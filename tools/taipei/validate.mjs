// tools/taipei/validate.mjs — M0 spike checks on the generated js/taipei-geodata.js.
// usage: node tools/taipei/validate.mjs
import fs from 'node:fs';
import { TAIPEI_GEO as G } from '../../js/taipei-geodata.js';

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};
const bb = G.frame.bbox;
const MARGIN = 1; // builder clips to the frame bbox; allow rounding slack

// 1. All coordinates inside the frame bbox (the tile is offset from the origin:
//    the box union spans x -6257.2..1513.8, z -2990.9..498.5 — the origin at
//    Taipei 101 is not tile-centred, and the union's west edge (lon 121.503)
//    is the far side now).
let maxAbs = 0, outOfBounds = 0;
const scan = (flatArr) => {
  for (let i = 0; i + 1 < flatArr.length; i += 2) {
    const x = flatArr[i], z = flatArr[i + 1];
    maxAbs = Math.max(maxAbs, Math.abs(x), Math.abs(z));
    if (x < bb.minX - MARGIN || x > bb.maxX + MARGIN || z < bb.minZ - MARGIN || z > bb.maxZ + MARGIN) outOfBounds++;
  }
};
G.roads.forEach((r) => scan(r.pts));
G.water.forEach((w) => scan(w.ring));
G.parks.forEach((p) => scan(p.ring));
(G.green || []).forEach((p) => scan(p.ring));
G.blocks.forEach((b) => scan([b.bbox.minX, b.bbox.minZ, b.bbox.maxX, b.bbox.maxZ]));
check(outOfBounds === 0, 'all coords within frame bbox', `max |coord| ${maxAbs.toFixed(1)} m, bbox x[${bb.minX}, ${bb.maxX}] z[${bb.minZ}, ${bb.maxZ}]`);

// 1b. Green-land layer present (issue #114): farmland / nature /
// recreation polygons the planner must keep lot-free.
check(Array.isArray(G.green) && G.green.length > 200, 'green-land layer present', `${(G.green || []).length} polygons`);

// 2. Taipei 101 landmark exists near origin
const t101 = G.landmarks['Taipei 101'];
check(!!t101, "landmarks['Taipei 101'] exists");
if (t101) {
  const d = Math.hypot(t101.x, t101.z);
  check(d < 300, 'Taipei 101 within 300 m of origin', `at (${t101.x}, ${t101.z}), ${d.toFixed(0)} m from origin`);
}

// 3. A water polygon in the northern part of the tile (Keelung River, z < -1500)
const ringCentroidZ = (ring) => { let s = 0; for (let i = 1; i < ring.length; i += 2) s += ring[i]; return s / (ring.length / 2); };
const northWater = G.water.filter((w) => ringCentroidZ(w.ring) < -1500);
check(northWater.length > 0, 'water polygon(s) in northern tile (Keelung River)', `${northWater.length} found, names: ${[...new Set(northWater.map((w) => w.name || '(unnamed)'))].join(', ')}`);

// 4. Road length > 100 km
let totalKm = 0, carriageKm = 0;
const NON_CARRIAGE = new Set(['footway', 'path', 'steps', 'pedestrian', 'cycleway', 'corridor', 'elevator', 'crossing', 'platform']);
for (const r of G.roads) {
  let len = 0;
  for (let i = 2; i < r.pts.length; i += 2) len += Math.hypot(r.pts[i] - r.pts[i - 2], r.pts[i + 1] - r.pts[i - 1]);
  totalKm += len / 1000;
  if (!NON_CARRIAGE.has(r.highway)) carriageKm += len / 1000;
}
check(totalKm > 100, 'total road length > 100 km', `${totalKm.toFixed(1)} km all highway ways, ${carriageKm.toFixed(1)} km excluding footway/path/steps/etc.`);

// 5. Blocks > 100
check(G.blocks.length > 100, 'blocks count > 100', `${G.blocks.length} blocks`);

// 6. Road graph (M1): connectivity, density, and reachability from Taipei 101
const graph = G.roadGraph;
check(!!graph && Array.isArray(graph.nodes) && Array.isArray(graph.edges), 'roadGraph present with nodes/edges');
if (graph) {
  const nodeCount = graph.nodes.length / 2;
  let badIndex = 0, badLength = 0, badLayout = 0;
  const LAYOUTS = new Set(['sidewalk', 'arcade', 'painted', 'shared']);
  for (const e of graph.edges) {
    if (!(e.a >= 0 && e.a < nodeCount && e.b >= 0 && e.b < nodeCount && e.a !== e.b)) badIndex++;
    if (!(e.length > 0)) badLength++;
    if (!LAYOUTS.has(e.pedestrianLayout)) badLayout++;
  }
  check(badIndex === 0 && badLength === 0, 'graph edges reference valid nodes with positive lengths', `${graph.edges.length} edges`);
  check(badLayout === 0, 'every graph edge carries a pedestrianLayout (sidewalk|arcade|painted|shared)');
  check(graph.edges.length > 3000, 'carriageway graph edges > 3000', `${graph.edges.length} edges, ${nodeCount} nodes`);
  const parent = Array.from({ length: nodeCount }, (_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (const e of graph.edges) { const a = find(e.a), b = find(e.b); if (a !== b) parent[b] = a; }
  const counts = new Map();
  for (let i = 0; i < nodeCount; i++) { const r = find(i); counts.set(r, (counts.get(r) || 0) + 1); }
  const largest = Math.max(0, ...counts.values());
  const pct = nodeCount ? (100 * largest) / nodeCount : 0;
  check(pct > 80, 'largest graph component contains > 80% of carriageway nodes', `${largest}/${nodeCount} nodes (${pct.toFixed(2)}%), ${counts.size} components`);
  if (t101) {
    let best = Infinity;
    for (let i = 0; i < nodeCount; i++) best = Math.min(best, Math.hypot(graph.nodes[2 * i] - t101.x, graph.nodes[2 * i + 1] - t101.z));
    check(best < 250, "Taipei 101's nearest graph node within 250 m", `${best.toFixed(1)} m`);
  }
  // Narrow named ways are real roads, not decoration: the graph must retain
  // 巷 (lane) and 弄 (alley) edges instead of dropping/widening them away.
  const laneEdges = graph.edges.filter((e) => e.name.includes('巷')).length;
  const alleyEdges = graph.edges.filter((e) => e.name.includes('弄')).length;
  check(laneEdges > 0 && alleyEdges > 0, 'graph retains named 巷 lane and 弄 alley edges', `${laneEdges} 巷 edges, ${alleyEdges} 弄 edges`);
}

// 7. Generation map (issue #6): provenance, anti-rot, length accounting.
const gm = JSON.parse(fs.readFileSync(new URL('./data/generation-map.json', import.meta.url), 'utf8'));
const rawRoads = JSON.parse(fs.readFileSync(new URL('./data/osm_roads.json', import.meta.url), 'utf8'));
const rawWayIds = new Set(rawRoads.elements.filter((e) => e.type === 'way').map((e) => e.id));
check(Array.isArray(G.roadbeds) && G.roadbeds.length > 1000, 'roadbeds present in geodata', `${Array.isArray(G.roadbeds) ? G.roadbeds.length : 0} roadbeds from the generation map`);
let noSource = 0, unknownId = 0;
for (const b of gm.roadbeds) {
  if (!Array.isArray(b.sourceWayIds) || !b.sourceWayIds.length) { noSource++; continue; }
  for (const id of b.sourceWayIds) if (!rawWayIds.has(id)) unknownId++;
}
check(noSource === 0 && unknownId === 0, 'every generation-map roadbed traces to raw OSM way ids', `${gm.roadbeds.length} roadbeds, ${noSource} without source, ${unknownId} unknown ids`);
let gNoSource = 0;
for (const b of G.roadbeds || []) if (!Array.isArray(b.sourceWayIds) || !b.sourceWayIds.length) gNoSource++;
check(gNoSource === 0, 'every geodata roadbed carries sourceWayIds');
const usedWayIds = new Set(gm.roadbeds.flatMap((b) => b.sourceWayIds));
const leakedLinks = gm.stats.excludedLinkWayIds.filter((id) => usedWayIds.has(id));
check(leakedLinks.length === 0, 'excluded short link ways appear in no roadbed', `${gm.stats.excludedLinkWayIds.length} link ways excluded (< 120 m), ${gm.stats.linkWaysKept} kept`);
check(gm.stats.overrides.every((o) => o.matchedWays >= 1), 'every width override matched at least one way (anti-rot)', gm.stats.overrides.length ? gm.stats.overrides.map((o) => `${o.name} x${o.matchedWays}`).join(', ') : 'no overrides defined');
check(gm.stats.mergeGroups > 0, 'boulevard merge produced merged roadbeds', `${gm.stats.mergeGroups} groups`);
let narrowMerged = 0;
for (const b of gm.roadbeds) if (b.merged && !(b.width + 0.05 >= Math.max(...b.constituentWidths))) narrowMerged++;
check(narrowMerged === 0, 'merged roadbed widths >= each constituent width');
// Length accounting, in metres, against the geodata's own roads array
// (carriageway = the builder's NON_CARRIAGEWAY complement, incl. traffic_island).
const BUILDER_NON_CARRIAGEWAY = new Set(['footway', 'path', 'steps', 'pedestrian', 'cycleway', 'corridor', 'elevator', 'crossing', 'platform', 'traffic_island']);
const flatLen = (flat) => { let L = 0; for (let i = 2; i < flat.length; i += 2) L += Math.hypot(flat[i] - flat[i - 2], flat[i + 1] - flat[i - 1]); return L; };
let preMergeM = 0;
for (const r of G.roads) if (!BUILDER_NON_CARRIAGEWAY.has(r.highway)) preMergeM += flatLen(r.pts);
const statsDelta = Math.abs(gm.stats.carriagewayLength - preMergeM) / preMergeM;
check(statsDelta < 0.01, 'generation-map carriageway length matches geodata roads (same raw extract)', `stats ${(gm.stats.carriagewayLength / 1000).toFixed(1)} km vs roads ${(preMergeM / 1000).toFixed(1)} km`);
let roadbedM = 0;
for (const b of G.roadbeds || []) roadbedM += flatLen(b.pts);
const accounted = roadbedM + gm.stats.excludedLinkLength + gm.stats.mergedConstituentOverlapLength - gm.stats.mergedLength + gm.stats.droppedScrapLength + (gm.stats.suppressedLength || 0) + (gm.stats.parkServiceExcludedLength || 0) + (gm.stats.simplificationShorteningM || 0);
const acctDelta = Math.abs(accounted - preMergeM) / preMergeM;
check(acctDelta < 0.015, 'rendered roadbed length accounts for pre-merge carriageway length within 1.5%', `roadbeds ${(roadbedM / 1000).toFixed(1)} km + excluded links ${(gm.stats.excludedLinkLength / 1000).toFixed(2)} km + merged overlap ${(gm.stats.mergedConstituentOverlapLength / 1000).toFixed(1)} km - merged ${(gm.stats.mergedLength / 1000).toFixed(1)} km + scrap ${(gm.stats.droppedScrapLength / 1000).toFixed(2)} km + suppressed ${((gm.stats.suppressedLength || 0) / 1000).toFixed(2)} km + park service ${((gm.stats.parkServiceExcludedLength || 0) / 1000).toFixed(2)} km + simplify shortening ${((gm.stats.simplificationShorteningM || 0) / 1000).toFixed(2)} km = ${(accounted / 1000).toFixed(1)} km vs ${(preMergeM / 1000).toFixed(1)} km`);
check(roadbedM < preMergeM, 'rendered carriageway is shorter than pre-merge (merges + link exclusion only remove)', `${(roadbedM / 1000).toFixed(1)} km < ${(preMergeM / 1000).toFixed(1)} km`);

// 8. Elevated decks (issue #61): the deck set's provenance, height
// discipline, deck-flag agreement between the two builders, and the
// pier rejection — recomputed here independently of the pipeline.
{
  const { isElevatedTags, DECK_CLASSES } = await import('./build-elevated.mjs');
  const elev = G.elevatedRoads;
  check(!!elev && Array.isArray(elev.lines) && elev.lines.length > 50, 'elevatedRoads present with deck lines', elev ? `${elev.lines.length} lines, ${elev.piers?.length ?? 0} piers` : 'missing');
  if (elev) {
    const rawById = new Map(rawRoads.elements.filter((e) => e.type === 'way').map((e) => [e.id, e]));
    // Provenance: every line traces to a raw way that is in the deck
    // set, and every deck-set way in the extract produced a line
    // (anti-rot in both directions).
    let badLine = 0;
    const lineWays = new Set();
    for (const l of elev.lines) {
      lineWays.add(l.wayId);
      const el = rawById.get(l.wayId);
      if (!el || !DECK_CLASSES.has(el.tags?.highway) || !isElevatedTags(el.tags || {})) badLine++;
    }
    check(badLine === 0, 'every deck line traces to an elevated deck-class way', `${lineWays.size} distinct ways`);
    let missing = 0;
    {
      // A selected way emits a line iff some segment of it crosses
      // the tile union (the builders' exact frame math; ways running
      // only through the dropped bands or outside the boxes emit
      // nothing, legitimately).
      const A = 6378137.0, E2 = 6.69437999014e-3, PHI0 = (25.0330 * Math.PI) / 180, SIN0 = Math.sin(PHI0);
      const KX = (Math.PI / 180) * (A / Math.sqrt(1 - E2 * SIN0 * SIN0)) * Math.cos(PHI0);
      const KY = (Math.PI / 180) * (A * (1 - E2)) / Math.pow(1 - E2 * SIN0 * SIN0, 1.5);
      const toW = (g) => [(g.lon - 121.5650) * KX, -(g.lat - 25.0330) * KY];
      const segHitsBox = (a, b, bx) => {
        let t0 = 0, t1 = 1;
        const dx = b[0] - a[0], dz = b[1] - a[1];
        for (const [p, qv] of [[-dx, a[0] - bx.minX], [dx, bx.maxX - a[0]], [-dz, a[1] - bx.minZ], [dz, bx.maxZ - a[1]]]) {
          if (Math.abs(p) < 1e-12) { if (qv < 0) return false; continue; }
          const r = qv / p;
          if (p < 0) t0 = Math.max(t0, r); else t1 = Math.min(t1, r);
          if (t0 > t1) return false;
        }
        return true;
      };
      for (const el of rawRoads.elements) {
        if (el.type !== 'way' || !el.tags?.highway) continue;
        if (!DECK_CLASSES.has(el.tags.highway) || !isElevatedTags(el.tags)) continue;
        const pts = (el.geometry || []).map(toW);
        const crosses = pts.some((p, i) => i + 1 < pts.length && G.frame.boxes.some((bx) => segHitsBox(p, pts[i + 1], bx)));
        if (crosses && !lineWays.has(el.id)) missing++;
      }
    }
    check(missing === 0, 'every union-crossing elevated deck-class way produced a deck line', `${missing} missing`);
    // Height discipline: 0 <= h <= 21 m (the L3 cap); a point may
    // exceed its own line's layer top ONLY near nodes shared with a
    // higher-layer way — the height function takes the max target
    // over the ways through a node, so an L1 ramp climbing to an L2
    // interchange legitimately rises above 9 m there (window of +-3
    // points around a shared coordinate must explain the excess).
    // And the ramp slope between consecutive points never exceeds
    // 6% (0.11 m of slack for the 0.1 m height quantisation).
    const topOf = (layer) => 9 + 6 * (Math.min(Math.max(layer, 1), 3) - 1);
    const topAtCoord = new Map();
    for (const l of elev.lines) for (let i = 0; i < l.pts.length; i += 2) {
      const k = `${Math.round(l.pts[i] * 10)},${Math.round(l.pts[i + 1] * 10)}`;
      topAtCoord.set(k, Math.max(topAtCoord.get(k) ?? 0, topOf(l.layer)));
    }
    let badH = 0, badSlope = 0;
    for (const l of elev.lines) {
      for (let i = 0; i < l.h.length; i++) {
        if (!(l.h[i] >= 0 && l.h[i] <= 21 + 0.051)) badH++;
        else if (l.h[i] > topOf(l.layer) + 0.051) {
          let allow = topOf(l.layer);
          for (let j = Math.max(0, i - 3); j <= Math.min(l.h.length - 1, i + 3); j++)
            allow = Math.max(allow, topAtCoord.get(`${Math.round(l.pts[2 * j] * 10)},${Math.round(l.pts[2 * j + 1] * 10)}`) ?? 0);
          if (l.h[i] > allow + 0.051) badH++;
        }
        if (i > 0) {
          const d = Math.hypot(l.pts[2 * i] - l.pts[2 * i - 2], l.pts[2 * i + 1] - l.pts[2 * i - 1]);
          if (d > 0.01 && Math.abs(l.h[i] - l.h[i - 1]) > 0.06 * d + 0.11) badSlope++;
        }
      }
    }
    check(badH === 0, 'deck heights bounded by layer tops (shared-node excess only)', `${badH} violations`);
    check(badSlope === 0, 'deck ramp slope never exceeds 6%', `${badSlope} violations`);
    // Deck flags: the generation map's flags (recomputed from its
    // own segment rules) and the geodata pass-through agree, and
    // every flagged bed derives from at least one deck-set way.
    const gmDeck = gm.roadbeds.filter((b) => b.deck).length;
    const geoDeck = (G.roadbeds || []).filter((b) => b.deck).length;
    check(gmDeck > 100 && gmDeck === geoDeck && gm.stats.deckBeds === gmDeck, 'deck-flagged roadbeds agree across builders', `${gmDeck} flagged`);
    let flagOrphans = 0;
    for (const b of gm.roadbeds) {
      if (!b.deck) continue;
      const ok = b.sourceWayIds.some((id) => {
        const el = rawById.get(id);
        return el && DECK_CLASSES.has(el.tags?.highway) && isElevatedTags(el.tags || {});
      });
      if (!ok) flagOrphans++;
    }
    check(flagOrphans === 0, 'every deck-flagged roadbed derives from a deck-set way', `${flagOrphans} orphans`);
    // Piers: none inside a planned lot, and none inside a ground
    // carriageway ribbon unless it stands in that street's median
    // strip or under its own deck over a street running parallel to
    // the deck (the median-pier arrangement — see build-elevated.mjs).
    const { ribbonPoly, buildPolyGrid, pointInAnyPoly, pointInPoly } = await import('../../js/taipei-painted.js');
    const { buildMedianStrips } = await import('../../js/taipei-surfaces.js');
    const { planTaipeiBuildings } = await import('../../js/taipei-buildings.js');
    const groundBedsV = (G.roadbeds || []).filter((b) => !b.deck);
    const groundRibbons = groundBedsV.map((b) => ribbonPoly(b));
    const ribbonGrid = buildPolyGrid(groundRibbons);
    const med = buildMedianStrips(G.roadbeds || [], null);
    const medPolys = [...med.plain, ...med.planted].map((quad) => [[quad[0], quad[1]], [quad[2], quad[3]], [quad[4], quad[5]], [quad[6], quad[7]]]);
    const medGrid = buildPolyGrid(medPolys);
    const lots = planTaipeiBuildings(G).lots;
    const bedParallelNear = (bed, p) => {
      const pts = bed.pts || [];
      for (let i = 0; i + 3 < pts.length; i += 2) {
        const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3];
        const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
        let t = ((p.x - ax) * dx + (p.z - az) * dz) / L2;
        t = Math.max(0, Math.min(1, t));
        if (Math.hypot(ax + t * dx - p.x, az + t * dz - p.z) > 4) continue;
        if (Math.abs(Math.cos(Math.atan2(dx, dz) - p.yaw)) > 0.9) return true;
      }
      return false;
    };
    let pierRoad = 0, pierLot = 0;
    for (const p of elev.piers || []) {
      if (lots.some((lot) => Math.abs(p.x - lot.x) <= lot.w / 2 && Math.abs(p.z - lot.z) <= lot.d / 2)) pierLot++;
      if (pointInAnyPoly(medGrid, medPolys, [p.x, p.z])) continue;
      const cellKey = `${Math.floor(p.x / 100)},${Math.floor(p.z / 100)}`;
      for (const ci of ribbonGrid.get(cellKey) || []) {
        if (pointInPoly([p.x, p.z], groundRibbons[ci]) && !bedParallelNear(groundBedsV[ci], p)) { pierRoad++; break; }
      }
    }
    check(pierRoad === 0, 'no deck pier in a crossing carriageway (median/parallel exemptions only)', `${pierRoad} violations`);
    check(pierLot === 0, 'no deck pier inside a planned building lot', `${pierLot} violations`);
  }
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
