/**
 * Synthetic `.fdt` and `.bin` builders for the tests.
 *
 * No fixture in this repository may be derived from the discs, so the format
 * tests build their own bytes. That is a feature as much as a constraint: a
 * synthetic record can exercise a case the real data never reaches, and the
 * real data is covered by `masax verify` instead.
 */
import { FieldType, StorageClass } from "./fdt.js";
import { toLatin1 } from "./text.js";

export interface FieldSpec {
  code: string;
  width: number;
  type: number;
  storage?: number;
  maxRepeat?: number;
  label?: string;
}

/** Build a `.fdt` byte image for the given fields. */
export function buildFdt(options: {
  fields: FieldSpec[];
  keys: string[];
  binTemplate: string;
  pntTemplate: string;
  sparse: boolean;
  maxRecord?: number;
}): Uint8Array {
  const { fields, keys, binTemplate, pntTemplate, sparse } = options;

  // Top-level count: a group header swallows the following same-letter fields.
  let topCount = 0;
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!;
    topCount++;
    if (field.type === FieldType.GroupA || field.type === FieldType.GroupB) {
      while (i + 1 < fields.length && fields[i + 1]!.code[0] === field.code[0]) i++;
    }
  }

  const labels = fields.map((f) => f.label ?? f.code);
  const size =
    0x38 +
    13 * fields.length +
    2 +
    8 * fields.length +
    labels.reduce((n, l) => n + 3 + l.length, 0);
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  const u16 = (at: number, value: number) => view.setUint16(at, value, true);

  u16(0x00, 0x36);
  u16(0x02, topCount);
  u16(0x04, fields.length);
  u16(0x06, fields.length);
  bytes.set(toLatin1(binTemplate), 0x08);
  bytes.set(toLatin1(pntTemplate), 0x15);
  u16(0x22, options.maxRecord ?? 512);
  u16(0x26, sparse ? 9 : 3);
  u16(0x2a, keys.length);
  keys.forEach((key, i) => bytes.set(toLatin1(key), 0x2c + 3 * i));

  let at = 0x38;
  for (const field of fields) {
    bytes.set(toLatin1(field.code), at);
    u16(at + 3, field.width);
    u16(at + 5, field.maxRepeat ?? 0);
    u16(at + 7, field.storage ?? StorageClass.Scalar);
    u16(at + 11, field.type);
    at += 13;
  }

  u16(at, 8 * fields.length);
  at += 2;
  let offset = 0;
  fields.forEach((field, i) => {
    u16(at + 8 * i, offset);
    u16(at + 8 * i + 2, field.width);
    u16(at + 8 * i + 4, 3);
    u16(at + 8 * i + 6, i);
    offset += field.width;
  });
  at += 8 * fields.length;

  for (const label of labels) {
    u16(at, label.length + 1);
    bytes.set(toLatin1(label), at + 2);
    at += 2 + label.length + 1;
  }
  return bytes.subarray(0, at);
}

/** Wrap a payload as a `.bin` record: a uint16 length, then the payload. */
export function buildRecord(payload: number[]): Uint8Array {
  const out = new Uint8Array(2 + payload.length);
  out[0] = payload.length & 0xff;
  out[1] = (payload.length >> 8) & 0xff;
  out.set(payload, 2);
  return out;
}

/** A presence bitmap: a length byte, then MSB-first bits for the given fields. */
export function bitmap(presentIndexes: number[], byteCount: number): number[] {
  const bits = new Array<number>(byteCount).fill(0);
  for (const i of presentIndexes) {
    const byte = i >> 3;
    if (byte < byteCount) bits[byte]! |= 0x80 >> (i & 7);
  }
  return [byteCount, ...bits];
}
