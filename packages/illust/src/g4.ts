/**
 * CCITT Group 4 (ITU-T T.6) decoder.
 *
 * Every ASA drawing is 1-bit bilevel, Group 4, so this is the only codec the
 * catalogue needs. T.6 is two-dimensional only: each row is coded against the
 * row above it as a sequence of *changing elements* — the positions where the
 * colour flips — and the first row is coded against an imaginary all-white
 * row. There is no 1D fallback and no EOL between rows.
 */
import {
  BLACK_CODES,
  MAX_CODE_BITS,
  MAX_MODE_BITS,
  MODE_CODES,
  Mode,
  WHITE_CODES,
  type CodeTable,
} from "./g4-tables.js";

/** A decoded bilevel image, one bit per pixel, MSB first, rows byte-aligned. */
export interface Bitmap {
  width: number;
  height: number;
  /** `ceil(width / 8)` bytes per row. */
  stride: number;
  /** A set bit is black, matching Photometric=0 (WhiteIsZero). */
  bits: Uint8Array;
}

class BitReader {
  private bit = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get exhausted(): boolean {
    return this.bit >= this.bytes.length * 8;
  }

  /** Bits consumed so far. */
  get position(): number {
    return this.bit;
  }

  /** Peek `count` bits without consuming. Bits past the end read as zero. */
  peek(count: number): number {
    let value = 0;
    for (let i = 0; i < count; i++) {
      const at = this.bit + i;
      const byte = this.bytes[at >> 3] ?? 0;
      value = (value << 1) | ((byte >> (7 - (at & 7))) & 1);
    }
    return value;
  }

  skip(count: number): void {
    this.bit += count;
  }
}

/** Read one run length: zero or more makeup codes, then one terminating code. */
function readRun(reader: BitReader, table: CodeTable, what: string): number {
  let total = 0;
  for (;;) {
    let run: number | undefined;
    let length = 0;
    for (let bits = 1; bits <= MAX_CODE_BITS; bits++) {
      const found = table.get((bits << 16) | reader.peek(bits));
      if (found !== undefined) {
        run = found;
        length = bits;
        break;
      }
    }
    if (run === undefined) {
      throw new Error(`G4: no ${what} run code at bit ${reader.position}`);
    }
    reader.skip(length);
    total += run;
    // Makeup codes are multiples of 64 and at least 64; a run ends on the
    // first terminating code, which is 0..63.
    if (run < 64) return total;
  }
}

export interface DecodeOptions {
  width: number;
  height: number;
  /** Reject rather than pad when the data runs out early. Default true. */
  strict?: boolean;
}

export interface DecodeResult extends Bitmap {
  /** Rows actually decoded. Equals `height` for well-formed data. */
  rows: number;
  /** Bits consumed, so a caller can check the strip was fully used. */
  bitsRead: number;
}

export function decodeGroup4(data: Uint8Array, options: DecodeOptions): DecodeResult {
  const { width, height } = options;
  const strict = options.strict ?? true;
  if (width <= 0 || height <= 0) throw new Error(`G4: bad size ${width}x${height}`);

  const stride = (width + 7) >> 3;
  const bits = new Uint8Array(stride * height);
  const reader = new BitReader(data);

  // Changing elements of the reference line. The imaginary row above the first
  // is all white, so its only transitions are at the right edge.
  let reference: number[] = [width, width];
  let row = 0;

  for (; row < height; row++) {
    const coding: number[] = [];
    let a0 = -1;
    let color = 0;
    let ended = false;

    while (a0 < width) {
      // b1 is the first changing element on the reference line strictly right
      // of a0 whose colour is opposite to the current colour. Transitions at
      // an even index are white-to-black, so the parity we want equals `color`.
      let i = 0;
      while (i < reference.length && reference[i]! <= a0) i++;
      if ((i & 1) !== color) i++;
      const b1 = i < reference.length ? reference[i]! : width;
      const b2 = i + 1 < reference.length ? reference[i + 1]! : width;

      let mode: (typeof Mode)[keyof typeof Mode] | undefined;
      let delta = 0;
      let modeBits = 0;
      for (let n = 1; n <= MAX_MODE_BITS; n++) {
        const found = MODE_CODES.get((n << 16) | reader.peek(n));
        if (found) {
          mode = found.mode;
          delta = found.delta;
          modeBits = n;
          break;
        }
      }
      if (mode === undefined) {
        // No mode code matches: either EOFB (T.6 §2.2.2, twelve zeros then a
        // one, twice) or trailing pad bits. Both mean the image is over.
        ended = true;
        break;
      }
      reader.skip(modeBits);

      if (mode === Mode.Pass) {
        a0 = b2;
      } else if (mode === Mode.Horizontal) {
        const start = a0 < 0 ? 0 : a0;
        const first = readRun(reader, color === 0 ? WHITE_CODES : BLACK_CODES, "horizontal");
        const second = readRun(reader, color === 0 ? BLACK_CODES : WHITE_CODES, "horizontal");
        const a1 = Math.min(start + first, width);
        const a2 = Math.min(a1 + second, width);
        coding.push(a1, a2);
        a0 = a2;
      } else if (mode === Mode.Vertical) {
        const a1 = Math.min(Math.max(b1 + delta, 0), width);
        coding.push(a1);
        a0 = a1;
        color ^= 1;
      } else {
        // Extension mode marks uncompressed data, which T.6 permits but no ASA
        // drawing uses. Refusing is better than emitting a plausible mess.
        throw new Error(`G4: extension mode at bit ${reader.position} is not supported`);
      }
    }

    if (ended && coding.length === 0) break;
    paintRow(bits, row * stride, width, coding);
    reference = coding.length > 0 ? [...coding, width, width] : [width, width];
    if (ended) {
      row++;
      break;
    }
  }

  if (strict && row < height) {
    throw new Error(`G4: data ended after ${row} of ${height} rows`);
  }

  return { width, height, stride, bits, rows: row, bitsRead: reader.position };
}

/**
 * Turn changing elements into pixels.
 *
 * A row starts white; the first element is where black begins, the second
 * where white resumes, and so on. An odd number of elements means the row ends
 * black.
 */
function paintRow(bits: Uint8Array, at: number, width: number, coding: number[]): void {
  let x = 0;
  let color = 0;
  for (const element of coding) {
    const next = Math.min(element, width);
    if (color === 1) setRun(bits, at, x, next);
    if (next > x) x = next;
    color ^= 1;
    if (x >= width) return;
  }
  if (color === 1) setRun(bits, at, x, width);
}

function setRun(bits: Uint8Array, at: number, from: number, to: number): void {
  for (let x = from; x < to; x++) {
    bits[at + (x >> 3)]! |= 0x80 >> (x & 7);
  }
}
