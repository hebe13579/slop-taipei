import assert from 'node:assert/strict';
import test from 'node:test';

import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import {
  TAIPEI_GEO_ADAPTED,
  getTaipeiLocationLabel,
  taipeiDistrictAt,
  nearestGraphNode,
} from '../js/taipei-adapter.js';
import { TAIPEI_TILE } from '../js/taipei-tile.js';
import { TILE_REGISTRY, tileIdFromSearch, loadSelectedTile } from '../js/tile-registry.js';

// M1 foundation: the Taipei tile's adapter, road graph, teleports and tile
// registry. Numbers printed via t.diagnostic are the actual generated values.

test('adapter loads and stubs every unsupported GEO field explicitly', () => {
  const geo = TAIPEI_GEO_ADAPTED;
  assert.equal(geo.frame.origin, 'Taipei 101 (25.0330, 121.5650)');
  assert.equal(geo.frame.sidewalk, null, 'no uniform sidewalk width is faked for Taiwan');
  assert.equal(geo.frame.pedestrianLayoutModel, 'per-road');
  assert.deepEqual(geo.streets, []);
  assert.deepEqual(geo.avenues, []);
  assert.deepEqual(geo.broadway, []);
  assert.deepEqual(geo.piers, []);
  assert.deepEqual(geo.bridges, {});
  assert.deepEqual(geo.points, {});
  assert.equal(geo.centralPark, null);
  assert.equal(geo.roads.length, TAIPEI_GEO.roads.length);
  // Blocks carry bounding rectangles only: no lot rect is ever faked.
  assert.ok(geo.blocks.length > 100);
  for (const block of geo.blocks) {
    assert.deepEqual(block[1], [], 'lot rects stay empty until real subdivision exists');
    assert.equal(block[5], 0, 'frontage frames stay unset');
    assert.equal(block[0].length, 8, 'block polygon is the bbox rectangle');
  }
  // Landmarks keep centre + bbox; height/area/ring stay null, never invented.
  const t101 = geo.landmarks['Taipei 101'];
  assert.ok(t101 && t101.h === null && t101.area === null && t101.ring === null);
  // Parks keep real rings with area derived from them.
  const daan = geo.parks.find((p) => p.name === '大安森林公園');
  assert.ok(daan && daan.acres > 40 && daan.rings[0].length > 100);
});

test('road graph connectivity: largest component, edge count, Taipei 101 reachability', (t) => {
  const graph = TAIPEI_GEO.roadGraph;
  const nodeCount = graph.nodes.length / 2;
  assert.ok(graph.edges.length > 3000, `edges ${graph.edges.length}`);
  const parent = Array.from({ length: nodeCount }, (_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (const e of graph.edges) {
    assert.ok(e.a >= 0 && e.a < nodeCount && e.b >= 0 && e.b < nodeCount && e.a !== e.b);
    assert.ok(e.length > 0 && e.width > 0 && typeof e.oneway === 'boolean');
    const a = find(e.a), b = find(e.b);
    if (a !== b) parent[b] = a;
  }
  const counts = new Map();
  for (let i = 0; i < nodeCount; i++) { const r = find(i); counts.set(r, (counts.get(r) || 0) + 1); }
  const largest = Math.max(...counts.values());
  const pct = (100 * largest) / nodeCount;
  t.diagnostic(`roadGraph: ${nodeCount} nodes, ${graph.edges.length} edges, ${counts.size} components, largest ${largest} (${pct.toFixed(2)}%)`);
  assert.ok(pct > 80, `largest component ${pct.toFixed(2)}%`);
  const near = nearestGraphNode(TAIPEI_GEO.landmarks['Taipei 101'].x, TAIPEI_GEO.landmarks['Taipei 101'].z);
  t.diagnostic(`Taipei 101 nearest graph node: ${near.dist.toFixed(1)} m`);
  assert.ok(near.dist < 250);
});

test('graph preserves narrow named ways and per-road pedestrian layouts', (t) => {
  const layouts = new Set(['sidewalk', 'arcade', 'painted', 'shared']);
  const laneEdges = TAIPEI_GEO.roadGraph.edges.filter((e) => e.name.includes('巷'));
  const alleyEdges = TAIPEI_GEO.roadGraph.edges.filter((e) => e.name.includes('弄'));
  t.diagnostic(`graph edges: ${laneEdges.length} named 巷, ${alleyEdges.length} named 弄`);
  assert.ok(laneEdges.length > 2000 && alleyEdges.length > 500, 'narrow 巷/弄 ways are real graph roads');
  for (const e of TAIPEI_GEO.roadGraph.edges) assert.ok(layouts.has(e.pedestrianLayout));
  const byLayout = {};
  for (const r of TAIPEI_GEO.roads) byLayout[r.pedestrianLayout] = (byLayout[r.pedestrianLayout] || 0) + 1;
  t.diagnostic(`pedestrian layouts (roads): ${JSON.stringify(byLayout)}`);
  assert.ok(byLayout.sidewalk > 0 && byLayout.painted > 0 && byLayout.shared > 0);
});

test('teleports resolve inside the tile with headings', () => {
  const bb = TAIPEI_GEO.frame.bbox;
  assert.deepEqual(Object.keys(TAIPEI_TILE.teleports).sort(), ['cityhall', 'daanpark', 'songshan', 'sysmemorial', 'taipei101']);
  for (const [key, loc] of Object.entries(TAIPEI_TILE.teleports)) {
    assert.ok(Number.isFinite(loc.x) && Number.isFinite(loc.z) && Number.isFinite(loc.heading), key);
    assert.ok(loc.x >= bb.minX && loc.x <= bb.maxX && loc.z >= bb.minZ && loc.z <= bb.maxZ, `${key} inside tile`);
    assert.ok(nearestGraphNode(loc.x, loc.z).dist < 400, `${key} near the road graph`);
  }
  assert.equal(TAIPEI_TILE.spawn.x, TAIPEI_GEO.landmarks['Taipei 101'].x);
  assert.equal(TAIPEI_TILE.spawn.z, TAIPEI_GEO.landmarks['Taipei 101'].z);
});

test('getLocationLabel returns a Taipei road name near Taipei 101', (t) => {
  const lm = TAIPEI_GEO.landmarks['Taipei 101'];
  const label = getTaipeiLocationLabel(lm.x, lm.z);
  t.diagnostic(`label at Taipei 101: ${label}`);
  assert.ok(label.includes('Taipei 101'), label);
  assert.ok(TAIPEI_TILE.roadNames.some((name) => name && label.includes(name)), `label names a real road: ${label}`);
  assert.equal(taipeiDistrictAt(lm.x, lm.z), 'Xinyi');
  assert.ok(taipeiDistrictAt(-2852, 362).startsWith("Da'an"));
});

test('tile registry is data-driven and defaults to nyc', async () => {
  assert.deepEqual(Object.keys(TILE_REGISTRY).sort(), ['nyc', 'taipei']);
  assert.equal(tileIdFromSearch(''), 'nyc');
  assert.equal(tileIdFromSearch('?city=taipei'), 'taipei');
  assert.equal(tileIdFromSearch('?city=unknown'), 'nyc');
  const nyc = await loadSelectedTile('');
  assert.equal(nyc.id, 'nyc');
  assert.equal(nyc.tile, null, 'legacy city loads no tile definition');
  const taipei = await loadSelectedTile('?city=taipei');
  assert.equal(taipei.tile.id, 'taipei');
  assert.equal(taipei.tile.geodata, TAIPEI_GEO);
  assert.equal(taipei.tile.adaptedGeo, TAIPEI_GEO_ADAPTED);
  assert.equal(typeof taipei.tile.loadBoot, 'function');
  // The registry entry is the ONLY place a future tile (e.g. Beitou) needs
  // to be added; no tile id is hardcoded in the selection logic.
  assert.equal(TILE_REGISTRY.taipei.kind, 'tile');
});
