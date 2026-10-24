import assert from 'node:assert/strict';
import test from 'node:test';

import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import {
  TAIPEI_GEO_ADAPTED,
  getTaipeiLocationLabel,
  getTaipeiLocationParts,
  taipeiDistrictAt,
  nearestGraphNode,
  currentTaipeiRoad,
} from '../js/taipei-adapter.js';
import { TAIPEI_TILE } from '../js/taipei-tile.js';
import { TILE_REGISTRY, tileIdFromSearch, loadSelectedTile } from '../js/tile-registry.js';
import { planTaipeiBuildings, taipeiCityBlocksOptions, pointInRing, latLonToTile } from '../js/taipei-buildings.js';

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

// HUD sign ordering (pulled forward from the localization pass at the user's
// request): the first green plate is the road the player is ON — its merged
// roadbed footprint contains the point — and the cross street comes second.
// Off-road points (park / block interior / landmark site) fall back to the
// nearest-roads pair exactly as before. Points below are derived from, or
// verified against, the pinned geodata.
test('location sign leads with the road you are on, cross street second', (t) => {
  const firstPlate = (label) => label.split(' · ').pop().split(' & ')[0];
  const segMid = (pts) => {
    let bi = 0, bl = -1;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const L = Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
      if (L > bl) { bl = L; bi = i; }
    }
    return [(pts[bi] + pts[bi + 2]) / 2, (pts[bi + 1] + pts[bi + 3]) / 2];
  };

  // (a) Standing on Zhongxiao E. Rd Sec. 4 (merged boulevard bed, ~29 m wide).
  const zxBed = TAIPEI_GEO.roadbeds.find((b) => b.merged && b.name === '忠孝東路四段');
  const [zxX, zxZ] = segMid(zxBed.pts);
  const onZx = currentTaipeiRoad(zxX, zxZ);
  t.diagnostic(`on-road at Zhongxiao Sec.4 (${zxX.toFixed(1)}, ${zxZ.toFixed(1)}): ${JSON.stringify(onZx)}`);
  assert.equal(onZx.name, '忠孝東路四段');
  assert.equal(firstPlate(getTaipeiLocationLabel(zxX, zxZ)), '忠孝東路四段');

  // (a2) At the Zhongxiao x Dunhua junction the old nearest-pair ordering led
  // with the cross street (Dunhua); on the boulevard the sign must lead with
  // Zhongxiao and demote Dunhua to the cross-street plate.
  const junction = getTaipeiLocationLabel(-1653, -950);
  t.diagnostic(`junction label: ${junction}`);
  assert.equal(junction, '忠孝東路四段 & 敦化南路一段');

  // (b) Standing on a named lane (巷): the lane itself leads, not the road it
  // branches from.
  const laneBed = TAIPEI_GEO.roadbeds.find((b) => b.name && b.name.includes('巷')
    && b.pts.some((_, i, p) => i % 2 === 0 && i + 3 < p.length && Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]) > 60));
  const [lnX, lnZ] = segMid(laneBed.pts);
  t.diagnostic(`lane point (${lnX.toFixed(1)}, ${lnZ.toFixed(1)}) on ${laneBed.name}`);
  assert.equal(currentTaipeiRoad(lnX, lnZ).name, laneBed.name);
  assert.equal(firstPlate(getTaipeiLocationLabel(lnX, lnZ)), laneBed.name);

  // (c) Da'an Forest Park centroid: inside the park, on no road — the
  // fallback nearest-roads label applies, no crash, no invented current road.
  const daan = TAIPEI_TILE.teleports.daanpark;
  assert.equal(currentTaipeiRoad(daan.x, daan.z), null);
  const parkLabel = getTaipeiLocationLabel(daan.x, daan.z);
  t.diagnostic(`Da'an centroid label: ${parkLabel}`);
  assert.equal(parkLabel, '建國南路二段');

  // (d) Taipei 101 spawn: the landmark centre is a block interior (off every
  // roadbed), so the familiar landmark + nearest-pair label is unchanged;
  // the roads it names (市府路 / 松廉路) are the ones adjoining the site.
  const lm = TAIPEI_GEO.landmarks['Taipei 101'];
  assert.equal(currentTaipeiRoad(lm.x, lm.z), null);
  assert.equal(getTaipeiLocationLabel(lm.x, lm.z), 'Taipei 101 · 市府路 & 松廉路');
});

// Structured label parts (drives the HUD's 正行駛 tag on the current
// road's plate): `current` is non-null ONLY where a roadbed footprint
// contains the point. The string label and the parts are computed from
// one shared helper, and this test pins that they agree.
test('location parts: current road reported only when a roadbed contains the point', (t) => {
  // (a) Zhongxiao x Dunhua junction: ON Zhongxiao, crossing Dunhua.
  const junction = getTaipeiLocationParts(-1653, -950);
  t.diagnostic(`junction parts: ${JSON.stringify(junction)}`);
  assert.deepEqual(junction, { place: null, current: '忠孝東路四段', cross: '敦化南路一段' });

  // (b) Da'an Forest Park centroid: off every road — the string label
  // still names the nearest road, but no road is "current".
  const daan = TAIPEI_TILE.teleports.daanpark;
  const park = getTaipeiLocationParts(daan.x, daan.z);
  t.diagnostic(`Da'an centroid parts: ${JSON.stringify(park)}`);
  assert.deepEqual(park, { place: null, current: null, cross: null });

  // (c) Taipei 101 landmark centre (the spawn point): the place is
  // reported, but the site is a block interior — no current road even
  // though the string label names the adjoining roads.
  const lm = TAIPEI_GEO.landmarks['Taipei 101'];
  const site = getTaipeiLocationParts(lm.x, lm.z);
  t.diagnostic(`Taipei 101 parts: ${JSON.stringify(site)}`);
  assert.deepEqual(site, { place: 'Taipei 101', current: null, cross: null });

  // (d) The tile exposes the parts getter main.js consumes.
  assert.equal(TAIPEI_TILE.getLocationParts, getTaipeiLocationParts);

  // (e) Parts and string are two views of one computation: wherever a
  // current road exists, the label's street plates are exactly
  // "current & cross" (or just "current"); wherever it does not, the
  // parts carry no street names at all.
  for (const [x, z] of [[-1653, -950], [45.0, -240.1], [daan.x, daan.z], [lm.x, lm.z]]) {
    const p = getTaipeiLocationParts(x, z);
    const streets = getTaipeiLocationLabel(x, z).split(' · ').pop();
    if (p.current) {
      assert.equal(streets, p.cross ? `${p.current} & ${p.cross}` : p.current, `parts/string agree at ${x},${z}`);
    } else {
      assert.equal(p.cross, null, `no cross street without a current road at ${x},${z}`);
    }
  }
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
  // The eight tiers are identical modules (the real tower's stacked
  // sections do not taper): same height and half-widths on every tier,
  // each flaring wider at its lip than at its stepped-in base. The
  // vertical budget podium + tiers + top section + spire sums to 508.
  const [tier0] = plan.tower.tiers;
  for (const tier of plan.tower.tiers) {
    assert.equal(tier.h, tier0.h, 'tier heights identical');
    assert.equal(tier.hwBottom, tier0.hwBottom, 'tier base half-widths identical');
    assert.equal(tier.hwTop, tier0.hwTop, 'tier lip half-widths identical');
    assert.ok(tier.hwTop > tier.hwBottom, 'each tier flares out to its lip');
  }
  assert.ok(plan.tower.top.hwTop < tier0.hwBottom, 'top section narrower than the tiers');
  assert.equal(plan.tower.spire.y0 + plan.tower.spire.h, 508, 'spire tip at 508 m');
  assert.ok(plan.tower.x > site.minX && plan.tower.x < site.maxX && plan.tower.z > site.minZ && plan.tower.z < site.maxZ, 'tower stands on its landmark site');
});

// Issue #26: the landmark structures around Taipei 101 (plus City
// Hall) get the 101 treatment — massing at the true position (real
// lat/lon through the geodata frame math) and the true published
// height, one signature silhouette feature each, and their sites
// (plus City Hall's open Civic Plaza) kept clear of generic lots.
// Expected heights/positions are the published values (Wikipedia /
// CTBUH), converted independently of the planner's own table.
test('landmark structures: true positions and heights, sites kept clear', (t) => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  const again = planTaipeiBuildings(TAIPEI_GEO);
  assert.deepEqual(plan.landmarkTowers, again.landmarkTowers, 'landmark plan deterministic across runs');
  const expected = {
    'taipei-nan-shan-plaza': { h: 272, x: 191.8, z: -155.1 },
    'the-sky-taipei': { h: 280, x: 106.6, z: -387.7 },
    'fubon-xinyi-a25': { h: 266.3, x: 504.6, z: -683.5 },
    'cathay-landmark': { h: 212, x: 199.0, z: -827.7 },
    'uni-president-international-tower': { h: 154, x: 19.6, z: -754.2 },
    'tao-zhu-yin-yuan': { h: 93.2, x: 545.0, z: -620.3 },
    'twtc-international-trade-building': { h: 142.92, x: -386.8, z: -157.0 },
    'taipei-city-hall': { h: 54.42, x: -56.5, z: -498.5 },
    // Batch 2 (issue #33): the Dome's 64 m is the above-ground height
    // (74.5 m published total minus the 10.5 m sunken field); the
    // Memorial Hall's 30.4 m is the official figure in the zh-Wikipedia
    // article body, positioned on its OSM footprint (see registry).
    'taipei-dome': { h: 64, x: -496.2, z: -1030.9 },
    'sun-yat-sen-memorial-hall': { h: 30.4, x: -474.3, z: -776.5 },
  };
  assert.equal(plan.landmarkTowers.length, Object.keys(expected).length, 'all verified structures present');
  const partTop = (p) => (p.y0 || 0) + p.h + (p.type === 'ridge' ? p.ridgeH : 0);
  for (const s of plan.landmarkTowers) {
    const e = expected[s.id];
    assert.ok(e, `unexpected landmark structure ${s.id}`);
    assert.equal(s.realHeight, e.h, `${s.id} carries its published height`);
    assert.ok(Math.abs(s.x - e.x) <= 1 && Math.abs(s.z - e.z) <= 1, `${s.id} at its true tile position`);
    const top = Math.max(...s.parts.map(partTop));
    assert.ok(Math.abs(top - e.h) < 0.01, `${s.id} massing tops out at its true height (got ${top})`);
    for (const rect of s.sites) {
      for (const lot of plan.lots) {
        const hit = lot.x + lot.w / 2 > rect.minX && lot.x - lot.w / 2 < rect.maxX && lot.z + lot.d / 2 > rect.minZ && lot.z - lot.d / 2 < rect.maxZ;
        assert.ok(!hit, `building at ${lot.x},${lot.z} intrudes on the ${s.id} site`);
      }
    }
  }
  t.diagnostic(`landmark structures: ${plan.landmarkTowers.map((s) => `${s.id}@${s.distFromOrigin}m`).join(', ')}`);
  // City Hall additionally registers its open Civic Plaza: exclusion
  // with no mass, west of the hall across City Hall Road.
  const hall = plan.landmarkTowers.find((s) => s.id === 'taipei-city-hall');
  assert.ok(hall.openGround, 'city hall registers the civic plaza as open ground');
  assert.ok(hall.openGround.maxX < hall.site.minX, 'plaza lies west of the hall site');
  // Tao Zhu Yin Yuan: per-floor segments twisting 4.5° each, ~90° total.
  const twist = plan.landmarkTowers.find((s) => s.id === 'tao-zhu-yin-yuan');
  const rots = twist.parts.filter((p) => p.rotY !== undefined).map((p) => p.rotY);
  assert.ok(rots.length >= 20, 'twist built from per-floor segments');
  for (let i = 1; i < rots.length; i++) assert.ok(rots[i] > rots[i - 1], 'twist accumulates monotonically');
  assert.ok(Math.abs(rots[rots.length - 1] - Math.PI / 2) < 0.01, 'twist totals 90 degrees');
  // The frame conversion itself: Taipei 101's published coordinates
  // land on its geodata landmark site.
  const t101 = TAIPEI_GEO.landmarks['Taipei 101'];
  const [c101x, c101z] = latLonToTile(25.033651, 121.564781, TAIPEI_GEO.frame.originLatLon);
  assert.ok(Math.abs(c101x - t101.x) < 100 && Math.abs(c101z - t101.z) < 100, 'frame conversion consistent with the geodata landmarks');
});

// Issue #33 batch 2: the two new silhouettes are honest massing — the
// Dome is an elliptical drum under a half-ellipsoid cap, and the
// Memorial Hall's upswept palace roof is the documented stylization
// (stepped frustum tiers + ridge + corner pylons), registered as hall
// mass only so Zhongshan Park around it stays open.
test('landmark batch 2: dome cap and stylized memorial-hall roof', () => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  const dome = plan.landmarkTowers.find((s) => s.id === 'taipei-dome');
  assert.ok(dome, 'taipei dome registered');
  const drum = dome.parts.find((p) => p.type === 'cylinder');
  const cap = dome.parts.find((p) => p.type === 'dome');
  assert.ok(drum && cap, 'dome = elliptical drum + dome cap');
  assert.ok(drum.rz < drum.r, 'drum plan is elliptical (170 m span across z)');
  assert.equal(cap.y0 + cap.h, 64, 'dome cap peaks at the 64 m above-ground height');
  // The drum's south rim stays clear of Zhongxiao Road's roadbed.
  let nearest = Infinity;
  for (const r of TAIPEI_GEO.roadbeds) {
    for (let i = 0; i + 1 < r.pts.length; i += 2) {
      nearest = Math.min(nearest, Math.hypot(r.pts[i] - dome.x, r.pts[i + 1] - dome.z));
    }
  }
  assert.ok(nearest > drum.rz, 'no roadbed point inside the drum ellipse');

  const hall = plan.landmarkTowers.find((s) => s.id === 'sun-yat-sen-memorial-hall');
  assert.ok(hall, 'memorial hall registered');
  const frustums = hall.parts.filter((p) => p.type === 'frustum');
  const ridge = hall.parts.find((p) => p.type === 'ridge');
  assert.ok(frustums.length >= 2 && ridge, 'roof massed as stepped frustum tiers under a ridge');
  assert.equal(ridge.y0 + ridge.ridgeH, 30.4, 'ridge peaks at the published 30.4 m');
  const pylons = hall.parts.filter((p) => p.type === 'box' && p.dx !== undefined && Math.abs(p.dx) === Math.abs(p.dz));
  assert.equal(pylons.length, 4, 'four corner pylons');
  // Hall mass only: the exclusion is the hall's own footprint, and the
  // mass stands on the geodata's OSM footprint for the building.
  assert.ok(hall.site.maxX - hall.site.minX <= 130 && hall.site.maxZ - hall.site.minZ <= 130, 'site is the hall footprint, not the park');
  assert.equal(hall.openGround, null, 'no extra open-ground registration — the park is already park');
  const osm = TAIPEI_GEO.landmarks['Sun Yat-sen Memorial Hall'];
  assert.ok(Math.abs(hall.x - osm.x) <= 2 && Math.abs(hall.z - osm.z) <= 2, 'hall stands on its OSM footprint');
});

// Issue #11: the plan is rendered by upstream's buildCityBlocks, fed
// through taipeiCityBlocksOptions. The adapter must be a faithful,
// deterministic transcription of the plan: one upstream lot per planned
// lot, same footprint and height, a valid facade material index, the
// tile frame as bounds, and colliders off (visual-only parity).
test('buildings options: plan faithfully adapted for the upstream building system', (t) => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  const opts = taipeiCityBlocksOptions(TAIPEI_GEO, plan);
  const again = taipeiCityBlocksOptions(TAIPEI_GEO, plan);
  assert.deepEqual(opts, again, 'options deterministic across calls');
  assert.equal(opts.lots.length, plan.lots.length, 'one upstream lot per planned lot');
  assert.equal(opts.colliders, false, 'tile buildings stay visual-only');
  assert.deepEqual(opts.bounds, TAIPEI_GEO.frame.bbox, 'streaming bounds are the tile frame');
  assert.deepEqual(opts.initial, [0, 0], 'first detail stream centres on the tile origin');
  t.diagnostic(`upstream lots: ${opts.lots.length}, mats ${JSON.stringify(opts.lots.reduce((m, l) => { m[l.mat] = (m[l.mat] || 0) + 1; return m; }, {}))}`);
  opts.lots.forEach((l, i) => {
    const p = plan.lots[i];
    assert.ok(l.x0 < l.x1 && l.z0 < l.z1, 'lot rect well-formed');
    assert.ok(Math.abs((l.x0 + l.x1) / 2 - p.x) < 0.051 && Math.abs((l.z0 + l.z1) / 2 - p.z) < 0.051, 'lot centre matches the plan');
    assert.ok(Math.abs((l.x1 - l.x0) - p.w) < 0.051 && Math.abs((l.z1 - l.z0) - p.d) < 0.051, 'lot footprint matches the plan');
    assert.equal(l.h, p.h, 'lot height matches the plan');
    assert.ok(Number.isInteger(l.mat) && l.mat >= 0 && l.mat <= 5, `facade material index ${l.mat} within upstream's six families`);
  });
  // Material zoning: the tall Xinyi core goes curtain glass (3-5), the
  // low residential interiors stay masonry (0-2).
  const core = opts.lots.filter((l) => l.h >= 40);
  assert.ok(core.length > 0 && core.every((l) => l.mat >= 3), 'tall core lots are glass');
  const low = opts.lots.filter((l) => l.h < 12);
  assert.ok(low.length > 0 && low.every((l) => l.mat <= 2), 'low residential lots are masonry');
});
