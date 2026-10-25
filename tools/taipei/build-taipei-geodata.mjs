// tools/taipei/build-taipei-geodata.mjs — M0 spike builder.
// Reads Overpass-style JSON from tools/taipei/data/ (osm_roads/osm_water/osm_parks/
// osm_landmarks.json, produced either by the .overpassql queries via Overpass or by
// extract-from-pbf.py from a Geofabrik extract) and writes js/taipei-geodata.js
// exporting TAIPEI_GEO. Self-contained: does NOT import upstream geo-base.mjs
// (that module loads NYC CSCL data at import time); the tangent-plane math below
// is copied from it.
//
// Frame: origin Taipei 101, LAT0=25.0330 LON0=121.5650, bearing 0 deg,
// 1 unit = 1 m, x = east, z = south (north = -z). The tile is the UNION
// of the boxes in tools/taipei/tile-boxes.json (issue #60): every clip
// below runs against the union of the box rects, so geometry crossing a
// box seam stays whole and the dropped bands between/around the boxes
// carry no data at all. frame.bbox is the union's bounding rect (the
// runtime clamp rect); frame.boxes carries the union itself.
// usage: node tools/taipei/build-taipei-geodata.mjs [out.js]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pedestrianLayout } from './pedestrian-layout.mjs';
import { buildElevated } from './build-elevated.mjs';
import { planTaipeiBuildings } from '../../js/taipei-buildings.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.TAIPEI_DATA || path.join(HERE, 'data');
const OUT = process.argv[2] || path.join(HERE, '..', '..', 'js', 'taipei-geodata.js');
const load = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

// ---- frame (copied tangent-plane math from upstream tools/geo-base.mjs) ----
const LAT0 = 25.0330, LON0 = 121.5650;
const TILE_CFG = JSON.parse(fs.readFileSync(path.join(HERE, 'tile-boxes.json'), 'utf8'));
const A = 6378137.0, E2 = 6.69437999014e-3;
const PHI0 = (LAT0 * Math.PI) / 180, SIN0 = Math.sin(PHI0);
const NRAD = A / Math.sqrt(1 - E2 * SIN0 * SIN0);
const MRAD = (A * (1 - E2)) / Math.pow(1 - E2 * SIN0 * SIN0, 1.5);
const KX = (Math.PI / 180) * NRAD * Math.cos(PHI0); // metres per degree lon
const KY = (Math.PI / 180) * MRAD;                  // metres per degree lat
const toWorld = (lon, lat) => [(lon - LON0) * KX, -(lat - LAT0) * KY]; // [x, z], bearing 0
const q = (v) => Math.round(v * 10) / 10;
// The tile's boxes as world-frame rects (issue #60). Abutting boxes
// share an edge VALUE (both derive it from the same lon/lat through the
// same q() rounding), so seam arithmetic below is exact.
const BOXES_WORLD = TILE_CFG.boxes.map((b) => {
  const [x0, z1] = toWorld(b.w, b.s); // south-west: z is max (south = +z)
  const [x1, z0] = toWorld(b.e, b.n);
  return { name: b.name, minX: q(x0), maxX: q(x1), minZ: q(z0), maxZ: q(z1) };
});
// The union's bounding rect: frame.bbox, the runtime clamp rect.
const BBOX = {
  minX: Math.min(...BOXES_WORLD.map((b) => b.minX)), maxX: Math.max(...BOXES_WORLD.map((b) => b.maxX)),
  minZ: Math.min(...BOXES_WORLD.map((b) => b.minZ)), maxZ: Math.max(...BOXES_WORLD.map((b) => b.maxZ)),
};

// ---- geometry helpers (from upstream geo-base.mjs, trimmed) ----
function ringArea(pts) { // pts: [[x,z],...]
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return a / 2;
}
const flat = (pts) => pts.flatMap(([x, z]) => [q(x), q(z)]);
const geomPts = (el) => (el.geometry || []).map((g) => toWorld(g.lon, g.lat));
const elRings = (el) => {
  if (el.rings) return el.rings.map((r) => r.map((g) => toWorld(g.lon, g.lat)));
  const pts = geomPts(el);
  // Only CLOSED ways are polygons. Open waterway=river centrelines must not be
  // polygonised (doing so turned the Keelung River centreline into a fake 98 km2 blob).
  if (pts.length >= 4) {
    const [fx, fz] = pts[0], [lx, lz] = pts[pts.length - 1];
    if (Math.hypot(fx - lx, fz - lz) < 0.5) return [pts];
  }
  return [];
};
// Buffer an open centreline into a polygon (left offsets forward + right offsets back).
function bufferLine(pts, halfWidth) {
  const n = pts.length;
  if (n < 2) return null;
  const normals = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1];
    const L = Math.hypot(dx, dz) || 1;
    normals.push([-dz / L, dx / L]);
  }
  const left = pts.map(([x, z], i) => [x + normals[i][0] * halfWidth, z + normals[i][1] * halfWidth]);
  const right = pts.map(([x, z], i) => [x - normals[i][0] * halfWidth, z - normals[i][1] * halfWidth]).reverse();
  return [...left, ...right, left[0]];
}

// ---- roads ----
const WIDTH_BY_CLASS = { motorway: 22, motorway_link: 10, trunk: 22, trunk_link: 10, primary: 18, primary_link: 9, secondary: 14, secondary_link: 8, tertiary: 11, tertiary_link: 7, unclassified: 8, residential: 8, living_street: 6, service: 5, pedestrian: 3, footway: 3, path: 3, cycleway: 3, steps: 2, track: 4, road: 8, construction: 6, busway: 7, corridor: 2, elevator: 2, platform: 3, crossing: 3, traffic_island: 2 };
function roadWidth(tags) {
  // Taiwan streetscape rule (user direction, 2026-10-23): never widen a narrow
  // way to a class default when OSM says how narrow it really is. An explicit
  // width wins, then lane count, then a name-based narrow default for
  // 巷 (lanes, ~4-8 m) / 弄 (alleys, ~2-4 m) / service alleys, then the class.
  const w = parseFloat(tags.width || '');
  if (Number.isFinite(w) && w > 0) return w;
  const lanes = parseInt(tags.lanes || '', 10);
  if (Number.isFinite(lanes) && lanes > 0) return Math.round(lanes * 3.2 * 10) / 10;
  const name = tags.name || '';
  if (tags.service === 'alley' || name.includes('弄')) return 3;
  if (name.includes('巷')) return 6;
  return WIDTH_BY_CLASS[tags.highway] ?? 6;
}
// pedestrianLayout lives in ./pedestrian-layout.mjs, shared with
// build-generation-map.mjs so the two builders can never disagree.

// Clip a polyline to the UNION of the tile's box rects, returning runs
// (an OSM way can enter/leave the union several times). Per segment the
// Liang-Barsky interval against EACH box is computed and the intervals
// merged before points are emitted: the boxes abut on shared edges, so
// a way crossing a seam yields ONE continuous run through the seam
// point (computed identically from both sides) instead of two runs
// ending at the same place — that is the whole seam story for ways.
// Points are records {x, z, nodeId}: nodeId is the OSM node id when the
// point is an original way vertex and the source element carried
// aligned `nodes` refs (the PBF extractor preserves them; Overpass-style
// JSON without refs leaves them null, and the road graph then falls back
// to rounded coordinates). Synthetic boundary points always have
// nodeId null.
function clipRuns(pts, boxes, nodeIds = null) {
  const runs = [];
  let run = [];
  const push = (p) => {
    const l = run[run.length - 1];
    if (!l || Math.hypot(p.x - l.x, p.z - l.z) > 0.01) run.push(p);
    else if (l.nodeId == null && p.nodeId != null) l.nodeId = p.nodeId;
  };
  const flush = () => { if (run.length >= 2) runs.push(run); run = []; };
  const segIntervals = (ax, az, dx, dz) => {
    const out = [];
    for (const bb of boxes) {
      let t0 = 0, t1 = 1, ok = true;
      for (const [p, qv] of [[-dx, ax - bb.minX], [dx, bb.maxX - ax], [-dz, az - bb.minZ], [dz, bb.maxZ - az]]) {
        if (Math.abs(p) < 1e-12) { if (qv < 0) { ok = false; break; } continue; }
        const r = qv / p;
        if (p < 0) t0 = Math.max(t0, r); else t1 = Math.min(t1, r);
        if (t0 > t1) { ok = false; break; }
      }
      if (ok) out.push([t0, t1]);
    }
    out.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const iv of out) {
      const last = merged[merged.length - 1];
      if (last && iv[0] <= last[1] + 1e-9) last[1] = Math.max(last[1], iv[1]);
      else merged.push([iv[0], iv[1]]);
    }
    return merged;
  };
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az;
    const ivs = segIntervals(ax, az, dx, dz);
    if (!ivs.length) { flush(); continue; }
    for (const [t0, t1] of ivs) {
      const idA = nodeIds && t0 === 0 ? nodeIds[i] : null;
      const idB = nodeIds && t1 === 1 ? nodeIds[i + 1] : null;
      const pA = t0 === 0 ? { x: ax, z: az, nodeId: idA } : { x: ax + t0 * dx, z: az + t0 * dz, nodeId: null };
      const pB = t1 === 1 ? { x: bx, z: bz, nodeId: idB } : { x: ax + t1 * dx, z: az + t1 * dz, nodeId: null };
      if (t0 > 0 && run.length) flush(); // re-entering after a gap starts a new run
      push(pA); push(pB);
      if (t1 < 1) flush();
    }
  }
  flush();
  return runs;
}
// Sutherland-Hodgman clip of a closed ring to the tile rect.
function clipRing(ring, bb) {
  const edges = [
    (p) => p[0] >= bb.minX, (a, b) => { const t = (bb.minX - a[0]) / (b[0] - a[0]); return [bb.minX, a[1] + t * (b[1] - a[1])]; },
    (p) => p[0] <= bb.maxX, (a, b) => { const t = (bb.maxX - a[0]) / (b[0] - a[0]); return [bb.maxX, a[1] + t * (b[1] - a[1])]; },
    (p) => p[1] >= bb.minZ, (a, b) => { const t = (bb.minZ - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), bb.minZ]; },
    (p) => p[1] <= bb.maxZ, (a, b) => { const t = (bb.maxZ - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), bb.maxZ]; },
  ];
  let poly = ring.slice(0, -1); // drop duplicated closing point
  for (let e = 0; e < edges.length; e += 2) {
    const inside = edges[e], intersect = edges[e + 1];
    const src = poly; poly = [];
    for (let i = 0; i < src.length; i++) {
      const cur = src[i], prev = src[(i + src.length - 1) % src.length];
      if (inside(cur)) { if (!inside(prev)) poly.push(intersect(prev, cur)); poly.push(cur); }
      else if (inside(prev)) poly.push(intersect(prev, cur));
    }
    if (!poly.length) break;
  }
  if (poly.length >= 3) poly.push(poly[0]);
  return poly;
}
// Clip a closed ring to the UNION of the box rects: one Sutherland–
// Hodgman piece per box. The boxes abut on shared edges (they never
// overlap in area), so the pieces tile ring ∩ union without double
// area; a ring crossing a seam comes back as multiple pieces, which
// downstream consumers (collectPolys) emit as sibling polygons with
// the same name/tags — the seam story for areas.
function clipRingUnion(ring, boxes) {
  const out = [];
  for (const bb of boxes) {
    const piece = clipRing(ring, bb);
    if (piece.length >= 4) out.push(piece);
  }
  return out;
}

const roads = [];
const graphSequences = []; // clipped carriageway runs with node ids, for the road graph below
const roadClassCounts = {};
let roadLenM = 0;
const NON_CARRIAGEWAY = new Set(['footway', 'path', 'steps', 'pedestrian', 'cycleway', 'corridor', 'elevator', 'crossing', 'platform', 'traffic_island']);
const roadsElements = load('osm_roads.json').elements;
for (const el of roadsElements) {
  if (el.type !== 'way' || !el.tags?.highway || !el.geometry || el.geometry.length < 2) continue;
  const nodeIds = Array.isArray(el.nodes) && el.nodes.length === el.geometry.length ? el.nodes : null;
  const runs = clipRuns(geomPts(el), BOXES_WORLD, nodeIds);
  if (!runs.length) continue;
  roadClassCounts[el.tags.highway] = (roadClassCounts[el.tags.highway] || 0) + 1;
  const width = roadWidth(el.tags);
  const layout = pedestrianLayout(el.tags, width);
  const onewayRaw = el.tags.oneway || '';
  for (const records of runs) {
    const pts = records.map((p) => [p.x, p.z]);
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    roadLenM += len;
    roads.push({
      name: el.tags.name || '', nameEn: el.tags['name:en'] || '', highway: el.tags.highway,
      width, oneway: ['yes', 'true', '1', '-1'].includes(onewayRaw), pedestrianLayout: layout,
      pts: flat(pts),
    });
    if (!NON_CARRIAGEWAY.has(el.tags.highway)) {
      graphSequences.push({
        name: el.tags.name || el.tags['name:en'] || '', highway: el.tags.highway, width,
        oneway: ['yes', 'true', '1', '-1'].includes(onewayRaw), reverse: onewayRaw === '-1',
        pedestrianLayout: layout, records,
      });
    }
  }
}

// ---- road graph (M1) ----
// Nodes are deduped by OSM node id where the source carried refs, else by
// rounded (0.1 m) coordinates. A point is a junction if it is an endpoint of
// any carriageway run or is shared by more than one run; ways are split at
// junctions and each sub-path is RDP-simplified at 1 m (junctions and ends are
// never simplified away), then consecutive retained points become edges.
// For oneway=-1 ways the edge is emitted b->a so that, for one-way edges, the
// a->b direction is always the legal travel direction.
const GRAPH_RDP_EPS = 1.0;
function buildRoadGraph(sequences) {
  const keyOf = (p) => (p.nodeId != null ? `n:${p.nodeId}` : `c:${q(p.x)},${q(p.z)}`);
  const seqCount = new Map();
  const endpointKeys = new Set();
  for (const s of sequences) {
    const seen = new Set();
    for (const p of s.records) {
      const k = keyOf(p);
      if (!seen.has(k)) { seqCount.set(k, (seqCount.get(k) || 0) + 1); seen.add(k); }
    }
    endpointKeys.add(keyOf(s.records[0]));
    endpointKeys.add(keyOf(s.records[s.records.length - 1]));
  }
  const isJunction = (p) => { const k = keyOf(p); return endpointKeys.has(k) || (seqCount.get(k) || 0) > 1; };
  const rdpRecords = (records, eps) => {
    if (records.length < 3) return records;
    const keep = new Uint8Array(records.length);
    keep[0] = keep[records.length - 1] = 1;
    const stack = [[0, records.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      const A = records[a], B = records[b];
      const dx = B.x - A.x, dz = B.z - A.z, L = Math.hypot(dx, dz) || 1e-9;
      let best = -1, bi = -1;
      for (let i = a + 1; i < b; i++) {
        const d = Math.abs((records[i].x - A.x) * dz - (records[i].z - A.z) * dx) / L;
        if (d > best) { best = d; bi = i; }
      }
      if (best > eps) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
    }
    return records.filter((_, i) => keep[i]);
  };
  const nodeIndex = new Map();
  const nodes = [];
  const nodeFor = (p) => {
    const k = keyOf(p);
    if (!nodeIndex.has(k)) { nodeIndex.set(k, nodes.length / 2); nodes.push(q(p.x), q(p.z)); }
    return nodeIndex.get(k);
  };
  const edges = [];
  for (const s of sequences) {
    const cuts = [0];
    for (let i = 1; i < s.records.length - 1; i++) if (isJunction(s.records[i])) cuts.push(i);
    cuts.push(s.records.length - 1);
    for (let c = 0; c + 1 < cuts.length; c++) {
      const sub = rdpRecords(s.records.slice(cuts[c], cuts[c + 1] + 1), GRAPH_RDP_EPS);
      for (let i = 1; i < sub.length; i++) {
        let a = nodeFor(sub[i - 1]);
        let b = nodeFor(sub[i]);
        if (a === b) continue;
        const length = Math.hypot(sub[i].x - sub[i - 1].x, sub[i].z - sub[i - 1].z);
        if (length < 0.05) continue;
        if (s.reverse) [a, b] = [b, a];
        edges.push({
          a, b, name: s.name, highway: s.highway, oneway: s.oneway, width: s.width,
          pedestrianLayout: s.pedestrianLayout, length: Math.round(length * 10) / 10,
        });
      }
    }
  }
  return { nodes, edges };
}
const roadGraph = buildRoadGraph(graphSequences);
const graphStats = (() => {
  const n = roadGraph.nodes.length / 2;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (const e of roadGraph.edges) { const a = find(e.a), b = find(e.b); if (a !== b) parent[b] = a; }
  const counts = new Map();
  for (let i = 0; i < n; i++) { const r = find(i); counts.set(r, (counts.get(r) || 0) + 1); }
  const largest = Math.max(0, ...counts.values());
  return { nodes: n, edges: roadGraph.edges.length, components: counts.size, largest, largestPct: n ? (100 * largest) / n : 0 };
})();

// ---- roadbeds (generation map, issue #6) ----
// The curated render layer produced by tools/taipei/build-generation-map.mjs
// from the SAME raw extracts: divided boulevards merged into single
// roadbeds, sub-120 m *_link ramps excluded, per-roadbed provenance back to
// raw way ids. This builder is a dumb consumer — every rework rule lives
// in the generation-map script, and the raw extracts are never edited.
// `roads` and `roadGraph` above are deliberately NOT affected: routing and
// the pre-merge record stay exactly as extracted. When generation-map.json
// is absent, roadbeds is null and the boot falls back to per-way ribbons,
// so the pipeline still builds from a bare extract.
let roadbeds = null;
{
  const gmPath = path.join(DATA, 'generation-map.json');
  if (fs.existsSync(gmPath)) {
    const gm = JSON.parse(fs.readFileSync(gmPath, 'utf8'));
    roadbeds = gm.roadbeds.map((b) => ({
      name: b.name, highway: b.highway, width: b.width, pedestrianLayout: b.pedestrianLayout,
      pts: b.centreline, sourceWayIds: b.sourceWayIds, ...(b.merged ? { merged: true } : {}),
      ...(b.deck ? { deck: true } : {}),
    }));
    console.log(`[taipei-geodata] roadbeds: ${roadbeds.length} from generation map (${gm.stats.mergeGroups} merged boulevard groups, ${gm.stats.linkWaysExcluded} short link ways excluded)`);
  } else {
    console.warn('[taipei-geodata] WARNING: generation-map.json missing — roadbeds null (run tools/taipei/build-generation-map.mjs). Boot falls back to per-way road ribbons.');
  }
}

// ---- water & parks ----
function collectPolys(file, minArea) {
  const out = [];
  for (const el of load(file).elements) {
    for (const rawRing of elRings(el)) {
      if (rawRing.length < 4) continue;
      for (const ring of clipRingUnion(rawRing, BOXES_WORLD)) {
        const area = Math.abs(ringArea(ring));
        if (area < minArea) continue;
        out.push({ name: el.tags?.name || el.tags?.['name:en'] || '', ring: flat(ring), area });
      }
    }
  }
  return out;
}
// Rivers: in this tile OSM maps the Keelung River as a centreline only (no bank
// polygon), so derive a surface by buffering the centreline. Default width 160 m
// (no width tag in OSM for these ways) — flagged derived:'centreline-buffer'.
const riverPolys = [];
// Issue #102: the flat 160 m default folds any stream whose meanders
// run closer together than the ribbon is wide — every Beitou/Tianmu
// creek （磺溪， 磺港溪， 貴子坑溪， 水磨坑溪， …) shipped as a
// self-intersecting blob (30 rings). A ribbon wider than the
// centreline's own local clearance overlaps itself by construction,
// so each vertex's half-width is clamped to 0.45x ITS distance to the
// non-adjacent centreline (floor 1.5 m): the ribbon pinches only at
// the tight spot — a meander neck, a confluence jog, an island tip —
// and keeps full width elsewhere. (A single global cap per river was
// measured and rejected: the Keelung's tightest jog is 13.6 m, which
// would have shrunk the whole river to a 12 m ribbon.) A piece that
// still folds after clamping retries at half width; a piece still
// invalid at the floor is dropped and booked in the log line below —
// invalid geometry never ships.
const segPtDist = (p, a, b) => {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const L2 = dx * dx + dz * dz;
  const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2)) : 0;
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dz * t));
};
const vertexClearances = (pts) => pts.map((p, i) => {
  let m = Infinity;
  for (let j = 0; j + 1 < pts.length; j++) {
    if (j === i - 1 || j === i) continue; // segments touching vertex i
    m = Math.min(m, segPtDist(p, pts[j], pts[j + 1]));
  }
  return m;
});
const bufferLineVar = (pts, halfArr) => {
  const n = pts.length;
  if (n < 2) return null;
  const left = [], right = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1];
    const L = Math.hypot(dx, dz) || 1;
    const nx = -dz / L, nz = dx / L;
    left.push([pts[i][0] + nx * halfArr[i], pts[i][1] + nz * halfArr[i]]);
    right.push([pts[i][0] - nx * halfArr[i], pts[i][1] - nz * halfArr[i]]);
  }
  return [...left, ...right.reverse(), left[0]];
};
const ringSelfIntersects = (pts) => {
  const cross = (p1, p2, p3, p4) => {
    const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
    if (!d) return false;
    const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
    const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
    return t > 0 && t < 1 && u > 0 && u < 1;
  };
  for (let i = 0; i + 1 < pts.length; i++)
    for (let j = i + 2; j + 1 < pts.length; j++) {
      if (i === 0 && j === pts.length - 2) continue;
      if (cross(pts[i], pts[i + 1], pts[j], pts[j + 1])) return true;
    }
  return false;
};
const riverBooked = { capped: [], dropped: [] };
for (const el of load('osm_water.json').elements) {
  if (el.type !== 'way' || el.tags?.waterway !== 'river' || !el.geometry) continue;
  const all = geomPts(el);
  const near = all.filter(([x, z]) => x >= BBOX.minX - 300 && x <= BBOX.maxX + 300 && z >= BBOX.minZ - 300 && z <= BBOX.maxZ + 300);
  if (near.length < 2) continue;
  const wtag = parseFloat(el.tags.width || '');
  const baseHalf = (Number.isFinite(wtag) ? wtag : 160) / 2;
  const clear = vertexClearances(near);
  const halfArr = clear.map((c) => Math.max(1.5, Math.min(baseHalf, 0.45 * c)));
  const minHalf = Math.min(...halfArr);
  if (minHalf < baseHalf) riverBooked.capped.push(`${el.tags.name || el.id}: min half-width ${minHalf.toFixed(1)} m at the tight vertex (base ${baseHalf.toFixed(0)})`);
  let pieces = null;
  for (const f of [1, 0.5, 0.25]) {
    const raw = bufferLineVar(near, halfArr.map((h) => h * f));
    if (!raw) break;
    const clipped = clipRingUnion(raw, BOXES_WORLD);
    if (clipped.every((ring) => !ringSelfIntersects(ring))) { pieces = clipped; break; }
  }
  if (!pieces) { riverBooked.dropped.push(el.tags.name || String(el.id)); continue; }
  for (const ring of pieces) {
    riverPolys.push({ name: el.tags.name || el.tags['name:en'] || '', ring: flat(ring), area: Math.abs(ringArea(ring)), derived: 'centreline-buffer' });
  }
}
if (riverBooked.capped.length) console.log(`[taipei-geodata] river buffers width-capped by centreline clearance: ${riverBooked.capped.join('; ')}`);
if (riverBooked.dropped.length) console.log(`[taipei-geodata] river buffers dropped (self-intersecting at every width): ${riverBooked.dropped.join('; ')}`);
const waterRaw = [...collectPolys('osm_water.json', 50), ...riverPolys];
const parksRaw = collectPolys('osm_parks.json', 100);
const water = waterRaw.map(({ name, ring, derived }) => (derived ? { name, ring, derived } : { name, ring }));
const parks = parksRaw.map(({ name, ring }) => ({ name, ring }));
const waterArea = waterRaw.reduce((s, w) => s + w.area, 0);
const parksArea = parksRaw.reduce((s, p) => s + p.area, 0);

// ---- green land (issue #114) ----
// Open land that carries no city buildings: farmland / meadow / nature /
// recreation ground, extracted to osm_green.json by extract-from-pbf.py
// (its green_class() owns the tag set). Each polygon keeps its class
// ('landuse:farmland', 'natural:wood', ...) for the census; the planner
// drops urban lots on these exactly as on parks/water. An older extract
// without osm_green.json builds with an empty layer, as before.
function greenClassOf(t) {
  if (!t) return null;
  if (['farmland', 'meadow', 'orchard', 'vineyard', 'grassland'].includes(t.landuse)) return 'landuse:' + t.landuse;
  if (['nature_reserve', 'recreation_ground'].includes(t.leisure)) return 'leisure:' + t.leisure;
  if (['wood', 'scrub', 'wetland', 'grassland'].includes(t.natural)) return 'natural:' + t.natural;
  return null;
}
const greenRaw = [];
if (fs.existsSync(path.join(DATA, 'osm_green.json'))) {
  for (const el of load('osm_green.json').elements) {
    const cls = greenClassOf(el.tags);
    if (!cls) continue;
    for (const rawRing of elRings(el)) {
      if (rawRing.length < 4) continue;
      for (const ring of clipRingUnion(rawRing, BOXES_WORLD)) {
        const area = Math.abs(ringArea(ring));
        if (area < 100) continue;
        greenRaw.push({ name: el.tags?.name || el.tags?.['name:en'] || '', cls, ring: flat(ring), area });
      }
    }
  }
}
const green = greenRaw.map(({ name, cls, ring }) => ({ name, cls, ring }));
const greenArea = greenRaw.reduce((s, p) => s + p.area, 0);

// ---- landmarks ----
const landmarks = {};
const lmSeen = [];
for (const el of load('osm_landmarks.json').elements) {
  const pts = el.type === 'node' ? [toWorld(el.lon, el.lat)] : elRings(el).flat();
  if (!pts.length) continue;
  let x0 = 1e18, x1 = -1e18, z0 = 1e18, z1 = -1e18;
  for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const key = el.tags?.['name:en'] || el.tags?.name || `osm-${el.type}-${el.id}`;
  if (landmarks[key]) continue;
  landmarks[key] = { x: q((x0 + x1) / 2), z: q((z0 + z1) / 2), w: q(x1 - x0), d: q(z1 - z0), name: el.tags?.name || '' };
  lmSeen.push(key);
}

// ---- blocks: raster method (land = tile rect minus water, roads stamped, label components) ----
const RES = 2; // m per cell (spike resolution; upstream used 1 m)
const W = Math.ceil((BBOX.maxX - BBOX.minX) / RES), H = Math.ceil((BBOX.maxZ - BBOX.minZ) / RES);
const grid = new Uint8Array(W * H).fill(1);
// Union mask (issue #60): the raster spans the union's bounding rect,
// but a cell whose centre falls outside EVERY tile box is not land —
// the dropped bands of the union (e.g. north of lat 25.055 east of
// lon 121.535) form no blocks, exactly as if the tile ended there.
const inUnionCell = (x, z) => BOXES_WORLD.some((b) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ);
for (let j = 0; j < H; j++) {
  const cz = BBOX.minZ + (j + 0.5) * RES;
  for (let i = 0; i < W; i++) {
    if (!inUnionCell(BBOX.minX + (i + 0.5) * RES, cz)) grid[j * W + i] = 0;
  }
}
function fillRing(ringFlat, val) { // scanline even-odd fill, ring as flat [x,z,...]
  const pts = [];
  for (let i = 0; i < ringFlat.length; i += 2) pts.push([ringFlat[i], ringFlat[i + 1]]);
  let zMin = 1e18, zMax = -1e18;
  for (const [, z] of pts) { zMin = Math.min(zMin, z); zMax = Math.max(zMax, z); }
  const j0 = Math.max(0, Math.floor((zMin - BBOX.minZ) / RES)), j1 = Math.min(H - 1, Math.ceil((zMax - BBOX.minZ) / RES));
  for (let j = j0; j <= j1; j++) {
    const z = BBOX.minZ + (j + 0.5) * RES;
    const xs = [];
    for (let i = 0, k = pts.length - 1; i < pts.length; k = i++) {
      const [xa, za] = pts[k], [xb, zb] = pts[i];
      if ((za > z) !== (zb > z)) xs.push(xa + ((z - za) * (xb - xa)) / (zb - za));
    }
    xs.sort((a, b) => a - b);
    for (let n = 0; n + 1 < xs.length; n += 2) {
      const i0 = Math.max(0, Math.ceil((xs[n] - BBOX.minX) / RES - 0.5));
      const i1 = Math.min(W - 1, Math.floor((xs[n + 1] - BBOX.minX) / RES - 0.5));
      for (let i = i0; i <= i1; i++) grid[j * W + i] = val;
    }
  }
}
for (const wpoly of water) fillRing(wpoly.ring, 0);
// stamp roads (only carriageway-ish classes cut blocks; footpaths would shred them)
const NON_CUTTING = new Set(['footway', 'path', 'pedestrian', 'cycleway', 'steps', 'corridor', 'elevator', 'crossing', 'platform', 'traffic_island']);
for (const r of roads) {
  if (NON_CUTTING.has(r.highway)) continue;
  const half = Math.max(r.width / 2, 1.5);
  const pts = [];
  for (let i = 0; i < r.pts.length; i += 2) pts.push([r.pts[i], r.pts[i + 1]]);
  for (let s = 0; s + 1 < pts.length; s++) {
    const [ax, az] = pts[s], [bx, bz] = pts[s + 1];
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - half - BBOX.minX) / RES)), i1 = Math.min(W - 1, Math.ceil((Math.max(ax, bx) + half - BBOX.minX) / RES));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - half - BBOX.minZ) / RES)), j1 = Math.min(H - 1, Math.ceil((Math.max(az, bz) + half - BBOX.minZ) / RES));
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9, r2 = half * half;
    for (let j = j0; j <= j1; j++) {
      const pz = BBOX.minZ + (j + 0.5) * RES;
      for (let i = i0; i <= i1; i++) {
        const k = j * W + i;
        if (!grid[k]) continue;
        const px = BBOX.minX + (i + 0.5) * RES;
        let t = ((px - ax) * dx + (pz - az) * dz) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = ax + t * dx - px, ez = az + t * dz - pz;
        if (ex * ex + ez * ez <= r2) grid[k] = 0;
      }
    }
  }
}
// label 4-connected components
const label = new Int32Array(W * H);
const blocks = [];
const stack = new Int32Array(W * H);
for (let start = 0; start < W * H; start++) {
  if (!grid[start] || label[start]) continue;
  let sp = 0, count = 0, sx = 0, sz = 0, ix0 = W, ix1 = 0, jz0 = H, jz1 = 0;
  const id = blocks.length + 1;
  stack[sp++] = start; label[start] = id;
  while (sp) {
    const cur = stack[--sp];
    const ci = cur % W, cj = (cur / W) | 0;
    count++; sx += ci; sz += cj;
    ix0 = Math.min(ix0, ci); ix1 = Math.max(ix1, ci); jz0 = Math.min(jz0, cj); jz1 = Math.max(jz1, cj);
    if (ci > 0 && grid[cur - 1] && !label[cur - 1]) { label[cur - 1] = id; stack[sp++] = cur - 1; }
    if (ci < W - 1 && grid[cur + 1] && !label[cur + 1]) { label[cur + 1] = id; stack[sp++] = cur + 1; }
    if (cj > 0 && grid[cur - W] && !label[cur - W]) { label[cur - W] = id; stack[sp++] = cur - W; }
    if (cj < H - 1 && grid[cur + W] && !label[cur + W]) { label[cur + W] = id; stack[sp++] = cur + W; }
  }
  const area = count * RES * RES;
  if (area < 400) continue;
  blocks.push({
    cx: q(BBOX.minX + ((sx / count) + 0.5) * RES), cz: q(BBOX.minZ + ((sz / count) + 0.5) * RES),
    area: Math.round(area),
    bbox: { minX: q(BBOX.minX + ix0 * RES), maxX: q(BBOX.minX + (ix1 + 1) * RES), minZ: q(BBOX.minZ + jz0 * RES), maxZ: q(BBOX.minZ + (jz1 + 1) * RES) },
  });
}
blocks.sort((a, b) => b.area - a.area);

// ---- emit ----
const TAIPEI_GEO = {
  version: 1,
  frame: { origin: 'Taipei 101 (25.0330, 121.5650)', originLatLon: [LAT0, LON0], bearingDeg: 0, units: 'm', bbox: BBOX, boxes: BOXES_WORLD },
  roads, roadGraph, roadbeds, water, parks, green, landmarks, blocks,
};

// ---- elevated decks (issue #61) ----
// Deck lines + piers from tools/taipei/build-elevated.mjs: heights
// over the elevated ways' node graph (Dijkstra from ground portals,
// 6% ramps), piers rejected against ground roadbed ribbons and the
// building plan's lots — so the pass runs after the geodata (and its
// roadbeds) exist, with the same deterministic lot plan the boot
// computes at runtime.
{
  const lotPlan = planTaipeiBuildings(TAIPEI_GEO);
  TAIPEI_GEO.elevatedRoads = buildElevated(roadsElements, TAIPEI_GEO.roadbeds || [], lotPlan.lots);
  const es = TAIPEI_GEO.elevatedRoads.stats;
  console.log(`[taipei-geodata] elevated: ${es.waysSelected} ways -> ${es.lines} deck lines (${es.lineKm} km), ${es.portals} portal nodes, ${es.unreachedNodes} unreached nodes; piers ${es.piers} (${es.pierCandidates} candidates, ${es.piersMerged} twin-merged, ${es.piersRejectedRoad} rejected on carriageways, ${es.piersRejectedLot} on lots)`);
}
const boxDesc = TILE_CFG.boxes.map((b) => `${b.name}: lat ${b.s}..${b.n}, lon ${b.w}..${b.e}`).join('; ');
const header = `// js/taipei-geodata.js — GENERATED by tools/taipei/build-taipei-geodata.mjs (M0 spike), do not edit by hand.\n// Taipei tile = union of boxes (${boxDesc}; tools/taipei/tile-boxes.json) in the world frame: 1 unit = 1 m,\n// origin at Taipei 101 (25.0330, 121.5650), x = east, z = south, bearing 0 deg.\n// Sources: (c) OpenStreetMap contributors (ODbL), via Overpass queries in tools/taipei/data/ or Geofabrik extract.\n`;
fs.writeFileSync(OUT, `${header}export const TAIPEI_GEO = ${JSON.stringify(TAIPEI_GEO)};\n`);

// ---- stats ----
console.log('[taipei-geodata] frame bbox', JSON.stringify(BBOX), `(${((BBOX.maxX - BBOX.minX) / 1000).toFixed(2)} km x ${((BBOX.maxZ - BBOX.minZ) / 1000).toFixed(2)} km)`);
console.log(`[taipei-geodata] roads: ${roads.length} ways, ${(roadLenM / 1000).toFixed(1)} km total`);
console.log(`[taipei-geodata] roadGraph: ${graphStats.nodes} nodes, ${graphStats.edges} edges, ${graphStats.components} components, largest ${graphStats.largest} nodes (${graphStats.largestPct.toFixed(2)}%)`);
console.log('[taipei-geodata] pedestrian layouts:', Object.entries(roads.reduce((m, r) => { m[r.pedestrianLayout] = (m[r.pedestrianLayout] || 0) + 1; return m; }, {})).map(([k, v]) => `${k}=${v}`).join(' '));
console.log('[taipei-geodata] road classes:', Object.entries(roadClassCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' '));
console.log(`[taipei-geodata] water: ${water.length} polygons, ${(waterArea / 1e6).toFixed(3)} km2`);
console.log(`[taipei-geodata] parks: ${parks.length} polygons, ${(parksArea / 1e6).toFixed(3)} km2`);
console.log(`[taipei-geodata] green: ${green.length} polygons, ${(greenArea / 1e6).toFixed(3)} km2 (issue #114)`);
console.log(`[taipei-geodata] blocks: ${blocks.length} (raster ${RES} m, min 400 m2; bounding rect + centroid + area, no polygon tracing)`);
console.log(`[taipei-geodata] landmarks found: ${lmSeen.length ? lmSeen.join(' | ') : '(none)'}`);
console.log(`[taipei-geodata] wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
