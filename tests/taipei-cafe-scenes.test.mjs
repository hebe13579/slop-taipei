import assert from 'node:assert/strict';
import test from 'node:test';

import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { planTaipeiBuildings, facadeMatFor } from '../js/taipei-buildings.js';
import { planStreetTrees, planStreetLamps, distToSegment } from '../js/taipei-streetscape.js';
import { planStreetAmenities } from '../js/taipei-street-amenities.js';
import {
  planCafeScenes, CAFE_SCENE_CAP, CAFE_SCENE_LAYOUT, MENU_BOARD,
  CAFE_MENU_ITEMS, CAFE_MENU_TITLE, drawCafeMenuBoard, menuFaceItems, SCOOTER_VARIANTS,
} from '../js/taipei-cafe-scenes.js';

// Issue #377: sidewalk café / plaza scenes — outdoor tables +
// chairs, a bench, a street tree, a chalkboard A-frame menu board,
// and a line-up of parked scooters in the sidewalk strip in front
// of a shophouse. The planner is pure, so these tests run it
// against synthetic streets and the real tile and pin the
// invariants the renderer relies on — scenes on the sidewalk band
// in front of a retail-led shophouse, never on a carriageway, in a
// lot, in a park, on water, or on a lamp post / tree trunk /
// street-amenity item.

const bed = (name, highway, width, layout, pts, ways = [1]) => ({
  name, highway, width, pedestrianLayout: layout, pts, sourceWayIds: ways,
});
const road = (highway, width, pts) => ({ highway, width, pts });
const geo = (beds, roads = []) => ({ roadbeds: beds, roads, parks: [], water: [] });
const emptyPlan = { lots: [], tower: null, landmarkTowers: [] };

// A synthetic commercial street: a 20 m secondary road along x
// with a 2.2 m sidewalk band, and a row of low-rise lots whose
// south faces sit 3.0 m past the carriageway edge (D = 3.0).
// Lots are 20 m apart, so the 12 m scene separation never binds.
function shopStreet(n = 40) {
  const lots = [];
  for (let i = 0; i < n; i++) {
    lots.push({ x: 5000 + i * 20, z: -19, w: 16, d: 12, h: 12, rot: 0 });
  }
  const g = geo(
    [bed('A', 'secondary', 20, 'sidewalk', [4900, 0, 5900, 0])],
    [road('secondary', 20, [4900, 0, 5900, 0])],
  );
  return { g, plan: { lots, tower: null, landmarkTowers: [] }, lots };
}

test('deterministic: identical inputs plan identical scenes', () => {
  const { g, plan } = shopStreet();
  const a = planCafeScenes(g, plan, { accept: 1 });
  const b = planCafeScenes(g, plan, { accept: 1 });
  assert.deepEqual(a, b);
});

test('synthetic street: scenes are complete and well-formed', () => {
  const { g, plan, lots } = shopStreet();
  const out = planCafeScenes(g, plan, { accept: 1 });
  // Every mat 6/7 lot fronts the street and gets a scene (accept: 1
  // removes the 0.35 acceptance roll, so the count is exact).
  const eligible = lots.filter((lot) => [6, 7].includes(facadeMatFor(lot)));
  assert.ok(eligible.length > 0, 'synthetic street has mat 6/7 lots');
  assert.equal(out.scenes.length, eligible.length, 'one scene per eligible lot');
  assert.equal(out.items.table.length, out.scenes.length * 2, 'two tables per scene');
  assert.equal(out.items.chair.length, out.scenes.length * 4, 'four chairs per scene');
  assert.equal(out.items.bench.length, out.scenes.length, 'one bench per scene');
  assert.equal(out.items.tree.length, out.scenes.length, 'one tree per scene');
  assert.equal(out.items.scooter.length, out.scenes.length * CAFE_SCENE_LAYOUT.scooterCount, 'four scooters per scene');
  assert.equal(out.items.menuBoard.length, out.scenes.length, 'one menu board per scene');
  assert.equal(out.items.menuFace.length, out.scenes.length * 2, 'two menu faces per board');
  for (const s of out.scenes) {
    assert.ok(s.D >= 2.0 && s.D <= 5.0, `scene depth ${s.D} outside [2, 5]`);
    assert.ok([6, 7].includes(s.mat), `scene on mat ${s.mat}`);
    assert.equal(s.highway, 'secondary', 'scene fronts the secondary road');
  }
  for (const it of out.items.scooter) {
    assert.ok(it.variant >= 0 && it.variant < SCOOTER_VARIANTS.length, `scooter variant ${it.variant} out of range`);
  }
  // Every item stands on the sidewalk strip: between the lot face
  // (z = -13) and the carriageway edge (z = -10), i.e. z in [-13, -10]
  // for this street, and outside the lot rect.
  for (const [kind, list] of Object.entries(out.items)) {
    for (const it of list) {
      assert.ok(it.z >= -13.01 && it.z <= -9.99, `${kind} at z=${it.z.toFixed(2)} off the sidewalk strip`);
      assert.ok(Math.abs(it.x - 5000 - Math.round((it.x - 5000) / 20) * 20) <= 4, `${kind} strayed from its lot's face`);
    }
  }
});

test('synthetic street: no scene when the fronting bed has no sidewalk', () => {
  // Same street, but the bed is an arcade walkway, not a sidewalk:
  // the planner only beds on pedestrianLayout === 'sidewalk', so no
  // fronting bed is found and the lot is rejected on depth.
  const lots = [{ x: 5000, z: -19, w: 16, d: 12, h: 12, rot: 0 }];
  const g = geo(
    [bed('A', 'secondary', 20, 'arcade', [4900, 0, 5100, 0])],
    [road('secondary', 20, [4900, 0, 5100, 0])],
  );
  const out = planCafeScenes(g, { lots, tower: null, landmarkTowers: [] }, { accept: 1 });
  assert.equal(out.scenes.length, 0, 'no scene without a fronting sidewalk bed');
  assert.equal(out.stats.rejected.depth, 1, 'the lot is rejected on depth');
});

test('menu faces sit on the board slabs, front and back', () => {
  const board = { x: 100, z: 200, rot: Math.PI / 3 };
  const faces = menuFaceItems(board);
  assert.equal(faces.length, 2, 'two faces per board');
  const fx = Math.sin(board.rot), fz = Math.cos(board.rot);
  assert.ok(Math.abs(faces[0].x - (100 + fx * MENU_BOARD.faceOffset)) < 1e-9, 'front face offset');
  assert.ok(Math.abs(faces[0].z - (200 + fz * MENU_BOARD.faceOffset)) < 1e-9, 'front face offset z');
  assert.ok(Math.abs(faces[1].x - (100 - fx * MENU_BOARD.faceOffset)) < 1e-9, 'back face offset');
  assert.ok(Math.abs(faces[1].rot - (board.rot + Math.PI)) < 1e-9, 'back face turned around');
  // The two faces are 0.28 m apart — one board, readable from both sides.
  assert.ok(Math.hypot(faces[0].x - faces[1].x, faces[0].z - faces[1].z) > 0.2, 'faces are separated');
});

test('menu list is a Taiwanese café menu, no 檳榔, NT$ prices', () => {
  assert.equal(CAFE_MENU_TITLE, '菜單', 'menu title');
  assert.ok(CAFE_MENU_ITEMS.length >= 5 && CAFE_MENU_ITEMS.length <= 8, 'menu fits one board');
  const text = JSON.stringify(CAFE_MENU_ITEMS);
  assert.ok(!text.includes('檳榔'), 'no betel nut on the menu');
  for (const item of CAFE_MENU_ITEMS) {
    assert.ok(item.name.length > 0, 'every item named');
    assert.ok(Number.isInteger(item.price) && item.price > 0 && item.price < 200, `sane NT$ price for ${item.name}`);
  }
  // The painter runs on a stub canvas context without throwing.
  const calls = [];
  const ctx = new Proxy({}, {
    get: (t, k) => {
      if (k === 'fillText' || k === 'strokeRect' || k === 'fillRect' || k === 'clearRect' || k === 'save' || k === 'restore') {
        return (...args) => calls.push([k, ...args]);
      }
      return t[k];
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  drawCafeMenuBoard(ctx, 256, 384);
  const drawn = calls.filter(([k]) => k === 'fillText').map(([, s]) => s).join(' ');
  assert.ok(drawn.includes('菜單'), 'title painted');
  for (const item of CAFE_MENU_ITEMS) assert.ok(drawn.includes(item.name), `${item.name} painted`);
  assert.ok(drawn.includes('NT$55'), 'a price painted');
});

// Real tile: the full census. The plan + lamp/tree/amenity plans
// are computed once at module scope (same as
// taipei-street-amenities.test.mjs).
const plan = planTaipeiBuildings(TAIPEI_GEO);
const streetTrees = planStreetTrees(TAIPEI_GEO, plan);
const lamps = planStreetLamps(TAIPEI_GEO, plan);
const street = planStreetAmenities(TAIPEI_GEO, plan, {
  avoid: [
    ...lamps.lamps.map((l) => ({ x: l.x, z: l.z, r: 0.4 })),
    ...streetTrees.trees.map((t) => ({ x: t.x, z: t.z, r: 0.5 })),
  ],
});
const cafe = planCafeScenes(TAIPEI_GEO, plan, {
  avoid: [
    ...lamps.lamps.map((l) => ({ x: l.x, z: l.z, r: 0.4 })),
    ...streetTrees.trees.map((t) => ({ x: t.x, z: t.z, r: 0.5 })),
    ...Object.values(street.items).flat().map((it) => ({ x: it.x, z: it.z, r: 0.5 })),
  ],
});

test('real tile: a modest number of scenes, every kind present', (t) => {
  const counts = Object.fromEntries(Object.entries(cafe.items).map(([k, v]) => [k, v.length]));
  t.diagnostic(`café scenes ${cafe.stats.total}: ${JSON.stringify(counts)}`);
  assert.ok(cafe.stats.total > 0, 'no café scenes placed');
  assert.ok(cafe.stats.total <= CAFE_SCENE_CAP, `scenes over cap (${cafe.stats.total} > ${CAFE_SCENE_CAP})`);
  for (const kind of ['table', 'chair', 'bench', 'tree', 'scooter', 'menuBoard', 'menuFace']) {
    assert.ok(counts[kind] > 0, `no ${kind} placed`);
  }
  assert.equal(counts.table, cafe.stats.total * 2, 'two tables per scene');
  assert.equal(counts.chair, cafe.stats.total * 4, 'four chairs per scene');
  assert.equal(counts.bench, cafe.stats.total, 'one bench per scene');
  assert.equal(counts.tree, cafe.stats.total, 'one tree per scene');
  assert.equal(counts.scooter, cafe.stats.total * CAFE_SCENE_LAYOUT.scooterCount, 'four scooters per scene');
  assert.equal(counts.menuBoard, cafe.stats.total, 'one menu board per scene');
  assert.equal(counts.menuFace, cafe.stats.total * 2, 'two menu faces per board');
  // Exact pins (measured 2026-11-16, issue #377): the planner is
  // fully deterministic, so the census is pinned, not ranged. This
  // run passes NO exclusions and the unfiltered lamp/tree/amenity
  // avoid lists — the same convention as the amenities test. The
  // boot's live count is 47, HIGHER, not lower: the boot passes
  // junction-cap exclusions (which remove 3 scenes) but its
  // lamp/tree/amenity avoid lists are themselves exclusion-filtered
  // (smaller), which frees 6 scenes the test's lists collide with
  // (measured 2026-11-17, probe-live-census.log: 44 - 3 + 6 = 47).
  assert.equal(cafe.stats.total, 44, 'total café scenes');
  assert.equal(counts.table, 88, 'table count');
  assert.equal(counts.chair, 176, 'chair count');
  assert.equal(counts.bench, 44, 'bench count');
  assert.equal(counts.tree, 44, 'tree count');
  assert.equal(counts.scooter, 176, 'scooter count');
  assert.equal(counts.menuBoard, 44, 'menu-board count');
  assert.equal(counts.menuFace, 88, 'menu-face count');
});

test('real tile: scenes spaced apart, depths in range, only on mat 6/7', () => {
  for (let i = 0; i < cafe.scenes.length; i++) {
    const a = cafe.scenes[i];
    assert.ok(a.D >= 2.0 && a.D <= 5.0, `scene ${i} depth ${a.D} outside [2, 5]`);
    assert.ok([6, 7].includes(a.mat), `scene ${i} on mat ${a.mat}`);
    for (let j = i + 1; j < cafe.scenes.length; j++) {
      const b = cafe.scenes[j];
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 12 - 1e-9, `scenes ${i} and ${j} closer than 12 m`);
    }
  }
});

test('real tile: no item on a carriageway, in a lot, or on a lamp/tree/amenity', () => {
  const ways = (TAIPEI_GEO.roads || []).filter((r) => !['footway', 'path', 'steps', 'pedestrian', 'cycleway', 'corridor', 'elevator', 'crossing', 'platform', 'traffic_island'].includes(r.highway));
  const wayBoxes = ways.map((w) => {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i + 1 < w.pts.length; i += 2) {
      minX = Math.min(minX, w.pts[i]); maxX = Math.max(maxX, w.pts[i]);
      minZ = Math.min(minZ, w.pts[i + 1]); maxZ = Math.max(maxZ, w.pts[i + 1]);
    }
    return { w, half: Math.max((w.width || 3) / 2, 0.75), minX, minZ, maxX, maxZ };
  });
  const all = Object.entries(cafe.items).flatMap(([kind, list]) => list.map((it) => ({ kind, ...it })));
  for (const it of all) {
    for (const { w, half, minX, minZ, maxX, maxZ } of wayBoxes) {
      if (it.x < minX - half - 1 || it.x > maxX + half + 1) continue;
      if (it.z < minZ - half - 1 || it.z > maxZ + half + 1) continue;
      for (let i = 0; i + 3 < w.pts.length; i += 2) {
        const d = distToSegment(it.x, it.z, w.pts[i], w.pts[i + 1], w.pts[i + 2], w.pts[i + 3]);
        assert.ok(d >= half + 0.35 - 0.01, `${it.kind} at ${it.x.toFixed(1)},${it.z.toFixed(1)} inside a carriageway (d=${d.toFixed(2)} < half+0.35=${(half + 0.35).toFixed(2)})`);
      }
    }
  }
  // No item in a plan lot (rotated-rect test, the planner's own rule).
  const lots = plan.lots;
  for (const it of all) {
    for (const lot of lots) {
      if (Math.abs(it.x - lot.x) > Math.hypot(lot.w, lot.d) / 2 + 1) continue;
      if (Math.abs(it.z - lot.z) > Math.hypot(lot.w, lot.d) / 2 + 1) continue;
      const dx = it.x - lot.x, dz = it.z - lot.z;
      let inside;
      if (lot.rot) {
        // World -> lot-local: x_l = dx*c - dz*sn, z_l = dx*sn + dz*c
        // (the inverse of the adapter's rotY map).
        const c = Math.cos(lot.rot), sn = Math.sin(lot.rot);
        inside = Math.abs(dx * c - dz * sn) <= lot.w / 2 + 0.3 && Math.abs(dx * sn + dz * c) <= lot.d / 2 + 0.3;
      } else {
        inside = Math.abs(dx) <= lot.w / 2 + 0.3 && Math.abs(dz) <= lot.d / 2 + 0.3;
      }
      assert.ok(!inside, `${it.kind} at ${it.x.toFixed(1)},${it.z.toFixed(1)} inside lot at ${lot.x.toFixed(1)},${lot.z.toFixed(1)}`);
    }
  }
  // No item within the avoid radius of a lamp post, tree trunk or
  // street-amenity item.
  const avoid = [
    ...lamps.lamps.map((l) => ({ x: l.x, z: l.z, r: 0.4 })),
    ...streetTrees.trees.map((t) => ({ x: t.x, z: t.z, r: 0.5 })),
    ...Object.values(street.items).flat().map((it) => ({ x: it.x, z: it.z, r: 0.5 })),
  ];
  let checked = 0;
  for (const it of all) {
    for (const a of avoid) {
      if (Math.abs(it.x - a.x) > 2 || Math.abs(it.z - a.z) > 2) continue;
      checked++;
      assert.ok(Math.hypot(it.x - a.x, it.z - a.z) >= a.r + 0.35 - 1e-9, `${it.kind} at ${it.x.toFixed(1)},${it.z.toFixed(1)} on a lamp/tree/amenity`);
    }
  }
  assert.ok(checked > 0, 'avoid audit examined near pairs');
});
