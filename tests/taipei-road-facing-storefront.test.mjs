// tests/taipei-road-facing-storefront.test.mjs
// Issue #379: the ground-floor storefront goes on the road-facing
// face(s) only — a corner lot gets both road-facing faces, a mid-block
// lot gets one, and no face fronts a rank-1-only side. The band sign
// follows the shopfront faces (the facade shader paints the band on
// ground-floor shop walls, and the wall kind comes from commit's
// `shops` faces — see js/buildings.js).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TAIPEI_GEO,
} from '../js/taipei-geodata.js';
import {
  planTaipeiBuildings,
  taipeiCityBlocksOptions,
  taipeiFrontageLookup,
  SHOP_FRONTAGE_MIN_RANK,
} from '../js/taipei-buildings.js';

assert.equal(SHOP_FRONTAGE_MIN_RANK, 2, 'commercial frontage starts at rank 2 (tertiary)');

// --- The lookup reports per-face ranks --------------------------------
// A fake geodata with a few roadbeds. buildSegmentGrid reads e.pts
// (flat [x0,z0,x1,z1,...]), e.width and e.highway (CLASS_RANK).
// The rect is {x0:0,x1:20,z0:0,z1:16}: its face samples sit 7 m out
// (e (17,8), w (-7,8), s (10,23), n (10,-7)) with a 16 m reach, so a
// road must sit close to its own face's sample and far from the
// others — the east road at x=30 (3 m past the east sample, 20+ m
// from the north/south samples) and the north road at z=-22 (15 m
// past the north sample) are placed exactly so.
const fakeGeo = (roads) => ({
  roadbeds: roads.map(([x0, z0, x1, z1, highway, width = 8]) => ({ pts: [x0, z0, x1, z1], width, highway })),
});
const rect = { x0: 0, x1: 20, z0: 0, z1: 16 };

// East road only (tertiary, rank 2).
const eastOnly = taipeiFrontageLookup(fakeGeo([[30, 0, 30, 16, 'tertiary']]))(rect);
assert.equal(eastOnly.rank, 2, 'best frontage is the east road');
assert.deepEqual(eastOnly.faces, { e: 2, w: 0, s: 0, n: 0 }, 'only the east face fronts a road');

// Corner: east rank 2 + north rank 3 (secondary).
const corner = taipeiFrontageLookup(fakeGeo([[30, 0, 30, 16, 'tertiary'], [0, -22, 20, -22, 'secondary']]))(rect);
assert.equal(corner.rank, 3, 'best frontage is the north road');
assert.deepEqual(corner.faces, { e: 2, w: 0, s: 0, n: 3 }, 'both road-facing faces are reported');

// Turned rect (rotY = 90°): the local faces turn with the lot, so the
// north road is found by the local east face and the east road by the
// local south face — the faces are reported in the lot's LOCAL frame,
// which is the frame commit's `shops` sides live in.
const turned = taipeiFrontageLookup(fakeGeo([[30, 0, 30, 16, 'tertiary'], [0, -22, 20, -22, 'secondary']]))({ ...rect, rotY: Math.PI / 2 });
assert.equal(turned.rank, 3, 'turned best frontage is the north road');
assert.deepEqual(turned.faces, { e: 3, w: 0, s: 2, n: 0 }, 'turned faces are reported in the local frame');

// Rank-1-only road: the face reports rank 1 and the best is rank 1.
const laneOnly = taipeiFrontageLookup(fakeGeo([[30, 0, 30, 16, 'residential']]))(rect);
assert.equal(laneOnly.rank, 1, 'a lane is rank 1');
assert.deepEqual(laneOnly.faces, { e: 1, w: 0, s: 0, n: 0 }, 'the lane face reports rank 1');

// No road anywhere: null, exactly as before.
assert.equal(taipeiFrontageLookup({ roadbeds: [] })(rect), null, 'no road means no frontage');

// --- The adapter, on the real plan ------------------------------------
// Every lot with shopFaces has a true face exactly when its best
// frontage is rank >= 2; every true face fronts a rank >= 2 road.
const plan = planTaipeiBuildings(TAIPEI_GEO);
const opts = taipeiCityBlocksOptions(TAIPEI_GEO, plan);
const frontageFor = taipeiFrontageLookup(TAIPEI_GEO);
const faceCount = (faces) => ['w', 'e', 'n', 's'].filter((s) => faces[s]).length;
let oneFace = 0, twoFace = 0, threeFace = 0, fourFace = 0, noFace = 0;
for (const lot of opts.lots) {
  const front = frontageFor(lot);
  if (!front) {
    assert.equal(lot.shopFaces, undefined, `no-frontage lot at (${lot.x0},${lot.z0}) carries no shopFaces`);
    continue;
  }
  assert.ok(lot.shopFaces, `fronted lot at (${lot.x0},${lot.z0}) carries shopFaces`);
  assert.deepEqual(
    lot.shopFaces,
    {
      w: front.faces.w >= SHOP_FRONTAGE_MIN_RANK,
      e: front.faces.e >= SHOP_FRONTAGE_MIN_RANK,
      n: front.faces.n >= SHOP_FRONTAGE_MIN_RANK,
      s: front.faces.s >= SHOP_FRONTAGE_MIN_RANK,
    },
    `shopFaces match the lookup faces at (${lot.x0},${lot.z0})`,
  );
  const n = faceCount(lot.shopFaces);
  if (n === 0) noFace++;
  else if (n === 1) oneFace++;
  else if (n === 2) twoFace++;
  else if (n === 3) threeFace++;
  else fourFace++;
  if (front.rank < SHOP_FRONTAGE_MIN_RANK) {
    assert.equal(n, 0, `rank-${front.rank} lot at (${lot.x0},${lot.z0}) has no road-facing face`);
    assert.equal(lot.shops, 0, `rank-${front.rank} lot at (${lot.x0},${lot.z0}) is shop-gated`);
  } else {
    assert.ok(n >= 1, `rank-${front.rank} lot at (${lot.x0},${lot.z0}) has a road-facing face`);
  }
}
// COUNT PINS (measured by census379.mjs on the branch tree, 2026-11-17:
// 70,348 lots carry shopFaces; 5,905 have no frontage at all and are
// not counted here. The 52,465 zero-face lots are exactly the rank < 2
// lots the #355 gate already sets shops = 0 on — they never reach the
// storefront path.)
assert.equal(oneFace, 7151, 'one-face lots');
assert.equal(twoFace, 6162, 'two-face corner lots');
assert.equal(threeFace, 4396, 'three-face lots');
assert.equal(fourFace, 174, 'four-face lots');
assert.equal(noFace, 52465, 'no-road-facing-face lots');

// --- The wiring, pinned by source -------------------------------------
// populatePlannedLot passes the adapter's lot.shopFaces through to
// commit's shops faces (js/buildings.js); the adapter stashes it from
// the lookup's per-face ranks (js/taipei-buildings.js). The behaviour
// cannot run in node without three.js, so the test pins the wiring
// itself, in the residential-shops test's pattern.
const buildingsSource = readFileSync(new URL('../js/buildings.js', import.meta.url), 'utf8');
assert.ok(buildingsSource.includes('shopFaces: lot.shopFaces'), 'populatePlannedLot passes the adapter shopFaces to commit');
assert.match(buildingsSource, /const shops = o\.shopFaces\n {6}\? \{ w: baseShops\.w && !!o\.shopFaces\.w/,
  'commit intersects the shops rule with the road-facing faces');
const taipeiSource = readFileSync(new URL('../js/taipei-buildings.js', import.meta.url), 'utf8');
assert.ok(taipeiSource.includes('r.shopFaces = {'), 'adapter stashes the road-facing faces');
assert.ok(taipeiSource.includes('best.faces = faceRanks'), 'lookup reports per-face ranks');
