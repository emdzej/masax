/**
 * Turning what the user typed into a filesystem rooted at a module.
 *
 * The user mounts the ISOs and points at the mount points. Neither is a module
 * root, neither is complete on its own, and their volume names are no guide —
 * disc A mounts as `MMC-A` and disc B as `MMC ASA 2`. So: survey each, overlay
 * them, and root the result at the module they share.
 */
import chalk from "chalk";
import type { CsFileSystem } from "@emdzej/csfs-core";
import { nodeFileSystem } from "@emdzej/csfs-node";
import {
  describeSurvey,
  overlay,
  scoped,
  survey,
  type AsaModule,
  type Layer,
} from "@masax/importer";

export interface OpenedModule {
  fs: CsFileSystem;
  module: AsaModule;
  layers: Layer[];
  /** The overlay before it was rooted at the module, for copying. */
  merged: CsFileSystem;
}

export async function openModule(paths: string[], wanted?: string): Promise<OpenedModule> {
  if (paths.length === 0) throw new Error("give at least one directory or mount point");

  const layers: Layer[] = paths.map((path) => ({ name: path, fs: nodeFileSystem(path) }));
  for (const layer of layers) {
    const found = await survey(layer.fs);
    console.log(chalk.dim(`${layer.name}  ${describeSurvey(found)}`));
  }

  const merged = overlay(layers);
  const combined = await survey(merged);
  if (combined.modules.length === 0) {
    throw new Error(
      `no ASA module in ${paths.join(", ")}. Expected a directory containing EPC and ILLUST, ` +
        `or one containing M60.`,
    );
  }

  const module = wanted
    ? combined.modules.find((m) => m.code.toLowerCase() === wanted.toLowerCase())
    : // Prefer a module in a subdirectory over the root: a mounted disc has
      // both `/` (which has no EPC) and `/M60` (which does).
      (combined.modules.find((m) => m.has.epc && m.has.illust) ??
      combined.modules.find((m) => m.has.epc));
  if (!module) {
    throw new Error(
      `no module ${wanted ?? ""} here; found ${combined.modules.map((m) => m.code || "/").join(", ")}`,
    );
  }

  return { fs: scoped(merged, module.path), module, layers, merged };
}
