/**
 * The data is single-byte, and not UTF-8. Latin-1 round-trips every byte to a
 * code point, which is what the format needs: part numbers and codes are ASCII,
 * and the Japanese `Desc` files are Shift-JIS that we must not mangle before
 * the caller has a chance to decode them properly.
 */

/** Decode bytes as Latin-1. Every byte maps to exactly one code point. */
export function latin1(bytes: Uint8Array): string {
  let out = "";
  // Chunked so a large index does not blow the argument limit.
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return out;
}

/** Encode a string back to Latin-1 bytes, for building index keys. */
export function toLatin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/** Trailing spaces are padding in every fixed-width field the format has. */
export function trimEnd(text: string): string {
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) === 0x20) end--;
  return text.slice(0, end);
}
