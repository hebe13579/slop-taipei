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
import { planTaipeiBuildings, taipeiCityBlocksOptions, pointInRing, latLonToTile, clampTaipeiRooftopGear, taipeiArcadeParts, taipeiVerticalSigns, taipeiRooftopAdditions, TAIPEI_ARCADE_DEPTH, taipei101OrnamentPositions, taipeiLandmarkStructures } from '../js/taipei-buildings.js';

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
  // Label re-pinned 2026-10-24 (issue #60): the old tile clipped the
  // park at lon 121.535, so the teleport (the park ring's bbox centre)
  // sat in the park's eastern sliver near 建國南路. The full park is in
  // the union now; its true centre's nearest roads are the western
  // edge's 新生南路二段 & 金華街.
  const daan = TAIPEI_TILE.teleports.daanpark;
  assert.equal(currentTaipeiRoad(daan.x, daan.z), null);
  const parkLabel = getTaipeiLocationLabel(daan.x, daan.z);
  t.diagnostic(`Da'an centroid label: ${parkLabel}`);
  assert.equal(parkLabel, '新生南路二段 & 金華街');

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

// Issue #40: the 101 podium is the real mall massing and the tier
// joints wear ornaments. Invariants: the shaft budget is untouched
// (508 m, identical tiers — asserted above too), every podium part
// stands inside the landmark site AND clear of every roadbed ribbon
// (issue #42's rule), the mall blocks follow the geodata "Taipei 101
// MALL" outline, the entrance court on the tower axis stays open
// (the landmark/spawn point stands in it), and all eight joints
// carry 4 corner discs + 4 face pieces — coins at joint 1 only,
// where the real pedestal meets the tower.
test('taipei 101 mall podium and joint ornaments (issue #40)', (t) => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  const tower = plan.tower;
  const t101 = TAIPEI_GEO.landmarks['Taipei 101'];
  const mall = TAIPEI_GEO.landmarks['Taipei 101 MALL'];
  const site = { minX: t101.x - t101.w / 2, maxX: t101.x + t101.w / 2, minZ: t101.z - t101.d / 2, maxZ: t101.z + t101.d / 2 };
  const mallRect = { minX: mall.x - mall.w / 2, maxX: mall.x + mall.w / 2, minZ: mall.z - mall.d / 2, maxZ: mall.z + mall.d / 2 };

  assert.equal(tower.totalHeight, 508, 'total height unchanged');
  assert.deepEqual(tower.podium, { w: 62, d: 62, h: 9 }, 'tower-zone base block');
  const boxes = tower.podiumParts.filter((p) => p.type === 'box');
  const shell = tower.podiumParts.find((p) => p.type === 'shell');
  assert.equal(boxes.length, 2, 'two mall blocks flank the court');
  assert.ok(shell, 'curved roof shell present');
  assert.equal(shell.y0 + shell.h, 38, 'shell top at the published podium main-roof height (124 ft)');

  const partRect = (p) => {
    const cx = tower.x + (p.dx || 0), cz = tower.z + (p.dz || 0);
    if (p.type === 'box') return { minX: cx - p.w / 2, maxX: cx + p.w / 2, minZ: cz - p.d / 2, maxZ: cz + p.d / 2 };
    return { minX: cx - p.rB, maxX: cx + p.rB, minZ: cz, maxZ: cz + p.rB }; // shell bbox (arc opens south)
  };
  const rects = [
    { name: 'base', rect: { minX: tower.x - tower.podium.w / 2, maxX: tower.x + tower.podium.w / 2, minZ: tower.z - tower.podium.d / 2, maxZ: tower.z + tower.podium.d / 2 }, inMall: false },
    ...tower.podiumParts.map((p) => ({ name: p.type, rect: partRect(p), inMall: true })),
  ];
  const inRect = (r, x, z) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
  for (const { name, rect, inMall } of rects) {
    assert.ok(rect.minX >= site.minX && rect.maxX <= site.maxX && rect.minZ >= site.minZ && rect.maxZ <= site.maxZ, `${name} inside the landmark site`);
    if (inMall) assert.ok(rect.minX >= mallRect.minX - 0.01 && rect.maxX <= mallRect.maxX + 0.01 && rect.minZ >= mallRect.minZ - 0.01 && rect.maxZ <= mallRect.maxZ + 0.01, `${name} follows the OSM mall outline`);
    assert.ok(!inRect(rect, t101.x, t101.z), `${name} keeps off the landmark/spawn point (entrance court stays open)`);
  }

  // Exact rect-to-segment distance (endpoint-in-rect or edge
  // crossing = 0), minus each ribbon's half width, must stay > 0.
  const distToSegment = (px, pz, ax, az, bx, bz) => {
    const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
    let tt = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
    tt = Math.max(0, Math.min(1, tt));
    return Math.hypot(ax + tt * dx - px, az + tt * dz - pz);
  };
  const distPtRect = (px, pz, r) => Math.hypot(Math.max(r.minX - px, 0, px - r.maxX), Math.max(r.minZ - pz, 0, pz - r.maxZ));
  const segSeg = (ax, az, bx, bz, cx, cz, dx, dz) => {
    const o = (px, pz, qx, qz, rx, rz) => (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
    return (o(ax, az, bx, bz, cx, cz) > 0) !== (o(ax, az, bx, bz, dx, dz) > 0) && (o(cx, cz, dx, dz, ax, az) > 0) !== (o(cx, cz, dx, dz, bx, bz) > 0);
  };
  const distSegRect = (ax, az, bx, bz, r) => {
    if (inRect(r, ax, az) || inRect(r, bx, bz)) return 0;
    const corners = [[r.minX, r.minZ], [r.maxX, r.minZ], [r.maxX, r.maxZ], [r.minX, r.maxZ]];
    for (let i = 0; i < 4; i++) if (segSeg(ax, az, bx, bz, ...corners[i], ...corners[(i + 1) % 4])) return 0;
    let d = Math.min(distPtRect(ax, az, r), distPtRect(bx, bz, r));
    for (const [cx, cz] of corners) d = Math.min(d, distToSegment(cx, cz, ax, az, bx, bz));
    return d;
  };
  for (const { name, rect } of rects) {
    let minClear = Infinity;
    for (const b of TAIPEI_GEO.roadbeds) {
      const half = Math.max((b.width || 3) / 2, 0.75);
      for (let i = 0; i + 3 < b.pts.length; i += 2) {
        minClear = Math.min(minClear, distSegRect(b.pts[i], b.pts[i + 1], b.pts[i + 2], b.pts[i + 3], rect) - half);
      }
    }
    t.diagnostic(`101 podium ${name}: min roadbed clearance ${minClear.toFixed(1)} m`);
    assert.ok(minClear > 0, `${name} clears every roadbed (got ${minClear.toFixed(2)} m)`);
  }

  // Ornaments: 8 per joint × 8 joints; coins only at the first.
  const orn = tower.ornaments;
  assert.equal(orn.length, 64, '64 ornaments total');
  const jointTops = tower.tiers.map((tier) => tier.y0 + tier.h);
  assert.deepEqual([...new Set(orn.map((o) => o.jointY))].sort((a, b) => a - b), jointTops, 'ornaments at all eight tier joints');
  for (const jy of jointTops) {
    const at = orn.filter((o) => o.jointY === jy);
    assert.equal(at.length, 8, `joint ${jy}: eight ornaments`);
    const discs = at.filter((o) => o.kind === 'disc');
    const faces = at.filter((o) => o.kind !== 'disc');
    assert.equal(discs.length, 4, `joint ${jy}: four corner discs`);
    assert.equal(faces.length, 4, `joint ${jy}: four face pieces`);
    for (const d of discs) {
      assert.ok(Math.abs(Math.abs(d.x - tower.x) - 25) < 0.01 && Math.abs(Math.abs(d.z - tower.z) - 25) < 0.01, 'disc sits on a tier corner');
      assert.equal(d.r, 3.4, 'corner disc radius');
    }
    for (const f of faces) {
      const onX = Math.abs(f.x - tower.x) > 20, onZ = Math.abs(f.z - tower.z) > 20;
      assert.ok(onX !== onZ, 'face piece centred on a face');
      if (jy === jointTops[0]) { assert.equal(f.kind, 'coin', 'joint 1 faces wear the coin discs'); assert.equal(f.r, 5.2); }
      else { assert.equal(f.kind, 'plaque', 'upper joints wear square plaques'); assert.equal(f.w, 6.4); assert.equal(f.h, 6.4); }
    }
    for (const o of at) assert.ok(o.y < jy && o.y > jy - 12, `joint ${jy}: ornament hangs just below the lip`);
  }
  // The merged soup: exact triangle budget, all finite.
  const soup = taipei101OrnamentPositions(orn);
  assert.equal(soup.length, (32 * 56 + 4 * 72 + 28 * 12) * 9, 'ornament soup triangle budget (2,416 tris)');
  assert.ok(soup.every(Number.isFinite), 'ornament soup coordinates finite');
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
  // Positions for the six issue-#42-corrected structures are the
  // OSM building-footprint centroids recorded in the registry (the
  // batch-1 published-coordinate pins put Fubon A25 on 松高路 and
  // oversized podiums on four more); heights are unchanged.
  const expected = {
    'taipei-nan-shan-plaza': { h: 272, x: 200.0, z: -155.1 },
    'the-sky-taipei': { h: 280, x: 105.7, z: -383.1 },
    'fubon-xinyi-a25': { h: 266.3, x: 562.9, z: -734.3 },
    'cathay-landmark': { h: 212, x: 186.2, z: -829.5 },
    'uni-president-international-tower': { h: 154, x: 40.9, z: -743.2 },
    'tao-zhu-yin-yuan': { h: 93.2, x: 545.0, z: -620.3 },
    'twtc-international-trade-building': { h: 142.92, x: -370.0, z: -160.0 },
    'taipei-city-hall': { h: 54.42, x: -56.5, z: -498.5 },
    // Batch 2 (issue #33): the Dome's 64 m is the above-ground height
    // (74.5 m published total minus the 10.5 m sunken field); the
    // Memorial Hall's 30.4 m is the official figure in the zh-Wikipedia
    // article body, positioned on its OSM footprint (see registry).
    'taipei-dome': { h: 64, x: -496.2, z: -1030.9 },
    'sun-yat-sen-memorial-hall': { h: 30.4, x: -474.3, z: -776.5 },
    // Batch 3 (issue #43): positions are the OSM footprint centres
    // (W: way 312729918; Songshan hall: relation 3067837; Eslite:
    // way 229059792; Arena: way 244001544). W's 151 m is published;
    // Songshan's 30 m follows its (unpublished, estimated) chimney;
    // Eslite's 63 m and the Arena's 31 m are ESTIMATES — see the
    // registry comments for the methods.
    'w-taipei': { h: 151, x: -20.2, z: -835.6 },
    'songshan-cultural-park': { h: 30, x: -481.9, z: -1175.6 },
    'eslite-spectrum-songyan': { h: 63, x: -372.8, z: -1281.7 },
    'taipei-arena': { h: 31, x: -1501.0, z: -1962.6 },
    // Batch 4 (issue #74, west-expansion phase 2): the station
    // district. Positions are the OSM footprint centres (Shin Kong:
    // way 204711206; Main Station: way 23641610; CKS Hall: the way
    // 1052759757 terrace centre; Concert Hall: way 1052759775;
    // Theater: way 1052759776; Presidential Office: relation 206817
    // assembly centre). Heights 244.15 / 48 / 70 / 60 m are
    // published; the two halls' 37 m is the OSM tag, flagged
    // estimated in the registry (see the batch-4 test).
    'shin-kong-life-tower': { h: 244.15, x: -5016.4, z: -1458.4 },
    'taipei-main-station': { h: 48, x: -4839.7, z: -1623.1 },
    'chiang-kai-shek-memorial-hall': { h: 70, x: -4388.2, z: -200.6 },
    'national-concert-hall': { h: 37, x: -4616.0, z: -441.4 },
    'national-theater': { h: 37, x: -4718.7, z: -256.9 },
    'presidential-office-building': { h: 60, x: -5351.6, z: -774.7 },
    // Batch 5 (issue #86): Beimen on its #77 junction island.
    // The 19 m is the accepted overall estimate (no published
    // figure exists — flagged estimated in the registry), and
    // the position is the island centre the junction treatment
    // fitted between the generated carriageways, NOT the
    // published gate point ~19 m WNW (see registry comment).
    'beimen': { h: 19, x: -5410.1, z: -1625.0 },
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

// Issue #43 batch 3: four new structures plus the Cathay Landmark
// rebuild. Cathay's massing follows the user's reference photo —
// two combined slabs (taller main + one stepped secondary) on the
// curved-front podium, which is also 微風信義 Breeze Xinyi's
// representation (the mall is inside this tower, not a separate
// structure). Eslite Songyan and Taipei Arena carry ESTIMATED
// heights (no published figure exists for either), flagged as
// such in the registry and carried through the map export.
test('landmark batch 3: two-slab Cathay rebuild, W, Songshan, Eslite, Arena', () => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  const byId = (id) => plan.landmarkTowers.find((s) => s.id === id);
  const partTop = (p) => (p.y0 || 0) + p.h + (p.type === 'ridge' ? p.ridgeH : 0);

  // Cathay Landmark: elliptical podium + exactly two slabs, one
  // step between them, sharing a face (combined, not separate).
  const cathay = byId('cathay-landmark');
  assert.ok(cathay, 'cathay landmark registered');
  const podium = cathay.parts.find((p) => p.type === 'cylinder');
  assert.ok(podium && podium.rz < podium.r, 'podium is the curved-front ellipse');
  const slabs = cathay.parts.filter((p) => p.type === 'box');
  assert.equal(slabs.length, 2, 'two combined slabs, no staircase crown');
  const tops = slabs.map(partTop).sort((a, b) => b - a);
  assert.equal(tops[0], 212, 'main slab tops out at the published 212 m');
  assert.ok(tops[1] < tops[0] && tops[1] > 180, 'secondary slab is one clean step below');
  const [west, east] = slabs.slice().sort((a, b) => (a.dx || 0) - (b.dx || 0));
  assert.equal((west.dx || 0) + west.w / 2, (east.dx || 0) - east.w / 2, 'slabs share a face — combined massing');

  // W Taipei: three podium blocks around the bus-loop court and
  // the tower rising from the east block to the published 151 m.
  const w = byId('w-taipei');
  assert.ok(w, 'w taipei registered');
  assert.equal(w.parts.filter((p) => p.type === 'box' && !p.y0).length, 3, 'podium massed as three blocks around the station court');
  const tower = w.parts.find((p) => p.y0 === 17);
  assert.ok(tower && partTop(tower) === 151, 'tower rises from the podium to 151 m');
  const eastPodium = w.parts.find((p) => !p.y0 && p.dx === tower.dx);
  assert.ok(eastPodium, 'tower stands on the east podium block');

  // Songshan park: hall + ridge roof, boiler room, and the
  // chimney as the tallest part.
  const park = byId('songshan-cultural-park');
  assert.ok(park, 'songshan park registered');
  const chimney = park.parts.find((p) => p.type === 'cylinder');
  assert.ok(chimney && partTop(chimney) === 30, 'chimney is the tallest part at 30 m');
  assert.ok(park.parts.filter((p) => p.type === 'box').length >= 2, 'factory hall and boiler room both massed');
  assert.ok(park.parts.some((p) => p.type === 'ridge'), 'hall carries its ridge roof');

  // Estimated heights are flagged, and only where flagged.
  const eslite = byId('eslite-spectrum-songyan');
  const arena = byId('taipei-arena');
  assert.equal(eslite.estimated, true, 'eslite height is an estimate (14 floors, no published metres)');
  assert.equal(arena.estimated, true, 'arena height is an estimate (no published height exists)');
  for (const s of plan.landmarkTowers) {
    // Batch 4 (issue #74) adds two more estimated heights: the two
    // national halls' 37 m is OSM-derived, not published. Batch 5
    // (issue #86) adds Beimen: its ~19 m overall height is the
    // accepted estimate — no published figure exists at all.
    if (s.id !== 'eslite-spectrum-songyan' && s.id !== 'taipei-arena'
      && s.id !== 'national-concert-hall' && s.id !== 'national-theater'
      && s.id !== 'beimen') {
      assert.equal(s.estimated, false, `${s.id} height is published, not estimated`);
    }
  }

  // Taipei Arena: elliptical drum + shallow dome cap + annex.
  const drum = arena.parts.find((p) => p.type === 'cylinder');
  const cap = arena.parts.find((p) => p.type === 'dome');
  assert.ok(drum && cap && drum.rz > drum.r, 'arena egg = elliptical drum (long in z) + dome cap');
  assert.equal(cap.y0 + cap.h, 31, 'dome cap peaks at the estimated 31 m');
  assert.ok(arena.parts.some((p) => p.type === 'box' && (p.dx || 0) > 0), 'ice-rink annex attached east');

  // The map layer reads the same registry: every batch-3 entry is
  // on the tile's landmark list with its Chinese name (pin +
  // Chinese-name search read nameZh from this list).
  for (const id of ['cathay-landmark', 'w-taipei', 'songshan-cultural-park', 'eslite-spectrum-songyan', 'taipei-arena']) {
    const pin = TAIPEI_TILE.landmarks.find((l) => l.id === id);
    assert.ok(pin && pin.nameZh && pin.height > 0, `${id} has a map pin with a Chinese name`);
  }
  const exported = taipeiLandmarkStructures(TAIPEI_GEO);
  assert.equal(exported.length, plan.landmarkTowers.length, 'map export covers the whole registry');
});

// Issue #74 batch 4 (west-expansion phase 2): the six station-
// district landmarks. Shin Kong is the beige tower under its
// pyramid crown; the Main Station is the long house under stepped
// red roofs with the clock tower at the centre (its massing sits
// +11 m east inside the slanted OSM outline to clear the 承德路
// diagonal — see the registry comment); the CKS Hall stacks three
// terrace steps, the white hall and two blue frustum eaves under a
// gold finial; the two national halls are the palace pair (plinth,
// walls, golden frustum hip + ridge) across Liberty Square; the
// Presidential Office is the red-brick baroque block — long main
// range, two end pavilions, central tower. The halls' sites only
// became buildable when the memorial park's internal service
// drives stopped being roadbeds (generation-map rule, issue #74).
test('landmark batch 4: station district — crown, clock tower, terrace hall, palace pair, brick block', () => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  const byId = (id) => plan.landmarkTowers.find((s) => s.id === id);
  const partTop = (p) => (p.y0 || 0) + p.h + (p.type === 'ridge' ? p.ridgeH : 0);

  // Shin Kong Life Tower: podium + shaft + pyramid crown + cap.
  const shinKong = byId('shin-kong-life-tower');
  assert.ok(shinKong, 'shin kong life tower registered');
  const crown = shinKong.parts.find((p) => p.type === 'frustum');
  assert.ok(crown && crown.wT < crown.wB, 'pyramid crown steps in from the shaft');
  assert.equal(Math.max(...shinKong.parts.map(partTop)), 244.15, 'cap tops out at the published 244.15 m');

  // Taipei Main Station: stepped red roofs + clock tower at 48 m.
  const station = byId('taipei-main-station');
  assert.ok(station, 'taipei main station registered');
  const clock = station.parts.find((p) => p.y0 === 40);
  assert.ok(clock && partTop(clock) === 48, 'clock tower tops out at the published 48 m');
  assert.ok(station.parts.filter((p) => p.flat === 0x9c4a38).length >= 2, 'red roof steps carry the flat terracotta');

  // CKS Memorial Hall: three terrace steps + two blue eaves + finial.
  const cks = byId('chiang-kai-shek-memorial-hall');
  assert.ok(cks, 'cks memorial hall registered');
  const terraces = cks.parts.filter((p) => p.type === 'box' && p.flat === 0xa39a8b || (p.type === 'box' && (p.y0 === 4.8 || p.y0 === 9.6)));
  assert.ok(terraces.length >= 2, 'stepped terrace levels present under the hall');
  const eaves = cks.parts.filter((p) => p.type === 'frustum' && p.flat === 0x1e4d8c);
  assert.equal(eaves.length, 2, 'blue double-eaved roof as two frustum tiers');
  const finial = cks.parts.find((p) => p.type === 'cylinder');
  assert.ok(finial && partTop(finial) === 70, 'gold finial tops out at the published 70 m');

  // The palace pair: same recipe (plinth / walls / frustum / ridge),
  // ridge peaks at the OSM-derived 37 m, flagged estimated.
  const concert = byId('national-concert-hall');
  const theater = byId('national-theater');
  assert.ok(concert && theater, 'both national halls registered');
  for (const hall of [concert, theater]) {
    assert.deepEqual(hall.parts.map((p) => p.type), ['box', 'box', 'frustum', 'ridge'], `${hall.id} = plinth + walls + frustum hip + ridge`);
    const ridge = hall.parts.find((p) => p.type === 'ridge');
    assert.equal(partTop(ridge), 37, `${hall.id} ridge peaks at 37 m`);
    assert.equal(hall.estimated, true, `${hall.id} height is OSM-derived, flagged estimated`);
  }
  assert.ok(concert.x > theater.x && concert.z < theater.z, 'concert hall stands NE of the theater across the square');

  // Presidential Office: main range + two pavilions + tower at 60 m.
  const office = byId('presidential-office-building');
  assert.ok(office, 'presidential office registered');
  const pavilions = office.parts.filter((p) => p.type === 'box' && Math.abs(p.dz || 0) === 54);
  assert.equal(pavilions.length, 2, 'two end pavilions flank the main range');
  assert.equal(Math.max(...office.parts.map(partTop)), 60, 'tower cap tops out at the published 60 m');

  // Map pins + Chinese names for all six, via the tile landmark list.
  for (const id of ['shin-kong-life-tower', 'taipei-main-station', 'chiang-kai-shek-memorial-hall', 'national-concert-hall', 'national-theater', 'presidential-office-building']) {
    const pin = TAIPEI_TILE.landmarks.find((l) => l.id === id);
    assert.ok(pin && pin.nameZh && pin.height > 0, `${id} has a map pin with a Chinese name`);
  }
});

// Issue #86 batch 5: Beimen (Cheng-en Gate) on the plaza island
// its #77 junction treatment fitted — two stone platform blocks
// flanking the single passage, the red-brick gatehouse bridging
// them, and the stepped tile roof under its ridge cap, every
// part turned to the island capsule's axis. The footprint vs
// roadbeds half of the contract is the unedited issue-#42 test.
test('landmark batch 5: beimen gate on its junction island', () => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  const gate = plan.landmarkTowers.find((s) => s.id === 'beimen');
  assert.ok(gate, 'beimen registered');
  assert.equal(gate.estimated, true, 'height is an estimate (no published figure exists)');
  const partTop = (p) => (p.y0 || 0) + p.h + (p.type === 'ridge' ? p.ridgeH : 0);
  assert.equal(Math.max(...gate.parts.map(partTop)), 19, 'ridge cap tops out at the estimated 19 m');
  // Two platform blocks flank the passage; the gatehouse walls
  // bridge the gap above them (y0 5.2, checked via part tops).
  const platform = gate.parts.filter((p) => !p.y0 && p.h === 5.2);
  assert.equal(platform.length, 2, 'platform massed as two blocks around the passage');
  assert.ok(gate.parts.some((p) => p.flat === 0x35302b && p.h === 4.6), 'passage carries its shadow plug');
  const centreDist = Math.hypot(platform[0].dx - platform[1].dx, platform[0].dz - platform[1].dz);
  const passage = centreDist - platform[0].w;
  assert.ok(passage > 4 && passage < 7, `passage gap reads at gate scale (${passage.toFixed(1)} m along the axis)`);
  for (const p of gate.parts) {
    assert.equal(p.type, 'box', 'beimen is stacked rotated boxes only (ridge/frustum parts cannot rotate)');
    assert.ok(Math.abs(p.rotY - Math.atan2(-0.531, -0.848)) < 0.001, 'every part turns with the island axis');
  }
  // The island and its apron stay open ground around the gate.
  assert.ok(gate.openGround, 'beimen registers its island plaza as open ground');
  const pin = TAIPEI_TILE.landmarks.find((l) => l.id === 'beimen');
  assert.ok(pin && pin.nameZh === '北門' && pin.height === 19, 'beimen has a map pin with its Chinese name');
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
    assert.ok(Number.isInteger(l.mat) && l.mat >= 0 && l.mat <= 9, `facade material index ${l.mat} within upstream's ten families`);
  });
  // Material zoning: the tall Xinyi core goes curtain glass (3-5), the
  // low residential interiors stay masonry (0-2).
  const core = opts.lots.filter((l) => l.h >= 40);
  assert.ok(core.length > 0 && core.every((l) => l.mat >= 3), 'tall core lots are glass');
  const low = opts.lots.filter((l) => l.h < 12);
  assert.ok(low.length > 0 && low.every((l) => l.mat <= 2), 'low residential lots are masonry');
});

// Issue #17: the four Taiwan types (families 6-9) are assigned only inside
// their height bands, together take a large share of the masonry lots
// there, and the glass families' counts are exactly what the pre-#17
// rules produced (the glass rolls are evaluated first, unchanged). The
// rooftop-gear clamp keeps every unit inside its roof, near-square, and
// removes water towers.
test('taiwan types: family zoning, distribution and rooftop clamp', (t) => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  const opts = taipeiCityBlocksOptions(TAIPEI_GEO, plan);
  const taiwan = opts.lots.filter((l) => l.mat >= 6);
  assert.ok(taiwan.length > 3000, `the Taiwan set is a major presence (${taiwan.length} lots)`);
  assert.ok(taiwan.every((l) => l.h >= 15 && l.h < 40), 'Taiwan types only on 15-40 m lots');
  // Per-type bands: 6 tile shophouse 15-40, 7 arcade < 36, 8 walk-up
  // < 36, 9 pebble-dash 15-40 — and every type is planted in real
  // numbers. Issue #55 raised the F7 cap 28 → 36 and the F8 cap 30 → 36
  // (the taller fourth gallery sample needs a planted band behind it;
  // both stay under 40 m, where facadeMatFor's untouched glass rule
  // takes over, which is what keeps the glass pin below exact).
  const typeBand = { 6: [15, 40], 7: [15, 36], 8: [15, 36], 9: [15, 40] };
  for (const [mat, [lo, hi]] of Object.entries(typeBand)) {
    const lots = opts.lots.filter((l) => l.mat === Number(mat));
    assert.ok(lots.length > 400, `family ${mat} planted in real numbers (${lots.length} lots)`);
    assert.ok(lots.every((l) => l.h >= lo && l.h < hi), `family ${mat} only on ${lo}-${hi} m lots`);
    t.diagnostic(`family ${mat}: ${lots.length} lots`);
  }
  const band = opts.lots.filter((l) => l.h >= 15 && l.h < 22);
  const bandTaiwan = band.filter((l) => l.mat >= 6).length;
  assert.ok(bandTaiwan / band.length > 0.55, `15-22 m band is mostly Taiwan types (${bandTaiwan}/${band.length})`);
  const glass = opts.lots.filter((l) => l.mat >= 3 && l.mat <= 5).length;
  t.diagnostic(`taiwan set 6-9: ${taiwan.length} lots; glass 3-5: ${glass} lots`);
  // The invariant is structural: facadeMatFor evaluates the glass rolls
  // first, on the same hash and thresholds as pre-#17, and the Taiwan
  // roll only subdivides the masonry remainder — so this count is
  // whatever the current lot plan yields. It was 2367 on the branch's
  // data and 2364 on main after PR #53 regenerated the road data
  // (3 glass-eligible lots fewer in the plan); issue #65's exact
  // ribbon exclusion then removed every lot that stood on a roadbed
  // or in a divided median — 716 of them glass — re-pinning the count
  // to 1648 on the old data, as the gate re-pins absolute numbers when
  // the plan legitimately changes (PR #35's band-km pin is the
  // precedent). The west-expansion data (issue #60) re-based the plan
  // to 23,106 lots / 2,388 glass; the PR #70 gate resolution then
  // applied the same #65 exclusion to the expansion plan — the
  // filter's own counters (lotsDroppedRoad 24,262 → 29,082, plus 114
  // median drops) account for exactly the 4,934 lots removed (23,106
  // → 18,172), 641 of them glass — re-pinning the count to 1747.
  // Issue #62 then turned the lot grids of the 1,501 blocks whose
  // fronting streets run at an angle (5,569 turned lots): a turned
  // grid repacks inside its block's inset bbox — its frame extent
  // reaches past the rect's corners, and the 26,222 candidates that
  // land outside are skipped, while the exact true-footprint tests
  // (rotated SAT vs ribbons/sites, rotated corners vs parks/union)
  // drop a few hundred more. The plan goes to 16,808 lots; every
  // family gives up lots in proportion to its presence on angled
  // blocks (F0 −295, F1 −365, F2 −237, F3 −93, F4 −9, F5 −31,
  // F6 −87, F7 −63, F8 −92, F9 −92), 133 of them glass —
  // re-pinning the count to 1614. Blocks on the true grids are
  // byte-identical to the pre-#62 plan (the axis path is untouched;
  // forcing the orientation epsilon off reproduces 18,172 / 1747
  // exactly), so the whole delta is the turned blocks' repack.
  // Gate re-pin 1614 -> 1611: PR #82's data fix dropped 22 CKS
  // Memorial park service beds, reshaping the park-edge blocks;
  // the merged-tree plan yields 3 fewer glass lots. Proven delta,
  // measured at the #79 gate on main f7693317.
  // Re-pinned for issue #102 (northern phase 1): the plan grows
  // 16,793 -> 45,548 lots over the five-box tile; the glass rolls
  // still evaluate first and unchanged, so the count is whatever
  // the enlarged plan yields — 3,636 glass (the north adds the
  // Tianmu/Shilin mid-rise stock plus Beitou resort towers), 9,823
  // Taiwan-type and 32,089 masonry lots.
  assert.equal(glass, 3636, 'glass family counts untouched by the Taiwan-type assignment');
  const masonry = opts.lots.filter((l) => l.mat <= 2).length;
  // Range re-based for issue #65: the exact ribbon exclusion removed
  // ~4,400 masonry lots that stood on ribbons or in medians; masonry
  // is reduced but still the city's majority fabric.
  // Range re-based for issue #102: 32,089 of 45,548 lots — still
  // the majority fabric of the enlarged tile.
  assert.ok(masonry > 28000 && masonry < 36000, `masonry 0-2 reduced but still present (${masonry})`);
  assert.equal(typeof opts.rooftopGearClamp, 'function', 'options carry the rooftop-gear clamp');

  const lot = { x0: 0, x1: 9, z0: 0, z1: 14 };
  const gear = clampTaipeiRooftopGear({
    waterTowers: [{ x: 4, y: 20, z: 7 }],
    hvacUnits: [
      { x: 4.5, y: 20, z: 7, w: 8.6, h: 5.2, d: 3.0 },   // oversized + too tall
      { x: -30, y: 20, z: 40, w: 2.4, h: 2.6, d: 2.4 },  // centre off the roof
    ],
  }, lot);
  // The incoming cedar tower is gone; this synthetic lot carries no
  // mat/h, so the issue #56 stainless-tank policy adds nothing either.
  assert.deepEqual(gear.waterTowers, [], 'cedar water towers removed for Taipei');
  assert.equal(gear.hvacUnits.length, 2, 'both units survive on a 9x14 m roof');
  for (const u of gear.hvacUnits) {
    assert.ok(u.w <= 4.2 && u.d <= 4.2 && u.h <= 3.0, 'unit size caps hold');
    assert.ok(Math.max(u.w, u.d) / Math.min(u.w, u.d) <= 1.3 + 1e-9, 'unit stays near-square (fans stay circular)');
    assert.ok(u.x - u.w / 2 >= lot.x0 && u.x + u.w / 2 <= lot.x1, 'unit inside the roof in x');
    assert.ok(u.z - u.d / 2 >= lot.z0 && u.z + u.d / 2 <= lot.z1, 'unit inside the roof in z');
  }
  const tiny = clampTaipeiRooftopGear(
    { waterTowers: [], hvacUnits: [{ x: 1, y: 9, z: 1, w: 2.4, h: 2.4, d: 2.4 }] },
    { x0: 0, x1: 3.2, z0: 0, z1: 12 });
  assert.equal(tiny.hvacUnits.length, 0, 'units dropped when the roof is too narrow');
});

// Issue #55: the F7 arcade massing is real geometry data — the ground
// storey core is inset the full arcade depth on every side, and columns
// stand at the lot's front edge on the facade's own bay grid, covering
// every side's full frontage (lots know no street side, so the arcade
// runs the full perimeter — see taipeiArcadeParts' note).
test('arcade parts: recessed core and full-perimeter colonnade', (t) => {
  const lot = { x0: 0, x1: 20, z0: 0, z1: 16, h: 22, mat: 7 };
  const parts = taipeiArcadeParts(lot);
  assert.ok(parts, 'a 20x16 m lot gets an arcade');
  assert.equal(parts.depth, TAIPEI_ARCADE_DEPTH);
  assert.deepEqual(parts.core, { x0: 3.6, x1: 16.4, z0: 3.6, z1: 12.4 }, 'core inset 3.6 m on every side');
  const C = 0.55;
  const inLot = (c) => c.x0 >= lot.x0 - 1e-9 && c.x1 <= lot.x1 + 1e-9 && c.z0 >= lot.z0 - 1e-9 && c.z1 <= lot.z1 + 1e-9;
  const overlaps = (a, b) => a.x0 < b.x1 - 1e-9 && a.x1 > b.x0 + 1e-9 && a.z0 < b.z1 - 1e-9 && a.z1 > b.z0 + 1e-9;
  for (const c of parts.columns) {
    assert.ok(inLot(c), 'every column stands inside the lot');
    assert.ok(!overlaps(c, parts.core), 'no column intersects the recessed core');
    // Every column touches at least one lot edge with its outer face.
    const flush = Math.abs(c.x0 - lot.x0) < 1e-9 || Math.abs(c.x1 - lot.x1) < 1e-9
      || Math.abs(c.z0 - lot.z0) < 1e-9 || Math.abs(c.z1 - lot.z1) < 1e-9;
    assert.ok(flush, 'every column is flush with a front edge');
    assert.ok(Math.abs((c.x1 - c.x0) - C) < 1e-9, 'columns are 0.55 m square');
    assert.ok(Math.abs((c.z1 - c.z0) - C) < 1e-9, 'columns are 0.55 m square');
  }
  for (let i = 0; i < parts.columns.length; i++) {
    for (let j = i + 1; j < parts.columns.length; j++) {
      assert.ok(!overlaps(parts.columns[i], parts.columns[j]), 'columns never overlap each other');
    }
  }
  // Full frontage: along each side the columns run corner to corner on
  // the facade bay grid — consecutive column CENTRES sit one grid step
  // apart: a bay step (bayW = inner/bays, bays rounded to the 2.7 m
  // target, so ≤ ~3.2 m) or, from a corner column, the 0.85 m corner
  // pier plus a bay step (≤ ~3.7 m).
  const sides = [
    parts.columns.filter((c) => Math.abs(c.z0 - lot.z0) < 1e-9).map((c) => [c.x0, c.x1]).sort((a, b) => a[0] - b[0]),
    parts.columns.filter((c) => Math.abs(c.z1 - lot.z1) < 1e-9).map((c) => [c.x0, c.x1]).sort((a, b) => a[0] - b[0]),
    parts.columns.filter((c) => Math.abs(c.x0 - lot.x0) < 1e-9).map((c) => [c.z0, c.z1]).sort((a, b) => a[0] - b[0]),
    parts.columns.filter((c) => Math.abs(c.x1 - lot.x1) < 1e-9).map((c) => [c.z0, c.z1]).sort((a, b) => a[0] - b[0]),
  ];
  const lens = [20, 20, 16, 16];
  sides.forEach((spans, si) => {
    assert.ok(spans.length >= 4, `side ${si} has a real colonnade (${spans.length} columns)`);
    assert.ok(spans[0][0] <= 0.001, `side ${si} starts at the corner`);
    assert.ok(spans[spans.length - 1][1] >= lens[si] - 0.001, `side ${si} ends at the corner`);
    const centres = spans.map(([a, b]) => (a + b) / 2);
    for (let k = 1; k < centres.length; k++) {
      assert.ok(centres[k] - centres[k - 1] <= 3.7, `side ${si} column spacing ${k} on the bay grid`);
    }
  });
  t.diagnostic(`20x16 m lot: ${parts.columns.length} columns`);
  // Too-small lots keep the flat facade.
  assert.equal(taipeiArcadeParts({ x0: 0, x1: 9, z0: 0, z1: 14, h: 18, mat: 7 }), null, 'narrow lot: no arcade');
  assert.equal(taipeiArcadeParts({ x0: 0, x1: 12, z0: 0, z1: 10.5, h: 18, mat: 7 }), null, 'shallow lot: no arcade');
  // Determinism: the same lot always yields the same massing.
  assert.deepEqual(taipeiArcadeParts(lot), parts, 'arcade parts are deterministic');

  // On the real plan: most F7 lots carry the arcade, and the colonnade
  // total stays in the stated budget (~24 facade-box instances per lot).
  const opts = taipeiCityBlocksOptions(TAIPEI_GEO, planTaipeiBuildings(TAIPEI_GEO));
  const f7 = opts.lots.filter((l) => l.mat === 7);
  const withArcade = f7.filter((l) => l.arcade);
  assert.ok(withArcade.length / f7.length > 0.8, `most F7 lots carry the arcade (${withArcade.length}/${f7.length})`);
  const totalCols = withArcade.reduce((s, l) => s + l.arcade.columns.length, 0);
  assert.ok(totalCols / withArcade.length < 30, `columns per arcade lot sane (${(totalCols / withArcade.length).toFixed(1)})`);
  t.diagnostic(`F7 lots ${f7.length}, with arcade ${withArcade.length}, total columns ${totalCols}`);
});

// Issue #56: vertical signs are planner policy on Taiwan-type lots —
// a deterministic ~55% subset, 1–2 panels each, always above the
// ground floor and below the roofline (panel colours are hashed
// in-shader from the photo palette; the policy pins placement only).
test('vertical signs: sparse deterministic panels on Taiwan types', (t) => {
  const opts = taipeiCityBlocksOptions(TAIPEI_GEO, planTaipeiBuildings(TAIPEI_GEO));
  const taiwan = opts.lots.filter((l) => l.mat >= 6 && l.h >= 10);
  const signed = taiwan.filter((l) => l.signs && l.signs.length);
  const share = signed.length / taiwan.length;
  assert.ok(share > 0.35 && share < 0.75, `signed share of Taiwan lots plausible (${signed.length}/${taiwan.length})`);
  assert.ok(opts.lots.every((l) => l.mat >= 6 || !l.signs), 'no signs on glass or masonry lots');
  let total = 0;
  for (const l of signed) {
    assert.ok(l.signs.length >= 1 && l.signs.length <= 2, 'one or two panels per building');
    const sides = new Set(l.signs.map((s) => s.side));
    assert.equal(sides.size, l.signs.length, 'two-panel buildings use two different sides');
    for (const s of l.signs) {
      total++;
      assert.ok(['n', 's', 'e', 'w'].includes(s.side), 'sign side is a facade side');
      assert.ok(s.y0 >= 3.9, 'sign base clears the ground floor');
      assert.ok(s.y0 + s.h <= l.h - 0.2, 'sign stays below the roofline');
      assert.ok(s.out >= 0.9 && s.out <= 1.45, 'protrusion in the photo range');
    }
  }
  t.diagnostic(`signed Taiwan lots ${signed.length}/${taiwan.length}, total panels ${total}`);
  const sample = signed[0];
  assert.deepEqual(taipeiVerticalSigns(sample), sample.signs, 'sign policy is deterministic per lot');
  assert.deepEqual(taipeiVerticalSigns({ x0: 0, x1: 20, z0: 0, z1: 16, h: 22, mat: 4 }), [], 'glass lots never sign');
});

// Issue #56: rooftop furniture — stainless tanks and 鐵皮屋 additions
// are sparse, deterministic, fitted to the roof, and never land on
// glass towers. Rates are measured over thousands of synthetic lots so
// the bands pin the POLICY (14% / 12% rolls plus fitting losses), not
// one plan's luck.
test('rooftop additions: sparse fitted tanks and sheet-metal huts', (t) => {
  let lots = 0, tanks = 0, huts = 0;
  const overlaps = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
  for (let i = 0; i < 4000; i++) {
    const lot = { x0: i * 37.3, x1: i * 37.3 + 18, z0: (i % 61) * 29.7, z1: (i % 61) * 29.7 + 15, h: 20, mat: 6 };
    const gear = { maxH: 20.7, waterTowers: [], hvacUnits: [{ x: lot.x0 + 9, y: 20.7, z: lot.z0 + 7.5, w: 3, h: 2, d: 3 }] };
    const adds = taipeiRooftopAdditions(gear, lot, gear.hvacUnits);
    lots++;
    const hvacRect = { x0: lot.x0 + 7.5, x1: lot.x0 + 10.5, z0: lot.z0 + 6, z1: lot.z0 + 9 };
    for (const tk of adds.tanks) {
      tanks++;
      assert.ok(tk.x - 1 >= lot.x0 && tk.x + 1 <= lot.x1 && tk.z - 1 >= lot.z0 && tk.z + 1 <= lot.z1, 'tank footprint inside the roof');
      assert.ok(!overlaps({ x0: tk.x - 1, x1: tk.x + 1, z0: tk.z - 1, z1: tk.z + 1 }, hvacRect), 'tank clears the HVAC unit');
      assert.equal(tk.y, 20.7, 'tank stands on the roof (gear maxH)');
    }
    for (const hu of adds.huts) {
      huts++;
      const r = { x0: hu.x - hu.w / 2, x1: hu.x + hu.w / 2, z0: hu.z - hu.d / 2, z1: hu.z + hu.d / 2 };
      assert.ok(r.x0 >= lot.x0 && r.x1 <= lot.x1 && r.z0 >= lot.z0 && r.z1 <= lot.z1, 'hut fits inside the roof');
      assert.ok(!overlaps(r, hvacRect), 'hut clears the HVAC unit');
      assert.ok(hu.h >= 2.4 && hu.h <= 3.2 && hu.pitch >= 0.15 && hu.pitch <= 0.25, 'hut proportions in range');
      for (const tk of adds.tanks) {
        assert.ok(!overlaps(r, { x0: tk.x - 1, x1: tk.x + 1, z0: tk.z - 1, z1: tk.z + 1 }), 'hut and tank never share a spot');
      }
    }
    if (i === 0) {
      assert.deepEqual(taipeiRooftopAdditions(gear, lot, gear.hvacUnits), adds, 'additions are deterministic per lot');
    }
  }
  const tankRate = tanks / lots, hutRate = huts / lots;
  t.diagnostic(`synthetic rates: tanks ${(tankRate * 100).toFixed(1)}%, huts ${(hutRate * 100).toFixed(1)}%`);
  assert.ok(tankRate > 0.06 && tankRate < 0.24, `tank rate sparse (${tankRate.toFixed(3)})`);
  assert.ok(hutRate > 0.05 && hutRate < 0.2, `hut rate sparse (${hutRate.toFixed(3)})`);
  // Glass towers and out-of-band lots never get furniture.
  for (let i = 0; i < 200; i++) {
    const base = { x0: i * 41.1, x1: i * 41.1 + 18, z0: i * 13.7, z1: i * 13.7 + 15 };
    assert.deepEqual(taipeiRooftopAdditions({ maxH: 20 }, { ...base, h: 20, mat: 4 }, []).tanks, [], 'no tanks on glass');
    assert.deepEqual(taipeiRooftopAdditions({ maxH: 20 }, { ...base, h: 20, mat: 5 }, []).huts, [], 'no huts on glass');
    assert.deepEqual(taipeiRooftopAdditions({ maxH: 45 }, { ...base, h: 45, mat: 6 }, []).huts, [], 'no huts on tall lots');
  }
});
