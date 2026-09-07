# Plan

Why masax is shaped the way it is: what the discs contain, the architectural
consequence of the storage format, and the order of work.

Read [`data-format.md`](data-format.md) first — the plan follows from the format.

## 1. The decisive finding

ASA addresses every record as an **offset in a `.bin`, taken from a sorted
`.pnt` index**. A record read is "two bytes at `offset` for the length, then
that many bytes", which is byte-for-byte the shape of an HTTP `Range` request
and of `File.slice()` in a browser.

So the reader interface is one method:

```ts
read(pos: number, len: number): Promise<Uint8Array>
```

with backends for HTTP `Range`, a picked directory, an in-memory buffer, and
`fs.read()` in the CLI. **The same engine runs over all of them**, and the
consequence is that **the data does not need converting** — a static host can
serve the vendor's own files.

Better still, the index is _monotonic_: entry `i`'s run ends where entry `i+1`
begins. A run is therefore one bounded read, averaging 186 bytes for `Vin`. A
VIN decode against a 76 MB file downloads about two hundred bytes.

## 2. Sizing — is client-side-only feasible?

Measured on the original media, `EPC/DATA1`:

|                         | Bytes       | How it is used                         |
| ----------------------- | ----------- | -------------------------------------- |
| `.pnt` indexes          | **25.4 MB** | preloaded, gzipped over the wire       |
| `.bin` data             | 405.8 MB    | **never fully downloaded** — run reads |
| Drawings, ~18,800 files | ~210 MB     | one fetch and decode per plate         |
| `.ddm`/`.fdt` schemas   | 40 kB       | read at open                           |

What the client actually holds at startup is the navigation and text tables —
`Desc` 1.3 MB, `pnc` 368 kB, `MGroup` 93 kB, `SGroup` 1.1 MB, `BGroup` 2.4 MB —
plus the two `Vin` indexes at 4.5 and 5.2 MB. Around 15 MB, comparable to
dialogysx's 17 MB.

The one thing held per selection is a catalogue's parts table, 0.3 to 28 MB.
That is a deliberate exception: `catalog` is keyed by part-name code only, so
the index cannot answer "what is on this plate", and there is no derived index
yet. Fetching the catalogue once and grouping it in memory is simpler than
inventing one, and 4 MB is the typical case.

**Verdict: purely client-side, no backend.** Built and running.

Unlike the Renault equivalent, **VIN decoding works locally**: `Vin` holds 5.4 M
records across the two halves, and identification is a lookup rather than an
algorithm.

## 3. Architecture

Two top-level homes: `apps/` for what you run, `packages/` for what they share.

```
apps/
  web        Svelte 5 + Vite browser client
  cli        verify the format, walk the data, decode VINs and drawings
packages/
  core       shared vocabulary and the YYYYMMT date
  lex        the storage engine: .ddm/.fdt, the .pnt index, .bin records, Reader
  illust     the drawings: de-obfuscation and a CCITT Group 4 decoder
  catalogue  the domain: catalogues, groups, plates, parts, VIN, text
  importer   disc classification and merge                        (not built)
  search     part-number and label search over derived indexes    (not built)
docs/
```

Mirroring dialogysx's stack and conventions: pnpm workspaces, turbo, TypeScript
project references with `strict` and `noUncheckedIndexedAccess`, Svelte 5,
Vite 6, vitest with `playwright-core` for the browser tests, prettier at
`printWidth: 100`, PolyForm Noncommercial.

### Why `illust` is its own package

The drawings are Group 4 TIFFs behind a byte obfuscation, and no browser renders
either. Decoding client-side rather than converting at import is what keeps the
"serve the vendor's files" property and lets the app work straight off a mounted
disc. It costs a codec — about 400 lines and the T.4/T.6 tables — and buys the
absence of an import step.

Converting is available (`masax illust --png`) but is for interoperability, not
size: PNG comes out _larger_ than the Group 4 original, 172 MB against 121 MB.

## 4. Order of work

**Phase 1 — the engine. Done.** `packages/lex` in TypeScript, with the Python
in `re/tools` as a differential oracle. `masax verify` ships with it and _is_
the test: 9,495,097 records on the original media, every one consuming exactly
its declared length, plus the three structural invariants.

**Phase 2 — the read path, no UI. Done.** `packages/catalogue`, exercised
through `masax show` and `masax vin` before any pixels existed.

**Phase 3 — the drawings. Done.** `packages/illust`, pixel-identical to a
reference decoder on every drawing sampled, and all 10,694 on disc B decode.

**Phase 4 — the web client. Done for browsing.** Catalogue → model → group →
plate, the drawing on a canvas beside the parts table, VIN decoding, four
languages. 30 kB gzipped, no backend. Four browser tests walk the chain over
HTTP `Range`, including that the canvas is actually painted rather than left
blank.

**Phase 5 — applicability. Not started, and deliberately not guessed.** This is
the part that decides which parts fit which vehicle, and it is unresolved:

- `catalog` carries `OPC`, `Classification`, `ApplicableCodes` and a date
  window per part, and `Vin` gives a vehicle's OPC, classification and build
  date. The vocabularies plainly relate, but how ASA _combines_ them has not
  been established.
- The `Vin` model code (`P02V`) and the catalogue model code (`L042G`) are
  different vocabularies. `VInfo` bridges them with patterns — `PA-PD#`,
  `P13,15T`, `L0/P0#` — which need a matcher and are not implemented.

So the client shows every part on a plate with its conditions visible, and does
not filter. A filter that is wrong hides a part that fits or offers one that
does not, and neither failure announces itself. Signing this phase off needs a
vehicle whose correct parts list is known from outside this data.

**Phase 6 — search.** Part-number lookup exists in the reader (`PREF` and
`PBook` are fully indexed) but is not in the interface. Part-name search wants
the `DudMMC` word index. Both need a derived index to be quick over HTTP.

**Phase 7 — import and offline.** `masax manifest` describes a static tree
today. A disc importer (merging the two ISOs, which are known to merge without
conflict) and an OPFS backend for genuine offline use are the natural next
steps; the `Source` interface already makes them backends rather than redesigns.

## 5. Ranked risks

1. **Applicability semantics** (Phase 5). Understood by example, not specified;
   the failure mode is quiet and wrong. Mitigation: do not filter until there is
   a known-answer test.
2. **Field inheritance.** Already bitten once — see
   [`AGENTS.md`](../AGENTS.md). Only run-key fields are inherited, the run keys
   are derived from the data, and `masax verify` re-derives them so a stale
   declaration fails rather than rots.
3. **Per-catalogue full fetch.** 28 MB for the largest catalogue on a cold cache
   is not pleasant. Mitigation if it matters: derive a (model, group, subgroup)
   index at import and go back to run reads.
4. **File System Access API support.** Chrome and Edge only. Firefox and Safari
   users need the HTTP path, and the interface says so rather than failing
   obscurely.
5. **Licensing and redistribution.** The data is Mitsubishi's. `data/` is
   git-ignored, so are `re/bin/` and any extracted tree, and the app ships
   without data.

## 6. Data is not redistributable

- No fixture in this repository may be derived from the discs. The format tests
  build synthetic bytes; the real data is covered by `masax verify`.
- No VIN in a commit, test, or doc. The VINs in these documents are constructed
  from a chassis prefix and a serial that appear in the data separately.
- The app ships **without** data: the user supplies a disc or points at their
  own static tree.

## 7. Deliberately out of scope

Recorded so nobody re-adds it: **pricing** (`Price`, `ExtPrice`, `ASAExtPrice`)
and the **labour-time guide** (the `dsLTG*` datasets and `ASALTG.dll`). Their
formats may be documented where they share the storage engine, but no feature is
built on them. Neither ships with data on the European media.
