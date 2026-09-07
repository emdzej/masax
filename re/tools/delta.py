#!/usr/bin/env python3
"""The `.U<nn>` data deltas carried by ASA update packages.

A delta is a flat sequence of operations against one dataset's `.bin`:

    uint32 offset      byte offset in the target .bin
    uint8  opcode      'A' add, 'D' delete, 'U' update
    uint16 length      payload length
    bytes  payload     a record body, encoded exactly as in .bin

So the payload is read with the ordinary `lexdb` record decoder -- the deltas
carry whole records, not byte patches. The `<nn>` suffix identifies the dataset:

    U00 Vin      U03 MGroup   U04 SGroup   U05 BGroup   U06 OInfo
    U07 Opc      U09 Desc     U10 catalog  U11 pnc      U12 PBook
    U16 rep      U19 PREF

Usage: delta.py <file.Unn> [...]
"""
import struct, sys, os, collections

ADD, DELETE, UPDATE = 0x41, 0x44, 0x55
OPS = {ADD: 'add', DELETE: 'delete', UPDATE: 'update'}

DATASET = {0: 'Vin', 3: 'MGroup', 4: 'SGroup', 5: 'BGroup', 6: 'OInfo',
           7: 'Opc', 9: 'Desc', 10: 'catalog', 11: 'pnc', 12: 'PBook',
           16: 'rep', 19: 'PREF'}


def parse(data):
    """Yield (offset, opcode, payload). Raises if the file does not frame."""
    o = 0
    while o < len(data):
        if o + 7 > len(data):
            raise ValueError(f'truncated header at {o}')
        off, = struct.unpack_from('<I', data, o)
        op = data[o + 4]
        ln, = struct.unpack_from('<H', data, o + 5)
        if op not in OPS:
            raise ValueError(f'bad opcode {op:#02x} at {o}')
        if o + 7 + ln > len(data):
            raise ValueError(f'truncated payload at {o}')
        yield off, op, data[o + 7:o + 7 + ln]
        o += 7 + ln


def dataset_for(path):
    ext = os.path.splitext(path)[1]
    if len(ext) == 4 and ext[1].upper() == 'U' and ext[2:].isdigit():
        return DATASET.get(int(ext[2:]))
    return None


def main(paths):
    rc = 0
    for p in paths:
        data = open(p, 'rb').read()
        ops = collections.Counter()
        try:
            n = 0
            for off, op, payload in parse(data):
                ops[OPS[op]] += 1; n += 1
            status = 'OK'
        except ValueError as e:
            status = f'FAIL {e}'; rc = 1
        ds = dataset_for(p) or '?'
        print(f'{status:<8} {os.path.basename(p):<22} {len(data):>8}B  '
              f'target={ds:<8} {dict(ops)}')
    return rc


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__.strip()); sys.exit(2)
    sys.exit(main(sys.argv[1:]))
