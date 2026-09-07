"""Illustrations: the parts drawings.

Files under ILLUST/ are named `*.tif` but are not TIFFs as stored -- every byte
is XOR'd with 0x0b, except byte 0 which uses 0x31. Undo that and you get an
ordinary TIFF: 1-bit bilevel, CCITT Group 4, typically around 960x1200.

`LxidTiff.dll` really does test for the `II*` magic, so the obfuscation is
applied on top of plain TIFF rather than being a LexCom container format.
"""
import struct

KEY, KEY0 = 0x0b, 0x31

TAGS = {0xfe: 'NewSubfileType', 0x100: 'ImageWidth', 0x101: 'ImageLength',
        0x102: 'BitsPerSample', 0x103: 'Compression', 0x106: 'Photometric',
        0x10a: 'FillOrder', 0x111: 'StripOffsets', 0x112: 'Orientation',
        0x115: 'SamplesPerPixel', 0x116: 'RowsPerStrip', 0x117: 'StripByteCounts',
        0x11a: 'XResolution', 0x11b: 'YResolution', 0x128: 'ResolutionUnit'}
COMPRESSION = {1: 'none', 2: 'CCITT-RLE', 3: 'CCITT-G3', 4: 'CCITT-G4',
               5: 'LZW', 7: 'JPEG', 8: 'Deflate', 32773: 'PackBits'}


def deobfuscate(data):
    """Turn a stored ILLUST file into a valid TIFF."""
    out = bytearray(b ^ KEY for b in data)
    out[0] = data[0] ^ KEY0
    return bytes(out)


def obfuscate(tiff):
    """Inverse of deobfuscate, for writing files the application can read."""
    return deobfuscate(tiff)


def read_ifd(tiff):
    """Parse the first IFD. Returns {tag: value}; raises on a malformed file."""
    if tiff[:4] not in (b'II*\x00', b'MM\x00*'):
        raise ValueError(f'not a TIFF: {tiff[:4]!r}')
    E = '<' if tiff[:2] == b'II' else '>'
    off, = struct.unpack_from(E + 'I', tiff, 4)
    n, = struct.unpack_from(E + 'H', tiff, off)
    tags = {}
    for i in range(n):
        o = off + 2 + 12 * i
        tag, typ, cnt = struct.unpack_from(E + 'HHI', tiff, o)
        if typ == 3:
            val, = struct.unpack_from(E + 'H', tiff, o + 8)
        else:
            val, = struct.unpack_from(E + 'I', tiff, o + 8)
        tags[tag] = val
    return tags


def describe(tags):
    w, h = tags.get(0x100), tags.get(0x101)
    comp = COMPRESSION.get(tags.get(0x103), tags.get(0x103))
    return f'{w}x{h} {tags.get(0x102)}-bit {comp}'
