import { describe, expect, it } from "vitest";
import { narrowToPlate } from "./catalogue.js";
import type { PartRow } from "./catalogue.js";
import type { Pnc } from "@masax/core";

const row = (pnc: string, partNumber: string): PartRow => ({ pnc: pnc as Pnc, partNumber });
const codes = (...list: string[]) => new Set(list as Pnc[]);

describe("narrowToPlate", () => {
  /**
   * The case this exists for. `13-010` on a V25W is three plates sharing one
   * run of 70 rows: a filler pipe and two tank-and-tube variants. Nothing in
   * `BGroup` separates them — same dates, no classification, no OPC — so the
   * drawing does.
   */
  it("splits one run between the plates that share a subgroup number", () => {
    const run = [row("05007", "MA152319"), row("05021", "MB504622"), row("05100A", "MB923920")];
    const pipe = codes("05007", "05021");
    const tank = codes("05100A");
    const claimed = codes("05007", "05021", "05100A");

    expect(narrowToPlate(run, pipe, claimed).map((r) => r.pnc)).toEqual(["05007", "05021"]);
    expect(narrowToPlate(run, tank, claimed).map((r) => r.pnc)).toEqual(["05100A"]);
  });

  it("keeps every row of a code, because a code can have several date windows", () => {
    const run = [row("05014", "MB927991"), row("05014", "MB893675"), row("05100A", "MB923920")];
    const narrowed = narrowToPlate(run, codes("05014"), codes("05014", "05100A"));
    expect(narrowed.map((r) => r.partNumber)).toEqual(["MB927991", "MB893675"]);
  });

  /**
   * 2,046 of the 735,274 subgroup codes on the media are called out by no
   * drawing of their subgroup. Hiding them would lose a real part, which is
   * worse than showing one that belongs to a sibling plate.
   */
  it("keeps a code that no drawing of the subgroup calls out", () => {
    const run = [row("05007", "MA152319"), row("11078", "MD030762")];
    const narrowed = narrowToPlate(run, codes("05007"), codes("05007", "05100A"));
    expect(narrowed.map((r) => r.pnc)).toEqual(["05007", "11078"]);
  });

  it("drops nothing when its own drawing claims everything", () => {
    const run = [row("05007", "MA152319"), row("05021", "MB504622")];
    const all = codes("05007", "05021");
    expect(narrowToPlate(run, all, all)).toHaveLength(2);
  });

  /** A callout can name a code from another model that shares the drawing. */
  it("ignores callouts that are not in the run", () => {
    const run = [row("05007", "MA152319")];
    const narrowed = narrowToPlate(run, codes("05007", "05265Z", "13 020"), codes("05007"));
    expect(narrowed.map((r) => r.pnc)).toEqual(["05007"]);
  });
});
