# masax

Reverse-engineering the **Mitsubishi After Sales Application** (ASA) — the
electronic parts catalogue for Mitsubishi vehicles — so its data can be read
without the original Windows application.

In the spirit of [dialogysx](../dialogysx), which does the same for
Renault/Dacia's Dialogys.

## Status

The container format, the schema, the illustrations, the update packages and
their checksum are all decoded.

```
$ masax verify <media>/M60
9495097 records decode exactly, 1889570 of them reachable through an index
```

That is every record of every dataset on the original media, each checked to
consume exactly its declared payload length, plus three structural invariants:
the sequential walk ends exactly at the end of the file, every index offset
lands on a record boundary, and the declared run keys match the data.

The gap between the two numbers is the point: the `.pnt` index covers only about
a fifth of the records. It points at the first record of a **run**, and later
records in a run inherit the fields they omit — see
[`docs/data-format.md`](docs/data-format.md#runs-and-the-fields-a-record-inherits).

Every one of the parts drawings decodes — 10,694 of 10,694 on disc B and
17,977 across both, none failing. They are stored as `*.tif` but are **not** TIFFs until de-obfuscated,
and the Group 4 decoder in `packages/illust` is pixel-identical to a reference
decoder on every drawing tested — see
[`docs/data-format.md`](docs/data-format.md#illustrations).

Joins are proven, not assumed. Walking VIN → model → group → plate → parts on
catalogue `B6037609A` yields real, correctly described parts:

```
model L042G, main group 13, subgroup 010   (plate 113_0103KC1A0T)
PNC     part        from     to       classification
05021   MB247230    1983011  1986043  -
05021   MB247230    1986051  1991061  NJL6,VNJL6,VNJR6
05021   MB504621    1986051  1991061  NJQL6,VNJQL6
05100A  MB247182    1983011  1986043  -
05100A  MB248375    1986051  1987053  NJL6,NJQL6,VNJL6,VNJQL6,VNJR6
```

42 parts across 30 part-name codes on that one plate — two part numbers for
`05021` in the same date window, separated by classification, which is what
applicability is.

The drawing for that plate, `113_0103KC1A0T.tif`, carries exactly those callout
numbers — an independent check on both the joins and the image decode.

## Getting the data in

**Mount the ISOs and point masax at the mount points.** Nothing is extracted,
nothing is converted, and the catalogue is read where it lies.

```sh
hdiutil attach -readonly MMC_ASA_EUR_A.iso     # macOS → /Volumes/MMC-A
hdiutil attach -readonly MMC_ASA_EUR_B.iso     #       → /Volumes/MMC ASA 2

masax survey /Volumes/MMC-A "/Volumes/MMC ASA 2"
masax verify /Volumes/MMC-A "/Volumes/MMC ASA 2"    # 9,495,097 records
```

Neither disc is complete — disc A carries 30 of the 52 catalogues and one half
of the vehicle index, disc B the rest — so the mount points are _overlaid_
rather than chosen between. `masax import` copies that overlay into one tree,
byte-for-byte, when you want a single thing to host or keep:

```sh
masax import /Volumes/MMC-A "/Volumes/MMC ASA 2" -o data/M60
```

## The app

A Svelte 5 client, 47 kB gzipped, no backend and no data server.

On first run it asks where the data is, and that choice is remembered — the same
panel is reachable later from the gear. **Choosing a folder is the primary path**:
`File.slice()` is a range read, so a mounted disc is read in place and a 76 MB
`VIN.BIN` never leaves it. Add both discs and they are overlaid the way the CLI
does it. A hosted tree over HTTP is the fallback, for browsers without the File
System Access API; OPFS can keep a copy for offline use.

```sh
pnpm dev        # then point it at a folder — no data server involved
```

The car sits in a toolbar across the top — VIN, catalogue, model — with the
decoded vehicle on a strip beneath it, so "which car am I looking at" stays on
screen. Group and plate are filterable lists on the left, matching on the number
as well as the name, because the number is often what you already know. The
drawing gets the larger share of the width, with the parts beside it.

Light and dark, with a third state that follows the system and keeps following
it. Dark repaints the plate light-on-dark from the decoded bitmap rather than
filtering it — a 960x1210 white rectangle is the largest thing on screen, and a
CSS filter would invert the callout highlights with it.

The drawings are Group 4 TIFFs behind a byte obfuscation, so they are decoded in
the browser rather than converted first — which is what lets the app read a disc
directly and a static host serve the vendor's own files unchanged.

The read boundary is [`csfs`](https://www.npmjs.com/package/@emdzej/csfs-core):
a `CsFile` is `Blob`-shaped, so `slice(pos, pos + len).bytes()` is exactly the
record read this format needs, over a picked directory, OPFS, HTTP `Range` or
`node:fs` without changing a line of the engine.

Ten browser tests walk the whole chain over HTTP `Range` — including that the
canvas is actually painted rather than left blank, that a callout links to its
row and back, and that three plates sharing a number get three different lists.

Decoding a VIN opens the catalogue and model it belongs to, so a VIN alone gets
you to a parts list — `VInfo` supplies that mapping, and the model code is the
same one the catalogues use: `V25W` is both what the VIN says and what
`PAJERO/MONTERO(EUR)` lists.

**A plate shows its own parts, not its subgroup's.** `catalog` keys to
`(model, main group, subgroup)` and does not key to a plate, so the three
`13-010 FUEL TANK` plates on a `V25W` all read the same 70 rows. What separates
them is the drawing: its callouts are its share of the list — 11, 33 and 29
codes across the three, union exactly the 47 the run holds. Over all 60,698
plates the rule accounts for **99.72%** of subgroup codes and halves a plate's
list. A code that no drawing of the subgroup claims stays on every plate of it,
because losing a real part is worse than showing a spare one.

**Applicability to a particular vehicle is still not filtered.** Every surviving
row is shown with its conditions visible — OPC, classification, applicable
codes, date window. How ASA combines those into "fits this vehicle" has not been
established here, and a wrong filter hides a part that fits or offers one that
does not without saying so. See
[`docs/data-format.md`](docs/data-format.md#what-is-not-established).

## Read this next

- **[`docs/guide.md`](docs/guide.md)** — the user guide: mounting the discs,
  importing, and finding a part.
- **[`docs/how-it-works.md`](docs/how-it-works.md)** — how ASA works and how to
  rebuild it: the pipeline, the join graph, the algorithms, the traps, and a
  build order where every step has a number to check against.
- **[`docs/plan.md`](docs/plan.md)** — why the project is shaped this way, the
  sizing that makes it client-side, and what is deliberately not done yet.
- **[`docs/data-format.md`](docs/data-format.md)** — the format specification:
  `.ddm`/`.fdt`/`.bin`/`.pnt`, the presence bitmap, groups and arrays, the
  Mitsubishi schema, date encoding, illustration naming.
- **[`docs/media.md`](docs/media.md)** — what the source archives are and how to
  build a bundle from the original discs.
- **[`AGENTS.md`](AGENTS.md)** — conventions, and the traps that have already
  cost time here.

## What it is underneath

ASA is not Mitsubishi-built. The engine is **LexCom Informationssysteme**'s
(Munich) — `LexDdm.dll`, `fdtpdll.dll`, volume label `LexASAM60`. The same
engine appears in other OEM catalogues, so most of `docs/data-format.md`
describes LexCom's format rather than anything Mitsubishi-specific.

One module of a larger family: `ASAMAIN.ini` also configures `M00`, `M50` and
`M80`. This work covers **M60**, the European passenger-car catalogue,
September 2008.

## Tools

```sh
pnpm install && pnpm build

masax verify out/M60                 # every record, every invariant
masax verify out/M60 --schema        # print each dataset's schema
masax verify out/M60 --run-keys      # what the data says about inheritance

masax show out/M60                                  # list catalogues
masax show out/M60 B6037609A L042G 13 10            # a plate and its parts
masax vin  out/M60 JMAGZP02VHA000001                # decode a VIN

masax illust out/M60/ILLUST --check                 # decode every drawing
masax illust out/M60/ILLUST -o png/ --png           # convert them
masax serve out/M60 -a apps/web/dist                # host the tree and client
```

`re/tools/` holds the two format tools with no TypeScript equivalent —
`unwise.py` for the Wise self-extractors the update packages ship as, and
`delta.py` for the `.U<nn>` record deltas and their checksum. Neither is needed
to read the media; they are what backs the update-package sections of
[`docs/data-format.md`](docs/data-format.md#delta-updates). The Python reader
that preceded `packages/lex` is gone: it validated only the indexed records,
which is how the record count came to be understated fivefold.

## Licence and intent

This is interoperability work on a 2008 catalogue: understanding a data format
so the information can be read on current systems. No Mitsubishi or LexCom data
is redistributed here — only format documentation and code that reads media you
already have.
