# Working on masax

Notes for anyone — human or agent — changing this repository. Conventions, and
mostly the ones learned by getting them wrong. For how the format works read
[`docs/data-format.md`](docs/data-format.md); for what the source archives are
read [`docs/media.md`](docs/media.md). For the system as a whole — the
pipeline, the joins and a build order — read
[`docs/how-it-works.md`](docs/how-it-works.md); the user-facing guide is
[`docs/guide.md`](docs/guide.md).

This is a parts catalogue. A wrong applicability decision puts a part on a
vehicle it does not fit, and nothing in a passing test run will tell you.

## Before you finish

```sh
pnpm check                              # build, typecheck, unit tests
masax verify <a merged media tree>/M60
MASAX_DATA=<the same tree> pnpm test    # and the browser suite
```

`pnpm check` **skips the browser suite** unless `MASAX_DATA` is set, and skipped
tests are reported as passes. It is the only place the range reads, the canvas
and the theme are exercised in a real browser, and it has caught things every
unit test agreed with — an unbound `fetch` throwing `Illegal invocation` is not
reproducible in Node. `MASAX_DATA` takes a module directory or one holding a
module, so either `/Volumes/data/masax` or `/Volumes/data/masax/M60`.

Expect `9495097 records decode exactly, 1889570 of them reachable through an
index`. **Anything less is a regression**, not an acceptable margin — the format
is understood, so a single failing record means the change is wrong or the input
is damaged.

`masax verify` is the integration suite on purpose. It decodes every record in
storage order, and additionally checks that the walk ends exactly at the end of
the file, that every index offset lands on a record boundary, and that the
declared run keys still match the data. It found every bug listed below.

**There is no longer a second implementation to check against.** The Python
reader that served as a differential oracle is gone, superseded by
`packages/lex` and `masax verify`; keeping it would have meant maintaining a
weaker checker, since it validated only the indexed records and understated the
record count fivefold. `re/tools/` keeps just `unwise.py` and `delta.py`, which
cover the update-package format and have no TypeScript equivalent, plus
`stage.sh` for staging PE files into the gitignored `re/bin/`.

## The index does not enumerate the file

This is the mistake that cost the most. `filesize / entry_size` on a `.pnt`
gives the number of _index entries_; the `.bin` holds far more records, and the
index points at the first record of each run. `SGroup` has 259 entries and
34,555 records.

Two consequences:

- **Validating "every record" means a sequential walk**, not iterating the
  index. An earlier `verify` iterated the index, reported 1,889,570 records and
  100%, and was reading a fifth of the data. Everything it read was correct,
  which is what made it convincing.
- **Continuation records inherit the fields they omit.** Read without
  inheritance they are parts with no PNC and no model, and read with _blanket_
  inheritance they acquire applicability they do not have. Only the run key is
  inherited; see `docs/data-format.md`. The safe test for an inheritable field
  is "never present in a continuation record" — not "present at every run
  start", which is data-dependent and disagrees between catalogues.

## The format code

**`docs/data-format.md` is the specification and it is kept honest.** If you
learn something new about a layout, update the doc in the same change. If you
find the doc overstating a claim, weaken it.

Rules the reader must not get wrong. Each of these passed on most of the data
before being caught:

- **`max_repeat` does not mean the field repeats.** Only the storage class
  does. `DudMMC.A0` has `max_repeat=4` and is a plain integer; treating it as an
  array breaks that one dataset while all eleven others still pass.
- **Array element counts are u8 for storage class 2 and u16 for class 4.**
  `catalog.E3` (capacity 1000) writes `0c 00`. Reading u8 there eats the low
  byte, invents an empty first element, and leaves the record one element short
  — 2–8% of catalogue rows, and nothing else notices.
- **The presence bitmap can be shorter than the field count.** Fields past its
  end are absent. `catalog` record `01090` ships one bitmap byte for thirteen
  fields. `ceil(nfields/8)` throws on it.
- **Type `0x14` is little-endian.** Big-endian gives subgroup numbers 2560,
  5120, 23040 instead of 10, 20, 90 — values that look like data, parse fine,
  and are wrong.
- **Filename templates are padded with stale bytes, not zeros.** `catalog.fdt`
  holds `"@.bin\0"` followed by `"g.bin\0"` left over from a longer name. Cut at
  the first NUL.
- **The `u32` in a `.U<nn>` delta is per record, not a file header.** Reading it
  once at the front makes the first operation parse and every later one fail on
  a bogus opcode -- which reads like an unknown format rather than an off-by-4.

## The DeltaUpd checksum

Reflected CRC32, poly `0xEDB88320`, **accumulator initialised to 0 and no final
complement**. The binary's own error strings call it "CRC32", and the table at
`0x41c7ec` is the standard one, so it is easy to conclude the algorithm is
standard and the _input_ must be unusual — and then to go hunting for the right
byte range. It is the other way round: the input is the whole file and the
init/final are non-standard.

The published value describes the target **after** the update, not before.
Prove that direction rather than assuming it: update 089's `PNC.U11` adds PNCs
`98127`/`98128`, and checking whether they are present in a tree tells you which
side of the patch its checksum represents. Both readings are self-consistent
against the checksums alone.

## Vin points elsewhere for the specification

Only 3.1% of `Vin` records carry the model, class, OPC and paint. The other
96.9% carry field `A2`, an **XREF** to the serial that does. Follow it or almost
every VIN decodes to a build date and nothing else — which looks exactly like
"not in the data", and is how this went unnoticed: the first VIN tested happened
to be in the 3%.

Two traps around it:

- **Do not solve it with inheritance.** Carrying absent fields forward from the
  record above is right for the catalogue tables and wrong here, and wrong
  _confidently_: for chassis `JMB0RV250R` the nearest preceding record with a
  model says `V23W`, the 2.3 litre, where the XREF says `V25W`.
- **Split a VIN from the right.** The serial is 7 characters in all 5,418,637
  records; the chassis is 10 in 99.26% and **7 in 39,986**. Splitting at a fixed
  offset from the left rejects those forty thousand as malformed.

Both were found by asking "how often is this actually true?" rather than by
reading one record. A sample of 150 real VINs across both halves now decodes
150/150, 144 of them via XREF.

## VInfo is the VIN-to-catalogue bridge

`VInfo.A1` is a model code in the **same vocabulary the catalogues use**, and
`A5` is the catalogue. So a decoded VIN reaches a parts list with no translation
step: `V25W` is both what the VIN says and what `PAJERO/MONTERO(EUR)` lists.

The classification is part of the key, not a refinement. 16 of the 242 models
are listed by more than one catalogue, and the classification separates them —
model _and_ classification pin exactly one catalogue for all 167,446 `Vin`
records that carry a model.

`docs/data-format.md` claimed for several commits that these were different
vocabularies "bridged by VInfo patterns". That was wrong, and it was wrong
because of a bad comparison: `P02V` was checked against `B6037609A`, which is
the Pajero I catalogue and simply not the one for that model. **Before
concluding two code sets are unrelated, check a pair the data says belongs
together.**

## Two languages, and they are not the same one

The catalogue carries its own text in four languages through `Desc`; the
interface speaks English or Polish through `apps/web/src/lib/i18n`. They are
independent, and conflating them is the obvious mistake: `DESC_D` translates a
quarter of the catalogue's strings, so a Polish interface over an English parts
list is the normal case.

**Adding a counted string means adding Polish plural forms.** i18next keys
plurals off `Intl.PluralRules`, so English needs `_one`/`_other` and Polish
needs `_one`/`_few`/`_many`/`_other`. `i18n.test.ts` asserts that from the
language's own categories rather than from a hardcoded list, so a missing
`_many` fails the suite instead of rendering `5 wiersze` to a Polish reader.

Two smaller traps it also covers: a key present in one file and missing in the
other falls back silently, and a sentence that needs markup inside it must stay
whole in the JSON — use `slot()` and `segments()`, because Polish moves the
styled fragment.

And **Polish is longer than English.** Six nowrap column headers overflowed the
parts pane by 17px at a 1500px window; the fix was the shared cell padding, not
a shorter Polish word. Check a dense layout in both.

## A field's label is not its vocabulary

`catalog.E1` is labelled **OPC** in the `.ddm`, and it is not a pack code. A
vehicle's OPC — `H70` — is a pack that `Opc` expands into option codes; `E1` is
one of the _expanded_ codes. Believing the label means testing `E1` against
`H70`, which never matches, and concluding that applicability cannot be
resolved. What settled it was membership: all 365 distinct values are in
`OInfo`, and per row the code lies inside that model's own pack vocabulary in
112,636 of 112,636 cases.

**The general lesson:** when a field's meaning is in doubt, check its values
against every candidate vocabulary in the schema rather than reading its name.
It is a five-minute query and it has now been decisive twice.

Applicability therefore _is_ narrowable — date window, classification list,
expanded option code — but that the three combine with `and` remains an
inference. Keep the switch, keep the hidden-row count visible, and never drop a
row silently.

## The parts table does not key to a plate

`catalog` keys to `(model, main group, subgroup)`. Several plates can share a
subgroup number — `13-010` on a `V25W` is three — and they all read the same
run. **The drawing is the discriminator:** its callouts are its share of the
list. Verified at scale, 99.72% of subgroup codes are claimed by some drawing of
their subgroup.

Do not filter without the two escape hatches: a drawing with no callouts implies
nothing (2,160 plates), and a code that _no_ drawing of the subgroup claims must
stay on every plate of it (2,046 codes) or it disappears everywhere at once.

This is the plate↔parts join, **not** vehicle applicability. Narrowing to one
vehicle by date, OPC and classification is still unresolved — see
`docs/data-format.md`, "What is not established". Do not guess it.

## A tag's declared length can be a lie

Hotspot coordinates live in private TIFF tag `0xfe00`, and **its declared count
is short**: the blob runs past `4 × count` to the end of the file. Trusting the
count truncated the last callouts on 13,653 of 17,977 drawings, mid-record, so
it read as "fewer callouts" rather than as corruption. The check that caught it
was asking whether the parse consumed every byte — the same check that carries
`masax verify`.

Related: **`.cds` files are not data.** They describe the application's
in-memory grids. Concluding from `dsPicPNC.cds` that no hotspot coordinates
existed was reasoning from the wrong artifact, and it stood for several commits.

## Case, across sources

Disc A spells the drawings directory `Illust`; disc B spells it `ILLUST`. An
ISO 9660 mount is **case-sensitive**, and so is the HTTP backend. Two things
followed from that, both caught only by counting:

- An overlay that matched names exactly asked disc B for `Illust`, got nothing,
  and imported **9,402 of the 17,977** drawings while reporting success. The
  overlay now resolves each path segment ignoring case, and `masax import` is
  checked against the union of both discs' paths.
- The client asked for `ILLUST/...` over HTTP against a tree that had `Illust/`,
  so every drawing 404'd. Drawing paths are resolved through
  `AsaCatalogue.readIllustration`, which finds the real directory name once.

The lesson generalises: **a filesystem's case rules are a property of that
filesystem**, and this project reads four kinds. Never hand a whole path to a
layer and assume it matches the way the previous layer did.

## Illustrations are not TIFFs

They are named `*.tif` and they are TIFFs _after_ XOR-ing with `0x0b` -- except
byte 0, which uses `0x31`. Two ways to lose a lot of time here:

- **XOR `0x0b` alone gives `73 49 2a 00`**, one byte off `II*\0`. "Nearly TIFF"
  is more misleading than "not TIFF at all"; it invites a hunt for a container
  format wrapping a TIFF.
- **The statistics say "compressed, not obfuscated".** The payload is CCITT
  Group 4, so entropy is 7.59 bits/byte, all 256 byte values occur, and
  index-of-coincidence is flat at every period from 1 to 64. Every measurement
  says "this is a compression format" and every one of them is a true statement
  about the _plaintext_. Do not let it rule out a cipher on top.

`docs/data-format.md` asserted these were plain TIFFs for one commit. The check
that caught it was running `file`-equivalent logic on the bytes rather than
trusting the extension, which is the general lesson: **verify the container, not
the name.**

## Measure, do not estimate

Sizes and counts in these docs are measured numbers. 194,801 catalogue rows,
237,164 parts in `PBook`, 48,549 English strings, 1,621 distinct plate
illustrations, 18,760 TIFFs — all read off the media, none derived by
arithmetic on a guess.

The same goes for claims about the media. "The two discs merge cleanly" means
the 81 overlapping files were compared with `cmp` and all 81 matched. "`DATA1`
is pristine disc data" means three files were extracted from the ISO and their
MD5s matched `DATA1` and differed from `DATA2`.

## Verify a finding by breaking it

A rule that has never been observed failing has not been shown to matter. Change
the reader so the bug it describes is present, watch the record count drop, then
restore. Every rule in the list above was established that way — the u16 count
rule, for instance, moves `catalog` between 100% and 92–98%.

Two traps found while doing this:

- **Don't trust a reader validated only on small datasets.** A dense reader
  with no bitmap decodes `Desc`, `pnc`, `OInfo`, `SPN`, `SSP`, `pnc_desc`,
  `DudMMC` and `MsgUpd` at 100% — eight datasets, 300,000 records, all green —
  and is completely wrong about the eleven tables that carry the actual
  catalogue. They all happen to have two to four always-present fields.
- **Check what the harness counted.** `catalog`'s template is `@.bin`, which
  glob-matches every `.bin` in the directory. An early sweep reported
  `194980/937544` and looked like a format failure; it was the harness counting
  `PBOOK.BIN` and `DESC_GB.BIN` as catalogues. The 52 real ones were at 100%.

## Reading the binaries

`re/bin/` holds the PE files, all unpacked x86. Read the parser rather than
guessing at bytes, but know what each one actually is:

- `fdtpdll.dll` — the `.pnt` index engine (`LEX_FdtPointer`). Small.
- `LexDdm.dll` — the `.ddm`/`.fdt` schema loader.
- `LexFpi32.dll` — **not** an index engine. FPI is the form/print interface; it
  drives the `.FRM` files. Named misleadingly if you are hunting for "fast
  pointer index".
- `Provide.dll` — MFC settings and text provider (`CPR`), nothing to do with
  the data format.
- `ASA.exe` — the application, and where the record decoding and illustration
  handling live.

Nothing in the format required a decompiler in the end; the `.ddm` comments and
the `.fdt` layout tables are self-describing enough to validate against the
data. Reach for Ghidra for semantics — what a flag _means_ — rather than for
layout.

## Scope

This covers module **M60**, the European passenger-car catalogue, September 2008. `ASAMAIN.ini` also configures `M00`, `M50` and `M80`; those use the same
engine and very likely the same format, but no claim here has been checked
against them. If you add one, say so in the docs and give it its own verify run.
