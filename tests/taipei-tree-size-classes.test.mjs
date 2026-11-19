// tests/taipei-tree-size-classes.test.mjs
// Issue #385: trees and bushes came in one size — every scale was
// a single continuous uniform draw, so most individuals landed near
// the mean (park trees 0.7–1.5, street trees 0.85–1.35, park bushes
// 0.55–1.40, street bushes 0.5–0.8). The fix is discrete size
// classes with a gap between them (pickSizeClass in
// taipei-streetscape.js): a few ~2x landmark trees (the park-tree
// heroes, unchanged), many medium, some ~0.5x saplings; distinct
// bush classes too. This pins the class mix on the real plan, the
// scale inside each class's range, and determinism (same inputs,
// same classes). Positions and counts are pinned by the existing
// streetscape2 tests and must not move.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  planTaipeiBuildings,
} from '../js/taipei-buildings.js';
import {
  TAIPEI_GEO,
} from '../js/taipei-geodata.js';
import {
  planParkTrees,
  planStreetTrees,
  TREE_SIZE_CLASSES,
  BUSH_SIZE_CLASSES,
  pickSizeClass,
} from '../js/taipei-streetscape.js';
import {
  planParkAmenities,
} from '../js/taipei-park-amenities.js';
import {
  planStreetAmenities,
} from '../js/taipei-street-amenities.js';

// The class picker itself: bands are the design shares, the scale
// lands inside the picked class's range, and the shares sum to 1.
test('pickSizeClass: bands follow the shares, scale stays in range', () => {
  for (const classes of [TREE_SIZE_CLASSES, BUSH_SIZE_CLASSES]) {
    assert.ok(Math.abs(classes.reduce((s, c) => s + c.share, 0) - 1) < 1e-9, 'shares sum to 1');
    let acc = 0;
    for (const c of classes) {
      const picked = pickSizeClass(classes, acc + c.share / 2, 0.5);
      assert.equal(picked.id, c.id, `mid-band ${c.share / 2} into ${c.id} picks ${c.id}`);
      assert.ok(picked.scale >= c.min && picked.scale <= c.max, `scale ${picked.scale} inside ${c.id} [${c.min}, ${c.max}]`);
      const lo = pickSizeClass(classes, acc + c.share / 2, 0);
      const hi = pickSizeClass(classes, acc + c.share / 2, 1);
      assert.equal(lo.scale, c.min, 'jitter 0 gives the class minimum');
      assert.equal(hi.scale, c.max, 'jitter 1 gives the class maximum');
      acc += c.share;
    }
  }
});

// Shares measured by census385.mjs on the branch tree, 2026-11-18
// (park 7,500; street 3,000; park bushes 10,360; street bushes
// 1,942). Bands are ±3 percentage points around the design shares
// — wide enough for the cap-thinning stride, tight enough that a
// class going missing fails.
function assertMix(actual, design, n, label) {
  for (const [id, share] of Object.entries(design)) {
    const got = (actual[id] || 0) / n;
    assert.ok(Math.abs(got - share) <= 0.03, `${label} ${id}: got ${(got * 100).toFixed(1)}%, want ${(share * 100).toFixed(1)}% ±3pp`);
  }
  for (const id of Object.keys(actual)) {
    assert.ok(id in design || id === 'hero', `${label}: unexpected class ${id}`);
  }
}

function assertInRange(items, classes, label) {
  const byId = Object.fromEntries(classes.map((c) => [c.id, c]));
  for (const t of items) {
    if (t.sizeClass === 'hero') {
      assert.ok(t.scale >= 1.9 && t.scale <= 2.4, `${label} hero scale ${t.scale} in [1.9, 2.4]`);
      continue;
    }
    const c = byId[t.sizeClass];
    assert.ok(c, `${label}: tree has a known size class (${t.sizeClass})`);
    assert.ok(t.scale >= c.min && t.scale <= c.max, `${label} ${t.sizeClass} scale ${t.scale} in [${c.min}, ${c.max}]`);
  }
}

test('real tile: park trees come in size classes', () => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  const a = planParkTrees(TAIPEI_GEO, plan);
  const b = planParkTrees(TAIPEI_GEO, plan);
  assert.equal(a.trees.length, 7500, 'park tree count unchanged');
  assert.deepEqual(
    a.trees.map((x) => [x.x, x.z, x.scale, x.sizeClass]),
    b.trees.map((x) => [x.x, x.z, x.scale, x.sizeClass]),
    'identical inputs plant identical sized trees',
  );
  assertMix(a.stats.bySizeClass, { sapling: 0.12, medium: 0.63, large: 0.25 }, a.trees.length, 'park trees');
  assert.ok(a.stats.heroes > 0 && a.stats.heroes < 300, `heroes still rare (${a.stats.heroes})`);
  assert.equal(a.stats.bySizeClass.hero, a.stats.heroes, 'every hero carries the hero class');
  assertInRange(a.trees, TREE_SIZE_CLASSES, 'park tree');
});

test('real tile: street trees come in size classes', () => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  const a = planStreetTrees(TAIPEI_GEO, plan);
  assert.equal(a.trees.length, 3000, 'street tree count unchanged (capped)');
  assertMix(a.stats.bySizeClass, { sapling: 0.12, medium: 0.63, large: 0.25 }, a.trees.length, 'street trees');
  assertInRange(a.trees, TREE_SIZE_CLASSES, 'street tree');
});

test('real tile: park and street bushes come in size classes', () => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  const park = planParkAmenities(TAIPEI_GEO, plan);
  const street = planStreetAmenities(TAIPEI_GEO, plan);
  assert.ok(park.items.bush.length > 5000, `park bushes planted (${park.items.bush.length})`);
  assert.ok(street.items.bush.length > 1000, `street bushes planted (${street.items.bush.length})`);
  const parkMix = {};
  for (const t of park.items.bush) parkMix[t.sizeClass] = (parkMix[t.sizeClass] || 0) + 1;
  const streetMix = {};
  for (const t of street.items.bush) streetMix[t.sizeClass] = (streetMix[t.sizeClass] || 0) + 1;
  assertMix(parkMix, { small: 0.25, medium: 0.55, large: 0.20 }, park.items.bush.length, 'park bushes');
  assertMix(streetMix, { small: 0.25, medium: 0.55, large: 0.20 }, street.items.bush.length, 'street bushes');
  assertInRange(park.items.bush, BUSH_SIZE_CLASSES, 'park bush');
  assertInRange(street.items.bush, BUSH_SIZE_CLASSES, 'street bush');
});

console.log('taipei-tree-size-classes.test.mjs: all assertions passed');
