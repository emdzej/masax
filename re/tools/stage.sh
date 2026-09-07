#!/bin/sh
# Copy the PE files worth decompiling out of an ASA installation into re/bin/,
# which is gitignored. Usage: stage.sh <path to ASA/M60>
set -e
[ -n "$1" ] || { echo "usage: $0 <path to ASA/M60>" >&2; exit 2; }
out="$(dirname "$0")/../bin"; mkdir -p "$out"
for f in fdtpdll.dll LexDdm.dll ASA.exe ASAExport.exe DeltaUpd.exe \
         LexFpi32.dll Provide.dll LxidDcod.dll ASAConfig.exe; do
    if [ -f "$1/PROG/$f" ]; then cp "$1/PROG/$f" "$out/" && echo "staged $f"; fi
done
