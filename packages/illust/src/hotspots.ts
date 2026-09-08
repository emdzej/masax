/**
 * Callout hotspots, from a private TIFF tag.
 *
 * The drawings are clickable in the original — `ASA.exe` has a
 * `CHotImageView` — and nothing in the `.ddm` schemas declares a coordinate.
 * The coordinates are in the image: TIFF tag **`0xfe00`**, a private tag
 * declared as an array of LONGs but really a packed byte blob of records.
 *
 * Each record is the bounding box of a callout *label* printed on the plate,
 * with the part-name code it points at:
 *
 * ```
 *   u16 length     total bytes of this record, including this field
 *   u16 x          left, in image pixels
 *   u16 y          top
 *   u16 width      of the label box, typically ~103
 *   u16 height     typically ~24
 *   u8  n, bytes   part-name code, length-prefixed
 *   u8  n, bytes   the label as drawn, length-prefixed
 *   u16 flags      always 1 on the European media
 * ```
 *
 * The two strings are usually identical; the second is what is printed, so it
 * is kept separately rather than assumed.
 *
 * Some drawings carry the tag with a single LONG and no records — an index page
 * with nothing to point at. That is not an error, and it is why the parser
 * reports "no hotspots" rather than failing on a short payload.
 *
 * **The declared count under-reports the data.** The blob is written after the
 * image strip, at the very end of the file, and the records run past
 * `4 * count`. Reading only the declared length truncates the last callouts on
 * 13,653 of the 17,977 drawings, and truncates them mid-record, so the loss
 * looks like "this plate has fewer hotspots" rather than like an error. Read to
 * the end of the file instead — `hotspotsFromTiff` does.
 */
/** The strings are single-byte codes; Latin-1 round-trips every byte. */
function latin1(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += String.fromCharCode(b);
  return out;
}

export const HOTSPOT_TAG = 0xfe00;

export interface Hotspot {
  /** Part-name code, e.g. `05296C`. Keys into a plate's parts list. */
  pnc: string;
  /** The text as printed on the drawing. Usually the same as `pnc`. */
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  flags: number;
}

export interface HotspotResult {
  hotspots: Hotspot[];
  /** Bytes the records consumed; equals the payload length when well-formed. */
  used: number;
  /** Payload length, so a caller can check nothing was left over. */
  length: number;
}

/**
 * Parse the tag payload.
 *
 * Stops cleanly rather than throwing: a payload too short to hold a record is
 * a drawing with no callouts, and there are thousands of those.
 */
export function parseHotspots(payload: Uint8Array): HotspotResult {
  const hotspots: Hotspot[] = [];
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  let at = 0;

  while (at + 10 <= payload.length) {
    const length = view.getUint16(at, true);
    // A record is at least the ten fixed bytes plus two length-prefixed
    // strings and the trailing flags.
    if (length < 14 || at + length > payload.length) break;

    const x = view.getUint16(at + 2, true);
    const y = view.getUint16(at + 4, true);
    const width = view.getUint16(at + 6, true);
    const height = view.getUint16(at + 8, true);

    let cursor = at + 10;
    const readString = (): string | undefined => {
      const n = payload[cursor];
      if (n === undefined || cursor + 1 + n > at + length) return undefined;
      const text = latin1(payload.subarray(cursor + 1, cursor + 1 + n));
      cursor += 1 + n;
      return text;
    };
    const pnc = readString();
    const label = readString();
    if (pnc === undefined || label === undefined || cursor + 2 > at + length) break;
    const flags = view.getUint16(cursor, true);

    hotspots.push({ pnc, label, x, y, width, height, flags });
    at += length;
  }

  return { hotspots, used: at, length: payload.length };
}

/**
 * Read the hotspots of a whole TIFF.
 *
 * Takes the blob from the tag's offset to the end of the file, because the
 * declared count is short. Nothing follows it: the tag payload is the last
 * thing written.
 */
export function hotspotsFromTiff(tiff: Uint8Array, tagOffset: number | undefined): HotspotResult {
  if (tagOffset === undefined || tagOffset >= tiff.length) {
    return { hotspots: [], used: 0, length: 0 };
  }
  return parseHotspots(tiff.subarray(tagOffset));
}
