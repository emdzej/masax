/**
 * Where the data comes from, in the browser.
 *
 * **A picked directory is the primary path.** The expected flow is: mount the
 * ISOs, point at the mount points. `File.slice()` is a range read, so the
 * catalogue is read in place — nothing is uploaded, extracted or converted, and
 * a 76 MB `VIN.BIN` never leaves the disc.
 *
 * HTTP is the fallback, for browsers without the File System Access API
 * (everything but Chromium) and for a hosted tree. OPFS is the third option:
 * copy once, then work offline.
 */
import type { CsFileSystem } from "@emdzej/csfs-core";
import { fsaFileSystem, isFsaSupported, pickDirectory } from "@emdzej/csfs-fsa";
import { httpFileSystem } from "@emdzej/csfs-http";
import { isOpfsSupported, opfsFileSystem, persist, quota } from "@emdzej/csfs-opfs";
import { copyTree, describeSurvey, findConflicts, overlay, scoped, survey } from "@masax/importer";
import type { AsaModule, Layer, Survey } from "@masax/importer";

export interface Disc {
  /** What to call it: the directory or volume name. */
  name: string;
  fs: CsFileSystem;
  survey: Survey;
  /** One line saying what was found, for the interface. */
  summary: string;
  /** Kept so it can be stored in IndexedDB and reopened next visit. */
  handle?: FileSystemDirectoryHandle;
}

export const canPickDirectory = isFsaSupported;
export const canStoreOffline = isOpfsSupported;

/** Wrap a handle we already have, and work out what is in it. */
export async function discFromHandle(handle: FileSystemDirectoryHandle): Promise<Disc> {
  // Case-insensitive because the data is: `PNC.BIN` sits beside `pnc.pnt`, and
  // disc A spells it `Illust` where disc B spells it `ILLUST`.
  const fs = fsaFileSystem(handle, { caseInsensitive: true });
  const found = await survey(fs);
  return { name: handle.name, fs, survey: found, summary: describeSurvey(found), handle };
}

/** Ask for a directory and work out what is in it. */
export async function addDisc(): Promise<Disc> {
  return discFromHandle(await pickDirectory("read"));
}

/** Rebuild the disc list from remembered handles, in order. */
export async function reopenDiscs(handles: FileSystemDirectoryHandle[]): Promise<Disc[]> {
  return Promise.all(handles.map(discFromHandle));
}

export interface Opened {
  fs: CsFileSystem;
  module: AsaModule;
  /** Merged view before it was rooted at the module, for copying. */
  merged: CsFileSystem;
  layers: Layer[];
}

/**
 * Combine the discs into one catalogue.
 *
 * Neither disc is complete — A has 30 catalogues and the `DATA1/A` index half,
 * B the other 22 and `DATA1/B` — and both write into the same `EPC/DATA1`, so
 * they are overlaid rather than chosen between.
 */
export function openDiscs(discs: Disc[], wanted?: string): Opened {
  if (discs.length === 0) throw new Error("no discs selected");
  const layers: Layer[] = discs.map((disc) => ({ name: disc.name, fs: disc.fs }));
  const merged = overlay(layers);

  const modules = discs.flatMap((disc) => disc.survey.modules);
  const module = wanted
    ? modules.find((m) => m.code.toLowerCase() === wanted.toLowerCase())
    : // Prefer the module that has both halves of what we need. A mounted disc
      // surveys as the root (no EPC) and as `M60` (which has it).
      (modules.find((m) => m.has.epc && m.has.illust) ?? modules.find((m) => m.has.epc));
  if (!module) {
    throw new Error(
      "No ASA catalogue here. Point at a mounted disc, or at a folder containing M60.",
    );
  }
  return { fs: scoped(merged, module.path), module, merged, layers };
}

/** Paths that appear on more than one disc with different contents. */
export async function checkDiscs(discs: Disc[]): Promise<string[]> {
  if (discs.length < 2) return [];
  const layers: Layer[] = discs.map((disc) => ({ name: disc.name, fs: disc.fs }));
  const conflicts = await findConflicts(layers);
  return conflicts.map((c) => c.path);
}

/** A hosted tree. The manifest is how it lists directories at all. */
export async function openHttp(base: string): Promise<Opened> {
  const fs = httpFileSystem(base);
  const found = await survey(fs);
  const module = found.modules.find((m) => m.has.epc);
  if (!module) throw new Error(`${base}: no ASA catalogue found`);
  return {
    fs: scoped(fs, module.path),
    module,
    merged: fs,
    layers: [{ name: base, fs }],
  };
}

/**
 * A subdirectory of our own inside OPFS.
 *
 * The origin private filesystem is shared by everything on the origin, so a
 * consumer rooted at `/` can see — and delete — another one's files. Namespaced
 * so that "delete the copy" means ours and nothing else.
 */
const NAMESPACE = "masax";

/** What masax actually reads, and so all a copy needs to hold. */
const NEEDED = /^epc$/i;
/** The drawings: 381 MB of the module, and optional.  */
const DRAWINGS = /^illust$/i;

export interface OfflineProgress {
  files: number;
  bytes: number;
  path: string;
}

/**
 * Copy the open source into the origin private filesystem.
 *
 * Not what makes the data available offline — a picked folder is already on
 * disk and needs no network. What this buys is the two frictions that remain:
 * a folder's permission does not survive a reload, so every session starts
 * with a click, and a hosted tree needs its host to be up. A copy in the
 * origin private filesystem needs neither.
 *
 * Takes the filesystem rather than an `Opened` so it can copy whatever is
 * mounted, however it was mounted.
 *
 * Only `EPC` is copied, plus `Illust` when asked. The rest of a module is the
 * original Windows program, its dongle drivers and its installer — 62 MB that
 * masax never opens and has no business putting in a browser's storage. The
 * drawings are another 381 MB, and a copy without them still answers "what is
 * this part number".
 */
export async function keepOffline(
  /** Whatever is open now — a picked folder, a hosted tree, an overlay of two discs. */
  source: CsFileSystem,
  options: { illustrations?: boolean; onProgress?: (p: OfflineProgress) => void } = {},
): Promise<{ files: number; bytes: number; granted: boolean }> {
  /*
   * Case-sensitive on purpose.
   *
   * Until `csfs-fsa` 0.1.1 this was forced: `dir(path, create)` would not
   * create a directory on a case-insensitive filesystem, so nothing under
   * `EPC/` could be written at all. That is fixed, and the choice stands on its
   * own merits.
   *
   * There is nothing here to be insensitive about — this creates the tree from
   * scratch with the source's own names — and case-insensitive resolution costs
   * a full directory listing for every segment of every path, which for a few
   * hundred files is a few hundred listings bought for nothing.
   *
   * Reading it back *does* need it, because the two discs disagree on `Illust`
   * versus `ILLUST`, so `openOffline` keeps it.
   */
  const target = await opfsFileSystem({ namespace: NAMESPACE });
  const granted = await persist();
  let files = 0;
  let bytes = 0;
  const result = await copyTree(source, target, {
    /*
     * Judged on the first path segment, not the last. A filter that matched any
     * directory named `illust` would also have to guess about everything else;
     * deciding at the top level says exactly which trees are wanted and lets
     * every path inside them through.
     */
    filter: (path) => {
      const top = path.split("/")[0] ?? "";
      if (path.includes("/")) return true;
      return NEEDED.test(top) || (options.illustrations === true && DRAWINGS.test(top));
    },
    onFile: (path, size) => {
      files++;
      bytes += size;
      options.onProgress?.({ files, bytes, path });
    },
  });
  return { files: result.files, bytes: result.bytes, granted };
}

/** An OPFS copy from a previous visit, if there is one. */
export async function openOffline(): Promise<Opened | undefined> {
  if (!isOpfsSupported()) return undefined;
  const fs = await opfsFileSystem({ caseInsensitive: true, namespace: NAMESPACE });
  const found = await survey(fs);
  const module = found.modules.find((m) => m.has.epc);
  if (!module) return undefined;
  return {
    fs: scoped(fs, module.path),
    module,
    merged: fs,
    layers: [{ name: "offline copy", fs }],
  };
}

/**
 * Delete the copy.
 *
 * Through the raw OPFS root rather than the filesystem abstraction, because
 * what is wanted is to remove the namespace directory itself — and because a
 * copy that cannot be deleted is a few hundred megabytes of the origin's quota
 * with no way out but clearing all site data.
 */
export async function clearOffline(): Promise<void> {
  if (!isOpfsSupported()) return;
  const root = await navigator.storage.getDirectory();
  try {
    await root.removeEntry(NAMESPACE, { recursive: true });
  } catch (cause) {
    // Already gone is success. Anything else is worth surfacing.
    if ((cause as DOMException)?.name !== "NotFoundError") throw cause;
  }
}

export async function offlineQuota(): Promise<{ usage: number; quota: number } | undefined> {
  if (!isOpfsSupported()) return undefined;
  const q = await quota();
  return { usage: q.usage ?? 0, quota: q.quota ?? 0 };
}
