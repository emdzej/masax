/**
 * `masax survey` and `masax import`.
 *
 * The expected flow is: mount the ISOs, point masax at the mount points. Every
 * other command reads them in place through an overlay, so importing is
 * optional — you do it when you want a single tree to host or to keep, not
 * before you can look at anything.
 *
 * Nothing is transformed. Files land byte-for-byte as they were on the disc,
 * because the format is already self-describing and range-readable; converting
 * it would only add a step that can rot.
 */
import chalk from "chalk";
import { nodeFileSystem } from "@emdzej/csfs-node";
import { MANIFEST_FILE, buildManifest, formatManifest } from "@emdzej/csfs-manifest";
import { copyTree, describeSurvey, findConflicts, survey, type Layer } from "@masax/importer";
import { openModule } from "./open.js";

const size = (bytes: number) =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${(bytes / 1e6).toFixed(1)} MB`;

export async function surveyPaths(paths: string[]): Promise<number> {
  let found = 0;
  for (const path of paths) {
    const result = await survey(nodeFileSystem(path));
    const label = result.modules.length > 0 ? chalk.green("ASA ") : chalk.yellow("?   ");
    console.log(`${label} ${path}`);
    console.log(`      ${describeSurvey(result)}`);
    if (result.installerMarkers.length > 0) {
      console.log(chalk.dim(`      installer: ${result.installerMarkers.join(", ")}`));
    }
    found += result.modules.length;
  }
  if (found === 0) {
    console.log("");
    console.log(
      chalk.yellow(
        "Nothing recognised. Mount the ISOs first and point at the mount points —\n" +
          "on macOS `hdiutil attach -readonly MMC_ASA_EUR_A.iso` gives /Volumes/MMC-A.",
      ),
    );
    return 1;
  }
  return 0;
}

export interface ImportOptions {
  out: string;
  module?: string;
  dryRun: boolean;
  compareBytes: boolean;
  illustrations: boolean;
}

export async function importDiscs(paths: string[], options: ImportOptions): Promise<number> {
  const opened = await openModule(paths, options.module);
  const code = opened.module.code || "module";
  console.log(
    chalk.bold(
      `${code}: EPC generations ${opened.module.generations.join(", ") || "none"}` +
        `${opened.module.has.illust ? ", illustrations" : ""}`,
    ),
  );

  // A silent winner is the failure worth guarding against: the same path on two
  // discs with different bytes loses one of them with no error.
  if (opened.layers.length > 1) {
    process.stdout.write(chalk.dim("checking for conflicts between discs… "));
    const conflicts = await findConflicts(opened.layers, {
      compareBytes: options.compareBytes,
    });
    if (conflicts.length === 0) {
      console.log(chalk.green("none"));
    } else {
      console.log(chalk.red(`${conflicts.length}`));
      for (const conflict of conflicts.slice(0, 20)) {
        console.log(`  ${conflict.path}  ${JSON.stringify(conflict.sizes)}`);
      }
      console.log(
        chalk.red("\nRefusing to import: one of these would be silently lost. Resolve first."),
      );
      return 1;
    }
  }

  const target = nodeFileSystem(options.out);
  // Overwrite one line when there is a terminal; print one line per directory
  // when there is not, because \r into a pipe runs the whole log together.
  const interactive = process.stdout.isTTY === true;
  let lastDir = "";
  const result = await copyTree(opened.fs, target, {
    dryRun: options.dryRun,
    filter: (path, entry) => {
      if (!options.illustrations && /^illust(\/|$)/i.test(path) && entry.kind === "directory") {
        return false;
      }
      return true;
    },
    onFile: (path) => {
      const dir = path.split("/").slice(0, -1).join("/") || ".";
      if (dir === lastDir) return;
      lastDir = dir;
      if (interactive) process.stdout.write(`\r${chalk.dim(`  ${dir.slice(0, 70).padEnd(70)}`)}`);
      else console.log(chalk.dim(`  ${dir}`));
    },
  });
  if (interactive) process.stdout.write(`\r${" ".repeat(76)}\r`);

  console.log(
    `${options.dryRun ? "would copy" : "copied"} ${result.files} files, ${size(result.bytes)}` +
      `${result.skipped.length > 0 ? `, skipped ${result.skipped.length}` : ""}`,
  );
  if (options.dryRun) return 0;

  const manifest = await buildManifest(target, {
    label: `Mitsubishi ASA ${code}`,
    builtAt: new Date().toISOString(),
  });
  await target.write(MANIFEST_FILE, new TextEncoder().encode(formatManifest(manifest)));
  console.log(
    `wrote ${MANIFEST_FILE} — ${Object.keys(manifest.files).length} entries, ` +
      chalk.dim("so the tree can be served over HTTP"),
  );
  console.log("");
  console.log(`  masax verify ${options.out}`);
  return 0;
}
