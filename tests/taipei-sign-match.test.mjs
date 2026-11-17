// tests/taipei-sign-match.test.mjs
// Issue #378: one brand per signed shop lot — the band plate and the
// blade plate agree. The lot's brand is computed once in
// js/buildings.js (lotSignSeed + pickLotSignPlates, module level) and
// carried to both shaders as per-instance attributes (aBandPlate on
// the facade boxes, aBladePlate on the blades). This pins:
//  - the renderer's lot seed mirrors the planner's lotPolicySeed;
//  - the pick's distribution (every plate appears; the #354 weighted
//    brands keep their shares);
//  - the blade→band mapping, including the two full-name extras that
//    map to their brand's band plate and the text-only extras whose
//    band takes a second deterministic pick;
//  - the shape lookup agrees with the signs module over all plates;
//  - the attribute plumbing exists in the renderer sources.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  TAIPEI_BAND_SIGNS,
  TAIPEI_BLADE_EXTRA,
  bladePlateShape,
} from '../js/taipei-signs.js';

const buildings = readFileSync(new URL('../js/buildings.js', import.meta.url), 'utf8');
const planner = readFileSync(new URL('../js/taipei-buildings.js', import.meta.url), 'utf8');
const tsl = readFileSync(new URL('../js/tsl-materials.js', import.meta.url), 'utf8');

function extractModuleFunction(src, name) {
  const match = src.match(new RegExp(`^function ${name}\\([^]*?\\n\\}`, 'm'));
  assert.ok(match, `${name} is present at module level`);
  return match[0];
}
const shapeLiteral = buildings.match(/const SIGN_BLADE_SHAPES = '([psrw]+)';/);
assert.ok(shapeLiteral, 'SIGN_BLADE_SHAPES literal is present in js/buildings.js');
const bandsLiteral = buildings.match(/const SIGN_BLADE_PLATE_BANDS = (\[[\s\S]*?\]);/);
assert.ok(bandsLiteral, 'SIGN_BLADE_PLATE_BANDS literal is present in js/buildings.js');

const sandbox = {
  SIGN_BLADE_SHAPES: shapeLiteral[1],
  SIGN_BLADE_SHAPE_PORTRAIT: 0,
  SIGN_BLADE_SHAPE_SQUARE: 1,
  SIGN_BLADE_SHAPE_ROUND: 2,
  SIGN_BLADE_PLATE_BANDS: vm.runInNewContext(`(${bandsLiteral[1]})`, {}),
  SIGN_BLADE_BRAND_FAMILY: 26.0,
  SIGN_BLADE_BRAND_PX: 71.0,
  SIGN_BAND_PLATES: 113,
};
vm.createContext(sandbox);
vm.runInContext(
  `${extractModuleFunction(buildings, 'lotSignSeed')}\n${extractModuleFunction(buildings, 'pickLotSignPlates')}\n${extractModuleFunction(buildings, 'bladeShapeCode')}`,
  sandbox,
);
const lotSignSeed = sandbox.lotSignSeed;
const pickLotSignPlates = sandbox.pickLotSignPlates;
const bladeShapeCode = sandbox.bladeShapeCode;
assert.equal(typeof lotSignSeed, 'function', 'extracted lotSignSeed runs in the vm');
assert.equal(typeof pickLotSignPlates, 'function', 'extracted pickLotSignPlates runs in the vm');
assert.equal(typeof bladeShapeCode, 'function', 'extracted bladeShapeCode runs in the vm');

// The renderer's lot seed mirrors the planner's lotPolicySeed.
vm.runInContext(extractModuleFunction(planner, 'lotPolicySeed'), sandbox);
const lotPolicySeed = sandbox.lotPolicySeed;
const SALT = 0x3785;
for (let i = 0; i < 5000; i++) {
  const lot = { x0: -8000 + i * 3.7, z0: -6000 + i * 2.3, x1: -7990 + i * 3.7 };
  assert.equal(lotSignSeed(lot, SALT), lotPolicySeed(lot, SALT), `lot seed agrees at lot ${i}`);
  assert.equal(lotSignSeed(lot, 0x5167), lotPolicySeed(lot, 0x5167), `lot seed agrees at lot ${i} (sign salt)`);
}

// The pick's distribution over realistic lot seeds: every plate
// appears, and the weighted brands keep their #354 shares.
const N = 200000;
const bladeCounts = new Array(120).fill(0);
const bandCounts = new Array(113).fill(0);
for (let i = 0; i < N; i++) {
  const lot = { x0: -8000 + (i % 1000) * 16.3, z0: -6000 + Math.floor(i / 1000) * 11.7, x1: -7990 + (i % 1000) * 16.3 };
  const { blade, band } = pickLotSignPlates(lotSignSeed(lot, SALT));
  bladeCounts[blade]++;
  bandCounts[band]++;
}
for (let p = 0; p < 120; p++) assert.ok(bladeCounts[p] > 0, `blade plate ${p} appears in the pick`);
for (let p = 0; p < 113; p++) assert.ok(bandCounts[p] > 0, `band plate ${p} appears in the pick`);
const share = (counts, p) => counts[p] / N;
const close = (actual, expected, tol, label) => {
  assert.ok(Math.abs(actual - expected) <= tol, `${label}: share ${actual.toFixed(4)} vs ${expected} ± ${tol}`);
};
close(share(bladeCounts, 1), 0.08, 0.02, '7-ELEVEN');
close(share(bladeCounts, 26), 0.04, 0.015, 'FamilyMart');
close(share(bladeCounts, 52), 0.05, 0.015, 'BFC');
close(share(bladeCounts, 53), 0.04, 0.015, 'Guotie');
close(share(bladeCounts, 51), 0.03, 0.012, 'Dongyi');
close(share(bladeCounts, 68), 0.03, 0.012, 'Tsannkuen');
close(share(bladeCounts, 71), 0.03, 0.012, 'PX Mart');
close(share(bladeCounts, 64), 0.02, 0.01, 'NET');
// The band shares follow the blade pick (same brand on both sides):
// 7-ELEVEN's band share matches its blade share.
close(share(bandCounts, 1), share(bladeCounts, 1), 0.005, '7-ELEVEN band vs blade share');

// The blade→band mapping, over the same sweep.
let mapped = 0;
let logoExtra = 0;
let textExtra = 0;
for (let i = 0; i < N; i++) {
  const lot = { x0: -8000 + (i % 1000) * 16.3, z0: -6000 + Math.floor(i / 1000) * 11.7, x1: -7990 + (i % 1000) * 16.3 };
  const seed = lotSignSeed(lot, SALT);
  const { blade, band } = pickLotSignPlates(seed);
  assert.ok(band >= 0 && band < 113, `band plate in range at seed ${seed}`);
  assert.ok(blade >= 0 && blade < 120, `blade plate in range at seed ${seed}`);
  // Deterministic: the same seed picks the same plates twice
  // (compared field-by-field — the pick runs in a vm realm, whose
  // objects carry a different prototype than this realm's).
  const again = pickLotSignPlates(seed);
  assert.equal(again.blade, blade, `pick blade is deterministic at seed ${seed}`);
  assert.equal(again.band, band, `pick band is deterministic at seed ${seed}`);
  if (blade < 113) {
    assert.equal(band, blade, `band == blade when the blade plate is a band plate (blade ${blade})`);
    mapped++;
  } else if (blade === 113) {
    assert.equal(band, 26, '全家便利商店 maps to 全家');
    logoExtra++;
  } else if (blade === 116) {
    assert.equal(band, 71, '全聯福利中心 maps to 全聯');
    logoExtra++;
  } else {
    textExtra++;
  }
}
assert.ok(mapped > N * 0.9, `most lots map band == blade (got ${mapped}/${N})`);
assert.ok(logoExtra > 0, 'the logo extras occur in the sweep');
assert.ok(textExtra > 0, 'the text-only extras occur in the sweep');

// The extra→band mapping matches the pool: the extra's logo is its
// brand's band plate logo.
assert.equal(TAIPEI_BLADE_EXTRA[0].logo, TAIPEI_BAND_SIGNS[26].logo, '全家便利商店 carries the 全家 logo');
assert.equal(TAIPEI_BLADE_EXTRA[3].logo, TAIPEI_BAND_SIGNS[71].logo, '全聯福利中心 carries the 全聯 logo');
// The other five extras are text-only (no logo, no band plate).
for (const i of [1, 2, 4, 5, 6]) {
  assert.equal(TAIPEI_BLADE_EXTRA[i].logo, undefined, `extra ${TAIPEI_BLADE_EXTRA[i].name} is text-only`);
}

// The shape lookup agrees with the signs module over all plates.
for (let p = 0; p < 120; p++) {
  const want = bladePlateShape(p) === 'square' ? 1 : bladePlateShape(p) === 'round' ? 2 : 0;
  assert.equal(bladeShapeCode(p), want, `shape code agrees for plate ${p}`);
}

// The attribute plumbing exists in the renderer sources.
assert.ok(
  buildings.includes('vSignGeo.attributes.aBladePlate.setX(vSignCount, s.bladePlate)'),
  'blade fill loop sets aBladePlate from the lot plate',
);
assert.ok(buildings.includes("attribute('aBladePlate', 'float')"), 'blade shader reads aBladePlate');
assert.ok(buildings.includes('s.bladePlate !== undefined'), 'blade fill loop keeps the hash fallback');
assert.ok(buildings.includes('bladePlate: signPlates.blade, bandPlate: signPlates.band'),
  'populatePlannedLot annotates sign copies with the lot plates');
assert.ok(buildings.includes('b.signPlates = signPlates'), 'lot plates ride on the building object');
assert.ok(buildings.includes('bandPlate: b.signPlates ? b.signPlates.band : -1'),
  'commit stamps the band plate onto facade boxes');
assert.ok(tsl.includes("geometry.setAttribute('aBandPlate', bandPlate)"),
  'createFacadeBoxes carries the aBandPlate attribute');
assert.ok(tsl.includes("attribute('aBandPlate', 'float')"), 'band shader reads aBandPlate');
assert.ok(tsl.includes('plate = mix(plate, bandPlateAttr, step(0.0, bandPlateAttr))'),
  'band plate prefers the lot attribute over the hash pick');

console.log('taipei-sign-match.test.mjs: all assertions passed');
