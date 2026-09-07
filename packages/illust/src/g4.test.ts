import { describe, expect, it } from "vitest";
import { decodeGroup4, type Bitmap } from "./g4.js";
import { deobfuscate, readIfd } from "./tiff.js";

/**
 * A 64x16 Group 4 stream, encoded once when this test was written and pasted
 * in. No fixture here may be derived from the discs, and a synthetic image can
 * exercise cases the drawings never reach — the real data is covered by
 * `masax illust --check`.
 *
 * It has a two-pixel diagonal (vertical modes), a 40-pixel black run at row 3
 * (horizontal mode with a makeup code) and an all-black final row (a run the
 * full width of the image).
 */
const STRIP = new Uint8Array([
  46, 12, 193, 20, 251, 123, 100, 202, 118, 199, 111, 111, 111, 111, 111, 111, 111, 111, 111, 110,
  37, 76, 55, 0, 16, 1,
]);

/**
 * The run colours the decoder returns, where a set bit is a black run.
 *
 * These are the visual inverse of the image that was drawn, because the
 * encoder tagged it `Photometric = 1` (BlackIsZero) while `decodeGroup4`
 * returns the Group 4 run colours themselves — the first run of every row is
 * white by definition of the coding. Every ASA drawing declares
 * `Photometric = 0` (WhiteIsZero), which is the same convention, so no
 * inversion is needed for real data and `decodeIllustration` refuses anything
 * else rather than rendering it upside down in tone.
 */
const EXPECTED_RUNS = [
  "0011111111111111111111111111111111111111111111111111111111111111",
  "1001111111111111111111111111111111111111111111111111111111111111",
  "1100111111111111111111111111111111111111111111111111111111111111",
  "1110011111000000000000000000000000000000000000000011111111111111",
  "1111001111111111111111111111111111111111111111111111111111111111",
  "1111100111111111111111111111111111111111111111111111111111111111",
  "1111110011111111111111111111111111111111111111111111111111111111",
  "1111111001111111111111111111111111111111111111111111111111111111",
  "1111111100111111111111111111111111111111111111111111111111111111",
  "1111111110011111111111111111111111111111111111111111111111111111",
  "1111111111001111111111111111111111111111111111111111111111111111",
  "1111111111100111111111111111111111111111111111111111111111111111",
  "1111111111110011111111111111111111111111111111111111111111111111",
  "1111111111111001111111111111111111111111111111111111111111111111",
  "1111111111111100111111111111111111111111111111111111111111111111",
  "0000000000000000000000000000000000000000000000000000000000000000",
];

function rowsOf(bitmap: Bitmap): string[] {
  const out: string[] = [];
  for (let y = 0; y < bitmap.height; y++) {
    let row = "";
    for (let x = 0; x < bitmap.width; x++) {
      row += (bitmap.bits[y * bitmap.stride + (x >> 3)]! >> (7 - (x & 7))) & 1 ? "1" : "0";
    }
    out.push(row);
  }
  return out;
}

describe("decodeGroup4", () => {
  it("decodes every row of a known image", () => {
    const image = decodeGroup4(STRIP, { width: 64, height: 16 });
    expect(image.rows).toBe(16);
    expect(rowsOf(image)).toEqual(EXPECTED_RUNS);
  });

  it("puts the diagonal one pixel further right on each row", () => {
    // The structural check, independent of tone: the source image has a
    // two-pixel diagonal, so the first run should grow by exactly one per row.
    // Row 15 is a single full-width run, so it has no diagonal to find.
    const rows = rowsOf(decodeGroup4(STRIP, { width: 64, height: 16 }));
    for (let y = 0; y < 15; y++) {
      expect(rows[y]!.indexOf("0"), `row ${y}`).toBe(y);
    }
  });

  it("consumes the strip apart from the end-of-block and fill", () => {
    const image = decodeGroup4(STRIP, { width: 64, height: 16 });
    const slack = STRIP.length * 8 - image.bitsRead;
    // The 24-bit EOFB is not consumed, plus fill to a byte boundary.
    expect(slack).toBeGreaterThanOrEqual(24);
    expect(slack).toBeLessThan(64);
  });

  it("refuses truncated data rather than padding it out", () => {
    // A decoder that quietly returns short would produce a plausible drawing
    // with its bottom missing, which is worse than an error.
    expect(() => decodeGroup4(STRIP.subarray(0, 6), { width: 64, height: 16 })).toThrow(
      /data ended after/,
    );
  });

  it("pads when asked not to be strict", () => {
    const image = decodeGroup4(STRIP.subarray(0, 6), { width: 64, height: 16, strict: false });
    expect(image.rows).toBeLessThan(16);
    expect(image.height).toBe(16);
  });

  it("rejects a nonsensical size", () => {
    expect(() => decodeGroup4(STRIP, { width: 0, height: 16 })).toThrow(/bad size/);
  });
});

describe("the obfuscation", () => {
  it("is its own inverse", () => {
    const original = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x08, 0xff, 0x7f]);
    expect([...deobfuscate(deobfuscate(original))]).toEqual([...original]);
  });

  it("uses a different key for byte 0", () => {
    // XOR 0x0b alone gives 73 49 2a 00 — "sI*\0", one byte off the TIFF magic.
    // That near-miss is what makes the file look like a container format.
    const stored = new Uint8Array([0x78, 0x42, 0x21, 0x0b]);
    expect([...deobfuscate(stored)]).toEqual([0x49, 0x49, 0x2a, 0x00]);
    const wrong = stored.map((b) => b ^ 0x0b);
    expect(wrong[0]).not.toBe(0x49);
  });

  it("reads the header of a de-obfuscated image", () => {
    // A minimal little-endian TIFF: header, then one IFD with width and height.
    const tiff = new Uint8Array(8 + 2 + 24 + 4);
    tiff.set([0x49, 0x49, 0x2a, 0x00], 0);
    const view = new DataView(tiff.buffer);
    view.setUint32(4, 8, true);
    view.setUint16(8, 2, true);
    const entry = (i: number, tag: number, value: number) => {
      const at = 10 + 12 * i;
      view.setUint16(at, tag, true);
      view.setUint16(at + 2, 4, true);
      view.setUint32(at + 4, 1, true);
      view.setUint32(at + 8, value, true);
    };
    entry(0, 0x0100, 960);
    entry(1, 0x0101, 1210);
    const { tags } = readIfd(tiff);
    expect(tags.get(0x0100)).toBe(960);
    expect(tags.get(0x0101)).toBe(1210);
  });
});
