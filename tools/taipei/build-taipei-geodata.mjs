// tools/taipei/build-taipei-geodata.mjs — M0 spike builder.
// Reads Overpass-style JSON from tools/taipei/data/ (osm_roads/osm_water/osm_parks/
// osm_landmarks.json, produced either by the .overpassql queries via Overpass or by
// extract-from-pbf.py from a Geofabrik extract) and writes js/taipei-geodata.js
// exporting TAIPEI_GEO. Self-contained: does NOT import upstream geo-base.mjs
// (that module loads NYC CSCL data at import time); the tangent-plane math below
// is copied from it.
//
// Frame: origin Taipei 101, LAT0=25.0330 LON0=121.5650, bearing 0 deg,
// 1 unit = 1 m, x = east, z = south (north = -z). Tile bbox:
// lat 25.020..25.060, lon 121.535..121.580.
// usage: node tools/taipei/build-taipei-geodata.mjs [out.js]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.TAIPEI_DATA || path.join(HERE, 'data');
const OUT = process.argv[2] || path.join(HERE, '..', '..', 'js', 'taipei-geodata.js');
const load = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

// ---- frame (copied tangent-plane math from upstream tools/geo-base.mjs) ----
const LAT0 = 25.0330, LON0 = 121.5650;
const TILE = { s: 25.020, w: 121.535, n: 25.060, e: 121.580 };
const A = 6378137.0, E2 = 6.69437999014e-3;
const PHI0 = (LAT0 * Math.PI) / 180, SIN0 = Math.sin(PHI0);
const NRAD = A / Math.sqrt(1 - E2 * SIN0 * SIN0);
const MRAD = (A * (1 - E2)) / Math.pow(1 - E2 * SIN0 * SIN0, 1.5);
const KX = (Math.PI / 180) * NRAD * Math.cos(PHI0); // metres per degree lon
const KY = (Math.PI / 180) * MRAD;                  // metres per degree lat
const toWorld = (lon, lat) => [(lon - LON0) * KX, -(lat - LAT0) * KY]; // [x, z], bearing 0
const q = (v) => Math.round(v * 10) / 10;
const BBOX = (() => {
  const [x0, z1] = toWorld(TILE.w, TILE.s); // south-west: z is max (south = +z)
  const [x1, z0] = toWorld(TILE.e, TILE.n);
  return { minX: q(x0), maxX: q(x1), minZ: q(z0), maxZ: q(z1) };
})();

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
  const lanes = parseInt(tags.lanes || '', 10);
  if (Number.isFinite(lanes) && lanes > 0) return Math.round(lanes * 3.2 * 10) / 10;
  const w = parseFloat(tags.width || '');
  if (Number.isFinite(w) && w > 0) return w;
  return WIDTH_BY_CLASS[tags.highway] ?? 6;
}
// Clip a polyline to the tile rect, returning runs (an OSM way can enter/leave
// the tile several times). Liang-Barsky per segment.
function clipRuns(pts, bb) {
  const runs = [];
  let run = [];
  const push = (p) => { const l = run[run.length - 1]; if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) > 0.01) run.push(p); };
  const flush = () => { if (run.length >= 2) runs.push(run); run = []; };
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az;
    let t0 = 0, t1 = 1, ok = true;
    for (const [p, qv] of [[-dx, ax - bb.minX], [dx, bb.maxX - ax], [-dz, az - bb.minZ], [dz, bb.maxZ - az]]) {
      if (Math.abs(p) < 1e-12) { if (qv < 0) { ok = false; break; } continue; }
      const r = qv / p;
      if (p < 0) t0 = Math.max(t0, r); else t1 = Math.min(t1, r);
      if (t0 > t1) { ok = false; break; }
    }
    if (!ok) { flush(); continue; }
    const pA = t0 === 0 ? [ax, az] : [ax + t0 * dx, az + t0 * dz];
    const pB = t1 === 1 ? [bx, bz] : [ax + t1 * dx, az + t1 * dz];
    if (t0 > 0 && run.length) flush(); // re-entering after a gap starts a new run
    push(pA); push(pB);
    if (t1 < 1) flush();
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

const roads = [];
const roadClassCounts = {};
let roadLenM = 0;
for (const el of load('osm_roads.json').elements) {
  if (el.type !== 'way' || !el.tags?.highway || !el.geometry || el.geometry.length < 2) continue;
  const runs = clipRuns(geomPts(el), BBOX);
  if (!runs.length) continue;
  roadClassCounts[el.tags.highway] = (roadClassCounts[el.tags.highway] || 0) + 1;
  for (const pts of runs) {
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    roadLenM += len;
    roads.push({
      name: el.tags.name || '', nameEn: el.tags['name:en'] || '', highway: el.tags.highway,
      width: roadWidth(el.tags), oneway: ['yes', 'true', '1', '-1'].includes(el.tags.oneway || ''),
      pts: flat(pts),
    });
  }
}

// ---- water & parks ----
function collectPolys(file, minArea) {
  const out = [];
  for (const el of load(file).elements) {
    for (const rawRing of elRings(el)) {
      if (rawRing.length < 4) continue;
      const ring = clipRing(rawRing, BBOX);
      if (ring.length < 4) continue;
      const area = Math.abs(ringArea(ring));
      if (area < minArea) continue;
      out.push({ name: el.tags?.name || el.tags?.['name:en'] || '', ring: flat(ring), area });
    }
  }
  return out;
}
// Rivers: in this tile OSM maps the Keelung River as a centreline only (no bank
// polygon), so derive a surface by buffering the centreline. Default width 160 m
// (no width tag in OSM for these ways) — flagged derived:'centreline-buffer'.
const riverPolys = [];
for (const el of load('osm_water.json').elements) {
  if (el.type !== 'way' || el.tags?.waterway !== 'river' || !el.geometry) continue;
  const all = geomPts(el);
  const near = all.filter(([x, z]) => x >= BBOX.minX - 300 && x <= BBOX.maxX + 300 && z >= BBOX.minZ - 300 && z <= BBOX.maxZ + 300);
  if (near.length < 2) continue;
  const wtag = parseFloat(el.tags.width || '');
  const raw = bufferLine(near, (Number.isFinite(wtag) ? wtag : 160) / 2);
  const ring = raw ? clipRing(raw, BBOX) : null;
  if (ring && ring.length >= 4) riverPolys.push({ name: el.tags.name || el.tags['name:en'] || '', ring: flat(ring), area: Math.abs(ringArea(ring)), derived: 'centreline-buffer' });
}
const waterRaw = [...collectPolys('osm_water.json', 50), ...riverPolys];
const parksRaw = collectPolys('osm_parks.json', 100);
const water = waterRaw.map(({ name, ring, derived }) => (derived ? { name, ring, derived } : { name, ring }));
const parks = parksRaw.map(({ name, ring }) => ({ name, ring }));
const waterArea = waterRaw.reduce((s, w) => s + w.area, 0);
const parksArea = parksRaw.reduce((s, p) => s + p.area, 0);

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
  frame: { origin: 'Taipei 101 (25.0330, 121.5650)', originLatLon: [LAT0, LON0], bearingDeg: 0, units: 'm', bbox: BBOX },
  roads, water, parks, landmarks, blocks,
};
const header = `// js/taipei-geodata.js — GENERATED by tools/taipei/build-taipei-geodata.mjs (M0 spike), do not edit by hand.\n// Taipei tile lat ${TILE.s}..${TILE.n}, lon ${TILE.w}..${TILE.e} in the world frame: 1 unit = 1 m,\n// origin at Taipei 101 (25.0330, 121.5650), x = east, z = south, bearing 0 deg.\n// Sources: (c) OpenStreetMap contributors (ODbL), via Overpass queries in tools/taipei/data/ or Geofabrik extract.\n`;
fs.writeFileSync(OUT, `${header}export const TAIPEI_GEO = ${JSON.stringify(TAIPEI_GEO)};\n`);

// ---- stats ----
console.log('[taipei-geodata] frame bbox', JSON.stringify(BBOX), `(${((BBOX.maxX - BBOX.minX) / 1000).toFixed(2)} km x ${((BBOX.maxZ - BBOX.minZ) / 1000).toFixed(2)} km)`);
console.log(`[taipei-geodata] roads: ${roads.length} ways, ${(roadLenM / 1000).toFixed(1)} km total`);
console.log('[taipei-geodata] road classes:', Object.entries(roadClassCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' '));
console.log(`[taipei-geodata] water: ${water.length} polygons, ${(waterArea / 1e6).toFixed(3)} km2`);
console.log(`[taipei-geodata] parks: ${parks.length} polygons, ${(parksArea / 1e6).toFixed(3)} km2`);
console.log(`[taipei-geodata] blocks: ${blocks.length} (raster ${RES} m, min 400 m2; bounding rect + centroid + area, no polygon tracing)`);
console.log(`[taipei-geodata] landmarks found: ${lmSeen.length ? lmSeen.join(' | ') : '(none)'}`);
console.log(`[taipei-geodata] wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
