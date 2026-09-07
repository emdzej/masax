/**
 * VIN decoding.
 *
 * ASA can do this locally, which is worth stating plainly because the
 * equivalent Renault system could not: its VIN lookup was a remote dealer
 * service, so a client-side reimplementation had to decline. Here the data is
 * on the disc — 5.4 million `Vin` records across the two halves.
 *
 * The trick is how a VIN is split. `Vin` is keyed on a **7-character serial**
 * and each record stores a chassis prefix; together they make the VIN:
 *
 * ```
 *   JMBGNPD5VS   +   A000003   =   JMBGNPD5VSA000003
 *   chassis (A1)     serial (A0)
 * ```
 *
 * **The split is from the right, because only the serial has a fixed length.**
 * Measured over all 5,418,637 records: the serial is 7 characters in every
 * single one, while the chassis is 10 in 99.26% and 7 in 39,986 of them (plus a
 * dozen at 4 and 6). So 0.74% of these vehicles have a chassis number that
 * predates the 17-character VIN, and a decoder that insists on 17 rejects
 * forty thousand valid ones.
 *
 * So a decode is: find the serial in the index, read its run — one bounded
 * range read, 186 bytes on average — and match the chassis prefix among the
 * records in it. One serial can carry many chassis variants; `A000001` has 66.
 *
 * **Most records do not carry a specification.** In a run of 316, the model,
 * classification, OPC, paint and trim fields appear on only 50; the rest carry
 * a serial, a chassis, a build date and an **XREF** — field `A2`, a pointer to
 * another serial that holds the specification for that chassis:
 *
 * ```
 *   J000188 + JMB0RV250R  ->  XREF J000153
 *   J000153 + JMB0RV250R  ->  model V25W, class GRXML6, OPC H70, paint D9H
 * ```
 *
 * Following it is not optional: without it a perfectly valid VIN decodes to a
 * build date and nothing else, which reads as "not found". And the obvious
 * alternative — inheriting absent fields from the record above, as the
 * catalogue tables do — gives the *wrong* answer here: the nearest preceding
 * record with a model is `V23W`, the 2.3, where the XREF says `V25W`.
 */
import { type AsaDate, type VinHalf, decodeAsaDate, type ProductionDate } from "@masax/core";
import type { CsFileSystem } from "@emdzej/csfs-core";
import { Dataset, type LexRecord } from "@masax/lex";

/** Invariant across every record on the media. */
export const SERIAL_LENGTH = 7;
/** The usual chassis length, and so the usual VIN length. Not a requirement. */
export const VIN_LENGTH = 17;
export const CHASSIS_LENGTH = VIN_LENGTH - SERIAL_LENGTH;
/** Shortest input that could carry a serial and at least some chassis. */
export const MIN_VIN_LENGTH = SERIAL_LENGTH + 1;

/** Fields of a `Vin` record, named from the `.ddm` comments. */
export interface VinRecord {
  serial: string;
  chassis: string;
  half: VinHalf;
  /** Serial holding this chassis's specification, when this record does not. */
  xref?: string;
  /**
   * Serial the specification was actually read from, when it came from an
   * XREF. Worth surfacing: the values describe this chassis but were recorded
   * against another serial.
   */
  specFrom?: string;
  productionDate?: AsaDate;
  produced?: ProductionDate;
  model?: string;
  classification?: string;
  /** The raw model-year code. Always a multiple of ten; see the note below. */
  modelYearCode?: number;
  opc?: string;
  exterior?: string;
  interior?: string;
  paint?: string;
  sef?: string;
  bcc?: string;
  bcf?: string;
  cfc?: string;
}

export interface VinDecoding {
  /** The VIN as given, normalised. */
  vin: string;
  serial: string;
  chassis: string;
  /** Records whose chassis prefix matches the VIN exactly. */
  matches: VinRecord[];
  /**
   * Other vehicles sharing the serial.
   *
   * Populated when the serial is present but no chassis matches, so the
   * interface can say "this serial exists, but not with that chassis" instead
   * of an unhelpful "not found".
   */
  sameSerial: VinRecord[];
}

export class VinNotWellFormed extends Error {}

/** Strip separators and upper-case. Does not validate the check digit — ASA has none. */
export function normaliseVin(input: string): string {
  return input.replace(/[\s-]/g, "").toUpperCase();
}

function toRecord(record: LexRecord, half: VinHalf): VinRecord {
  const text = (code: string) => {
    const value = record[code];
    return typeof value === "string" && value !== "" ? value : undefined;
  };
  const number = (code: string) => {
    const value = record[code];
    return typeof value === "number" ? value : undefined;
  };
  const date = number("A3");
  return {
    serial: text("A0") ?? "",
    chassis: text("A1") ?? "",
    half,
    xref: text("A2"),
    productionDate: date,
    produced: decodeAsaDate(date),
    model: text("A4"),
    classification: text("A5"),
    modelYearCode: number("A6"),
    opc: text("A7"),
    exterior: text("A8"),
    interior: text("A9"),
    paint: text("AA"),
    sef: text("AB"),
    bcc: text("AC"),
    bcf: text("AD"),
    cfc: text("AE"),
  };
}

/** The `Vin` index, over both halves. */
export class VinIndex {
  private constructor(private readonly halves: { half: VinHalf; dataset: Dataset }[]) {}

  /**
   * Open both halves.
   *
   * The two are separate datasets, not two parts of one: a serial can exist in
   * both with different vehicles behind it, so a lookup has to try each and the
   * chassis prefix is what disambiguates.
   */
  static async open(fs: CsFileSystem, dataDir: string): Promise<VinIndex> {
    const halves: { half: VinHalf; dataset: Dataset }[] = [];
    for (const half of ["A", "B"] as const) {
      try {
        halves.push({ half, dataset: await Dataset.open(fs, `${dataDir}/${half}`, "Vin") });
      } catch {
        // A partial installation may carry only one half.
      }
    }
    if (halves.length === 0) throw new Error(`${dataDir}: no Vin data in either half`);
    return new VinIndex(halves);
  }

  get records(): number {
    return this.halves.reduce((n, h) => n + h.dataset.count, 0);
  }

  /** Every vehicle recorded against a serial, across both halves. */
  async bySerial(serial: string): Promise<VinRecord[]> {
    const out: VinRecord[] = [];
    for (const { half, dataset } of this.halves) {
      for (const record of await dataset.runFor(serial, ["A0"])) {
        out.push(toRecord(record, half));
      }
    }
    return out;
  }

  /** Does this record already say what the vehicle is? */
  private static hasSpecification(record: VinRecord): boolean {
    return record.model !== undefined || record.classification !== undefined;
  }

  /**
   * Fill in a record's specification by following its XREF.
   *
   * The chain can be more than one hop, so it is walked with a cap and a set of
   * visited serials — a cycle in the data would otherwise hang a lookup. Only
   * absent fields are filled: the record's own build date is this vehicle's and
   * must not be replaced by the referenced vehicle's.
   */
  async resolveSpecification(record: VinRecord, maxHops = 4): Promise<VinRecord> {
    if (VinIndex.hasSpecification(record)) return record;
    const seen = new Set([record.serial]);
    let cursor = record;

    for (let hop = 0; hop < maxHops; hop++) {
      const next = cursor.xref;
      if (!next || seen.has(next)) break;
      seen.add(next);

      const candidates = await this.bySerial(next);
      const referenced = candidates.find((c) => c.chassis === record.chassis);
      if (!referenced) break;
      cursor = referenced;
      if (VinIndex.hasSpecification(referenced)) {
        return {
          ...record,
          model: record.model ?? referenced.model,
          classification: record.classification ?? referenced.classification,
          modelYearCode: record.modelYearCode ?? referenced.modelYearCode,
          opc: record.opc ?? referenced.opc,
          exterior: record.exterior ?? referenced.exterior,
          interior: record.interior ?? referenced.interior,
          paint: record.paint ?? referenced.paint,
          sef: record.sef ?? referenced.sef,
          bcc: record.bcc ?? referenced.bcc,
          bcf: record.bcf ?? referenced.bcf,
          cfc: record.cfc ?? referenced.cfc,
          specFrom: referenced.serial,
        };
      }
    }
    return record;
  }

  async decode(input: string): Promise<VinDecoding> {
    const vin = normaliseVin(input);
    if (vin.length < MIN_VIN_LENGTH) {
      throw new VinNotWellFormed(
        `need at least ${MIN_VIN_LENGTH} characters — a ${SERIAL_LENGTH}-character ` +
          `serial and a chassis — but got ${vin.length} in ${JSON.stringify(vin)}`,
      );
    }
    // Split from the right: the serial is always 7, the chassis is not always 10.
    const serial = vin.slice(-SERIAL_LENGTH);
    const chassis = vin.slice(0, -SERIAL_LENGTH);
    const all = await this.bySerial(serial);
    const matches = await Promise.all(
      all.filter((r) => r.chassis === chassis).map((r) => this.resolveSpecification(r)),
    );
    return {
      vin,
      serial,
      chassis,
      matches,
      sameSerial: matches.length > 0 ? [] : all,
    };
  }

  async close(): Promise<void> {
    for (const { dataset } of this.halves) await dataset.close();
  }
}
