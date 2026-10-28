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
  // is the PRE-#208 selection count (identical axis/dir/size
  // distribution — the garnish changed no lot's hut), of which
  // 2,158 gable (35.0%), 5,362 patched panels over 3,640 huts,
  // 1,414 bumps (23.0%).
  assert.equal(hutLots, 6160, 'hut selection is the pre-#208 census');
  assert.equal(gable, 2158, 'gable census');
  assert.equal(patches, 5362, 'patch census');
  assert.equal(bumps, 1414, 'bump census');
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
