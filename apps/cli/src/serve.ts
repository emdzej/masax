/**
 * `masax serve` — a static server for a data tree, and optionally the client.
 *
 * The HTTP path needs a host that honours `Range`: the engine reads records by
 * byte range, and a server that answers 200 with the whole body would make
 * every read return the wrong bytes. `HttpRangeReader` rejects that rather than
 * trusting it, so there has to be something correct to point it at.
 *
 * Serving both from one origin also avoids CORS, which is the other thing that
 * makes "just open it in a browser" not work.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import chalk from "chalk";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

interface Mount {
  prefix: string;
  dir: string;
}

function send(req: IncomingMessage, res: ServerResponse, mounts: Mount[]): void {
  const path = decodeURIComponent((req.url ?? "/").split("?")[0]!);
  const mount = mounts.find((m) => path.startsWith(m.prefix));
  if (!mount) return void res.writeHead(404).end("not found\n");

  // Append the index before normalising, not after: `normalize("")` is ".",
  // and "." + "index.html" is ".index.html".
  let rest = path.slice(mount.prefix.length);
  if (rest === "" || rest.endsWith("/")) rest += "index.html";
  rest = normalize(rest);
  const file = join(mount.dir, rest);
  if (!file.startsWith(mount.dir) || !existsSync(file) || !statSync(file).isFile()) {
    return void res.writeHead(404).end("not found\n");
  }

  const size = statSync(file).size;
  const type = TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
  const common = { "accept-ranges": "bytes", "content-type": type };

  if (req.method === "HEAD") {
    return void res.writeHead(200, { ...common, "content-length": size }).end();
  }

  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) return void res.writeHead(416, common).end();
    const from = match[1] ? Number(match[1]) : 0;
    const to = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (from > to) return void res.writeHead(416, common).end();
    res.writeHead(206, {
      ...common,
      "content-range": `bytes ${from}-${to}/${size}`,
      "content-length": to - from + 1,
    });
    return void createReadStream(file, { start: from, end: to }).pipe(res);
  }

  res.writeHead(200, { ...common, "content-length": size });
  createReadStream(file).pipe(res);
}

export interface ServeOptions {
  port: number;
  host: string;
  app?: string;
}

export async function serve(root: string, options: ServeOptions): Promise<number> {
  const dataDir = resolve(root);
  if (!existsSync(dataDir)) {
    console.error(chalk.red(`${dataDir}: no such directory`));
    return 1;
  }
  if (!existsSync(join(dataDir, "manifest.json"))) {
    console.error(
      chalk.yellow(
        `${dataDir}/manifest.json is missing. HTTP cannot list a directory, so the\n` +
          `client needs one. Generate it with:  masax manifest ${root} -o ${root}/manifest.json`,
      ),
    );
  }

  const mounts: Mount[] = [{ prefix: "/data/", dir: dataDir }];
  const appDir = options.app ? resolve(options.app) : undefined;
  if (appDir) {
    if (!existsSync(join(appDir, "index.html"))) {
      console.error(chalk.red(`${appDir}: no index.html; build the client first`));
      return 1;
    }
    mounts.push({ prefix: "/", dir: appDir });
  }

  const server = createServer((req, res) => {
    try {
      send(req, res, mounts);
    } catch (cause) {
      res.writeHead(500).end(`${(cause as Error).message}\n`);
    }
  });

  await new Promise<void>((done) => server.listen(options.port, options.host, done));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  const base = `http://${options.host}:${port}`;

  console.log(chalk.dim(`data  ${dataDir}`));
  if (appDir) console.log(chalk.dim(`app   ${appDir}`));
  console.log("");
  if (appDir) {
    console.log(`  ${chalk.bold.cyan(`${base}/?tree=/data/`)}`);
    console.log(chalk.dim(`  the client, opening that tree straight away`));
  } else {
    console.log(`  ${chalk.bold.cyan(`${base}/data/`)}`);
    console.log(chalk.dim(`  paste this into the client's "static tree over HTTP" box`));
  }
  console.log("");
  console.log(chalk.dim("Ctrl-C to stop."));

  await new Promise(() => {});
  return 0;
}
