// js/taipei-drape.js — issue #132: the Beitou + Yuanshan terrain drape.
//
// ONE continuous height function h(x, z): h = de-speckled SRTM DEM
// inside a drape region, feathered smoothly to 0 across a boundary
// band, identically 0 outside. Every draped system (ground patch,
// road ribbons, junction caps, markings, plan buildings, the Grand
// Hotel, street furniture, deck/MRT lifts, the player ground hook)
// samples THIS function — that is what makes the user's seam
// requirement ("the road must connected between area with lifted,
// and not") achievable by construction: there are no two heights to
// disagree at a boundary, only one field and a feather.
//
// Regions (game coords in taipei-drape-data.js, baked from lon/lat
// by tools/taipei/build-drape-dem.py):
//   beitou   — tile box 4 exactly (121.464-121.510 x 25.113-25.150)
//   yuanshan — the Grand Hotel hill pocket, refined from the DEM
//              (121.5198-121.5335 x 25.0725-25.0830): the hill mass
//              the hotel and its approach roads sit on, no more.
//
// Kill-switch: setDrapeEnabled(false) makes drapeHeight identically
// 0, so every draped system renders its flat build with no geodata
// rebuild (the settings gear's "Terrain drape" row + ?drape= URL
// param drive it; see js/settings.js).
import { DRAPE_GRID, DRAPE_RECTS, DRAPE_DATA_B64 } from './taipei-drape-data.js';

const KX = 100923.1, KY = 110773.4;         // tile frame (taipei-buildings.js latLonToTile)
const ORIGIN_LON = 121.5650, ORIGIN_LAT = 25.0330;
export const DRAPE_FEATHER = 200;          // boundary band width, m (design start; measured in the report)

// --- DEM grid decode (int16 LE, row 0 = north edge) -------------------
let _grid = null;
function grid() {
  if (_grid) return _grid;
  const bin = atob(DRAPE_DATA_B64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  _grid = new Int16Array(bytes.buffer);
  return _grid;
}

// Smoothed SRTM elevation (m) at a game position; 0 outside the bake
// extent and for below-sea readings. Bilinear over 1-arc-second postings.
export function drapeDem(x, z) {
  const lon = ORIGIN_LON + x / KX, lat = ORIGIN_LAT - z / KY;
  const { w, e, s, n, cols, rows, stepDeg } = DRAPE_GRID;
  if (lon < w || lon > e || lat < s || lat > n) return 0;
  const g = grid();
  const fx = (lon - w) / stepDeg, fy = (n - lat) / stepDeg;
  const x0 = Math.min(Math.max(Math.floor(fx), 0), cols - 2);
  const y0 = Math.min(Math.max(Math.floor(fy), 0), rows - 2);
  const dx = fx - x0, dy = fy - y0;
  const v = (xx, yy) => g[yy * cols + xx];
  const h = v(x0, y0) * (1 - dx) * (1 - dy) + v(x0 + 1, y0) * dx * (1 - dy)
          + v(x0, y0 + 1) * (1 - dx) * dy + v(x0 + 1, y0 + 1) * dx * dy;
  return Math.max(0, h);
}

// Region weight: 1 inside a rect, smoothstep to 0 across the feather
// band outside it. The max over regions wins where feathers overlap.
export function drapeWeight(x, z, feather = DRAPE_FEATHER) {
  let w = 0;
  for (const r of DRAPE_RECTS) {
    const dx = Math.max(r.minX - x, 0, x - r.maxX);
    const dz = Math.max(r.minZ - z, 0, z - r.maxZ);
    const d = Math.hypot(dx, dz);
    if (d <= 0) return 1;
    if (d < feather) {
      const t = 1 - d / feather;
      w = Math.max(w, t * t * (3 - 2 * t));
    }
  }
  return w;
}

let _enabled = true;
export function setDrapeEnabled(v) { _enabled = !!v; }
export function drapeEnabled() { return _enabled; }

// The height function every draped system samples. `feather` is a
// parameter (not a constant) so the seam census can measure the
// design before and after feather tuning with the same code the game
// boots.
export function drapeHeight(x, z, feather = DRAPE_FEATHER) {
  if (!_enabled) return 0;
  const w = drapeWeight(x, z, feather);
  if (w <= 0) return 0;
  return drapeDem(x, z) * w;
}

export { DRAPE_RECTS };

// --- Drape ground patch grids (pure; the boot colours them) ---------
// One DEM grid mesh per region (plus its feather margin) at h - 0.02,
// so the flat layer stack (blocks 0.02, parks 0.04, roads 0.06 —
// each itself draped by the same h) keeps its authored offsets above
// the terrain. Vertices inside a water polygon pin below the water
// plane (-0.05): rivers stay flat, their banks a measured residue.
// Grid step 28 m, the bake's posting spacing. Returns per-region
// grids with positions + triangle indices + the grid dims the boot
// needs to colour by slope; vertex y is drapeHeight - 0.02 except
// water pins. Pure and node-testable (no THREE).
export const DRAPE_PATCH_STEP = 28;
export const DRAPE_PATCH_DROP = 0.02;
export const DRAPE_WATER_PIN_Y = -0.05;

export function buildDrapePatchGrids(waterRings) {
  const rings = (waterRings || []).filter((r) => r && r.length >= 6).map((r) => {
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (let i = 0; i < r.length; i += 2) {
      minX = Math.min(minX, r[i]); maxX = Math.max(maxX, r[i]);
      minZ = Math.min(minZ, r[i + 1]); maxZ = Math.max(maxZ, r[i + 1]);
    }
    return { r, minX, maxX, minZ, maxZ };
  });
  const inWater = (x, z) => {
    for (const w of rings) {
      if (x < w.minX || x > w.maxX || z < w.minZ || z > w.maxZ) continue;
      let inside = false;
      const r = w.r;
      for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
        const xi = r[i], zi = r[i + 1], xj = r[j], zj = r[j + 1];
        if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
      }
      if (inside) return true;
    }
    return false;
  };
  const grids = [];
  for (const r of DRAPE_RECTS) {
    const step = DRAPE_PATCH_STEP;
    const minX = r.minX - DRAPE_FEATHER, maxX = r.maxX + DRAPE_FEATHER;
    const minZ = r.minZ - DRAPE_FEATHER, maxZ = r.maxZ + DRAPE_FEATHER;
    const nx = Math.max(2, Math.round((maxX - minX) / step));
    const nz = Math.max(2, Math.round((maxZ - minZ) / step));
    const positions = new Float32Array((nx + 1) * (nz + 1) * 3);
    let o = 0;
    for (let j = 0; j <= nz; j++) {
      for (let i = 0; i <= nx; i++) {
        const x = minX + ((maxX - minX) * i) / nx, z = minZ + ((maxZ - minZ) * j) / nz;
        let y = drapeHeight(x, z) - DRAPE_PATCH_DROP;
        if (y > -DRAPE_PATCH_DROP && inWater(x, z)) y = DRAPE_WATER_PIN_Y;
        positions[o++] = x; positions[o++] = y; positions[o++] = z;
      }
    }
    const indices = new Uint32Array(nx * nz * 6);
    let ip = 0;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
        indices[ip++] = a; indices[ip++] = c; indices[ip++] = b;
        indices[ip++] = b; indices[ip++] = c; indices[ip++] = d;
      }
    }
    grids.push({ name: r.name, positions, indices, triCount: nx * nz * 2, nx, nz, minX, minZ, stepX: (maxX - minX) / nx, stepZ: (maxZ - minZ) / nz });
  }
  return grids;
}
