/**
 * What an OPC means.
 *
 * A vehicle's OPC — `H70` on a Pajero — is not itself a feature. It is a key
 * into `Opc`, which holds the list of option codes that OPC stands for, and
 * each of those resolves through `OInfo` to a description:
 *
 * ```
 *   Opc(V25W, H70) -> [A28, A88, C15, ...] -> OInfo -> Desc -> "DIFF LOCK"
 * ```
 *
 * Two things about the lookup are not obvious.
 *
 * **The date window lives on the classification, not on the record.** An `Opc`
 * record carries a repeating group of (classification, year, start, end) — up
 * to 50 entries — and one flat list of option codes that applies to all of
 * them. So a `(model, opc)` pair can have several records, each covering
 * different classifications over different periods. `V25W`/`H70` has two, both
 * `GRXML6`: 1993-11 to 1994-05 with 34 options, and 1994-06 to 1995-08 with 35.
 * Picking the wrong one gives two options the vehicle does not have.
 *
 * The pair is unambiguous, and that is measured rather than assumed: across all
 * 41,030 `(model, opc)` pairs, **no two records overlap in date for the same
 * classification**. So classification and build date together select at most
 * one record.
 *
 * **The stored order is not the display order.** `Opc` writes
 * `SER, SFH, SH6, SNN, SSP, SXE, SXH, S30, S70` — letters before digits, which
 * is neither ASCII nor alphabetical. The original application shows `S30, S70`
 * first, which is plain ASCII, so the codes are sorted here. Verified against
 * the application's own output for one vehicle: 34 options, same order.
 *
 * ## What it resolves
 *
 * Measured over every distinct `(model, opc, classification, build date)` in
 * `Vin` half A — 41,919 of them:
 *
 * | Route                         | Count  |
 * | ----------------------------- | ------ |
 * | classification and build date | 38,283 |
 * | classification only           |  2,607 |
 * | the only record               |      5 |
 * | build date only               |      3 |
 * | nothing                       |  1,021 |
 *
 * **1,016 of the 1,021 have no `Opc` record for that `(model, opc)` at all**, so
 * the rule is not failing on them — the catalogue does not describe those
 * vehicles' option packs. Only 5 have records that miss, and those ask for a
 * classification and era the records do not cover: `P15V`/`S03` wants `JLZR6`
 * in 1986 against records covering `JLZL6` and `JLNL6` from 1994 on.
 *
 * 171 of the 3,083 distinct codes `Opc` uses have no `OInfo` row. That is the
 * vendor's gap rather than a lookup bug — the missing ones are absent under any
 * spelling, trimmed or padded, while `OInfo` describes 6,223 codes in total,
 * more than `Opc` ever uses. They come back with a `code` and no `name`, to be
 * shown bare rather than dropped.
 */
import type { AsaDate } from "@masax/core";
import type { CsFileSystem } from "@emdzej/csfs-core";
import { Dataset, type LexRecord } from "@masax/lex";
import type { TextTable } from "./text.js";

/** One option a vehicle carries. */
export interface VehicleOption {
  /** e.g. `A28`. */
  code: string;
  /** e.g. `VARIABLE SHOCK ABSORBER`. Undefined when `OInfo` has no row. */
  name?: string;
}

/** How the record was chosen, which the interface says out loud. */
export type OptionMatch =
  /** Classification matched and the build date fell in its window. */
  | "classification and build date"
  /** Classification matched but no window covered the build date. */
  | "classification"
  /** No classification matched; a window covered the build date. */
  | "build date"
  /** Neither matched, and there was only one record to choose. */
  | "the only record";

export interface OptionSet {
  model: string;
  opc: string;
  options: VehicleOption[];
  /** The classification the chosen record was matched on. */
  classification?: string;
  startDate?: AsaDate;
  endDate?: AsaDate;
  via: OptionMatch;
  /** Records for this `(model, opc)` that were not chosen. */
  others: number;
}

const str = (record: LexRecord, code: string): string | undefined => {
  const value = record[code];
  return typeof value === "string" && value !== "" ? value : undefined;
};
const num = (record: LexRecord, code: string): number | undefined =>
  typeof record[code] === "number" ? (record[code] as number) : undefined;

/** `.pnt` pads a text key to each field's full width. */
const MODEL_WIDTH = 7;
const OPC_WIDTH = 4;

/** One (classification, window) the record's option list applies to. */
interface Cover {
  classification?: string;
  startDate?: AsaDate;
  endDate?: AsaDate;
}

const covers = (record: LexRecord): Cover[] => {
  const group = record["B0"];
  if (!Array.isArray(group)) return [];
  return (group as Record<string, string | number>[]).map((row) => ({
    classification: typeof row["B1"] === "string" && row["B1"] ? row["B1"] : undefined,
    startDate: typeof row["B3"] === "number" ? row["B3"] : undefined,
    endDate: typeof row["B4"] === "number" ? row["B4"] : undefined,
  }));
};

const within = (date: AsaDate | undefined, cover: Cover): boolean =>
  date !== undefined &&
  (cover.startDate === undefined || date >= cover.startDate) &&
  (cover.endDate === undefined || date <= cover.endDate);

export class OptionTable {
  private constructor(
    private readonly opc: Dataset,
    /** Option code to description. 6,223 rows and 62 kB, so it is held. */
    private readonly names: Map<string, string | undefined>,
  ) {}

  /**
   * `OInfo` is held; `Opc` is not.
   *
   * `OPC.BIN` is 6.7 MB and indexed on exactly the key a lookup has —
   * `(model, opc)` — so a resolve is one bounded run read rather than a table
   * to keep in memory. `OINFO.BIN` is 62 kB and is needed for every code, so
   * holding it saves a range read per option.
   */
  static async open(fs: CsFileSystem, dir: string, text: TextTable): Promise<OptionTable> {
    const info = await Dataset.open(fs, dir, "OInfo");
    const names = new Map<string, string | undefined>();
    for await (const { record } of info.scan()) {
      const code = str(record, "A0");
      if (code) names.set(code, text.get(num(record, "B0")));
    }
    await info.close();

    const opc = await Dataset.open(fs, dir, "Opc");
    return new OptionTable(opc, names);
  }

  /** Every option code the catalogue describes, for a count in the interface. */
  get size(): number {
    return this.names.size;
  }

  /** The description of one option code. */
  name(code: string): string | undefined {
    return this.names.get(code);
  }

  /**
   * The options an OPC stands for, for one vehicle.
   *
   * `built` and `classification` are what narrow several records to one. Both
   * come from a decoded VIN, and `via` says which of them did the work so the
   * interface can be honest when it had to fall back.
   */
  async resolve(vehicle: {
    model?: string;
    opc?: string;
    classification?: string;
    productionDate?: AsaDate;
  }): Promise<OptionSet | undefined> {
    const { model, opc } = vehicle;
    if (!model || !opc) return undefined;

    const key = model.padEnd(MODEL_WIDTH) + opc.padEnd(OPC_WIDTH);
    const run = await this.opc.runFor(key, ["A0", "A1"]);
    // A run is bounded by the next index entry, which is the next `(model,
    // opc)`. Filtering anyway costs nothing and means a shifted index cannot
    // quietly return another OPC's options.
    const records = run.filter((r) => str(r, "A0") === model && str(r, "A1") === opc);
    if (records.length === 0) return undefined;

    const built = vehicle.productionDate;
    const wanted = vehicle.classification;

    let best: { record: LexRecord; cover: Cover; via: OptionMatch } | undefined;
    const rank: Record<OptionMatch, number> = {
      "classification and build date": 0,
      classification: 1,
      "build date": 2,
      "the only record": 3,
    };

    for (const record of records) {
      for (const cover of covers(record)) {
        const sameClass = wanted !== undefined && cover.classification === wanted;
        const inWindow = within(built, cover);
        let via: OptionMatch | undefined;
        if (sameClass && inWindow) via = "classification and build date";
        else if (sameClass) via = "classification";
        else if (inWindow) via = "build date";
        if (via && (!best || rank[via] < rank[best.via])) best = { record, cover, via };
      }
    }
    if (!best && records.length === 1) {
      best = { record: records[0]!, cover: covers(records[0]!)[0] ?? {}, via: "the only record" };
    }
    if (!best) return undefined;

    // Sorted: see the note at the top of this file.
    const codes = Array.isArray(best.record["C0"])
      ? [...(best.record["C0"] as (string | number)[])].map(String).filter(Boolean).sort()
      : [];

    return {
      model,
      opc,
      options: codes.map((code) => ({ code, name: this.names.get(code) })),
      classification: best.cover.classification,
      startDate: best.cover.startDate,
      endDate: best.cover.endDate,
      via: best.via,
      others: records.length - 1,
    };
  }

  async close(): Promise<void> {
    await this.opc.close();
  }
}
