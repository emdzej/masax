/**
 * `.bin` — the records.
 *
 * A record is a `uint16` payload length followed by the payload. Fields appear
 * in `.ddm` order; text is length-prefixed or space padded per its type,
 * integers are little-endian, and arrays and groups carry a leading count.
 *
 * When the `.fdt` says the dataset is sparse, the payload opens with a field
 * presence bitmap and only the fields whose bit is set are stored.
 */
import { FieldType, StorageClass, isGroup, type Field, type Fdt } from "./fdt.js";
import { latin1, trimEnd } from "./text.js";

export type Scalar = string | number;
export type GroupRow = Record<string, Scalar>;
export type FieldValue = Scalar | Scalar[] | GroupRow[];
export type LexRecord = Record<string, FieldValue>;

function readScalar(body: Uint8Array, at: number, field: Field): [Scalar, number] {
  switch (field.type) {
    case FieldType.VarStr: {
      const len = body[at];
      if (len === undefined) throw new Error(`record: truncated varstr length for ${field.code}`);
      const end = at + 1 + len;
      if (end > body.length) throw new Error(`record: varstr ${field.code} runs past the payload`);
      return [trimEnd(latin1(body.subarray(at + 1, end))), end];
    }
    case FieldType.FixStr: {
      const end = at + field.width;
      if (end > body.length) throw new Error(`record: fixstr ${field.code} runs past the payload`);
      return [trimEnd(latin1(body.subarray(at, end))), end];
    }
    case FieldType.Uint:
    case FieldType.Int: {
      const end = at + field.width;
      if (end > body.length) throw new Error(`record: int ${field.code} runs past the payload`);
      let value = 0;
      for (let i = field.width - 1; i >= 0; i--) value = value * 256 + body[at + i]!;
      if (field.type === FieldType.Int) {
        const limit = 2 ** (field.width * 8 - 1);
        if (value >= limit) value -= limit * 2;
      }
      return [value, end];
    }
    default:
      throw new Error(`record: ${field.code} is not a scalar (type ${field.type.toString(16)})`);
  }
}

function readField(body: Uint8Array, at: number, field: Field): [FieldValue, number] {
  if (isGroup(field.type)) {
    const count = body[at];
    if (count === undefined) throw new Error(`record: truncated group count for ${field.code}`);
    let cursor = at + 1;
    const rows: GroupRow[] = [];
    for (let i = 0; i < count; i++) {
      const row: GroupRow = {};
      for (const child of field.children) {
        const [value, next] = readScalar(body, cursor, child);
        row[child.code] = value;
        cursor = next;
      }
      rows.push(row);
    }
    return [rows, cursor];
  }

  // The count width follows the storage class, not the capacity. `catalog.E3`
  // holds up to 1000 codes and writes its count as a uint16; reading a byte
  // there consumes the low half, invents an empty first element, and leaves
  // the record exactly one element short.
  let count: number | undefined;
  let cursor = at;
  if (field.storage === StorageClass.Array8) {
    count = body[at];
    cursor = at + 1;
  } else if (field.storage === StorageClass.Array16) {
    if (at + 2 > body.length) throw new Error(`record: truncated array count for ${field.code}`);
    count = body[at]! | (body[at + 1]! << 8);
    cursor = at + 2;
  }
  if (count === undefined) return readScalar(body, at, field);
  const values: Scalar[] = [];
  for (let i = 0; i < count; i++) {
    const [value, next] = readScalar(body, cursor, field);
    values.push(value);
    cursor = next;
  }
  return [values, cursor];
}

/**
 * Decode one record payload — the bytes after the length prefix.
 *
 * `used` is how many bytes the fields consumed. A well-formed record consumes
 * exactly its declared length; anything else means the schema and the data
 * disagree, and `masax verify` treats it as a failure rather than rounding it
 * off.
 */
export function decodeRecord(body: Uint8Array, fdt: Fdt): { record: LexRecord; used: number } {
  const record: LexRecord = {};
  let at = 0;
  let bitmap: Uint8Array | undefined;

  if (fdt.sparse) {
    const byteCount = body[0];
    if (byteCount === undefined) throw new Error("record: truncated bitmap length");
    bitmap = body.subarray(1, 1 + byteCount);
    at = 1 + byteCount;
  }

  for (let i = 0; i < fdt.tree.length; i++) {
    // The bitmap can be shorter than the field count; anything past its end is
    // absent. `catalog` record `01090` ships one byte for thirteen fields.
    if (bitmap) {
      const byte = bitmap[i >> 3];
      if (byte === undefined || (byte & (0x80 >> (i & 7))) === 0) continue;
    }
    const field = fdt.tree[i]!;
    const [value, next] = readField(body, at, field);
    record[field.code] = value;
    at = next;
  }

  return { record, used: at };
}
