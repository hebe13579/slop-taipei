// Issue #108: two more Taiwan facade families — the high-rise
// residential slab (12, 電梯大樓/華廈, 40–75 m) and the 二丁掛
// strip-tile mid-rise (13, 9–30 m). The census pins for both live in
// tests/taipei-newer-apartments.test.mjs (with the F6–F9 re-pin
// reasons); this file pins the families' own invariants: their height
// bands, the core rule, the guard-mode contract, determinism, the
// F12 roof tanks, the F13 vertical signs, and the strip-tile shader
// parameter the families introduce.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import {
  planTaipeiBuildings,
  taipeiCityBlocksOptions,
  officeCoreFor,
  facadeMatFor,
  highRiseTaiwanKind,
  stripTileKind,
  taipeiRooftopAdditions,
  taipeiVerticalSigns,
  HIGH_RISE_TAIWAN_SHARE,
  HIGH_RISE_TAIWAN_MIN_H,
  HIGH_RISE_TAIWAN_MAX_H,
  STRIP_TILE_SHARE,
  STRIP_TILE_MIN_H,
  STRIP_TILE_MAX_H,
} from '../js/taipei-buildings.js';

function planAndOpts() {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  return { plan, opts: taipeiCityBlocksOptions(TAIPEI_GEO, plan) };
}

test('taiwan108: high-rise residential (12) is banded 40-75 m, outside the cores', () => {
  const { plan, opts } = planAndOpts();
  const f12 = opts.lots.filter((l) => l.mat === 12);
  // Issue #110: the re-seated lots re-roll families in the plan itself — F12 606 -> 609 (facadeMatFor is the assignment, so the renderer options agree).
  // Re-pinned for issue #258 (south expansion): the south's tall
  // residential takes F12 609 -> 705 (probe: newer-apartments
  // census; same count in both tests).
  // Issue #278: F12 705 -> 704 (−1 — one F12 lot removed by the VGH site; same count in the newer-apartments test).
  // Issue #282: F12 704 -> 712 (+8 — the re-faced lots re-roll their renderer-options families; same count in the newer-apartments test; proven by the facing:false cross-run, F12 exactly 702 on both trees).
  assert.equal(f12.length, 712, 'high-rise residential planted in the hundreds');
  for (let i = 0; i < opts.lots.length; i++) {
    const l = opts.lots[i];
    if (l.mat !== 12) continue;
    assert.ok(l.h >= HIGH_RISE_TAIWAN_MIN_H && l.h < HIGH_RISE_TAIWAN_MAX_H,
      `family 12 only on 40-75 m lots (lot ${i} at ${l.h} m)`);
    assert.ok(!officeCoreFor(plan.lots[i]), `family 12 never inside an office core (lot ${i})`);
  }
  // The share is a seeded 40% of the tall-Taiwan remainder — the roll
  // itself is pinned, not just the census.
  assert.equal(HIGH_RISE_TAIWAN_SHARE, 0.40, 'high-rise share is the 40% design point');
});

test('taiwan108: strip-tile mid-rise (13) is banded 9-30 m', () => {
  const { opts } = planAndOpts();
  const f13 = opts.lots.filter((l) => l.mat === 13);
  // Issue #110: F13 4,358 -> 4,377 in the plan itself (same mechanism as F12).
  // Re-pinned for issue #258 (south expansion): the south's mid-rise
  // takes F13 4,377 -> 4,863 (same count in the newer-apartments test).
  // Issue #278: F13 4,863 -> 4,852 (−11 — eleven F13 lots removed by the 3 sites; same count in the newer-apartments test).
  // Issue #282: F13 4,852 -> 4,855 (+3 — same re-roll; same count in the newer-apartments test; proven by the facing:false cross-run, F13 exactly 4,860 on both trees).
  assert.equal(f13.length, 4855, 'strip-tile mid-rise planted in the thousands');
  for (const l of f13) {
    assert.ok(l.h >= STRIP_TILE_MIN_H && l.h < STRIP_TILE_MAX_H,
      `family 13 only on 9-30 m lots (at ${l.h} m)`);
  }
  assert.equal(STRIP_TILE_SHARE, 0.12, 'strip-tile share is the 12% design point');
});

test('taiwan108: the new rolls are deterministic and height-banded', () => {
  // The frontage-pull guard probes facadeMatFor at seven heights; the
  // new-type choice must be stable per lot and must not leak outside
  // its band at any probe height the guard uses.
  const probe = (h) => ({ x: -1234.5, z: 6789.1, w: 20, d: 18, h });
  for (const h of [6, 13, 18, 26, 33, 38]) {
    assert.ok(facadeMatFor(probe(h)) !== 12, `no high-rise type at ${h} m`);
  }
  assert.ok(facadeMatFor(probe(80)) !== 12, 'no high-rise type at 80 m (capped at 75)');
  assert.equal(facadeMatFor(probe(40)), facadeMatFor(probe(50)), 'same family across the tall band');
  assert.equal(facadeMatFor(probe(50)), facadeMatFor(probe(50)), 'deterministic per lot');
  for (const h of [6, 8, 30, 36, 50]) {
    assert.ok(facadeMatFor(probe(h)) !== 13, `no strip-tile type at ${h} m`);
  }
  // The roll functions themselves enforce the bands, independent of
  // the facadeMatFor call path.
  const seed = 12345;
  for (const h of [39, 75, 80]) assert.equal(highRiseTaiwanKind({ h }, seed), 0, `high-rise roll is 0 at ${h} m`);
  for (const h of [8, 30, 36]) assert.equal(stripTileKind({ h }, seed), 0, `strip-tile roll is 0 at ${h} m`);
});

test('taiwan108: guard mode never returns a new type', () => {
  // Guard mode (issues #256/#296): the frontage-pull/facing guards
  // judge landings by the pre-#108 family, so the new types move no
  // lot — guard mode never returns 12 or 13, at any probe height,
  // and on the real plan no lot's guard family is a new type.
  const probe = (h) => ({ x: -1234.5, z: 6789.1, w: 20, d: 18, h });
  for (const h of [6, 13, 18, 26, 33, 38, 50, 60, 70]) {
    const g = facadeMatFor(probe(h), { guard: true });
    assert.ok(g !== 12 && g !== 13, `guard mode never returns a new type at ${h} m`);
    assert.ok(g >= 0 && g <= 9, 'guard mode stays in the pre-#108 families');
  }
  const { plan } = planAndOpts();
  let guardNew = 0;
  for (const l of plan.lots) {
    const g = facadeMatFor(l, { guard: true });
    if (g === 12 || g === 13) guardNew++;
  }
  assert.equal(guardNew, 0, 'no lot on the real plan has a new-type guard family');
});

test('taiwan108: high-rise lots carry roof tanks at the design rate', () => {
  // The tank cap runs to 75 m for mat 12 only (same 14% rate as the
  // walk-ups); before #108 the 40–75 m lots wore F6/8/9, where the
  // h <= 34 cap admitted no tank at all — every F12 tank is new.
  const { opts } = planAndOpts();
  const f12 = opts.lots.filter((l) => l.mat === 12);
  let tanks = 0, tankLots = 0;
  for (const l of f12) {
    const adds = taipeiRooftopAdditions({ maxH: l.h, waterTowers: [], hvacUnits: [] }, l, []);
    assert.ok(adds.tanks.length <= 1, 'at most one tank per high-rise roof');
    if (adds.tanks.length) { tankLots++; tanks += adds.tanks.length; }
  }
  // Re-pinned for issue #258: F12 roof tanks 87 -> 97 (97/705 = 13.8%,
  // still inside the 10–20% band asserted below).
  // Issue #278: F12 roof tanks 97 -> 96 (96/704 = 13.6%, one tank lot removed with its F12 lot).
  // Issue #282: F12 roof tanks 96 -> 99 (99/712 = 13.9%, still inside the 10–20% band — the re-faced F12 lots re-roll their tanks; proven by the facing:false cross-run, tanks exactly 95 on both trees).
  assert.equal(tanks, 99, 'F12 roof tanks planted');
  assert.ok(tankLots / f12.length > 0.10 && tankLots / f12.length < 0.20,
    `tank share at its ~14% design point (${(tankLots / f12.length).toFixed(3)})`);
});

test('taiwan108: strip-tile lots carry vertical signs, high-rise lots carry none', () => {
  // The vertical-sign gate (taipeiVerticalSigns) admits family 13
  // with the other mid-rise Taiwan types and keeps family 12 out
  // with 10/11 — a residential tower carries no vertical shop sign.
  const { opts } = planAndOpts();
  const f13 = opts.lots.filter((l) => l.mat === 13);
  const f12 = opts.lots.filter((l) => l.mat === 12);
  let signed13 = 0;
  for (const l of f13) if (taipeiVerticalSigns(l).length) signed13++;
  // Issue #110: signed F13 2,323 -> 2,338 — more F13 lots in the renderer options, same sign rule.
  // Re-pinned for issue #258: signed F13 2,338 -> 2,597 (more F13
  // lots, same sign rule).
  // Issue #278: signed F13 2,597 -> 2,590 (−7 — seven signed F13 lots removed with their F13 lots; same sign rule).
  // Issue #282: signed F13 2,590 -> 2,591 (+1 — one of the 3 new F13 lots carries a sign; same sign rule, and no F12 lot carries one). Proven by cross-run: with { facing: false } signed13 is exactly 2,602 on BOTH this tree and pristine main (facing282-evidence/proof-signs.mjs).
  assert.equal(signed13, 2591, 'strip-tile lots carry vertical signs');
  assert.ok(f12.every((l) => taipeiVerticalSigns(l).length === 0), 'no high-rise lot carries a vertical sign');
});

test('taiwan108: strip-tile shader parameter and material entries', () => {
  // The shader itself cannot execute in node (three.js/WebGPU), so
  // this pins everything that CAN be pinned without a browser, in
  // the taipei-farfade.test.mjs pattern: the tileModuleY option
  // defaults to the square module, both grout computations use it
  // on the vertical axis, and the F13 material entry sets the strip
  // module (0.45 x 0.12 m) while F12 keeps the square module.
  const tslSource = readFileSync(new URL('../js/tsl-materials.js', import.meta.url), 'utf8');
  const factory = tslSource.slice(tslSource.indexOf('function createTileShophouseMaterial'));
  assert.match(factory, /tileModuleY = tileModule,/, 'vertical tile module defaults to the square module');
  assert.match(factory, /floor\(vCoord\.div\(tileModuleY\)\)/, 'tile cell id uses the vertical module');
  assert.match(factory, /gridLine\(vCoord, tileModuleY, 0\.012\)/, 'grout lines use the vertical module');
  const buildingsSource = readFileSync(new URL('../js/buildings.js', import.meta.url), 'utf8');
  const facades = buildingsSource.slice(buildingsSource.indexOf('const facades = ['));
  assert.match(facades, /tileModule: 0\.45,\n\s*tileModuleY: 0\.12,/, 'family 13 sets the 0.45 x 0.12 m strip module');
  assert.match(facades, /12: Taiwan high-rise residential/, 'family 12 material entry present');
  assert.match(facades, /13: Taiwan 二丁掛 strip-tile mid-rise/, 'family 13 material entry present');
});
