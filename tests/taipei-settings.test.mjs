import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { planTaipeiBuildings } from '../js/taipei-buildings.js';
import {
  SETTINGS_STORAGE_KEY,
  DEFAULT_SETTINGS,
  resolveSettings,
  readStoredSettings,
  persistSettings,
  graphicsConfig,
  trafficConfig,
  initSettingsPanel,
  isMobileDevice,
  TRAFFIC_DENSITY_COUNTS,
  TRAFFIC_RANGE_METERS,
  TRAFFIC_CARS_MAX,
  TRAFFIC_CARS_TICKS,
  TRAFFIC_RADIUS_TICKS,
  TRAFFIC_SLIDER_DEBOUNCE_MS,
  SPECIAL_LOD_FAR_M_DEFAULT,
  SPECIAL_LOD_FAR_M_MIN,
  SPECIAL_LOD_FAR_M_MAX,
} from '../js/settings.js';

// Issue #218 — the settings gear: resolution rules, graphics
// presets, and the density censuses. The DEFAULT plan must stay
// byte-identical to the pre-#218 plan (the whole existing suite
// pins it); each density preset gets its own fingerprint here so
// a preset can never silently drift. If a future geodata
// regeneration re-pins these numbers, update the panel's census
// labels in index.html (#settings-popover) in the same change.
//
// The fingerprint is a rolling FNV hash over every emitted lot's
// rounded fields — byte identity without storing the plan.

function fingerprint(plan) {
  let h = 0x811c9dc5;
  const mix = (n) => { h ^= (n | 0); h = Math.imul(h, 0x01000193); };
  for (const l of plan.lots) {
    mix(Math.round(l.x * 10)); mix(Math.round(l.z * 10));
    mix(Math.round(l.w * 10)); mix(Math.round(l.d * 10)); mix(Math.round(l.h * 10));
    mix(l.rot ? Math.round(l.rot * 10000) : 0);
    for (const c of l.color) mix(c);
  }
  return { lots: plan.lots.length, hash: (h >>> 0).toString(16), stats: plan.stats };
}

test('settings resolution: defaults are the pre-#218 behaviour', () => {
  assert.deepEqual(resolveSettings(), { specials: true, density: 'fine', graphics: 'medium', farDetail: 'fade', specialLodFarM: 2000, drape: true, trafficCars: 0, trafficRadiusM: 380 });
  assert.deepEqual(resolveSettings({ search: '', stored: null }), DEFAULT_SETTINGS);
});

test('settings resolution: storage beats defaults, URL beats storage, per field', () => {
  const stored = JSON.stringify({ specials: false, density: 'dense', graphics: 'low' });
  assert.deepEqual(resolveSettings({ stored }), { specials: false, density: 'dense', graphics: 'low', farDetail: 'fade', specialLodFarM: 2000, drape: true, trafficCars: 0, trafficRadiusM: 380 });
  // URL overrides only the fields it names.
  assert.deepEqual(
    resolveSettings({ stored, search: '?density=coarse' }),
    { specials: false, density: 'coarse', graphics: 'low', farDetail: 'fade', specialLodFarM: 2000, drape: true, trafficCars: 0, trafficRadiusM: 380 },
  );
  assert.deepEqual(
    resolveSettings({ stored, search: '?specials=on&graphics=high' }),
    { specials: true, density: 'dense', graphics: 'high', farDetail: 'fade', specialLodFarM: 2000, drape: true, trafficCars: 0, trafficRadiusM: 380 },
  );
  // Stored value may arrive as an object too.
  assert.equal(resolveSettings({ stored: { density: 'coarse' } }).density, 'coarse');
});

test('settings resolution: invalid values fall back per field, never throw', () => {
  assert.deepEqual(
    resolveSettings({ stored: '{not json', search: '?density=huge&graphics=ultra&specials=maybe' }),
    { specials: true, density: 'fine', graphics: 'medium', farDetail: 'fade', specialLodFarM: 2000, drape: true, trafficCars: 0, trafficRadiusM: 380 },
  );
  assert.deepEqual(
    resolveSettings({ stored: JSON.stringify({ density: 'huge', graphics: 7, specials: 'off' }) }),
    { specials: false, density: 'fine', graphics: 'medium', farDetail: 'fade', specialLodFarM: 2000, drape: true, trafficCars: 0, trafficRadiusM: 380 },
  );
  // Boolean spellings the URL layer accepts.
  for (const [raw, want] of [['off', false], ['0', false], ['no', false], ['on', true], ['1', true], ['yes', true]]) {
    assert.equal(resolveSettings({ search: `?specials=${raw}` }).specials, want, `specials=${raw}`);
  }
});

test('settings persistence: round-trip through storage, failures stay silent', () => {
  const mem = new Map();
  const storage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
  };
  const s = { specials: false, density: 'dense', graphics: 'high', farDetail: 'full', specialLodFarM: 1200, drape: false, trafficCars: 350, trafficRadiusM: 500 };
  assert.equal(persistSettings(storage, s), true);
  assert.deepEqual(resolveSettings({ stored: readStoredSettings(storage) }), s);
  assert.equal(mem.has(SETTINGS_STORAGE_KEY), true);
  const hostile = { getItem() { throw new Error('nope'); }, setItem() { throw new Error('nope'); } };
  assert.equal(readStoredSettings(hostile), null);
  assert.equal(persistSettings(hostile, s), false);
});

test('graphics presets: medium is exactly the pre-#218 engine config', () => {
  assert.deepEqual(graphicsConfig('medium', 2), { pixelRatio: 1.0, shadows: true });
  assert.deepEqual(graphicsConfig('low', 2), { pixelRatio: 0.7, shadows: false });
  assert.deepEqual(graphicsConfig('high', 3), { pixelRatio: 2, shadows: true }, 'high clamps the device ratio at 2');
  assert.deepEqual(graphicsConfig('high', 1.5), { pixelRatio: 1.5, shadows: true });
  assert.deepEqual(graphicsConfig('high', 0.5), { pixelRatio: 1, shadows: true }, 'high never goes below 1');
  assert.deepEqual(graphicsConfig('bogus', 2), { pixelRatio: 1.0, shadows: true }, 'unknown preset plans as medium');
});

test('density fine (default): the shipped plan, byte-identical', () => {
  const implicit = fingerprint(planTaipeiBuildings(TAIPEI_GEO));
  const explicit = fingerprint(planTaipeiBuildings(TAIPEI_GEO, { density: 'fine' }));
  assert.deepEqual(explicit, implicit, 'explicit fine == implicit default plan');
  // Re-pinned at the merge gate on the composed tile (68,570-lot plan
  // after #221 campus clearing): the PR base predated #186/#221, so its
  // fingerprints described an older city. The identity that matters —
  // explicit fine == implicit default — is asserted above and holds.
  // Re-pinned for issue #255: the 4 new registry sites (TWTC Hall 1,
  // Grand Hyatt, ATT 4 FUN, Bellavita) exclude exactly 32 lots —
  // 17 + 4 + 7 + 4, counted lot-by-lot inside the site rects on the
  // pre-#255 plan — at every density; the fine-classifier stats are
  // untouched (the excluded lots are all coarse-class).
  // Issue #216: the facing pass turns and re-seats frontage lots, so
  // every preset's geometry hash moves (lot counts, blocksFine and
  // lotsFine are unchanged — only x/z/w/d move).
  // Gate: hashes measured on the merged tree (the PR-side hashes
  // were measured on its stale pre-#216/pre-#259 base and do not
  // survive — counts compose, hashes do not).
  // Issue #110: plan 68,482 -> 68,472 — 23 bridge links re-admitted + 71 bed-end fusions re-seat 1,282 lots near the changed roadbeds (net -10).
  // Issue #258: plan 68,472 -> 76,367 (+7,895) — the south expansion (see the schools test for the full lot-diff decomposition); the hash moves with the new lots (fingerprint is over every lot's rounded fields). blocksFine 2,897 -> 3,388 (+491 fine-classified south blocks).
  assert.equal(implicit.lots, 77808); // Issue #314: 76,650 -> 77,808 (+1,158 net; see the plan re-pin in heights.test.mjs) // re-pinned for #326: 76,209 -> 76,260 (+51 net: 127 added, 76 removed — lot diff in ntsec326-evidence/lotdiff326.log) // Issue #313: 76,260 -> 76,650 (+390 net: 3,016 added, 2,626 removed - every changed lot at z < -7000 in the Beitou creek corridors; full-JSON plan diff in blocks313-evidence/plan-diff-ordered313.log)
  // Issue #110: the plan hash moves with the re-seated lots (fingerprint is over every lot's rounded fields).
  // Issue #282: the plan hash moves with the re-faced lots (the fingerprint mixes every lot's rounded x/z/w/d/h/rot/color, so turning 2,729 lots moves it; counts, blocksFine and lotsFine are unchanged). Proven by cross-run: with { facing: false } the fine hash is exactly c396d999 on BOTH this tree and pristine main (facing282-evidence/proof-crossrun.mjs).
  assert.equal(implicit.hash, '88c03c9b'); // BATCH: measured on the merged tree (fine) // Issue #313: fine hash moves with the re-gridded Beitou lots (fingerprint is over every lot's rounded fields); lotsFine 50,813 -> 51,241 // Issue #314: fine hash moves with the re-subdivided old-interior lots; lotsFine 51,241 -> 52,867
  // Issue #326: the plan hash moves with the re-sited lots (fingerprint is over every lot's rounded fields); measured on this tree.
  // BATCH (merge of #329 + #332): composed value MEASURED on the merged tree.

  assert.equal(implicit.stats.blocksFine, 3470); // Issue #314: blocksFine 3,388 -> 3,470 (+82 - the new door plates flip 82 blocks to fine grain)
  // Issue #110: lotsFine 44,923 -> 44,907.
  // Issue #258: lotsFine 44,907 -> 50,803 (+5,896 fine south lots).
  // Issue #278: lotsFine 50,803 -> 50,779 (-24 fine lots in the 3 new registry sites).
  // Issue #326: lotsFine 50,779 -> 50,813 (+34 — the re-site frees the old rects' fine lots and the re-routed roads re-cut the blocks they bound).
  assert.equal(implicit.stats.lotsFine, 52867); // Issue #313: lotsFine 50,813 -> 51,241 (+428 - the re-gridded Beitou blocks classify 428 more lots fine) // Issue #314: lotsFine 51,241 -> 52,867 (+1,626 - the re-subdivided old-interior blocks classify 1,626 more lots fine)
});

test('density coarse: the pre-#124 rule (fine classifier never fires)', () => {
  const fp = fingerprint(planTaipeiBuildings(TAIPEI_GEO, { density: 'coarse' }));
  // Issue #110: coarse 36,103 -> 36,107 — the roadbed change moves lots at every density.
  // Issue #258: coarse 36,107 -> 39,574 (+3,467) — the south expansion plans coarse too.
  // Issue #326: coarse 39,433 -> 39,461 (+28 net in the coarse regime — the re-site frees the old rects' coarse lots and the re-routed roads re-cut the blocks they bound; measured on this tree).
  assert.equal(fp.lots, 39549); // re-pinned for #278: the 3 new registry sites exclude 141 lots net at coarse density (see the fine test) // Issue #313: coarse 39,461 -> 39,549 (+88 - the re-gridded Beitou blocks plan coarse too)
  // Issue #110: the coarse-plan hash moves with the re-seated lots.
  // Issue #282: the coarse-plan hash moves with the re-faced lots (the facing pass turns lots at every density; counts unchanged). Proven by cross-run: with { facing: false } the coarse hash is exactly 13647a59 on BOTH this tree and pristine main.
  assert.equal(fp.hash, 'c8ea1e4a'); // BATCH: measured on the merged tree (coarse) // Issue #313: coarse hash moves with the re-gridded Beitou lots; coarse lots 39,461 -> 39,549 // Issue #314: coarse hash moves with the re-seated old-interior lots (their heights change; coarse lots 39,549 unchanged — the fine classifier never fires at coarse density)
  // Issue #326: the coarse-plan hash moves with the re-sited lots; measured on this tree.
  // BATCH (merge of #329 + #332): composed value MEASURED on the merged tree.

  assert.equal(fp.stats.blocksFine, 0);
  assert.equal(fp.stats.lotsFine, 0);
});

test('density dense: the #124 study draft at ~100k lots', () => {
  const fp = fingerprint(planTaipeiBuildings(TAIPEI_GEO, { density: 'dense' }));
  // Issue #110: dense 93,140 -> 93,142 — the roadbed change moves lots at every density.
  // Issue #258: dense 93,142 -> 104,349 (+11,207) — the south expansion at the dense pitch.
  // Issue #326: dense 104,178 -> 104,230 (+52 — the re-site frees the old rects' lots and the re-routed roads re-cut the blocks they bound; measured on this tree).
  assert.equal(fp.lots, 106780); // re-pinned for #278: the 3 new registry sites exclude 171 lots net at dense density (see the fine test) // Issue #313: dense 104,230 -> 104,760 (+530 - the re-gridded Beitou blocks pack 530 more lots at the dense pitch) // Issue #314: dense 104,760 -> 106,780 (+2,020 - the re-subdivided old-interior blocks pack 2,020 more lots at the dense pitch)
  // Issue #110: the dense-plan hash moves with the re-seated lots.
  // Issue #282: the dense-plan hash moves with the re-faced lots (counts unchanged). Proven by cross-run: with { facing: false } the dense hash is exactly 6f43c70e on BOTH this tree and pristine main.
  assert.equal(fp.hash, '4cf69745'); // BATCH: measured on the merged tree (dense) // Issue #313: dense hash moves with the re-gridded Beitou lots; dense lots 104,230 -> 104,760, lotsFine 78,783 -> 79,351 // Issue #314: dense hash moves with the re-subdivided old-interior lots; dense lots 104,760 -> 106,780, lotsFine 79,351 -> 81,839
  // Issue #326: the dense-plan hash moves with the re-sited lots; measured on this tree.
  // BATCH (merge of #329 + #332): composed value MEASURED on the merged tree.

  assert.equal(fp.stats.blocksFine, 3470, 'dense keeps the fine classifier — only the pitch tightens'); // Issue #314: blocksFine 3,388 -> 3,470 (same +82 as fine)
  // Issue #110: dense lotsFine 69,581 -> 69,577.
  // Issue #258: dense lotsFine 69,577 -> 78,785 (+9,208 fine south lots at the dense pitch).
  // Issue #278: dense lotsFine 78,785 -> 78,748 (-37 fine lots in the 3 new registry sites).
  // Issue #326: dense lotsFine 78,748 -> 78,783 (+35 — the re-site frees the old rects' fine lots and the re-routed roads re-cut the blocks they bound; measured on this tree).
  assert.equal(fp.stats.lotsFine, 81839); // Issue #313: dense lotsFine 78,783 -> 79,351 (+568 - the re-gridded Beitou blocks classify 568 more lots fine at the dense pitch) // Issue #314: dense lotsFine 79,351 -> 81,839 (+2,488 - the re-subdivided old-interior blocks classify 2,488 more lots fine at the dense pitch)
});

test('density unknown value plans as fine', () => {
  const fp = fingerprint(planTaipeiBuildings(TAIPEI_GEO, { density: 'huge' }));
  // Issue #110: plan 68,482 -> 68,472 — 23 bridge links re-admitted + 71 bed-end fusions re-seat 1,282 lots near the changed roadbeds (net -10).
  // Issue #258: plan 68,472 -> 76,367 (+7,895) — the south expansion; the hash moves with the new lots.
  assert.equal(fp.lots, 77808); // Issue #314: 76,650 -> 77,808 (+1,158 net; unknown plans as fine, same as above) // re-pinned for #326: 76,209 -> 76,260 (+51 net: 127 added, 76 removed — lot diff in ntsec326-evidence/lotdiff326.log) // Issue #313: 76,260 -> 76,650 (+390 net: 3,016 added, 2,626 removed - every changed lot at z < -7000 in the Beitou creek corridors; full-JSON plan diff in blocks313-evidence/plan-diff-ordered313.log)
  // Issue #110: the plan hash moves with the re-seated lots (unknown plans as fine).
  // Issue #282: the plan hash moves with the re-faced lots (unknown plans as fine — same hash as the fine preset, b7248559).
  assert.equal(fp.hash, '88c03c9b'); // BATCH: measured on the merged tree (unknown plans as fine — same as fine) // Issue #313: unknown-plans-as-fine hash is the fine hash (see above) // Issue #314: unknown-plans-as-fine hash is the fine hash (see above)
  // Issue #326: the plan hash moves with the re-sited lots (unknown plans as fine); measured on this tree.
  // BATCH (merge of #329 + #332): composed value MEASURED on the merged tree.

});

// Source contracts for the UI surface (the browser evidence in the
// PR is the integration proof): the gear + popover exist in the
// toolbar idiom, every control row is present, and main.js / the boot
// wire the settings through.
const indexSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const bootSource = readFileSync(new URL('../js/taipei-boot.js', import.meta.url), 'utf8');

test('settings UI: gear button and panel rows in index.html', () => {
  assert.match(indexSource, /id="btn-settings"[^>]*popovertarget="settings-popover"/);
  assert.match(indexSource, /id="settings-popover" class="popover settings-popover" popover/);
  assert.match(indexSource, /id="set-specials"/);
  // Issue #132: the drape kill-switch row.
  assert.match(indexSource, /id="set-drape"/);
  for (const p of ['coarse', 'fine', 'dense']) assert.match(indexSource, new RegExp(`data-setting-density="${p}"`));
  for (const p of ['low', 'medium', 'high']) assert.match(indexSource, new RegExp(`data-setting-graphics="${p}"`));
  // Issue #281: the traffic controls are sliders now — heaviness
  // 0–800 cars (0 = Off) and render distance 200–600 m, with the
  // old presets as datalist ticks. The preset buttons are gone.
  assert.ok(!indexSource.includes('id="set-traffic"'), 'the old traffic switch is gone');
  assert.ok(!indexSource.includes('data-setting-trafficdensity'), 'the density preset buttons are gone');
  assert.ok(!indexSource.includes('data-setting-trafficrange'), 'the range preset buttons are gone');
  assert.ok(!indexSource.includes('Coming soon — being measured behind a flag'), 'reserved traffic copy is gone');
  assert.match(indexSource, /id="set-traffic-cars" type="range" min="0" max="800" step="1"/);
  assert.match(indexSource, /id="set-traffic-radius" type="range" min="200" max="600" step="1"/);
  assert.match(indexSource, /id="set-traffic-cars-value"/);
  assert.match(indexSource, /id="set-traffic-radius-value"/);
  for (const t of [0, 60, 200, 400, 800]) assert.match(indexSource, new RegExp(`<option value="${t}"`));
  for (const t of [200, 380, 600]) assert.match(indexSource, new RegExp(`<option value="${t}"`));
});

test('far detail resolution: default fade, storage beats default, URL beats storage', () => {
  // Issue #240: far buildings fade detail with distance unless the
  // user asks for full detail. Same per-field resolution as the
  // other rows: URL param > localStorage > default.
  assert.equal(resolveSettings().farDetail, 'fade');
  assert.equal(resolveSettings({ stored: JSON.stringify({ farDetail: 'full' }) }).farDetail, 'full');
  assert.equal(
    resolveSettings({ stored: JSON.stringify({ farDetail: 'full' }), search: '?farDetail=fade' }).farDetail,
    'fade',
  );
  assert.equal(resolveSettings({ search: '?farDetail=full' }).farDetail, 'full');
  // Invalid values fall back to the default, never throw.
  assert.equal(resolveSettings({ search: '?farDetail=everything' }).farDetail, 'fade');
  assert.equal(resolveSettings({ stored: JSON.stringify({ farDetail: 7 }) }).farDetail, 'fade');
});

test('special LOD resolution: default 2,000 m, storage beats default, URL beats storage (issue #393)', () => {
  // The special-building LOD swap distance: specials keep full detail
  // within this range, then simplify to their flat far massing. Same
  // per-field resolution as the other rows: URL param > localStorage >
  // default. The old 700 m swap is the slider's near end.
  assert.equal(resolveSettings().specialLodFarM, SPECIAL_LOD_FAR_M_DEFAULT);
  assert.equal(resolveSettings({ stored: JSON.stringify({ specialLodFarM: 1200 }) }).specialLodFarM, 1200);
  assert.equal(
    resolveSettings({ stored: JSON.stringify({ specialLodFarM: 1200 }), search: '?specialLodFarM=3000' }).specialLodFarM,
    3000,
  );
  assert.equal(resolveSettings({ search: '?specialLodFarM=700' }).specialLodFarM, SPECIAL_LOD_FAR_M_MIN);
  // Out-of-span values clamp; invalid values fall back to the default.
  assert.equal(resolveSettings({ stored: JSON.stringify({ specialLodFarM: 99999 }) }).specialLodFarM, SPECIAL_LOD_FAR_M_MAX);
  assert.equal(resolveSettings({ stored: JSON.stringify({ specialLodFarM: 50 }) }).specialLodFarM, SPECIAL_LOD_FAR_M_MIN);
  assert.equal(resolveSettings({ search: '?specialLodFarM=abc' }).specialLodFarM, SPECIAL_LOD_FAR_M_DEFAULT);
  assert.equal(resolveSettings({ stored: JSON.stringify({ specialLodFarM: 'far' }) }).specialLodFarM, SPECIAL_LOD_FAR_M_DEFAULT);
});

test('traffic resolution: default off, storage beats default, URL beats storage (issues #252/#266/#281)', () => {
  assert.equal(resolveSettings().trafficCars, 0);
  assert.equal(resolveSettings().trafficRadiusM, 380);
  // Numeric stored values resolve directly, clamped to the spans.
  assert.equal(resolveSettings({ stored: JSON.stringify({ trafficCars: 350, trafficRadiusM: 500 }) }).trafficCars, 350);
  assert.equal(resolveSettings({ stored: JSON.stringify({ trafficCars: 350, trafficRadiusM: 500 }) }).trafficRadiusM, 500);
  assert.equal(resolveSettings({ stored: JSON.stringify({ trafficCars: 9999 }) }).trafficCars, TRAFFIC_CARS_MAX);
  assert.equal(resolveSettings({ stored: JSON.stringify({ trafficRadiusM: 50 }) }).trafficRadiusM, 200);
  // Old stored presets still map onto the sliders.
  const stored = JSON.stringify({ trafficDensity: 'heavy', trafficRange: 'far' });
  const fromStored = resolveSettings({ stored });
  assert.equal(fromStored.trafficCars, 400);
  assert.equal(fromStored.trafficRadiusM, 600);
  // A stored number wins over a stored preset.
  assert.equal(resolveSettings({ stored: JSON.stringify({ trafficCars: 150, trafficDensity: 'heavy' }) }).trafficCars, 150);
  // Legacy stored settings (pre-#266) carried trafficEnabled: a stored
  // density wins over it; otherwise it maps onto Normal (200) / Off (0).
  assert.equal(resolveSettings({ stored: JSON.stringify({ trafficEnabled: true, trafficDensity: 'heavy' }) }).trafficCars, 400);
  assert.equal(resolveSettings({ stored: JSON.stringify({ trafficEnabled: true }) }).trafficCars, 200);
  assert.equal(resolveSettings({ stored: JSON.stringify({ trafficEnabled: false }) }).trafficCars, 0);
  // URL: a numeric param wins over a preset param, which wins over
  // trafficEnabled; URL beats storage per field.
  assert.equal(resolveSettings({ stored, search: '?trafficEnabled=off' }).trafficCars, 0);
  assert.equal(resolveSettings({ stored, search: '?trafficCars=150' }).trafficCars, 150);
  assert.equal(resolveSettings({ stored, search: '?trafficDensity=light' }).trafficCars, 60);
  assert.equal(resolveSettings({ stored, search: '?trafficRadiusM=500' }).trafficRadiusM, 500);
  assert.equal(resolveSettings({ stored, search: '?trafficRange=near' }).trafficRadiusM, 200);
  assert.equal(resolveSettings({ search: '?trafficEnabled=on' }).trafficCars, 200);
  assert.equal(resolveSettings({ search: '?trafficEnabled=on&trafficDensity=heavy' }).trafficCars, 400);
  assert.equal(resolveSettings({ search: '?trafficEnabled=on&trafficCars=90' }).trafficCars, 90);
  // Invalid values fall back per field, never throw.
  assert.equal(resolveSettings({ search: '?trafficEnabled=maybe' }).trafficCars, 0);
  assert.equal(resolveSettings({ search: '?trafficDensity=huge' }).trafficCars, 0);
  assert.equal(resolveSettings({ search: '?trafficRange=huge' }).trafficRadiusM, 380);
  assert.equal(resolveSettings({ search: '?trafficCars=nope' }).trafficCars, 0);
  assert.equal(resolveSettings({ search: '?trafficRadiusM=nope' }).trafficRadiusM, 380);
  assert.equal(resolveSettings({ search: '?trafficCars=9999' }).trafficCars, TRAFFIC_CARS_MAX);
});

test('traffic config: slider values map to pool sizes and radii (issues #252/#266/#281)', () => {
  assert.deepEqual(TRAFFIC_DENSITY_COUNTS, { off: 0, light: 60, normal: 200, heavy: 400 });
  assert.deepEqual(TRAFFIC_RANGE_METERS, { near: 200, normal: 380, far: 600 });
  assert.deepEqual(TRAFFIC_CARS_TICKS, [0, 60, 200, 400, 800]);
  assert.deepEqual(TRAFFIC_RADIUS_TICKS, [200, 380, 600]);
  assert.deepEqual(trafficConfig(resolveSettings()), { enabled: false, carCount: 0, trafficRadius: 380 });
  assert.deepEqual(
    trafficConfig(resolveSettings({ search: '?trafficCars=800&trafficRadiusM=600' })),
    { enabled: true, carCount: 800, trafficRadius: 600 },
  );
  assert.deepEqual(
    trafficConfig(resolveSettings({ search: '?trafficDensity=heavy&trafficRange=far' })),
    { enabled: true, carCount: 400, trafficRadius: 600 },
    'old preset params still resolve onto the sliders',
  );
  assert.deepEqual(
    trafficConfig({ trafficCars: 150, trafficRadiusM: 500 }),
    { enabled: true, carCount: 150, trafficRadius: 500 },
    'any value in the span is a valid config, not just the presets',
  );
  assert.deepEqual(
    trafficConfig({ trafficCars: 'bogus', trafficRadiusM: 'bogus' }),
    { enabled: false, carCount: 0, trafficRadius: 380 },
    'unknown values fall back to off (no traffic) and the normal radius',
  );
  assert.deepEqual(
    trafficConfig({ trafficCars: 9999, trafficRadiusM: 50 }),
    { enabled: true, carCount: 800, trafficRadius: 200 },
    'out-of-span values clamp to the slider spans',
  );
});

test('settings wiring: main.js applies traffic from the gear, with the legacy flag winning (issue #252)', () => {
  assert.match(mainSource, /onTraffic: \(cfg\) => applyTrafficConfig\(cfg\)/);
  assert.match(mainSource, /taipeiTrafficEnv\(cfg\.carCount, \{ trafficRadius: cfg\.trafficRadius \}\)/);
  assert.match(mainSource, /trafficCountFromSearch\(window\.location\.search\)/);
  assert.match(mainSource, /delete window\.__traffic/);
  // The gear must show the effective initial state, not the stored one:
  // the legacy flag maps its count directly onto the heaviness slider
  // (issue #281 — no nearest-preset rounding any more).
  assert.match(mainSource, /settings\.trafficCars = taipeiTraffic\.trafficCountFromSearch\(window\.location\.search\)/);
});

test('settings UI: distant-buildings row in index.html, wired in main.js', () => {
  for (const p of ['fade', 'full']) assert.match(indexSource, new RegExp(`data-setting-fardetail="${p}"`));
  assert.match(indexSource, /Distant buildings/);
  assert.match(mainSource, /setFarFadeEnabled\(settings\.farDetail !== 'full'\)/);
  assert.match(mainSource, /onFarDetail: \(preset\) => setFarFadeEnabled\(preset !== 'full'\)/);
  assert.match(mainSource, /from '\.\/tsl-materials\.js'/);
});

test('settings wiring: main.js resolves + passes settings, boot exposes the runtime API', () => {
  assert.match(mainSource, /resolveSettings\(\{/);
  assert.match(mainSource, /initSettingsPanel\(\{/);
  assert.match(mainSource, /settings: \{ density: settings\.density, specials: settings\.specials, drape: settings\.drape \}/);
  // Sandbox (?sandbox=): the boot also passes opts.bounds (the sandbox
  // box; SANDBOX_BOX is null without the param, so the call is the
  // pre-sandbox call exactly — the bounds filter is a no-op then).
  assert.match(bootSource, /planTaipeiBuildings\(geo, \{ density: bootSettings\.density, groundAt: drapeHeight, bounds: SANDBOX_BOX \|\| undefined \}\)/);
  assert.match(bootSource, /setDensity\(preset\)/);
  assert.match(bootSource, /setSpecialsVisible\(visible\)/);
  assert.match(bootSource, /taipeiSettings,/);
});

// Issue #266 — the panel applies traffic without the old switch race.
// The switch read the state at click time but applied it a frame later,
// so two rapid taps queued two builds with the same direction and the
// second tap was swallowed. The sliders (issue #281) keep the same
// rule: a change commits the setting at once and coalesces applies —
// one pending run reads the CURRENT settings, so a whole drag ends at
// the settled value with one build. The drag itself is debounced
// (TRAFFIC_SLIDER_DEBOUNCE_MS), so the world never rebuilds per tick.
// These tests drive the real initSettingsPanel with a minimal DOM stub
// (doc is injectable) and a controllable rAF queue — no browser.
function stubPanel() {
  const makeEl = (id, dataset = {}) => {
    const listeners = {};
    const el = {
      id, dataset, children: [], textContent: '', value: '', disabled: false, title: '',
      classList: { _s: new Set(), toggle(c, on) { if (on) this._s.add(c); else this._s.delete(c); }, contains(c) { return this._s.has(c); } },
      attributes: {},
      setAttribute(k, v) { this.attributes[k] = v; },
      getAttribute(k) { return this.attributes[k] ?? null; },
      querySelector() { return null; },
      addEventListener(ev, fn) { (listeners[ev] ||= []).push(fn); },
      click() { for (const fn of listeners.click || []) fn(); },
      fire(ev) { for (const fn of listeners[ev] || []) fn(); },
    };
    return el;
  };
  const statusEl = makeEl('set-traffic-status');
  const carsSlider = makeEl('set-traffic-cars');
  const carsValue = makeEl('set-traffic-cars-value');
  const radiusSlider = makeEl('set-traffic-radius');
  const radiusValue = makeEl('set-traffic-radius-value');
  const pop = makeEl('settings-popover');
  pop.querySelectorAll = () => [];
  const doc = {
    getElementById: (id) => ({
      'settings-popover': pop,
      'set-traffic-status': statusEl,
      'set-traffic-cars': carsSlider,
      'set-traffic-cars-value': carsValue,
      'set-traffic-radius': radiusSlider,
      'set-traffic-radius-value': radiusValue,
    }[id] || null),
  };
  // Drive a slider like a user: set the value and fire input for each
  // drag tick; fire change on release (optionally with a final value).
  const drag = (slider, ...values) => { for (const v of values) { slider.value = String(v); slider.fire('input'); } };
  const release = (slider, v) => { if (v !== undefined) { slider.value = String(v); slider.fire('input'); } slider.fire('change'); };
  return { doc, statusEl, carsSlider, carsValue, radiusSlider, radiusValue, drag, release };
}

async function flushFrames(rafQueue) {
  while (rafQueue.length) {
    const q = rafQueue.splice(0);
    for (const cb of q) cb();
    await new Promise((r) => setTimeout(r, 0));
  }
  await new Promise((r) => setTimeout(r, 0));
}

// Wait out the slider debounce (real timer), then flush the rAF queue.
async function flushDebounce(rafQueue) {
  await new Promise((r) => setTimeout(r, TRAFFIC_SLIDER_DEBOUNCE_MS + 100));
  await flushFrames(rafQueue);
}

test('traffic sliders: a drag commits every value but applies once at the settled value (issues #266/#281)', async () => {
  const prevRaf = globalThis.requestAnimationFrame;
  const rafQueue = [];
  globalThis.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
  try {
    const { doc, carsSlider, carsValue, drag } = stubPanel();
    const settings = resolveSettings();
    const calls = [];
    initSettingsPanel({ settings, taipeiSettings: {}, doc, onTraffic: (cfg) => { calls.push({ ...cfg }); }, persist: () => {} });
    // A continuous drag 100 -> 350 -> 800: every tick commits (the
    // gear label follows live) but nothing applies mid-drag.
    drag(carsSlider, 100, 350, 800);
    assert.equal(settings.trafficCars, 800);
    assert.equal(carsValue.textContent, '800 cars');
    assert.equal(calls.length, 0, 'nothing applies before the drag settles');
    await flushDebounce(rafQueue);
    assert.equal(calls.length, 1, 'one debounced apply for the whole drag');
    assert.deepEqual(calls[0], { enabled: true, carCount: 800, trafficRadius: 380 });
  } finally {
    if (prevRaf === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = prevRaf;
  }
});

test('traffic sliders: releasing applies at once, and snaps to a preset tick (issue #281)', async () => {
  const prevRaf = globalThis.requestAnimationFrame;
  const rafQueue = [];
  globalThis.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
  try {
    const { doc, carsSlider, carsValue, release } = stubPanel();
    const settings = resolveSettings();
    const calls = [];
    initSettingsPanel({ settings, taipeiSettings: {}, doc, onTraffic: (cfg) => { calls.push({ ...cfg }); }, persist: () => {} });
    // Release near Normal (205 -> 200): the apply runs on the next
    // frame, with no debounce wait.
    release(carsSlider, 205);
    await flushFrames(rafQueue);
    assert.equal(calls.length, 1, 'release applies at once');
    assert.deepEqual(calls[0], { enabled: true, carCount: 200, trafficRadius: 380 });
    assert.equal(settings.trafficCars, 200, 'snapped to the Normal tick');
    assert.equal(carsValue.textContent, '200 cars');
    // Release near Light (63 -> 60), then at a non-tick value (100).
    release(carsSlider, 63);
    await flushFrames(rafQueue);
    assert.deepEqual(calls[1], { enabled: true, carCount: 60, trafficRadius: 380 });
    assert.equal(settings.trafficCars, 60);
    release(carsSlider, 100);
    await flushFrames(rafQueue);
    assert.deepEqual(calls[2], { enabled: true, carCount: 100, trafficRadius: 380 });
    assert.equal(settings.trafficCars, 100, '100 is not within the snap window of any tick');
  } finally {
    if (prevRaf === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = prevRaf;
  }
});

test('traffic sliders: the range slider changes the spawn radius, with the same snap (issue #281)', async () => {
  const prevRaf = globalThis.requestAnimationFrame;
  const rafQueue = [];
  globalThis.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
  try {
    const { doc, radiusSlider, radiusValue, release } = stubPanel();
    const settings = resolveSettings();
    const calls = [];
    initSettingsPanel({ settings, taipeiSettings: {}, doc, onTraffic: (cfg) => { calls.push({ ...cfg }); }, persist: () => {} });
    release(radiusSlider, 500);
    await flushFrames(rafQueue);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { enabled: false, carCount: 0, trafficRadius: 500 });
    assert.equal(settings.trafficRadiusM, 500);
    assert.equal(radiusValue.textContent, '500 m');
    // Release near Around (385 -> 380).
    release(radiusSlider, 385);
    await flushFrames(rafQueue);
    assert.deepEqual(calls[1], { enabled: false, carCount: 0, trafficRadius: 380 });
    assert.equal(settings.trafficRadiusM, 380, 'snapped to the Around tick');
  } finally {
    if (prevRaf === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = prevRaf;
  }
});

test('traffic sliders: a failed build restores the last good config, gear and world agree (issue #266)', async () => {
  const prevRaf = globalThis.requestAnimationFrame;
  const rafQueue = [];
  globalThis.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
  try {
    const { doc, statusEl, carsSlider, release } = stubPanel();
    const settings = resolveSettings();
    const calls = [];
    initSettingsPanel({
      settings, taipeiSettings: {}, doc,
      onTraffic: (cfg) => { calls.push({ ...cfg }); if (cfg.carCount === 400) throw new Error('simulated build failure'); },
      persist: () => {},
    });
    release(carsSlider, 60);
    await flushFrames(rafQueue);
    assert.equal(calls.length, 1);
    release(carsSlider, 400);
    await flushFrames(rafQueue);
    // The failed Heavy build is followed by a re-apply of Light (the
    // last good config), and the setting is restored to Light.
    assert.deepEqual(calls.map((c) => c.carCount), [60, 400, 60]);
    assert.equal(settings.trafficCars, 60);
    assert.equal(carsSlider.value, '60', 'the slider jumps back to the last good value');
    assert.equal(statusEl.textContent, 'change failed — kept previous state');
  } finally {
    if (prevRaf === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = prevRaf;
  }
});

// Gate follow-up (issue #266): the live settle probe could not prove
// the Off-after-rapid-taps path — the headless browser barely
// produces frames, and the coalesced apply runs on the next frame,
// while the "rebuilding…" status is painted at schedule time, before
// the apply runs. A stuck status plus a present world therefore
// cannot distinguish "apply never ran" from "apply failed". Prove
// the settle at unit level with the controllable rAF queue: the
// drag to Off from an on state must collapse into ONE apply ending
// at Off, destroying the world.
test('traffic sliders: a drag from an on state settles at Off with the world destroyed (issue #266 gate)', async () => {
  const prevRaf = globalThis.requestAnimationFrame;
  const rafQueue = [];
  globalThis.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
  try {
    const { doc, statusEl, carsSlider, drag, release } = stubPanel();
    const settings = resolveSettings({ search: '?trafficCars=200' });
    let worldPresent = true; // booted with traffic on (?traffic=1 maps to 200)
    const calls = [];
    initSettingsPanel({
      settings, taipeiSettings: {}, doc,
      onTraffic: (cfg) => { calls.push({ ...cfg }); worldPresent = cfg.enabled; },
      persist: () => {},
    });
    drag(carsSlider, 150, 60, 0);
    release(carsSlider);
    assert.equal(calls.length, 0, 'nothing applies before the frame');
    await flushFrames(rafQueue);
    assert.equal(calls.length, 1, 'one coalesced apply for the whole drag');
    assert.deepEqual(calls[0], { enabled: false, carCount: 0, trafficRadius: 380 });
    assert.equal(worldPresent, false, 'the Off apply destroys the world');
    assert.equal(settings.trafficCars, 0);
    assert.equal(statusEl.textContent, '');
  } finally {
    if (prevRaf === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = prevRaf;
  }
});

// Gate follow-up (issue #266): when the FIRST build fails there is no
// last-good config yet — the fallback re-applies the boot state (Off),
// which is destroy-only and cannot throw the build, and the gear must
// agree with the world.
test('traffic sliders: a failed first build falls back to Off and the gear agrees (issue #266 gate)', async () => {
  const prevRaf = globalThis.requestAnimationFrame;
  const rafQueue = [];
  globalThis.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
  try {
    const { doc, statusEl, carsSlider, release } = stubPanel();
    const settings = resolveSettings();
    const seen = [];
    let calls = 0;
    initSettingsPanel({
      settings, taipeiSettings: {}, doc,
      onTraffic: (cfg) => { seen.push({ ...cfg }); calls += 1; if (calls === 1) throw new Error('simulated first-build failure'); },
      persist: () => {},
    });
    release(carsSlider, 60);
    await flushFrames(rafQueue);
    assert.deepEqual(seen.map((c) => c.carCount), [60, 0], 'failed Light build, then the Off fallback');
    assert.equal(settings.trafficCars, 0);
    assert.equal(statusEl.textContent, 'change failed — kept previous state');
  } finally {
    if (prevRaf === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = prevRaf;
  }
});

// Gate follow-up (issue #266): main.js nulls initTimings after the
// boot log, but applyTrafficConfig calls markInit('traffic') on every
// post-boot build. Without the guard the push threw after every
// successful build and the fallback rolled the good build back. No
// test executes main.js, so pin the guard as a source contract.
test('boot timing: markInit is a no-op after initTimings is nulled (issue #266 gate fix)', () => {
  assert.match(mainSource, /const markInit = \(label\) => \{[^}]*if \(!initTimings\) return;/s);
  assert.match(mainSource, /initTimings = null;/);
});

// Issue #268 — phones default to Coarse buildings + Low graphics.
// Detection is a pure function over a browser snapshot; the device
// defaults fill in only where storage and the URL are silent.
test('mobile detection: phones count, tablets and desktops do not (issue #268)', () => {
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
  const androidPhone = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
  const androidTablet = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
  const desktop = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
  assert.equal(isMobileDevice({ userAgent: iphone }), true);
  assert.equal(isMobileDevice({ userAgent: androidPhone }), true);
  assert.equal(isMobileDevice({ userAgent: androidTablet }), false, 'Android without the Mobile token is a tablet');
  assert.equal(isMobileDevice({ userAgent: desktop }), false);
  assert.equal(isMobileDevice({}), false, 'no signals at all is not mobile');
  // Webview fallback: a desktop UA with a coarse pointer, touch, and
  // a small short side still counts; a large screen does not.
  assert.equal(isMobileDevice({ userAgent: desktop, pointerCoarse: true, maxTouchPoints: 5, smallestScreen: 390 }), true);
  assert.equal(isMobileDevice({ userAgent: desktop, pointerCoarse: true, maxTouchPoints: 5, smallestScreen: 1200 }), false);
  assert.equal(isMobileDevice({ userAgent: desktop, pointerCoarse: true, maxTouchPoints: 0, smallestScreen: 390 }), false, 'no touch, no fallback');
});

test('mobile defaults: phones SET Coarse + Low over stored settings, URL still wins (issue #268)', () => {
  assert.deepEqual(
    resolveSettings({ isMobile: true }),
    { specials: true, density: 'coarse', graphics: 'low', farDetail: 'fade', specialLodFarM: 2000, drape: true, trafficCars: 0, trafficRadiusM: 380 },
  );
  assert.deepEqual(resolveSettings({ isMobile: false }), resolveSettings(), 'desktop resolution is unchanged');
  // The phone never reads the previous density/graphics: a stored
  // Fine/High (e.g. saved on desktop) is overridden, so the phone
  // browser cannot OOM on the saved load. Other stored fields still
  // apply.
  const fromDesktop = resolveSettings({ isMobile: true, stored: JSON.stringify({ density: 'fine', graphics: 'high', specials: false }) });
  assert.equal(fromDesktop.density, 'coarse');
  assert.equal(fromDesktop.graphics, 'low');
  assert.equal(fromDesktop.specials, false);
  // A URL param is an explicit current choice and still wins.
  assert.equal(resolveSettings({ isMobile: true, search: '?density=dense&graphics=medium' }).density, 'dense');
  assert.equal(resolveSettings({ isMobile: true, search: '?density=dense&graphics=medium' }).graphics, 'medium');
  assert.equal(resolveSettings({ isMobile: true, stored: JSON.stringify({ density: 'fine' }), search: '?density=dense' }).density, 'dense');
});

test('settings wiring: main.js detects the device and passes it to resolution (issue #268)', () => {
  assert.match(mainSource, /isMobileDevice\(/);
  assert.match(mainSource, /isMobile: isMobileDevice\(/);
  assert.match(mainSource, /pointer: coarse/);

});
