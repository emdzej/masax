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

Every one of the parts drawings decodes: 10,694 of 10,694 on disc B, none
failing. They are stored as `*.tif` but are **not** TIFFs until de-obfuscated,
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

## Read this next

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

```
re/tools/lexdb.py     the reader: .ddm/.fdt/.bin/.pnt
re/tools/verify.py    decode everything and check every record's length
re/tools/illust.py    de-obfuscate the parts drawings
re/tools/deillust.py  convert or validate an ILLUST tree
re/tools/unwise.py    extract the payloads from an asacm60e*.exe update
re/tools/delta.py     parse the .U<nn> record deltas
re/tools/stage.sh     copy the PE binaries worth decompiling into re/bin/
```

```sh
# extract the original media and verify it
unzip -p ASA_EUROPE.zip MMC_ASA_EUR_A.iso | bsdtar -xf - -C out/
unzip -p ASA_EUROPE.zip MMC_ASA_EUR_B.iso | bsdtar -xf - -C out/
python3 re/tools/verify.py out/M60

# print the schema of every dataset
python3 re/tools/verify.py out/M60 --schema

# the drawings are XOR-obfuscated TIFFs -- check and convert them
python3 re/tools/deillust.py --check out/M60/ILLUST
python3 re/tools/deillust.py --all out/M60/ILLUST tiffs/
```

## Licence and intent

This is interoperability work on a 2008 catalogue: understanding a data format
so the information can be read on current systems. No Mitsubishi or LexCom data
is redistributed here — only format documentation and code that reads media you
already have.
