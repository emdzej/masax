# The ASA data format

Mitsubishi's After Sales Application (ASA) is an electronic parts catalogue
built by **LexCom Informationssysteme** (Munich). The data engine is theirs, not
Mitsubishi's — `LexDdm.dll`, `fdtpdll.dll`, volume labels like `LexASAM60`. The
same engine shows up in other OEM catalogues, so this document describes the
*LexCom* format, with Mitsubishi's schema as the worked example.

Everything below is validated by `re/tools/verify.py`, which decodes every
record of every dataset and asserts each one consumes exactly its declared
payload length. Current status: **1,889,570 / 1,889,570 records on the original
media, 3,854,258 / 3,854,258 on a fully updated installation — 100%.**

## Layout of an installation

```
ASA/
  ASAMAIN.ini              per-module config (M60 Europe, M00/M50/M80 others)
  M60/                     one module = one market/product line
    PROG/                  the application, its DLLs, print forms, help
    EPC/DATA1/             catalogue data as shipped on the discs
    EPC/DATA2/             the same data after delta updates were applied
    ILLUST/<bucket>/       parts drawings, one per plate (obfuscated TIFF)
    UPDATE/, Updates/      delta update staging
    Users/                 baskets, memos, per-user settings
```

`DATA1` is byte-identical to the discs; `DATA2` is the updated copy. Both hold a
complete, independently readable dataset.

## A dataset is four files

Every table is a quadruple sharing one base name:

| File | Role |
|---|---|
| `.ddm` | INI text: the field list, with human-readable comments |
| `.fdt` | binary field definition table: schema plus record layout |
| `.bin` | the records |
| `.pnt` | the index — sorted key → byte offset |

The `.bin` and `.pnt` names come from the `.fdt`, not from the `.ddm` name, and
they may contain `@` — a placeholder for a **language code** (`D F GB I J NL P E
USA`) or for a **catalogue id**. So `Desc_@.bin` expands to `DESC_GB.BIN`, and
`catalog`'s template is just `@.bin`, expanding to `B6037609A.bin` and 51 others.

Filenames mix case freely: `PNC.BIN` sits beside `pnc.pnt`. Resolve
case-insensitively.

### `.ddm` — the field list

```ini
[FILE1]
fdt=catalog.fdt

[DDF]
cnt=13
1=A1,S  ;PNC
2=A2,S  ;Model
3=B1,I  ;MainGroup
...
```

Field codes are a letter plus a digit. The **letter groups related fields** and
matters for the record layout; the comments are the only real field names in the
format, so keep them. `S` is text, `I` an integer. Where the `.fdt` labels and
the `.ddm` comments disagree, the `.ddm` is the better name.

### `.fdt` — the schema

All little-endian.

| Offset | Type | Meaning |
|---|---|---|
| `0x00` | u16 | magic, always `0x36` |
| `0x02` | u16 | **top-level** field count |
| `0x04` | u16 | **total** field count, including group children |
| `0x06` | u16 | label count |
| `0x08` | char[13] | `.bin` filename template, NUL-terminated |
| `0x15` | char[13] | `.pnt` filename template |
| `0x22` | u16 | max unpacked record length |
| `0x26` | u16 | **record encoding: `9` = sparse, anything else = dense** |
| `0x2a` | u16 | key field count |
| `0x2c` | char[3]× | key field codes, then zero padding |
| `0x38` | | field descriptors, 13 bytes each |
| then | | record layout table |
| then | | field labels: u16 length (incl NUL) + bytes |

The 13-byte padding of the two filename templates is *stale, uninitialised
bytes*, not zeros — `catalog.fdt` holds `"@.bin\0" + "g.bin\0"`, left over from
a longer previous name. Always cut at the first NUL.

A **field descriptor** is:

```c
char code[3];       // "A1", NUL-terminated
uint16 width;       // characters, or bytes for an integer
uint16 max_repeat;  // capacity of an array; 0 if not an array
uint16 storage;     // storage class, see below
uint16 unknown;     // 2 or 4 on group headers, 0 otherwise
uint16 type;        // storage type, see below
```

Storage types:

| `type` | Meaning |
|---|---|
| `0x12` | fixed-width text, space padded to `width` |
| `0x14` | unsigned integer, `width` bytes, little-endian |
| `0x16` | signed integer, `width` bytes, little-endian |
| `0x22` | variable text: one length byte, then that many bytes |
| `0x0a`, `0x1a` | repeating **group** header |

Storage classes:

| `storage` | Meaning |
|---|---|
| `1` | group header |
| `2` | array, **u8** element count |
| `3` | plain scalar |
| `4` | array, **u16** element count |

**`max_repeat` alone does not mean the field repeats.** `DudMMC.A0` has
`max_repeat=4` and is a plain 4-byte integer. Only `storage` decides. Getting
this wrong silently mis-parses that dataset while every other one still passes.

**The element count width follows `storage`, not the capacity.**
`catalog.E3` (`ApplicableCodes`, capacity 1000, storage 4) stores its count as
`0c 00` — a u16. Reading a u8 there consumes the low byte, yields a phantom
empty first element, and leaves the record exactly one element short. It cost
2–8% of catalogue records and nothing else in the format notices.

A **group header** owns every following field sharing its letter. `rep.fdt`
declares 5 top-level fields where the `.ddm` lists 7: `B1` ("Previous Group") is
a group header owning `B2`/`B3`, and `C1` owns `C2`/`C3`. Group children get no
bit in the presence bitmap.

The **record layout table** is a u16 byte size (always `8 × total_fields`) then
one entry per field: `u16 offset, u16 width, u16 type, u16 index`. The offsets
describe the *unpacked* buffer the engine reads a record into, not the file. You
do not need it to read `.bin`; its size is a good self check.

### `.pnt` — the index

Fixed-size entries, sorted by key:

```
key bytes (sum of the key fields' widths) || uint32 offset into .bin
```

So 8 bytes for a 4-byte integer key, 11 for a 7-character PNC, 21 for a
17-character part number. A **variable-text key is space padded to its full
width here**, even though `.bin` stores it length-prefixed. Record count is
simply `filesize / entry_size`.

### `.bin` — the records

```
uint16 payload_length
payload
```

Fields appear in `.ddm` order. Text is length-prefixed or space padded per its
type; integers are little-endian; arrays and groups carry a leading element
count.

When `0x26` of the `.fdt` is **9**, the payload starts with a **presence
bitmap**:

```
uint8  bitmap_byte_count
uint8  bitmap[bitmap_byte_count]   // MSB first: bit 0 = first top-level field
```

Only fields whose bit is set are stored. **The bitmap can be shorter than the
field count** — anything past its end is absent. `catalog` record `01090` ships
one byte for thirteen fields. Assuming `ceil(nfields/8)` bytes throws on that
record and a few thousand like it.

Datasets with `0x26 != 9` have no bitmap and store every field. They are all
small — two to four fields — which makes it easy to "confirm" a dense reader
against them and then be wrong about the eleven interesting tables.

## Mitsubishi's schema

Text is normalised: nearly every human-readable string is an integer **TS**
(text serial) resolved through `Desc`, which exists once per language. This is
what makes the catalogue multilingual without duplicating structure.

| Dataset | Key | Rows* | What it is |
|---|---|---|---|
| `catalog` | PNC | 194,801 | **the parts table**, one file per catalogue |
| `PBook` | part number | 237,164 | part master: maker, supersession, colour, material |
| `Vin` | serial no | 881,746 | VIN → model, OPC, paint, trim, production date |
| `Opc` | model+OPC | 41,030 | option/spec codes per model |
| `Desc` | TS | 48,549 ×4 | **all display text**, one file per language |
| `pnc` | PNC | 28,313 | part name code → TS |
| `PREF` | part number | 249,378 | part → PNC → catalogue reverse index |
| `MGroup` | catalogue | 259 | model → main group, index illustration |
| `SGroup`/`BGroup` | catalogue | 6,614 | subgroups and plates, with illustrations |
| `rep` | part number | 21,494 | supersession chains, previous and next |
| `SSP` | part number | 237 | secondary service part numbers |
| `SPN` | SPN | 931 ×4 | service parts news |
| `CInfo` | catalogue | 52 | catalogue id → model name, data package |
| `OInfo`, `VInfo`, `ASP`, `OpcMod`, `pnc_desc` | | | option, vehicle-name, publication lookups |
| `DudMMC`, `MsgUpd` | TS | 716 ×9 | UI word index and update messages (in `PROG/`) |

\* original media, `EPC/DATA1`.

`catalog`'s fields are `PNC, Model, MainGroup, SubGroup, StartDate, EndDate,
PartNumber, Qty, SupplyCondition, OPC, DescTs, Classification[100],
ApplicableCodes[1000]`.

### Dates

`StartDate`/`EndDate` are integers of the form **`YYYYMMT`**, where `T` is a
third of the month: `1` early, `2` mid, `3` late. `1983011` is early January
1983; `1991061` early June 1991. Verified against the whole distribution —
only 1, 2 and 3 ever appear in the last position and months stay in 1–12.

### Illustrations

**The files under `ILLUST/` are named `*.tif` but are not TIFFs as stored.**
Every byte is XOR'd with `0x0b`, except byte 0 which uses `0x31`. Undo that and
you have an ordinary TIFF:

```python
out = bytearray(b ^ 0x0b for b in data)
out[0] = data[0] ^ 0x31
```

They are 1-bit bilevel, **CCITT Group 4**, typically 960x1210 (also 909x1187,
992x1403, and 294x162 for icons). All 18,760 illustrations in an installation
decode to a valid TIFF -- verified, none fail:

```sh
python3 re/tools/deillust.py --check <tree>/M60/ILLUST
```

The obfuscation sits on top of plain TIFF rather than being a container format:
`LxidTiff.dll` genuinely tests for the `II*` magic, and `LxidDcod.dll` picks a
codec by *file extension* (`FUN_6010e220` searches the name for `'.'`), so the
`.tif` extension is load-bearing even though the stored bytes are not TIFF.

Note the trap: XOR-ing with `0x0b` alone yields `73 49 2a 00` -- "sI\*\0",
one byte away from the magic -- which reads as "nearly TIFF but not quite" and
sends you looking for a container. It is only byte 0 that uses a different key.
Byte frequency is no help either: the payload is Group 4 data, so entropy is
7.59 bits/byte and index-of-coincidence is flat at every period, which makes the
file look compressed-and-unobfuscated.

`MGroup`/`SGroup`/`BGroup` each carry an `Illustration` field holding the
basename. Its first three characters are the subdirectory:

```
BGroup.Illustration = "113_0103KC1A0T"  ->  M60/ILLUST/113/113_0103KC1A0T.tif
MGroup.Illustration = "1@_____300164T"  ->  M60/ILLUST/1@_/1@_____300164T.tif
```

`1@_` is a literal directory name -- the `@` is not a placeholder here. All
1,621 distinct `BGroup` illustrations resolve; none are missing. The trailing
letter distinguishes plate type: `T` for parts plates, `K` for subgroup index
pages.

Service-parts-news images live in `ILLUST/SPN/` and are named from `SPN.A1`
("File Prefix") plus the SPN number and a `#page` suffix.

The drawings independently corroborate the schema. The plate for catalogue
`B6037609A`, model `L042G`, main group 13, subgroup 010 is
`113_0103KC1A0T.tif`, and its callouts are exactly the PNCs the catalogue
returns for that plate -- `05100A` FUEL TANK ASSY, `05114` CAP, `05145` GAUGE
UNIT, `05152` FILTER, `05265` HOSE. It also carries `REF. 13-020`, matching the
main-group/subgroup fields, and a date note `(-8301*3)` in the same
`YYYYMM`+third-of-month form as `StartDate`/`EndDate`.

## Delta updates

Disc A carries `UPDATE/asacm60e056.exe` through `asacm60e089.exe`. Each is a
**Wise Installer** self-extractor: a ~15 KB PE stub, then an overlay of
consecutively stored raw-deflate streams. Walking the overlay and inflating
back to back recovers every payload, so Wise's own per-file headers need not be
parsed:

```sh
python3 re/tools/unwise.py UPDATE/asacm60e056.exe out/
```

A package holds `WiseColors.dib`, `WiseScript.bin`, `Wise0132.dll`, a DeltaUpd
recipe, the data deltas, and replacement illustrations.

### The recipe

One payload is a plain-text script for `PROG/DeltaUpd.exe`, tab separated, with
`%0`-`%4` and `%L` standing for the source, update, target, illustration and
program directories and the new update level:

```
#9H2%1  DELTAUPD.LOG
#1%0\DATADESC\*.*   %2
#A%2\DESC_GB.BIN   DE1700D3   %0\DATEN\DESC_GB.U09   %2\DESC.FDT
#6%2\OPCMOD.FDT   %2
#1%0\ILLUST\*.*   %3
?9J3%4\ASAMAIN.INI   U   M60   UPDLEVEL_EPC   %L
```

`#A` applies a delta: *target `.bin`*, *an 8-hex-digit checksum of the target*,
*the delta file*, *the schema `.fdt`*. `#1` copies a file set, `#6` copies a
single file, `#9H*` sets up logging, and a `?` prefix marks a step as optional.
The last line is what bumps `UPDLEVEL_EPC` in `ASAMAIN.ini`.

The checksum is what produces the application's "not a valid previous version
and could not be upgraded" error. **It is not a plain CRC32.** Neither CRC32,
its complement, a byte-swap, nor Adler-32 over the whole target file reproduces
any of the published values, against base media or an updated tree. Identifying
it needs `DeltaUpd.exe` reversed, and until then a delta applier cannot verify
what it produces.

### The `.U<nn>` delta files

A delta is a flat sequence of operations on one dataset's `.bin`:

| Field | Type | Meaning |
|---|---|---|
| offset | u32 | byte offset in the target `.bin` |
| opcode | u8 | `'A'` add, `'D'` delete, `'U'` update |
| length | u16 | payload length |
| payload | bytes | a record body, encoded exactly as in `.bin` |

So deltas carry **whole records, not byte patches**, and the payload is read
with the ordinary record decoder. The suffix identifies the dataset: `U00` Vin,
`U03` MGroup, `U04` SGroup, `U05` BGroup, `U06` OInfo, `U07` Opc, `U09` Desc,
`U10` catalog, `U11` pnc, `U12` PBook, `U16` rep, `U19` PREF.

The `u32` is easy to mistake for a file header -- it is per record, and reading
it once at the front makes the first record parse and everything after it fail.
`PNC.U11` is the clearest specimen: 36 bytes, exactly two 18-byte operations
adding PNCs `98127` and `98128`, both at offset 370058.

```sh
python3 re/tools/delta.py <tree>/M60/UPDATE/Temp/Daten/*.U[0-9][0-9]
```

All 19 deltas left in a real installation's `UPDATE/Temp/Daten`, and all 10
carried by update 056, frame exactly.

## Reading a vehicle

```
Vin[serial]                 -> model, OPC, classification, production date
MGroup[catalogue, model]    -> main groups        + index illustration
BGroup[catalogue, model]    -> subgroups / plates + plate illustration
catalog[catalogue]          -> parts, filtered by model, main group, subgroup
  .PNC     -> pnc -> Desc[lang]    part name
  .DescTs  -> Desc[lang]           feature/qualifier text
  .PartNumber -> PBook             maker, supersession, material
              -> rep               previous/next part numbers
```

Applicability is decided by `Model`, the `StartDate`/`EndDate` window, `OPC`,
`Classification` and `ApplicableCodes`. A part is only correct for a vehicle
when all of those agree — see `AGENTS.md`.
