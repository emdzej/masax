/**
 * `masax verify` — the regression test for the format code.
 *
 * Decodes every record of every dataset and checks each one consumes exactly
 * its declared payload length. That check is strong: it is what caught the
 * array count width, the short presence bitmap and the integer endianness,
 * each of which had already passed on most of the data.
 */
import chalk from "chalk";
import { Dataset, findVariants, parseDdm, parseFdt, resolveFile } from "@masax/lex";
import { NodeSource } from "@masax/lex/node";
import { datasetLocations, type DatasetLocation } from "@masax/catalogue";

export interface VerifyOptions {
  generation: 1 | 2;
  schema: boolean;
  only?: string;
}

interface Result {
  location: DatasetLocation;
  variant?: string;
  rows: number;
  clean: number;
  error?: string;
}

/**
 * Catalogue ids come from `CInfo`, which lists them authoritatively.
 *
 * They must not be discovered from the filenames: `catalog`'s template is
 * `@.bin`, which glob-matches every `.bin` in the directory. An earlier sweep
 * did exactly that and reported a format failure that was really `PBOOK.BIN`
 * and `DESC_GB.BIN` being counted as catalogues.
 */
async function catalogueIds(source: NodeSource, dir: string): Promise<string[]> {
  const cinfo = await Dataset.open(source, dir, "CInfo");
  const ids: string[] = [];
  for await (const { record } of cinfo.records()) {
    const id = record["A0"];
    if (typeof id === "string" && id) ids.push(id);
  }
  await cinfo.close();
  return ids;
}

async function variantsFor(
  source: NodeSource,
  location: DatasetLocation,
  catalogues: string[],
): Promise<(string | undefined)[]> {
  if (location.variant === "none") return [undefined];
  if (location.variant === "catalogue") return catalogues;
  const ddmPath = await resolveFile(source, location.dir, `${location.name}.ddm`);
  const ddm = parseDdm(await source.readFile(ddmPath));
  const fdtPath = await resolveFile(source, location.dir, ddm.fdt ?? `${location.name}.fdt`);
  const fdt = parseFdt(await source.readFile(fdtPath));
  return findVariants(source, location.dir, fdt.binTemplate);
}

export async function verify(root: string, options: VerifyOptions): Promise<number> {
  const source = new NodeSource(root);
  const locations = datasetLocations(options.generation).filter(
    (l) => !options.only || l.name.toLowerCase() === options.only.toLowerCase(),
  );

  const dataDir = `EPC/DATA${options.generation}`;
  let catalogues: string[] = [];
  try {
    catalogues = await catalogueIds(source, dataDir);
  } catch (error) {
    console.error(chalk.red(`cannot read ${dataDir}/CInfo: ${(error as Error).message}`));
    return 1;
  }
  console.log(chalk.dim(`${catalogues.length} catalogues listed in ${dataDir}/CInfo`));

  const results: Result[] = [];
  for (const location of locations) {
    let variants: (string | undefined)[];
    try {
      variants = await variantsFor(source, location, catalogues);
    } catch (error) {
      if (location.optional) continue;
      results.push({ location, rows: 0, clean: 0, error: (error as Error).message });
      continue;
    }

    let present = 0;
    let rows = 0;
    let clean = 0;
    let firstError: string | undefined;

    for (const variant of variants) {
      let dataset: Dataset;
      try {
        dataset = await Dataset.open(source, location.dir, location.name, variant);
      } catch {
        continue; // no data files for this variant
      }
      present++;
      if (options.schema) console.log(describeSchema(dataset));

      const sorted = dataset.index.checkSorted();
      if (!sorted.ok) {
        firstError ??= `${location.name}: .pnt is not sorted at entry ${sorted.at}`;
      }

      rows += dataset.count;
      try {
        for await (const _entry of dataset.records()) clean++;
      } catch (error) {
        firstError ??= (error as Error).message;
      }
      await dataset.close();
    }

    if (present === 0) {
      if (!location.optional) {
        results.push({ location, rows: 0, clean: 0, error: "no data files present" });
      }
      continue;
    }
    results.push({ location, rows, clean, error: firstError });
  }

  let totalRows = 0;
  let totalClean = 0;
  let failed = 0;
  for (const r of results) {
    totalRows += r.rows;
    totalClean += r.clean;
    const label = `${r.location.dir}/${r.location.name}`;
    if (r.error) {
      failed++;
      console.log(`${chalk.red("FAIL")} ${label.padEnd(26)} ${r.clean}/${r.rows}  ${r.error}`);
    } else {
      console.log(
        `${chalk.green("ok  ")} ${label.padEnd(26)} ${String(r.clean).padStart(8)}/${String(r.rows).padEnd(8)} clean`,
      );
    }
  }

  const pct = totalRows === 0 ? 0 : (100 * totalClean) / totalRows;
  const line = `${totalClean}/${totalRows} records decode exactly (${pct.toFixed(4)}%)`;
  console.log("");
  console.log(failed === 0 ? chalk.green(line) : chalk.red(line));
  return failed === 0 && totalClean === totalRows ? 0 : 1;
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
