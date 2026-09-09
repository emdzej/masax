/*
 * The app icons, drawn rather than dragged out of a design tool.
 *
 * Run from the web app: `node tools/icons.mjs public`. Committed output, since
 * a build must not need a browser — this only runs when the mark changes.
 *
 * The mark is the one masax already uses: the Mitsubishi-red diamond and the
 * wordmark with its accented x. Rendered with the same fonts and the same red
 * so the installed icon and the interface are recognisably the same product.
 *
 * Two shapes, because a launcher needs both. `any` is the icon as drawn, with
 * its own margin; `maskable` fills the whole square with the ground colour and
 * keeps the mark inside the 80% safe circle, because Android will crop it to
 * whatever shape the launcher uses.
 */
const RED = "#e60012";

const page = (size, { maskable }) => {
  /*
   * The diamond with the accented x inside it.
   *
   * The full wordmark was the obvious first try and it does not work: at 48px
   * in a launcher `masax` is a grey smear. An icon gets one glyph, so this
   * takes the two things that identify the mark — the Mitsubishi-red diamond
   * and the x that carries the accent in the wordmark — and puts the second
   * inside the first.
   *
   * A maskable icon must survive a circular crop, so the diamond is drawn
   * smaller on a full-bleed ground: its points are the first thing a launcher
   * would clip.
   */
  const bleed = maskable ? 0.58 : 0.74;
  const d = size * bleed;
  return `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;width:${size}px;height:${size}px}
    body{
      display:grid;place-items:center;background:#ffffff;
      ${maskable ? "" : `border-radius:${size * 0.16}px;`}
    }
    .diamond{
      width:${d}px;height:${d}px;
      background:${RED};transform:rotate(45deg);
      border-radius:${size * 0.03}px;
      display:grid;place-items:center;
    }
    .x{
      transform:rotate(-45deg);
      font:700 ${d * 0.5}px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
      color:#ffffff;
    }
  </style>
  <div class="diamond"><span class="x">x</span></div>`;
};

const { chromium } = await import("playwright-core");
const browser = await chromium.launch({ channel: "chrome" });
const out = process.argv[2];
for (const [name, size, maskable] of [
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["icon-maskable-512.png", 512, true],
  ["apple-touch-icon.png", 180, true],
]) {
  const p = await browser.newPage({ viewport: { width: size, height: size } });
  await p.setContent(page(size, { maskable }));
  await p.screenshot({ path: `${out}/${name}`, omitBackground: false });
  await p.close();
  console.log("wrote", name, `${size}x${size}`, maskable ? "(maskable)" : "");
}
await browser.close();
