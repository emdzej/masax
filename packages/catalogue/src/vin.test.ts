import { describe, expect, it } from "vitest";
import { CHASSIS_LENGTH, SERIAL_LENGTH, VIN_LENGTH, normaliseVin } from "./vin.js";

describe("how a VIN splits", () => {
  it("is a 10-character chassis prefix plus a 7-character serial", () => {
    // The dataset is keyed on the serial and stores the chassis, so this split
    // is what makes a local decode one bounded read rather than a scan.
    expect(CHASSIS_LENGTH + SERIAL_LENGTH).toBe(VIN_LENGTH);
    const vin = "JMBGNPD5VSA000003";
    expect(vin.length).toBe(VIN_LENGTH);
    expect(vin.slice(0, CHASSIS_LENGTH)).toBe("JMBGNPD5VS");
    expect(vin.slice(CHASSIS_LENGTH)).toBe("A000003");
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
