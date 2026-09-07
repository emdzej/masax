#!/usr/bin/env python3
"""Decode every record of every ASA dataset and check it consumes exactly its
declared payload length. Usage: verify.py <path to ASA/M60>  [--schema]"""
import sys, os, glob, struct
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lexdb


def main(root, show_schema=False):
    dirs = [d for d in ('EPC/DATA1', 'EPC/DATA1/A', 'EPC/DATA1/B', 'EPC/DATA2',
                        'EPC/DATA2/A', 'EPC/DATA2/B', 'PROG')
            if os.path.isdir(os.path.join(root, d))]
    grand_ok = grand_bad = 0
    for d in dirs:
        for ddm in sorted(glob.glob(os.path.join(root, d, '*.ddm'))):
            name = os.path.basename(ddm)[:-4]
            # Variant discovery must not need the data files to exist, so it
            # reads the .fdt template directly rather than via a Dataset.
            try:
                fdt = lexdb.parse_fdt(ddm[:-4] + '.fdt')
            except Exception as e:
                print(f'FDT  {d}/{name}: {e}')
                continue
            vs = [None]
            if '@' in fdt['bin']:
                pre, post = fdt['bin'].split('@')
                found = set()
                for f in os.listdir(os.path.join(root, d)):
                    fl, pl, sl = f.lower(), pre.lower(), post.lower()
                    if fl.startswith(pl) and fl.endswith(sl) and len(f) > len(pre) + len(post):
                        found.add(f[len(pre):len(f) - len(post)])
                # '@.bin' (catalog) matches every .bin in the directory, so drop
                # ids that are really another dataset's file.
                others = {os.path.basename(x)[:-4].lower()
                          for x in glob.glob(os.path.join(root, d, '*.ddm'))}
                vs = sorted(v for v in found
                            if v.lower() not in others
                            and not any(v.lower().startswith(t) for t in
                                        ('desc_', 'spn_')))
                vs = vs or [None]
            n_ok = n_bad = rows = nv = 0
            for v in vs:
                try:
                    ds = lexdb.Dataset(ddm, v)
                except FileNotFoundError:
                    continue
                nv += 1
                rows += ds.count()
                if show_schema:
                    print(ds.schema()); print()
                data = open(ds.binpath, 'rb').read()
                for key, off in ds.index():
                    try:
                        ln, = struct.unpack_from('<H', data, off)
                        rec, used = ds.decode(data[off + 2:off + 2 + ln])
                        if used == ln: n_ok += 1
                        else: n_bad += 1
                    except Exception:
                        n_bad += 1
            if not nv:
                print(f'---- {d}/{name}: no data files present')
                continue
            grand_ok += n_ok; grand_bad += n_bad
            flag = 'OK  ' if n_bad == 0 else 'FAIL'
            print(f'{flag} {d}/{name:<12} {nv:>2} variant(s)  {n_ok:>7}/{rows:<7} clean'
                  + ('' if not n_bad else f'  {n_bad} BAD'))
    tot = grand_ok + grand_bad
    print(f'\n{grand_ok}/{tot} records decode exactly'
          f' ({100 * grand_ok / max(tot, 1):.4f}%)')
    return 0 if grand_bad == 0 else 1


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    sys.exit(main(args[0], '--schema' in sys.argv))
