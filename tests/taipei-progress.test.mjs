import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { TAIPEI_BUILD_STAGES, createBuildProgress } from '../js/taipei-progress.js';

// Issue #63 — real loading progress for tile construction. The stage
// list, weights and bookkeeping live in js/taipei-progress.js (pure);
// js/taipei-boot.js completes the stages in this order at the real
// builder boundaries, and js/main.js renders them in the loader.
// These tests pin the contract: the stage list and order, weights
// summing to the whole build, progress firing once per stage
// strictly monotonically 0 -> 1, and the boot source completing the
// stages in the pinned order (the boot smoke is the integration
// proof that they fire during a real build).

const EXPECTED_ORDER = ['ground', 'roads', 'junctions', 'medians', 'markings', 'decks', 'buildings', 'trees'];

test('taipei build stages: list, order, labels, weights', () => {
  assert.deepEqual(TAIPEI_BUILD_STAGES.map((s) => s.id), EXPECTED_ORDER);
  for (const s of TAIPEI_BUILD_STAGES) {
    assert.equal(typeof s.label, 'string');
    assert.ok(s.label.length > 0, `stage ${s.id} has a loader label`);
    assert.ok(s.weight > 0, `stage ${s.id} has a positive weight`);
  }
  const sum = TAIPEI_BUILD_STAGES.reduce((a, s) => a + s.weight, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `weights sum to 1 (got ${sum})`);
});

test('taipei build progress: fires per stage, strictly monotonic 0 -> 1', () => {
  const events = [];
  const progress = createBuildProgress((e) => events.push(e));
  let prev = 0;
  for (const [i, stage] of TAIPEI_BUILD_STAGES.entries()) {
    const fraction = progress.complete(stage.id, 'detail');
    assert.ok(fraction > prev, `fraction advances at stage ${stage.id} (${prev} -> ${fraction})`);
    assert.equal(fraction, progress.fraction);
    prev = fraction;
    const e = events[events.length - 1];
    assert.equal(e.stage, stage.id);
    assert.equal(e.label, stage.label);
    assert.equal(e.index, i);
    assert.equal(e.total, TAIPEI_BUILD_STAGES.length);
    assert.equal(e.fraction, fraction);
    assert.equal(e.detail, 'detail');
  }
  assert.equal(events.length, TAIPEI_BUILD_STAGES.length, 'one event per stage');
  assert.equal(prev, 1, 'the last stage completes the bar exactly');
  assert.equal(progress.done, true);
});

test('taipei build progress: duplicate completion does not double-count, unknown stage throws', () => {
  const events = [];
  const progress = createBuildProgress((e) => events.push(e));
  const first = progress.complete('ground');
  assert.equal(progress.complete('ground'), first, 'second completion of a stage is a no-op');
  assert.equal(events.length, 1, 'no second event fires');
  assert.throws(() => progress.complete('nope'), /unknown Taipei build stage/);
  assert.equal(progress.done, false);
});

test('taipei build progress: a build without a listener still tracks fractions', () => {
  const progress = createBuildProgress(undefined);
  for (const stage of TAIPEI_BUILD_STAGES) progress.complete(stage.id);
  assert.equal(progress.fraction, 1);
  assert.equal(progress.done, true);
});

// Source contracts: the boot must complete the pinned stages in the
// pinned order at its real builder boundaries, and main.js must wire
// the callback into the Taipei branch only (NYC keeps its bar as the
// plain compile fraction — progressBase stays 0 there).
const bootSource = readFileSync(new URL('../js/taipei-boot.js', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');

test('taipei-boot completes the stages in the pinned order (source contract)', () => {
  const calls = [...bootSource.matchAll(/await completeStage\('(\w+)'/g)].map((m) => m[1]);
  assert.deepEqual(calls, EXPECTED_ORDER, 'stage boundaries in buildTaipeiGround follow the stage table');
  assert.match(bootSource, /export async function buildTaipeiGround\(scene, tile, deps = \{\}\)/);
  assert.match(bootSource, /createBuildProgress\(deps\.onProgress\)/);
});

test('main.js wires onProgress into the Taipei build only (source contract)', () => {
  assert.match(mainSource, /await boot\.buildTaipeiGround\(scene, activeTile, \{/);
  assert.match(mainSource, /onProgress: \(\{ label, fraction \}\) =>/);
  assert.match(mainSource, /progressBase = TAIPEI_BUILD_PROGRESS_SHARE;/);
  // The shared compile phase offsets by progressBase; with NYC's 0
  // base the expression reduces to the historical done/jobs fraction.
  assert.match(mainSource, /setLoadingProgress\(progressBase \+ \(done \/ jobs\.length\) \* \(1 - progressBase\)\)/);
  assert.match(mainSource, /cityGrid = buildCityGrid\(scene\);/, 'NYC build call unchanged');
});
