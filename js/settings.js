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
//   specialLodFarM — (Taipei; issue #393): the distance in metres
//               past which registry specials with farParts swap to
//               their simplified flat massing (near side one
//               hysteresis band inside). Default 2,000 m; the old
//               700 m is the slider's near end. Applied live — the
//               per-frame LOD update reads it each frame, no
//               rebuild. Schools keep the 700/600 m swap.
//   drape     — (Taipei; issue #132): the Beitou + Yuanshan
//               terrain drape — roads and buildings follow the
//               baked SRTM DEM. Default ON; turning it off restores
//               the flat y=0 build with no geodata rebuild (the
//               kill-switch). Applied at boot, so a change reloads
//               the page.
//   traffic   — (Taipei; issues #210/#252/#266/#281) the traffic
//               heaviness slider (0–800 cars, 0 = Off) and the car
//               render-distance slider (200–600 m). Applied live by
//               js/main.js (build/destroy/rebuild the traffic
//               system — no reload). Default Off (0 cars).
//               The legacy ?traffic= flag still works (see
//               js/taipei-traffic.js) and wins for the boot it is
//               given on. Old stored/URL preset spellings
//               (trafficDensity: light/normal/heavy, trafficRange:
//               near/normal/far, trafficEnabled) still resolve onto
//               the sliders, so a saved preset is never lost.
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
// measured with; 'heavy' was the ?traffic= clamp ceiling before #281;
// 'off' builds nothing (0 cars) — it is how traffic stays off.
export const TRAFFIC_DENSITY_COUNTS = Object.freeze({ off: 0, light: 60, normal: 200, heavy: 400 });
// Spawn-range radii in metres: 'normal' is the historical 380 m retire
// radius js/traffic.js always used; 'near' keeps cars close, 'far'
// spreads them out (with the frame cost that implies).
export const TRAFFIC_RANGE_METERS = Object.freeze({ near: 200, normal: 380, far: 600 });
// Issue #281: the sliders. Heaviness is a continuous 0–800 cars —
// twice the old Heavy maximum of 400 — with tick marks at the old
// presets (0 = Off, 60 = Light, 200 = Normal, 400 = Heavy) so an
// existing setting maps onto the slider. Render distance is a
// continuous 200–600 m with ticks at the old presets.
export const TRAFFIC_CARS_MIN = 0;
export const TRAFFIC_CARS_MAX = 800;
export const TRAFFIC_CARS_TICKS = Object.freeze([0, 60, 200, 400, 800]);
export const TRAFFIC_RADIUS_MIN_M = 200;
export const TRAFFIC_RADIUS_MAX_M = 600;
export const TRAFFIC_RADIUS_TICKS = Object.freeze([200, 380, 600]);
// A slider drag fires input events continuously; the world rebuilds
// at most once per settled value — the apply is debounced while the
// user drags and runs at once on release (see initSettingsPanel).
export const TRAFFIC_SLIDER_DEBOUNCE_MS = 250;
// On release the slider snaps to a preset tick when it lands this
// close, so the old presets stay one flick away.
export const TRAFFIC_SLIDER_SNAP_CARS = 12;
export const TRAFFIC_SLIDER_SNAP_M = 12;
// Issue #393: the special-building LOD swap distance. 700 m is the
// old behaviour (the slider's near end); 2,000 m is the new default
// — specials keep full detail across the whole downtown view; 3,000 m
// keeps them detailed from anywhere in the central city. The near side
// of the hysteresis band sits 100 m inside the far side (see
// lodNearM in js/taipei-buildings.js).
export const SPECIAL_LOD_FAR_M_MIN = 700;
export const SPECIAL_LOD_FAR_M_MAX = 3000;
export const SPECIAL_LOD_FAR_M_DEFAULT = 2000;
export const SPECIAL_LOD_FAR_M_TICKS = Object.freeze([700, 1200, 2000, 3000]);
// On release the LOD slider snaps to a tick when it lands this close.
export const SPECIAL_LOD_SLIDER_SNAP_M = 100;

export const DEFAULT_SETTINGS = Object.freeze({
  specials: true,
  density: 'fine',
  graphics: 'medium',
  farDetail: 'fade',
  specialLodFarM: SPECIAL_LOD_FAR_M_DEFAULT,
  drape: true,
  trafficCars: 0,
  trafficRadiusM: 380,
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
// Issue #281: clamp a slider value to its span, or null when it is
// not a number at all (absent / unparsable — the caller keeps the
// value from the lower-precedence layer instead of clamping junk).
const clampTrafficCars = (v) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.max(TRAFFIC_CARS_MIN, Math.min(TRAFFIC_CARS_MAX, Math.round(v)));
};
const clampTrafficRadiusM = (v) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.max(TRAFFIC_RADIUS_MIN_M, Math.min(TRAFFIC_RADIUS_MAX_M, Math.round(v)));
};
// Issue #393: clamp the special-LOD swap distance to its span, or
// null when it is not a number at all (absent / unparsable — the
// caller keeps the value from the lower-precedence layer).
// Exported for the Taipei boot (js/taipei-boot.js).
export const clampSpecialLodFarM = (v) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.max(SPECIAL_LOD_FAR_M_MIN, Math.min(SPECIAL_LOD_FAR_M_MAX, Math.round(v)));
};
// A URLSearchParams value as a finite number, or null when the param
// is absent, empty, or unparsable.
const numParam = (v) => {
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
// Nearest preset tick within the snap window, else the value itself.
const snapToTick = (value, ticks, window) => {
  let best = value;
  let bestGap = Infinity;
  for (const t of ticks) {
    const gap = Math.abs(t - value);
    if (gap < bestGap) { best = t; bestGap = gap; }
  }
  return bestGap <= window ? best : value;
};

// The effective traffic configuration for a resolved settings object:
// pool size + spawn radius, from the slider values. `enabled` is
// derived — 0 cars means no traffic. main.js uses this for every
// build/rebuild so the gear, the URL, and storage can never disagree
// about what a slider position means.
export function trafficConfig(settings) {
  const carCount = clampTrafficCars(settings?.trafficCars) ?? TRAFFIC_CARS_MIN;
  const trafficRadius = clampTrafficRadiusM(settings?.trafficRadiusM) ?? TRAFFIC_RANGE_METERS.normal;
  return {
    enabled: carCount > 0,
    carCount,
    trafficRadius,
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
    // Issue #393: a stored LOD distance wins over the default.
    const slf = clampSpecialLodFarM(s.specialLodFarM);
    if (slf !== null) out.specialLodFarM = slf;
    // Issue #281: the sliders are numeric now. A stored number wins;
    // otherwise an old stored preset maps onto its count/radius, and
    // a pre-#266 trafficEnabled maps onto Normal (200) / Off (0).
    // Stored trafficDensity still wins over trafficEnabled.
    const stc = clampTrafficCars(s.trafficCars);
    if (stc !== null) out.trafficCars = stc;
    else {
      const td = validTrafficDensity(s.trafficDensity);
      if (td) out.trafficCars = TRAFFIC_DENSITY_COUNTS[td];
      else {
        const te = parseBool(s.trafficEnabled);
        if (te !== null) out.trafficCars = te ? TRAFFIC_DENSITY_COUNTS.normal : 0;
      }
    }
    const str = clampTrafficRadiusM(s.trafficRadiusM);
    if (str !== null) out.trafficRadiusM = str;
    else {
      const tr = validTrafficRange(s.trafficRange);
      if (tr) out.trafficRadiusM = TRAFFIC_RANGE_METERS[tr];
    }
    const dr = parseBool(s.drape);
    if (dr !== null) out.drape = dr;
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
  // Issue #393: the LOD distance param wins over storage.
  const qslf = clampSpecialLodFarM(numParam(q.get('specialLodFarM')));
  if (qslf !== null) out.specialLodFarM = qslf;
  // Issue #281: the numeric slider params win; the old preset params
  // map onto the sliders, and trafficEnabled maps onto them only when
  // no trafficCars / trafficDensity param is given.
  const qtc = clampTrafficCars(numParam(q.get('trafficCars')));
  if (qtc !== null) out.trafficCars = qtc;
  else {
    const td = validTrafficDensity(q.get('trafficDensity'));
    if (td) out.trafficCars = TRAFFIC_DENSITY_COUNTS[td];
    else if (q.has('trafficEnabled')) {
      const te = parseBool(q.get('trafficEnabled'));
      if (te !== null) out.trafficCars = te ? TRAFFIC_DENSITY_COUNTS.normal : 0;
    }
  }
  const qtr = clampTrafficRadiusM(numParam(q.get('trafficRadiusM')));
  if (qtr !== null) out.trafficRadiusM = qtr;
  else {
    const tr = validTrafficRange(q.get('trafficRange'));
    if (tr) out.trafficRadiusM = TRAFFIC_RANGE_METERS[tr];
  }
  if (q.has('drape')) {
    const dr = parseBool(q.get('drape'));
    if (dr !== null) out.drape = dr;
  }
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
      specialLodFarM: settings.specialLodFarM,
      trafficCars: settings.trafficCars,
      trafficRadiusM: settings.trafficRadiusM,
      drape: settings.drape,
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
//   onDrape        — called with the boolean when the drape toggle
//                    changes (the caller reloads: the drape is a
//                    boot-time setting)
//   persist        — called after any change (storage write)
//   doc            — document (injectable for tests)
export function initSettingsPanel({ settings, taipeiSettings = null, onGraphics = null, onFarDetail = null, onTraffic = null, onDrape = null, persist = null, doc = null } = {}) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d) return null;
  const pop = d.getElementById('settings-popover');
  if (!pop) return null;

  const specialsBtn = d.getElementById('set-specials');
  const specialsState = specialsBtn ? specialsBtn.querySelector('.set-state') : null;
  const drapeBtn = d.getElementById('set-drape');
  const drapeState = drapeBtn ? drapeBtn.querySelector('.set-state') : null;
  const densityStatus = d.getElementById('set-density-status');
  const densityBtns = [...pop.querySelectorAll('[data-setting-density]')];
  const graphicsBtns = [...pop.querySelectorAll('[data-setting-graphics]')];
  const farDetailBtns = [...pop.querySelectorAll('[data-setting-fardetail]')];
  const trafficStatus = d.getElementById('set-traffic-status');
  const trafficCarsSlider = d.getElementById('set-traffic-cars');
  const trafficCarsValue = d.getElementById('set-traffic-cars-value');
  const trafficRadiusSlider = d.getElementById('set-traffic-radius');
  const trafficRadiusValue = d.getElementById('set-traffic-radius-value');
  const specialLodSlider = d.getElementById('set-special-lod-far');
  const specialLodValue = d.getElementById('set-special-lod-far-value');

  const reflect = () => {
    for (const b of densityBtns) b.classList.toggle('active', b.dataset.settingDensity === settings.density);
    for (const b of graphicsBtns) b.classList.toggle('active', b.dataset.settingGraphics === settings.graphics);
    for (const b of farDetailBtns) b.classList.toggle('active', b.dataset.settingFardetail === settings.farDetail);
    if (specialLodSlider) specialLodSlider.value = String(settings.specialLodFarM);
    if (specialLodValue) specialLodValue.textContent = `${settings.specialLodFarM.toLocaleString('en-US')} m`;
    if (trafficCarsSlider) trafficCarsSlider.value = String(settings.trafficCars);
    if (trafficCarsValue) trafficCarsValue.textContent = settings.trafficCars === 0 ? 'Off' : `${settings.trafficCars} cars`;
    if (trafficRadiusSlider) trafficRadiusSlider.value = String(settings.trafficRadiusM);
    if (trafficRadiusValue) trafficRadiusValue.textContent = `${settings.trafficRadiusM} m`;
    if (specialsBtn) {
      specialsBtn.setAttribute('aria-pressed', settings.specials ? 'true' : 'false');
      if (specialsState) specialsState.textContent = settings.specials ? 'On' : 'Off';
    }
    if (specialsBtn) {
      specialsBtn.setAttribute('aria-pressed', settings.specials ? 'true' : 'false');
      if (specialsState) specialsState.textContent = settings.specials ? 'On' : 'Off';
    }
    if (drapeBtn) {
      drapeBtn.setAttribute('aria-pressed', settings.drape ? 'true' : 'false');
      if (drapeState) drapeState.textContent = settings.drape ? 'On' : 'Off';
    }
  };

  if (!taipeiSettings) {
    for (const b of [...densityBtns, ...farDetailBtns, specialsBtn, drapeBtn].filter(Boolean)) {
      b.disabled = true;
      b.title = 'Taipei mode only';
    }
    for (const s of [trafficCarsSlider, trafficRadiusSlider, specialLodSlider].filter(Boolean)) {
      s.disabled = true;
      s.title = 'Taipei mode only';
    }
  }

  // Issue #281: the traffic controls are sliders now — heaviness
  // 0–800 cars (0 = Off) and render distance 200–600 m. The #266
  // rule still holds: a change commits the setting at once (the gear
  // reflects it immediately) and schedules at most ONE deferred
  // apply, which reads the CURRENT settings when it executes. A
  // slider drag fires input events continuously, so the apply is
  // debounced while dragging — it fires once, ~250 ms after the
  // last input — and runs at once on release (change). Never one
  // rebuild per tick. On release the value snaps to a preset tick
  // when it lands within the snap window, so Light / Normal / Heavy
  // (and Nearby / Around / Far) stay one flick away.
  if (taipeiSettings) {
    let trafficApplyQueued = false;
    let trafficApplied = { trafficCars: settings.trafficCars, trafficRadiusM: settings.trafficRadiusM };
    let trafficDebounce = null;
    const scheduleTrafficApply = () => {
      if (trafficApplyQueued) return;
      trafficApplyQueued = true;
      if (trafficStatus) trafficStatus.textContent = trafficApplied.trafficCars !== 0 ? 'rebuilding…' : 'building…';
      const run = () => {
        trafficApplyQueued = false;
        const apply = (cfg) => {
          try { if (onTraffic) onTraffic(cfg); return true; }
          catch (err) { console.error('[settings] traffic change failed', err); return false; }
        };
        if (apply(trafficConfig(settings))) {
          trafficApplied = { trafficCars: settings.trafficCars, trafficRadiusM: settings.trafficRadiusM };
          if (trafficStatus) trafficStatus.textContent = '';
        } else {
          // The build failed after main.js destroyed the old system:
          // restore the last good config in the world first, so the
          // gear and the street never disagree. If even that fails,
          // fall back to Off (destroy-only, cannot throw the build).
          const lastGood = { ...settings, ...trafficApplied };
          if (apply(trafficConfig(lastGood))) {
            settings.trafficCars = trafficApplied.trafficCars;
            settings.trafficRadiusM = trafficApplied.trafficRadiusM;
          } else {
            settings.trafficCars = 0;
            settings.trafficRadiusM = trafficApplied.trafficRadiusM;
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
    const scheduleDebouncedTrafficApply = () => {
      if (trafficDebounce !== null) clearTimeout(trafficDebounce);
      trafficDebounce = setTimeout(() => { trafficDebounce = null; scheduleTrafficApply(); }, TRAFFIC_SLIDER_DEBOUNCE_MS);
    };
    const settledDiffers = () => settings.trafficCars !== trafficApplied.trafficCars || settings.trafficRadiusM !== trafficApplied.trafficRadiusM;
    const releaseTrafficApply = () => {
      if (trafficDebounce !== null) { clearTimeout(trafficDebounce); trafficDebounce = null; }
      if (settledDiffers()) scheduleTrafficApply();
    };
    if (trafficCarsSlider) {
      trafficCarsSlider.addEventListener('input', () => {
        const v = clampTrafficCars(Number(trafficCarsSlider.value)) ?? 0;
        if (v === settings.trafficCars) return;
        settings.trafficCars = v;
        reflect();
        scheduleDebouncedTrafficApply();
      });
      trafficCarsSlider.addEventListener('change', () => {
        settings.trafficCars = snapToTick(settings.trafficCars, TRAFFIC_CARS_TICKS, TRAFFIC_SLIDER_SNAP_CARS);
        reflect();
        releaseTrafficApply();
      });
    }
    if (trafficRadiusSlider) {
      trafficRadiusSlider.addEventListener('input', () => {
        const v = clampTrafficRadiusM(Number(trafficRadiusSlider.value)) ?? TRAFFIC_RANGE_METERS.normal;
        if (v === settings.trafficRadiusM) return;
        settings.trafficRadiusM = v;
        reflect();
        scheduleDebouncedTrafficApply();
      });
      trafficRadiusSlider.addEventListener('change', () => {
        settings.trafficRadiusM = snapToTick(settings.trafficRadiusM, TRAFFIC_RADIUS_TICKS, TRAFFIC_SLIDER_SNAP_M);
        reflect();
        releaseTrafficApply();
      });
    }
    // Issue #393: the special-LOD distance slider. Unlike traffic,
    // the apply is instant — the per-frame LOD update reads the
    // boot's value each frame, so there is nothing to rebuild and
    // nothing to debounce: input applies at once, release snaps to
    // a tick and persists.
    if (specialLodSlider) {
      specialLodSlider.addEventListener('input', () => {
        const v = clampSpecialLodFarM(Number(specialLodSlider.value)) ?? SPECIAL_LOD_FAR_M_DEFAULT;
        if (v === settings.specialLodFarM) return;
        settings.specialLodFarM = v;
        taipeiSettings.setSpecialLodFarM(v);
        reflect();
      });
      specialLodSlider.addEventListener('change', () => {
        settings.specialLodFarM = snapToTick(settings.specialLodFarM, SPECIAL_LOD_FAR_M_TICKS, SPECIAL_LOD_SLIDER_SNAP_M);
        taipeiSettings.setSpecialLodFarM(settings.specialLodFarM);
        if (persist) persist();
        reflect();
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

  // Issue #132: the drape kill-switch — a boot-time setting, so the
  // toggle persists and the caller (main.js) reloads the page.
  if (drapeBtn && taipeiSettings) {
    drapeBtn.addEventListener('click', () => {
      const next = !settings.drape;
      settings.drape = next;
      if (persist) persist();
      if (onDrape) onDrape(next);
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
