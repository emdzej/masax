# masax

Reverse-engineering the **Mitsubishi After Sales Application** (ASA) — the
electronic parts catalogue for Mitsubishi vehicles — so its data can be read
without the original Windows application.

In the spirit of [dialogysx](../dialogysx), which does the same for
Renault/Dacia's Dialogys.

## Status

The container format is fully decoded and the schema is understood end to end.

```
$ python3 re/tools/verify.py <media>/M60
1889570/1889570 records decode exactly (100.0000%)
```

That is every record of every dataset on the original media, each one checked
to consume exactly its declared payload length. A fully updated installation
(`EPC/DATA2`, update level 89) also reads at 100% — 3,854,258 records.

Joins are proven, not assumed. Walking VIN → model → group → plate → parts on
catalogue `B6037609A` yields real, correctly described parts:

```
model L042G, main group 13, subgroup 010   (plate 113_0103KC1A0T)
PNC      PartNumber   Qty  from      to        description
05100A   MB247182     01   1983011   1986043   FUEL TANK ASSY
05114    MB247387     01   1983011   1986043   CAP,FUEL TANK
05145    MB408473     01   1983011   1987053   GAUGE UNIT,FUEL TANK
05152    MB129895     01   1983011   1991061   FILTER,FUEL IN TANK
```

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
re/tools/lexdb.py    the reader: .ddm/.fdt/.bin/.pnt
re/tools/verify.py   decode everything and check every record's length
re/tools/stage.sh    copy the PE binaries worth decompiling into re/bin/
```

```sh
# extract the original media and verify it
unzip -p ASA_EUROPE.zip MMC_ASA_EUR_A.iso | bsdtar -xf - -C out/
unzip -p ASA_EUROPE.zip MMC_ASA_EUR_B.iso | bsdtar -xf - -C out/
python3 re/tools/verify.py out/M60

# print the schema of every dataset
python3 re/tools/verify.py out/M60 --schema
```

## Licence and intent

This is interoperability work on a 2008 catalogue: understanding a data format
so the information can be read on current systems. No Mitsubishi or LexCom data
is redistributed here — only format documentation and code that reads media you
already have.
