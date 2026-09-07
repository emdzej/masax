import { describe, expect, it } from "vitest";
import { decodeAsaDate, formatAsaDate, formatAsaDateShort } from "./index.js";

describe("YYYYMMT dates", () => {
  it("splits year, month and third of month", () => {
    expect(decodeAsaDate(1983011)).toEqual({ year: 1983, month: 1, third: 1 });
    expect(decodeAsaDate(1991061)).toEqual({ year: 1991, month: 6, third: 1 });
    expect(decodeAsaDate(2000043)).toEqual({ year: 2000, month: 4, third: 3 });
  });

  it("rejects values that are not dates", () => {
    expect(decodeAsaDate(0)).toBeUndefined();
    expect(decodeAsaDate(undefined)).toBeUndefined();
    // Only 1, 2 and 3 ever appear in the last position across the whole media.
    expect(decodeAsaDate(1983015)).toBeUndefined();
    expect(decodeAsaDate(1983991)).toBeUndefined();
    expect(decodeAsaDate(31290)).toBeUndefined();
  });

  it("formats both ways", () => {
    expect(formatAsaDate(1983011)).toBe("1983-01 (early)");
    expect(formatAsaDate(2000043)).toBe("2000-04 (late)");
    expect(formatAsaDateShort(1983013)).toBe("1983-01·3");
    expect(formatAsaDateShort(undefined)).toBe("");
  });
});
