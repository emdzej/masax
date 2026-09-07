import { describe, expect, it } from "vitest";
import { FieldType, StorageClass, parseFdt } from "./fdt.js";
import { bitmap, buildFdt } from "./fixture.js";
import { decodeRecord } from "./record.js";
import { toLatin1 } from "./text.js";

const ascii = (text: string) => [...toLatin1(text)];

describe("dense records", () => {
  it("reads fields in order with no bitmap", () => {
    const fdt = parseFdt(
      buildFdt({
        fields: [
          { code: "A0", width: 4, type: FieldType.Int },
          { code: "A1", width: 1, type: FieldType.FixStr },
          { code: "B0", width: 60, type: FieldType.VarStr },
        ],
        keys: ["A0"],
        binTemplate: "Desc_@.bin",
        pntTemplate: "Desc_@.pnt",
        sparse: false,
      }),
    );
    // This is the shape of a real Desc record: TS, a flag, then the text.
    const body = new Uint8Array([1, 0, 0, 0, 0x20, 12, ...ascii("(-'88 MODEL)")]);
    const { record, used } = decodeRecord(body, fdt);
    expect(record).toEqual({ A0: 1, A1: "", B0: "(-'88 MODEL)" });
    expect(used).toBe(body.length);
  });
});

describe("the presence bitmap", () => {
  const fdt = parseFdt(
    buildFdt({
      fields: [
        { code: "A0", width: 17, type: FieldType.VarStr },
        { code: "B0", width: 4, type: FieldType.Int },
        { code: "B1", width: 7, type: FieldType.VarStr },
      ],
      keys: ["A0"],
      binTemplate: "PBook.bin",
      pntTemplate: "PBook.pnt",
      sparse: true,
    }),
  );

  it("skips absent fields", () => {
    const body = new Uint8Array([...bitmap([0, 2], 1), 5, ...ascii("00380"), 3, ...ascii("803")]);
    const { record, used } = decodeRecord(body, fdt);
    expect(record).toEqual({ A0: "00380", B1: "803" });
    expect(used).toBe(body.length);
  });

  it("treats fields past a short bitmap as absent", () => {
    // A one-byte bitmap covers only eight fields. Real catalogue records do
    // this — `01090` ships one byte for thirteen fields — and assuming
    // ceil(n/8) bytes throws on them.
    const wide = parseFdt(
      buildFdt({
        fields: Array.from({ length: 12 }, (_, i) => ({
          code: `A${i.toString(36)}`,
          width: 4,
          type: FieldType.Int,
        })),
        keys: ["A0"],
        binTemplate: "x.bin",
        pntTemplate: "x.pnt",
        sparse: true,
      }),
    );
    const body = new Uint8Array([...bitmap([0], 1), 7, 0, 0, 0]);
    const { record, used } = decodeRecord(body, wide);
    expect(record).toEqual({ A0: 7 });
    expect(used).toBe(body.length);
  });
});

describe("arrays and groups", () => {
  it("reads an array16 count as two bytes", () => {
    // catalog.E3 (ApplicableCodes) holds up to 1000 entries and writes its
    // count as a uint16. Reading one byte eats the low half, invents an empty
    // first element and leaves the record one element short.
    const fdt = parseFdt(
      buildFdt({
        fields: [
          {
            code: "E3",
            width: 7,
            type: FieldType.VarStr,
            storage: StorageClass.Array16,
            maxRepeat: 1000,
          },
        ],
        keys: ["E3"],
        binTemplate: "@.bin",
        pntTemplate: "@.pnt",
        sparse: false,
      }),
    );
    const body = new Uint8Array([2, 0, 7, ...ascii("HAX 31H"), 7, ...ascii("HAX 31U")]);
    const { record, used } = decodeRecord(body, fdt);
    expect(record).toEqual({ E3: ["HAX 31H", "HAX 31U"] });
    expect(used).toBe(body.length);
  });

  it("does not treat maxRepeat alone as an array", () => {
    // DudMMC.A0 has maxRepeat=4 and is a plain integer. Only the storage class
    // decides, and getting this wrong breaks that one dataset while every
    // other still passes.
    const fdt = parseFdt(
      buildFdt({
        fields: [
          {
            code: "A0",
            width: 4,
            type: FieldType.Int,
            storage: StorageClass.Scalar,
            maxRepeat: 4,
          },
        ],
        keys: ["A0"],
        binTemplate: "DudMMC@.bin",
        pntTemplate: "DudMMC@.pnt",
        sparse: false,
      }),
    );
    const { record, used } = decodeRecord(new Uint8Array([9, 0, 0, 0]), fdt);
    expect(record).toEqual({ A0: 9 });
    expect(used).toBe(4);
  });

  it("nests group children under their header and counts rows", () => {
    const fdt = parseFdt(
      buildFdt({
        fields: [
          { code: "A0", width: 17, type: FieldType.VarStr },
          {
            code: "B1",
            width: 1,
            type: FieldType.GroupB,
            storage: StorageClass.Group,
            maxRepeat: 2,
          },
          { code: "B2", width: 17, type: FieldType.VarStr },
          { code: "B3", width: 1, type: FieldType.FixStr },
        ],
        keys: ["A0"],
        binTemplate: "rep.bin",
        pntTemplate: "rep.pnt",
        sparse: false,
      }),
    );
    expect(fdt.topCount).toBe(2);
    expect(fdt.tree.map((f) => f.code)).toEqual(["A0", "B1"]);
    expect(fdt.tree[1]!.children.map((f) => f.code)).toEqual(["B2", "B3"]);

    const body = new Uint8Array([
      3,
      ...ascii("A01"),
      2,
      5,
      ...ascii("MB100"),
      0x41,
      5,
      ...ascii("MB200"),
      0x42,
    ]);
    const { record, used } = decodeRecord(body, fdt);
    expect(record).toEqual({
      A0: "A01",
      B1: [
        { B2: "MB100", B3: "A" },
        { B2: "MB200", B3: "B" },
      ],
    });
    expect(used).toBe(body.length);
  });
});

describe("integers", () => {
  it("reads both integer types little-endian", () => {
    // Big-endian turns subgroup 10 into 2560 — a value that looks like data,
    // parses fine, and is wrong.
    const fdt = parseFdt(
      buildFdt({
        fields: [
          { code: "B2", width: 2, type: FieldType.Uint },
          { code: "C1", width: 4, type: FieldType.Int },
        ],
        keys: ["B2"],
        binTemplate: "@.bin",
        pntTemplate: "@.pnt",
        sparse: false,
      }),
    );
    const { record } = decodeRecord(new Uint8Array([10, 0, 0x81, 0x98, 0x1e, 0x00]), fdt);
    expect(record["B2"]).toBe(10);
    expect(record["C1"]).toBe(2005121);
  });

  it("sign-extends a negative signed integer", () => {
    const fdt = parseFdt(
      buildFdt({
        fields: [{ code: "A0", width: 4, type: FieldType.Int }],
        keys: ["A0"],
        binTemplate: "x.bin",
        pntTemplate: "x.pnt",
        sparse: false,
      }),
    );
    const { record } = decodeRecord(new Uint8Array([0xff, 0xff, 0xff, 0xff]), fdt);
    expect(record["A0"]).toBe(-1);
  });
});

describe("runs and inheritance", () => {
  // The .pnt index points at the first record of a run; later records omit the
  // fields that have not changed. Reading them without inheriting leaves a
  // part with no PNC and no model.
  const fdt = parseFdt(
    buildFdt({
      fields: [
        { code: "A1", width: 7, type: FieldType.VarStr, label: "PNC" },
        { code: "A2", width: 7, type: FieldType.VarStr, label: "Model" },
        { code: "D1", width: 17, type: FieldType.VarStr, label: "PartNumber" },
        { code: "E1", width: 4, type: FieldType.FixStr, label: "OPC" },
      ],
      keys: ["A1"],
      binTemplate: "@.bin",
      pntTemplate: "@.pnt",
      sparse: true,
    }),
  );

  /** Apply the inheritance rule the way `Dataset.scan` does. */
  function scan(bodies: Uint8Array[], inherit: string[]) {
    const carry: Record<string, unknown> = {};
    return bodies.map((body) => {
      const { record } = decodeRecord(body, fdt);
      for (const code of inherit) {
        if (record[code] !== undefined) carry[code] = record[code];
        else if (carry[code] !== undefined) record[code] = carry[code] as never;
      }
      return { ...record };
    });
  }

  const runStart = new Uint8Array([
    ...bitmap([0, 1, 2], 1),
    6,
    ...ascii("05100A"),
    5,
    ...ascii("L042G"),
    8,
    ...ascii("MB247182"),
  ]);
  // A continuation: part number only, and its own OPC.
  const continuation = new Uint8Array([
    ...bitmap([2, 3], 1),
    8,
    ...ascii("MB554417"),
    ...ascii("A50 "),
  ]);

  it("carries the run key forward but not per-record fields", () => {
    const rows = scan([runStart, continuation], ["A1", "A2"]);
    expect(rows[0]).toEqual({ A1: "05100A", A2: "L042G", D1: "MB247182" });
    expect(rows[1]).toEqual({ A1: "05100A", A2: "L042G", D1: "MB554417", E1: "A50" });
  });

  it("leaves a continuation unusable without inheritance", () => {
    const rows = scan([runStart, continuation], []);
    expect(rows[1]!["A1"]).toBeUndefined();
    expect(rows[1]!["A2"]).toBeUndefined();
  });

  it("does not invent an OPC for a part that has none", () => {
    // Inheriting every absent field would give the third record the second's
    // OPC. On one real plate that turns 1 option-restricted part into 42, and
    // the result is a part shown as fitting a vehicle it does not.
    const noOpc = new Uint8Array([...bitmap([2], 1), 8, ...ascii("MB554422")]);
    const wrong = scan([runStart, continuation, noOpc], ["A1", "A2", "D1", "E1"]);
    expect(wrong[2]!["E1"]).toBe("A50");

    const right = scan([runStart, continuation, noOpc], ["A1", "A2"]);
    expect(right[2]!["E1"]).toBeUndefined();
    expect(right[2]!["A1"]).toBe("05100A");
  });
});
