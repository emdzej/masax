/**
 * A dataset — one `.ddm`/`.fdt`/`.bin`/`.pnt` quadruple.
 *
 * The `.bin` and `.pnt` names come from the `.fdt`, not from the `.ddm`'s own
 * name, and they may contain a `@` standing for a language code or a catalogue
 * id. Filenames also mix case freely: `PNC.BIN` sits beside `pnc.pnt`, so every
 * lookup resolves case-insensitively.
 */
import { parseDdm, type Ddm, type DdmField } from "./ddm.js";
import { parseFdt, type Fdt, type Field } from "./fdt.js";
import { PntIndex, type PntKey } from "./pnt.js";
import { decodeRecord, type LexRecord } from "./record.js";
import { BytesReader, type Reader, type Source } from "./reader.js";

/** A field with the `.ddm` comment folded in — the name worth showing a user. */
export interface NamedField extends Field {
  /** `.ddm` comment when there is one, else the `.fdt` label. */
  name: string;
  /** `S` or `I` from the `.ddm`, when present. */
  kind?: string;
}

export interface DatasetEntry {
  key: PntKey;
  record: LexRecord;
}

const joinPath = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

/** Resolve `name` in `dir` case-insensitively, returning the real path. */
export async function resolveFile(source: Source, dir: string, name: string): Promise<string> {
  const wanted = name.toLowerCase();
  for (const entry of await source.list(dir)) {
    if (entry.toLowerCase() === wanted) return joinPath(dir, entry);
  }
  throw new Error(`${joinPath(dir, name)}: not found`);
}

/**
 * Names that fill the `@` in a template, from what is actually on disk.
 *
 * Beware the degenerate case: `catalog`'s template is `@.bin`, which matches
 * *every* `.bin` in the directory. Callers wanting catalogue ids should read
 * them from `CInfo`, which lists them authoritatively, rather than trusting
 * this.
 */
export async function findVariants(
  source: Source,
  dir: string,
  template: string,
): Promise<string[]> {
  const at = template.indexOf("@");
  if (at === -1) return [];
  const prefix = template.slice(0, at).toLowerCase();
  const suffix = template.slice(at + 1).toLowerCase();
  const found = new Set<string>();
  for (const entry of await source.list(dir)) {
    const lower = entry.toLowerCase();
    if (!lower.startsWith(prefix) || !lower.endsWith(suffix)) continue;
    if (entry.length <= prefix.length + suffix.length) continue;
    found.add(entry.slice(prefix.length, entry.length - suffix.length));
  }
  return [...found].sort();
}

export class Dataset {
  private constructor(
    readonly name: string,
    readonly dir: string,
    readonly variant: string | undefined,
    readonly ddm: Ddm,
    readonly fdt: Fdt,
    readonly index: PntIndex,
    readonly fields: NamedField[],
    private readonly bin: Reader,
    private readonly binPath: string,
  ) {}

  static async open(source: Source, dir: string, name: string, variant?: string): Promise<Dataset> {
    const ddmPath = await resolveFile(source, dir, `${name}.ddm`);
    const ddm = parseDdm(await source.readFile(ddmPath));
    const fdtPath = await resolveFile(source, dir, ddm.fdt ?? `${name}.fdt`);
    const fdt = parseFdt(await source.readFile(fdtPath));

    const fill = (template: string) => template.replace("@", variant ?? "");
    const binPath = await resolveFile(source, dir, fill(fdt.binTemplate));
    const pntPath = await resolveFile(source, dir, fill(fdt.pntTemplate));

    const index = new PntIndex(await source.readFile(pntPath), fdt);
    const bin = await source.open(binPath);

    return new Dataset(
      name,
      dir,
      variant,
      ddm,
      fdt,
      index,
      nameFields(fdt.fields, ddm.fields),
      bin,
      binPath,
    );
  }

  /** Which `@` values exist for this dataset's `.bin` template. */
  static async variants(source: Source, dir: string, name: string): Promise<string[]> {
    const ddmPath = await resolveFile(source, dir, `${name}.ddm`);
    const ddm = parseDdm(await source.readFile(ddmPath));
    const fdtPath = await resolveFile(source, dir, ddm.fdt ?? `${name}.fdt`);
    const fdt = parseFdt(await source.readFile(fdtPath));
    return findVariants(source, dir, fdt.binTemplate);
  }

  get count(): number {
    return this.index.count;
  }

  get path(): string {
    return this.binPath;
  }

  /** The record at index position `i`. */
  async at(i: number): Promise<DatasetEntry> {
    const offset = this.index.offsetAt(i);
    const header = await this.bin.read(offset, 2);
    if (header.length < 2) throw new Error(`${this.name}: no record at offset ${offset}`);
    const length = header[0]! | (header[1]! << 8);
    const body = await this.bin.read(offset + 2, length);
    const { record, used } = decodeRecord(body, this.fdt);
    if (used !== length) {
      throw new Error(
        `${this.name} entry ${i}: fields consumed ${used} of ${length} declared bytes`,
      );
    }
    return { key: this.index.keyAt(i), record };
  }

  /** Look up one key. Undefined when it is not in the index. */
  async get(key: PntKey): Promise<LexRecord | undefined> {
    const at = this.index.find(key);
    if (at === -1) return undefined;
    return (await this.at(at)).record;
  }

  /**
   * Look up many keys in one batch.
   *
   * Two rounds of `readMany` — lengths, then bodies — so a plate view costs two
   * round trips rather than two per part.
   */
  async getMany(keys: readonly PntKey[]): Promise<(LexRecord | undefined)[]> {
    const positions = keys.map((k) => this.index.find(k));
    const present = positions.filter((p) => p !== -1).map((p) => this.index.offsetAt(p));
    const headers = await this.bin.readMany(present.map((o) => [o, 2] as const));
    const lengths = headers.map((h) => h[0]! | (h[1]! << 8));
    const bodies = await this.bin.readMany(present.map((o, i) => [o + 2, lengths[i]!] as const));

    const out: (LexRecord | undefined)[] = [];
    let cursor = 0;
    for (const position of positions) {
      if (position === -1) {
        out.push(undefined);
        continue;
      }
      const body = bodies[cursor]!;
      const { record, used } = decodeRecord(body, this.fdt);
      if (used !== lengths[cursor]!) {
        throw new Error(`${this.name}: fields consumed ${used} of ${lengths[cursor]} bytes`);
      }
      out.push(record);
      cursor++;
    }
    return out;
  }

  /**
   * Every record, in key order.
   *
   * This pulls the whole `.bin` into memory, because walking 400 MB two bytes
   * at a time is not what the range-read path is for. Use it from the CLI, not
   * from the browser — `A/VIN.BIN` alone is 76 MB.
   */
  async *records(): AsyncGenerator<DatasetEntry> {
    const size = await this.bin.size();
    const whole = new BytesReader(await this.bin.read(0, size));
    for (let i = 0; i < this.index.count; i++) {
      const offset = this.index.offsetAt(i);
      const header = await whole.read(offset, 2);
      const length = header[0]! | (header[1]! << 8);
      const body = await whole.read(offset + 2, length);
      const { record, used } = decodeRecord(body, this.fdt);
      if (used !== length) {
        throw new Error(
          `${this.name} entry ${i} (key ${String(this.index.keyAt(i))}): ` +
            `fields consumed ${used} of ${length} declared bytes`,
        );
      }
      yield { key: this.index.keyAt(i), record };
    }
  }

  async close(): Promise<void> {
    await this.bin.close?.();
  }
}

function nameFields(fields: Field[], ddmFields: DdmField[]): NamedField[] {
  const byCode = new Map(ddmFields.map((f) => [f.code, f]));
  return fields.map((field) => {
    const ddm = byCode.get(field.code);
    return {
      ...field,
      kind: ddm?.kind,
      name: ddm?.comment || field.label,
    };
  });
}
