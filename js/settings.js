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
//   traffic   — RESERVED: the panel renders the row disabled
//               ("coming soon") until issue #210's experiment
//               lands its switch here.
//
// Resolution order per field: URL param > localStorage > default,
// so links are shareable (?density=dense&specials=off&graphics=low)
// and tests can pin a configuration without touching storage.
// The pure parts (resolution, preset tables, graphics config) are
// node-testable; DOM is touched only inside initSettingsPanel /
// applyGraphicsSettings, never at module level.

export const SETTINGS_STORAGE_KEY = 'slop-settings';

export const DENSITY_PRESETS = ['coarse', 'fine', 'dense'];
export const GRAPHICS_PRESETS = ['low', 'medium', 'high'];
export const FAR_DETAIL_PRESETS = ['fade', 'full'];

export const DEFAULT_SETTINGS = Object.freeze({
  specials: true,
  density: 'fine',
  graphics: 'medium',
  farDetail: 'fade',
  traffic: false,
});

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

// Resolve the effective settings. `stored` may be the raw
// localStorage string, an already-parsed object, or null.
export function resolveSettings({ search = '', stored = null } = {}) {
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
//                    Taipei mode (density/specials/far-detail rows disable)
//   onGraphics     — called with the preset when graphics change
//   onFarDetail    — called with the preset when far detail changes
//   persist        — called after any change (storage write)
//   doc            — document (injectable for tests)
export function initSettingsPanel({ settings, taipeiSettings = null, onGraphics = null, onFarDetail = null, persist = null, doc = null } = {}) {
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

  const reflect = () => {
    for (const b of densityBtns) b.classList.toggle('active', b.dataset.settingDensity === settings.density);
    for (const b of graphicsBtns) b.classList.toggle('active', b.dataset.settingGraphics === settings.graphics);
    for (const b of farDetailBtns) b.classList.toggle('active', b.dataset.settingFardetail === settings.farDetail);
    if (specialsBtn) {
      specialsBtn.setAttribute('aria-pressed', settings.specials ? 'true' : 'false');
      if (specialsState) specialsState.textContent = settings.specials ? 'On' : 'Off';
    }
  };

  if (!taipeiSettings) {
    for (const b of [...densityBtns, ...farDetailBtns, specialsBtn].filter(Boolean)) {
      b.disabled = true;
      b.title = 'Taipei mode only';
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
