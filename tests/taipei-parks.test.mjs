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
  PLAYGROUND_MIN_AREA, PICNIC_MIN_AREA, COURT_MIN_AREA, PAVILION_MIN_AREA,
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
  // Re-pinned at the #246 implementation on main 49283187: the
  // mapped pads claim ground first, so a few furniture spots
  // under mapped pads are lost (bench −30, lamp −7, bin −8,
  // bush −61 — pure removals where a pad covers the spot, zero
  // other movement: the #222 skipped counts below are unchanged)
  // and the seeded kits add 146 gap-fillers. Mapped 341 of 489
  // shipped entries place; 148 skip (hard conflicts, a path
  // through the equipment core, or SAT overlap with a neighbour
  // mapped pad). parksMapped 147, parksSeeded246 120.
  assert.deepEqual(counts, {
    bench: 4102, lamp: 3785, bin: 2324, vending: 300,
    restroom: 81, sculpture: 18, fountain: 12, bush: 8704,
    playground: 133, picnic: 78, court: 90, pavilion: 184,
  });
  assert.equal(Object.values(counts).reduce((s, v) => s + v, 0), 19811, 'grand total');
  assert.equal(stats.parksTotal, 1600);
  assert.equal(stats.parksPlaza, 25);
  assert.equal(stats.parksPathless, 1114);
  assert.equal(stats.parksDressed, 461);
  assert.equal(stats.parksMapped, 146);
  assert.equal(stats.parksSeeded246, 119);
  assert.deepEqual(stats.kits246.mapped, { playground: 63, picnic: 17, court: 81, pavilion: 179 });
  assert.deepEqual(stats.kits246.seeded, { playground: 70, picnic: 61, court: 9, pavilion: 5 });
  assert.deepEqual(stats.kits246.mappedSkipped, { playground: 62, picnic: 1, court: 49, pavilion: 37 });
  assert.equal(stats.kits246.mappedOrphan, 0, 'every shipped entry joins a park ring');
  assert.deepEqual(
    Object.fromEntries(Object.entries(stats.byClass).map(([k, v]) => [k, v.items])),
    // +138 large / +194 medium / +46 small / +3 tiny vs #236.
    { large: 9740, medium: 8181, small: 1852, tiny: 38 },
    'items by area class',
  );
  // Every park eligible for a restroom got one (81 of 81).
  assert.equal(stats.skipped.restroom, 0);
  // The type site reads fully dressed.
  const daan = stats.topParks.find((p) => p.name === '大安森林公園');
  assert.deepEqual(daan.counts, {
    bench: 64, lamp: 48, bin: 28, vending: 3,
    restroom: 1, sculpture: 0, fountain: 1, bush: 260,
    playground: 0, picnic: 0, court: 0, pavilion: 9,
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
  const NEW_KINDS = new Set(['playground', 'picnic', 'court', 'pavilion']);
  let checked = 0;
  for (const [kind, list] of Object.entries(items)) {
    if (NEW_KINDS.has(kind)) continue; // rect kits: the rect loop below.
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
  assert.equal(checked, 19326);
});

test('placement invariants, rect kits: pads inside a park, off water and carriageways, cores off paths', () => {
  const { items } = planParkAmenities(TAIPEI_GEO, plan);
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
  const bedGrid = buildSegmentGrid(TAIPEI_GEO.roadbeds || [], 20);
  // Kit pad sizes (the derive step's fixed pads / the seeded rects).
  const dims = (it) => it.kind === 'playground' ? [14, 11]
    : it.kind === 'picnic' ? [2.4, 1.8]
    : it.kind === 'pavilion' ? [8, 8]
    : it.sport === 'basketball' ? [30, 17] : [28, 14];
  const samples = (it, hw, hd) => {
    const c = Math.cos(it.rot), s = Math.sin(it.rot);
    const toW = (lx, lz) => [it.x + lx * c + lz * s, it.z - lx * s + lz * c];
    const pts = [[0, 0]];
    for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd], [0, -hd], [0, hd], [-hw, 0], [hw, 0]]) pts.push([lx, lz]);
    return pts.map(([lx, lz]) => toW(lx, lz));
  };
  let checked = 0;
  for (const kind of ['playground', 'picnic', 'court', 'pavilion']) {
    for (const it of items[kind]) {
      const [w, d] = dims({ ...it, kind });
      const hw = w / 2, hd = d / 2;
      for (const [x, z] of samples(it, hw, hd)) {
        assert.ok(inAnyPark(x, z), `${kind} pad inside a park (${x.toFixed(1)}, ${z.toFixed(1)} from ${it.x}, ${it.z})`);
        assert.ok(!inWater(x, z), `${kind} pad out of water (${x.toFixed(1)}, ${z.toFixed(1)})`);
        let bedClear = Infinity;
        for (const s of bedGrid.near(x, z)) bedClear = Math.min(bedClear, distToSegment(x, z, s.ax, s.az, s.bx, s.bz) - s.half);
        assert.ok(bedClear >= 0.6 - 0.02, `${kind} pad off carriageways (${bedClear.toFixed(2)} m)`);
      }
      // Courts and playgrounds: no path through the equipment
      // core (pad shrunk 1.5 m). Pavilions/picnic are exempt by
      // design — path-adjacent, and a path under a pavilion
      // roof reads true.
      if (kind === 'court' || kind === 'playground') {
        const shrink = Math.min(1.5, Math.max(0, Math.min(hw, hd) - 0.3));
        let pathClear = Infinity;
        for (const [x, z] of samples(it, Math.max(hw - shrink, 0.3), Math.max(hd - shrink, 0.3))) {
          for (const s of pathGrid.near(x, z)) pathClear = Math.min(pathClear, distToSegment(x, z, s.ax, s.az, s.bx, s.bz) - s.half);
        }
        assert.ok(pathClear >= 0.6 - 0.02, `${kind} core off paths (${pathClear.toFixed(2)} m at ${it.x}, ${it.z})`);
      }
      checked++;
    }
  }
  assert.equal(checked, 133 + 78 + 90 + 184, 'all four rect kits checked');
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
  // Issue #246: every rect kit names its source; courts name
  // their sport. Seeded kits honour the area floors (mapped
  // kits are ground truth and carry no floor).
  const areaByName = new Map();
  for (const p of TAIPEI_GEO.parks) {
    if (isPlazaName(p.name)) continue;
    const a = ringArea(p.ring);
    const n = p.name || '';
    if (!areaByName.has(n) || a > areaByName.get(n)) areaByName.set(n, a);
  }
  for (const kind of ['playground', 'picnic', 'court', 'pavilion']) {
    for (const it of items[kind]) {
      assert.ok(it.src === 'mapped' || it.src === 'seeded', `${kind} src is mapped/seeded (${it.src})`);
      assert.ok(Number.isFinite(it.rot), `${kind} rot is finite`);
      if (kind === 'court') assert.ok(it.sport === 'basketball' || it.sport === 'tennis', `court sport (${it.sport})`);
      if (it.src === 'seeded') {
        const min = kind === 'playground' ? PLAYGROUND_MIN_AREA : kind === 'picnic' ? PICNIC_MIN_AREA : kind === 'court' ? COURT_MIN_AREA : PAVILION_MIN_AREA;
        assert.ok((areaByName.get(it.park) || 0) >= min, `seeded ${kind} in a >= ${min} m2 park (${it.park})`);
      }
    }
  }
  // No seeded court or pavilion in a small/tiny park at all
  // (seeded floors are large-only; mapped ground truth may sit
  // in a smaller park, and does — 16 mapped courts in small parks).
  for (const it of items.court) {
    if (it.src === 'seeded') assert.ok((areaByName.get(it.park) || 0) >= 40000, 'seeded court in a large park');
  }
  for (const it of items.pavilion) {
    if (it.src === 'seeded') assert.ok((areaByName.get(it.park) || 0) >= 40000, 'seeded pavilion in a large park');
  }
});

test('per-park caps hold at the top of the table', () => {
  const { stats } = planParkAmenities(TAIPEI_GEO, plan);
  const capSum = (cls) => AMENITY_CAPS.bench[cls] + AMENITY_CAPS.lamp[cls] + AMENITY_CAPS.bin[cls] + AMENITY_CAPS.bush[cls] + 6 + 1 + 1 + 1;
  for (const p of stats.topParks) {
    for (const k of ['bench', 'lamp', 'bin', 'bush']) {
      assert.ok(p.counts[k] <= AMENITY_CAPS[k][p.cls], `${p.name}: ${k} within the ${p.cls} cap`);
    }
    // The #222 furniture subtotal still honours the summed caps;
    // the #246 kits sit outside it — mapped kits are uncapped
    // ground truth (美堤 carries 10 mapped courts) and seeded
    // kits are capped per polygon by construction (3/2/0/0).
    const oldKinds = p.items - (p.counts.playground + p.counts.picnic + p.counts.court + p.counts.pavilion);
    assert.ok(oldKinds <= capSum(p.cls), `${p.name}: #222 subtotal within the summed caps`);
    assert.ok(p.counts.vending <= 6 && p.counts.restroom <= 1 && p.counts.fountain <= 1, `${p.name}: singleton rules`);
    assert.ok(p.counts.playground + p.counts.picnic + p.counts.court + p.counts.pavilion <= 15, `${p.name}: #246 kits stay bounded`);
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

test('synthetic: mapped parkSports entries place verbatim, in pathless parks too', () => {
  const ring = [-100, -100, 100, -100, 100, 100, -100, 100, -100, -100];
  const geo = {
    parks: [{ name: 'Mapped Park', ring }],
    roads: [],
    roadbeds: [],
    water: [],
    parkSports: [
      { kind: 'playground', x: 0, z: -60, rot: 0, w: 14, d: 11, sport: null, park: 'Mapped Park', src: 'way:1' },
      { kind: 'court', x: 0, z: 60, rot: 0, w: 30, d: 17, sport: 'tennis', park: 'Mapped Park', src: 'way:2' },
      { kind: 'pavilion', x: -60, z: -60, rot: 0, w: 8, d: 8, sport: null, park: 'Mapped Park', src: 'way:3' },
      { kind: 'picnic', x: 60, z: 60, rot: 0, w: 2.4, d: 1.8, sport: null, park: 'Mapped Park', src: 'way:4' },
    ],
  };
  const emptyPlan = { lots: [], tower: null, landmarkTowers: [] };
  const { items, stats } = planParkAmenities(geo, emptyPlan);
  // No path in this park, yet ground truth places: pathless
  // parks get mapped kits (but no #222 furniture).
  assert.equal(stats.parksPathless, 1);
  assert.equal(stats.parksMapped, 1);
  assert.deepEqual(stats.kits246.mapped, { playground: 1, picnic: 1, court: 1, pavilion: 1 });
  assert.deepEqual(stats.kits246.mappedSkipped, { playground: 0, picnic: 0, court: 0, pavilion: 0 });
  assert.equal(items.playground.length, 1);
  assert.deepEqual([items.playground[0].x, items.playground[0].z], [0, -60]);
  assert.equal(items.court[0].sport, 'tennis');
  assert.equal(items.playground[0].src, 'mapped');
});

test('synthetic: a mapped pad the path crosses is skipped, never replaced by a seeded kit', () => {
  const ring = [-60, -60, 60, -60, 60, 60, -60, 60, -60, -60];
  const geo = {
    parks: [{ name: 'Crossed Park', ring }],
    roads: [{ highway: 'footway', width: 3, pts: [-80, 0, 80, 0] }],
    roadbeds: [],
    water: [],
    parkSports: [
      // Court centred on the path: the path runs through the
      // equipment core, so the mapped pad is skipped. The park
      // is 14,400 m2 (medium) so no seeded court can replace it.
      { kind: 'court', x: 0, z: 0, rot: 0, w: 30, d: 17, sport: 'basketball', park: 'Crossed Park', src: 'way:1' },
    ],
  };
  const emptyPlan = { lots: [], tower: null, landmarkTowers: [] };
  const { items, stats } = planParkAmenities(geo, emptyPlan);
  assert.equal(stats.kits246.mapped.court, 0);
  assert.equal(stats.kits246.mappedSkipped.court, 1);
  assert.equal(items.court.length, 0, 'no seeded court replaces the skipped mapped court');
});

test('synthetic: a mapped kit blocks the seeded kit of the same kind', () => {
  const ring = [-100, -100, 100, -100, 100, 100, -100, 100, -100, -100];
  const geo = {
    parks: [{ name: 'Blocked Park', ring }],
    roads: [{ highway: 'footway', width: 3, pts: [-140, 0, 140, 0] }],
    roadbeds: [],
    water: [],
    parkSports: [
      { kind: 'playground', x: 0, z: -60, rot: 0, w: 14, d: 11, sport: null, park: 'Blocked Park', src: 'way:1' },
    ],
  };
  const emptyPlan = { lots: [], tower: null, landmarkTowers: [] };
  const { items, stats } = planParkAmenities(geo, emptyPlan);
  assert.equal(items.playground.length, 1, 'exactly the mapped playground, no seeded second');
  assert.equal(items.playground[0].src, 'mapped');
  assert.equal(stats.kits246.seeded.playground, 0);
});

test('park trees keep out of the kit pads when the pads are passed as exclusions', () => {
  // Issue #246: the boot plans amenities before trees and hands
  // the pad rings to the tree planners through opts.exclusions.
  // Measured without the exclusion: 69 trunks stood inside
  // pads (51 in courts). This pins the contract the boot
  // relies on — one closed ring per placed kit, and the tree
  // planner honouring it.
  const { items, pads } = planParkAmenities(TAIPEI_GEO, plan);
  const kitTotal = items.playground.length + items.picnic.length + items.court.length + items.pavilion.length;
  assert.equal(pads.length, kitTotal, 'one pad ring per placed kit');
  assert.equal(pads.length, 485);
  for (const ring of pads) {
    assert.equal(ring.length, 10, 'closed rect ring (5 points)');
    assert.equal(ring[0], ring[8]);
    assert.equal(ring[1], ring[9]);
  }
  const parkPlan = planParkTrees(TAIPEI_GEO, plan, { exclusions: pads });
  const inPad = (x, z) => pads.some((ring) => pointInRing(x, z, ring));
  const inside = parkPlan.trees.filter((t) => inPad(t.x, t.z));
  assert.equal(inside.length, 0, `no park tree inside a kit pad (first: ${JSON.stringify(inside[0])})`);
  assert.ok(parkPlan.trees.length > 3000, 'the exclusion displaces trees, it does not delete the planting');
});

test('park trees carry seeded canopy variants; street trees do not', () => {
  const parkPlan = planParkTrees(TAIPEI_GEO, plan);
  assert.ok(parkPlan.trees.length > 3000, 'park planting exists');
  const dist = {};
  for (const t of parkPlan.trees) {
    assert.ok(PARK_TREE_VARIANTS.includes(t.variant), `variant is a known canopy (${t.variant})`);
    dist[t.variant] = (dist[t.variant] || 0) + 1;
  }
  // The hash bands (40/18/20/22) after cap thinning: banyan is the
  // plurality, every variant is a real share.
  const n = parkPlan.trees.length;
  assert.ok(dist.banyan > dist.palm && dist.banyan > dist.conifer && dist.banyan > dist.round, 'banyan plurality');
  for (const v of PARK_TREE_VARIANTS) {
    assert.ok(dist[v] / n >= 0.12 && dist[v] / n <= 0.48, `${v} share in band (${(dist[v] / n).toFixed(2)})`);
  }
  const streetPlan = planStreetTrees(TAIPEI_GEO, plan);
  assert.ok(streetPlan.trees.every((t) => t.variant === undefined), 'street trees keep the single original look');
});
