import { describe, expect, it } from "vitest";
import { canNarrow, fitsVehicle, narrowToVehicle } from "./applicability.js";
import type { PartRow } from "./catalogue.js";
import type { Pnc } from "@masax/core";

const row = (over: Partial<PartRow> = {}): PartRow => ({
  pnc: "05014" as Pnc,
  partNumber: "MB927991",
  ...over,
});

/** The vehicle behind every measurement in `applicability.ts`. */
const V25W = {
  classification: "GRXML6",
  productionDate: 1994031,
  options: new Set(["A28", "C15", "H44"]),
};

describe("fitsVehicle", () => {
  it("keeps a row with no conditions at all", () => {
    expect(fitsVehicle(row(), V25W)).toEqual({ fits: true, reasons: [] });
  });

  /**
   * The case the filter exists for. `05014` has three period rows and a car
   * built 1994-03 takes the first; the later two are the same part superseded.
   */
  it("picks the period row that contains the build date", () => {
    const periods = [
      row({ partNumber: "MB927991", startDate: 1993111, endDate: 1994053 }),
      row({ partNumber: "MB893675", startDate: 1994061, endDate: 1997053 }),
      row({ partNumber: "MR271573", startDate: 1997061, endDate: 2000023 }),
    ];
    expect(narrowToVehicle(periods, V25W).map((r) => r.partNumber)).toEqual(["MB927991"]);
  });

  it("treats the date window as inclusive at both ends", () => {
    const at = (date: number) =>
      fitsVehicle(row({ startDate: 1994031, endDate: 1994053 }), {
        productionDate: date,
      }).fits;
    expect(at(1994031)).toBe(true);
    expect(at(1994053)).toBe(true);
    expect(at(1994023)).toBe(false);
    expect(at(1994061)).toBe(false);
  });

  it("accepts an open-ended window", () => {
    expect(fitsVehicle(row({ startDate: 1993111 }), V25W).fits).toBe(true);
    expect(fitsVehicle(row({ endDate: 2000023 }), V25W).fits).toBe(true);
    expect(fitsVehicle(row({ startDate: 1997061 }), V25W).fits).toBe(false);
  });

  it("matches the classification list, and takes an empty one as all", () => {
    expect(fitsVehicle(row({ classification: ["GRXML6", "GNXML6"] }), V25W).fits).toBe(true);
    expect(fitsVehicle(row({ classification: ["GNXVR6"] }), V25W).fits).toBe(false);
    expect(fitsVehicle(row({ classification: [] }), V25W).fits).toBe(true);
  });

  /**
   * `E1` is an option code, not a pack code: the row says `C15`, the vehicle
   * carries pack `H70`, and `Opc` expands `H70` to the codes to test against.
   */
  it("tests the option code against the expanded pack", () => {
    expect(fitsVehicle(row({ opc: "C15" }), V25W).fits).toBe(true);
    expect(fitsVehicle(row({ opc: "N22" }), V25W).fits).toBe(false);
    expect(fitsVehicle(row({ opc: "" }), V25W).fits).toBe(true);
  });

  it("reports every test a row failed, not just the first", () => {
    const bad = row({ startDate: 1997061, classification: ["GNXVR6"], opc: "N22" });
    expect(fitsVehicle(bad, V25W).reasons).toEqual(["date", "classification", "option"]);
  });

  /**
   * A test the *vehicle* cannot answer is skipped, not failed. Treating an
   * unresolved pack as a mismatch would empty the list for the 1,016
   * model-and-OPC pairs the catalogue does not describe.
   */
  it("skips a test the vehicle has no value for", () => {
    expect(fitsVehicle(row({ startDate: 1997061 }), { classification: "GRXML6" }).fits).toBe(true);
    expect(fitsVehicle(row({ opc: "N22" }), { productionDate: 1994031 }).fits).toBe(true);
    expect(fitsVehicle(row({ classification: ["GNXVR6"] }), { productionDate: 1994031 }).fits).toBe(
      true,
    );
  });

  it("knows when there is nothing to narrow by", () => {
    expect(canNarrow({})).toBe(false);
    expect(canNarrow({ productionDate: 1994031 })).toBe(true);
    expect(canNarrow({ options: new Set() })).toBe(true);
  });
});
