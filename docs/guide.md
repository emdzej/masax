# Using masax

Getting your own copy of the catalogue in, and finding a part once it is.

masax reads the After Sales Application discs you already own. It ships no
catalogue data, uploads nothing, and needs no server — the browser reads the
files where they lie.

---

## 1. What you need

- **The ASA media.** Two ISOs for module M60 (European passenger cars,
  September 2008), or a folder someone already imported from them.
- **A browser with the File System Access API** — Chrome, Edge, or another
  Chromium — if you want to point masax straight at a folder. Firefox and Safari
  can still use a hosted copy; see [§5](#5-if-your-browser-cannot-pick-a-folder).
- **Node 22 and pnpm**, only if you want the command-line tools or to run the
  client locally.

Nothing needs installing on Windows, and the original application is not
required.

## 2. Mount the discs

The discs are read in place. Do not unzip anything into a folder tree by hand —
the two discs overlap and the merge has a subtlety to it (see step 3).

**macOS**

```sh
hdiutil attach -readonly MMC_ASA_EUR_A.iso     # → /Volumes/MMC-A
hdiutil attach -readonly MMC_ASA_EUR_B.iso     # → /Volumes/MMC ASA 2
```

**Linux**

```sh
sudo mkdir -p /mnt/asa-a /mnt/asa-b
sudo mount -o loop,ro MMC_ASA_EUR_A.iso /mnt/asa-a
sudo mount -o loop,ro MMC_ASA_EUR_B.iso /mnt/asa-b
```

**Windows** — right-click each ISO and choose _Mount_; they appear as drive
letters.

Check that masax recognises them:

```sh
masax survey /Volumes/MMC-A "/Volumes/MMC ASA 2"
```

## 3. Both discs, always

**Neither disc is complete.** Disc A carries 30 of the 52 catalogues and one
half of the vehicle index; disc B carries the other 22 and the other half. Both
write into the same `EPC/DATA1`, so they are _overlaid_, not chosen between.

Give masax both mount points and it does that for you:

```sh
masax verify /Volumes/MMC-A "/Volumes/MMC ASA 2"
```

Expect:

```
9495097 records decode exactly, 1889570 of them reachable through an index
```

If you point it at one disc only, it will work — but roughly half the vehicles
will not decode and half the catalogues will be missing, with nothing on screen
saying so.

## 4. Two ways to give the app your data

### Point at a folder (recommended)

Start the client and it asks where the data is:

```sh
pnpm install && pnpm build
pnpm dev
```

Open the URL it prints, choose **Pick a folder**, and select a mount point — or
the parent of both, or an imported tree. Add both discs and masax overlays them
exactly as the CLI does.

This is the primary path and the one to prefer. `File.slice()` is a range read,
so the 76 MB vehicle index is never read end to end and never leaves your
machine. The choice is remembered; change it later from the gear icon in the
toolbar.

> macOS will ask you to grant the browser access to the volume. That prompt is
> the browser's, not masax's.

### Import to one folder first

Useful if you want a single directory to keep, back up or host:

```sh
masax import /Volumes/MMC-A "/Volumes/MMC ASA 2" -o data/M60
```

It copies the union byte-for-byte, converts nothing, and writes the manifest an
HTTP host needs. About **714 MB**, of which 231 MB is the drawings — pass
`--no-illustrations` to leave those out if you only want the text data.

Add `--dry-run` to see what it would copy without writing anything, and
`--compare-bytes` to check the files the two discs share byte by byte rather
than by size.

Then point the app at `data/M60`, or serve it:

```sh
masax serve data/M60 -a apps/web/dist
```

## 5. If your browser cannot pick a folder

Use the **HTTP location** field in the same panel and give it the URL of a
hosted tree. The host must support `Range` requests and must carry the
`csfs-manifest.json` that `masax import` writes — HTTP cannot list a directory,
so without the manifest masax cannot find anything.

`masax serve` sets both up correctly and is the easy way to test.

OPFS can also keep a copy inside the browser for offline use.

## 6. Finding a part

### Start from a VIN

Type it into **Vehicle** and press **Decode**. masax resolves it against the
vehicle index on the disc — locally, nothing is sent anywhere — and fills in the
strip beneath the toolbar: model, classification, build date, OPC, paint, trim.
It then **opens the catalogue and model that vehicle belongs to**, so a VIN
alone is enough to reach a parts list. You do not have to know that a `V25W` is
a Pajero.

The strip also says how it decided — for instance `spec from serial J000153`,
meaning this VIN's own record pointed at another one for its specification,
which is normal and applies to most records.

Shorter chassis numbers work. About 0.74% of these vehicles predate the
17-character VIN, and masax accepts them.

### Or pick by hand

Choose a **Catalogue** and then a **Model** from the toolbar. Both are plain
lists; the model codes are the same ones a VIN decodes to.

### Navigate to the plate

The left rail has **Group** and, under it, **Plate**. Both filter as you type,
and both match on the **number as well as the name** — type `13` or `fuel`,
whichever you happen to know. Press Enter when one match is left.

**Several plates can share a plate number.** `010 FUEL TANK` on a Pajero is
three: a filler pipe and two tank-and-filler-tube variants. They are listed
separately, each with its own subtitle, and **each has its own parts list** —
which is what the drawing beside it is showing.

### Read the plate

The drawing is on the left, the parts on the right. The parts list scrolls; the
drawing stays put.

- **Click a callout number on the drawing** and its row is highlighted.
- **Click a row** and its number lights up on the drawing — every occurrence, so
  a part used in four places shows all four.
- Callouts that are not on this list are still drawn, because they are printed
  on the paper, but they do not respond. A drawing is often shared between
  variants and carries their numbers too, along with `REF.` pointers into other
  groups.
- The icon in the drawing's top-right corner switches between **fit to the
  column** and **actual size**. At actual size, drag the drawing to pan it.

### Light and dark

The two controls at the right of the toolbar are the theme and the settings cog.
The theme cycles **auto → light → dark**; auto follows the machine and keeps
following it, so a desk that switches at sunset switches with it. The choice is
remembered.

In dark, the drawing is painted light-on-dark rather than left as a white
rectangle — it is the largest thing on screen and would undo the theme on its
own. The plate is repainted from the decoded bitmap, so the callout highlights
stay red rather than being inverted along with everything else.

### What the parts table says

| Column      | Meaning                                                 |
| ----------- | ------------------------------------------------------- |
| PNC         | part-name code — the number printed on the drawing      |
| Part number | what to order                                           |
| Qty         | how many are fitted                                     |
| Name        | the part's description                                  |
| Period      | the build-date window this part number applies to       |
| Applies     | the option and classification codes attached to the row |

### Narrowing to your vehicle

Once you have decoded a VIN the list narrows to that vehicle, and the header
carries the switch — **This vehicle**. Three things narrow it: the build date
against each row's period, your classification against the row's list, and your
option pack against the row's option code. The footnote says how many rows were
hidden and why.

Untick it to see everything the plate holds. Worth doing when a part you expect
is missing: on `13-010 FUEL FILLER PIPE` for a 1994-03 Pajero, 19 rows become
11 — one per number on the drawing — and all 8 hidden rows are later periods of
the same parts.

**The date test is arithmetic; the combination is inference.** A row whose period
ends in 1994-05 plainly does not apply to a car built 1997-06. How the original
application _combines_ the three tests is not confirmed, which is why the switch
exists and the hidden-row count is always shown. See
[`data-format.md`](data-format.md#what-is-not-established).

### What an OPC means

The OPC on the vehicle strip is a **pack code**, not a feature — `H70` stands
for 34 separate options. Click it and the panel lists them with their codes and
descriptions, and says which record it matched and on what.

Some codes have no description: 171 of the codes the catalogue uses have no
entry in its own option table. Those show as bare codes rather than being
dropped.

### Language and theme

The gear opens **Settings**, which has two tabs.

**User interface** carries the language masax speaks — English or Polish, or
whichever of those your browser asks for — and the theme. Both apply the moment
you pick them, so there is nothing to save; the panel says so and offers Done.

**Data location** keeps the discs, the hosted tree, and the language the
_catalogue's own text_ is read in. That is a different setting: masax's words
and Mitsubishi's words are independent, and the catalogue's coverage is partial
— German translates about a quarter of its strings and French a third — so a
Polish interface over an English parts list is the normal case, not a fault.

The theme control also sits in the toolbar, left of the gear, for a quick
switch.

### Report, and copying

- **Report**, on the vehicle strip, prints everything the data holds about the
  vehicle — VIN, chassis and serial, model, classification, build date, OPC with
  its full option list, paint, trim, exterior, and the catalogue it resolved to.
  One sheet, black on white whatever theme you are using.
- **The drawing** has a copy button beside the zoom control, which puts the
  plate on the clipboard as an image. It copies what is on screen, so a plate
  copied in dark mode is light-on-dark.
- **A part number or name** copies from its own cell. Point at a row and small
  copy buttons appear beside the number and the name; on a touch screen, tap the
  row first. Copying does not change which callout is selected.

## 7. From the command line

The same engine, without a browser. Useful for checking a fresh copy of the
media, and for scripting.

```sh
masax survey <paths...>                 # what is this directory?
masax verify <paths...>                 # decode everything, check every invariant
masax verify <path> --schema            # print each dataset's schema
masax verify <path> --run-keys          # what the data says about inheritance
masax import  <paths...> -o data/M60    # merge the discs into one tree

masax show data/M60                                 # list the catalogues
masax show data/M60 B60356A4A                       # its models
masax show data/M60 B60356A4A V25W                  # main groups
masax show data/M60 B60356A4A V25W 13               # plates in group 13
masax show data/M60 B60356A4A V25W 13 010           # the plates and their parts

masax vin data/M60 JMB0RV250RJ000188                # decode a VIN

masax illust data/M60/ILLUST --check                # decode every drawing
masax illust data/M60/ILLUST -o png/ --png          # convert them to PNG
masax serve data/M60 -a apps/web/dist               # host the tree and the client
```

`masax show … 13 010` prints **each** plate that shares the number `010`, with
its own drawing name and its own parts, and says how many of the subgroup's rows
that plate accounts for.

Add `-l D`, `-l F` or `-l J` for German, French or Japanese text. The catalogue
stores every string once per language, so switching costs nothing — but
**the translations are patchy**: of the 48,549 strings, German translates 25.9%
and French 31.3%, leaving the rest in English. Group and plate names are often
among the untranslated, so a German session shows German part names under
English headings. That is the data, not masax. Japanese needs a different text
decode and is not usable yet; see [§9](#9-what-masax-will-not-tell-you).

## 8. When something looks wrong

**"Is this really a data tree?"** — the folder is not a module root. Point at
the mount point itself, or at the directory containing `EPC/`, or at its parent
if you are giving it both discs.

**Half the vehicles will not decode** — you have one disc. The vehicle index is
split across both.

**A VIN gives a build date and nothing else** — that would be a bug; most
records legitimately hold no specification and masax follows the cross-reference
to find it. Please report the VIN's chassis prefix, not the full VIN.

**A drawing says "not in this data"** — that plate's illustration is on the
other disc, or `ILLUST` was skipped at import.

**Nothing loads over HTTP** — the host is missing `csfs-manifest.json`, or does
not answer `Range` requests.

## 9. What masax will not tell you

- **Whether a part fits your exact vehicle.** It shows the conditions; you
  apply them. See [§6](#what-the-parts-table-says).
- **Prices.** The `Price`, `SMO`, `Sec` and `ExtPrice` datasets ship a schema
  and no data on the European media — those modules were not licensed.
- **Anything outside module M60.** The family also includes M00, M50 and M80;
  only M60 has been worked through here.
- **Japanese text.** `DESC_J` translates 61.5% of the strings, but stores them
  as half-width katakana in the single-byte range rather than as Latin-1, so
  masax currently renders them as mojibake. The other three languages are
  fine.
