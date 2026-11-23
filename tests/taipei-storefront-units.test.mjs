// tests/taipei-storefront-units.test.mjs
// Issue #423: shop units — a shop face's bays are grouped into units
// of varied width ([2, 3, 1, 4, 2] bays over a 12-bay period, rotated
// per building by the tone), one sign panel and one door per unit
// (double door on the 4-bay unit), instead of one identical bay-unit
// repeated across the frontage. The grouping lives in facadeCell
// (js/tsl-materials.js); js/taipei-buildings.js's
// storefrontUnitLayout mirrors the math so this test can census it.
// The recess population is whatever the base tree carries (5,871 lots
// / 10,970 faces on main after the #425 palette rebalance widened it
// from the #390 census of 4,539 / 8,368); this change does not move
// it — the plan diff against the base is byte-identical.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TAIPEI_GEO,
} from '../js/taipei-geodata.js';
import {
  planTaipeiBuildings,
  taipeiCityBlocksOptions,
  taipeiShopsRoll,
  taipeiLotTone,
  storefrontBaysFor,
  storefrontUnitLayout,
  STOREFRONT_UNIT_PATTERN,
  STOREFRONT_UNIT_STARTS,
  STOREFRONT_UNIT_DOORS,
  STOREFRONT_UNIT_PERIOD,
  STOREFRONT_UNIT_FACADES,
} from '../js/taipei-buildings.js';

assert.deepEqual(STOREFRONT_UNIT_PATTERN, [2, 3, 1, 4, 2], 'unit pattern (bays per unit)');
assert.deepEqual(STOREFRONT_UNIT_STARTS, [0, 2, 5, 6, 10], 'unit starts (phases)');
assert.deepEqual(STOREFRONT_UNIT_DOORS, [[1], [3], [5], [7, 8], [11]], 'unit door phases');
assert.equal(STOREFRONT_UNIT_PERIOD, 12, 'pattern period');

// --- The layout (synthetic faces) --------------------------------------
// Mat 6 (windowWidth 2.55, cornerPier 0.55): a 31.7 m face fits
// exactly 12 bays ((31.7 - 1.1) / 2.55 = 12).
assert.deepEqual(storefrontBaysFor(31.7, 6), { bays: 12, bayWidth: 2.55 }, 'bay fit, 12 bays');
// Tone 0 -> rotation 0: the pattern runs from the wall's first bay.
assert.deepEqual(storefrontUnitLayout(31.7, 6, 0), [
  { start: 0, size: 2, doors: [1] },
  { start: 2, size: 3, doors: [3] },
  { start: 5, size: 1, doors: [5] },
  { start: 6, size: 4, doors: [7, 8] },
  { start: 10, size: 2, doors: [11] },
], 'rotation 0: [2,3,1,4,2] with a double door on the 4-bay unit');
// Tone 0.5 -> rotation 6: the 4-bay unit leads, doors shift with it.
assert.deepEqual(storefrontUnitLayout(31.7, 6, 0.5), [
  { start: 0, size: 4, doors: [1, 2] },
  { start: 4, size: 2, doors: [5] },
  { start: 6, size: 2, doors: [7] },
  { start: 8, size: 3, doors: [9] },
  { start: 11, size: 1, doors: [11] },
], 'rotation 6: the pattern is rotated, not restarted');
// Tone 0.95 -> rotation 11: the first unit starts before the wall
// (its door still lands on bay 0); the last unit's door falls past
// the wall's end and is dropped.
assert.deepEqual(storefrontUnitLayout(31.7, 6, 0.95), [
  { start: -1, size: 2, doors: [0] },
  { start: 1, size: 2, doors: [2] },
  { start: 3, size: 3, doors: [4] },
  { start: 6, size: 1, doors: [6] },
  { start: 7, size: 4, doors: [8, 9] },
  { start: 11, size: 2, doors: [] },
], 'rotation 11: partial units at both ends');
// Walls of 1-2 bays are a single unit with a centre door (mat 9:
// windowWidth 3.6, cornerPier 0.5).
assert.deepEqual(storefrontUnitLayout(4, 9, 0.3), [{ start: 0, size: 1, doors: [0] }], 'a 1-bay wall is one unit');
assert.deepEqual(storefrontUnitLayout(8, 9, 0.3), [{ start: 0, size: 2, doors: [1] }], 'a 2-bay wall is one unit');
// The layout is deterministic in the tone.
assert.deepEqual(storefrontUnitLayout(20, 12, 0.42), storefrontUnitLayout(20, 12, 0.42), 'the layout is deterministic');

// --- The facade table, pinned against js/buildings.js ------------------
const buildingsSource = readFileSync(new URL('../js/buildings.js', import.meta.url), 'utf8');
const tslSource = readFileSync(new URL('../js/tsl-materials.js', import.meta.url), 'utf8');
const facadeBlock = (src, n) => {
  const m = src.match(new RegExp(`// ${n}:[^\\n]*(?:\\n\\s*//[^\\n]*)*\\n\\s*\\[createTileShophouseMaterial, \\{([\\s\\S]*?)\\}\\]`));
  return m ? m[1] : null;
};
for (let n = 6; n <= 13; n++) {
  const block = facadeBlock(buildingsSource, n);
  assert.ok(block, `facades[${n}] block found`);
  const ww = parseFloat(block.match(/windowWidth: ([0-9.]+)/)[1]);
  assert.equal(ww, STOREFRONT_UNIT_FACADES[n].windowWidth, `facades[${n}] windowWidth`);
  const cp = block.match(/cornerPier: ([0-9.]+)/);
  if (cp) assert.equal(parseFloat(cp[1]), STOREFRONT_UNIT_FACADES[n].cornerPier, `facades[${n}] cornerPier`);
  else assert.equal(n, 6, 'only family 6 omits cornerPier (the factory default)');
}
// Family 6's entry in the mirror is the factory default in the source.
assert.ok(tslSource.includes('cornerPier = 0.55,'), 'the factory default cornerPier is 0.55');
assert.equal(STOREFRONT_UNIT_FACADES[6].cornerPier, 0.55, 'family 6 mirrors the factory default');

// --- The shader wiring, pinned by source -------------------------------
// facadeCell computes the unit fields with the same pattern: rotation
// by the tone, unit starts/sizes from the phase table, the double
// door on phases 7+8, and the small-wall override.
assert.ok(tslSource.includes('const rot = floor(tone.mul(12.0));'), 'the unit pattern rotates by the tone');
assert.ok(tslSource.includes('const phase = mod(bayIdx.add(rot), 12.0);'), 'the unit phase is the rotated bay index');
assert.ok(tslSource.includes('step(abs(phase.sub(7.0)), 0.5)'), 'door phase 7 pinned');
assert.ok(tslSource.includes('step(abs(phase.sub(8.0)), 0.5)'), 'door phase 8 pinned (the double door)');
assert.ok(tslSource.includes('const small = step(bays, 2.5);'), 'the small-wall override is pinned');
assert.ok(tslSource.includes('unitU, unitDoor, unitEdge, unitId, unitSize'), 'facadeCell returns the unit fields');
// The tile material paints the door from the unit, spans the sign
// panel across the unit, and posts the unit's left edge.
assert.ok(tslSource.includes('cell.unitDoor.mul(isShopFloor)'), 'the shop door paints from cell.unitDoor');
assert.ok(tslSource.includes('filteredPulse(cell.unitU, 0.035, 0.965, unitFw)'), 'the sign panel spans the unit');
assert.ok(tslSource.includes('const bandUV = vec2(mix(cell.unitU,'), 'the band plate samples across the unit');
assert.ok(tslSource.includes('const unitPost = cell.unitEdge'), 'the unit post is painted');
// The #378 pin is untouched: bandPlateColor still overrides the hash
// pick with the lot's plate, and the #390 shopDoor definition stays.
assert.ok(tslSource.includes('plate = mix(plate, bandPlateAttr, step(0.0, bandPlateAttr));'),
  'the #378 bandPlateAttr line is untouched');
assert.ok(tslSource.includes('const shopDoor = floor0.mul(isGroundFloor)'), 'the #390 shopDoor definition stays');

// --- The census, on the real plan --------------------------------------
// Same loop as tests/taipei-3d-storefront.test.mjs over the recess
// population; face lengths are the recess box's sides (the ground
// storey the shader paints).
const plan = planTaipeiBuildings(TAIPEI_GEO);
const opts = taipeiCityBlocksOptions(TAIPEI_GEO, plan);
let recessLots = 0;
let recessFaces = 0;
let totalBays = 0;
let units = 0;
let doors = 0;
let doubleDoorUnits = 0;
const bySizeClass = { 1: 0, 2: 0, 3: 0, 4: 0 };
let facesWithMixedUnits = 0;
let doorlessFaces = 0;
for (const r of opts.lots) {
  if (taipeiShopsRoll(r) !== 'all' || !r.storefront) continue;
  recessLots++;
  const rec = r.storefront.recess;
  const tone = taipeiLotTone(r);
  const faceLen = {
    w: rec.z1 - rec.z0, e: rec.z1 - rec.z0,
    n: rec.x1 - rec.x0, s: rec.x1 - rec.x0,
  };
  for (const side of ['w', 'e', 'n', 's']) {
    if (!r.shopFaces?.[side]) continue;
    recessFaces++;
    const fit = storefrontBaysFor(faceLen[side], r.mat);
    const layout = storefrontUnitLayout(faceLen[side], r.mat, tone);
    totalBays += fit.bays;
    const sizesSeen = new Set();
    let faceDoors = 0;
    for (const u of layout) {
      units++;
      bySizeClass[u.size]++;
      sizesSeen.add(u.size);
      faceDoors += u.doors.length;
      doors += u.doors.length;
      if (u.doors.length >= 2) doubleDoorUnits++;
    }
    if (sizesSeen.size >= 2) facesWithMixedUnits++;
    if (faceDoors === 0) doorlessFaces++;
  }
}
// COUNT PINS (measured by census423.mjs on the branch tree,
// 2026-11-23, on the post-#425 base: the recess population is the
// base's own — pristine main measures the same 5,871 / 10,970 — and
// the unit counts are the new census over it).
assert.equal(recessLots, 5871, 'recess lots (the base population after #425)');
assert.equal(recessFaces, 10970, 'recessed shopfront faces (the base population after #425)');
assert.equal(totalBays, 53154, 'bays across the recess faces');
assert.equal(units, 28343, 'shop units across the recess faces');
assert.equal(doors, 26810, 'unit doors across the recess faces');
assert.equal(doubleDoorUnits, 3402, 'double-door (4-bay) units with both doors on the wall');
assert.deepEqual(bySizeClass, { 1: 6020, 2: 7558, 3: 7724, 4: 7041 }, 'units by size class (bays)');
assert.equal(facesWithMixedUnits, 9799, 'faces with two or more unit sizes side by side');
assert.equal(doorlessFaces, 0, 'every recess face keeps at least one door');

console.log('all assertions passed');
