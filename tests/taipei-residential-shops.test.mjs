// tests/taipei-residential-shops.test.mjs
// Issue #355: shops and signs are a commercial-frontage treatment.
// A lot whose BEST frontage (max road rank over its four faces, per
// taipeiFrontageLookup — the same definition the #153 roof-board
// policy uses) is rank 1 (a residential lane / unclassified / living
// street / service drive), or which fronts no road at all, is pure
// residential: it carries no vertical sign and no ground-floor
// shopfront (adapter r.shops = 0, honoured by populatePlannedLot).
// Rank >= 2 (tertiary/collector and better) keeps shops and signs
// exactly as before. The sign content rules are untouched (the
// everyday pool, 檳榔 excluded) — only WHERE signs spawn changes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TAIPEI_GEO,
} from '../js/taipei-geodata.js';
import {
  planTaipeiBuildings,
  taipeiCityBlocksOptions,
  taipeiVerticalSigns,
  taipeiFrontageLookup,
  SHOP_FRONTAGE_MIN_RANK,
} from '../js/taipei-buildings.js';

const plan = planTaipeiBuildings(TAIPEI_GEO);
const opts = taipeiCityBlocksOptions(TAIPEI_GEO, plan);
const frontageFor = taipeiFrontageLookup(TAIPEI_GEO);
const rankOf = (lot) => {
  const f = frontageFor(lot);
  return f ? f.rank : 0;
};

assert.equal(SHOP_FRONTAGE_MIN_RANK, 2, 'commercial frontage starts at rank 2 (tertiary)');

// --- The gate, on real plan lots -------------------------------------
// Every rank 0–1 lot is sign-free and shop-gated; every signed lot
// fronts rank >= 2. The adapter flag and the sign policy agree lot
// for lot with the production frontage lookup.
let signedLots = 0, panels = 0, shops0 = 0;
for (const lot of opts.lots) {
  const rank = rankOf(lot);
  const signed = (lot.signs?.length || 0) > 0;
  if (signed) { signedLots++; panels += lot.signs.length; }
  if (lot.shops === 0) shops0++;
  if (rank <= 1) {
    assert.ok(!signed, `rank-${rank} lot at (${lot.x0},${lot.z0}) carries no sign`);
    assert.equal(lot.shops, 0, `rank-${rank} lot at (${lot.x0},${lot.z0}) is shop-gated`);
  } else {
    assert.ok(!signed || rank >= 2, 'signed lots front rank >= 2');
    assert.equal(lot.shops, undefined, `rank-${rank} lot at (${lot.x0},${lot.z0}) keeps the family table`);
  }
}
assert.ok(signedLots > 0, 'commercial streets still carry signs');

// --- The gate, directly on the policy --------------------------------
// A Taiwan-type lot that WOULD sign (its hash passes the 55% roll)
// signs with a rank-2 front and not with a rank-1 front; a rank-0
// (no frontage) lot never signs; glass lots never sign at any rank.
const signer = opts.lots.find((l) => l.mat >= 6 && l.h >= 10 && rankOf(l) >= 2
  && taipeiVerticalSigns(l, { rank: 3 }).length > 0);
assert.ok(signer, 'found a signing lot to probe the gate with');
assert.equal(taipeiVerticalSigns(signer, { rank: 1 }).length, 0, 'rank-1 frontage kills the sign');
assert.equal(taipeiVerticalSigns(signer, null).length, 0, 'no frontage kills the sign');
assert.ok(taipeiVerticalSigns(signer, { rank: 2 }).length > 0, 'rank-2 frontage keeps the sign');
assert.deepEqual(taipeiVerticalSigns(signer, { rank: 3 }), signer.signs, 'sign policy is deterministic per lot');
assert.deepEqual(
  taipeiVerticalSigns({ x0: 0, x1: 20, z0: 0, z1: 16, h: 22, mat: 4 }, { rank: 4 }),
  [], 'glass lots never sign, even on an arterial frontage');
assert.deepEqual(
  taipeiVerticalSigns({ x0: 0, x1: 20, z0: 0, z1: 16, h: 22, mat: 12 }, { rank: 4 }),
  [], 'family 12 never signs, even on an arterial frontage');

// --- Census pins (measured on the fixed tree) ------------------------
// Pristine main: 23,718 signed lots / 32,685 panels / 42,940
// shopfront lots, of which 18,451 signed / 25,447 panels / 33,045
// shopfronts sat on rank 0–1 frontage. After the gate all of those
// are gone; the commercial remainder is untouched.
// Issue #355: signed lots 23,718 -> 5,267; panels 32,685 -> 7,238.
assert.equal(signedLots, 5267, 'signed lots after the residential gate');
assert.equal(panels, 7238, 'sign panels after the residential gate');
// Issue #355: 59,760 lots (the rank 0–1 set, 76.8% of the city)
// carry the shop gate.
assert.equal(shops0, 59760, 'shop-gated lots after the residential gate');
// Roof boards are already rank-gated (#153) and untouched by #355.
assert.equal(
  opts.lots.filter((l) => l.roofBoards?.length).length, 757, 'roof-board lots unchanged');
// The plan itself is untouched by #355 (render-only: the adapter
// output changes, the lot rects do not).
assert.equal(plan.lots.length, 77808, 'plan lots unchanged');
assert.equal(opts.lots.length, plan.lots.length, 'adapter lots match the plan');

// --- Upstream honouring ----------------------------------------------
// populatePlannedLot passes the adapter's lot.shops through to
// commit's shops probability (js/buildings.js); Manhattan lots never
// carry the field, so NYC is untouched. Pinned by source, in the
// taipei-farfade.test.mjs pattern: the behaviour cannot run in node
// without three.js, so the test pins the wiring itself.
const buildingsSource = readFileSync(new URL('../js/buildings.js', import.meta.url), 'utf8');
assert.match(buildingsSource, /shops: lot\.shops \?\? \[0\.85, 0\.9, 0\.45, 0\.35, 0\.35, 0\.3\]\[mat - 6\]/,
  'Taiwan-type commit honours lot.shops');
assert.match(buildingsSource, /shops: lot\.shops \?\? 0\.3/g,
  'glass and masonry commits honour lot.shops');
assert.ok(buildingsSource.includes("lot.shops ?? [0.85"),
  'lot.shops override present in populatePlannedLot');
