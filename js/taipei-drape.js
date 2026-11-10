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
//   yuanshan — the Grand Hotel hill pocket, extended north + east by
//              issue #263 (121.5198-121.558 x 25.0725-25.108): the
//              whole hill mass including the 故宮 grounds, so the
//              200 m feather falls on flat/low ground and empty
//              mountainside instead of mid-slope on the hotel hill.
//              The north edge stops at 25.108 (the ridge crest
//              behind the museum): 天母's Dayeh Takashimaya and
//              Tianmu Stadium stay outside the feather, where they
//              would otherwise lift and float on the slope.
// Flat sites (issue #263, DRAPE_FLAT_SITES in taipei-drape-data.js):
//   npm — the 國立故宮博物院 grounds stay flat (the #186
//         flat-convention pin) while the hills around them get
//         terrain: drapeHeight is 0 inside the site ring, feathered
//         to 1 over 200 m outside it. Without it the museum would
//         lift 44.4 m as a rigid body on ground varying 37.8-52.5 m
//         under its podium (float up to 6.6 m, bury up to 8.1 m).
//
// Kill-switch: setDrapeEnabled(false) makes drapeHeight identically
// 0, so every draped system renders its flat build with no geodata
// rebuild (the settings gear's "Terrain drape" row + ?drape= URL
// param drive it; see js/settings.js).
import { DRAPE_GRID, DRAPE_RECTS, DRAPE_FLAT_SITES, DRAPE_DATA_B64 } from './taipei-drape-data.js';

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

// Flat-site factor (issue #263): 0 inside a flat site's ring,
// smoothstep 0 -> 1 across `feather` m outside it, 1 beyond. A bbox
// pre-check (ring bbox + feather) keeps the per-call cost to a
// bounds test outside the site's neighbourhood; inside it the
// point-in-polygon + ring-distance test runs over the ring's points.
const FLAT_SITES = (DRAPE_FLAT_SITES || []).map((s) => {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < s.ring.length; i += 2) {
    minX = Math.min(minX, s.ring[i]); maxX = Math.max(maxX, s.ring[i]);
    minZ = Math.min(minZ, s.ring[i + 1]); maxZ = Math.max(maxZ, s.ring[i + 1]);
  }
  return { ...s, minX: minX - s.feather, maxX: maxX + s.feather, minZ: minZ - s.feather, maxZ: maxZ + s.feather };
});
function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i], zi = ring[i + 1], xj = ring[j], zj = ring[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function distToRing(x, z, ring) {
  let d = Infinity;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const ax = ring[i], az = ring[i + 1], bx = ring[j], bz = ring[j + 1];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    let t = L2 ? ((x - ax) * dx + (z - az) * dz) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    d = Math.min(d, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
  }
  return d;
}
export function flatSiteFactor(x, z) {
  let f = 1;
  for (const s of FLAT_SITES) {
    if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) continue;
    if (pointInRing(x, z, s.ring)) return 0;
    const d = distToRing(x, z, s.ring);
    if (d < s.feather) {
      const t = d / s.feather;
      f = Math.min(f, t * t * (3 - 2 * t));
    }
  }
  return f;
}

// The height function every draped system samples. `feather` is a
// parameter (not a constant) so the seam census can measure the
// design before and after feather tuning with the same code the game
// boots.
export function drapeHeight(x, z, feather = DRAPE_FEATHER) {
  if (!_enabled) return 0;
  const w = drapeWeight(x, z, feather);
  if (w <= 0) return 0;
  const f = flatSiteFactor(x, z);
  if (f <= 0) return 0;
  return drapeDem(x, z) * w * f;
}

export { DRAPE_RECTS, DRAPE_FLAT_SITES };

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

// DEM posting grid in game coords (1-arc-second SRTM postings:
// stepDeg of longitude at this latitude, of latitude). The adaptive
// ground's base cells are aligned to these posting lines, so no
// triangle straddles a posting-line kink (where the DEM's gradient
// jumps): inside one posting cell the field is smooth, the chord
// error falls quadratically as a triangle splits, and the
// refinement converges at a modest depth instead of chasing the
// kink linearly. (An arbitrary 14 m grid straddles posting lines
// and needs sub-metre triangles to reach 0.02 m — measured: 6.0M
// tris and still 0.95 m residual.)
export const DRAPE_POSTING_STEP_X = DRAPE_GRID.stepDeg * 100923.1;
export const DRAPE_POSTING_STEP_Z = DRAPE_GRID.stepDeg * 110773.4;
export const DRAPE_POSTING_X0 = (DRAPE_GRID.w - 121.5650) * 100923.1;
export const DRAPE_POSTING_Z0 = (25.0330 - DRAPE_GRID.n) * 110773.4;
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

// --- Adaptive drape ground (issue #285) -----------------------------------
// The land-block layer is built from raster-block rects whose only
// vertices are the four corners; drapeGeometry lifts those corners and
// the interior chords straight across the DEM — at S3 前港街26巷 the
// chord rode +1.20 m above the road and buried it, the lower floors
// of buildings and the bases of signs with it. The 28 m drape patch
// chords the same way (up to +1.76 m above roads). A uniform 14 m
// subdivision (the ribbons' step) does NOT fix it: measured on the
// real tile it still leaves 24 km of road covered by the blocks
// (max +0.77 m) because the DEM's kinks — posting-line gradient
// jumps on steep slopes — make the chord error shrink only ~linearly
// with the cell size, so no affordable uniform step reaches the
// 0.04 m the road stack needs (road ribbon at DEM + 0.06, block at
// DEM + 0.02). A per-block uniform step is worse (132M tris: a few
// giant blocks need 0.875 m everywhere).
//
// The ground is therefore built as ONE adaptive triangulation over
// the drape footprint (each rect + feather):
//   - start from one quad per DEM posting cell (28.0 x 30.8 m),
//     aligned to the posting lines so no triangle straddles a
//     posting-line kink; a quad whose surface rides more than
//     DRAPE_GROUND_TOL_M above the DEM (burying) or more than
//     DRAPE_GROUND_TOL_UNDER_M below it (sagging, a floating road)
//     is split into four sub-quads, recursively, until within
//     tolerance or the depth cap. Quads stay square-ish (a
//     centroid-fan makes skinny slivers whose long edge never
//     shrinks, so the error never converges — measured: 6.0M tris
//     and still 0.95 m residual), so the error falls ~4x per level
//     and converges at depth 4. Cracks at a refined/coarse boundary
//     are bounded by the tolerance (the coarser neighbour meets the
//     DEM within tol at the shared edge midpoint);
//   - refinement is confined to a 150 m mask around the road
//     network: far from every road the ground is open mountainside
//     whose chord error cannot cover anything, and refining it is
//     what explodes the triangle count (the feather cliff needs
//     sub-metre triangles to follow a 300 m field to 0.02 m);
//   - triangles are assigned by slope: gentle ground wears the pale
//     block tone, steep ground the terrain colours (the patch's own
//     colour rule), so the hillsides keep their green while the
//     streets keep their pale ground. The patch colour blends from
//     the pale tone across the slope band [0.30, 0.45] (issue #297):
//     a hard per-triangle step at the split reads as a patchwork of
//     pale and green triangles on bare mountain slopes, so a vertex
//     at the split wears exactly the pale tone and the colour ramps
//     smoothly to the terrain rule.
// The result stays below the road ribbons everywhere a road runs:
// the block surface is DEM + 0.02 with over-error <= 0.02, the patch
// surface DEM - 0.02. Pure and node-testable (no THREE).
export const DRAPE_GROUND_STEP_M = 14;
export const DRAPE_GROUND_TOL_M = 0.02;
export const DRAPE_GROUND_TOL_UNDER_M = 0.10;
export const DRAPE_GROUND_MAX_DEPTH = 4;
export const DRAPE_GROUND_PALE_SLOPE = 0.30;
// Above this slope the patch wears its full terrain colour; between
// DRAPE_GROUND_PALE_SLOPE and here it blends from the pale block
// tone (issue #297).
export const DRAPE_GROUND_BLEND_SLOPE = 0.45;
export const DRAPE_GROUND_BLOCK_Y = 0.02;
export const DRAPE_GROUND_PATCH_Y = -0.02;

// sRGB hex -> linear-srgb triple, exactly what THREE.Color(hex) stores
// (ColorManagement on): the patch colours below are compared against
// THREE in tests, so this must match, not approximate.
function srgbHexToLinear(hex) {
  const conv = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return [conv((hex >> 16) & 0xff), conv((hex >> 8) & 0xff), conv(hex & 0xff)];
}
const DRAPE_TERRAIN_LOW = srgbHexToLinear(0x77875c);
const DRAPE_TERRAIN_MID = srgbHexToLinear(0x46683d);
const DRAPE_TERRAIN_HIGH = srgbHexToLinear(0x6f7d68);
const DRAPE_TERRAIN_ROCK = srgbHexToLinear(0x8a8578);
// The pale tone the block surface wears — must stay equal to
// SURFACE_TONES.block in js/taipei-surfaces.js (0x8f8b80); the
// drape test pins the match so the two cannot drift apart.
const DRAPE_GROUND_PALE_TONE = srgbHexToLinear(0x8f8b80);
function lerp3(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
// The patch's own colour rule (js/taipei-boot.js buildDrapePatchMeshes):
// rock on steep ground, otherwise scrub/forest by height. Pure.
export function drapeTerrainColor(slope, hgt) {
  if (slope > 0.55) return [...DRAPE_TERRAIN_ROCK];
  if (hgt < 18) return lerp3(DRAPE_TERRAIN_LOW, DRAPE_TERRAIN_MID, Math.max(0, hgt) / 18);
  return lerp3(DRAPE_TERRAIN_MID, DRAPE_TERRAIN_HIGH, Math.min(1, (hgt - 18) / 90));
}
// The colour a patch vertex actually wears (issue #297): the terrain
// rule blended toward the pale block tone across the slope band
// [DRAPE_GROUND_PALE_SLOPE, DRAPE_GROUND_BLEND_SLOPE], so the
// block/patch split is continuous instead of a hard step. The split
// is per-triangle by the triangle's own plane slope; the colour is
// per-vertex by the DEM gradient slope. Without the blend the two
// surfaces meet in a hard step — measured on the real tile,
// block/patch adjacencies differ by ΔRGB 0.19 on average (18,263
// pairs, 99.8% above 0.10) while patch/patch adjacencies differ by
// 0.003 — that hard step is the triangle patchwork the user sees on
// bare mountain slopes, not chord error (the patch surface sits on
// the DEM to 0.004 m mean over-error). With the blend a vertex at
// the split wears exactly the pale tone, and the colour ramps
// smoothly (smoothstep, so no kink at either end of the band) to
// the terrain rule by 0.45. Pure.
export function drapePatchColor(slope, hgt) {
  const t = Math.max(0, Math.min(1, (slope - DRAPE_GROUND_PALE_SLOPE) / (DRAPE_GROUND_BLEND_SLOPE - DRAPE_GROUND_PALE_SLOPE)));
  const s = t * t * (3 - 2 * t);
  return lerp3(DRAPE_GROUND_PALE_TONE, drapeTerrainColor(slope, hgt), s);
}

// One ground vertex's colour and smooth normal, as a pure function
// of (x, z) (issue #345): the DEM gradient over ±DRAPE_GROUND_STEP_M
// gives the slope for drapePatchColor and the smooth normal. The
// #297 patch branch inlined this computation; the block branch now
// shares it, so the colour and shading are continuous across the
// block/patch split — the split is per-triangle by plane slope, but
// the vertex values do not depend on which side a triangle falls
// on. hgt is the vertex's DEM height clamped at 0 (callers pass
// Math.max(0, v[1]); a water-pinned vertex wears hgt 0, exactly as
// the patch did before this helper existed).
export function drapeGroundVertex(x, z, hgt) {
  const dhx = drapeHeight(x + DRAPE_GROUND_STEP_M, z) - drapeHeight(x - DRAPE_GROUND_STEP_M, z);
  const dhz = drapeHeight(x, z + DRAPE_GROUND_STEP_M) - drapeHeight(x, z - DRAPE_GROUND_STEP_M);
  const slope = Math.hypot(dhx, dhz) / (2 * DRAPE_GROUND_STEP_M);
  const [cr, cg, cb] = drapePatchColor(slope, hgt);
  const gx = dhx / (2 * DRAPE_GROUND_STEP_M), gz = dhz / (2 * DRAPE_GROUND_STEP_M);
  const nl = Math.hypot(gx, 1, gz);
  return { color: [cr, cg, cb], normal: [-gx / nl, 1 / nl, -gz / nl] };
}

// Plane through three vertices, evaluated at (x, z). Vertices are
// [x, y, z] with y already the lifted height.
function groundPlaneY(p0, p1, p2, x, z) {
  const [x0, y0, z0] = p0, [x1, y1, z1] = p1, [x2, y2, z2] = p2;
  const d = (z2 - z0) * (x1 - x0) - (x2 - x0) * (z1 - z0);
  if (Math.abs(d) < 1e-12) return y0;
  const a = ((z2 - z0) * (y1 - y0) - (y2 - y0) * (z1 - z0)) / d;
  const b = ((y2 - y0) * (x1 - x0) - (y1 - y0) * (x2 - x0)) / d;
  return y0 + a * (x - x0) + b * (z - z0);
}
// Gradient magnitude of a triangle's plane (its slope).
function groundTriSlope(tri) {
  const [a, b, c] = tri;
  const d = (c[2] - a[2]) * (b[0] - a[0]) - (b[2] - a[2]) * (c[0] - a[0]);
  if (Math.abs(d) < 1e-12) return 0;
  const gx = ((c[2] - a[2]) * (b[1] - a[1]) - (b[2] - a[2]) * (c[1] - a[1])) / d;
  const gz = ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / d;
  return Math.hypot(gx, gz);
}
// Max over-error (plane minus DEM) and max under-error (DEM minus
// plane) of a triangle, sampled at its centroid and its three edge
// midpoints. The over direction buries roads/buildings/signs and is
// held to 0.02 m; the under direction sags the ground below the
// terrain (a floating road, a gap under a building) and is held to
// 0.10 m. A one-sided (over-only) test lets a refined triangle sag
// 0.81 m below the DEM at S1 — measured — so both directions
// refine. A triangle with a water-pinned vertex is exempt from the
// under test: the pin drags its plane down to the water by design
// (the river cut), which is not a sag defect.
function groundTriError(tri) {
  const [a, b, c] = tri;
  const pinned = [a, b, c].some((v) => v[1] === DRAPE_WATER_PIN_Y && drapeHeight(v[0], v[2]) > 0);
  const cx = (a[0] + b[0] + c[0]) / 3, cz = (a[2] + b[2] + c[2]) / 3;
  const pts = [
    [cx, cz],
    [(a[0] + b[0]) / 2, (a[2] + b[2]) / 2],
    [(b[0] + c[0]) / 2, (b[2] + c[2]) / 2],
    [(c[0] + a[0]) / 2, (c[2] + a[2]) / 2],
  ];
  let over = -Infinity, under = -Infinity;
  for (const [x, z] of pts) {
    const d = groundPlaneY(a, b, c, x, z) - drapeHeight(x, z);
    if (d > over) over = d;
    if (!pinned && -d > under) under = -d;
  }
  return { over, under };
}

// Refinement mask (road proximity). The DEM's chord error only
// matters where the ground can cover something — within reach of a
// road (ribbons, signs, traffic) or a lot (buildings sit on lots,
// and lots front roads). Far from every road the ground is open
// mountainside: a coarse mesh there is invisible, and refining it
// is what explodes the triangle count (the feather cliff alone
// needs sub-metre triangles to follow a 300 m field to 0.02 m).
// The mask is a dilation of the road polylines on a coarse grid;
// a ground cell refines iff its centre cell is marked.
export const DRAPE_GROUND_MASK_CELL_M = 25;
export const DRAPE_GROUND_REFINE_RADIUS_M = 150;

export function buildDrapeRefineMask(roads, radiusM = DRAPE_GROUND_REFINE_RADIUS_M) {
  const cell = DRAPE_GROUND_MASK_CELL_M;
  const rings = Math.ceil(radiusM / cell);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const samples = [];
  for (const pts of roads || []) {
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const x0 = pts[i], z0 = pts[i + 1], x1 = pts[i + 2], z1 = pts[i + 3];
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.max(1, Math.ceil(len / 10));
      for (let k = 0; k <= n; k++) {
        const x = x0 + (x1 - x0) * k / n, z = z0 + (z1 - z0) * k / n;
        samples.push([x, z]);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
    }
  }
  if (!samples.length) return { needsRefine: () => false };
  minX -= radiusM; maxX += radiusM; minZ -= radiusM; maxZ += radiusM;
  const nx = Math.ceil((maxX - minX) / cell) + 1, nz = Math.ceil((maxZ - minZ) / cell) + 1;
  const grid = new Uint8Array(nx * nz);
  for (const [x, z] of samples) {
    const cx = Math.floor((x - minX) / cell), cz = Math.floor((z - minZ) / cell);
    for (let dz = -rings; dz <= rings; dz++) {
      for (let dx = -rings; dx <= rings; dx++) {
        const gx = cx + dx, gz = cz + dz;
        if (gx >= 0 && gx < nx && gz >= 0 && gz < nz) grid[gz * nx + gx] = 1;
      }
    }
  }
  return {
    cell, minX, minZ, nx, nz,
    needsRefine(x, z) {
      const cx = Math.floor((x - minX) / cell), cz = Math.floor((z - minZ) / cell);
      if (cx < 0 || cx >= nx || cz < 0 || cz >= nz) return false;
      return grid[cz * nx + cx] === 1;
    },
  };
}

// One adaptive triangulation over the drape footprint (each rect +
// feather), split into the pale block surface (DEM + 0.02) and the
// terrain patch surface (DEM - 0.02, vertex-coloured) by slope.
// waterRings are flat [x, z, ...] rings, as buildDrapePatchGrids
// takes them; vertices inside one are pinned to DRAPE_WATER_PIN_Y,
// the patch's rule, so rivers stay water. opts.roads is the road
// polylines (flat [x, z, ...]) that drive the refinement mask; with
// no roads the mask is empty and every cell stays coarse (the
// builder still returns a valid ground). opts.trenchSlots is the
// trench-slot rings (issue #263): quads intersecting one are
// skipped whole, counted in stats.slotSkippedQuads, so the trench
// stays open. Returns non-indexed triangle positions (the boot
// wraps them in BufferGeometry) plus a stats block the boot logs
// and tests pin.
export function buildAdaptiveDrapeGround(waterRings, opts = {}) {
  const mask = opts.mask || buildDrapeRefineMask(opts.roads || []);
  const refineAt = (x, z) => mask.needsRefine(x, z);
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
  // Trench slots (issue #263): the Wenhu Line dive portal + the
  // 復北地下道 approach cuts. The adaptive ground must not bridge
  // them — the flat land layer has holes there, and a ground surface
  // over a slot would bury the trench (the 復北地下道 underpass
  // reads as a filled-in slab). opts.trenchSlots is an array of
  // 4-point rings ([[x, z], ...]) as portalTrenchSlots /
  // roadTrenchSlots return them. A leaf quad or coarse cell whose
  // footprint intersects a slot is skipped whole (conservative:
  // the hole is accurate to the leaf/cell size, and the slot's
  // approach cutting reads as a shallow ditch around the trench
  // rather than a buried underpass). The intersection test mirrors
  // the boot's quadIntersectsPts (js/taipei-boot.js): bbox reject,
  // then a corner/vertex/midpoint inside either polygon, then a
  // proper edge crossing.
  const slotRings = (opts.trenchSlots || []).filter((r) => r && r.length >= 4).map((r) => {
    const pts = r.map((p) => [p[0], p[1]]);
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const [x, z] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    return { pts, minX, maxX, minZ, maxZ };
  });
  const pointInPoly = (x, z, pts) => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i++) {
      const [xi, zi] = pts[i], [xj, zj] = pts[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  };
  const quadIntersectsSlot = (x0, z0, x1, z1) => {
    const quad = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    for (const s of slotRings) {
      if (x1 < s.minX || x0 > s.maxX || z1 < s.minZ || z0 > s.maxZ) continue;
      if (quad.some((p) => pointInPoly(p[0], p[1], s.pts))) return true;
      if (s.pts.some((p) => p[0] >= x0 && p[0] <= x1 && p[1] >= z0 && p[1] <= z1)) return true;
      const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (s.pts.some((p, i) => { const m = mid(p, s.pts[(i + 1) % s.pts.length]); return m[0] >= x0 && m[0] <= x1 && m[1] >= z0 && m[1] <= z1; })) return true;
      if (quad.some((p, i) => pointInPoly(...mid(p, quad[(i + 1) % 4]), s.pts))) return true;
      const segX = (a, b, c, d) => {
        const den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
        if (Math.abs(den) < 1e-12) return false;
        const t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den;
        const u = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / -den;
        return t > 0 && t < 1 && u > 0 && u < 1;
      };
      if (s.pts.some((p, i) => quad.some((q, j) => segX(p, s.pts[(i + 1) % s.pts.length], q, quad[(j + 1) % 4])))) return true;
    }
    return false;
  };
  // A ground vertex: [x, drapeHeight, z], pinned under water.
  const vert = (x, z) => {
    const h = drapeHeight(x, z);
    return [x, (h > 0 && inWater(x, z)) ? DRAPE_WATER_PIN_Y : h, z];
  };
  const stats = { totalTris: 0, blockTris: 0, patchTris: 0, splits: 0, maxDepth: 0, maxResidualOver: -Infinity, maxResidualUnder: -Infinity, refinedCells: 0, coarseCells: 0, coarseTris: 0, slotSkippedQuads: 0, worstResidual: null };
  const blockPos = [], blockColors = [], blockNormals = [], patchByRegion = [];
  // Leaves are emitted straight into the position arrays (never collected):
  // the builder holds O(depth) live triangles, not O(leaves).
  const emit = (tri, patchPositions, patchColors, patchNormals) => {
    if (groundTriSlope(tri) < DRAPE_GROUND_PALE_SLOPE) {
      // Issue #345: the block side wears the same slope-blended
      // vertex colours and smooth DEM-gradient normals as the
      // patch side (drapeGroundVertex, a pure function of (x, z)),
      // so the colour and shading are continuous across the
      // block/patch split. Before this the block was uniformly
      // pale with per-face normals (computeVertexNormals on the
      // merged non-indexed mesh in the boot) — a brightness
      // checkerboard across all block ground plus a colour mosaic
      // wherever the split runs through built-up hillsides.
      for (const v of tri) {
        blockPos.push(v[0], v[1] + DRAPE_GROUND_BLOCK_Y, v[2]);
        const s = drapeGroundVertex(v[0], v[2], Math.max(0, v[1]));
        blockColors.push(s.color[0], s.color[1], s.color[2]);
        blockNormals.push(s.normal[0], s.normal[1], s.normal[2]);
      }
      stats.blockTris++;
    } else {
      for (const v of tri) {
        patchPositions.push(v[0], v[1] + DRAPE_GROUND_PATCH_Y, v[2]);
        // One ±14 m central-difference gradient per vertex, shared
        // by the colour slope and the smooth normal below (issue
        // #297): the patch mesh is non-indexed, so
        // computeVertexNormals gives face normals and flat shading
        // lights every triangle as a facet — measured, adjacent
        // triangles differ by 6.4° at block/patch boundaries and
        // 1.1° within the patch. A normal from the DEM gradient is
        // a pure function of (x, z), so the two triangles sharing
        // an edge agree exactly and the shading is continuous
        // across it. The boot sets this attribute and drops
        // flatShading.
        const s = drapeGroundVertex(v[0], v[2], Math.max(0, v[1]));
        patchColors.push(s.color[0], s.color[1], s.color[2]);
        patchNormals.push(s.normal[0], s.normal[1], s.normal[2]);
      }
      stats.patchTris++;
    }
  };
  const splitTri = (x0, z0, x1, z1, depth, patchPositions, patchColors, patchNormals) => {
    // Quadtree subdivision of one posting-aligned quad (never a
    // skinny triangle: every leaf is a square-ish quad, so the
    // chord error falls ~4x per level and the refinement converges
    // at a modest depth). A leaf's two triangles are emitted as-is.
    // Cracks at a refined/coarse boundary are bounded by the
    // tolerance: the coarser neighbour's plane meets the DEM within
    // tol at the shared edge midpoint, which is a sample point of
    // its own error test.
    const t1 = [vert(x0, z0), vert(x1, z1), vert(x1, z0)];
    const t2 = [vert(x0, z0), vert(x0, z1), vert(x1, z1)];
    const e1 = groundTriError(t1), e2 = groundTriError(t2);
    const over = Math.max(e1.over, e2.over), under = Math.max(e1.under, e2.under);
    if (depth >= DRAPE_GROUND_MAX_DEPTH || (over <= DRAPE_GROUND_TOL_M && under <= DRAPE_GROUND_TOL_UNDER_M)) {
      // A leaf over a trench slot is skipped whole: the trench
      // stays open (the flat land layer has a hole there) instead
      // of being bridged by a ground surface. The quad was
      // evaluated at this depth, so maxDepth still counts it.
      if (quadIntersectsSlot(x0, z0, x1, z1)) {
        stats.slotSkippedQuads++;
        stats.maxDepth = Math.max(stats.maxDepth, depth);
        return;
      }
      emit(t1, patchPositions, patchColors, patchNormals);
      emit(t2, patchPositions, patchColors, patchNormals);
      stats.maxDepth = Math.max(stats.maxDepth, depth);
      if (depth >= DRAPE_GROUND_MAX_DEPTH) {
        if (over > stats.maxResidualOver) {
          stats.maxResidualOver = over;
          const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
          stats.worstResidual = { x: cx, z: cz, over, dem: drapeDem(cx, cz), w: drapeWeight(cx, cz), h: drapeHeight(cx, cz) };
        }
        stats.maxResidualUnder = Math.max(stats.maxResidualUnder, under);
      }
      return;
    }
    stats.splits++;
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    splitTri(x0, z0, mx, mz, depth + 1, patchPositions, patchColors, patchNormals);
    splitTri(mx, z0, x1, mz, depth + 1, patchPositions, patchColors, patchNormals);
    splitTri(x0, mz, mx, z1, depth + 1, patchPositions, patchColors, patchNormals);
    splitTri(mx, mz, x1, z1, depth + 1, patchPositions, patchColors, patchNormals);
  };
  for (const r of DRAPE_RECTS) {
    const minX = r.minX - DRAPE_FEATHER, maxX = r.maxX + DRAPE_FEATHER;
    const minZ = r.minZ - DRAPE_FEATHER, maxZ = r.maxZ + DRAPE_FEATHER;
    // Base cells aligned to the DEM posting grid (see the constants
    // above): one quad per posting cell, clipped to the footprint.
    // No triangle straddles a posting-line kink.
    const i0 = Math.floor((minX - DRAPE_POSTING_X0) / DRAPE_POSTING_STEP_X);
    const i1 = Math.floor((maxX - DRAPE_POSTING_X0) / DRAPE_POSTING_STEP_X);
    const j0 = Math.floor((minZ - DRAPE_POSTING_Z0) / DRAPE_POSTING_STEP_Z);
    const j1 = Math.floor((maxZ - DRAPE_POSTING_Z0) / DRAPE_POSTING_STEP_Z);
    const positions = [], colors = [], normals = [];
    let triCount = 0;
    const beforePatch = stats.patchTris;
    for (let j = j0; j <= j1; j++) {
      const z0 = Math.max(minZ, DRAPE_POSTING_Z0 + j * DRAPE_POSTING_STEP_Z);
      const z1 = Math.min(maxZ, DRAPE_POSTING_Z0 + (j + 1) * DRAPE_POSTING_STEP_Z);
      if (z1 <= z0) continue;
      for (let i = i0; i <= i1; i++) {
        const x0 = Math.max(minX, DRAPE_POSTING_X0 + i * DRAPE_POSTING_STEP_X);
        const x1 = Math.min(maxX, DRAPE_POSTING_X0 + (i + 1) * DRAPE_POSTING_STEP_X);
        if (x1 <= x0) continue;
        // Cells far from every road stay coarse (2 triangles, no
        // refinement): their chord error cannot cover a road, a lot
        // or a sign. Refined cells split until within tolerance.
        if (refineAt((x0 + x1) / 2, (z0 + z1) / 2)) {
          stats.refinedCells++;
          splitTri(x0, z0, x1, z1, 0, positions, colors, normals);
        } else if (quadIntersectsSlot(x0, z0, x1, z1)) {
          // A coarse cell over a trench slot is skipped whole (it
          // still counts as a coarse cell, so the stats invariant
          // totalTris == 2*(refined+coarse) + 6*splits -
          // 2*slotSkippedQuads holds); it emits no triangles.
          stats.coarseCells++;
          stats.slotSkippedQuads++;
        } else {
          stats.coarseCells++;
          const t1 = [vert(x0, z0), vert(x1, z1), vert(x1, z0)];
          const t2 = [vert(x0, z0), vert(x0, z1), vert(x1, z1)];
          emit(t1, positions, colors, normals); emit(t2, positions, colors, normals);
          stats.coarseTris += 2;
        }
      }
    }
    triCount = stats.patchTris - beforePatch;
    patchByRegion.push({ name: r.name, positions: new Float32Array(positions), colors: new Float32Array(colors), normals: new Float32Array(normals), triCount });
  }
  stats.totalTris = stats.blockTris + stats.patchTris;
  return { block: new Float32Array(blockPos), blockColors: new Float32Array(blockColors), blockNormals: new Float32Array(blockNormals), patch: patchByRegion, stats };
}
