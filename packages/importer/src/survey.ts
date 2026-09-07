/**
 * Recognising what the user pointed at.
 *
 * The media is **not self-describing**: nothing on a disc says which disc it
 * is, and the volume names are no help — disc A mounts as `MMC-A` and disc B as
 * `MMC ASA 2`. So a mount point is identified by what is inside it.
 *
 * A mount point is also not the module root. The user mounts an ISO and gets a
 * volume containing `M60/`, and the catalogue lives one level down. Asking them
 * to navigate into it would be a worse interface than looking.
 */
import type { CsFileSystem } from "@emdzej/csfs-core";

/** A module root: the directory holding `EPC` and `ILLUST`. */
export interface AsaModule {
  /** Path within the filesystem, `""` when the root itself is the module. */
  path: string;
  /** Module code, e.g. `M60`. Empty when it cannot be told from the path. */
  code: string;
  /** Which of the expected directories are present. */
  has: { epc: boolean; illust: boolean; prog: boolean };
  /** Catalogue data generations present, e.g. `[1]` or `[1, 2]`. */
  generations: (1 | 2)[];
}

export interface Survey {
  /** Every module root found, outermost first. */
  modules: AsaModule[];
  /** Directories that mark this as installation media rather than an install. */
  installerMarkers: string[];
  /** Present only on the disc that carries the update chain. */
  updateCount: number;
}

const MODULE_NAME = /^M\d{2}$/i;

async function names(fs: CsFileSystem, path: string): Promise<string[]> {
  const dir = await fs.directory(path || "/");
  if (!dir) return [];
  return (await dir.entries()).map((e) => e.name);
}

const findName = (entries: string[], wanted: string): string | undefined =>
  entries.find((e) => e.toLowerCase() === wanted.toLowerCase());

async function describeModule(
  fs: CsFileSystem,
  path: string,
  code: string,
): Promise<AsaModule | undefined> {
  const entries = await names(fs, path);
  const epc = findName(entries, "EPC");
  const illust = findName(entries, "ILLUST");
  const prog = findName(entries, "PROG");
  if (!epc && !illust) return undefined;

  const generations: (1 | 2)[] = [];
  if (epc) {
    const inEpc = await names(fs, path ? `${path}/${epc}` : epc);
    for (const generation of [1, 2] as const) {
      if (findName(inEpc, `DATA${generation}`)) generations.push(generation);
    }
  }
  return {
    path,
    code,
    has: { epc: Boolean(epc), illust: Boolean(illust), prog: Boolean(prog) },
    generations,
  };
}

/**
 * Look for ASA modules at the root and one level down.
 *
 * One level is enough for every shape that occurs: a mounted disc
 * (`/M60/EPC`), an installation (`ASA/M60/EPC` — point at `ASA`), or a module
 * root itself. Going deeper would start matching things by accident.
 */
export async function survey(fs: CsFileSystem): Promise<Survey> {
  const modules: AsaModule[] = [];
  const root = await describeModule(fs, "", "");
  if (root) modules.push(root);

  const entries = await names(fs, "");
  for (const entry of entries) {
    const found = await describeModule(
      fs,
      entry,
      MODULE_NAME.test(entry) ? entry.toUpperCase() : "",
    );
    if (found) modules.push(found);
  }

  const installerMarkers = ["Install", "Client", "Server", "setup.EXE", "setup.ini"].filter(
    (marker) => findName(entries, marker),
  );

  let updateCount = 0;
  const update = findName(entries, "UPDATE");
  if (update) {
    updateCount = (await names(fs, update)).filter((n) => /^asacm.*\.exe$/i.test(n)).length;
  }

  return { modules, installerMarkers, updateCount };
}

/** One-line description, for the CLI and the interface. */
export function describeSurvey(survey: Survey): string {
  if (survey.modules.length === 0) return "no ASA module found";
  const parts = survey.modules.map((module) => {
    const where = module.path || "the root";
    const bits = [
      module.has.epc ? `EPC(${module.generations.join(",") || "?"})` : "",
      module.has.illust ? "ILLUST" : "",
      module.has.prog ? "PROG" : "",
    ].filter(Boolean);
    return `${module.code || where}: ${bits.join(" + ")}`;
  });
  if (survey.updateCount > 0) parts.push(`${survey.updateCount} update packages`);
  return parts.join("; ");
}
