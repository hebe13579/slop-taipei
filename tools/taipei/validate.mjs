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
//    it spans x -3027.7..1513.8, z -2990.9..1440.1, so max |coord| is ~3028 m,
//    not ~2600 m as first guessed — the origin at Taipei 101 is not tile-centred).
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
G.blocks.forEach((b) => scan([b.bbox.minX, b.bbox.minZ, b.bbox.maxX, b.bbox.maxZ]));
check(outOfBounds === 0, 'all coords within frame bbox', `max |coord| ${maxAbs.toFixed(1)} m, bbox x[${bb.minX}, ${bb.maxX}] z[${bb.minZ}, ${bb.maxZ}]`);

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
const accounted = roadbedM + gm.stats.excludedLinkLength + gm.stats.mergedConstituentOverlapLength - gm.stats.mergedLength + gm.stats.droppedScrapLength;
const acctDelta = Math.abs(accounted - preMergeM) / preMergeM;
check(acctDelta < 0.015, 'rendered roadbed length accounts for pre-merge carriageway length within 1.5%', `roadbeds ${(roadbedM / 1000).toFixed(1)} km + excluded links ${(gm.stats.excludedLinkLength / 1000).toFixed(2)} km + merged overlap ${(gm.stats.mergedConstituentOverlapLength / 1000).toFixed(1)} km - merged ${(gm.stats.mergedLength / 1000).toFixed(1)} km + scrap ${(gm.stats.droppedScrapLength / 1000).toFixed(2)} km = ${(accounted / 1000).toFixed(1)} km vs ${(preMergeM / 1000).toFixed(1)} km`);
check(roadbedM < preMergeM, 'rendered carriageway is shorter than pre-merge (merges + link exclusion only remove)', `${(roadbedM / 1000).toFixed(1)} km < ${(preMergeM / 1000).toFixed(1)} km`);

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
