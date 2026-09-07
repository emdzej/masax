/**
 * The read boundary.
 *
 * ASA addresses every record as an offset in a `.bin`, taken from a sorted
 * `.pnt` index — see `docs/data-format.md`. A record read is "two bytes at
 * `offset` for the length, then that many bytes", which is exactly the shape
 * of an HTTP `Range` request and of `Blob.slice()`. So the engine needs one
 * primitive and gets its backends for free.
 */

export interface Reader {
  /** Total length of the underlying resource, in bytes. */
  size(): Promise<number>;
  /** Read `len` bytes at `pos`. Returns fewer only at EOF. */
  read(pos: number, len: number): Promise<Uint8Array>;
  /**
   * Read many ranges. A plate view is one read per part record, so backends
   * that can overlap them should.
   */
  readMany(ranges: ReadonlyArray<readonly [pos: number, len: number]>): Promise<Uint8Array[]>;
  close?(): Promise<void>;
}

/** Shared `readMany` for backends with no better idea. */
export abstract class BaseReader implements Reader {
  abstract size(): Promise<number>;
  abstract read(pos: number, len: number): Promise<Uint8Array>;

  async readMany(
    ranges: ReadonlyArray<readonly [pos: number, len: number]>,
  ): Promise<Uint8Array[]> {
    const out: Uint8Array[] = [];
    for (const [pos, len] of ranges) out.push(await this.read(pos, len));
    return out;
  }
}

/** A reader over an in-memory buffer, for preloaded indexes and small files. */
export class BytesReader extends BaseReader {
  constructor(private readonly bytes: Uint8Array) {
    super();
  }

  async size(): Promise<number> {
    return this.bytes.length;
  }

  async read(pos: number, len: number): Promise<Uint8Array> {
    return this.bytes.subarray(pos, pos + len);
  }

  override async readMany(
    ranges: ReadonlyArray<readonly [pos: number, len: number]>,
  ): Promise<Uint8Array[]> {
    return ranges.map(([pos, len]) => this.bytes.subarray(pos, pos + len));
  }
}

/** A reader over a browser `Blob` or `File` — the picked-directory path. */
export class BlobReader extends BaseReader {
  constructor(private readonly blob: Blob) {
    super();
  }

  async size(): Promise<number> {
    return this.blob.size;
  }

  async read(pos: number, len: number): Promise<Uint8Array> {
    if (len === 0) return new Uint8Array(0);
    return new Uint8Array(await this.blob.slice(pos, pos + len).arrayBuffer());
  }

  override async readMany(
    ranges: ReadonlyArray<readonly [pos: number, len: number]>,
  ): Promise<Uint8Array[]> {
    return Promise.all(ranges.map(([pos, len]) => this.read(pos, len)));
  }
}

/**
 * A reader over HTTP `Range` requests — the static-hosting path.
 *
 * A host that ignores `Range` and answers 200 with the whole body would make
 * every read silently return the wrong bytes, so anything but 206 is rejected
 * with a message that names the cause.
 */
export class HttpRangeReader extends BaseReader {
  private cachedSize?: number;

  constructor(
    private readonly url: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    super();
  }

  async size(): Promise<number> {
    if (this.cachedSize !== undefined) return this.cachedSize;
    const res = await this.fetchImpl(this.url, { method: "HEAD" });
    if (!res.ok) throw new Error(`HEAD ${this.url}: ${res.status}`);
    const len = res.headers.get("content-length");
    if (len === null) throw new Error(`HEAD ${this.url}: no content-length`);
    return (this.cachedSize = Number(len));
  }

  async read(pos: number, len: number): Promise<Uint8Array> {
    if (len === 0) return new Uint8Array(0);
    const res = await this.fetchImpl(this.url, {
      headers: { Range: `bytes=${pos}-${pos + len - 1}` },
    });
    if (res.status !== 206) {
      throw new Error(
        `GET ${this.url} with Range returned ${res.status}, expected 206. ` +
          `The host is ignoring Range requests, so every read would return the wrong bytes.`,
      );
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  override async readMany(
    ranges: ReadonlyArray<readonly [pos: number, len: number]>,
  ): Promise<Uint8Array[]> {
    return Promise.all(ranges.map(([pos, len]) => this.read(pos, len)));
  }
}

/**
 * Where the files come from.
 *
 * Kept separate from `Reader` because the format needs two different things:
 * whole small files (schemas, indexes) and byte ranges of large ones. It also
 * needs to *list* a directory, because `.fdt` templates carry a `@` that has to
 * be resolved against whatever variants are actually present.
 */
export interface Source {
  /** Read a whole file. For schemas and indexes, not for `.bin`. */
  readFile(path: string): Promise<Uint8Array>;
  /** Open a reader for range reads over a large file. */
  open(path: string): Promise<Reader>;
  /** Names of the entries directly in `dir`, without paths. */
  list(dir: string): Promise<string[]>;
}
