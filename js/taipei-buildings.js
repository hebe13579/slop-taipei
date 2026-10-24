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
//     centroid falls inside a park or water polygon.
//   - A block's bbox is inset by 3 m (the street-section band the ground
//     builder draws around each roadbed lives in that margin), then cut
//     into a lot grid: frontage 15–25 m, depth 15–22 m per lot, with a
//     1.2–3 m gap between neighbouring footprints. Very large blocks
//     (> 40,000 m² — campuses, depots, riverside tracts) use a coarser
//     pitch and a higher vacancy rate so they don't read as carpet.
//   - A lot is dropped when its centre falls inside a park/water
//     polygon (exact point-in-polygon, so a park that merely overlaps a
//     block's bbox still stays empty — Da'an Forest Park above all),
//     when its footprint intersects the Taipei 101 landmark site, or
//     when its centre comes within 1.6 m of a roadbed/path ribbon edge,
//     or when any footprint corner lands inside a ribbon (block bboxes
//     are rectangles around non-rectangular raster components; these
//     tests keep footprints out of the road corridors that cut through
//     a bbox's concave notches, and off the narrow lanes they flank).
//   - Heights are contextual, from distance to the tile origin (Taipei
//     101) and the best road class adjacent to the lot:
//       < 650 m from origin (Xinyi core)      → 25–60 m
//       next to a secondary-or-better road    → 12–30 m
//       everything else (residential lanes)   →  8–18 m
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
// increment owns signage). Lots are axis-aligned to the tile frame, not
// rotated to each street's angle. The plan's per-lot colours are no
// longer used for rendering — upstream's facade materials carry their
// own palettes — but stay in the plan as data.

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

// ---- Landmark structures around Taipei 101 (issue #26) ----
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
//   box      { w, d, h, y0?, dx?, dz?, rotY? }   axis-aligned block
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
    parts: [
      { type: 'box', w: 108, d: 54, h: 30, dx: -77, dz: 1 },
      { type: 'box', w: 66, d: 58, h: 34, dx: 20, dz: -1 },
      { type: 'box', w: 48, d: 38, h: 34, dx: 90, dz: 8 },
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
    parts: [
      { type: 'box', w: 47, d: 16, h: 12, dx: 51, dz: 8 },
      { type: 'box', w: 56, d: 21, h: 15, dx: 66, dz: 38 },
      { type: 'frustum', wB: 43, dB: 43, wT: 32, dT: 32, h: 250 },
      { type: 'frustum', wB: 32, dB: 32, wT: 30, dT: 30, h: 16.3, y0: 250, topDropX: 10 },
    ],
  },
  {
    // 212 m, 46F, completed 2015 (Wikipedia / CTBUH). A slender
    // vertically-striped slab on the Breeze Xinyi podium; the top
    // arcs down toward the east in a smooth curve — massed as four
    // descending steps.
    // Footprint corrected in issue #42 to the OSM outline (way
    // 378443967 國泰置地廣場, 122.3 × 78.8 m): the batch-1 axis sat
    // ~13 m east, pushing the podium's east edge onto a service
    // roadbed.
    id: 'cathay-landmark', name: 'Cathay Landmark', nameZh: '國泰置地廣場',
    lat: 25.040488, lon: 121.566845, realHeight: 212, color: 0x51606e,
    site: { w: 126, d: 82, dx: 0, dz: 0 },
    parts: [
      // Two boxes: the west cap stops north of the service drive
      // that notches the outline's SW corner (issue #42 audit).
      { type: 'box', w: 105, d: 77, h: 26, dx: 8 },
      { type: 'box', w: 15, d: 63, h: 26, dx: -52, dz: -7 },
      { type: 'box', w: 58, d: 36, h: 158, y0: 26 },
      { type: 'box', w: 14.5, d: 36, h: 28, y0: 184, dx: -21.75 },
      { type: 'box', w: 14.5, d: 36, h: 21, y0: 184, dx: -7.25 },
      { type: 'box', w: 14.5, d: 36, h: 14, y0: 184, dx: 7.25 },
      { type: 'box', w: 14.5, d: 36, h: 7, y0: 184, dx: 21.75 },
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
    parts: [
      // Main slab + a mid-height east strip: the bus-station drives
      // east of the tower notch the outline's NE and SE corners
      // (issue #42 audit), so no single box fits the outline.
      { type: 'box', w: 92, d: 57, h: 30, dx: -7 },
      { type: 'box', w: 12, d: 30, h: 30, dx: 45, dz: -7 },
      { type: 'box', w: 60, d: 40, h: 114, y0: 30 },
      { type: 'box', w: 2.5, d: 40, h: 10, y0: 144, dx: -28.75 },
      { type: 'box', w: 2.5, d: 40, h: 10, y0: 144, dx: 28.75 },
      { type: 'box', w: 60, d: 3, h: 2, y0: 152, dz: -14 },
      { type: 'box', w: 60, d: 3, h: 2, y0: 152, dz: 0 },
      { type: 'box', w: 60, d: 3, h: 2, y0: 152, dz: 14 },
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
    parts: [
      { type: 'cylinder', r: 125, rz: 95, h: 22 },
      { type: 'dome', rx: 125, rz: 95, h: 42, y0: 22 },
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
    parts: [
      { type: 'box', w: 108, d: 108, h: 1.5 },
      { type: 'box', w: 96, d: 96, h: 15.5, y0: 1.5 },
      { type: 'frustum', wB: 104, dB: 104, wT: 90, dT: 90, h: 4, y0: 17 },
      { type: 'frustum', wB: 90, dB: 90, wT: 74, dT: 74, h: 3.5, y0: 21 },
      { type: 'ridge', w: 74, d: 74, h: 0, ridgeH: 5.9, y0: 24.5 },
      { type: 'box', w: 5, d: 5, h: 3.5, y0: 21, dx: -42, dz: -42 },
      { type: 'box', w: 5, d: 5, h: 3.5, y0: 21, dx: 42, dz: -42 },
      { type: 'box', w: 5, d: 5, h: 3.5, y0: 21, dx: -42, dz: 42 },
      { type: 'box', w: 5, d: 5, h: 3.5, y0: 21, dx: 42, dz: 42 },
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
    distFromOrigin: Math.round(Math.hypot(x, z)),
    color: def.color, site, openGround,
    sites: openGround ? [site, openGround] : [site],
    parts: def.parts,
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
    return { id: r.id, name: r.name, nameZh: r.nameZh, x: r.x, z: r.z, height: r.realHeight };
  });
}

export function planTaipeiBuildings(geodata) {
  const stats = { blocksSeen: 0, blocksSkippedSmall: 0, blocksSkippedParkWater: 0, lotsDroppedVacancy: 0, lotsDroppedParkWater: 0, lotsDroppedTowerSite: 0, lotsDroppedRoad: 0 };
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
  const exclusionSites = towerSite ? [towerSite, ...landmarkSites] : landmarkSites;

  const lots = [];
  const blocks = geodata.blocks || [];
  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi];
    stats.blocksSeen++;
    if (!(block.area >= 150)) { stats.blocksSkippedSmall++; continue; }
    if (inPoly(block.cx, block.cz)) { stats.blocksSkippedParkWater++; continue; }
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
    const cols = Math.max(1, Math.round(innerW / frontage));
    const rows = Math.max(1, Math.round(innerD / depthPitch));
    const cellW = innerW / cols, cellD = innerD / rows;
    for (let col = 0; col < cols; col++) {
      for (let row = 0; row < rows; row++) {
        const seed = Math.imul(bi + 1, 73856093) ^ Math.imul(col + 1, 19349663) ^ Math.imul(row + 1, 83492791);
        if (hash01(seed ^ 0x51ab) < vacancy) { stats.lotsDroppedVacancy++; continue; }
        const cx = minX + (col + 0.5) * cellW;
        const cz = minZ + (row + 0.5) * cellD;
        const gap = 1.2 + hash01(seed ^ 0x77c3) * 1.8;
        const w = cellW - gap, d = cellD - gap;
        if (w < 7 || d < 7) continue;
        if (inPoly(cx, cz)) { stats.lotsDroppedParkWater++; continue; }
        let onLandmarkSite = false;
        for (const s of exclusionSites) {
          if (cx + w / 2 > s.minX && cx - w / 2 < s.maxX && cz + d / 2 > s.minZ && cz - d / 2 < s.maxZ) { onLandmarkSite = true; break; }
        }
        if (onLandmarkSite) {
          stats.lotsDroppedTowerSite++;
          continue;
        }
        const { clearance, rank } = roadInfoAt(cx, cz);
        if (clearance < 1.6) { stats.lotsDroppedRoad++; continue; }
        // The centre test alone lets a wide lot beside a narrow lane
        // overhang the lane itself; require every footprint corner to
        // stay out of the ribbons too (corner clearance < 0 = inside).
        let cornerInRoad = false;
        for (const [ox, oz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
          if (roadInfoAt(cx + (ox * w) / 2, cz + (oz * d) / 2).clearance < 0) { cornerInRoad = true; break; }
        }
        if (cornerInRoad) { stats.lotsDroppedRoad++; continue; }
        const dOrigin = Math.hypot(cx, cz);
        let lo, hi;
        if (dOrigin < 650) { lo = 25; hi = 60; }        // Xinyi commercial core
        else if (rank >= 3) { lo = 12; hi = 30; }       // boulevard / arterial frontage
        else { lo = 8; hi = 18; }                        // residential interiors
        const h = Math.round((lo + hash01(seed ^ 0x3d9a) * (hi - lo)) * 2) / 2;
        const base = PALETTE[Math.floor(hash01(seed ^ 0x9f2c) * PALETTE.length) % PALETTE.length];
        const shade = 0.92 + hash01(seed ^ 0x64d1) * 0.16;
        const color = base.map((c) => Math.max(0, Math.min(255, Math.round(c * shade * 255))));
        lots.push({ x: Math.round(cx * 10) / 10, z: Math.round(cz * 10) / 10, w: Math.round(w * 10) / 10, d: Math.round(d * 10) / 10, h, color });
      }
    }
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

// Facade material for a planned lot, as an index into upstream
// buildings.js's six facade families (0-2 masonry pre-war/brick/
// brownstone, 3-5 curtain-wall glass). Deterministic from the lot's
// position, like everything else in the plan: the Xinyi-core towers go
// glass, boulevard mid-rises mix glass and masonry, residential
// interiors stay masonry.
function facadeMatFor(lot) {
  const seed = (Math.imul(Math.round(lot.x * 10), 73856093) ^ Math.imul(Math.round(lot.z * 10), 19349663) ^ 0x101) | 0;
  const r = hash01(seed);
  if (lot.h >= 40) return [3, 4, 5][Math.floor(r * 3) % 3];
  if (lot.h >= 22) return r < 0.5 ? [3, 4, 5][Math.floor(r * 6) % 3] : [0, 1][Math.floor((r - 0.5) * 4) % 2];
  if (lot.h >= 12) return r < 0.1 ? 3 : [0, 1, 2][Math.floor(r * 3) % 3];
  return [0, 1, 2][Math.floor(r * 3) % 3];
}

// Adapt a plan into the options upstream's buildCityBlocks (js/
// buildings.js) understands: one pre-planned lot per building, the
// tile frame as the streaming bounds, the tile origin as the first
// stream centre, and no colliders (Taipei buildings stay visual-only,
// as in the first buildings increment — the controllers pass the flat
// tile at y=0). Pure data, like the planner.
export function taipeiCityBlocksOptions(geodata, plan = planTaipeiBuildings(geodata)) {
  return {
    lots: plan.lots.map((lot) => ({
      x0: lot.x - lot.w / 2,
      x1: lot.x + lot.w / 2,
      z0: lot.z - lot.d / 2,
      z1: lot.z + lot.d / 2,
      h: lot.h,
      mat: facadeMatFor(lot),
    })),
    bounds: { ...geodata.frame.bbox },
    initial: [0, 0],
    colliders: false,
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

export function createTaipei101(THREE, plan) {
  if (!plan.tower) return null;
  const t = plan.tower;
  const towerGroup = new THREE.Group();
  towerGroup.name = 'Taipei101';
  const glassMat = new THREE.MeshStandardNodeMaterial({ color: 0x2e4f45, roughness: 0.35, metalness: 0.15 });
  const podium = new THREE.Mesh(new THREE.BoxGeometry(t.podium.w, t.podium.h, t.podium.d), glassMat);
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
  const mallMat = new THREE.MeshStandardNodeMaterial({ color: 0x51655a, roughness: 0.8, metalness: 0.05 });
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
  const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.4, t.spire.h, 6), glassMat);
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

// The landmark structures around Taipei 101 as plain meshes, one
// subgroup per structure (named by id), each in its own plain
// material tint — the same massing register as createTaipei101.
// `THREE` is passed in for the same reason as createTaipei101.
export function createTaipeiLandmarkTowers(THREE, plan) {
  if (!plan.landmarkTowers || !plan.landmarkTowers.length) return null;
  const group = new THREE.Group();
  group.name = 'TaipeiLandmarkTowers';
  for (const s of plan.landmarkTowers) {
    const mat = new THREE.MeshStandardNodeMaterial({ color: s.color, roughness: 0.5, metalness: 0.1 });
    const flatMat = new THREE.MeshStandardNodeMaterial({ color: s.color, roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide });
    const sub = new THREE.Group();
    sub.name = s.id;
    for (const part of s.parts) {
      const y0 = part.y0 || 0;
      let mesh = null;
      if (part.type === 'box') {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(part.w, part.h, part.d), mat);
        mesh.position.set(s.x + (part.dx || 0), y0 + part.h / 2, s.z + (part.dz || 0));
        if (part.rotY) mesh.rotation.y = part.rotY;
      } else if (part.type === 'cylinder') {
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(part.r, part.r, part.h, 24), mat);
        if (part.rz) mesh.scale.z = part.rz / part.r; // elliptical plan
        mesh.position.set(s.x + (part.dx || 0), y0 + part.h / 2, s.z + (part.dz || 0));
      } else if (part.type === 'dome') {
        // Half-ellipsoid: a unit hemisphere scaled to the part's radii.
        mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), mat);
        mesh.scale.set(part.rx, part.h, part.rz);
        mesh.position.set(s.x + (part.dx || 0), y0, s.z + (part.dz || 0));
      } else if (part.type === 'frustum') {
        mesh = new THREE.Mesh(frustumGeometry(THREE, part), flatMat);
        mesh.position.set(s.x, y0, s.z);
      } else if (part.type === 'ridge') {
        mesh = new THREE.Mesh(ridgeGeometry(THREE, part), flatMat);
        mesh.position.set(s.x, y0, s.z);
      }
      if (mesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        sub.add(mesh);
      }
    }
    group.add(sub);
  }
  return group;
}
