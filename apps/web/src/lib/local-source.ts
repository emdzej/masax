/**
 * A `Source` over a directory the user picked.
 *
 * `File.slice()` is the same `read(pos, len)` the engine wants, so a mounted
 * disc or an imported tree needs no conversion — which is the whole reason the
 * read boundary is one method.
 */
import { BlobReader, type Reader, type Source } from "@masax/lex";

export class LocalSource implements Source {
  private readonly dirs = new Map<string, FileSystemDirectoryHandle>();
  private readonly listings = new Map<string, string[]>();

  constructor(private readonly root: FileSystemDirectoryHandle) {
    this.dirs.set("", root);
  }

  private async dir(path: string): Promise<FileSystemDirectoryHandle> {
    const cached = this.dirs.get(path);
    if (cached) return cached;
    let handle = this.root;
    for (const part of path.split("/").filter(Boolean)) {
      handle = await this.childDirectory(handle, part);
    }
    this.dirs.set(path, handle);
    return handle;
  }

  /** Directory names differ in case between discs — `Illust` and `ILLUST`. */
  private async childDirectory(
    parent: FileSystemDirectoryHandle,
    name: string,
  ): Promise<FileSystemDirectoryHandle> {
    try {
      return await parent.getDirectoryHandle(name);
    } catch {
      const wanted = name.toLowerCase();
      for await (const entry of parent.values()) {
        if (entry.name.toLowerCase() === wanted && entry.kind === "directory") {
          return entry as FileSystemDirectoryHandle;
        }
      }
      throw new Error(`${name}: no such directory`);
    }
  }

  private async file(path: string): Promise<File> {
    const at = path.lastIndexOf("/");
    const dir = await this.dir(at === -1 ? "" : path.slice(0, at));
    const name = at === -1 ? path : path.slice(at + 1);
    try {
      return await (await dir.getFileHandle(name)).getFile();
    } catch {
      const wanted = name.toLowerCase();
      for await (const entry of dir.values()) {
        if (entry.name.toLowerCase() === wanted && entry.kind === "file") {
          return await (entry as FileSystemFileHandle).getFile();
        }
      }
      throw new Error(`${path}: no such file`);
    }
  }

  async readFile(path: string): Promise<Uint8Array> {
    return new Uint8Array(await (await this.file(path)).arrayBuffer());
  }

  async open(path: string): Promise<Reader> {
    return new BlobReader(await this.file(path));
  }

  async list(dir: string): Promise<string[]> {
    const cached = this.listings.get(dir);
    if (cached) return cached;
    const names: string[] = [];
    try {
      const handle = await this.dir(dir);
      for await (const entry of handle.values()) names.push(entry.name);
    } catch {
      // A missing directory lists as empty; callers report the real problem.
    }
    this.listings.set(dir, names);
    return names;
  }
}
