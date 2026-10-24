import { TAIPEI_GEO } from './taipei-geodata.js';

// js/taipei-adapter.js
// Converts the Taipei-native TAIPEI_GEO (tools/taipei/build-taipei-geodata.mjs)
// into the GEO-shaped object documented in tools/taipei/GEO_CONTRACT.md, for
// the fields the M0/M1 data can honestly supply.
//
// UNSUPPORTED / STUBBED FIELDS — explicit, no silent fakes:
//   streets: []        — NYC numbered-street grid; no Taipei equivalent.
//                        Taipei code paths must never call streetZ().
//   avenues: []        — NYC named-avenue grid; same rule for avenueX().
//   broadway: []       — NYC-specific diagonal.
//   manhattan: []      — no island coastline; Taipei land is the tile
//                        rectangle minus `water` (see `tileLand` below).
//   upperManhattan: [], innerShore: [] — shoreline concepts, n/a.
//   islands: {}        — none modelled in this tile.
//   boroughs: all empty ring lists — surrounding scenery is a later tile
//                        profile concern (mountain ring), not geodata yet.
//   centralPark: null  — Da'an Forest Park is a normal entry in `parks`.
//   piers: []          — inland tile, n/a.
//   bridges: {}        — Keelung River crossings exist as graph roads; no
//                        parametric bridge specs yet (later increment).
//   points: {}         — no named tower/point table yet.
//   landmarks[name].h / .area / .ring: null — the spike has centre + bbox
//                        (w/d) only; heights and footprint rings were not
//                        extracted. w*d is NOT passed off as footprint area.
//   blocks[][1] (lot rects): [] for every block, and blocks[][5] (frontage
//                        frames): 0 — lot subdivision was never computed.
//                        Block polygons below are the raster components'
//                        BOUNDING RECTANGLES, for ground rendering only.
//                        buildings.js must stay stubbed in Taipei mode until
//                        real lot rects exist.
//   frame.cutZ / .strip: null — Manhattan shoreline concepts, n/a.
//   frame.sidewalk: null — DELIBERATE: Taiwan has no uniform sidewalk width.
//                        Pedestrian space is per-road: every native road and
//                        graph edge carries `pedestrianLayout`
//                        (sidewalk | arcade | painted | shared), and the
//                        upstream tuple roads keep it on `roadGraphNative`.
//   roads tuple dir: 'FT' for one-way ways ('TW' otherwise). The native
//                        roads do not preserve oneway=-1 reversal; the road
//                        graph does (its one-way edges are emitted in the
//                        legal travel direction), so route on the graph.
//   roads tuple lanes: 0 (unknown) — lane counts were used at build time for
//                        width inference but are not retained per road.

const q = (v) => Math.round(v * 10) / 10;
const ringArea = (flatRing) => {
  let a = 0;
  for (let i = 0, j = flatRing.length - 2; i < flatRing.length; j = i, i += 2) {
    a += flatRing[j] * flatRing[i + 1] - flatRing[i] * flatRing[j + 1];
  }
  return a / 2;
};
const HIGHWAY_CLASSES = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link']);

export function adaptTaipeiGeo(source = TAIPEI_GEO) {
  const bb = source.frame.bbox;
  // Upstream-compatible road graph: nodes stay flat [x, z, ...]; links are
  // [a, b, nameIndex, width, lanes(0=unknown), dir(1 = a->b only, 0 = both),
  // innerShapePoints] where inner is [] because graph edges are straight
  // segments between graph nodes by construction.
  const names = [];
  const nameIndex = new Map();
  const nameId = (name) => {
    if (!nameIndex.has(name)) { nameIndex.set(name, names.length); names.push(name); }
    return nameIndex.get(name);
  };
  const links = (source.roadGraph?.edges || []).map((e) => [
    e.a, e.b, nameId(e.name || ''), e.width || 0, 0, e.oneway ? 1 : 0, [],
  ]);
  const tileLand = [bb.minX, bb.minZ, bb.maxX, bb.minZ, bb.maxX, bb.maxZ, bb.minX, bb.maxZ, bb.minX, bb.minZ];
  return {
    version: source.version,
    frame: {
      bearingDeg: source.frame.bearingDeg,
      origin: source.frame.origin,
      originLatLon: source.frame.originLatLon,
      units: source.frame.units,
      bbox: bb,
      cutZ: null,
      strip: null,
      sidewalk: null,
      pedestrianLayoutModel: 'per-road',
    },
    // Taipei-specific land model: the tile rectangle is land except where a
    // `water` ring (in the native geodata / `water` below) cuts it.
    tileLand,
    water: source.water,
    manhattan: [],
    upperManhattan: [],
    innerShore: [],
    islands: {},
    boroughs: { brooklyn: [], queens: [], bronx: [], statenIsland: [], newJersey: [] },
    streets: [],
    avenues: [],
    broadway: [],
    plazas: [],
    roads: source.roads.map((r) => [
      r.name || r.nameEn || '', r.width || 0, r.oneway ? 'FT' : 'TW', 0,
      HIGHWAY_CLASSES.has(r.highway) ? 1 : 0, r.pts,
    ]),
    roadGraph: { nodes: source.roadGraph ? source.roadGraph.nodes : [], links, names },
    roadGraphNative: source.roadGraph || { nodes: [], edges: [] },
    blocks: source.blocks.map((b) => [[
      b.bbox.minX, b.bbox.minZ, b.bbox.maxX, b.bbox.minZ,
      b.bbox.maxX, b.bbox.maxZ, b.bbox.minX, b.bbox.maxZ,
    ], [], 0, '', 1, 0]),
    parks: source.parks.map((p) => ({
      name: p.name || '',
      cat: 'park',
      acres: Math.round((Math.abs(ringArea(p.ring)) / 4046.8564224) * 100) / 100,
      rings: [p.ring],
    })),
    centralPark: null,
    piers: [],
    bridges: {},
    landmarks: Object.fromEntries(Object.entries(source.landmarks).map(([key, lm]) => [key, {
      x: lm.x, z: lm.z, w: lm.w, d: lm.d, h: null, area: null, ring: null, name: lm.name || '',
    }])),
    points: {},
  };
}

export const TAIPEI_GEO_ADAPTED = adaptTaipeiGeo();

// --- Taipei lookups (graph/road based; no street/avenue grid anywhere) ---

const ROAD_CELL = 64;
const roadGrid = new Map();
for (const r of TAIPEI_GEO.roads) {
  if (!r.name && !r.nameEn) continue;
  for (let i = 0; i + 3 < r.pts.length; i += 2) {
    const seg = { name: r.name || r.nameEn, nameEn: r.nameEn || '', highway: r.highway, ax: r.pts[i], az: r.pts[i + 1], bx: r.pts[i + 2], bz: r.pts[i + 3] };
    const ix0 = Math.floor(Math.min(seg.ax, seg.bx) / ROAD_CELL), ix1 = Math.floor(Math.max(seg.ax, seg.bx) / ROAD_CELL);
    const iz0 = Math.floor(Math.min(seg.az, seg.bz) / ROAD_CELL), iz1 = Math.floor(Math.max(seg.az, seg.bz) / ROAD_CELL);
    for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
      const k = ix * 100000 + iz;
      if (!roadGrid.has(k)) roadGrid.set(k, []);
      roadGrid.get(k).push(seg);
    }
  }
}

// Roadbed grid for the "road you are on" test. The generation map's roadbeds
// (not the raw carriageways) are the right footprint: a divided boulevard is
// ONE wide bed there, so a driver in its middle lanes is on it even though
// both raw carriageway centrelines run metres to either side. A point counts
// as ON a road when its centreline distance is within half the bed width
// plus a kerb margin; among overlapping beds (junctions) the winner is the
// one the point sits deepest inside (smallest dist − halfWidth).
const BED_CELL = 64;
const BED_ON_RADIUS = 64; // > max half bed width (~29 m) + margin, with slack
const NON_CARRIAGEWAY_BED = new Set(['footway', 'path', 'steps', 'pedestrian', 'cycleway', 'corridor', 'elevator', 'crossing', 'platform', 'traffic_island']);
const bedGrid = new Map();
for (const b of TAIPEI_GEO.roadbeds || []) {
  if (!b.name || NON_CARRIAGEWAY_BED.has(b.highway)) continue;
  for (let i = 0; i + 3 < b.pts.length; i += 2) {
    const seg = { name: b.name, width: b.width || 0, ax: b.pts[i], az: b.pts[i + 1], bx: b.pts[i + 2], bz: b.pts[i + 3] };
    const ix0 = Math.floor(Math.min(seg.ax, seg.bx) / BED_CELL), ix1 = Math.floor(Math.max(seg.ax, seg.bx) / BED_CELL);
    const iz0 = Math.floor(Math.min(seg.az, seg.bz) / BED_CELL), iz1 = Math.floor(Math.max(seg.az, seg.bz) / BED_CELL);
    for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
      const k = ix * 100000 + iz;
      if (!bedGrid.has(k)) bedGrid.set(k, []);
      bedGrid.get(k).push(seg);
    }
  }
}

/**
 * The carriageway road (x, z) is standing/driving on, from the roadbed
 * footprints: { name, dist, width, horizontal } or null when the point is
 * off every roadbed (park or block interior, a plaza, …).
 */
export function currentTaipeiRoad(x, z) {
  let best = null;
  const ix0 = Math.floor((x - BED_ON_RADIUS) / BED_CELL), ix1 = Math.floor((x + BED_ON_RADIUS) / BED_CELL);
  const iz0 = Math.floor((z - BED_ON_RADIUS) / BED_CELL), iz1 = Math.floor((z + BED_ON_RADIUS) / BED_CELL);
  for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
    for (const s of bedGrid.get(ix * 100000 + iz) || []) {
      const dx = s.bx - s.ax, dz = s.bz - s.az;
      const L2 = dx * dx + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / L2));
      const d = Math.hypot(s.ax + t * dx - x, s.az + t * dz - z);
      const half = s.width / 2;
      if (d > half + 3) continue;
      const key = d - half;
      if (!best || key < best.key || (key === best.key && d < best.dist)) {
        best = { name: s.name, dist: d, width: s.width, horizontal: Math.abs(dx) > Math.abs(dz), key };
      }
    }
  }
  return best && { name: best.name, dist: best.dist, width: best.width, horizontal: best.horizontal };
}

/** Nearest named roads to (x, z): [{ name, nameEn, highway, dist, horizontal }] sorted by distance. */
export function nearestTaipeiRoads(x, z, radius = 160) {
  const best = new Map();
  const ix0 = Math.floor((x - radius) / ROAD_CELL), ix1 = Math.floor((x + radius) / ROAD_CELL);
  const iz0 = Math.floor((z - radius) / ROAD_CELL), iz1 = Math.floor((z + radius) / ROAD_CELL);
  for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
    for (const s of roadGrid.get(ix * 100000 + iz) || []) {
      const dx = s.bx - s.ax, dz = s.bz - s.az;
      const L2 = dx * dx + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / L2));
      const d = Math.hypot(s.ax + t * dx - x, s.az + t * dz - z);
      if (d > radius) continue;
      const prev = best.get(s.name);
      if (!prev || d < prev.dist) best.set(s.name, { name: s.name, nameEn: s.nameEn, highway: s.highway, dist: d, horizontal: Math.abs(dx) > Math.abs(dz) });
    }
  }
  return [...best.values()].sort((a, b) => a.dist - b.dist);
}

/** Nearest carriageway graph node to (x, z): { index, x, z, dist } or null. */
export function nearestGraphNode(x, z) {
  const nodes = TAIPEI_GEO.roadGraph?.nodes || [];
  let best = null;
  for (let i = 0; i + 1 < nodes.length; i += 2) {
    const d = Math.hypot(nodes[i] - x, nodes[i + 1] - z);
    if (!best || d < best.dist) best = { index: i / 2, x: nodes[i], z: nodes[i + 1], dist: d };
  }
  return best;
}

const LANDMARK_LIST = Object.entries(TAIPEI_GEO.landmarks).map(([key, lm]) => ({ key, ...lm }));
const NON_CARRIAGEWAY = new Set(['footway', 'path', 'steps', 'pedestrian', 'cycleway', 'corridor', 'elevator', 'crossing', 'platform', 'traffic_island']);

/**
 * Location label — Taipei analogue of city-config's getLocationLabel.
 * String shape is the one main.js's renderLocation renders: an optional
 * "Place · " prefix, then street names joined by " & " (one green plate
 * each, in order). The first street is the road the player is ON when a
 * roadbed contains the point (see currentTaipeiRoad); the second is the
 * cross street. Off-road points keep the nearest-roads pair.
 */
export function getTaipeiLocationLabel(x, z) {
  const roadsLabel = () => {
    const near = nearestTaipeiRoads(x, z, 160).filter((r) => !NON_CARRIAGEWAY.has(r.highway));
    // Lead with the road the player is actually ON (its roadbed footprint
    // contains the point), then the nearest differently-named cross street.
    // The old nearest-pair ordering flipped to the cross street whenever its
    // raw centreline passed closer — e.g. crossing a junction on a wide
    // merged boulevard, whose own centrelines run metres to either side.
    const cur = currentTaipeiRoad(x, z);
    if (cur) {
      const cross = near.find((r) => r.name !== cur.name && r.horizontal !== cur.horizontal)
        || near.find((r) => r.name !== cur.name);
      return cross ? `${cur.name} & ${cross.name}` : cur.name;
    }
    // Off-road (park, block interior, landmark site): nearest pair, as before.
    const a = near[0];
    const b = a && near.find((r) => r.name !== a.name && r.horizontal !== a.horizontal);
    if (a && b) return `${a.name} & ${b.name}`;
    return a ? a.name : '';
  };
  let nearestLm = null;
  for (const lm of LANDMARK_LIST) {
    const d = Math.hypot(x - lm.x, z - lm.z);
    if (d < 100 && (!nearestLm || d < nearestLm.d)) nearestLm = { ...lm, d };
  }
  if (nearestLm) {
    const roads = roadsLabel();
    return `${nearestLm.key}${roads ? ` · ${roads}` : ''}`;
  }
  return roadsLabel() || taipeiDistrictAt(x, z);
}

/**
 * Approximate named zones for the Xinyi tile. These are orientation zones
 * derived from the tile geography, NOT legal district boundaries (those are a
 * later data import); they exist so labels/profiles have something honest to
 * return instead of NYC neighbourhood names.
 */
export function taipeiDistrictAt(x, z) {
  const bb = TAIPEI_GEO.frame.bbox;
  if (x < bb.minX || x > bb.maxX || z < bb.minZ || z > bb.maxZ) return 'Outside the Taipei tile';
  if (z < -1900) return x > -1500 ? 'Songshan (Keelung River)' : 'Zhongshan / Songshan Airport fringe';
  if (x >= -700) return z < -1100 ? 'Songshan' : 'Xinyi';
  return z >= -350 ? "Da'an (south)" : "Da'an";
}

export { TAIPEI_GEO };
