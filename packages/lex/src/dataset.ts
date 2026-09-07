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
import type { Reader, Source } from "./reader.js";

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

export interface ScanEntry {
  /** Byte offset of the record in the `.bin`. */
  offset: number;
  record: LexRecord;
  /** True when this record began a run, i.e. it carried the run-key fields. */
  runStart: boolean;
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
   * The records the index points at — one per run, not one per record.
   *
   * For most datasets the index covers every record, but for the navigation
   * and parts tables it does not: see `scan`.
   */
  async *indexEntries(): AsyncGenerator<DatasetEntry> {
    const whole = await this.whole();
    for (let i = 0; i < this.index.count; i++) {
      const offset = this.index.offsetAt(i);
      const { record } = this.decodeAt(whole, offset, `entry ${i}`);
      yield { key: this.index.keyAt(i), record };
    }
  }

  /**
   * Every record in the `.bin`, in storage order, with run-key fields carried
   * forward.
   *
   * **The index does not cover every record.** It points at the first record of
   * each run: 259 entries for `SGroup`'s 34,555 records, 5,150 for a
   * catalogue's 77,556. Records after the first in a run omit the fields that
   * have not changed, and those fields have to be inherited from the preceding
   * record or the row is meaningless — a part with no PNC and no model.
   *
   * `inherit` must list only the run-key fields. Carrying *every* absent field
   * forward is wrong and dangerously so: `E1` (OPC) and `E2` (Classification)
   * are per-record applicability, and propagating them makes a part look like
   * it fits a vehicle it does not. On one plate that turns 1 option-restricted
   * part into 42. See `deriveRunKey` for how the right set is established.
   *
   * This pulls the whole `.bin` into memory. That is what the CLI wants, and
   * what the browser wants for a single catalogue (a few MB); it is not what
   * either wants for `VIN.BIN` at 76 MB.
   */
  async *scan(inherit: readonly string[] = []): AsyncGenerator<ScanEntry> {
    const whole = await this.whole();
    const carry: LexRecord = {};
    let at = 0;
    while (at + 2 <= whole.length) {
      const length = whole[at]! | (whole[at + 1]! << 8);
      if (length === 0) break;
      const { record } = this.decodeAt(whole, at, `offset ${at}`);
      for (const code of inherit) {
        const value = record[code];
        if (value !== undefined) carry[code] = value;
        else if (carry[code] !== undefined) record[code] = carry[code]!;
      }
      yield {
        offset: at,
        record,
        runStart: inherit.length === 0 || record[inherit[0]!] !== undefined,
      };
      at += 2 + length;
    }
    if (at !== whole.length) {
      throw new Error(`${this.name}: sequential scan ended at ${at} of ${whole.length} bytes`);
    }
  }

  /**
   * Every record of the run that index entry `i` points at.
   *
   * Index offsets are monotonic, so a run ends where the next entry begins.
   * That makes a run a single bounded range read rather than a scan of the
   * file: 186 bytes on average for `Vin`, 18 KB at worst. This is the path the
   * browser uses — `A/VIN.BIN` is 76 MB and is never downloaded.
   *
   * `inherit` is applied within the run, seeded from its first record, which is
   * self-sufficient by definition of a run start.
   */
  async readRun(i: number, inherit: readonly string[] = []): Promise<LexRecord[]> {
    if (i < 0 || i >= this.index.count) return [];
    const from = this.index.offsetAt(i);
    const to = i + 1 < this.index.count ? this.index.offsetAt(i + 1) : await this.bin.size();
    const window = await this.bin.read(from, to - from);

    const out: LexRecord[] = [];
    const carry: LexRecord = {};
    let at = 0;
    while (at + 2 <= window.length) {
      const length = window[at]! | (window[at + 1]! << 8);
      if (length === 0) break;
      const { record, used } = decodeRecord(window.subarray(at + 2, at + 2 + length), this.fdt);
      if (used !== length) {
        throw new Error(`${this.name} run ${i}: fields consumed ${used} of ${length} bytes`);
      }
      for (const code of inherit) {
        const value = record[code];
        if (value !== undefined) carry[code] = value;
        else if (carry[code] !== undefined) record[code] = carry[code]!;
      }
      out.push(record);
      at += 2 + length;
    }
    return out;
  }

  /** The run for `key`, or an empty array when the key is not indexed. */
  async runFor(key: PntKey, inherit: readonly string[] = []): Promise<LexRecord[]> {
    return this.readRun(this.index.find(key), inherit);
  }

  /** Byte offsets of every record, for checking the index lands on boundaries. */
  async recordOffsets(): Promise<Set<number>> {
    const whole = await this.whole();
    const offsets = new Set<number>();
    let at = 0;
    while (at + 2 <= whole.length) {
      const length = whole[at]! | (whole[at + 1]! << 8);
      if (length === 0) break;
      offsets.add(at);
      at += 2 + length;
    }
    return offsets;
  }

  private cachedWhole?: Uint8Array;

  private async whole(): Promise<Uint8Array> {
    this.cachedWhole ??= await this.bin.read(0, await this.bin.size());
    return this.cachedWhole;
  }

  private decodeAt(whole: Uint8Array, offset: number, where: string) {
    const length = whole[offset]! | (whole[offset + 1]! << 8);
    const { record, used } = decodeRecord(
      whole.subarray(offset + 2, offset + 2 + length),
      this.fdt,
    );
    if (used !== length) {
      throw new Error(`${this.name} ${where}: fields consumed ${used} of ${length} declared bytes`);
    }
    return { record, length };
  }

  /**
   * Work out which fields may be inherited, from the data.
   *
   * The property that matters is **never present in a continuation record**. A
   * field that only ever appears where a run begins can be carried forward
   * safely; a field that also appears mid-run is per-record data, and carrying
   * it forward invents values. For a catalogue `A1`, `A2`, `B1`, `B2` never
   * continue, while `E1` (OPC) appears in 35% of continuation records.
   *
   * "Present in every run start" is *not* the right test, though it looks like
   * it on the biggest catalogues: a single-model catalogue omits `A2` even at
   * run starts, so that test drops `A2` for three of the 52 and the derived key
   * would disagree with itself between files.
   *
   * `alwaysAtStart` is reported too, since a field in `neverContinued` but not
   * in `alwaysAtStart` is one whose first record simply did not set it.
   */
  async deriveRunKey(): Promise<{
    runKey: string[];
    neverContinued: string[];
    alwaysAtStart: string[];
    records: number;
    runs: number;
  }> {
    const whole = await this.whole();
    const first = this.fdt.tree[0]!.code;
    const atStart = new Map<string, number>();
    const later = new Map<string, number>();
    let records = 0;
    let runs = 0;
    let at = 0;
    while (at + 2 <= whole.length) {
      const length = whole[at]! | (whole[at + 1]! << 8);
      if (length === 0) break;
      const { record } = this.decodeAt(whole, at, `offset ${at}`);
      const isStart = record[first] !== undefined;
      if (isStart) runs++;
      const bucket = isStart ? atStart : later;
      for (const field of this.fdt.tree) {
        if (record[field.code] !== undefined) {
          bucket.set(field.code, (bucket.get(field.code) ?? 0) + 1);
        }
      }
      records++;
      at += 2 + length;
    }
    if (records === runs) {
      return { runKey: [], neverContinued: [], alwaysAtStart: [], records, runs };
    }
    const neverContinued = this.fdt.tree
      .filter((f) => (later.get(f.code) ?? 0) === 0)
      .map((f) => f.code);
    const alwaysAtStart = this.fdt.tree
      .filter((f) => (atStart.get(f.code) ?? 0) === runs)
      .map((f) => f.code);
    return {
      runKey: neverContinued.filter((c) => alwaysAtStart.includes(c)),
      neverContinued,
      alwaysAtStart,
      records,
      runs,
    };
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
