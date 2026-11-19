import assert from 'node:assert/strict';
import test from 'node:test';

import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { planTaipeiBuildings } from '../js/taipei-buildings.js';
import { planParkTrees, PARK_TREE_CAP } from '../js/taipei-streetscape.js';
import { clampParkTreeDensity, PARK_TREE_DENSITY_STOPS } from '../js/settings.js';

// Issue #384 — park-tree density slider (1x / 5x / 10x, default 1x).
// Density tightens the planting grid by 1/sqrt(d) and raises the
// instance cap by d, with the accept field untouched — so the tree
// count scales ~d while groves, clearings and the edge bias keep
// their structure. All counts below are measured on main a899bdd9
// with the #384 planner (see parktrees384-evidence/census384.log);
// re-measure them if the plan or geodata regenerates.
//
// The six plans are built once at module scope and shared by the
// tests — each planParkTrees call costs 10–70 s on this VM, so
// re-planning per test would push the file past its timeout.

const plan = planTaipeiBuildings(TAIPEI_GEO);
const d1 = planParkTrees(TAIPEI_GEO, plan, { density: 1 });
const d1u = planParkTrees(TAIPEI_GEO, plan, { density: 1, cap: Number.MAX_SAFE_INTEGER });
const d5 = planParkTrees(TAIPEI_GEO, plan, { density: 5 });
const d5u = planParkTrees(TAIPEI_GEO, plan, { density: 5, cap: Number.MAX_SAFE_INTEGER });
const d10 = planParkTrees(TAIPEI_GEO, plan, { density: 10 });
const d10u = planParkTrees(TAIPEI_GEO, plan, { density: 10, cap: Number.MAX_SAFE_INTEGER });
const daan = (r) => r.trees.filter((x) => x.park === '大安森林公園').length;

test('density 1x reproduces today\'s planting exactly', () => {
  const def = planParkTrees(TAIPEI_GEO, plan);
  assert.deepEqual(d1.trees, def.trees, 'density 1 is the default call, tree for tree');
  assert.equal(d1.stats.cap, PARK_TREE_CAP);
  assert.equal(d1.trees.length, 7500, 'the 1x plan is capped at 7,500');
  assert.equal(d1.stats.capped, true);
  assert.equal(daan(d1), 127);
});

test('density scales the planting ~5x / ~10x, cap included', () => {
  // Raw (unthinned) planting scales with the grid: 50,961 -> 254,826
  // (5.00x) -> 509,223 (9.99x). Candidates scale the same way.
  assert.equal(d1u.trees.length, 50961);
  assert.equal(d5u.trees.length, 254826);
  assert.equal(d10u.trees.length, 509223);
  assert.equal(d5u.stats.totalCandidates, 730096);
  assert.equal(d10u.stats.totalCandidates, 1460143);
  // The default caps bind at every stop: 7,500 / 37,500 / 75,000.
  assert.equal(d5.stats.cap, 37500);
  assert.equal(d5.trees.length, 37500);
  assert.equal(d5.stats.capped, true);
  assert.equal(d10.stats.cap, 75000);
  assert.equal(d10.trees.length, 75000);
  assert.equal(d10.stats.capped, true);
  // Da'an Forest Park scales with the city: 127 -> 653 (5.14x) ->
  // 1,311 (10.3x) under the caps; unthinned 870 -> 4,441 (5.10x)
  // -> 8,909 (10.2x).
  assert.equal(daan(d5), 653);
  assert.equal(daan(d10), 1311);
  assert.equal(daan(d5u), 4441);
  assert.equal(daan(d10u), 8909);
  // The class mix moves with the cap, but the structure (groves,
  // clearings) is the same planting, denser — grove count is
  // density-invariant.
  assert.equal(d1u.stats.groves, 1291);
  assert.equal(d5u.stats.groves, 1291);
  assert.equal(d10u.stats.groves, 1291);
  assert.deepEqual(
    Object.fromEntries(Object.entries(d5.stats.byClass).map(([k, v]) => [k, v.trees])),
    { large: 30554, medium: 4886, small: 2053, tiny: 7 },
  );
  assert.deepEqual(
    Object.fromEntries(Object.entries(d10.stats.byClass).map(([k, v]) => [k, v.trees])),
    { large: 60283, medium: 9936, small: 4619, tiny: 162 },
  );
});

test('capped plans are subsets of the unthinned plan at the same density', () => {
  for (const [capped, full] of [[d1, d1u], [d5, d5u], [d10, d10u]]) {
    const fullSet = new Set(full.trees.map((x) => `${x.x},${x.z}`));
    assert.ok(capped.trees.every((x) => fullSet.has(`${x.x},${x.z}`)), 'capped plan is a subset of the unthinned plan');
  }
});

test('invalid densities fall back to 1x, never throw', () => {
  for (const bad of [0, -3, Number.NaN, 'dense', null, undefined]) {
    const r = planParkTrees(TAIPEI_GEO, plan, { density: bad });
    assert.deepEqual(r.trees, d1.trees, `density ${String(bad)} plans as 1x`);
  }
  // The settings clamp snaps to the nearest stop; ties snap down.
  assert.deepEqual(PARK_TREE_DENSITY_STOPS, [1, 5, 10]);
  assert.equal(clampParkTreeDensity(2), 1);
  assert.equal(clampParkTreeDensity(3), 1);
  assert.equal(clampParkTreeDensity(4), 5);
  assert.equal(clampParkTreeDensity(7), 5);
  assert.equal(clampParkTreeDensity(8), 10);
  assert.equal(clampParkTreeDensity('dense'), null);
  assert.equal(clampParkTreeDensity(Number.NaN), null);
});
