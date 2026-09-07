/**
 * `masax verify` — the regression test for the format code.
 *
 * Every record of every dataset is decoded in storage order and checked to
 * consume exactly its declared payload length. Three further invariants are
 * checked because each one was, at some point, wrong:
 *
 *  - the sequential scan must end exactly at the end of the file, so no record
 *    is skipped and none is invented;
 *  - every `.pnt` offset must land on a record boundary;
 *  - the run key derived from the data must match the one declared in
 *    `@masax/catalogue`, so a declaration cannot quietly go stale.
 *
 * The index covers only the first record of each run, so an earlier version of
 * this command validated 1.9 M records and believed that was all of them. It is
 * really 5.6 M.
 */
import chalk from "chalk";
import { Dataset, findVariants, parseDdm, parseFdt, resolveFile } from "@masax/lex";
import type { CsFileSystem } from "@emdzej/csfs-core";
import { datasetLocations, type DatasetLocation } from "@masax/catalogue";

export interface VerifyOptions {
  generation: 1 | 2;
  schema: boolean;
  only?: string;
  runKeys: boolean;
}

interface Result {
  label: string;
  records: number;
  indexed: number;
  problems: string[];
}

/**
 * Catalogue ids come from `CInfo`, which lists them authoritatively.
 *
 * They must not be discovered from filenames: `catalog`'s template is `@.bin`,
 * which glob-matches every `.bin` in the directory.
 */
async function mustRead(fs: CsFileSystem, path: string): Promise<Uint8Array> {
  const bytes = await fs.read(path);
  if (!bytes) throw new Error(`${path}: not found`);
  return bytes;
}

async function catalogueIds(fs: CsFileSystem, dir: string): Promise<string[]> {
  const cinfo = await Dataset.open(fs, dir, "CInfo");
  const ids: string[] = [];
  for await (const { record } of cinfo.indexEntries()) {
    const id = record["A0"];
    if (typeof id === "string" && id) ids.push(id);
  }
  await cinfo.close();
  return ids;
}

async function variantsFor(
  fs: CsFileSystem,
  location: DatasetLocation,
  catalogues: string[],
): Promise<(string | undefined)[]> {
  if (location.variant === "none") return [undefined];
  if (location.variant === "catalogue") return catalogues;
  const ddmPath = await resolveFile(fs, location.dir, `${location.name}.ddm`);
  const ddm = parseDdm(await mustRead(fs, ddmPath));
  const fdtPath = await resolveFile(fs, location.dir, ddm.fdt ?? `${location.name}.fdt`);
  const fdt = parseFdt(await mustRead(fs, fdtPath));
  return findVariants(fs, location.dir, fdt.binTemplate);
}

export async function verify(fs: CsFileSystem, options: VerifyOptions): Promise<number> {
  const locations = datasetLocations(options.generation).filter(
    (l) => !options.only || l.name.toLowerCase() === options.only.toLowerCase(),
  );

  const dataDir = `EPC/DATA${options.generation}`;
  let catalogues: string[] = [];
  try {
    catalogues = await catalogueIds(fs, dataDir);
  } catch (error) {
    console.error(chalk.red(`cannot read ${dataDir}/CInfo: ${(error as Error).message}`));
    return 1;
  }
  console.log(chalk.dim(`${catalogues.length} catalogues listed in ${dataDir}/CInfo`));

  const results: Result[] = [];
  for (const location of locations) {
    let variants: (string | undefined)[];
    try {
      variants = await variantsFor(fs, location, catalogues);
    } catch (error) {
      if (!location.optional) {
        results.push({
          label: `${location.dir}/${location.name}`,
          records: 0,
          indexed: 0,
          problems: [(error as Error).message],
        });
      }
      continue;
    }

    let present = 0;
    let records = 0;
    let indexed = 0;
    const problems: string[] = [];

    for (const variant of variants) {
      let dataset: Dataset;
      try {
        dataset = await Dataset.open(fs, location.dir, location.name, variant);
      } catch {
        continue;
      }
      present++;
      if (options.schema) console.log(describeSchema(dataset));
      indexed += dataset.count;

      const sorted = dataset.index.checkSorted();
      if (!sorted.ok) problems.push(`.pnt is not sorted at entry ${sorted.at}`);

      try {
        const declared = location.runKey ?? [];
        const derived = await dataset.deriveRunKey();
        if (options.runKeys) {
          console.log(
            `  ${location.name}${variant ? `[${variant}]` : ""}: ` +
              `${derived.records} records, ${derived.runs} runs, ` +
              `never continued [${derived.neverContinued.join(", ")}]`,
          );
        } else {
          // Declaring a field inherited is only safe if the data never carries
          // it mid-run. The reverse is fine: a field that never continues but
          // is not declared simply is not carried forward.
          const unsafe = declared.filter((c) => !derived.neverContinued.includes(c));
          if (unsafe.length > 0) {
            problems.push(
              `inheriting [${unsafe.join(", ")}] is unsafe: the data sets ` +
                `${unsafe.length === 1 ? "it" : "them"} in continuation records too`,
            );
          }
          // `runs === 0` means the dataset never sets its first field at all —
          // `ASP` is like that — so there is nothing to inherit from.
          if (derived.runs > 0 && derived.records > derived.runs && declared.length === 0) {
            problems.push(
              `${derived.records - derived.runs} records continue a run but no run key is declared`,
            );
          }
        }

        const offsets = await dataset.recordOffsets();
        for (let i = 0; i < dataset.index.count; i++) {
          const offset = dataset.index.offsetAt(i);
          if (!offsets.has(offset)) {
            problems.push(`.pnt entry ${i} points at ${offset}, not a record boundary`);
            break;
          }
        }

        // A run-key field can legitimately stay undefined: a single-model
        // catalogue never sets `A2`, so there is nothing to carry. The scan
        // itself is the check — it fails if the file does not frame exactly.
        for await (const _entry of dataset.scan(declared)) records++;
      } catch (error) {
        problems.push((error as Error).message);
      }
      await dataset.close();
      if (problems.length > 0) break;
    }

    if (present === 0) {
      if (!location.optional) {
        results.push({
          label: `${location.dir}/${location.name}`,
          records: 0,
          indexed: 0,
          problems: ["no data files present"],
        });
      }
      continue;
    }
    results.push({
      label: `${location.dir}/${location.name}`,
      records,
      indexed,
      problems,
    });
  }

  let totalRecords = 0;
  let totalIndexed = 0;
  let failed = 0;
  for (const r of results) {
    totalRecords += r.records;
    totalIndexed += r.indexed;
    if (r.problems.length > 0) {
      failed++;
      console.log(`${chalk.red("FAIL")} ${r.label.padEnd(26)} ${r.problems[0]}`);
    } else {
      console.log(
        `${chalk.green("ok  ")} ${r.label.padEnd(26)} ` +
          `${String(r.records).padStart(9)} records  ` +
          `${String(r.indexed).padStart(8)} indexed`,
      );
    }
  }

  console.log("");
  const line =
    `${totalRecords} records decode exactly, ` +
    `${totalIndexed} of them reachable through an index`;
  console.log(failed === 0 ? chalk.green(line) : chalk.red(line));
  return failed === 0 ? 0 : 1;
}

function describeSchema(dataset: Dataset): string {
  const head =
    `${dataset.name}${dataset.variant ? `[${dataset.variant}]` : ""}  ` +
    `rows=${dataset.count}  ${dataset.fdt.sparse ? "sparse" : "dense"}  ` +
    `keys=[${dataset.fdt.keys.join(", ")}] entry=${dataset.index.entrySize}B`;
  const lines = [chalk.bold(head)];
  const render = (field: (typeof dataset.fields)[number], depth: number) => {
    const kind =
      field.storage === 1
        ? "group"
        : field.storage === 2
          ? "array[u8]"
          : field.storage === 4
            ? "array[u16]"
            : "";
    lines.push(
      `  ${"  ".repeat(depth)}${field.code.padEnd(3)} ${kind.padEnd(10)} ` +
        `w=${String(field.width).padEnd(4)} ${field.name}`,
    );
    for (const child of field.children) {
      const named = dataset.fields.find((f) => f.code === child.code);
      if (named) render(named, depth + 1);
    }
  };
  for (const field of dataset.fields) {
    if (dataset.fdt.tree.some((t) => t.code === field.code)) render(field, 0);
  }
  return lines.join("\n");
}
