/**
 * A `Source` over a static tree served by HTTP.
 *
 * HTTP cannot list a directory, so the tree has to be described. The engine
 * needs listings for exactly two things — resolving names case-insensitively
 * and expanding the `@` in a filename template — so a flat map of directory to
 * names is enough.
 */
import { HttpRangeReader, type Reader, type Source } from "@masax/lex";

export interface TreeManifest {
  /** Directory path, without leading or trailing slash, to the names inside. */
  entries: Record<string, string[]>;
}

export class HttpSource implements Source {
  constructor(
    private readonly base: string,
    private readonly manifest: TreeManifest,
  ) {}

  static async load(base: string): Promise<HttpSource> {
    // Resolve against the page first: a relative tree like `/data/` is not a
    // valid base for `new URL`, which needs an absolute one.
    const root = new URL(base.endsWith("/") ? base : `${base}/`, location.href).toString();
    const url = new URL("manifest.json", root);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        `${url}: ${res.status}. A static tree needs a manifest, because HTTP ` +
          `cannot list a directory.`,
      );
    }
    return new HttpSource(root, (await res.json()) as TreeManifest);
  }

  private url(path: string): string {
    return new URL(path, this.base).toString();
  }

  async readFile(path: string): Promise<Uint8Array> {
    const res = await fetch(this.url(path));
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async open(path: string): Promise<Reader> {
    return new HttpRangeReader(this.url(path));
  }

  async list(dir: string): Promise<string[]> {
    return this.manifest.entries[dir] ?? [];
  }
}
