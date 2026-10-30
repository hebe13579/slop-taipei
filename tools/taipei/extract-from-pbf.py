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

Relation member recovery (issue #134): a multipolygon's member ways
are collected in pass 1 only when they touch the tile, but a big
river's bank ring chains far outside it — the Tamsui's true bankfull
polygon (relation 4010571), the Keelung's east polygon (3298928) and
the Xindian's lower polygon (4615380) all failed to stitch and the
rivers survived only as 160 m centreline buffers, ~300-700 m too
narrow (issue #125). So pass 2 re-reads the PBF and collects EVERY
member way of every relation of interest, wherever it runs; stitching
then sees complete rings. Recovered ways are used ONLY for stitching:
the way lists below still emit just the pass-1 (tile-touching) ways,
and a relation is emitted only when a stitched ring touches the tile.
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

EDU_AMENITIES = ('school', 'kindergarten', 'university', 'college')

def is_edu(t):
    return t.get('amenity') in EDU_AMENITIES or t.get('landuse') == 'education'

# Issue #246: park sports features (playgrounds, pitches, picnic
# tables/sites, shelters/pavilions) for the parkSports geodata
# section. Same tag set as the #246 census (census246.py); the
# derive step (build-park-sports.mjs) applies the mapping rules
# and the inside-a-park test, so the extract stays a dumb filter.
def is_park_sport(t):
    if t.get('leisure') in ('playground', 'pitch', 'track', 'picnic_table', 'shelter'):
        return True
    if t.get('amenity') == 'shelter' or t.get('building') == 'pavilion':
        return True
    if t.get('shelter_type') or t.get('tourism') == 'picnic_site':
        return True
    if t.get('sport'):
        return True
    return False

class Collector(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.ways = {}        # id -> {tags, nodes:[ids], geometry:[{lat,lon}]}
        self.nodes = {}       # id -> {tags, lat, lon} (only tagged/landmark nodes in bbox)
        self.station_nodes = {}  # id -> {tags, lat, lon} (railway station/stop nodes in bbox, issue #118)
        self.school_nodes = {}  # id -> {tags, lat, lon} (education campuses mapped as a point only, issue #221)
        self.relations = []   # {tags, members:[(type, ref, role)]}
        self.rel_member_ways = set()  # member way ids of interesting relations (pass-2 recovery)
        self.sports_nodes = {}  # id -> {tags, lat, lon} (park-sport nodes in bbox, issue #246)
    def node(self, n):
        if is_park_sport(n.tags):
            if in_bbox(n.location.lat, n.location.lon, M):
                self.sports_nodes[n.id] = {'tags': dict(n.tags), 'lat': n.location.lat, 'lon': n.location.lon}
        if is_edu(n.tags):
            if in_bbox(n.location.lat, n.location.lon, M):
                self.school_nodes[n.id] = {'tags': dict(n.tags), 'lat': n.location.lat, 'lon': n.location.lon}
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
                       or is_edu(tags)
                       or tags.get('aeroway') == 'aerodrome'
                       or tags.get('name:en') in ('Taipei 101',) or tags.get('name') == '台北101'
                       or tags.get('name:en', '').startswith(('Sun Yat-Sen', 'Taipei City Hall')))
        if interesting:
            self.relations.append({'id': r.id, 'tags': tags,
                                   'members': [(m.type, m.ref, m.role) for m in r.members]})
            self.rel_member_ways.update(m.ref for m in r.members if m.type == 'w')

class MemberRecovery(osmium.SimpleHandler):
    """Pass 2 (issue #134): fetch the member ways of interesting
    relations that pass 1 never saw, so their rings can stitch."""
    def __init__(self, collector):
        super().__init__()
        self.c = collector
    def way(self, w):
        if w.id in self.c.rel_member_ways and w.id not in self.c.ways:
            self.c.ways[w.id] = {'tags': dict(w.tags), 'nodes': [nd.ref for nd in w.nodes],
                                 'geometry': [{'lat': nd.location.lat, 'lon': nd.location.lon} for nd in w.nodes]}

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
    tile_way_ids = set(c.ways)  # pass-1 ways: the only ones the way lists may emit
    print(f'ways in tile: {len(c.ways)}, relations of interest: {len(c.relations)}')
    if c.rel_member_ways:
        MemberRecovery(c).apply_file(pbf, locations=True)
        print(f'relation member recovery: {len(c.ways) - len(tile_way_ids)} ways recovered '
              f'({len(c.rel_member_ways)} member ways of interesting relations island-wide)')

    # Roads keep their OSM node refs (aligned with geometry) so the M1 road
    # graph can dedupe junctions by node id instead of only by coordinates.
    roads = [{'type': 'way', 'id': wid, 'tags': w['tags'], 'nodes': w['nodes'], 'geometry': w['geometry']}
             for wid, w in c.ways.items() if wid in tile_way_ids and 'highway' in w['tags']]
    def is_water(t): return t.get('natural') == 'water' or t.get('waterway') in ('riverbank',)
    def is_park(t): return t.get('leisure') == 'park' or t.get('landuse') in ('grass', 'forest', 'meadow')
    LM_EN = ('Taipei 101', 'Sun Yat-Sen Memorial Hall', 'Taipei City Hall')
    def is_lm(t):
        return (t.get('name:en', '').startswith(LM_EN[:1]) or t.get('name:en') in LM_EN
                or t.get('name') in ('台北101', '國父紀念館', '臺北市政府', '台北市政府'))

    water = [{'type': 'way', 'id': wid, 'tags': w['tags'], 'geometry': w['geometry']}
             for wid, w in c.ways.items() if wid in tile_way_ids and (is_water(w['tags']) or w['tags'].get('waterway') == 'river')]
    parks = [{'type': 'way', 'id': wid, 'tags': w['tags'], 'geometry': w['geometry']}
             for wid, w in c.ways.items() if wid in tile_way_ids and is_park(t := w['tags'])]
    green = [{'type': 'way', 'id': wid, 'tags': w['tags'], 'geometry': w['geometry']}
             for wid, w in c.ways.items() if wid in tile_way_ids and green_class(w['tags']) is not None]
    landmarks = [{'type': 'way', 'id': wid, 'tags': w['tags'], 'geometry': w['geometry']}
                 for wid, w in c.ways.items() if wid in tile_way_ids and is_lm(w['tags'])]
    landmarks += [{'type': 'node', 'id': nid, 'tags': n['tags'], 'lat': n['lat'], 'lon': n['lon']}
                  for nid, n in c.nodes.items()]

    # Park sports (issue #246): every in-tile way/node carrying a
    # playground/pitch/picnic/shelter/sport tag, with geometry; the
    # derive step maps them to park-anchored rects.
    sports = [{'type': 'way', 'id': wid, 'tags': w['tags'], 'geometry': w['geometry']}
              for wid, w in c.ways.items() if wid in tile_way_ids and is_park_sport(w['tags'])]
    sports += [{'type': 'node', 'id': nid, 'tags': n['tags'], 'lat': n['lat'], 'lon': n['lon']}
               for nid, n in c.sports_nodes.items()]

    # Railways (issue #118): every way carrying a `railway` tag (tracks,
    # platforms, station outlines) with node refs preserved like roads,
    # plus the station/stop nodes — the MRT deck + station pass
    # (tools/taipei/build-mrt.mjs) digests this file.
    railways = [{'type': 'way', 'id': wid, 'tags': w['tags'], 'nodes': w['nodes'], 'geometry': w['geometry']}
                for wid, w in c.ways.items() if wid in tile_way_ids and 'railway' in w['tags']]
    railways += [{'type': 'node', 'id': nid, 'tags': n['tags'], 'lat': n['lat'], 'lon': n['lon']}
                 for nid, n in c.station_nodes.items()]

    # Aeroway (issue #134): the Songshan airfield — runway/taxiway
    # centrelines, apron/terminal/hangar polygons — plus, in the
    # relation loop below, the aerodrome boundary itself. The builder
    # turns this into the planner's special-site exclusion and the
    # field's ground surfaces; the terminal/parking STRUCTURES are
    # issue #135.
    aeroway = [{'type': 'way', 'id': wid, 'tags': w['tags'], 'geometry': w['geometry']}
               for wid, w in c.ways.items() if wid in tile_way_ids and 'aeroway' in w['tags']]

    # Special sites (issue #186): the National Palace Museum grounds —
    # OSM way 827791918, landuse=recreation_ground, a tag pair no other
    # classifier takes (green_class reads leisure=recreation_ground,
    # is_park reads leisure=park / landuse grass|forest|meadow), so
    # without this list the grounds would be planned over. Issue #149:
    # the grounds are a SPECIAL SITE like the airport — the builder
    # turns this into the planner's museum-site exclusion.
    def is_npm_site(t):
        return t.get('landuse') == 'recreation_ground' and t.get('name') == '國立故宮博物院'
    sites = [{'type': 'way', 'id': wid, 'tags': w['tags'], 'geometry': w['geometry']}
             for wid, w in c.ways.items() if wid in tile_way_ids and is_npm_site(w['tags'])]
    # Education grounds (issue #221): school / kindergarten /
    # university / college campuses — the input of the procedural
    # campus generator. Ways carry their own outline; relations are
    # stitched in the loop below like every other polygon class;
    # campuses mapped as a bare node are emitted as nodes — the
    # census names them, but no generator can bound a point, so the
    # builder skips them by construction.
    schools = [{'type': 'way', 'id': wid, 'tags': w['tags'], 'geometry': w['geometry']}
               for wid, w in c.ways.items() if wid in tile_way_ids and is_edu(w['tags'])]
    schools += [{'type': 'node', 'id': nid, 'tags': n['tags'], 'lat': n['lat'], 'lon': n['lon']}
                for nid, n in c.school_nodes.items()]
    for rel in c.relations:
        outer = [ref for (t, ref, role) in rel['members'] if t == 'w' and role in ('outer', '')]
        rings = stitch(outer, c.ways)
        if not rings:
            continue
        # A relation recovered via pass 2 may live entirely outside the
        # tile (a farmland multipolygon in another county): emit only
        # relations whose rings touch the tile.
        if not any(in_bbox(p['lat'], p['lon'], M) for ring in rings for p in ring):
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
        if rel['tags'].get('aeroway') == 'aerodrome':
            aeroway.append(el)
        if is_npm_site(rel['tags']):
            sites.append(el)
        if is_edu(rel['tags']):
            schools.append(el)

    # Issue #221: per-campus content stats. The generator needs to
    # know what OSM already mapped inside each ground — a university
    # with many building footprints and NO pitch anywhere (NTUT's
    # dense urban campus) must not grow a fictional running track,
    # while a ground carrying a mapped track should keep the track
    # archetype. Pitch/track polygons and building footprints are
    # joined by centroid against each ground's rings, here where
    # every tile way is already in memory.
    def _shoelace_m2(geom):
        a = 0.0
        for i in range(len(geom)):
            g1, g2 = geom[i], geom[(i + 1) % len(geom)]
            a += (g1['lon'] * 100842.0) * (g2['lat'] * 110996.0) - (g2['lon'] * 100842.0) * (g1['lat'] * 110996.0)
        return abs(a) / 2.0
    def _centroid(geom):
        return (sum(g['lat'] for g in geom) / len(geom), sum(g['lon'] for g in geom) / len(geom))
    def _in_ring(lat, lon, ring):
        inside = False
        j = len(ring) - 1
        for i in range(len(ring)):
            li, loi = ring[i]['lat'], ring[i]['lon']
            lj, loj = ring[j]['lat'], ring[j]['lon']
            if (li > lat) != (lj > lat) and lon < (loj - loi) * (lat - li) / (lj - li) + loi:
                inside = not inside
            j = i
        return inside
    pitch_pts, building_pts = [], []
    for wid, w in c.ways.items():
        if wid not in tile_way_ids or not w['geometry']:
            continue
        t = w['tags']
        if t.get('leisure') in ('pitch', 'track'):
            la, lo = _centroid(w['geometry'])
            is_track = (t.get('leisure') == 'track' or t.get('sport') in ('running', 'athletics')
                        or '跑道' in t.get('name', '') or '田徑' in t.get('name', ''))
            pitch_pts.append((la, lo, _shoelace_m2(w['geometry']), is_track))
        elif 'building' in t:
            la, lo = _centroid(w['geometry'])
            building_pts.append((la, lo))
    for el in schools:
        if el['type'] == 'node':
            continue
        rings = el.get('rings') or ([el['geometry']] if el.get('geometry') else [])
        rings = [r for r in rings if len(r) >= 4 and r[0] == r[-1]] or rings
        if not rings:
            continue
        lats = [g['lat'] for r in rings for g in r]; lons = [g['lon'] for r in rings for g in r]
        bb = (min(lats), min(lons), max(lats), max(lons))
        def _inside(la, lo):
            if not (bb[0] <= la <= bb[2] and bb[1] <= lo <= bb[3]):
                return False
            return any(_in_ring(la, lo, r) for r in rings)
        ps = [p for p in pitch_pts if _inside(p[0], p[1])]
        bs = [b for b in building_pts if _inside(b[0], b[1])]
        el['campusStats'] = {
            'pitches': len(ps),
            'pitchAreaM2': round(sum(p[2] for p in ps)),
            # The largest single sports surface: a real running
            # track (or field) is ONE big polygon (>= ~3000 m2 for
            # a 200 m-class track), while a dense campus's courts
            # are many small ones — the sum alone cannot tell NTUT's
            # seven courts from a track, so the generator's
            # dense-built veto reads this, not the sum.
            'largestPitchM2': round(max((p[2] for p in ps), default=0)),
            'hasTrack': any(p[3] for p in ps),
            'buildings': len(bs),
        }

    import os
    for name, els in [('osm_roads', roads), ('osm_water', water), ('osm_parks', parks), ('osm_landmarks', landmarks), ('osm_green', green), ('osm_railways', railways), ('osm_aeroway', aeroway), ('osm_sites', sites), ('osm_schools', schools), ('osm_park_sports', sports)]:
        path = os.path.join(outdir, name + '.json')
        with open(path, 'w') as f:
            json.dump({'version': 0.7, 'generator': 'extract-from-pbf.py (Geofabrik Taiwan extract)', 'elements': els}, f)
        print(f'{name}.json: {len(els)} elements')

if __name__ == '__main__':
    main()
