# The ASA data format

Mitsubishi's After Sales Application (ASA) is an electronic parts catalogue
built by **LexCom Informationssysteme** (Munich). The data engine is theirs, not
Mitsubishi's — `LexDdm.dll`, `fdtpdll.dll`, volume labels like `LexASAM60`. The
same engine shows up in other OEM catalogues, so this document describes the
_LexCom_ format, with Mitsubishi's schema as the worked example.

Everything below is validated by `masax verify`, which walks every dataset in
storage order and asserts each record consumes exactly its declared payload
length, that the walk ends precisely at the end of the file, that every index
offset lands on a record boundary, and that the declared run keys match the
data. Current status: **9,495,097 records on the original media, all clean.**

> An earlier version of this document quoted 1,889,570 records. That was the
> number of `.pnt` **index entries**, and the index covers only about a fifth of
> the data — see the `.pnt` section below.

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

| File   | Role                                                     |
| ------ | -------------------------------------------------------- |
| `.ddm` | INI text: the field list, with human-readable comments   |
| `.fdt` | binary field definition table: schema plus record layout |
| `.bin` | the records                                              |
| `.pnt` | the index — sorted key → byte offset                     |

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

| Offset | Type     | Meaning                                                  |
| ------ | -------- | -------------------------------------------------------- |
| `0x00` | u16      | magic, always `0x36`                                     |
| `0x02` | u16      | **top-level** field count                                |
| `0x04` | u16      | **total** field count, including group children          |
| `0x06` | u16      | label count                                              |
| `0x08` | char[13] | `.bin` filename template, NUL-terminated                 |
| `0x15` | char[13] | `.pnt` filename template                                 |
| `0x22` | u16      | max unpacked record length                               |
| `0x26` | u16      | **record encoding: `9` = sparse, anything else = dense** |
| `0x2a` | u16      | key field count                                          |
| `0x2c` | char[3]× | key field codes, then zero padding                       |
| `0x38` |          | field descriptors, 13 bytes each                         |
| then   |          | record layout table                                      |
| then   |          | field labels: u16 length (incl NUL) + bytes              |

The 13-byte padding of the two filename templates is _stale, uninitialised
bytes_, not zeros — `catalog.fdt` holds `"@.bin\0" + "g.bin\0"`, left over from
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

| `type`         | Meaning                                              |
| -------------- | ---------------------------------------------------- |
| `0x12`         | fixed-width text, space padded to `width`            |
| `0x14`         | unsigned integer, `width` bytes, little-endian       |
| `0x16`         | signed integer, `width` bytes, little-endian         |
| `0x22`         | variable text: one length byte, then that many bytes |
| `0x0a`, `0x1a` | repeating **group** header                           |

Storage classes:

| `storage` | Meaning                      |
| --------- | ---------------------------- |
| `1`       | group header                 |
| `2`       | array, **u8** element count  |
| `3`       | plain scalar                 |
| `4`       | array, **u16** element count |

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
describe the _unpacked_ buffer the engine reads a record into, not the file. You
do not need it to read `.bin`; its size is a good self check.

### `.pnt` — the index

Fixed-size entries, sorted by key:

```
key bytes (sum of the key fields' widths) || uint32 offset into .bin
```

So 8 bytes for a 4-byte integer key, 11 for a 7-character PNC, 21 for a
17-character part number. A **variable-text key is space padded to its full
width here**, even though `.bin` stores it length-prefixed.

**The index does not cover every record.** `filesize / entry_size` is the number
of _index entries_, not records, and for the navigation and parts tables the two
are wildly different:

| dataset                       | index entries  | records        |
| ----------------------------- | -------------- | -------------- |
| `pnc`, `PBook`, `Desc`, `rep` | one per record | one per record |
| `MGroup`                      | 259            | 6,607          |
| `SGroup`                      | 259            | 34,555         |
| `BGroup`                      | 6,355          | 61,111         |
| `catalog` (all 52)            | 194,801        | 3,027,265      |
| `A/Vin`                       | 408,872        | 2,669,815      |

Every index offset lands on a record boundary, and a sequential walk of the
`.bin` ends exactly at the end of the file — both are checked by `masax verify`.
So the index points _into_ the file rather than enumerating it, and the
remaining records are reached by reading forward. See **Runs** below.

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

## Runs, and the fields a record inherits

Records are stored in runs. The first record of a run carries the fields that
identify it; later records **omit whatever has not changed** and inherit those
fields from the record before them. Without that rule a continuation record is
meaningless — a part with no part-name code and no model.

For a catalogue the inherited fields are `A1` (PNC), `A2` (Model), `B1`
(MainGroup) and `B2` (SubGroup). One run is one (model, main group, subgroup,
PNC) and its records are the part numbers for it:

```
off      0  PNC=01000A  model=L042G  MG=11  SG=10  part=MD990099   <- run start
off     66                                         part=MD990100
off    109                                         part=MD990101
off    152                                         part=MD991233
```

**Do not carry every absent field forward.** `E1` (OPC), `E2` (Classification)
and `E3` (ApplicableCodes) are per-record applicability, and inheriting them
makes a part look like it fits a vehicle it does not. On one plate — model
`L042G`, main group 13, subgroup 010 — blanket inheritance reports all 42 parts
as option-restricted; the truth is 1 with an OPC and 6 with a classification.
Read with the right rule the plate makes sense as a catalogue:

```
PNC     part        from     to       OPC   classification
05021   MB247230    1983011  1986043  -     -
05021   MB247230    1986051  1991061  -     NJL6,VNJL6,VNJR6
05021   MB504621    1986051  1991061  -     NJQL6,VNJQL6
```

Two part numbers for one PNC in the same date window, separated by
classification — which is what applicability _is_.

### Deriving the run key

The property that identifies an inheritable field is **never present in a
continuation record**. A field that appears only where a run begins can be
carried forward; one that also appears mid-run is per-record data.

"Present in every run start" looks like the same test and is not: a
single-model catalogue omits `A2` even at its run starts, so that test drops
`A2` for three of the 52 files and the derived key disagrees with itself between
catalogues. On the never-continued test all 52 agree on
`[A1, A2, B1, B2]`, while `E1` appears in 35% of continuation records.

`masax verify --run-keys` prints what the data says; a plain `masax verify`
re-derives it and fails if the declaration in `@masax/catalogue` has gone stale.

## Mitsubishi's schema

Text is normalised: nearly every human-readable string is an integer **TS**
(text serial) resolved through `Desc`, which exists once per language. This is
what makes the catalogue multilingual without duplicating structure.

| Dataset            | Key                | Records*  | Indexed* | What it is                                         |
| ------------------ | ------------------ | --------- | -------- | -------------------------------------------------- |
| `catalog`          | PNC                | 3,027,265 | 194,801  | **the parts table**, one file per catalogue        |
| `Vin` (A+B)        | serial no          | 5,418,637 | 881,746  | VIN → model, OPC, paint, trim, production date     |
| `PBook`            | part number        | 237,164   | 237,164  | part master: maker, supersession, colour, material |
| `PREF` (A+B)       | part number        | 286,239   | 249,378  | part → PNC → catalogue reverse index               |
| `Desc`             | TS                 | 48,549 ×4 | all      | **all display text**, one file per language        |
| `Opc`              | model+OPC          | 66,382    | 41,030   | option/spec codes per model                        |
| `OpcMod`           | model+OPC          | 66,382    | 242      | a second index over the same `opc.bin`             |
| `pnc`              | PNC                | 28,313    | 28,313   | part name code → TS                                |
| `pnc_desc`         | PNC                | 28,313    | 16,132   | part name code descriptions                        |
| `BGroup`           | catalogue+model+MG | 61,111    | 6,355    | plates, with the drawing reference                 |
| `SGroup`           | catalogue+model    | 34,555    | 259      | subgroups                                          |
| `MGroup`           | catalogue+model    | 6,607     | 259      | main groups, with the index illustration           |
| `rep`              | part number        | 21,494    | 21,494   | supersession chains, previous and next             |
| `OInfo`            | option             | 6,223     | 6,223    | option descriptions                                |
| `SPN`              | SPN                | 931 ×4    | all      | service parts news                                 |
| `VInfo`            | VNC                | 263       | 35       | vehicle name code → model and catalogue            |
| `SSP`              | part number        | 241       | 237      | secondary service part numbers                     |
| `CInfo`            | catalogue          | 52        | 52       | catalogue id → model name, data package            |
| `ASP`              | model              | 7         | 1        | publications                                       |
| `DudMMC`, `MsgUpd` | TS                 | 716 ×9    | all      | UI word index and update messages (`PROG/`)        |

\* original media, `EPC/DATA1`. **9,495,097 records in total**, of which
1,889,570 are reachable through an index. `OpcMod` shares `opc.bin` with `Opc`,
so its records are counted twice in that total.

`catalog`'s fields are `PNC, Model, MainGroup, SubGroup, StartDate, EndDate,
PartNumber, Qty, SupplyCondition, OPC, DescTs, Classification[100],
ApplicableCodes[1000]`.

### Language coverage is partial

`Desc` exists once per language and every one of the four holds the same 48,549
serials, so a language switch is one different file and nothing else. The
_content_ is another matter. Against `DESC_GB`:

| Language | Translated     | Still English  | Empty         |
| -------- | -------------- | -------------- | ------------- |
| `D`      | 12,551 (25.9%) | 35,684 (73.5%) | 314 (0.6%)    |
| `F`      | 15,181 (31.3%) | 33,054 (68.1%) | 314 (0.6%)    |
| `J`      | 29,843 (61.5%) | 12,269 (25.3%) | 6,437 (13.3%) |

So a German session legitimately shows English group and plate headings over
German part names — `21417` is `FUEL TANK` in both `DESC_GB` and `DESC_D`, while
`DESC_F` has `RESERVOIR DE CARBURANT`. Worth knowing before hunting for a bug in
the text resolver.

`DESC_J` is **not Latin-1**: its 29,635 non-ASCII strings are half-width katakana
in the single-byte `0xa1`–`0xdf` range, i.e. JIS X 0201. Decoding it as Latin-1
— which is correct for the other three — produces mojibake.

### Dates

`StartDate`/`EndDate` are integers of the form **`YYYYMMT`**, where `T` is a
third of the month: `1` early, `2` mid, `3` late. `1983011` is early January
1983; `1991061` early June 1991. Verified against the whole distribution —
only 1, 2 and 3 ever appear in the last position and months stay in 1–12.

### VIN and the `Vin` dataset

`Vin` is keyed on a **7-character serial**, and each record stores a chassis
prefix. Together they make the VIN:

```
JMBGNPD5VS   +   A000003   =   JMBGNPD5VSA000003
chassis (A1)     serial (A0)
```

**Split from the right.** Only the serial has a fixed length. Measured over all
5,418,637 records: the serial is 7 characters in _every_ one, while the chassis
is 10 in 99.26% and **7 in 39,986** of them (plus twelve at 4 and 6). Those are
vehicles whose chassis number predates the 17-character VIN, and a decoder that
insists on 17 characters rejects forty thousand valid ones.

One serial carries many vehicles — `A000001` has 66, and one run reaches 316 —
so the chassis prefix is what disambiguates. Index offsets are monotonic, so the
run is one bounded read: 186 bytes on average against a 76 MB file.

#### Most records point elsewhere for the specification

Only **167,446 records (3.1%)** carry the model, classification, OPC, paint and
trim. The other **5,251,191 (96.9%)** carry a serial, a chassis, a build date
and field **`A2`, an XREF** — the serial of another record that holds the
specification for that chassis. None have neither.

```
J000188 + JMB0RV250R  ->  XREF J000153
J000153 + JMB0RV250R  ->  model V25W, class GRXML6, OPC H70, paint D9H
```

Following it is not an optimisation. Without it a valid VIN decodes to a build
date and nothing else, which reads as "not in the data" — and that is what 96.9%
of VINs did before this was found. Resolution is: match the chassis in the
XREF'd serial's run, take the fields this record lacks, keep this record's own
build date, and cap the hops in case the data has a cycle.

**Do not reach for inheritance here.** The catalogue tables carry absent fields
forward from the record above; `Vin` does not work that way, and doing it gives
a confidently wrong answer. For `JMB0RV250R` the nearest preceding record with a
model says `V23W` — the 2.3 litre — where the XREF says `V25W`. Same plate, wrong
engine.

### From a VIN to a catalogue

`VInfo` is the bridge, and it is keyed on exactly what `Vin` reports:

| field | holds                                                   |
| ----- | ------------------------------------------------------- |
| `A0`  | VNC — vehicle name code, the table's own key            |
| `A1`  | **model code — the same vocabulary the catalogues use** |
| `A5`  | the catalogue id                                        |
| `B0`  | the classifications that catalogue covers               |

So `V25W` is both what a VIN decodes to _and_ what `PAJERO/MONTERO(EUR)`
(`B60356A4A`) lists as one of its 19 models. There is no translation step.

**The classification is required, not an optimisation.** 16 of the 242 models
are listed by more than one catalogue — `E32A` by both `B6085101A` and
`B6085601A`, `D22A` by both `C6086411D` and `C6086404D` — and the classification
separates them. Measured over every `Vin` record that carries a model, all
167,446: model _and_ classification pin exactly one catalogue, none ambiguous
and none unresolved.

Both routes to the catalogue agree. Of the 233 distinct models that appear in
`Vin`, all 233 are listed by some catalogue, all 233 appear in `VInfo`, and
`VInfo`'s answer is always among the catalogues that list the model. So `VInfo`
is used because it disambiguates, not because the model list is unreliable.

> An earlier version of this document said the `Vin` model code was "a different
> vocabulary from the catalogue model code, bridged by `VInfo` patterns". That
> was wrong, and wrong because of a bad comparison: `P02V` was checked against
> `B6037609A`, which is the Pajero I catalogue and simply not the one for that
> model. `VInfo`'s `A2` field does hold a pattern (`PA-PD#`, `L0/P0#`), but it is
> a human-readable range label, not the join.

### The parts table does not key to a plate

`catalog` keys to `Model, MainGroup, SubGroup`. `BGroup` keys to
`Catalog, Model, MainGroup` and carries a `SubGroup` — and **a subgroup number
can carry several plates**. On `V25W`, `13-010` is three: a filler pipe and two
tank-and-tube variants. All three read the same 70 rows over 47 codes, because
that is the only granularity the parts table has.

What separates them is not in `BGroup`. Those three records differ in exactly
two fields, `TSDesc` and `Illustration`:

```
{"sub":"010","ts":21417,"tsd":1872,"ill":"113_0103KC1B5T"}   FUEL FILLER PIPE
{"sub":"010","ts":21417,"tsd":1896,"ill":"113_0103KC1N5T"}   FUEL TANK & FILLER TUBE '94MODEL-
{"sub":"010","ts":21417,"tsd":1889,"ill":"113_0103KC1U5T"}   FUEL TANK & FILLER TUBE (75L) '95MODEL-
```

No date window, no classification, no OPC. **The drawing is the discriminator:
its callouts are its share of the list.** For that subgroup the three drawings
call out 11, 33 and 29 codes, and their union is exactly the 47 the run holds.

Measured over all 60,698 plates: **733,228 of 735,274** subgroup codes appear on
some drawing of their subgroup, so the rule accounts for **99.72%**, and it
halves a plate's list — 1,685,164 codes down to 944,471.

Two cases need an escape hatch, because losing a real part is worse than showing
a spare one:

- **A drawing with no callouts implies nothing.** 2,160 plates have none; show
  the whole run.
- **A code on no drawing of the subgroup stays on every plate of it.** That is
  the other 0.28%, 2,046 codes — real parts that no image calls out. Filtering
  them against a drawing would hide them everywhere at once.

This is the plate↔parts join, not vehicle applicability. Narrowing the surviving
rows to one _vehicle_ — by build date, OPC and classification — is a further
step and is [still unresolved](#what-is-not-established).

### Callout hotspots

The drawings are clickable in the original — `ASA.exe` has a `CHotImageView` —
and **no `.ddm` declares a coordinate**. The coordinates are in the image, in
private TIFF tag **`0xfe00`**: declared as an array of LONGs, but really a
packed blob of records, one per callout label printed on the plate.

| field         | type       | meaning                                        |
| ------------- | ---------- | ---------------------------------------------- |
| length        | u16        | bytes in this record, including this field     |
| x, y          | u16        | top-left of the label box, in image pixels     |
| width, height | u16        | of the label box; typically ~103 × ~25         |
| pnc           | u8 + bytes | part-name code the callout points at           |
| label         | u8 + bytes | the text as printed; usually the same as `pnc` |
| flags         | u16        | always 1 on the European media                 |

**The declared count under-reports the data.** The blob is written after the
image strip, at the very end of the file, and the records continue past
`4 × count`. Reading only the declared length truncates the last callouts on
**13,653 of the 17,977** drawings — and truncates them mid-record, so the loss
looks like "this plate has fewer callouts" rather than like an error. Read from
the tag's offset to the end of the file: nothing follows it.

Measured over every drawing, reading to EOF: **16,938 carry hotspots, 371,928 in
total**, up to 99 on one plate, with **0 bytes left unparsed** and **0 boxes
outside the image**. The remaining 1,039 have none, which is what an index page
looks like.

#### A callout is not always on the plate's own list

Of the 16,332 referenced illustrations, **11,839 are used by more than one
plate** and one is used by 235. A drawing therefore carries the callouts of
every variant it serves, plus `REF.` pointers into other groups — a lubrication
plate carries engine codes like `02093P`. Sampling 120 plates, 3,168 of 3,630
callouts matched the plate's own parts list and 462 did not.

So a callout is only actionable when its code is on the current parts list. The
client draws the others — they are printed on the paper — and leaves them inert.

> An earlier version of this document said the drawings had no hotspot data,
> reasoning from `dsPicPNC.cds` declaring no X/Y fields. The conclusion was
> drawn from the wrong artifact: `.cds` files describe the application's
> in-memory grids, not the data on the disc.

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
codec by _file extension_ (`FUN_6010e220` searches the name for `'.'`), so the
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

`#A` applies a delta: _target `.bin`_, _an 8-hex-digit checksum_, _the delta
file_, _the schema `.fdt`_. `#1` copies a file set, `#6` copies a single file,
`#9H*` sets up logging, and a `?` prefix marks a step as optional. The last line
is what bumps `UPDLEVEL_EPC` in `ASAMAIN.ini`.

### The checksum

It is **reflected CRC32 (poly `0xEDB88320`) with the accumulator initialised to
0 and no final complement.** Standard CRC32 initialises to `0xFFFFFFFF` and
complements the result, which is why it reproduces none of the published values.
`DeltaUpd.exe` builds the ordinary table at `0x41c7ec`, and `FUN_004057d0`
zeroes the accumulator, streams the file through `FUN_00405790` in 64 KB
chunks, and returns it unmodified.

```python
def checksum(data):                       # re/tools/delta.py
    return (~zlib.crc32(data, 0xFFFFFFFF)) & 0xFFFFFFFF
```

The published value is the expected checksum of the target **after** the update
is applied, not before. Across all 34 update recipes this reproduces 77 exact
target-name-and-value matches against an installation at level 89, and for every
file the matching level is 089 — the last update. That it is the _post_ state is
settled independently: update 089's `PNC.U11` adds part-name codes `98127` and
`98128`, and both are present in that tree and absent from the base data.

### The `.U<nn>` delta files

A delta is a flat sequence of operations on one dataset's `.bin`:

| Field   | Type  | Meaning                                     |
| ------- | ----- | ------------------------------------------- |
| offset  | u32   | byte offset in the target `.bin`            |
| opcode  | u8    | `'A'` add, `'D'` delete, `'U'` update       |
| length  | u16   | payload length                              |
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

### The shipped chain does not apply to this media

None of the 769 distinct checksums published across updates 056-089 matches any
file on the discs, under any CRC variant tried — while the same search finds 77
matches against an update-derived tree. The discs are a freshly mastered
snapshot dated 2008-09-19, not the result of running the chain, so their bytes
differ from an updated tree even where the logical content agrees. The update
packages on disc A exist to bring _older installations_ forward; they are not a
patch series for the media itself.

## What is not established

Everything above is derived from the data and checked by `masax verify`. Two
things are not, and are deliberately left un-guessed rather than approximated:

**Vehicle applicability inside a plate.** After the drawing narrows a plate to
its own codes, several rows can remain for one code — `05014` has three, each
with its own date window — and rows carry `OPC`, `Classification[100]` and
`ApplicableCodes[1000]`. A decoded VIN gives a build date, an OPC and a
classification, so the ingredients are all present. What is not known is how ASA
_combines_ them: whether the tests are conjunctive, whether an empty
classification means "all" or "unknown", and what `ApplicableCodes` indexes. The
client therefore shows every surviving row with its conditions visible, and
applies none of them. Settling it needs a vehicle whose correct parts list is
known from outside the data — a printed microfiche page, or the original
application's own output for a specific VIN.

**`ApplicableCodes` semantics.** An array of up to 1,000 `u16` on a part row. It
is not resolved here.

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
