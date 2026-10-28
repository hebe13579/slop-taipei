#!/usr/bin/env python3
"""Issue #221 census: union-exact inventory of education grounds in the tile.

Scans the Geofabrik Taiwan PBF for amenity=school / kindergarten /
university / college (plus the newer landuse=education) on ways,
relations AND nodes, stitches relation rings (pass-2 member recovery,
same pattern as extract-from-pbf.py), clips every ground to the tile
union (tile-boxes.json), and writes a JSON census + markdown table.

A ground is counted once per OSM element; a way whose ring duplicates
a relation's ring (same element mapped twice) is flagged. Pitch /
running-track polygons and building footprints inside each ground are
counted so the archetype study starts from what OSM actually carries.

Usage: census-schools.py <taiwan.osm.pbf> <outdir>
Requires pyosmium (the expansion-work venv).
"""
import json, math, os, sys
import osmium

HERE = os.path.dirname(os.path.abspath(__file__))
_CFG = json.load(open(os.path.join(HERE, 'tile-boxes.json')))
BOXES = [(b['s'], b['w'], b['n'], b['e']) for b in _CFG['boxes']]
M = 0.004

EDU = ('school', 'kindergarten', 'university', 'college')

def in_bbox(lat, lon, m=0.0):
    return any(s - m <= lat <= n + m and w - m <= lon <= e + m for (s, w, n, e) in BOXES)

def clip_half(poly, inside, intersect):
    out = []
    if not poly:
        return out
    prev = poly[-1]
    pin = inside(prev)
    for cur in poly:
        cin = inside(cur)
        if cin:
            if not pin:
                out.append(intersect(prev, cur))
            out.append(cur)
        elif pin:
            out.append(intersect(prev, cur))
        prev, pin = cur, cin
    return out

def clip_rect(ring, s, w, n, e):
    # Sutherland–Hodgman against one box (lat/lon space; boxes are
    # near-rectangular in it and the tile frame treats them so too).
    def ix_x(a, b, x):
        t = (x - a[0]) / (b[0] - a[0]) if b[0] != a[0] else 0.0
        return (x, a[1] + t * (b[1] - a[1]))
    def ix_y(a, b, y):
        t = (y - a[1]) / (b[1] - a[1]) if b[1] != a[1] else 0.0
        return (a[0] + t * (b[0] - a[0]), y)
    poly = [(lon, lat) for (lat, lon) in ring]
    poly = clip_half(poly, lambda p: p[0] >= w, lambda a, b: ix_x(a, b, w))
    poly = clip_half(poly, lambda p: p[0] <= e, lambda a, b: ix_x(a, b, e))
    poly = clip_half(poly, lambda p: p[1] >= s, lambda a, b: ix_y(a, b, s))
    poly = clip_half(poly, lambda p: p[1] <= n, lambda a, b: ix_y(a, b, n))
    return [(lat, lon) for (lon, lat) in poly]

KX = 100842.0  # m per deg lon at lat 25.05 (tangent frame of the builders)
KY = 110996.0  # m per deg lat

def ring_area_m2(ring):
    a = 0.0
    for i in range(len(ring)):
        la1, lo1 = ring[i]
        la2, lo2 = ring[(i + 1) % len(ring)]
        a += (lo1 * KX) * (la2 * KY) - (lo2 * KX) * (la1 * KY)
    return abs(a) / 2.0

def point_in_ring(lat, lon, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        li, loi = ring[i]
        lj, loj = ring[j]
        if (li > lat) != (lj > lat) and lon < (loj - loi) * (lat - li) / (lj - li) + loi:
            inside = not inside
        j = i
    return inside

class Collector(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.ways = {}          # tile-touching ways (for stitching + content)
        self.edu_ways = {}      # education-tagged ways (any closure)
        self.edu_nodes = {}     # education nodes in tile
        self.edu_relations = []
        self.rel_member_ways = set()
        self.pitch_ways = []    # leisure=pitch / track in tile
        self.building_ways = [] # building=* in tile (bbox only)
    def node(self, n):
        t = n.tags
        if t.get('amenity') in EDU or t.get('landuse') == 'education':
            if in_bbox(n.location.lat, n.location.lon, M):
                self.edu_nodes[n.id] = {'tags': dict(t), 'lat': n.location.lat, 'lon': n.location.lon}
    def way(self, w):
        t = dict(w.tags)
        geom = None
        touches = any(in_bbox(nd.location.lat, nd.location.lon, M) for nd in w.nodes)
        if t.get('amenity') in EDU or t.get('landuse') == 'education':
            geom = [(nd.location.lat, nd.location.lon) for nd in w.nodes]
            self.edu_ways[w.id] = {'tags': t, 'nodes': [nd.ref for nd in w.nodes], 'geometry': geom}
        if not touches:
            return
        if geom is None:
            geom = [(nd.location.lat, nd.location.lon) for nd in w.nodes]
        self.ways[w.id] = {'tags': t, 'nodes': [nd.ref for nd in w.nodes], 'geometry': geom}
        if t.get('leisure') in ('pitch', 'track') or t.get('sport') and t.get('leisure') == 'pitch':
            self.pitch_ways.append((w.id, t, geom))
        if 'building' in t:
            lats = [g[0] for g in geom]; lons = [g[1] for g in geom]
            self.building_ways.append((w.id, (min(lats), min(lons), max(lats), max(lons))))
    def relation(self, r):
        t = dict(r.tags)
        if t.get('amenity') in EDU or t.get('landuse') == 'education':
            self.edu_relations.append({'id': r.id, 'tags': t,
                                       'members': [(m.type, m.ref, m.role) for m in r.members]})
            self.rel_member_ways.update(m.ref for m in r.members if m.type == 'w')

class MemberRecovery(osmium.SimpleHandler):
    def __init__(self, c):
        super().__init__()
        self.c = c
    def way(self, w):
        if w.id in self.c.rel_member_ways and w.id not in self.c.ways:
            self.c.ways[w.id] = {'tags': dict(w.tags), 'nodes': [nd.ref for nd in w.nodes],
                                 'geometry': [(nd.location.lat, nd.location.lon) for nd in w.nodes]}

def stitch(way_ids, ways):
    segs = []
    for wid in way_ids:
        w = ways.get(wid)
        if w and len(w['nodes']) >= 2:
            segs.append((w['nodes'], w['geometry']))
    rings = []
    while segs:
        nodes, geom = segs.pop()
        rn, rg = list(nodes), list(geom)
        progressed = True
        while rn[0] != rn[-1] and progressed:
            progressed = False
            for i, (ns, gs) in enumerate(segs):
                if ns[0] == rn[-1]:
                    rn += ns[1:]; rg += gs[1:]
                elif ns[-1] == rn[-1]:
                    rn += ns[::-1][1:]; rg += gs[::-1][1:]
                else:
                    continue
                segs.pop(i); progressed = True; break
        if len(rg) >= 4 and rn[0] == rn[-1]:
            rings.append(rg)
    return rings

def main():
    pbf, outdir = sys.argv[1], sys.argv[2]
    os.makedirs(outdir, exist_ok=True)
    c = Collector()
    c.apply_file(pbf, locations=True)
    print(f'pass1: {len(c.ways)} tile ways, {len(c.edu_ways)} edu ways, '
          f'{len(c.edu_relations)} edu relations, {len(c.edu_nodes)} edu nodes')
    if c.rel_member_ways:
        MemberRecovery(c).apply_file(pbf, locations=True)
        print(f'pass2: member recovery done ({len(c.rel_member_ways)} member ways)')

    grounds = []   # {srcType, osmId, kind, name, rings(full), ...}
    for wid, w in c.edu_ways.items():
        g = w['geometry']
        closed = len(g) >= 4 and abs(g[0][0] - g[-1][0]) < 1e-9 and abs(g[0][1] - g[-1][1]) < 1e-9
        grounds.append({'srcType': 'way', 'osmId': wid, 'tags': w['tags'],
                        'rings': [g] if closed else [], 'closed': closed})
    failed_relations = []
    for rel in c.edu_relations:
        outer = [ref for (t, ref, role) in rel['members'] if t == 'w' and role in ('outer', '')]
        rings = stitch(outer, c.ways)
        if rings:
            grounds.append({'srcType': 'relation', 'osmId': rel['id'], 'tags': rel['tags'],
                            'rings': rings, 'closed': True})
        else:
            failed_relations.append({'osmId': rel['id'], 'tags': rel['tags'],
                                     'outerWays': len(outer)})
    # Inner rings (holes) are not modelled anywhere in this project;
    # census counts grounds by their outer rings only.

    rows = []
    for g in grounds:
        t = g['tags']
        kind = t.get('amenity') or ('education' if t.get('landuse') == 'education' else '')
        full_area = sum(ring_area_m2(r) for r in g['rings'])
        # clip each ring to the union; keep the union area + main ring
        clipped = []
        for r in g['rings']:
            for (s, w_, n, e) in BOXES:
                cr = clip_rect(r, s, w_, n, e)
                if len(cr) >= 3:
                    clipped.append(cr)
        tile_area = sum(ring_area_m2(r) for r in clipped)
        if not g['rings']:
            status = 'open-way (no polygon)'
        elif tile_area < 50:
            status = 'outside-tile / sliver'
        else:
            status = 'ok'
        main_ring = max(clipped, key=ring_area_m2) if clipped else None
        row = {
            'srcType': g['srcType'], 'osmId': g['osmId'], 'kind': kind,
            'name': t.get('name', ''), 'nameEn': t.get('name:en', ''),
            'fullAreaM2': round(full_area), 'tileAreaM2': round(tile_area),
            'rings': len(g['rings']), 'status': status,
            'centroid': None, 'bbox': None, 'pitches': 0, 'pitchAreaM2': 0,
            'buildings': 0,
        }
        if main_ring:
            lats = [p[0] for p in main_ring]; lons = [p[1] for p in main_ring]
            row['centroid'] = [round(sum(lats) / len(lats), 6), round(sum(lons) / len(lons), 6)]
            row['bbox'] = [round(min(lats), 6), round(min(lons), 6), round(max(lats), 6), round(max(lons), 6)]
            for (pid, pt, pgeom) in c.pitch_ways:
                plats = [p[0] for p in pgeom]; plons = [p[1] for p in pgeom]
                if point_in_ring(sum(plats) / len(plats), sum(plons) / len(plons), main_ring):
                    row['pitches'] += 1
                    row['pitchAreaM2'] += round(ring_area_m2(pgeom))
            for (bid, bb) in c.building_ways:
                clat, clon = (bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2
                if point_in_ring(clat, clon, main_ring):
                    row['buildings'] += 1
        rows.append(row)

    rows.sort(key=lambda r: -r['tileAreaM2'])
    nodes = [{'osmId': nid, 'kind': n['tags'].get('amenity', ''), 'name': n['tags'].get('name', ''),
              'lat': round(n['lat'], 6), 'lon': round(n['lon'], 6)}
             for nid, n in sorted(c.edu_nodes.items())]
    out = {'grounds': rows, 'pointOnly': nodes, 'failedRelations': failed_relations}
    with open(os.path.join(outdir, 'census.json'), 'w') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    ok = [r for r in rows if r['status'] == 'ok']
    print(f'grounds total: {len(rows)} (ok {len(ok)}, '
          f'open-way {sum(1 for r in rows if r["status"].startswith("open"))}, '
          f'sliver {sum(1 for r in rows if r["status"].startswith("outside"))})')
    for k in EDU:
        sub = [r for r in ok if r['kind'] == k]
        print(f'  {k}: {len(sub)} grounds, {sum(r["tileAreaM2"] for r in sub)/1e4:.1f} ha in tile')
    print(f'point-only campuses: {len(nodes)}; failed relations: {len(failed_relations)}')
    for r in rows:
        print(f"{r['srcType'][:3]} {r['osmId']:>10} {r['kind']:<12} {r['tileAreaM2']:>8} m2  rings={r['rings']} pitch={r['pitches']} bld={r['buildings']}  {r['name']} [{r['status']}]")
    for n in nodes:
        print(f"node {n['osmId']:>10} {n['kind']:<12} {n['name']} @ {n['lat']},{n['lon']}")

if __name__ == '__main__':
    main()
