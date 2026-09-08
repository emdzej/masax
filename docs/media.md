# Building a bundle from original media

## What the source archives actually are

| Archive                        | Contents                                                              | Verdict                           |
| ------------------------------ | --------------------------------------------------------------------- | --------------------------------- |
| `ASA_EUROPE.zip` (371 MB)      | `MMC_ASA_EUR_A.iso` (440 MB), `MMC_ASA_EUR_B.iso` (350 MB)            | **the original media** — use this |
| `MMC_ASA_M60_803.exe` (372 MB) | self-extracting **RAR5**; payload is an already-installed `M60/` tree | a repack, not media               |
| `rev/ASA.zip` (367 MB)         | a dump of `C:\MMC\ASA` after installation                             | useful as a reference target      |

`MMC_ASA_M60_803.exe` is a PE whose last 99.9% is a RAR5 archive carrying a
Cyrillic comment. It holds an installed tree with delta updates already folded
in, so its `DATA1` has newer catalogue revisions than the discs. Treat it as
someone's convenience repack.

## The two discs

`ASAMAIN.ini` records `NumCDs=2`, `InstType=B`, `Components=A`,
`CDName=LexASAM60`, `CDDate=2008-09-19`. The two ISOs are those two discs.

```
MMC_ASA_EUR_A.iso     MMC_ASA_EUR_B.iso
  M60/EPC/DATA1/        M60/EPC/DATA1/
    A/                    B/                 <- per-disc VIN and PREF indexes
    <shared tables>       <shared tables>    <- identical on both discs
    <30 catalogues>       <22 catalogues>    <- disjoint
  M60/Illust/           M60/ILLUST/          <- note the case difference
  M60/PROG/                                  <- the application, disc A only
  M60/GfxUpd/                                <- disc A only
  M60/{Client,Server,Install,Updates}/       <- installer, disc A only
  M60/{Hardlock,HaspHL,Prg_Hasp,Prg_HL}/     <- dongle drivers, disc A only
  UPDATE/asacm60e056..089.exe                <- 34 delta updates, disc A only
```

**The discs merge cleanly.** 81 files appear on both, and all 81 are
byte-identical — verified with `cmp`, not assumed. There is no collision to
resolve, unlike some other OEM disc sets. Merge order does not matter.

Between them the discs carry all 52 catalogues, both VIN index halves
(`DATA1/A` and `DATA1/B`), and all four installed languages
(`DESC_D`, `DESC_F`, `DESC_GB`, `DESC_J`).

`M60/ILLUST` on disc B and `M60/Illust` on disc A differ only in case; on a
case-insensitive target they are one directory. Do not let a case-sensitive
merge produce two.

Disc A also has a `crack/` directory. It is not Mitsubishi's — the application
is dongle-locked (`Aladdin=HaspHL`, `MMC_Hasp.exe`, `LxMMhdl_Hasp.dll`) and
whoever mastered the ISO added a bypass. It has nothing to do with the data and
is not needed to read it.

## Base data versus updates

`EPC/DATA1` on the discs is the base dataset. `ASAMAIN.ini` in the reference
dump says `UPDLEVEL_EPC=89`, and disc A ships `UPDATE/asacm60e056.exe` through
`asacm60e089.exe` — so a fully patched installation is **base media plus 34
delta updates**, applied by `PROG/DeltaUpd.exe`.

This is directly observable. Against `MMC_ASA_EUR_A.iso`:

```
M60/EPC/DATA1/B60318A8A.bin   identical to the dump's DATA1   (md5 b02daeba…)
M60/EPC/DATA1/PBOOK.BIN       identical to the dump's DATA1   (md5 0e243979…)
                              differs from the dump's DATA2
```

So in an installed tree, **`DATA1` is pristine disc data and `DATA2` is the
updated copy**. Catalogue revisions bump their second-to-last character:
`B60318A8A` on the media becomes `B60318A9A` after updating; likewise
`B603D507A` → `B603D508A` and `B603N608A` → `B603N609A`.

A bundle built from the ISOs alone is complete and internally consistent — it
is simply the September 2008 release rather than update level 89.

The update packages **are** unpacked now — they are Wise Installer
self-extractors, and `re/tools/unwise.py` recovers their payloads. Each carries
a plain-text recipe for `DeltaUpd.exe` plus `.U<nn>` record deltas, both
documented in [`data-format.md`](data-format.md#delta-updates). The recipe's checksum is
reflected CRC32 with a zero init and no final complement, and it describes the
target _after_ patching — see
[`data-format.md`](data-format.md#the-checksum).

**The shipped delta chain is not applicable to these discs.** None of the 769
published checksums matches any media file, while the same search finds 77
matches against an update-derived installation. The discs are a freshly
mastered 2008-09-19 snapshot rather than the output of the chain, so their bytes
differ from an updated tree even where the content agrees. Updates 056-089 are
there to bring older installations forward. If you want a level-89 tree, take it
from an installation that reached it, not by patching this media.

Record counts, media versus the updated dump:

|                               | media (`DATA1`) | updated (`DATA2`) |
| ----------------------------- | --------------- | ----------------- |
| catalogues                    | 52              | 55                |
| `catalog` rows                | 194,801         | 206,416           |
| `PBook` rows                  | 237,164         | 242,288           |
| `Desc` strings (×4 languages) | 48,549          | 49,708            |

## Extracting without a Windows install

The ISOs are plain ISO 9660 and stream straight out of the zip:

```sh
unzip -p ASA_EUROPE.zip MMC_ASA_EUR_A.iso | bsdtar -xf - -C out/
unzip -p ASA_EUROPE.zip MMC_ASA_EUR_B.iso | bsdtar -xf - -C out/
masax verify out/M60                        # expect 9,495,097 records
```

No installer, no dongle, and no registry state is needed to read the data — the
format is self-describing and the setup program only copies files and applies
updates.

## What a bundle needs

Required for a working catalogue:

- `M60/EPC/DATA1/**` — every `.ddm`/`.fdt`/`.bin`/`.pnt`, both `A/` and `B/`
- `M60/ILLUST/**` — the drawings, ~18,800 TIFFs

Optional, and only if you want to run or study the original application:

- `M60/PROG/**` — the app, print forms (`.FRM`), help (`.chm`)
- `M60/{Hardlock,HaspHL,Prg_Hasp,Prg_HL}` — dongle drivers
- `UPDATE/asacm60e*.exe` — the delta updates
- `M60/GfxUpd/**` — replacement illustrations shipped with updates

`ASAMAIN.ini` is per-installation configuration (absolute `C:\MMC\ASA` paths, a
dongle password, printer fonts). It is worth keeping for the metadata it
records — `CDDate`, `UPDLEVEL_EPC`, the language selection — but nothing in the
data depends on it.
