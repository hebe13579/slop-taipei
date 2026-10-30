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
  assert.deepEqual(resolveSettings(), { specials: true, density: 'fine', graphics: 'medium', farDetail: 'fade', trafficDensity: 'off', trafficRange: 'normal' });
  assert.deepEqual(resolveSettings({ search: '', stored: null }), DEFAULT_SETTINGS);
});

test('settings resolution: storage beats defaults, URL beats storage, per field', () => {
  const stored = JSON.stringify({ specials: false, density: 'dense', graphics: 'low' });
  assert.deepEqual(resolveSettings({ stored }), { specials: false, density: 'dense', graphics: 'low', farDetail: 'fade', trafficDensity: 'off', trafficRange: 'normal' });
  // URL overrides only the fields it names.
  assert.deepEqual(
    resolveSettings({ stored, search: '?density=coarse' }),
    { specials: false, density: 'coarse', graphics: 'low', farDetail: 'fade', trafficDensity: 'off', trafficRange: 'normal' },
  );
  assert.deepEqual(
    resolveSettings({ stored, search: '?specials=on&graphics=high' }),
    { specials: true, density: 'dense', graphics: 'high', farDetail: 'fade', trafficDensity: 'off', trafficRange: 'normal' },
  );
  // Stored value may arrive as an object too.
  assert.equal(resolveSettings({ stored: { density: 'coarse' } }).density, 'coarse');
});

test('settings resolution: invalid values fall back per field, never throw', () => {
  assert.deepEqual(
    resolveSettings({ stored: '{not json', search: '?density=huge&graphics=ultra&specials=maybe' }),
    { specials: true, density: 'fine', graphics: 'medium', farDetail: 'fade', trafficDensity: 'off', trafficRange: 'normal' },
  );
  assert.deepEqual(
    resolveSettings({ stored: JSON.stringify({ density: 'huge', graphics: 7, specials: 'off' }) }),
    { specials: false, density: 'fine', graphics: 'medium', farDetail: 'fade', trafficDensity: 'off', trafficRange: 'normal' },
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
  const s = { specials: false, density: 'dense', graphics: 'high', farDetail: 'full', trafficDensity: 'off', trafficRange: 'normal' };
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
// toolbar idiom, every control row is present, and main.js / the boot
// wire the settings through.
const indexSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const bootSource = readFileSync(new URL('../js/taipei-boot.js', import.meta.url), 'utf8');

test('settings UI: gear button and panel rows in index.html', () => {
  assert.match(indexSource, /id="btn-settings"[^>]*popovertarget="settings-popover"/);
  assert.match(indexSource, /id="settings-popover" class="popover settings-popover" popover/);
  assert.match(indexSource, /id="set-specials"/);
  for (const p of ['coarse', 'fine', 'dense']) assert.match(indexSource, new RegExp(`data-setting-density="${p}"`));
  for (const p of ['low', 'medium', 'high']) assert.match(indexSource, new RegExp(`data-setting-graphics="${p}"`));
  // Issue #266: Off is a density option — no separate switch. The
  // old on/off button is gone; Off is the first density preset.
  assert.ok(!indexSource.includes('id="set-traffic"'), 'the old traffic switch is gone');
  assert.ok(!indexSource.includes('Coming soon — being measured behind a flag'), 'reserved traffic copy is gone');
  for (const p of ['off', 'light', 'normal', 'heavy']) assert.match(indexSource, new RegExp(`data-setting-trafficdensity="${p}"`));
  for (const p of ['near', 'normal', 'far']) assert.match(indexSource, new RegExp(`data-setting-trafficrange="${p}"`));
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

test('traffic resolution: default off, storage beats default, URL beats storage (issues #252/#266)', () => {
  assert.equal(resolveSettings().trafficDensity, 'off');
  assert.equal(resolveSettings().trafficRange, 'normal');
  const stored = JSON.stringify({ trafficDensity: 'heavy', trafficRange: 'far' });
  const fromStored = resolveSettings({ stored });
  assert.equal(fromStored.trafficDensity, 'heavy');
  assert.equal(fromStored.trafficRange, 'far');
  // Legacy stored settings (pre-#266) carried trafficEnabled: a stored
  // density wins over it; otherwise it maps onto the density.
  assert.equal(resolveSettings({ stored: JSON.stringify({ trafficEnabled: true, trafficDensity: 'heavy' }) }).trafficDensity, 'heavy');
  assert.equal(resolveSettings({ stored: JSON.stringify({ trafficEnabled: true }) }).trafficDensity, 'normal');
  assert.equal(resolveSettings({ stored: JSON.stringify({ trafficEnabled: false }) }).trafficDensity, 'off');
  assert.equal(resolveSettings({ stored, search: '?trafficEnabled=off' }).trafficDensity, 'off');
  assert.equal(resolveSettings({ stored, search: '?trafficDensity=light' }).trafficDensity, 'light');
  assert.equal(resolveSettings({ stored, search: '?trafficRange=near' }).trafficRange, 'near');
  // The legacy URL param maps onto the density only when no density
  // param is given; a density param wins over it.
  assert.equal(resolveSettings({ search: '?trafficEnabled=on' }).trafficDensity, 'normal');
  assert.equal(resolveSettings({ search: '?trafficEnabled=on&trafficDensity=heavy' }).trafficDensity, 'heavy');
  // Invalid values fall back to the default, never throw.
  assert.equal(resolveSettings({ search: '?trafficEnabled=maybe' }).trafficDensity, 'off');
  assert.equal(resolveSettings({ search: '?trafficDensity=huge' }).trafficDensity, 'off');
  assert.equal(resolveSettings({ search: '?trafficRange=huge' }).trafficRange, 'normal');
});

test('traffic config: presets map to the measured pool sizes and radii (issues #252/#266)', () => {
  assert.deepEqual(TRAFFIC_DENSITY_COUNTS, { off: 0, light: 60, normal: 200, heavy: 400 });
  assert.deepEqual(TRAFFIC_RANGE_METERS, { near: 200, normal: 380, far: 600 });
  assert.deepEqual(trafficConfig(resolveSettings()), { enabled: false, carCount: 0, trafficRadius: 380 });
  assert.deepEqual(
    trafficConfig(resolveSettings({ search: '?trafficDensity=heavy&trafficRange=far' })),
    { enabled: true, carCount: 400, trafficRadius: 600 },
  );
  assert.deepEqual(
    trafficConfig({ trafficDensity: 'bogus', trafficRange: 'bogus' }),
    { enabled: false, carCount: 0, trafficRadius: 380 },
    'unknown density falls back to off (no traffic), unknown range to normal',
  );
});

test('settings wiring: main.js applies traffic from the gear, with the legacy flag winning (issue #252)', () => {
  assert.match(mainSource, /onTraffic: \(cfg\) => applyTrafficConfig\(cfg\)/);
  assert.match(mainSource, /taipeiTrafficEnv\(cfg\.carCount, \{ trafficRadius: cfg\.trafficRadius \}\)/);
  assert.match(mainSource, /trafficCountFromSearch\(window\.location\.search\)/);
  assert.match(mainSource, /delete window\.__traffic/);
  // The gear must show the effective initial state, not the stored one:
  // the legacy flag maps onto the nearest density preset and syncs the
  // in-memory field before the panel reflects.
  assert.match(mainSource, /settings\.trafficDensity = legacyCount > 0 \? nearest : 'off'/);
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

// Issue #266 — the panel applies traffic without the old switch race.
// The switch read the state at click time but applied it a frame later,
// so two rapid taps queued two builds with the same direction and the
// second tap was swallowed. The preset buttons update the setting at
// once and coalesce applies: one pending run reads the CURRENT
// settings, so rapid taps end at the last tap with one build. These
// tests drive the real initSettingsPanel with a minimal DOM stub
// (doc is injectable) and a controllable rAF queue — no browser.
function stubPanel() {
  const makeEl = (id, dataset = {}) => {
    const listeners = {};
    const el = {
      id, dataset, children: [], textContent: '', disabled: false, title: '',
      classList: { _s: new Set(), toggle(c, on) { if (on) this._s.add(c); else this._s.delete(c); }, contains(c) { return this._s.has(c); } },
      attributes: {},
      setAttribute(k, v) { this.attributes[k] = v; },
      getAttribute(k) { return this.attributes[k] ?? null; },
      querySelector() { return null; },
      addEventListener(ev, fn) { (listeners[ev] ||= []).push(fn); },
      click() { for (const fn of listeners.click || []) fn(); },
    };
    return el;
  };
  const statusEl = makeEl('set-traffic-status');
  const densityBtns = ['off', 'light', 'normal', 'heavy'].map((p) => makeEl('d-' + p, { settingTrafficdensity: p }));
  const rangeBtns = ['near', 'normal', 'far'].map((p) => makeEl('r-' + p, { settingTrafficrange: p }));
  const pop = makeEl('settings-popover');
  pop.querySelectorAll = (sel) => (sel.includes('trafficdensity') ? densityBtns : sel.includes('trafficrange') ? rangeBtns : []);
  const doc = {
    getElementById: (id) => ({ 'settings-popover': pop, 'set-traffic-status': statusEl }[id] || null),
  };
  const byPreset = (btns, key, value) => btns.find((b) => b.dataset[key] === value);
  return { doc, statusEl, densityBtns, rangeBtns, byPreset };
}

async function flushFrames(rafQueue) {
  while (rafQueue.length) {
    const q = rafQueue.splice(0);
    for (const cb of q) cb();
    await new Promise((r) => setTimeout(r, 0));
  }
  await new Promise((r) => setTimeout(r, 0));
}

test('traffic panel: rapid taps coalesce into one apply ending at the last tap (issue #266)', async () => {
  const prevRaf = globalThis.requestAnimationFrame;
  const rafQueue = [];
  globalThis.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
  try {
    const { doc, densityBtns, byPreset } = stubPanel();
    const settings = resolveSettings();
    const calls = [];
    initSettingsPanel({ settings, taipeiSettings: {}, doc, onTraffic: (cfg) => { calls.push({ ...cfg }); }, persist: () => {} });
    // Light, then Off, before any frame fires: the old switch applied
    // enabled=true twice here. The coalesced apply reads the current
    // settings — Off — exactly once.
    byPreset(densityBtns, 'settingTrafficdensity', 'light').click();
    byPreset(densityBtns, 'settingTrafficdensity', 'off').click();
    assert.equal(calls.length, 0, 'nothing applies before the frame');
    await flushFrames(rafQueue);
    assert.equal(calls.length, 1, 'one coalesced apply');
    assert.deepEqual(calls[0], { enabled: false, carCount: 0, trafficRadius: 380 });
    assert.equal(settings.trafficDensity, 'off');
    assert.equal(byPreset(densityBtns, 'settingTrafficdensity', 'off').classList.contains('active'), true);
    // Sequential taps each apply once; re-tapping the active preset is a no-op.
    byPreset(densityBtns, 'settingTrafficdensity', 'light').click();
    await flushFrames(rafQueue);
    assert.deepEqual(calls[1], { enabled: true, carCount: 60, trafficRadius: 380 });
    byPreset(densityBtns, 'settingTrafficdensity', 'heavy').click();
    await flushFrames(rafQueue);
    assert.deepEqual(calls[2], { enabled: true, carCount: 400, trafficRadius: 380 });
    byPreset(densityBtns, 'settingTrafficdensity', 'heavy').click();
    await flushFrames(rafQueue);
    assert.equal(calls.length, 3, 're-tapping the active preset applies nothing');
  } finally {
    if (prevRaf === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = prevRaf;
  }
});

test('traffic panel: a failed build restores the last good config, gear and world agree (issue #266)', async () => {
  const prevRaf = globalThis.requestAnimationFrame;
  const rafQueue = [];
  globalThis.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
  try {
    const { doc, statusEl, densityBtns, byPreset } = stubPanel();
    const settings = resolveSettings();
    const calls = [];
    initSettingsPanel({
      settings, taipeiSettings: {}, doc,
      onTraffic: (cfg) => { calls.push({ ...cfg }); if (cfg.carCount === 400) throw new Error('simulated build failure'); },
      persist: () => {},
    });
    byPreset(densityBtns, 'settingTrafficdensity', 'light').click();
    await flushFrames(rafQueue);
    assert.equal(calls.length, 1);
    byPreset(densityBtns, 'settingTrafficdensity', 'heavy').click();
    await flushFrames(rafQueue);
    // The failed Heavy build is followed by a re-apply of Light (the
    // last good config), and the setting is restored to Light.
    assert.deepEqual(calls.map((c) => c.carCount), [60, 400, 60]);
    assert.equal(settings.trafficDensity, 'light');
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
// five-tap burst from an on state must collapse into ONE apply
// ending at Off, destroying the world.
test('traffic panel: rapid taps from an on state settle at Off with the world destroyed (issue #266 gate)', async () => {
  const prevRaf = globalThis.requestAnimationFrame;
  const rafQueue = [];
  globalThis.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
  try {
    const { doc, statusEl, densityBtns, byPreset } = stubPanel();
    const settings = resolveSettings({ search: '?trafficDensity=normal' });
    let worldPresent = true; // booted with traffic on (?traffic=1 maps to normal)
    const calls = [];
    initSettingsPanel({
      settings, taipeiSettings: {}, doc,
      onTraffic: (cfg) => { calls.push({ ...cfg }); worldPresent = cfg.enabled; },
      persist: () => {},
    });
    for (const p of ['off', 'light', 'heavy', 'normal', 'off']) byPreset(densityBtns, 'settingTrafficdensity', p).click();
    assert.equal(calls.length, 0, 'nothing applies before the frame');
    await flushFrames(rafQueue);
    assert.equal(calls.length, 1, 'one coalesced apply for the whole burst');
    assert.deepEqual(calls[0], { enabled: false, carCount: 0, trafficRadius: 380 });
    assert.equal(worldPresent, false, 'the Off apply destroys the world');
    assert.equal(settings.trafficDensity, 'off');
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
test('traffic panel: a failed first build falls back to Off and the gear agrees (issue #266 gate)', async () => {
  const prevRaf = globalThis.requestAnimationFrame;
  const rafQueue = [];
  globalThis.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
  try {
    const { doc, statusEl, densityBtns, byPreset } = stubPanel();
    const settings = resolveSettings();
    const seen = [];
    let calls = 0;
    initSettingsPanel({
      settings, taipeiSettings: {}, doc,
      onTraffic: (cfg) => { seen.push({ ...cfg }); calls += 1; if (calls === 1) throw new Error('simulated first-build failure'); },
      persist: () => {},
    });
    byPreset(densityBtns, 'settingTrafficdensity', 'light').click();
    await flushFrames(rafQueue);
    assert.deepEqual(seen.map((c) => c.carCount), [60, 0], 'failed Light build, then the Off fallback');
    assert.equal(settings.trafficDensity, 'off');
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
    { specials: true, density: 'coarse', graphics: 'low', farDetail: 'fade', trafficDensity: 'off', trafficRange: 'normal' },
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
