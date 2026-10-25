// js/taipei-buildings.js
// Procedural buildings for registry tiles (buildings increment).
//
// The geodata's blocks are raster components: each carries only a bbox,
// a centroid and an area — no lot rects, no frontage frames (see
// tools/taipei/GEO_CONTRACT.md). This module subdivides those bboxes
// into plausible lots and plans one building box per lot. The planner
// (planTaipeiBuildings) is pure data — no three.js — so tests can pin
// its invariants. RENDERING is not done here: taipeiCityBlocksOptions
// adapts a plan into the lot list upstream's own building system
// (js/buildings.js buildCityBlocks) consumes, so Taipei's buildings are
// built by the exact machinery Manhattan renders with — facade boxes,
// TSL facade materials, cornices, rooftop gear, quadtree detail
// streaming. (The first Taipei increment rendered the plan itself with
// a custom InstancedMesh + setColorAt material; those buildings never
// appeared on mobile WebGPU — issue #11. Only the Taipei 101 massing,
// a plain Mesh group, is still built here.)
//
// Placement rules (all deterministic — a hash of block/lot index, never
// Math.random, so plans are byte-stable across runs and machines):
//   - Blocks under 150 m² are skipped, and so is any block whose
//     centroid falls inside a park, water or green-land polygon
//     (issue #114: farmland / nature / recreation ground, e.g. the
//     Guandu plain and the riverside bands, carry no city lots).
//   - A block's bbox is inset by 3 m (the street-section band the ground
//     builder draws around each roadbed lives in that margin), then cut
//     into a lot grid: frontage 15–25 m, depth 15–22 m per lot, with a
//     1.2–3 m gap between neighbouring footprints. Very large blocks
//     (> 40,000 m² — campuses, depots, riverside tracts) use a coarser
//     pitch and a higher vacancy rate so they don't read as carpet.
//   - Issue #106: a block face that fronts a collector-or-better road
//     (tertiary rank ≥ 2, measured per block edge — see the frontage
//     section in the planner) packs its row to ZERO side gap with no
//     vacancy holes: Taipei's main streets are continuous party-wall
//     frontages, not detached slabs. Faces on lanes/alleys keep the
//     gapped subdivision above.
//   - The tile is a union of boxes (issue #60): a block whose centroid
//     is outside every box is skipped, and a lot whose centre or any
//     footprint corner leaves the union is dropped — nothing is
//     planned over a dropped band.
//   - A lot is dropped when its centre falls inside a park/water or
//     green-land polygon (exact point-in-polygon, so a park that merely overlaps a
//     block's bbox still stays empty — Da'an Forest Park above all),
//     when its footprint intersects the Taipei 101 landmark site, or
//     when it fails the exact ribbon tests of issue #65 (below):
//     the footprint grown by ROAD_MARGIN_M must not intersect any
//     roadbed/path ribbon segment rectangle, and a lot flanked on
//     opposite sides by ribbons of the same named carriageway sits
//     inside that road's divided span (a median/separator strip) and
//     is dropped too. (The pre-#65 centre/corner sampling could not
//     see a ribbon slicing a lot through two edges — 2,606 of the
//     2,621 lot∩ribbon intersections citywide were that case — nor
//     the planted strips between a boulevard's separate carriageway
//     beds, where whole lot columns stood on the Dunhua medians.)
//   - Heights are contextual, from distance to the tile origin (Taipei
//     101) and the best road class adjacent to the lot:
//       < 650 m from origin (Xinyi core)      → 25–60 m
//       next to a secondary-or-better road    → 12–30 m
//       everything else (residential lanes)   →  8–18 m
//     Issue #106 adds the frontage regime on top: a lot standing in a
//     block face that fronts a main road draws its height from that
//     face's class instead (the Xinyi core band still wins there):
//       primary-or-better face (rank ≥ 4)     → 24–54 m
//       secondary face (rank 3)               → 18–42 m
//       tertiary/collector face (rank 2)      → 15–30 m
//     — the Taipei pattern of tall continuous walls on the big roads
//     with the low walk-up fabric behind them in the lanes.
//   - Issue #128: where the height layer (geodata.heights, built by
//     tools/taipei/build-heights.py from the OGDL permit/door
//     datasets and OSM height tags) carries a REAL signal for a lot,
//     the real height wins over every band above — permit floors,
//     then an OSM footprint's height/levels at the lot centre, then
//     the median door floors of the lot's block face. Lots with no
//     signal of their own blend their band draw with the median real
//     height within 100 m (the neighbourhood field). Every lot is
//     labelled (hSrc) real vs estimated; see the join section in the
//     planner and HEIGHT_JOIN below.
//   - Colours come from a Taipei-plausible palette (concrete greys,
//     tile beige, brick) with a small per-lot brightness jitter.
//
// Taipei 101 itself is a massing placeholder, not a model: a podium
// plus the tower's signature eight identical stacked, flared
// trapezoid tiers, a narrower top section and a spire, at the
// landmark's true 508 m overall height, in dark
// glass-green. It stands on the northern part of the landmark site so
// the tile's spawn points (at the landmark point, south of it) stay in
// the open. Detailed facade treatment is later scope.
//
// Issue #40 gives the placeholder its real base and its ornaments.
// The podium is the Taipei 101 Mall massing: two 30 m blocks (the
// mall's L wrapped around the tower zone; outline from the geodata
// "Taipei 101 MALL" footprint) flanking an open entrance court on
// the tower axis — the court is the gameplay simplification that
// keeps the spawn point in the open — plus the mall's signature
// sweeping curved roof as a half-frustum shell over the court's west
// side (the bright shell measures ~48 × 75 m on Esri z18 satellite).
// The published podium main roof is 124 ft ≈ 37.8 m (CTBUH diagram
// data); 30 m keeps the mall subordinate to the first tier's flare.
// The eight tier joints wear the tower's ornaments as ONE merged
// light-tone soup: a disc at each corner of every joint (the real
// ruyi stand ≥ 8 m tall at the segment corners; the disc is the
// simplification the souvenir models also use), a square plaque at
// each face centre (the "money box" symbol between facade
// sections), and — only at the first joint, where the real building
// puts them — four large coin discs, one per face ("the four discs
// mounted on each face of the building where the pedestal meets the
// tower represent coins" — Wikipedia, Taipei 101, Symbolism).
//
// The same massing treatment covers the other notable structures
// around 101 (LANDMARK_STRUCTURES below, issue #26): each is a small
// set of plain parts — boxes, rectangular frustums, one ridge roof,
// one slanted cap, one twisted stack — at its true position (real
// lat/lon run through the geodata builder's exact frame math) and
// true total height, with ONE signature silhouette feature modelled
// and the rest left plain. Their sites (and Taipei City Hall's open
// Civic Plaza) are registered alongside the 101 site so the generic
// lot planner keeps off them. Facade detail stays out of scope
// (issue #17 owns surfaces).
//
// Buildings are visual only: no colliders (the options pass
// colliders: false), no interiors, no shop signs (the localization
// increment owns signage). Lots front their street: each block's lot
// grid turns to the block's dominant frontage angle (issue #62, see
// the orientation section below), and a turned lot carries its angle
// as `rot`; blocks on the true grids stay axis-aligned exactly as
// before. The plan's per-lot colours are no longer used for
// rendering — upstream's facade materials carry their own palettes —
// but stay in the plan as data.

const PALETTE = [
  [0.62, 0.59, 0.55], // concrete grey
  [0.55, 0.52, 0.48], // darker concrete
  [0.68, 0.64, 0.58], // light concrete
  [0.78, 0.71, 0.60], // tile beige
  [0.72, 0.65, 0.55], // sand tile
  [0.64, 0.46, 0.37], // brick
  [0.58, 0.40, 0.33], // dark brick
  [0.82, 0.79, 0.74], // plaster off-white
  [0.56, 0.59, 0.59], // grey-blue tile
  [0.70, 0.62, 0.52], // ochre tile
];

const CLASS_RANK = { motorway: 6, trunk: 5, primary: 4, secondary: 3, tertiary: 2 };
const NON_CARRIAGEWAY = new Set(['footway', 'path', 'steps', 'pedestrian', 'cycleway', 'corridor', 'elevator', 'crossing', 'platform', 'traffic_island']);

// Deterministic 0..1 hash of an integer seed (splitmix-style finaliser).
function hash01(seed) {
  let h = (seed | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function ringBbox(ring) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i + 1 < ring.length; i += 2) {
    if (ring[i] < minX) minX = ring[i];
    if (ring[i] > maxX) maxX = ring[i];
    if (ring[i + 1] < minZ) minZ = ring[i + 1];
    if (ring[i + 1] > maxZ) maxZ = ring[i + 1];
  }
  return { minX, maxX, minZ, maxZ };
}

// Even-odd ray cast against a flat [x, z, ...] ring (closing duplicate
// point, if present, is harmless: it adds a zero-length edge).
export function pointInRing(x, z, ring) {
  let inside = false;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i * 2], zi = ring[i * 2 + 1];
    const xj = ring[j * 2], zj = ring[j * 2 + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// Shortest distance from a point to a flat ring's boundary.
function distToRing(x, z, ring) {
  let best = Infinity;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const d = distToSegment(x, z, ring[j * 2], ring[j * 2 + 1], ring[i * 2], ring[i * 2 + 1]);
    if (d < best) best = d;
  }
  return best;
}

function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const ex = ax + t * dx - px, ez = az + t * dz - pz;
  return Math.hypot(ex, ez);
}

// Uniform-grid index over road centreline segments. A segment is filed
// under every cell its bbox (expanded by QUERY_R) touches, so a point
// query only needs its own cell to find every segment within QUERY_R.
const GRID_CELL = 48;
const QUERY_R = 34;
function buildSegmentGrid(entries) {
  const grid = new Map();
  const key = (gx, gz) => gx * 100003 + gz;
  for (const e of entries) {
    for (let i = 0; i + 3 < e.pts.length; i += 2) {
      const ax = e.pts[i], az = e.pts[i + 1], bx = e.pts[i + 2], bz = e.pts[i + 3];
      const seg = { ax, az, bx, bz, half: Math.max((e.width || 3) / 2, 0.75), rank: CLASS_RANK[e.highway] || 1 };
      const gx0 = Math.floor((Math.min(ax, bx) - QUERY_R) / GRID_CELL), gx1 = Math.floor((Math.max(ax, bx) + QUERY_R) / GRID_CELL);
      const gz0 = Math.floor((Math.min(az, bz) - QUERY_R) / GRID_CELL), gz1 = Math.floor((Math.max(az, bz) + QUERY_R) / GRID_CELL);
      for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
        const k = key(gx, gz);
        let bucket = grid.get(k);
        if (!bucket) grid.set(k, bucket = []);
        bucket.push(seg);
      }
    }
  }
  return { grid, key };
}

// ---- Exact ribbon exclusion (issue #65) ----
//
// Ribbons are the per-segment butt-cap rectangles the ground renderer
// draws (half = max(width/2, 0.75)) — the same construction the
// landmark overlap test audits against, so "no intersection" here
// means no intersection with what is actually rendered as road.
const ROAD_MARGIN_M = 0.5;       // footprint clearance kept off every ribbon edge
const CORRIDOR_GAP_MAX_M = 20;   // same-name flank reach for the median test
const RIBBON_GRID_CELL = 48;
const RIBBON_REACH_M = ROAD_MARGIN_M + CORRIDOR_GAP_MAX_M + 6; // grid filing slack

function buildRibbonRects(entries, flank) {
  const rects = [];
  for (const e of entries) {
    const half = Math.max((e.width || 3) / 2, 0.75);
    const pts = e.pts || [];
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3];
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
      if (len < 0.01) continue;
      const ux = dx / len, uz = dz / len;
      const nx = (-dz / len) * half, nz = (dx / len) * half;
      const xs = [ax + nx, bx + nx, bx - nx, ax - nx];
      const zs = [az + nz, bz + nz, bz - nz, az - nz];
      rects.push({
        name: e.name || '', flank, ux, uz,
        minX: Math.min(...xs), maxX: Math.max(...xs),
        minZ: Math.min(...zs), maxZ: Math.max(...zs),
        corners: [xs[0], zs[0], xs[1], zs[1], xs[2], zs[2], xs[3], zs[3]],
      });
    }
  }
  return rects;
}

// Rects are filed under every cell their bbox (expanded by
// RIBBON_REACH_M) touches, so a query over the cells a lot's bbox
// touches finds every rect that could intersect the lot or flank it
// within CORRIDOR_GAP_MAX_M.
function buildRibbonGrid(rects) {
  const grid = new Map();
  const key = (gx, gz) => gx * 100003 + gz;
  rects.forEach((r, idx) => {
    const gx0 = Math.floor((r.minX - RIBBON_REACH_M) / RIBBON_GRID_CELL);
    const gx1 = Math.floor((r.maxX + RIBBON_REACH_M) / RIBBON_GRID_CELL);
    const gz0 = Math.floor((r.minZ - RIBBON_REACH_M) / RIBBON_GRID_CELL);
    const gz1 = Math.floor((r.maxZ + RIBBON_REACH_M) / RIBBON_GRID_CELL);
    for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
      const k = key(gx, gz);
      let bucket = grid.get(k);
      if (!bucket) grid.set(k, bucket = []);
      bucket.push(idx);
    }
  });
  return { grid, key };
}

// The interval where a ribbon rect crosses the horizontal line z
// (resp. the vertical line x), or null when the line misses the rect.
// The flank tests must use these true crossings, never the rect's
// bbox: a slanted segment's bbox overhangs the rect at any given z,
// and a bbox-based flank test misses the very bed that borders the
// lot (the Dunhua median columns survived a bbox flank test on
// 0.1–0.8 m of bbox overhang).
function ribbonSpanAtZ(r, z) {
  const c = r.corners;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 8; i += 2) {
    const x1 = c[i], z1 = c[i + 1], x2 = c[(i + 2) % 8], z2 = c[(i + 3) % 8];
    if (z1 === z) { if (x1 < lo) lo = x1; if (x1 > hi) hi = x1; }
    if ((z1 < z && z2 > z) || (z2 < z && z1 > z)) {
      const x = x1 + ((z - z1) * (x2 - x1)) / (z2 - z1);
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
  }
  return lo <= hi ? [lo, hi] : null;
}
function ribbonSpanAtX(r, x) {
  const c = r.corners;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 8; i += 2) {
    const x1 = c[i], z1 = c[i + 1], x2 = c[(i + 2) % 8], z2 = c[(i + 3) % 8];
    if (x1 === x) { if (z1 < lo) lo = z1; if (z1 > hi) hi = z1; }
    if ((x1 < x && x2 > x) || (x2 < x && x1 > x)) {
      const z = z1 + ((x - x1) * (z2 - z1)) / (x2 - x1);
      if (z < lo) lo = z;
      if (z > hi) hi = z;
    }
  }
  return lo <= hi ? [lo, hi] : null;
}

// Separating-axis test of one ribbon rect against an axis-aligned lot
// rect. The caller has already established bbox overlap, which covers
// the lot's own two axes; only the ribbon's axes are projected here.
function ribbonHitsLot(r, minX, maxX, minZ, maxZ) {
  const c = r.corners;
  for (const [axx, azz] of [[r.ux, r.uz], [-r.uz, r.ux]]) {
    let rMin = Infinity, rMax = -Infinity;
    for (let i = 0; i < 8; i += 2) {
      const p = c[i] * axx + c[i + 1] * azz;
      if (p < rMin) rMin = p;
      if (p > rMax) rMax = p;
    }
    let lMin = Infinity, lMax = -Infinity;
    for (const [px, pz] of [[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]]) {
      const p = px * axx + pz * azz;
      if (p < lMin) lMin = p;
      if (p > lMax) lMax = p;
    }
    if (rMax < lMin || lMax < rMin) return false;
  }
  return true;
}
//
// Every entry was verified against published sources (Wikipedia /
// CTBUH Skyscraper Center; heights are the published architectural /
// roof heights) and a reference photo (URLs in the PR). Positions are
// real lat/lon converted with the geodata builder's own frame math
// (tools/taipei/build-taipei-geodata.mjs: WGS84 radii at the origin),
// so a structure stands where it stands in the world. `parts` are
// declarative massing primitives the renderer
// (createTaipeiLandmarkTowers) turns into plain meshes:
//
//   box      { w, d, h, y0?, dx?, dz?, rotY? }   block; rotY turns
//              it in the tile plane (planner convention — the
//              renderer negates it for THREE, see
//              createTaipeiLandmarkTowers)
//   frustum  { wB, dB, wT, dT, h, y0?, topDropX? }
//              rectangular frustum; topDropX lowers the +x top edge
//              by that many metres (a diagonal-cut crown)
//   ridge    { w, d, h, ridgeH, y0? }   hip roof: side walls to h,
//              then slopes up to a ridge along x at h + ridgeH
//   cylinder { r, h, y0?, dx?, dz?, rz? }   rz gives an elliptical
//              plan: radius r along x, rz along z (a scaled cylinder)
//   dome     { rx, rz, h, y0?, dx?, dz? }   half-ellipsoid: radii rx
//              (x) and rz (z), rising h above y0
//
// `site` is the lot-exclusion rectangle (centred on the structure,
// dx/dz offset allowed); `plaza` is an extra exclusion rectangle that
// carries NO mass — open ground that must stay open.

const FRAME_A = 6378137.0, FRAME_E2 = 6.69437999014e-3;
export function latLonToTile(lat, lon, originLatLon) {
  const [lat0, lon0] = originLatLon;
  const phi0 = (lat0 * Math.PI) / 180, sin0 = Math.sin(phi0);
  const nRad = FRAME_A / Math.sqrt(1 - FRAME_E2 * sin0 * sin0);
  const mRad = (FRAME_A * (1 - FRAME_E2)) / Math.pow(1 - FRAME_E2 * sin0 * sin0, 1.5);
  const kx = (Math.PI / 180) * nRad * Math.cos(phi0); // metres per degree lon
  const ky = (Math.PI / 180) * mRad;                  // metres per degree lat
  return [Math.round((lon - lon0) * kx * 10) / 10, Math.round(-(lat - lat0) * ky * 10) / 10];
}

// Tao Zhu Yin Yuan's twist as stacked segments: a plain base, then
// 21 floor slabs each rotated 4.5° past the one below (the real
// tower's DNA twist totals 90° from bottom to top), and the rooftop
// helipad as a thin disc whose top is the true 93.2 m.
function taoZhuParts() {
  const parts = [{ type: 'box', w: 58, d: 42, h: 5 }];
  const segH = (92.7 - 5) / 21;
  for (let i = 0; i < 21; i++) {
    parts.push({ type: 'box', w: 50, d: 32, h: segH, y0: 5 + i * segH, rotY: (i * 4.5 * Math.PI) / 180 });
  }
  parts.push({ type: 'cylinder', r: 10, h: 0.5, y0: 92.7 });
  return parts;
}

const LANDMARK_STRUCTURES = [
  {
    // 272 m, 48F, completed 2018 (Wikipedia / CTBUH). Dark tapered
    // shaft over the 7-storey Breeze Nan Shan mall podium, topped by
    // the sloped diamond crown — modelled as a ridge roof.
    // 微風南山 Breeze Nan Shan is NOT a separate structure: it is
    // this complex's podium department store, so the podium mass
    // below is its representation.
    // Position/footprint corrected in issue #42 from the OSM
    // building outlines (ways 383731054 南山廣場 + 513491894
    // 微風南山): the published coordinate is the complex's west
    // entrance, and the original single 150×105 podium box reached
    // ~44 m south across 松廉路. The podium is now three boxes on
    // the real outlines, kept west of the 松壽路20巷 ribbon that
    // clips the outline's NE notch; the axis sits under the tower
    // (z18 satellite: the dark slab stands centre-complex).
    id: 'taipei-nan-shan-plaza', name: 'Taipei Nan Shan Plaza', nameZh: '臺北南山廣場',
    lat: 25.0344, lon: 121.566982, realHeight: 272, color: 0x2c3540,
    site: { w: 242, d: 64, dx: -5, dz: -1 },
    // Issue #57: dark blue-grey curtain wall on the shaft; the mall
    // podium gets a lighter, wider-bayed curtain variant and the
    // Breeze wordmark the real podium carries.
    facade: { kind: 'curtain', glassTint: 0x1b2836, frameTint: 0x6d7885, windowWidth: 2.6, floorHeight: 4.2, litProbability: 0.34, warmth: 0.58, reflectivity: 0.92, seed: 57.11 },
    sign: { text: 'Breeze', w: 30, h: 5, y: 20, dx: 20, dz: 28.4, bg: '#22262c', fg: '#ece5d3', accent: '#c8372d' },
    parts: [
      { type: 'box', w: 108, d: 54, h: 30, dx: -77, dz: 1, facade: { kind: 'curtain', glassTint: 0x2a3745, frameTint: 0x59636e, windowWidth: 3.2, floorHeight: 3.6, litProbability: 0.42, warmth: 0.6, reflectivity: 0.9, seed: 57.12 } },
      { type: 'box', w: 66, d: 58, h: 34, dx: 20, dz: -1, facade: { kind: 'curtain', glassTint: 0x2a3745, frameTint: 0x59636e, windowWidth: 3.2, floorHeight: 3.6, litProbability: 0.42, warmth: 0.6, reflectivity: 0.9, seed: 57.12 } },
      { type: 'box', w: 48, d: 38, h: 34, dx: 90, dz: 8, facade: { kind: 'curtain', glassTint: 0x2a3745, frameTint: 0x59636e, windowWidth: 3.2, floorHeight: 3.6, litProbability: 0.42, warmth: 0.6, reflectivity: 0.9, seed: 57.12 } },
      { type: 'frustum', wB: 52, dB: 40, wT: 47, dT: 36, h: 208, y0: 34 },
      { type: 'ridge', w: 47, d: 36, h: 0, ridgeH: 30, y0: 242 },
    ],
  },
  {
    // 280 m, 56F (CTBUH). Topped out and fully clad — CTBUH lists it
    // Completed (2025); the two Hyatt hotels inside are not yet open.
    // ACPV (architect): a green "bamboo shoot" — pleated shaft that
    // narrows gently all the way up to a slanted shoot-tip cut.
    // Footprint corrected in issue #42 from the OSM outline (way
    // 1339580862): the real plan is a narrow 41.6 × 92.4 m slab, so
    // the podium is that slab (not the original 96 × 72 box, which
    // spilled across 松智路15巷) and the shoot's frustums run long
    // in z to match; the east faces stay inside the outline, clear
    // of the construction-road ribbon hugging its east edge.
    id: 'the-sky-taipei', name: 'The Sky Taipei', nameZh: '台北天空塔',
    lat: 25.036458, lon: 121.566047, realHeight: 280, color: 0x5d7a6c,
    site: { w: 44, d: 96, dx: 0, dz: -2 },
    // Issue #57: pale sage-green pleated glass — narrow bays, tall
    // floors, high reflectivity.
    facade: { kind: 'curtain', glassTint: 0x51665c, frameTint: 0x9fb4a6, windowWidth: 2.2, floorHeight: 4.6, litProbability: 0.3, warmth: 0.5, reflectivity: 0.94, seed: 57.13 },
    parts: [
      // Podium stops at the construction-road ribbon along the
      // outline's north edge (issue #42 audit: the ribbon's south
      // edge reaches z ≈ -424 in tile coords).
      { type: 'box', w: 37, d: 78, h: 22, dz: 4 },
      { type: 'frustum', wB: 35, dB: 47, wT: 31, dT: 42, h: 120, y0: 22 },
      { type: 'frustum', wB: 31, dB: 42, wT: 27, dT: 37, h: 118, y0: 142 },
      { type: 'frustum', wB: 27, dB: 37, wT: 25, dT: 35, h: 20, y0: 260, topDropX: 14 },
    ],
  },
  {
    // 266.3 m, 56F, completed 2022 (Wikipedia / Fubon). Renzo
    // Piano's crystalline shard: a square shaft with cut-back notch
    // corners (the exposed perimeter bracing lives in the notch —
    // facade territory, not massing) tapering steadily to a slanted
    // top; the low Fubon Art Museum block stands east of the tower.
    // Position corrected in issue #42: the batch-1 coordinate stood
    // ~72 m NW of the tower, ON 松高路 — the axis is now the OSM
    // tower footprint's centroid (way 1010525370 富邦信義A25總部,
    // 45.8 × 44.1 m), and the east blocks are the real annex (way
    // 1131522119) and museum (way 1131522120 富邦美術館) outlines.
    id: 'fubon-xinyi-a25', name: 'Fubon Xinyi A25', nameZh: '富邦信義A25',
    lat: 25.039629, lon: 121.570578, realHeight: 266.3, color: 0x8fa5b5,
    site: { w: 120, d: 74, dx: 36, dz: 14 },
    // Issue #57: light stone-and-glass grid (the prewar masonry
    // factory reads as Piano's stone frame with glazing between).
    facade: { kind: 'prewar', stoneColor: 0xb9bdc2, trimColor: 0x8f959c, windowGlassColor: 0x27384a, windowWidth: 3.0, floorHeight: 4.4, litProbability: 0.3, warmth: 0.55, seed: 57.14 },
    parts: [
      { type: 'box', w: 47, d: 16, h: 12, dx: 51, dz: 8 },
      { type: 'box', w: 56, d: 21, h: 15, dx: 66, dz: 38 },
      { type: 'frustum', wB: 43, dB: 43, wT: 32, dT: 32, h: 250 },
      { type: 'frustum', wB: 32, dB: 32, wT: 30, dT: 30, h: 16.3, y0: 250, topDropX: 10 },
    ],
  },
  {
    // 212 m, 46F, completed 2015 (Wikipedia / CTBUH). The massing
    // is TWO combined rectangular slabs — a taller main slab and a
    // stepped, slightly shorter secondary slab joined along the
    // top section — on a wide, low, curved-front mall podium (the
    // user's reference photo, 2026-10-24; this replaces the earlier
    // massing, a single slab under a four-step staircase crown,
    // which the photo contradicts). 微風信義 Breeze Xinyi is NOT a
    // separate structure: it is the department store inside this
    // tower (忠孝東路五段68號 — the podium, B2–4F, plus the
    // restaurants at 45–47F), so the podium mass below is its
    // representation (the Breeze Nan Shan precedent above).
    // Position is issue #42's re-pin to the OSM outline (way
    // 378443967 國泰置地廣場, 122.3 × 78.8 m → tile (186.2,
    // −829.5)); the podium takes the outline's own ellipse — the
    // curved south front — pulled in slightly at the SW corner,
    // clear of the service drive that notches that corner (the
    // issue #42/#43 audits: min clearance 3.0 m, overlap 0).
    id: 'cathay-landmark', name: 'Cathay Landmark', nameZh: '國泰置地廣場',
    lat: 25.040488, lon: 121.566845, realHeight: 212, color: 0x51606e,
    site: { w: 126, d: 82, dx: 0, dz: 0 },
    // Issue #57: deep blue-grey curtain wall with pale fin frames on
    // the two slabs; the mall podium takes a wider-bayed retail
    // variant and the Breeze Xinyi wordmark its south front carries.
    facade: { kind: 'curtain', glassTint: 0x20384e, frameTint: 0xa8b2ba, windowWidth: 2.4, floorHeight: 4.2, litProbability: 0.33, warmth: 0.55, reflectivity: 0.93, seed: 57.15 },
    sign: { text: 'Breeze', w: 44, h: 6, y: 14, dx: 4, dz: 39.9, bg: '#22262c', fg: '#ece5d3', accent: '#c8372d' },
    parts: [
      { type: 'cylinder', r: 58.5, rz: 38.5, h: 26, dx: 4, dz: 1, facade: { kind: 'curtain', glassTint: 0x2c3e50, frameTint: 0x7e8894, windowWidth: 4.6, floorHeight: 3.6, litProbability: 0.45, warmth: 0.6, reflectivity: 0.9, seed: 57.16 } },
      { type: 'box', w: 32, d: 34, h: 186, y0: 26, dx: -11, dz: 6 },
      { type: 'box', w: 22, d: 34, h: 168, y0: 26, dx: 16, dz: 6 },
    ],
  },
  {
    // 154 m, 30F, completed 2004 (Wikipedia / CTBUH). Stone-clad
    // slab over the Eslite Xinyi podium, signed by its open pergola
    // crown: two side fins and the beams spanning between them —
    // the "grille" silhouette over the roof.
    // Footprint corrected in issue #42 to the OSM outline (way
    // 228938184 統一國際大樓, 108.8 × 59.1 m): the batch-1 podium
    // (128 × 82) overshot the real outline on every side.
    id: 'uni-president-international-tower', name: 'Uni-President International Tower', nameZh: '統一國際大樓',
    lat: 25.039709, lon: 121.565405, realHeight: 154, color: 0x9a958c,
    site: { w: 112, d: 62, dx: 0, dz: 0 },
    // Issue #57: warm beige stone cladding; the pergola fins and
    // beams stay plain stone trim (flat), as built.
    facade: { kind: 'prewar', stoneColor: 0xb3a78d, trimColor: 0x8d8271, windowGlassColor: 0x2a3542, windowWidth: 2.8, floorHeight: 4.8, litProbability: 0.3, warmth: 0.62, seed: 57.17 },
    parts: [
      // Main slab + a mid-height east strip: the bus-station drives
      // east of the tower notch the outline's NE and SE corners
      // (issue #42 audit), so no single box fits the outline.
      { type: 'box', w: 92, d: 57, h: 30, dx: -7 },
      { type: 'box', w: 12, d: 30, h: 30, dx: 45, dz: -7 },
      { type: 'box', w: 60, d: 40, h: 114, y0: 30 },
      { type: 'box', w: 2.5, d: 40, h: 10, y0: 144, dx: -28.75, flat: 0x9a8f7a },
      { type: 'box', w: 2.5, d: 40, h: 10, y0: 144, dx: 28.75, flat: 0x9a8f7a },
      { type: 'box', w: 60, d: 3, h: 2, y0: 152, dz: -14, flat: 0x9a8f7a },
      { type: 'box', w: 60, d: 3, h: 2, y0: 152, dz: 0, flat: 0x9a8f7a },
      { type: 'box', w: 60, d: 3, h: 2, y0: 152, dz: 14, flat: 0x9a8f7a },
    ],
  },
  {
    // 93.2 m, 21F, completed 2018 (Wikipedia). Vincent Callebaut's
    // DNA tower: every floor rotates 4.5°, 90° in total (see
    // taoZhuParts). The greenery that wraps the real balconies is
    // facade/surface work (issue #17), not massing.
    id: 'tao-zhu-yin-yuan', name: 'Tao Zhu Yin Yuan', nameZh: '陶朱隱園',
    lat: 25.0386, lon: 121.5704, realHeight: 93.2, color: 0x8b978c,
    site: { w: 72, d: 56, dx: 0, dz: 0 },
    // Issue #57: light warm residential stone; the floor height is
    // the slab pitch itself (segH ≈ 4.17 m), so every twisted slab
    // reads as one planted floor with its own window row.
    facade: { kind: 'prewar', stoneColor: 0xa9b3a4, trimColor: 0x87917f, windowGlassColor: 0x223140, windowWidth: 3.0, floorHeight: 4.17, litProbability: 0.38, warmth: 0.75, seed: 57.18 },
    parts: taoZhuParts(),
  },
  {
    // 142.92 m, 34F, completed 1988 (Wikipedia / CTBUH) — Taiwan's
    // tallest building 1988–90. A sheer brown-stone slab along
    // Keelung Road with no setbacks at all; the signature is the
    // unbroken slab itself, closed by a slightly inset top band.
    // Position corrected in issue #42: the batch-1 axis put the
    // slab's east edge on the 莊敬路 ribbon and its west edge into
    // the complex's forecourt drives; the slab now stands inside
    // the OSM outline (way 137077756 國貿大樓, 65.2 × 67 m) at the
    // placement the overlap audit verifies clear of the forecourt
    // drive loop and the 莊敬路 diagonal ribbon — 36 × 60 m, the
    // depth trimmed from 64 because no full-depth placement inside
    // the parcel clears both.
    id: 'twtc-international-trade-building', name: 'TWTC International Trade Building', nameZh: '台北世界貿易中心國際貿易大樓',
    lat: 25.034444, lon: 121.561334, realHeight: 142.92, color: 0x7a5c50,
    site: { w: 68, d: 70, dx: -12.5, dz: 2.4 },
    // Issue #57: the brown-stone grid the real slab is wrapped in.
    facade: { kind: 'prewar', stoneColor: 0x8a6a58, trimColor: 0x6e5546, windowGlassColor: 0x1f2c3c, windowWidth: 2.6, floorHeight: 4.1, litProbability: 0.3, warmth: 0.6, seed: 57.19 },
    parts: [
      { type: 'box', w: 36, d: 60, h: 137.92 },
      { type: 'box', w: 33, d: 60, h: 5, y0: 137.92 },
    ],
  },
  {
    // 54.42 m, 12F, completed 1994 (Wikipedia), 市府路1號. The seat
    // of the city government is not a tower but a long municipal
    // slab whose PLAN is the famous 雙十 (double-ten): two
    // cross-shaped wings sharing a spine — massed as that spine
    // plus its two crossbars, so the 十十 reads from the air (the
    // satellite view confirms the envelope, ~140 × 216 m).
    // 市民廣場 Civic Plaza, the open ceremonial ground in front of
    // its west facade across 市府路, is registered as open ground:
    // exclusion with no mass. (It is also a geodata park polygon;
    // the explicit rect keeps the intent testable.)
    id: 'taipei-city-hall', name: 'Taipei City Hall', nameZh: '臺北市市政大樓',
    lat: 25.0375, lon: 121.56444, realHeight: 54.42, color: 0x8a7f72,
    site: { w: 152, d: 228, dx: 0, dz: 0 },
    // Issue #57: formal municipal rhythm — grey stone, tall floors,
    // wide bays, few lit windows.
    facade: { kind: 'prewar', stoneColor: 0x9d968a, trimColor: 0x7d766b, windowGlassColor: 0x24303e, windowWidth: 3.0, floorHeight: 4.5, litProbability: 0.26, warmth: 0.6, seed: 57.20 },
    plaza: { w: 96, d: 34, dx: -193.5, dz: -22.5 },
    parts: [
      { type: 'box', w: 36, d: 216, h: 54.42 },
      { type: 'box', w: 140, d: 36, h: 54.42, dz: -52 },
      { type: 'box', w: 140, d: 36, h: 54.42, dz: 52 },
    ],
  },
  {
    // 64 m above ground, built 2023 (Wikipedia / Farglory). The
    // great shallow dome over an elliptical drum — the signature is
    // the dome itself. The published structural height, 74.5 m,
    // measures from the sunken field 10.5 m below grade; the massing
    // height is the 64 m that stands above the street. Interior
    // span 230 × 170 m (zh-Wikipedia); the drum takes that span as
    // its exterior ellipse, which also keeps its south rim clear of
    // Zhongxiao Road's roadbed (~99 m from the centre to its edge).
    id: 'taipei-dome', name: 'Taipei Dome', nameZh: '臺北大巨蛋',
    lat: 25.042306, lon: 121.560083, realHeight: 64, color: 0xcfc9bb,
    site: { w: 270, d: 200, dx: 0, dz: 0 },
    // Issue #57: the drum is panelled metal, not glass — the
    // curtain factory tuned to near-zero lit windows, wide panels
    // and matched glass/frame tones reads as panel bands; the cap
    // is a flat silvery shell (see the part note). The entrance
    // gets an abstract glyph band (project stylization) — on the
    // NORTH rim since issue #98: Gate 1, the main entrance,
    // fronts Zhongxiao East Road (zh-Wikipedia captions its
    // Gate 1 photo 台北大巨蛋正門， the dome's main gate); the
    // band previously sat on the south rim, facing the park.
    facade: { kind: 'curtain', glassTint: 0xb7b1a1, frameTint: 0xa39c8c, windowWidth: 7.6, floorHeight: 5.5, litProbability: 0.05, warmth: 0.5, reflectivity: 0.5, seed: 57.21 },
    sign: { glyphs: 7, w: 40, h: 4.5, y: 11, dx: 0, dz: -95.4, rotY: Math.PI, bg: '#3a3f45', fg: '#ddd6c2' },
    parts: [
      { type: 'cylinder', r: 125, rz: 95, h: 22 },
      // The cap is a smooth titanium shell: the curtain factory's
      // hardcoded dark gravel-roof branch would take over its
      // up-facing normals, so the cap wears a flat silvery metal
      // tone instead (the drum keeps the panel grid).
      { type: 'dome', rx: 125, rz: 95, h: 42, y0: 22, flat: { color: 0xcac5b6, roughness: 0.42, metalness: 0.35 } },
    ],
  },
  {
    // 30.4 m, completed 1972 — the official building data carried in
    // the zh-Wikipedia article body (the infobox's 29.6 m is the
    // rounded figure); a 100 m-square hall on a raised terrace in
    // Zhongshan Park, kept as hall mass only — the park around it
    // stays open ground. The upswept palace roof is STYLIZED at
    // massing level (the simplicity-over-fidelity rule): two stepped
    // frustum tiers read as the rising eaves, a ridge closes the
    // peak, and four corner pylon blocks mark the upturned corners;
    // the roof's true curvature is not modelled. The published
    // coordinate (25.0400, 121.5600) is rounded to the arc second and
    // lands ~30 m west of the building; lat/lon below is refined so
    // the mass stands on the OSM footprint the geodata itself
    // carries (−475.1, −776.5; 112.1 × 114.6 m).
    id: 'sun-yat-sen-memorial-hall', name: 'Sun Yat-sen Memorial Hall', nameZh: '國父紀念館',
    lat: 25.04001, lon: 121.5603, realHeight: 30.4, color: 0x9c8a66,
    site: { w: 124, d: 124, dx: 0, dz: 0 },
    // Issue #57: warm sandstone walls; the palace roof tiers, ridge
    // and corner pylons stay flat ochre (glazed-tile tone), the
    // terrace flat stone. A gold glyph band marks the entrance.
    facade: { kind: 'prewar', stoneColor: 0xbfae8e, trimColor: 0x9a8a68, windowGlassColor: 0x2c3844, windowWidth: 3.2, floorHeight: 5.2, litProbability: 0.22, warmth: 0.7, seed: 57.22 },
    sign: { glyphs: 6, w: 30, h: 3, y: 11.5, dx: 0, dz: 48.4, bg: '#4a3826', fg: '#e8cf9a' },
    parts: [
      { type: 'box', w: 108, d: 108, h: 1.5, flat: 0xa89a80 },
      { type: 'box', w: 96, d: 96, h: 15.5, y0: 1.5 },
      { type: 'frustum', wB: 104, dB: 104, wT: 90, dT: 90, h: 4, y0: 17, flat: 0xa06a42 },
      { type: 'frustum', wB: 90, dB: 90, wT: 74, dT: 74, h: 3.5, y0: 21, flat: 0xa06a42 },
      { type: 'ridge', w: 74, d: 74, h: 0, ridgeH: 5.9, y0: 24.5, flat: 0xa06a42 },
      { type: 'box', w: 5, d: 5, h: 3.5, y0: 21, dx: -42, dz: -42, flat: 0xa06a42 },
      { type: 'box', w: 5, d: 5, h: 3.5, y0: 21, dx: 42, dz: -42, flat: 0xa06a42 },
      { type: 'box', w: 5, d: 5, h: 3.5, y0: 21, dx: -42, dz: 42, flat: 0xa06a42 },
      { type: 'box', w: 5, d: 5, h: 3.5, y0: 21, dx: 42, dz: 42, flat: 0xa06a42 },
    ],
  },
  {
    // Batch 3 (issue #43). 151 m: this is the Taipei City Hall Bus
    // Station complex (市府轉運站, 忠孝東路五段10號) — W Taipei
    // occupies floors 8–31 of the tower. Height 151 m per
    // Wikipedia's tallest-buildings list and its Xinyi Planning
    // District table (the complex's own article says 150 m; the
    // OSM outline, way 312729918 at 160.3 × 85.6 m, is tagged
    // 145.4 m — the published 151 m is used). The complex is
    // built AROUND its bus loop: a service roadbed in the geodata
    // rings the station court through the middle of the outline,
    // and the merged Keelung Road roadbed swath clips the
    // outline's west strip, so the podium is massed as the three
    // blocks that stand clear of every roadbed — the south
    // (Uni-Hankyu) block, the north strip and the east block —
    // with the tower on the east block, where the hotel slab
    // actually rises. Issue #43 audit: min clearance 1.4 m,
    // overlap 0.
    id: 'w-taipei', name: 'W Taipei', nameZh: '台北W飯店',
    lat: 25.0405433, lon: 121.5647998, realHeight: 151, color: 0x8fa8b8,
    site: { w: 168, d: 104, dx: 26, dz: -4 },
    // Issue #57: dark hotel grid glass, and the white W mark the
    // real tower carries on its south face.
    facade: { kind: 'curtain', glassTint: 0x18222c, frameTint: 0x8b95a1, windowWidth: 2.8, floorHeight: 4.2, litProbability: 0.36, warmth: 0.6, reflectivity: 0.92, seed: 57.23 },
    sign: { text: 'W', w: 12, h: 12, y: 130, dx: 73, dz: 14.4, bg: '#10151b', fg: '#f2f2f2' },
    parts: [
      { type: 'box', w: 128, d: 14, h: 17, dx: 14, dz: 36.2 },
      { type: 'box', w: 96, d: 13, h: 17, dx: 34, dz: -34.3 },
      { type: 'box', w: 58, d: 58, h: 17, dx: 73, dz: -8 },
      { type: 'box', w: 52, d: 40, h: 134, y0: 17, dx: 73, dz: -6 },
    ],
  },
  {
    // Batch 3 (issue #43). The 1937 tobacco factory (製菸工廠):
    // a 165 × 93 m two-storey Baroque-revival hall around a
    // central courtyard (zh-Wikipedia; OSM relation 3067837
    // measures 167.1 × 95.7 m), massed as one hall block under a
    // ridge roof — the courtyard is not cut out (hall mass only,
    // the park around it stays open; the SYS Hall precedent) —
    // plus the boiler room (鍋爐房, OSM way 228920411) and its
    // chimney SE of the hall, the park's two recognisable parts.
    // No published chimney height exists and no height tag was
    // found for it in OSM: the chimney's 30 m is an ESTIMATE, from
    // the stack's proportion against the two-storey hall in
    // photographs of the park, and it is the entry's tallest
    // part, so realHeight follows it. Issue #43 audit: min
    // clearance 7.9 m, overlap 0.
    id: 'songshan-cultural-park', name: 'Songshan Cultural and Creative Park', nameZh: '松山文創園區',
    lat: 25.0436127, lon: 121.5602251, realHeight: 30, color: 0x8a6a54,
    site: { w: 244, d: 140, dx: 33, dz: 18 },
    // Issue #57: brick-red masonry for the factory hall and boiler
    // room; the roof ridge and chimney stay flat brick/tile tones.
    // An abstract glyph band marks the hall entrance — on the
    // WEST face since issue #98 (zh-Wikipedia's park article: the
    // factory's 入口在西側， its entrance is on the west side,
    // where the office wing stands); it previously sat south.
    facade: { kind: 'prewar', stoneColor: 0x9a6a52, trimColor: 0x7c5540, windowGlassColor: 0x232f3a, windowWidth: 3.2, floorHeight: 5.0, litProbability: 0.28, warmth: 0.72, seed: 57.24 },
    sign: { glyphs: 6, w: 38, h: 3.4, y: 7.2, dx: -82.9, dz: 0, rotY: -Math.PI / 2, bg: '#4a3226', fg: '#e6d9c3' },
    parts: [
      { type: 'box', w: 165, d: 93, h: 10 },
      { type: 'ridge', w: 165, d: 93, h: 0, ridgeH: 4, y0: 10, flat: 0x6e4a38 },
      { type: 'box', w: 17, d: 25, h: 8, dx: 140.4, dz: 69.3 },
      { type: 'cylinder', r: 3.2, h: 30, dx: 140.4, dz: 61.6, flat: 0x8a5a44 },
    ],
  },
  {
    // Batch 3 (issue #43). 誠品生活松菸 is the retail inside the
    // Taipei New Horizon Building (臺北文創大樓, Toyo Ito) — the
    // terraced crescent at the park's NE corner (OSM way
    // 229059792, 164.7 × 68.4 m): the mall at B1–3F, eslite
    // hotel and offices above, 14 storeys. NO height in metres
    // is published anywhere (only floor counts), so 63 m is an
    // ESTIMATE — 14 levels at a 4.5 m mixed mall/office/hotel
    // floor-to-floor average — and the entry is flagged
    // estimated. The OSM building parts step down across the
    // west half (the terraces); the slab sits on the outline's
    // southern two-thirds, clear of the park service roadbed
    // that dips across the outline's north edge. Issue #43
    // audit: min clearance 2.3 m, overlap 0.
    id: 'eslite-spectrum-songyan', name: 'Eslite Spectrum Songyan', nameZh: '誠品生活松菸',
    lat: 25.0445705, lon: 121.5613061, realHeight: 63, estimated: true, color: 0xb0aca2,
    site: { w: 156, d: 68, dx: -8, dz: 4 },
    // Issue #57: pale stone with wide ribbon windows (windowRatioX
    // 0.78), and the eslite wordmark band over the mall entrance —
    // the real building carries the lowercase Latin mark on deep
    // green.
    facade: { kind: 'prewar', stoneColor: 0xcac2b2, trimColor: 0xa39a88, windowGlassColor: 0x26313e, windowWidth: 2.6, floorHeight: 4.5, windowRatioX: 0.78, windowRatioY: 0.62, litProbability: 0.34, warmth: 0.62, seed: 57.25 },
    sign: { text: 'eslite', w: 40, h: 4.6, y: 10, dx: 2, dz: 30.4, bg: '#173f35', fg: '#f0ead8' },
    parts: [
      { type: 'box', w: 120, d: 46, h: 63, dx: 2, dz: 7 },
      { type: 'box', w: 52, d: 40, h: 34, dx: -52, dz: -2 },
    ],
  },
  {
    // Batch 3 (issue #43). ESTIMATED HEIGHT — no published
    // overall height exists for Taipei Arena (its zh-Wikipedia
    // article carries no height field at all; the often-quoted
    // 42.3 m is KAOHSIUNG Arena — never use it). Estimate
    // method: brightness transects across the Esri z18 satellite
    // frame put the sunlit dome plateau's rim at ≈ 22 m,
    // cross-checked against the published programme (5 storeys
    // above ground, 2 basement); the shallow cap adds ≈ 9 m
    // from the roof profile in photographs → 31 m (bracket
    // 27–35 m), flagged estimated. The footprint is the OSM
    // outline (way 244001544, 158.8 × 160.7 m, 19,498 m²; the
    // published site area is 5,986 坪 ≈ 19,788 m²): the silver
    // egg — an elliptical drum under a shallow dome cap — with
    // the ice-rink annex (冰上樂園, its 61 × 30 m rink) attached
    // east. Issue #43 audit: min clearance 1.0 m, overlap 0.
    id: 'taipei-arena', name: 'Taipei Arena', nameZh: '臺北小巨蛋',
    lat: 25.0507173, lon: 121.5501273, realHeight: 31, estimated: true, color: 0xcac5b8,
    site: { w: 172, d: 174, dx: 0, dz: 0 },
    // Issue #57: silvery shell panels (the curtain factory at
    // near-zero lit windows and wide panels, as on the Dome).
    facade: { kind: 'curtain', glassTint: 0xb2b6b8, frameTint: 0x969ca0, windowWidth: 6.8, floorHeight: 5.5, litProbability: 0.04, warmth: 0.5, reflectivity: 0.6, seed: 57.26 },
    parts: [
      { type: 'cylinder', r: 74, rz: 80, h: 22, dx: -5 },
      { type: 'dome', rx: 74, rz: 80, h: 9, y0: 22, dx: -5, flat: { color: 0xc4c8ca, roughness: 0.42, metalness: 0.35 } },
      { type: 'box', w: 50, d: 82, h: 13, dx: 46, dz: -4 },
    ],
  },
  {
    // Station district batch (issue #74, expansion phase 2).
    // 244.15 m, 51F, completed 1993 (Wikipedia / CTBUH; the OSM
    // outline way 204711206 carries the same tagged height). For
    // a decade Taiwan's tallest building: a beige stone-clad slab
    // over its department-store podium, closed by the stepped
    // pyramid crown that still anchors the station skyline. The
    // OSM outline (40.9 × 85.1 m) is the tower way itself; the
    // podium stays inside it (its NW corner is trimmed — the
    // outline's north-west taper is left unbuilt), the shaft
    // stands on the podium's north half, and the crown is one
    // frustum taper to a small cap: 22 + 194 + 24 + 4.15 = 244.15.
    //
    // Issues #98/#99 (facing audit; evidence in the PR): the
    // front is NORTH. The office portal — the gold 新光人壽保險
    // 摩天大樓 band zh-Wikipedia captions 正面外牆題字, the
    // inscription on the FRONT exterior wall — flanked by the
    // Mitsukoshi entrances, opens on the forecourt on Zhongxiao
    // West Road, and the store fills the tower's own B2–13F
    // (zh floor table): there is no separate low podium. The
    // #74 massing got both wrong — the glyph band sat on the
    // shaft's SOUTH face, and the podium was a 22 m annexe
    // offset south with the shaft protruding past its north
    // edge. The base is now the full 13-storey store (52 m)
    // inside the outline, a 6 m mechanical band stepping back
    // on E/W/S (the terraces the east elevation shows), and
    // the shaft rising from it with its north face flush with
    // the base's: 52 + 6 + 158 + 24 + 4.15 = 244.15. The glyph
    // band moves to the shaft's north face.
    id: 'shin-kong-life-tower', name: 'Shin Kong Life Tower', nameZh: '新光人壽保險大樓',
    lat: 25.046166, lon: 121.515295, realHeight: 244.15, color: 0xbfb198,
    site: { w: 52, d: 96, dx: 1, dz: 10 },
    // Issue #57 machinery: beige stone grid on shaft and base
    // (the base a wider-bayed retail variant); the crown stays
    // flat stone, and the Chinese name the real building carries
    // is an abstract glyph band on the shaft's north face (the
    // front — issue #98; before the audit it sat on the south).
    facade: { kind: 'prewar', stoneColor: 0xcabfa5, trimColor: 0xa2937a, windowGlassColor: 0x2c3844, windowWidth: 2.8, floorHeight: 4.4, litProbability: 0.32, warmth: 0.6, seed: 57.27 },
    sign: { glyphs: 4, w: 20, h: 3.6, y: 205, dx: 0, dz: -21.4, rotY: Math.PI, bg: '#33302a', fg: '#e8dfc8' },
    parts: [
      { type: 'box', w: 38, d: 80, h: 52, dx: 1.7, dz: 19, facade: { kind: 'prewar', stoneColor: 0xbfb198, trimColor: 0x9c8f76, windowGlassColor: 0x2c3844, windowWidth: 4.6, floorHeight: 4.0, litProbability: 0.4, warmth: 0.62, seed: 57.33 } },
      { type: 'box', w: 36, d: 76, h: 6, y0: 52, dx: 0.8, dz: 17, flat: 0xbfb198 },
      { type: 'box', w: 34, d: 42, h: 158, y0: 58 },
      { type: 'frustum', wB: 34, dB: 42, wT: 9, dT: 14, h: 24, y0: 216, flat: 0xc0b090 },
      { type: 'box', w: 9, d: 14, h: 4.15, y0: 240, flat: 0xa89878 },
    ],
  },
  {
    // Station district batch (issue #74). 48 m published (the
    // OSM height tag on way 23641610 says 30 m — wrong; the
    // station house is six floors under a tall red hip roof).
    // The OSM outline (178.5 × 153.7 m) is the whole station
    // block, and like the district grid it slants ~10° against
    // the tile frame; the massing is a house (150 × 96 m)
    // placed inside the outline with margin on every side.
    // Issue #116: the house now carries the outline's measured
    // slant — min-rect long-axis azimuth 100.65° on way
    // 23641610 (edge family 100.6/10.6) — so every part is
    // rotated by rotY 0.1859 rad (10.65°) about the pin, offsets
    // rotated with it; the front (south face, sign, porticos)
    // now faces azimuth 190.65°, as built. The 臺北車站 characters over the south
    // entrance are an abstract glyph band, and two red-capped
    // entrance porticos stand on the south face (issue #98,
    // from the south-facade reference photo). Placement
    // disclosure (issue #74): the house sits +11 m east of the
    // outline centre — at centre, its NW corner clipped the
    // diagonal 承德路一段 roadbed ribbon west of the block
    // (0.52 m² on the house, 38.8 m² on the eaves); shifted
    // east and with the eaves trimmed to 154 × 100 it clears
    // the ribbon and stays inside the outline on every side.
    //
    // Issue #98 (facing audit; evidence in the PR): the front
    // was already south — the glyph band's side was right —
    // but the roof was wrong twice over. The #74 "clock tower"
    // box does not exist: the south-facade photo and the
    // satellite both show ONE red hip roof with a central flat
    // skylight deck and no tower of any kind (the only clock
    // is a small LED panel on the facade). The tower box is
    // deleted, and the roof is re-profiled from three chunky
    // slabs (a ziggurat read) to six fine steps inside the
    // audited 154 × 100 eaves footprint, rising to the same
    // skylight deck: 27 + 6 × 3.25 + 1.5 = 48. A true frustum
    // hip was measured and rejected: the frustum/ridge
    // primitives are centre-locked, and a centred 148 m roof
    // clipped the 承德路 ribbon by 19.48 m² (the audit's own
    // number), so the stepped boxes stay — every step inside
    // the footprint the audit already clears.
    id: 'taipei-main-station', name: 'Taipei Main Station', nameZh: '臺北車站',
    lat: 25.047652, lon: 121.517046, realHeight: 48, color: 0xcbb694,
    site: { w: 186, d: 162, dx: 0, dz: 0 },
    facade: { kind: 'prewar', stoneColor: 0xd6c8ac, trimColor: 0xa08b6a, windowGlassColor: 0x2a3540, windowWidth: 3.2, floorHeight: 4.2, litProbability: 0.34, warmth: 0.62, seed: 57.28 },
    sign: { glyphs: 4, w: 30, h: 4, y: 20, dx: 3.0, dz: 43.7, rotY: -0.1859, bg: '#7c3a2c', fg: '#efe6d0' },
    parts: [
      { type: 'box', w: 150, d: 96, h: 27, dx: 11.9, dz: -3.9, rotY: 0.1859 },
      { type: 'box', w: 154, d: 100, h: 3.25, y0: 27, dx: 11.9, dz: -3.9, rotY: 0.1859, flat: 0x9c4a38 },
      { type: 'box', w: 139, d: 86, h: 3.25, y0: 30.25, dx: 11.9, dz: -3.9, rotY: 0.1859, flat: 0x9c4a38 },
      { type: 'box', w: 125, d: 72, h: 3.25, y0: 33.5, dx: 11.9, dz: -3.9, rotY: 0.1859, flat: 0x9c4a38 },
      { type: 'box', w: 110, d: 58, h: 3.25, y0: 36.75, dx: 11.9, dz: -3.9, rotY: 0.1859, flat: 0x9c4a38 },
      { type: 'box', w: 95, d: 44, h: 3.25, y0: 40, dx: 11.9, dz: -3.9, rotY: 0.1859, flat: 0x9c4a38 },
      { type: 'box', w: 80, d: 30, h: 3.25, y0: 43.25, dx: 11.9, dz: -3.9, rotY: 0.1859, flat: 0x9c4a38 },
      { type: 'box', w: 62, d: 12, h: 1.5, y0: 46.5, dx: 11.9, dz: -3.9, rotY: 0.1859, flat: 0x39434e },
      { type: 'box', w: 16, d: 5, h: 6, dx: -34.7, dz: 38.7, rotY: 0.1859 },
      { type: 'box', w: 18, d: 7, h: 1.2, y0: 6, dx: -34.7, dz: 38.7, rotY: 0.1859, flat: 0x9c4a38 },
      { type: 'box', w: 16, d: 5, h: 6, dx: 39.9, dz: 52.8, rotY: 0.1859 },
      { type: 'box', w: 18, d: 7, h: 1.2, y0: 6, dx: 39.9, dz: 52.8, rotY: 0.1859, flat: 0x9c4a38 },
    ],
  },
  {
    // Station district batch (issue #74). 70 m published: the
    // white hall on its three-level stepped terrace in the
    // memorial park, under the blue double-eaved roof. The OSM
    // terrace way (1052759757, tagged 14.5 m — the terrace top)
    // is a loose trace of the ~120 m-square platform, rotated
    // against the frame with the park's own diagonal paths; the
    // massing keeps the platform's true scale as three clean
    // steps (the SYS Hall stylization precedent), the hall's
    // walls in white stone, and the octagonal roof read as two
    // stepped square eave tiers under a gold finial: 14.5
    // (terrace) + 26 (hall) + 12 + 10 (eaves) + 7.5 (finial)
    // = 70.
    // Issue #116: the whole hall group now sits on the park's
    // measured axis — min-rect on the terrace way gives axis
    // azimuths 118.21/28.21°, so every centre part carries
    // rotY 0.4924 rad (28.21°) with its offset rotated about
    // the pin, and the authored WEST front (issue #98) now
    // faces azimuth 298.21°, toward Liberty Square as built.
    // The two roof frustums become stepped box tiers (the
    // Main Station / Beimen precedent: frustum parts cannot
    // rotate in the renderer or the issue-#42 audit, boxes
    // can), each step's footprint taken from the frustum
    // profile at the step's base. The perimeter wall runs
    // further down are NOT rotated with the group: they were
    // fitted to the park polygon's own edges (verified in
    // #116: run families 117.9/28.7/117.5° track the polygon
    // edges 117.9/28.7/117.3°, and the west chord runs 16.5°
    // because the 中山南路 boundary itself is not parallel
    // to the park axis — the park is not a parallelogram).
    id: 'chiang-kai-shek-memorial-hall', name: 'Chiang Kai-shek Memorial Hall', nameZh: '中正紀念堂',
    lat: 25.034811, lon: 121.521519, realHeight: 70, color: 0xdfd9cc,
    site: { w: 150, d: 150, dx: 0, dz: 0 },
    facade: { kind: 'prewar', stoneColor: 0xe9e5db, trimColor: 0xcac4b4, windowGlassColor: 0x2e3a46, windowWidth: 3.4, floorHeight: 5.2, litProbability: 0.22, warmth: 0.6, seed: 57.29 },
    parts: [
      { type: 'box', w: 118, d: 118, h: 4.8, rotY: 0.4924, flat: 0xa39a8b },
      { type: 'box', w: 104, d: 104, h: 4.8, y0: 4.8, rotY: 0.4924, flat: 0xa39a8b },
      { type: 'box', w: 90, d: 90, h: 4.9, y0: 9.6, rotY: 0.4924, flat: 0xaca294 },
      { type: 'box', w: 62, d: 62, h: 26, y0: 14.5, rotY: 0.4924 },
      // Issue #116: the two blue eave frustums as stepped box
      // tiers (see the entry note) — same profile, same total
      // heights (12 + 10), footprints from each frustum's
      // profile at the step base.
      { type: 'box', w: 70, d: 70, h: 4, y0: 40.5, rotY: 0.4924, flat: 0x1e4d8c },
      { type: 'box', w: 64, d: 64, h: 4, y0: 44.5, rotY: 0.4924, flat: 0x1e4d8c },
      { type: 'box', w: 58, d: 58, h: 4, y0: 48.5, rotY: 0.4924, flat: 0x1e4d8c },
      { type: 'box', w: 52, d: 52, h: 3.33, y0: 52.5, rotY: 0.4924, flat: 0x1e4d8c },
      { type: 'box', w: 45, d: 45, h: 3.33, y0: 55.83, rotY: 0.4924, flat: 0x1e4d8c },
      { type: 'box', w: 38, d: 38, h: 3.34, y0: 59.17, rotY: 0.4924, flat: 0x1e4d8c },
      { type: 'cylinder', r: 3.2, h: 7.5, y0: 62.5, flat: 0xcfa14e },
      // Issue #98: the front the references show, authored on the
      // WEST face (the Liberty Square side): a stair climbing the
      // terrace's west face in three giant treads, then the great
      // staircase up the hall's west face — five marble steps with
      // the pale central ramp strips (the carved 御路） — to the
      // dark arched entrance recess and its red plaque. Before
      // this fix the structure was perfectly symmetric, with no
      // front feature on any side.
      { type: 'box', w: 26, d: 5, h: 4.8, dx: -54.3, dz: -28.9, rotY: 0.4924, flat: 0xb3aa99 },
      { type: 'box', w: 26, d: 7, h: 9.6, dx: -49.0, dz: -26.1, rotY: 0.4924, flat: 0xb3aa99 },
      { type: 'box', w: 26, d: 9, h: 14.5, dx: -43.7, dz: -23.3, rotY: 0.4924, flat: 0xb3aa99 },
      { type: 'box', w: 44, d: 13, h: 1.9, y0: 14.5, dx: -33.1, dz: -17.6, rotY: 0.4924, flat: 0xe3ddd0 },
      { type: 'box', w: 44, d: 10.4, h: 1.9, y0: 16.4, dx: -31.9, dz: -17.0, rotY: 0.4924, flat: 0xe3ddd0 },
      { type: 'box', w: 44, d: 7.8, h: 1.9, y0: 18.3, dx: -30.8, dz: -16.4, rotY: 0.4924, flat: 0xe3ddd0 },
      { type: 'box', w: 44, d: 5.2, h: 1.9, y0: 20.2, dx: -29.7, dz: -15.8, rotY: 0.4924, flat: 0xe3ddd0 },
      { type: 'box', w: 44, d: 2.6, h: 1.9, y0: 22.1, dx: -28.5, dz: -15.2, rotY: 0.4924, flat: 0xe3ddd0 },
      { type: 'box', w: 10, d: 2.2, h: 0.32, y0: 16.4, dx: -37.8, dz: -20.1, rotY: 0.4924, flat: 0xefe9db },
      { type: 'box', w: 10, d: 2.2, h: 0.32, y0: 18.3, dx: -35.4, dz: -18.9, rotY: 0.4924, flat: 0xefe9db },
      { type: 'box', w: 10, d: 2.2, h: 0.32, y0: 20.2, dx: -33.1, dz: -17.6, rotY: 0.4924, flat: 0xefe9db },
      { type: 'box', w: 10, d: 2.2, h: 0.32, y0: 22.1, dx: -30.8, dz: -16.4, rotY: 0.4924, flat: 0xefe9db },
      { type: 'box', w: 10, d: 2.2, h: 0.32, y0: 24, dx: -28.5, dz: -15.2, rotY: 0.4924, flat: 0xefe9db },
      { type: 'box', w: 11, d: 0.6, h: 8.5, y0: 24, dx: -27.6, dz: -14.7, rotY: 0.4924, flat: 0x17120e },
      { type: 'box', w: 3.6, d: 0.7, h: 4.8, y0: 33.2, dx: -27.6, dz: -14.7, rotY: 0.4924, flat: 0x7a2e22 },
      // The perimeter wall (user request, 2026-10-24): the whole
      // memorial park is enclosed by a thin white ROOFED CORRIDOR
      // wall — white walls under a blue tile roof, ~1,200 m of it
      // (taiwanobsessed visitor guide; EN Wikipedia for the gates).
      // Modelled as white runs (h 3, 0.8 thick) with a blue roof
      // cap (h 0.55, 1.7 wide) following the 中正紀念公園 polygon's
      // four corner-to-corner edges, inset 2.5 m, ends pulled 6 m
      // off the corners (satellite: refs/sat-cks-park-z17-overlay
      // .jpg). Gate gaps where the real gates are (EN Wikipedia):
      // the main gate （大中至正 / Liberty Square Arch) WEST on
      // 中山南路 at the square axis (38 m), 大忠門 NORTH on 信義路
      // 一段 on the hall's cross-axis (16 m), 大孝門 SOUTH on
      // 愛國東路 on the cross-axis (16 m); the 杭州南路一段 east
      // edge runs continuous. Two further 16 m breaks (one each
      // on the north and south runs) are NOT gates: the
      // generation map carries a 6.4 m bed named 林森南路車行
      // 地下道 diagonally across the park (an underpass in the
      // data — never modelled, per the standing rule), and the
      // wall yields where that modelled bed crosses it. The
      // road-overlap audit covers these parts like any other —
      // they must stay at 0.000 m².
      { type: 'box', w: 142.9, d: 0.8, h: 3, dx: -385.1, dz: -305.1, rotY: 1.8592, flat: 0xe9e4d4 },
      { type: 'box', w: 142.9, d: 1.7, h: 0.55, y0: 3, dx: -385.1, dz: -305.1, rotY: 1.8592, flat: 0x2c4a7c },
      { type: 'box', w: 157.5, d: 0.8, h: 3, dx: -438.7, dz: -124.6, rotY: 1.8592, flat: 0xe9e4d4 },
      { type: 'box', w: 157.5, d: 1.7, h: 0.55, y0: 3, dx: -438.7, dz: -124.6, rotY: 1.8592, flat: 0x2c4a7c },
      { type: 'box', w: 260.5, d: 0.8, h: 3, dx: -342.4, dz: 20.4, rotY: 0.4872, flat: 0xe9e4d4 },
      { type: 'box', w: 260.5, d: 1.7, h: 0.55, y0: 3, dx: -342.4, dz: 20.4, rotY: 0.4872, flat: 0x2c4a7c },
      { type: 'box', w: 138.7, d: 0.8, h: 3, dx: -151.9, dz: 121.4, rotY: 0.4872, flat: 0xe9e4d4 },
      { type: 'box', w: 138.7, d: 1.7, h: 0.55, y0: 3, dx: -151.9, dz: 121.4, rotY: 0.4872, flat: 0x2c4a7c },
      { type: 'box', w: 171.8, d: 0.8, h: 3, dx: -0.6, dz: 201.5, rotY: 0.4872, flat: 0xe9e4d4 },
      { type: 'box', w: 171.8, d: 1.7, h: 0.55, y0: 3, dx: -0.6, dz: 201.5, rotY: 0.4872, flat: 0x2c4a7c },
      { type: 'box', w: 336.7, d: 0.8, h: 3, dx: 164.3, dz: 91.6, rotY: -1.0704, flat: 0xe9e4d4 },
      { type: 'box', w: 336.7, d: 1.7, h: 0.55, y0: 3, dx: 164.3, dz: 91.6, rotY: -1.0704, flat: 0x2c4a7c },
      { type: 'box', w: 176.3, d: 0.8, h: 3, dx: 164.4, dz: -104.8, rotY: -2.6617, flat: 0xe9e4d4 },
      { type: 'box', w: 176.3, d: 1.7, h: 0.55, y0: 3, dx: 164.4, dz: -104.8, rotY: -2.6617, flat: 0x2c4a7c },
      { type: 'box', w: 138.2, d: 0.8, h: 3, dx: 10.7, dz: -184.8, rotY: -2.6617, flat: 0xe9e4d4 },
      { type: 'box', w: 138.2, d: 1.7, h: 0.55, y0: 3, dx: 10.7, dz: -184.8, rotY: -2.6617, flat: 0x2c4a7c },
      { type: 'box', w: 330.3, d: 0.8, h: 3, dx: -211.3, dz: -300.3, rotY: -2.6617, flat: 0xe9e4d4 },
      { type: 'box', w: 330.3, d: 1.7, h: 0.55, y0: 3, dx: -211.3, dz: -300.3, rotY: -2.6617, flat: 0x2c4a7c },
    ],
  },
  {
    // Station district batch (issue #74). One of the twin
    // palace halls flanking Liberty Square (the north hall):
    // cream walls under a golden Chinese hip roof, massed as a
    // plinth, a wall block, a frustum hip and a ridge crest.
    // Height 37 m is the OSM tag on way 1052759775 (118.5 ×
    // 113.7 m outline) — no figure is published anywhere, so
    // the entry is flagged estimated.
    // Issue #98 due diligence: the name was challenged during
    // the facing sweep and VERIFIED correct — way 1052759775's
    // own OSM tags (name 國家音樂廳, addr 中山南路) sit at this
    // entry's lat/lon (one-pass locations read of the PBF; the
    // south way 1052759776 is likewise the theatre by its tags).
    // A crossed two-pass probe + an unordered Wikipedia list
    // phrase briefly suggested a swap; the tags govern — do not
    // "fix" this again. See facing-evidence FACTS.md §6.
    // Issue #116: this hall's own way measures the park axis
    // family (longest edges at azimuth 118.2/28.5°), so the
    // hall carries rotY 0.4924 (28.21°, the ONE park axis from
    // the terrace way) like the memorial hall; the frustum +
    // ridge roof becomes stepped boxes (they cannot rotate —
    // see the memorial hall's note), profiles matched at each
    // step's base, ridge crest along the rotated local x.
    id: 'national-concert-hall', name: 'National Concert Hall', nameZh: '國家音樂廳',
    lat: 25.036985, lon: 121.519262, realHeight: 37, estimated: true, color: 0xdccfa9,
    site: { w: 126, d: 121, dx: 0, dz: 0 },
    facade: { kind: 'prewar', stoneColor: 0xe6d9bc, trimColor: 0xbfae87, windowGlassColor: 0x2a3644, windowWidth: 3.4, floorHeight: 5.0, litProbability: 0.26, warmth: 0.68, seed: 57.30 },
    parts: [
      { type: 'box', w: 110, d: 105, h: 5, rotY: 0.4924, flat: 0xa89c80 },
      { type: 'box', w: 94, d: 90, h: 15, y0: 5, rotY: 0.4924 },
      { type: 'box', w: 112, d: 108, h: 3, y0: 20, rotY: 0.4924, flat: 0xc79a3f },
      { type: 'box', w: 103, d: 99, h: 3, y0: 23, rotY: 0.4924, flat: 0xc79a3f },
      { type: 'box', w: 94, d: 90, h: 3, y0: 26, rotY: 0.4924, flat: 0xc79a3f },
      { type: 'box', w: 84, d: 80, h: 2.67, y0: 29, rotY: 0.4924, flat: 0xc79a3f },
      { type: 'box', w: 84, d: 53, h: 2.67, y0: 31.67, rotY: 0.4924, flat: 0xc79a3f },
      { type: 'box', w: 84, d: 27, h: 2.67, y0: 34.33, rotY: 0.4924, flat: 0xc79a3f },
    ],
  },
  {
    // Station district batch (issue #74). The south twin of the
    // concert hall across Liberty Square — the same palace
    // recipe at its own OSM outline (way 1052759776, 122.9 ×
    // 116.0 m), the mirror of the pair. Height 37 m is the OSM
    // tag (levels 7); unpublished, so flagged estimated.
    // Name verified at issue #98 (see the north entry's note).
    // Issue #116: rotated to the park axis with the north hall
    // (its own way 1052759776 measures the same 118.2/28.5°
    // edge family); roof as stepped boxes, profiles matched.
    id: 'national-theater', name: 'National Theater', nameZh: '國家戲劇院',
    lat: 25.035319, lon: 121.518245, realHeight: 37, estimated: true, color: 0xdccfa9,
    site: { w: 130, d: 123, dx: 0, dz: 0 },
    facade: { kind: 'prewar', stoneColor: 0xe6d9bc, trimColor: 0xbfae87, windowGlassColor: 0x2a3644, windowWidth: 3.4, floorHeight: 5.0, litProbability: 0.26, warmth: 0.68, seed: 57.31 },
    parts: [
      { type: 'box', w: 114, d: 107, h: 5, rotY: 0.4924, flat: 0xa89c80 },
      { type: 'box', w: 98, d: 92, h: 15, y0: 5, rotY: 0.4924 },
      { type: 'box', w: 116, d: 110, h: 3, y0: 20, rotY: 0.4924, flat: 0xc79a3f },
      { type: 'box', w: 107, d: 101, h: 3, y0: 23, rotY: 0.4924, flat: 0xc79a3f },
      { type: 'box', w: 97, d: 92, h: 3, y0: 26, rotY: 0.4924, flat: 0xc79a3f },
      { type: 'box', w: 88, d: 82, h: 2.67, y0: 29, rotY: 0.4924, flat: 0xc79a3f },
      { type: 'box', w: 88, d: 55, h: 2.67, y0: 31.67, rotY: 0.4924, flat: 0xc79a3f },
      { type: 'box', w: 88, d: 28, h: 2.67, y0: 34.33, rotY: 0.4924, flat: 0xc79a3f },
    ],
  },
  {
    // Station district batch (issue #74). 60 m published — the
    // central tower of the 1919 red-brick baroque block (the
    // wings are five floors). The OSM relation 206817 assembles
    // the perimeter block (102.0 × 137.7 m, long in z, facing
    // Ketagalan Boulevard east): massed as the long brick slab
    // with its two end pavilions, the tower at the centre and a
    // small frustum cap: 27 + 30 + 3 = 60. The prewar factory
    // in brick red with pale trim reads as the brick-and-band
    // facade.
    // Issue #116: the block is skewed ~5.6° off cardinal — the
    // relation's main way (39239021) measures min-rect long
    // axis azimuth 6.03° with its long edges at 95.1/96.2° and
    // 5.0–5.8° — so the slab, pavilions and tower carry rotY
    // 0.0977 (5.6°) with offsets rotated about the pin; the
    // square frustum cap becomes two stepped boxes so it can
    // rotate with them (frustum parts cannot rotate).
    id: 'presidential-office-building', name: 'Presidential Office Building', nameZh: '總統府',
    lat: 25.039994, lon: 121.511973, realHeight: 60, color: 0x9c5a41,
    site: { w: 110, d: 145, dx: 0, dz: 0 },
    facade: { kind: 'prewar', stoneColor: 0xa9603f, trimColor: 0xd9d0bd, windowGlassColor: 0x27313d, windowWidth: 2.6, floorHeight: 4.6, litProbability: 0.27, warmth: 0.58, seed: 57.32 },
    parts: [
      { type: 'box', w: 44, d: 130, h: 27, rotY: 0.0977 },
      { type: 'box', w: 54, d: 22, h: 27, dx: 5.3, dz: -53.7, rotY: 0.0977 },
      { type: 'box', w: 54, d: 22, h: 27, dx: -5.3, dz: 53.7, rotY: 0.0977 },
      { type: 'box', w: 26, d: 26, h: 30, y0: 27, rotY: 0.0977 },
      { type: 'box', w: 26, d: 26, h: 1.5, y0: 57, rotY: 0.0977, flat: 0x4a4440 },
      { type: 'box', w: 19, d: 19, h: 1.5, y0: 58.5, rotY: 0.0977, flat: 0x4a4440 },
    ],
  },
  {
    // Issue #86: 北門 (Cheng-en Gate, 1884) — the gate the #77
    // junction treatment built its island for. The only Taipei
    // city gate still in its Qing form: a closed Minnan
    // blockhouse — an andesite platform pierced by ONE arched
    // passage, red-brick gatehouse walls, and a single-eaved
    // hip-and-gable roof （單簷歇山）. The platform is massed as
    // two blocks flanking the 4.5 m passage gap; the roof is
    // stacked rotated boxes (an eave slab over two tile steps
    // under a heavy ridge cap — the Main Station stepped-flat
    // roof precedent, because ridge/frustum parts cannot
    // rotate and this structure must).
    // Orientation: the long axis follows the old north-wall
    // line, which is the #77 island capsule's axis (BEIMEN_SITE
    // axis (-0.848, -0.531) in js/taipei-junctions.js; every
    // part carries rotY = atan2(-0.531, -0.848) = -2.5821), so
    // the gatehouse facades face NNE/SSW and the passage cuts
    // across the axis — north toward 大稻埕， south into the
    // walled city along 博愛路.
    // Height: no published figure exists (Wikipedia and the
    // national-monument record describe the form, give no
    // metres), so the accepted ~19 m overall estimate is used
    // and flagged estimated, decomposed 5.2 (platform) + 8.3
    // (two-storey brick gatehouse) + 0.8 (eave) + 3.5 (roof
    // steps) + 1.2 (ridge) = 19.
    // Position: the published gate point (25.047717,
    // 121.511192) converts to (-5430.5, -1630.3) — about 19 m
    // WNW of the island the #77 treatment fitted between the
    // GENERATED carriageways, and a platform centred there
    // reaches past the island's west end toward the 中華路
    // curve. The structure is therefore centred on the island
    // (capsule centre (-5412, -1622), shifted 3.5 m across-axis
    // away from the south lane whose ribbon grazes the
    // island's south edge); this entry's lat/lon back-converts
    // to exactly that spot (-5410.1, -1625.0) — the Main
    // Station +11 m placement precedent, disclosed the same
    // way. Audited: every part at 0.000 m² against every
    // roadbed ribbon (nearest clearance 1.5 m — the platform's
    // SE corner to the south lane), and the whole footprint
    // inside the island capsule.
    id: 'beimen', name: 'Beimen (Cheng-en Gate)', nameZh: '北門',
    lat: 25.04767, lon: 121.511394, realHeight: 19, estimated: true, color: 0xa55f41,
    site: { w: 34, d: 30, dx: 0, dz: 0 },
    plaza: { w: 68, d: 56, dx: 0, dz: 0 },
    facade: { kind: 'prewar', stoneColor: 0xa55f41, trimColor: 0xd8cdb6, windowGlassColor: 0x27313d, windowWidth: 3.2, floorHeight: 4.15, litProbability: 0.18, warmth: 0.6, seed: 57.34 },
    parts: [
      { type: 'box', w: 12, d: 15.5, h: 5.2, dx: 7.0, dz: 4.38, rotY: -2.5821, flat: 0x7a7263 },
      { type: 'box', w: 12, d: 15.5, h: 5.2, dx: -7.0, dz: -4.38, rotY: -2.5821, flat: 0x7a7263 },
      // The passage as a near-black plug recessed in the slot:
      // an open slot reads as two detached slabs from street
      // level (you see the city through it); the plug reads as
      // the shadowed arch tunnel from every angle.
      { type: 'box', w: 4.5, d: 13.5, h: 4.6, rotY: -2.5821, flat: 0x35302b },
      { type: 'box', w: 28.5, d: 15.5, h: 0.35, y0: 4.85, rotY: -2.5821, flat: 0x8d8578 },
      { type: 'box', w: 19, d: 12.5, h: 8.3, y0: 5.2, rotY: -2.5821 },
      { type: 'box', w: 21.5, d: 15, h: 0.8, y0: 13.5, rotY: -2.5821, flat: 0x46484a },
      { type: 'box', w: 19.5, d: 13, h: 1.8, y0: 14.3, rotY: -2.5821, flat: 0x50544e },
      { type: 'box', w: 16.5, d: 10.5, h: 1.7, y0: 16.1, rotY: -2.5821, flat: 0x50544e },
      { type: 'box', w: 13, d: 3.2, h: 1.2, y0: 17.8, rotY: -2.5821, flat: 0x5d6058 },
    ],
  },
  {
    // Batch 6 (issue #103, northern phase 2): 圓山大飯店 — the
    // 1973 palace hotel on the Jiantan hill in the Red Line
    // corridor. 87 m PUBLISHED (EN/ZH Wikipedia: the main
    // building is 87 m, 14 storeys, Yang Cho-cheng; Taiwan's
    // tallest 1973-81). The front faces SOUTH over the basin
    // (the entrance porch, ceremonial steps and reflecting pond
    // are all on the south side). Form from the reference
    // photos: a tall slab in a full-height vermilion column /
    // balcony lattice, muted teal bracket bands between the
    // floors and under the eaves, and a double-eaved golden
    // glazed-tile hip roof (a wide lower eave wrapping the top
    // floor, the main roof above a pale railed gallery band).
    // Footprint from the Esri satellite stitch: the golden roof
    // plan measures ~125 x 66 m, its long axis rotated -12.4°
    // from east along the hill contour — so, like Beimen, the
    // massing is stacked rotated boxes (frustum/ridge parts
    // cannot rotate), every part at rotY = -0.216.
    // Position: the phase-1 terrain report's footprint point.
    // (The OSM POIs inside the main building — 大會廳/松鶴廳/
    // 圓苑餐廳/圓山牛排館 — cluster ~25 m NE of it, inside the
    // same footprint, and the satellite roof centroid reads SW
    // of both: an 87 m roof relief-displaced in off-nadir
    // imagery.)
    // PLAN TRIM (disclosed): the satellite roof plan measures
    // ~125 x 66 m, but the OSM drive ring as drawn hugs the
    // building — the rear service drive's ribbon runs within a
    // few metres of the north wall — so at the true plan the
    // rotated corners cross the ring's ribbons and the issue-#42
    // invariant cannot hold. The modelled plan is trimmed to a
    // 105 x 53 m lower eave over a 98 x 40 m shaft (the same
    // palace proportions, the same -12.4° axis), and the terrace
    // is shaped to the plateau inside the ring: two under-
    // building steps plus a shallow south forecourt apron.
    // Audited (issue #42): every part at 0.000 m² against every
    // roadbed ribbon; the tightest clearances are the lower
    // eave's north-east corner, 0.1 m from the rear drive's
    // ribbon, and the plinth's west corner at 0.3 m — the real
    // roof likewise overhangs close over the rear drive.
    // TERRAIN COMPROMISE (phase-1 report §6, option ii): the
    // hotel stands at SRTM ~39 m (crest ~48 m) over a basin
    // floor at ~11 m, and the world is flat — so the published
    // 87 m is spent as an 11 m two-step terrace plinth + 76 m
    // of building, keeping the total silhouette at the true
    // height with part of the hill's lift restored. The plinth
    // is modelled mass and is audited like every other part:
    // the hotel's own forecourt drives are roadbeds (nearest
    // centreline 46 m from the structure centre), and the
    // plinth steps are sized to the terrace inside that ring.
    // Decomposition: 11 (plinth) + 8 (podium) + 40 (shaft)
    // + 2.2 (teal band) + 3.4 (lower eave) + 4.6 (gallery)
    // + 2.0 (teal band) + 6.5 + 5.5 (roof steps) + 3.8
    // (ridge) = 87.
    id: 'grand-hotel', name: 'The Grand Hotel', nameZh: '圓山大飯店',
    lat: 25.0788, lon: 121.5263, realHeight: 87, color: 0xa83c26,
    site: { w: 190, d: 175, dx: 2, dz: 14 },
    facade: { kind: 'prewar', stoneColor: 0xa63c26, trimColor: 0x5f7a6a, windowGlassColor: 0x2a3540, windowWidth: 3.0, floorHeight: 4.0, litProbability: 0.3, warmth: 0.66, seed: 57.35 },
    parts: [
      { type: 'box', w: 105, d: 54, h: 5.5, dx: 1.9, dz: -0.4, rotY: -0.216, flat: 0x98917d },
      { type: 'box', w: 102, d: 47, h: 5.5, y0: 5.5, rotY: -0.216, flat: 0xa39a86 },
      // The south forecourt terrace (local (0, +33)): a
      // single-height apron in front of the entrance steps.
      { type: 'box', w: 66, d: 12, h: 5.5, dx: 7.1, dz: 32.2, rotY: -0.216, flat: 0xa39a86 },
      { type: 'box', w: 100, d: 45, h: 8, y0: 11, rotY: -0.216 },
      { type: 'box', w: 98, d: 40, h: 40, y0: 19, rotY: -0.216, facade: { kind: 'prewar', stoneColor: 0xa63c26, trimColor: 0x5f7a6a, windowGlassColor: 0x232d38, windowWidth: 2.6, floorHeight: 4.2, litProbability: 0.34, warmth: 0.62, seed: 57.36 } },
      { type: 'box', w: 102, d: 44, h: 2.2, y0: 59, rotY: -0.216, flat: 0x52796a },
      { type: 'box', w: 105, d: 53, h: 3.4, y0: 61.2, rotY: -0.216, flat: 0xc99636 },
      { type: 'box', w: 100, d: 42, h: 4.6, y0: 64.6, rotY: -0.216, flat: 0xdfd8c4 },
      { type: 'box', w: 102, d: 44, h: 2.0, y0: 69.2, rotY: -0.216, flat: 0x52796a },
      { type: 'box', w: 100, d: 45, h: 6.5, y0: 71.2, rotY: -0.216, flat: 0xc99636 },
      { type: 'box', w: 92, d: 38, h: 5.5, y0: 77.7, rotY: -0.216, flat: 0xc99636 },
      { type: 'box', w: 66, d: 20, h: 3.8, y0: 83.2, rotY: -0.216, flat: 0xbd8a2e },
      // The entrance porch on the south face (local (0, +29)
      // in the building frame, rotated into tile offsets) with
      // its own small golden roof slab.
      { type: 'box', w: 30, d: 12, h: 6.5, y0: 11, dx: 6.2, dz: 28.3, rotY: -0.216 },
      { type: 'box', w: 34, d: 15, h: 1.8, y0: 17.5, dx: 6.2, dz: 28.3, rotY: -0.216, flat: 0xc99636 },
    ],
  },
  {
    // Batch 6 (issue #103, northern phase 2): 北投焚化爐 —
    // the Beitou Refuse Incineration Plant's chimney in the
    // connector box, completed 1999. Chimney height 150 m
    // PUBLISHED (ZH Wikipedia incinerator list). Position is
    // the OSM restaurant node (7775187071, 摘星樓星月360度旋轉
    // 景觀餐廳, height tag 120) — it sits on the chimney.
    // Form from the reference photos: a straight, gently
    // tapered white concrete shaft painted with a bold
    // blue/grey/orange geometric mural; at ~116-120 m a wide
    // DARK CIRCULAR drum — the observation deck (116 m,
    // Taipei DEP visitor material) and the revolving
    // restaurant (120 m, Wikivoyage; one revolution per
    // 90 min, the world's first on a chimney) — with a teal
    // glass band and a railed rim; above it a slimmer shaft
    // to a smaller top collar and cap at 150 m. (The drum is
    // circular: "star" is the restaurant's name, 摘星樓/星月,
    // not its plan.) The renderer has no tapered cylinder, so
    // the shaft is stepped cylinders; the diagonal mural is
    // beyond the part idiom — one blue-grey segment stands in
    // for its dominant blue (recorded simplification). The
    // low plant hall east of the chimney (satellite: main
    // block ~135 x 96 m) takes the entry's concrete prewar
    // grid. Flat siting is correct — the phase-1 terrain
    // report puts the plant on the genuinely flat Guandu
    // plain edge. Audited (issue #42): every part at
    // 0.000 m²; nearest clearance 5.5 m (the south annex to
    // the plant's loop drive).
    // Decomposition: 10 (base flare) + 34 + 30 + 36 (shaft)
    // + 9.5 (drum) + 1.8 (rim) + 21.7 (upper shaft) + 3.6
    // (collar) + 3.4 (cap) = 150.
    id: 'beitou-incinerator', name: 'Beitou Incinerator', nameZh: '北投焚化爐',
    lat: 25.10804, lon: 121.49940, realHeight: 150, color: 0x87a0b4,
    site: { w: 265, d: 205, dx: 58, dz: -2 },
    facade: { kind: 'prewar', stoneColor: 0xcac2b0, trimColor: 0x8d8471, windowGlassColor: 0x27333f, windowWidth: 4.2, floorHeight: 5.0, litProbability: 0.22, warmth: 0.55, seed: 57.37 },
    parts: [
      { type: 'box', w: 134, d: 96, h: 30, dx: 70, dz: -8 },
      { type: 'box', w: 120, d: 80, h: 3, y0: 30, dx: 70, dz: -8, flat: 0x8f8a80 },
      { type: 'box', w: 64, d: 44, h: 15, dx: 58, dz: 42 },
      { type: 'cylinder', r: 7.6, h: 10, flat: 0xdcd8ce },
      { type: 'cylinder', r: 6.6, h: 34, y0: 10, flat: 0xe9e6dd },
      { type: 'cylinder', r: 6.1, h: 30, y0: 44, flat: 0x6d90ad },
      { type: 'cylinder', r: 5.6, h: 36, y0: 74, flat: 0xe9e6dd },
      { type: 'cylinder', r: 11.2, h: 9.5, y0: 110, flat: { color: 0x274b57, roughness: 0.3, metalness: 0.15 } },
      { type: 'cylinder', r: 12.0, h: 1.8, y0: 119.5, flat: 0x3c4147 },
      { type: 'cylinder', r: 4.7, h: 21.7, y0: 121.3, flat: 0xdcd8ce },
      { type: 'cylinder', r: 7.8, h: 3.6, y0: 143, flat: 0x4a5058 },
      { type: 'cylinder', r: 4.9, h: 3.4, y0: 146.6, flat: 0xb9b4a8 },
    ],
  },
];

// Resolve a structure definition into plan data: true tile-frame
// position, exclusion rectangles, and the distance a "how far is it"
// answer needs. Pure data, like the rest of the planner.
function resolveLandmark(def, originLatLon) {
  const [x, z] = latLonToTile(def.lat, def.lon, originLatLon);
  const rect = (r) => ({
    minX: Math.round((x + (r.dx || 0) - r.w / 2) * 10) / 10,
    maxX: Math.round((x + (r.dx || 0) + r.w / 2) * 10) / 10,
    minZ: Math.round((z + (r.dz || 0) - r.d / 2) * 10) / 10,
    maxZ: Math.round((z + (r.dz || 0) + r.d / 2) * 10) / 10,
  });
  const site = rect(def.site);
  const openGround = def.plaza ? rect(def.plaza) : null;
  return {
    id: def.id, name: def.name, nameZh: def.nameZh,
    x, z, lat: def.lat, lon: def.lon,
    realHeight: def.realHeight, height: def.realHeight,
    estimated: !!def.estimated,
    distFromOrigin: Math.round(Math.hypot(x, z)),
    color: def.color, site, openGround,
    sites: openGround ? [site, openGround] : [site],
    parts: def.parts,
    // Issue #57: the structure's facade treatment + optional sign,
    // pure registry data (the builders turn them into materials).
    facade: def.facade || null,
    sign: def.sign || null,
  };
}

// The registry resolved to plain marker data — the single source the
// in-game map's landmark layer reads (js/taipei-tile.js assembles the
// tile's landmark list from this plus Taipei 101 itself), so a
// structure is added in exactly one place and the map can never drift
// from the buildings that actually render.
export function taipeiLandmarkStructures(geodata) {
  const originLatLon = (geodata.frame && geodata.frame.originLatLon) || [25.033, 121.565];
  return LANDMARK_STRUCTURES.map((def) => {
    const r = resolveLandmark(def, originLatLon);
    return { id: r.id, name: r.name, nameZh: r.nameZh, x: r.x, z: r.z, height: r.realHeight, estimated: r.estimated };
  });
}

// ---- Per-block lot orientation (issue #62) ----
//
// Taipei is not one grid: the station district, Xinyi and the
// diagonal corridors all sit at different angles, and an
// axis-aligned lot grid reads wrong on every street that runs at an
// angle. Each block therefore takes a dominant angle from the
// carriageways that front it: roadbed centreline segments are
// clipped to the block's bbox grown by FRONTAGE_REACH_M (a wide
// boulevard's centreline sits that far from the land it fronts) and
// their directions accumulated at 4θ — the modulo-90° resultant, so
// the two directions of one street grid reinforce instead of
// cancelling — weighted by clipped length. The resultant is the
// block's angle only when it is both strong (coherence =
// |resultant| / total weight ≥ ORIENT_MIN_COHERENCE; a block
// fronting two grids at once has no single dominant angle) and
// actually angled (deviation from the tile axes > ORIENT_EPS_RAD;
// Taipei's true grids measure within ~3° of the axes and keep the
// axis grid, so those blocks plan byte-identically to pre-#62).
// The turned grid is laid over the same inset bbox in the block's
// frame, and the planner re-tests every exclusion on the lot's TRUE
// rotated footprint (below), so rotation never weakens an invariant
// the axis plan carries.
const FRONTAGE_REACH_M = 18;
const ORIENT_EPS_RAD = (3 * Math.PI) / 180;
const ORIENT_MIN_COHERENCE = 0.5;
const FRONTAGE_CELL = 96;

export function buildFrontageIndex(entries) {
  const grid = new Map();
  const key = (gx, gz) => gx * 100003 + gz;
  for (const e of entries) {
    const pts = e.pts || [];
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.01) continue;
      const phi4 = 4 * Math.atan2(bz - az, bx - ax);
      const s = { ax, az, bx, bz, len, c4: Math.cos(phi4), s4: Math.sin(phi4) };
      const gx0 = Math.floor(Math.min(ax, bx) / FRONTAGE_CELL), gx1 = Math.floor(Math.max(ax, bx) / FRONTAGE_CELL);
      const gz0 = Math.floor(Math.min(az, bz) / FRONTAGE_CELL), gz1 = Math.floor(Math.max(az, bz) / FRONTAGE_CELL);
      for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
        const k = key(gx, gz);
        let bucket = grid.get(k);
        if (!bucket) grid.set(k, bucket = []);
        bucket.push(s);
      }
    }
  }
  return { grid, key };
}

// Length of the part of segment a→b inside an axis rect (Liang–Barsky).
function clippedSegLen(ax, az, bx, bz, minX, maxX, minZ, maxZ) {
  const dx = bx - ax, dz = bz - az;
  let t0 = 0, t1 = 1;
  const p = [-dx, dx, -dz, dz], q = [ax - minX, maxX - ax, az - minZ, maxZ - az];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return 0; continue; }
    const r = q[i] / p[i];
    if (p[i] < 0) { if (r > t1) return 0; if (r > t0) t0 = r; }
    else { if (r < t0) return 0; if (r < t1) t1 = r; }
  }
  return Math.max(0, t1 - t0) * Math.hypot(dx, dz);
}

// The block's frontage angle in radians, or 0 to keep the axis grid
// (no frontage found, no dominant direction, or within the epsilon
// of the tile axes).
export function blockOrientation(index, block) {
  const minX = block.bbox.minX - FRONTAGE_REACH_M, maxX = block.bbox.maxX + FRONTAGE_REACH_M;
  const minZ = block.bbox.minZ - FRONTAGE_REACH_M, maxZ = block.bbox.maxZ + FRONTAGE_REACH_M;
  const seen = new Set();
  let sx = 0, sy = 0, wsum = 0;
  const gx0 = Math.floor(minX / FRONTAGE_CELL), gx1 = Math.floor(maxX / FRONTAGE_CELL);
  const gz0 = Math.floor(minZ / FRONTAGE_CELL), gz1 = Math.floor(maxZ / FRONTAGE_CELL);
  for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
    const bucket = index.grid.get(index.key(gx, gz));
    if (!bucket) continue;
    for (const s of bucket) {
      if (seen.has(s)) continue;
      seen.add(s);
      const w = clippedSegLen(s.ax, s.az, s.bx, s.bz, minX, maxX, minZ, maxZ);
      if (w <= 0) continue;
      sx += w * s.c4;
      sy += w * s.s4;
      wsum += w;
    }
  }
  if (!wsum) return 0;
  if (Math.hypot(sx, sy) / wsum < ORIENT_MIN_COHERENCE) return 0;
  let theta = Math.atan2(sy, sx) / 4;
  if (theta < 0) theta += Math.PI / 2;
  const dev = Math.min(theta, Math.PI / 2 - theta);
  return dev > ORIENT_EPS_RAD ? theta : 0;
}

// A lot's true footprint corners: centre + w along the frame's u
// axis (cosθ, sinθ), d along v (−sinθ, cosθ), as [x, z] pairs.
function lotCorners(cx, cz, w, d, cosT, sinT) {
  const hw = w / 2, hd = d / 2;
  return [
    [cx + hw * cosT - hd * sinT, cz + hw * sinT + hd * cosT],
    [cx + hw * cosT + hd * sinT, cz + hw * sinT - hd * cosT],
    [cx - hw * cosT + hd * sinT, cz - hw * sinT - hd * cosT],
    [cx - hw * cosT - hd * sinT, cz - hw * sinT + hd * cosT],
  ];
}

// Separating-axis intersection of two convex quads ([x, z] pairs in
// loop order): project both onto each quad's two edge normals.
function quadsIntersect(a, b) {
  for (const q of [a, b]) {
    for (const i of [0, 1]) {
      const [x1, z1] = q[i], [x2, z2] = q[(i + 1) % 4];
      const ex = x2 - x1, ez = z2 - z1, len = Math.hypot(ex, ez);
      if (len < 1e-9) continue;
      const ax = -ez / len, az = ex / len;
      let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
      for (const [px, pz] of a) { const p = px * ax + pz * az; if (p < aMin) aMin = p; if (p > aMax) aMax = p; }
      for (const [px, pz] of b) { const p = px * ax + pz * az; if (p < bMin) bMin = p; if (p > bMax) bMax = p; }
      if (aMax < bMin || bMax < aMin) return false;
    }
  }
  return true;
}

// Issue #128: the real-height join's constants. The floors->metres
// factors are validated against OSM height tags by the layer builder
// (tools/taipei/build-heights.py prints the MAE table on every run);
// the heights census test asserts the generated layer's header
// factors agree with these, so the two can never drift silently.
export const HEIGHT_JOIN = {
  permitM: 3.0,        // permit floor count (surveyed outlines) -> metres
  osmLevelsM: 3.0,     // OSM building:levels -> metres (counted floors:
                       // MAE 2.10 m vs OSM height tags, n=1,705 — see
                       // build-heights.py's FACTORS note)
  doorM: 3.85,         // door max floor -> metres: a plate point names the
                       // highest REGISTERED floor, undercounting the
                       // building by its roof level, so its metres per
                       // floor run higher (validated in build-heights.py)
  faceDoorDepthM: 22,  // plate points count for a block face up to this
                       // far inside the block from the face line
  faceDoorMinDoors: 2, // a face needs at least this many plate points
                       // before its median speaks for a lot
  fieldRadiusM: 100,   // neighbourhood-field reach for signal-less lots
  fieldMinLots: 3,     // ...and at least this many real lots inside it
};

export function planTaipeiBuildings(geodata) {
  const stats = { blocksSeen: 0, blocksSkippedSmall: 0, blocksSkippedParkWater: 0, blocksSkippedGreen: 0, blocksSkippedOutsideUnion: 0, lotsDroppedVacancy: 0, lotsDroppedParkWater: 0, lotsDroppedGreen: 0, lotsDroppedTowerSite: 0, lotsDroppedRoad: 0, lotsDroppedMedian: 0, lotsDroppedOutsideUnion: 0, lotsDroppedTrackBed: 0, lotsDroppedTrackPierce: 0, blocksRotated: 0, lotsRotated: 0, lotsPackedFrontage: 0, lotsTallFrontage: 0, heightsPermit: 0, heightsOsmHeight: 0, heightsOsmLevels: 0, heightsDoor: 0, heightsField: 0, heightsProc: 0 };
  // Union-of-boxes tile (issue #60): the geodata frame carries the
  // tile's boxes; ground exists only inside them. Raster blocks are
  // masked to the union by the builder, but a block's bbox can still
  // wrap a union corner, so the planner re-checks: a block whose
  // centroid is outside every box is skipped, and a lot whose centre
  // or any footprint corner leaves the union is dropped — no building
  // may hang over a dropped band. A geodata without boxes (older
  // extracts) plans exactly as before.
  const unionBoxes = Array.isArray(geodata.frame?.boxes) && geodata.frame.boxes.length ? geodata.frame.boxes : null;
  const inUnion = (x, z) => !unionBoxes || unionBoxes.some((b) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ);
  const polys = [];
  for (const p of geodata.parks || []) polys.push({ ring: p.ring, bb: ringBbox(p.ring) });
  for (const w of geodata.water || []) polys.push({ ring: w.ring, bb: ringBbox(w.ring) });
  const inPoly = (x, z) => {
    for (const p of polys) {
      if (x < p.bb.minX || x > p.bb.maxX || z < p.bb.minZ || z > p.bb.maxZ) continue;
      if (pointInRing(x, z, p.ring)) return true;
    }
    return false;
  };
  // Issue #102: emitted lot centres/sizes are rounded (0.1 m grid),
  // so a turned corner the planner cleared at full precision can
  // reconstruct up to ~0.07 m across a park/water edge. Guard the
  // turned-corner check with a clearance epsilon: a corner inside
  // a polygon OR within CORNER_CLEARANCE of its boundary counts as
  // in — the emitted plan then satisfies the corner invariant at
  // its own precision.
  const CORNER_CLEARANCE = 0.08;
  const nearPoly = (x, z) => {
    for (const p of polys) {
      if (x < p.bb.minX - CORNER_CLEARANCE || x > p.bb.maxX + CORNER_CLEARANCE ||
          z < p.bb.minZ - CORNER_CLEARANCE || z > p.bb.maxZ + CORNER_CLEARANCE) continue;
      if (pointInRing(x, z, p.ring)) return true;
      if (distToRing(x, z, p.ring) < CORNER_CLEARANCE) return true;
    }
    return false;
  };
  // Issue #114: green land (geodata.green — farmland, nature and
  // recreation ground from the same PBF extract) excludes urban lots
  // by the same two verdicts as park/water, counted separately so the
  // park/water numbers stay comparable across the change.
  const greenPolys = [];
  for (const p of geodata.green || []) greenPolys.push({ ring: p.ring, bb: ringBbox(p.ring) });
  const inGreen = (x, z) => {
    for (const p of greenPolys) {
      if (x < p.bb.minX || x > p.bb.maxX || z < p.bb.minZ || z > p.bb.maxZ) continue;
      if (pointInRing(x, z, p.ring)) return true;
    }
    return false;
  };
  const nearGreen = (x, z) => {
    for (const p of greenPolys) {
      if (x < p.bb.minX - CORNER_CLEARANCE || x > p.bb.maxX + CORNER_CLEARANCE ||
          z < p.bb.minZ - CORNER_CLEARANCE || z > p.bb.maxZ + CORNER_CLEARANCE) continue;
      if (pointInRing(x, z, p.ring)) return true;
      if (distToRing(x, z, p.ring) < CORNER_CLEARANCE) return true;
    }
    return false;
  };

  // Issue #128: the real-height join. geodata.heights (built by
  // tools/taipei/build-heights.py from the OGDL permit + door
  // datasets and OSM height/levels tags) is sampled per lot in
  // strict priority order — permit footprint over the lot centre,
  // then an OSM footprint there, then the door floors of the lot's
  // block face (below), then the neighbourhood field (second pass,
  // after the lot loop), then the procedural bands. Real signals
  // are never clamped to the bands: where the data says a tower
  // stands, the tower's height stands (the #115 study: Xinyi's real
  // massing far exceeds the 25–60 m core band). A geodata without
  // the layer plans exactly as before.
  const heightLayer = geodata.heights && Array.isArray(geodata.heights.footprints) ? geodata.heights : null;
  const FP_CELL = 48;
  const fpKey = (gx, gz) => gx * 100003 + gz;
  const fpGrid = new Map();
  if (heightLayer) {
    for (const f of heightLayer.footprints) {
      const e = { ring: f.ring, bb: ringBbox(f.ring), src: f.src, floors: f.floors, height: f.height };
      const gx0 = Math.floor(e.bb.minX / FP_CELL), gx1 = Math.floor(e.bb.maxX / FP_CELL);
      const gz0 = Math.floor(e.bb.minZ / FP_CELL), gz1 = Math.floor(e.bb.maxZ / FP_CELL);
      for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
        const k = fpKey(gx, gz);
        if (!fpGrid.has(k)) fpGrid.set(k, []);
        fpGrid.get(k).push(e);
      }
    }
  }
  // Tiers 1–2: the signal of the footprint over a point. Permits
  // win over OSM wherever both contain the point (a surveyed permit
  // outline outranks a mapper's tag), so the scan completes before
  // any OSM hit is returned.
  const footprintSignalAt = (x, z) => {
    if (!heightLayer) return null;
    const bucket = fpGrid.get(fpKey(Math.floor(x / FP_CELL), Math.floor(z / FP_CELL)));
    if (!bucket) return null;
    let osm = null;
    for (const e of bucket) {
      if (x < e.bb.minX || x > e.bb.maxX || z < e.bb.minZ || z > e.bb.maxZ) continue;
      if (!pointInRing(x, z, e.ring)) continue;
      if (e.src === 'permit' && e.floors > 0) return { src: 'permit', floors: e.floors };
      if (e.src === 'osm' && !osm) osm = e;
    }
    if (osm) {
      if (osm.height > 0) return { src: 'osm-height', height: osm.height };
      if (osm.floors > 0) return { src: 'osm-levels', floors: osm.floors };
    }
    return null;
  };
  // Tier 3 support: door plate points (flat [x, z, maxFloors]) on a
  // grid. A plate point samples the WHOLE building at its address —
  // the join therefore never reads a single door for a lot; each
  // block face pools its doors and speaks by their median (the
  // per-face pools are built in the block loop, where the faces
  // live). The #115 study's per-lot nearest-door join oscillated
  // 3 m -> 35 m along one real row of houses; a face median cannot.
  const DOOR_CELL = 24;
  const doorPts = heightLayer && Array.isArray(heightLayer.doors) ? heightLayer.doors : null;
  const doorGrid = new Map();
  if (doorPts) {
    for (let i = 0; i + 2 < doorPts.length; i += 3) {
      const k = fpKey(Math.floor(doorPts[i] / DOOR_CELL), Math.floor(doorPts[i + 1] / DOOR_CELL));
      if (!doorGrid.has(k)) doorGrid.set(k, []);
      doorGrid.get(k).push(i / 3);
    }
  }
  const medianOf = (vals) => {
    const s = [...vals].sort((a, b) => a - b);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  };

  // Road ribbons the lots must keep off: merged roadbeds for carriageways
  // (raw carriageway ways as fallback), plus the non-carriageway paths.
  const carriageways = Array.isArray(geodata.roadbeds) && geodata.roadbeds.length
    ? geodata.roadbeds
    : (geodata.roads || []).filter((r) => !NON_CARRIAGEWAY.has(r.highway));
  const paths = (geodata.roads || []).filter((r) => NON_CARRIAGEWAY.has(r.highway));
  const { grid, key } = buildSegmentGrid([...carriageways, ...paths]);
  const roadInfoAt = (x, z) => {
    const bucket = grid.get(key(Math.floor(x / GRID_CELL), Math.floor(z / GRID_CELL)));
    let clearance = Infinity, rank = 0;
    if (bucket) {
      for (const s of bucket) {
        const d = distToSegment(x, z, s.ax, s.az, s.bx, s.bz);
        if (d - s.half < clearance) clearance = d - s.half;
        if (d < QUERY_R && s.rank > rank) rank = s.rank;
      }
    }
    return { clearance, rank };
  };
  // Issue #106: the best road class whose ribbon edge actually comes
  // within `reach` of a point (roadInfoAt's rank windows a flat 34 m,
  // which lets a crossing arterial claim faces it never fronts). Used
  // to classify each block face by the road that fronts IT.
  const frontageRankAt = (x, z, reach) => {
    const bucket = grid.get(key(Math.floor(x / GRID_CELL), Math.floor(z / GRID_CELL)));
    let rank = 0;
    if (bucket) {
      for (const s of bucket) {
        if (distToSegment(x, z, s.ax, s.az, s.bx, s.bz) - s.half <= reach && s.rank > rank) rank = s.rank;
      }
    }
    return rank;
  };

  // Exact ribbon verdicts (issue #65), over the same carriageway +
  // path set as the segment grid: 'road' when the margin-grown
  // footprint intersects a ribbon, 'median' when the lot is flanked
  // on opposite sides by same-name carriageway ribbons (the divided
  // span of one road — its median/separator strips are raster land
  // between separate beds, so no ribbon covers them), else null.
  const ribbonRects = [...buildRibbonRects(carriageways, true), ...buildRibbonRects(paths, false)];
  const ribbonGrid = buildRibbonGrid(ribbonRects);
  const ribbonVerdict = (cx, cz, w, d) => {
    const minX = cx - w / 2, maxX = cx + w / 2, minZ = cz - d / 2, maxZ = cz + d / 2;
    const gMinX = minX - ROAD_MARGIN_M, gMaxX = maxX + ROAD_MARGIN_M;
    const gMinZ = minZ - ROAD_MARGIN_M, gMaxZ = maxZ + ROAD_MARGIN_M;
    const west = new Map(), east = new Map(), north = new Map(), south = new Map();
    const seen = new Set();
    const gx0 = Math.floor(minX / RIBBON_GRID_CELL), gx1 = Math.floor(maxX / RIBBON_GRID_CELL);
    const gz0 = Math.floor(minZ / RIBBON_GRID_CELL), gz1 = Math.floor(maxZ / RIBBON_GRID_CELL);
    for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
      const bucket = ribbonGrid.grid.get(ribbonGrid.key(gx, gz));
      if (!bucket) continue;
      for (const idx of bucket) {
        if (seen.has(idx)) continue;
        seen.add(idx);
        const r = ribbonRects[idx];
        if (r.maxX >= gMinX && r.minX <= gMaxX && r.maxZ >= gMinZ && r.minZ <= gMaxZ
          && ribbonHitsLot(r, gMinX, gMaxX, gMinZ, gMaxZ)) return 'road';
        if (r.flank && r.name) {
          const spanZ = ribbonSpanAtZ(r, cz);
          if (spanZ) {
            if (spanZ[1] <= minX + 0.5) {
              const dd = minX - spanZ[1];
              if (dd < (west.get(r.name) ?? Infinity)) west.set(r.name, dd);
            }
            if (spanZ[0] >= maxX - 0.5) {
              const dd = spanZ[0] - maxX;
              if (dd < (east.get(r.name) ?? Infinity)) east.set(r.name, dd);
            }
          }
          const spanX = ribbonSpanAtX(r, cx);
          if (spanX) {
            if (spanX[1] <= minZ + 0.5) {
              const dd = minZ - spanX[1];
              if (dd < (north.get(r.name) ?? Infinity)) north.set(r.name, dd);
            }
            if (spanX[0] >= maxZ - 0.5) {
              const dd = spanX[0] - maxZ;
              if (dd < (south.get(r.name) ?? Infinity)) south.set(r.name, dd);
            }
          }
        }
      }
    }
    for (const [name, dd] of west) {
      if (dd <= CORRIDOR_GAP_MAX_M && (east.get(name) ?? Infinity) <= CORRIDOR_GAP_MAX_M) return 'median';
    }
    for (const [name, dd] of north) {
      if (dd <= CORRIDOR_GAP_MAX_M && (south.get(name) ?? Infinity) <= CORRIDOR_GAP_MAX_M) return 'median';
    }
    return null;
  };

  // Issue #62: block frontage angles come from the same carriageway
  // set the ribbons are built from, and a turned lot's road test is
  // an exact SAT of its margin-grown true footprint against the
  // ribbon rects (the axis ribbonVerdict only ever sees the lot's
  // axis twin — the planner loop runs both, see below).
  const frontageIndex = buildFrontageIndex(carriageways);
  const rotatedRoadHit = (cx, cz, w, d, cosT, sinT) => {
    const grown = lotCorners(cx, cz, w + 2 * ROAD_MARGIN_M, d + 2 * ROAD_MARGIN_M, cosT, sinT);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [px, pz] of grown) {
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (pz < minZ) minZ = pz;
      if (pz > maxZ) maxZ = pz;
    }
    const seen = new Set();
    const gx0 = Math.floor(minX / RIBBON_GRID_CELL), gx1 = Math.floor(maxX / RIBBON_GRID_CELL);
    const gz0 = Math.floor(minZ / RIBBON_GRID_CELL), gz1 = Math.floor(maxZ / RIBBON_GRID_CELL);
    for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
      const bucket = ribbonGrid.grid.get(ribbonGrid.key(gx, gz));
      if (!bucket) continue;
      for (const idx of bucket) {
        if (seen.has(idx)) continue;
        seen.add(idx);
        const r = ribbonRects[idx];
        if (r.maxX < minX || r.minX > maxX || r.maxZ < minZ || r.minZ > maxZ) continue;
        const c = r.corners;
        const rc = [[c[0], c[1]], [c[2], c[3]], [c[4], c[5]], [c[6], c[7]]];
        if (quadsIntersect(grown, rc)) return true;
      }
    }
    return false;
  };

  // ---- MRT track clearance (issue #139) ----
  // No lot may stand on the track bed or pierce the guideway. The
  // test geometry is the emitted mrtDecks lines themselves (the
  // pipeline pre-builds the deck lines before the plan, so the
  // planner tests exactly what the renderer draws, identically in
  // the pipeline, the boot and the tests): per segment a butt-cap
  // rect at the line's width, classed at-grade by the renderer's
  // own low-bed rule. A lot whose margin-grown footprint intersects
  // an at-grade rect drops outright; against an elevated rect only
  // a lot tall enough to reach the deck underside (minus a
  // clearance) drops — low lots under a viaduct are real Taipei
  // and stay.
  const TRACK_MARGIN_M = 0.5;      // footprint clearance off the track rect, as for road ribbons
  const TRACK_CLEARANCE_M = 1.0;   // a kept lot's top stays this far below the underside
  const TRACK_LOW_BED_MAX = 0.5;   // mirrors LOW_BED_MAX in js/taipei-viaduct.js
  const trackDepth = (geodata.mrtDecks && geodata.mrtDecks.deckDepth) ?? 1.8;
  const trackRects = [];
  for (const line of (geodata.mrtDecks && geodata.mrtDecks.lines) || []) {
    const half = Math.max((line.width || 6) / 2, 0.75);
    const pts = line.pts || [];
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3];
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
      if (len < 0.01) continue;
      const ux = dx / len, uz = dz / len;
      const nx = (-dz / len) * half, nz = (dx / len) * half;
      const xs = [ax + nx, bx + nx, bx - nx, ax - nx];
      const zs = [az + nz, bz + nz, bz - nz, az - nz];
      const hA = line.h[i / 2], hB = line.h[i / 2 + 1];
      trackRects.push({
        ax, az, bx, bz, ux, uz, hA, hB,
        atGrade: Math.max(hA, hB) < TRACK_LOW_BED_MAX,
        minX: Math.min(...xs), maxX: Math.max(...xs),
        minZ: Math.min(...zs), maxZ: Math.max(...zs),
        corners: [xs[0], zs[0], xs[1], zs[1], xs[2], zs[2], xs[3], zs[3]],
      });
    }
  }
  const trackGrid = trackRects.length ? buildRibbonGrid(trackRects) : null;
  // Verdict for one candidate footprint: { bed, under } — bed when
  // the margin-grown footprint crosses an at-grade track rect;
  // under = the lowest deck underside (m) along the elevated rects
  // it crosses (Infinity when it crosses none). `grown` is the
  // margin-grown footprint as corner pairs.
  const trackVerdict = (cx, cz, grown, gMinX, gMaxX, gMinZ, gMaxZ) => {
    const out = { bed: false, under: Infinity };
    if (!trackGrid) return out;
    const seen = new Set();
    const gx0 = Math.floor(gMinX / RIBBON_GRID_CELL), gx1 = Math.floor(gMaxX / RIBBON_GRID_CELL);
    const gz0 = Math.floor(gMinZ / RIBBON_GRID_CELL), gz1 = Math.floor(gMaxZ / RIBBON_GRID_CELL);
    for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
      const bucket = trackGrid.grid.get(trackGrid.key(gx, gz));
      if (!bucket) continue;
      for (const idx of bucket) {
        if (seen.has(idx)) continue;
        seen.add(idx);
        const r = trackRects[idx];
        if (r.maxX < gMinX || r.minX > gMaxX || r.maxZ < gMinZ || r.minZ > gMaxZ) continue;
        const rc = [[r.corners[0], r.corners[1]], [r.corners[2], r.corners[3]], [r.corners[4], r.corners[5]], [r.corners[6], r.corners[7]]];
        if (!quadsIntersect(grown, rc)) continue;
        if (r.atGrade) { out.bed = true; continue; }
        // Lowest underside along the segment's run through the
        // footprint: sample the AABB-clipped ends plus the point
        // nearest the lot centre (the slab clip is the build-
        // elevated.mjs pattern).
        const dx = r.bx - r.ax, dz = r.bz - r.az;
        const L2 = dx * dx + dz * dz || 1e-9;
        let lo = 0, hi = 1, ok = true;
        for (const [p, qv] of [[-dx, r.ax - gMinX], [dx, gMaxX - r.ax], [-dz, r.az - gMinZ], [dz, gMaxZ - r.az]]) {
          if (Math.abs(p) < 1e-12) { if (qv < 0) { ok = false; break; } continue; }
          const t = qv / p;
          if (p < 0) lo = Math.max(lo, t); else hi = Math.min(hi, t);
          if (lo > hi) { ok = false; break; }
        }
        const ts = ok ? [lo, hi] : [];
        const tc = ((cx - r.ax) * dx + (cz - r.az) * dz) / L2;
        ts.push(Math.max(0, Math.min(1, tc)));
        for (const t of ts) {
          const u = r.hA + (r.hB - r.hA) * t - trackDepth;
          if (u < out.under) out.under = u;
        }
      }
    }
    return out;
  };

  const t101 = (geodata.landmarks || {})['Taipei 101'];
  const towerSite = t101
    ? { minX: t101.x - t101.w / 2, maxX: t101.x + t101.w / 2, minZ: t101.z - t101.d / 2, maxZ: t101.z + t101.d / 2 }
    : null;

  // Landmark structures (issue #26): resolved against the tile
  // frame's real origin, and every exclusion rectangle they register
  // (structure sites + City Hall's open plaza) joins the 101 site in
  // keeping generic lots off.
  const originLatLon = (geodata.frame && geodata.frame.originLatLon) || [25.033, 121.565];
  const landmarkTowers = LANDMARK_STRUCTURES.map((def) => resolveLandmark(def, originLatLon));
  const landmarkSites = landmarkTowers.flatMap((s) => s.sites);
  // MRT elevated stations (issue #118): the structures straddle the
  // guideway corridor, so their footprint bounding boxes join the
  // exclusion sites — no generic lot is planned through a station.
  // (Stations are deliberately NOT landmark-registry entries: a
  // straddling footprint cannot satisfy the registry's plan-view
  // no-road-overlap invariant.)
  const mrtSites = (geodata.mrtStations || []).map((s) => {
    // Footprint half extents of the rendered station structures —
    // mirrors mrtStationFootprint in js/taipei-mrt-stations.js (this
    // module stays import-free by convention; keep the two in sync).
    const L = s.length || 112;
    const Wd = s.width || (s.kind === 'jiantan' ? 24 : s.kind === 'beitou' ? 33 : s.kind === 'at-grade' ? 16.5 : 21.5);
    const hw = s.kind === 'jiantan' ? (Wd + 2) / 2 : s.kind === 'beitou' ? (Wd + 2.6) / 2 : s.kind === 'xinbeitou' ? (Wd + 1.2) / 2 : s.kind === 'at-grade' ? (Wd + 4.6) / 2 : (Wd + 1.9) / 2;
    const hl = s.kind === 'jiantan' ? 122 : s.kind === 'beitou' ? (L + 4) / 2 : s.kind === 'xinbeitou' ? (L + 2.4) / 2 : L / 2;
    const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [lx, lz] of [[-hw, -hl], [hw, -hl], [hw, hl], [-hw, hl]]) {
      const px = s.x + lx * cy + lz * sy, pz = s.z - lx * sy + lz * cy;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (pz < minZ) minZ = pz;
      if (pz > maxZ) maxZ = pz;
    }
    return { minX, maxX, minZ, maxZ };
  });
  // Beitou depot (issue #139): the site rect the digest fitted over
  // the yard fan + halls joins the exclusions — but as an exact
  // rotated-rect test, not an AABB: the rect runs ~1.5 km at the
  // fan's diagonal yaw, and its AABB would swallow whole
  // neighbourhood blocks at the corners. The candidate's own
  // AABB corners are transformed into the site frame (the same
  // conservative square bound the AABB site test uses).
  const depotRect = (() => {
    const dep = geodata.mrtDepot;
    if (!dep || !dep.site) return null;
    return {
      x: dep.x, z: dep.z, cos: Math.cos(dep.yaw), sin: Math.sin(dep.yaw),
      dAlong: dep.site.dAlong, dAcross: dep.site.dAcross,
      hAlong: dep.site.along / 2, hAcross: dep.site.across / 2,
    };
  })();
  const depotHit = (cx, cz, hw, hd) => {
    if (!depotRect) return false;
    let mnA = Infinity, mxA = -Infinity, mnL = Infinity, mxL = -Infinity;
    for (const [ox, oz] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) {
      const dx = cx + ox - depotRect.x, dz = cz + oz - depotRect.z;
      const la = dx * depotRect.cos - dz * depotRect.sin;
      const ll = dx * depotRect.sin + dz * depotRect.cos;
      if (la < mnA) mnA = la;
      if (la > mxA) mxA = la;
      if (ll < mnL) mnL = ll;
      if (ll > mxL) mxL = ll;
    }
    return mxA >= depotRect.dAcross - depotRect.hAcross && mnA <= depotRect.dAcross + depotRect.hAcross &&
           mxL >= depotRect.dAlong - depotRect.hAlong && mnL <= depotRect.dAlong + depotRect.hAlong;
  };
  const exclusionSites = towerSite ? [towerSite, ...landmarkSites, ...mrtSites] : [...landmarkSites, ...mrtSites];

  const lots = [];
  const lotProcH = []; // issue #128: each lot's procedural draw, index-aligned with lots
  const blocks = geodata.blocks || [];
  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi];
    stats.blocksSeen++;
    if (!(block.area >= 150)) { stats.blocksSkippedSmall++; continue; }
    if (inPoly(block.cx, block.cz)) { stats.blocksSkippedParkWater++; continue; }
    if (inGreen(block.cx, block.cz)) { stats.blocksSkippedGreen++; continue; }
    if (!inUnion(block.cx, block.cz)) { stats.blocksSkippedOutsideUnion++; continue; }
    const inset = 3.0; // street-section band margin (see header)
    const minX = block.bbox.minX + inset, maxX = block.bbox.maxX - inset;
    const minZ = block.bbox.minZ + inset, maxZ = block.bbox.maxZ - inset;
    const innerW = maxX - minX, innerD = maxZ - minZ;
    if (innerW < 10 || innerD < 10) continue;
    const big = block.area > 40000;
    const pitchMul = big ? 1.7 : 1.0;
    const vacancy = big ? 0.30 : 0.13;
    const frontage = (15 + hash01(bi * 7919) * 10) * pitchMul;
    const depthPitch = (15 + hash01(bi * 104729 + 3) * 7) * pitchMul;
    // Issue #62: the block's lot grid turns to its fronting streets
    // (theta = 0 keeps the axis grid — the pre-#62 plan, byte for
    // byte). In the turned frame the grid spans the inset bbox's
    // extent along the frame axes; candidate lots whose true
    // corners leave the inset bbox are skipped in the loop below.
    const theta = blockOrientation(frontageIndex, block);
    const cosT = Math.cos(theta), sinT = Math.sin(theta);
    let cols, rows, cellW, cellD;
    if (theta) {
      stats.blocksRotated++;
      const extU = innerW * Math.abs(cosT) + innerD * Math.abs(sinT);
      const extV = innerW * Math.abs(sinT) + innerD * Math.abs(cosT);
      cols = Math.max(1, Math.round(extU / frontage));
      rows = Math.max(1, Math.round(extV / depthPitch));
      cellW = extU / cols;
      cellD = extV / rows;
    } else {
      cols = Math.max(1, Math.round(innerW / frontage));
      rows = Math.max(1, Math.round(innerD / depthPitch));
      cellW = innerW / cols;
      cellD = innerD / rows;
    }
    const ocx = (minX + maxX) / 2, ocz = (minZ + maxZ) / 2;
    // Issue #106: classify the block's four faces by the road that
    // fronts each — three samples per face, pushed 7 m out from the
    // inset edge (past the block's own bbox edge, into the street
    // section), best class whose ribbon edge comes within 16 m of a
    // sample. Faces are named by the frame axis they cap: vLow/vHigh
    // are the row ends (row 0 / row rows-1), uLow/uHigh the column
    // ends. A face at rank ≥ 2 (tertiary/collector or better) packs
    // its row wall-to-wall and skips vacancy; rank ≥ 2 faces also
    // carry the tall-frontage height regime (see the height pick).
    const halfU = (cols * cellW) / 2, halfV = (rows * cellD) / 2;
    const edgeRankAt = (cu, cv, ou, ov) => {
      // Sample the face whose centre is (cu, cv) in frame coords and
      // whose outward normal is (ou, ov): points at ±30% and centre
      // along the face, pushed 7 m outward.
      let rank = 0;
      const alongU = ou === 0; // face runs along u when its normal is v
      const span = alongU ? halfU : halfV;
      for (const f of [-0.3, 0, 0.3]) {
        const fu = cu + (alongU ? f * 2 * span : 0) + ou * 7;
        const fv = cv + (alongU ? 0 : f * 2 * span) + ov * 7;
        const r = frontageRankAt(ocx + fu * cosT - fv * sinT, ocz + fu * sinT + fv * cosT, 16);
        if (r > rank) rank = r;
      }
      return rank;
    };
    const edgeRankVLow = edgeRankAt(0, -halfV, 0, -1);
    const edgeRankVHigh = edgeRankAt(0, halfV, 0, 1);
    const edgeRankULow = edgeRankAt(-halfU, 0, -1, 0);
    const edgeRankUHigh = edgeRankAt(halfU, 0, 1, 0);
    // Issue #128: this block's door plate points, pooled per face
    // in the block frame. A door belongs to a face when it stands
    // inside the block within FACE_DOOR_DEPTH of the face line (a
    // plate point sits at its building's entrance, behind the
    // frontage) and within the face's span; a corner door serves
    // both faces it touches. Doors deeper inside the block belong
    // to no face — interior lots hear from the neighbourhood field
    // instead. Pools hold door indices; a lot pools the faces it
    // stands in and takes the pooled median (see the height pick).
    const faceDoorIdx = { vLow: [], vHigh: [], uLow: [], uHigh: [] };
    if (doorPts) {
      const reach = Math.max(halfU, halfV) + HEIGHT_JOIN.faceDoorDepthM + 4;
      const gx0 = Math.floor((ocx - reach) / DOOR_CELL), gx1 = Math.floor((ocx + reach) / DOOR_CELL);
      const gz0 = Math.floor((ocz - reach) / DOOR_CELL), gz1 = Math.floor((ocz + reach) / DOOR_CELL);
      for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
        const bucket = doorGrid.get(fpKey(gx, gz));
        if (!bucket) continue;
        for (const di of bucket) {
          const dx = doorPts[di * 3] - ocx, dz = doorPts[di * 3 + 1] - ocz;
          const fu = dx * cosT + dz * sinT, fv = -dx * sinT + dz * cosT;
          if (fu < -halfU - 2 || fu > halfU + 2 || fv < -halfV - 2 || fv > halfV + 2) continue;
          const dep = HEIGHT_JOIN.faceDoorDepthM;
          if (fv >= -halfV - 1 && fv <= -halfV + dep) faceDoorIdx.vLow.push(di);
          if (fv <= halfV + 1 && fv >= halfV - dep) faceDoorIdx.vHigh.push(di);
          if (fu >= -halfU - 1 && fu <= -halfU + dep) faceDoorIdx.uLow.push(di);
          if (fu <= halfU + 1 && fu >= halfU - dep) faceDoorIdx.uHigh.push(di);
        }
      }
    }
    for (let col = 0; col < cols; col++) {
      for (let row = 0; row < rows; row++) {
        const seed = Math.imul(bi + 1, 73856093) ^ Math.imul(col + 1, 19349663) ^ Math.imul(row + 1, 83492791);
        // Issue #106: which of the block's faces does this lot stand
        // in, and how are they classed? packU/packV: the lot's row
        // runs along a collector-or-better face, so its side gap
        // along that row closes to zero; frontRank is the best face
        // class the lot stands in (drives the tall regime below).
        const packU = (row === 0 && edgeRankVLow >= 2) || (row === rows - 1 && edgeRankVHigh >= 2);
        const packV = (col === 0 && edgeRankULow >= 2) || (col === cols - 1 && edgeRankUHigh >= 2);
        let frontRank = 0;
        if (row === 0) frontRank = Math.max(frontRank, edgeRankVLow);
        if (row === rows - 1) frontRank = Math.max(frontRank, edgeRankVHigh);
        if (col === 0) frontRank = Math.max(frontRank, edgeRankULow);
        if (col === cols - 1) frontRank = Math.max(frontRank, edgeRankUHigh);
        // A packed frontage row takes no vacancy holes — a missing
        // tooth is exactly what the continuous street wall is not.
        if (hash01(seed ^ 0x51ab) < (packU || packV ? 0 : vacancy)) { stats.lotsDroppedVacancy++; continue; }
        // The emitted lot centre is rounded to 0.1 m (see the push
        // below); run every exclusion test at THAT point, not the raw
        // grid centre. The two can straddle a polygon edge — the west
        // expansion regen (issue #60) produced a lot whose raw centre
        // sat 5 mm outside a park sliver while its rounded, emitted
        // centre sat inside it, passing the planner and failing the
        // audit. One point, tested once, no disagreement.
        let cx, cz;
        if (theta) {
          const fu = (col + 0.5) * cellW - (cols * cellW) / 2;
          const fv = (row + 0.5) * cellD - (rows * cellD) / 2;
          cx = Math.round((ocx + fu * cosT - fv * sinT) * 10) / 10;
          cz = Math.round((ocz + fu * sinT + fv * cosT) * 10) / 10;
        } else {
          cx = Math.round((minX + (col + 0.5) * cellW) * 10) / 10;
          cz = Math.round((minZ + (row + 0.5) * cellD) * 10) / 10;
        }
        const gap = 1.2 + hash01(seed ^ 0x77c3) * 1.8;
        // Issue #106: packed rows share party walls — no gap is
        // subtracted along the packed direction, so neighbouring
        // footprints meet at the cell boundary exactly.
        const w = cellW - (packU ? 0 : gap), d = cellD - (packV ? 0 : gap);
        if (w < 7 || d < 7) continue;
        // Issue #62: a turned lot's true footprint, from its
        // emitted (rounded) centre and the frame angle. The lot must
        // stay inside the block's inset bbox — the same ground the
        // axis grid subdivides (an uncounted skip, like w < 7).
        const corners = theta ? lotCorners(cx, cz, w, d, cosT, sinT) : null;
        let cornersAabb = null;
        if (theta) {
          cornersAabb = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
          for (const [px, pz] of corners) {
            if (px < cornersAabb.minX) cornersAabb.minX = px;
            if (px > cornersAabb.maxX) cornersAabb.maxX = px;
            if (pz < cornersAabb.minZ) cornersAabb.minZ = pz;
            if (pz > cornersAabb.maxZ) cornersAabb.maxZ = pz;
          }
          if (corners.some(([px, pz]) => px < minX - 1e-9 || px > maxX + 1e-9 || pz < minZ - 1e-9 || pz > maxZ + 1e-9)) continue;
        }
        if (inPoly(cx, cz)) { stats.lotsDroppedParkWater++; continue; }
        if (theta && corners.some(([px, pz]) => nearPoly(px, pz))) { stats.lotsDroppedParkWater++; continue; }
        if (inGreen(cx, cz)) { stats.lotsDroppedGreen++; continue; }
        if (theta && corners.some(([px, pz]) => nearGreen(px, pz))) { stats.lotsDroppedGreen++; continue; }
        if (!inUnion(cx, cz)) { stats.lotsDroppedOutsideUnion++; continue; }
        let onLandmarkSite = false;
        for (const s of exclusionSites) {
          if (cx + w / 2 > s.minX && cx - w / 2 < s.maxX && cz + d / 2 > s.minZ && cz - d / 2 < s.maxZ) { onLandmarkSite = true; break; }
        }
        if (onLandmarkSite) {
          stats.lotsDroppedTowerSite++;
          continue;
        }
        // Issue #139: the Beitou depot site, tested exactly in its
        // own frame (see depotHit above).
        if (depotHit(cx, cz, w / 2, d / 2)) { stats.lotsDroppedTowerSite++; continue; }
        if (theta) {
          // The axis test above sees the lot's axis twin; the true
          // footprint is a different quad — test it exactly (SAT)
          // against every exclusion site as well.
          let siteHit = false;
          for (const s of exclusionSites) {
            if (cornersAabb.maxX < s.minX || cornersAabb.minX > s.maxX || cornersAabb.maxZ < s.minZ || cornersAabb.minZ > s.maxZ) continue;
            if (quadsIntersect(corners, [[s.minX, s.minZ], [s.maxX, s.minZ], [s.maxX, s.maxZ], [s.minX, s.maxZ]])) { siteHit = true; break; }
          }
          if (!siteHit && depotHit(cx, cz, (cornersAabb.maxX - cornersAabb.minX) / 2, (cornersAabb.maxZ - cornersAabb.minZ) / 2)) siteHit = true;
          if (siteHit) { stats.lotsDroppedTowerSite++; continue; }
        }
        const verdict = ribbonVerdict(cx, cz, w, d);
        if (verdict === 'road') { stats.lotsDroppedRoad++; continue; }
        if (verdict === 'median') { stats.lotsDroppedMedian++; continue; }
        if (theta) {
          // Issue #62: the axis verdict guarantees what the #65
          // audit re-derives from the emitted data; the TRUE
          // footprint must clear the ribbons exactly as well
          // (margin-grown SAT), and the median rule is re-run on
          // the footprint's axis span — its flank lines measured
          // at that span, the conservative reading: a divided
          // span that flanks the span flanks the lot. (The span's
          // own 'road' result is not used: the span is a superset
          // shape and intersection is judged on the two exact
          // footprints only.)
          if (rotatedRoadHit(cx, cz, w, d, cosT, sinT)) { stats.lotsDroppedRoad++; continue; }
          if (ribbonVerdict(cx, cz, cornersAabb.maxX - cornersAabb.minX, cornersAabb.maxZ - cornersAabb.minZ) === 'median') { stats.lotsDroppedMedian++; continue; }
        }
        // Issue #139: the MRT track corridor. The bed half runs
        // here (it needs no height); the pierce half runs after
        // the height pick below, against track.under.
        const trackGrown = lotCorners(cx, cz, w + 2 * TRACK_MARGIN_M, d + 2 * TRACK_MARGIN_M, cosT, sinT);
        let tgMinX = Infinity, tgMaxX = -Infinity, tgMinZ = Infinity, tgMaxZ = -Infinity;
        for (const [px, pz] of trackGrown) {
          if (px < tgMinX) tgMinX = px;
          if (px > tgMaxX) tgMaxX = px;
          if (pz < tgMinZ) tgMinZ = pz;
          if (pz > tgMaxZ) tgMaxZ = pz;
        }
        const track = trackVerdict(cx, cz, trackGrown, tgMinX, tgMaxX, tgMinZ, tgMaxZ);
        if (track.bed) { stats.lotsDroppedTrackBed++; continue; }
        // The ribbon verdicts say nothing about the tile union
        // (issue #60): no footprint corner may hang over a dropped
        // band, where there is no ground at all.
        let cornerOutsideUnion = false;
        for (const [ox, oz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
          if (!inUnion(cx + (ox * w) / 2, cz + (oz * d) / 2)) { cornerOutsideUnion = true; break; }
        }
        if (cornerOutsideUnion) { stats.lotsDroppedOutsideUnion++; continue; }
        if (theta && corners.some(([px, pz]) => !inUnion(px, pz))) { stats.lotsDroppedOutsideUnion++; continue; }
        const { rank } = roadInfoAt(cx, cz);
        const dOrigin = Math.hypot(cx, cz);
        let lo, hi;
        if (dOrigin < 650) { lo = 25; hi = 60; }        // Xinyi commercial core
        else if (rank >= 3) { lo = 12; hi = 30; }       // boulevard / arterial frontage
        else { lo = 8; hi = 18; }                        // residential interiors
        // Issue #106: the tall-frontage regime — a lot standing in a
        // main-road face draws from that face's band instead of the
        // contextual tiers (the Xinyi core band already out-talls
        // every frontage band, so it keeps its own).
        let tallFrontage = false;
        if (dOrigin >= 650 && frontRank >= 2) {
          tallFrontage = true;
          if (frontRank >= 4) { lo = 24; hi = 54; }      // primary-or-better face
          else if (frontRank === 3) { lo = 18; hi = 42; } // secondary face
          else { lo = 15; hi = 30; }                      // tertiary / collector face
        }
        const procH = Math.round((lo + hash01(seed ^ 0x3d9a) * (hi - lo)) * 2) / 2;
        // Issue #128: a real signal overrides the band draw (see
        // the join section above for the tiers). The procedural
        // draw is still computed for every lot — it is the fallback
        // for signal-less lots, the field tier's blend partner, and
        // it keeps every hash consumer downstream byte-stable.
        let h = procH, hSrc = 'proc';
        if (heightLayer) {
          const fp = footprintSignalAt(cx, cz);
          if (fp) {
            if (fp.src === 'permit') { h = Math.round(fp.floors * HEIGHT_JOIN.permitM * 2) / 2; hSrc = 'permit'; }
            else if (fp.src === 'osm-height') { h = Math.round(fp.height * 2) / 2; hSrc = 'osm-height'; }
            else { h = Math.round(fp.floors * HEIGHT_JOIN.osmLevelsM * 2) / 2; hSrc = 'osm-levels'; }
          } else if (doorPts) {
            // Tier 3: pool the plate points of the face(s) this
            // lot stands in; the pooled median floor speaks.
            const pool = new Set();
            if (row === 0) for (const di of faceDoorIdx.vLow) pool.add(di);
            if (row === rows - 1) for (const di of faceDoorIdx.vHigh) pool.add(di);
            if (col === 0) for (const di of faceDoorIdx.uLow) pool.add(di);
            if (col === cols - 1) for (const di of faceDoorIdx.uHigh) pool.add(di);
            if (pool.size >= HEIGHT_JOIN.faceDoorMinDoors) {
              const med = medianOf([...pool].map((di) => doorPts[di * 3 + 2]));
              h = Math.round(med * HEIGHT_JOIN.doorM * 2) / 2;
              hSrc = 'door';
            }
          }
        }
        // Issue #139 (pierce half of the track test): a lot under
        // the guideway stays only when its top keeps the clearance
        // below the lowest underside it crosses.
        if (track.under < Infinity && h > track.under - TRACK_CLEARANCE_M) { stats.lotsDroppedTrackPierce++; continue; }
        const base = PALETTE[Math.floor(hash01(seed ^ 0x9f2c) * PALETTE.length) % PALETTE.length];
        const shade = 0.92 + hash01(seed ^ 0x64d1) * 0.16;
        const color = base.map((c) => Math.max(0, Math.min(255, Math.round(c * shade * 255))));
        const lot = { x: Math.round(cx * 10) / 10, z: Math.round(cz * 10) / 10, w: Math.round(w * 10) / 10, d: Math.round(d * 10) / 10, h, color, hSrc };
        if (theta) { lot.rot = Math.round(theta * 10000) / 10000; stats.lotsRotated++; }
        if (packU || packV) stats.lotsPackedFrontage++;
        if (tallFrontage) stats.lotsTallFrontage++;
        lots.push(lot);
        lotProcH.push(procH);
      }
    }
  }

  // Issue #128 tier 4: the neighbourhood field. A lot with no real
  // signal of its own blends its procedural draw 50/50 with the
  // median of the REAL lot heights within fieldRadiusM (the #128
  // proposal: the field reaches most of the uncovered lots, and the
  // blend keeps the core/frontage/lane bands shaping them). Beyond
  // the field's reach the pure band draw stands. Field lots are
  // labelled 'field' — estimated, never real.
  if (heightLayer) {
    const CELL = HEIGHT_JOIN.fieldRadiusM;
    const fieldGrid = new Map();
    for (let i = 0; i < lots.length; i++) {
      if (lots[i].hSrc === 'proc') continue;
      const k = fpKey(Math.floor(lots[i].x / CELL), Math.floor(lots[i].z / CELL));
      if (!fieldGrid.has(k)) fieldGrid.set(k, []);
      fieldGrid.get(k).push(i);
    }
    if (fieldGrid.size) {
      for (let i = 0; i < lots.length; i++) {
        if (lots[i].hSrc !== 'proc') continue;
        const { x, z } = lots[i];
        const gx = Math.floor(x / CELL), gz = Math.floor(z / CELL);
        const near = [];
        for (let ax = gx - 1; ax <= gx + 1; ax++) for (let az = gz - 1; az <= gz + 1; az++) {
          for (const j of fieldGrid.get(fpKey(ax, az)) || []) {
            if (Math.hypot(lots[j].x - x, lots[j].z - z) <= CELL) near.push(lots[j].h);
          }
        }
        if (near.length >= HEIGHT_JOIN.fieldMinLots) {
          lots[i].h = Math.round(((lotProcH[i] + medianOf(near)) / 2) * 2) / 2;
          lots[i].hSrc = 'field';
        }
      }
    }
  }
  for (const lot of lots) {
    if (lot.hSrc === 'permit') stats.heightsPermit++;
    else if (lot.hSrc === 'osm-height') stats.heightsOsmHeight++;
    else if (lot.hSrc === 'osm-levels') stats.heightsOsmLevels++;
    else if (lot.hSrc === 'door') stats.heightsDoor++;
    else if (lot.hSrc === 'field') stats.heightsField++;
    else stats.heightsProc++;
  }

  // Taipei 101 massing (see header): podium + 8 identical flared
  // trapezoid tiers + a narrower top section + spire at the true
  // 508 m overall height, centred on the northern part of the
  // landmark site so the spawn points stay clear. The eight tiers are
  // identical modules, like the real tower's stacked sections: each
  // steps in at its base (the bamboo joint) and flares back out to
  // the same lip, so the shaft holds a constant width instead of
  // tapering as it rises.
  let tower = null;
  if (t101) {
    const tx = t101.x - 10, tz = t101.z - 45;
    // The podium field is now the tower-zone base block the shaft
    // stands on; the mall massing around it lives in podiumParts
    // (issue #40, see header). Every part stays inside the landmark
    // site and clear of every roadbed (audited in the tests).
    const podium = { w: 62, d: 62, h: 9 };
    const podiumParts = [
      // West mall block: tile x −110..−67, z −170..−51. (The OSM
      // outline reaches x ≈ −115, but a 5 m service lane's ribbon
      // ends at x ≈ −111.5 along z ≈ −112 — the block stops at −110
      // to keep the no-roadbed-overlap rule.)
      { type: 'box', w: 43, d: 119, h: 30, dx: -24.1, dz: 32.7 },
      // East mall block: tile x −35..7, z −170..−51 (the OSM
      // outline's east edge). The 32 m slot between the blocks is
      // the open entrance court on the tower axis (the
      // landmark/spawn point stands in it).
      { type: 'box', w: 42, d: 119, h: 30, dx: 50.4, dz: 32.7 },
      // The curved roof: a half-frustum shell, flat side against the
      // tower's south face, opening south over the court (52 m arc,
      // sized to the bright shell core on satellite and kept west
      // clear of the same service lane). Its top (30 + 8 = 38 m)
      // lands at the published podium main-roof height
      // (124 ft ≈ 37.8 m) the 30 m blocks stay under.
      { type: 'shell', rB: 26, rT: 17, h: 8, y0: 30, dx: -19.6, dz: 25.2 },
    ];
    // Vertical budget: 9 (podium) + 8 × 52 (tiers) + 41 (top section)
    // + 42 (spire) = 508.
    const tierH = 52, tiers = [];
    for (let i = 0; i < 8; i++) {
      tiers.push({
        y0: podium.h + tierH * i,
        h: tierH,
        hwBottom: 22.4, // step in at each bamboo joint
        hwTop: 25.0,    // flare out to the tier's lip
      });
    }
    const top = { y0: podium.h + tierH * 8, h: 41, hwBottom: 14.0, hwTop: 13.0 };
    // Ornaments at the eight tier joints (issue #40): corner discs at
    // every joint (the ruyi positions), face plaques at joints 2–8,
    // and the four big coin discs at joint 1 only — where the real
    // pedestal meets the tower. Offsets sit a hair inside the tier
    // surface at that height (half-width ≈ 24.8 just below the lip)
    // so the pieces read attached, not floating.
    const ornaments = [];
    const r4 = (n) => Math.round(n * 10000) / 10000;
    for (let j = 0; j < 8; j++) {
      const jointY = podium.h + tierH * (j + 1);
      for (const sx of [1, -1]) for (const sz of [1, -1]) {
        ornaments.push({
          kind: 'disc', jointY, x: tx + sx * 25.0, y: jointY - 4.2, z: tz + sz * 25.0,
          rotY: r4(Math.atan2(sx, sz)), r: 3.4, t: 0.8,
        });
      }
      for (const [nx, nz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        if (j === 0) {
          ornaments.push({
            kind: 'coin', jointY, x: tx + nx * 25.15, y: jointY - 5.7, z: tz + nz * 25.15,
            rotY: r4(Math.atan2(nx, nz)), r: 5.2, t: 0.9,
          });
        } else {
          ornaments.push({
            kind: 'plaque', jointY, x: tx + nx * 25.1, y: jointY - 4.2, z: tz + nz * 25.1,
            rotY: r4(Math.atan2(nx, nz)), w: 6.4, h: 6.4, t: 0.7,
          });
        }
      }
    }
    tower = { x: tx, z: tz, podium, podiumParts, ornaments, tiers, top, spire: { y0: top.y0 + top.h, h: 508 - (top.y0 + top.h), w: 2.4 }, totalHeight: 508 };
  }
  return { lots, tower, landmarkTowers, stats };
}

// Issue #136: the office cores — the districts where curtain glass
// is the REAL fabric, so facadeMatFor's glass rules keep applying
// there. Two zones, both simple map facts: the Xinyi planning
// district as its real rectangle (Keelung Rd to Songren Rd, Zhongxiao
// E. Rd to Zhuangjing Rd — a 650 m ring around Taipei 101 was tried
// first and bulged south across Zhuangjing Rd into the Wuxing St
// housing apron, which is exactly the Xiangshan-frame monoculture
// the reality audit flagged), and the station-front band, 700 m
// around Taipei Main Station (Shin Kong, Asiaworld, the 館前/忠孝西路
// office stock). Exported so the taipei suite can pin the boundary.
const [STATION_FRONT_X, STATION_FRONT_Z] = latLonToTile(25.0478, 121.5170, [25.0330, 121.5650]);
export function officeCoreFor(lot) {
  if (lot.x >= -450 && lot.x <= 1000 && lot.z >= -1000 && lot.z <= 170) return true; // Xinyi planning district
  return Math.hypot(lot.x - STATION_FRONT_X, lot.z - STATION_FRONT_Z) < 700; // station front
}

// Facade material for a planned lot, as an index into upstream
// buildings.js's facade families (0-2 masonry pre-war/brick/brownstone,
// 3-5 curtain-wall glass, 6-9 the Taiwan types — issue #17).
// Deterministic from the lot's position, like everything else in the
// plan: the Xinyi-core towers go glass, boulevard mid-rises mix glass
// and masonry, residential interiors stay masonry. The four Taiwan types
// (6 tile shophouse, 7 arcade shophouse, 8 walk-up slab, 9 pebble-dash
// mid-rise) take a large share of the lots the pre-#17 rules put on
// MASONRY in the 15–40 m band where Taipei's classic mixed-use blocks
// live — 72% of the masonry pool at 15–22 m, 75% at 22–40 m — split
// between the types by height-plausibility weights (see taiwanTypeFor).
// The glass rolls in both bands are evaluated first with the exact
// pre-#17 formulas, so the glass families' counts are untouched; above
// 40 m and below 15 m nothing changes at all.
//
// Issue #136 re-draws the two tall bands around the office cores (see
// officeCoreFor): the #128 real-height join put true heights on the
// plan, and facadeMatFor's height rules then made every tall lot glass
// (7,988 of 34,645 lots) — dark glass canyons where real Taipei's tall
// RESIDENTIAL stock is tile/concrete in red/pink/white/beige. Inside
// the cores the rules below are the pre-#136 ones verbatim (Xinyi
// stays a glass district); outside them, lots of 40 m or more wear
// the Taiwan tile types (tallTaiwanTypeFor) with only a small glass
// accent, and the 22–40 m glass share drops from a half to a fifth.
function facadeMatFor(lot) {
  const seed = (Math.imul(Math.round(lot.x * 10), 73856093) ^ Math.imul(Math.round(lot.z * 10), 19349663) ^ 0x101) | 0;
  const r = hash01(seed);
  const core = officeCoreFor(lot);
  if (lot.h >= 40) {
    if (core) return [3, 4, 5][Math.floor(r * 3) % 3];
    if (r < 0.12) { const u = r / 0.12; return [3, 4, 5][Math.floor(u * 3) % 3]; } // glass accent: the curtain-wall 豪宅 minority
    return tallTaiwanTypeFor(lot, seed);
  }
  if (lot.h >= 22) {
    if (core) {
      if (r < 0.5) return [3, 4, 5][Math.floor(r * 6) % 3]; // glass half, unchanged
      const u = (r - 0.5) * 2; // masonry half, rescaled to 0..1
      if (u < 0.75) return taiwanTypeFor(lot, seed);
      const v = (u - 0.75) * 4;
      return [0, 1][Math.floor(v * 2) % 2];
    }
    if (r < 0.2) { const u = r / 0.2; return [3, 4, 5][Math.floor(u * 6) % 3]; } // glass fifth: district offices/hotels
    const u = (r - 0.2) / 0.8; // remainder, rescaled to 0..1
    if (u < 0.75) return taiwanTypeFor(lot, seed);
    const v = (u - 0.75) * 4;
    return [0, 1][Math.floor(v * 2) % 2];
  }
  if (lot.h >= 15) {
    if (r < 0.1) return 3; // glass accent, unchanged
    const u = (r - 0.1) / 0.9; // masonry pool, rescaled to 0..1
    if (u < 0.72) return taiwanTypeFor(lot, seed);
    const v = (u - 0.72) / 0.28;
    return [0, 1, 2][Math.floor(v * 3) % 3];
  }
  if (lot.h >= 12) return r < 0.1 ? 3 : [0, 1, 2][Math.floor(r * 3) % 3];
  return [0, 1, 2][Math.floor(r * 3) % 3];
}

// The tall-residential pick (issue #136): a lot of 40 m or more
// outside the office cores wears a Taiwan tile type — Taipei's real
// residential towers are tile/concrete slabs, not curtain glass. The
// walk-up slab (8) carries the largest share (its dense tile grid,
// balconies and grilles ARE the 電梯大樓 read), the tile shophouse (6)
// and pebble-dash (9) split the rest. The arcade type (7) is not in
// this pick: its colonnade is a street-wall ground floor, not a tower
// language, so it keeps its under-36 m cap in taiwanTypeFor.
function tallTaiwanTypeFor(lot, seed) {
  const weights = [[8, 3.4], [6, 2.2], [9, 2.2]];
  const total = weights.reduce((s, [, w]) => s + w, 0);
  let pick = hash01(seed ^ 0x1360) * total;
  for (const [mat, w] of weights) {
    if (pick < w) return mat;
    pick -= w;
  }
  return 8;
}

// Which Taiwan type a Taiwan-set lot becomes, by height plausibility —
// a second hash of the same seed picks within the weights, and a type's
// weight is zero outside its band, which is what caps each type:
//   6 tile shophouse  15–40 m, weight 3 throughout
//   7 arcade shophouse 15–36 m, weight 3 (issue #55 raised the cap from
//     28: the 騎樓 colonnade is a ground-floor treatment, and arcade-
//     fronted blocks of 9–10 storeys stand all over Taipei — the type
//     thins out above that, it does not stop at 8 storeys)
//   8 walk-up slab     15–36 m, weight 3 (raised from 30, issue #55: the
//     family's dense beige-tile vocabulary runs on the taller 80s slabs
//     too; the pure stairs-only walk-ups are its low end)
//   9 pebble-dash      15–40 m, weight 2.2 (洗石子 runs from 5-storey
//     walk-ups to mid-rises, but is the least common of the four)
// All caps stay under 40 m on purpose: this pick serves the classic
// mixed-use bands only. Above 40 m facadeMatFor's own rules decide —
// glass inside the office cores, tallTaiwanTypeFor outside them
// (issue #136) — and neither path consults these weights, so the
// counts this function produces in its bands are exactly what they
// were (see the taiwan test).
function taiwanTypeFor(lot, seed) {
  const h = lot.h;
  const weights = [
    [6, h >= 15 && h < 40 ? 3 : 0],
    [7, h >= 15 && h < 36 ? 3 : 0],
    [8, h >= 15 && h < 36 ? 3 : 0],
    [9, h >= 15 && h < 40 ? 2.2 : 0],
  ];
  const total = weights.reduce((s, [, w]) => s + w, 0);
  let pick = hash01(seed ^ 0x9e3779b9) * total;
  for (const [mat, w] of weights) {
    if (pick < w) return mat;
    pick -= w;
  }
  return 6;
}

// Rooftop-gear clamp (issue #17): upstream's commit() sizes bulkhead/HVAC
// units from a Manhattan range (up to ~65% of the roof's width across on
// big boxes, tall on small ones) and can drop a cedar water tower on any
// non-mech roof. On narrow Taipei lots that produced rooftop boxes wider
// than the building and HVAC fan wells stretched into ellipses (the unit
// boxes are scaled non-uniformly per roof, so an over-wide unit means an
// elliptical fan). Taipei policy, applied by js/buildings.js's lot mode
// right after each commit: no cedar water towers (wrong vocabulary for
// Taipei — issue #56: a sparse share of roofs gets a stainless tank
// and/or a 鐵皮屋 addition instead, see taipeiRooftopAdditions), and
// every unit must fit INSIDE the lot rect with margin —
// shrunk toward square (aspect ≤ 1.3, so fan wells stay near-circular),
// capped at 4.2 m across and 3.0 m tall, and dropped when the roof is too
// small to hold a unit honestly (smaller dimension < 3.6 m, or the shrunk
// unit would fall under 1.8 m). Pure data — unit-tested.
export function clampTaipeiRooftopGear(gear, lot) {
  const roofW = lot.x1 - lot.x0;
  const roofD = lot.z1 - lot.z0;
  const roofMin = Math.min(roofW, roofD);
  const units = [];
  if (roofMin >= 3.6) {
    for (const u of gear.hvacUnits || []) {
      let w = Math.min(u.w, roofW - 1.0, 4.2);
      let d = Math.min(u.d, roofD - 1.0, 4.2);
      if (w < 1.8 || d < 1.8) continue;
      if (w > d * 1.3) w = d * 1.3;
      if (d > w * 1.3) d = w * 1.3;
      const xLo = lot.x0 + w / 2 + 0.25, xHi = lot.x1 - w / 2 - 0.25;
      const zLo = lot.z0 + d / 2 + 0.25, zHi = lot.z1 - d / 2 - 0.25;
      if (xHi < xLo || zHi < zLo) continue;
      units.push({
        ...u,
        w, d,
        h: Math.min(u.h, 3.0),
        x: Math.min(Math.max(u.x, xLo), xHi),
        z: Math.min(Math.max(u.z, zLo), zHi),
      });
    }
  }
  const adds = taipeiRooftopAdditions(gear, lot, units);
  // Issue #100: a full-roof 鐵皮屋 is built over the roof plane — the
  // roof's clamped HVAC units are displaced, not dodged: they stood
  // where the addition now stands.
  return { waterTowers: adds.tanks, hvacUnits: adds.huts.length ? [] : units, rooftopAdds: adds.huts };
}

// --- Issue #56 rooftop furniture: stainless tanks & 鐵皮屋 additions ---
// Taipei's roofs (see the user's rooftop photo): most carry a squat
// stainless-steel water tank (不鏽鋼水塔, a ~2 m cylinder), and a
// minority of the low/mid walk-ups carry a 鐵皮屋 — an informal sheet-
// metal room with a single-pitch sheet roof, weathered red or green
// (occasionally grey-blue or rust-brown). Both are SPARSE on purpose
// ("not all of them otherwise it look weird"): a 14% tank roll and a
// 12% hut roll over the eligible lots, deterministic by lot hash, off
// for glass towers (families 3–5) and off for lots whose plan carries
// no mat/h (defensive — the synthetic lots in the unit tests).
// Placement: the tank picks from a 3×3 grid of candidate spots,
// hash-rotated — first spot that fits inside the roof clear of the
// clamped HVAC units wins. The hut is different (issue #100): it spans
// the host's ENTIRE roof, so it neither picks a spot nor dodges the
// furniture — it displaces it (the clamp drops the roof's HVAC units,
// and the tank roll is skipped on hut lots; see below).
export const TAIPEI_TANK_RATE = 0.14;
export const TAIPEI_HUT_RATE = 0.12;
export const TAIPEI_HUT_COLORS = [0x9e3d34, 0x4a6b52, 0x7d8894, 0x8a4a3a]; // weathered red, green, grey-blue, rust
const TANK_RADIUS = 1.0;
// Issue #100: cap the hut sheet's centre-to-edge rise (half its total
// drop) — over a wide host the raw hash pitch would stand the sheet's
// high edge ~5 m above its centre.
const HUT_MAX_RISE = 2.2;

function lotPolicySeed(lot, salt) {
  return (Math.imul(Math.round(lot.x0 * 10), 73856093)
    ^ Math.imul(Math.round(lot.z0 * 10), 19349663)
    ^ Math.imul(Math.round(lot.x1 * 10), 83492791)
    ^ salt) >>> 0;
}

function roofSpotOrder(lot, seed) {
  const w = lot.x1 - lot.x0, d = lot.z1 - lot.z0;
  const spots = [];
  for (const fx of [0.22, 0.5, 0.78]) for (const fz of [0.22, 0.5, 0.78]) {
    spots.push({ x: lot.x0 + fx * w, z: lot.z0 + fz * d });
  }
  const rot = Math.floor(hash01(seed ^ 0x5eed) * spots.length) % spots.length;
  return spots.slice(rot).concat(spots.slice(0, rot));
}

function gearRectsOverlap(a, b, pad) {
  return a.x0 - pad < b.x1 && a.x1 + pad > b.x0 && a.z0 - pad < b.z1 && a.z1 + pad > b.z0;
}

export function taipeiRooftopAdditions(gear, lot, units) {
  const none = { tanks: [], huts: [] };
  if (!lot || typeof lot.mat !== 'number' || typeof lot.h !== 'number') return none;
  if (lot.mat >= 3 && lot.mat <= 5) return none; // glass towers: no furniture
  const roofY = typeof gear.maxH === 'number' ? gear.maxH : lot.h;
  const w = lot.x1 - lot.x0, d = lot.z1 - lot.z0;
  const seed = lotPolicySeed(lot, 0x7a11);
  const occupied = (units || []).map((u) => ({
    x0: u.x - u.w / 2, x1: u.x + u.w / 2, z0: u.z - u.d / 2, z1: u.z + u.d / 2,
  }));
  const spots = roofSpotOrder(lot, seed);
  const fits = (r, pad) => r.x0 >= lot.x0 + 0.4 && r.x1 <= lot.x1 - 0.4
    && r.z0 >= lot.z0 + 0.4 && r.z1 <= lot.z1 - 0.4
    && !occupied.some((o) => gearRectsOverlap(r, o, pad));
  const huts = [];
  // 鐵皮屋： low/mid lots only (9–27 m — the walk-up and small-slab roofs
  // in the photo), roofs at least 8 m in both dimensions.
  // Issue #100: the addition spans the host's ENTIRE roof — the classic
  // full-roof 鐵皮屋 — centred on the roof and inset 0.4 m (the margin
  // `fits` uses for roof furniture), so it never overhangs the walls.
  // Same eligibility and the same 12% roll as the #56 patch hut, so the
  // SAME lots are selected; only the geometry grows. The sheet keeps
  // its hash pitch, capped so its centre-to-edge rise (half the total
  // drop) stays under HUT_MAX_RISE.
  if (lot.h >= 9 && lot.h <= 27 && Math.min(w, d) >= 8 && hash01(seed ^ 0x1117) < TAIPEI_HUT_RATE) {
    const hw = w - 0.8, hd = d - 0.8;
    const axis = hash01(seed ^ 0x4447) < 0.5 ? 'z' : 'x';
    const along = axis === 'z' ? hd : hw;
    const pitch = Math.min(
      0.16 + hash01(seed ^ 0x3337) * 0.08,
      Math.atan((2 * HUT_MAX_RISE) / along));
    huts.push({
      x: lot.x0 + w / 2, y: roofY, z: lot.z0 + d / 2, w: hw, d: hd,
      h: 2.5 + hash01(seed ^ 0x2227) * 0.6,
      pitch,
      axis,
      dir: hash01(seed ^ 0x5557) < 0.5 ? -1 : 1,
      colorIdx: Math.floor(hash01(seed ^ 0x6667) * TAIPEI_HUT_COLORS.length) % TAIPEI_HUT_COLORS.length,
    });
  }
  const tanks = [];
  // Stainless tanks: nearly any non-glass roof of 8–34 m with 5.5 m of
  // room — in the photo they sit on walk-ups and mid slabs alike.
  // Skipped on hut lots (issue #100): every spot is under the addition.
  if (huts.length === 0 && lot.h >= 8 && lot.h <= 34 && Math.min(w, d) >= 5.5 && hash01(seed ^ 0x7777) < TAIPEI_TANK_RATE) {
    for (const s of spots) {
      const r = { x0: s.x - TANK_RADIUS, x1: s.x + TANK_RADIUS, z0: s.z - TANK_RADIUS, z1: s.z + TANK_RADIUS };
      if (!fits(r, 0.35)) continue;
      tanks.push({ x: s.x, y: roofY, z: s.z });
      occupied.push(r);
      break;
    }
  }
  return { tanks, huts };
}

// --- Issue #55: the F7 騎樓 (arcade) as real geometry -------------------
// Until now F7's "arcade" was a gradient painted on flat shopfront
// glass. taipeiArcadeParts computes the actual massing for an arcade
// lot — pure data, consumed by js/buildings.js's populatePlannedLot:
//   - core:    the ground storey, inset ARCADE_DEPTH on every side, so
//              the ground floor is genuinely recessed （內縮） and the
//              walkway passes under the upper floors, exactly the
//              cross-section in the 營建署 manual the user supplied;
//   - columns: 0.55 m square columns standing at the lot's front edge,
//              holding the upper block — one at each corner plus one at
//              every bay boundary of the F7 facade's own bay grid
//              (cornerPier 0.85 m, bayWidth 2.7 m — the same numbers the
//              F7 material paints with), so the painted piers above and
//              the real columns below land on the same rhythm.
// Orientation: the planner's lots do NOT know a street side — a lot is
// a free-standing cell in a block interior, every side faces a street
// or lane across the 1.2–3 m gap to its neighbours, and every Taiwan
// family already paints its full front treatment (shopfronts, signage
// band, address plate) on all four sides for the same reason. The
// arcade therefore runs the full perimeter: the full length of every
// frontage, which is also how the real corner shophouses read.
// Lots under 11 m in either dimension get no arcade (the inset core
// would drop under ~3.8 m); they keep the flat F7 facade.
export const TAIPEI_ARCADE_DEPTH = 3.6; // = ARCADE_BAND_W in taipei-streetscape.js
const ARCADE_COLUMN = 0.55;
const ARCADE_BAY_W = 2.7;    // mirrors facades[7].windowWidth in js/buildings.js
const ARCADE_PIER = 0.85;    // mirrors facades[7].cornerPier in js/buildings.js

export function taipeiArcadeParts(lot) {
  const w = lot.x1 - lot.x0, d = lot.z1 - lot.z0;
  if (!(w >= 11 && d >= 11)) return null;
  const D = TAIPEI_ARCADE_DEPTH, C = ARCADE_COLUMN;
  const core = { x0: lot.x0 + D, x1: lot.x1 - D, z0: lot.z0 + D, z1: lot.z1 - D };
  // Bay-boundary offsets along a side of the given length, measured
  // from the side's start corner (the facade bay grid is symmetric, so
  // the same offsets serve both directions of a side).
  const bayOffsets = (len) => {
    const pier = Math.min(ARCADE_PIER, len * 0.2);
    const inner = len - pier * 2;
    const bays = Math.max(1, Math.floor(inner / ARCADE_BAY_W + 0.5));
    const bayW = inner / bays;
    const out = [];
    for (let k = 1; k < bays; k++) out.push(pier + k * bayW);
    return out;
  };
  const columns = [];
  const push = (x0, z0) => columns.push({ x0, x1: x0 + C, z0, z1: z0 + C });
  // Corner columns, centred inside the corner so both outer faces are
  // flush with the lot edges.
  push(lot.x0, lot.z0); push(lot.x1 - C, lot.z0); push(lot.x0, lot.z1 - C); push(lot.x1 - C, lot.z1 - C);
  // Bay-boundary columns along each side, flush with that side's edge.
  for (const off of bayOffsets(w)) {
    push(lot.x0 + off - C / 2, lot.z0);
    push(lot.x0 + off - C / 2, lot.z1 - C);
  }
  for (const off of bayOffsets(d)) {
    push(lot.x0, lot.z0 + off - C / 2);
    push(lot.x1 - C, lot.z0 + off - C / 2);
  }
  return { depth: D, core, columns };
}

// --- Issue #56: vertical signs （直式招牌） ------------------------------
// The street photo's defining layer: thin sign panels mounted
// PERPENDICULAR to the facade, stacked with glyph characters, in reds,
// yellows, greens, blues and white. Policy here returns the panels for
// one lot (pure data); js/buildings.js instances them as real boxes
// with the abstract-glyph sign material, whose panel colours are
// hashed in-shader from the same photo palette (coloured panel +
// glyph marks, no rendered text — the same stylization as the facade
// signage bands). Taiwan types only (families 6–9): ~55% of them
// carry signs, one panel usually, two on a hash share, each on its
// own side; a panel starts above the ground floor (y0 ≈ 4.1–4.6 m)
// and never crosses the roof.
const SIGN_RATE = 0.55;

export function taipeiVerticalSigns(lot) {
  if (!lot || lot.mat < 6 || lot.mat > 9 || lot.h < 10) return [];
  const seed = lotPolicySeed(lot, 0x5167);
  if (hash01(seed) >= SIGN_RATE) return [];
  const two = hash01(seed ^ 0x11) >= 0.62;
  const sides = ['n', 's', 'e', 'w'];
  const signs = [];
  const used = new Set();
  for (let i = 0; i < (two ? 2 : 1); i++) {
    let sideIdx = Math.floor(hash01(seed ^ (0x21 + i * 7)) * 4) % 4;
    if (used.has(sides[sideIdx])) sideIdx = (sideIdx + 1) % 4;
    used.add(sides[sideIdx]);
    const signH = Math.min(3.6 + hash01(seed ^ (0x41 + i * 17)) * 3.6, lot.h - 5.2);
    if (signH < 3.2) continue;
    signs.push({
      side: sides[sideIdx],
      along: 0.22 + hash01(seed ^ (0x31 + i * 13)) * 0.56,
      y0: 4.1 + hash01(seed ^ (0x51 + i * 19)) * 0.5,
      h: signH,
      out: 0.95 + hash01(seed ^ (0x61 + i * 23)) * 0.45,
      thick: 0.18,
      seed: (seed ^ Math.imul(i + 1, 7919)) >>> 0,
    });
  }
  return signs;
}

// Adapt a plan into the options upstream's buildCityBlocks (js/
// buildings.js) understands: one pre-planned lot per building, the
// tile frame as the streaming bounds, the tile origin as the first
// stream centre, and no colliders (Taipei buildings stay visual-only,
// as in the first buildings increment — the controllers pass the flat
// tile at y=0). Pure data, like the planner.
export function taipeiCityBlocksOptions(geodata, plan = planTaipeiBuildings(geodata)) {
  return {
    lots: plan.lots.map((lot) => {
      const r = {
        x0: lot.x - lot.w / 2,
        x1: lot.x + lot.w / 2,
        z0: lot.z - lot.d / 2,
        z1: lot.z + lot.d / 2,
        h: lot.h,
        mat: facadeMatFor(lot),
      };
      // Issue #62: a turned lot carries its frontage angle — the
      // rect stays the lot's LOCAL frame and buildCityBlocks massed
      // it in that frame, turned into place about the lot centre
      // (the frontage-frame path). Arcade parts and sign policy
      // below are computed from the same local rect, so they turn
      // with the building.
      if (lot.rot) r.rotY = lot.rot;
      // Issue #55: F7 arcade lots carry their recessed-ground-floor
      // massing (null on lots too small for the inset core).
      if (r.mat === 7) r.arcade = taipeiArcadeParts(r);
      // Issue #56: vertical signs on a hashed subset of Taiwan-type lots.
      const signs = taipeiVerticalSigns(r);
      if (signs.length) r.signs = signs;
      return r;
    }),
    bounds: { ...geodata.frame.bbox },
    initial: [0, 0],
    colliders: false,
    // Issue #17: Taipei's rooftop-gear policy (no water towers; HVAC units
    // clamped to the roof) — buildCityBlocks' lot mode applies it to the
    // committed gear of every lot when present.
    rooftopGearClamp: clampTaipeiRooftopGear,
    // Issue #56: the gear pool's water-tower slots render as stainless
    // tanks (the clamp's sparse tanks) instead of cedar towers.
    silverTanks: true,
  };
}

// The Taipei 101 massing as plain meshes (podium + eight identical
// flared tiers + narrower top section + spire, dark glass-green).
// `THREE` is passed in (the boot module owns
// the three import) so the planner above stays three-free and
// unit-testable in plain node. Returns null when the geodata has no
// Taipei 101 landmark.
// Issue #40: the 101 ornaments as ONE merged triangle soup (pure
// data — no THREE — so the tests can count and place every piece).
// Each ornament is built in a local frame (face normal = +z, centre
// at the origin) and rotated/translated into place: discs and coins
// are polygonal prisms (14 / 18 sides), plaques are thin boxes.
// 64 ornaments × ~38 triangles ≈ 2.4 k triangles, one draw call.
export function taipei101OrnamentPositions(ornaments) {
  const localFor = (o) => {
    const list = [];
    if (o.kind === 'plaque') {
      const x = o.w / 2, y = o.h / 2, z = o.t / 2;
      const c = (sx, sy, sz) => [sx * x, sy * y, sz * z];
      pushQuad(list, c(-1, -1, 1), c(1, -1, 1), c(1, 1, 1), c(-1, 1, 1));   // front
      pushQuad(list, c(1, -1, -1), c(-1, -1, -1), c(-1, 1, -1), c(1, 1, -1)); // back
      pushQuad(list, c(1, -1, 1), c(1, -1, -1), c(1, 1, -1), c(1, 1, 1));   // east
      pushQuad(list, c(-1, -1, -1), c(-1, -1, 1), c(-1, 1, 1), c(-1, 1, -1)); // west
      pushQuad(list, c(-1, 1, 1), c(1, 1, 1), c(1, 1, -1), c(-1, 1, -1));   // top
      pushQuad(list, c(-1, -1, -1), c(1, -1, -1), c(1, -1, 1), c(-1, -1, 1)); // bottom
      return list;
    }
    const seg = o.kind === 'coin' ? 18 : 14;
    const hz = o.t / 2;
    const rim = [];
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      rim.push([o.r * Math.cos(a), o.r * Math.sin(a)]);
    }
    for (let k = 0; k < seg; k++) {
      const [x0, y0] = rim[k], [x1, y1] = rim[(k + 1) % seg];
      list.push(0, 0, hz, x0, y0, hz, x1, y1, hz);        // front cap fan
      list.push(0, 0, -hz, x1, y1, -hz, x0, y0, -hz);     // back cap fan
      pushQuad(list, [x0, y0, hz], [x1, y1, hz], [x1, y1, -hz], [x0, y0, -hz]); // side
    }
    return list;
  };
  const cache = new Map();
  const positions = [];
  for (const o of ornaments || []) {
    const key = `${o.kind}:${o.r || 0}:${o.w || 0}:${o.t}`;
    if (!cache.has(key)) cache.set(key, localFor(o));
    const local = cache.get(key);
    const c = Math.cos(o.rotY), s = Math.sin(o.rotY);
    for (let i = 0; i < local.length; i += 3) {
      const x = local[i], y = local[i + 1], z = local[i + 2];
      positions.push(o.x + x * c + z * s, o.y + y, o.z - x * s + z * c);
    }
  }
  return positions;
}

export function createTaipei101(THREE, plan, factories) {
  if (!plan.tower) return null;
  const t = plan.tower;
  const towerGroup = new THREE.Group();
  towerGroup.name = 'Taipei101';
  // Issue #57: the shaft's flat glass colour becomes a real curtain
  // wall — dark green-teal glazing at the tower's floor rhythm —
  // and the mall blocks a green-grey punched-stone facade, when the
  // boot module injects the TSL factories (this file stays
  // import-free for the node suite; without factories the original
  // flat tones render, as before). The spire keeps the flat tone:
  // a window grid would be noise at its radius. Massing, the
  // ornaments and the curved shell are untouched.
  const glassMat = factories
    ? factories.createCurtainWallMaterial({ glassTint: 0x14342a, frameTint: 0x3d5c50, windowWidth: 2.6, floorHeight: 3.9, litProbability: 0.32, warmth: 0.55, reflectivity: 0.9, seed: 57.101, boxLocal: false })
    : new THREE.MeshStandardNodeMaterial({ color: 0x2e4f45, roughness: 0.35, metalness: 0.15 });
  const mallMat = factories
    ? factories.createPreWarBuildingMaterial({ stoneColor: 0x77877c, trimColor: 0x5d6f63, windowGlassColor: 0x1d2b26, windowWidth: 3.4, floorHeight: 3.75, litProbability: 0.3, warmth: 0.7, seed: 57.102, boxLocal: false })
    : new THREE.MeshStandardNodeMaterial({ color: 0x51655a, roughness: 0.8, metalness: 0.05 });
  const spireMat = new THREE.MeshStandardNodeMaterial({ color: 0x2e4f45, roughness: 0.35, metalness: 0.15 });
  const podium = new THREE.Mesh(new THREE.BoxGeometry(t.podium.w, t.podium.h, t.podium.d), factories ? mallMat : glassMat);
  podium.position.set(t.x, t.podium.h / 2, t.z);
  podium.castShadow = true;
  podium.receiveShadow = true;
  towerGroup.add(podium);
  // Issue #40: the mall podium — muted green-grey stone blocks (a
  // step lighter than the tower glass) and the pale curved-roof
  // shell, a half-frustum whose flat side meets the tower's south
  // face and whose arc opens south over the entrance court
  // (cylinder theta from −90° to +90° puts the arc at z ≥ 0 = south
  // in the tile frame; DoubleSide because the theta seam is open and
  // the underside shows over the court).
  const shellMat = new THREE.MeshStandardNodeMaterial({ color: 0xb9beb2, roughness: 0.6, metalness: 0.05, side: THREE.DoubleSide });
  for (const part of t.podiumParts || []) {
    if (part.type === 'box') {
      const m = new THREE.Mesh(new THREE.BoxGeometry(part.w, part.h, part.d), mallMat);
      m.name = 'Taipei101MallBlock';
      m.position.set(t.x + (part.dx || 0), part.h / 2, t.z + (part.dz || 0));
      m.castShadow = true;
      m.receiveShadow = true;
      towerGroup.add(m);
    } else if (part.type === 'shell') {
      const geo = new THREE.CylinderGeometry(part.rT, part.rB, part.h, 28, 1, false, -Math.PI / 2, Math.PI);
      const m = new THREE.Mesh(geo, shellMat);
      m.name = 'Taipei101MallRoof';
      m.position.set(t.x + (part.dx || 0), part.y0 + part.h / 2, t.z + (part.dz || 0));
      m.castShadow = true;
      towerGroup.add(m);
    }
  }
  for (const tier of t.tiers) {
    // A 4-sided cone frustum rotated 45° = a tapered square tier;
    // radius is the half-diagonal of the square section.
    const geo = new THREE.CylinderGeometry(tier.hwTop * Math.SQRT2, tier.hwBottom * Math.SQRT2, tier.h, 4, 1);
    const m = new THREE.Mesh(geo, glassMat);
    m.rotation.y = Math.PI / 4;
    m.position.set(t.x, tier.y0 + tier.h / 2, t.z);
    m.castShadow = true;
    m.receiveShadow = true;
    towerGroup.add(m);
  }
  if (t.top) {
    // The narrower top section under the spire, as one more tapered
    // square frustum (same construction as the tiers).
    const topGeo = new THREE.CylinderGeometry(t.top.hwTop * Math.SQRT2, t.top.hwBottom * Math.SQRT2, t.top.h, 4, 1);
    const topMesh = new THREE.Mesh(topGeo, glassMat);
    topMesh.rotation.y = Math.PI / 4;
    topMesh.position.set(t.x, t.top.y0 + t.top.h / 2, t.z);
    topMesh.castShadow = true;
    topMesh.receiveShadow = true;
    towerGroup.add(topMesh);
  }
  const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.4, t.spire.h, 6), spireMat);
  spire.position.set(t.x, t.spire.y0 + t.spire.h / 2, t.z);
  spire.castShadow = true;
  towerGroup.add(spire);
  // Issue #40: all 64 joint ornaments as one merged soup mesh in a
  // pale bronze tone — a single extra draw call for the whole set.
  const ornamentPositions = taipei101OrnamentPositions(t.ornaments);
  if (ornamentPositions.length) {
    const ornamentMat = new THREE.MeshStandardNodeMaterial({ color: 0xd8c491, roughness: 0.38, metalness: 0.35, side: THREE.DoubleSide });
    const ornamentMesh = new THREE.Mesh(soupGeometry(THREE, ornamentPositions), ornamentMat);
    ornamentMesh.name = 'Taipei101Ornaments';
    ornamentMesh.castShadow = true;
    towerGroup.add(ornamentMesh);
  }
  return towerGroup;
}

// ---- Landmark structure rendering (issue #26) ----
// The two custom solids the box/cylinder set cannot express: a
// rectangular frustum (optionally with a diagonal-cut top — the +x
// top edge dropped by topDropX) and a hip/ridge roof. Both are built
// as non-indexed triangle soup in a local frame (base at y=0, centre
// at x/z=0) with flat facets via computeVertexNormals, and rendered
// DoubleSide so a winding slip can never make a face invisible.

function pushQuad(list, a, b, c, d) {
  list.push(...a, ...b, ...c, ...a, ...c, ...d);
}

function soupGeometry(THREE, list) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(list, 3));
  geo.computeVertexNormals();
  return geo;
}

function frustumGeometry(THREE, part) {
  const drop = part.topDropX || 0;
  const bw = part.wB / 2, bd = part.dB / 2, tw = part.wT / 2, td = part.dT / 2, h = part.h;
  const bSW = [-bw, 0, bd], bSE = [bw, 0, bd], bNE = [bw, 0, -bd], bNW = [-bw, 0, -bd];
  const tSW = [-tw, h, td], tSE = [tw, h - drop, td], tNE = [tw, h - drop, -td], tNW = [-tw, h, -td];
  const list = [];
  pushQuad(list, bSW, bSE, tSE, tSW); // south
  pushQuad(list, bNE, bNW, tNW, tNE); // north
  pushQuad(list, bSE, bNE, tNE, tSE);  // east (dropped edge)
  pushQuad(list, bNW, bSW, tSW, tNW); // west
  pushQuad(list, tSW, tSE, tNE, tNW); // top (slanted when drop > 0)
  return soupGeometry(THREE, list);
}

function ridgeGeometry(THREE, part) {
  const w = part.w / 2, d = part.d / 2, h = part.h, top = part.h + part.ridgeH;
  const rl = w * 0.5; // ridge half-length along x
  const bSW = [-w, 0, d], bSE = [w, 0, d], bNE = [w, 0, -d], bNW = [-w, 0, -d];
  const eSW = [-w, h, d], eSE = [w, h, d], eNE = [w, h, -d], eNW = [-w, h, -d];
  const rW = [-rl, top, 0], rE = [rl, top, 0];
  const list = [];
  if (h > 0) {
    pushQuad(list, bSW, bSE, eSE, eSW);
    pushQuad(list, bNE, bNW, eNW, eNE);
    pushQuad(list, bSE, bNE, eNE, eSE);
    pushQuad(list, bNW, bSW, eSW, eNW);
  }
  pushQuad(list, eSW, eSE, rE, rW);   // south slope
  pushQuad(list, eNE, eNW, rW, rE);   // north slope
  list.push(...eNW, ...eSW, ...rW);  // west gable
  list.push(...eSE, ...eNE, ...rE);  // east gable
  return soupGeometry(THREE, list);
}

// ---- Landmark facade materials + signage (issue #57) ----
// Upstream's landmarks get their detail from shared procedural TSL
// materials (js/landmarks.js + js/tsl-materials.js), not from
// textures or extra geometry — the same factories the F0–F9 families
// use. The registry carries each structure's assignment as pure data
// (`facade`: { kind: 'curtain' | 'prewar', ...factoryOpts }, with
// optional per-part `facade` variants and `flat` colour overrides for
// roofs, pergolas and chimneys). The factories are injected by the
// boot module / gallery because this file must stay import-free for
// the node test suite; without them every part falls back to the
// flat tint it rendered with before this pass. The factories are
// world-space, so boxes, cylinders, domes and the frustum/ridge
// triangle soup all take the same grid with no UV work, and because
// the styles are uniform-driven they cost no extra shader programs
// and no texture memory.
function landmarkFacadeMaterial(THREE, factories, facade, fallbackColor, doubleSide) {
  if (factories && facade && (facade.kind === 'curtain' || facade.kind === 'prewar')) {
    const opts = { ...facade, boxLocal: false };
    delete opts.kind;
    let mat = facade.kind === 'curtain'
      ? factories.createCurtainWallMaterial(opts)
      : factories.createPreWarBuildingMaterial(opts);
    if (doubleSide && mat.side !== THREE.DoubleSide) {
      // The frustum/ridge soup renders DoubleSide (winding safety);
      // clone so the shared factory cache entry keeps its own side.
      mat = mat.clone();
      mat.side = THREE.DoubleSide;
    }
    return mat;
  }
  const mat = new THREE.MeshStandardNodeMaterial({ color: fallbackColor, roughness: 0.5, metalness: 0.1 });
  if (doubleSide) mat.side = THREE.DoubleSide;
  return mat;
}

// A landmark's sign as a canvas-texture plane, in the upstream
// MetLife-sign precedent (js/landmarks.js). Latin wordmarks are the
// ones the real building carries (Breeze, W, eslite); Chinese
// signage stays abstract glyph blocks, per the project stylization
// — character-like blocks with a stroke gap, never real characters.
// Deterministic: glyph widths come from a fixed pattern.
function landmarkSignMesh(THREE, s) {
  const sign = s.sign;
  if (!sign || typeof document === 'undefined') return null;
  const cw = 512;
  const ch = Math.max(16, Math.round((cw * sign.h) / sign.w));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.fillStyle = sign.bg;
  g.fillRect(0, 0, cw, ch);
  if (sign.accent) {
    // Brand block at the left (the Breeze red square).
    const b = ch * 0.62;
    g.fillStyle = sign.accent;
    g.fillRect(ch * 0.22, (ch - b) / 2, b, b);
    g.fillStyle = sign.bg;
    g.fillRect(ch * 0.22 + b * 0.24, (ch - b) / 2 + b * 0.24, b * 0.52, b * 0.52);
  }
  if (sign.text) {
    g.fillStyle = sign.fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const fontPx = Math.round(ch * (sign.text.length <= 1 ? 0.8 : 0.56));
    g.font = `${sign.text === 'Breeze' ? 'italic ' : ''}700 ${fontPx}px Georgia, 'Times New Roman', serif`;
    g.fillText(sign.text, sign.accent ? cw / 2 + ch * 0.4 : cw / 2, ch / 2 + fontPx * 0.05);
  } else if (sign.glyphs) {
    const widths = [0.92, 0.55, 0.74, 1.0, 0.62, 0.84, 0.7, 0.95];
    const gh = ch * 0.52, gy = (ch - gh) / 2;
    const unit = (cw * 0.8) / sign.glyphs;
    let x = cw * 0.1;
    g.fillStyle = sign.fg;
    for (let i = 0; i < sign.glyphs; i++) {
      const gw = Math.min(unit * (0.2 + 0.68 * widths[i % widths.length]), unit * 0.9);
      const r = gh * 0.12;
      g.beginPath();
      g.moveTo(x + r, gy);
      g.lineTo(x + gw - r, gy);
      g.arcTo(x + gw, gy, x + gw, gy + r, r);
      g.lineTo(x + gw, gy + gh - r);
      g.arcTo(x + gw, gy + gh, x + gw - r, gy + gh, r);
      g.lineTo(x + r, gy + gh);
      g.arcTo(x, gy + gh, x, gy + gh - r, r);
      g.lineTo(x, gy + r);
      g.arcTo(x, gy, x + r, gy, r);
      g.fill();
      // A horizontal stroke gap, so the block reads as a glyph.
      g.fillStyle = sign.bg;
      g.fillRect(x + gw * 0.18, gy + gh * 0.42, gw * 0.64, gh * 0.13);
      g.fillStyle = sign.fg;
      x += unit;
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(sign.w, sign.h),
    new THREE.MeshBasicNodeMaterial({ map: tex })
  );
  mesh.position.set(s.x + (sign.dx || 0), sign.y, s.z + (sign.dz || 0));
  // Issue #98: sign.rotY is the plane's own rotation — the plane
  // faces +z (south) by default, so a band authored on a north
  // face carries rotY π and one on a west face −π/2, turning it
  // to face OUTWARD off its wall instead of into it.
  if (sign.rotY) mesh.rotation.y = sign.rotY;
  mesh.name = 'LandmarkSign';
  return mesh;
}

// The landmark structures around Taipei 101, one subgroup per
// structure (named by id). Massing is the registry's parts exactly
// as before; issue #57 layers the per-structure facade material,
// per-part variants/flat overrides and the sign on top.
// `THREE` (and the TSL `factories`) are passed in for the same
// reason as createTaipei101.
export function createTaipeiLandmarkTowers(THREE, plan, factories) {
  if (!plan.landmarkTowers || !plan.landmarkTowers.length) return null;
  const group = new THREE.Group();
  group.name = 'TaipeiLandmarkTowers';
  for (const s of plan.landmarkTowers) {
    const mat = landmarkFacadeMaterial(THREE, factories, s.facade, s.color, false);
    const soupMat = landmarkFacadeMaterial(THREE, factories, s.facade, s.color, true);
    const flatCache = new Map();
    const flatPartMaterial = (flat, doubleSide) => {
      // `flat` is a colour, or { color, roughness, metalness } where
      // a part needs a specific finish (the arena/dome shells).
      const spec = typeof flat === 'number' ? { color: flat, roughness: 0.85, metalness: 0.02 } : flat;
      const key = `${spec.color}|${spec.roughness}|${spec.metalness}|${doubleSide ? 1 : 0}`;
      if (!flatCache.has(key)) {
        const m = new THREE.MeshStandardNodeMaterial({ color: spec.color, roughness: spec.roughness, metalness: spec.metalness });
        if (doubleSide) m.side = THREE.DoubleSide;
        flatCache.set(key, m);
      }
      return flatCache.get(key);
    };
    const partMaterial = (part, soup) => {
      if (part.flat !== undefined && part.flat !== null) return flatPartMaterial(part.flat, soup);
      if (part.facade) return landmarkFacadeMaterial(THREE, factories, part.facade, s.color, soup);
      return soup ? soupMat : mat;
    };
    const sub = new THREE.Group();
    sub.name = s.id;
    for (const part of s.parts) {
      const y0 = part.y0 || 0;
      let mesh = null;
      if (part.type === 'box') {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(part.w, part.h, part.d), partMaterial(part, false));
        mesh.position.set(s.x + (part.dx || 0), y0 + part.h / 2, s.z + (part.dz || 0));
        // rotY is authored in the tile-plane convention the
        // planner (lotCorners), the registry data and the
        // issue-#42 overlap audit all share: local +x maps to
        // (cos, +sin) in (x, z). THREE's rotation.y turns the
        // other way (measured against the local three build:
        // +x maps to (cos, -sin)), so the sign flips here to
        // make the rendered box the audited box. Until issue
        // #86 only Tao Zhu Yin Yuan's twist used rotY; it now
        // renders in the direction its data describes.
        if (part.rotY) mesh.rotation.y = -part.rotY;
      } else if (part.type === 'cylinder') {
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(part.r, part.r, part.h, 24), partMaterial(part, false));
        if (part.rz) mesh.scale.z = part.rz / part.r; // elliptical plan
        mesh.position.set(s.x + (part.dx || 0), y0 + part.h / 2, s.z + (part.dz || 0));
      } else if (part.type === 'dome') {
        // Half-ellipsoid: a unit hemisphere scaled to the part's radii.
        mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), partMaterial(part, false));
        mesh.scale.set(part.rx, part.h, part.rz);
        mesh.position.set(s.x + (part.dx || 0), y0, s.z + (part.dz || 0));
      } else if (part.type === 'frustum') {
        mesh = new THREE.Mesh(frustumGeometry(THREE, part), partMaterial(part, true));
        mesh.position.set(s.x, y0, s.z);
      } else if (part.type === 'ridge') {
        mesh = new THREE.Mesh(ridgeGeometry(THREE, part), partMaterial(part, true));
        mesh.position.set(s.x, y0, s.z);
      }
      if (mesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        sub.add(mesh);
      }
    }
    const signMesh = landmarkSignMesh(THREE, s);
    if (signMesh) sub.add(signMesh);
    group.add(sub);
  }
  return group;
}
