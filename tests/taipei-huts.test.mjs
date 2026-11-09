// Issue #208: the 鐵皮屋 detail vocabulary — gable forms, patched
// sheet panels and roof bumps, all seeded off the hut's lot hash.
// The invariants pinned here:
//   (a) SELECTION IS UNTOUCHED: the same lots carry huts as before
//       #208 (the garnish rolls use fresh hash salts), so the hut
//       rate over the synthetic scan and the real-plan hut census
//       match the pre-#208 numbers exactly;
//   (b) the garnish distribution lands in its designed bands, is
//       deterministic per lot, and a patch never wears its hut's
//       own colour;
//   (c) the renderer's palette literal mirrors the planner's
//       TAIPEI_HUT_COLORS (the two lists must never drift);
//   (d) every garnish pool in js/buildings.js follows the #156
//       upload discipline — count set, instanceMatrix flagged, and
//       instanceColor both written per fill and flagged — the
//       contract whose breach shipped the flashing roofs twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import {
  planTaipeiBuildings, taipeiCityBlocksOptions, taipeiRooftopAdditions,
  TAIPEI_HUT_COLORS,
} from '../js/taipei-buildings.js';

test('hut garnish: seeded forms, patches and bumps on the synthetic scan', (t) => {
  let huts = 0, gable = 0, patched = 0, patchTotal = 0, bumps = 0;
  for (let i = 0; i < 4000; i++) {
    const lot = { x0: i * 37.3, x1: i * 37.3 + 18, z0: (i % 61) * 29.7, z1: (i % 61) * 29.7 + 15, h: 20, mat: 6 };
    const gear = { maxH: 20.7, waterTowers: [], hvacUnits: [] };
    const adds = taipeiRooftopAdditions(gear, lot, []);
    if (i === 0) assert.deepEqual(taipeiRooftopAdditions(gear, lot, []), adds, 'garnish is deterministic per lot');
    for (const hu of adds.huts) {
      huts++;
      assert.ok(hu.form === 'single' || hu.form === 'gable', `hut form is one of the two forms (${hu.form})`);
      if (hu.form === 'gable') gable++;
      assert.ok(Array.isArray(hu.patches) && hu.patches.length <= 2, 'at most two patched panels');
      if (hu.patches.length) patched++;
      for (const p of hu.patches) {
        patchTotal++;
        assert.notEqual(p.colorIdx, hu.colorIdx, 'a patch never wears its hut’s own colour');
        assert.ok(p.u >= 0.2 && p.u <= 0.8 && Math.abs(p.v) <= 0.3, 'patch sits on the slope, not past its edges');
        assert.ok(p.w >= 1.2 && p.w <= 2.8 && p.d >= 0.9 && p.d <= 2.0, 'patch panel proportions in range');
        assert.ok(p.colorIdx >= 0 && p.colorIdx < TAIPEI_HUT_COLORS.length, 'patch tone is a palette tone');
      }
      if (hu.bump) {
        bumps++;
        assert.ok(hu.bump.wFrac >= 0.34 && hu.bump.wFrac <= 0.5, 'bump across fraction in range');
        assert.ok(hu.bump.dAlong >= 2.2 && hu.bump.dAlong <= 3.2, 'bump along-slope size in range');
        assert.ok(hu.bump.h >= 1.1 && hu.bump.h <= 1.7, 'bump height in range');
      }
    }
  }
  const gableShare = gable / huts, patchShare = patched / huts, bumpShare = bumps / huts;
  t.diagnostic(`synthetic garnish: ${huts} huts, gable ${(gableShare * 100).toFixed(1)}%, patched ${(patchShare * 100).toFixed(1)}% (${patchTotal} panels), bumps ${(bumpShare * 100).toFixed(1)}%`);
  assert.ok(gableShare > 0.27 && gableShare < 0.43, `gable share at its ~35% design point (${gableShare.toFixed(3)})`);
  assert.ok(patchShare > 0.5 && patchShare < 0.66, `patched-hut share at its ~58% design point (${patchShare.toFixed(3)})`);
  assert.ok(bumpShare > 0.18 && bumpShare < 0.32, `bump share at its ~25% design point (${bumpShare.toFixed(3)})`);
});

test('hut census on the real plan: selection unchanged, garnish at census', (t) => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  const frameLots = taipeiCityBlocksOptions(TAIPEI_GEO, plan).lots;
  let hutLots = 0, gable = 0, patches = 0, bumps = 0;
  for (const lot of frameLots) {
    const adds = taipeiRooftopAdditions({ maxH: lot.h }, lot, []);
    for (const hu of adds.huts) {
      hutLots++;
      if (hu.form === 'gable') gable++;
      patches += hu.patches.length;
      if (hu.bump) bumps++;
    }
  }
  t.diagnostic(`real-plan garnish census: ${hutLots} hut lots, ${gable} gable, ${patches} patches, ${bumps} bumps`);
  // Census measured at the #208 gate on this tree: 6,160 hut lots
  // on the PR base. Re-pinned at the merge gate on the composed
  // tree: 5,892 hut lots, 2,056 gable (34.9%), 5,149 patched
  // panels, 1,371 bumps. The invariant that matters — selection
  // UNCHANGED by the garnish — was proven at the gate by running
  // the PRE-#208 planner on this same tree: it also yields exactly
  // 5,892 hut lots. The 6,160 -> 5,892 move is tree composition
  // (#221 campus clearing: schools-off on this tree gives 6,571;
  // the rest is the #213/#219/#226 tree changes since the PR base),
  // not the garnish, whose rolls use fresh salts.
  // Re-pinned at the #289 gate: 5,891 hut lots, 1,380 bumps.
  // Exactly one hut lot is lost — (243.7, -229.3), removed by the
  // VieShow site rect (the lot stood inside it; the merged-tree
  // census proves main/base 5,892 vs merged/PR-head 5,891 with
  // that single centre lost and none gained). The lot carried a
  // bump too, hence 1,381 -> 1,380. Gable/patches unchanged.
  // Issue #110: 4 more hut lots — the re-seated lots re-roll the hut selection (seeded from lot position/footprint).
  // Issue #258 (south expansion): 5,895 -> 6,560 hut lots — the
  // south's new lots re-roll the hut selection (seeded from lot
  // position/footprint); gable 2,058 -> 2,292, patches 5,121 ->
  // 5,647, bumps 1,381 -> 1,560, same +665/+234/+526/+179 class.
  // Issue #278: hut 6,560 -> 6,539 (−21: 20 hut lots removed by the
  // 3 registry sites, 1 kept lot flips hut status on the field
  // re-seat — lot-by-lot diff on this tree); the garnish moves with
  // the selection (gable 2,292 -> 2,286, patches 5,647 -> 5,624,
  // bumps 1,560 -> 1,553, measured on this tree).
  // Issue #282: hut 6,539 -> 6,552 (+13) — the re-faced lots
  // re-roll the hut selection (seeded from lot position/footprint);
  // the garnish moves with the selection (gable 2,286 -> 2,292,
  // patches 5,624 -> 5,667, bumps 1,553 -> 1,546, measured on this
  // tree). Proven by cross-run: with { facing: false } the census
  // returns to exactly 6,536 / 2,285 / 5,641 / 1,544 on BOTH this
  // tree and pristine main (facing282-evidence/proof-crossrun.mjs).
  assert.equal(hutLots, 6599, 'hut selection is the pre-#208 census'); // BATCH: measured on the merged tree — NOT the additive 6,551 (6,539 +13 −1); the re-seated lots re-roll hut status under the new facing rule (interaction −2) // Issue #313: hut 6,549 -> 6,599 (+50 - the re-gridded Beitou lots re-roll the hut selection, seeded from lot position/footprint)
  // Issue #326: hut 6,539 -> 6,538 (−1 — one hut lot removed by the
  // re-site; measured on this tree).
  // BATCH (merge of #329 + #332): composed values MEASURED on the merged tree.

  // Issue #216: the facing pass moves lots, and the garnish rolls
  // are seeded from lot position — 2 gable draws, 14 patch draws
  // and 10 bump draws flip, while the selection (5,892 hut lots)
  // is unchanged. Proven by cross-run: with { facing: false }
  // the census returns to exactly 2,056 / 5,149 / 1,371
  // (facing216b-evidence/proof-huts-off.mjs).
  // Issue #110: gable census 2,054 -> 2,058 — 4 more gable-roof lots (the re-seated lots re-roll the gable selection, same +4 as the hut census).
  // Issue #278: gable 2,292 -> 2,286 (−6, measured on this tree — the garnish moves with the hut selection).
  // Issue #282: gable 2,286 -> 2,292 (+6 — the re-faced lots re-roll the gable selection, same +13 class as the hut census; proven by the facing:false cross-run).
  assert.equal(gable, 2317, 'gable census'); // Issue #313: gable 2,292 -> 2,317 (+25 - the garnish moves with the hut selection)
  // Issue #110: patch census 5,135 -> 5,121 (-14) — the re-seated lots re-roll the roof-patch selection.
  // Issue #278: patches 5,647 -> 5,624 (−23, measured on this tree).
  // Issue #282: patches 5,624 -> 5,667 (+43 — the re-faced lots re-roll the roof-patch selection; proven by the facing:false cross-run).
  assert.equal(patches, 5711, 'patch census'); // BATCH: measured on the merged tree = #282's 5,667 + 1 // Issue #313: patches 5,668 -> 5,711 (+43 - the garnish moves with the hut selection)
  // Issue #110: bump census 1,380 -> 1,381 (+1) — the re-seated lots re-roll the roof-bump selection.
  // Issue #278: bumps 1,560 -> 1,553 (−7, measured on this tree).
  // Issue #282: bumps 1,553 -> 1,546 (−7 — the re-faced lots re-roll the roof-bump selection; proven by the facing:false cross-run).
  assert.equal(bumps, 1572, 'bump census'); // BATCH: measured on the merged tree = #282's 1,546 + 2 // Issue #313: bumps 1,548 -> 1,572 (+24 - the garnish moves with the hut selection)
  // Issue #326: gable 2,286 -> 2,288 (+2, measured on this tree — the re-seated lots re-roll the gable selection).
  // Issue #110: patch census 5,135 -> 5,121 (-14) — the re-seated lots re-roll the roof-patch selection.
  // Issue #278: patches 5,647 -> 5,624 (−23, measured on this tree).
  // Issue #326: patches 5,624 -> 5,627 (+3, measured on this tree — the re-seated lots re-roll the roof-patch selection).
  // Issue #110: bump census 1,380 -> 1,381 (+1) — the re-seated lots re-roll the roof-bump selection.
  // Issue #278: bumps 1,560 -> 1,553 (−7, measured on this tree).
  // Issue #326: bumps 1,553 -> 1,555 (+2, measured on this tree — the re-seated lots re-roll the roof-bump selection).
  // BATCH (merge of #329 + #332): composed values MEASURED on the merged tree.

});

test('renderer palette mirrors the planner palette', () => {
  assert.equal(TAIPEI_HUT_COLORS.length, 6, 'planner palette is the #208 six tones');
  const src = readFileSync(new URL('../js/buildings.js', import.meta.url), 'utf8');
  const m = src.match(/const hutPalette = \[([^\]]+)\]/);
  assert.ok(m, 'renderer hutPalette literal present');
  const rendererTones = [...m[1].matchAll(/0x[0-9a-f]+/gi)].map((x) => parseInt(x[0], 16));
  assert.deepEqual(rendererTones, TAIPEI_HUT_COLORS, 'renderer and planner hut palettes agree tone for tone');
});

test('garnish pools: the streamer flags every garnish instance colour for upload (source contract)', () => {
  const src = readFileSync(new URL('../js/buildings.js', import.meta.url), 'utf8');
  for (const [pool, counter] of [
    ['hutGableInst', 'gableCount'],
    ['hutPatchInst', 'patchCount'],
    ['hutBumpInst', 'bumpCount'],
    ['hutBumpRoofInst', 'bumpCount'],
  ]) {
    assert.match(src, new RegExp(`${pool}\\.count = ${counter};`), `${pool} count set from ${counter}`);
    assert.match(src, new RegExp(`flagRange\\(${pool}\\.instanceMatrix, ${counter}\\)`), `${pool} instanceMatrix flagged`);
    assert.match(src, new RegExp(`if \\(${pool}\\.instanceColor\\) flagRange\\(${pool}\\.instanceColor, ${counter}\\)`), `${pool} instanceColor flagged`);
    assert.match(src, new RegExp(`${pool}\\.setColorAt\\(${counter}, hutPalette`), `${pool} colour written per fill`);
  }
});
