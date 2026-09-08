# How ASA works, and how to rebuild it

This is the guide I wish had existed when this started: what the Mitsubishi
After Sales Application actually does, how its data is organised, and the order
to attack it in so that each step can be checked before the next one depends on
it.

It is a companion to [`data-format.md`](data-format.md), which is the byte-level
reference. This document is the _system_: the pipeline, the joins, the
algorithms, and the traps that cost real time. Where a byte layout matters, it
links rather than repeats.

Everything here was derived by reading the data, cross-checked against
`fdtpdll.dll` and `ASA.exe` in Ghidra where the data alone was ambiguous, and is
re-checked on every run of `masax verify`. Where something is **not** known, it
says so instead of guessing.

---

## 1. What the application is

ASA is a **parts catalogue**: a dealer looks up a vehicle and gets the exploded
drawings and part numbers for it. Module `M60` is European passenger cars, dated
September 2008. The user-facing job breaks into four things:

1. **Identify the vehicle.** Type a VIN, or pick a catalogue and model by hand.
2. **Navigate to a plate.** Main group → subgroup → plate, e.g. `13 FUEL` →
   `010 FUEL TANK` → the filler-pipe variant.
3. **Read the plate.** An exploded drawing with numbered callouts, beside a
   table of part numbers, quantities and validity dates. The numbers on the
   drawing and the rows in the table are the same set, and clicking either
   should light up the other.
4. **Look a part up directly.** By part number, by part-name code, or through
   supersession — what replaced what.

That is the whole product. Everything below is in service of it.

## 2. The shape of the data, in one paragraph

There is no database engine and no SQL. A dataset is **four files** — a `.ddm`
field list, a `.fdt` schema, a `.pnt` sorted index and a `.bin` of records — and
a lookup is "binary-search the index for a key, take the `uint32` offset, read
two bytes at that offset for a length, then that many bytes". Text is
normalised: nearly every human-readable string is an integer _text serial_
resolved through a `Desc` table that exists once per language. There are 27-odd
datasets and **9,495,097 records**, of which only 1,889,570 are reachable
through an index — the rest are found by reading forward. Drawings are separate
files: CCITT Group 4 TIFFs behind a byte-level obfuscation.

The consequence worth internalising early: **a record read is a bounded byte
range at a known offset.** That is the same shape as `Blob.slice()` and as an
HTTP `Range` request, which is why this can be a browser application with no
server. See [`plan.md`](plan.md) for the sizing that follows from it.

## 3. Getting the data

The media is two ISOs (plus an installer `.exe` that is a Wise SFX). Neither
disc is complete: disc A carries 30 of the 52 catalogues and the `DATA1/A`
index half, disc B the other 22 and `DATA1/B`, and **both write into the same
`EPC/DATA1`**. So the two trees have to be overlaid, not read separately.

```
hdiutil attach -readonly MMC_ASA_EUR_A.iso     # macOS
masax survey /Volumes/*                        # say what each mount point is
masax verify /Volumes/MMC-A "/Volumes/MMC ASA 2"
masax import /Volumes/MMC-A "/Volumes/MMC ASA 2" --out ./data
```

`import` copies the union unchanged and writes a manifest; nothing is converted.
`verify` will read straight off the mount points, so importing is optional.

> **Trap: case.** One disc spells the drawings directory `Illust`, the other
> `ILLUST`, and the same divergence appears inside filenames. An overlay that
> resolves paths case-sensitively silently drops whichever spelling it did not
> see first — this lost **8,575 of 17,977 drawings** and still reported success,
> because every file it _did_ copy was fine. Resolve each path segment
> case-insensitively, and assert the union count.

See [`media.md`](media.md) for what each archive contains and why the shipped
delta-update chain does not apply to these discs.

## 4. Reading a dataset

Four files per dataset, named from the `.fdt`'s own templates. Layouts are in
[`data-format.md`](data-format.md#a-dataset-is-four-files); the algorithm is:

### 4.1 Open

```
fdt   = parse .fdt                 # field descriptors, key codes, sparse flag
ddm   = parse .ddm                 # field comments; better labels than the .fdt
tree  = nest group children under their headers
index = mmap .pnt as fixed-size entries: key bytes || uint32 offset
```

The `.fdt` gives you the key field codes; their widths summed give the `.pnt`
entry's key width, and the entry size is that plus four.

> **Trap: the filename templates carry stale bytes.** `catalog.fdt` holds
> `"@.bin\0" + "g.bin\0"` — the tail is uninitialised junk from a longer
> previous name. Cut at the first NUL.

> **Trap: `max_repeat` does not mean "repeats".** `DudMMC.A0` has
> `max_repeat = 4` and is a plain 4-byte integer. Only the `storage` class
> decides. And the element-count width follows `storage`, not the capacity:
> `catalog.E3` has capacity 1000 and writes a **u16** count. Reading a u8 there
> eats the low byte, invents an empty first element, and leaves the record one
> element short — it cost 2–8% of catalogue records and nothing else in the
> format notices.

### 4.2 Decode one record

```
length = u16 at offset
body   = bytes[offset+2 .. offset+2+length]
at     = 0
if fdt.sparse:
    n      = body[0]                      # bitmap length in bytes
    bitmap = body[1 .. 1+n]
    at     = 1 + n
for i, field in enumerate(fdt.tree):      # top-level fields, .ddm order
    if fdt.sparse and not bit(bitmap, i):
        continue                          # absent, not empty
    value, at = read_field(body, at, field)
assert at == length                       # the whole record, exactly
```

`read_field` dispatches on `storage` first (group / u8-counted array /
scalar / u16-counted array) and then on `type` (fixed text, var text, signed and
unsigned little-endian integers). Fixed text is space-padded and wants trimming;
var text is one length byte then that many bytes.

That final `assert` is the single most valuable check in the whole project. A
schema that disagrees with the data by one byte produces plausible-looking
garbage; the assertion turns it into a hard failure at the exact record.

> **Trap: the bitmap can be shorter than the field count.** `catalog` record
> `01090` ships one byte for thirteen fields. Anything past the bitmap's end is
> absent, not present.

### 4.3 Runs, and why the index is not a table of contents

**The index points at the first record of a _run_, not at every record.**
`SGroup` has 259 index entries for 34,555 records. Records after the first in a
run **omit the fields that have not changed** since the run started.

```
run(i):
    from = index.offset(i)
    to   = index.offset(i+1) if i+1 < index.count else filesize
    for each record in bytes[from..to]:      # offsets are monotonic
        inherit run-key fields from the previous record where absent
```

Because the offsets are monotonic, a run is **one bounded read** — 186 bytes on
average for `Vin`. A VIN decode against a 76 MB file transfers about two hundred
bytes.

> **Trap, and it is the important one: inherit only the run-key fields.**
> Carrying _every_ absent field forward is wrong and dangerous. On `catalog`,
> `E1` (OPC) and `E2` (Classification) are **per-record applicability**;
> propagating them makes a part look like it fits a vehicle it does not. The
> safe test for a run-key field is structural: it is present in every record
> that starts a run and in **none** that continues one. Derive it from the data
> rather than declaring it — `masax verify --run-keys` prints what the data
> says, and CI fails if a declaration has gone stale.

### 4.4 Check it

Three invariants, all cheap, all worth wiring into a verify command:

1. Every record's fields consume exactly its declared length.
2. Every index offset lands on a record boundary.
3. A sequential walk of the `.bin` ends exactly at end-of-file.

On the original media that is **9,495,097 records** decoding with zero
exceptions. If your number differs, note whether you are counting records or
index entries — I reported 1,889,570 as "every record" once, and it was the
index.

## 5. The schema, as a join graph

The full inventory is [in the format doc](data-format.md#mitsubishis-schema).
The parts that matter for navigation:

```
                     VIN string
                         │  split from the RIGHT: 7-char serial + chassis
                         ▼
     Vin (A+B halves) ───────────────► model, classification, OPC, paint, trim,
                         │                                     production date
                         └─ A2 = XREF ─► another serial that holds the spec
                         ▼
     VInfo  ────────────► catalogue id  (keyed on model + classification)
                         ▼
     CInfo  ────────────► catalogue name, data package
                         ▼
     MGroup ────────────► main groups for (catalogue, model)
     SGroup ────────────► subgroups
     BGroup ────────────► plates, each with an Illustration name
                         ▼
     catalog[<cat id>] ─► part rows for (model, main group, subgroup)
                         ▼
     pnc / pnc_desc ────► part-name code → text
     Desc_<lang> ───────► every display string, by text serial
     PBook ─────────────► part master: maker, colour, material, supersession
     rep ──────────────► supersession chains, previous and next
     PREF (A+B) ────────► part number → PNC → catalogue, the reverse index
```

Two things about this graph are not obvious and both cost time:

**`VInfo` is the bridge, and the classification is not optional.** 16 of the 242
models are listed by more than one catalogue — `E32A` by both `B6085101A` and
`B6085601A` — so model alone is ambiguous. Model _and_ classification pin
exactly one catalogue: measured over all 167,446 spec-bearing `Vin` records,
none ambiguous, none unresolved.

**The model code is one vocabulary, not two.** `V25W` is both what a VIN decodes
to and what `PAJERO/MONTERO(EUR)` lists. I claimed otherwise for a while, having
compared a model code against a _catalogue id_ — `P02V` against `B6037609A` —
which is a category error. A VIN alone is therefore enough to reach a parts
list, and the user never has to know that a V25W is a Pajero.

## 6. VIN decoding

ASA does this **locally**; the data is on the disc, 5.4 million `Vin` records
across two halves. (Worth stating because the equivalent Renault system used a
remote dealer service, so a client-side reimplementation there had to decline.)

```
JMBGNPD5VS   +   A000003   =   JMBGNPD5VSA000003
chassis (A1)     serial (A0)
```

```
decode(vin):
    serial  = vin[-7:]                  # from the RIGHT
    chassis = vin[:-7]
    half    = which of the two Vin files indexes this serial
    run     = read the run for serial
    rec     = the record in run whose chassis prefix matches
    if rec has no model and rec.A2 is set:
        rec = follow XREF to that serial, match the same chassis   # cap the hops
    return spec from rec, noting which serial it came from
```

Three findings, each of which is the difference between working and not:

- **Split from the right.** The serial is 7 characters in every one of the
  5,418,637 records; the chassis is 10 in 99.26% and 7 in 39,986 of them. So
  0.74% of these vehicles predate the 17-character VIN, and a decoder that
  insists on 17 rejects forty thousand valid ones.
- **Follow the XREF.** Most records carry no specification — in one run of 316,
  only 50 do. The rest hold a serial, a chassis, a build date and `A2`, a
  pointer to another serial that has the spec for that chassis. Without it,
  **96.9%** of VINs decode to a build date and nothing else, which reads as "not
  found".
- **Do not inherit the spec from the record above.** The obvious alternative to
  the XREF gives the _wrong answer_: for `JMB0RV250RJ000188` the nearest
  preceding record with a model says `V23W` (the 2.3), and the XREF says `V25W`.
  Right shape, wrong vehicle — and nothing in the data flags it.

One serial can carry many chassis variants; `A000001` has 66. Sampled 150
VINs, 150 resolve.

## 7. Navigating to a plate, and the plate↔parts join

`MGroup`, `SGroup` and `BGroup` are all small enough to hold whole (93 kB,
1.1 MB, 2.4 MB) and are keyed on `(catalogue, model, …)`. Filter, sort, done.

The parts table is the interesting one. **`catalog` keys to
`(Model, MainGroup, SubGroup)` — it does not key to a plate**, and a subgroup
number can carry several plates. On `V25W`, `13-010` is three plates: a filler
pipe and two tank-and-tube variants. All three read the same 70 rows over 47
codes, because that is the only granularity the table has.

Nothing in `BGroup` separates them either — those three records differ in
exactly two fields, the description text and the `Illustration`. No date window,
no classification, no OPC.

**The drawing is the discriminator: its callouts are its share of the list.**
The three drawings call out 11, 33 and 29 codes; their union is exactly the 47
the run holds.

```
parts_for_plate(cat, model, mg, sub, illustration):
    rows    = catalog rows for (model, mg, sub)          # the whole run
    own     = callout codes of this plate's drawing
    if not own: return rows                              # 2,160 plates have none
    claimed = union of callout codes over every plate of this subgroup
    return [r for r in rows if r.pnc in own or r.pnc not in claimed]
```

Measured over all 60,698 plates: **733,228 of 735,274** subgroup codes appear on
some drawing of their subgroup, so the rule accounts for **99.72%**, and it
halves a plate's list — 1,685,164 codes down to 944,471. The two escape hatches
matter, because losing a real part is worse than showing a spare one: a drawing
with no callouts implies nothing, and a code that **no** drawing of the subgroup
claims stays on every plate of it (the other 0.28%, 2,046 real parts that no
image happens to call out).

The reverse mismatch is left alone. 83,597 callouts name a code that is not in
the subgroup's run at all, because a shared drawing carries every model's
callouts, plus 29,507 that are `REF.` pointers into other groups. Draw them —
they are printed on the paper — and leave them inert.

## 8. Drawings

**The files under `ILLUST/` are named `*.tif` and are not TIFFs as stored.**
Every byte is XOR'd with `0x0b`, except byte 0 which uses `0x31`. Undo that and
it is an ordinary single-strip TIFF: `Compression = 4` (CCITT Group 4,
ITU-T T.6), `Photometric = 0` (WhiteIsZero), `RowsPerStrip = ImageLength` on
every drawing on the media. Mostly 960×1210.

The name's first three characters are its subdirectory: `113_0103KC1B5T` lives
in `113/`. `1@_____300164T` lives in `1@_` — that is a literal directory name,
not a placeholder.

So the decode path is: read file → XOR → parse IFD → decode Group 4 → paint. You
need a real T.6 decoder (vertical, pass and horizontal modes, with white and
black run-length code tables); there is no shortcut, and browsers will not do it
for you. All 17,977 decode, pixel-identical to a reference implementation on
samples, with at most 127 bits left unread after the last row (EOFB and fill).

Do **not** convert them to PNG ahead of time hoping to save bytes: 121 MB of
Group 4 becomes 172 MB of PNG. I claimed the opposite once; it is simply worse.

### Callout coordinates

They are in the image, in **private TIFF tag `0xfe00`** — declared as an array
of LONGs, actually a packed blob of records, one per callout printed on the
plate:

```c
uint16 length;                  // bytes in this record, including this field
uint16 x, y, width, height;     // label box in image pixels, typically 103×25
uint8 n; char pnc[n];           // the part-name code the callout points at
uint8 n; char label[n];         // the text as printed; usually the same
uint16 flags;                   // always 1 on the European media
```

> **Trap: the declared count is short.** The blob is written after the image
> strip at the very end of the file, and the records continue past
> `4 × count`. Reading only the declared length truncates the last callouts on
> **13,653 of the 17,977** drawings — _mid-record_, so the loss looks like "this
> plate has fewer callouts" rather than like an error. Read from the tag's
> offset to end-of-file; nothing follows it.

Reading to EOF: 16,938 drawings carry hotspots, **371,928 in total**, up to 99 on
one plate, with **0 bytes left unparsed** and **0 boxes outside the image**.

> An earlier version of this project concluded the drawings had no hotspot data
> at all, reasoning from `dsPicPNC.cds` declaring no X/Y fields. That was the
> wrong artifact: `.cds` files describe the application's in-memory grids, not
> the data on the disc. The conclusion stood for several commits.

## 9. Text

Almost nothing stores a string. Fields hold an integer **text serial**, resolved
through `Desc`, which exists once per language (`DESC_GB.BIN`, `DESC_D`,
`DESC_F`, `DESC_J`). That is what makes the catalogue multilingual without
duplicating any structure — and it means a reimplementation gets language
support for free, provided every label goes through the same resolver.

Part _names_ take one more hop: a part row's PNC keys `pnc`, which yields the
text serial, which keys `Desc`.

Dates are integers of the form **`YYYYMMT`** where `T` is a third of the month:
`1` early, `2` mid, `3` late. `1994051` is early May 1994.

## 10. Architecture of the reimplementation

Recommended shape, and the one masax uses:

| Layer       | Job                                                                 |
| ----------- | ------------------------------------------------------------------- |
| filesystem  | one interface over picked directory / OPFS / HTTP Range / `node:fs` |
| `lex`       | the generic format: `.ddm`, `.fdt`, `.pnt`, `.bin`, runs            |
| `illust`    | XOR, TIFF IFD, Group 4 decoder, hotspots                            |
| `catalogue` | the ASA domain: catalogues, groups, plates, parts, VIN              |
| `importer`  | survey, overlay, copy, manifest                                     |
| clients     | CLI and browser, both on the same packages                          |

Keeping `lex` free of anything Mitsubishi-specific is worth the discipline: the
engine is **LexCom Informationssysteme's**, not Mitsubishi's, so the same reader
is a reasonable bet on another OEM's catalogue.

What to hold in memory and what to range-read:

- **Hold:** the navigation and text tables — `Desc` 1.3 MB, `pnc` 368 kB,
  `MGroup` 93 kB, `SGroup` 1.1 MB, `BGroup` 2.4 MB — plus the two `Vin` indexes
  at 4.5 and 5.2 MB. About 15 MB.
- **Hold per selection:** one catalogue's parts table, 0.3 to 28 MB. A
  deliberate exception — `catalog`'s index is keyed by part-name code only, so
  it cannot answer "what is on this plate", and fetching the catalogue once and
  grouping it in memory beats inventing a derived index.
- **Range-read:** `Vin` and `PBook`, 76 MB and 79 MB. Never held.

> **Trap, if you go the browser route:** an unbound `fetch` stored as a field
> throws `Illegal invocation`. Wrap it. This is the kind of thing only a real
> browser test catches — it passed every unit test.

## 11. A build order that stays checkable

Each step has a number you can compare against, so a mistake surfaces at the
step that caused it rather than three steps later.

| #   | Step                      | Check                                                      |
| --- | ------------------------- | ---------------------------------------------------------- |
| 1   | `.fdt` + `.ddm` parsers   | every dataset's schema prints; layout table is `8 × total` |
| 2   | `.bin` record decode      | fields consume exactly the declared length, everywhere     |
| 3   | `.pnt` + sequential walk  | **9,495,097** records; offsets on boundaries; ends at EOF  |
| 4   | derive run keys           | matches your declarations; `catalog` is `A1 A2 B1 B2`      |
| 5   | `Desc` and `pnc` text     | part names read as English                                 |
| 6   | navigation tables         | 52 catalogues, 242 models, plates with drawing names       |
| 7   | XOR + TIFF + Group 4      | **17,977** drawings decode, 0 failures                     |
| 8   | hotspots, reading to EOF  | 371,928 in 16,938 drawings, 0 bytes unparsed               |
| 9   | plate↔parts narrowing     | `V25W 13-010` → 11 / 32 / 28 codes over three plates       |
| 10  | VIN decode with XREF      | `…RJ000188` → `V25W`, class `GRXML6`, built 1994-03        |
| 11  | VIN → catalogue via VInfo | 167,446 spec-bearing records, none ambiguous               |

Steps 1–4 are the foundation and the only ones where a subtle error is invisible
— hence the emphasis on the consume-exactly assertion. Steps 7–8 are
self-checking. Step 9 is the one that needs a plate you can eyeball against its
drawing.

## 12. What is not established

Two things, deliberately not guessed:

**Vehicle applicability inside a plate.** After the drawing narrows a plate to
its own codes, several rows can survive for one code — `05014` has three, each
with its own date window — and rows carry `OPC`, `Classification[100]` and
`ApplicableCodes[1000]`. A decoded VIN gives a build date, an OPC and a
classification, so every ingredient is present. What is unknown is how ASA
_combines_ them: whether the tests are conjunctive, whether an empty
classification means "all" or "unknown", and what `ApplicableCodes` indexes.
masax therefore shows every surviving row with its conditions visible and
applies none of them. Settling it needs a vehicle whose correct parts list is
known **from outside the data** — a printed microfiche page, or the original
application's own output for a specific VIN.

**`ApplicableCodes`.** An array of up to 1,000 `u16` on a part row. Not
resolved.

Also not built here, though nothing about them looks hard: search by part number
and by label across a catalogue, and surfacing the `rep` supersession chains in
the interface.

## 13. Things that were true and turned out not to be

Kept because the corrections are more useful than the conclusions, and because
each one survived for a while:

| Claimed                                          | Actually                                                     |
| ------------------------------------------------ | ------------------------------------------------------------ |
| 1,889,570 records                                | that is index entries; **9,495,097** records                 |
| Absent fields inherit from the record above      | only run-key fields; inheriting OPC corrupts applicability   |
| Illustrations are plain TIFFs                    | XOR'd, `0x0b` with `0x31` on byte 0                          |
| PNG would be smaller than Group 4                | larger: 172 MB against 121 MB                                |
| Drawings carry no hotspot data                   | private tag `0xfe00`; the `.cds` file was the wrong artifact |
| The hotspot tag's declared count bounds the blob | it is short; read to EOF                                     |
| VIN model codes are a separate vocabulary        | same vocabulary; I had compared against a catalogue id       |
| A VIN splits from the left                       | from the right — only the serial has a fixed length          |

The pattern in all of them: a claim derived from one artifact, or from a
plausible-looking sample, that nothing in the pipeline was positioned to
contradict. The fixes that stuck were structural checks — consume-exactly,
offsets-on-boundaries, walk-ends-at-EOF, parse-consumed-every-byte,
derive-the-run-key-from-the-data — rather than more careful reading.
