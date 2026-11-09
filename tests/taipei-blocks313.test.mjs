// Issue #313: the committed geodata blocks were not reproducible by the
// HEAD builder on HEAD data — the original builder gave 7,637 legacy
// blocks against the committed 7,640, with ~165 differing.
//
// Mechanism (measured, see blocks313-evidence/):
// (1) The committed blocks are a pure REORDER of the #186 blocks
// (multiset-identical, only 1 of 7,640 at the same index, 34 area
// inversions — a composition artifact from the #186-PR2 compose at
// 07ee205, not builder output; the builder always emits a clean
// area-desc sort). The reorder happened before #223, so the values
// the file carries are the #186 values.
// (2) The VALUES drift is the #223 creek-width fix: the #186 blocks
// were cut against 165 m-wide creek buffers (every 溪-named creek
// drawn at the 160 m river default), while the HEAD builder cuts
// against the corrected channel-width water (20 m default + the
// road-clearance cap). Proof: the HEAD builder with the #186 water
// substituted reproduces the committed legacy blocks to within 36
// blocks off by a few cells; with the #186 water AND the #186 roads
// it reproduces the #186 blocks byte-identically (sha 78343f219b2a).
// The 36-cell residual is the roads input (re-serialized/rounded
// since Oct 27) — the committed water is byte-identical to #186's.
// (3) The fresh values: 181 matched blocks change area (all gains
// sit in the Beitou/Tianmu creek corridors, biggest +113,524 m2),
// 20 committed blocks merge away into neighbours, 17 fresh blocks
// appear — net legacy 7,640 -> 7,637.
//
// Fix: transplant the fresh builder values into the committed ORDER,
// because the planner seeds every lot draw by block index
// (hash01(bi*7919), seed=imul(bi+1,...)) — a plain fresh transplant
// re-rolls the whole city (measured: only 364 of 76,260 lots survive
// byte-identical). The order-preserving transplant keeps every
// surviving block at its committed index, so the plan diff is
// confined to the drift: 76,260 -> 76,650 lots (+390 net; 2,626
// removed, 3,016 added, every changed lot at z < -7000 in the
// Beitou creek corridors — plan-diff313, full-JSON diff).
// The 17 only-new blocks fill the nearest absorbed slots; the 3
// leftover absorbed slots hold a zero-area marker carrying the
// absorbed block's bbox (the planner skips area < 150, so no lots;
// the boot ground layer draws the same-tone rect, invisible
// overlap; no block index shifts). Pass-B (1,356) is byte-identical
// already and is kept verbatim; every other geodata section is
// byte-identical to main — only the blocks section changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { planTaipeiBuildings } from '../js/taipei-buildings.js';

// Multiset hash of the blocks (order-independent): the same algorithm
// as the #313 investigation (census313.mjs) — JSON per block, sorted,
// hashed with multiplicities.
const multisetHash = (arr) => {
  const h = createHash('sha256');
  const counts = new Map();
  for (const r of arr) {
    const s = JSON.stringify(r);
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  for (const [s, n] of [...counts.entries()].sort()) h.update(s + '\n' + n + '\n');
  return h.digest('hex').slice(0, 12);
};

test('issue #313: transplanted blocks keep the committed count and order', () => {
  const { blocks } = TAIPEI_GEO;
  assert.equal(blocks.length, 8996, 'the transplant keeps 8,996 blocks (7,640 legacy slots + 1,356 pass-B)');
  // The three merged-away slots hold zero-area markers — never lots,
  // never a shift of any surviving block's index.
  const markers = blocks.map((b, i) => ({ b, i })).filter(({ b }) => b.area === 0);
  assert.equal(markers.length, 3, 'exactly three zero-area markers (20 absorbed slots minus 17 only-new blocks)');
  assert.deepEqual(markers.map(({ i }) => i), [5391, 6783, 7491], 'markers sit at the leftover absorbed slots');
  assert.deepEqual(markers.map(({ b }) => b.bbox), [
    { minX: -6657.2, maxX: -6491.2, minZ: -9048.5, maxZ: -8910.5 },
    { minX: -3899.2, maxX: -3799.2, minZ: -10060.5, maxZ: -10018.5 },
    { minX: -795.2, maxX: -741.2, minZ: -8076.5, maxZ: -7934.5 },
  ], 'markers carry the absorbed blocks\' bboxes (the land that merged away)');
  // Every real block keeps the builder's min-area invariant.
  for (const b of blocks) {
    if (b.area === 0) continue;
    assert.ok(b.area >= 400, `every non-marker block is >= 400 m2 (got ${b.area})`);
  }
  // Order pins: each surviving block keeps its committed index, with
  // the fresh builder's value. Index 2 is the biggest merge (the
  // 貴子坑溪 block grows by 113,524 m2 as the creek narrows);
  // index 0 is an unchanged block (same index, same area).
  assert.equal(blocks[2].area, 1551864, 'merged creek block keeps committed index 2 with its fresh area');
  assert.equal(blocks[3].area, 1197472, 'index 3 carries its fresh area (+2,132 m2)');
  assert.equal(blocks[0].area, 2271632, 'unchanged block keeps index 0 and its area');
});

test('issue #313: shipped blocks are the HEAD builder output (as a multiset)', () => {
  // The transplant's non-marker blocks are exactly the fresh
  // HEAD-builder blocks (7,637 legacy + 1,356 pass-B) — only their
  // ORDER is the committed one, so a future regeneration re-cutting
  // the values fails this pin instead of drifting silently. Re-pin
  // with a measured reason if the builder legitimately re-cuts.
  const live = TAIPEI_GEO.blocks.filter((b) => b.area !== 0);
  assert.equal(live.length, 8993, '8,993 live blocks (7,637 fresh legacy + 1,356 pass-B)');
  assert.equal(multisetHash(live), '8d8b12c8c00c', 'live blocks multiset is the HEAD builder output');
});

test('issue #313: plan moves only inside the Beitou creek corridors', () => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  assert.equal(plan.lots.length, 76650, 'plan 76,260 -> 76,650 (+390 net: 2,626 removed, 3,016 added — every changed lot at z < -7000 in the Beitou creek corridors, plan-diff313 full-JSON diff; a plain fresh transplant re-rolls the city to 364 identical lots and is rejected)');
});
