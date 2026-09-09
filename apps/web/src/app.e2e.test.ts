/**
 * The whole chain in a real browser: HTTP `Range` -> engine -> catalogue ->
 * Group 4 decode -> canvas and parts table.
 *
 * Gated on `MASAX_DATA`, because no data lives in this repository. Without it
 * the suite skips. It may name a module directory or a directory holding one:
 * `/Volumes/data/masax` and `/Volumes/data/masax/M60` both work.
 *
 * The static server here answers `Range` properly on purpose: a host that
 * ignores it and returns 200 with the whole body would make every read return
 * the wrong bytes, and `HttpRangeReader` is written to reject that rather than
 * trust it. This test is also what proves the range path works at all.
 */
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DATA = process.env["MASAX_DATA"];
const DIST = new URL("../dist/", import.meta.url).pathname;

/** A module root is the directory with an `EPC` in it. Spelling varies by disc. */
const isModuleRoot = (dir: string): boolean => {
  try {
    return readdirSync(dir).some((entry) => entry.toLowerCase() === "epc");
  } catch {
    return false;
  }
};

/**
 * The URL path the client should be pointed at, under the served `/data/`.
 *
 * `MASAX_DATA` may name the module directory itself or a directory holding one,
 * because both are reasonable readings and only one of them used to work.
 * Pointing at the module root produced a 404 on the manifest and an error about
 * the tree not being a data tree — which blames the data rather than the
 * variable, and cost real time.
 */
function modulePath(root: string): string {
  if (isModuleRoot(root)) return "/data/";
  const modules = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isModuleRoot(join(root, entry.name)))
    .map((entry) => entry.name);
  if (modules.length !== 1) {
    throw new Error(
      `MASAX_DATA=${root} holds ${modules.length} module directories, expected one` +
        `${modules.length ? `: ${modules.join(", ")}` : ""}`,
    );
  }
  return `/data/${modules[0]}/`;
}

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
  let context: import("playwright-core").BrowserContext;
  let page: import("playwright-core").Page;

  beforeAll(async () => {
    ({ server, url: base } = await serve([
      { prefix: "/data/", dir: DATA! },
      { prefix: "/", dir: DIST },
    ]));
    const { chromium } = await import("playwright-core");
    browser = await chromium.launch({ channel: "chrome" });
    context = await browser.newContext();
    page = await context.newPage();
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
    await page.getByPlaceholder(/example\.org/).fill(`${base}${modulePath(DATA!)}`);
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

    // Scoped to the panel: the vehicle report renders its own tables, hidden
    // but present in the DOM, and a bare `tbody` selector counts those too.
    const rows = page.locator("section.panel tbody tr");
    await expect.poll(() => rows.count(), { timeout: 30_000 }).toBeGreaterThan(30);
    const text = await page.locator("section.panel tbody").textContent();
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

  it("links a callout on the plate to its row, and back", async () => {
    // The coordinates come from a private TIFF tag; see @masax/illust. A
    // drawing can serve many plates, so callouts that are not on this list are
    // drawn but inert.
    const spots = page.locator("button.spot");
    await expect.poll(() => spots.count(), { timeout: 30_000 }).toBeGreaterThan(10);
    const live = page.locator("button.spot.live");
    expect(await live.count()).toBeGreaterThan(0);
    expect(await live.count()).toBeLessThanOrEqual(await spots.count());

    await live.first().click();
    const linked = page.locator("tbody tr.linked");
    await expect.poll(() => linked.count(), { timeout: 10_000 }).toBeGreaterThan(0);
    // The callout the user clicked is marked; a code used in several places
    // marks all of them, which is the point.
    expect(await page.locator("button.spot.on").count()).toBeGreaterThan(0);

    const code = (await linked.first().getAttribute("data-pnc")) ?? "";
    expect(code).not.toBe("");
    expect(await live.first().getAttribute("aria-label")).toContain(code);

    // Clicking the row again unlinks it.
    await linked.first().click();
    await expect.poll(() => page.locator("tbody tr.linked").count()).toBe(0);
  });

  it("gives each plate that shares a subgroup number its own parts list", async () => {
    // 13-010 on a V25W is three plates over one run of 70 rows: a filler pipe
    // and two tank-and-tube variants. Nothing in BGroup separates them, so the
    // drawing does — its callouts are its share of the list.
    await page.selectOption("select#catalogue", "B60356A4A");
    await page.selectOption("select#model", "V25W");
    await page.getByRole("button", { name: /^13\s/ }).click();

    const plates = page.locator("section.rail").last().locator("button.row");
    // Matched on the code cell, not the row text: the row opens with an empty
    // marker span, so anchoring a regex to the start of the row never matches.
    const tanks = plates.filter({ has: page.locator("span.num", { hasText: /^010$/ }) });
    expect(await tanks.count()).toBe(3);

    const lists: string[][] = [];
    for (let i = 0; i < 3; i++) {
      await tanks.nth(i).click();
      const rows = page.locator("section.panel tbody tr");
      await expect.poll(() => rows.count(), { timeout: 30_000 }).toBeGreaterThan(0);
      lists.push(
        await page
          .locator("tbody tr")
          .evaluateAll((all) => all.map((row) => row.getAttribute("data-pnc") ?? "")),
      );
    }

    // Each is a strict subset of the run, and together they are the whole run.
    // The three drawings carry 11, 33 and 29 callouts; two of those are `13 020`
    // REF. pointers into another subgroup rather than parts, hence 32 and 28.
    const codes = lists.map((list) => new Set(list.filter(Boolean)));
    expect(codes.map((c) => c.size)).toEqual([11, 32, 28]);
    expect(new Set(codes.flatMap((c) => [...c])).size).toBe(47);

    // The filler-pipe plate is the small one, and it is filler-pipe parts.
    await tanks.first().click();
    await expect.poll(() => page.locator("section.panel tbody tr").count()).toBe(19);
    expect(await page.locator("section.panel tbody").textContent()).toContain("PIPE,FUEL FILLER");
    expect(await page.locator("section.panel tbody").textContent()).not.toContain("FUEL PUMP ASSY");
  });

  it("pans the drawing at actual size, without the drag selecting a callout", async () => {
    const zoom = page.getByRole("button", { name: "Show at actual size" });
    await zoom.click();
    const frame = page.locator(".frame.actual");
    await expect.poll(() => frame.count()).toBe(1);

    // Zooming in centres the plate, so there is room to drag in both directions.
    const start = await frame.evaluate((el) => ({ x: el.scrollLeft, y: el.scrollTop }));
    expect(start.x + start.y).toBeGreaterThan(0);

    const box = (await frame.boundingBox())!;
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    // In steps, because a single jump does not produce intermediate moves.
    for (let i = 1; i <= 5; i++) await page.mouse.move(from.x - i * 12, from.y - i * 8);
    await page.mouse.up();

    const after = await frame.evaluate((el) => ({ x: el.scrollLeft, y: el.scrollTop }));
    expect(after.x).toBeGreaterThan(start.x);
    expect(after.y).toBeGreaterThan(start.y);
    // A drag that crossed a callout must not have selected one.
    expect(await page.locator("tbody tr.linked").count()).toBe(0);

    // The control stays in the corner rather than scrolling away with the plate.
    const button = (await page.getByRole("button", { name: "Fit to the column" }).boundingBox())!;
    const sheet = (await page.locator("figure.sheet").boundingBox())!;
    expect(button.y - sheet.y).toBeLessThan(24);
    expect(sheet.x + sheet.width - (button.x + button.width)).toBeLessThan(24);

    await page.getByRole("button", { name: "Fit to the column" }).click();
    await expect.poll(() => page.locator(".frame.actual").count()).toBe(0);
  });

  it("cycles the theme, remembers it, and repaints the plate", async () => {
    const button = page.locator(".tools button.icon").first();
    const attribute = () =>
      page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    // The paper of the plate, read off the canvas rather than the CSS: the
    // drawing is painted, so a theme that only changed the chrome would leave
    // the largest thing on screen unchanged.
    const paper = () =>
      page.evaluate(() => {
        const context = document.querySelector("canvas")!.getContext("2d")!;
        const [r, g, b] = context.getImageData(2, 2, 1, 1).data;
        return [r, g, b] as [number, number, number];
      });

    // Auto writes no attribute — its absence *is* the auto state.
    expect(await attribute()).toBeNull();
    const light = await paper();
    expect(Math.min(...light)).toBeGreaterThan(200);

    await button.click();
    expect(await attribute()).toBe("light");

    await button.click();
    expect(await attribute()).toBe("dark");
    await expect.poll(async () => Math.max(...(await paper()))).toBeLessThan(60);

    await button.click();
    expect(await attribute()).toBeNull();
    await expect.poll(async () => Math.min(...(await paper()))).toBeGreaterThan(200);

    // Remembered, so the next visit opens in the same theme.
    await button.click();
    expect(await page.evaluate(() => localStorage.getItem("masax.theme.v1"))).toBe("light");
    await button.click();
    await button.click();
    expect(await attribute()).toBeNull();
  });

  it("keeps the settings cog against the right edge of the toolbar", async () => {
    const bar = (await page.locator("header.bar").boundingBox())!;
    const cog = (await page.locator(".tools button.icon").last().boundingBox())!;
    expect(bar.x + bar.width - (cog.x + cog.width)).toBeLessThan(20);
    // and the theme control sits to its left, not the other way round
    const swatch = (await page.locator(".tools button.icon").first().boundingBox())!;
    expect(swatch.x).toBeLessThan(cog.x);
  });

  it("narrows the parts list to the decoded vehicle, and can be switched off", async () => {
    // The vehicle from the VIN tests below is a V25W built 1994-03. On the
    // filler-pipe plate that leaves one row per callout: the later part numbers
    // for 05014, 05078, 05079, 05114, 05178 and 05292 are all later periods.
    await page.selectOption("select#catalogue", "B60356A4A");
    await page.selectOption("select#model", "V25W");
    await page.locator("input#vin").fill("JMB0RV250RJ000188");
    await page.getByRole("button", { name: "Decode" }).click();
    await expect
      .poll(() => page.locator("select#model").inputValue(), { timeout: 30_000 })
      .toBe("V25W");
    await page.getByRole("button", { name: /^13\s/ }).click();
    // By name, not by position: decoding the VIN reopens the catalogue and
    // model, which rebuilds this list, and an index taken before that resolves
    // lands on whichever plate the previous test had selected.
    await page
      .locator("section.rail")
      .last()
      .locator("button.row")
      .filter({ hasText: "FUEL FILLER PIPE" })
      .click();
    await expect
      .poll(() => page.locator("figcaption.block").textContent(), { timeout: 30_000 })
      .toMatch(/113_0103KC1B5T/);

    const rows = page.locator("section.panel tbody tr");
    await expect.poll(() => rows.count(), { timeout: 30_000 }).toBe(11);
    // Every dropped row goes on the build date, and the footnote says so.
    const footnote = (await page.locator("section.panel footer").textContent()) ?? "";
    expect(footnote.replace(/\s+/g, " ")).toMatch(/8 rows hidden.*build date/);

    await page.locator("label.switch input").uncheck();
    await expect.poll(() => rows.count()).toBe(19);
    await page.locator("label.switch input").check();
    await expect.poll(() => rows.count()).toBe(11);
  });

  it("copies a part number and a part name from a row", async () => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const row = page.locator("section.panel tbody tr").first();
    const buttons = row.locator("button.copy");
    expect(await buttons.count()).toBe(2);

    // Hidden until the row is pointed at, and not clickable while hidden —
    // otherwise every part number on the plate carries an invisible control.
    expect(await buttons.first().evaluate((el) => getComputedStyle(el).opacity)).toBe("0");
    expect(await buttons.first().evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");
    await row.hover();
    await expect
      .poll(() => buttons.first().evaluate((el) => getComputedStyle(el).opacity))
      .toBe("1");

    await buttons.first().click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("MA152319");
    // Copying is not selecting: the row's own click must not have fired.
    expect(await page.locator("tbody tr.linked").count()).toBe(0);

    await buttons.nth(1).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe("GASKET,FUEL FILLER NECK");
  });

  it("copies the plate as an image", async () => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.locator("button.zoom.copy").click();
    // The tick only appears when the clipboard write resolved.
    await expect
      .poll(() => page.locator("button.zoom.copy.ok").count(), { timeout: 10_000 })
      .toBe(1);
  });

  it("prints a vehicle report, and hides the interface while doing it", async () => {
    const report = page.locator("section.report");
    expect(await report.count()).toBe(1);
    expect(await report.evaluate((el) => getComputedStyle(el).display)).toBe("none");

    // `window.print` would block on a dialog, so it is stubbed and the media
    // switched by hand. What matters is the stylesheet, not the dialog.
    await page.addInitScript(() => {
      window.print = () => {};
    });
    await page.getByRole("button", { name: "Report" }).click();

    await page.emulateMedia({ media: "print" });
    try {
      expect(await report.evaluate((el) => getComputedStyle(el).display)).toBe("block");
      expect(await page.locator("header.bar").evaluate((el) => getComputedStyle(el).display)).toBe(
        "none",
      );
      const text = await report.innerText();
      // Everything the VIN gave, including fields the strip has no room for.
      for (const wanted of [
        "JMB0RV250RJ000188",
        "V25W",
        "GRXML6",
        "1994-03 (early)",
        "H70",
        "D9H",
        "44D",
        "serial J000153",
        "PAJERO/MONTERO(EUR)",
        "VARIABLE SHOCK ABSORBER",
        "SWISS SPEC",
      ]) {
        expect(text, `report should carry ${wanted}`).toContain(wanted);
      }
    } finally {
      await page.emulateMedia({ media: "screen" });
    }
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
