/**
 * Node filesystem backend. Kept in its own module so the browser bundle never
 * pulls `node:fs` in through the package entry point.
 */
import { open, readdir, readFile, stat, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { BaseReader, type Reader, type Source } from "./reader.js";

export class NodeFileReader extends BaseReader {
  private handle?: FileHandle;
  private cachedSize?: number;

  constructor(private readonly path: string) {
    super();
  }

  private async fh(): Promise<FileHandle> {
    this.handle ??= await open(this.path, "r");
    return this.handle;
  }

  async size(): Promise<number> {
    this.cachedSize ??= (await stat(this.path)).size;
    return this.cachedSize;
  }

  async read(pos: number, len: number): Promise<Uint8Array> {
    if (len === 0) return new Uint8Array(0);
    const buf = new Uint8Array(len);
    const { bytesRead } = await (await this.fh()).read(buf, 0, len, pos);
    return bytesRead === len ? buf : buf.subarray(0, bytesRead);
  }

  async close(): Promise<void> {
    await this.handle?.close();
    this.handle = undefined;
  }
}

/** A `Source` rooted at a directory on disk — a mounted disc or an import. */
export class NodeSource implements Source {
  private readonly listings = new Map<string, string[]>();

  constructor(private readonly root: string) {}

  private resolve(path: string): string {
    return path ? join(this.root, path) : this.root;
  }

  async readFile(path: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.resolve(path)));
  }

  async open(path: string): Promise<Reader> {
    return new NodeFileReader(this.resolve(path));
  }

  async list(dir: string): Promise<string[]> {
    const cached = this.listings.get(dir);
    if (cached) return cached;
    let entries: string[];
    try {
      entries = await readdir(this.resolve(dir));
    } catch {
      entries = [];
    }
    this.listings.set(dir, entries);
    return entries;
  }
}
