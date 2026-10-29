import assert from 'node:assert/strict';
import test from 'node:test';

import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { planTaipeiBuildings } from '../js/taipei-buildings.js';
import {
  planParkTrees, planStreetTrees, pointInRing, ringArea,
  buildSegmentGrid, distToSegment, PARK_TREE_VARIANTS,
} from '../js/taipei-streetscape.js';
import {
  planParkAmenities, AMENITY_CAPS,
  VENDING_MIN_AREA, RESTROOM_MIN_AREA, SCULPTURE_MIN_AREA, FOUNTAIN_MIN_AREA,
} from '../js/taipei-park-amenities.js';

// Issue #222 — park amenity dressing. The planner is pure, so the
// census, the determinism contract and the placement invariants
// (inside a park, off paths/water/roads/lots, per-park caps) are
// pinned here against the real tile; the renderer only instances
// what the planner emits.

const plan = planTaipeiBuildings(TAIPEI_GEO);
const NON_CARRIAGEWAY = new Set(['footway', 'path', 'steps', 'pedestrian', 'cycleway', 'corridor', 'elevator', 'crossing', 'platform', 'traffic_island']);
const isPlazaName = (name) => (name || '').includes('廣場');

test('amenity census: the shipped totals are pinned', () => {
  const { items, stats } = planParkAmenities(TAIPEI_GEO, plan);
  const counts = Object.fromEntries(Object.entries(items).map(([k, v]) => [k, v.length]));
  // Measured at the #222 implementation on main 5e893bc1: 461 of
  // 1,575 non-plaza parks carry a mapped interior path and are
  // dressed; 1,114 pathless parks receive trees only (the census
  // comment on issue #222 has the full table).
  // Re-pinned at the #236 gate for tree composition: identical code
  // on the PR-base tree reproduces 19,428 exactly, so the +3 here
  // (bush +2, lamp +1, pure additions, zero removals) is the
  // #221/#213 plan change freeing three furniture spots where
  // lots used to stand — not the amenity planner.
  assert.deepEqual(counts, {
    bench: 4132, lamp: 3792, bin: 2332, vending: 300,
    restroom: 81, sculpture: 18, fountain: 12, bush: 8764,
  });
  assert.equal(Object.values(counts).reduce((s, v) => s + v, 0), 19431, 'grand total');
  assert.equal(stats.parksTotal, 1600);
  assert.equal(stats.parksPlaza, 25);
  assert.equal(stats.parksPathless, 1114);
  assert.equal(stats.parksDressed, 461);
  assert.deepEqual(
    Object.fromEntries(Object.entries(stats.byClass).map(([k, v]) => [k, v.items])),
    // +1 in each class at the #236 gate: the same three freed spots, one per class.
    { large: 9602, medium: 7988, small: 1806, tiny: 35 },
    'items by area class',
  );
  // Every park eligible for a restroom got one (81 of 81).
  assert.equal(stats.skipped.restroom, 0);
  // The type site reads fully dressed.
  const daan = stats.topParks.find((p) => p.name === '大安森林公園');
  assert.deepEqual(daan.counts, {
    bench: 64, lamp: 48, bin: 28, vending: 3,
    restroom: 1, sculpture: 0, fountain: 1, bush: 260,
  });
});

test('amenity plan is deterministic', () => {
  const a = planParkAmenities(TAIPEI_GEO, plan);
  const b = planParkAmenities(TAIPEI_GEO, plan);
  assert.equal(JSON.stringify(a.items), JSON.stringify(b.items), 'identical inputs plan identical furniture');
});

test('placement invariants: inside a park, off water and off paths', () => {
  const { items } = planParkAmenities(TAIPEI_GEO, plan);
  // Park lookup by 100 m grid over park bboxes.
  const parkGrid = new Map();
  const pk = (cx, cz) => `${cx},${cz}`;
  for (const p of TAIPEI_GEO.parks) {
    if (isPlazaName(p.name)) continue;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < p.ring.length; i += 2) {
      minX = Math.min(minX, p.ring[i]); maxX = Math.max(maxX, p.ring[i]);
      minZ = Math.min(minZ, p.ring[i + 1]); maxZ = Math.max(maxZ, p.ring[i + 1]);
    }
    for (let cx = Math.floor(minX / 100); cx <= Math.floor(maxX / 100); cx++) {
      for (let cz = Math.floor(minZ / 100); cz <= Math.floor(maxZ / 100); cz++) {
        const k = pk(cx, cz);
        if (!parkGrid.has(k)) parkGrid.set(k, []);
        parkGrid.get(k).push(p.ring);
      }
    }
  }
  const inAnyPark = (x, z) => (parkGrid.get(pk(Math.floor(x / 100), Math.floor(z / 100))) || []).some((r) => pointInRing(x, z, r));
  const waterBB = TAIPEI_GEO.water.map((w) => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < w.ring.length; i += 2) {
      minX = Math.min(minX, w.ring[i]); maxX = Math.max(maxX, w.ring[i]);
      minZ = Math.min(minZ, w.ring[i + 1]); maxZ = Math.max(maxZ, w.ring[i + 1]);
    }
    return { ring: w.ring, minX, maxX, minZ, maxZ };
  });
  const inWater = (x, z) => waterBB.some((w) => x >= w.minX && x <= w.maxX && z >= w.minZ && z <= w.maxZ && pointInRing(x, z, w.ring));
  const pathWays = TAIPEI_GEO.roads.filter((r) => NON_CARRIAGEWAY.has(r.highway));
  const pathGrid = buildSegmentGrid(pathWays, 8);
  // The planner's own clearance radius per kit class.
  const radius = { bench: 0.55, lamp: 0.3, bin: 0.35, vending: 0.62, restroom: 3.6, sculpture: 2.2, fountain: 0.8, bush: 0.55 };
  let checked = 0;
  for (const [kind, list] of Object.entries(items)) {
    for (const it of list) {
      assert.ok(inAnyPark(it.x, it.z), `${kind} inside a park (${it.x}, ${it.z})`);
      assert.ok(!inWater(it.x, it.z), `${kind} out of water (${it.x}, ${it.z})`);
      let clear = Infinity;
      for (const s of pathGrid.near(it.x, it.z)) {
        clear = Math.min(clear, distToSegment(it.x, it.z, s.ax, s.az, s.bx, s.bz) - s.half);
      }
      assert.ok(clear >= radius[kind] - 0.02, `${kind} keeps its path clearance (${clear.toFixed(2)} m at ${it.x}, ${it.z})`);
      checked++;
    }
  }
  assert.equal(checked, 19431);
});

test('eligibility rules: big-ticket items only in big enough parks', () => {
  const { items } = planParkAmenities(TAIPEI_GEO, plan);
  const bigEnough = (minArea) => new Set(
    TAIPEI_GEO.parks.filter((p) => !isPlazaName(p.name) && ringArea(p.ring) >= minArea).map((p) => p.name || ''),
  );
  const restroomParks = bigEnough(RESTROOM_MIN_AREA);
  const sculptureParks = bigEnough(SCULPTURE_MIN_AREA);
  const fountainParks = bigEnough(FOUNTAIN_MIN_AREA);
  const vendingParks = bigEnough(VENDING_MIN_AREA);
  for (const it of items.restroom) assert.ok(restroomParks.has(it.park), `restroom in a >= ${RESTROOM_MIN_AREA} m2 park (${it.park})`);
  for (const it of items.sculpture) assert.ok(sculptureParks.has(it.park), `sculpture in a large park (${it.park})`);
  for (const it of items.fountain) assert.ok(fountainParks.has(it.park), `fountain only in a >= ${FOUNTAIN_MIN_AREA} m2 park (${it.park})`);
  for (const it of items.vending) {
    assert.ok(vendingParks.has(it.park), `vending in a >= ${VENDING_MIN_AREA} m2 park (${it.park})`);
    assert.ok(it.tint >= 0 && it.tint <= 3, 'vending tint in range');
  }
  for (const it of items.sculpture) assert.ok(it.form >= 0 && it.form <= 2, 'sculpture form in range');
  // At most one fountain per park polygon name-set is enforced by
  // the planner per polygon; tile-wide the count stays rare.
  assert.ok(items.fountain.length <= 22, 'fountains stay rare');
});

test('per-park caps hold at the top of the table', () => {
  const { stats } = planParkAmenities(TAIPEI_GEO, plan);
  const capSum = (cls) => AMENITY_CAPS.bench[cls] + AMENITY_CAPS.lamp[cls] + AMENITY_CAPS.bin[cls] + AMENITY_CAPS.bush[cls] + 6 + 1 + 1 + 1;
  for (const p of stats.topParks) {
    for (const k of ['bench', 'lamp', 'bin', 'bush']) {
      assert.ok(p.counts[k] <= AMENITY_CAPS[k][p.cls], `${p.name}: ${k} within the ${p.cls} cap`);
    }
    assert.ok(p.items <= capSum(p.cls), `${p.name}: total within the summed caps`);
    assert.ok(p.counts.vending <= 6 && p.counts.restroom <= 1 && p.counts.fountain <= 1, `${p.name}: singleton rules`);
  }
});

test('synthetic: a pathless park gets nothing, a pathed park dresses', () => {
  const ring = [-100, -100, 100, -100, 100, 100, -100, 100, -100, -100];
  const geo = {
    parks: [
      { name: 'Pathed Park', ring },
      { name: 'Bare Park', ring: ring.map((v) => v + 1000) },
    ],
    roads: [{ highway: 'footway', width: 3, pts: [-140, 0, 140, 0] }],
    roadbeds: [],
    water: [],
  };
  const emptyPlan = { lots: [], tower: null, landmarkTowers: [] };
  const { items, stats } = planParkAmenities(geo, emptyPlan);
  assert.equal(stats.parksPathless, 1);
  assert.equal(stats.parksDressed, 1);
  assert.ok(items.bench.length > 0 && items.lamp.length > 0 && items.bush.length > 0, 'path-anchored kit placed');
  assert.ok(items.restroom.length === 1, 'a 40,000 m2 park gets its restroom block');
  assert.ok(items.vending.length >= 2, 'entrance vending cluster placed');
  for (const list of Object.values(items)) {
    for (const it of list) assert.ok(Math.abs(it.x) <= 100 && Math.abs(it.z) <= 100, 'nothing in the pathless park');
  }
});

test('park trees carry seeded canopy variants; street trees do not', () => {
  const parkPlan = planParkTrees(TAIPEI_GEO, plan);
  assert.ok(parkPlan.trees.length > 3000, 'park planting exists');
  const dist = {};
  for (const t of parkPlan.trees) {
    assert.ok(PARK_TREE_VARIANTS.includes(t.variant), `variant is a known canopy (${t.variant})`);
    if (t.variant === 'blossom') assert.ok(['pink', 'white', 'gold'].includes(t.tone), `blossom tone is known (${t.tone})`);
    dist[t.variant] = (dist[t.variant] || 0) + 1;
  }
  // The hash bands (36/18/18/18/10, issue #245) after cap thinning:
  // banyan is the plurality, every variant is a real share; blossom
  // is the deliberate minority (10% band, measured 9.3% on main).
  const n = parkPlan.trees.length;
  assert.ok(dist.banyan > dist.palm && dist.banyan > dist.conifer && dist.banyan > dist.round, 'banyan plurality');
  for (const v of ['banyan', 'palm', 'conifer', 'round']) {
    assert.ok(dist[v] / n >= 0.12 && dist[v] / n <= 0.48, `${v} share in band (${(dist[v] / n).toFixed(2)})`);
  }
  assert.ok(dist.blossom / n >= 0.06 && dist.blossom / n <= 0.16, `blossom share in band (${(dist.blossom / n).toFixed(2)})`);
  const streetPlan = planStreetTrees(TAIPEI_GEO, plan);
  assert.ok(streetPlan.trees.every((t) => t.variant === undefined), 'street trees keep the single original look');
});

test('issue #245: groves cluster the planting, heroes stand taller', () => {
  // Grove census, pinned with the clustering parameters in the
  // comment: grove discs 0.09–0.18 × sqrt(area), acceptance up to
  // ~2.3x at the centre and halved on the lawn between, 5% hero
  // roll inside groves at 1.9–2.4x. Measured on main: 1,016 grove
  // discs, 123 kept heroes; Da-an keeps 5 groves.
  const parkPlan = planParkTrees(TAIPEI_GEO, plan);
  assert.ok(parkPlan.stats.groves >= 800, `grove discs seeded (${parkPlan.stats.groves})`);
  assert.ok(parkPlan.stats.heroes >= 50, `hero trees kept (${parkPlan.stats.heroes})`);
  const heroes = parkPlan.trees.filter((t) => t.hero);
  assert.ok(heroes.length > 0 && heroes.every((t) => t.scale >= 1.9 && t.scale <= 2.4), 'heroes are clearly bigger');
  assert.ok(parkPlan.trees.some((t) => t.scale <= 0.75), 'the small end survives');
  assert.ok(Math.max(...parkPlan.trees.map((t) => t.scale)) >= 1.9, 'max scale reaches hero band');
  // Clustering, measured two ways on main (baseline in the
  // comment: the pre-#245 jittered grid). Capped plan, Da-an:
  // 19.5% of trees have a neighbour within 12 m (was 7.0%).
  // Unthinned plan, Da-an: 25 m-cell variance/mean 1.44 (was
  // 1.06, i.e. uniform) with 54 empty cells (was 26) — lawn.
  const daan = parkPlan.trees.filter((t) => t.park === '大安森林公園');
  let near = 0;
  for (let i = 0; i < daan.length; i++) {
    for (let j = 0; j < daan.length; j++) {
      if (i !== j && Math.hypot(daan[i].x - daan[j].x, daan[i].z - daan[j].z) <= 12) { near++; break; }
    }
  }
  assert.ok(near / daan.length >= 0.15, `Da-an trees clump (${(100 * near / daan.length).toFixed(1)}% with a neighbour in 12 m)`);
  const unthinned = planParkTrees(TAIPEI_GEO, plan, { cap: Number.MAX_SAFE_INTEGER });
  const pts = unthinned.trees.filter((t) => t.park === '大安森林公園');
  const park = TAIPEI_GEO.parks.find((p) => p.name === '大安森林公園');
  const ring = park.ring;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    minX = Math.min(minX, ring[i]); maxX = Math.max(maxX, ring[i]);
    minZ = Math.min(minZ, ring[i + 1]); maxZ = Math.max(maxZ, ring[i + 1]);
  }
  const cells = new Map();
  for (const t of pts) {
    const k = Math.floor(t.x / 25) + ',' + Math.floor(t.z / 25);
    cells.set(k, (cells.get(k) || 0) + 1);
  }
  const counts = [];
  for (let gx = Math.floor(minX / 25); gx <= Math.floor(maxX / 25); gx++) {
    for (let gz = Math.floor(minZ / 25); gz <= Math.floor(maxZ / 25); gz++) {
      if (pointInRing((gx + 0.5) * 25, (gz + 0.5) * 25, ring)) counts.push(cells.get(gx + ',' + gz) || 0);
    }
  }
  const mean = counts.reduce((s, v) => s + v, 0) / counts.length;
  const vari = counts.reduce((s, v) => s + (v - mean) ** 2, 0) / counts.length;
  assert.ok(vari / mean >= 1.25, `unthinned Da-an planting is clumped (var/mean ${(vari / mean).toFixed(2)})`);
});

test('issue #245: grove planting is deterministic, groves included', () => {
  const a = planParkTrees(TAIPEI_GEO, plan);
  const b = planParkTrees(TAIPEI_GEO, plan);
  assert.deepEqual(
    a.trees.map((t) => [t.x, t.z, t.scale, t.variant, t.tone || '', !!t.hero]),
    b.trees.map((t) => [t.x, t.z, t.scale, t.variant, t.tone || '', !!t.hero]),
    'identical inputs plant identical groves, heroes and tones',
  );
  assert.equal(a.stats.groves, b.stats.groves, 'grove census is deterministic');
});
