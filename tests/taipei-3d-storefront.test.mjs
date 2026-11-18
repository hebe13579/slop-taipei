// tests/taipei-3d-storefront.test.mjs
// Issue #390: the ground-floor shopfront becomes real 3D — a recessed
// 落地窗 (the ground storey as a recessed mass) plus a shop door bay in
// the shader — and narrow 4-floor Taiwanese shophouses get their own
// style (awning over each shopfront face, forced rooftop water tank).
// The adapter replicates commit's shops roll exactly (a fresh mulberry32
// instance, same seed formula and probability table as
// populatePlannedLot's commit call), so the plan stays byte-identical;
// the roll, the table, the seed formula and the storey heights are
// pinned against js/buildings.js source below.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TAIPEI_GEO,
} from '../js/taipei-geodata.js';
import {
  planTaipeiBuildings,
  taipeiCityBlocksOptions,
  taipeiShopsRoll,
  taipeiStorefrontParts,
  narrowShophouseFor,
  STOREFRONT_RECESS_M,
  STOREFRONT_RECESS_MATS,
  NARROW_SHOPHOUSE_MATS,
  NARROW_SHOPHOUSE_FLOORS,
  NARROW_SHOPHOUSE_MAX_NARROW_M,
  NARROW_SHOPHOUSE_STOREYS,
  SHOPS_PROBABILITY_TABLE,
  SHOPS_PROBABILITY_OTHER,
} from '../js/taipei-buildings.js';

assert.equal(STOREFRONT_RECESS_M, 0.4, 'the recess is 0.4 m (shallow enough to keep the lot mass, deep enough to read)');
assert.deepEqual(STOREFRONT_RECESS_MATS, [6, 8, 9, 12, 13], 'recess mats: Taiwan, non-arcade, non-newer');
assert.deepEqual(NARROW_SHOPHOUSE_MATS, [6, 7], 'narrow shophouse mats');
assert.equal(NARROW_SHOPHOUSE_FLOORS, 4, 'narrow shophouse floors');
assert.equal(NARROW_SHOPHOUSE_MAX_NARROW_M, 10, 'narrow shophouse max narrow side');
assert.equal(SHOPS_PROBABILITY_OTHER, 0.3, 'mats 0–5 shops probability');

// --- The recess parts (synthetic lots) --------------------------------
const faces = { w: true, e: false, n: true, s: false };
const lot = (over = {}) => ({
  x0: 0, x1: 20, z0: 0, z1: 16, h: 13.4, mat: 6, shopFaces: faces, ...over,
});
const corner = taipeiStorefrontParts(lot(), 'all');
assert.deepEqual(corner, {
  recess: { x0: 0.4, x1: 20, z0: 0.4, z1: 16 },
}, 'a corner lot is inset 0.4 m on its two shop faces only');
const single = taipeiStorefrontParts(lot({ shopFaces: { w: false, e: true, n: false, s: false } }), 'all');
assert.deepEqual(single.recess, { x0: 0, x1: 19.6, z0: 0, z1: 16 }, 'a single-face lot is inset on that face only');
assert.equal(taipeiStorefrontParts(lot({ shopFaces: { w: false, e: false, n: false, s: false } }), 'all'), null, 'no shop face means no recess');
assert.equal(taipeiStorefrontParts(lot(), 'none'), null, 'a lot that rolls no shops gets no recess');
assert.equal(taipeiStorefrontParts(lot({ mat: 7 }), 'all'), null, 'F7 keeps the arcade core, no extra recess');
assert.equal(taipeiStorefrontParts(lot({ mat: 10 }), 'all'), null, 'F10 keeps the newer podium, no recess');
assert.equal(taipeiStorefrontParts(lot({ mat: 11 }), 'all'), null, 'F11 keeps the newer podium, no recess');
assert.equal(taipeiStorefrontParts(lot({ mat: 0 }), 'all'), null, 'pre-war/glass families keep the flat front');
assert.equal(taipeiStorefrontParts(lot({ mat: 5 }), 'all'), null, 'glass families keep the flat front');
assert.equal(taipeiStorefrontParts(lot({ x1: 0.7 }), 'all'), null, 'a lot too narrow for the inset keeps the flat front');

// --- The narrow shophouse flag (synthetic lots) -----------------------
// F6, 4 floors (h 13.4 / 3.35), 8 m narrow side, shop roll, a shop face.
assert.equal(narrowShophouseFor(lot({ x1: 8 }), 'all'), true, 'narrow 4-floor F6 shop lot');
assert.equal(narrowShophouseFor(lot({ x1: 8, mat: 7, h: 13.8 }), 'all'), true, 'narrow 4-floor F7 shop lot');
assert.equal(narrowShophouseFor(lot({ x1: 8, h: 16.75 }), 'all'), false, '5 floors is not the narrow style');
assert.equal(narrowShophouseFor(lot({ x1: 8, h: 10.05 }), 'all'), false, '3 floors is not the narrow style');
assert.equal(narrowShophouseFor(lot({ x1: 12 }), 'all'), false, 'a 12 m narrow side is too wide');
assert.equal(narrowShophouseFor(lot({ x1: 8, mat: 8 }), 'all'), false, 'F8 is not the narrow style');
assert.equal(narrowShophouseFor(lot({ x1: 8 }), 'none'), false, 'a lot that rolls no shops is not the narrow style');
assert.equal(narrowShophouseFor(lot({ x1: 8, shopFaces: { w: false, e: false, n: false, s: false } }), 'all'), false, 'no shop face means no narrow style');

// --- The roll replication, pinned against buildings.js source ---------
const buildingsSource = readFileSync(new URL('../js/buildings.js', import.meta.url), 'utf8');
const taipeiSource = readFileSync(new URL('../js/taipei-buildings.js', import.meta.url), 'utf8');
const tslSource = readFileSync(new URL('../js/tsl-materials.js', import.meta.url), 'utf8');
// The shops probability table in the adapter is the table in
// populatePlannedLot's commit call, parsed out of the source.
const tableMatch = buildingsSource.match(/shops: lot\.shops \?\? (\[[0-9., ]+\])\[mat - 6\]/);
assert.ok(tableMatch, 'the shops table literal is in populatePlannedLot');
assert.deepEqual(JSON.parse(tableMatch[1]), SHOPS_PROBABILITY_TABLE, 'the adapter table matches commit’s table');
assert.ok(buildingsSource.includes('shops: lot.shops ?? 0.3'), 'mats 0–5 keep the 0.3 fallback in commit');
// The seed formula in the adapter is populatePlannedLot's re-seed.
assert.ok(buildingsSource.includes('Math.imul(Math.round(minX * 4), 73856093) ^ Math.imul(Math.round(minZ * 4), 19349663) ^ 10019'),
  'the per-lot re-seed formula is in populatePlannedLot');
assert.ok(taipeiSource.includes('Math.imul(Math.round(lot.x0 * 4), 73856093)'),
  'the adapter replicates the seed from the lot’s x0/z0');
// mulberry32 in the adapter is a verbatim copy of buildings.js’s.
const mulberry = (src) => {
  const m = src.match(/function mulberry32\(seed\) \{([\s\S]*?)\n\}/);
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
};
assert.ok(mulberry(buildingsSource), 'mulberry32 is in buildings.js');
assert.equal(mulberry(taipeiSource), mulberry(buildingsSource), 'the adapter’s mulberry32 matches buildings.js verbatim');
// The storey heights in the adapter are facades[6]/[7] floorHeight —
// matched on each entry's own `// N:` comment line, which is followed
// directly by the `[createTileShophouseMaterial, {` entry (the header
// comment above the array also uses `// 6:`, so a plain split lands on
// the wrong chunk).
const floorHeight = (src, n) => {
  const m = src.match(new RegExp(`// ${n}:[^\\n]*(?:\\n\\s*//[^\\n]*)*\\n\\s*\\[createTileShophouseMaterial, \\{[^}]*?floorHeight: ([0-9.]+)`));
  return m ? parseFloat(m[1]) : null;
};
assert.equal(floorHeight(buildingsSource, 6), NARROW_SHOPHOUSE_STOREYS[6], 'F6 storey');
assert.equal(floorHeight(buildingsSource, 7), NARROW_SHOPHOUSE_STOREYS[7], 'F7 storey');
// The roll is deterministic (the same lot always rolls the same way).
const probe = { x0: 100, x1: 112, z0: -50, z1: -38, h: 13.4, mat: 6 };
assert.equal(taipeiShopsRoll(probe), taipeiShopsRoll(probe), 'the roll is deterministic');
// The #355 gate (shops = 0) always rolls 'none'.
assert.equal(taipeiShopsRoll({ ...probe, shops: 0 }), 'none', 'a shop-gated lot never rolls shops');

// --- The adapter, on the real plan ------------------------------------
const plan = planTaipeiBuildings(TAIPEI_GEO);
const opts = taipeiCityBlocksOptions(TAIPEI_GEO, plan);
let shopLots = 0;
let shopFaces = 0;
const recessByMat = {};
let recessTotal = 0;
let recessFaces = 0;
const narrowByMat = {};
let narrowTotal = 0;
let awningFaces = 0;
for (const r of opts.lots) {
  const shopsOn = taipeiShopsRoll(r);
  if (shopsOn !== 'all') {
    assert.equal(r.storefront, null, `a 'none' lot at (${r.x0},${r.z0}) carries no storefront`);
    assert.equal(r.narrowShophouse, false, `a 'none' lot at (${r.x0},${r.z0}) is not narrow`);
    continue;
  }
  shopLots++;
  const nFaces = ['w', 'e', 'n', 's'].filter((s) => r.shopFaces?.[s]).length;
  shopFaces += nFaces;
  if (r.storefront) {
    recessByMat[r.mat] = (recessByMat[r.mat] || 0) + 1;
    recessTotal++;
    recessFaces += nFaces;
    // The recess is the lot rect inset 0.4 m on the shop faces only.
    assert.equal(r.storefront.recess.x0, r.x0 + (r.shopFaces.w ? 0.4 : 0), `recess west at (${r.x0},${r.z0})`);
    assert.equal(r.storefront.recess.x1, r.x1 - (r.shopFaces.e ? 0.4 : 0), `recess east at (${r.x0},${r.z0})`);
    assert.equal(r.storefront.recess.z0, r.z0 + (r.shopFaces.n ? 0.4 : 0), `recess north at (${r.x0},${r.z0})`);
    assert.equal(r.storefront.recess.z1, r.z1 - (r.shopFaces.s ? 0.4 : 0), `recess south at (${r.x0},${r.z0})`);
    assert.ok(![7, 10, 11].includes(r.mat), `no arcade/newer lot carries a recess at (${r.x0},${r.z0})`);
  }
  if (r.narrowShophouse) {
    narrowByMat[r.mat] = (narrowByMat[r.mat] || 0) + 1;
    narrowTotal++;
    awningFaces += nFaces;
    assert.ok([6, 7].includes(r.mat), `narrow lot at (${r.x0},${r.z0}) is F6/F7`);
    assert.ok(Math.min(r.x1 - r.x0, r.z1 - r.z0) <= 10, `narrow lot at (${r.x0},${r.z0}) is <= 10 m on its narrow side`);
  }
}
// COUNT PINS (measured by census390.mjs on the branch tree, 2026-11-18:
// shop lots 8,962 — the same as measure390.mjs on pristine main, so the
// roll replication is exact; shopfront faces 16,672 — the #379 count,
// unchanged by the recess. The narrow count is the exact <= 10 m count:
// measure390's 576 was the floor-bucket sum, which over-counted the
// [10,11) bucket.)
assert.equal(shopLots, 8962, 'shop lots');
assert.equal(shopFaces, 16672, 'shopfront faces');
assert.equal(recessTotal, 4539, 'recess lots');
assert.deepEqual(recessByMat, { 6: 2341, 8: 1103, 9: 652, 12: 99, 13: 344 }, 'recess lots by mat');
assert.equal(recessFaces, 8368, 'recessed shopfront faces');
assert.equal(narrowTotal, 406, 'narrow shophouse lots');
assert.deepEqual(narrowByMat, { 6: 187, 7: 219 }, 'narrow lots by mat');
assert.equal(awningFaces, 749, 'awning faces');

// --- The wiring, pinned by source -------------------------------------
// populatePlannedLot masses the recessed ground storey + the full rect
// above it, and passes the narrow flag through to commit (js/buildings.js).
assert.ok(buildingsSource.includes('mass(b, [lot.storefront.recess], 0, 1)'), 'populatePlannedLot masses the recessed ground storey');
assert.ok(buildingsSource.includes('(lot.arcade || lot.storefront) && floors >= 2 ? 1 : 0'), 'the upper part starts at storey 1 on recessed lots');
assert.ok(buildingsSource.includes('narrowShophouse: lot.narrowShophouse'), 'populatePlannedLot passes the narrow flag to commit');
assert.ok(buildingsSource.includes('if (o.narrowShophouse && shopsOn !== \'none\')'), 'commit has the narrow-awning step');
assert.ok(buildingsSource.includes('noSign: true'), 'the narrow awning carries noSign');
assert.ok(buildingsSource.includes('if (!a.noSign)'), 'the fill loop gates the fascia sign on noSign');
// The gear clamp forces a tank on narrow lots (js/taipei-buildings.js).
assert.ok(taipeiSource.includes('lot.narrowShophouse || hash01(seed ^ 0x7777) < TAIPEI_TANK_RATE'), 'the tank roll is forced on narrow lots');
// The shop door bay (js/tsl-materials.js): facadeCell returns shopDoor,
// the tile material paints it as a glass door with a handle.
assert.ok(tslSource.includes('shopDoor, tone,'), 'facadeCell returns shopDoor');
assert.ok(tslSource.includes('const shopDoor = floor0.mul(isGroundFloor)'), 'shopDoor is the tone-picked bay on ground-floor shop fronts');
assert.ok(tslSource.includes('shopDoorGlass'), 'the tile material paints the door glass');
assert.ok(tslSource.includes('doorHandle'), 'the tile material paints the door handle');
assert.ok(tslSource.includes('storeMullion'), 'the tile material frames the shop glass with mullions');
// The #378 pin is untouched: the band plate line is exactly as before.
assert.ok(tslSource.includes('plate = mix(plate, bandPlateAttr, step(0.0, bandPlateAttr));'),
  'the #378 bandPlateAttr line is untouched');
