/**
 * Turning a decoded bitmap into something displayable.
 *
 * The web client draws to a canvas, so it wants RGBA. The CLI writes files, so
 * it wants PNG.
 *
 * Note that PNG is *larger* than the Group 4 original — 172 MB against 121 MB
 * over disc B's 10,694 drawings — because deflate on scanlines does not match
 * what a codec built for bilevel line art achieves. Converting is for
 * interoperability, not for size.
 */
import type { Bitmap } from "./g4.js";

/** RGBA pixels for `ImageData`. A set bit is drawn as `black`. */
export function bitmapToRgba(
  bitmap: Bitmap,
  colours: { black?: [number, number, number]; white?: [number, number, number] } = {},
): Uint8ClampedArray {
  const [br, bg, bb] = colours.black ?? [0, 0, 0];
  const [wr, wg, wb] = colours.white ?? [255, 255, 255];
  const { width, height, stride, bits } = bitmap;
  const out = new Uint8ClampedArray(width * height * 4);
  let at = 0;
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    for (let x = 0; x < width; x++) {
      const black = (bits[row + (x >> 3)]! >> (7 - (x & 7))) & 1;
      out[at++] = black ? br : wr;
      out[at++] = black ? bg : wg;
      out[at++] = black ? bb : wb;
      out[at++] = 255;
    }
  }
  return out;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

/** A deflate implementation. Node passes `zlib.deflateSync`. */
export type Deflate = (data: Uint8Array) => Uint8Array;

/**
 * Encode as a 1-bit greyscale PNG.
 *
 * PNG greyscale treats 0 as black and 1 as white, the opposite of our set-bit
 * convention, so the rows are inverted on the way out.
 */
export function encodePng(bitmap: Bitmap, deflate: Deflate): Uint8Array {
  const { width, height, stride, bits } = bitmap;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const to = y * (stride + 1);
    raw[to] = 0; // filter: none
    for (let x = 0; x < stride; x++) raw[to + 1 + x] = ~bits[y * stride + x]! & 0xff;
  }

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 1; // bit depth
  ihdr[9] = 0; // colour type: greyscale

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflate(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
