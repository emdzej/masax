"""Reader for the LexCom ASA data files (Mitsubishi After Sales Application).

See docs/data-format.md for the format. Everything here is validated against a
real installation: `python3 re/tools/verify.py <ASA/M60 dir>` decodes every
record of every dataset and checks each one consumes exactly its declared
payload length.
"""
import struct, os, re, glob

# Field storage types, from the .fdt field descriptor.
FIXSTR, UINT, INT, VARSTR = 0x12, 0x14, 0x16, 0x22
GROUP_A, GROUP_B = 0x0a, 0x1a
GROUPS = (GROUP_A, GROUP_B)
TYPES = {FIXSTR: 'fixstr', UINT: 'uint', INT: 'int', VARSTR: 'varstr',
         GROUP_A: 'group', GROUP_B: 'group'}

# Storage class (`sc`), the low u16 of the descriptor word at +7.
SC_GROUP, SC_ARRAY8, SC_SCALAR, SC_ARRAY16 = 1, 2, 3, 4

FDT_FIELDS_OFF = 0x38   # first field descriptor
FDT_DESC_SZ = 13        # bytes per field descriptor
SPARSE_FLAG = 9         # value of the u16 at 0x26 when records carry a bitmap


def parse_ddm(path):
    """The .ddm is INI text; [DDF] lists `<ordinal>=<code>,<S|I> ;<comment>`.

    The comments are the only human-readable field names in the format and they
    are worth keeping -- the .fdt labels disagree with them here and there.
    """
    txt = open(path, 'rb').read().decode('latin1')
    out, sect = [], None
    for line in txt.splitlines():
        line = line.strip()
        if line.startswith('['):
            sect = line.strip('[]').upper()
            continue
        if sect != 'DDF' or '=' not in line:
            continue
        k, v = line.split('=', 1)
        if not k.strip().isdigit():
            continue
        body, _, comment = v.partition(';')
        parts = [p.strip() for p in body.split(',')]
        if len(parts) >= 2:
            out.append(dict(n=int(k), code=parts[0], kind=parts[1],
                            comment=comment.strip()))
    return sorted(out, key=lambda f: f['n'])


def parse_fdt(path):
    d = open(path, 'rb').read()
    magic, ntop, ntot = struct.unpack_from('<HHH', d, 0)
    if magic != 0x36:
        raise ValueError(f'{path}: bad magic {magic:#x}')
    binname = d[0x08:0x15].split(b'\0')[0].decode('latin1')
    pntname = d[0x15:0x22].split(b'\0')[0].decode('latin1')
    maxrec, u24, sparse = struct.unpack_from('<HHH', d, 0x22)
    nkey, = struct.unpack_from('<H', d, 0x2a)
    keys = [d[0x2c + 3 * i:0x2c + 3 * i + 2].decode('latin1') for i in range(nkey)]

    flds, o = [], FDT_FIELDS_OFF
    for _ in range(ntot):
        code = d[o:o + 2].decode('latin1')
        w, rep, sc, hi, t = struct.unpack_from('<HHHHH', d, o + 3)
        if t not in TYPES:
            raise ValueError(f'{path}: field {code} unknown type {t:#x}')
        flds.append(dict(code=code, w=w, rep=rep, sc=sc, hi=hi, t=t,
                         ty=TYPES[t]))
        o += FDT_DESC_SZ

    # Record layout table: unpacked-buffer offsets. Not needed to read .bin --
    # storage is compact -- but its size is a useful self check.
    tblsz, = struct.unpack_from('<H', d, o)
    if tblsz != 8 * ntot:
        raise ValueError(f'{path}: layout table {tblsz} != {8 * ntot}')
    o += 2
    for i in range(ntot):
        off, w, t, idx = struct.unpack_from('<HHHH', d, o + 8 * i)
        flds[i].update(loff=off, lw=w, lt=t)
    o += tblsz

    for f in flds:
        ln, = struct.unpack_from('<H', d, o)
        f['label'] = d[o + 2:o + 2 + ln].split(b'\0')[0].decode('latin1')
        o += 2 + ln

    # Build the field tree. A group header owns every following field that
    # shares its letter prefix; those children are not top-level fields and do
    # not get a bit in the record's presence bitmap.
    tree, i = [], 0
    while i < len(flds):
        f = flds[i]
        f['kids'] = []
        if f['t'] in GROUPS:
            j = i + 1
            while j < len(flds) and flds[j]['code'][0] == f['code'][0]:
                f['kids'].append(flds[j])
                j += 1
            i = j
        else:
            i += 1
        tree.append(f)
    if len(tree) != ntop:
        raise ValueError(f'{path}: grouped into {len(tree)} fields, header says {ntop}')

    return dict(ntop=ntop, ntot=ntot, bin=binname, pnt=pntname, maxrec=maxrec,
                u24=u24, sparse=(sparse == SPARSE_FLAG), sparse_raw=sparse,
                keys=keys, flds=flds, tree=tree, end=o, size=len(d))


def _scalar(b, o, f):
    t, w = f['t'], f['w']
    if t == VARSTR:
        n = b[o]
        return b[o + 1:o + 1 + n].decode('latin1'), o + 1 + n
    if t == FIXSTR:
        return b[o:o + w].decode('latin1').rstrip(), o + w
    if t == UINT:
        return int.from_bytes(b[o:o + w], 'little'), o + w
    if t == INT:
        return int.from_bytes(b[o:o + w], 'little', signed=True), o + w
    raise ValueError(f'scalar type {t:#x}')


def _field(b, o, f):
    """A field is a scalar, an array of scalars, or a repeating group.

    `rep` alone does not mean repeating -- DudMMC.A0 has rep=4 and is a plain
    integer. The storage class is what decides.
    """
    if f['t'] in GROUPS:
        n = b[o]; o += 1
        rows = []
        for _ in range(n):
            row = {}
            for k in f['kids']:
                row[k['code']], o = _scalar(b, o, k)
            rows.append(row)
        return rows, o
    if f['sc'] == SC_ARRAY8:
        n = b[o]; o += 1
    elif f['sc'] == SC_ARRAY16:
        n = int.from_bytes(b[o:o + 2], 'little'); o += 2
    else:
        return _scalar(b, o, f)
    vals = []
    for _ in range(n):
        v, o = _scalar(b, o, f)
        vals.append(v)
    return vals, o


class Dataset:
    def __init__(self, ddm_path, variant=None):
        self.dir = os.path.dirname(ddm_path) or '.'
        self.name = os.path.basename(ddm_path)[:-4]
        self.ddm = parse_ddm(ddm_path)
        m = re.search(r'(?mi)^\s*fdt\s*=\s*(\S+)',
                      open(ddm_path, 'rb').read().decode('latin1'))
        self.fdt = parse_fdt(self._find(m.group(1) if m else self.name + '.fdt'))
        self.variant = variant
        self.binpath = self._find(self.fdt['bin'].replace('@', variant or ''))
        self.pntpath = self._find(self.fdt['pnt'].replace('@', variant or ''))
        by_code = {f['code']: f for f in self.fdt['flds']}
        for df in self.ddm:
            if df['code'] in by_code:
                by_code[df['code']].update(kind=df['kind'], comment=df['comment'])
        self.fields = self.fdt['flds']
        self.tree = self.fdt['tree']

    def _find(self, name):
        """The tree mixes case freely: PNC.BIN beside pnc.pnt."""
        cand = os.path.join(self.dir, name)
        if os.path.exists(cand):
            return cand
        low = name.lower()
        for f in os.listdir(self.dir):
            if f.lower() == low:
                return os.path.join(self.dir, f)
        raise FileNotFoundError(os.path.join(self.dir, name))

    @property
    def keysize(self):
        by = {f['code']: f for f in self.fields}
        return sum(by[k]['w'] for k in self.fdt['keys'] if k in by)

    @property
    def entsize(self):
        return self.keysize + 4

    def count(self):
        return os.path.getsize(self.pntpath) // self.entsize

    def index(self):
        """[(key, offset)] in key order. Integer keys are returned as ints."""
        d = open(self.pntpath, 'rb').read()
        ks, es = self.keysize, self.entsize
        by = {f['code']: f for f in self.fields}
        one_int = (len(self.fdt['keys']) == 1
                   and by[self.fdt['keys'][0]]['t'] in (UINT, INT))
        out = []
        for o in range(0, len(d) - es + 1, es):
            raw = d[o:o + ks]
            off, = struct.unpack_from('<I', d, o + ks)
            if one_int:
                t = by[self.fdt['keys'][0]]['t']
                key = int.from_bytes(raw, 'little', signed=(t == INT))
            else:
                key = raw.decode('latin1').rstrip()
            out.append((key, off))
        return out

    def decode(self, body):
        """Decode a record payload. Returns (dict, bytes_consumed)."""
        o, out = 0, {}
        if self.fdt['sparse']:
            nb = body[0]; o += 1
            bits = body[o:o + nb]; o += nb
            # The bitmap may be shorter than the field count; anything past its
            # end is absent.
            present = [i // 8 < len(bits) and bool(bits[i // 8] & (0x80 >> (i % 8)))
                       for i in range(len(self.tree))]
        else:
            present = [True] * len(self.tree)
        for f, p in zip(self.tree, present):
            if p:
                out[f['code']], o = _field(body, o, f)
        return out, o

    def records(self):
        """Yield (key, record) for every row, in key order."""
        data = open(self.binpath, 'rb').read()
        for key, off in self.index():
            ln, = struct.unpack_from('<H', data, off)
            rec, used = self.decode(data[off + 2:off + 2 + ln])
            if used != ln:
                raise ValueError(f'{self.name} key={key!r}: used {used} of {ln}')
            yield key, rec

    def variants(self):
        """Language / catalogue ids that fill the '@' in the file templates."""
        t = self.fdt['bin']
        if '@' not in t:
            return [None]
        pre, post = t.split('@')
        out = set()
        for f in os.listdir(self.dir):
            fl, pl, sl = f.lower(), pre.lower(), post.lower()
            if fl.startswith(pl) and fl.endswith(sl) and len(f) > len(pre) + len(post):
                out.add(f[len(pre):len(f) - len(post)])
        return sorted(out)

    def schema(self):
        f0 = self.fdt
        lines = [f'{self.name}  bin={os.path.basename(self.binpath)} '
                 f'pnt={os.path.basename(self.pntpath)}  rows={self.count()}  '
                 f'{"sparse" if f0["sparse"] else "dense"}  keys={f0["keys"]} '
                 f'(entry {self.entsize}B)']
        for f in self.tree:
            self._fmt(f, lines, 0)
        return '\n'.join(lines)

    def _fmt(self, f, lines, depth):
        pad = '   ' * depth
        kind = {SC_GROUP: 'group', SC_ARRAY8: 'array[u8]',
                SC_ARRAY16: 'array[u16]', SC_SCALAR: ''}.get(f['sc'], '?')
        lines.append(f'  {pad}{f["code"]:<3} {f["ty"]:<7} w={f["w"]:<4} '
                     f'{kind:<10} max={f["rep"] or "":<5} '
                     f'{f.get("comment") or f["label"]}')
        for k in f['kids']:
            self._fmt(k, lines, depth + 1)
