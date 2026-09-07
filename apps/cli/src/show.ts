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
import { NodeSource } from "@masax/lex/node";

export interface ShowOptions {
  generation: 1 | 2;
  language: Language;
}

const dateRange = (row: { startDate?: number; endDate?: number }) => {
  const from = formatAsaDateShort(row.startDate);
  const to = formatAsaDateShort(row.endDate);
  return from || to ? `${from || "?"} - ${to || "?"}` : "";
};

export async function show(root: string, path: string[], options: ShowOptions): Promise<number> {
  const catalogue = await AsaCatalogue.open(new NodeSource(root), options);
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
  const parts = await catalogue.partsFor(id, model, mainGroup, subGroup);
  const plate = catalogue.platesFor(id, model, mainGroup).find((p) => p.subGroup === subGroup);
  console.log(
    chalk.bold(
      `${id} / ${model} / ${mainGroup}-${String(subGroup).padStart(3, "0")}` +
        `${plate?.name ? ` — ${plate.name}` : ""}`,
    ),
  );
  if (plate?.illustration) console.log(chalk.dim(`  drawing ${plate.illustration}`));
  console.log(
    `  ${"PNC".padEnd(8)}${"part".padEnd(12)}${"qty".padEnd(4)}` +
      `${"dates".padEnd(30)}${"OPC".padEnd(5)}name / applicability`,
  );
  for (const row of parts) console.log(`  ${formatPart(row)}`);
  console.log(
    chalk.dim(
      `\n  ${parts.length} parts, ${new Set(parts.map((p) => p.pnc)).size} part-name codes`,
    ),
  );
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

export async function decodeVin(root: string, vin: string, options: ShowOptions): Promise<number> {
  const catalogue = await AsaCatalogue.open(new NodeSource(root), options);
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
