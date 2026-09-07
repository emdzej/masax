/**
 * Several filesystems read as one.
 *
 * The catalogue is split across two discs and neither is complete: disc A
 * carries 30 catalogues and the `DATA1/A` index half, disc B the other 22 and
 * `DATA1/B`. Both write into the same `M60/EPC/DATA1`, so reading one alone
 * gives a catalogue with holes.
 *
 * Overlaying them means the user can mount both and read straight from them —
 * no copying, no transformation, nothing to go stale. Copying into one tree is
 * then something you do when you *want* a single tree (to host, or to keep
 * offline), not something you must do before you can look at anything.
 *
 * Earlier layers win. That is only safe because the discs were checked: 81
 * paths appear on both and all 81 are byte-identical, so there is nothing for a
 * precedence rule to get wrong. `findConflicts` re-checks that rather than
 * trusting it.
 */
import {
  statVia,
  type CsDirectory,
  type CsEntry,
  type CsFile,
  type CsFileSystem,
  type CsStat,
} from "@emdzej/csfs-core";

export interface Layer {
  /** How this layer is described in a message, e.g. a mount point. */
  name: string;
  fs: CsFileSystem;
}

const clean = (path: string) => path.replace(/^\/+|\/+$/g, "");

/**
 * The real name of a child, ignoring case.
 *
 * **Names must be matched case-insensitively across layers.** Disc A spells the
 * drawings directory `Illust` and disc B spells it `ILLUST`, and an ISO 9660
 * mount is case-sensitive — so asking disc B for `Illust` returns nothing and
 * half the drawings vanish with no error. That is exactly what happened: an
 * import took 9,402 of the 18,760 and reported success.
 */
async function realName(
  dir: CsDirectory,
  name: string,
  kind: "file" | "directory",
): Promise<string | null> {
  const wanted = name.toLowerCase();
  for (const entry of await dir.entries()) {
    if (entry.kind === kind && entry.name.toLowerCase() === wanted) return entry.name;
  }
  return null;
}

class OverlayDirectory implements CsDirectory {
  private merged?: CsEntry[];

  constructor(
    readonly path: string,
    readonly name: string,
    private readonly dirs: CsDirectory[],
  ) {}

  async entries(): Promise<CsEntry[]> {
    if (this.merged) return this.merged;
    // First layer wins on a name clash, and directories merge rather than
    // shadow — otherwise disc A's EPC/DATA1 would hide disc B's catalogues.
    const seen = new Map<string, CsEntry>();
    for (const dir of this.dirs) {
      for (const entry of await dir.entries()) {
        const key = entry.name.toLowerCase();
        if (!seen.has(key)) seen.set(key, entry);
      }
    }
    return (this.merged = [...seen.values()]);
  }

  async file(name: string): Promise<CsFile | null> {
    for (const dir of this.dirs) {
      const direct = await dir.file(name);
      if (direct) return direct;
      const actual = await realName(dir, name, "file");
      if (actual && actual !== name) {
        const found = await dir.file(actual);
        if (found) return found;
      }
    }
    return null;
  }

  async directory(name: string): Promise<CsDirectory | null> {
    const found: CsDirectory[] = [];
    for (const dir of this.dirs) {
      let child = await dir.directory(name);
      if (!child) {
        const actual = await realName(dir, name, "directory");
        if (actual && actual !== name) child = await dir.directory(actual);
      }
      if (child) found.push(child);
    }
    if (found.length === 0) return null;
    return new OverlayDirectory(
      this.path === "/" ? `/${name}` : `${this.path}/${name}`,
      name,
      found,
    );
  }
}

export class OverlayFileSystem implements CsFileSystem {
  readonly kind = "overlay";

  constructor(readonly layers: Layer[]) {
    if (layers.length === 0) throw new Error("an overlay needs at least one layer");
  }

  /** Which layer answered for a path, for diagnostics. */
  async layerFor(path: string): Promise<string | undefined> {
    for (const layer of this.layers) {
      if (await layer.fs.stat(path)) return layer.name;
    }
    return undefined;
  }

  private async root(): Promise<OverlayDirectory | null> {
    const found: CsDirectory[] = [];
    for (const layer of this.layers) {
      const dir = await layer.fs.directory("/");
      if (dir) found.push(dir);
    }
    return found.length > 0 ? new OverlayDirectory("/", "", found) : null;
  }

  /**
   * Resolve a path one segment at a time.
   *
   * Not by handing the whole path to each layer: that would use each layer's
   * own case rules, and the layers disagree. Walking makes every step go
   * through `OverlayDirectory`, which matches names ignoring case.
   */
  async file(path: string): Promise<CsFile | null> {
    const parts = clean(path).split("/").filter(Boolean);
    const name = parts.pop();
    if (!name) return null;
    let dir = await this.root();
    for (const part of parts) {
      const next = await dir?.directory(part);
      if (!next) return null;
      dir = next as OverlayDirectory;
    }
    return dir ? dir.file(name) : null;
  }

  async directory(path: string): Promise<CsDirectory | null> {
    let dir = await this.root();
    for (const part of clean(path).split("/").filter(Boolean)) {
      const next = await dir?.directory(part);
      if (!next) return null;
      dir = next as OverlayDirectory;
    }
    return dir;
  }

  async read(path: string): Promise<Uint8Array | null> {
    const file = await this.file(path);
    return file ? file.bytes() : null;
  }

  async stat(path: string): Promise<CsStat | null> {
    const root = await this.directory("/");
    return root ? statVia(root, path) : null;
  }
}

export function overlay(layers: Layer[]): CsFileSystem {
  return layers.length === 1 ? layers[0]!.fs : new OverlayFileSystem(layers);
}

export interface Conflict {
  path: string;
  /** Layer name to the size it reports, for the layers that have the path. */
  sizes: Record<string, number>;
}

export interface ConflictOptions {
  /** Where to start. Default: the whole tree. */
  root?: string;
  /**
   * Compare contents, not just sizes.
   *
   * Off by default because it reads every shared file — 81 files and 46 MB for
   * the European discs, which is quick, but the same sweep over an installation
   * would not be.
   */
  compareBytes?: boolean;
  onProgress?: (path: string) => void;
}

/**
 * Paths present in more than one layer whose contents differ.
 *
 * A silent winner is the failure mode worth guarding against: the same path on
 * two discs with different bytes loses one of them with no error, which is how
 * an image archive went missing in the sibling project.
 */
export async function findConflicts(
  layers: Layer[],
  options: ConflictOptions = {},
): Promise<Conflict[]> {
  const conflicts: Conflict[] = [];
  const root = options.root ?? "";

  const walk = async (dir: string): Promise<void> => {
    const listings = new Map<string, { layer: Layer; entries: CsEntry[] }[]>();
    for (const layer of layers) {
      const handle = await layer.fs.directory(dir || "/");
      if (!handle) continue;
      for (const entry of await handle.entries()) {
        const key = entry.name.toLowerCase();
        const bucket = listings.get(key) ?? [];
        bucket.push({ layer, entries: [entry] });
        listings.set(key, bucket);
      }
    }

    for (const bucket of listings.values()) {
      const first = bucket[0]!.entries[0]!;
      const path = dir ? `${dir}/${first.name}` : first.name;
      if (first.kind === "directory") {
        await walk(path);
        continue;
      }
      if (bucket.length < 2) continue;

      options.onProgress?.(path);
      const sizes: Record<string, number> = {};
      for (const { layer, entries } of bucket) {
        const entry = entries[0]!;
        sizes[layer.name] = entry.kind === "file" ? entry.size : 0;
      }
      const distinct = new Set(Object.values(sizes));
      if (distinct.size > 1) {
        conflicts.push({ path, sizes });
        continue;
      }
      if (!options.compareBytes) continue;

      const contents = await Promise.all(bucket.map(({ layer }) => layer.fs.read(path)));
      const reference = contents[0];
      if (!reference) continue;
      const differs = contents.some(
        (other) =>
          !other ||
          other.length !== reference.length ||
          other.some((byte, at) => byte !== reference[at]),
      );
      if (differs) conflicts.push({ path, sizes });
    }
  };

  await walk(clean(root));
  return conflicts;
}
