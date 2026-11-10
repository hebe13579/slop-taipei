// Issue #314: the committed geodata heights section was the #258 v4
// region-filtered composition (27,003 footprints, 155,762 doors) — the
// old interior's real heights never made it in, even though the
// committed data file (tools/taipei/data/osm_heights.json, built
// 2026-11-04) already carries them. A fresh HEAD-builder run on HEAD
// data emits 28,068 footprints + 162,429 doors: the gap is 1,065
// footprints + 6,667 doors, ALL only-fresh, ALL in the old interior
// (footprint centroids lat 25.0779-25.1108, lon 121.5338-121.5740;
// 714 of them at lat <= 25.085), 0 only-committed.
//
// Reconciliation of the two earlier measurements (see
// heights314-evidence/): #314's 1,067 footprints / 6,667 doors were
// counted at the DATA-file level (Nov 4 rebuild vs the Oct-25 file);
// the doors match EXACTLY (6,667) and the 2-footprint difference is
// matcher/quantization noise between the data-level and geodata-level
// comparisons. #313's +1,062 footprints / +20,001 doors were the same
// gap counted two other ways: 20,001 is the FLAT-ELEMENT count of the
// door array (20,001 / 3 = 6,667 door points exactly), and 1,062 is a
// SET-collapsed count of footprint JSONs (the fresh array carries 3
// duplicated footprint JSONs, so the true multiset difference is
// 1,065). The true gap is 1,065 footprints + 6,667 doors.
//
// Fix: transplant the fresh builder values into the committed ORDER,
// because the planner's footprint join is first-hit-wins among
// overlapping same-source footprints (footprintSignalAt keeps the
// first permit and first OSM hit per grid bucket) — a naive rebuild
// in data-file order flips 701 lots' winners (measured: naive-order
// plan vs transplant plan, 77,107 identical of 77,808, 701 lots
// differ, hSrc histograms identical — a pure permutation). The
// order-preserving transplant keeps the 27,003 committed entries at
// their EXACT committed indices and appends the 1,065 new footprints
// + 6,667 new doors at the end (fresh order among themselves), so
// no old-vs-old winner flips and no new footprint ever beats an old
// one at the same point. The guard corroboration is an existence
// check (order-independent) and the door medians / field tier are
// order-independent, so the array order is the only sensitivity and
// the transplant removes it.
//
// Plan effect (measured, plan-diff2-314, full-JSON diff): 76,650 ->
// 77,808 lots (+1,158 net; 2,403 removed, 3,561 added; every changed
// lot inside x -3265..494, z -8184..-4923, the old interior).
// Decomposed: new footprints alone (variant F) change 1,574 lots by
// height only (same count: proc -1,098, permit +339, osm-levels
// +260, osm-height +52, field +450); new doors alone (variant D)
// supply the whole +1,158 net — the door density flips 82 blocks to
// fine grain (blocksFine 3,388 -> 3,470, lotsFine 51,241 -> 52,867),
// re-subdividing them into more, smaller lots. The old city was
// under-subdivided because its door plates were missing (#124).
// Registry identical (56).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { planTaipeiBuildings } from '../js/taipei-buildings.js';

// Multiset hash of an array (order-independent): the same algorithm
// as the #313 test — JSON per entry, sorted, hashed with
// multiplicities.
const multisetHash = (arr, keyFn) => {
  const h = createHash('sha256');
  const counts = new Map();
  for (const r of arr) {
    const s = keyFn(r);
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  for (const [s, n] of [...counts.entries()].sort()) h.update(s + '\n' + n + '\n');
  return h.digest('hex').slice(0, 12);
};

test('issue #314: transplanted heights keep the committed count, order, and values', () => {
  const { heights } = TAIPEI_GEO;
  assert.equal(heights.footprints.length, 28068, '27,003 committed + 1,065 only-fresh footprints');
  assert.equal(heights.doors.length, 487287, '155,762 committed + 6,667 only-fresh door points, flat [x, z, floors]');
  // The committed prefix keeps its exact #258 composition order:
  // the first 27,003 entries are the committed ones, byte-identical
  // in sequence (multiset hash pins the SET; the index pins below
  // pin the ORDER at the seams).
  assert.equal(
    multisetHash(heights.footprints.slice(0, 27003), (f) => JSON.stringify(f)),
    'e5b74d669ba6',
    'first 27,003 footprints are the committed set, in committed order',
  );
  // Seam pins: index 0 is the first committed entry, 27002 the last
  // committed entry (a south new-area OSM outline — the #258
  // composition appended new-area entries at the end), 27003 the
  // first appended old-interior entry, 28067 the last.
  assert.equal(heights.footprints[0].src, 'permit', 'fp[0] is the first committed permit');
  assert.equal(heights.footprints[0].floors, 6, 'fp[0] keeps its 6 floors');
  assert.deepEqual(heights.footprints[0].ring.slice(0, 4), [-3498.7, -9662.5, -3491.2, -9659.6], 'fp[0] keeps its ring');
  assert.equal(heights.footprints[27002].src, 'osm', 'fp[27002] is the last committed entry (south new-area OSM)');
  assert.equal(heights.footprints[27002].floors, 1, 'fp[27002] keeps its 1 floor');
  assert.equal(heights.footprints[27003].src, 'permit', 'fp[27003] is the first appended old-interior entry');
  assert.equal(heights.footprints[27003].floors, 1, 'fp[27003] is a 1-floor permit');
  assert.deepEqual(heights.footprints[27003].ring.slice(0, 4), [-2581.5, -7218.4, -2582, -7216.8], 'fp[27003] keeps its ring');
  assert.equal(heights.footprints[28067].src, 'osm', 'fp[28067] is the last appended entry');
  assert.equal(heights.footprints[28067].floors, 3, 'fp[28067] is a 3-floor OSM outline');
  // The appended entries are all old-interior: centroid lat range.
  const latOf = (z) => 25.0330 - z / 110990;
  let lat0 = 99, lat1 = -99;
  for (const f of heights.footprints.slice(27003)) {
    let sz = 0, n = 0;
    for (let k = 0; k < f.ring.length; k += 2) { sz += f.ring[k + 1]; n++; }
    const lat = latOf(sz / n);
    lat0 = Math.min(lat0, lat);
    lat1 = Math.max(lat1, lat);
  }
  assert.ok(lat0 >= 25.077 && lat1 <= 25.111, `appended footprints sit in the old interior (lat ${lat0.toFixed(4)}..${lat1.toFixed(4)})`);
  // Appended door seam pins.
  assert.deepEqual(
    heights.doors.slice(155762 * 3, 155762 * 3 + 3),
    [-1818.8, -5239.4, 4],
    'first appended door triple',
  );
  assert.deepEqual(
    heights.doors.slice(162429 * 3 - 3),
    [-1138.9, -6743.1, 1],
    'last appended door triple',
  );
});

test('issue #314: shipped heights are the HEAD builder output (as a multiset)', () => {
  // The transplant's values are exactly the fresh HEAD-builder
  // output (28,068 footprints + 162,429 doors from the committed
  // data file) — only their ORDER is the committed one, so a future
  // regeneration re-cutting the values fails this pin instead of
  // drifting silently. Re-pin with a measured reason if the builder
  // legitimately re-cuts.
  const { heights } = TAIPEI_GEO;
  assert.equal(
    multisetHash(heights.footprints, (f) => JSON.stringify(f)),
    'd9a40798689c',
    'footprints multiset is the HEAD builder output',
  );
  const triples = [];
  for (let i = 0; i < heights.doors.length; i += 3) triples.push([heights.doors[i], heights.doors[i + 1], heights.doors[i + 2]]);
  assert.equal(
    multisetHash(triples, (t) => JSON.stringify(t)),
    'd9fd44571fc6',
    'doors multiset is the HEAD builder output',
  );
});

test('issue #314: plan moves only inside the old interior', () => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  assert.equal(plan.lots.length, 77808, 'plan 76,650 -> 77,808 (+1,158 net: 2,403 removed, 3,561 added — every changed lot inside x -3265..494, z -8184..-4923, the old interior; plan-diff2-314 full-JSON diff; a naive data-file-order rebuild flips 701 lots\' overlap winners and is rejected)');
});
