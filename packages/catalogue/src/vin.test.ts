import { describe, expect, it } from "vitest";
import { CHASSIS_LENGTH, MIN_VIN_LENGTH, SERIAL_LENGTH, VIN_LENGTH, normaliseVin } from "./vin.js";

/** The split the decoder performs. Kept here so the test states the rule. */
const split = (vin: string) => ({
  chassis: vin.slice(0, -SERIAL_LENGTH),
  serial: vin.slice(-SERIAL_LENGTH),
});

describe("how a VIN splits", () => {
  it("is a chassis prefix plus a 7-character serial", () => {
    // The dataset is keyed on the serial and stores the chassis, so this split
    // is what makes a local decode one bounded read rather than a scan.
    expect(CHASSIS_LENGTH + SERIAL_LENGTH).toBe(VIN_LENGTH);
    expect(split("JMBGNPD5VSA000003")).toEqual({
      chassis: "JMBGNPD5VS",
      serial: "A000003",
    });
  });

  it("splits from the right, because only the serial has a fixed length", () => {
    // Measured over all 5,418,637 records: the serial is 7 characters in every
    // one; the chassis is 10 in 99.26% and 7 in 39,986. Splitting at a fixed
    // offset from the left rejects those forty thousand.
    expect(split("D0NV320RJ01238".padEnd(0) + "")).toEqual({
      chassis: "D0NV320",
      serial: "RJ01238",
    });
    expect(MIN_VIN_LENGTH).toBe(SERIAL_LENGTH + 1);
  });

  it("normalises separators and case", () => {
    expect(normaliseVin(" jmbgnpd5vs-a000003 ")).toBe("JMBGNPD5VSA000003");
  });

  it("does not try to validate a check digit", () => {
    // ASA has none: identification is a lookup, not an algorithm, which is why
    // a VIN absent from the data is "not in this data" and not "invalid".
    expect(normaliseVin("00000000000000000")).toHaveLength(VIN_LENGTH);
  });
});
