# Changelog

Notable changes, newest first. Findings about the format are listed with the
number that backs them, because a claim about someone else's data is only worth
as much as its evidence — the reasoning behind each one is in
[`docs/data-format.md`](docs/data-format.md).

Versions follow [semantic versioning](https://semver.org/). Before 1.0 a minor
bump is where features land.

## 0.3.1

### Fixed

- The toolbar sat its wordmark and tool icons on the inputs' baseline, which
  left them pinned to the bottom edge of the bar — the three fields are
  label-over-input and so twice their height. They centre on the bar now, with
  the fields still setting that height. The bar's bottom padding was also a
  hair short of its top, which biased the centre once there was a centre to
  bias.

## 0.3.0

### A parts bin

A cart in the toolbar collects what you have decided to order. Adding from a
plate's list takes the quantity the plate fits, and adding a number already in
the bin raises that quantity rather than opening a second line — it is keyed by
part number, and a bolt is a bolt however many plates list it.

Each line carries where it came from: catalogue, model, plate and the VIN that
was in the toolbar. That provenance is the difference between a list somebody
else can act on and a column of numbers. The bin prints as a pick list,
quantity first, and exports as CSV with every field quoted — part names contain
commas as a matter of course.

It is persisted, because a bin assembled across a dozen plates is the one piece
of state in masax with real work in it.

### Notes on a part number

`MS240141` is `BOLT,FUEL FILLER PIPE` in the catalogue, which does not tell you
it is M6×10. A note attaches that to the number and then follows it everywhere
it appears — every plate that lists it, the bin, the printed pick list, the CSV.
Shown inline rather than behind the icon: a note you have to hover to find is a
note you have to already know about.

Notes are keyed by part number and not scoped to a catalogue or model, and they
export and import as JSON from a **Notes** tab in settings. Import merges,
newest wins, so taking a colleague's notes does not discard your own. They are
also the only thing in masax that cannot be re-read from the discs, which is why
they are the only thing with an export.

### Searchable catalogue and model

Both are comboboxes now, filtering on the label, the key and the hint. The
catalogue list needed it: **16 of the 52 catalogues share a name**, and the four
`PAJERO/MONTERO(EUR)` entries are the Pajero 1 through 4. Each row therefore
carries its production span, which is what actually separates them — and what a
user is choosing between, since the model codes underneath differ completely
between generations.

### Fixed

- `download()` wrote a UTF-8 BOM unconditionally. It is right for a CSV, and it
  makes `JSON.parse` refuse the file — so the notes export could not be
  imported back. Opt-in now, with the round trip under test.
- The interface tab of settings showed `Forget` and `Open catalogue`, which act
  on the data and mean nothing beside a theme picker. The footer follows the tab.
- `settings.tab.notes` reached the interface as literal text. The suite now
  walks every static `t("…")` call in the client and fails on a key that does
  not exist, which is a better guarantee than a runtime fallback.
- A dead `bin.lines`/`bin.pieces` pair and a dead `note.count` sat beside their
  plural forms, where i18next v4 never reads them. The key-parity test caught
  all three.

### Repository

- The parts-bin component is `PartsBin.svelte`, not `Bin.svelte`: a component
  and a store differing only in case make `./bin.svelte` ambiguous on a
  case-insensitive filesystem.
- The toolbar controls carry names rather than positions. Inserting the cart
  ahead of them turned `.tools button.icon:first` into a different button and
  quietly opened a dialog over half the test suite.

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
