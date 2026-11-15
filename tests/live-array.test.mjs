import assert from 'node:assert/strict';
import test from 'node:test';

import { refillLiveArray, LIVE_ARRAY_CHUNK } from '../js/live-array.js';

// Issue #407 — the live site died at boot with
// `RangeError: Maximum call stack size exceeded` in `syncAllColliders`
// (main.js:226): `allColliders.push(...a, ...b, ...)` spread ~100k
// colliders into one push() call, past the browser's max argument
// count. The fix refills live arrays in bounded chunks via
// refillLiveArray (js/live-array.js, pure, no imports). These tests
// pin the contract: same array reference, old contents dropped,
// sources concatenated in order, nullish sources skipped, and a
// production-scale refill (the measured combined collider count on
// the merged tree) completing with the exact contents.

test('refillLiveArray: refills in place, same reference, old contents dropped', () => {
  const target = [1, 2, 3];
  const out = refillLiveArray(target, [4, 5]);
  assert.equal(out, target, 'returns the same array');
  assert.deepEqual(target, [4, 5]);
});

test('refillLiveArray: concatenates sources in order, skips nullish sources', () => {
  const target = [];
  refillLiveArray(target, [1, 2], null, [3], undefined, [4, 5, 6]);
  assert.deepEqual(target, [1, 2, 3, 4, 5, 6]);
});

test('refillLiveArray: chunk size is small enough to never cross the argument limit', () => {
  assert.ok(LIVE_ARRAY_CHUNK <= 8192, `chunk ${LIVE_ARRAY_CHUNK} is bounded`);
  assert.ok(LIVE_ARRAY_CHUNK > 0, 'chunk is positive');
});

test('refillLiveArray: production-scale refill keeps exact contents and order', () => {
  // Measured combined collider count on the merged tree (main
  // a1c35389): cityBlocks.colliders (105,691, real buildCityBlocks)
  // + cityGrid.colliders (22,444, taipeiExtraColliders) = 128,135.
  const N = 128135;
  const a = Array.from({ length: 105691 }, (_, i) => i);
  const b = Array.from({ length: N - 105691 }, (_, i) => 1000000 + i);
  const target = ['stale'];
  refillLiveArray(target, a, b);
  assert.equal(target.length, N);
  assert.equal(target[0], 0);
  assert.equal(target[105690], 105690);
  assert.equal(target[105691], 1000000);
  assert.equal(target[N - 1], 1000000 + (N - 105691 - 1));
});
