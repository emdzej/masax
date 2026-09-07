#!/usr/bin/env python3
"""Turn ILLUST files into real TIFFs (or check that they all decode).

Usage:
  deillust.py --check <ILLUST dir>          validate every file, print a summary
  deillust.py <in.tif> <out.tif>            convert one file
  deillust.py --all <ILLUST dir> <outdir>   convert the whole tree
"""
import sys, os, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import illust


def walk(root):
    for dp, _, fns in os.walk(root):
        for fn in fns:
            if fn.lower().endswith('.tif'):
                yield os.path.join(dp, fn)


def main(argv):
    if argv[0] == '--check':
        ok = bad = 0
        dims, comps, errs = collections.Counter(), collections.Counter(), collections.Counter()
        for p in walk(argv[1]):
            try:
                tags = illust.read_ifd(illust.deobfuscate(open(p, 'rb').read()))
                if not tags.get(0x100) or not tags.get(0x101):
                    raise ValueError('no dimensions')
                dims[(tags[0x100], tags[0x101])] += 1
                comps[illust.COMPRESSION.get(tags.get(0x103), tags.get(0x103))] += 1
                ok += 1
            except Exception as e:
                bad += 1; errs[f'{type(e).__name__}: {e}'[:60]] += 1
        print(f'{ok} valid TIFF, {bad} failed')
        print('  compression:', dict(comps))
        print('  dimensions :', dims.most_common(6))
        for e, c in errs.most_common(5):
            print(f'    {c} x {e}')
        return 0 if bad == 0 else 1
    if argv[0] == '--all':
        root, out = argv[1], argv[2]
        n = 0
        for p in walk(root):
            rel = os.path.relpath(p, root)
            dst = os.path.join(out, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            open(dst, 'wb').write(illust.deobfuscate(open(p, 'rb').read()))
            n += 1
        print(f'converted {n} files into {out}')
        return 0
    src, dst = argv[0], argv[1]
    tiff = illust.deobfuscate(open(src, 'rb').read())
    open(dst, 'wb').write(tiff)
    print(f'{os.path.basename(src)}: {illust.describe(illust.read_ifd(tiff))} -> {dst}')
    return 0


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__.strip()); sys.exit(2)
    sys.exit(main(sys.argv[1:]))
