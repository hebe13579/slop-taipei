// tests/taipei-upper-level-branding.test.mjs
// Issue #380: upper-level branding + multi-layer-store buildings.
// A shop lot in a sign-bearing family may carry shops on its second
// floor (and, rarely, its third): the facade shader paints the sign
// band + the shopfront glass on those floors too, with each floor's
// OWN brand pick (a different salt per floor), so floors show
// different shops — a drink shop below, a clinic or cram school
// above, like the real stacked shophouses. This pins:
//  - the pick's gates (sign-bearing mats only, floors >= 2, want
//    clamped to floors-1) and its rates (1% two upper floors, 6%
//    one upper floor — a pure hash, no rand() before commit's tone);
//  - the per-floor plates are valid band plates and usually differ
//    between floors;
//  - the attribute plumbing exists in the renderer sources (commit
//    stamps upperShops/bandPlate2/bandPlate3 onto facade boxes;
//    createFacadeBoxes sets aUpperShops/aBandPlate2/aBandPlate3; the
//    tile shophouse material paints shop floors from upperShopFloor);
//  - the measured counts on the real plan (445 multi-layer lots, all
//    road-facing, shop lots unchanged at 8,962 — the tone roll is
//    untouched by the pure-hash pick).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  TAIPEI_GEO,
} from '../js/taipei-geodata.js';
import {
  planTaipeiBuildings,
  taipeiCityBlocksOptions,
} from '../js/taipei-buildings.js';

const buildings = readFileSync(new URL('../js/buildings.js', import.meta.url), 'utf8');
const tsl = readFileSync(new URL('../js/tsl-materials.js', import.meta.url), 'utf8');

function extractModuleFunction(src, name) {
  const match = src.match(new RegExp(`^function ${name}\\([^]*?\\n\\}`, 'm'));
  assert.ok(match, `${name} is present at module level`);
  return match[0];
}

// --- The pick, extracted with its dependencies (sign-match pattern) ---
const shapeLiteral = buildings.match(/const SIGN_BLADE_SHAPES = '([psrw]+)';/);
assert.ok(shapeLiteral, 'SIGN_BLADE_SHAPES literal is present in js/buildings.js');
const bandsLiteral = buildings.match(/const SIGN_BLADE_PLATE_BANDS = (\[[\s\S]*?\]);/);
assert.ok(bandsLiteral, 'SIGN_BLADE_PLATE_BANDS literal is present in js/buildings.js');
const sandbox = {
  SIGN_BLADE_SHAPES: shapeLiteral[1],
  SIGN_BLADE_PLATE_BANDS: vm.runInNewContext(`(${bandsLiteral[1]})`, {}),
  SIGN_BLADE_BRAND_FAMILY: 26.0,
  SIGN_BLADE_BRAND_PX: 71.0,
  SIGN_BAND_PLATES: 113,
  UPPER_SHOP_WANT_SALT: 0x3800,
  UPPER_SHOP_FLOOR1_SALT: 0x3801,
  UPPER_SHOP_FLOOR2_SALT: 0x3802,
  UPPER_SHOP_MATS: [6, 7, 8, 9, 13],
};
vm.createContext(sandbox);
vm.runInContext(
  `${extractModuleFunction(buildings, 'lotSignSeed')}\n${extractModuleFunction(buildings, 'pickLotSignPlates')}\n${extractModuleFunction(buildings, 'upperShopPick')}`,
  sandbox,
);
const upperShopPick = sandbox.upperShopPick;
assert.equal(typeof upperShopPick, 'function', 'extracted upperShopPick runs in the vm');

// The rates and the mat set are pinned in the source.
assert.ok(buildings.includes('h < 0.01 ? 2 : h < 0.07 ? 1 : 0'), 'want rates 1% / 6% are pinned in upperShopPick');
assert.ok(buildings.includes('const UPPER_SHOP_MATS = [6, 7, 8, 9, 13];'), 'upper-shop mats are the sign-bearing families');

// --- Gates ------------------------------------------------------------
// Non-sign families and single-floor lots never get an upper shop.
// (Field-by-field: the pick runs in a vm realm, whose objects carry
// a different prototype than this realm's — deepEqual would fail.)
const noUpper = (pick) => pick.want === 0 && pick.plates.length === 0;
for (const mat of [0, 1, 2, 3, 4, 5, 10, 11, 12]) {
  assert.ok(noUpper(upperShopPick({ x0: 100, z0: 100, x1: 120, mat }, 5)), `mat ${mat} never gets an upper shop`);
}
for (const mat of [6, 7, 8, 9, 13]) {
  assert.ok(noUpper(upperShopPick({ x0: 100, z0: 100, x1: 120, mat }, 1)), `mat ${mat} with 1 floor never gets an upper shop`);
}
// A 2-floor lot can take at most 1 upper floor (clamped to floors-1).
for (let i = 0; i < 20000; i++) {
  const lot = { x0: -8000 + (i % 200) * 16.3, z0: -6000 + Math.floor(i / 200) * 11.7, x1: -7990 + (i % 200) * 16.3, mat: 6 };
  const pick = upperShopPick(lot, 2);
  assert.ok(pick.want <= 1, `2-floor lot clamps want to 1 (got ${pick.want})`);
  assert.equal(pick.plates.length, pick.want, 'plates array matches want');
}

// --- Distribution over a 200k-lot sweep (floors 4, so want 2 is open) --
const N = 200000;
let want1 = 0, want2 = 0, diffBands = 0, want2Seen = 0;
for (let i = 0; i < N; i++) {
  const lot = { x0: -8000 + (i % 1000) * 16.3, z0: -6000 + Math.floor(i / 1000) * 11.7, x1: -7990 + (i % 1000) * 16.3, mat: 6 };
  const pick = upperShopPick(lot, 4);
  assert.ok(pick.want >= 0 && pick.want <= 2, 'want in range');
  assert.equal(pick.plates.length, pick.want, 'plates array matches want');
  for (const p of pick.plates) {
    assert.ok(p.band >= 0 && p.band < 113, `upper band plate in range (got ${p.band})`);
    assert.ok(p.blade >= 0 && p.blade < 120, `upper blade plate in range (got ${p.blade})`);
  }
  if (pick.want === 1) want1++;
  if (pick.want === 2) {
    want2++;
    want2Seen++;
    if (pick.plates[0].band !== pick.plates[1].band) diffBands++;
  }
  // Deterministic: the same lot picks the same plates twice (compared
  // field-by-field — the pick runs in a vm realm).
  const again = upperShopPick(lot, 4);
  assert.equal(again.want, pick.want, 'want is deterministic');
  for (let f = 0; f < pick.want; f++) assert.equal(again.plates[f].band, pick.plates[f].band, 'upper band is deterministic');
}
const close = (actual, expected, tol, label) => {
  assert.ok(Math.abs(actual - expected) <= tol, `${label}: share ${actual.toFixed(4)} vs ${expected} ± ${tol}`);
};
close(want2 / N, 0.01, 0.0015, 'two-upper-floor share');
close(want1 / N, 0.06, 0.003, 'one-upper-floor share');
assert.ok(diffBands / want2Seen > 0.9, `floors usually show different brands (${diffBands}/${want2Seen} differ)`);

// --- Plumbing: the attributes exist in the renderer sources -----------
assert.ok(buildings.includes('b.upperShops = upperShopPick(lot, floors);'), 'populatePlannedLot stashes the upper-shop pick');
assert.ok(buildings.includes('upperShops: upperCount, bandPlate2: upperPlate2, bandPlate3: upperPlate3'), 'commit stamps the upper-shop attributes onto facade boxes');
assert.ok(buildings.includes("shopsOn !== 'none' && b.upperShops"), 'the upper want applies only when the lot rolled shops');
assert.ok(tsl.includes('function upperShopFloor(cell)'), 'upperShopFloor exists in the shophouse material');
assert.ok(tsl.includes("attribute('aUpperShops', 'float')"), 'the material reads aUpperShops');
assert.ok(tsl.includes("attribute('aBandPlate2', 'float')"), 'the material reads aBandPlate2');
assert.ok(tsl.includes("attribute('aBandPlate3', 'float')"), 'the material reads aBandPlate3');
assert.ok(tsl.includes("geometry.setAttribute('aUpperShops', upperShops)"), 'createFacadeBoxes sets aUpperShops');
assert.ok(tsl.includes("geometry.setAttribute('aBandPlate2', bandPlate2)"), 'createFacadeBoxes sets aBandPlate2');
assert.ok(tsl.includes("geometry.setAttribute('aBandPlate3', bandPlate3)"), 'createFacadeBoxes sets aBandPlate3');
assert.ok(tsl.includes('bandPlateAttr = attribute(\'aBandPlate\', \'float\')'), 'bandPlateColor takes the floor plate as a parameter');
const bandAttrUses = tsl.split('const { isShopFloor, plateAttr: bandPlateAttr } = upperShopFloor(cell);').length - 1;
assert.equal(bandAttrUses, 2, 'the colour + emissive nodes use the floor plate (2 uses)');
const plainUses = tsl.split('const { isShopFloor } = upperShopFloor(cell); // Issue #380').length - 1;
assert.equal(plainUses, 2, 'the roughness + normal nodes use the shop-floor mask (2 uses)');

// --- The adapter, on the real plan ------------------------------------
// Replicates commit's per-lot tone roll exactly (census380.mjs):
// `tone` is the FIRST rand() output after the per-lot re-seed, and the
// pure-hash upper pick adds no rand() before it.
vm.runInContext(extractModuleFunction(buildings, 'mulberry32'), sandbox);
const { mulberry32 } = sandbox;
const table = JSON.parse(buildings.match(/shops: lot\.shops \?\? (\[[0-9., ]+\])\[mat - 6\]/)[1]);
const storeys = [...buildings.matchAll(/floorHeight: ([0-9.]+)/g)].map((m) => parseFloat(m[1]));
const plan = planTaipeiBuildings(TAIPEI_GEO);
const opts = taipeiCityBlocksOptions(TAIPEI_GEO, plan);
const SIGN_MATS = [6, 7, 8, 9, 13];
let shopLots = 0;
let total = 0, w1 = 0, w2 = 0;
const byMat = {};
let pickedSigned = 0;
for (const lot of opts.lots) {
  const shopsProb = lot.shops ?? (lot.mat >= 6 ? table[lot.mat - 6] : 0.3);
  if (typeof shopsProb !== 'number') continue;
  const seed = (Math.imul(Math.round(lot.x0 * 4), 73856093) ^ Math.imul(Math.round(lot.z0 * 4), 19349663) ^ 10019) >>> 0;
  if (mulberry32(seed)() >= shopsProb) continue;
  shopLots++;
  if (!SIGN_MATS.includes(lot.mat)) continue;
  const floors = Math.max(1, Math.round(lot.h / storeys[lot.mat]));
  const pick = upperShopPick(lot, floors);
  if (pick.want === 0) continue;
  total++;
  if (pick.want === 1) w1++; else w2++;
  byMat[lot.mat] = byMat[lot.mat] || { 1: 0, 2: 0 };
  byMat[lot.mat][pick.want]++;
  // Every upper-shop lot fronts a road — the #379 road-facing rule
  // holds for the upper band too (it paints only on shop walls, and
  // shop walls exist only on road-facing faces).
  assert.ok(lot.shopFaces && Object.values(lot.shopFaces).some(Boolean),
    `upper-shop lot at (${lot.x0},${lot.z0}) has a road-facing face`);
  if (Array.isArray(lot.signs) && lot.signs.length) pickedSigned++;
}
// COUNT PINS (measured by census380.mjs on the branch tree, 2026-11-17:
// shop lots 8,962 — the same as pristine main, so the pure-hash pick
// moved no ground-floor shop; 445 multi-layer lots, 365 with one upper
// floor and 80 with two).
// Re-pinned for issue #17 (2026-11-22 slice): the palette rebalance
// grows the sign-bearing Taiwan population the pick draws from —
// shop lots 8,962 -> 10,215 (the same census as the 3D-storefront
// test), multi-layer lots 445 -> 548 (451 one-upper, 97 two-upper),
// pickedSigned 266 -> 334. The pick's gates and rates are unedited.
assert.equal(shopLots, 10215, 'shop lots after the #17 palette slice — the tone roll is untouched');
assert.equal(total, 548, 'multi-layer-store lots');
assert.equal(w1, 451, 'lots with one upper shop floor');
assert.equal(w2, 97, 'lots with two upper shop floors');
assert.deepEqual(byMat, {
  6: { 1: 158, 2: 31 },
  7: { 1: 139, 2: 33 },
  8: { 1: 74, 2: 17 },
  9: { 1: 52, 2: 8 },
  13: { 1: 28, 2: 8 },
}, 'multi-layer lots by family');
assert.equal(pickedSigned, 334, 'upper-shop lots that also carry a blade');
