/**
 * The whole chain in a real browser: HTTP `Range` -> engine -> catalogue ->
 * Group 4 decode -> canvas and parts table.
 *
 * Gated on `MASAX_DATA` pointing at an ASA module directory, because no data
 * lives in this repository. Without it the suite skips.
 *
 * The static server here answers `Range` properly on purpose: a host that
 * ignores it and returns 200 with the whole body would make every read return
 * the wrong bytes, and `HttpRangeReader` is written to reject that rather than
 * trust it. This test is also what proves the range path works at all.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DATA = process.env["MASAX_DATA"];
const DIST = new URL("../dist/", import.meta.url).pathname;

const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
};

function serve(roots: { prefix: string; dir: string }[]): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? "/").split("?")[0]!);
    const root = roots.find((r) => path.startsWith(r.prefix));
    if (!root) return void res.writeHead(404).end();
    let rest = normalize(path.slice(root.prefix.length));
    if (rest === "/" || rest === "" || rest === ".") rest = "index.html";
    const file = join(root.dir, rest);
    if (!file.startsWith(root.dir) || !existsSync(file) || !statSync(file).isFile()) {
      return void res.writeHead(404).end();
    }
    const size = statSync(file).size;
    const type = TYPES[extname(file)] ?? "application/octet-stream";
    const range = req.headers.range;

    if (req.method === "HEAD") {
      return void res
        .writeHead(200, { "content-length": size, "accept-ranges": "bytes", "content-type": type })
        .end();
    }
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (!match) return void res.writeHead(416).end();
      const from = Number(match[1]);
      const to = match[2] ? Number(match[2]) : size - 1;
      res.writeHead(206, {
        "content-range": `bytes ${from}-${to}/${size}`,
        "content-length": to - from + 1,
        "content-type": type,
      });
      return void createReadStream(file, { start: from, end: to }).pipe(res);
    }
    res.writeHead(200, { "content-length": size, "content-type": type, "accept-ranges": "bytes" });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

describe.skipIf(!DATA || !existsSync(DIST))("the browser client", () => {
  let server: Server;
  let base: string;
  let browser: import("playwright-core").Browser;
  let page: import("playwright-core").Page;

  beforeAll(async () => {
    ({ server, url: base } = await serve([
      { prefix: "/data/", dir: DATA! },
      { prefix: "/", dir: DIST },
    ]));
    const { chromium } = await import("playwright-core");
    browser = await chromium.launch({ channel: "chrome" });
    page = await browser.newPage();
    const problems: string[] = [];
    page.on("pageerror", (error) => problems.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 400) {
        const url = new URL(response.url());
        // The page declares no favicon, so the browser asks for one anyway.
        if (url.pathname === "/favicon.ico") return;
        problems.push(`${response.status()} ${url.pathname}`);
      }
    });
    await page.goto(base);
    // The picked-directory path is the primary one and needs a real user
    // gesture against a real folder, so the browser test drives the HTTP
    // fallback. It lives behind a disclosure, which has to be opened first.
    await page.getByText("or a tree hosted over HTTP").click();
    await page.getByPlaceholder(/example\.org/).fill(`${base}/data/M60/`);
    await page.getByRole("button", { name: "Open", exact: true }).click();
    try {
      await page.locator("select[size]").waitFor({ timeout: 90_000 });
    } catch (cause) {
      // Surface what the page actually said rather than just the timeout.
      const shown = await page.locator("body").innerText();
      throw new Error(
        `${(cause as Error).message}\n--- page ---\n${shown}\n--- console ---\n${problems.join("\n")}`,
      );
    }
    expect(problems, "console and page errors").toEqual([]);
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    server?.close();
  });

  it("lists the catalogues from CInfo", async () => {
    const options = page.locator("select[size] option");
    await expect.poll(() => options.count(), { timeout: 30_000 }).toBeGreaterThan(10);
    expect(await options.first().textContent()).toBeTruthy();
  });

  it("walks catalogue, model, group and plate to a drawing and its parts", async () => {
    await page.selectOption("select[size]", "B6037609A");
    await page.getByRole("button", { name: "L042G", exact: true }).click();
    await page.getByRole("button", { name: /^13\s/ }).click();
    // 13-010 is FUEL TANK; its drawing is 113_0103KC1A0T.
    await page.getByRole("button", { name: /010\s+FUEL TANK/ }).click();

    // The caption gains the size only once the drawing has decoded, so poll
    // for the whole string rather than for the name and then reading again.
    const caption = page.locator("figcaption");
    await expect
      .poll(() => caption.textContent(), { timeout: 30_000 })
      .toMatch(/113_0103KC1A0T — 960×1210/);

    const rows = page.locator("tbody tr");
    await expect.poll(() => rows.count(), { timeout: 30_000 }).toBeGreaterThan(30);
    const text = await page.locator("tbody").textContent();
    expect(text).toContain("FUEL TANK ASSY");
    expect(text).toContain("MB247182");
  });

  it("paints the drawing rather than leaving the canvas blank", async () => {
    // A canvas that decoded nothing is uniformly white, which would pass any
    // check that only looked at its size.
    const ink = await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      if (!canvas) return -1;
      const context = canvas.getContext("2d");
      if (!context) return -1;
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let dark = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i]! < 128) dark++;
      return dark;
    });
    expect(ink).toBeGreaterThan(10_000);
    expect(ink).toBeLessThan(960 * 1210 * 0.5);
  });

  it("decodes a VIN that carries its own specification", async () => {
    // One of the 3.1% of records that hold the model directly.
    await page.getByPlaceholder(/VIN/).fill("JMAGZP02VHA000001");
    await page.getByRole("button", { name: "Decode" }).click();
    const vehicle = page.locator("dl.vehicle");
    await expect.poll(() => vehicle.count(), { timeout: 30_000 }).toBeGreaterThan(0);
    const text = await vehicle.first().textContent();
    expect(text).toContain("P02V");
    expect(text).toContain("1986-11");
  });

  it("follows the XREF for a VIN whose record has no specification", async () => {
    // The other 96.9%. Before the XREF was followed this decoded to a build
    // date and nothing else, which reads as "not in the data".
    await page.getByPlaceholder(/VIN/).fill("JMB0RV250RJ000188");
    await page.getByRole("button", { name: "Decode" }).click();
    const vehicle = page.locator("dl.vehicle").first();
    await expect
      .poll(() => vehicle.textContent(), { timeout: 30_000 })
      .toContain("V25W");
    const text = await vehicle.textContent();
    expect(text).toContain("GRXML6");
    expect(text).toContain("1994-03");
    // and the interface says where the specification came from
    expect(await page.locator(".via").first().textContent()).toContain("J000153");
  });
});
