#!/usr/bin/env python3
"""Issue #128: build the real-height layer, tools/taipei/data/osm_heights.json.

Three sources, all fetched by THIS script from the official portals
(nothing is copied from any other project or study directory):

  1. Building permits — data.gov.tw dataset 151936 (臺北市建築執照套繪圖),
     a ZIP of TWD97/TM2 shapefiles published by Taipei City on
     data.taipei. Surveyed permit outlines with a floor count
     (bud_floor, falling back to the trailing NF of budatt_no).
  2. Door (house-number plate) points — data.gov.tw dataset 155472
     (臺北市門牌位置數值資料), a ~125 MB CSV, one row per registered
     unit. The floor is embedded in the 號 field (９１號三樓); a plate
     point's signal is the HIGHEST floor named at its coordinates —
     the point samples the whole building at that address.
  3. OSM building footprints with height / building:levels tags, from
     the same Geofabrik Taiwan PBF the rest of the pipeline extracts
     (extract-from-pbf.py takes the identical input).

  Both OGDL datasets are 政府資料開放授權條款第 1 版 (OGDL v1);
  OSM is ODbL. The layer header records each dataset's title, id,
  portal modified-date and licence, so a regenerated layer can be
  audited against the portals.

Output: osm_heights.json in the same lat/lon style as the other
tools/taipei/data files (build-taipei-geodata.mjs converts to the
world frame and clips):
  { version, generator, builtAt, factors, sources,
    footprints: [{src: 'permit'|'osm', floors: n|null, height: m|null,
                  ring: [[lat, lon], ...]}...],   # signal-bearing only
    doors: [[lat, lon, maxFloor], ...] }          # plate points in tile

Only footprints that CARRY a signal are emitted (permit floors > 0,
OSM height or levels present). Rings are thinned (points within
0.25 m of the chord through their neighbours are dropped) and rounded
to 7 dp; the planner only ever point-in-polygon tests lot centres
against them.

Floors -> metres factors live in FACTORS below AND in the planner
(js/taipei-buildings.js HEIGHT_JOIN — tests assert the two agree).
They were validated on this data (see the [validate] lines this
script prints every run): OSM levels vs the same footprints' height
tags, door maxima vs the height-tagged footprints containing them,
permit floors vs the height-tagged footprints they overlap.

Usage: build-heights.py [--pbf PATH] [--src DIR] [--out PATH] [--offline]
  --pbf   Geofabrik Taiwan extract (or env TAIPEI_PBF). Required.
  --src   download cache dir (default tools/taipei/data/heights-downloads/,
          gitignored — the raw CSV is ~125 MB and never committed).
  --out   default tools/taipei/data/osm_heights.json.
  --offline  fail unless both downloads are already in --src.
Downloads are reused when present; delete the cache (or pass a fresh
--src) to pick up a newer portal snapshot (doors update monthly).
Requires: osmium (pyosmium), pyshp — the pipeline's Python env.
"""
import argparse, csv, io, json, math, os, re, sys, urllib.request, zipfile
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
CFG = json.load(open(os.path.join(HERE, 'tile-boxes.json')))
BOXES = [(b['s'], b['w'], b['n'], b['e']) for b in CFG['boxes']]  # (S, W, N, E)
MARGIN = 0.004  # degrees, same collection margin as extract-from-pbf.py

DATASETS = {
    'permits': {'id': 151936, 'title': '臺北市建築執照套繪圖'},
    'doors': {'id': 155472, 'title': '臺北市門牌位置數值資料'},
}
LICENCE = '政府資料開放授權條款第 1 版 (OGDL v1)'

# Floors -> metres, per source. Validated against OSM height tags on
# the fetched data (the [validate] lines this script prints every run
# plus the finer scan in heights-evidence/factor-analysis.py):
#   counted floors (permit bud_floor, OSM building:levels): 3.0 m/f
#     — MAE 2.10 m against the height tags of the 1,705 footprints
#     carrying both tags (0.86 m on the <=6F stock that dominates the
#     levels-only population; the height/levels ratio medians at
#     exactly 3.00). The #115 study used 3.3; it is near-unbiased
#     (+0.3 m) but its MAE is 2.87 — the tag's roof/bulkhead metres
#     are not floor metres, so the MAE winner is the honest box top.
#   door maxima: 3.85 m/f (the study's value) — a plate point names
#     the highest REGISTERED floor, undercounting its building
#     (median 1 floor vs the containing footprint's levels), and
#     3.85 is the bias-free factor on clean one-door footprints
#     (bias -0.26 m, MAE 7.13, n=937). Doors are noisy per building;
#     that is why the planner only reads them as block-face medians.
FACTORS = {'osmLevels': 3.0, 'permit': 3.0, 'door': 3.85}


def in_tile(lat, lon, m=0.0):
    return any(s - m <= lat <= n + m and w - m <= lon <= e + m
               for (s, w, n, e) in BOXES)


# ---------- TWD97 TM2 (EPSG:3826) -> WGS84, pure python ----------
# GRS80 ellipsoid, central meridian 121E, k0 0.9999, false easting
# 250000 m. Series inverse (Snyder) — cross-checked against pyproj on
# the study's data to < 0.01 m, so the script needs no pyproj.
_A = 6378137.0
_F = 1 / 298.257222101
_E2 = _F * (2 - _F)
_E = math.sqrt(_E2)
_LON0 = math.radians(121.0)
_K0 = 0.9999
_FE = 250000.0


def tm2_to_wgs(x, y):
    e1 = (1 - math.sqrt(1 - _E2)) / (1 + math.sqrt(1 - _E2))
    mu = (y / _K0) / (_A * (1 - _E2 / 4 - 3 * _E2 ** 2 / 64 - 5 * _E2 ** 3 / 256))
    j1, j2, j3, j4 = 3 * e1 / 2 - 27 * e1 ** 3 / 32, 21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32, \
        151 * e1 ** 3 / 96, 1097 * e1 ** 4 / 512
    fp = mu + j1 * math.sin(2 * mu) + j2 * math.sin(4 * mu) + j3 * math.sin(6 * mu) + j4 * math.sin(8 * mu)
    sf, cf, tf = math.sin(fp), math.cos(fp), math.tan(fp)
    ep2 = _E2 / (1 - _E2)
    n1 = _A / math.sqrt(1 - _E2 * sf * sf)
    r1 = _A * (1 - _E2) / (1 - _E2 * sf * sf) ** 1.5
    d = (x - _FE) / (n1 * _K0)
    lat = fp - (n1 * tf / r1) * (d * d / 2 - (5 + 3 * tf * tf + 10 * ep2 * cf * cf - 4 * ep2 * ep2 - 9 * ep2) * d ** 4 / 24
                                 + (61 + 90 * tf * tf + 298 * ep2 * cf * cf + 45 * tf ** 4 - 252 * ep2 - 3 * ep2 * cf * cf) * d ** 6 / 720)
    lon = _LON0 + (d - (1 + 2 * tf * tf + ep2 * cf * cf) * d ** 3 / 6
                   + (5 - 2 * ep2 * cf * cf + 28 * tf * tf - 8 * ep2 * ep2 + 4 * ep2 * ep2 * cf * cf + 6 * ep2 * cf * cf + 24 * tf ** 4) * d ** 5 / 120) / cf
    return math.degrees(lat), math.degrees(lon)


# ---------- downloads ----------
UA = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
                    '(KHTML, like Gecko) Chrome/126.0 Safari/537.36 slop-taipei-pipeline'}


def dataset_info(ds_id):
    url = f'https://data.gov.tw/api/v2/rest/dataset/{ds_id}'
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.load(r)['result']
    dl = None
    for dist in d.get('distribution', []):
        u = dist.get('resourceDownloadUrl') or dist.get('url') or ''
        if 'download' in u:
            dl = u
            break
    return {'modified': d.get('modifiedDate'), 'download': dl}


def fetch(key, src_dir, offline):
    """Return (path, source-record) for one dataset, downloading if needed."""
    ds = DATASETS[key]
    fname = 'permits.zip' if key == 'permits' else 'doors.csv'
    path = os.path.join(src_dir, fname)
    sidecar = path + '.json'
    info = None
    if not offline:
        try:
            info = dataset_info(ds['id'])
        except Exception as e:  # portal hiccup: fall back to the cache
            print(f'[fetch] data.gov.tw API failed for {key} ({e}); using cache', file=sys.stderr)
    if not os.path.exists(path):
        if offline or not info or not info['download']:
            raise SystemExit(f'[fetch] {path} missing and cannot download (offline={offline})')
        print(f'[fetch] {key}: downloading {info["download"]}', file=sys.stderr)
        os.makedirs(src_dir, exist_ok=True)
        tmp = path + '.tmp'
        req = urllib.request.Request(info['download'], headers=UA)
        with urllib.request.urlopen(req, timeout=600) as r, open(tmp, 'wb') as f:
            while True:
                chunk = r.read(1 << 20)
                if not chunk:
                    break
                f.write(chunk)
        os.replace(tmp, path)
    rec = {'dataset': f"data.gov.tw {ds['id']} {ds['title']}", 'licence': LICENCE}
    if info:
        rec['modified'] = info['modified']
        rec['download'] = info['download']
        with open(sidecar, 'w') as f:
            json.dump(rec, f, ensure_ascii=False)
    elif os.path.exists(sidecar):
        rec = json.load(open(sidecar))
    rec['bytes'] = os.path.getsize(path)
    return path, rec


# ---------- permits (dataset 151936, shapefile ZIP) ----------
def read_permits(zip_path):
    import shapefile  # pyshp
    zf = zipfile.ZipFile(zip_path)
    shp_name = next(n for n in zf.namelist() if n.endswith('.shp'))
    base = shp_name[:-4]
    def part(ext):
        return io.BytesIO(zf.read(base + ext))
    rdr = shapefile.Reader(shp=part('.shp'), dbf=part('.dbf'),
                           shx=part('.shx'), prj=part('.prj'), encoding='utf-8')
    out = []
    att_re = re.compile(r'(\d+)\.(\d+)\.(\d+)F')
    for shp, rec in zip(rdr.iterShapes(), rdr.iterRecords()):
        d = rec.as_dict()
        floors = d.get('bud_floor') or 0
        if floors <= 0:
            m = att_re.match(str(d.get('budatt_no') or ''))
            if m:
                floors = int(m.group(3))
        if floors <= 0:
            continue  # no floor signal — the layer is signal-only
        pts = shp.points
        if not shp.parts:
            continue  # one record in the snapshot carries no geometry at all
        parts = list(shp.parts) + [len(pts)]
        # Only the FIRST ring is the building outline. The extra
        # parts in this dataset are inner rings: measured on the
        # 2026-10 snapshot, single-part rings are uniformly clockwise
        # (shapefile outer winding) while 6,077 of 6,099 extra rings
        # run counter-clockwise with a median area of 0.37 m2 —
        # courtyard/vent holes and cadastral slivers, not buildings.
        ring = []
        for (x, y) in pts[parts[0]:parts[1]]:
            lat, lon = tm2_to_wgs(x, y)
            ring.append((lat, lon))
        if len(ring) >= 4:
            out.append({'ring': ring, 'floors': int(floors)})
    kept = []
    for p in out:
        clat = sum(q[0] for q in p['ring']) / len(p['ring'])
        clon = sum(q[1] for q in p['ring']) / len(p['ring'])
        if in_tile(clat, clon, MARGIN):
            kept.append(p)
    print(f'[permits] polygons with floors: {len(out)} citywide, {len(kept)} in tile', file=sys.stderr)
    return kept


# ---------- doors (dataset 155472, unit-row CSV) ----------
CN = {'一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
      '壹': 1, '貳': 2, '參': 3, '肆': 4, '伍': 5, '陸': 6, '柒': 7, '捌': 8, '玖': 9, '拾': 10}
FLOOR_RE = re.compile(r'([0-9一二三四五六七八九十壹貳參肆伍陸柒捌玖拾]+)樓')


def cn_num(s):
    if not s:
        return None
    if s.isdigit():
        return int(s)
    if s == '十':
        return 10
    total = 0
    cur = 0
    for ch in s:
        if ch in ('十', '拾'):
            total += (cur or 1) * 10
            cur = 0
        elif ch in CN:
            cur = CN[ch]
        else:
            return None
    return total + cur or None


def row_floor(hao):
    import unicodedata
    hao = unicodedata.normalize('NFKC', hao or '')
    if '地下' in hao:
        return 0  # basement unit; doesn't raise the point's max
    m = FLOOR_RE.search(hao)
    if m:
        v = cn_num(m.group(1))
        if v:
            return v
    return 1  # base address (號 with no 樓）


def read_doors(csv_path):
    points = {}  # (tmx, tmy) rounded to 0.1 -> max floor
    n = 0
    with open(csv_path, newline='', encoding='utf-8') as f:
        rd = csv.DictReader(f)
        for row in rd:
            n += 1
            try:
                x = float(row['橫座標'])
                y = float(row['縱座標'])
            except (TypeError, ValueError):
                continue
            fl = row_floor(row['號'])
            key = (round(x, 1), round(y, 1))
            if fl > points.get(key, -1):
                points[key] = fl
    print(f'[doors] unit rows: {n}; unique plate points citywide: {len(points)}', file=sys.stderr)
    out = []
    for (x, y), fl in points.items():
        lat, lon = tm2_to_wgs(x, y)
        if in_tile(lat, lon, 0.0005):
            out.append((lat, lon, fl))
    print(f'[doors] plate points in tile: {len(out)}', file=sys.stderr)
    return out


# ---------- OSM footprints (Geofabrik PBF, 3-pass like the study) ----------
def read_osm(pbf):
    import osmium
    class NodePass(osmium.SimpleHandler):
        def __init__(self):
            super().__init__()
            self.nodes = {}
        def node(self, nd):
            if in_tile(nd.location.lat, nd.location.lon, MARGIN):
                self.nodes[nd.id] = (nd.location.lat, nd.location.lon)

    class WayPass(osmium.SimpleHandler):
        def __init__(self, nodes):
            super().__init__()
            self.nodes = nodes
            self.bways = {}
            self.rels = []
            self.member_ids = set()
        def way(self, w):
            if 'building' in w.tags:
                nids = [x.ref for x in w.nodes]
                if any(i in self.nodes for i in nids):
                    self.bways[w.id] = (dict(w.tags), nids)
        def relation(self, r):
            if 'building' in r.tags:
                mem = [(m.ref, m.role) for m in r.members if m.type == 'w']
                self.rels.append((dict(r.tags), mem))
                self.member_ids.update(ref for ref, _ in mem)

    class MemberPass(osmium.SimpleHandler):
        def __init__(self, wanted):
            super().__init__()
            self.wanted = wanted
            self.ways = {}
        def way(self, w):
            if w.id in self.wanted:
                self.ways[w.id] = [x.ref for x in w.nodes]

    def parse_f(tags, key):
        v = tags.get(key)
        if v:
            try:
                return float(str(v).replace('m', '').strip().split()[0])
            except Exception:
                return None
        return None

    np_ = NodePass()
    np_.apply_file(pbf, locations=False)
    print(f'[osm] nodes in tile+margin: {len(np_.nodes)}', file=sys.stderr)
    wp = WayPass(np_.nodes)
    wp.apply_file(pbf, locations=False)
    print(f'[osm] building ways: {len(wp.bways)}; relations: {len(wp.rels)}', file=sys.stderr)
    mp = MemberPass(wp.member_ids)
    mp.apply_file(pbf, locations=False)
    nodes = np_.nodes

    def centroid(ring):
        return (sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring))

    out = []
    for wid, (tags, nids) in wp.bways.items():
        ring = [nodes[i] for i in nids if i in nodes]
        if len(ring) < 4:
            continue
        clat, clon = centroid(ring)
        if not in_tile(clat, clon):
            continue
        out.append({'ring': ring, 'height': parse_f(tags, 'height'),
                    'levels': parse_f(tags, 'building:levels')})

    def stitch(way_ids):
        segs = []
        for wid in way_ids:
            nids = mp.ways.get(wid)
            if nids and len(nids) >= 2:
                segs.append(list(nids))
        rings = []
        while segs:
            cur = segs.pop()
            changed = True
            while changed:
                changed = False
                for s in list(segs):
                    if s[0] == cur[-1]:
                        cur += s[1:]; segs.remove(s); changed = True
                    elif s[-1] == cur[-1]:
                        cur += s[-2::-1]; segs.remove(s); changed = True
                    elif s[-1] == cur[0]:
                        cur = s[:-1] + cur; segs.remove(s); changed = True
                    elif s[0] == cur[0]:
                        cur = s[1:][::-1] + cur; segs.remove(s); changed = True
            rings.append(cur)
        return rings

    n_rel = 0
    for tags, members in wp.rels:
        outer = [ref for ref, role in members if role in ('outer', '')]
        if not outer:
            continue
        rings = stitch(outer)
        if not rings:
            continue
        best = max(rings, key=len)
        ring = [nodes[i] for i in best if i in nodes]
        if len(ring) < 4:
            continue
        clat, clon = centroid(ring)
        if not in_tile(clat, clon):
            continue
        n_rel += 1
        out.append({'ring': ring, 'height': parse_f(tags, 'height'),
                    'levels': parse_f(tags, 'building:levels')})
    kept = [b for b in out if b['height'] or b['levels']]
    print(f'[osm] footprints in tile: {len(out)} ({n_rel} from relations); '
          f'with height/levels signal: {len(kept)}', file=sys.stderr)
    return kept


# ---------- ring thinning ----------
def thin_ring(ring, tol_m=0.25):
    """Drop points within tol of the chord through their neighbours.
    Input/output: [(lat, lon), ...] (not necessarily closed)."""
    if len(ring) <= 4:
        return ring
    if ring[0] != ring[-1]:
        ring = ring + [ring[0]]
    # work in a local metre frame (origin at first point)
    lat0, lon0 = ring[0]
    kx = 111320.0 * math.cos(math.radians(lat0))
    ky = 110540.0
    pts = [( (lon - lon0) * kx, (lat - lat0) * ky ) for (lat, lon) in ring]
    core = pts[:-1]  # ring is closed here; drop the repeated last point
    keep = [True] * len(core)
    for i in range(len(core)):
        if not keep[i]:
            continue
        # previous / next KEPT points (the ring wraps)
        j = (i - 1) % len(core)
        while not keep[j] and j != i:
            j = (j - 1) % len(core)
        a = core[j]
        k = (i + 1) % len(core)
        while not keep[k] and k != i:
            k = (k + 1) % len(core)
        b = core[k]
        px, py = core[i]
        ax, ay = a
        bx, by = b
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        if L2 < 1e-12:
            dist = math.hypot(px - ax, py - ay)
        else:
            t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
            dist = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
        if dist < tol_m:
            keep[i] = False
    out = [core[i] for i in range(len(core)) if keep[i]]
    if len(out) < 3:
        return ring
    res = [(lat0 + y / ky, lon0 + x / kx) for (x, y) in out]
    res.append(res[0])
    return res


def point_in_ring(lat, lon, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        yi, xi = ring[i]
        yj, xj = ring[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


# ---------- factor validation (printed every run) ----------
def validate_factors(osm_all, permits, doors):
    """MAE of floors x candidate vs OSM height tags, per source."""
    cands = [3.0, 3.3, 3.5, 3.85, 4.0]
    def mae(pairs, f):
        return sum(abs(fl * f - h) for fl, h in pairs) / len(pairs) if pairs else float('nan')
    # OSM levels vs OSM height on the same footprint
    lv = [(b['levels'], b['height']) for b in osm_all if b['levels'] and b['height']]
    print(f'[validate] osm levels vs height: n={len(lv)} ' +
          ' '.join(f'{c}m/f MAE {mae(lv, c):.2f}' for c in cands), file=sys.stderr)
    # doors inside a height-tagged OSM footprint
    grid = {}
    for (lat, lon, fl) in doors:
        grid.setdefault((int(lat / 0.0009), int(lon / 0.0009)), []).append((lat, lon, fl))
    dp = []
    for b in osm_all:
        if not b['height']:
            continue
        clat = sum(p[0] for p in b['ring']) / len(b['ring'])
        clon = sum(p[1] for p in b['ring']) / len(b['ring'])
        for (lat, lon, fl) in grid.get((int(clat / 0.0009), int(clon / 0.0009)), ()):
            if point_in_ring(lat, lon, b['ring']):
                dp.append((fl, b['height']))
    print(f'[validate] door floors vs osm height: n={len(dp)} ' +
          ' '.join(f'{c}m/f MAE {mae(dp, c):.2f}' for c in cands), file=sys.stderr)
    # permit floors: permit centroid inside a height-tagged OSM footprint
    pp = []
    hgrid = {}
    for b in osm_all:
        if not b['height']:
            continue
        clat = sum(p[0] for p in b['ring']) / len(b['ring'])
        clon = sum(p[1] for p in b['ring']) / len(b['ring'])
        hgrid.setdefault((int(clat / 0.0009), int(clon / 0.0009)), []).append(b)
    for p in permits:
        clat = sum(q[0] for q in p['ring']) / len(p['ring'])
        clon = sum(q[1] for q in p['ring']) / len(p['ring'])
        for b in hgrid.get((int(clat / 0.0009), int(clon / 0.0009)), ()):
            if point_in_ring(clat, clon, b['ring']):
                pp.append((p['floors'], b['height']))
                break
    print(f'[validate] permit floors vs osm height: n={len(pp)} ' +
          ' '.join(f'{c}m/f MAE {mae(pp, c):.2f}' for c in cands), file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pbf', default=os.environ.get('TAIPEI_PBF'))
    ap.add_argument('--src', default=os.path.join(HERE, 'data', 'heights-downloads'))
    ap.add_argument('--out', default=os.path.join(HERE, 'data', 'osm_heights.json'))
    ap.add_argument('--offline', action='store_true')
    args = ap.parse_args()
    if not args.pbf or not os.path.exists(args.pbf):
        raise SystemExit('need --pbf PATH (or TAIPEI_PBF) pointing at the Geofabrik Taiwan extract')

    permits_path, permits_rec = fetch('permits', args.src, args.offline)
    doors_path, doors_rec = fetch('doors', args.src, args.offline)
    permits = read_permits(permits_path)
    doors = read_doors(doors_path)
    osm = read_osm(args.pbf)
    validate_factors(osm, permits, doors)

    footprints = []
    for p in permits:
        ring = thin_ring(p['ring'])
        footprints.append({'src': 'permit', 'floors': p['floors'], 'height': None,
                           'ring': [[round(a, 7), round(o, 7)] for a, o in ring]})
    for b in osm:
        ring = thin_ring(b['ring'])
        footprints.append({'src': 'osm', 'floors': b['levels'], 'height': b['height'],
                           'ring': [[round(a, 7), round(o, 7)] for a, o in ring]})
    layer = {
        'version': 1,
        'generator': 'tools/taipei/build-heights.py (issue #128)',
        'builtAt': date.today().isoformat(),
        'licence': LICENCE + '; OpenStreetMap (ODbL)',
        'factors': FACTORS,
        'sources': {
            'permits': permits_rec,
            'doors': doors_rec,
            'osm': {'dataset': 'OpenStreetMap building footprints (height / building:levels tags)',
                    'licence': 'ODbL', 'extract': os.path.basename(args.pbf)},
        },
        'footprints': footprints,
        'doors': [[round(a, 7), round(o, 7), f] for (a, o, f) in doors],
    }
    with open(args.out, 'w') as f:
        json.dump(layer, f, separators=(',', ':'))
    print(f'[heights] wrote {args.out} ({os.path.getsize(args.out) / 1e6:.2f} MB): '
          f'{len(footprints)} signal footprints, {len(doors)} door points', file=sys.stderr)


if __name__ == '__main__':
    main()
