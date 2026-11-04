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
const isPlazaName = (name) => (name || '').includes('廣場') && name !== '松壽廣場'; // Issue #289: 松壽廣場 is a lawn park, not a paved square — exempted, mirroring taipei-surfaces.js.

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
  // Re-pinned for issue #257 (National Taiwan Museum): the
  // museum's site + plaza rects join the planner's hard
  // exclusions, so 18 furniture spots on the terrace, steps and
  // forecourt are removed (6 benches, 1 lamp, 3 bins, 8 bushes —
  // every removed item inside the new rects, proven by the
  // before/after item diff in museum257-evidence/amenity-diff.mjs;
  // zero removals anywhere else) and the per-park caps refill 9
  // of them elsewhere in 228 Peace Memorial Park (6 benches,
  // 1 lamp, 2 bins), for a net bin −1, bush −8.
  // The 9 net removals all sit in the 'large' area class (228
  // Peace Memorial Park): large 9740 → 9731, other classes
  // unchanged.
  // Re-pinned for issue #289 (Songshou Plaza Park): 松壽廣場 is a
  // lawn park, not a paved square, so it leaves the plaza bucket and
  // is dressed like any other medium park — +31 items, all in the
  // medium class, all inside its ring (bench 7, lamp 8, bin 6,
  // vending 1, bush 9, proven by the item diff in
  // xinyi289-evidence/amenity-census.mjs; zero removals anywhere
  // else). parksPlaza 25 -> 24, parksDressed 461 -> 462.
  // Re-pinned for issue #258 (south expansion, probe-round4.mjs):
  // the south's parks (Da'an south tip, Fuyang, Toad Mountain,
  // Gongguan riverside, NTU/Shida grounds) are dressed like the
  // rest of the tile — bench 4,109 -> 4,801, lamp 3,793 -> 4,410,
  // bin 2,329 -> 2,740, vending 301 -> 353, restroom 81 -> 93,
  // sculpture 18 -> 23, fountain 12 -> 15, bush 8,705 -> 10,412,
  // playground 133 -> 159, picnic 78 -> 88, court 90 -> 122,
  // pavilion 184 -> 212; grand total 19,833 -> 23,428.
  assert.deepEqual(counts, {
    bench: 4801, lamp: 4410, bin: 2740, vending: 353,
    restroom: 93, sculpture: 23, fountain: 15, bush: 10412,
    playground: 159, picnic: 88, court: 122, pavilion: 212,
  });
  assert.equal(Object.values(counts).reduce((s, v) => s + v, 0), 23428, 'grand total');
  assert.equal(stats.parksTotal, 2268);
  assert.equal(stats.parksPlaza, 35);
  assert.equal(stats.parksPathless, 1625);
  assert.equal(stats.parksDressed, 608);
  assert.equal(stats.parksMapped, 169);
  assert.equal(stats.parksSeeded246, 140);
  assert.deepEqual(stats.kits246.mapped, { playground: 76, picnic: 17, court: 111, pavilion: 206 });
  assert.deepEqual(stats.kits246.seeded, { playground: 83, picnic: 71, court: 11, pavilion: 6 });
  assert.deepEqual(stats.kits246.mappedSkipped, { playground: 79, picnic: 2, court: 68, pavilion: 40 });
  assert.equal(stats.kits246.mappedOrphan, 0, 'every shipped entry joins a park ring');
  assert.deepEqual(
    Object.fromEntries(Object.entries(stats.byClass).map(([k, v]) => [k, v.items])),
    // +138 large / +194 medium / +46 small / +3 tiny vs #236.
    // −9 large for #257 (see the census re-pin above).
    // +31 medium for #289 (Songshou Plaza Park, see above).
    // Re-pinned for issue #258 (south expansion): large 9,731 ->
    // 12,607, medium 8,212 -> 8,637, small 1,852 -> 2,124, tiny
    // 38 -> 60 — the south's parks dress across all classes.
    { large: 12607, medium: 8637, small: 2124, tiny: 60 },
    'items by area class',
  );
  // Every park eligible for a restroom got one (81 of 81).
  assert.equal(stats.skipped.restroom, 0);
  // The type site reads fully dressed.
  const daan = stats.topParks.find((p) => p.name === '大安森林公園');
  // Re-pinned for issue #258: Da'an Park's ring now extends into
  // its south tip (7-south), and the vending seed lands one fewer
  // (3 -> 2); every other Da'an count is unchanged.
  assert.deepEqual(daan.counts, {
    bench: 64, lamp: 48, bin: 28, vending: 2,
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
  // Re-pinned for issue #258: checked 19,348 -> 22,847 (grand total
  // 23,428 minus the 581 rect-kit items, which the next test checks).
  assert.equal(checked, 22847); // −9 for #257: the museum forecourt spots (see the census re-pin above); +31 for #289: the newly-dressed Songshou Plaza Park (7 benches, 8 lamps, 6 bins, 1 vending machine, 9 bushes — all inside the park, off water and off paths, as this test proves).
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
  // Re-pinned for issue #258: rect kits 133+78+90+184=485 ->
  // 159+88+122+212=581 (the south's parks add playgrounds, picnic
  // sets, courts and pavilions).
  assert.equal(checked, 159 + 88 + 122 + 212, 'all four rect kits checked');
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
  // Re-pinned for issue #258: pads 485 -> 581 (same rect-kit census
  // as the placement-invariants test above).
  assert.equal(pads.length, 581);
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
