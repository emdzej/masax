/**
 * `masax manifest` — describe a tree so it can be served over HTTP.
 *
 * HTTP cannot list a directory, and the engine needs listings for two things:
 * resolving a name case-insensitively (`PNC.BIN` beside `pnc.pnt`) and
 * expanding the `@` in a filename template. A map of directory to names covers
 * both, and it is small — a few tens of kB for a whole module.
 */
import { readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import chalk from "chalk";

export interface TreeManifest {
  entries: Record<string, string[]>;
}

export async function writeManifest(root: string, out: string): Promise<number> {
  const entries: Record<string, string[]> = {};
  let directories = 0;
  let files = 0;

  const walk = async (dir: string): Promise<void> => {
    const found = await readdir(dir, { withFileTypes: true });
    const key = relative(root, dir).split("\\").join("/");
    entries[key] = found.map((e) => e.name);
    directories++;
    files += found.filter((e) => e.isFile()).length;
    for (const entry of found) {
      if (entry.isDirectory()) await walk(join(dir, entry.name));
    }
  };
  await walk(root);

  const json = JSON.stringify({ entries } satisfies TreeManifest);
  await writeFile(out, json);
  console.log(
    `${directories} directories, ${files} files -> ${out} ` +
      chalk.dim(`(${(json.length / 1024).toFixed(1)} kB)`),
  );
  return 0;
}
