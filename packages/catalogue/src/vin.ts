/**
 * VIN decoding.
 *
 * ASA can do this locally, which is worth stating plainly because the
 * equivalent Renault system could not: its VIN lookup was a remote dealer
 * service, so a client-side reimplementation had to decline. Here the data is
 * on the disc — 5.4 million `Vin` records across the two halves.
 *
 * The trick is how a VIN is split. `Vin` is keyed on a **7-character serial**
 * and each record stores a **10-character chassis prefix**; together they are
 * exactly the 17 characters of a VIN:
 *
 * ```
 *   JMBGNPD5VS   +   A000003   =   JMBGNPD5VSA000003
 *   chassis (A1)     serial (A0)
 * ```
 *
 * So a decode is: find the serial in the index, read its run — one bounded
 * range read, 186 bytes on average — and match the chassis prefix among the
 * records in it. One serial can carry many chassis variants; `A000001` has 66.
 */
import { type AsaDate, type VinHalf, decodeAsaDate, type ProductionDate } from "@masax/core";
import type { CsFileSystem } from "@emdzej/csfs-core";
import { Dataset, type LexRecord } from "@masax/lex";

export const VIN_LENGTH = 17;
export const SERIAL_LENGTH = 7;
export const CHASSIS_LENGTH = VIN_LENGTH - SERIAL_LENGTH;

/** Fields of a `Vin` record, named from the `.ddm` comments. */
export interface VinRecord {
  serial: string;
  chassis: string;
  half: VinHalf;
  xref?: string;
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

  async decode(input: string): Promise<VinDecoding> {
    const vin = normaliseVin(input);
    if (vin.length !== VIN_LENGTH) {
      throw new VinNotWellFormed(
        `a VIN is ${VIN_LENGTH} characters; got ${vin.length} in ${JSON.stringify(vin)}`,
      );
    }
    const chassis = vin.slice(0, CHASSIS_LENGTH);
    const serial = vin.slice(CHASSIS_LENGTH);
    const all = await this.bySerial(serial);
    const matches = all.filter((r) => r.chassis === chassis);
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
