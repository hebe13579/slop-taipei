// tools/taipei/build-elevated.mjs — elevated highway decks (issue #61).
//
// The deck pass between the raw extract / generation map and the
// geodata: it selects the elevated carriageway ways, computes a deck
// height per OSM node, and emits render-ready deck lines + pier
// placements into TAIPEI_GEO.elevatedRoads. The runtime side is
// js/taipei-viaduct.js (one merged box-section mesh + instanced
// piers); decks are DRAWN, NOT DRIVEN — routing, traffic and the
// ground planners never see them.
//
// Method (spec: sc0Vu study §B.2, techniques only — this is our own
// implementation):
//   * Selection: carriageway classes motorway/trunk/primary/
//     secondary/tertiary (+_link) with layer >= 1 or a bridge tag —
//     the same elevation predicate the generation map uses
//     (isElevatedTags there; the two copies are cross-checked by
//     validate.mjs through the roadbed deck flags).
//   * Heights: deck top per layer = 9 + 6*(min(layer,3)-1) m
//     (L1 9 m, L2 15 m, L3+ 21 m; a bridge-only way counts as L1).
//     A Dijkstra over the elevated ways' shared-node graph, seeded
//     at PORTAL nodes (nodes also used by non-elevated carriageway
//     ways, h = 0), caps the climb at RAMP_SLOPE = 0.06:
//     h(v) = min(target(v), min over neighbours h(u) + 0.06 * len).
//     The height function IS the ramp — a deck descends smoothly to
//     exactly 0 where its network meets the ground. Nodes no portal
//     can reach keep their full deck top (tile-edge continuations).
//   * Widths: the shared roadWidth inference + 1.2 m of shoulders,
//     except 建國快速道路， whose established override (11 m per
//     carriageway, shoulders included) applies flat.
//   * Piers: a candidate every 32 m along each line where the
//     underside clears 2.5 m. A candidate twin-projects onto the
//     other carriageway of the same road (within ~22 m) and the
//     pair shares one central pier — projection, not candidate
//     matching, so the carriageways' independent sampling phases
//     cannot defeat the pairing. A candidate is REJECTED when it
//     lands inside a planned building lot, or inside a GROUND
//     roadbed ribbon it has no business in — standing in that
//     street's median strip, or under its own deck over a street
//     running parallel to the deck, is exempt (the median-pier
//     arrangement every Taipei viaduct uses; the sc0Vu study's
//     blanket "no pier on any roadbed polygon" rule left 400 m
//     spans floating here, because the surface streets under the
//     decks mostly carry no modelled median). A rejected candidate
//     first slides +-10/+-20 m along its line — real piers stand
//     at junction corners, not mid-crossing.
//
// Frame math, width table and the union clip are copied from
// build-taipei-geodata.mjs (the house pattern: the builders never
// disagree because the copies are verbatim, and validate.mjs checks
// the outputs against each other).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ribbonPoly, buildPolyGrid, pointInAnyPoly, pointInPoly } from '../../js/taipei-painted.js';
import { buildMedianStrips } from '../../js/taipei-surfaces.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---- deck configuration ----
export const DECK_CLASSES = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link']);
export const DECK_DEPTH = 1.8;          // box-section depth, m
export const RAMP_SLOPE = 0.06;         // max |dh| per metre along the graph
export const PIER_SPACING_M = 32;       // pier candidate rhythm along a line
export const PIER_MIN_UNDERSIDE = 2.5;  // no pier where the deck is this close to grade
export const PIER_TWIN_MERGE_M = 22;    // same-name twin candidates this close share one pier
const SHOULDER_M = 1.2;                 // added to inferred carriageway width
const WIDTH_OVERRIDES = { '建國快速道路': 11 }; // per carriageway, shoulders included (mirrors build-generation-map.mjs OVERRIDES)

const NON_CARRIAGEWAY = new Set(['footway', 'path', 'steps', 'pedestrian', 'cycleway', 'corridor', 'elevator', 'crossing', 'platform', 'traffic_island']);
// A deck (layer >= 1, or any bridge tag) — the generation map's
// predicate (build-generation-map.mjs isElevatedTags), verbatim.
export const isElevatedTags = (tags) => parseInt(tags.layer || '0', 10) >= 1 || (!!tags.bridge && tags.bridge !== 'no');
export const deckTopForLayer = (layer) => 9 + 6 * (Math.min(Math.max(layer, 1), 3) - 1);
// Effective layer for height purposes: a bridge-only way (no layer
// tag, or layer 0) counts as layer 1.
const effectiveLayer = (tags) => {
  const raw = parseInt(tags.layer || '0', 10);
  return Number.isFinite(raw) && raw >= 1 ? raw : 1;
};

// ---- frame (copied tangent-plane math from build-taipei-geodata.mjs) ----
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

// ---- width inference (copied from build-taipei-geodata.mjs) ----
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

// ---- union clip with node-id records (copied from
//      build-taipei-geodata.mjs; points are {x, z, nodeId}) ----
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

// Binary min-heap of [priority, key] for the height Dijkstra.
function makeHeap() {
  const a = [];
  return {
    get size() { return a.length; },
    push(prio, key) {
      a.push([prio, key]);
      let i = a.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
    },
    pop() {
      const top = a[0], last = a.pop();
      if (a.length) {
        a[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < a.length && a[l][0] < a[m][0]) m = l;
          if (r < a.length && a[r][0] < a[m][0]) m = r;
          if (m === i) break;
          [a[m], a[i]] = [a[i], a[m]]; i = m;
        }
      }
      return top;
    },
  };
}

// buildDeckSet(records, roadbeds, lots, stats) -> { lines, piers, deckDepth, stats }
// The shared deck machinery: height Dijkstra over the records'
// shared-node graph (seeded at portals — nodes a set record shares
// with a non-set record), clipped line emission, pier placement.
// A record is one source way digested by a caller:
//   { id, nodeIds, pts (world), inSet, targetTop, emit,
//     lineName, lineHighway, lineLayer, lineWidth }
// buildElevated (roads) and buildMrtDecks (issue #118, rail records
// digested by tools/taipei/build-mrt.mjs) are the two callers; the
// road path's records reproduce the pre-#118 behaviour exactly.
//   roadbeds: the geodata roadbeds (runtime shape: pts flat, width, deck flag)
//   lots:     planTaipeiBuildings output lots ({x, z, w, d} axis-aligned)
function buildDeckSet(ways, roadbeds, lots, stats) {
  const selected = ways.filter((w) => w.emit);
  stats.waysSelected = selected.length;

  // Node keys mirror buildRoadGraph's keyOf: OSM id when the source
  // carried refs, else rounded coordinates.
  const keyOf = (w, i) => (w.nodeIds && w.nodeIds[i] != null ? `n:${w.nodeIds[i]}` : `c:${q(w.pts[i][0])},${q(w.pts[i][1])}`);

  // ---- graph + targets + portals ----
  const nodePos = new Map();   // key -> [x, z]
  const target = new Map();    // key -> deck top (max over set ways)
  const inSetNode = new Set();
  const inGroundNode = new Set();
  const adj = new Map();       // key -> [{ to, len }]
  const addAdj = (a, b, len) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push({ to: b, len });
  };
  for (const w of ways) {
    for (let i = 0; i < w.pts.length; i++) {
      const k = keyOf(w, i);
      if (!nodePos.has(k)) nodePos.set(k, w.pts[i]);
      (w.inSet ? inSetNode : inGroundNode).add(k);
      if (w.inSet) {
        const top = w.targetTop;
        if (top > (target.get(k) ?? -Infinity)) target.set(k, top);
      }
      if (i > 0) {
        const prev = keyOf(w, i - 1);
        if (w.inSet && prev !== k) {
          const len = Math.hypot(w.pts[i][0] - w.pts[i - 1][0], w.pts[i][1] - w.pts[i - 1][1]);
          if (len > 0.01) { addAdj(prev, k, len); addAdj(k, prev, len); }
        }
      }
    }
  }
  // ---- height Dijkstra from portals ----
  const height = new Map();
  const heap = makeHeap();
  for (const k of inSetNode) {
    if (inGroundNode.has(k)) { height.set(k, 0); heap.push(0, k); stats.portals++; }
  }
  stats.graphNodes = inSetNode.size;
  while (heap.size) {
    const [h, k] = heap.pop();
    if (h > (height.get(k) ?? Infinity)) continue;
    for (const e of adj.get(k) || []) {
      const cand = Math.min(target.get(e.to) ?? 0, h + RAMP_SLOPE * e.len);
      if (cand < (height.get(e.to) ?? Infinity) - 1e-9) { height.set(e.to, cand); heap.push(cand, e.to); }
    }
  }
  for (const k of inSetNode) if (!height.has(k)) { height.set(k, target.get(k) ?? 0); stats.unreachedNodes++; }
  // Height at an arbitrary point of a way: node height at vertices;
  // synthetic clip points interpolate along their source segment.
  const heightAt = (w, i) => height.get(keyOf(w, i)) ?? target.get(keyOf(w, i)) ?? 0;
  const heightOnSegment = (w, x, z) => {
    let best = null;
    for (let i = 0; i + 1 < w.pts.length; i++) {
      const [ax, az] = w.pts[i], [bx, bz] = w.pts[i + 1];
      const dx = bx - ax, dz = bz - az;
      const L2 = dx * dx + dz * dz;
      let t = L2 > 0 ? ((x - ax) * dx + (z - az) * dz) / L2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(ax + t * dx - x, az + t * dz - z);
      if (!best || d < best.d) best = { d, h: heightAt(w, i) + (heightAt(w, i + 1) - heightAt(w, i)) * t };
    }
    return best ? best.h : 0;
  };

  // ---- lines (clipped runs of the selected ways) ----
  const lines = [];
  for (const w of selected) {
    const name = w.lineName;
    const width = w.lineWidth;
    const runs = clipRuns(w.pts, BOXES_WORLD, w.nodeIds);
    for (const records of runs) {
      const pts = [], hs = [];
      let len = 0;
      records.forEach((p, i) => {
        if (i > 0) len += Math.hypot(p.x - records[i - 1].x, p.z - records[i - 1].z);
        pts.push(q(p.x), q(p.z));
        hs.push(q(p.nodeId != null && w.nodeIds ? (height.get(`n:${p.nodeId}`) ?? heightOnSegment(w, p.x, p.z)) : heightOnSegment(w, p.x, p.z)));
      });
      if (records.length < 2 || len < 1) continue;
      lines.push({ wayId: w.id, name, highway: w.lineHighway, layer: w.lineLayer, width, pts, h: hs, ...(w.lineTracks ? { tracks: w.lineTracks } : {}) });
      stats.lineKm += len / 1000;
    }
  }
  stats.lines = lines.length;
  stats.lineKm = Math.round(stats.lineKm * 10) / 10;

  // ---- piers ----
  // Line geometry helpers: point/height/yaw at arc position s.
  const lineGeom = lines.map((line) => {
    const pts = [];
    for (let i = 0; i < line.pts.length; i += 2) pts.push([line.pts[i], line.pts[i + 1]]);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return { pts, cum, total: cum[cum.length - 1] };
  });
  const atS = (li, s) => {
    const g = lineGeom[li];
    if (s < 0 || s > g.total) return null;
    let lo = 0;
    while (lo + 1 < g.cum.length - 1 && g.cum[lo + 1] < s) lo++;
    const f = (s - g.cum[lo]) / ((g.cum[lo + 1] - g.cum[lo]) || 1e-9);
    const line = lines[li];
    return {
      x: g.pts[lo][0] + (g.pts[lo + 1][0] - g.pts[lo][0]) * f,
      z: g.pts[lo][1] + (g.pts[lo + 1][1] - g.pts[lo][1]) * f,
      h: line.h[lo] + (line.h[lo + 1] - line.h[lo]) * f,
      yaw: Math.atan2(g.pts[lo + 1][0] - g.pts[lo][0], g.pts[lo + 1][1] - g.pts[lo][1]),
    };
  };
  // Candidates: one per PIER_SPACING_M of deck high enough to need
  // support. Positions resolve later (twin projection + slide), so a
  // candidate is just (line, arc position).
  const candidates = [];
  lines.forEach((line, lineIdx) => {
    const g = lineGeom[lineIdx];
    for (let s = PIER_SPACING_M / 2; s < g.total - 4; s += PIER_SPACING_M) {
      const p = atS(lineIdx, s);
      if (p && p.h - DECK_DEPTH > PIER_MIN_UNDERSIDE) candidates.push({ lineIdx, s, name: line.name });
    }
  });
  stats.pierCandidates = candidates.length;
  // Segment index for twin projection: every line segment filed
  // under the 40 m cells its bounding box overlaps.
  const SEG_CELL = 40;
  const segIndex = new Map();
  lines.forEach((line, li) => {
    const g = lineGeom[li];
    for (let i = 0; i + 1 < g.pts.length; i++) {
      const minX = Math.floor(Math.min(g.pts[i][0], g.pts[i + 1][0]) / SEG_CELL), maxX = Math.floor(Math.max(g.pts[i][0], g.pts[i + 1][0]) / SEG_CELL);
      const minZ = Math.floor(Math.min(g.pts[i][1], g.pts[i + 1][1]) / SEG_CELL), maxZ = Math.floor(Math.max(g.pts[i][1], g.pts[i + 1][1]) / SEG_CELL);
      for (let cx = minX; cx <= maxX; cx++) for (let cz = minZ; cz <= maxZ; cz++) {
        const k = `${cx},${cz}`;
        if (!segIndex.has(k)) segIndex.set(k, []);
        segIndex.get(k).push([li, i]);
      }
    }
  });
  // Closest point on another SAME-NAME line within the merge radius
  // (the twin carriageway of the same road). Projection-based, so
  // the two carriageways' independent sampling phases cannot defeat
  // the pairing the way candidate-to-candidate matching did (the
  // 市民大道 carriageways sit ~24 m apart with offset phases —
  // candidate matching left 400 m pier-less stretches there).
  const projectTwin = (c, x, z) => {
    if (!c.name) return null;
    let best = null, bestD = PIER_TWIN_MERGE_M;
    const seen = new Set();
    const cx0 = Math.floor((x - PIER_TWIN_MERGE_M) / SEG_CELL), cx1 = Math.floor((x + PIER_TWIN_MERGE_M) / SEG_CELL);
    const cz0 = Math.floor((z - PIER_TWIN_MERGE_M) / SEG_CELL), cz1 = Math.floor((z + PIER_TWIN_MERGE_M) / SEG_CELL);
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++)
      for (const [li, si] of segIndex.get(`${cx},${cz}`) || []) {
        if (li === c.lineIdx || lines[li].name !== c.name) continue;
        const key = `${li}:${si}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const g = lineGeom[li];
        const ax = g.pts[si][0], az = g.pts[si][1], bx = g.pts[si + 1][0], bz = g.pts[si + 1][1];
        const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
        let t = ((x - ax) * dx + (z - az) * dz) / L2;
        t = Math.max(0, Math.min(1, t));
        const px = ax + t * dx, pz = az + t * dz;
        const d = Math.hypot(px - x, pz - z);
        if (d < bestD) { bestD = d; best = { x: px, z: pz, h: lines[li].h[si] + (lines[li].h[si + 1] - lines[li].h[si]) * t }; }
      }
    return best;
  };
  // Resolve a candidate at arc offset ds into a pier: twin-merged
  // (midpoint of the candidate and its twin projection, underside =
  // the lower deck's) when a twin passes within the merge radius,
  // solo otherwise. Null when the deck is too low there to need one.
  // Positions are quantised here, before rejection: the rejection
  // tests exactly the coordinates that ship.
  const resolvePier = (c, ds) => {
    const p = atS(c.lineIdx, c.s + ds);
    if (!p || p.h - DECK_DEPTH <= PIER_MIN_UNDERSIDE) return null;
    const twin = projectTwin(c, p.x, p.z);
    if (twin) {
      const under = Math.min(p.h, twin.h) - DECK_DEPTH;
      if (under > PIER_MIN_UNDERSIDE) return { x: q((p.x + twin.x) / 2), z: q((p.z + twin.z) / 2), yaw: p.yaw, h: under, twin: true };
    }
    return { x: q(p.x), z: q(p.z), yaw: p.yaw, h: p.h - DECK_DEPTH, twin: false };
  };
  // Rejection geometry: ground carriageway ribbons (deck beds exempt
  // — a pier stands under its own deck, often inside its own bed's
  // ribbon) and planned building lots. Two exemptions, detailed at
  // pierPasses below: median strips, and streets running parallel
  // under the deck. (Strips are built without junction caps here, so
  // the median exemption is a hair generous at junction corners —
  // where median piers also occur in reality.)
  const groundBeds = (roadbeds || []).filter((b) => !b.deck);
  const ribbons = groundBeds.map((b) => ribbonPoly(b));
  const ribbonGrid = buildPolyGrid(ribbons);
  const medians = buildMedianStrips(roadbeds || [], null);
  const medianPolys = [...medians.plain, ...medians.planted].map((quad) => [[quad[0], quad[1]], [quad[2], quad[3]], [quad[4], quad[5]], [quad[6], quad[7]]]);
  const medianGrid = buildPolyGrid(medianPolys);
  const lotGrid = new Map();
  for (const lot of lots || []) {
    const k = `${Math.floor(lot.x / 50)},${Math.floor(lot.z / 50)}`;
    if (!lotGrid.has(k)) lotGrid.set(k, []);
    lotGrid.get(k).push(lot);
  }
  const inLot = (x, z) => {
    for (let gx = Math.floor(x / 50) - 1; gx <= Math.floor(x / 50) + 1; gx++)
      for (let gz = Math.floor(z / 50) - 1; gz <= Math.floor(z / 50) + 1; gz++)
        for (const lot of lotGrid.get(`${gx},${gz}`) || [])
          if (Math.abs(x - lot.x) <= lot.w / 2 && Math.abs(z - lot.z) <= lot.d / 2) return true;
    return false;
  };
  // A pier inside a ground ribbon passes in exactly two cases:
  // (a) it stands in that street's median strip; (b) the street runs
  // PARALLEL to the deck within a few metres of the pier — the pier
  // stands under its own deck over the street the deck shadows,
  // which is the median-pier arrangement every Taipei viaduct uses
  // (the surface streets under 市民大道 / 建國 carry no modelled
  // median — most are single beds — so a strips-only exemption left
  // 400 m spans pier-less). A pier in a CROSSING street's lanes
  // fails both and is rejected: it would block the cross traffic.
  const bedParallelNear = (bed, p) => {
    const pts = bed.pts || [];
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3];
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
      let t = ((p.x - ax) * dx + (p.z - az) * dz) / L2;
      t = Math.max(0, Math.min(1, t));
      if (Math.hypot(ax + t * dx - p.x, az + t * dz - p.z) > 4) continue;
      const dir = Math.atan2(dx, dz);
      if (Math.abs(Math.cos(dir - p.yaw)) > 0.9) return true;
    }
    return false;
  };
  const pierPasses = (p) => {
    if (inLot(p.x, p.z)) return false;
    if (pointInAnyPoly(medianGrid, medianPolys, [p.x, p.z])) return true;
    const cellKey = `${Math.floor(p.x / 100)},${Math.floor(p.z / 100)}`;
    for (const ci of ribbonGrid.get(cellKey) || []) {
      if (!pointInPoly([p.x, p.z], ribbons[ci])) continue;
      if (!bedParallelNear(groundBeds[ci], p)) return false;
    }
    return true;
  };
  // Emit: each candidate tries its sampled position, then slides
  // +-10 / +-20 m along its line — a pier that would land in a
  // crossing street shifts just clear of the junction, the way real
  // piers stand at junction corners, instead of vanishing and
  // leaving a long unsupported span. Twin piers dedupe: the twin
  // carriageway's own candidate resolving to (nearly) the same
  // midpoint is consumed, not double-drawn.
  const piers = [];
  const emittedTwin = [];
  for (const c of candidates) {
    let placed = null, consumed = false;
    for (const ds of [0, -10, 10, -20, 20]) {
      const p = resolvePier(c, ds);
      if (!p) continue;
      if (p.twin && emittedTwin.some((e) => Math.hypot(e.x - p.x, e.z - p.z) < 14)) { consumed = true; break; }
      if (!pierPasses(p)) continue;
      placed = p;
      if (ds !== 0) stats.piersSlid++;
      break;
    }
    if (consumed) continue;
    if (!placed) {
      const p0 = resolvePier(c, 0);
      if (p0 && inLot(p0.x, p0.z)) stats.piersRejectedLot++; else stats.piersRejectedRoad++;
      continue;
    }
    if (placed.twin) { emittedTwin.push(placed); stats.piersMerged++; }
    piers.push({ x: placed.x, z: placed.z, yaw: Math.round(placed.yaw * 100) / 100, h: q(placed.h) });
  }
  stats.piers = piers.length;

  return { lines, piers, deckDepth: DECK_DEPTH, stats };
}

// buildElevated(elements, roadbeds, lots): the road deck pass —
// carriageway ways from osm_roads.json, digested into records whose
// set membership / targets / widths are the rules this file has
// always applied (deck classes + elevated tags, layer tops, the
// road width inference + shoulders + the 建國 override).
export function buildElevated(elements, roadbeds, lots) {
  const stats = {
    waysSelected: 0, lines: 0, lineKm: 0, portals: 0, graphNodes: 0, unreachedNodes: 0,
    pierCandidates: 0, piersMerged: 0, piersSlid: 0, piersRejectedRoad: 0, piersRejectedLot: 0, piers: 0,
  };
  const records = [];
  for (const el of elements) {
    if (el.type !== 'way' || !el.tags?.highway || !el.geometry || el.geometry.length < 2) continue;
    if (NON_CARRIAGEWAY.has(el.tags.highway)) continue;
    const nodeIds = Array.isArray(el.nodes) && el.nodes.length === el.geometry.length ? el.nodes : null;
    const inSet = DECK_CLASSES.has(el.tags.highway) && isElevatedTags(el.tags);
    const name = el.tags.name || '';
    records.push({
      id: el.id, tags: el.tags, nodeIds,
      pts: el.geometry.map((g) => toWorld(g.lon, g.lat)),
      inSet, emit: inSet,
      targetTop: deckTopForLayer(effectiveLayer(el.tags)),
      lineName: name, lineHighway: el.tags.highway, lineLayer: effectiveLayer(el.tags),
      lineWidth: Object.hasOwn(WIDTH_OVERRIDES, name) ? WIDTH_OVERRIDES[name] : q(roadWidth(el.tags) + SHOULDER_M),
    });
  }
  return buildDeckSet(records, roadbeds, lots, stats);
}

// buildMrtDecks(records, roadbeds, lots): the MRT deck pass
// (issue #118) — records digested by tools/taipei/build-mrt.mjs from
// osm_railways.json: elevated records are the set (target = the MRT
// guideway datum), tunnel records only seed portals, at-grade
// records emit with target 0 and render as the renderer's low bed.
// The output lands in geodata.mrtDecks, a sibling of elevatedRoads:
// validate.mjs's deck provenance audit is defined over road ways,
// so the rail lines keep their own field and their own test file.
export function buildMrtDecks(records, roadbeds, lots) {
  const stats = {
    waysSelected: 0, lines: 0, lineKm: 0, portals: 0, graphNodes: 0, unreachedNodes: 0,
    pierCandidates: 0, piersMerged: 0, piersSlid: 0, piersRejectedRoad: 0, piersRejectedLot: 0, piers: 0,
  };
  return buildDeckSet(records, roadbeds, lots, stats);
}
