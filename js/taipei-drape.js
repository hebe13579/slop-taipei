// js/taipei-drape.js — issue #132 PROTOTYPE (branch drape-proto only).
//
// ONE continuous height function h(x, z) for the Beitou + Yuanshan
// drape prototype: h = de-speckled SRTM DEM inside a drape region,
// feathered smoothly to 0 across a boundary band, identically 0
// outside. Every draped system (ground patch, road ribbons, junction
// caps, markings, plan buildings, the Grand Hotel, street furniture,
// the player ground hook) samples THIS function — that is what makes
// the user's seam requirement ("the road must connected between area
// with lifted, and not") achievable by construction: there are no two
// heights to disagree at a boundary, only one field and a feather.
//
// Regions (game coords in taipei-drape-data.js, baked from lon/lat):
//   beitou   — tile box 4 exactly (121.464-121.510 x 25.113-25.150)
//   yuanshan — the Grand Hotel hill pocket, refined from the DEM
//              (121.5198-121.5335 x 25.0725-25.0830): the hill mass
//              the hotel and its approach roads sit on, no more.
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
