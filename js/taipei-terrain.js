// js/taipei-terrain.js — visual-only DEM terrain skin (issue #129):
// pure geometry for the baked heightfield grids the pipeline emits
// into geodata.terrain (tools/taipei/build-terrain.mjs, SRTM GL1).
// No three.js here — taipei-boot.js wraps the arrays into meshes, so
// node tests pin the geometry directly.
//
// The skin is a BACKDROP, not terrain: one displaced mesh per grid
// (round 1, #129: Beitou box + corridor north; round 2, #187: the
// north-rim grid behind the airport-north strip and the east-rim
// grid on box A), seated over the tile's mountain rims. Vertex height =
//
//   DEM x smoothstep(15 m -> 45 m) x roadMask x edgeFade - 0.3 m
//
// - the gain keeps the basin floor and Beitou town at zero (the mesh
//   hides 0.3 m under the land planes there — the Guandu plain, DEM
//   median 3 m, stays exactly as flat as it really is);
// - the road mask (baked from the generation map's roadbed
//   centrelines: 0 within 35 m, 1 beyond 120 m) keeps every road on
//   its flat bench, so nothing the player can reach ever meets the
//   mesh — roads, buildings, junctions, decks, pedestrians and the
//   controllers' groundHeight() === 0 are all untouched by design;
// - edge fades (baked per grid) tuck the mesh under the flat ground
//   at its outer south/west/east edges over 4 postings; the shared
//   beitou/corridor edge does not fade (the two grids share lattice
//   postings along it, so the meshes meet seamlessly) and the north
//   edge keeps its height — it is the horizon massif.
//
// Colours are per-vertex, flat-shaded by face normals: deep forest
// greens matched to the Esri satellite read of the Datun slopes
// (the #117 prototype's pale mint bands were explicitly corrected
// in #129), with a dark rock tint on steep faces. The palette sits
// in the game's hex discipline — deeper than park lawn 0x56854a and
// the median shrub 0x4c5c33, as befits a backdrop.

export const TERRAIN_GAIN_LO = 15;   // DEM at/below this stays at floor level
export const TERRAIN_GAIN_HI = 45;   // DEM at/above this rises at full height
export const TERRAIN_SINK = 0.3;     // metres the skin tucks under the land planes
export const TERRAIN_FADE_CELLS = 4; // postings over which outer edges fade out

const C_LOW = 0x131b06;   // scrub at the valley edges
const C_MID = 0x0a1304;   // deep forest green, the main hill band
const C_HIGH = 0x111708;  // higher slopes, a step greyer
const C_ROCK = 0x19150c;  // steep faces
// The hexes read near-black on paper: they are albedos under the
// game's midday rig (strong sun + blue aerial haze at backdrop
// distances), which lifts and washes everything it touches — the
// #117 prototype's mid band (0.30, 0.39, 0.22) rendered pale mint
// through the same rig, and a first production cut at roughly
// prototype depth still sampled sage (street-shot hill median
// sRGB (125, 152, 140)). The shipped values were tuned on the
// production stage renders (terra-skin-evidence) until the massif
// read as deep forest green against the Esri satellite read:
// street-shot hill median (120, 143, 132) — the sunlit facets carry
// the remaining haze lift, the shadow facets sit at satellite
// depth, and green dominates blue in every facet.
const rgb = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
const COL = { low: rgb(C_LOW), mid: rgb(C_MID), high: rgb(C_HIGH), rock: rgb(C_ROCK) };

const sstep = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix3 = (c1, c2, t) => [c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t, c1[2] + (c2[2] - c1[2]) * t];

// The height rule for one posting, before the edge fade.
export function terrainSkinHeight(dem, mask) {
  return dem * sstep(TERRAIN_GAIN_LO, TERRAIN_GAIN_HI, dem) * mask - TERRAIN_SINK;
}

// Fade multiplier for a posting: 0..1 ramps over TERRAIN_FADE_CELLS
// postings in from each edge the bake flagged as fading.
export function terrainEdgeFade(grid, r, c) {
  const f = grid.fade || {};
  let e = 1;
  if (f.w) e = Math.min(e, c / TERRAIN_FADE_CELLS);
  if (f.e) e = Math.min(e, (grid.cols - 1 - c) / TERRAIN_FADE_CELLS);
  if (f.s) e = Math.min(e, (grid.rows - 1 - r) / TERRAIN_FADE_CELLS);
  if (f.n) e = Math.min(e, r / TERRAIN_FADE_CELLS);
  return e;
}

function vertexColor(grid, r, c, dx, dz) {
  const { cols, rows, h } = grid;
  const dem = h[r * cols + c];
  let col = dem < 80
    ? mix3(COL.low, COL.mid, sstep(10, 80, dem))
    : mix3(COL.mid, COL.high, sstep(80, 300, dem));
  const gx = (h[r * cols + Math.min(cols - 1, c + 1)] - h[r * cols + Math.max(0, c - 1)]) / (2 * dx);
  const gz = (h[Math.min(rows - 1, r + 1) * cols + c] - h[Math.max(0, r - 1) * cols + c]) / (2 * dz);
  const slope = Math.hypot(gx, gz);
  return mix3(col, COL.rock, sstep(0.55, 1.1, slope) * 0.7);
}

// buildTerrainSkinGeometry(terrain) -> {
//   positions, normals, colors (Float32Arrays, non-indexed triangles),
//   triCount, grids: [{ box, triCount, maxY }] }
// One triangle soup across all grids; winding gives outward (+y-ish)
// face normals, computed per face so the shading is flat.
export function buildTerrainSkinGeometry(terrain) {
  const pos = [], nor = [], col = [];
  const grids = [];
  let triCount = 0;
  for (const grid of terrain?.grids || []) {
    const { cols, rows, x0, z0, x1, z1, h, mask } = grid;
    if (!cols || !rows || !h || !mask) continue;
    const dx = (x1 - x0) / (cols - 1), dz = (z1 - z0) / (rows - 1);
    // Per-posting vertices (position + colour), shared by the
    // triangle emission below; normals are per-face.
    const vx = new Float32Array(cols * rows * 3);
    const vc = new Float32Array(cols * rows * 3);
    let maxY = -Infinity;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const fade = terrainEdgeFade(grid, r, c);
        const rise = h[i] * sstep(TERRAIN_GAIN_LO, TERRAIN_GAIN_HI, h[i]) * mask[i];
        const yy = rise * fade - TERRAIN_SINK;
        vx[i * 3] = x0 + c * dx; vx[i * 3 + 1] = yy; vx[i * 3 + 2] = z0 + r * dz;
        const cc = vertexColor(grid, r, c, dx, dz);
        vc[i * 3] = cc[0]; vc[i * 3 + 1] = cc[1]; vc[i * 3 + 2] = cc[2];
        if (yy > maxY) maxY = yy;
      }
    }
    const P = (i) => [vx[i * 3], vx[i * 3 + 1], vx[i * 3 + 2]];
    const quad = (a, b, c2, d) => { // two triangles (a, c2, b) + (b, c2, d) in grid order
      for (const tri of [[a, c2, b], [b, c2, d]]) {
        const A = P(tri[0]), B = P(tri[1]), Cc = P(tri[2]);
        const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2];
        const wx = Cc[0] - A[0], wy = Cc[1] - A[1], wz = Cc[2] - A[2];
        let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
        const L = Math.hypot(nx, ny, nz) || 1;
        nx /= L; ny /= L; nz /= L;
        for (const i of tri) { pos.push(vx[i * 3], vx[i * 3 + 1], vx[i * 3 + 2]); nor.push(nx, ny, nz); col.push(vc[i * 3], vc[i * 3 + 1], vc[i * 3 + 2]); }
        triCount++;
      }
    };
    let gTris = 0;
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
        quad(a, b, d, e); gTris += 2;
      }
    }
    grids.push({ box: grid.box, triCount: gTris, maxY });
  }
  return {
    positions: new Float32Array(pos), normals: new Float32Array(nor), colors: new Float32Array(col),
    triCount, grids,
  };
}
