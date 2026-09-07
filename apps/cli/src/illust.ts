/**
 * `masax illust` — check or convert the parts drawings.
 *
 * The drawings are the one part of the data that needs decoding rather than
 * just reading, so this doubles as the codec's regression test over real
 * input: `--check` decodes every file and reports anything that fails.
 */
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { join, relative, dirname } from "node:path";
import { deflateSync } from "node:zlib";
import chalk from "chalk";
import { decodeIllustration, deobfuscate, describe, encodePng, readIfd } from "@masax/illust";

async function* walk(root: string): AsyncGenerator<string> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.name.toLowerCase().endsWith(".tif")) yield path;
  }
}

const deflate = (data: Uint8Array) => new Uint8Array(deflateSync(data, { level: 9 }));

export async function checkIllustrations(root: string, full: boolean): Promise<number> {
  let ok = 0;
  let failed = 0;
  const dimensions = new Map<string, number>();
  const failures: string[] = [];
  let sourceBytes = 0;
  let pngBytes = 0;
  let maxSlack = 0;

  for await (const path of walk(root)) {
    const stored = new Uint8Array(await readFile(path));
    sourceBytes += stored.length;
    try {
      if (full) {
        const image = decodeIllustration(stored);
        // `decodeGroup4` already refuses to return fewer rows than the header
        // declares, which is the check that matters. The leftover bits are the
        // EOFB plus fill, and how much fill an encoder emits is its business —
        // so this only catches a decoder that gave up a long way early.
        const slack = image.stripBytes * 8 - image.bitsRead;
        maxSlack = Math.max(maxSlack, slack);
        if (slack < 0 || slack > 4096) {
          throw new Error(`strip has ${slack} bits left over after ${image.rows} rows`);
        }
        pngBytes += encodePng(image, deflate).length;
        dimensions.set(
          `${image.width}x${image.height}`,
          (dimensions.get(`${image.width}x${image.height}`) ?? 0) + 1,
        );
      } else {
        const tags = readIfd(deobfuscate(stored));
        const key = `${tags.tags.get(0x0100)}x${tags.tags.get(0x0101)}`;
        dimensions.set(key, (dimensions.get(key) ?? 0) + 1);
      }
      ok++;
    } catch (error) {
      failed++;
      if (failures.length < 10)
        failures.push(`${relative(root, path)}: ${(error as Error).message}`);
    }
  }

  console.log(`${ok} ${full ? "decoded" : "parsed"}, ${failed} failed`);
  const sorted = [...dimensions].sort((a, b) => b[1] - a[1]).slice(0, 6);
  console.log(`  dimensions: ${sorted.map(([d, n]) => `${d} x${n}`).join(", ")}`);
  if (full) {
    console.log(`  most bits left unread after the last row: ${maxSlack} (EOFB and fill)`);
  }
  if (full && pngBytes > 0) {
    console.log(
      `  ${(sourceBytes / 1e6).toFixed(1)} MB stored -> ${(pngBytes / 1e6).toFixed(1)} MB as PNG`,
    );
  }
  for (const failure of failures) console.log(chalk.red(`  ${failure}`));
  return failed === 0 ? 0 : 1;
}

export async function convertIllustrations(
  input: string,
  output: string,
  asPng: boolean,
): Promise<number> {
  let count = 0;
  for await (const path of walk(input)) {
    const stored = new Uint8Array(await readFile(path));
    const rel = relative(input, path);
    const dest = join(output, asPng ? rel.replace(/\.tif$/i, ".png") : rel);
    await mkdir(dirname(dest), { recursive: true });
    const bytes = asPng ? encodePng(decodeIllustration(stored), deflate) : deobfuscate(stored);
    await writeFile(dest, bytes);
    count++;
  }
  console.log(`converted ${count} drawings into ${output}`);
  return 0;
}

export async function showIllustration(path: string): Promise<number> {
  const stored = new Uint8Array(await readFile(path));
  const tiff = deobfuscate(stored);
  const { tags } = readIfd(tiff);
  console.log(chalk.bold(path));
  console.log(`  ${describe(tags)}`);
  const image = decodeIllustration(stored);
  console.log(
    `  strip ${image.stripBytes} bytes, decoder read ${(image.bitsRead / 8).toFixed(1)}, ` +
      `${image.rows} rows`,
  );
  let black = 0;
  for (const byte of image.bits) black += (byte.toString(2).match(/1/g) ?? []).length;
  console.log(`  ${black} black pixels of ${image.width * image.height}`);
  return 0;
}
