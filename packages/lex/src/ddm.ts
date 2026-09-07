/**
 * `.ddm` — the field list, as INI text.
 *
 * ```ini
 * [FILE1]
 * fdt=catalog.fdt
 *
 * [DDF]
 * cnt=13
 * 1=A1,S  ;PNC
 * 2=A2,S  ;Model
 * ```
 *
 * The trailing comments are the only human-readable field names the format
 * carries, and they are better than the `.fdt` labels — the two disagree here
 * and there, and the `.ddm` is the one that matches what the field holds.
 */
import { latin1 } from "./text.js";

export interface DdmField {
  /** 1-based position in the `[DDF]` list. */
  ordinal: number;
  /** Field code, e.g. `A1`. */
  code: string;
  /** `S` for text, `I` for an integer. Advisory: `.fdt` carries the real type. */
  kind: string;
  /** The trailing comment. Empty when the vendor left it out. */
  comment: string;
}

export interface Ddm {
  /** The `.fdt` this dataset's schema lives in. */
  fdt?: string;
  fields: DdmField[];
}

export function parseDdm(bytes: Uint8Array): Ddm {
  const text = latin1(bytes);
  let section = "";
  let fdt: string | undefined;
  const fields: DdmField[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("[")) {
      section = line.replace(/^\[|\]$/g, "").toUpperCase();
      continue;
    }
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1);

    if (section === "FILE1" && key.toLowerCase() === "fdt") {
      fdt = value.trim();
      continue;
    }
    if (section !== "DDF") continue;
    const ordinal = Number(key);
    if (!Number.isInteger(ordinal)) continue;

    const semi = value.indexOf(";");
    const body = semi === -1 ? value : value.slice(0, semi);
    const comment = semi === -1 ? "" : value.slice(semi + 1).trim();
    const parts = body.split(",").map((p) => p.trim());
    if (parts.length < 2) continue;
    fields.push({ ordinal, code: parts[0]!, kind: parts[1]!, comment });
  }

  fields.sort((a, b) => a.ordinal - b.ordinal);
  return { fdt, fields };
}
