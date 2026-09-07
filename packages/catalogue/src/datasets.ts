/**
 * What datasets an installation has, and where.
 *
 * The tree is not self-describing: nothing lists the datasets, so this is the
 * inventory. It is derived from the `.ddm` files present on the European media
 * and is checked by `masax verify`, which reports anything on disk it did not
 * expect.
 */

/** How the `@` in a dataset's filename template is filled. */
export type VariantKind =
  /** No `@`: one file. */
  | "none"
  /** A language code — `Desc_@.bin` becomes `DESC_GB.BIN`. */
  | "language"
  /** A catalogue id — `@.bin` becomes `B6037609A.bin`. */
  | "catalogue";

export interface DatasetSpec {
  /** The `.ddm` basename, and the name used on the command line. */
  name: string;
  variant: VariantKind;
  /** What it holds, for `--schema` output and the interface. */
  role: string;
  /**
   * True when an installation may legitimately not have the data files.
   * `Price`, `SMO`, `Sec` and `ExtPrice` ship a schema and no `.bin` on the
   * European media — the modules that would fill them are not licensed.
   */
  optional?: boolean;
}

/** Datasets directly under `EPC/DATA<n>`. */
export const CATALOGUE_DATASETS: readonly DatasetSpec[] = [
  { name: "CInfo", variant: "none", role: "catalogue id to model name and data package" },
  { name: "catalog", variant: "catalogue", role: "the parts table, one file per catalogue" },
  { name: "MGroup", variant: "none", role: "model to main group, with the index illustration" },
  { name: "SGroup", variant: "none", role: "subgroups" },
  { name: "BGroup", variant: "none", role: "plates, with the drawing reference" },
  { name: "PBook", variant: "none", role: "part master: maker, supersession, colour, material" },
  { name: "pnc", variant: "none", role: "part name code to text serial" },
  { name: "pnc_desc", variant: "none", role: "part name code descriptions" },
  { name: "Desc", variant: "language", role: "all display text, one file per language" },
  { name: "Opc", variant: "none", role: "option and spec codes per model" },
  { name: "OpcMod", variant: "none", role: "option codes by model" },
  { name: "OInfo", variant: "none", role: "option descriptions" },
  { name: "VInfo", variant: "none", role: "vehicle name code to model and catalogue" },
  { name: "rep", variant: "none", role: "supersession chains, previous and next" },
  { name: "SSP", variant: "none", role: "secondary service part numbers" },
  { name: "SPN", variant: "language", role: "service parts news" },
  { name: "ASP", variant: "none", role: "publications" },
  { name: "Price", variant: "none", role: "part prices", optional: true },
  { name: "SMO", variant: "none", role: "supersession memo", optional: true },
];

/** Datasets under `EPC/DATA<n>/A` and `.../B` — the two index halves. */
export const HALF_DATASETS: readonly DatasetSpec[] = [
  { name: "Vin", variant: "none", role: "serial to model, OPC, paint, trim, production date" },
  { name: "PREF", variant: "none", role: "part number to part name code and catalogue" },
  { name: "Sec", variant: "none", role: "serial to catalogue number", optional: true },
];

/** Datasets that live with the application rather than the data. */
export const PROGRAM_DATASETS: readonly DatasetSpec[] = [
  { name: "DudMMC", variant: "language", role: "interface word index" },
  { name: "MsgUpd", variant: "language", role: "update messages" },
  { name: "ExtPrice", variant: "none", role: "externally supplied prices", optional: true },
];

export interface DatasetLocation extends DatasetSpec {
  /** Directory relative to the module root, e.g. `EPC/DATA1`. */
  dir: string;
}

/**
 * Every dataset an installation could have, with its directory.
 *
 * `generation` selects `DATA1` or `DATA2`. Both hold a complete dataset:
 * `DATA1` is what the discs carry and `DATA2` is a delta-updated copy, so
 * either can be read on its own.
 */
export function datasetLocations(generation: 1 | 2 = 1): DatasetLocation[] {
  const data = `EPC/DATA${generation}`;
  return [
    ...CATALOGUE_DATASETS.map((d) => ({ ...d, dir: data })),
    ...HALF_DATASETS.flatMap((d) => [
      { ...d, dir: `${data}/A` },
      { ...d, dir: `${data}/B` },
    ]),
    ...PROGRAM_DATASETS.map((d) => ({ ...d, dir: "PROG" })),
  ];
}
