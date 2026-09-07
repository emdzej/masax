# Working on masax

Notes for anyone — human or agent — changing this repository. Conventions, and
mostly the ones learned by getting them wrong. For how the format works read
[`docs/data-format.md`](docs/data-format.md); for what the source archives are
read [`docs/media.md`](docs/media.md).

This is a parts catalogue. A wrong applicability decision puts a part on a
vehicle it does not fit, and nothing in a passing test run will tell you.

## Before you finish

```sh
python3 re/tools/verify.py <a merged media tree>/M60
```

Expect `1889570/1889570 records decode exactly (100.0000%)`. Against a fully
updated installation, expect `3854258/3854258`. **Anything less than 100% is a
regression**, not an acceptable margin — the format is fully understood, so a
single failing record means the change is wrong or the input is damaged.

`verify.py` is the whole test suite on purpose. The check it performs — decode
every record and assert it consumes exactly its declared payload length — is
strong enough that no unit test has yet caught something it missed. It found
every bug listed below.

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

## Illustrations are not TIFFs

They are named `*.tif` and they are TIFFs *after* XOR-ing with `0x0b` -- except
byte 0, which uses `0x31`. Two ways to lose a lot of time here:

- **XOR `0x0b` alone gives `73 49 2a 00`**, one byte off `II*\0`. "Nearly TIFF"
  is more misleading than "not TIFF at all"; it invites a hunt for a container
  format wrapping a TIFF.
- **The statistics say "compressed, not obfuscated".** The payload is CCITT
  Group 4, so entropy is 7.59 bits/byte, all 256 byte values occur, and
  index-of-coincidence is flat at every period from 1 to 64. Every measurement
  says "this is a compression format" and every one of them is a true statement
  about the *plaintext*. Do not let it rule out a cipher on top.

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
data. Reach for Ghidra for semantics — what a flag *means* — rather than for
layout.

## Scope

This covers module **M60**, the European passenger-car catalogue, September
2008. `ASAMAIN.ini` also configures `M00`, `M50` and `M80`; those use the same
engine and very likely the same format, but no claim here has been checked
against them. If you add one, say so in the docs and give it its own verify run.
