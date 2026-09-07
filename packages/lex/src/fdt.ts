/**
 * `.fdt` — the field definition table.
 *
 * See `docs/data-format.md` for the byte layout. Everything here is
 * little-endian.
 */
import { latin1, trimEnd } from "./text.js";

/** How a field's value is stored. */
export const FieldType = {
  /** Fixed-width text, space padded to `width`. */
  FixStr: 0x12,
  /** Unsigned integer, `width` bytes, little-endian. */
  Uint: 0x14,
  /** Signed integer, `width` bytes, little-endian. */
  Int: 0x16,
  /** Variable text: one length byte, then that many bytes. */
  VarStr: 0x22,
  /** Repeating group header. Two spellings occur; they behave the same. */
  GroupA: 0x0a,
  GroupB: 0x1a,
} as const;
export type FieldTypeValue = (typeof FieldType)[keyof typeof FieldType];

const FIELD_TYPES = new Set<number>(Object.values(FieldType));
export function isGroup(type: number): boolean {
  return type === FieldType.GroupA || type === FieldType.GroupB;
}

/**
 * How many values a field holds, and how the count is encoded.
 *
 * `maxRepeat` alone does not mean a field repeats — `DudMMC.A0` has
 * `maxRepeat = 4` and is a plain integer. Only this decides.
 */
export const StorageClass = {
  Group: 1,
  /** Array of scalars, count in one byte. */
  Array8: 2,
  Scalar: 3,
  /** Array of scalars, count in two bytes. `catalog.E3` holds up to 1000. */
  Array16: 4,
} as const;

export interface Field {
  /** The two-character code from the `.ddm`, e.g. `A1`. */
  code: string;
  /** Characters for text, bytes for an integer. */
  width: number;
  /** Capacity of an array. Zero when the field does not repeat. */
  maxRepeat: number;
  storage: number;
  type: number;
  /** The `.fdt`'s own label. `.ddm` comments are usually better; see `ddm.ts`. */
  label: string;
  /** Byte offset in the unpacked buffer. Not used to read `.bin`. */
  bufferOffset: number;
  /** For a group header, the fields it owns. Empty otherwise. */
  children: Field[];
}

export interface Fdt {
  /** Number of top-level fields — the width of the presence bitmap. */
  topCount: number;
  /** Number of fields including group children. */
  totalCount: number;
  /** `.bin` filename, with `@` where a language or catalogue id goes. */
  binTemplate: string;
  pntTemplate: string;
  /** Longest possible unpacked record. */
  maxRecord: number;
  /** True when records carry a field presence bitmap. */
  sparse: boolean;
  /** Codes of the key fields, in order. Their widths make up the index key. */
  keys: string[];
  /** Every field, flat, in `.ddm` order. */
  fields: Field[];
  /** Top-level fields, with group children nested. Iterate this to decode. */
  tree: Field[];
}

const MAGIC = 0x36;
const FIELDS_AT = 0x38;
const DESCRIPTOR_SIZE = 13;
const SPARSE_FLAG = 9;

/**
 * Read a NUL-terminated name out of a fixed-width slot.
 *
 * The padding is stale bytes, not zeros — `catalog.fdt` holds `"@.bin\0"`
 * followed by `"g.bin\0"` left over from a longer previous name — so the cut
 * has to be at the first NUL rather than by trimming.
 */
function slotName(bytes: Uint8Array, at: number, len: number): string {
  const slot = bytes.subarray(at, at + len);
  const nul = slot.indexOf(0);
  return latin1(nul === -1 ? slot : slot.subarray(0, nul));
}

export function parseFdt(bytes: Uint8Array): Fdt {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => view.getUint16(at, true);

  const magic = u16(0x00);
  if (magic !== MAGIC) throw new Error(`.fdt: bad magic ${magic.toString(16)}, expected 36`);

  const topCount = u16(0x02);
  const totalCount = u16(0x04);
  const binTemplate = slotName(bytes, 0x08, 13);
  const pntTemplate = slotName(bytes, 0x15, 13);
  const maxRecord = u16(0x22);
  const sparse = u16(0x26) === SPARSE_FLAG;
  const keyCount = u16(0x2a);

  const keys: string[] = [];
  for (let i = 0; i < keyCount; i++)
    keys.push(latin1(bytes.subarray(0x2c + 3 * i, 0x2c + 3 * i + 2)));

  const fields: Field[] = [];
  let at = FIELDS_AT;
  for (let i = 0; i < totalCount; i++) {
    const code = latin1(bytes.subarray(at, at + 2));
    const width = u16(at + 3);
    const maxRepeat = u16(at + 5);
    const storage = u16(at + 7);
    const type = u16(at + 11);
    if (!FIELD_TYPES.has(type)) {
      throw new Error(`.fdt: field ${code} has unknown type ${type.toString(16)}`);
    }
    fields.push({
      code,
      width,
      maxRepeat,
      storage,
      type,
      label: "",
      bufferOffset: 0,
      children: [],
    });
    at += DESCRIPTOR_SIZE;
  }

  // The record layout table describes the unpacked buffer, which we never
  // build — `.bin` storage is compact. Its declared size is a useful check
  // that the descriptor table was the length the header claimed.
  const layoutSize = u16(at);
  if (layoutSize !== 8 * totalCount) {
    throw new Error(`.fdt: layout table is ${layoutSize} bytes, expected ${8 * totalCount}`);
  }
  at += 2;
  for (let i = 0; i < totalCount; i++) {
    fields[i]!.bufferOffset = u16(at + 8 * i);
  }
  at += layoutSize;

  for (const field of fields) {
    const len = u16(at);
    field.label = trimEnd(slotName(bytes, at + 2, len));
    at += 2 + len;
  }

  return {
    topCount,
    totalCount,
    binTemplate,
    pntTemplate,
    maxRecord,
    sparse,
    keys,
    fields,
    tree: buildTree(fields, topCount),
  };
}

/**
 * Nest group children under their header.
 *
 * A group header owns every following field that shares its letter prefix.
 * `rep.fdt` declares five top-level fields where the `.ddm` lists seven: `B1`
 * ("Previous Group") owns `B2`/`B3`, and `C1` owns `C2`/`C3`. Children get no
 * bit in the presence bitmap, which is why the count has to come out right.
 */
function buildTree(fields: Field[], topCount: number): Field[] {
  const tree: Field[] = [];
  let i = 0;
  while (i < fields.length) {
    const field = fields[i]!;
    if (isGroup(field.type)) {
      let j = i + 1;
      while (j < fields.length && fields[j]!.code[0] === field.code[0]) {
        field.children.push(fields[j]!);
        j++;
      }
      i = j;
    } else {
      i++;
    }
    tree.push(field);
  }
  if (tree.length !== topCount) {
    throw new Error(`.fdt: grouped into ${tree.length} top-level fields, header says ${topCount}`);
  }
  return tree;
}
