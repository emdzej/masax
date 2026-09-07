/**
 * Shared vocabulary for the ASA catalogue.
 *
 * The names follow the `.ddm` field comments, which are the vendor's own and
 * the only human-readable names the format carries. Where a comment is
 * misspelled in the data (`Classicfication`) the type uses the correct
 * spelling and the mapping is done in `@masax/lex`.
 */

/** A language the data ships in. The `.fdt` templates use these as the `@`. */
export type Language = "D" | "E" | "F" | "GB" | "I" | "J" | "NL" | "P" | "USA";

/** The four languages present on the European media. */
export const EUROPE_LANGUAGES: readonly Language[] = ["D", "F", "GB", "J"];

/**
 * A catalogue id, e.g. `B6037609A`. One catalogue is one `.bin`/`.pnt` pair
 * and covers a family of models. The second-to-last character is a revision:
 * `B60318A8A` becomes `B60318A9A` when an update supersedes it.
 */
export type CatalogueId = string;

/** A text serial: an integer key into `Desc`, which exists once per language. */
export type Ts = number;

/**
 * A date as the catalogue stores it: `YYYYMMT`, where `T` is a third of the
 * month — 1 early, 2 mid, 3 late. `1983011` is early January 1983.
 */
export type AsaDate = number;

/** A part name code, e.g. `05100A`. Keys `pnc`, and printed on the drawings. */
export type Pnc = string;

/** A part number, e.g. `MB247182`. */
export type PartNumber = string;

/** The two halves of the VIN and serial indexes, one per disc. */
export type VinHalf = "A" | "B";

/** A resolved production date. `third` is 1, 2 or 3. */
export interface ProductionDate {
  year: number;
  month: number;
  third: 1 | 2 | 3;
}

/** Decode a `YYYYMMT` integer. Returns undefined for 0 or a malformed value. */
export function decodeAsaDate(value: AsaDate | undefined): ProductionDate | undefined {
  if (!value || value <= 0) return undefined;
  const third = value % 10;
  const month = Math.floor(value / 10) % 100;
  const year = Math.floor(value / 1000);
  if (third < 1 || third > 3) return undefined;
  if (month < 1 || month > 12) return undefined;
  if (year < 1900 || year > 2100) return undefined;
  return { year, month, third: third as 1 | 2 | 3 };
}

/**
 * Compact form for tables: `1983-01·1`, with the third as a digit.
 *
 * The drawings themselves print dates this way — a plate carries `(-8301·3)` —
 * so the notation is the vendor's, not an invention.
 */
export function formatAsaDateShort(value: AsaDate | undefined): string {
  const d = decodeAsaDate(value);
  if (!d) return "";
  return `${d.year}-${String(d.month).padStart(2, "0")}\u00b7${d.third}`;
}

/** Format a production date as `1983-01` plus the third, e.g. `1983-01 (early)`. */
export function formatAsaDate(value: AsaDate | undefined): string {
  const d = decodeAsaDate(value);
  if (!d) return "";
  const third = d.third === 1 ? "early" : d.third === 2 ? "mid" : "late";
  return `${d.year}-${String(d.month).padStart(2, "0")} (${third})`;
}
