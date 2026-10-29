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
  assert.deepEqual(resolveSettings(), { specials: true, density: 'fine', graphics: 'medium', farDetail: 'fade', traffic: false });
  assert.deepEqual(resolveSettings({ search: '', stored: null }), DEFAULT_SETTINGS);
});

test('settings resolution: storage beats defaults, URL beats storage, per field', () => {
  const stored = JSON.stringify({ specials: false, density: 'dense', graphics: 'low' });
  assert.deepEqual(resolveSettings({ stored }), { specials: false, density: 'dense', graphics: 'low', farDetail: 'fade', traffic: false });
  // URL overrides only the fields it names.
  assert.deepEqual(
    resolveSettings({ stored, search: '?density=coarse' }),
    { specials: false, density: 'coarse', graphics: 'low', farDetail: 'fade', traffic: false },
  );
  assert.deepEqual(
    resolveSettings({ stored, search: '?specials=on&graphics=high' }),
    { specials: true, density: 'dense', graphics: 'high', farDetail: 'fade', traffic: false },
  );
  // Stored value may arrive as an object too.
  assert.equal(resolveSettings({ stored: { density: 'coarse' } }).density, 'coarse');
});

test('settings resolution: invalid values fall back per field, never throw', () => {
  assert.deepEqual(
    resolveSettings({ stored: '{not json', search: '?density=huge&graphics=ultra&specials=maybe' }),
    { specials: true, density: 'fine', graphics: 'medium', farDetail: 'fade', traffic: false },
  );
  assert.deepEqual(
    resolveSettings({ stored: JSON.stringify({ density: 'huge', graphics: 7, specials: 'off' }) }),
    { specials: false, density: 'fine', graphics: 'medium', farDetail: 'fade', traffic: false },
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
  const s = { specials: false, density: 'dense', graphics: 'high', farDetail: 'full', traffic: false };
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
  assert.equal(implicit.lots, 68570);
  assert.equal(implicit.hash, '5ce99501');
  assert.equal(implicit.stats.blocksFine, 2897);
  assert.equal(implicit.stats.lotsFine, 44923);
});

test('density coarse: the pre-#124 rule (fine classifier never fires)', () => {
  const fp = fingerprint(planTaipeiBuildings(TAIPEI_GEO, { density: 'coarse' }));
  assert.equal(fp.lots, 36191); // re-pinned at the merge gate: composed tile (see the fine test)
  assert.equal(fp.hash, '9a2285d3');
  assert.equal(fp.stats.blocksFine, 0);
  assert.equal(fp.stats.lotsFine, 0);
});

test('density dense: the #124 study draft at ~100k lots', () => {
  const fp = fingerprint(planTaipeiBuildings(TAIPEI_GEO, { density: 'dense' }));
  assert.equal(fp.lots, 93228); // re-pinned at the merge gate: composed tile (see the fine test)
  assert.equal(fp.hash, 'b2dcb854');
  assert.equal(fp.stats.blocksFine, 2897, 'dense keeps the fine classifier — only the pitch tightens');
  assert.equal(fp.stats.lotsFine, 69581);
});

test('density unknown value plans as fine', () => {
  const fp = fingerprint(planTaipeiBuildings(TAIPEI_GEO, { density: 'huge' }));
  assert.equal(fp.lots, 68570); // re-pinned at the merge gate: composed tile (see the fine test)
  assert.equal(fp.hash, '5ce99501');
});

// Source contracts for the UI surface (the browser evidence in the
// PR is the integration proof): the gear + popover exist in the
// toolbar idiom, every control row is present, the traffic row is
// disabled, and main.js / the boot wire the settings through.
const indexSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const bootSource = readFileSync(new URL('../js/taipei-boot.js', import.meta.url), 'utf8');

test('settings UI: gear button and panel rows in index.html', () => {
  assert.match(indexSource, /id="btn-settings"[^>]*popovertarget="settings-popover"/);
  assert.match(indexSource, /id="settings-popover" class="popover settings-popover" popover/);
  assert.match(indexSource, /id="set-specials"/);
  for (const p of ['coarse', 'fine', 'dense']) assert.match(indexSource, new RegExp(`data-setting-density="${p}"`));
  for (const p of ['low', 'medium', 'high']) assert.match(indexSource, new RegExp(`data-setting-graphics="${p}"`));
  // Traffic stays a reserved, disabled row until issue #210 lands.
  const trafficRow = indexSource.match(/<button class="pop-item tp-btn" type="button" disabled[^>]*>\s*<span class="pop-name">Traffic<\/span>/);
  assert.ok(trafficRow, 'traffic row is present and disabled');
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
  assert.match(mainSource, /settings: \{ density: settings\.density, specials: settings\.specials \}/);
  assert.match(bootSource, /planTaipeiBuildings\(geo, \{ density: bootSettings\.density \}\)/);
  assert.match(bootSource, /setDensity\(preset\)/);
  assert.match(bootSource, /setSpecialsVisible\(visible\)/);
  assert.match(bootSource, /taipeiSettings,/);
});
