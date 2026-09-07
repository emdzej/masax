/**
 * `.pnt` — the index.
 *
 * Fixed-size entries, sorted by key: the key fields laid out at their declared
 * width, then a `uint32` offset into the `.bin`. A variable-text key is space
 * padded to its full width here even though `.bin` stores it length-prefixed,
 * so entry size is `sum(key widths) + 4` — 8 for a four-byte integer key, 11
 * for a seven-character PNC, 21 for a seventeen-character part number.
 */
import { FieldType, type Fdt } from "./fdt.js";
import { latin1, toLatin1, trimEnd } from "./text.js";

export type PntKey = string | number;

/** Byte size of the key portion of an entry. */
export function keySize(fdt: Fdt): number {
  const byCode = new Map(fdt.fields.map((f) => [f.code, f]));
  let total = 0;
  for (const code of fdt.keys) {
    const field = byCode.get(code);
    if (!field) throw new Error(`.fdt: key field ${code} is not in the field list`);
    total += field.width;
  }
  return total;
}

/**
 * Is the key a single integer?
 *
 * It matters for ordering: an integer key is stored little-endian, so
 * comparing the raw bytes is not the same as comparing the numbers, and a
 * binary search over the bytes would find the wrong entry as soon as the key
 * crosses a byte boundary.
 */
function isNumericKey(fdt: Fdt): boolean {
  if (fdt.keys.length !== 1) return false;
  const field = fdt.fields.find((f) => f.code === fdt.keys[0]);
  return field?.type === FieldType.Uint || field?.type === FieldType.Int;
}

export class PntIndex {
  readonly count: number;
  readonly keySize: number;
  readonly entrySize: number;
  readonly numeric: boolean;
  private readonly signed: boolean;
  private readonly view: DataView;

  constructor(
    private readonly bytes: Uint8Array,
    fdt: Fdt,
  ) {
    this.keySize = keySize(fdt);
    this.entrySize = this.keySize + 4;
    this.numeric = isNumericKey(fdt);
    this.signed = fdt.fields.find((f) => f.code === fdt.keys[0])?.type === FieldType.Int;
    this.count = Math.floor(bytes.length / this.entrySize);
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  /** Raw key bytes of entry `i`, without the offset. */
  keyBytesAt(i: number): Uint8Array {
    const at = i * this.entrySize;
    return this.bytes.subarray(at, at + this.keySize);
  }

  keyAt(i: number): PntKey {
    const raw = this.keyBytesAt(i);
    if (!this.numeric) return trimEnd(latin1(raw));
    let value = 0;
    for (let b = raw.length - 1; b >= 0; b--) value = value * 256 + raw[b]!;
    if (this.signed) {
      const limit = 2 ** (raw.length * 8 - 1);
      if (value >= limit) value -= limit * 2;
    }
    return value;
  }

  offsetAt(i: number): number {
    return this.view.getUint32(i * this.entrySize + this.keySize, true);
  }

  /** Turn a caller's key into the byte form the index stores. */
  encodeKey(key: PntKey): Uint8Array {
    if (this.numeric) {
      const out = new Uint8Array(this.keySize);
      let value = Math.trunc(key as number);
      if (value < 0) value += 2 ** (this.keySize * 8);
      for (let i = 0; i < this.keySize; i++) out[i] = (value >>> (8 * i)) & 0xff;
      return out;
    }
    const text = String(key);
    const out = new Uint8Array(this.keySize).fill(0x20);
    const src = toLatin1(text.slice(0, this.keySize));
    out.set(src, 0);
    return out;
  }

  private compareAt(i: number, key: PntKey, encoded: Uint8Array): number {
    if (this.numeric) {
      const here = this.keyAt(i) as number;
      const there = key as number;
      return here < there ? -1 : here > there ? 1 : 0;
    }
    const raw = this.keyBytesAt(i);
    for (let b = 0; b < this.keySize; b++) {
      const diff = raw[b]! - encoded[b]!;
      if (diff !== 0) return diff < 0 ? -1 : 1;
    }
    return 0;
  }

  /** First entry whose key is >= `key`, or `count` if there is none. */
  lowerBound(key: PntKey): number {
    const encoded = this.encodeKey(key);
    let lo = 0;
    let hi = this.count;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.compareAt(mid, key, encoded) < 0) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Index of `key`, or -1. */
  find(key: PntKey): number {
    const at = this.lowerBound(key);
    if (at >= this.count) return -1;
    return this.compareAt(at, key, this.encodeKey(key)) === 0 ? at : -1;
  }

  /** Every entry, in key order. */
  *entries(): Generator<[PntKey, number]> {
    for (let i = 0; i < this.count; i++) yield [this.keyAt(i), this.offsetAt(i)];
  }

  /**
   * Is the index actually sorted the way the search assumes?
   *
   * A cheap invariant, and the one that would catch getting integer key
   * ordering wrong: for a dense integer key the byte order and the numeric
   * order agree for the first 256 entries and diverge after, so a spot check
   * near the start proves nothing.
   */
  checkSorted(): { ok: boolean; at?: number } {
    for (let i = 1; i < this.count; i++) {
      const key = this.keyAt(i);
      if (this.compareAt(i - 1, key, this.encodeKey(key)) > 0) return { ok: false, at: i };
    }
    return { ok: true };
  }
}
