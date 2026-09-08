/**
 * The parts drawings.
 *
 * Files under `ILLUST/` are named `*.tif` but are not TIFFs as stored: every
 * byte is XOR'd with `0x0b`, except byte 0 which uses `0x31`. Undo that and
 * you have an ordinary TIFF — 1-bit bilevel, CCITT Group 4, typically
 * 960x1210.
 *
 * The obfuscation sits on top of plain TIFF rather than being a container:
 * `LxidTiff.dll` genuinely tests for the `II*` magic. Note that XOR-ing with
 * `0x0b` alone yields `73 49 2a 00` — "sI*\0", one byte off the magic — which
 * reads as "nearly TIFF" and invites a hunt for a wrapper that does not exist.
 */
import { decodeGroup4, type DecodeResult } from "./g4.js";

const KEY = 0x0b;
const KEY_FIRST = 0x31;

export const Tag = {
  NewSubfileType: 0x00fe,
  ImageWidth: 0x0100,
  ImageLength: 0x0101,
  BitsPerSample: 0x0102,
  Compression: 0x0103,
  Photometric: 0x0106,
  FillOrder: 0x010a,
  StripOffsets: 0x0111,
  Orientation: 0x0112,
  SamplesPerPixel: 0x0115,
  RowsPerStrip: 0x0116,
  StripByteCounts: 0x0117,
  XResolution: 0x011a,
  YResolution: 0x011b,
  ResolutionUnit: 0x0128,
} as const;

export const Compression: Record<number, string> = {
  1: "none",
  2: "CCITT-RLE",
  3: "CCITT-G3",
  4: "CCITT-G4",
  5: "LZW",
  7: "JPEG",
  8: "Deflate",
  32773: "PackBits",
};

/** Undo the obfuscation. Self-inverse, so it also re-applies it. */
export function deobfuscate(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i]! ^ KEY;
  if (data.length > 0) out[0] = data[0]! ^ KEY_FIRST;
  return out;
}

/** Same transform; named for intent when writing files the application reads. */
export const obfuscate = deobfuscate;

export interface Ifd {
  /** Single-valued tags. */
  tags: Map<number, number>;
  /** Multi-valued tags, kept separately so a stray array is not read as a scalar. */
  arrays: Map<number, number[]>;
  /**
   * Raw payload bytes per tag, as the tag declares them.
   *
   * Needed because tag `0xfe00` declares itself an array of LONGs but is really
   * a packed byte blob — the callout hotspots. Reading it as numbers loses the
   * record boundaries.
   */
  raw: Map<number, Uint8Array>;
  /**
   * Where each tag's payload starts in the file.
   *
   * Tag `0xfe00` needs this because **its declared count under-reports the
   * data**: the blob is written after the image strip, at the end of the file,
   * and the records run past `4 * count`. Reading only the declared length
   * truncates the last few callouts on 13,653 of the 17,977 drawings — and
   * truncates them *mid-record*, so a parser that stops there looks like it
   * simply found fewer hotspots.
   */
  offsets: Map<number, number>;
  littleEndian: boolean;
}

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4 };

export function readIfd(tiff: Uint8Array): Ifd {
  if (tiff.length < 8) throw new Error("TIFF: too short");
  const magic = String.fromCharCode(tiff[0]!, tiff[1]!);
  if (magic !== "II" && magic !== "MM") {
    throw new Error(`TIFF: bad byte order ${JSON.stringify(magic)}`);
  }
  const little = magic === "II";
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const u16 = (at: number) => view.getUint16(at, little);
  const u32 = (at: number) => view.getUint32(at, little);
  if (u16(2) !== 42) throw new Error(`TIFF: bad version ${u16(2)}`);

  const start = u32(4);
  const count = u16(start);
  const tags = new Map<number, number>();
  const arrays = new Map<number, number[]>();
  const raw = new Map<number, Uint8Array>();
  const offsets = new Map<number, number>();

  for (let i = 0; i < count; i++) {
    const at = start + 2 + 12 * i;
    const tag = u16(at);
    const type = u16(at + 2);
    const length = u32(at + 4);
    const size = TYPE_SIZE[type] ?? 0;
    if (size === 0) continue;

    const inline = size * length <= 4;
    const base = inline ? at + 8 : u32(at + 8);
    const read = (n: number): number => {
      const p = base + n * size;
      if (type === 3) return u16(p);
      if (type === 4 || type === 9) return u32(p);
      if (type === 1 || type === 2 || type === 6 || type === 7) return tiff[p] ?? 0;
      if (type === 5) return u32(p) / (u32(p + 4) || 1);
      return 0;
    };

    raw.set(tag, tiff.subarray(base, base + size * length));
    offsets.set(tag, base);
    if (length === 1) {
      tags.set(tag, read(0));
    } else {
      const values: number[] = [];
      for (let n = 0; n < length; n++) values.push(read(n));
      arrays.set(tag, values);
      tags.set(tag, values[0]!);
    }
  }
  return { tags, arrays, raw, offsets, littleEndian: little };
}

export interface Illustration extends DecodeResult {
  compression: number;
  /** What the strip declared, against `bitsRead` from the decoder. */
  stripBytes: number;
}

/**
 * Decode a stored `ILLUST/*.tif` all the way to pixels.
 *
 * Multi-strip images are refused rather than guessed at: `RowsPerStrip` equals
 * `ImageLength` for every drawing on the media, so a second strip would mean
 * the assumption no longer holds and the caller should know.
 */
export function decodeIllustration(stored: Uint8Array): Illustration {
  const tiff = deobfuscate(stored);
  const { tags, arrays } = readIfd(tiff);

  const width = tags.get(Tag.ImageWidth);
  const height = tags.get(Tag.ImageLength);
  if (!width || !height) throw new Error("TIFF: no image dimensions");

  const compression = tags.get(Tag.Compression) ?? 1;
  if (compression !== 4) {
    throw new Error(
      `TIFF: compression ${Compression[compression] ?? compression} is not supported; ` +
        `every ASA drawing is CCITT-G4`,
    );
  }
  // `decodeGroup4` returns the Group 4 run colours, where the first run of a
  // row is white. That is exactly WhiteIsZero, so a drawing tagged otherwise
  // would come out inverted in tone. Every drawing on the media declares 0;
  // refusing anything else keeps the assumption visible instead of silently
  // wrong.
  const photometric = tags.get(Tag.Photometric) ?? 0;
  if (photometric !== 0) {
    throw new Error(
      `TIFF: Photometric ${photometric} is not supported; ` +
        `the decoder returns WhiteIsZero run colours`,
    );
  }
  if (arrays.has(Tag.StripOffsets)) {
    throw new Error(`TIFF: ${arrays.get(Tag.StripOffsets)!.length} strips, expected one`);
  }

  const offset = tags.get(Tag.StripOffsets);
  const stripBytes = tags.get(Tag.StripByteCounts);
  if (offset === undefined || stripBytes === undefined) throw new Error("TIFF: no strip");

  const strip = tiff.subarray(offset, offset + stripBytes);
  const decoded = decodeGroup4(strip, { width, height });
  return { ...decoded, compression, stripBytes };
}

/** One-line summary, for the CLI. */
export function describe(tags: Map<number, number>): string {
  const compression = tags.get(Tag.Compression);
  return (
    `${tags.get(Tag.ImageWidth)}x${tags.get(Tag.ImageLength)} ` +
    `${tags.get(Tag.BitsPerSample)}-bit ${Compression[compression ?? 0] ?? compression}`
  );
}
