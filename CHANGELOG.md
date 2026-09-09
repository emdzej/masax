# Changelog

Notable changes, newest first. Findings about the format are listed with the
number that backs them, because a claim about someone else's data is only worth
as much as its evidence — the reasoning behind each one is in
[`docs/data-format.md`](docs/data-format.md).

Versions follow [semantic versioning](https://semver.org/). Before 1.0 a minor
bump is where features land.

## 0.2.0

### An OPC is a pack, and its options resolve

A vehicle's OPC is not a feature — `H70` on a Pajero is a **pack code** that
`Opc` expands into 34 option codes, each resolving through `OInfo` to a
description. The OPC on the vehicle strip is now the button that opens them.

Two things had to be right for the list to be. The date window sits on the
**classification**, not the record: an `Opc` record carries up to 50
`(classification, year, start, end)` entries against one option list, and
`V25W`/`H70` has two records — 34 options for a 1993-11 to 1994-05 build, 35 for
1994-06 to 1995-08. Across all 41,030 `(model, opc)` pairs no two records
overlap in date for the same classification, so the pair selects at most one.
And the stored order is not the display order: `Opc` writes letters before
digits, the original application shows plain ASCII.

Verified against that application's own output for one vehicle: 34 options, same
order, same text.

Measured over every distinct `(model, opc, classification, build date)` in `Vin`
half A — 41,919 of them — 40,898 resolve, 38,283 of those on classification and
build date together. Of the 1,021 that do not, **1,016 have no `Opc` record at
all** for that pair, so the rule is not failing on them.

### Applicability narrows to the vehicle

`catalog.E1` is labelled `OPC` and is **not** a pack code — it is one of the
_expanded_ option codes. Reading the label rather than the values is what made
applicability look unresolvable: `E1` never matches `H70`. All 365 distinct
values are in `OInfo`, and per row the code lies inside that model's own pack
vocabulary in **112,636 of 112,636 rows, with no exceptions**.

So a part row applies when its date window contains the build date, its
classification list contains the vehicle's, and its option code is in the
expanded pack. Across 350 plates of a `V25W` built 1994-03 that takes 4.96 rows
per part-name code down to 1.87; on `13-010 FUEL FILLER PIPE` it is 19 rows down
to exactly 11, one per callout printed on the drawing.

That the three tests combine with `and` is still an inference, so this is a
switch in the parts-list header — on by default — and the number of hidden rows
and the reason are always shown.

### A plate shows its own parts

`catalog` keys to `(model, main group, subgroup)` and does not key to a plate,
so the three `13-010 FUEL TANK` plates on a `V25W` all read the same 70 rows.
Nothing in `BGroup` separates them: those records differ only in their
description text and their `Illustration`. **The drawing is the discriminator**
— its callouts are its share of the list, and over all 60,698 plates that
accounts for 99.72% of subgroup codes.

A code that no drawing of the subgroup claims stays on every plate of it, and a
drawing with no callouts implies nothing. Losing a real part is worse than
showing a spare one.

### Interface language: English and Polish

The interface speaks English or Polish, defaulting to what the browser asks for
and overridable in settings. This is **separate** from the catalogue's own text,
which has its own four languages and its own setting — masax's words and
Mitsubishi's are independent, and the catalogue's coverage is partial.

i18next is here for Polish plurals: `1 wiersz`, `3 wiersze`, `11 wierszy`, and
`13 wierszy` again at the teens. `Intl.PluralRules` gets that right and a
`count === 1` ternary does not.

### Interface

- **Settings has two tabs** — Data location, and User interface carrying the
  language and the theme. The interface tab offers Done rather than Save,
  because both settings apply on the click that sets them.
- **A printable vehicle report** from the strip: everything the record holds,
  including the `SEF`, `BCC`, `BCF` and `CFC` fields whose meaning is not
  established, under their own codes. One sheet, black on white whatever theme
  is set.
- **Copy the drawing** to the clipboard as a PNG, and **copy a part number or
  name** from its own cell — revealed on hover where there is a hovering
  pointer, and on the selected row where there is not.
- **Dark theme**, with a third state that follows the system and keeps following
  it. The plate is repainted light-on-dark from the decoded bitmap rather than
  filtered, so the callout highlights stay red.
- **Drag to pan** the drawing at actual size, with a threshold so a drag across
  a callout does not select it.
- Versions lost their `v` prefix, in the display and in the release link.

### Fixed

- The dialog scrim was a wash of `--ink`, which is the _text_ colour — in dark
  it lightened the page instead of dimming it. It has its own token now.
- A filled accent button at the generic disabled opacity was unreadable on dark.
- The parts count read `19 / 11 codes`, which parses as "19 of 11". It names
  both numbers now.
- The narrowing checkbox is drawn rather than native: Safari and Firefox enforce
  a minimum size regardless of `width`, and against 7.25px cap height an 11px
  box reads as misaligned however well it is centred.
- The report printed nothing at first — `#app > *` beats a Svelte-scoped class
  on specificity even with both `!important`, so it was hidden along with the
  interface.
- Six nowrap column headers overflowed the parts pane in Polish. Fixed in the
  shared cell padding rather than by shortening a Polish word.

### Repository

- [`docs/how-it-works.md`](docs/how-it-works.md) — how ASA works and how to
  rebuild it: the pipeline, the join graph, the algorithms, the traps, and a
  13-step build order where every step has a number to check against. It closes
  with the claims that turned out to be wrong.
- [`docs/guide.md`](docs/guide.md) — the user guide: mounting both discs and why
  both, the folder picker against the HTTP fallback, and how to read a plate.
- `MASAX_DATA` takes a module directory **or** one holding a module; the
  previous requirement was undocumented and the failure blamed the data.
- The Python reader that preceded `packages/lex` is gone, superseded by
  `masax verify`. `re/tools/` keeps `unwise.py` and `delta.py`, which cover the
  update-package format and have no TypeScript equivalent.

### Known limits

- Whether the three applicability tests combine with `and`, and whether an empty
  field means "all" or "unknown". Settling it needs a plate whose correct list
  is known from outside the data.
- `ApplicableCodes` (`E3`) is unresolved: a four-plus-three character pair such
  as `BD2 72H` that resembles a colour and trim combination without matching
  either vocabulary well enough to claim.
- `DESC_J` is stored as half-width katakana rather than Latin-1, so Japanese
  catalogue text renders as mojibake. The other three are fine.
- No search by part number or label yet, and `rep` supersession chains are read
  but not surfaced.

## 0.1.0

The format, decoded and read.

- **9,495,097 records** decode exactly on the original media, every one checked
  to consume its declared payload length, plus three structural invariants: the
  sequential walk ends at end of file, every index offset lands on a record
  boundary, and the declared run keys match the data.
- The index covers about a fifth of those. It points at the first record of a
  **run**, and later records inherit the run-key fields they omit — inheriting
  anything more corrupts applicability.
- **All 17,977 drawings decode.** They are named `.tif` and are not TIFFs until
  de-obfuscated: every byte XOR `0x0b`, except byte 0 which uses `0x31`. The
  CCITT Group 4 decoder is pixel-identical to a reference implementation.
- **Callout hotspots** live in the image, in private TIFF tag `0xfe00`, whose
  declared count is short — the blob runs to end of file. 371,928 hotspots in
  16,938 drawings, 0 bytes unparsed.
- **VIN decoding**, locally. The split is from the right, because only the
  7-character serial has a fixed length, and the `A2` cross-reference has to be
  followed: without it 96.9% of VINs decode to a build date and nothing else.
- **A VIN alone reaches a parts list.** `VInfo` maps model and classification to
  a catalogue, unambiguously across all 167,446 spec-bearing records.
- A Svelte client with no backend and no data server, reading a mounted disc in
  place over `csfs`; a CLI with `survey`, `import`, `verify`, `show`, `vin`,
  `serve` and `illust`; and CI plus Pages to
  [masax.emdzej.pl](https://masax.emdzej.pl).
