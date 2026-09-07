"""Empirically determine the .bin record encoding for every dataset."""
import struct, os, sys, glob

TYPES = {0x12: 'fixstr', 0x14: 'uintLE', 0x16: 'intLE', 0x22: 'varstr',
         0x0a: 'group', 0x1a: 'group2'}
GROUP = (0x0a, 0x1a)
CNT = {2: 1, 4: 1, 'group_2': 1, 'group_4': 1}


def parse_fdt(path):
    d = open(path, 'rb').read()
    ntop, ntot, n3 = struct.unpack_from('<HHH', d, 2)
    binname = d[0x08:0x15].split(b'\0')[0].decode('latin1')
    pntname = d[0x15:0x22].split(b'\0')[0].decode('latin1')
    maxrec, u24, u26 = struct.unpack_from('<HHH', d, 0x22)
    nkey, = struct.unpack_from('<H', d, 0x2a)
    keys = [d[0x2c + 3 * i:0x2c + 3 * i + 2].decode('latin1') for i in range(nkey)]
    flds, o = [], 0x38
    for _ in range(ntot):
        code = d[o:o + 2].decode('latin1')
        w, rep = struct.unpack_from('<HH', d, o + 3)
        sc, hi = struct.unpack_from('<HH', d, o + 7)
        t, = struct.unpack_from('<H', d, o + 11)
        flds.append(dict(code=code, w=w, rep=rep, sc=sc, hi=hi, t=t,
                         ty=TYPES.get(t, hex(t))))
        o += 13
    tsz, = struct.unpack_from('<H', d, o); o += 2
    for i in range(ntot):
        off, w, t, idx = struct.unpack_from('<HHHH', d, o + 8 * i)
        flds[i].update(loff=off, lw=w, lt=t, lidx=idx)
    o += tsz
    for f in flds:
        ln, = struct.unpack_from('<H', d, o)
        f['label'] = d[o + 2:o + 2 + ln].split(b'\0')[0].decode('latin1')
        o += 2 + ln
    # group the flat field list into a tree: a group header owns the following
    # fields that share its letter, until the letter changes.
    tree, i = [], 0
    while i < len(flds):
        f = flds[i]
        if f['t'] in GROUP:
            kids, j = [], i + 1
            while j < len(flds) and flds[j]['code'][0] == f['code'][0]:
                kids.append(flds[j]); j += 1
            f['kids'] = kids
            tree.append(f); i = j
        else:
            f['kids'] = []
            tree.append(f); i += 1
    return dict(ntop=ntop, ntot=ntot, n3=n3, bin=binname, pnt=pntname,
                maxrec=maxrec, u24=u24, u26=u26, keys=keys, flds=flds,
                tree=tree, tail=o, size=len(d))


def read_scalar(b, o, f):
    t, w = f['t'], f['w']
    if t == 0x22:
        n = b[o]; return b[o+1:o+1+n].decode('latin1'), o + 1 + n
    if t == 0x12:
        return b[o:o+w].decode('latin1').rstrip(), o + w
    if t == 0x14:
        return int.from_bytes(b[o:o+w], 'little'), o + w
    if t == 0x16:
        return int.from_bytes(b[o:o+w], 'little', signed=True), o + w
    raise ValueError(f'scalar type {t:#x}')


def read_field(b, o, f):
    """A field is a scalar, an array of scalars, or a repeating group."""
    if f['t'] in GROUP:
        if CNT.get('group_%d' % f['hi'], 1) == 2:
            n = int.from_bytes(b[o:o+2], 'little'); o += 2
        else:
            n = b[o]; o += 1
        rows = []
        for _ in range(n):
            row = {}
            for k in f['kids']:
                row[k['code']], o = read_scalar(b, o, k)
            rows.append(row)
        return rows, o
    if f['sc'] in (2, 4):
        if CNT[f['sc']] == 2:
            n = int.from_bytes(b[o:o+2], 'little'); o += 2
        else:
            n = b[o]; o += 1
        vals = []
        for _ in range(n):
            v, o = read_scalar(b, o, f)
            vals.append(v)
        return vals, o
    return read_scalar(b, o, f)


def decode(body, tree, sparse):
    o, out = 0, {}
    if sparse:
        nb = body[o]; o += 1
        bits = body[o:o+nb]; o += nb
        # The bitmap can be shorter than the field count; anything past its
        # end is absent. catalog record '01090' ships one byte for 13 fields.
        present = [i // 8 < len(bits) and bool(bits[i//8] & (0x80 >> (i % 8)))
                   for i in range(len(tree))]
    else:
        present = [True] * len(tree)
    for f, p in zip(tree, present):
        if not p:
            continue
        out[f['code']], o = read_field(body, o, f)
    return out, o


def probe(ddm, variant):
    base = ddm[:-4]
    fdt = parse_fdt(base + '.fdt')
    dirn = os.path.dirname(ddm)
    def find(n):
        c = os.path.join(dirn, n)
        if os.path.exists(c): return c
        for f in os.listdir(dirn):
            if f.lower() == n.lower(): return os.path.join(dirn, f)
        raise FileNotFoundError(n)
    bp = find(fdt['bin'].replace('@', variant or ''))
    pp = find(fdt['pnt'].replace('@', variant or ''))
    by = {f['code']: f for f in fdt['flds']}
    ks = sum(by[k]['w'] for k in fdt['keys'] if k in by)
    es = ks + 4
    idx = open(pp, 'rb').read()
    data = open(bp, 'rb').read()
    n = len(idx) // es
    res = {}
    for sparse in (False, True):
        ok = bad = 0
        for i in range(n):
            off, = struct.unpack_from('<I', idx, i * es + ks)
            if off + 2 > len(data): bad += 1; continue
            ln, = struct.unpack_from('<H', data, off)
            body = data[off+2:off+2+ln]
            if len(body) != ln: bad += 1; continue
            try:
                _, used = decode(body, fdt['tree'], sparse)
            except Exception:
                bad += 1; continue
            if used == ln: ok += 1
            else: bad += 1
        res['sparse' if sparse else 'dense'] = (ok, bad)
    return fdt, n, es, res
