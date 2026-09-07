/**
 * The catalogue read path: catalogue -> model -> main group -> subgroup ->
 * plate and its parts.
 *
 * Sizing decides the shape here. The navigation tables are small enough to
 * hold whole — `MGroup` 93 kB, `SGroup` 1.1 MB, `BGroup` 2.4 MB — and so is a
 * language's text. A catalogue's parts table is 0.3 to 28 MB, so it is fetched
 * once per catalogue and indexed in memory; the alternative would be a range
 * read per run, and the index is keyed by part-name code only, which does not
 * answer "what is on this plate".
 *
 * `Vin` and `PBook` are the two that are never held: 76 MB and 79 MB for the
 * VIN halves, reached by bounded run reads instead.
 */
import type { AsaDate, CatalogueId, Language, Pnc, PartNumber } from "@masax/core";
import { Dataset, type LexRecord, type Source } from "@masax/lex";
import { TextTable } from "./text.js";
import { VinIndex } from "./vin.js";
import { CATALOGUE_DATASETS } from "./datasets.js";

const runKeyOf = (name: string): readonly string[] =>
  CATALOGUE_DATASETS.find((d) => d.name === name)?.runKey ?? [];

const text = (record: LexRecord, code: string): string | undefined => {
  const value = record[code];
  return typeof value === "string" && value !== "" ? value : undefined;
};
const int = (record: LexRecord, code: string): number | undefined => {
  const value = record[code];
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};
const list = (record: LexRecord, code: string): string[] | undefined => {
  const value = record[code];
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((v): v is string => typeof v === "string" && v !== "");
  return out.length > 0 ? out : undefined;
};

export interface CatalogueInfo {
  id: CatalogueId;
  /** Model family, e.g. `L200(EUR)`. */
  name?: string;
  version?: string;
  type?: string;
  dataPackage?: string;
  startDate?: AsaDate;
  endDate?: AsaDate;
}

export interface GroupRef {
  mainGroup: number;
  /** Present for a subgroup or plate, absent for a main group. */
  subGroup?: number;
  name?: string;
  /** The qualifier line, e.g. `ALL` or `CANVAS,METAL TOP..EXC.COIL SUSP MODEL`. */
  note?: string;
  /** Drawing basename; the first three characters are its subdirectory. */
  illustration?: string;
  startDate?: AsaDate;
  endDate?: AsaDate;
  classification?: string[];
  opc?: string[];
}

export interface PartRow {
  pnc: Pnc;
  /** The part name from `pnc` -> `Desc`, e.g. `FUEL TANK ASSY`. */
  name?: string;
  model?: string;
  mainGroup?: number;
  subGroup?: number;
  partNumber?: PartNumber;
  quantity?: string;
  supplyCondition?: string;
  startDate?: AsaDate;
  endDate?: AsaDate;
  /** Applicability. Per record — never inherited from the row above. */
  opc?: string;
  classification?: string[];
  applicableCodes?: string[];
  /** The feature or qualifier line, resolved through `Desc`. */
  feature?: string;
}

export interface OpenOptions {
  generation?: 1 | 2;
  language?: Language;
}

export class AsaCatalogue {
  private readonly partsCache = new Map<CatalogueId, PartRow[]>();

  private constructor(
    private readonly source: Source,
    readonly dataDir: string,
    readonly text: TextTable,
    readonly vin: VinIndex,
    private readonly info: CatalogueInfo[],
    private readonly mainGroups: LexRecord[],
    private readonly subGroups: LexRecord[],
    private readonly plates: LexRecord[],
  ) {}

  static async open(source: Source, options: OpenOptions = {}): Promise<AsaCatalogue> {
    const dataDir = `EPC/DATA${options.generation ?? 1}`;
    const language = options.language ?? "GB";

    const textTable = await TextTable.open(source, dataDir, language);
    const vin = await VinIndex.open(source, dataDir);

    const cinfo = await Dataset.open(source, dataDir, "CInfo");
    const info: CatalogueInfo[] = [];
    for await (const { record } of cinfo.scan(runKeyOf("CInfo"))) {
      const id = text(record, "A0");
      if (!id) continue;
      info.push({
        id,
        version: text(record, "A1"),
        name: textTable.get(int(record, "A2")),
        type: text(record, "A4"),
        startDate: int(record, "A5"),
        endDate: int(record, "A6"),
        dataPackage: text(record, "A7"),
      });
    }
    await cinfo.close();

    const load = async (name: string) => {
      const dataset = await Dataset.open(source, dataDir, name);
      const rows: LexRecord[] = [];
      for await (const { record } of dataset.scan(runKeyOf(name))) rows.push(record);
      await dataset.close();
      return rows;
    };

    return new AsaCatalogue(
      source,
      dataDir,
      textTable,
      vin,
      info,
      await load("MGroup"),
      await load("SGroup"),
      await load("BGroup"),
    );
  }

  catalogues(): CatalogueInfo[] {
    return this.info;
  }

  catalogue(id: CatalogueId): CatalogueInfo | undefined {
    return this.info.find((c) => c.id === id);
  }

  /** Models a catalogue covers, from the plate table. */
  models(id: CatalogueId): string[] {
    const seen = new Set<string>();
    for (const record of this.plates) {
      if (text(record, "A0") === id) {
        const model = text(record, "A1");
        if (model) seen.add(model);
      }
    }
    return [...seen].sort();
  }

  private toGroup(record: LexRecord, withSubGroup: boolean): GroupRef {
    return {
      mainGroup: int(record, "A2") ?? 0,
      subGroup: withSubGroup ? int(record, "A3") : undefined,
      name: this.text.get(int(record, "A6")),
      note: this.text.get(int(record, "A7")),
      illustration: text(record, "A8"),
      startDate: int(record, "A4"),
      endDate: int(record, "A5"),
      classification: list(record, "A9"),
      opc: list(record, "B0"),
    };
  }

  /** Main groups for a model — the top level of the catalogue tree. */
  mainGroupsFor(id: CatalogueId, model: string): GroupRef[] {
    const out: GroupRef[] = [];
    const seen = new Set<number>();
    for (const record of this.mainGroups) {
      if (text(record, "A0") !== id || text(record, "A1") !== model) continue;
      const group = this.toGroup(record, false);
      if (seen.has(group.mainGroup)) continue;
      seen.add(group.mainGroup);
      out.push(group);
    }
    return out.sort((a, b) => a.mainGroup - b.mainGroup);
  }

  /** Subgroups within a main group. These carry the `K` index illustrations. */
  subGroupsFor(id: CatalogueId, model: string, mainGroup: number): GroupRef[] {
    const out: GroupRef[] = [];
    for (const record of this.subGroups) {
      if (text(record, "A0") !== id || text(record, "A1") !== model) continue;
      if ((int(record, "A2") ?? -1) !== mainGroup) continue;
      out.push(this.toGroup(record, true));
    }
    return out.sort((a, b) => (a.subGroup ?? 0) - (b.subGroup ?? 0));
  }

  /**
   * Plates for a main group — the drawings with the parts on them.
   *
   * `BGroup` carries the `T` plate drawings, `SGroup` the `K` subgroup index
   * pages, so these are different levels of the same tree rather than
   * duplicates.
   */
  platesFor(id: CatalogueId, model: string, mainGroup: number): GroupRef[] {
    const out: GroupRef[] = [];
    for (const record of this.plates) {
      if (text(record, "A0") !== id || text(record, "A1") !== model) continue;
      if ((int(record, "A2") ?? -1) !== mainGroup) continue;
      out.push(this.toGroup(record, true));
    }
    return out.sort((a, b) => (a.subGroup ?? 0) - (b.subGroup ?? 0));
  }

  /** Load and cache a catalogue's parts table. */
  private async partsTable(id: CatalogueId): Promise<PartRow[]> {
    const cached = this.partsCache.get(id);
    if (cached) return cached;

    const dataset = await Dataset.open(this.source, this.dataDir, "catalog", id);
    const rows: PartRow[] = [];
    for await (const { record } of dataset.scan(runKeyOf("catalog"))) {
      const pnc = text(record, "A1");
      if (!pnc) continue;
      rows.push({
        pnc,
        name: this.text.partName(pnc),
        model: text(record, "A2"),
        mainGroup: int(record, "B1"),
        subGroup: int(record, "B2"),
        partNumber: text(record, "D1"),
        quantity: text(record, "D2"),
        supplyCondition: text(record, "D3"),
        startDate: int(record, "C1"),
        endDate: int(record, "C2"),
        opc: text(record, "E1"),
        classification: list(record, "E2"),
        applicableCodes: list(record, "E3"),
        feature: this.text.get(int(record, "F1")),
      });
    }
    await dataset.close();
    this.partsCache.set(id, rows);
    return rows;
  }

  /**
   * Every part on one plate.
   *
   * No applicability filtering is applied. The fields that would drive it —
   * `opc`, `classification`, `applicableCodes` and the date window — are
   * returned as the data holds them, because how ASA combines them has not been
   * established here, and guessing would put parts on vehicles they do not fit.
   */
  async partsFor(
    id: CatalogueId,
    model: string,
    mainGroup: number,
    subGroup: number,
  ): Promise<PartRow[]> {
    const table = await this.partsTable(id);
    return table.filter(
      (row) => row.model === model && row.mainGroup === mainGroup && row.subGroup === subGroup,
    );
  }

  /** Every part in a catalogue whose part number matches, for search. */
  async findPartNumber(id: CatalogueId, partNumber: PartNumber): Promise<PartRow[]> {
    const wanted = partNumber.toUpperCase();
    return (await this.partsTable(id)).filter((row) => row.partNumber?.toUpperCase() === wanted);
  }

  async close(): Promise<void> {
    await this.vin.close();
  }
}
