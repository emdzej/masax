#!/usr/bin/env python3
"""Extract the payloads from an ASA delta update package (asacm60e*.exe).

The packages are Wise Installer self-extractors: a ~15 KB PE stub followed by
an overlay of consecutively stored raw-deflate streams, each followed by a
4-byte CRC. Rather than parse Wise's per-file headers we walk the overlay
inflating streams back to back, which recovers every payload exactly.

A package contains, in order:
  WiseColors.dib    the installer splash bitmap
  WiseScript.bin    the install script -- names the files it will write
  Wise0132.dll      the Wise runtime
  DeltaUpd.recipe   tab-separated instructions for PROG/DeltaUpd.exe
  *.U<nn>           the data deltas (see delta.py)
  *.tif             replacement illustrations (see illust.py)

Usage: unwise.py <asacm60e0NN.exe> [outdir]
"""
import struct, zlib, sys, os

MIN_STREAM = 512   # ignore accidental tiny inflations while resyncing


def pe_end(d):
    """First byte after the PE image -- where the overlay starts."""
    e, = struct.unpack_from('<I', d, 0x3c)
    nsec, = struct.unpack_from('<H', d, e + 6)
    optsz, = struct.unpack_from('<H', d, e + 20)
    end = 0
    for i in range(nsec):
        o = e + 24 + optsz + i * 40
        rsz, ra = struct.unpack_from('<II', d, o + 16)
        end = max(end, ra + rsz)
    return end


def payloads(data):
    """Yield (offset, compressed_size, decompressed_bytes) for each stream."""
    i, n = pe_end(data), len(data)
    while i < n - 16:
        try:
            do = zlib.decompressobj(-15)
            out = do.decompress(data[i:], 64 << 20)
            csz = len(data[i:]) - len(do.unused_data)
            if do.eof and len(out) >= MIN_STREAM:
                yield i, csz, out
                i += csz
                continue
        except zlib.error:
            pass
        i += 1


def classify(blob, seen):
    if blob[:2] == b'MZ':
        return 'Wise0132.dll'
    if blob[:4] == b'\x28\x00\x00\x00':
        return 'WiseColors.dib'
    if b'DELTAUPD.LOG' in blob[:2048]:
        return 'DeltaUpd.recipe'
    if b'Wise' in blob[:4096] or b'CMD_TARGETDIR' in blob[:8192]:
        return 'WiseScript.bin'
    # an obfuscated TIFF: byte 0 ^ 0x31 then 0x0b gives 'II*\0'
    if len(blob) > 4 and bytes([blob[0] ^ 0x31]) + bytes(b ^ 0x0b for b in blob[1:4]) == b'II*\x00':
        seen['tif'] += 1
        return f'illustration_{seen["tif"]:02d}.tif'
    if len(blob) > 7 and blob[4] in (0x41, 0x44, 0x55):
        seen['u'] += 1
        return f'delta_{seen["u"]:02d}.U'
    return None


def main(path, outdir=None):
    data = open(path, 'rb').read()
    print(f'{os.path.basename(path)}: {len(data):,} bytes, overlay at {pe_end(data):,}')
    seen = {'tif': 0, 'u': 0}
    if outdir:
        os.makedirs(outdir, exist_ok=True)
    for off, csz, blob in payloads(data):
        name = classify(blob, seen) or f'payload_@{off}.bin'
        print(f'  @{off:<9} {csz:>8} -> {len(blob):>9}  {name}')
        if outdir:
            open(os.path.join(outdir, name), 'wb').write(blob)
    return 0


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__.strip()); sys.exit(2)
    sys.exit(main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None))
