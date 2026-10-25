#!/usr/bin/env python3
"""Fallback fetcher for the M0 spike.

The Overpass endpoints (overpass-api.de, kumi.systems, nchc.org.tw) were all
at capacity / unreachable on 2026-10-23, so the tile data was extracted from
the Geofabrik Taiwan OSM extract (taiwan-261022.osm.pbf, 2026-10-23) instead.
Output is the same Overpass-style JSON the .overpassql queries would have
produced: ways as {type,id,tags,geometry:[{lat,lon}]}, relations pre-resolved
to {type,id,tags,rings:[[{lat,lon},...], ...]} (outer rings only, stitched).

Usage: extract-from-pbf.py <taiwan.osm.pbf> <outdir>
Requires pyosmium (pip install osmium, in a venv).

The tile is the UNION of the boxes in tile-boxes.json (next to this
script, issue #60): an element is collected when any of its vertices
touches any box (plus margin). Collection is keyed by OSM id, so a way
crossing a box seam is collected exactly once, with its full geometry —
the builders downstream clip against the union of the boxes, which is
where seam handling lives.
"""
import json, os, sys
import osmium

_CFG = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tile-boxes.json')))
BOXES = [(b['s'], b['w'], b['n'], b['e']) for b in _CFG['boxes']]  # (S, W, N, E) per box
M = 0.004  # margin degrees, so boundary-crossing ways/relations resolve fully

def in_bbox(lat, lon, m=0.0):
    return any(s - m <= lat <= n + m and w - m <= lon <= e + m for (s, w, n, e) in BOXES)

# Green land (issue #114): open land that must carry NO city buildings —
# farmland, nature and recreation ground. The parks extract only carries
# leisure=park (+ landuse grass/forest/meadow), so the Guandu plain
# (landuse=farmland), the riverside bands (recreation_ground / meadow)
# and wooded slopes (natural=wood) were subdivided and planted. This
# classifier is the single source of the green tag set; the builder
# (build-taipei-geodata.mjs) derives each polygon's class from the same
# tags, carried through in osm_green.json.
def green_class(t):
    lu, le, na = t.get('landuse'), t.get('leisure'), t.get('natural')
    if lu in ('farmland', 'meadow', 'orchard', 'vineyard', 'grassland'):
        return 'landuse:' + lu
    if le in ('nature_reserve', 'recreation_ground'):
        return 'leisure:' + le
    if na in ('wood', 'scrub', 'wetland', 'grassland'):
        return 'natural:' + na
    return None

class Collector(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.ways = {}        # id -> {tags, nodes:[ids], geometry:[{lat,lon}]}
        self.nodes = {}       # id -> {tags, lat, lon} (only tagged/landmark nodes in bbox)
        self.station_nodes = {}  # id -> {tags, lat, lon} (railway station/stop nodes in bbox, issue #118)
        self.relations = []   # {tags, members:[(type, ref, role)]}
    def node(self, n):
        if n.tags.get('railway') in ('station', 'stop', 'halt') or n.tags.get('public_transport') == 'station':
            if in_bbox(n.location.lat, n.location.lon, M):
                self.station_nodes[n.id] = {'tags': dict(n.tags), 'lat': n.location.lat, 'lon': n.location.lon}
        if n.tags.get('name:en') == 'Taipei 101' or n.tags.get('name') == '台北101':
            if in_bbox(n.location.lat, n.location.lon, M):
                self.nodes[n.id] = {'tags': dict(n.tags), 'lat': n.location.lat, 'lon': n.location.lon}
    def way(self, w):
        # Cheap bbox gate first: geometry dicts are built only for ways
        # touching the tile (same collected set as building them all).
        if any(in_bbox(nd.location.lat, nd.location.lon, M) for nd in w.nodes):
            geom = [{'lat': nd.location.lat, 'lon': nd.location.lon} for nd in w.nodes]
            self.ways[w.id] = {'tags': dict(w.tags), 'nodes': [nd.ref for nd in w.nodes], 'geometry': geom}
    def relation(self, r):
        tags = dict(r.tags)
        interesting = (tags.get('natural') == 'water' or tags.get('waterway') == 'riverbank'
                       or tags.get('leisure') == 'park' or tags.get('landuse') in ('grass', 'forest', 'meadow')
                       or green_class(tags) is not None
                       or tags.get('name:en') in ('Taipei 101',) or tags.get('name') == '台北101'
                       or tags.get('name:en', '').startswith(('Sun Yat-Sen', 'Taipei City Hall')))
        if interesting:
            self.relations.append({'id': r.id, 'tags': tags,
                                   'members': [(m.type, m.ref, m.role) for m in r.members]})

def stitch(way_ids, ways):
    """Chain member ways into rings by shared endpoint node ids."""
    segs = []
    for wid in way_ids:
        w = ways.get(wid)
        if w and len(w['nodes']) >= 2:
            segs.append((w['nodes'], w['geometry']))
    rings = []
    while segs:
        nodes, geom = segs.pop()
        ring_nodes, ring_geom = list(nodes), list(geom)
        progressed = True
        while ring_nodes[0] != ring_nodes[-1] and progressed:
            progressed = False
            for i, (ns, gs) in enumerate(segs):
                if ns[0] == ring_nodes[-1]:
                    ring_nodes += ns[1:]; ring_geom += gs[1:]
                elif ns[-1] == ring_nodes[-1]:
                    ring_nodes += ns[::-1][1:]; ring_geom += gs[::-1][1:]
                else:
                    continue
                segs.pop(i); progressed = True; break
        if len(ring_geom) >= 4 and ring_nodes[0] == ring_nodes[-1]:
            rings.append(ring_geom)
    return rings

def main():
    pbf, outdir = sys.argv[1], sys.argv[2]
    c = Collector()
    c.apply_file(pbf, locations=True)
    print(f'ways in tile: {len(c.ways)}, relations of interest: {len(c.relations)}')

    # Roads keep their OSM node refs (aligned with geometry) so the M1 road
    # graph can dedupe junctions by node id instead of only by coordinates.
    roads = [{'type': 'way', 'id': wid, 'tags': w['tags'], 'nodes': w['nodes'], 'geometry': w['geometry']}
             for wid, w in c.ways.items() if 'highway' in w['tags']]
    def is_water(t): return t.get('natural') == 'water' or t.get('waterway') in ('riverbank',)
    def is_park(t): return t.get('leisure') == 'park' or t.get('landuse') in ('grass', 'forest', 'meadow')
    LM_EN = ('Taipei 101', 'Sun Yat-Sen Memorial Hall', 'Taipei City Hall')
    def is_lm(t):
        return (t.get('name:en', '').startswith(LM_EN[:1]) or t.get('name:en') in LM_EN
                or t.get('name') in ('台北101', '國父紀念館', '臺北市政府', '台北市政府'))

    water = [{'type': 'way', 'id': wid, 'tags': w['tags'], 'geometry': w['geometry']}
             for wid, w in c.ways.items() if is_water(w['tags']) or w['tags'].get('waterway') == 'river']
    parks = [{'type': 'way', 'id': wid, 'tags': w['tags'], 'geometry': w['geometry']}
             for wid, w in c.ways.items() if is_park(t := w['tags'])]
    green = [{'type': 'way', 'id': wid, 'tags': w['tags'], 'geometry': w['geometry']}
             for wid, w in c.ways.items() if green_class(w['tags']) is not None]
    landmarks = [{'type': 'way', 'id': wid, 'tags': w['tags'], 'geometry': w['geometry']}
                 for wid, w in c.ways.items() if is_lm(w['tags'])]
    landmarks += [{'type': 'node', 'id': nid, 'tags': n['tags'], 'lat': n['lat'], 'lon': n['lon']}
                  for nid, n in c.nodes.items()]

    # Railways (issue #118): every way carrying a `railway` tag (tracks,
    # platforms, station outlines) with node refs preserved like roads,
    # plus the station/stop nodes — the MRT deck + station pass
    # (tools/taipei/build-mrt.mjs) digests this file.
    railways = [{'type': 'way', 'id': wid, 'tags': w['tags'], 'nodes': w['nodes'], 'geometry': w['geometry']}
                for wid, w in c.ways.items() if 'railway' in w['tags']]
    railways += [{'type': 'node', 'id': nid, 'tags': n['tags'], 'lat': n['lat'], 'lon': n['lon']}
                 for nid, n in c.station_nodes.items()]

    for rel in c.relations:
        outer = [ref for (t, ref, role) in rel['members'] if t == 'w' and role in ('outer', '')]
        rings = stitch(outer, c.ways)
        if not rings:
            continue
        el = {'type': 'relation', 'id': rel['id'], 'tags': rel['tags'], 'rings': rings}
        if is_water(rel['tags']):
            water.append(el)
        if is_park(rel['tags']):
            parks.append(el)
        if green_class(rel['tags']) is not None:
            green.append(el)
        if is_lm(rel['tags']):
            landmarks.append(el)

    import os
    for name, els in [('osm_roads', roads), ('osm_water', water), ('osm_parks', parks), ('osm_landmarks', landmarks), ('osm_green', green), ('osm_railways', railways)]:
        path = os.path.join(outdir, name + '.json')
        with open(path, 'w') as f:
            json.dump({'version': 0.6, 'generator': 'extract-from-pbf.py (Geofabrik Taiwan extract)', 'elements': els}, f)
        print(f'{name}.json: {len(els)} elements')

if __name__ == '__main__':
    main()
