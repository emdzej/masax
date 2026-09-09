/**
 * Whether a part row fits a particular vehicle.
 *
 * A plate's rows are the whole production run of a model. A 1994 Pajero's
 * filler-pipe plate lists three hoses, one per period, and only one of them is
 * the part to order. Narrowing that to the vehicle needs three fields, and the
 * third one took a while to identify.
 *
 * **`E1` is an option code, not a pack code.** This is the finding that makes
 * the rest work. A vehicle's OPC — `H70` — is a *pack*, and `Opc` expands it to
 * 34 option codes like `A28` and `C15`. A part row's `E1` is one of those
 * expanded codes, so the test is "is `E1` in the pack this vehicle carries".
 * Measured over every `E1`-bearing row of `PAJERO/MONTERO(EUR)`: the code lies
 * inside that model's own pack vocabulary in **112,636 of 112,636 rows, with no
 * exceptions**, and all 365 distinct values appear in `OInfo`. No PNC and no
 * model code does.
 *
 * So a row applies when all three hold, each vacuously true when its field is
 * empty:
 *
 * | Field                    | Test                                        |
 * | ------------------------ | ------------------------------------------- |
 * | `C1`/`C2` date window    | the build date falls inside it, inclusive   |
 * | `E2` classification list | it contains the vehicle's classification    |
 * | `E1` option code         | the vehicle's option pack contains it       |
 *
 * ## What it does, measured
 *
 * Over all 350 plates of a `V25W` built 1994-03, classification `GRXML6`,
 * OPC `H70`:
 *
 * | Stage             | Rows   | Rows per code | Codes with more than one row |
 * | ----------------- | ------ | ------------- | ---------------------------- |
 * | unfiltered        | 20,836 | 4.96          | 54.8%                        |
 * | + date            |  8,010 | 2.11          | 13.8%                        |
 * | + classification  |  6,864 | 1.91          |  8.7%                        |
 * | + options         |  6,685 | 1.87          |  7.7%                        |
 *
 * On `13-010 FUEL FILLER PIPE` that is 19 rows down to 11 — exactly one per
 * callout printed on the drawing — and every dropped row goes on date alone.
 *
 * The residual 7.7% is mostly not ambiguity at all. Of the 620 codes that keep
 * more than one row: 216 give the *same* part number twice, 72 are `L`/`R`
 * pairs, 157 differ by an option code the pack holds both of, and 175 are
 * variants a catalogue genuinely lists side by side — engine bearing grades
 * like `03407`'s `MD169655` and `MD169656`, chosen by measurement rather than
 * by VIN.
 *
 * ## What is still not proven
 *
 * That the three tests are combined with **and**, and that an empty field means
 * "all" rather than "unknown". Both are consistent with everything measured and
 * neither is confirmed against the original application's output for a plate.
 * Filtering removes 628 of 4,203 codes for the vehicle above — correctly as far
 * as can be told, since each goes on a date window that plainly excludes the
 * build date, but not verifiably. Hence `reasons`: the caller can show why a
 * row was dropped instead of making it vanish silently.
 *
 * `E3 ApplicableCodes` plays no part here and is still unidentified — a
 * four-plus-three character pair such as `BD2 72H`, which resembles a colour
 * and trim combination without matching either vocabulary well enough to say.
 */
import type { AsaDate } from "@masax/core";
import type { PartRow } from "./catalogue.js";

/** What a decoded VIN contributes to the decision. */
export interface VehicleFit {
  classification?: string;
  productionDate?: AsaDate;
  /** The vehicle's expanded option pack — see `OptionTable`. */
  options?: ReadonlySet<string>;
}

/** Which test a row failed. */
export type FitFailure = "date" | "classification" | "option";

export interface RowFit {
  fits: boolean;
  /** Empty when it fits. Ordered as the tests are listed above. */
  reasons: FitFailure[];
}

const FITS: RowFit = { fits: true, reasons: [] };

/**
 * Test one row.
 *
 * A test whose *vehicle* side is unknown is skipped rather than failed: with no
 * decoded build date, a date window cannot exclude anything, and treating the
 * absence as a mismatch would empty the list. The same goes for an option pack
 * that could not be resolved — 1,016 model-and-OPC pairs have none.
 */
export function fitsVehicle(row: PartRow, vehicle: VehicleFit): RowFit {
  const reasons: FitFailure[] = [];

  const built = vehicle.productionDate;
  if (built !== undefined) {
    const from = row.startDate;
    const to = row.endDate;
    if ((from !== undefined && built < from) || (to !== undefined && built > to)) {
      reasons.push("date");
    }
  }

  const wanted = vehicle.classification;
  if (wanted !== undefined && row.classification?.length && !row.classification.includes(wanted)) {
    reasons.push("classification");
  }

  const pack = vehicle.options;
  if (pack !== undefined && row.opc && !pack.has(row.opc)) {
    reasons.push("option");
  }

  return reasons.length === 0 ? FITS : { fits: false, reasons };
}

/** True when there is anything at all to narrow by. */
export function canNarrow(vehicle: VehicleFit): boolean {
  return (
    vehicle.productionDate !== undefined ||
    vehicle.classification !== undefined ||
    vehicle.options !== undefined
  );
}

/** The rows that fit, in order. */
export function narrowToVehicle(rows: readonly PartRow[], vehicle: VehicleFit): PartRow[] {
  return rows.filter((row) => fitsVehicle(row, vehicle).fits);
}
