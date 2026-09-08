/**
 * `masax show` and `masax vin` — the read path from a terminal.
 *
 * The point of these is to exercise catalogue -> model -> group -> plate ->
 * parts, and VIN -> vehicle, before any pixels exist. If a plate looks wrong
 * here it is wrong in the data or the domain, not in the interface.
 */
import chalk from "chalk";
import { AsaCatalogue, VinNotWellFormed, type PartRow } from "@masax/catalogue";
import type { Language } from "@masax/core";
import { formatAsaDate, formatAsaDateShort } from "@masax/core";
import type { CsFileSystem } from "@emdzej/csfs-core";

export interface ShowOptions {
  generation: 1 | 2;
  language: Language;
}

const dateRange = (row: { startDate?: number; endDate?: number }) => {
  const from = formatAsaDateShort(row.startDate);
  const to = formatAsaDateShort(row.endDate);
  return from || to ? `${from || "?"} - ${to || "?"}` : "";
};

export async function show(
  fs: CsFileSystem,
  path: string[],
  options: ShowOptions,
): Promise<number> {
  const catalogue = await AsaCatalogue.open(fs, options);
  const [id, model, mainGroupText, subGroupText] = path;

  if (!id) {
    const all = catalogue.catalogues();
    console.log(chalk.bold(`${all.length} catalogues`));
    for (const info of all) {
      console.log(
        `  ${chalk.cyan(info.id)}  ${(info.name ?? "").padEnd(28)} ` +
          `type=${info.type ?? "-"} package=${info.dataPackage ?? "-"}`,
      );
    }
    await catalogue.close();
    return 0;
  }

  const info = catalogue.catalogue(id);
  if (!info) {
    console.error(chalk.red(`no catalogue ${id}; run without arguments to list them`));
    await catalogue.close();
    return 1;
  }

  if (!model) {
    const models = catalogue.models(id);
    console.log(chalk.bold(`${id} — ${info.name ?? "?"}: ${models.length} models`));
    console.log(`  ${models.join("  ")}`);
    await catalogue.close();
    return 0;
  }

  if (!mainGroupText) {
    const groups = catalogue.mainGroupsFor(id, model);
    console.log(chalk.bold(`${id} / ${model}: ${groups.length} main groups`));
    for (const group of groups) {
      console.log(
        `  ${chalk.cyan(String(group.mainGroup).padStart(2))}  ${(group.name ?? "").padEnd(34)} ` +
          `${group.illustration ?? ""}`,
      );
    }
    await catalogue.close();
    return 0;
  }

  const mainGroup = Number(mainGroupText);
  if (!subGroupText) {
    const plates = catalogue.platesFor(id, model, mainGroup);
    console.log(chalk.bold(`${id} / ${model} / main group ${mainGroup}: ${plates.length} plates`));
    for (const plate of plates) {
      console.log(
        `  ${chalk.cyan(String(plate.subGroup).padStart(3))}  ${(plate.name ?? "").padEnd(34)} ` +
          `${(plate.note ?? "").padEnd(24)} ${plate.illustration ?? ""}`,
      );
    }
    await catalogue.close();
    return 0;
  }

  const subGroup = Number(subGroupText);
  // A subgroup number can carry several plates, each with its own drawing and
  // its own share of one shared parts run. Print every one of them: picking the
  // first would silently hide the others and show a list belonging to all three.
  const plates = catalogue.platesFor(id, model, mainGroup).filter((p) => p.subGroup === subGroup);
  const label = `${id} / ${model} / ${mainGroup}-${String(subGroup).padStart(3, "0")}`;
  if (plates.length === 0) {
    console.error(`${label}: no such plate`);
    await catalogue.close();
    return 1;
  }
  if (plates.length > 1) {
    console.log(chalk.dim(`${label}: ${plates.length} plates share this number\n`));
  }
  for (const plate of plates) {
    const parts = await catalogue.partsForPlate(id, model, mainGroup, subGroup, plate.illustration);
    const whole = await catalogue.partsFor(id, model, mainGroup, subGroup);
    console.log(chalk.bold(`${label}${plate.name ? ` — ${plate.name}` : ""}`));
    if (plate.note) console.log(chalk.dim(`  ${plate.note}`));
    if (plate.illustration) console.log(chalk.dim(`  drawing ${plate.illustration}`));
    console.log(
      `  ${"PNC".padEnd(8)}${"part".padEnd(12)}${"qty".padEnd(4)}` +
        `${"dates".padEnd(30)}${"OPC".padEnd(5)}name / applicability`,
    );
    for (const row of parts) console.log(`  ${formatPart(row)}`);
    const codes = new Set(parts.map((p) => p.pnc)).size;
    const shared = parts.length === whole.length ? "" : ` of ${whole.length} in the subgroup run`;
    console.log(chalk.dim(`\n  ${parts.length} parts${shared}, ${codes} part-name codes\n`));
  }
  await catalogue.close();
  return 0;
}

function formatPart(row: PartRow): string {
  const applicability = [
    row.classification?.length ? `class ${row.classification.join(",")}` : "",
    row.applicableCodes?.length ? `codes ${row.applicableCodes.length}` : "",
    row.feature ?? "",
  ]
    .filter(Boolean)
    .join("  ");
  return (
    `${row.pnc.padEnd(8)}${(row.partNumber ?? "").padEnd(12)}${(row.quantity ?? "").padEnd(4)}` +
    `${dateRange(row).padEnd(24)}${(row.opc ?? "-").padEnd(5)}` +
    `${row.name ?? ""}${applicability ? `  ${chalk.dim(applicability)}` : ""}`
  );
}

export async function decodeVin(
  fs: CsFileSystem,
  vin: string,
  options: ShowOptions,
): Promise<number> {
  const catalogue = await AsaCatalogue.open(fs, options);
  try {
    const result = await catalogue.vin.decode(vin);
    console.log(
      chalk.bold(result.vin) + chalk.dim(`   chassis ${result.chassis} + serial ${result.serial}`),
    );
    const rows = result.matches.length > 0 ? result.matches : result.sameSerial;
    if (result.matches.length === 0) {
      if (rows.length === 0) {
        console.log(chalk.yellow(`  serial ${result.serial} is not in this data`));
        await catalogue.close();
        return 1;
      }
      console.log(
        chalk.yellow(
          `  no vehicle with chassis ${result.chassis}; ` +
            `${rows.length} others share the serial:`,
        ),
      );
    }
    for (const row of rows.slice(0, result.matches.length > 0 ? rows.length : 10)) {
      console.log(
        `  ${chalk.cyan(row.chassis + row.serial)}  half=${row.half}  ` +
          `model=${(row.model ?? "-").padEnd(6)} class=${(row.classification ?? "-").padEnd(9)} ` +
          `built=${formatAsaDate(row.productionDate) || "-"}`,
      );
      console.log(
        `    OPC ${row.opc ?? "-"}   paint ${row.paint ?? "-"}   ` +
          `interior ${row.interior ?? "-"}   exterior ${row.exterior ?? "-"}`,
      );
      const resolved = catalogue.resolveVehicle(row);
      if (resolved) {
        console.log(
          `    ${chalk.green("catalogue")} ${resolved.catalogue} ` +
            `${chalk.bold(resolved.name ?? "")} model ${resolved.model}` +
            chalk.dim(
              `  (from ${resolved.via}` +
                (resolved.alternatives.length ? `, over ${resolved.alternatives.join(", ")}` : "") +
                `)`,
            ),
        );
        console.log(chalk.dim(`    masax show <root> ${resolved.catalogue} ${resolved.model}`));
      } else {
        console.log(chalk.yellow(`    no catalogue lists model ${row.model ?? "?"}`));
      }
    }
    await catalogue.close();
    return result.matches.length > 0 ? 0 : 1;
  } catch (error) {
    if (error instanceof VinNotWellFormed) {
      console.error(chalk.red(error.message));
      await catalogue.close();
      return 2;
    }
    throw error;
  }
}
