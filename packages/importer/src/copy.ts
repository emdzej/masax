/**
 * Copying a merged tree out.
 *
 * Nothing is transformed: every file lands byte-for-byte as it was on the disc.
 * The format is self-describing and range-readable as it stands, so converting
 * it would only add a step that can rot. What a copy buys is a *single* tree —
 * one thing to host, or to keep for offline use — not a better one.
 */
import { isWritable, type CsDirectory, type CsEntry, type CsFileSystem } from "@emdzej/csfs-core";

export interface CopyOptions {
  /** Subtree to copy. Default: everything. */
  root?: string;
  /** Return false to skip a file or a whole directory. */
  filter?: (path: string, entry: CsEntry) => boolean;
  onFile?: (path: string, bytes: number) => void;
  /** Report progress without writing anything. */
  dryRun?: boolean;
}

export interface CopyResult {
  files: number;
  bytes: number;
  /** Paths skipped by the filter, so a caller can show what was left out. */
  skipped: string[];
}

const clean = (path: string) => path.replace(/^\/+|\/+$/g, "");

export async function copyTree(
  from: CsFileSystem,
  to: CsFileSystem,
  options: CopyOptions = {},
): Promise<CopyResult> {
  if (!options.dryRun && !isWritable(to)) {
    throw new Error(`${to.kind} cannot be written to`);
  }
  const result: CopyResult = { files: 0, bytes: 0, skipped: [] };

  // Walk with the directory handle rather than re-resolving each path from the
  // root: the listing already knows the child's real name, and on an overlay a
  // fresh resolve costs a listing per layer per segment.
  const walk = async (handle: CsDirectory, dir: string): Promise<void> => {
    for (const entry of await handle.entries()) {
      const path = dir ? `${dir}/${entry.name}` : entry.name;
      if (options.filter && !options.filter(path, entry)) {
        result.skipped.push(path);
        continue;
      }
      if (entry.kind === "directory") {
        const child = await handle.directory(entry.name);
        if (child) await walk(child, path);
        continue;
      }
      const file = await handle.file(entry.name);
      if (!file) continue;
      if (!options.dryRun && isWritable(to)) {
        // Streamed rather than buffered: VIN.BIN is 76 MB and there is no
        // reason for it to be resident to be copied.
        await to.write(path, file.stream());
      }
      result.files++;
      result.bytes += file.size;
      options.onFile?.(path, file.size);
    }
  };

  const start = clean(options.root ?? "");
  const root = await from.directory(start || "/");
  if (root) await walk(root, start);
  return result;
}
