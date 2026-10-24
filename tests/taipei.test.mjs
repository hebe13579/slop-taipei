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
import { planTaipeiBuildings, pointInRing } from '../js/taipei-buildings.js';

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

// Ground-triangulation regression guard (M1 fixes increment): the boot
// screenshots' black streaks were initially blamed on bad triangulation of
// a water/park ring. Verification showed every ring triangulates
// area-exactly (the streaks trace to the crowd pose shader under the
// headless WebGL2 fallback, not the ground). These are the data invariants
// that conclusion rests on — if a future geodata regeneration ships a
// non-simple, non-finite or zero-area ring, the ground builder really
// could break, and this test should fail first.
test('water and park rings are finite, simple and non-degenerate', (t) => {
  const ringPoints = (ring) => {
    const pts = [];
    for (let i = 0; i + 1 < ring.length; i += 2) pts.push([ring[i], ring[i + 1]]);
    // Drop the duplicated closing point, as the boot builder does.
    if (pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.01) pts.pop();
    return pts;
  };
  const segCross = (a, b, c, d) => {
    const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
    const den = r[0] * s[1] - r[1] * s[0];
    if (den === 0) return false;
    const u = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
    const v = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
    return u > 1e-9 && u < 1 - 1e-9 && v > 1e-9 && v < 1 - 1e-9;
  };
  let checked = 0;
  for (const [kind, items] of [['water', TAIPEI_GEO.water], ['parks', TAIPEI_GEO.parks]]) {
    for (const item of items) {
      const pts = ringPoints(item.ring);
      const label = `${kind} "${item.name || ''}" (${pts.length} pts)`;
      assert.ok(pts.length >= 3, label);
      // (Two source rings repeat one vertex mid-ring — harmless OSM noise
      // that earcut tolerates; the triangulation stays area-exact. What
      // must never appear is a non-finite coordinate, a self-intersection
      // or a collapsed ring, so those are what is asserted.)
      assert.ok(new Set(pts.map((p) => p.join(','))).size >= 3, `${label}: at least 3 distinct points`);
      let area = 0;
      for (let i = 0; i < pts.length; i++) {
        const [x1, z1] = pts[i];
        const [x2, z2] = pts[(i + 1) % pts.length];
        assert.ok(Number.isFinite(x1) && Number.isFinite(z1), `${label}: finite coordinates`);
        area += x1 * z2 - x2 * z1;
      }
      assert.ok(Math.abs(area) / 2 > 0.5, `${label}: non-degenerate area ${Math.abs(area) / 2} m²`);
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 2; j < pts.length; j++) {
          if (i === 0 && j === pts.length - 1) continue;
          assert.ok(!segCross(pts[i], pts[(i + 1) % pts.length], pts[j], pts[(j + 1) % pts.length]), `${label}: no self-intersection (segments ${i}/${j})`);
        }
      }
      checked++;
    }
  }
  t.diagnostic(`verified ${checked} water/park rings`);
  assert.equal(checked, TAIPEI_GEO.water.length + TAIPEI_GEO.parks.length);
});

// Generation map (issue #6): the geodata's roadbeds are the curated render
// layer over the raw roads — every roadbed traces back to raw OSM ways,
// divided boulevards arrive merged into single wide roadbeds, and the
// rendered carriageway length shrinks only by what merges and the link
// policy account for (the exact accounting lives in validate.mjs).
test('generation map roadbeds: provenance, merged boulevards, sane totals', (t) => {
  const beds = TAIPEI_GEO.roadbeds;
  assert.ok(Array.isArray(beds) && beds.length > 1000, 'roadbeds present in geodata');
  const flatLen = (flat) => { let L = 0; for (let i = 2; i < flat.length; i += 2) L += Math.hypot(flat[i] - flat[i - 2], flat[i + 1] - flat[i - 1]); return L; };
  let merged = 0, bedLen = 0;
  for (const b of beds) {
    assert.ok(Array.isArray(b.sourceWayIds) && b.sourceWayIds.length >= 1, `roadbed "${b.name}" has provenance`);
    assert.ok(b.width > 0 && b.pts.length >= 4, `roadbed "${b.name}" has a centreline and width`);
    for (let i = 0; i < b.pts.length; i++) assert.ok(Number.isFinite(b.pts[i]), `roadbed "${b.name}" finite coords`);
    bedLen += flatLen(b.pts);
    if (b.merged) {
      merged++;
      assert.ok(b.sourceWayIds.length >= 2, 'a merged roadbed combines at least two raw ways');
    }
  }
  t.diagnostic(`roadbeds: ${beds.length}, merged groups ${merged}, rendered carriageway ${(bedLen / 1000).toFixed(1)} km`);
  assert.ok(merged > 50, `expected many merged boulevards, got ${merged}`);
  // Zhongxiao E. Rd Sec. 4 was two paired 12.8/16 m ribbons; merged it must
  // be single roadbeds at boulevard width (>= 24 m), never the old ribbons.
  const zx = beds.filter((b) => b.merged && b.name === '忠孝東路四段');
  assert.ok(zx.length >= 3 && zx.every((b) => b.width >= 24), `Zhongxiao Sec.4 merged widths: ${zx.map((b) => b.width).join(', ')}`);
  const NON_CARRIAGEWAY = new Set(['footway', 'path', 'steps', 'pedestrian', 'cycleway', 'corridor', 'elevator', 'crossing', 'platform', 'traffic_island']);
  let rawLen = 0;
  for (const r of TAIPEI_GEO.roads) if (!NON_CARRIAGEWAY.has(r.highway)) rawLen += flatLen(r.pts);
  assert.ok(bedLen < rawLen && bedLen > rawLen * 0.85, `roadbed ${(bedLen / 1000).toFixed(1)} km vs raw carriageway ${(rawLen / 1000).toFixed(1)} km`);
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

// Buildings increment: the procedural lot plan over the raster blocks.
// The invariants that keep the city honest: the plan is deterministic,
// no building stands in a park or in water (Da'an Forest Park stays
// empty), the Taipei 101 site is kept clear for the massing, and the
// massing itself is present at the landmark with its eight tiers.
test('buildings plan: deterministic, excludes parks/water/101 site, tower present', (t) => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  const again = planTaipeiBuildings(TAIPEI_GEO);
  assert.equal(plan.lots.length, again.lots.length, 'building count stable across runs');
  assert.deepEqual(plan.lots.slice(0, 100), again.lots.slice(0, 100), 'lot plan deterministic across runs');
  assert.deepEqual(plan.tower, again.tower, 'tower plan deterministic across runs');
  t.diagnostic(`buildings: ${plan.lots.length} lots, stats ${JSON.stringify(plan.stats)}`);
  assert.ok(plan.lots.length > 5000, `expected a city of buildings, got ${plan.lots.length}`);

  const ringBbox = (ring) => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i + 1 < ring.length; i += 2) {
      minX = Math.min(minX, ring[i]); maxX = Math.max(maxX, ring[i]);
      minZ = Math.min(minZ, ring[i + 1]); maxZ = Math.max(maxZ, ring[i + 1]);
    }
    return { minX, maxX, minZ, maxZ };
  };
  const polys = [...TAIPEI_GEO.parks, ...TAIPEI_GEO.water].map((p) => ({ name: p.name, ring: p.ring, bb: ringBbox(p.ring) }));
  for (const lot of plan.lots) {
    for (const p of polys) {
      if (lot.x < p.bb.minX || lot.x > p.bb.maxX || lot.z < p.bb.minZ || lot.z > p.bb.maxZ) continue;
      assert.ok(!pointInRing(lot.x, lot.z, p.ring), `building at ${lot.x},${lot.z} inside "${p.name || 'water'}"`);
    }
    assert.ok(lot.h >= 8 && lot.h <= 60, `height ${lot.h} within the contextual tiers`);
    assert.ok(lot.w >= 7 && lot.d >= 7, 'footprint sane');
  }
  // Some Xinyi-core lots reach the tall tier.
  assert.ok(plan.lots.some((l) => Math.hypot(l.x, l.z) < 650 && l.h >= 40), 'tall buildings near Taipei 101');

  const t101 = TAIPEI_GEO.landmarks['Taipei 101'];
  const site = { minX: t101.x - t101.w / 2, maxX: t101.x + t101.w / 2, minZ: t101.z - t101.d / 2, maxZ: t101.z + t101.d / 2 };
  for (const lot of plan.lots) {
    const hit = lot.x + lot.w / 2 > site.minX && lot.x - lot.w / 2 < site.maxX && lot.z + lot.d / 2 > site.minZ && lot.z - lot.d / 2 < site.maxZ;
    assert.ok(!hit, `building at ${lot.x},${lot.z} intrudes on the Taipei 101 site`);
  }
  assert.ok(plan.tower, 'Taipei 101 massing planned');
  assert.equal(plan.tower.tiers.length, 8, 'eight bamboo-joint tiers');
  assert.equal(plan.tower.totalHeight, 508, 'true overall height');
  assert.ok(plan.tower.x > site.minX && plan.tower.x < site.maxX && plan.tower.z > site.minZ && plan.tower.z < site.maxZ, 'tower stands on its landmark site');
});
