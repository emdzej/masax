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

export interface OfflineProgress {
  files: number;
  bytes: number;
  path: string;
}

/**
 * Copy a tree into the origin private filesystem.
 *
 * Worth it for the catalogue data, which is the part that must be resident to
 * be useful. The drawings are 210 MB and can stay where they are, so they are
 * excluded by default and the interface says so.
 */
export async function keepOffline(
  opened: Opened,
  options: { illustrations?: boolean; onProgress?: (p: OfflineProgress) => void } = {},
): Promise<{ files: number; bytes: number; granted: boolean }> {
  const target = await opfsFileSystem({ caseInsensitive: true });
  const granted = await persist();
  let files = 0;
  let bytes = 0;
  const result = await copyTree(opened.fs, target, {
    filter: (path, entry) =>
      options.illustrations === true ||
      !(entry.kind === "directory" && /^illust$/i.test(path.split("/").pop() ?? "")),
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
  const fs = await opfsFileSystem({ caseInsensitive: true });
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

export async function offlineQuota(): Promise<{ usage: number; quota: number } | undefined> {
  if (!isOpfsSupported()) return undefined;
  const q = await quota();
  return { usage: q.usage ?? 0, quota: q.quota ?? 0 };
}
