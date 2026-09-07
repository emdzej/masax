/**
 * A filesystem rooted at a subdirectory.
 *
 * A mount point is not a module root: mounting a disc gives a volume with
 * `M60/` inside it, and the catalogue is one level down. Scoping means the rest
 * of the code keeps taking a filesystem whose root *is* the module, rather than
 * every caller having to carry a prefix around.
 */
import {
  statVia,
  type CsDirectory,
  type CsFile,
  type CsFileSystem,
  type CsStat,
} from "@emdzej/csfs-core";

const clean = (path: string) => path.replace(/^\/+|\/+$/g, "");

class ScopedFileSystem implements CsFileSystem {
  readonly kind: string;

  constructor(
    private readonly inner: CsFileSystem,
    private readonly prefix: string,
  ) {
    this.kind = `${inner.kind}:${prefix}`;
  }

  private at(path: string): string {
    const rest = clean(path);
    return rest ? `${this.prefix}/${rest}` : this.prefix;
  }

  file(path: string): Promise<CsFile | null> {
    return this.inner.file(this.at(path));
  }

  directory(path: string): Promise<CsDirectory | null> {
    return this.inner.directory(this.at(path));
  }

  read(path: string): Promise<Uint8Array | null> {
    return this.inner.read(this.at(path));
  }

  async stat(path: string): Promise<CsStat | null> {
    const root = await this.directory("/");
    return root ? statVia(root, path) : null;
  }

  async directUrl(path: string): Promise<string | null> {
    return this.inner.directUrl ? this.inner.directUrl(this.at(path)) : null;
  }
}

/** `fs` seen as though `prefix` were its root. `""` returns `fs` unchanged. */
export function scoped(fs: CsFileSystem, prefix: string): CsFileSystem {
  const at = clean(prefix);
  return at ? new ScopedFileSystem(fs, at) : fs;
}
