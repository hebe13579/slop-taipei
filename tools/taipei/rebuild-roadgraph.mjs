// tools/taipei/rebuild-roadgraph.mjs — recompute ONLY the `roadGraph`
// section of js/taipei-geodata.js from the merged inputs
// (tools/taipei/data/osm_roads.json + tools/taipei/tile-boxes.json),
// with issue #252 level tags. The helpers below are copied verbatim
// from tools/taipei/build-taipei-geodata.mjs so a recompute of the
// shipped bake can be PROVEN identical before the level-tagged
// section is spliced in: run with --strip-level and diff the parsed
// output against the current section — it must match exactly.
// The runtime filter (non-ground levels excluded from the ground
// traffic graph) lives in js/taipei-traffic.js, not in this data:
// every edge carries its level here so the deck-traffic work
// (issue #254) can read it later.
//
// usage: node tools/taipei/rebuild-roadgraph.mjs [--strip-level] [out.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pedestrianLayout } from './pedestrian-layout.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.TAIPEI_DATA || path.join(HERE, 'data');
const load = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

const LAT0 = 25.0330, LON0 = 121.5650;
const TILE_CFG = JSON.parse(fs.readFileSync(path.join(HERE, 'tile-boxes.json'), 'utf8'));
const A = 6378137.0, E2 = 6.69437999014e-3;
const PHI0 = (LAT0 * Math.PI) / 180, SIN0 = Math.sin(PHI0);
const NRAD = A / Math.sqrt(1 - E2 * SIN0 * SIN0);
const MRAD = (A * (1 - E2)) / Math.pow(1 - E2 * SIN0 * SIN0, 1.5);
const KX = (Math.PI / 180) * NRAD * Math.cos(PHI0);
const KY = (Math.PI / 180) * MRAD;
const toWorld = (lon, lat) => [(lon - LON0) * KX, -(lat - LAT0) * KY];
const q = (v) => Math.round(v * 10) / 10;
const BOXES_WORLD = TILE_CFG.boxes.map((b) => {
  const [x0, z1] = toWorld(b.w, b.s);
  const [x1, z0] = toWorld(b.e, b.n);
  return { name: b.name, minX: q(x0), maxX: q(x1), minZ: q(z0), maxZ: q(z1) };
});
const geomPts = (el) => (el.geometry || []).map((g) => toWorld(g.lon, g.lat));

const WIDTH_BY_CLASS = { motorway: 22, motorway_link: 10, trunk: 22, trunk_link: 10, primary: 18, primary_link: 9, secondary: 14, secondary_link: 8, tertiary: 11, tertiary_link: 7, unclassified: 8, residential: 8, living_street: 6, service: 5, pedestrian: 3, footway: 3, path: 3, cycleway: 3, steps: 2, track: 4, road: 8, construction: 6, busway: 7, corridor: 2, elevator: 2, platform: 3, crossing: 3, traffic_island: 2 };
function roadWidth(tags) {
  const w = parseFloat(tags.width || '');
  if (Number.isFinite(w) && w > 0) return w;
  const lanes = parseInt(tags.lanes || '', 10);
  if (Number.isFinite(lanes) && lanes > 0) return Math.round(lanes * 3.2 * 10) / 10;
  const name = tags.name || '';
  if (tags.service === 'alley' || name.includes('弄')) return 3;
  if (name.includes('巷')) return 6;
  return WIDTH_BY_CLASS[tags.highway] ?? 6;
}

// Issue #252: the OSM level of a way — explicit `layer` wins, else a
// bridge sits at 1, a tunnel at -1, everything else at ground 0.
function wayLevel(tags) {
  const raw = tags.layer;
  if (raw !== undefined && raw !== '' && raw !== null) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n)) return n;
  }
  if (tags.bridge && tags.bridge !== 'no') return 1;
  if (tags.tunnel && tags.tunnel !== 'no') return -1;
  return 0;
}

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
      if (t0 > 0 && run.length) flush();
      push(pA); push(pB);
      if (t1 < 1) flush();
    }
  }
  flush();
  return runs;
}

const NON_CARRIAGEWAY = new Set(['footway', 'path', 'steps', 'pedestrian', 'cycleway', 'corridor', 'elevator', 'crossing', 'platform', 'traffic_island']);
const graphSequences = [];
const roadsElements = load('osm_roads.json').elements;
for (const el of roadsElements) {
  if (el.type !== 'way' || !el.tags?.highway || !el.geometry || el.geometry.length < 2) continue;
  const nodeIds = Array.isArray(el.nodes) && el.nodes.length === el.geometry.length ? el.nodes : null;
  const runs = clipRuns(geomPts(el), BOXES_WORLD, nodeIds);
  if (!runs.length) continue;
  const width = roadWidth(el.tags);
  const layout = pedestrianLayout(el.tags, width);
  const onewayRaw = el.tags.oneway || '';
  const level = wayLevel(el.tags);
  for (const records of runs) {
    if (!NON_CARRIAGEWAY.has(el.tags.highway)) {
      graphSequences.push({
        name: el.tags.name || el.tags['name:en'] || '', highway: el.tags.highway, width, level,
        oneway: ['yes', 'true', '1', '-1'].includes(onewayRaw), reverse: onewayRaw === '-1',
        pedestrianLayout: layout, records,
      });
    }
  }
}

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
          pedestrianLayout: s.pedestrianLayout, length: Math.round(length * 10) / 10, level: s.level,
        });
      }
    }
  }
  return { nodes, edges };
}

const stripLevel = process.argv.includes('--strip-level');
const outPath = process.argv.filter((a) => !a.startsWith('--'))[2];
const roadGraph = buildRoadGraph(graphSequences);
if (stripLevel) {
  for (const e of roadGraph.edges) delete e.level;
}
const byLevel = {};
for (const e of roadGraph.edges) byLevel[e.level ?? 0] = (byLevel[e.level ?? 0] || 0) + 1;
let groundKm = 0, totalKm = 0;
for (const e of roadGraph.edges) { totalKm += e.length || 0; if ((e.level ?? 0) === 0) groundKm += e.length || 0; }
console.log(`[rebuild-roadgraph] nodes=${roadGraph.nodes.length / 2} edges=${roadGraph.edges.length} levels=${JSON.stringify(byLevel)} totalKm=${(totalKm / 1000).toFixed(1)} groundKm=${(groundKm / 1000).toFixed(1)}`);
if (outPath) {
  fs.writeFileSync(outPath, JSON.stringify(roadGraph));
  console.log(`[rebuild-roadgraph] wrote ${outPath}`);
}
