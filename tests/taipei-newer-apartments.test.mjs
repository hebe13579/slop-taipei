// Issue #256: two newer apartment archetypes as procedural facade
// families + massing — the modern white slab (10) and the neoclassical
// stone-clad luxury tower (11). The spawn rule is measured from the
// plan (see apartments256-evidence/measure256*.mjs): tall lots are
// scarce and narrow in the fine-grain plan, so the rule keys on height
// + a minimum narrow side, and the new families take their share from
// the Taiwan tall pool only — the glass accent roll runs first with
// its pre-#256 formula, so glass counts are untouched.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import {
  planTaipeiBuildings,
  taipeiCityBlocksOptions,
  officeCoreFor,
  facadeMatFor,
  newerApartmentKind,
  taipeiNewerApartmentParts,
  taipeiEntranceCanopy,
  taipeiNewerEntrance,
  NEWER_APARTMENT_MIN_DIM,
  NEWER_TOWER_INSET,
  NEWER_CROWN_INSET,
  NEWER_TWIN_GAP,
  NEWER_SLAB_MIN,
  NEWER_CANOPY_Y0,
  NEWER_CANOPY_Y1,
  NEWER_CANOPY_PROUD,
} from '../js/taipei-buildings.js';

function planAndOpts() {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  return { plan, opts: taipeiCityBlocksOptions(TAIPEI_GEO, plan) };
}

test('newer apartments: census pins — both families planted, glass untouched', (t) => {
  const { plan, opts } = planAndOpts();
  // Issue #110: plan 68,482 -> 68,472 — 23 bridge links re-admitted + 71 bed-end fusions re-seat 1,282 lots near the changed roadbeds (net -10).
  // Issue #258: plan 68,472 -> 76,367 (+7,895) — the south expansion; the new lots take their seeded family shares (see the family re-pins below).
  assert.equal(plan.lots.length, 76650, 'the rule moves families only — the lot count is the composed plan (issue #255 gate: 68,570 − 32 site-excluded lots; issue #289 gate: 68,538 − 56 site-excluded lots net; issue #278 gate: 76,367 − 158 site-excluded lots net); Issue #326: 76,209 -> 76,260 (+51 net: 127 lots added, 76 removed — lot-by-lot diff in ntsec326-evidence/lotdiff326.log; the re-site frees the old (wrong) site rects — the 280x160 ring rect and the 160x110 drum rect at the beige complex — and the old road chords, while the correct site rects + re-routed roads exclude lots in their place)'); // Issue #313: 76,260 -> 76,650 (+390 net: 3,016 added, 2,626 removed - every changed lot at z < -7000 in the Beitou creek corridors; full-JSON plan diff in blocks313-evidence/plan-diff-ordered313.log)
  const fam = {};
  for (const l of opts.lots) fam[l.mat] = (fam[l.mat] || 0) + 1;
  // Pinned at the #256 gate on the composed tree: 492 tall-Taiwan lots
  // convert (272 slab + 220 stone), all from families 6/8/9; family 7
  // (arcade) and the glass families keep their pre-#256 counts exactly.
  // Re-pinned from the branch-tree 267/218 at the gate: the branch base
  // predates the #270 facing pass, and with the facing probes guarded
  // (pre-#256 family, like the pull guard) a turned lot re-rolls its
  // rendered family at its final position. The plan itself is
  // byte-identical to main (0 differing lots, full-field diff), so
  // this is a census re-pin, not a moved city.
  // Issue #110: F10 272 -> 274 (+2) — the re-seated lots re-roll the newer-apartment families (2 more lots land in F10).
  // Issue #258: F10 274 -> 303 (+29), F11 220 -> 242 (+22) — the south expansion's 40 m+ lots take the newer-apartment families at their seeded shares.
  // Issue #278: F10 untouched (303); F11 242 -> 241 (−1 — one F11 lot removed by the VGH site; lot-by-lot diff on this tree).
  // Issue #282: F10 303 -> 297 (−6) — the re-faced lots re-roll
  // their rendered family at their final position (same facing-guard
  // mechanism as the #256 gate note); F11 untouched (241). Proven
  // by cross-run: with { facing: false } the families return to
  // exactly F10 295 / F11 239 on BOTH this tree and pristine main
  // (facing282-evidence/proof-crossrun.mjs).
  assert.equal(fam[10], 293, 'modern slab family planted in the hundreds'); // Issue #313: F10 297 -> 293 (-4 - 8 added, 12 removed, 0 kept lots flip family)
  assert.equal(fam[11], 238, 'neoclassical stone family planted in the hundreds'); // Issue #313: F11 241 -> 238 (-3 - 7 added, 11 removed, 1 net flip in)
  // Issue #255 gate: the 4 new sites exclude 32 lots; the removed
  // lots' families (lot-by-lot vs pristine main, diff265.mjs) are
  // 0:2, 1:2, 2:3, 3:2, 4:2, 5:3, 6:5, 7:1, 8:6, 9:6 — and the
  // field re-pool flips 6 lots next to the ATT site from field to
  // proc heights (28→52.5, 19→35, 14.5→25.5, 25.5→47.5 m), which
  // re-rolls 3 kept lots across the Taiwan families (0/1/7 lose one
  // each; 6 gains one, 9 gains two). Glass (3/4/5) is pure removal;
  // 10/11 and the twins are untouched.
  // Issue #289 gate: the 4 new sites exclude 56 lots net; the
  // removed lots' families (lot-by-lot vs pristine main,
  // facing-fam-measure.mjs — 65 full-field keys, the 56 removals
  // plus the 9 field re-seats at their old heights) are 0:3, 1:1,
  // 3:6, 4:6, 5:5, 6:19, 7:2, 8:7, 9:16; the 9 re-seats land in
  // 4:1, 5:1, 6:2, 8:1, 9:3 and one of 0/1/2 at their new heights,
  // so the census moves are 6:−17, 8:−6, 9:−13, 7:−2, 3:−6, 4:−5,
  // 5:−4. 10/11 and the twins are untouched.
  // Issue #17 slice 2 re-pins the Taiwan families: the low-band
  // Taiwan roll assigns F6–F9 their shares of the 6–15 m masonry
  // pool — F6 +4,477 (6–9 m: 1,091; 9–12 m: 1,395; 12–15 m: 1,991),
  // F7 +4,515 (1,116 / 1,402 / 1,997), F8 +3,434 (9–12 m: 1,399;
  // 12–15 m: 2,035), F9 +2,494 (1,003 / 1,491) — 14,920 lots in
  // all, exactly the masonry drop. Proven delta: the plan is
  // byte-identical (the pull/facing guards judge by the pre-slice-2
  // family, see facadeMatFor), so no lot moved — the whole delta
  // is the family re-assignment at the final positions. F10/F11
  // and the glass families are untouched by the change.
  // Issue #108 re-pins the Taiwan families: the two new families take
  // their shares from the Taiwan pools only — F12 (high-rise
  // residential) takes 606 lots from the 40–75 m tall-Taiwan remainder
  // (F6 −169: 40–50 m −103, 50–75 m −66; F8 −262: −173/−89; F9 −175:
  // −107/−68) and F13 (二丁掛 strip-tile) takes 4,358 lots from the
  // 9–30 m Taiwan pool (F6 −1,182: 9–12 m −169, 12–15 m −222, 15–22 m
  // −623, 22–30 m −168; F7 −1,160: −167/−243/−594/−156; F8 −1,183:
  // −154/−245/−615/−169; F9 −833: −115/−195/−423/−100). Proven delta:
  // the plan is byte-identical (both new rolls are guard-wrapped —
  // the pull/facing guards judge by the pre-#108 family, see
  // facadeMatFor — full-field diff, 0 moved lots), so the whole delta
  // is the family re-assignment at the final positions. Glass and
  // F10/F11 are untouched: their rolls evaluate first with the exact
  // pre-#108 formulas.
  // Issue #110: F6 10,672 -> 10,652 (-20) — the re-seated lots re-roll the renderer-options families.
  // Issue #258: the south expansion's new lots take their seeded Taiwan/glass shares — F6 10,652 -> 11,902 (+1,250), F8 9,484 -> 10,594 (+1,110), F9 7,243 -> 8,009 (+766), F7 10,037 -> 11,231 (+1,194), F12 609 -> 705 (+96), F13 4,377 -> 4,863 (+486), glass F3 5,126 -> 5,665 (+539), F4 1,062 -> 1,164 (+102), F5 999 -> 1,097 (+98).
  // Issue #278: the 3 registry sites exclude 158 lots net; the removed lots' families (lot-by-lot diff on this tree) are 0:15, 1:12, 2:8, 3:8, 5:2, 6:25, 7:22, 8:35, 9:19, 11:1, 12:1, 13:11, plus 1 added F0 re-seat and 2 kept lots re-rolling into glass (F7->F3, F8->F3) — so F6 −25, F8 −36, F9 −19, F7 −23, F12 −1, F13 −11, F3 −6, F5 −2, F4 0, F10 0, F11 −1.
  // Issue #282: the re-faced lots re-roll their renderer-options families (seeded from lot position/geometry) — F6 −3, F7 −2, F8 +3, F9 −6, F12 +8, F13 +3, glass F3/F4/F5 untouched. Proven by cross-run: with { facing: false } the whole histogram agrees exactly between this tree and pristine main (facing282-evidence/proof-families.mjs).
  assert.equal(fam[6], 11988, 'tile shophouse gives up its seeded share'); // BATCH: measured on the merged tree = #282's 11,874 + #326's +10 // Issue #313: F6 11,884 -> 11,988 (+104 - 374 added, 266 removed, 4 net flip out)
  // Issue #110: F8 9,476 -> 9,484 (+8).
  // Issue #282: F8 10,558 -> 10,561 (+3 — the re-faced lots re-roll the renderer-options families; proven by the facing:false cross-run).
  assert.equal(fam[8], 10649, 'walk-up slab gives up its seeded share'); // BATCH: measured on the merged tree = #282's 10,561 + #326's +13 // Issue #313: F8 10,574 -> 10,649 (+75 - 350 added, 271 removed, 4 net flip out)
  // Issue #110: F9 7,249 -> 7,243 (-6).
  // Issue #282: F9 7,990 -> 7,984 (−6 — same re-roll; proven by the facing:false cross-run).
  assert.equal(fam[9], 8011, 'pebble-dash gives up its seeded share'); // BATCH: measured on the merged tree = #282's 7,984 + #326's +6 // Issue #313: F9 7,990 -> 8,011 (+21 - 228 added, 207 removed, 0 flips)
  // Issue #110: F7 10,038 -> 10,037 (-1).
  // Issue #282: F7 11,208 -> 11,206 (−2 — same re-roll; proven by the facing:false cross-run).
  assert.equal(fam[7], 11273, 'arcade family: #256 never consults it, but #17 slice 2 assigns it the low-band share'); // BATCH: measured on the merged tree = #282's 11,206 + #326's +9 // Issue #313: F7 11,215 -> 11,273 (+58 - 347 added, 300 removed, 11 net flip in; same count as the taipei test)
  // Issue #110: F12 606 -> 609 (+3) — same delta as the taiwan108 test.
  // Issue #282: F12 704 -> 712 (+8 — same re-roll; proven by the facing:false cross-run).
  assert.equal(fam[12], 711, 'high-rise residential planted in the hundreds'); // BATCH: measured on the merged tree = #282's 712 + #326's +1 (same count in the taiwan108 test) // Issue #313: F12 713 -> 711 (-2 - 10 added, 12 removed, 0 flips; same count as the taiwan108 test)
  // Issue #110: F13 4,358 -> 4,377 (+19) — same delta as the taiwan108 test.
  // Issue #282: F13 4,852 -> 4,855 (+3 — same re-roll; proven by the facing:false cross-run).
  assert.equal(fam[13], 4892, 'strip-tile mid-rise planted in the thousands'); // BATCH: measured on the merged tree = #282's 4,855 + #326's +2 (same count in the taiwan108 test) // Issue #313: F13 4,857 -> 4,892 (+35 - 165 added, 129 removed, 1 net flip out; same count as the taiwan108 test)
  // Issue #326: the re-site re-seats lots near the two sites; the re-seated lots re-roll their families at their final positions (measured on this tree via famprobe326.mjs) — F6 +10, F8 +13, F9 +6, F7 +9, F12 +1, F13 +2, F3 +1, F4 +6, F5 +3; F10/F11 unchanged.
  // Issue #110: F8 9,476 -> 9,484 (+8).
  // Issue #110: F9 7,249 -> 7,243 (-6).
  // Issue #110: F7 10,038 -> 10,037 (-1).
  // Issue #110: F12 606 -> 609 (+3) — same delta as the taiwan108 test.
  // Issue #110: F13 4,358 -> 4,377 (+19) — same delta as the taiwan108 test.
  // BATCH (merge of #329 + #332): composed values MEASURED on the merged tree.

  // Issue #110: glass F3 5,127 -> 5,126 (-1) — the re-seated lots re-roll the glass accent.
  assert.equal(fam[3], 5705, 'glass family 3 untouched — the accent roll runs first'); // Issue #313: F3 5,660 -> 5,705 (+45 - 184 added, 135 removed, 4 net flip out; glass total 7,975, same as the taipei test)
  // Issue #110: glass F4 1,061 -> 1,062 (+1).
  assert.equal(fam[4], 1170, 'glass family 4 untouched');
  // Issue #110: glass F5 1,003 -> 999 (-4).
  assert.equal(fam[5], 1100, 'glass family 5 untouched'); // Issue #313: F5 1,098 -> 1,100 (+2 - 24 added, 19 removed, 3 net flip out)
  t.diagnostic(`families: ${JSON.stringify(fam)}`);
});

test('newer apartments: spawn rule invariants', () => {
  const { plan, opts } = planAndOpts();
  for (let i = 0; i < opts.lots.length; i++) {
    const l = opts.lots[i], p = plan.lots[i];
    if (l.mat !== 10 && l.mat !== 11) continue;
    assert.ok(l.h >= 40, `family ${l.mat} only on 40 m+ lots (lot ${i} at ${l.h} m)`);
    assert.ok(!officeCoreFor(p), `family ${l.mat} never inside an office core (lot ${i})`);
    assert.ok(Math.min(p.w, p.d) >= NEWER_APARTMENT_MIN_DIM, `family ${l.mat} only on lots ${NEWER_APARTMENT_MIN_DIM} m+ across (lot ${i}: ${p.w}x${p.d})`);
    assert.ok(l.newer, `family ${l.mat} lot carries its tower/crown parts (lot ${i})`);
    assert.ok(l.newer.towers.length >= 1 && l.newer.crowns.length === l.newer.towers.length, 'one crown per tower');
  }
  const f11 = opts.lots.filter((l) => l.mat === 11);
  assert.ok(f11.every((l) => l.entrance), 'every stone tower carries its entrance canopy + piers');
  assert.ok(opts.lots.filter((l) => l.mat === 10).every((l) => !l.entrance), 'slabs carry no canopy');
  // Twin slabs are the wide-lot minority: 19 of the 272 slab lots
  // (re-pinned from 18 at the gate — same facing-guard reason as above).
  // Issue #258: twins 19 -> 20 — the south expansion's wide lots add one more twin-slab complex, at (-1881, 566) in 7-south (Gongguan, just south of the Box A seam); the 19 old-city twins are unchanged.
  // Issue #282: twins 20 -> 19 (−1 — one wide lot's family re-rolls off the twin rule when its facing changes; proven by the facing:false cross-run, twins exactly 19 on both trees).
  const twins = opts.lots.filter((l) => l.mat === 10 && l.newer.twin);
  assert.equal(twins.length, 21, 'twin-slab complexes planted on the widest lots'); // Issue #313: twins 19 -> 21 (+2 - 6 twin-slabs added with the re-gridded Beitou lots, 4 removed: added at (-6403.6,-7486.5), (-6021.5,-7159.8), (-5992.1,-7323.2), (-6441.1,-9896.1/-9805.7/-9774.9); removed at (-6083.4,-7192.5), (-6054.2,-7192.5), (-5995.7,-7192.5), (-5615.5,-7519.2); all in Beitou)
});

test('newer apartments: rule is deterministic and height-banded', () => {
  // The frontage-pull guard probes facadeMatFor at seven heights; the
  // new-type choice must be stable per lot and must not leak below
  // the 40 m band at any probe height the guard uses.
  const probe = (h) => ({ x: -1234.5, z: 6789.1, w: 20, d: 18, h });
  for (const h of [6, 13, 18, 26, 33, 38]) {
    assert.ok(facadeMatFor(probe(h)) !== 10 && facadeMatFor(probe(h)) !== 11, `no new type at ${h} m`);
  }
  assert.equal(facadeMatFor(probe(40)), facadeMatFor(probe(50)), 'same family across the tall band');
  assert.equal(facadeMatFor(probe(50)), facadeMatFor(probe(50)), 'deterministic per lot');
  const narrow = (h) => ({ x: 10, z: 20, w: 12, d: 20, h });
  assert.ok(facadeMatFor(narrow(50)) !== 10 && facadeMatFor(narrow(50)) !== 11, 'narrow lot never converts, even tall');
  // Guard mode (issue #256): the frontage-pull guard judges landings
  // by the pre-#256 family, so #256 moves no lot — guard mode never
  // returns a new type, at any probe height, on a lot that converts.
  for (const h of [6, 13, 18, 26, 33, 38, 50]) {
    const g = facadeMatFor(probe(h), { guard: true });
    assert.ok(g !== 10 && g !== 11, `guard mode never returns a new type at ${h} m`);
    assert.ok(g >= 0 && g <= 9, 'guard mode stays in the pre-#256 families');
  }
});

test('newer apartment parts: single tower geometry', () => {
  const lot = { x0: 0, x1: 20, z0: 0, z1: 18 };
  const parts = taipeiNewerApartmentParts(lot);
  assert.ok(parts && !parts.twin, 'narrow lot gets a single tower');
  assert.equal(parts.towers.length, 1);
  assert.deepEqual(parts.towers[0], {
    x0: NEWER_TOWER_INSET, x1: 20 - NEWER_TOWER_INSET,
    z0: NEWER_TOWER_INSET, z1: 18 - NEWER_TOWER_INSET,
  });
  assert.deepEqual(parts.crowns[0], {
    x0: NEWER_TOWER_INSET + NEWER_CROWN_INSET, x1: 20 - NEWER_TOWER_INSET - NEWER_CROWN_INSET,
    z0: NEWER_TOWER_INSET + NEWER_CROWN_INSET, z1: 18 - NEWER_TOWER_INSET - NEWER_CROWN_INSET,
  });
  for (const r of [...parts.towers, ...parts.crowns]) {
    assert.ok(r.x0 >= lot.x0 && r.x1 <= lot.x1 && r.z0 >= lot.z0 && r.z1 <= lot.z1, 'parts stay inside the lot rect');
    assert.ok(r.x1 - r.x0 >= 0.5 && r.z1 - r.z0 >= 0.5, 'parts survive the mass() minimum-size skip');
  }
});

test('newer apartment parts: twin slabs split along the long axis', () => {
  const lotX = { x0: 0, x1: 34, z0: 0, z1: 20 };
  const px = taipeiNewerApartmentParts(lotX);
  assert.ok(px.twin && px.towers.length === 2, 'wide lot splits along x');
  const gapX = px.towers[1].x0 - px.towers[0].x1;
  assert.ok(Math.abs(gapX - NEWER_TWIN_GAP) < 1e-9, `twin gap is ${NEWER_TWIN_GAP} m`);
  const slabW = px.towers[0].x1 - px.towers[0].x0;
  assert.ok(slabW >= NEWER_SLAB_MIN, `each slab is an honest tower (${slabW.toFixed(1)} m)`);
  assert.ok(Math.abs(slabW - (px.towers[1].x1 - px.towers[1].x0)) < 1e-9, 'slabs are equal');
  assert.ok(px.towers[0].x0 >= lotX.x0 && px.towers[1].x1 <= lotX.x1, 'slabs stay inside the lot');
  assert.equal(px.crowns.length, 2, 'one crown per slab');

  const lotZ = { x0: 0, x1: 20, z0: 0, z1: 34 };
  const pz = taipeiNewerApartmentParts(lotZ);
  assert.ok(pz.twin && pz.towers.length === 2, 'long lot splits along z');
  assert.ok(Math.abs((pz.towers[1].z0 - pz.towers[0].z1) - NEWER_TWIN_GAP) < 1e-9, 'twin gap along z');

  // A lot whose long side is long but narrow side is under the rule
  // minimum gets no parts (defensive: facadeMatFor gates it anyway).
  assert.equal(taipeiNewerApartmentParts({ x0: 0, x1: 40, z0: 0, z1: 10 }), null, 'too-narrow lot gets no parts');
});

test('newer apartment entrance: canopy + piers per face, face picked by length', () => {
  const lot = { x0: 0, x1: 24, z0: 0, z1: 16 };
  const s = taipeiEntranceCanopy(lot, 's');
  assert.ok(s, 'south canopy exists');
  assert.equal(s.canopy.y0, NEWER_CANOPY_Y0, 'canopy caps the ground floor');
  assert.equal(s.canopy.y1, NEWER_CANOPY_Y1);
  assert.ok(Math.abs(s.canopy.z1 - (lot.z1 + NEWER_CANOPY_PROUD)) < 1e-9, 'fascia stands 0.05 m proud of the face');
  assert.equal(s.piers.length, 2, 'two flanking piers');
  for (const p of s.piers) {
    assert.equal(p.y0, 0, 'piers run from the ground');
    assert.equal(p.y1, NEWER_CANOPY_Y0, 'piers meet the canopy underside');
    assert.ok(p.x0 >= lot.x0 - NEWER_CANOPY_PROUD - 1e-9 && p.x1 <= lot.x1 + NEWER_CANOPY_PROUD + 1e-9, 'piers stay within the face + fascia plane');
  }
  const e = taipeiEntranceCanopy(lot, 'e');
  assert.ok(Math.abs(e.canopy.x1 - (lot.x1 + NEWER_CANOPY_PROUD)) < 1e-9, 'east fascia proud of the east face');
  const n = taipeiEntranceCanopy(lot, 'n');
  assert.ok(Math.abs(n.canopy.z0 - (lot.z0 - NEWER_CANOPY_PROUD)) < 1e-9, 'north fascia proud of the north face');
  const w = taipeiEntranceCanopy(lot, 'w');
  assert.ok(Math.abs(w.canopy.x0 - (lot.x0 - NEWER_CANOPY_PROUD)) < 1e-9, 'west fascia proud of the west face');

  // Face pick: longest face wins, ties prefer south.
  assert.equal(taipeiNewerEntrance(lot).canopy.z1, s.canopy.z1, 'wider lot takes the south face');
  const tall = { x0: 0, x1: 16, z0: 0, z1: 24 };
  assert.equal(taipeiNewerEntrance(tall).canopy.x1, taipeiEntranceCanopy(tall, 'e').canopy.x1, 'taller lot takes the east face');
  const square = { x0: 0, x1: 20, z0: 0, z1: 20 };
  assert.equal(taipeiNewerEntrance(square).canopy.z1, taipeiEntranceCanopy(square, 's').canopy.z1, 'square lot prefers south');
  // A face shorter than ~3.3 m is too short for a canopy (cw < 2 m).
  assert.equal(taipeiEntranceCanopy({ x0: 0, x1: 3, z0: 0, z1: 20 }, 's'), null, 'no canopy on a sliver face');
});

test('newer apartments: every part stays within the cleared lot (no roadbed reach)', () => {
  const { opts } = planAndOpts();
  for (const l of opts.lots) {
    if (!l.newer) continue;
    const rects = [...l.newer.towers, ...l.newer.crowns];
    for (const r of rects) {
      assert.ok(r.x0 >= l.x0 - 1e-9 && r.x1 <= l.x1 + 1e-9 && r.z0 >= l.z0 - 1e-9 && r.z1 <= l.z1 + 1e-9,
        'tower/crown parts never leave the lot rect the exclusion gauntlet cleared');
    }
    if (l.entrance) {
      const c = l.entrance.canopy;
      assert.ok(c.x0 >= l.x0 - NEWER_CANOPY_PROUD - 1e-9 && c.x1 <= l.x1 + NEWER_CANOPY_PROUD + 1e-9 &&
        c.z0 >= l.z0 - NEWER_CANOPY_PROUD - 1e-9 && c.z1 <= l.z1 + NEWER_CANOPY_PROUD + 1e-9,
        'canopy overhang is the 0.05 m fascia only');
    }
  }
});
