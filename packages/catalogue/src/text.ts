/**
 * Text resolution.
 *
 * Nearly every human-readable string in the catalogue is an integer **text
 * serial** resolved through `Desc`, which exists once per language. That is what
 * makes the data multilingual without duplicating any structure, and it means a
 * language switch is a different `Desc` file and nothing else.
 */
import type { Language, Pnc, Ts } from "@masax/core";
import type { CsFileSystem } from "@emdzej/csfs-core";
import { Dataset } from "@masax/lex";

export class TextTable {
  private constructor(
    readonly language: Language,
    private readonly strings: Map<number, string>,
    private readonly pncTs: Map<string, number>,
  ) {}

  /**
   * Load the text for one language.
   *
   * `Desc` is 48,549 rows and about 1.3 MB, and `pnc` 28,313 rows and 368 kB,
   * so both are read in full and held. Everything else is looked up by range.
   */
  static async open(fs: CsFileSystem, dir: string, language: Language): Promise<TextTable> {
    const desc = await Dataset.open(fs, dir, "Desc", language);
    const strings = new Map<number, string>();
    for await (const { record } of desc.scan()) {
      const ts = record["A0"];
      const text = record["B0"];
      if (typeof ts === "number" && typeof text === "string") strings.set(ts, text);
    }
    await desc.close();

    const pnc = await Dataset.open(fs, dir, "pnc");
    const pncTs = new Map<string, number>();
    for await (const { record } of pnc.scan()) {
      const code = record["A0"];
      const ts = record["B0"];
      if (typeof code === "string" && typeof ts === "number") pncTs.set(code, ts);
    }
    await pnc.close();

    return new TextTable(language, strings, pncTs);
  }

  /** Resolve a text serial. Undefined rather than a placeholder when missing. */
  get(ts: Ts | undefined): string | undefined {
    return ts === undefined ? undefined : this.strings.get(ts);
  }

  /** The part name for a part name code, e.g. `05100A` -> `FUEL TANK ASSY`. */
  partName(pnc: Pnc | undefined): string | undefined {
    if (pnc === undefined) return undefined;
    return this.get(this.pncTs.get(pnc));
  }

  get size(): number {
    return this.strings.size;
  }
}
