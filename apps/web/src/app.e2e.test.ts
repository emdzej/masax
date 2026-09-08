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
    // The picked-directory path is the primary one and needs a real gesture
    // against a real folder, so the browser test drives the HTTP fallback. On a
    // first run the settings panel is already open and asking.
    await page.getByPlaceholder(/example\.org/).fill(`${base}/data/M60/`);
    await page.getByRole("button", { name: "Open", exact: true }).click();
    try {
      await page.locator("select#catalogue").waitFor({ timeout: 90_000 });
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
    const options = page.locator("select#catalogue option");
    await expect.poll(() => options.count(), { timeout: 30_000 }).toBeGreaterThan(10);
    expect(await options.nth(1).textContent()).toBeTruthy();
  });

  it("walks catalogue, model, group and plate to a drawing and its parts", async () => {
    await page.selectOption("select#catalogue", "B6037609A");
    await page.selectOption("select#model", "L042G");
    await page.getByRole("button", { name: /^13\s/ }).click();
    // 13-010 is FUEL TANK; its drawing is 113_0103KC1A0T.
    await page.getByRole("button", { name: /010\s+FUEL TANK/ }).click();

    // The title block gains the pixel size only once the drawing has decoded,
    // so poll for the whole block rather than reading it twice.
    const block = page.locator("figcaption.block");
    await expect.poll(() => block.textContent(), { timeout: 30_000 }).toMatch(/113_0103KC1A0T/);
    await expect.poll(() => block.textContent()).toMatch(/960×1210/);
    expect(await block.textContent()).toContain("13-010");

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

  it("filters the group list by number and by name", async () => {
    const groups = page.locator("section.rail").first();
    const before = await groups.locator("button.row").count();
    expect(before).toBeGreaterThan(10);

    await groups.getByPlaceholder("Filter groups").fill("fuel");
    await expect.poll(() => groups.locator("button.row").count()).toBeLessThan(before);
    expect(await groups.locator("button.row").first().textContent()).toMatch(/FUEL/);

    // The code is searchable too, because it is often what the user knows.
    await groups.getByPlaceholder("Filter groups").fill("13");
    await expect.poll(() => groups.locator("button.row").count()).toBeGreaterThan(0);
    expect(await groups.locator("button.row").first().textContent()).toMatch(/13/);

    await groups.getByPlaceholder("Filter groups").fill("");
    await expect.poll(() => groups.locator("button.row").count()).toBe(before);
  });

  it("decodes a VIN that carries its own specification", async () => {
    // One of the 3.1% of records that hold the model directly.
    await page.locator("input#vin").fill("JMAGZP02VHA000001");
    await page.getByRole("button", { name: "Decode" }).click();
    const strip = page.locator(".strip");
    await expect.poll(() => strip.textContent(), { timeout: 30_000 }).toContain("P02V");
    expect(await strip.textContent()).toContain("1986-11");
  });

  it("opens the catalogue and model the VIN belongs to", async () => {
    // VInfo maps the decoded model and classification to a catalogue, and the
    // model code is the same vocabulary the catalogues use — so a VIN alone is
    // enough to get to a parts list.
    await page.locator("input#vin").fill("JMB0RV250RJ000188");
    await page.getByRole("button", { name: "Decode" }).click();
    await expect
      .poll(() => page.locator("select#catalogue").inputValue(), { timeout: 30_000 })
      .toBe("B60356A4A");
    expect(await page.locator("select#model").inputValue()).toBe("V25W");
    // and it says how it decided
    expect(await page.locator(".strip").textContent()).toContain("PAJERO/MONTERO");
  });

  it("follows the XREF for a VIN whose record has no specification", async () => {
    // The other 96.9%. Before the XREF was followed this decoded to a build
    // date and nothing else, which reads as "not in the data".
    await page.locator("input#vin").fill("JMB0RV250RJ000188");
    await page.getByRole("button", { name: "Decode" }).click();
    const strip = page.locator(".strip");
    await expect.poll(() => strip.textContent(), { timeout: 30_000 }).toContain("V25W");
    const text = await strip.textContent();
    expect(text).toContain("GRXML6");
    expect(text).toContain("1994-03");
    // and the interface says where the specification came from
    expect(text).toContain("J000153");
  });
});
