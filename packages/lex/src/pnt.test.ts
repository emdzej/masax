import { describe, expect, it } from "vitest";
import { FieldType, parseFdt } from "./fdt.js";
import { buildFdt } from "./fixture.js";
import { PntIndex } from "./pnt.js";
import { toLatin1 } from "./text.js";

function intIndex(keys: number[]): PntIndex {
  const fdt = parseFdt(
    buildFdt({
      fields: [
        { code: "A0", width: 4, type: FieldType.Int },
        { code: "B0", width: 60, type: FieldType.VarStr },
      ],
      keys: ["A0"],
      binTemplate: "Desc_@.bin",
      pntTemplate: "Desc_@.pnt",
      sparse: false,
    }),
  );
  const bytes = new Uint8Array(keys.length * 8);
  const view = new DataView(bytes.buffer);
  keys.forEach((key, i) => {
    view.setUint32(i * 8, key, true);
    view.setUint32(i * 8 + 4, key * 100, true);
  });
  return new PntIndex(bytes, fdt);
}

function textIndex(keys: string[]): PntIndex {
  const fdt = parseFdt(
    buildFdt({
      fields: [
        { code: "A0", width: 7, type: FieldType.FixStr },
        { code: "B0", width: 4, type: FieldType.Int },
      ],
      keys: ["A0"],
      binTemplate: "pnc.bin",
      pntTemplate: "pnc.pnt",
      sparse: false,
    }),
  );
  const bytes = new Uint8Array(keys.length * 11).fill(0x20);
  const view = new DataView(bytes.buffer);
  keys.forEach((key, i) => {
    bytes.set(toLatin1(key.padEnd(7).slice(0, 7)), i * 11);
    view.setUint32(i * 11 + 7, i, true);
  });
  return new PntIndex(bytes, fdt);
}

describe("integer keys", () => {
  // A four-byte integer key is stored little-endian, so comparing the raw
  // bytes is not comparing the numbers. It agrees for keys 0..255 and diverges
  // the moment one crosses a byte boundary — so a spot check near the start of
  // a dense index proves nothing. Every integer-keyed dataset here (Desc,
  // OInfo, pnc_desc, DudMMC, MsgUpd) is dense from 1, which is exactly the
  // shape that hides the bug.
  const keys = [1, 2, 3, 255, 256, 257, 1000, 65535, 65536, 1_000_000];

  it("finds every key", () => {
    const index = intIndex(keys);
    expect(index.count).toBe(keys.length);
    for (const key of keys) {
      const at = index.find(key);
      expect(at, `key ${key}`).toBeGreaterThanOrEqual(0);
      expect(index.keyAt(at)).toBe(key);
    }
  });

  it("finds keys whose little-endian bytes sort differently from their values", () => {
    const index = intIndex(keys);
    // Bytewise: 256 is 00 01 00 00 and 2 is 02 00 00 00, so 256 would compare
    // less than 2 and the search would walk the wrong half.
    expect(index.keyAt(index.find(256))).toBe(256);
    expect(index.keyAt(index.find(65536))).toBe(65536);
    expect(index.keyAt(index.find(1_000_000))).toBe(1_000_000);
  });

  it("reports a missing key rather than a neighbour", () => {
    const index = intIndex(keys);
    expect(index.find(4)).toBe(-1);
    expect(index.find(0)).toBe(-1);
    expect(index.find(2_000_000)).toBe(-1);
  });

  it("agrees that the index is sorted", () => {
    expect(intIndex(keys).checkSorted()).toEqual({ ok: true });
  });

  it("notices an index that is not sorted", () => {
    expect(intIndex([3, 1, 2]).checkSorted().ok).toBe(false);
  });
});

describe("text keys", () => {
  const keys = ["01000A", "01005A", "01010A", "01070", "05100A", "ZZ999"];

  it("finds every key, padded or not", () => {
    const index = textIndex(keys);
    expect(index.entrySize).toBe(11);
    for (const key of keys) {
      expect(index.keyAt(index.find(key)), key).toBe(key);
    }
  });

  it("does not confuse a prefix with the padded key", () => {
    const index = textIndex(keys);
    // "01000A" is stored as "01000A " — a lookup of "01000" must miss, because
    // it would be "01000  " and no such entry exists.
    expect(index.find("01000")).toBe(-1);
    expect(index.keyAt(index.find("01070"))).toBe("01070");
  });

  it("returns the offset stored beside the key", () => {
    const index = textIndex(keys);
    expect(index.offsetAt(index.find("01010A"))).toBe(2);
  });
});
