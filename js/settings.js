// js/settings.js
// Issue #218: the settings gear (top-right toolbar) and the runtime
// settings it drives.
//
//   specials  — registry landmarks + site structures visible
//               (Taipei; applied by js/taipei-boot.js)
//   density   — building-density preset: 'coarse' | 'fine' |
//               'dense' (Taipei; planTaipeiBuildings' opts.density,
//               re-planned and rebuilt live by the boot — no reload)
//   graphics  — 'low' | 'medium' | 'high': pixel ratio + sun
//               shadows, from the knobs the engine already exposes
//               (renderer.setPixelRatio, sunLight.castShadow).
//               'medium' IS today's behaviour (pixel ratio 1.0,
//               shadows on), so an untouched boot is unchanged.
//   farDetail — 'fade' | 'full' (Taipei; issue #240): whether
//               far lot facades fade their procedural detail to a
//               flat colour with distance. 'fade' is the default;
//               specials are exempt either way. Applied live via
//               a shared shader uniform — no rebuild.
//   traffic   — (Taipei; issues #210/#252/#266) the traffic density
//               preset (Off / Light / Normal / Heavy) and spawn-range
//               preset. Off IS a density option — there is no separate
//               switch. Applied live by js/main.js (build/destroy/
//               rebuild the traffic system — no reload). Default Off.
//               The legacy ?traffic= flag still works (see
//               js/taipei-traffic.js) and wins for the boot it is
//               given on.
//
// Resolution order per field: URL param > phone force (issue #268:
// phones always start Coarse + Low, overriding stored settings, so a
// saved Fine/High can never OOM the phone browser) > localStorage >
// default, so links are shareable (?density=dense&specials=off&
// graphics=low) and tests can pin a configuration without touching
// storage.
// The pure parts (resolution, preset tables, graphics config) are
// node-testable; DOM is touched only inside initSettingsPanel /
// applyGraphicsSettings, never at module level.

export const SETTINGS_STORAGE_KEY = 'slop-settings';

export const DENSITY_PRESETS = ['coarse', 'fine', 'dense'];
export const GRAPHICS_PRESETS = ['low', 'medium', 'high'];
export const FAR_DETAIL_PRESETS = ['fade', 'full'];
export const TRAFFIC_DENSITY_PRESETS = ['off', 'light', 'normal', 'heavy'];
export const TRAFFIC_RANGE_PRESETS = ['near', 'normal', 'far'];
// Pool sizes: 'normal' is the upstream NYC pool size the #210 experiment
// measured with; 'heavy' is the ?traffic= clamp ceiling; 'off' builds
// nothing (0 cars) — it is how traffic stays off.
export const TRAFFIC_DENSITY_COUNTS = Object.freeze({ off: 0, light: 60, normal: 200, heavy: 400 });
// Spawn-range radii in metres: 'normal' is the historical 380 m retire
// radius js/traffic.js always used; 'near' keeps cars close, 'far'
// spreads them out (with the frame cost that implies).
export const TRAFFIC_RANGE_METERS = Object.freeze({ near: 200, normal: 380, far: 600 });

export const DEFAULT_SETTINGS = Object.freeze({
  specials: true,
  density: 'fine',
  graphics: 'medium',
  farDetail: 'fade',
  trafficDensity: 'off',
  trafficRange: 'normal',
});

// Issue #268: is this a phone? Pure and unit-tested — main.js passes
// the browser snapshot, tests pass plain objects. A phone user-agent
// (iPhone/iPod, Android carrying the Mobile token, small mobile
// browsers) counts; an Android tablet (Android without the Mobile
// token) and desktop browsers do not. The fallback catches webviews
// that report a desktop UA: a coarse pointer + touch + a genuinely
// small short screen side (under 900 CSS px — phones, and small
// tablets held portrait, which also benefit from the lighter load).
export function isMobileDevice({ userAgent = '', maxTouchPoints = 0, pointerCoarse = false, smallestScreen = Infinity } = {}) {
  if (/iPhone|iPod|Android.*Mobile|Mobile.*Android|BlackBerry|IEMobile|Opera Mini/i.test(userAgent)) return true;
  return pointerCoarse && maxTouchPoints > 0 && smallestScreen < 900;
}

const parseBool = (v) => {
  if (typeof v === 'boolean') return v;
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (s === 'on' || s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'off' || s === 'false' || s === '0' || s === 'no') return false;
  return null;
};

const validDensity = (v) => (DENSITY_PRESETS.includes(v) ? v : null);
const validGraphics = (v) => (GRAPHICS_PRESETS.includes(v) ? v : null);
const validFarDetail = (v) => (FAR_DETAIL_PRESETS.includes(v) ? v : null);
const validTrafficDensity = (v) => (TRAFFIC_DENSITY_PRESETS.includes(v) ? v : null);
const validTrafficRange = (v) => (TRAFFIC_RANGE_PRESETS.includes(v) ? v : null);

// The effective traffic configuration for a resolved settings object:
// pool size + spawn radius, from the presets. `enabled` is derived —
// density 'off' means no traffic. main.js uses this for every
// build/rebuild so the gear, the URL, and storage can never disagree
// about what "normal" means.
export function trafficConfig(settings) {
  const density = validTrafficDensity(settings.trafficDensity) || 'off';
  return {
    enabled: density !== 'off',
    carCount: TRAFFIC_DENSITY_COUNTS[density],
    trafficRadius: TRAFFIC_RANGE_METERS[settings.trafficRange] ?? TRAFFIC_RANGE_METERS.normal,
  };
}

// Resolve the effective settings. `stored` may be the raw
// localStorage string, an already-parsed object, or null.
// `isMobile` (issue #268) FORCES Coarse buildings + Low graphics on
// phones, overriding whatever storage says: a phone browser OOMs on
// a saved Fine/High load, so the phone never reads the previous
// density/graphics at all. A URL param still wins (an explicit,
// current choice), and the gear can still change it live in-session.
export function resolveSettings({ search = '', stored = null, isMobile = false } = {}) {
  const out = { ...DEFAULT_SETTINGS };
  let s = null;
  if (typeof stored === 'string') {
    try { s = JSON.parse(stored); } catch { s = null; }
  } else if (stored && typeof stored === 'object') {
    s = stored;
  }
  if (s) {
    const sp = parseBool(s.specials);
    if (sp !== null) out.specials = sp;
    const d = validDensity(s.density);
    if (d) out.density = d;
    const g = validGraphics(s.graphics);
    if (g) out.graphics = g;
    const f = validFarDetail(s.farDetail);
    if (f) out.farDetail = f;
    // Issue #266: Off is a density option now. Old stored settings
    // carry trafficEnabled instead of (or beside) a density: a stored
    // density wins; otherwise trafficEnabled false -> 'off',
    // true -> 'normal'.
    const td = validTrafficDensity(s.trafficDensity);
    if (td) out.trafficDensity = td;
    else {
      const te = parseBool(s.trafficEnabled);
      if (te !== null) out.trafficDensity = te ? 'normal' : 'off';
    }
    const tr = validTrafficRange(s.trafficRange);
    if (tr) out.trafficRange = tr;
  }
  // Issue #268 (corrected 2026-10-29): phones SET Coarse + Low
  // instead of reading the previous density/graphics — storage is
  // applied above, then overridden here, so a saved Fine/High from
  // a desktop visit can never OOM the phone browser.
  if (isMobile) {
    out.density = 'coarse';
    out.graphics = 'low';
  }
  const q = new URLSearchParams(typeof search === 'string' ? search : '');
  if (q.has('specials')) {
    const sp = parseBool(q.get('specials'));
    if (sp !== null) out.specials = sp;
  }
  const d = validDensity(q.get('density'));
  if (d) out.density = d;
  const g = validGraphics(q.get('graphics'));
  if (g) out.graphics = g;
  const f = validFarDetail(q.get('farDetail'));
  if (f) out.farDetail = f;
  // Issue #266: the legacy trafficEnabled URL param maps onto the
  // density, and only when no trafficDensity param is given.
  const td = validTrafficDensity(q.get('trafficDensity'));
  if (td) out.trafficDensity = td;
  else if (q.has('trafficEnabled')) {
    const te = parseBool(q.get('trafficEnabled'));
    if (te !== null) out.trafficDensity = te ? 'normal' : 'off';
  }
  const tr = validTrafficRange(q.get('trafficRange'));
  if (tr) out.trafficRange = tr;
  return out;
}

export function readStoredSettings(storage) {
  try {
    return storage ? storage.getItem(SETTINGS_STORAGE_KEY) : null;
  } catch {
    return null; // storage can throw (private mode, disabled cookies)
  }
}

export function persistSettings(storage, settings) {
  try {
    if (!storage) return false;
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
      specials: settings.specials,
      density: settings.density,
      graphics: settings.graphics,
      farDetail: settings.farDetail,
      trafficDensity: settings.trafficDensity,
      trafficRange: settings.trafficRange,
    }));
    return true;
  } catch {
    return false;
  }
}

// The graphics presets in engine terms. 'medium' returns exactly
// the values the boot hard-coded before #218 (pixel ratio 1.0,
// shadows on) — the default boot must not move a single pixel.
export function graphicsConfig(preset, devicePixelRatio = 1) {
  switch (preset) {
    case 'low':
      return { pixelRatio: 0.7, shadows: false };
    case 'high':
      return { pixelRatio: Math.min(Math.max(devicePixelRatio || 1, 1), 2), shadows: true };
    case 'medium':
    default:
      return { pixelRatio: 1.0, shadows: true };
  }
}

// Apply a graphics preset live: pixel ratio is a renderer knob,
// shadows are the sun light's castShadow flag (the only shadow
// caster driver; materials keep their shadow setup, so toggling
// back is free). Returns the resolved config.
export function applyGraphicsSettings(renderer, sunLight, preset, devicePixelRatio = 1) {
  const cfg = graphicsConfig(preset, devicePixelRatio);
  if (renderer) {
    renderer.setPixelRatio(cfg.pixelRatio);
    if (typeof window !== 'undefined') renderer.setSize(window.innerWidth, window.innerHeight);
  }
  if (sunLight) sunLight.castShadow = cfg.shadows;
  return cfg;
}

// Wire the settings popover (index.html #settings-popover).
//   settings       — the resolved settings object (mutated in place)
//   taipeiSettings — js/taipei-boot.js' runtime API, or null outside
//                    Taipei mode (density/specials/far-detail/traffic
//                    rows disable)
//   onGraphics     — called with the preset when graphics change
//   onFarDetail    — called with the preset when far detail changes
//   onTraffic      — called with trafficConfig(settings) when any
//                    traffic control changes; main.js owns building,
//                    destroying, and rebuilding the traffic system
//   persist        — called after any change (storage write)
//   doc            — document (injectable for tests)
export function initSettingsPanel({ settings, taipeiSettings = null, onGraphics = null, onFarDetail = null, onTraffic = null, persist = null, doc = null } = {}) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d) return null;
  const pop = d.getElementById('settings-popover');
  if (!pop) return null;

  const specialsBtn = d.getElementById('set-specials');
  const specialsState = specialsBtn ? specialsBtn.querySelector('.set-state') : null;
  const densityStatus = d.getElementById('set-density-status');
  const densityBtns = [...pop.querySelectorAll('[data-setting-density]')];
  const graphicsBtns = [...pop.querySelectorAll('[data-setting-graphics]')];
  const farDetailBtns = [...pop.querySelectorAll('[data-setting-fardetail]')];
  const trafficStatus = d.getElementById('set-traffic-status');
  const trafficDensityBtns = [...pop.querySelectorAll('[data-setting-trafficdensity]')];
  const trafficRangeBtns = [...pop.querySelectorAll('[data-setting-trafficrange]')];

  const reflect = () => {
    for (const b of densityBtns) b.classList.toggle('active', b.dataset.settingDensity === settings.density);
    for (const b of graphicsBtns) b.classList.toggle('active', b.dataset.settingGraphics === settings.graphics);
    for (const b of farDetailBtns) b.classList.toggle('active', b.dataset.settingFardetail === settings.farDetail);
    for (const b of trafficDensityBtns) b.classList.toggle('active', b.dataset.settingTrafficdensity === settings.trafficDensity);
    for (const b of trafficRangeBtns) b.classList.toggle('active', b.dataset.settingTrafficrange === settings.trafficRange);
    if (specialsBtn) {
      specialsBtn.setAttribute('aria-pressed', settings.specials ? 'true' : 'false');
      if (specialsState) specialsState.textContent = settings.specials ? 'On' : 'Off';
    }
    if (specialsBtn) {
      specialsBtn.setAttribute('aria-pressed', settings.specials ? 'true' : 'false');
      if (specialsState) specialsState.textContent = settings.specials ? 'On' : 'Off';
    }
  };

  if (!taipeiSettings) {
    for (const b of [...densityBtns, ...farDetailBtns, ...trafficDensityBtns, ...trafficRangeBtns, specialsBtn].filter(Boolean)) {
      b.disabled = true;
      b.title = 'Taipei mode only';
    }
  }

  // Issue #266: Off is a density option, so the traffic controls are
  // preset buttons only — no separate switch. A tap updates the
  // setting at once (the gear reflects it immediately) and schedules
  // at most ONE deferred apply: the pending run reads the CURRENT
  // settings when it executes, so rapid taps (Light -> Off -> Light)
  // collapse into one build ending at the last tap, instead of each
  // tap queuing a build that captured the state at click time (the
  // old switch swallowed the second tap of a rapid pair — both runs
  // applied the same direction). The build is synchronous CPU work:
  // paint the busy state first, then build on the next frame (same
  // idiom as the density row).
  if (taipeiSettings) {
    let trafficApplyQueued = false;
    let trafficApplied = { trafficDensity: settings.trafficDensity, trafficRange: settings.trafficRange };
    const scheduleTrafficApply = () => {
      if (trafficApplyQueued) return;
      trafficApplyQueued = true;
      if (trafficStatus) trafficStatus.textContent = trafficApplied.trafficDensity !== 'off' ? 'rebuilding…' : 'building…';
      const run = () => {
        trafficApplyQueued = false;
        const apply = (cfg) => {
          try { if (onTraffic) onTraffic(cfg); return true; }
          catch (err) { console.error('[settings] traffic change failed', err); return false; }
        };
        if (apply(trafficConfig(settings))) {
          trafficApplied = { trafficDensity: settings.trafficDensity, trafficRange: settings.trafficRange };
          if (trafficStatus) trafficStatus.textContent = '';
        } else {
          // The build failed after main.js destroyed the old system:
          // restore the last good config in the world first, so the
          // gear and the street never disagree. If even that fails,
          // fall back to Off (destroy-only, cannot throw the build).
          const lastGood = { ...settings, ...trafficApplied };
          if (apply(trafficConfig(lastGood))) {
            settings.trafficDensity = trafficApplied.trafficDensity;
            settings.trafficRange = trafficApplied.trafficRange;
          } else {
            settings.trafficDensity = 'off';
            settings.trafficRange = trafficApplied.trafficRange;
            apply(trafficConfig(settings));
          }
          if (trafficStatus) trafficStatus.textContent = 'change failed — kept previous state';
        }
        if (persist) persist();
        reflect();
      };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(run, 0));
      else setTimeout(run, 0);
    };
    for (const b of trafficDensityBtns) {
      b.addEventListener('click', () => {
        const preset = b.dataset.settingTrafficdensity;
        if (preset === settings.trafficDensity) return;
        settings.trafficDensity = preset;
        reflect();
        scheduleTrafficApply();
      });
    }
    for (const b of trafficRangeBtns) {
      b.addEventListener('click', () => {
        const preset = b.dataset.settingTrafficrange;
        if (preset === settings.trafficRange) return;
        settings.trafficRange = preset;
        reflect();
        scheduleTrafficApply();
      });
    }
  }

  if (specialsBtn && taipeiSettings) {
    specialsBtn.addEventListener('click', () => {
      const next = !settings.specials;
      taipeiSettings.setSpecialsVisible(next);
      settings.specials = next;
      if (persist) persist();
      reflect();
    });
  }

  for (const b of densityBtns) {
    b.addEventListener('click', () => {
      const preset = b.dataset.settingDensity;
      if (!taipeiSettings || preset === settings.density) return;
      // The re-plan is synchronous CPU work (seconds at Dense):
      // paint the busy state first, then build on the next frame.
      if (densityStatus) densityStatus.textContent = 'rebuilding…';
      b.disabled = true;
      const run = () => {
        try {
          const res = taipeiSettings.setDensity(preset);
          if (res) {
            settings.density = preset;
            if (persist) persist();
            if (densityStatus) {
              densityStatus.textContent = `${res.lots.toLocaleString('en-US')} buildings · ${(res.ms / 1000).toFixed(1)}s`;
            }
          }
        } catch (err) {
          console.error('[settings] density rebuild failed', err);
          if (densityStatus) densityStatus.textContent = 'rebuild failed — kept previous density';
        }
        b.disabled = false;
        reflect();
      };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(run, 0));
      else setTimeout(run, 0);
    });
  }

  for (const b of graphicsBtns) {
    b.addEventListener('click', () => {
      const preset = b.dataset.settingGraphics;
      if (preset === settings.graphics) return;
      settings.graphics = preset;
      if (onGraphics) onGraphics(preset);
      if (persist) persist();
      reflect();
    });
  }

  for (const b of farDetailBtns) {
    b.addEventListener('click', () => {
      const preset = b.dataset.settingFardetail;
      if (!taipeiSettings || preset === settings.farDetail) return;
      settings.farDetail = preset;
      if (onFarDetail) onFarDetail(preset);
      if (persist) persist();
      reflect();
    });
  }

  reflect();
  return { reflect };
}
