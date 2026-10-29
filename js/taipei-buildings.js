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
//   - Issue #124: the fine-grain rule. The #107 reality check found
//     ordinary blocks reading half-empty from the air (coverage
//     0.23–0.27 of block land against a real 0.39–0.61+, grain ~15 m
//     against a real 9–14 m), and the #124 study showed grain and
//     coverage are the same defect: only 14–21% of grid candidates
//     survive the exact ribbon verdicts, because a ~20 m cell
//     straddles ribbons and edges a ~11 m cell fits between. A block
//     whose REAL door-plate density (height-layer door points inside
//     the block's bbox, per hectare of block land) is ≥ 60/ha is old
//     fine fabric — Datong medians ~72/ha, the planned east ~35/ha —
//     and subdivides fine instead: frontage pitch 9–12.5 m, depth
//     pitch 12.5–16.5 m, gap 0.4–1.2 m, vacancy 4%, a 2 m inset
//     (fine fabric fronts its lanes near-flush) and a 6 m minimum
//     lot width. Big blocks are never fine. One real signal, no
//     traced footprints, no hand-drawn zones; coarse blocks
//     subdivide exactly as before, so the planned districts keep
//     their grain (see the study on issue #124).
//   - Issue #218: the density is a runtime option (the settings
//     gear passes opts.density): 'coarse' disables the fine rule
//     (the pre-#124 plan), 'dense' keeps the classifier but
//     tightens the fine pitch to ~7.5–10.5 m frontage (the
//     ~7–11 m draft the #124 study measured). The default
//     'fine' is this header's plan, byte for byte.
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
//   - Issue #185: the street-wall pull. A lot standing in a block
//     face that fronts a major road (rank ≥ 3, the #106 face
//     classification) is pulled toward that street after the plan is
//     complete, until its face sits on the street section's outer
//     edge — carriageway edge plus the section band drawn there
//     (sidewalk band by class; the arcade reach; nothing for shared
//     or painted sections). The grid above leaves every frontage
//     face the 3 m inset plus half the lot gap behind that edge,
//     and a turned grid can leave one most of a cell behind it;
//     real Taipei fronts its avenues flush (the user's Fuxing
//     corridor photo: facades on the walkway edge, no pale margin).
//     The pull moves positions only — size, height, height source,
//     colour, facade family and signs are all preserved (see the
//     pull section for its two guards) — and interior lots and
//     minor-road frontages are never touched.
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
//   wheel    { y0, h, dx?, dz? }   Ferris wheel: y0 = bottom
//              elevation, h = diameter (rim + spokes + cabins in
//              the tile x-y plane). Airborne mass — its ground
//              contact is separate box parts (issue #186).
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

// Issue #166 (Tianmu/Beitou batch): a school running track as flat
// painted parts — a capsule (one rotated box for the straights plus
// unrotated discs at the ends, since cylinder parts cannot rotate)
// in rust red with a narrower green infield capsule on top. (cx, cz)
// is the capsule centre in structure space, `straight` the distance
// between the end-disc centres, `width` the full track width and
// `fieldWidth` the infield width.
function trackCapsuleParts(cx, cz, straight, width, fieldWidth, rotY, trackColor, fieldColor) {
  const ex = (straight / 2) * Math.cos(rotY), ez = (straight / 2) * Math.sin(rotY);
  const capsule = (w, h) => [
    { type: 'box', w: straight, d: w, h, y0: 0.02, dx: cx, dz: cz, rotY, flat: trackColor },
    { type: 'cylinder', r: w / 2, h, y0: 0.02, dx: cx + ex, dz: cz + ez, flat: trackColor },
    { type: 'cylinder', r: w / 2, h, y0: 0.02, dx: cx - ex, dz: cz - ez, flat: trackColor },
  ];
  const field = capsule(fieldWidth, 0.36).map((p) => ({ ...p, flat: fieldColor }));
  return [...capsule(width, 0.3), ...field];
}

// Tianmu Baseball Stadium (issue #166): the project's first
// stadium form — an elliptical stepped bowl of tangent segment
// boxes around an open field, generated like taoZhuParts().
// Siting is measured, not eyeballed (posted on issue #166): the
// OSM stadium-grounds way 172953503 spans lon 121.53163–121.53446
// and the Red Line corridor's east edge is lon 121.533, so the
// bowl straddles the tile edge (≈90% of the grounds east of it).
// Per the decision recorded on the issue, the bowl is modelled
// COMPLETE at its true position — only drawn geometry crosses
// the edge; no ground, lots or roads are generated past it. The
// field centre (satellite digitisation, Esri z18) is
// (25.11380, 121.53360) — dx 46.4, dz −17.7 in structure space;
// the OSM stands outline (way 518853867) spans lon
// 121.53213–121.53415, lat 25.11278–25.11450 around it.
function tianmuStadiumParts() {
  const FC = { x: 46.4, z: -17.7 }; // measured field centre
  const parts = [
    // Warning-track ring (rust) under the grass ellipse, then the
    // dirt infield diamond (axis home→centre-field at +37°).
    { type: 'cylinder', r: 67, rz: 63, h: 0.3, y0: 0.02, dx: FC.x, dz: FC.z, flat: 0x9c5a40 },
    { type: 'cylinder', r: 62, rz: 58, h: 0.36, y0: 0.02, dx: FC.x, dz: FC.z, flat: 0x4e7d32 },
    { type: 'box', w: 50, d: 50, h: 0.14, y0: 0.36, dx: 10.1, dz: -15.5, rotY: -0.646, flat: 0xc2a06b },
  ];
  const seg = (a, b, h, d, w, phiDeg, flat) => {
    const phi = (phiDeg * Math.PI) / 180;
    // Ellipse tangent direction (map angle) -> authored rotY.
    const alphaT = Math.atan2(b * Math.cos(phi), -a * Math.sin(phi));
    parts.push({ type: 'box', w, d, h, dx: FC.x + a * Math.cos(phi), dz: FC.z - b * Math.sin(phi), rotY: -alphaT, flat });
  };
  // Main bowl: two stepped tiers wrapping home plate (west) and
  // both foul lines; phi is CCW from east in map space. The NE
  // outfield stays low, as on the real bowl.
  for (let phi = 95; phi <= 335; phi += 15) {
    seg(76, 64, 8.5, 13, 22, phi, 0xd6d0c2);
    seg(89, 76, 14, 13, 25, phi, 0xcac3b2);
  }
  // Outfield berm seating: one low tier.
  for (let phi = -30; phi <= 90; phi += 15) seg(82, 68, 5, 10, 23, phi, 0xd6d0c2);
  // The white scalloped shell canopy over the main stand behind
  // home (phi ≈ 196°): three flattened domes centred on the
  // mid-tier line so they roof the stands instead of hovering
  // over the outer wall, the middle shell a step higher.
  for (const [phi, y0] of [[178, 14], [196, 14.8], [214, 14]]) {
    const p = (phi * Math.PI) / 180;
    parts.push({ type: 'dome', rx: 15, rz: 10, h: 7, y0, dx: FC.x + 82 * Math.cos(p), dz: FC.z - 69 * Math.sin(p), flat: { color: 0xf4f1ea, roughness: 0.6, metalness: 0.05 } });
  }
  // Centre-field scoreboard on the berm.
  parts.push({ type: 'box', w: 18, d: 2.5, h: 9, y0: 5, dx: FC.x + 65.5, dz: FC.z - 40.9, rotY: -2.216, flat: 0x1c2733 });
  // Four light towers at the rim; the 30 m overall height is an
  // estimate from photographs (no published figure).
  for (const phi of [-40, 40, 150, 232]) {
    const p = (phi * Math.PI) / 180;
    const ex = 95 * Math.cos(p), nz = 82 * Math.sin(p);
    const alphaT = Math.atan2(82 * Math.cos(p), -95 * Math.sin(p));
    parts.push({ type: 'box', w: 1.8, d: 1.8, h: 30, dx: FC.x + ex, dz: FC.z - nz, flat: 0x8f979e });
    parts.push({ type: 'box', w: 8, d: 3, h: 3, y0: 27, dx: FC.x + ex, dz: FC.z - nz, rotY: -alphaT, flat: 0xd8dde2 });
  }
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
    // Issue #165: the Four Seasons Hotel Taipei (Yuanta), on the
    // Xinyi D3 block directly across Xinyi Road from Taipei 101 —
    // modelled COMPLETED, the Twin Towers (#135) precedent: the
    // tower topped out in 2026 and the hotel is due to open in 2028.
    // 180 m architectural height, 31F above ground / 4 below, 260
    // keys (RSHP project sheet: architects RSHP with C.C. Jen
    // Architects, for Yuan Lih Construction 元利建設; site area
    // 5,121 m2). CTBUH lists a tower GFA of 77,000 m2; the zh
    // tall-buildings list's 181.4 m spire figure is the same tower
    // measured to the louvre tips — the registry carries the
    // architect's published 180 m.
    // Position is the published coordinate (Wikipedia infobox /
    // parcel centroid of the OSM construction parcel, way
    // 186083333 信義計畫區D3街廓), and the site rect takes that
    // parcel's measured extent (tile x -116..+34, z +29..+107: the
    // full D3 block between Xinyi Rd Sec 5 and Songren Rd, fronting
    // Songzhi Rd on the east). OSM carries no building outline for
    // the tower yet, so the plate is design-derived, stated
    // honestly: the RSHP cover render's east elevation is a
    // six-bay glazed slab ~54 m long; the slab's depth reads
    // ~0.55-0.6 of its length in the same render, giving the
    // 32 x 54 m plate below, standing at the parcel's NE corner
    // over a full-width glazed podium (~30 m in the renders: the
    // exoskeleton-framed lobby/ballroom stack) that runs west
    // along Xinyi Road. The signature crown — a slanted glass-
    // louvre array leaning back (NW) over the top floors — is
    // three thin slabs stepping NW, the stepped-taper idiom.
    id: 'four-seasons-hotel-taipei', name: 'Four Seasons Hotel Taipei (Yuanta)', nameZh: '元利四季酒店',
    lat: 25.0325, lon: 121.56472, realHeight: 180, color: 0x46586a,
    site: { w: 150, d: 78, dx: -13.2, dz: 12.4 },
    // Blue-grey curtain glass with the design's bronze accent tone
    // in the frame colour (the twin bronze light strips carried
    // over from the developer's One Park Taipei).
    facade: { kind: 'curtain', glassTint: 0x3d4f5e, frameTint: 0xa8875a, windowWidth: 2.4, floorHeight: 5.6, litProbability: 0.35, warmth: 0.62, reflectivity: 0.92, seed: 165.11 },
    parts: [
      { type: 'box', w: 86, d: 54, h: 30, dx: -22, dz: 1.5 },
      { type: 'box', w: 32, d: 54, h: 132, y0: 30 },
      { type: 'box', w: 30, d: 50, h: 6, y0: 162, dx: -1.5, dz: -1.5 },
      { type: 'box', w: 27, d: 46, h: 6, y0: 168, dx: -3, dz: -3 },
      { type: 'box', w: 24, d: 42, h: 6, y0: 174, dx: -4.5, dz: -4.5 },
    ],
  },
  {
    // Issue #165: Farglory Financial Center, Songgao Rd 1 —
    // completed 2013, the district's third tower at 208.3 m, 32F
    // (tall-buildings study; OSM way 289834528 carries height 208).
    // The axis is that outline's minimum-area-rect centre (tile
    // (-80.5, -733.1); the rect measures 47.1 x 40.9 m, long axis
    // 1.1 deg off the tile axes, so the plate is axis-aligned) and
    // the shaft plate is the outline trimmed ~1 m a side, the #42
    // convention. Esri satellite (z19) shows NO podium — the stone
    // shaft meets the ground directly behind its Songgao Rd
    // entrance canopy — so the massing is the shaft alone under
    // the signature classical crown: a tapering cap and finial
    // block (the real crown is a domed, temple-form cap; the
    // frustum + finial is the registry's idiom for it).
    id: 'farglory-financial-center', name: 'Farglory Financial Center', nameZh: '遠雄金融中心',
    lat: 25.039606, lon: 121.564201, realHeight: 208.3, color: 0xc98a6d,
    site: { w: 52, d: 46, dx: 0, dz: 0 },
    // Salmon-pink stone (OSM building:colour #e9967a) on the
    // prewar stone-grid factory.
    facade: { kind: 'prewar', stoneColor: 0xd8a583, trimColor: 0xa87a5c, windowGlassColor: 0x2a3a4a, windowWidth: 2.6, floorHeight: 5.8, litProbability: 0.3, warmth: 0.6, seed: 165.21 },
    parts: [
      { type: 'box', w: 45, d: 39, h: 190 },
      { type: 'frustum', wB: 45, dB: 39, wT: 30, dT: 26, h: 14, y0: 190 },
      { type: 'box', w: 10, d: 10, h: 4.3, y0: 204 },
    ],
  },
  {
    // Issue #165: Shin Kong Mitsukoshi Xinyi Place A4, Songgao Rd
    // 19 (opened 2005). One of the four department-store halls of
    // the Xinyi Place cluster, registered per hall (the Songshan
    // terminal pattern) so each hall's site rect hugs its own
    // measured outline. Footprint: OSM way 274647897's
    // minimum-area rect, 84.1 x 66.2 m axis-aligned at tile
    // (166.5, -740.5); the plate is the rect trimmed ~1 m a side.
    // Height is ESTIMATED (flagged): no published figure — the
    // store is 6 floors above ground (zh-Wikipedia, Shin Kong
    // Mitsukoshi article) at a 5.5 m department-store floor
    // height = 33 m. Flat slab + thin roof cap, the cluster's
    // shared simple roof form. The plate is trimmed harder than
    // the usual ~1 m: unnamed service drives in the geodata reach
    // into the outline's west strip (their roadbeds end at tile
    // x 129.2 at z -740 and x 129.7 at z -768 — the real building
    // arcades over them), so the slab is two boxes east of
    // x 130.7: the main mass plus a narrower north strip — the
    // #42 audit's trim convention, as on the batch-1 podiums.
    // Issue #255: the red steel frame the user photographed is
    // A8's, NOT A4's — proven by the Esri/OSM overlay
    // (xinyi255-evidence/esri-xinyi-overlaid.jpg: the red
    // pergola sits inside A8's outline) and by the photo's
    // viewpoint (Xiangti Ave facing south, Breeze Songgao on
    // the left). A4 keeps its pale treatment, made glassier:
    // the Xinyi Place halls are "giant, very long low-rise
    // structures of gleaming glass and exposed steel girders
    // that have the look of a small fleet of cruise liners"
    // (taiwaneverything.cc / travelintaiwan.net, Apr 2025).
    // Geometry unchanged (it already matches OSM way
    // 274647897's rect); the logo band is new.
    id: 'shin-kong-mitsukoshi-a4', name: 'Shin Kong Mitsukoshi Xinyi Place A4', nameZh: '新光三越信義新天地A4館',
    lat: 25.039673, lon: 121.566652, realHeight: 33, estimated: true, color: 0xb0aa9e,
    site: { w: 86, d: 68, dx: 0, dz: 0 },
    facade: { kind: 'curtain', glassTint: 0xa8b8bc, frameTint: 0x8f8a80, windowWidth: 4.6, floorHeight: 5.5, litProbability: 0.45, warmth: 0.6, reflectivity: 0.5, seed: 165.31 },
    sign: { glyphs: 4, w: 26, h: 3, y: 24, dx: 0, dz: 33.6, bg: '#3a3f45', fg: '#ddd6c2' },
    parts: [
      { type: 'box', w: 74, d: 57, h: 31.5, dx: 1, dz: 4.5 },
      { type: 'box', w: 74, d: 9, h: 31.5, dx: 4, dz: -27.5 },
      { type: 'box', w: 74, d: 57, h: 1.5, y0: 31.5, dx: 1, dz: 4.5 },
      { type: 'box', w: 74, d: 9, h: 1.5, y0: 31.5, dx: 4, dz: -27.5 },
    ],
    farParts: [
      { type: 'box', w: 74, d: 57, h: 31.5, dx: 1, dz: 4.5 },
      { type: 'box', w: 74, d: 9, h: 31.5, dx: 4, dz: -27.5 },
      { type: 'box', w: 74, d: 57, h: 1.5, y0: 31.5, dx: 1, dz: 4.5 },
      { type: 'box', w: 74, d: 9, h: 1.5, y0: 31.5, dx: 4, dz: -27.5 },
    ],
  },
  {
    // Issue #165: Shin Kong Mitsukoshi Xinyi Place A8, Songgao Rd
    // 12 (opened 2002) — the cluster's long slab south of Songgao
    // Rd: OSM way 274647896's minimum-area rect, 48.9 x 137.9 m
    // axis-aligned at tile (181.4, -585.0); plate trimmed ~1 m a
    // side. Height ESTIMATED (flagged): 7 floors above ground
    // (zh-Wikipedia) x 5.5 m = 38.5 m.
    // Issue #255 (correction): THE RED STEEL FRAME IS A8'S. The
    // user's Street View photo (Songren Rd, 101 behind) shows the
    // building wrapped in a red/orange-red exposed-steel
    // exoskeleton — diagonal bracing, red columns and beams over
    // dark glass. The Esri/OSM overlay proves it is A8: the red
    // rectangular pergola + the blue/white circular rooftop
    // feature sit inside OSM way 274647896 (A8), whose OSM
    // colour tag is itself #FF0000. The photo's viewpoint
    // (Xiangti Ave facing south, Breeze Songgao on the left)
    // puts A8 on the right. The #165 entry's pale prewar slab
    // is therefore corrected: dark glass curtain with pale
    // frame bands + the red exoskeleton (corner + face columns,
    // horizontal band courses, roof pergola grid) + the rooftop
    // disc. Massing, site and height unchanged; the frame parts
    // stay inside the existing cap's plan so the #42 audit sees
    // no new footprint. The frame drops out of the far version
    // (sub-pixel past 700 m) — the slab stays visible.
    id: 'shin-kong-mitsukoshi-a8', name: 'Shin Kong Mitsukoshi Xinyi Place A8', nameZh: '新光三越信義新天地A8館',
    lat: 25.038272, lon: 121.5668, realHeight: 38.5, estimated: true, color: 0xb5ab97,
    site: { w: 53, d: 151, dx: 0, dz: 0 },
    facade: { kind: 'curtain', glassTint: 0x39434a, frameTint: 0xd8d5cc, windowWidth: 3.4, floorHeight: 5.5, litProbability: 0.45, warmth: 0.6, reflectivity: 0.5, seed: 165.32 },
    parts: [
      { type: 'box', w: 49, d: 147, h: 37 },
      { type: 'box', w: 49, d: 149, h: 1.5, y0: 37 },
      // Red exoskeleton: corner columns + long-face columns.
      { type: 'box', w: 1.2, d: 1.2, h: 37, dx: -23.5, dz: -72, flat: 0xb02a1e },
      { type: 'box', w: 1.2, d: 1.2, h: 37, dx: 23.5, dz: -72, flat: 0xb02a1e },
      { type: 'box', w: 1.2, d: 1.2, h: 37, dx: -23.5, dz: 72, flat: 0xb02a1e },
      { type: 'box', w: 1.2, d: 1.2, h: 37, dx: 23.5, dz: 72, flat: 0xb02a1e },
      { type: 'box', w: 1, d: 1, h: 37, dx: -24.5, dz: -48, flat: 0xb02a1e },
      { type: 'box', w: 1, d: 1, h: 37, dx: 24.5, dz: -48, flat: 0xb02a1e },
      { type: 'box', w: 1, d: 1, h: 37, dx: -24.5, dz: -24, flat: 0xb02a1e },
      { type: 'box', w: 1, d: 1, h: 37, dx: 24.5, dz: -24, flat: 0xb02a1e },
      { type: 'box', w: 1, d: 1, h: 37, dx: -24.5, dz: 0, flat: 0xb02a1e },
      { type: 'box', w: 1, d: 1, h: 37, dx: 24.5, dz: 0, flat: 0xb02a1e },
      { type: 'box', w: 1, d: 1, h: 37, dx: -24.5, dz: 24, flat: 0xb02a1e },
      { type: 'box', w: 1, d: 1, h: 37, dx: 24.5, dz: 24, flat: 0xb02a1e },
      { type: 'box', w: 1, d: 1, h: 37, dx: -24.5, dz: 48, flat: 0xb02a1e },
      { type: 'box', w: 1, d: 1, h: 37, dx: 24.5, dz: 48, flat: 0xb02a1e },
      // Horizontal band courses, proud of the facade.
      { type: 'box', w: 50.5, d: 148.5, h: 0.8, y0: 12, flat: 0xb02a1e },
      { type: 'box', w: 50.5, d: 148.5, h: 0.8, y0: 24, flat: 0xb02a1e },
      // Roof pergola grid.
      { type: 'box', w: 1, d: 149, h: 1.2, y0: 38.5, dx: -23.5, flat: 0xb02a1e },
      { type: 'box', w: 1, d: 149, h: 1.2, y0: 38.5, dx: 23.5, flat: 0xb02a1e },
      { type: 'box', w: 49, d: 1, h: 1.2, y0: 38.5, dz: -72, flat: 0xb02a1e },
      { type: 'box', w: 49, d: 1, h: 1.2, y0: 38.5, dz: -36, flat: 0xb02a1e },
      { type: 'box', w: 49, d: 1, h: 1.2, y0: 38.5, dz: 0, flat: 0xb02a1e },
      { type: 'box', w: 49, d: 1, h: 1.2, y0: 38.5, dz: 36, flat: 0xb02a1e },
      { type: 'box', w: 49, d: 1, h: 1.2, y0: 38.5, dz: 72, flat: 0xb02a1e },
      // Rooftop disc (the blue/white circular feature on satellite).
      { type: 'cylinder', r: 8, h: 1, y0: 38.5, dz: 40, flat: 0xa8c8d8 },
    ],
    farParts: [
      { type: 'box', w: 49, d: 147, h: 37 },
      { type: 'box', w: 49, d: 149, h: 1.5, y0: 37 },
    ],
  },
  {
    // Issue #165: Shin Kong Mitsukoshi Xinyi Place A9, Songshou Rd
    // 9 (opened 2003) — the west slab of the Xiangti Ave pair:
    // OSM way 269773067's minimum-area rect, 38.2 x 137.1 m
    // axis-aligned at tile (168.7, -404.0); plate trimmed ~1 m a
    // side. (The neighbouring way 269773066 is NAMED "A9" in OSM
    // but its address/amenity tags are Songshou Rd 20, the VieShow
    // Cinemas building — not part of this cluster.) Height
    // ESTIMATED (flagged): 9 floors above ground (zh-Wikipedia)
    // x 5.5 m = 49.5 m — the cluster's tallest hall. The plate
    // is shifted east inside the outline: a service drive in the
    // geodata runs under the hall's west arcade (its roadbed
    // reaches tile x 152.2 at z -367), so the west face stops
    // east of it — the #42 trim convention.
    id: 'shin-kong-mitsukoshi-a9', name: 'Shin Kong Mitsukoshi Xinyi Place A9', nameZh: '新光三越信義新天地A9館',
    lat: 25.036641, lon: 121.566674, realHeight: 49.5, estimated: true, color: 0xc2b8a4,
    site: { w: 41, d: 149, dx: 0, dz: 0 },
    facade: { kind: 'prewar', stoneColor: 0xcac0ae, trimColor: 0x9d9480, windowGlassColor: 0x2c3e50, windowWidth: 3.4, floorHeight: 5.5, litProbability: 0.45, warmth: 0.6, seed: 165.33 },
    parts: [
      { type: 'box', w: 34, d: 145, h: 48, dx: 2.5 },
      { type: 'box', w: 35, d: 147, h: 1.5, y0: 48, dx: 2 },
    ],
  },
  {
    // Issue #165: Shin Kong Mitsukoshi Xinyi Place A11, Songsou
    // Rd 11 (opened 1997, the cluster's first hall) — the east
    // slab of the Xiangti Ave pair: OSM way 391309615's main-body
    // rect, 51.7 x 148 m axis-aligned at tile (227.2, -404.0).
    // The outline's narrow south tab is the skybridge toward
    // VieShow across Songshou Rd — NOT modelled (it would cross
    // the roadbed). Height ESTIMATED (flagged): 6 floors above
    // ground (zh-Wikipedia) x 5.5 m = 33 m. The plate is shifted
    // west inside the outline: the skybridge drive's roadbed
    // crosses the outline's east face at z -370 (it reaches tile
    // x 248.8), so the east face stops west of it — the #42 trim
    // convention.
    id: 'shin-kong-mitsukoshi-a11', name: 'Shin Kong Mitsukoshi Xinyi Place A11', nameZh: '新光三越信義新天地A11館',
    lat: 25.036641, lon: 121.567255, realHeight: 33, estimated: true, color: 0xcfc5ab,
    site: { w: 54, d: 150, dx: 0, dz: 0 },
    facade: { kind: 'prewar', stoneColor: 0xd8cdb4, trimColor: 0xa79b7f, windowGlassColor: 0x2c3e50, windowWidth: 3.4, floorHeight: 5.5, litProbability: 0.45, warmth: 0.6, seed: 165.34 },
    parts: [
      { type: 'box', w: 44, d: 146, h: 31.5, dx: -3 },
      { type: 'box', w: 46, d: 148, h: 1.5, y0: 31.5, dx: -3 },
    ],
  },
  {
    // Issue #255: TWTC Exhibition Hall 1 （台北世貿一館 / 展覽大樓）,
    // No. 5, Hsin-Yi Rd Sec 5 (opened 1986) — the four-in-one
    // TWTC complex's exhibition hall (EN Wikipedia). 7 floors,
    // 159,329 m²; no published height: height ESTIMATED (flagged)
    // 38 m — a tall showground floor + 6 upper floors. OSM way
    // 137077752's stepped outline wraps the International Trade
    // Building's east and south sides (see the #255 satellite
    // overlay); the plate below is the main mass only, trimmed
    // inside the outline, and the SW terrace lobe is a separate
    // wing so no part reaches the tower's plate. The signature
    // is the stepped ziggurat of green-tinted glass terraces
    // under the big dark-green glazed pyramid at the centre
    // (Esri z19 stitch, xinyi255-evidence/esri-twtc-overlaid.jpg).
    // The pyramid frustum is centred on the entry (the frustum
    // audit + renderer both centre it on the structure), so the
    // entry's lat/lon IS the pyramid centre, tile (-262, -112).
    id: 'twtc-exhibition-hall-1', name: 'TWTC Exhibition Hall 1', nameZh: '台北世貿一館',
    lat: 25.034011, lon: 121.562404, realHeight: 38, estimated: true, color: 0x5a7a68,
    site: { w: 212, d: 200, dx: -18, dz: -3 },
    facade: { kind: 'curtain', glassTint: 0x5a8a76, frameTint: 0x8a7f6a, windowWidth: 6.0, floorHeight: 5.5, litProbability: 0.3, warmth: 0.5, reflectivity: 0.5, seed: 255.11 },
    sign: { glyphs: 6, w: 34, h: 3.4, y: 7, dx: 0, dz: 86.5, bg: '#3a3f45', fg: '#ddd6c2' },
    parts: [
      { type: 'box', w: 168, d: 176, h: 12, dx: -2, dz: -2 },
      { type: 'box', w: 36, d: 44, h: 12, dx: -66, dz: -78 },
      { type: 'box', w: 150, d: 158, h: 10, y0: 12, dx: -2, dz: -2 },
      { type: 'box', w: 128, d: 136, h: 8, y0: 22, dx: -2, dz: -2 },
      { type: 'frustum', wB: 76, dB: 76, wT: 10, dT: 10, h: 8, y0: 30, flat: { color: 0x27584a, roughness: 0.35, metalness: 0.3 } },
    ],
    farParts: [
      { type: 'box', w: 168, d: 176, h: 12, dx: -2, dz: -2 },
      { type: 'box', w: 36, d: 44, h: 12, dx: -66, dz: -78 },
      { type: 'box', w: 150, d: 158, h: 10, y0: 12, dx: -2, dz: -2 },
      { type: 'box', w: 128, d: 136, h: 8, y0: 22, dx: -2, dz: -2 },
      { type: 'frustum', wB: 76, dB: 76, wT: 10, dT: 10, h: 8, y0: 30, flat: { color: 0x27584a, roughness: 0.35, metalness: 0.3 } },
    ],
  },
  {
    // Issue #255: Grand Hyatt Taipei （台北君悅酒店）, No. 2,
    // Songshou Rd (opened Sept 1990, architect Haigo T. H. Shen,
    // 853 rooms — EN Wikipedia / Hyatt). Height CONFLICT, resolved
    // for the published figure: EN Wikipedia 104 m / 27 stories
    // vs OSM way 137077760 height=85 / levels=25 — adopted 104 m
    // (27 floors x ~3.8 m fits it). OSM's #F5DEB3 wheat colour
    // is wrong against the satellite: the tower reads as a
    // brown-bronze gridded curtain wall. Massing: a three-sided
    // courtyard block (nickkembel.com: "shaped like a three-sided
    // courtyard home … looking down on a swimming pool on the
    // rooftop of the five-story lobby") — 18 m podium, three
    // 86 m wings around the pool court open to the south
    // (Songshou Rd entrance), octagonal terracotta roof feature
    // on the north wing (satellite). Entrance wordmark only: no
    // rooftop sign could be verified, so none is modelled.
    id: 'grand-hyatt-taipei', name: 'Grand Hyatt Taipei', nameZh: '台北君悅酒店',
    lat: 25.035310, lon: 121.562638, realHeight: 104, color: 0x6b563e,
    site: { w: 136, d: 82, dx: 0, dz: 0 },
    facade: { kind: 'curtain', glassTint: 0x7a5f43, frameTint: 0x4a3826, windowWidth: 3.2, floorHeight: 3.8, litProbability: 0.35, warmth: 0.6, reflectivity: 0.4, seed: 255.12 },
    sign: { text: 'GRAND HYATT', w: 30, h: 3, y: 8, dx: 0, dz: 39.6, bg: '#3a2e20', fg: '#e8dcc0' },
    parts: [
      { type: 'box', w: 132, d: 78, h: 18 },
      { type: 'box', w: 132, d: 30, h: 86, y0: 18, dz: -24 },
      { type: 'box', w: 28, d: 40, h: 86, y0: 18, dx: 52, dz: -4 },
      { type: 'box', w: 28, d: 40, h: 86, y0: 18, dx: -52, dz: -4 },
      { type: 'cylinder', r: 10, h: 0.6, y0: 18, dx: 0, dz: 8, flat: 0x7fa8b8 },
      { type: 'cylinder', r: 13, h: 4, y0: 104, dx: 0, dz: -24, flat: 0xc98a6b },
    ],
    farParts: [
      { type: 'box', w: 132, d: 78, h: 18 },
      { type: 'box', w: 132, d: 30, h: 86, y0: 18, dz: -24 },
      { type: 'box', w: 28, d: 40, h: 86, y0: 18, dx: 52, dz: -4 },
      { type: 'box', w: 28, d: 40, h: 86, y0: 18, dx: -52, dz: -4 },
    ],
  },
  {
    // Issue #255: ATT 4 FUN, No. 12, Songshou Rd (opened 29 Aug
    // 2011, architect Kris Yao — EN/zh Wikipedia): the 2010
    // refit of New York New York (opened Mar 2000, American
    // modern style). Floor counts CONFLICT: EN Wikipedia 10
    // above / 3 below vs the zh-Wikipedia table's 11 above / 1
    // below (B2–B3 parking) — adopted 11 x 4.2 m = 46 m
    // ESTIMATED (flagged). OSM way 234589397, dark grey
    // (#696969): a dark-glass curtain box, setback top floor,
    // roof terraces, the 'ATT 4 FUN' facade wordmark. NO red
    // steel frame — the red frame in the user's photo is A8's
    // (see the A8 entry + xinyi255-evidence/REFERENCE_PACK.md).
    id: 'att-4-fun', name: 'ATT 4 FUN', nameZh: 'ATT 4 FUN',
    lat: 25.035328, lon: 121.566041, realHeight: 46, estimated: true, color: 0x696969,
    site: { w: 54, d: 88, dx: 0, dz: 0 },
    facade: { kind: 'curtain', glassTint: 0x2e3438, frameTint: 0x1c1f22, windowWidth: 4.2, floorHeight: 4.2, litProbability: 0.5, warmth: 0.5, reflectivity: 0.6, seed: 255.13 },
    sign: { text: 'ATT 4 FUN', w: 26, h: 4, y: 30, dx: 0, dz: 42.6, bg: '#101114', fg: '#f2f2f2', accent: '#c8372d' },
    parts: [
      { type: 'box', w: 50, d: 84, h: 39 },
      { type: 'box', w: 44, d: 60, h: 5, y0: 39, dz: -8 },
      { type: 'box', w: 20, d: 14, h: 2, y0: 44, dx: -10, dz: -12 },
      { type: 'box', w: 14, d: 10, h: 2, y0: 44, dx: 12, dz: 6 },
    ],
    farParts: [
      { type: 'box', w: 50, d: 84, h: 39 },
      { type: 'box', w: 44, d: 60, h: 5, y0: 39, dz: -8 },
    ],
  },
  {
    // Issue #255: Bellavita （寶麗廣塲）, No. 28, Songren Rd
    // (opened 21 Sept 2009, 9 floors above / 4 below, 49,593 m²,
    // architects P&T Group & Chu-Yuan Lee — EN Wikipedia).
    // European palace style with an atrium fountain + palms;
    // height ESTIMATED (flagged) 42 m (9 floors x ~4.5 m +
    // corner pavilions). OSM way 274646859: the satellite shows
    // the cream palace block, the central OVAL glass skylight
    // dome and the patterned roof borders (see
    // esri-xinyi-overlaid.jpg). NOT the Taichung "La Bella
    // Vita" residential tower that shares search results.
    id: 'bellavita', name: 'Bellavita', nameZh: '寶麗廣塲',
    lat: 25.039680, lon: 121.567725, realHeight: 42, estimated: true, color: 0xddd3b8,
    site: { w: 100, d: 68, dx: 0, dz: 0 },
    facade: { kind: 'prewar', stoneColor: 0xddd3b8, trimColor: 0xb5a888, windowGlassColor: 0x3a4a52, windowWidth: 3.0, floorHeight: 4.5, litProbability: 0.4, warmth: 0.7, seed: 255.14 },
    sign: { text: 'BELLAVITA', w: 34, h: 3.6, y: 12, dx: -48.6, dz: 0, rotY: -Math.PI / 2, bg: '#2e2a20', fg: '#e8d9a8' },
    parts: [
      { type: 'box', w: 96, d: 64, h: 36 },
      { type: 'box', w: 98, d: 66, h: 2, y0: 36 },
      { type: 'box', w: 14, d: 14, h: 42, dx: -40, dz: -24 },
      { type: 'box', w: 14, d: 14, h: 42, dx: 40, dz: -24 },
      { type: 'box', w: 14, d: 14, h: 42, dx: -40, dz: 24 },
      { type: 'box', w: 14, d: 14, h: 42, dx: 40, dz: 24 },
      { type: 'dome', rx: 26, rz: 17, h: 6, y0: 38, flat: { color: 0xbfd4cc, roughness: 0.25, metalness: 0.4 } },
    ],
    farParts: [
      { type: 'box', w: 96, d: 64, h: 36 },
      { type: 'box', w: 98, d: 66, h: 2, y0: 36 },
      { type: 'box', w: 14, d: 14, h: 42, dx: -40, dz: -24 },
      { type: 'box', w: 14, d: 14, h: 42, dx: 40, dz: -24 },
      { type: 'box', w: 14, d: 14, h: 42, dx: -40, dz: 24 },
      { type: 'box', w: 14, d: 14, h: 42, dx: 40, dz: 24 },
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
    // Taipei Twin Towers (issue #135): the COMPLETED design
    // west of Taipei Main Station, modelled ahead of the real
    // towers (construction began 2022-11-11; completion 2027
    // per Taipei DORTS). Two blue-glass towers of unequal
    // height over the C1/D1 parcels between the station and
    // 延平北路一段:
    //   D1 (west parcel): 369 m overall — SOM's project page
    //     (som.com/projects/taipei-twin-towers: building height
    //     369 m, 73 stories, site area 31,600 m² for the pair)
    //     and contractor Kumagai Gumi's release (D1 369 m /
    //     73F, C1 289 m / 56F). Taipei DORTS gives D1 70 floors
    //     / ~360 m to the main roof, so the model's shaft steps
    //     to 349 and a 20 m crown step closes to 369.
    //   C1 (east parcel): 289 m overall (Kumagai Gumi, above;
    //     DORTS: 53 floors / ~280 m) — shaft steps to 279 and
    //     a 10 m crown step closes to 289.
    // Tower plates measured from the OSM construction
    // outlines (taiwan.osm.pbf 2026-10-23): D1 = way
    // 1502280746, min-area rect 76 × 48 m axis-aligned E-W;
    // C1 = way 1502280687, 66 × 42 m with its long axis at
    // +11.4° in the tile plane — the station grid's skew (cf.
    // the station's rotY 0.1859) — so C1's parts carry rotY
    // 0.199 and D1's none. NO podium bridges 重慶北路一段,
    // which splits the parcels: one slab per parcel, south
    // edges aligned so the pair reads as the renders' shared
    // podium (27 m — the terraced base reads about 1/13 of
    // D1's height in SOM's renders; the design's mid-rise
    // slabs behind the towers are not modelled). The design's bullet taper reads as three shaft
    // steps + a crown step per tower. site = the C1 parcel
    // (OSM block way 204616538), plaza = the D1 parcel (way
    // 204616537) — the City Hall precedent: exclusion without
    // mass, so both parcels stay lot-free.
    id: 'taipei-twin-towers', name: 'Taipei Twin Towers', nameZh: '台北雙子星',
    lat: 25.04877, lon: 121.51316, realHeight: 369, color: 0x3a5570,
    site: { w: 163, d: 160, dx: 114, dz: 32 },
    plaza: { w: 165, d: 160, dx: -66, dz: -12 },
    facade: { kind: 'curtain', glassTint: 0x2c4a68, frameTint: 0xb9c6d2, windowWidth: 2.8, floorHeight: 4.6, litProbability: 0.3, warmth: 0.35, reflectivity: 0.93, seed: 135.1 },
    parts: [
      // D1 podium (west parcel), trimmed to the parcel's
      // road frame: south edge north of the station pickup
      // lanes along 北平西路 (ribbons at z ≈ -1696..-1709),
      // west edge clear of the slanting 延平北路一段 ribbon,
      // north edge south of 鄭州路.
      { type: 'box', w: 112, d: 95, h: 27, dx: -76, dz: -12, facade: { kind: 'curtain', glassTint: 0x7d94a8, frameTint: 0xd9dde1, windowWidth: 3.4, floorHeight: 4.4, litProbability: 0.28, warmth: 0.4, seed: 135.2 } },
      // D1 tower, 369 m: measured 76 × 48 plate, stepped.
      { type: 'box', w: 74, d: 46, h: 208, dx: -90, dz: -10 },
      { type: 'box', w: 67, d: 42, h: 96, y0: 208, dx: -90, dz: -10 },
      { type: 'box', w: 58, d: 37, h: 45, y0: 304, dx: -90, dz: -10 },
      { type: 'box', w: 47, d: 30, h: 20, y0: 349, dx: -90, dz: -10 },
      // C1 podium (east parcel, on the station grid's skew),
      // in two boxes: no single rotated slab both contains
      // the tower plate and clears the parcel's road frame
      // (the 鄭州路/市民大道 curve north, the pickup lanes
      // south — measured against the #42 audit) — so a plinth
      // fitted to the tower plate plus a lower terrace
      // reaching east toward the station, stepped 0.6 m down
      // where they overlap.
      { type: 'box', w: 88, d: 50, h: 27, dx: 92, dz: 8, rotY: 0.199, facade: { kind: 'curtain', glassTint: 0x7d94a8, frameTint: 0xd9dde1, windowWidth: 3.4, floorHeight: 4.4, litProbability: 0.28, warmth: 0.4, seed: 135.3 } },
      { type: 'box', w: 120, d: 48, h: 26.4, dx: 125, dz: 8, rotY: 0.199, facade: { kind: 'curtain', glassTint: 0x7d94a8, frameTint: 0xd9dde1, windowWidth: 3.4, floorHeight: 4.4, litProbability: 0.28, warmth: 0.4, seed: 135.3 } },
      // C1 tower, 289 m: measured 66 × 42 plate at rotY 0.199.
      { type: 'box', w: 64, d: 40, h: 188, dx: 92, dz: 12, rotY: 0.199 },
      { type: 'box', w: 58, d: 37, h: 66, y0: 188, dx: 92, dz: 12, rotY: 0.199 },
      { type: 'box', w: 51, d: 33, h: 25, y0: 254, dx: 92, dz: 12, rotY: 0.199 },
      { type: 'box', w: 42, d: 28, h: 10, y0: 279, dx: 92, dz: 12, rotY: 0.199 },
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
    // Issue #138 (detail pass): the hall's walls are now BLANK
    // white stone (flat) — the cited photos (facing-evidence/
    // refs/photo-cks-1/2) show no openings but the great arch
    // and the red plaque, so the prewar window grid the block
    // used to carry is gone (the #131 gate folded into #138).
    // The #98 hall-face staircase came out: in the photos the
    // 89 steps climb the TERRACE only (84 granite + 5 hall
    // steps, zh-Wikipedia) and the arch's sill is the terrace
    // top — the old stair mass hid the lower wall and squeezed
    // the arch into a slit at y0 24. The arch is rebuilt at the
    // terrace top at the bronze doors' published scale (the
    // doors are 16 m tall): stepped dark opening, bronze door
    // leaf, pale surround, plaque above. The terrace treads
    // widen 26 -> 40 m (photo: twin stairs + the carved 御路
    // span most of the front) and gain their ramp strips. The
    // Liberty Square Arch （自由廣場牌樓， 30 m tall x 80 m wide,
    // 五間六柱， zh-Wikipedia) is added below at the west wall's
    // 38 m gate gap, its centre 7 m inside the wall line so its
    // 80 m span clears the wall ends; published distance from
    // the hall's centre line is 470 m (the modelled gap centre
    // sits at 465 m on the same axis). Finial slims 3.2 -> 2.4
    // (the audit's oversized-finial note).
    id: 'chiang-kai-shek-memorial-hall', name: 'Chiang Kai-shek Memorial Hall', nameZh: '中正紀念堂',
    lat: 25.034811, lon: 121.521519, realHeight: 70, color: 0xdfd9cc,
    site: { w: 150, d: 150, dx: 0, dz: 0 },
    facade: { kind: 'prewar', stoneColor: 0xe9e5db, trimColor: 0xcac4b4, windowGlassColor: 0x2e3a46, windowWidth: 3.4, floorHeight: 5.2, litProbability: 0.22, warmth: 0.6, seed: 57.29 },
    parts: [
      { type: 'box', w: 118, d: 118, h: 4.8, rotY: 0.4924, flat: 0xa39a8b },
      { type: 'box', w: 104, d: 104, h: 4.8, y0: 4.8, rotY: 0.4924, flat: 0xa39a8b },
      { type: 'box', w: 90, d: 90, h: 4.9, y0: 9.6, rotY: 0.4924, flat: 0xaca294 },
      // Issue #138 gate revision: the hall body BATTERS — the
      // photos show walls visibly wider at the base than at the
      // top. The straight 62 m box becomes six stepped tiers,
      // plan 66 -> 59 m over the 26 m wall height. The tiers are
      // offset along the local x so the WEST face stays on the
      // plane the #138 arch assembly is seated on (arch, plaque
      // and stairs untouched); the taper reads on the other
      // three faces and in the front silhouette's width.
      { type: 'box', w: 66, d: 66, h: 4.33, y0: 14.5, dx: 1.8, dz: 0.9, rotY: 0.4924, flat: 0xe9e5db },
      { type: 'box', w: 64.6, d: 64.6, h: 4.33, y0: 18.83, dx: 1.1, dz: 0.6, rotY: 0.4924, flat: 0xe9e5db },
      { type: 'box', w: 63.2, d: 63.2, h: 4.33, y0: 23.17, dx: 0.5, dz: 0.3, rotY: 0.4924, flat: 0xe9e5db },
      { type: 'box', w: 61.8, d: 61.8, h: 4.33, y0: 27.5, dx: -0.1, dz: 0, rotY: 0.4924, flat: 0xe9e5db },
      { type: 'box', w: 60.4, d: 60.4, h: 4.33, y0: 31.83, dx: -0.7, dz: -0.4, rotY: 0.4924, flat: 0xe9e5db },
      { type: 'box', w: 59, d: 59, h: 4.33, y0: 36.17, dx: -1.3, dz: -0.7, rotY: 0.4924, flat: 0xe9e5db },
      // Issue #138: moulded base + cornice bands on the blank
      // hall block, a pale fascia under the first eave tier and
      // a lighter-blue ridge cap under the finial. The base and
      // cornice bands follow the battered tiers they wrap (the
      // base band rides tier 1's offset, the cornice tier 6's).
      { type: 'box', w: 67.2, d: 67.2, h: 1.8, y0: 14.5, dx: 1.8, dz: 0.9, rotY: 0.4924, flat: 0xd9d3c3 },
      { type: 'box', w: 60.4, d: 60.4, h: 1.5, y0: 39.0, dx: -1.3, dz: -0.7, rotY: 0.4924, flat: 0xf0ebdf },
      { type: 'box', w: 71, d: 71, h: 0.8, y0: 39.9, rotY: 0.4924, flat: 0xe9e5db },
      { type: 'box', w: 20, d: 4.5, h: 1.2, y0: 62.2, rotY: 0.4924, flat: 0x2a5a9e },
      // Issue #116: the two blue eave frustums as stepped box
      // tiers (see the entry note). Issue #138 gate revision:
      // the profile is re-cut so the DOUBLE EAVE reads — a wide,
      // flatter lower skirt (80 -> 71 m over 8 m, flaring past
      // the battered body) under a steeper upper roof (65 ->
      // 43 m over 14 m). Same total roof height (40.5 -> 62.5).
      { type: 'box', w: 80, d: 80, h: 2, y0: 40.5, rotY: 0.4924, flat: 0x1e4d8c },
      { type: 'box', w: 77, d: 77, h: 2, y0: 42.5, rotY: 0.4924, flat: 0x1e4d8c },
      { type: 'box', w: 74, d: 74, h: 2, y0: 44.5, rotY: 0.4924, flat: 0x1e4d8c },
      { type: 'box', w: 71, d: 71, h: 2, y0: 46.5, rotY: 0.4924, flat: 0x1e4d8c },
      { type: 'box', w: 65, d: 65, h: 2.8, y0: 48.5, rotY: 0.4924, flat: 0x1e4d8c },
      { type: 'box', w: 59.5, d: 59.5, h: 2.8, y0: 51.3, rotY: 0.4924, flat: 0x1e4d8c },
      { type: 'box', w: 54, d: 54, h: 2.8, y0: 54.1, rotY: 0.4924, flat: 0x1e4d8c },
      { type: 'box', w: 48.5, d: 48.5, h: 2.8, y0: 56.9, rotY: 0.4924, flat: 0x1e4d8c },
      { type: 'box', w: 43, d: 43, h: 2.8, y0: 59.7, rotY: 0.4924, flat: 0x1e4d8c },
      { type: 'cylinder', r: 2.4, h: 7.5, y0: 62.5, flat: 0xcfa14e },
      // Issue #98: the front the references show, authored on
      // the WEST face (the Liberty Square side): the stair
      // climbs the terrace's west face in three giant treads.
      // Issue #138: treads widened to the photos' span and
      // given the pale central 御路 ramp strips; the arch now
      // sits at the terrace top — pale surround proudest, the
      // stepped dark opening behind it, the bronze door leaf
      // (16 m doors, zh-Wikipedia) inset at its base, the red
      // plaque above the surround.
      { type: 'box', w: 40, d: 5, h: 4.8, dx: -54.3, dz: -28.9, rotY: 0.4924, flat: 0xb3aa99 },
      { type: 'box', w: 40, d: 7, h: 9.6, dx: -49.0, dz: -26.1, rotY: 0.4924, flat: 0xb3aa99 },
      { type: 'box', w: 40, d: 9, h: 14.5, dx: -43.7, dz: -23.3, rotY: 0.4924, flat: 0xb3aa99 },
      { type: 'box', w: 5, d: 11, h: 0.32, y0: 4.8, dx: -54.2, dz: -29.1, rotY: 0.4924, flat: 0xefe9db },
      { type: 'box', w: 7, d: 11, h: 0.32, y0: 9.6, dx: -48.9, dz: -26.2, rotY: 0.4924, flat: 0xefe9db },
      { type: 'box', w: 9, d: 11, h: 0.32, y0: 14.5, dx: -43.6, dz: -23.4, rotY: 0.4924, flat: 0xefe9db },
      { type: 'box', w: 1.8, d: 2.4, h: 18.6, y0: 14.5, dx: -24.4, dz: -21.5, rotY: 0.4924, flat: 0xf2ecdd },
      { type: 'box', w: 1.8, d: 2.4, h: 18.6, y0: 14.5, dx: -31.4, dz: -8.5, rotY: 0.4924, flat: 0xf2ecdd },
      { type: 'box', w: 1.8, d: 17.2, h: 1.7, y0: 33.2, dx: -27.9, dz: -15.0, rotY: 0.4924, flat: 0xf2ecdd },
      { type: 'box', w: 0.8, d: 12.4, h: 15.0, y0: 14.5, dx: -28.1, dz: -15.1, rotY: 0.4924, flat: 0x16110c },
      { type: 'box', w: 0.8, d: 9.6, h: 1.9, y0: 29.5, dx: -28.1, dz: -15.1, rotY: 0.4924, flat: 0x16110c },
      { type: 'box', w: 0.8, d: 6.2, h: 1.7, y0: 31.4, dx: -28.1, dz: -15.1, rotY: 0.4924, flat: 0x16110c },
      { type: 'box', w: 0.5, d: 8.6, h: 8.0, y0: 14.5, dx: -28.4, dz: -15.2, rotY: 0.4924, flat: { color: 0x6b4f2e, roughness: 0.5, metalness: 0.6 } },
      { type: 'box', w: 0.7, d: 3.6, h: 4.6, y0: 35.4, dx: -27.8, dz: -14.9, rotY: 0.4924, flat: 0x7a2e22 },
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
      { type: 'box', w: 142.9, d: 0.8, h: 3, dx: -385.1, dz: -305.1, rotY: 1.8592, flat: 0xe9e4d4, despawnFar: true },
      { type: 'box', w: 142.9, d: 1.7, h: 0.55, y0: 3, dx: -385.1, dz: -305.1, rotY: 1.8592, flat: 0x2c4a7c, despawnFar: true },
      { type: 'box', w: 157.5, d: 0.8, h: 3, dx: -438.7, dz: -124.6, rotY: 1.8592, flat: 0xe9e4d4, despawnFar: true },
      { type: 'box', w: 157.5, d: 1.7, h: 0.55, y0: 3, dx: -438.7, dz: -124.6, rotY: 1.8592, flat: 0x2c4a7c, despawnFar: true },
      { type: 'box', w: 260.5, d: 0.8, h: 3, dx: -342.4, dz: 20.4, rotY: 0.4872, flat: 0xe9e4d4, despawnFar: true },
      { type: 'box', w: 260.5, d: 1.7, h: 0.55, y0: 3, dx: -342.4, dz: 20.4, rotY: 0.4872, flat: 0x2c4a7c, despawnFar: true },
      { type: 'box', w: 138.7, d: 0.8, h: 3, dx: -151.9, dz: 121.4, rotY: 0.4872, flat: 0xe9e4d4, despawnFar: true },
      { type: 'box', w: 138.7, d: 1.7, h: 0.55, y0: 3, dx: -151.9, dz: 121.4, rotY: 0.4872, flat: 0x2c4a7c, despawnFar: true },
      { type: 'box', w: 171.8, d: 0.8, h: 3, dx: -0.6, dz: 201.5, rotY: 0.4872, flat: 0xe9e4d4, despawnFar: true },
      { type: 'box', w: 171.8, d: 1.7, h: 0.55, y0: 3, dx: -0.6, dz: 201.5, rotY: 0.4872, flat: 0x2c4a7c, despawnFar: true },
      { type: 'box', w: 336.7, d: 0.8, h: 3, dx: 164.3, dz: 91.6, rotY: -1.0704, flat: 0xe9e4d4, despawnFar: true },
      { type: 'box', w: 336.7, d: 1.7, h: 0.55, y0: 3, dx: 164.3, dz: 91.6, rotY: -1.0704, flat: 0x2c4a7c, despawnFar: true },
      { type: 'box', w: 176.3, d: 0.8, h: 3, dx: 164.4, dz: -104.8, rotY: -2.6617, flat: 0xe9e4d4, despawnFar: true },
      { type: 'box', w: 176.3, d: 1.7, h: 0.55, y0: 3, dx: 164.4, dz: -104.8, rotY: -2.6617, flat: 0x2c4a7c, despawnFar: true },
      { type: 'box', w: 138.2, d: 0.8, h: 3, dx: 10.7, dz: -184.8, rotY: -2.6617, flat: 0xe9e4d4, despawnFar: true },
      { type: 'box', w: 138.2, d: 1.7, h: 0.55, y0: 3, dx: 10.7, dz: -184.8, rotY: -2.6617, flat: 0x2c4a7c, despawnFar: true },
      { type: 'box', w: 330.3, d: 0.8, h: 3, dx: -211.3, dz: -300.3, rotY: -2.6617, flat: 0xe9e4d4, despawnFar: true },
      { type: 'box', w: 330.3, d: 1.7, h: 0.55, y0: 3, dx: -211.3, dz: -300.3, rotY: -2.6617, flat: 0x2c4a7c, despawnFar: true },
      // Issue #138: the Liberty Square Arch at the west
      // wall's gate gap (published 30 m tall x 80 m wide,
      // five bays / six pillars, blue tile roofs — zh-
      // Wikipedia). Six pillars with plinth bases, stepped
      // arch heads, a stepped frieze, dark plaque panels and
      // stepped blue roofs (centre 30.4 m, mid 24.5, ends
      // 21.9); the roofs use 0x26548f, a shade off the hall
      // eaves' 0x1e4d8c, so the test's six-eave pin stands.
      { type: 'box', w: 5.6, d: 6.4, h: 1.2, dx: -393.9, dz: -251.5, rotY: 1.8592, flat: 0xdfd9c8 },
      { type: 'box', w: 4, d: 5, h: 15.8, dx: -393.9, dz: -251.5, rotY: 1.8592, flat: 0xe9e4d4 },
      { type: 'box', w: 5.6, d: 6.4, h: 1.2, dx: -397.3, dz: -240.0, rotY: 1.8592, flat: 0xdfd9c8 },
      { type: 'box', w: 4, d: 5, h: 15.8, dx: -397.3, dz: -240.0, rotY: 1.8592, flat: 0xe9e4d4 },
      { type: 'box', w: 6.6, d: 6.4, h: 1.2, dx: -401.7, dz: -225.2, rotY: 1.8592, flat: 0xdfd9c8 },
      { type: 'box', w: 5, d: 5, h: 18, dx: -401.7, dz: -225.2, rotY: 1.8592, flat: 0xe9e4d4 },
      { type: 'box', w: 6.6, d: 6.4, h: 1.2, dx: -407.7, dz: -205.0, rotY: 1.8592, flat: 0xdfd9c8 },
      { type: 'box', w: 5, d: 5, h: 18, dx: -407.7, dz: -205.0, rotY: 1.8592, flat: 0xe9e4d4 },
      { type: 'box', w: 5.6, d: 6.4, h: 1.2, dx: -412.1, dz: -190.2, rotY: 1.8592, flat: 0xdfd9c8 },
      { type: 'box', w: 4, d: 5, h: 15.8, dx: -412.1, dz: -190.2, rotY: 1.8592, flat: 0xe9e4d4 },
      { type: 'box', w: 5.6, d: 6.4, h: 1.2, dx: -415.5, dz: -178.7, rotY: 1.8592, flat: 0xdfd9c8 },
      { type: 'box', w: 4, d: 5, h: 15.8, dx: -415.5, dz: -178.7, rotY: 1.8592, flat: 0xe9e4d4 },
      { type: 'box', w: 15, d: 5, h: 1.6, y0: 15.5, dx: -404.7, dz: -215.1, rotY: 1.8592, flat: 0xe9e4d4 },
      { type: 'box', w: 11, d: 5, h: 1.5, y0: 17.1, dx: -404.7, dz: -215.1, rotY: 1.8592, flat: 0xe9e4d4 },
      { type: 'box', w: 6.5, d: 5, h: 1.4, y0: 18.6, dx: -404.7, dz: -215.1, rotY: 1.8592, flat: 0xe9e4d4 },
      { type: 'box', w: 10.5, d: 5, h: 1.5, y0: 12.8, dx: -399.4, dz: -232.8, rotY: 1.8592, flat: 0xe9e4d4 },
      { type: 'box', w: 7.5, d: 5, h: 1.4, y0: 14.3, dx: -399.4, dz: -232.8, rotY: 1.8592, flat: 0xe9e4d4 },
      { type: 'box', w: 4, d: 5, h: 1.3, y0: 15.7, dx: -399.4, dz: -232.8, rotY: 1.8592, flat: 0xe9e4d4 },
      { type: 'box', w: 10.5, d: 5, h: 1.5, y0: 12.8, dx: -410.0, dz: -197.4, rotY: 1.8592, flat: 0xe9e4d4 },
      { type: 'box', w: 7.5, d: 5, h: 1.4, y0: 14.3, dx: -410.0, dz: -197.4, rotY: 1.8592, flat: 0xe9e4d4 },
      { type: 'box', w: 4, d: 5, h: 1.3, y0: 15.7, dx: -410.0, dz: -197.4, rotY: 1.8592, flat: 0xe9e4d4 },
      { type: 'box', w: 7.5, d: 5, h: 1.4, y0: 10, dx: -395.6, dz: -245.8, rotY: 1.8592, flat: 0xe9e4d4 },
      { type: 'box', w: 5, d: 5, h: 1.3, y0: 11.4, dx: -395.6, dz: -245.8, rotY: 1.8592, flat: 0xe9e4d4 },
      { type: 'box', w: 2.8, d: 5, h: 1.2, y0: 12.7, dx: -395.6, dz: -245.8, rotY: 1.8592, flat: 0xe9e4d4 },
      { type: 'box', w: 7.5, d: 5, h: 1.4, y0: 10, dx: -413.8, dz: -184.4, rotY: 1.8592, flat: 0xe9e4d4 },
      { type: 'box', w: 5, d: 5, h: 1.3, y0: 11.4, dx: -413.8, dz: -184.4, rotY: 1.8592, flat: 0xe9e4d4 },
      { type: 'box', w: 2.8, d: 5, h: 1.2, y0: 12.7, dx: -413.8, dz: -184.4, rotY: 1.8592, flat: 0xe9e4d4 },
      { type: 'box', w: 5.5, d: 5, h: 2, y0: 18, dx: -401.7, dz: -225.2, rotY: 1.8592, flat: 0xe9e4d4 },
      { type: 'box', w: 5.5, d: 5, h: 2, y0: 18, dx: -407.7, dz: -205.0, rotY: 1.8592, flat: 0xe9e4d4 },
      { type: 'box', w: 32, d: 5.6, h: 2.6, y0: 20, dx: -404.7, dz: -215.1, rotY: 1.8592, flat: 0xe9e4d4 },
      { type: 'box', w: 25, d: 5.6, h: 2.2, y0: 15.8, dx: -396.6, dz: -242.4, rotY: 1.8592, flat: 0xe9e4d4 },
      { type: 'box', w: 25, d: 5.6, h: 2.2, y0: 15.8, dx: -412.8, dz: -187.8, rotY: 1.8592, flat: 0xe9e4d4 },
      { type: 'box', w: 11, d: 0.4, h: 2.2, y0: 20.3, dx: -401.9, dz: -214.3, rotY: 1.8592, flat: 0x2e2a26 },
      { type: 'box', w: 11, d: 0.4, h: 2.2, y0: 20.3, dx: -407.5, dz: -215.9, rotY: 1.8592, flat: 0x2e2a26 },
      { type: 'box', w: 36, d: 7, h: 2.4, y0: 22.6, dx: -404.7, dz: -215.1, rotY: 1.8592, flat: 0x26548f },
      { type: 'box', w: 30, d: 7, h: 2.3, y0: 25, dx: -404.7, dz: -215.1, rotY: 1.8592, flat: 0x26548f },
      { type: 'box', w: 23, d: 7, h: 2.2, y0: 27.3, dx: -404.7, dz: -215.1, rotY: 1.8592, flat: 0x26548f },
      { type: 'box', w: 14, d: 7, h: 0.9, y0: 29.5, dx: -404.7, dz: -215.1, rotY: 1.8592, flat: 0x2a5a9e },
      { type: 'box', w: 19, d: 6.6, h: 2.3, y0: 18, dx: -397.9, dz: -238.1, rotY: 1.8592, flat: 0x26548f },
      { type: 'box', w: 14.5, d: 6.6, h: 2.2, y0: 20.3, dx: -397.9, dz: -238.1, rotY: 1.8592, flat: 0x26548f },
      { type: 'box', w: 10, d: 6.6, h: 2, y0: 22.5, dx: -397.9, dz: -238.1, rotY: 1.8592, flat: 0x26548f },
      { type: 'box', w: 19, d: 6.6, h: 2.3, y0: 18, dx: -411.5, dz: -192.1, rotY: 1.8592, flat: 0x26548f },
      { type: 'box', w: 14.5, d: 6.6, h: 2.2, y0: 20.3, dx: -411.5, dz: -192.1, rotY: 1.8592, flat: 0x26548f },
      { type: 'box', w: 10, d: 6.6, h: 2, y0: 22.5, dx: -411.5, dz: -192.1, rotY: 1.8592, flat: 0x26548f },
      { type: 'box', w: 12.5, d: 6.2, h: 2, y0: 18, dx: -394.6, dz: -249.1, rotY: 1.8592, flat: 0x26548f },
      { type: 'box', w: 9, d: 6.2, h: 1.9, y0: 20, dx: -394.6, dz: -249.1, rotY: 1.8592, flat: 0x26548f },
      { type: 'box', w: 12.5, d: 6.2, h: 2, y0: 18, dx: -414.8, dz: -181.1, rotY: 1.8592, flat: 0x26548f },
      { type: 'box', w: 9, d: 6.2, h: 1.9, y0: 20, dx: -414.8, dz: -181.1, rotY: 1.8592, flat: 0x26548f },
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
    // Issue #138: walls blanked to flat cream (the cited
    // front photo shows blank walls behind the colonnade —
    // the prewar window grid is gone) and the square front
    // authored: red pillar colonnade, pale frieze, glass
    // entrance and the grand stair down the plinth. The
    // front is the local +z face, toward the square.
    id: 'national-concert-hall', name: 'National Concert Hall', nameZh: '國家音樂廳',
    lat: 25.036985, lon: 121.519262, realHeight: 37, estimated: true, color: 0xdccfa9,
    site: { w: 126, d: 121, dx: 0, dz: 0 },
    facade: { kind: 'prewar', stoneColor: 0xe6d9bc, trimColor: 0xbfae87, windowGlassColor: 0x2a3644, windowWidth: 3.4, floorHeight: 5.0, litProbability: 0.26, warmth: 0.68, seed: 57.30 },
    parts: [
      { type: 'box', w: 110, d: 105, h: 5, rotY: 0.4924, flat: 0xa89c80 },
      { type: 'box', w: 94, d: 90, h: 15, y0: 5, rotY: 0.4924, flat: 0xe6d9bc },
      { type: 'box', w: 95.4, d: 91.4, h: 1.6, y0: 5, rotY: 0.4924, flat: 0xd8cba6 },
      { type: 'box', w: 1.7, d: 1.7, h: 12.5, y0: 5, dx: -57.4, dz: 22.3, rotY: 0.4924, flat: 0x9e2b23 },
      { type: 'box', w: 1.7, d: 1.7, h: 12.5, y0: 5, dx: -50.3, dz: 26.1, rotY: 0.4924, flat: 0x9e2b23 },
      { type: 'box', w: 1.7, d: 1.7, h: 12.5, y0: 5, dx: -43.3, dz: 29.9, rotY: 0.4924, flat: 0x9e2b23 },
      { type: 'box', w: 1.7, d: 1.7, h: 12.5, y0: 5, dx: -36.2, dz: 33.7, rotY: 0.4924, flat: 0x9e2b23 },
      { type: 'box', w: 1.7, d: 1.7, h: 12.5, y0: 5, dx: -29.2, dz: 37.5, rotY: 0.4924, flat: 0x9e2b23 },
      { type: 'box', w: 1.7, d: 1.7, h: 12.5, y0: 5, dx: -22.1, dz: 41.2, rotY: 0.4924, flat: 0x9e2b23 },
      { type: 'box', w: 1.7, d: 1.7, h: 12.5, y0: 5, dx: -15.1, dz: 45.0, rotY: 0.4924, flat: 0x9e2b23 },
      { type: 'box', w: 1.7, d: 1.7, h: 12.5, y0: 5, dx: -8.0, dz: 48.8, rotY: 0.4924, flat: 0x9e2b23 },
      { type: 'box', w: 1.7, d: 1.7, h: 12.5, y0: 5, dx: -1.0, dz: 52.6, rotY: 0.4924, flat: 0x9e2b23 },
      { type: 'box', w: 1.7, d: 1.7, h: 12.5, y0: 5, dx: 6.1, dz: 56.4, rotY: 0.4924, flat: 0x9e2b23 },
      { type: 'box', w: 1.7, d: 1.7, h: 12.5, y0: 5, dx: 13.1, dz: 60.1, rotY: 0.4924, flat: 0x9e2b23 },
      { type: 'box', w: 95, d: 2.2, h: 1.6, y0: 17.5, dx: -22.0, dz: 41.1, rotY: 0.4924, flat: 0x7d8b74 },
      { type: 'box', w: 17, d: 0.8, h: 7.5, y0: 5.5, dx: -21.5, dz: 40.0, rotY: 0.4924, flat: 0x1c2833 },
      { type: 'box', w: 30, d: 2.4, h: 4.95, dx: -25.4, dz: 47.3, rotY: 0.4924, flat: 0xbdb098 },
      { type: 'box', w: 30, d: 2.4, h: 3.3, dx: -26.5, dz: 49.4, rotY: 0.4924, flat: 0xbdb098 },
      { type: 'box', w: 30, d: 2.4, h: 1.65, dx: -27.7, dz: 51.6, rotY: 0.4924, flat: 0xbdb098 },
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
    // Issue #138: same blank-wall + square-front treatment
    // as the concert hall; the front is the local -z face,
    // toward the square.
    id: 'national-theater', name: 'National Theater', nameZh: '國家戲劇院',
    lat: 25.035319, lon: 121.518245, realHeight: 37, estimated: true, color: 0xdccfa9,
    site: { w: 130, d: 123, dx: 0, dz: 0 },
    facade: { kind: 'prewar', stoneColor: 0xe6d9bc, trimColor: 0xbfae87, windowGlassColor: 0x2a3644, windowWidth: 3.4, floorHeight: 5.0, litProbability: 0.26, warmth: 0.68, seed: 57.31 },
    parts: [
      { type: 'box', w: 114, d: 107, h: 5, rotY: 0.4924, flat: 0xa89c80 },
      { type: 'box', w: 98, d: 92, h: 15, y0: 5, rotY: 0.4924, flat: 0xe6d9bc },
      { type: 'box', w: 99.4, d: 93.4, h: 1.6, y0: 5, rotY: 0.4924, flat: 0xd8cba6 },
      { type: 'box', w: 1.7, d: 1.7, h: 12.5, y0: 5, dx: -14.4, dz: -62.0, rotY: 0.4924, flat: 0x9e2b23 },
      { type: 'box', w: 1.7, d: 1.7, h: 12.5, y0: 5, dx: -7.0, dz: -58.0, rotY: 0.4924, flat: 0x9e2b23 },
      { type: 'box', w: 1.7, d: 1.7, h: 12.5, y0: 5, dx: 0.4, dz: -54.0, rotY: 0.4924, flat: 0x9e2b23 },
      { type: 'box', w: 1.7, d: 1.7, h: 12.5, y0: 5, dx: 7.8, dz: -50.1, rotY: 0.4924, flat: 0x9e2b23 },
      { type: 'box', w: 1.7, d: 1.7, h: 12.5, y0: 5, dx: 15.2, dz: -46.1, rotY: 0.4924, flat: 0x9e2b23 },
      { type: 'box', w: 1.7, d: 1.7, h: 12.5, y0: 5, dx: 22.6, dz: -42.1, rotY: 0.4924, flat: 0x9e2b23 },
      { type: 'box', w: 1.7, d: 1.7, h: 12.5, y0: 5, dx: 30.0, dz: -38.2, rotY: 0.4924, flat: 0x9e2b23 },
      { type: 'box', w: 1.7, d: 1.7, h: 12.5, y0: 5, dx: 37.4, dz: -34.2, rotY: 0.4924, flat: 0x9e2b23 },
      { type: 'box', w: 1.7, d: 1.7, h: 12.5, y0: 5, dx: 44.8, dz: -30.2, rotY: 0.4924, flat: 0x9e2b23 },
      { type: 'box', w: 1.7, d: 1.7, h: 12.5, y0: 5, dx: 52.2, dz: -26.2, rotY: 0.4924, flat: 0x9e2b23 },
      { type: 'box', w: 1.7, d: 1.7, h: 12.5, y0: 5, dx: 59.6, dz: -22.3, rotY: 0.4924, flat: 0x9e2b23 },
      { type: 'box', w: 99, d: 2.2, h: 1.6, y0: 17.5, dx: 22.5, dz: -41.9, rotY: 0.4924, flat: 0x7d8b74 },
      { type: 'box', w: 17, d: 0.8, h: 7.5, y0: 5.5, dx: 21.9, dz: -40.9, rotY: 0.4924, flat: 0x1c2833 },
      { type: 'box', w: 30, d: 2.4, h: 4.95, dx: 25.9, dz: -48.2, rotY: 0.4924, flat: 0xbdb098 },
      { type: 'box', w: 30, d: 2.4, h: 3.3, dx: 27.0, dz: -50.3, rotY: 0.4924, flat: 0xbdb098 },
      { type: 'box', w: 30, d: 2.4, h: 1.65, dx: 28.1, dz: -52.4, rotY: 0.4924, flat: 0xbdb098 },
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
    // Issue #138 (detail pass): the cited front photo
    // (Wikipedia, from Ketagalan Boulevard) drives the new
    // detail — the red/white banding now exists as GEOMETRY
    // (thin white slabs at every floor line of the range and
    // both pavilions, over a grey stereobate base — the
    // official architecture page's own feature list), the
    // wings gain their pale-green hip roofs and the pavilions
    // their green pyramid caps (pavilions rise 27 -> 30 m as
    // in the photo), the entrance gains its stone portico
    // with the two guard towers the official page describes
    // flanking it (flat-roofed, +3.5 m over the range), and
    // the tower gets band rings, a white crown and a slate-
    // green stepped cap still topping out at exactly 60 m.
    // Facade grid retuned to the real five floors (5.4 m).
    id: 'presidential-office-building', name: 'Presidential Office Building', nameZh: '總統府',
    lat: 25.039994, lon: 121.511973, realHeight: 60, color: 0x9c5a41,
    site: { w: 110, d: 145, dx: 0, dz: 0 },
    facade: { kind: 'prewar', stoneColor: 0xa9603f, trimColor: 0xd9d0bd, windowGlassColor: 0x27313d, windowWidth: 3.2, floorHeight: 5.4, litProbability: 0.27, warmth: 0.58, seed: 57.32 },
    parts: [
      { type: 'box', w: 44, d: 130, h: 27, rotY: 0.0977 },
      { type: 'box', w: 54, d: 22, h: 30, dx: 5.3, dz: -53.7, rotY: 0.0977 },
      { type: 'box', w: 54, d: 22, h: 30, dx: -5.3, dz: 53.7, rotY: 0.0977 },
      // Issue #138 gate revision: the tower is SLENDER — the
      // photo puts it at ~1/8 of the facade width, where the old
      // 26 m block read at ~1/4 and barely cleared the wings.
      // The shaft is now 16.5 m square, still y0 27 and still
      // topping out (with its cap) at the published 60 m.
      { type: 'box', w: 16.5, d: 16.5, h: 27, y0: 27, rotY: 0.0977 },
      { type: 'box', w: 45.6, d: 131.6, h: 2.0, rotY: 0.0977, flat: 0x8d867b },
      { type: 'box', w: 44.7, d: 130.7, h: 0.85, y0: 5.0, rotY: 0.0977, flat: 0xd9d0bd },
      { type: 'box', w: 44.7, d: 130.7, h: 0.85, y0: 10.4, rotY: 0.0977, flat: 0xd9d0bd },
      { type: 'box', w: 44.7, d: 130.7, h: 0.85, y0: 15.8, rotY: 0.0977, flat: 0xd9d0bd },
      { type: 'box', w: 44.7, d: 130.7, h: 0.85, y0: 21.2, rotY: 0.0977, flat: 0xd9d0bd },
      { type: 'box', w: 45.2, d: 131.2, h: 1.1, y0: 25.9, rotY: 0.0977, flat: 0xd9d0bd },
      { type: 'box', w: 54.7, d: 22.7, h: 0.85, y0: 5.0, dx: 5.3, dz: -53.7, rotY: 0.0977, flat: 0xd9d0bd },
      { type: 'box', w: 54.7, d: 22.7, h: 0.85, y0: 10.4, dx: 5.3, dz: -53.7, rotY: 0.0977, flat: 0xd9d0bd },
      { type: 'box', w: 54.7, d: 22.7, h: 0.85, y0: 15.8, dx: 5.3, dz: -53.7, rotY: 0.0977, flat: 0xd9d0bd },
      { type: 'box', w: 54.7, d: 22.7, h: 0.85, y0: 21.2, dx: 5.3, dz: -53.7, rotY: 0.0977, flat: 0xd9d0bd },
      { type: 'box', w: 54.7, d: 22.7, h: 1.1, y0: 28.9, dx: 5.3, dz: -53.7, rotY: 0.0977, flat: 0xd9d0bd },
      { type: 'box', w: 54.7, d: 22.7, h: 0.85, y0: 5.0, dx: -5.3, dz: 53.7, rotY: 0.0977, flat: 0xd9d0bd },
      { type: 'box', w: 54.7, d: 22.7, h: 0.85, y0: 10.4, dx: -5.3, dz: 53.7, rotY: 0.0977, flat: 0xd9d0bd },
      { type: 'box', w: 54.7, d: 22.7, h: 0.85, y0: 15.8, dx: -5.3, dz: 53.7, rotY: 0.0977, flat: 0xd9d0bd },
      { type: 'box', w: 54.7, d: 22.7, h: 0.85, y0: 21.2, dx: -5.3, dz: 53.7, rotY: 0.0977, flat: 0xd9d0bd },
      { type: 'box', w: 54.7, d: 22.7, h: 1.1, y0: 28.9, dx: -5.3, dz: 53.7, rotY: 0.0977, flat: 0xd9d0bd },
      { type: 'box', w: 47, d: 133, h: 1.1, y0: 27, rotY: 0.0977, flat: 0x74907f },
      { type: 'box', w: 41, d: 124, h: 2.0, y0: 28.1, rotY: 0.0977, flat: 0x7fa08c },
      { type: 'box', w: 33, d: 112, h: 1.9, y0: 30.1, rotY: 0.0977, flat: 0x7fa08c },
      { type: 'box', w: 40, d: 18, h: 1.8, y0: 30, dx: 5.3, dz: -53.7, rotY: 0.0977, flat: 0x74907f },
      { type: 'box', w: 26, d: 12, h: 1.7, y0: 31.8, dx: 5.3, dz: -53.7, rotY: 0.0977, flat: 0x7fa08c },
      { type: 'box', w: 40, d: 18, h: 1.8, y0: 30, dx: -5.3, dz: 53.7, rotY: 0.0977, flat: 0x74907f },
      { type: 'box', w: 26, d: 12, h: 1.7, y0: 31.8, dx: -5.3, dz: 53.7, rotY: 0.0977, flat: 0x7fa08c },
      { type: 'box', w: 7, d: 11, h: 30.5, dx: 26.4, dz: -18.5, rotY: 0.0977 },
      { type: 'box', w: 7.7, d: 11.7, h: 0.9, y0: 30.5, dx: 26.4, dz: -18.5, rotY: 0.0977, flat: 0xd9d0bd },
      { type: 'box', w: 7, d: 11, h: 30.5, dx: 22.3, dz: 23.3, rotY: 0.0977 },
      { type: 'box', w: 7.7, d: 11.7, h: 0.9, y0: 30.5, dx: 22.3, dz: 23.3, rotY: 0.0977, flat: 0xd9d0bd },
      { type: 'box', w: 3, d: 18, h: 0.5, dx: 29.6, dz: 2.9, rotY: 0.0977, flat: 0xd9d0bd },
      { type: 'box', w: 3, d: 16.5, h: 0.5, y0: 0.5, dx: 28.1, dz: 2.8, rotY: 0.0977, flat: 0xd9d0bd },
      { type: 'box', w: 5.5, d: 14, h: 7.2, y0: 1.0, dx: 24.6, dz: 2.4, rotY: 0.0977, flat: 0xd9d0bd },
      { type: 'box', w: 6.5, d: 15.5, h: 0.8, y0: 8.2, dx: 24.6, dz: 2.4, rotY: 0.0977, flat: 0xcfc5ae },
      { type: 'box', w: 0.6, d: 5.5, h: 5.2, y0: 1.2, dx: 27.5, dz: 2.7, rotY: 0.0977, flat: 0x17120e },
      { type: 'box', w: 0.6, d: 1.8, h: 3.6, y0: 1.6, dx: 27.9, dz: -1.8, rotY: 0.0977, flat: 0x27313d },
      { type: 'box', w: 0.6, d: 1.8, h: 3.6, y0: 1.6, dx: 27.0, dz: 7.2, rotY: 0.0977, flat: 0x27313d },
      // Tower dress on the slender shaft (gate revision): the
      // white band rings keep their 7 m rhythm, shrunk to ride
      // just proud of the 16.5 m shaft; above the shaft top
      // (54 m) a white crown, then the slate-green stepped cap
      // and the small spire, still topping out at exactly 60 m.
      { type: 'box', w: 17.2, d: 17.2, h: 0.8, y0: 34, rotY: 0.0977, flat: 0xd9d0bd },
      { type: 'box', w: 17.2, d: 17.2, h: 0.8, y0: 41, rotY: 0.0977, flat: 0xd9d0bd },
      { type: 'box', w: 17.2, d: 17.2, h: 0.8, y0: 48, rotY: 0.0977, flat: 0xd9d0bd },
      { type: 'box', w: 18, d: 18, h: 2, y0: 54, rotY: 0.0977, flat: 0xd9d0bd },
      { type: 'box', w: 13.5, d: 13.5, h: 1.6, y0: 56, rotY: 0.0977, flat: 0x5d6d66 },
      { type: 'box', w: 9.5, d: 9.5, h: 1.4, y0: 57.6, rotY: 0.0977, flat: 0x5d6d66 },
      { type: 'box', w: 2, d: 2, h: 1, y0: 59, rotY: 0.0977, flat: 0x5d6d66 },
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
  {
    // Batch 7 (issue #144): 臺北表演藝術中心 — the Taipei
    // Performing Arts Center (OMA, opened 2022), immediately SW
    // of Jiantan station. A 12-storey central cube with three
    // theatres plugged into it: the Grand Theater (south), the
    // Blue Box (north) and the spherical Globe Playhouse (east)
    // — the "planet docking against the cube" of the user's
    // reference photo. Height 55 m PUBLISHED for the built
    // building (ASCE Civil Engineering Magazine, Jan 2023: "a
    // 12-story, 55 m tall central cube"; the 63 m in OMA's
    // project data is the competition scheme). The Chinese
    // structural paper （土木水利 42(2), 2015) gives the cube's
    // structural module as ~55 m tall, 50 × 50 m, the Grand
    // Theater 37 × 39 m plugged at 3F–8F of the south side and
    // the multiform theater 29 × 31 m at 3F–7F of the north.
    // Siting is measured from the OSM building relation
    // 13913132 (outline way 449040993 + its building:part ways),
    // fitted in the tile frame: the composition axis is the
    // cube's fitted centre and every box carries the outline's
    // measured axis, rotY −0.159 rad (−9.1° — both the west-face
    // chain and the north edge measure it). The cube's plan
    // envelope measures 56 × 59 m (the paper's 50 × 50 is the
    // braced core inside it) and the cube zone's WEST TOWER
    // slab 19 × 59 m along its west face. The two theatre boxes
    // take their OSM part footprints (GT 43.6 × 35.6,
    // MT 32.8 × 27.9)
    // at their plugged heights over the open plaza storey
    // (y0 9, the ground storey the whole composition is raised
    // on: corner pilotis + a ground core + the GT's own legs
    // stand in for the public-loop undercroft).
    // The sphere is an ELLIPSOID （實構築季刊： 橢圓形結構）: the
    // OSM part's arc fits a plan circle of R 22.1 m (max
    // residual 0.02 m) centred 28 m east of the cube centre
    // — the published cantilever is 26 m (New Atlas: "juts
    // outwards by 26 m"), measured from the cube's
    // structural face; against the OSM envelope's east
    // steps the disc stands 22 m proud, and the model keeps
    // the fitted disc position exactly. The Blue Box keeps
    // its part's exact size but sits 2 m south of the part's
    // north edge: the lane along the north face (OSM way
    // 1184381230) has its centreline drawn ON the building's
    // face line, so the lane's 5 m ribbon clips the true
    // footprint's NW corner by 0.91 m² in the issue-#42
    // audit — the closest legal siting, flagged here (the
    // Main Station's +11 m shift inside its outline, issue
    // #74, is the same medicine).
    // Vertically it is squashed: Ø 44 in plan × 34 tall,
    // spanning 19–53 m (the published 5F–12F band), crown
    // 2 m under the cube's 55 m roof, as the user's photo
    // shows. Two hemisphere parts
    // (one flipped) make the ball; the plan disc the issue-#42
    // audit tests is the OSM disc. The axis stands ~89 m SW of
    // the Jiantan guideway centreline; no part reaches the
    // MRT corridor, and the roadbed audit runs in the PR.
    id: 'taipei-performing-arts-center', name: 'Taipei Performing Arts Center', nameZh: '臺北表演藝術中心',
    lat: 25.085153, lon: 121.524222, realHeight: 55, color: 0x232d36,
    site: { w: 111, d: 137, dx: -1, dz: 5 },
    // The cube's corrugated dark glass (the theatres' matte
    // aluminium shells are flat overrides on their parts).
    facade: { kind: 'curtain', glassTint: 0x1c262f, frameTint: 0x707880, windowWidth: 2.4, floorHeight: 4.6, litProbability: 0.3, warmth: 0.5, reflectivity: 0.9, seed: 57.38 },
    parts: [
      { type: 'box', w: 19, d: 59, h: 48, dx: -34.8, dz: 5.8, rotY: -0.159, facade: { kind: 'curtain', glassTint: 0x151b21, frameTint: 0x565e63, windowWidth: 2.0, floorHeight: 4.0, litProbability: 0.26, warmth: 0.5, reflectivity: 0.85, seed: 57.39 } },
      { type: 'box', w: 26, d: 30, h: 9, dx: 0.3, dz: 2.0, rotY: -0.159, flat: 0x3d4143 },
      { type: 'box', w: 3.5, d: 3.5, h: 9, dx: 20.0, dz: -27.0, rotY: -0.159, flat: 0x53575a },
      { type: 'box', w: 3.5, d: 3.5, h: 9, dx: -23.5, dz: -20.0, rotY: -0.159, flat: 0x53575a },
      { type: 'box', w: 3.5, d: 3.5, h: 9, dx: 27.4, dz: 19.4, rotY: -0.159, flat: 0x53575a },
      { type: 'box', w: 3.5, d: 3.5, h: 9, dx: -16.0, dz: 26.4, rotY: -0.159, flat: 0x53575a },
      { type: 'box', w: 3.5, d: 3.5, h: 9, dx: -12.2, dz: 62.7, rotY: -0.159, flat: 0x53575a },
      { type: 'box', w: 3.5, d: 3.5, h: 9, dx: 19.4, dz: 57.6, rotY: -0.159, flat: 0x53575a },
      { type: 'box', w: 56, d: 59, h: 46, y0: 9, dx: 2.0, dz: -0.3, rotY: -0.159 },
      { type: 'box', w: 43.6, d: 35.6, h: 25, y0: 9, dx: 3.6, dz: 47.6, rotY: -0.159, flat: { color: 0xb7bbbd, roughness: 0.5, metalness: 0.3 } },
      { type: 'box', w: 32.8, d: 27.9, h: 20, y0: 9, dx: -13.9, dz: -39.7, rotY: -0.159, flat: { color: 0xb7bbbd, roughness: 0.5, metalness: 0.3 } },
      { type: 'dome', rx: 22, rz: 22, h: 17, y0: 36, dx: 29.6, dz: -4.5, flat: { color: 0xc2c5c7, roughness: 0.55, metalness: 0.25 } },
      { type: 'dome', rx: 22, rz: 22, h: 17, y0: 36, dx: 29.6, dz: -4.5, flip: true, flat: { color: 0xc2c5c7, roughness: 0.55, metalness: 0.25 } },
    ],
  },
  // Batch 8 (issue #166, Tianmu/Beitou): five registry entries —
  // a department store, the project's first stadium, and three
  // school campuses. All siting is measured from OSM footprints
  // (PBF extract) cross-checked against Esri satellite; heights
  // are floors × 3.6 m unless a figure is published, and every
  // height in this batch is flagged estimated except where the
  // registry comment says otherwise.
  {
    // Dayeh Takashimaya, 忠誠路二段 55號 — the Tianmu department
    // store inside the Red Line corridor strip. One slab on the
    // OSM outline (relation 6821492, lon 121.53111–121.53224,
    // lat 25.11118–25.11236): a 5F retail podium (21 m) fitted to
    // the outline's tilted frame (−0.175 rad — the corners are
    // pulled inboard of the outline so nothing crosses the
    // 忠誠路二段 / 53巷 carriageways), a lower NE shoulder block
    // (15 m, the parking annex under the outline's diagonal
    // north edge) and the taller east slab (parking + 12F top,
    // Wikipedia: 12 floors above ground) at 47 m ≈ 12 × 3.9 m —
    // no published metric height, so estimated. The mass split
    // is the satellite read (grey podium roof west, taller
    // slab east).
    id: 'dayeh-takashimaya', name: 'Dayeh Takashimaya', nameZh: '大葉高島屋',
    lat: 25.11177, lon: 121.531675, realHeight: 47, estimated: true, color: 0xd8c49c,
    site: { w: 122, d: 139, dx: 0, dz: 0 },
    facade: { kind: 'prewar', stoneColor: 0xd8c49c, trimColor: 0xb39b74, windowGlassColor: 0x2c3844, windowWidth: 3.4, floorHeight: 3.9, litProbability: 0.35, warmth: 0.6, seed: 57.41 },
    parts: [
      { type: 'box', w: 92, d: 110, h: 21, dx: 0, dz: -1, rotY: -0.175 },
      { type: 'box', w: 42, d: 26, h: 15, dx: 22, dz: -44, rotY: -0.175 },
      { type: 'box', w: 34, d: 108, h: 47, dx: 30, dz: -2, rotY: -0.175 },
    ],
  },
  {
    // Tianmu Baseball Stadium — stands bowl + light towers +
    // open field, generated by tianmuStadiumParts() (measured
    // siting and the tile-edge straddle are documented there and
    // on issue #166). 30 m is the light-tower estimate.
    id: 'tianmu-stadium', name: 'Tianmu Baseball Stadium', nameZh: '天母棒球場',
    lat: 25.11364, lon: 121.53314, realHeight: 30, estimated: true, color: 0xcfc8bb,
    site: { w: 190, d: 172, dx: 42, dz: -18 },
    facade: { kind: 'prewar', stoneColor: 0xcfc8bb, trimColor: 0xa9a294, windowGlassColor: 0x2e3a46, windowWidth: 4.5, floorHeight: 4.2, litProbability: 0.15, warmth: 0.5, seed: 57.42 },
    parts: tianmuStadiumParts(),
  },
  {
    // Shipai Junior High School — the eastern of the two Shipai
    // campuses (relation 4630268); the named OSM buildings are
    // modelled at their measured rects: 勤學樓 (way 202909351),
    // 七年級教室 (202909352), 八年級教室 (202909364), 辦公室
    // (202909365), 廁所大樓 (202909246), 活動中心 (sports_centre
    // 202909073) and the 風雨操場 roof (202909083) as posts + a
    // slab. The 操場 (202909068) is the flat painted track
    // capsule; 籃球場 (202909060) and 游泳池 (202909082) are flat
    // slabs. No OSM levels tags — classroom blocks at an
    // estimated 4F × 3.6 m.
    id: 'shipai-junior-high', name: 'Shipai Junior High School', nameZh: '石牌國中',
    lat: 25.1159, lon: 121.5136, realHeight: 14.4, estimated: true, color: 0xd9cfc0,
    site: { w: 212, d: 208, dx: 3, dz: 4 },
    facade: { kind: 'prewar', stoneColor: 0xd9cfc0, trimColor: 0xb0a58e, windowGlassColor: 0x2e3a46, windowWidth: 2.6, floorHeight: 3.6, litProbability: 0.25, warmth: 0.55, seed: 57.43 },
    parts: [
      { type: 'box', w: 86.4, d: 10.9, h: 14.4, dx: -20.2, dz: 65.3, rotY: -0.433 },
      { type: 'box', w: 100, d: 15, h: 14.4, dx: -31.8, dz: 34.2, rotY: -0.443 },
      { type: 'box', w: 113, d: 10.9, h: 14.4, dx: 11.1, dz: 89.7, rotY: -0.447 },
      { type: 'box', w: 62.7, d: 10.8, h: 14.4, dx: 23.2, dz: 44.3, rotY: 1.108 },
      { type: 'box', w: 14.5, d: 10.3, h: 7.2, dx: -47.5, dz: 96.4, rotY: 1.072 },
      { type: 'box', w: 30.7, d: 19.6, h: 10, dx: 50.4, dz: 11.1, rotY: 0.984 },
      { type: 'box', w: 0.9, d: 0.9, h: 6.5, dx: 49.6, dz: 30, flat: 0xb9bcbe },
      { type: 'box', w: 0.9, d: 0.9, h: 6.5, dx: 62, dz: 56.4, flat: 0xb9bcbe },
      { type: 'box', w: 0.9, d: 0.9, h: 6.5, dx: 30.8, dz: 38.8, flat: 0xb9bcbe },
      { type: 'box', w: 0.9, d: 0.9, h: 6.5, dx: 43.2, dz: 65.2, flat: 0xb9bcbe },
      { type: 'box', w: 31.3, d: 22.8, h: 0.7, y0: 6.5, dx: 46.4, dz: 47.6, rotY: 1.129, flat: 0x8a8d90 },
      ...trackCapsuleParts(-8.1, -45.4, 44, 48, 40, -2.107, 0xa04a30, 0x4e7d32),
      { type: 'box', w: 38.5, d: 57.3, h: 0.25, y0: 0.02, dx: -70.7, dz: -3.3, rotY: -0.419, flat: 0x3f6d8e },
      { type: 'box', w: 43.7, d: 29.3, h: 0.35, y0: 0.02, dx: 82.7, dz: 68.7, rotY: 1.117, flat: 0x3f8fbf },
    ],
  },
  {
    // Qingjiang Elementary School — campus fully inside the
    // tile (buildings span lon 121.50628–121.50783, lat
    // 25.12569–25.12721, west of the corridor's heart but well
    // east of its 121.494 edge). The five named 樓 at their OSM
    // rects: 丹鳳樓 (way 224819890), 陽明樓 (224823940, the only
    // one with an OSM levels tag: 4), 觀音樓 (224825864), 七星樓
    // (224826063), 大屯樓 (224826217), plus 活動中心 (224828172),
    // 幼兒園 (224826611) and the 小操場 (224826678) as a flat
    // painted field. Blocks at 4F × 3.6 m following 陽明樓's tag.
    id: 'qingjiang-elementary', name: 'Qingjiang Elementary School', nameZh: '清江國小',
    lat: 25.12645, lon: 121.50705, realHeight: 14.4, estimated: true, color: 0xd6c8b4,
    site: { w: 152, d: 168, dx: -5, dz: 3 },
    facade: { kind: 'prewar', stoneColor: 0xd6c8b4, trimColor: 0xab9c80, windowGlassColor: 0x2e3a46, windowWidth: 2.6, floorHeight: 3.6, litProbability: 0.25, warmth: 0.55, seed: 57.44 },
    parts: [
      { type: 'box', w: 40, d: 10.9, h: 14.4, dx: 52.5, dz: -15.5, rotY: 1.012 },
      { type: 'box', w: 26.4, d: 12.7, h: 14.4, dx: 22.2, dz: -27.7, rotY: -0.555 },
      { type: 'box', w: 44.8, d: 7.8, h: 14.4, dx: -4, dz: -32.1, rotY: 1.009 },
      { type: 'box', w: 57.9, d: 10.9, h: 14.4, dx: 26.2, dz: -56.5, rotY: 1.012 },
      { type: 'box', w: 43.8, d: 10.2, h: 14.4, dx: -10.1, dz: -63.1, rotY: -0.555 },
      { type: 'box', w: 44.8, d: 27.6, h: 10, dx: -51.5, dz: 61, rotY: -0.55 },
      { type: 'box', w: 29.4, d: 7.2, h: 7.2, dx: 14.1, dz: 31.2, rotY: -0.616 },
      { type: 'box', w: 36, d: 30, h: 0.25, y0: 0.02, dx: 31.3, dz: -3.3, rotY: 0.601, flat: 0xa04a30 },
      { type: 'box', w: 31, d: 25, h: 0.32, y0: 0.02, dx: 31.3, dz: -3.3, rotY: 0.601, flat: 0x4e7d32 },
    ],
  },
  {
    // Jianguo High School — full campus (relation 3392608),
    // INSIDE the tile per the user's correction on this issue:
    // the 紅樓 (way 202768775) stands at lat 25.03065–25.03101,
    // north of box A's 25.0285 south edge. The Red Building is
    // the centrepiece: brick slab (99 × 17 m on the OSM outline,
    // axis −15°) with its two end towers and grey caps; ~17 m
    // overall from photo proportions (no published figure —
    // estimated). (A porch/fountain flourish was cut at the
    // render gate: unverifiable at this scale and colliding
    // with 莊敬樓's footprint.)
    // Classroom blocks at their OSM rects and tagged levels:
    // 正誼樓 4F (202768950, an L of two slabs on its outline),
    // 莊敬樓 4F (202768788), 科學館 4F (202768580), 自強樓 4F
    // (202768582), 明道樓 3F (202768758), 格物樓 3F (202768744),
    // 活動中心 4F (202768754), 資源大樓 (1158623539, L of two
    // slabs, 5F estimated) and 夢紅樓 7F (252994053). The track
    // is the flat capsule around the rugby pitch (202768453).
    id: 'jianguo-high-school', name: 'Jianguo High School', nameZh: '建國中學',
    lat: 25.0303, lon: 121.5126, realHeight: 25.2, estimated: true, color: 0xd9d2c4,
    site: { w: 246, d: 232, dx: 6, dz: 8 },
    facade: { kind: 'prewar', stoneColor: 0xd9d2c4, trimColor: 0xb3aa97, windowGlassColor: 0x2e3a46, windowWidth: 2.8, floorHeight: 3.6, litProbability: 0.25, warmth: 0.55, seed: 57.45 },
    parts: [
      { type: 'box', w: 99, d: 17, h: 11, dx: -34.3, dz: -56.5, rotY: -0.262, flat: { color: 0x9c4a36, roughness: 0.92, metalness: 0.02 } },
      { type: 'box', w: 100, d: 18, h: 0.8, y0: 11, dx: -34.3, dz: -56.5, rotY: -0.262, flat: 0x67635c },
      { type: 'box', w: 13, d: 19, h: 16, dx: -72.9, dz: -46.1, rotY: -0.262, flat: { color: 0x9c4a36, roughness: 0.92, metalness: 0.02 } },
      { type: 'box', w: 14.5, d: 20.5, h: 1.1, y0: 16, dx: -72.9, dz: -46.1, rotY: -0.262, flat: 0x67635c },
      { type: 'box', w: 13, d: 19, h: 16, dx: 4.3, dz: -66.9, rotY: -0.262, flat: { color: 0x9c4a36, roughness: 0.92, metalness: 0.02 } },
      { type: 'box', w: 14.5, d: 20.5, h: 1.1, y0: 16, dx: 4.3, dz: -66.9, rotY: -0.262, flat: 0x67635c },
      { type: 'box', w: 61, d: 11, h: 14.4, dx: -65.1, dz: -18.3, rotY: -0.266 },
      { type: 'box', w: 38, d: 11, h: 14.4, dx: -97.6, dz: -29.8, rotY: 1.29 },
      { type: 'box', w: 33.2, d: 23, h: 14.4, dx: -27.2, dz: -32.1, rotY: 1.299 },
      { type: 'box', w: 30.3, d: 28, h: 14.4, dx: 90.9, dz: -16.6, rotY: 1.33 },
      { type: 'box', w: 41.2, d: 11.3, h: 14.4, dx: 94.9, dz: 27.7, rotY: 1.302 },
      { type: 'box', w: 72.7, d: 11, h: 10.8, dx: -95.8, dz: 56.5, rotY: 1.299 },
      { type: 'box', w: 64, d: 12.2, h: 10.8, dx: 61.2, dz: 90.3, rotY: -0.246 },
      { type: 'box', w: 56.9, d: 44.2, h: 14.4, dx: -13.1, dz: 93, rotY: -0.244 },
      { type: 'box', w: 64, d: 15, h: 18, dx: 114.1, dz: -42.1, rotY: 1.512 },
      { type: 'box', w: 36, d: 13, h: 18, dx: 90.9, dz: -62, rotY: 0.297 },
      { type: 'box', w: 48, d: 26.6, h: 25.2, dx: 74.7, dz: -86.4, rotY: -0.213 },
      // The courts east of the track, from the OSM pitch ways,
      // one painted slab per row (a single union rect overshoots
      // the diagonal band and clips the campus east drive):
      // volleyball 1087155062-63 north, acrylic basketball
      // 202768713 / 1087155058-60 south, the two tennis courts
      // 202768661 / 1087550733 east, and the baseball practice
      // ground (1271725984) at the SE.
      { type: 'box', w: 24, d: 55, h: 0.25, y0: 0.02, dx: 60.6, dz: 10.5, rotY: -0.265, flat: 0x3f6d8e },
      { type: 'box', w: 63, d: 37, h: 0.25, y0: 0.02, dx: 52.5, dz: 60.3, rotY: -0.265, flat: 0x3f6d8e },
      { type: 'box', w: 32, d: 33, h: 0.25, y0: 0.02, dx: 118.6, dz: 16, rotY: -0.265, flat: 0x3f7d6b },
      { type: 'box', w: 26, d: 21, h: 0.25, y0: 0.02, dx: 123.1, dz: 64.1, rotY: -0.265, flat: 0x4e7d32 },
      ...trackCapsuleParts(-9.1, 28.8, 68, 60, 47.7, -0.265, 0xa04a30, 0x4e7d32),
    ],
  },
  {
    // Batch 8 (issues #149 + #186): the National Palace Museum on
    // its terraced hillfoot in Waishuangxi — the palace-style main
    // hall (第一展覽區/正館, OSM way 203799171: a ~140 x ~120 m
    // outline incl. terrace, building levels 4) with cream walls
    // and pale-green glazed-tile roofs, the administration pair
    // west of the ceremonial axis, the white marble 天下為公
    // pailou at the plaza, and the glass restaurant block
    // south-east. Composition measured from the OSM ways and the
    // user's aerial (npm-evidence/npm-user-photo.png; Esri
    // satellite agrees): the hall runs E-W at the grounds' north,
    // its forecourt terrace opens south to the 華表大道 — OSM's
    // named pedestrian axis, which leaves the forecourt steps at
    // (25.10143, 121.54895) and runs SSW to (25.10027, 121.54953),
    // ~65 m EAST of the hall centreline; the pailou (way
    // 1167548671) stands mid-avenue at (25.10084, 121.54940),
    // the 華表 pair below the steps. 文會堂 (way 226936389) is
    // the annex west of the hall. 研究大樓 (way 226936384,
    // height 16) is a diamond-plan
    // slab (rotY 45°) west of the axis; 第二展覽區 (way 226936385,
    // height 16) is the big green-roofed block at the grounds'
    // south-west (its OSM outline wraps a courtyard; modelled as
    // its west mass). The grounds themselves are a special site
    // (TAIPEI_GEO.npmSite, PR1 of #186): no procedural lots
    // anywhere in this entry's field. No published overall height
    // exists for the hall — 27.5 m is FORM-DERIVED (estimated:
    // true): podium 6 + 4-floor walls 13 + main hip roof 6.5,
    // with the raised central tier (box 4 + ridge 4.5) setting
    // the apex, proportions read off the user's aerial. The
    // hall's ~1.5° plan tilt and the two small 華表 pillars
    // flanking the avenue (r ~1 m at this scale) are recorded
    // simplifications: the avenue pillars ARE modelled; the
    // tilt is not (ridge parts cannot rotate).
    id: 'national-palace-museum', name: 'National Palace Museum', nameZh: '國立故宮博物院',
    lat: 25.10219, lon: 121.54859, realHeight: 27.5, color: 0xe7dec5, estimated: true,
    site: { w: 220, d: 190, dx: 0, dz: 45 },
    plaza: { w: 110, d: 300, dx: 45, dz: 210 },
    facade: { kind: 'prewar', stoneColor: 0xe8dfc6, trimColor: 0x9a8f74, windowGlassColor: 0x2c3844, windowWidth: 2.2, floorHeight: 3.3, litProbability: 0.22, warmth: 0.6, seed: 149.11 },
    parts: [
      // Terraced podium (two stone tiers) hugging the hall — the
      // grounds' service drives loop around it on every side
      // (issue-#42 audit, measured at the gate).
      { type: 'box', w: 122, d: 68, h: 3, dx: -4, dz: 1, flat: 0xcfc9bb },
      { type: 'box', w: 114, d: 62, h: 3, y0: 3, dx: -4, dz: 1, flat: 0xd8d3c4 },
      // Main hall: cream block + pale-green hip roof (ridge at the
      // origin = hall centre), raised central tier, end pavilions.
      { type: 'box', w: 132, d: 36, h: 13, y0: 6 },
      { type: 'ridge', w: 136, d: 40, h: 0, ridgeH: 6.5, y0: 19, flat: 0x55806a },
      { type: 'box', w: 46, d: 24, h: 4, y0: 19 },
      { type: 'ridge', w: 50, d: 27, h: 0, ridgeH: 4.5, y0: 23, flat: 0x55806a },
      { type: 'box', w: 14, d: 14, h: 3.5, y0: 19, dx: -52 },
      { type: 'box', w: 14, d: 14, h: 3.5, y0: 19, dx: 52 },
      { type: 'box', w: 16.5, d: 16.5, h: 1.1, y0: 22.5, dx: -52, flat: 0x4a7a63 },
      { type: 'box', w: 16.5, d: 16.5, h: 1.1, y0: 22.5, dx: 52, flat: 0x4a7a63 },
      // The forecourt terrace floor on the podium's south face.
      { type: 'box', w: 112, d: 16, h: 1.2, y0: 6, dz: 25, flat: 0xd8d3c4 },
      // 文會堂 (OSM way 226936389): the annex west of the hall —
      // modelled as its north mass; the service lane bends
      // through the south of its OSM outline (a courtyard side).
      { type: 'box', w: 48, d: 30, h: 13, dx: -34, dz: 48 },
      { type: 'box', w: 50, d: 32, h: 1.3, y0: 13, dx: -34, dz: 47, flat: 0x4a7a63 },
      // Forecourt stair terraces descending to the 華表大道 head
      // (the avenue leaves the steps at (25.10143, 121.54895),
      // dx +36 — the stairs centre on it, audited clear of the
      // steps roadbeds).
      { type: 'box', w: 34, d: 10, h: 4, dx: 50, dz: 92, flat: 0xd8d3c4 },
      { type: 'box', w: 34, d: 10, h: 2, dx: 50, dz: 102, flat: 0xcfc9bb },
      // The twin 華表 pillars flanking the avenue below the steps.
      { type: 'cylinder', r: 1.0, h: 9.5, dx: 24, dz: 112, flat: 0xf2efe6 },
      { type: 'cylinder', r: 1.0, h: 9.5, dx: 52, dz: 112, flat: 0xf2efe6 },
      // 天下為公 pailou mid-avenue (OSM way 1167548671:
      // 25.10082–25.10086 x 121.54926–121.54953, a 27 m span) —
      // four white marble posts, two lintels, green rooflets.
      { type: 'box', w: 1.7, d: 1.7, h: 8.5, dx: 73, dz: 150, flat: 0xf2efe6 },
      { type: 'box', w: 1.7, d: 1.7, h: 8.5, dx: 82, dz: 150, flat: 0xf2efe6 },
      { type: 'box', w: 1.7, d: 1.7, h: 8.5, dx: 91, dz: 150, flat: 0xf2efe6 },
      { type: 'box', w: 1.7, d: 1.7, h: 8.5, dx: 100, dz: 150, flat: 0xf2efe6 },
      { type: 'box', w: 31, d: 2.4, h: 1.6, y0: 7.0, dx: 86.5, dz: 150, flat: 0xf2efe6 },
      { type: 'box', w: 33, d: 4.6, h: 0.7, y0: 8.55, dx: 86.5, dz: 150, flat: 0x4a7a63 },
      { type: 'box', w: 23, d: 2.2, h: 1.2, y0: 8.6, dx: 86.5, dz: 150, flat: 0xf2efe6 },
      { type: 'box', w: 25, d: 4.2, h: 0.7, y0: 9.75, dx: 86.5, dz: 150, flat: 0x4a7a63 },
      // 研究大樓: the diamond-plan administration slab, h 16
      // (OSM). A single service loop wraps its island on all
      // sides and the OSM outline's own corners graze that
      // loop's roadbed, so the slab is modelled at 25 m square
      // (real plan ~52 m sides incl. apron) — the largest
      // diamond the loop admits inside the audit tolerance.
      { type: 'box', w: 25, d: 25, h: 16, dx: -23, dz: 143, rotY: Math.PI / 4 },
      { type: 'box', w: 25, d: 25, h: 1.4, y0: 16, dx: -23, dz: 143, rotY: Math.PI / 4, flat: 0x4a7a63 },
      { type: 'box', w: 14, d: 14, h: 2.6, y0: 17.4, dx: -23, dz: 143, rotY: Math.PI / 4 },
      { type: 'box', w: 17, d: 17, h: 1.1, y0: 20, dx: -23, dz: 143, rotY: Math.PI / 4, flat: 0x4a7a63 },
      // 第二展覽區: the big green-roofed block, grounds SW, h 16
      // (OSM), kept east of the 113巷35弄 lane on its west flank.
      { type: 'box', w: 48, d: 72, h: 16, dx: -6, dz: 245 },
      { type: 'box', w: 48, d: 68, h: 1.6, y0: 16, dx: -6, dz: 245, flat: 0x55806a },
      { type: 'box', w: 30, d: 34, h: 3, y0: 17.6, dx: -6, dz: 245 },
      { type: 'box', w: 34, d: 38, h: 1.2, y0: 20.6, dx: -6, dz: 245, flat: 0x4a7a63 },
      // The glass restaurant block south-east of the hall among
      // the Zhishan Garden trees (plot = OSM way 226936387),
      // turned to the garden drive that loops its east side.
      { type: 'box', w: 48, d: 26, h: 12, dx: 130, dz: 186, rotY: -0.85, facade: { kind: 'curtain', glassTint: 0x6d8a94, frameTint: 0xb9bcbe, windowWidth: 3.4, floorHeight: 3.6, litProbability: 0.3, warmth: 0.55, reflectivity: 0.7, seed: 149.12 } },
    ],
  },
  {
    // Batch 8 (issue #186): Miramar Entertainment Park, Dazhi —
    // the mall and its Ferris wheel (OSM node 5121602758,
    // tourism=attraction), the registry origin AT the wheel on
    // the mall's south front. Published (zh.wikipedia,
    // 美麗華百樂園): the wheel's total height is 100 m with 48
    // cabins, boarding at the 5F roof plaza; the commonly
    // published wheel diameter is 70 m — modelled as y0 30
    // (roofline) + 70 = apex 100. Massing measured from OSM
    // way 155816458 (the mall building proper: dx -109..+56,
    // dz -98..+13 rel. the wheel) and way 1191618576 (the wider
    // complex incl. the north annex): main glass slab, the
    // curved drum at its NW, the taller IMAX east wing, and the
    // low annex north of 植福路 (which the complex bridges —
    // the roadbed runs between the two masses, audited). The
    // separate parking structure west of 敬業三路 is not
    // modelled. The wheel's ground contact is the pylon pair +
    // crossbeam (plain boxes, audited); the 'wheel' part itself
    // is airborne mass (rim/spokes/cabins) outside the audit's
    // vocabulary by design.
    id: 'miramar-entertainment-park', name: 'Miramar Entertainment Park', nameZh: '美麗華百樂園',
    lat: 25.08290, lon: 121.55772, realHeight: 100, color: 0x7fa3ad,
    site: { w: 230, d: 215, dx: -28, dz: -80 },
    facade: { kind: 'curtain', glassTint: 0x51707c, frameTint: 0xa8b0ae, windowWidth: 3.4, floorHeight: 3.8, litProbability: 0.36, warmth: 0.55, reflectivity: 0.8, seed: 186.21 },
    sign: { text: 'MIRAMAR', w: 46, h: 6.5, y: 25, dx: -24, dz: -1.2, bg: '#1d2a30', fg: '#e8f0ee', accent: '#c8372d' },
    parts: [
      { type: 'box', w: 150, d: 92, h: 32, dx: -24, dz: -48 },
      { type: 'cylinder', r: 26, h: 32, dx: -78, dz: -70 },
      { type: 'box', w: 62, d: 40, h: 38, dx: 28, dz: -84, facade: { kind: 'curtain', glassTint: 0x3d5a66, frameTint: 0x9aa39f, windowWidth: 3.4, floorHeight: 3.8, litProbability: 0.3, warmth: 0.5, reflectivity: 0.8, seed: 186.22 } },
      { type: 'box', w: 120, d: 36, h: 20, dx: -10, dz: -138, flat: 0x8d9296 },
      // Boarding-plaza deck + the wheel's portal frame.
      { type: 'box', w: 36, d: 12, h: 2, y0: 29, dz: 2, flat: 0xd8d5cc },
      { type: 'box', w: 3.4, d: 3.4, h: 35, y0: 30, dx: -13.5, flat: 0xe9e7e0 },
      { type: 'box', w: 3.4, d: 3.4, h: 35, y0: 30, dx: 13.5, flat: 0xe9e7e0 },
      { type: 'box', w: 30.4, d: 3.4, h: 3.2, y0: 61.8, flat: 0xe9e7e0 },
      { type: 'wheel', y0: 30, h: 70, flat: 0xe9e7e0, cabinFlat: 0xc8ccd2 },
    ],
  },
];

// Songshan Airport site structures (issue #135): the terminal
// complex on the airfield's south edge. These are SITE
// buildings, not registry landmarks — no map pins, no search
// names (taipeiLandmarkStructures reads LANDMARK_STRUCTURES
// only) — resolved through the same resolveLandmark massing
// path and returned on the plan as siteStructures; boot renders
// them with the landmark renderer. They live INSIDE the #134
// aerodrome site, where the planner's airfield rule already
// drops every procedural lot; their site rects join the
// exclusions as well, so the footprints stay clear even at the
// site's edge. Footprints segmented from the OSM terminal
// outlines (taiwan.osm.pbf 2026-10-23): way 549458178 is one
// merged outline for the whole complex (T2 + link + T1), way
// 498435030 the T2 outline, way 269541734 the observation
// deck block airside of T2. Heights are storey-based estimates
// (estimated: true — no published metric height): T1 works
// over 3-4 floors (arrivals 2F / departures 3F per the
// airport's own guidance), T2 is 3 floors with the public
// observation deck on its roof (opened 2011-11-09), so
// 16 m / 13 m + thin roof slabs reading the real buildings'
// long curved roofline as a flat cap. The outline's gate-pier
// teeth along T1's airside edge are below this scale and are
// not modelled.
const AIRPORT_TERMINAL_FACADE = { kind: 'curtain', glassTint: 0x8ea6b5, frameTint: 0xe9e7e0, windowWidth: 3.6, floorHeight: 4.2, litProbability: 0.3, warmth: 0.45, reflectivity: 0.55, seed: 135.4 };
const AIRPORT_SITE_STRUCTURES = [
  {
    id: 'songshan-terminal-t1-west', name: 'Songshan Airport Terminal 1 (west)', nameZh: '松山機場第一航廈',
    lat: 25.063942, lon: 121.551945, realHeight: 17.6, color: 0xd9d5c9, estimated: true,
    site: { w: 243, d: 83, dx: 0, dz: 0 },
    facade: AIRPORT_TERMINAL_FACADE,
    parts: [
      { type: 'box', w: 235, d: 75, h: 16 },
      { type: 'box', w: 241, d: 81, h: 1.6, y0: 16, flat: 0xcfd0cc },
    ],
  },
  {
    id: 'songshan-terminal-t1-east', name: 'Songshan Airport Terminal 1 (east)', nameZh: '松山機場第一航廈',
    lat: 25.064253, lon: 121.553728, realHeight: 17.6, color: 0xd9d5c9, estimated: true,
    site: { w: 133, d: 49, dx: 0, dz: 0 },
    facade: AIRPORT_TERMINAL_FACADE,
    parts: [
      { type: 'box', w: 125, d: 41, h: 16 },
      { type: 'box', w: 131, d: 47, h: 1.6, y0: 16, flat: 0xcfd0cc },
    ],
  },
  {
    id: 'songshan-terminal-t2', name: 'Songshan Airport Terminal 2', nameZh: '松山機場第二航廈',
    lat: 25.063932, lon: 121.550173, realHeight: 14.4, color: 0xd9d5c9, estimated: true,
    site: { w: 130, d: 80, dx: 0, dz: 0 },
    facade: AIRPORT_TERMINAL_FACADE,
    parts: [
      { type: 'box', w: 122, d: 72, h: 13 },
      { type: 'box', w: 128, d: 78, h: 1.4, y0: 13, flat: 0xcfd0cc },
    ],
  },
  {
    id: 'songshan-observation-deck', name: 'Songshan Airport Observation Deck', nameZh: '松山機場觀景台',
    lat: 25.06446, lon: 121.550407, realHeight: 10, color: 0xd9d5c9, estimated: true,
    site: { w: 98, d: 29, dx: 0, dz: 0 },
    facade: AIRPORT_TERMINAL_FACADE,
    parts: [
      { type: 'box', w: 90, d: 21, h: 9 },
      { type: 'box', w: 96, d: 27, h: 1, y0: 9, flat: 0xd8d5cc },
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
    // Issue #255: the simplified far massing (farParts), pure
    // registry data like parts — the builder swaps to it past
    // the LOD distance. Structures without farParts render
    // their full parts at every distance, as before.
    farParts: def.farParts || null,
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
  // Issue #219: sanity guards on the join itself (census on the
  // issue). A donor whose outline is parcel-scale, or whose claim
  // is extreme, must be corroborated by a second source before it
  // may speak; an uncorroborated donor is skipped and its lots
  // fall through to the next tier like signal-less lots. The
  // guards live here, not in the data file, so a future refresh
  // of the layer cannot silently reintroduce the class.
  parcelSpanM: 100,    // a footprint wider than this is a parcel
                       // outline, not a building outline
  extremeHeightM: 120, // an implied height at/above this is an
                       // extreme claim (40F at the permit factor)
  corrGapM: 40,        // a corroborating footprint's bbox may sit
                       // this far from the donor's bbox
  corrDoorGrowM: 25,   // door plates corroborate from this far
                       // outside the donor's bbox
  corrFrac: 0.5,       // corroboration must support at least
                       // this share of the claim
  stepMinHeightM: 30,  // stepped massing (issue #219): only joined
  stepMinSpanM: 24,    // heights >= this on footprints >= this
                       // wide read as a complex wall worth stepping
};

// ---------- Issue #221: procedural school campuses ----------
//
// The user's directive (2026-10-27): do NOT handcraft schools one by
// one — GENERATE them. Until now there was no institutional class
// anywhere in the pipeline: a campus was just a very large raster
// block, so the lot packer built a shallow rim of generic buildings
// around an empty crater (NTUT is one 81,024 m² block), small
// campuses were built over entirely, and no track, court, fence or
// gate was ever drawn (leisure=pitch was not even extracted).
//
// The pipeline: tools/taipei/extract-from-pbf.py emits every
// amenity=school / kindergarten / university / college ground (ways
// + relations; landuse=education included) to osm_schools.json;
// build-taipei-geodata.mjs clips the rings to the tile union as
// geodata.schools; here, planSchoolCampuses() keeps every ground
// lot-free (the schoolPolys verdicts in the planner, counted like
// the airfield's) and generates a campus on each ground the data
// can bound:
//
//   * the fitted frame is the ring's minimum-area rectangle
//     (rotating calipers over the convex hull); its fill ratio
//     (ring area / rect area) grades how rectangular the ground is;
//   * the sports core is a running track from the #166 kit
//     (trackCapsuleParts: rust-red capsule, green infield) in
//     400/300/200 m classes, or — when no track fits — a courts
//     cluster + playground slab (the compact archetype);
//   * classroom slabs (3–6F, seeded lengths/heights) stand around
//     the track in U / parallel / L arrangements, plus an assembly
//     hall at one end; universities (and any ground ≥ 4.2 ha) get
//     the large archetype: taller slabs, a library-scale block,
//     courts cluster and lawns;
//   * a concrete perimeter fence follows the OSM ring itself (the
//     CKS Memorial Hall wall idiom) with a gated gap on the best
//     street frontage — two posts and a lintel — and trees inside
//     the fence line;
//   * kindergartens get the mini archetype: low slabs, a play
//     lawn and one court, never a track.
//
// Every choice is drawn from hash01() salts of a seed hashed from
// the ground's OSM type+id, so the same ground generates the same
// campus on every rebuild. Every placed part is containment-tested
// against the ring (parts that fall outside are dropped, which is
// what makes irregular/hillside grounds come out clipped instead
// of wrong), and slab rows never overlap the track or each other
// (a local-rect registry arbitrates).
//
// Skips, all recorded on plan.schools with reasons: grounds that
// already carry a registry campus (the #166 trio — 石牌國中,
// 青江國小, 建國中學 — detected by overlap with a landmark site
// rect, so any future registry campus is skipped the same way);
// grounds subsumed by a larger education ground (a campus mapped
// twice, or an affiliated school inside a university ring);
// non-largest fragments of a campus the tile union clipped into
// pieces; building-footprint-scale grounds (< 700 m² — a way
// tagging the school BUILDING, not its grounds); and grounds where
// even the compact layout places nothing (no-fit). Skipped grounds
// still exclude lots: OSM says the land is a campus either way.
// Campuses OSM maps as a bare node have no ring at all — the
// builder never emits them (the census on issue #221 names them).

const SCHOOL_TRACK_RED = 0xa04a30;   // the #166 kit's colours, so a
const SCHOOL_FIELD_GREEN = 0x4e7d32; // generated campus and a
const SCHOOL_COURT_BLUE = 0x3f6d8e;  // handcrafted one read alike
const SCHOOL_COURT_GREEN = 0x3f7d6b;
const SCHOOL_FENCE_COLOR = 0xd8d4c8;
const SCHOOL_YARD_COLOR = 0xbdb7a8;
const SCHOOL_PARKING_COLOR = 0x93969a;
const SCHOOL_LAWN_COLOR = 0x557c40;
const SCHOOL_TRUNK_COLOR = 0x6b4f35;
const SCHOOL_CANOPY_COLORS = [0x4a7038, 0x557c40, 0x3d6335];
const SCHOOL_FACADES = [
  { kind: 'prewar', stoneColor: 0xd9cfc0, trimColor: 0xb0a58e, windowGlassColor: 0x2e3a46, windowWidth: 2.6, floorHeight: 3.6, litProbability: 0.25, warmth: 0.55 },
  { kind: 'prewar', stoneColor: 0xd6c8b4, trimColor: 0xab9c80, windowGlassColor: 0x2e3a46, windowWidth: 2.6, floorHeight: 3.6, litProbability: 0.25, warmth: 0.55 },
  { kind: 'prewar', stoneColor: 0xcfd4d6, trimColor: 0x9aa4a8, windowGlassColor: 0x2e3a46, windowWidth: 3.0, floorHeight: 3.6, litProbability: 0.22, warmth: 0.5 },
  { kind: 'prewar', stoneColor: 0xdcc7b0, trimColor: 0xa87f5f, windowGlassColor: 0x2e3a46, windowWidth: 2.6, floorHeight: 3.6, litProbability: 0.25, warmth: 0.6 },
];
// Track classes: capsule overall (straight + width) x width. The
// first is the 400 m class, then 300 m, 200 m, small-200 m, mini.
const SCHOOL_TRACK_CLASSES = [
  { cls: '400m', straight: 84, width: 62 },
  { cls: '300m', straight: 64, width: 52 },
  { cls: '200m', straight: 46, width: 42 },
  { cls: '200m-s', straight: 30, width: 32 },
  { cls: 'mini', straight: 18, width: 24 },
];

function schoolSeedOf(osmType, osmId) {
  const s = `${osmType}/${osmId}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h | 0;
}

function ringPtsOf(ring) {
  const pts = [];
  for (let i = 0; i + 1 < ring.length; i += 2) pts.push([ring[i], ring[i + 1]]);
  if (pts.length > 1) {
    const [fx, fz] = pts[0], [lx, lz] = pts[pts.length - 1];
    if (Math.hypot(fx - lx, fz - lz) < 0.05) pts.pop();
  }
  return pts;
}

function ringAreaOf(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return a / 2;
}

function convexHullOf(pts) {
  const sorted = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

// Minimum-area rectangle of the ring (rotating calipers over the
// hull's edge directions). Returns the frame the whole layout is
// authored in: centre C, axis angle theta (the long axis runs along
// (cos, sin) in the tile plane), long side W, short side D, and the
// fill ratio ring-area / rect-area.
function fitCampusRect(pts) {
  const hull = convexHullOf(pts);
  let best = null;
  const consider = (theta) => {
    const c = Math.cos(theta), s = Math.sin(theta);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, z] of hull) {
      const u = x * c + z * s, v = -x * s + z * c;
      if (u < u0) u0 = u; if (u > u1) u1 = u;
      if (v < v0) v0 = v; if (v > v1) v1 = v;
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area - 1e-9) best = { theta, u0, u1, v0, v1, area };
  };
  for (let i = 0; i < hull.length; i++) {
    const [ax, az] = hull[i], [bx, bz] = hull[(i + 1) % hull.length];
    if (Math.hypot(bx - ax, bz - az) < 0.01) continue;
    consider(Math.atan2(bz - az, bx - ax));
  }
  if (!best) return null;
  let { theta } = best;
  // Extents over the whole ring (not just the hull) in the frame.
  const c = Math.cos(theta), s = Math.sin(theta);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [x, z] of pts) {
    const u = x * c + z * s, v = -x * s + z * c;
    if (u < u0) u0 = u; if (u > u1) u1 = u;
    if (v < v0) v0 = v; if (v > v1) v1 = v;
  }
  let W = u1 - u0, D = v1 - v0;
  let cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  if (D > W) { // keep W the long side: rotate the frame a quarter turn
    theta += Math.PI / 2;
    [W, D] = [D, W];
    const c2 = Math.cos(theta), s2 = Math.sin(theta);
    u0 = Infinity; u1 = -Infinity; v0 = Infinity; v1 = -Infinity;
    for (const [x, z] of pts) {
      const u = x * c2 + z * s2, v = -x * s2 + z * c2;
      if (u < u0) u0 = u; if (u > u1) u1 = u;
      if (v < v0) v0 = v; if (v > v1) v1 = v;
    }
    cu = (u0 + u1) / 2; cv = (v0 + v1) / 2;
  }
  const cc = Math.cos(theta), ss = Math.sin(theta);
  const cx = cu * cc - cv * ss, cz = cu * ss + cv * cc;
  const area = Math.abs(ringAreaOf(pts));
  return { cx, cz, theta, W, D, area, fill: area / (W * D) };
}

// One campus, generated. `frame` is the fitted rect, `gateSide` the
// local side index (0:+u end, 1:-u end, 2:+v side, 3:-v side) whose
// frontage the gate opens on. Parts come back in structure space
// (dx/dz relative to the structure origin at the ring centroid).
function generateSchoolCampus(ground, frame, gateSide, origin, opts = {}) {
  const seed = schoolSeedOf(ground.osmType, ground.osmId);
  const draw = (salt) => hash01(seed ^ (salt * 0x9e37 + 0x221));
  const kind = ground.kind;
  const isUni = kind === 'university' || kind === 'college';
  const isKinder = kind === 'kindergarten';
  const large = isUni || frame.area >= 42000;
  const clipped = frame.fill < 0.72;
  const { theta, W, D } = frame;
  const cosT = Math.cos(theta), sinT = Math.sin(theta);
  const toWorld = (u, v) => [frame.cx + u * cosT - v * sinT, frame.cz + u * sinT + v * cosT];
  const inRing = (u, v, shrink = 0) => {
    const [x, z] = toWorld(u, v);
    return pointInRing(x, z, ground.ring);
  };
  const parts = [];
  const placed = []; // local rects {u, v, w, d} (axis-aligned in the local frame)
  const overlaps = (u, v, w, d, pad = 1) => placed.some((p) =>
    Math.abs(u - p.u) < (w + p.w) / 2 + pad && Math.abs(v - p.v) < (d + p.d) / 2 + pad);
  const boxInRing = (u, v, w, d, rot) => {
    const c = Math.cos(rot), s = Math.sin(rot);
    for (const [lx, lz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]) {
      if (!inRing(u + lx * c - lz * s, v + lx * s + lz * c)) return false;
    }
    return true;
  };
  // Author a box part from local frame coords; registers its rect.
  const addBox = (u, v, w, d, h, opts = {}) => {
    const rot = opts.rot || 0;
    const regW = rot ? d : w, regD = rot ? w : d;
    if (!opts.skipFit) {
      if (overlaps(u, v, regW, regD, opts.pad ?? 1)) return false;
      if (!boxInRing(u, v, w, d, rot)) return false;
    }
    const [x, z] = toWorld(u, v);
    const part = { type: 'box', w, d, h, dx: Math.round((x - origin.x) * 10) / 10, dz: Math.round((z - origin.z) * 10) / 10 };
    if (opts.y0) part.y0 = opts.y0;
    const rotY = theta + rot;
    if (rotY) part.rotY = Math.round(rotY * 10000) / 10000;
    if (opts.flat !== undefined) part.flat = opts.flat;
    parts.push(part);
    if (!opts.noReg) placed.push({ u, v, w: regW, d: regD });
    if (h >= 7 && opts.flat === undefined) buildingCount++;
    return true;
  };

  let salt = 1;
  let buildingCount = 0;      // slabs + hall + library actually placed
  const M = 3.5;              // slab margin inside the fitted rect
  const slabDepth = 11 + draw(salt++) * 2.5;
  const floorsFor = (lo, hi) => lo + Math.floor(draw(salt++) * (hi - lo + 1));
  let maxTop = 0;
  const noteTop = (h) => { if (h > maxTop) maxTop = h; };

  // --- choose the sports core: largest track class that fits with
  // its arrangement's side bands, else the compact courts layout ---
  const rowBand = slabDepth + 6.5;             // row of slabs + gap to the track
  const courtBand = 25;                        // courts row + margins
  let track = null, variant = null;
  // The extract's content join vetoes the track on a ground OSM
  // maps as fully built with no sports surface of track scale
  // (NTUT: 30 building footprints, seven small courts, no track —
  // its real field sits across the expressway, off-campus): such
  // a ground takes the compact layout however big it is, instead
  // of growing a fictional running track. A ground whose data
  // carries a track — tagged as one, or one sports polygon of
  // track scale (>= 3000 m², a 200 m-class surface) — keeps the
  // track archetype through the ordinary fit below.
  const trackMapped = !!(ground.stats && (ground.stats.hasTrack || (ground.stats.largestPitchM2 || 0) >= 3000));
  const denseBuilt = !!(ground.stats && ground.stats.buildings >= 10 && !trackMapped);
  // planSchoolCampuses retries a track-only outcome with
  // forceCompact set: the compact layout's perimeter rows use
  // the frame differently and fit dense old urban plots where a
  // track leaves no slab room.
  const forceCompact = !!opts.forceCompact;
  // The fitted rect can overhang a concave ring; probe the capsule
  // (cap tips, straight edges, cap shoulders) against the ring so
  // a track never spills onto the neighbouring lots or roads.
  const trackInRing = (tc, vOff = 0) => {
    const hl = (tc.straight + tc.width) / 2 - 1, hw = tc.width / 2, hs = tc.straight / 2;
    const probes = [[0, 0], [-hl, 0], [hl, 0], [0, -hw], [0, hw], [-hs, -hw], [-hs, hw], [hs, -hw], [hs, hw],
      [-hl + tc.width / 4, -hw * 0.7], [-hl + tc.width / 4, hw * 0.7], [hl - tc.width / 4, -hw * 0.7], [hl - tc.width / 4, hw * 0.7]];
    return probes.every(([u, v]) => inRing(u, vOff + v));
  };
  if (!isKinder && !denseBuilt && !forceCompact) {
    const variants = [
      { name: 'U', bandA: rowBand, bandB: rowBand, ends: true },
      { name: 'parallel', bandA: rowBand, bandB: rowBand, ends: false },
      { name: 'L', bandA: rowBand, bandB: 6, ends: true },
      { name: 'court-side', bandA: rowBand, bandB: courtBand, ends: false },
      { name: 'bare', bandA: 6, bandB: 6, ends: false },
    ];
    // Two passes over (class, variant): pass 1 takes the largest
    // track class that fits WITH slab rows around it (seeded
    // variant preference inside the class); pass 2 allows the
    // 'bare' variant. Slabs around the track are the signature
    // look, so a smaller track with buildings beats a bigger
    // empty field (a 192x87 m ground took a bare 400 m loop over
    // a rowed 300 m one before this ordering).
    const pref = variants.map((v, i) => [draw(900 + i), i]).sort((a, b) => b[0] - a[0]).map(([, i]) => variants[i]);
    for (const allowBare of [false, true]) {
      for (const tc of SCHOOL_TRACK_CLASSES) {
        if (tc.cls === 'mini' && frame.area > 26000) continue; // a big ground never takes the mini loop
        const overallL = tc.straight + tc.width;
        for (const v of pref) {
          if (!allowBare && v.name === 'bare') continue;
          if (tc.width + v.bandA + v.bandB <= D - 1 && overallL <= W - 16 && trackInRing(tc, (v.bandA - v.bandB) / 2)) { track = tc; variant = v; break; }
        }
        if (track) break;
      }
      if (track) break;
    }
  }

  // Yard slab: a pale concrete ground sheet under the whole campus,
  // only where the fitted rect honestly sits inside the ring.
  if (frame.fill >= 0.78 && boxInRing(0, 0, W - 5, D - 5, 0)) {
    addBox(0, 0, W - 5, D - 5, 0.1, { y0: 0.03, flat: SCHOOL_YARD_COLOR, noReg: true, skipFit: true });
  }

  let trackHalfW = 0, trackL = 0;
  // Asymmetric variants (L, court-side) carry different bands on
  // the two sides; the fit test budgets width + bandA + bandB
  // against D, which only closes if the track sits OFF-centre,
  // shifted toward the lighter band by half the difference. All
  // v coordinates of the track layout hang off this offset.
  const vOff = track ? (variant.bandA - variant.bandB) / 2 : 0;
  if (track) {
    trackHalfW = track.width / 2; trackL = track.straight + track.width;
    placed.push({ u: 0, v: vOff, w: trackL, d: track.width });
    const [tx, tz] = toWorld(0, vOff);
    for (const p of trackCapsuleParts(Math.round((tx - origin.x) * 10) / 10, Math.round((tz - origin.z) * 10) / 10,
      track.straight, track.width, track.width - 12, theta, SCHOOL_TRACK_RED, SCHOOL_FIELD_GREEN)) parts.push(p);
  }

  // --- assembly hall at one end (not the gate end when the gate is
  // an end side), sized to sit between the slab rows ---
  let hallEnd = 0; // +1: at +u end, -1: at -u end, 0: none
  if (!isKinder && W >= (track ? trackL + 46 : 78)) {
    hallEnd = gateSide === 0 ? -1 : gateSide === 1 ? 1 : (draw(salt++) < 0.5 ? 1 : -1);
    const hallD = 17 + draw(salt++) * 4;
    const hallW = Math.min(track ? track.width - 6 : D - 2 * (M + slabDepth) - 4, 36);
    const hallH = Math.round((8.5 + draw(salt++) * 4) * 10) / 10;
    // With a track, the hall anchors beyond the capsule tip (the
    // registry's AABB test would otherwise eat it); the frame
    // position wins when it is already further out.
    const hu = hallEnd * (track ? Math.max(W / 2 - M - hallD / 2, trackL / 2 + hallD / 2 + 2) : W / 2 - M - hallD / 2);
    if (hallW >= 18 && addBox(hu, vOff, hallW, hallD, hallH, { rot: Math.PI / 2 })) {
      noteTop(hallH);
      addBox(hu, vOff, hallW + 1.2, hallD + 1.2, 0.5, { y0: hallH, rot: Math.PI / 2, flat: 0x8a8d90, noReg: true, skipFit: true });
    } else hallEnd = 0;
  }

  // --- classroom slab rows ---
  const slabFloors = isKinder ? [2, 3] : large ? [4, 8] : kind === 'school' ? [3, 6] : [3, 5];
  const fillRow = (vC, uFrom, uTo, blocked = []) => {
    const ranges = [];
    let cur = uFrom;
    for (const [b0, b1] of [...blocked].sort((a, b) => a[0] - b[0])) {
      if (b0 > cur) ranges.push([cur, Math.min(b0, uTo)]);
      cur = Math.max(cur, b1);
    }
    if (cur < uTo) ranges.push([cur, uTo]);
    for (const [r0, r1] of ranges) {
      let u = r0;
      while (r1 - u >= 24) {
        let len = 26 + draw(salt++) * 32;
        if (r1 - u - len < 18) len = r1 - u; // absorb an unusable tail stub
        len = Math.min(len, r1 - u);
        const floors = floorsFor(slabFloors[0], slabFloors[1]);
        const h = Math.round(floors * 3.6 * 10) / 10;
        if (addBox(u + len / 2, vC, len, slabDepth, h)) noteTop(h);
        u += len + 4 + draw(salt++) * 5;
      }
    }
  };

  if (track) {
    const rowV = trackHalfW + 3.5 + slabDepth / 2;
    const uFrom = -W / 2 + M, uTo = W / 2 - M;
    if (variant.bandA >= rowBand) fillRow(vOff - rowV, uFrom, uTo);
    if (variant.bandB >= rowBand) fillRow(vOff + rowV, uFrom, uTo);
    if (variant.bandB >= courtBand && variant.bandA < courtBand) {
      // courts row on the +v side
      const cv = vOff + trackHalfW + 3.5 + 9;
      let cu = -trackL / 2 + 16;
      const nCourts = Math.min(3, Math.floor(trackL / 34));
      for (let i = 0; i < nCourts; i++) {
        addBox(cu, cv, 30, 18, 0.25, { y0: 0.05, flat: i % 2 ? SCHOOL_COURT_GREEN : SCHOOL_COURT_BLUE });
        cu += 34;
      }
    }
    if (variant.ends) {
      // End slabs at the non-hall end, spanning the track's
      // width, anchored just beyond the capsule tip (anchoring
      // at the frame edge left them stranded across the yard on
      // long grounds, and the AABB registry ate them when they
      // sat at the tip itself).
      const endU = (hallEnd === 1 ? -1 : 1) * (trackL / 2 + 2 + slabDepth / 2);
      let v = vOff - trackHalfW + 2;
      while (v + 22 <= vOff + trackHalfW - 1) {
        const len = Math.min(22 + draw(salt++) * 14, vOff + trackHalfW - 1 - v);
        if (len < 16) break;
        const floors = floorsFor(slabFloors[0], slabFloors[1]);
        const h = Math.round(floors * 3.6 * 10) / 10;
        if (addBox(endU, v + len / 2, len, slabDepth, h, { rot: Math.PI / 2 })) noteTop(h);
        v += len + 5;
      }
    }
  } else {
    // --- compact archetype: perimeter rows + courts/playground ---
    const rowVN = -(D / 2 - M - slabDepth / 2), rowVS = D / 2 - M - slabDepth / 2;
    const uFrom = -W / 2 + M, uTo = W / 2 - M;
    fillRow(rowVN, uFrom, uTo);
    if (!isKinder || D >= 40) fillRow(rowVS, uFrom, uTo);
    const midD = D - 2 * (M + slabDepth);
    if (midD >= 21 && W >= 52) {
      // courts row(s) in the middle band
      let cu = uFrom + 16;
      const nCourts = Math.min(isKinder ? 1 : 3, Math.floor((uTo - uFrom - 8) / 34));
      for (let i = 0; i < nCourts; i++) {
        addBox(cu, 0, 30, 18, 0.25, { y0: 0.05, flat: i % 2 ? SCHOOL_COURT_BLUE : SCHOOL_COURT_GREEN });
        cu += 34;
      }
      if (midD >= 40 && !isKinder) { // a green playground slab beside the courts
        addBox(0, midD / 2 - 8, Math.min(W - 2 * M - 4, 60), 14, 0.22, { y0: 0.05, flat: SCHOOL_LAWN_COLOR });
      }
    } else if (midD >= 10) {
      addBox(0, 0, Math.min(W - 2 * M - 4, 56), Math.min(midD - 2, 20), 0.22, { y0: 0.05, flat: isKinder ? SCHOOL_LAWN_COLOR : SCHOOL_COURT_GREEN });
    }
  }

  // --- large-campus extras: a library-scale block + lawns ---
  if (large && !isKinder) {
    const libW = 24 + draw(salt++) * 8, libD = 18 + draw(salt++) * 6;
    const libH = Math.round(floorsFor(7, 10) * 3.6 * 10) / 10;
    const corners = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map((c, i) => [draw(700 + i), c]).sort((a, b) => b[0] - a[0]);
    for (const [, [su, sv]] of corners) {
      if (addBox(su * (W / 2 - M - libD / 2), sv * (D / 2 - M - libW / 2), libW, libD, libH, { rot: Math.PI / 2 })) { noteTop(libH); break; }
      if (addBox(su * (W / 2 - M - libW / 2), sv * (D / 2 - M - libD / 2), libW, libD, libH)) { noteTop(libH); break; }
    }
    for (const [su, sv] of [[1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const lw = 16 + draw(salt++) * 14, ld = 10 + draw(salt++) * 8;
      addBox(su * (W / 2 - M - lw / 2 - 2), sv * (D / 2 - M - ld / 2 - 2), lw, ld, 0.22, { y0: 0.05, flat: SCHOOL_LAWN_COLOR });
    }
  }

  // --- scatter fallback: an irregular ground whose fitted rows
  // all failed containment (a C-shaped or diagonal plot — the
  // frame's rows and centre courts all land off-ring) still gets
  // a campus: a few slabs seeded on a coarse grid over the fitted
  // rect, each containment- and overlap-tested like every other
  // part, so what lands is clipped to the ground by construction.
  let scattered = false;
  if (buildingCount === 0) {
    const cand = [];
    for (let u = -W / 2 + M + 12; u <= W / 2 - M - 12; u += 26)
      for (let v = -D / 2 + M + 8; v <= D / 2 - M - 8; v += 20) cand.push([u, v]);
    for (let i = cand.length - 1; i > 0; i--) {
      const j = Math.floor(draw(8000 + i) * (i + 1));
      [cand[i], cand[j]] = [cand[j], cand[i]];
    }
    let placedN = 0;
    for (const [u, v] of cand) {
      if (placedN >= (isKinder ? 2 : 5)) break;
      const len = isKinder ? 13 + draw(salt++) * 8 : 20 + draw(salt++) * 14;
      const floors = floorsFor(slabFloors[0], slabFloors[1]);
      const h = Math.round(floors * 3.6 * 10) / 10;
      if (addBox(u, v, len, slabDepth, h) || addBox(u, v, slabDepth, len, h, { rot: Math.PI / 2 })) { noteTop(h); placedN++; }
    }
    if (placedN > 0) {
      scattered = true;
      addBox(0, 0, 30, 18, 0.25, { y0: 0.05, flat: SCHOOL_COURT_GREEN });
    }
  }

  // --- parking near the gate (seeded, optional) ---
  if (!isKinder && draw(salt++) < 0.55) {
    const pw = 16 + draw(salt++) * 12, pd = 10 + draw(salt++) * 5;
    const sideV = gateSide === 2 ? 1 : gateSide === 3 ? -1 : (draw(salt++) < 0.5 ? 1 : -1);
    const sideU = gateSide === 0 ? 1 : gateSide === 1 ? -1 : (draw(salt++) < 0.5 ? 1 : -1);
    addBox(sideU * (W / 2 - M - pw / 2 - 1), sideV * (D / 2 - M - pd / 2 - 1), pw, pd, 0.12, { y0: 0.04, flat: SCHOOL_PARKING_COLOR });
  }

  // --- perimeter fence + gate + trees (world space, on the ring) ---
  const fence = schoolFenceParts(ground, gateSide, frame, origin, seed);
  parts.push(...fence.parts);

  const archetype = isKinder ? 'kindergarten'
    : denseBuilt ? (large ? 'large-dense' : 'dense-built')
    : large ? (track ? 'large-track' : 'large-compact')
    : track ? `track-${variant.name}` : (frame.area < 5200 ? 'compact-mini' : 'compact');
  return {
    archetype: (scattered ? `${archetype}+scatter` : archetype) + (clipped ? '+clipped' : ''),
    trackClass: track ? track.cls : null,
    parts, height: Math.round((maxTop || 7.2) * 10) / 10, slabCount: buildingCount,
    gateSeg: fence.gateSeg,
  };
}

// The fence: thin concrete wall boxes along the (simplified) OSM
// ring, a gated gap where the gate side's frontage meets the ring,
// gate posts + lintel, an optional guard house, and trees inside
// the line. All parts in structure space.
function schoolFenceParts(ground, gateSide, frame, origin, seed) {
  const draw = (salt) => hash01(seed ^ (salt * 0x9e37 + 0x221));
  const pts = ringPtsOf(ground.ring);
  // Simplify: drop near-duplicate vertices, then merge near-collinear
  // runs (cap ~44 segments so a wiggly OSM ring stays affordable).
  const simp = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [px, pz] = simp[simp.length - 1];
    if (Math.hypot(pts[i][0] - px, pts[i][1] - pz) >= 1.2) simp.push(pts[i]);
  }
  const angleAt = (a, b, c) => {
    const v1 = [b[0] - a[0], b[1] - a[1]], v2 = [c[0] - b[0], c[1] - b[1]];
    const l1 = Math.hypot(...v1) || 1, l2 = Math.hypot(...v2) || 1;
    return Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2))));
  };
  for (let pass = 0; pass < 4 && simp.length > 12; pass++) {
    const out = [simp[0]];
    for (let i = 1; i < simp.length; i++) {
      const prev = out[out.length - 1], cur = simp[i], next = simp[(i + 1) % simp.length];
      if (i < simp.length - 1 && angleAt(prev, cur, next) < 0.16 && Math.hypot(cur[0] - prev[0], cur[1] - prev[1]) < 34) continue;
      out.push(cur);
    }
    if (out.length === simp.length) break;
    simp.length = 0; simp.push(...out);
    if (simp.length <= 44) break;
  }
  const segs = [];
  for (let i = 0; i < simp.length; i++) {
    const a = simp[i], b = simp[(i + 1) % simp.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len >= 0.8) segs.push({ a, b, len });
  }
  // Gate target: the fitted rect's gate-side midpoint, pushed to the ring.
  const cosT = Math.cos(frame.theta), sinT = Math.sin(frame.theta);
  const sideLocal = [[frame.W / 2, 0], [-frame.W / 2, 0], [0, frame.D / 2], [0, -frame.D / 2]][gateSide];
  const gx = frame.cx + sideLocal[0] * cosT - sideLocal[1] * sinT;
  const gz = frame.cz + sideLocal[0] * sinT + sideLocal[1] * cosT;
  let gateSeg = -1, gateT = 0.5, gateDist = Infinity;
  segs.forEach((sg, i) => {
    const dx = sg.b[0] - sg.a[0], dz = sg.b[1] - sg.a[1];
    const L2 = dx * dx + dz * dz || 1;
    let t = ((gx - sg.a[0]) * dx + (gz - sg.a[1]) * dz) / L2;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(sg.a[0] + t * dx - gx, sg.a[1] + t * dz - gz);
    if (d < gateDist) { gateDist = d; gateSeg = i; gateT = t; }
  });
  const gateW = ground.kind === 'kindergarten' ? 7 : 11 + draw(4242) * 3;
  const parts = [];
  const pushBox = (cx, cz, w, d, h, rotY, flat, y0 = 0) => {
    const part = { type: 'box', w, d, h, dx: Math.round((cx - origin.x) * 10) / 10, dz: Math.round((cz - origin.z) * 10) / 10, flat };
    if (y0) part.y0 = y0;
    if (rotY) part.rotY = Math.round(rotY * 10000) / 10000;
    parts.push(part);
  };
  const treeSpots = [];
  segs.forEach((sg, i) => {
    const dx = sg.b[0] - sg.a[0], dz = sg.b[1] - sg.a[1];
    const rotY = Math.atan2(dz, dx);
    const pieces = [];
    if (i === gateSeg) {
      const cPos = gateT * sg.len;
      const g0 = Math.max(0, cPos - gateW / 2), g1 = Math.min(sg.len, cPos + gateW / 2);
      if (g0 > 0.8) pieces.push([0, g0]);
      if (sg.len - g1 > 0.8) pieces.push([g1, sg.len]);
      // gate posts + lintel at the gap
      for (const gp of [g0, g1]) {
        const px = sg.a[0] + (dx * gp) / sg.len, pz = sg.a[1] + (dz * gp) / sg.len;
        pushBox(px, pz, 0.9, 0.9, 3.4, 0, 0xb9b2a2);
      }
      const mx = sg.a[0] + (dx * (g0 + g1)) / (2 * sg.len), mz = sg.a[1] + (dz * (g0 + g1)) / (2 * sg.len);
      pushBox(mx, mz, g1 - g0 + 1.8, 1.0, 0.8, rotY, 0xb9b2a2, 3.2);
      // guard house just inside the gate (seeded; dropped when the
      // spot lands outside a concave ring)
      if (draw(4243) < 0.55) {
        const inw = [(frame.cx - mx), (frame.cz - mz)];
        const il = Math.hypot(...inw) || 1;
        const hx = mx + (inw[0] / il) * 4.2 + (dx / sg.len) * (gateW / 2 + 2.6);
        const hz = mz + (inw[1] / il) * 4.2 + (dz / sg.len) * (gateW / 2 + 2.6);
        if (pointInRing(hx, hz, ground.ring)) pushBox(hx, hz, 3.2, 3, 3.0, rotY, 0xcfc8b8);
      }
    } else pieces.push([0, sg.len]);
    for (const [p0, p1] of pieces) {
      const len = p1 - p0;
      const mx = sg.a[0] + (dx * (p0 + p1)) / (2 * sg.len), mz = sg.a[1] + (dz * (p0 + p1)) / (2 * sg.len);
      pushBox(mx, mz, len, 0.35, 2.5, rotY, SCHOOL_FENCE_COLOR);
    }
    // tree spots along this segment, offset toward the campus centre
    const step = 20 + draw(5000 + i) * 8;
    for (let dpos = step * 0.6; dpos < sg.len - 3; dpos += step) {
      const px = sg.a[0] + (dx * dpos) / sg.len, pz = sg.a[1] + (dz * dpos) / sg.len;
      const inw = [frame.cx - px, frame.cz - pz];
      const il = Math.hypot(...inw) || 1;
      treeSpots.push([px + (inw[0] / il) * 1.8, pz + (inw[1] / il) * 1.8]);
    }
  });
  // Trees: trunk + dome canopy, capped; skipped near the gate.
  const gateC = gateSeg >= 0 ? [segs[gateSeg].a[0] + (segs[gateSeg].b[0] - segs[gateSeg].a[0]) * gateT,
                                segs[gateSeg].a[1] + (segs[gateSeg].b[1] - segs[gateSeg].a[1]) * gateT] : null;
  let trees = 0;
  for (const [tx, tz] of treeSpots) {
    if (trees >= 14) break;
    if (gateC && Math.hypot(tx - gateC[0], tz - gateC[1]) < gateW) continue;
    if (!pointInRing(tx, tz, ground.ring)) continue;
    const r = 1.9 + draw(6000 + trees) * 1.0;
    parts.push({ type: 'cylinder', r: 0.16, h: 2.1, dx: Math.round((tx - origin.x) * 10) / 10, dz: Math.round((tz - origin.z) * 10) / 10, flat: SCHOOL_TRUNK_COLOR });
    parts.push({ type: 'dome', rx: r, rz: r, h: Math.round(r * 1.05 * 10) / 10, y0: 1.9, dx: Math.round((tx - origin.x) * 10) / 10, dz: Math.round((tz - origin.z) * 10) / 10, flat: SCHOOL_CANOPY_COLORS[trees % 3] });
    trees++;
  }
  return { parts, gateSeg };
}

// All campuses for a geodata: grouping, skip rules, gate frontage,
// generation. Returns { structures, report } — structures are
// resolved like resolveLandmark's output and join plan.siteStructures.
export function planSchoolCampuses(geodata, landmarkSites, carriageways, originLatLon) {
  const report = [];
  const structures = [];
  // Tile -> lat/lon for the resolved structures, the inverse of
  // latLonToTile's frame (same default origin as resolveLandmark).
  const [lat0, lon0] = originLatLon || [25.033, 121.565];
  const phi0 = (lat0 * Math.PI) / 180, sin0 = Math.sin(phi0);
  const nRad = FRAME_A / Math.sqrt(1 - FRAME_E2 * sin0 * sin0);
  const mRad = (FRAME_A * (1 - FRAME_E2)) / Math.pow(1 - FRAME_E2 * sin0 * sin0, 1.5);
  const kx = (Math.PI / 180) * nRad * Math.cos(phi0), ky = (Math.PI / 180) * mRad;
  const toLatLon = (x, z) => [Math.round((lat0 - z / ky) * 1e6) / 1e6, Math.round((lon0 + x / kx) * 1e6) / 1e6];
  const entries = Array.isArray(geodata.schools) ? geodata.schools : [];
  // Group clipped pieces by OSM element.
  const groups = new Map();
  for (const e of entries) {
    const key = `${e.osmType}/${e.osmId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const grounds = [];
  for (const [key, pieces] of groups) {
    pieces.sort((a, b) => b.area - a.area);
    const main = pieces[0];
    const totalArea = pieces.reduce((s, p) => s + p.area, 0);
    grounds.push({ key, osmType: main.osmType, osmId: main.osmId, kind: main.kind, name: main.name || '', ring: main.ring, area: totalArea, pieces: pieces.length, stats: main.stats || null });
  }
  grounds.sort((a, b) => b.area - a.area);
  // Road vertices near a ground, for the gate-frontage scan.
  const roadPtsNear = (bb, grow) => {
    const out = [];
    for (const bed of carriageways || []) {
      const pts = bed.pts || [];
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i + 1 < pts.length; i += 2) {
        if (pts[i] < minX) minX = pts[i]; if (pts[i] > maxX) maxX = pts[i];
        if (pts[i + 1] < minZ) minZ = pts[i + 1]; if (pts[i + 1] > maxZ) maxZ = pts[i + 1];
      }
      if (maxX < bb.minX - grow || minX > bb.maxX + grow || maxZ < bb.minZ - grow || minZ > bb.maxZ + grow) continue;
      for (let i = 0; i + 1 < pts.length; i += 2) out.push([pts[i], pts[i + 1]]);
    }
    return out;
  };
  const kept = [];
  for (const g of grounds) {
    const rep = { key: g.key, osmType: g.osmType, osmId: g.osmId, kind: g.kind, name: g.name, area: g.area, pieces: g.pieces };
    if (g.stats) rep.stats = g.stats;
    report.push(rep);
    if (g.area < 700) { rep.skip = 'building-footprint-scale (<700 m² in tile — the way tags a building, or only a tile-edge sliver of the ground falls in tile)'; continue; }
    const pts = ringPtsOf(g.ring);
    const bb = ringBbox(g.ring);
    // Registry campuses: overlap with a landmark site rect.
    let registryHit = false;
    for (const s of landmarkSites || []) {
      const ix = Math.max(0, Math.min(bb.maxX, s.maxX) - Math.max(bb.minX, s.minX));
      const iz = Math.max(0, Math.min(bb.maxZ, s.maxZ) - Math.max(bb.minZ, s.minZ));
      if (ix * iz >= 0.35 * (bb.maxX - bb.minX) * (bb.maxZ - bb.minZ)) { registryHit = true; break; }
    }
    if (registryHit) { rep.skip = 'registry campus (handcrafted — #166)'; continue; }
    // Subsumption: >= 85% of this ring's vertices inside a kept larger ground.
    let subsumedBy = null;
    for (const big of kept) {
      let inside = 0;
      for (const [x, z] of pts) if (pointInRing(x, z, big.ring)) inside++;
      if (pts.length && inside / pts.length >= 0.85) { subsumedBy = big.key; break; }
    }
    if (subsumedBy) { rep.skip = `subsumed by ${subsumedBy}`; continue; }
    kept.push(g);
    const frame = fitCampusRect(pts);
    if (!frame) { rep.skip = 'degenerate ring'; continue; }
    rep.frame = { W: Math.round(frame.W), D: Math.round(frame.D), fill: Math.round(frame.fill * 100) / 100 };
    if (g.pieces > 1) rep.fragmentNote = `largest of ${g.pieces} clipped pieces generates; the rest stay exclusion-only`;
    // Gate side: the fitted-rect side whose midpoint (pushed 8 m
    // outward) comes closest to a carriageway vertex; fallback the
    // +v long side when no road runs within 90 m.
    const roadPts = roadPtsNear(bb, 90);
    const cosT = Math.cos(frame.theta), sinT = Math.sin(frame.theta);
    const sideMid = [[frame.W / 2, 0], [-frame.W / 2, 0], [0, frame.D / 2], [0, -frame.D / 2]];
    let gateSide = 2, gateBest = Infinity;
    sideMid.forEach(([lu, lv], si) => {
      const nx = lu === 0 ? 0 : Math.sign(lu), nz = lv === 0 ? 0 : Math.sign(lv);
      const ox = frame.cx + (lu + nx * 8) * cosT - (lv + nz * 8) * sinT;
      const oz = frame.cz + (lu + nx * 8) * sinT + (lv + nz * 8) * cosT;
      for (const [rx, rz] of roadPts) {
        const d = Math.hypot(rx - ox, rz - oz);
        if (d < gateBest) { gateBest = d; gateSide = si; }
      }
    });
    rep.gateRoadDist = gateBest === Infinity ? null : Math.round(gateBest);
    // Structure origin: ring centroid (the resolveLandmark convention).
    let ox = 0, oz = 0;
    for (const [x, z] of pts) { ox += x; oz += z; }
    const origin = { x: Math.round((ox / pts.length) * 10) / 10, z: Math.round((oz / pts.length) * 10) / 10 };
    let gen = generateSchoolCampus(g, frame, gateSide, origin);
    if (gen.slabCount === 0 && gen.trackClass) {
      // A track fits the ground but leaves no room a classroom
      // slab can use (dense old urban plots — 南門國小's class):
      // retry as the compact archetype before calling it no-fit.
      const retry = generateSchoolCampus(g, frame, gateSide, origin, { forceCompact: true });
      if (retry.slabCount > 0) gen = retry;
    }
    if (gen.slabCount === 0) {
      // A campus with no classroom slab is not a campus — skip it
      // honestly (the ground still excludes lots) rather than
      // rendering a lone track or a fence around nothing.
      rep.skip = gen.trackClass
        ? 'no-fit (a track fits the ground but no classroom slab does)'
        : 'no-fit (even the compact layout places nothing)';
      continue;
    }
    rep.archetype = gen.archetype;
    rep.trackClass = gen.trackClass;
    rep.parts = gen.parts.length;
    rep.slabs = gen.slabCount;
    const facade = { ...SCHOOL_FACADES[Math.floor(hash01(schoolSeedOf(g.osmType, g.osmId) ^ 0xfacade) * SCHOOL_FACADES.length) % SCHOOL_FACADES.length], seed: 57 + Math.floor(hash01(schoolSeedOf(g.osmType, g.osmId) ^ 0x5eed) * 900) / 100 };
    const [slat, slon] = toLatLon(origin.x, origin.z);
    structures.push({
      id: `school-${g.osmType}-${g.osmId}`,
      name: g.name || `School (OSM ${g.osmType} ${g.osmId})`,
      nameZh: /[\u4e00-\u9fff]/.test(g.name) ? g.name : '',
      x: origin.x, z: origin.z,
      lat: slat, lon: slon,
      realHeight: gen.height, height: gen.height, estimated: true,
      distFromOrigin: Math.round(Math.hypot(origin.x, origin.z)),
      color: facade.stoneColor,
      site: { minX: bb.minX, maxX: bb.maxX, minZ: bb.minZ, maxZ: bb.maxZ },
      openGround: null,
      sites: [{ minX: bb.minX, maxX: bb.maxX, minZ: bb.minZ, maxZ: bb.maxZ }],
      parts: gen.parts, facade, sign: null,
      school: { key: g.key, kind: g.kind, archetype: gen.archetype, trackClass: gen.trackClass },
    });
  }
  return { structures, report };
}

export function planTaipeiBuildings(geodata, opts = {}) {
  const stats = { blocksSeen: 0, blocksFine: 0, lotsFine: 0, blocksSkippedSmall: 0, blocksSkippedParkWater: 0, blocksSkippedGreen: 0, blocksSkippedAirfield: 0, blocksSkippedSchool: 0, blocksSkippedLoop: 0, blocksSkippedNpmSite: 0, blocksSkippedOutsideUnion: 0, lotsDroppedVacancy: 0, lotsDroppedParkWater: 0, lotsDroppedGreen: 0, lotsDroppedRiverside: 0, lotsDroppedAirfield: 0, lotsDroppedSchool: 0, lotsDroppedLoop: 0, lotsDroppedNpmSite: 0, lotsDroppedTowerSite: 0, lotsDroppedRoad: 0, lotsDroppedMedian: 0, lotsDroppedOutsideUnion: 0, lotsDroppedTrackBed: 0, lotsDroppedTrackPierce: 0, lotsDroppedPier: 0, blocksRotated: 0, lotsRotated: 0, lotsPackedFrontage: 0, lotsTallFrontage: 0, heightsPermit: 0, heightsOsmHeight: 0, heightsOsmLevels: 0, heightsDoor: 0, heightsField: 0, heightsProc: 0, heightsGuardParcel: 0, heightsGuardExtreme: 0, heightsSteppedGroups: 0, heightsSteppedLots: 0, lotsFrontagePulled: 0, lotsFrontageFlush: 0, lotsFrontageHeldNoBed: 0, lotsFrontageHeldBlocked: 0, frontagePullMetres: 0 };
  // Issue #218: building-density presets (settings gear). 'fine'
  // is the shipped default: every constant it selects below is the
  // literal this code used before the option existed, so the
  // default plan is byte-identical (fingerprint-pinned in
  // tests/taipei-settings.test.mjs). 'coarse' restores the pre-#124
  // rule — the fine classifier never fires. 'dense' is the finer
  // draft measured during the #124 study (~7–11 m pitch, ~100k
  // lots): the classifier is unchanged, but fine blocks subdivide
  // at the tighter 7.5–10.5 m frontage pitch with narrower gaps
  // and walk-up vacancy. An unknown value plans as 'fine'.
  const density = opts.density === 'coarse' || opts.density === 'dense' ? opts.density : 'fine';
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

  // Issue #137: the Tamsui riverside rule (user, 2026-10-25) — the
  // river plus a band of riverside land on BOTH banks is non-buildable
  // BY RULE, not only where OSM happens to tag a park. The builder
  // flags the Tamsui's water polygons (river: 'tamsui' — the recovered
  // bankfull polygon, relation 4010571) and carries the band width on
  // geodata.riverside.bandM. Issue #186 extends the same flag to the
  // Keelung's Dazhi reach (river: 'keelung', strip-scoped in the
  // builder). Lots inside the water already drop as
  // park/water; this distance verdict covers the untagged slivers the
  // tags miss — wharf aprons, levee strips, floodplain — which is
  // exactly where the #125 phantom lots stood (192 in the Dadaocheng
  // frame alone, on the park strip and in the river itself).
  const RIVERSIDE_BAND_M = geodata.riverside?.bandM ?? 30;
  // Flagged rivers: the Tamsui (issue #137) and, since issue #186,
  // the Keelung's Dazhi reach — the builder scopes the Keelung flag
  // to the airport-north strip, so this verdict stays strip-local
  // there while the Tamsui band runs tile-wide as before.
  const tamsuiRings = [];
  for (const w of geodata.water || []) if (w.river) tamsuiRings.push({ ring: w.ring, bb: ringBbox(w.ring) });
  const nearTamsui = (x, z) => {
    for (const p of tamsuiRings) {
      if (x < p.bb.minX - RIVERSIDE_BAND_M || x > p.bb.maxX + RIVERSIDE_BAND_M ||
          z < p.bb.minZ - RIVERSIDE_BAND_M || z > p.bb.maxZ + RIVERSIDE_BAND_M) continue;
      if (distToRing(x, z, p.ring) < RIVERSIDE_BAND_M) return true;
    }
    return false;
  };
  // Issue #134: Songshan Airport is a special site — no procedural
  // lots inside the aerodrome boundary (geodata.airfield.site, from
  // OSM relation 5421750), tested exactly like green land. The
  // terminal and parking structures are hand-built work (#135); the
  // site stays clean for them.
  const airfieldPolys = [];
  for (const s of geodata.airfield?.site || []) airfieldPolys.push({ ring: s.ring, bb: ringBbox(s.ring) });
  const inAirfield = (x, z) => {
    for (const p of airfieldPolys) {
      if (x < p.bb.minX || x > p.bb.maxX || z < p.bb.minZ || z > p.bb.maxZ) continue;
      if (pointInRing(x, z, p.ring)) return true;
    }
    return false;
  };
  const nearAirfield = (x, z) => {
    for (const p of airfieldPolys) {
      if (x < p.bb.minX - CORNER_CLEARANCE || x > p.bb.maxX + CORNER_CLEARANCE ||
          z < p.bb.minZ - CORNER_CLEARANCE || z > p.bb.maxZ + CORNER_CLEARANCE) continue;
      if (pointInRing(x, z, p.ring)) return true;
      if (distToRing(x, z, p.ring) < CORNER_CLEARANCE) return true;
    }
    return false;
  };
  // Issues #149/#186: the National Palace Museum grounds are a
  // special site on the airfield pattern (geodata.npmSite.site, from
  // OSM way 827791918) — no procedural lots on the terraces/gardens;
  // the museum itself is a registry landmark.
  const npmSitePolys = [];
  for (const s of geodata.npmSite?.site || []) npmSitePolys.push({ ring: s.ring, bb: ringBbox(s.ring) });
  const inNpmSite = (x, z) => {
    for (const p of npmSitePolys) {
      if (x < p.bb.minX || x > p.bb.maxX || z < p.bb.minZ || z > p.bb.maxZ) continue;
      if (pointInRing(x, z, p.ring)) return true;
    }
    return false;
  };
  const nearNpmSite = (x, z) => {
    for (const p of npmSitePolys) {
      if (x < p.bb.minX - CORNER_CLEARANCE || x > p.bb.maxX + CORNER_CLEARANCE ||
          z < p.bb.minZ - CORNER_CLEARANCE || z > p.bb.maxZ + CORNER_CLEARANCE) continue;
      if (pointInRing(x, z, p.ring)) return true;
      if (distToRing(x, z, p.ring) < CORNER_CLEARANCE) return true;
    }
    return false;
  };
  // Issue #213: interchange-loop interiors — land enclosed by
  // interchange carriageways (cloverleaf infields and the pockets
  // between carriageways), derived at build time into
  // geodata.loopSites by tools/taipei/build-loops.mjs. The lot
  // gauntlet's road tests clear the carriageways themselves but
  // not the ground they enclose, and OSM's green layer tags only
  // some infields; this class clears the rest, tested exactly
  // like the airfield site. A geodata without the layer (an older
  // build) plans exactly as before.
  const loopPolys = [];
  for (const s of geodata.loopSites || []) loopPolys.push({ ring: s.ring, bb: ringBbox(s.ring) });
  const inLoop = (x, z) => {
    for (const p of loopPolys) {
      if (x < p.bb.minX || x > p.bb.maxX || z < p.bb.minZ || z > p.bb.maxZ) continue;
      if (pointInRing(x, z, p.ring)) return true;
    }
    return false;
  };
  const nearLoop = (x, z) => {
    for (const p of loopPolys) {
      if (x < p.bb.minX - CORNER_CLEARANCE || x > p.bb.maxX + CORNER_CLEARANCE ||
          z < p.bb.minZ - CORNER_CLEARANCE || z > p.bb.maxZ + CORNER_CLEARANCE) continue;
      if (pointInRing(x, z, p.ring)) return true;
      if (distToRing(x, z, p.ring) < CORNER_CLEARANCE) return true;
    }
    return false;
  };

  // Issue #221: school grounds (geodata.schools — every clipped
  // piece of every education ground, generated or skipped) exclude
  // procedural lots by the same two verdicts as the airfield,
  // counted separately. The campuses themselves are generated by
  // planSchoolCampuses (below, where the landmark sites and the
  // carriageways exist) and join plan.siteStructures; this ring
  // verdict is the lot-proofing, so a skipped ground — registry,
  // subsumed, footprint-scale, no-fit — still clears its land.
  const schoolPolys = [];
  for (const s of geodata.schools || []) schoolPolys.push({ ring: s.ring, bb: ringBbox(s.ring) });
  const inSchool = (x, z) => {
    for (const p of schoolPolys) {
      if (x < p.bb.minX || x > p.bb.maxX || z < p.bb.minZ || z > p.bb.maxZ) continue;
      if (pointInRing(x, z, p.ring)) return true;
    }
    return false;
  };
  const nearSchool = (x, z) => {
    for (const p of schoolPolys) {
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
  // Issue #219: every footprint entry also carries its span, its
  // centre and the height it would donate (implied), precomputed
  // once — the sanity guards below and the stepped-massing pass
  // after the lot loop both read them.
  const fpEntries = [];
  if (heightLayer) {
    for (const f of heightLayer.footprints) {
      const bb = ringBbox(f.ring);
      const e = {
        idx: fpEntries.length, ring: f.ring, bb, src: f.src, floors: f.floors, height: f.height,
        span: Math.max(bb.maxX - bb.minX, bb.maxZ - bb.minZ),
        cx: (bb.minX + bb.maxX) / 2, cz: (bb.minZ + bb.maxZ) / 2,
        implied: f.src === 'permit'
          ? (f.floors > 0 ? f.floors * HEIGHT_JOIN.permitM : 0)
          : (f.height > 0 ? f.height : (f.floors > 0 ? f.floors * HEIGHT_JOIN.osmLevelsM : 0)),
        blocked: null,
      };
      fpEntries.push(e);
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
    let permit = null, osm = null;
    for (const e of bucket) {
      if (x < e.bb.minX || x > e.bb.maxX || z < e.bb.minZ || z > e.bb.maxZ) continue;
      if (!pointInRing(x, z, e.ring)) continue;
      // Issue #219: a blocked donor (uncorroborated parcel-scale
      // or extreme claim, see the guard pass below) does not
      // speak; the scan continues so a valid second signal under
      // the same point still can.
      if (e.blocked) continue;
      if (e.src === 'permit' && e.floors > 0) { if (!permit) permit = e; }
      else if (e.src === 'osm' && !osm) osm = e;
    }
    if (permit) return { src: 'permit', floors: permit.floors, fpIdx: permit.idx };
    if (osm) {
      if (osm.height > 0) return { src: 'osm-height', height: osm.height, fpIdx: osm.idx };
      if (osm.floors > 0) return { src: 'osm-levels', floors: osm.floors, fpIdx: osm.idx };
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

  // Issue #219: the join's sanity guards, precomputed per donor.
  // The census (on the issue) found the class: permit/OSM outlines
  // at PARCEL scale donating a whole block's floor count to every
  // lot inside (a 55F permit on a 161 x 152 m parcel made eight
  // 165 m lots in low-rise Shilin), and extreme single-source
  // claims with no second source anywhere near. A donor is
  // GUARDED when its span is parcel-scale (> parcelSpanM) or its
  // implied height is extreme (>= extremeHeightM); a guarded
  // donor still speaks only when CORROBORATED — a second footprint
  // supporting at least corrFrac of the claim with its bbox within
  // corrGapM, or door plates within corrDoorGrowM of the bbox
  // whose tallest floor, at the door factor, supports the same
  // share. Every legitimate extreme in the census is corroborated
  // (the Xinyi 54F permit by an OSM 266 m outline and 54F doors;
  // the twin 43F permits by each other); the Shilin parcel and the
  // 112 m / 165 m-span OSM outline in Beitou have nothing. Blocked
  // donors are skipped by footprintSignalAt, so their lots fall
  // through to the door / field / procedural tiers.
  if (heightLayer) {
    const CORR_CELL = 128;
    const corrGrid = new Map();
    for (const e of fpEntries) {
      const gx0 = Math.floor((e.bb.minX - HEIGHT_JOIN.corrGapM) / CORR_CELL), gx1 = Math.floor((e.bb.maxX + HEIGHT_JOIN.corrGapM) / CORR_CELL);
      const gz0 = Math.floor((e.bb.minZ - HEIGHT_JOIN.corrGapM) / CORR_CELL), gz1 = Math.floor((e.bb.maxZ + HEIGHT_JOIN.corrGapM) / CORR_CELL);
      for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
        const k = fpKey(gx, gz);
        if (!corrGrid.has(k)) corrGrid.set(k, []);
        corrGrid.get(k).push(e);
      }
    }
    const bboxGap = (a, b) => Math.hypot(
      Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX)),
      Math.max(0, Math.max(a.minZ - b.maxZ, b.minZ - a.maxZ)));
    for (const e of fpEntries) {
      if (!e.implied) continue;
      const parcel = e.span > HEIGHT_JOIN.parcelSpanM;
      if (!parcel && e.implied < HEIGHT_JOIN.extremeHeightM) continue;
      const bar = HEIGHT_JOIN.corrFrac * e.implied;
      let corr = false;
      const gx0 = Math.floor((e.bb.minX - HEIGHT_JOIN.corrGapM) / CORR_CELL), gx1 = Math.floor((e.bb.maxX + HEIGHT_JOIN.corrGapM) / CORR_CELL);
      const gz0 = Math.floor((e.bb.minZ - HEIGHT_JOIN.corrGapM) / CORR_CELL), gz1 = Math.floor((e.bb.maxZ + HEIGHT_JOIN.corrGapM) / CORR_CELL);
      for (let gx = gx0; gx <= gx1 && !corr; gx++) for (let gz = gz0; gz <= gz1 && !corr; gz++) {
        for (const g of corrGrid.get(fpKey(gx, gz)) || []) {
          if (g === e || !g.implied || g.implied < bar) continue;
          if (bboxGap(e.bb, g.bb) <= HEIGHT_JOIN.corrGapM) { corr = true; break; }
        }
      }
      if (!corr && doorPts) {
        const grow = HEIGHT_JOIN.corrDoorGrowM;
        const dgx0 = Math.floor((e.bb.minX - grow) / DOOR_CELL), dgx1 = Math.floor((e.bb.maxX + grow) / DOOR_CELL);
        const dgz0 = Math.floor((e.bb.minZ - grow) / DOOR_CELL), dgz1 = Math.floor((e.bb.maxZ + grow) / DOOR_CELL);
        for (let gx = dgx0; gx <= dgx1 && !corr; gx++) for (let gz = dgz0; gz <= dgz1 && !corr; gz++) {
          for (const di of doorGrid.get(fpKey(gx, gz)) || []) {
            const dx = doorPts[di * 3], dz = doorPts[di * 3 + 1];
            if (dx < e.bb.minX - grow || dx > e.bb.maxX + grow || dz < e.bb.minZ - grow || dz > e.bb.maxZ + grow) continue;
            if (doorPts[di * 3 + 2] * HEIGHT_JOIN.doorM >= bar) { corr = true; break; }
          }
        }
      }
      if (!corr) {
        e.blocked = parcel ? 'parcel' : 'extreme';
        if (parcel) stats.heightsGuardParcel++; else stats.heightsGuardExtreme++;
      }
    }
  }

  // Support piers (validate's and taipei-mrt's rule): no pier point
  // — elevated-road or MRT deck — may stand inside a planned lot's
  // footprint. The builders placed both pier sets against the
  // pre-#124 plan, so the block loop owns the test now — the #185
  // pull has always re-checked its moved lots the same way. Tested
  // on the candidate's own frame, grown 0.1 m for the emitted lots'
  // 0.1 m rounding, which is what the audits use.
  const pierPtsAll = [...((geodata.elevatedRoads && geodata.elevatedRoads.piers) || []), ...((geodata.mrtDecks && geodata.mrtDecks.piers) || [])];
  const PIER_CELL_M = 64;
  const pierGridAll = new Map();
  for (const p of pierPtsAll) {
    const k = fpKey(Math.floor(p.x / PIER_CELL_M), Math.floor(p.z / PIER_CELL_M));
    let bucket = pierGridAll.get(k);
    if (!bucket) pierGridAll.set(k, bucket = []);
    bucket.push(p);
  }
  const pierHit = (cx, cz, w, d, cosT, sinT) => {
    const gx = Math.floor(cx / PIER_CELL_M), gz = Math.floor(cz / PIER_CELL_M);
    for (let ix = gx - 1; ix <= gx + 1; ix++) for (let iz = gz - 1; iz <= gz + 1; iz++) {
      for (const p of pierGridAll.get(fpKey(ix, iz)) || []) {
        const dx = p.x - cx, dz = p.z - cz;
        if (Math.abs(dx) <= w / 2 + 0.1 && Math.abs(dz) <= d / 2 + 0.1) return true;
        if (Math.abs(dx * cosT + dz * sinT) <= w / 2 + 0.1 && Math.abs(-dx * sinT + dz * cosT) <= d / 2 + 0.1) return true;
      }
    }
    return false;
  };

  // Issue #124: the fine-grain classifier. Door plates are the
  // densest real-fabric signal the tile carries (137k points): old
  // walk-up fabric registers many plates per hectare of block land,
  // planned big-parcel districts few. Count the plates inside the
  // block's bbox on the door grid built above; the threshold and the
  // calibration live in the #124 study (Datong median ~72/ha,
  // Guangfu ~35/ha; ≥ 60 classes 74% / 31% / 17% of the three sample
  // districts' land as fine). No door layer → no fine blocks, so
  // synthetic geodata plans exactly as before.
  const FINE_DOORS_PER_HA = 60;
  const blockDoorCount = (bb) => {
    if (!doorPts) return 0;
    let n = 0;
    const gx0 = Math.floor(bb.minX / DOOR_CELL), gx1 = Math.floor(bb.maxX / DOOR_CELL);
    const gz0 = Math.floor(bb.minZ / DOOR_CELL), gz1 = Math.floor(bb.maxZ / DOOR_CELL);
    for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
      const bucket = doorGrid.get(fpKey(gx, gz));
      if (!bucket) continue;
      for (const di of bucket) {
        const x = doorPts[di * 3], z = doorPts[di * 3 + 1];
        if (x >= bb.minX && x <= bb.maxX && z >= bb.minZ && z <= bb.maxZ) n++;
      }
    }
    return n;
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
  // Songshan Airport site structures (issue #135): resolved like
  // landmarks but kept off the registry — the plan carries them
  // separately and their site rects join the exclusions (inside
  // the #134 airfield the lot rule already clears the ground;
  // the rects keep the terminal frontage clear regardless).
  const siteStructures = AIRPORT_SITE_STRUCTURES.map((def) => resolveLandmark(def, originLatLon));
  const siteStructureSites = siteStructures.flatMap((s) => s.sites);
  // Issue #221: procedurally generated school campuses join the
  // site structures and render through the same massing path. Their
  // grounds exclude lots by the exact ring verdict (schoolPolys
  // above), so the campuses' bbox sites deliberately do NOT join
  // exclusionSites — an irregular campus bbox would clear whole
  // neighbouring city blocks that are not campus land.
  const schoolPlan = planSchoolCampuses(geodata, landmarkSites, carriageways, originLatLon);
  for (const s of schoolPlan.structures) siteStructures.push(s);
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
    const Wd = s.width || (s.kind === 'jiantan' ? 24 : s.kind === 'beitou' ? 33 : s.kind === 'at-grade' ? 16.5 : s.kind === 'wenhu' ? 20 : s.kind === 'wenhu-open' ? 20 : s.kind === 'entrance' ? 7 : 21.5);
    const hw = s.kind === 'jiantan' ? (Wd + 2) / 2 : s.kind === 'beitou' ? (Wd + 2.6) / 2 : s.kind === 'xinbeitou' ? (Wd + 1.2) / 2 : s.kind === 'at-grade' ? (Wd + 4.6) / 2 : s.kind === 'wenhu' ? (Wd + 1.6) / 2 : s.kind === 'wenhu-open' ? (Wd + 2.2) / 2 : s.kind === 'entrance' ? (Wd + 1.6) / 2 : (Wd + 1.9) / 2;
    const hl = s.kind === 'jiantan' ? 122 : s.kind === 'beitou' ? (L + 4) / 2 : s.kind === 'xinbeitou' ? (L + 2.4) / 2 : s.kind === 'wenhu' ? (L + 1.2) / 2 : s.kind === 'wenhu-open' ? (L + 1.2) / 2 : s.kind === 'entrance' ? (L + 1.6) / 2 : L / 2;
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
  const exclusionSites = towerSite ? [towerSite, ...landmarkSites, ...mrtSites, ...siteStructureSites] : [...landmarkSites, ...mrtSites, ...siteStructureSites];

  const lots = [];
  const lotProcH = []; // issue #128: each lot's procedural draw, index-aligned with lots
  const lotFp = []; // issue #219: each lot's winning footprint entry index (or -1), index-aligned with lots
  // Issue #185: per-lot major-face records for the street-wall pull
  // (index-aligned with lots; null when the lot stands in no face of
  // rank >= FRONTAGE_PULL_MIN_RANK). vF/uF hold [dir, rank] for each
  // qualifying face on that axis; c/s are the block frame's cos/sin.
  const FRONTAGE_PULL_MIN_RANK = 3; // secondary or better, #106 face ranks
  const lotFront = [];
  const blocks = geodata.blocks || [];
  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi];
    stats.blocksSeen++;
    if (!(block.area >= 150)) { stats.blocksSkippedSmall++; continue; }
    if (inPoly(block.cx, block.cz)) { stats.blocksSkippedParkWater++; continue; }
    if (inGreen(block.cx, block.cz)) { stats.blocksSkippedGreen++; continue; }
    if (inAirfield(block.cx, block.cz)) { stats.blocksSkippedAirfield++; continue; }
    if (inNpmSite(block.cx, block.cz)) { stats.blocksSkippedNpmSite++; continue; }
    if (inLoop(block.cx, block.cz)) { stats.blocksSkippedLoop++; continue; }
    if (inSchool(block.cx, block.cz)) { stats.blocksSkippedSchool++; continue; }
    if (!inUnion(block.cx, block.cz)) { stats.blocksSkippedOutsideUnion++; continue; }
    const big = block.area > 40000;
    const pitchMul = big ? 1.7 : 1.0;
    // Issue #124: fine-grain blocks (dense real door fabric, never
    // big blocks) subdivide at shophouse pitch with party-wall gaps
    // and walk-up vacancy; every other block keeps the standard
    // subdivision byte for byte.
    const fine = density !== 'coarse' && !big && blockDoorCount(block.bbox) / (block.area / 1e4) >= FINE_DOORS_PER_HA;
    if (fine) stats.blocksFine++;
    // Fine fabric fronts its lanes near-flush (narrow or arcade
    // sections, not the full street-section band), so its inset is
    // 2 m; the ribbon verdicts still police every footprint.
    const inset = fine ? 2.0 : 3.0; // street-section band margin (see header)
    const minX = block.bbox.minX + inset, maxX = block.bbox.maxX - inset;
    const minZ = block.bbox.minZ + inset, maxZ = block.bbox.maxZ - inset;
    const innerW = maxX - minX, innerD = maxZ - minZ;
    if (innerW < 10 || innerD < 10) continue;
    const vacancy = big ? 0.30 : fine ? (density === 'dense' ? 0.03 : 0.04) : 0.13;
    const frontage = fine ? (density === 'dense' ? 7.5 + hash01(bi * 7919) * 3 : 9 + hash01(bi * 7919) * 3.5) : (15 + hash01(bi * 7919) * 10) * pitchMul;
    const depthPitch = fine ? (density === 'dense' ? 11 + hash01(bi * 104729 + 3) * 3.5 : 12.5 + hash01(bi * 104729 + 3) * 4) : (15 + hash01(bi * 104729 + 3) * 7) * pitchMul;
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
        const gap = fine ? (density === 'dense' ? 0.3 + hash01(seed ^ 0x77c3) * 0.7 : 0.4 + hash01(seed ^ 0x77c3) * 0.8) : 1.2 + hash01(seed ^ 0x77c3) * 1.8;
        // Issue #106: packed rows share party walls — no gap is
        // subtracted along the packed direction, so neighbouring
        // footprints meet at the cell boundary exactly.
        const w = cellW - (packU ? 0 : gap), d = cellD - (packV ? 0 : gap);
        // Issue #124: fine lots may run to true shophouse width
        // (6 m); the standard 7 m floor stands elsewhere.
        if (w < (fine ? 6 : 7) || d < 7) continue;
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
        if (tamsuiRings.length && nearTamsui(cx, cz)) { stats.lotsDroppedRiverside++; continue; }
        if (theta && tamsuiRings.length && corners.some(([px, pz]) => nearTamsui(px, pz))) { stats.lotsDroppedRiverside++; continue; }
        if (inAirfield(cx, cz)) { stats.lotsDroppedAirfield++; continue; }
        if (theta && corners.some(([px, pz]) => nearAirfield(px, pz))) { stats.lotsDroppedAirfield++; continue; }
        if (inNpmSite(cx, cz)) { stats.lotsDroppedNpmSite++; continue; }
        if (theta && corners.some(([px, pz]) => nearNpmSite(px, pz))) { stats.lotsDroppedNpmSite++; continue; }
        if (inLoop(cx, cz)) { stats.lotsDroppedLoop++; continue; }
        if (theta && corners.some(([px, pz]) => nearLoop(px, pz))) { stats.lotsDroppedLoop++; continue; }
        if (inSchool(cx, cz)) { stats.lotsDroppedSchool++; continue; }
        // The school corner verdict runs for UNROTATED lots too
        // (their axis corners): campus grounds are not in the
        // raster block mask, so a block can straddle a boundary
        // and an axis lot centred off-campus could otherwise
        // overhang the ring by metres. (Park/green land never
        // faces this — it is masked upstream of the blocks.)
        const schoolCorners = theta ? corners
          : [[cx - w / 2, cz - d / 2], [cx + w / 2, cz - d / 2], [cx + w / 2, cz + d / 2], [cx - w / 2, cz + d / 2]];
        if (schoolCorners.some(([px, pz]) => nearSchool(px, pz))) { stats.lotsDroppedSchool++; continue; }
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
        if (pierHit(cx, cz, w, d, cosT, sinT)) { stats.lotsDroppedPier++; continue; }
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
        let fpIdx = -1;
        if (heightLayer) {
          const fp = footprintSignalAt(cx, cz);
          if (fp) {
            fpIdx = fp.fpIdx;
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
        if (fine) stats.lotsFine++;
        lots.push(lot);
        lotProcH.push(procH);
        lotFp.push(fpIdx);
        // Issue #185: this lot's grid position and the block's four
        // face ranks, for the street-wall pull below. The direct
        // faces (vF/uF: the face rows/columns the lot stands in, at
        // rank >= FRONTAGE_PULL_MIN_RANK) are only half the story:
        // along the avenues the raster block edge sits at or inside
        // the carriageway edge, so the true first row/column often
        // dies to the ribbon tests at planning and the SURVIVING
        // front row stands one cell back, 10-25 m behind the
        // walkway. That row is the block's de-facto frontage — the
        // post-pass finds it as the outermost surviving lot of each
        // face line and pulls it too (see below).
        const vF = [], uF = [];
        if (row === 0 && edgeRankVLow >= FRONTAGE_PULL_MIN_RANK) vF.push([-1, edgeRankVLow]);
        if (row === rows - 1 && edgeRankVHigh >= FRONTAGE_PULL_MIN_RANK) vF.push([1, edgeRankVHigh]);
        if (col === 0 && edgeRankULow >= FRONTAGE_PULL_MIN_RANK) uF.push([-1, edgeRankULow]);
        if (col === cols - 1 && edgeRankUHigh >= FRONTAGE_PULL_MIN_RANK) uF.push([1, edgeRankUHigh]);
        lotFront.push({ c: cosT, s: sinT, bi, row, col, vF, uF, rVL: edgeRankVLow, rVH: edgeRankVHigh, rUL: edgeRankULow, rUH: edgeRankUHigh });
      }
    }
  }

  // Issue #219: stepped massing for lots sharing one joined
  // footprint. The fine-grain planner subdivides a real complex's
  // footprint into several lots, and the join used to hand EVERY
  // one of them the footprint's full height — a uniform wall of
  // identical slabs where one complex stands (type site: the twin
  // 14-level footprints at Fuguo x Chengde, 2 lots each, all four
  // at 42 m). Now the joined height lands as the complex's
  // massing: the lot nearest the footprint's centre keeps it, and
  // each sibling steps down by rank — 0.90, 0.80, ... floored at
  // 0.55 — with a small seeded jitter so the steps do not read as
  // a staircase. Only groups tall and wide enough to read as a
  // complex wall are stepped (implied >= stepMinHeightM on a
  // footprint spanning >= stepMinSpanM, at least 2 lots); a lone
  // lot, a low building or a narrow footprint keeps the joined
  // height untouched, and hSrc still names the signal — the
  // massing is an estimate of the complex, not a new source. This
  // runs BEFORE the field tier, so the neighbourhood field samples
  // the stepped complex instead of the uniform wall (the corner's
  // field lots stood at 24-30 m on the wall's median).
  if (heightLayer) {
    const stepGroups = new Map();
    for (let i = 0; i < lots.length; i++) {
      const fi = lotFp[i];
      if (fi < 0) continue;
      const e = fpEntries[fi];
      if (!e || e.implied < HEIGHT_JOIN.stepMinHeightM || e.span < HEIGHT_JOIN.stepMinSpanM) continue;
      if (!stepGroups.has(fi)) stepGroups.set(fi, []);
      stepGroups.get(fi).push(i);
    }
    for (const [fi, idxs] of stepGroups) {
      if (idxs.length < 2) continue;
      const e = fpEntries[fi];
      idxs.sort((a, b) => {
        const da = Math.hypot(lots[a].x - e.cx, lots[a].z - e.cz);
        const db = Math.hypot(lots[b].x - e.cx, lots[b].z - e.cz);
        return da - db || lots[a].x - lots[b].x || lots[a].z - lots[b].z;
      });
      stats.heightsSteppedGroups++;
      for (let r = 1; r < idxs.length; r++) {
        const lot = lots[idxs[r]];
        const jitter = 0.96 + hash01((Math.round(lot.x * 10) * 73856093) ^ (Math.round(lot.z * 10) * 19349663) ^ (fi * 83492791)) * 0.07;
        const f = Math.max(0.55, 0.9 - 0.1 * (r - 1)) * jitter;
        const nh = Math.round(lot.h * f * 2) / 2;
        if (nh < lot.h) { lot.h = nh; stats.heightsSteppedLots++; }
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
  // Issue #139, second look (found at the #186 merge gate): the
  // field blend above is the one height change that lands AFTER
  // the block loop's pierce check, and it can raise a 'proc' lot
  // through a guideway its drawn height cleared — a field lot
  // beside the Xinbeitou branch, drawn under the clearance, was
  // blended to 14 m against a 7.2 m underside. Re-run the track
  // verdict for every field-blended lot at its final height and
  // drop the piercers, exactly as the block loop would have.
  // (Bed is position-only and cannot change here; the #185 pull
  // re-checks its own moves with final heights in pullClear.)
  if (trackGrid) {
    const dropIdx = new Set();
    for (let i = 0; i < lots.length; i++) {
      const lot = lots[i];
      if (lot.hSrc !== 'field') continue;
      const c = lot.rot ? Math.cos(lot.rot) : 1, s = lot.rot ? Math.sin(lot.rot) : 0;
      const grown = lotCorners(lot.x, lot.z, lot.w + 2 * TRACK_MARGIN_M, lot.d + 2 * TRACK_MARGIN_M, c, s);
      let mnx = Infinity, mxx = -Infinity, mnz = Infinity, mxz = -Infinity;
      for (const [px, pz] of grown) {
        if (px < mnx) mnx = px;
        if (px > mxx) mxx = px;
        if (pz < mnz) mnz = pz;
        if (pz > mxz) mxz = pz;
      }
      const track = trackVerdict(lot.x, lot.z, grown, mnx, mxx, mnz, mxz);
      if (track.under < Infinity && lot.h > track.under - TRACK_CLEARANCE_M) dropIdx.add(i);
    }
    if (dropIdx.size) {
      stats.lotsDroppedTrackPierce += dropIdx.size;
      const keptLots = lots.filter((_, i) => !dropIdx.has(i));
      lots.length = 0; lots.push(...keptLots);
      const keptProc = lotProcH.filter((_, i) => !dropIdx.has(i));
      lotProcH.length = 0; lotProcH.push(...keptProc);
      const keptFront = lotFront.filter((_, i) => !dropIdx.has(i));
      lotFront.length = 0; lotFront.push(...keptFront);
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

  // ---- Issue #185: the street-wall pull ----
  // Runs after the whole plan (height join and neighbourhood field
  // included) and moves positions only: every lot keeps its size,
  // height, height source and colour, so the plan's counts by
  // height are untouched. Two guards keep the visuals honest:
  //   - facadeMatFor hashes the lot's position, so a pulled
  //     position must reproduce the lot's original facade family —
  //     probed at one height per facadeMatFor band so the equality
  //     holds at any height and the choice is height-regime
  //     independent (see the probe note at the candidate search).
  //     The search tries the flush landing first, then pull
  //     reductions (fine steps inside the ~1 m flush band the
  //     acceptance statistic measures, then coarser ones) and
  //     small shifts along the face, which re-roll the position
  //     hash without changing the setback;
  //   - the moved footprint re-passes the block loop's whole
  //     exclusion gauntlet (park/water, green, riverside, airfield,
  //     union, landmark/depot sites, ribbons + median rule, MRT
  //     bed/pierce), plus two rules the loop never needed: no
  //     overlap with another planned lot (a face the #106 sampling
  //     over-reached must not drag its building across the block
  //     in front of it), and the validate.mjs rule that no
  //     elevated-road pier stands inside a planned lot (the piers
  //     were placed against the pre-pull plan).
  // A lot that satisfies both moves; a lot that cannot keeps its
  // planned position and is counted (lotsFrontageHeldBlocked /
  // lotsFrontageHeldNoBed). Lots with no major face (direct or
  // outermost-surviving) are never candidates, so their placement
  // is byte-identical to before.
  {
    const FRONTAGE_BED_MIN_RANK = 2;  // the bed a face stands on: tertiary or better
    const FRONTAGE_PULL_MAX_M = 20;   // sanity cap — a turned grid can leave a face a cell back
    const FRONTAGE_PULL_MIN_M = 0.3;  // a face this close to its edge already reads flush
    // The sidewalk band a bed of this class grows past its
    // carriageway edge — mirrors sidewalkBandWidth in
    // js/taipei-streetscape.js (this module stays import-free;
    // keep the two in sync, the mrtSites/mrtStationFootprint
    // mirror convention).
    const frontBandWidth = (bed) => {
      const hw = bed.highway || '';
      let w;
      if (hw.endsWith('_link')) w = 1.5;
      else if (hw === 'trunk' || hw === 'primary') w = 2.5;
      else if (hw === 'secondary') w = 2.2;
      else if (hw === 'tertiary') w = 2.0;
      else w = 1.5;
      const half = Math.max((bed.width || 3) / 2, 0.75);
      return Math.min(w, Math.max(1.2, half));
    };
    const FRONT_ARCADE_BAND_W = 3.6; // ARCADE_BAND_W in js/taipei-streetscape.js
    // Fronting segments over the same carriageway set the ribbons
    // use, each carrying its street-section reach past the bed
    // edge: the drawn sidewalk band, the arcade reach, or nothing
    // (shared streets; painted walkways — that band is painted
    // INSIDE the carriageway, see js/taipei-painted.js). The
    // non-carriageway paths join them with no band: OSM maps many
    // avenue sidewalks as separate footway ways running between
    // the carriageway and the blocks, and the buildings front
    // THAT way's outer edge — a face can sit 15 m behind the bed's
    // own band edge with the mapped sidewalk in between. A path
    // segment carries no class of its own here: eligibility comes
    // from the face's major classification, and every guard in
    // pullClear (the path is itself a ribbon) still arbitrates.
    const FRONT_CELL = 48;
    const cellKey = (gx, gz) => gx * 100003 + gz;
    const frontGrid = new Map();
    const frontAdd = (pts, half, rank, band) => {
      for (let i = 0; i + 3 < pts.length; i += 2) {
        const sg = { ax: pts[i], az: pts[i + 1], bx: pts[i + 2], bz: pts[i + 3], half, rank, band };
        const gx0 = Math.floor((Math.min(sg.ax, sg.bx) - 22) / FRONT_CELL), gx1 = Math.floor((Math.max(sg.ax, sg.bx) + 22) / FRONT_CELL);
        const gz0 = Math.floor((Math.min(sg.az, sg.bz) - 22) / FRONT_CELL), gz1 = Math.floor((Math.max(sg.az, sg.bz) + 22) / FRONT_CELL);
        for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
          const k = cellKey(gx, gz);
          let bucket = frontGrid.get(k);
          if (!bucket) frontGrid.set(k, bucket = []);
          bucket.push(sg);
        }
      }
    };
    for (const bed of carriageways) {
      const layout = bed.pedestrianLayout;
      const band = layout === 'sidewalk' ? frontBandWidth(bed) : layout === 'arcade' ? FRONT_ARCADE_BAND_W : 0;
      frontAdd(bed.pts || [], Math.max((bed.width || 3) / 2, 0.75), CLASS_RANK[bed.highway] || 1, band);
    }
    for (const way of paths) {
      frontAdd(way.pts || [], Math.max((way.width || 3) / 2, 0.75), FRONTAGE_BED_MIN_RANK, 0);
    }
    // The gap between a face (centre fx/fz, outward unit normal
    // nx/nz, unit tangent tx/tz, length len) and the street
    // section's outer edge in front of it: the minimum over the
    // bed segments the face actually stands on — in front of the
    // face, running along it, tertiary or better. Sampled at the
    // face centre and at ±40% of its length (the #106 sampling):
    // a bed running even a few degrees off the face binds at the
    // face's tight end, not its centre, and the ribbon verdict is
    // an exact area test — the centre sample alone would pull
    // the tight corner across the carriageway edge. Returns
    // { gap, band } of the binding sample (band: the winning
    // segment's section reach past the bed edge), or null when
    // no bed fronts any sample (the face stands on a lane, or
    // past the pull cap's reach).
    const frontGapAt = (fx, fz, nx, nz, tx, tz, len) => {
      let best = null;
      for (const f of [-0.4, 0, 0.4]) {
        const sx = fx + tx * f * len, sz = fz + tz * f * len;
        const bucket = frontGrid.get(cellKey(Math.floor(sx / FRONT_CELL), Math.floor(sz / FRONT_CELL)));
        if (!bucket) continue;
        for (const sg of bucket) {
          if (sg.rank < FRONTAGE_BED_MIN_RANK) continue;
          const dx = sg.bx - sg.ax, dz = sg.bz - sg.az, L2 = dx * dx + dz * dz || 1e-9;
          let t = ((sx - sg.ax) * dx + (sz - sg.az) * dz) / L2;
          t = Math.max(0, Math.min(1, t));
          const vx = sg.ax + t * dx - sx, vz = sg.az + t * dz - sz;
          const d = Math.hypot(vx, vz);
          if (d <= sg.half) continue;                 // sample inside the bed — not its frontage
          if (vx * nx + vz * nz < 0.55 * d) continue;  // bed not in front of the face
          const sl = Math.sqrt(L2);
          if (Math.abs((dx / sl) * tx + (dz / sl) * tz) < 0.8) continue; // crosses the face, not along it
          const gap = d - sg.half - sg.band;
          if (gap < -0.5) continue;                    // face already past this section edge
          if (best === null || gap < best.gap) best = { gap, band: sg.band };
        }
      }
      return best;
    };
    // Planned lots on a grid, for the overlap guard in pullClear:
    // a face the #106 classification over-reached (an avenue read
    // through a lane and the block across it) must never drag its
    // building across that block's lots. The grid is keyed on the
    // positions lots hold when the pull starts; a pulled lot moves
    // at most FRONTAGE_PULL_MAX_M, and pullClear reads every other
    // lot's CURRENT position from the lots array, so querying
    // generously around the candidate covers moved neighbours.
    const LOT_CELL = 32;
    const lotGrid = new Map();
    lots.forEach((lot, li) => {
      const r = (lot.rot ? Math.hypot(lot.w, lot.d) / 2 : Math.max(lot.w, lot.d) / 2) + 1;
      const gx0 = Math.floor((lot.x - r) / LOT_CELL), gx1 = Math.floor((lot.x + r) / LOT_CELL);
      const gz0 = Math.floor((lot.z - r) / LOT_CELL), gz1 = Math.floor((lot.z + r) / LOT_CELL);
      for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
        const k = cellKey(gx, gz);
        let bucket = lotGrid.get(k);
        if (!bucket) lotGrid.set(k, bucket = []);
        bucket.push(li);
      }
    });
    // Support piers on a small grid (see the guard note). Issue
    // #124: the MRT deck piers join the elevated-road piers here —
    // the block loop tests both sets now, so a pulled lot must too.
    const pierPts = [...((geodata.elevatedRoads && geodata.elevatedRoads.piers) || []), ...((geodata.mrtDecks && geodata.mrtDecks.piers) || [])];
    const PIER_CELL = 64;
    const pierGrid = new Map();
    pierPts.forEach((p, pi) => {
      const k = cellKey(Math.floor(p.x / PIER_CELL), Math.floor(p.z / PIER_CELL));
      let bucket = pierGrid.get(k);
      if (!bucket) pierGrid.set(k, bucket = []);
      bucket.push(pi);
    });
    // The block loop's exclusion gauntlet at a pulled position.
    // The one deliberate exception is the inset-bbox test: leaving
    // the 3 m inset margin for the street section is the pull's
    // whole point — the ribbon verdicts are the real boundary.
    const pullClear = (lot, lotIndex, rec, nx, nz) => {
      const { w, d, h } = lot;
      const turned = lot.rot !== undefined;
      const corners = turned ? lotCorners(nx, nz, w, d, rec.c, rec.s) : null;
      let aabb = null;
      if (turned) {
        aabb = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
        for (const [px, pz] of corners) {
          if (px < aabb.minX) aabb.minX = px;
          if (px > aabb.maxX) aabb.maxX = px;
          if (pz < aabb.minZ) aabb.minZ = pz;
          if (pz > aabb.maxZ) aabb.maxZ = pz;
        }
      }
      if (inPoly(nx, nz)) return false;
      if (turned && corners.some(([px, pz]) => nearPoly(px, pz))) return false;
      if (inGreen(nx, nz)) return false;
      if (turned && corners.some(([px, pz]) => nearGreen(px, pz))) return false;
      if (tamsuiRings.length && nearTamsui(nx, nz)) return false;
      if (turned && tamsuiRings.length && corners.some(([px, pz]) => nearTamsui(px, pz))) return false;
      if (inAirfield(nx, nz)) return false;
      if (turned && corners.some(([px, pz]) => nearAirfield(px, pz))) return false;
      if (inSchool(nx, nz)) return false;
      const schoolCorners = turned ? corners
        : [[nx - w / 2, nz - d / 2], [nx + w / 2, nz - d / 2], [nx + w / 2, nz + d / 2], [nx - w / 2, nz + d / 2]];
      if (schoolCorners.some(([px, pz]) => nearSchool(px, pz))) return false;
      if (!inUnion(nx, nz)) return false;
      for (const s of exclusionSites) {
        if (nx + w / 2 > s.minX && nx - w / 2 < s.maxX && nz + d / 2 > s.minZ && nz - d / 2 < s.maxZ) return false;
      }
      if (depotHit(nx, nz, w / 2, d / 2)) return false;
      if (turned) {
        let siteHit = false;
        for (const s of exclusionSites) {
          if (aabb.maxX < s.minX || aabb.minX > s.maxX || aabb.maxZ < s.minZ || aabb.minZ > s.maxZ) continue;
          if (quadsIntersect(corners, [[s.minX, s.minZ], [s.maxX, s.minZ], [s.maxX, s.maxZ], [s.minX, s.maxZ]])) { siteHit = true; break; }
        }
        if (!siteHit && depotHit(nx, nz, (aabb.maxX - aabb.minX) / 2, (aabb.maxZ - aabb.minZ) / 2)) siteHit = true;
        if (siteHit) return false;
      }
      if (ribbonVerdict(nx, nz, w, d)) return false;
      if (turned) {
        if (rotatedRoadHit(nx, nz, w, d, rec.c, rec.s)) return false;
        if (ribbonVerdict(nx, nz, aabb.maxX - aabb.minX, aabb.maxZ - aabb.minZ) === 'median') return false;
      }
      const trackGrown = lotCorners(nx, nz, w + 2 * TRACK_MARGIN_M, d + 2 * TRACK_MARGIN_M, rec.c, rec.s);
      let tgMinX = Infinity, tgMaxX = -Infinity, tgMinZ = Infinity, tgMaxZ = -Infinity;
      for (const [px, pz] of trackGrown) {
        if (px < tgMinX) tgMinX = px;
        if (px > tgMaxX) tgMaxX = px;
        if (pz < tgMinZ) tgMinZ = pz;
        if (pz > tgMaxZ) tgMaxZ = pz;
      }
      const track = trackVerdict(nx, nz, trackGrown, tgMinX, tgMaxX, tgMinZ, tgMaxZ);
      if (track.bed) return false;
      if (track.under < Infinity && h > track.under - TRACK_CLEARANCE_M) return false;
      for (const [ox, oz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        if (!inUnion(nx + (ox * w) / 2, nz + (oz * d) / 2)) return false;
      }
      if (turned && corners.some(([px, pz]) => !inUnion(px, pz))) return false;
      const pcx = Math.floor(nx / PIER_CELL), pcz = Math.floor(nz / PIER_CELL);
      for (let gx = pcx - 1; gx <= pcx + 1; gx++) for (let gz = pcz - 1; gz <= pcz + 1; gz++) {
        for (const pi of pierGrid.get(cellKey(gx, gz)) || []) {
          const p = pierPts[pi];
          if (Math.abs(p.x - nx) <= w / 2 && Math.abs(p.z - nz) <= d / 2) return false;
          if (turned) {
            const dx = p.x - nx, dz = p.z - nz;
            if (Math.abs(dx * rec.c + dz * rec.s) <= w / 2 && Math.abs(-dx * rec.s + dz * rec.c) <= d / 2) return false;
          }
        }
      }
      // No overlap with any other planned lot (see the lotGrid
      // note). The candidate is shrunk a hair so the exact party-
      // wall touches of packed rows do not read as overlaps.
      const cand = lotCorners(nx, nz, Math.max(w - 0.12, 0.1), Math.max(d - 0.12, 0.1), rec.c, rec.s);
      const candAabb = turned ? aabb : { minX: nx - w / 2, maxX: nx + w / 2, minZ: nz - d / 2, maxZ: nz + d / 2 };
      const reach = Math.hypot(w, d) / 2 + 34 + FRONTAGE_PULL_MAX_M;
      const seenLot = new Set();
      const lgx0 = Math.floor((nx - reach) / LOT_CELL), lgx1 = Math.floor((nx + reach) / LOT_CELL);
      const lgz0 = Math.floor((nz - reach) / LOT_CELL), lgz1 = Math.floor((nz + reach) / LOT_CELL);
      for (let gx = lgx0; gx <= lgx1; gx++) for (let gz = lgz0; gz <= lgz1; gz++) {
        for (const li of lotGrid.get(cellKey(gx, gz)) || []) {
          if (li === lotIndex || seenLot.has(li)) continue;
          seenLot.add(li);
          const o = lots[li];
          const oc = o.rot !== undefined
            ? lotCorners(o.x, o.z, o.w, o.d, Math.cos(o.rot), Math.sin(o.rot))
            : lotCorners(o.x, o.z, o.w, o.d, 1, 0);
          // AABB reject before the SAT (most neighbours are far).
          let oMinX = Infinity, oMaxX = -Infinity, oMinZ = Infinity, oMaxZ = -Infinity;
          for (const [px, pz] of oc) {
            if (px < oMinX) oMinX = px;
            if (px > oMaxX) oMaxX = px;
            if (pz < oMinZ) oMinZ = pz;
            if (pz > oMaxZ) oMaxZ = pz;
          }
          if (oMaxX < candAabb.minX || oMinX > candAabb.maxX || oMaxZ < candAabb.minZ || oMinZ > candAabb.maxZ) continue;
          if (quadsIntersect(cand, oc)) return false;
        }
      }
      return true;
    };

    // Outermost surviving lot of every block face line (see the
    // lotFront note): for each (block, face, line) the surviving
    // lot closest to that face. Lines whose first cell survived
    // resolve to that same lot (already a direct face); lines
    // whose first cell died at planning resolve one cell back —
    // that lot gains the face here.
    const outerU = new Map(), outerV = new Map();
    for (let i = 0; i < lots.length; i++) {
      const r = lotFront[i];
      const kU = `${r.bi}|${r.row}`, kV = `${r.bi}|${r.col}`;
      const cu = outerU.get(kU), cv = outerV.get(kV);
      if (!cu) outerU.set(kU, { lo: i, hi: i });
      else {
        if (r.col < lotFront[cu.lo].col) cu.lo = i;
        if (r.col > lotFront[cu.hi].col) cu.hi = i;
      }
      if (!cv) outerV.set(kV, { lo: i, hi: i });
      else {
        if (r.row < lotFront[cv.lo].row) cv.lo = i;
        if (r.row > lotFront[cv.hi].row) cv.hi = i;
      }
    }

    for (let i = 0; i < lots.length; i++) {
      const rec0 = lotFront[i];
      const lot = lots[i];
      // Effective faces: the direct ones plus any face this lot is
      // the outermost survivor of (at major rank).
      const vF = rec0.vF.slice(), uF = rec0.uF.slice();
      const ou = outerU.get(`${rec0.bi}|${rec0.row}`), ov = outerV.get(`${rec0.bi}|${rec0.col}`);
      if (ou.lo === i && rec0.col > 0 && rec0.rUL >= FRONTAGE_PULL_MIN_RANK && !uF.some(([dir]) => dir === -1)) uF.push([-1, rec0.rUL]);
      if (ou.hi === i && rec0.rUH >= FRONTAGE_PULL_MIN_RANK && !uF.some(([dir]) => dir === 1)) uF.push([1, rec0.rUH]);
      if (ov.lo === i && rec0.row > 0 && rec0.rVL >= FRONTAGE_PULL_MIN_RANK && !vF.some(([dir]) => dir === -1)) vF.push([-1, rec0.rVL]);
      if (ov.hi === i && rec0.rVH >= FRONTAGE_PULL_MIN_RANK && !vF.some(([dir]) => dir === 1)) vF.push([1, rec0.rVH]);
      if (!vF.length && !uF.length) continue;
      const rec = { c: rec0.c, s: rec0.s, vF, uF };
      const U = [rec.c, rec.s], V = [-rec.s, rec.c];
      // One pull per axis. A lot spanning a one-row/one-column
      // block stands in both faces of that axis; the more set-back
      // face wins the pull (the other face keeps its wall, one
      // pull's width further back). state: 'pull' (amount along
      // unit normal n), 'flush' (every face on its section edge),
      // 'absent' (no face on this axis), 'none' (a face exists but
      // no fronting bed in range serves it).
      const axisPull = (faces, N, T, halfExtent, faceLen) => {
        if (!faces.length) return { state: 'absent' };
        let pull = null, sawBed = false, allFlush = true;
        for (const [dir] of faces) {
          const n = [N[0] * dir, N[1] * dir];
          const fg = frontGapAt(lot.x + n[0] * halfExtent, lot.z + n[1] * halfExtent, n[0], n[1], T[0], T[1], faceLen);
          if (fg === null) { allFlush = false; continue; }
          sawBed = true;
          // The legal landing: the section edge, except that a
          // band-less section (shared/painted — its edge IS the
          // carriageway edge) keeps the ribbon rule's 0.5 m margin
          // plus a rounding hair: the face stops 0.6 m short of
          // the bed edge there instead of on it.
          const amount = fg.gap - Math.max(0, 0.6 - fg.band);
          if (amount <= 0 || fg.gap <= FRONTAGE_PULL_MIN_M) continue;
          allFlush = false;
          if (amount > FRONTAGE_PULL_MAX_M) continue;
          if (!pull || amount > pull.amount) pull = { n, amount };
        }
        if (pull) return { state: 'pull', n: pull.n, amount: pull.amount };
        if (sawBed && allFlush) return { state: 'flush' };
        return { state: 'none' };
      };
      const pullV = axisPull(rec.vF, V, U, lot.d / 2, lot.w);
      const pullU = axisPull(rec.uF, U, V, lot.w / 2, lot.d);
      const pv = pullV.state === 'pull' ? pullV.amount : 0;
      const pu = pullU.state === 'pull' ? pullU.amount : 0;
      if (!pv && !pu) {
        const settled = (s) => s.state === 'flush' || s.state === 'absent';
        if (settled(pullV) && settled(pullU) && (pullV.state === 'flush' || pullU.state === 'flush')) stats.lotsFrontageFlush++;
        else stats.lotsFrontageHeldNoBed++;
        continue;
      }
      // The facade guard: facadeMatFor hashes the lot's position,
      // so an arbitrary landing re-rolls the facade family — the
      // candidate must reproduce the lot's family. It reads lot.h
      // ONLY through the band thresholds 12/15/22/30/36/40, so
      // equality is probed at one height per band (7 probes): a
      // position that matches under every probe renders the same
      // family at ANY height, which keeps the material census
      // exact in the real plan AND makes the choice independent of
      // the height regime (the heights byte-stability test plans
      // with heights:null and expects untouched lots byte-stable —
      // a guard keyed on the lot's own h would pick different
      // landings in the two regimes). Vertical signs are NOT
      // guarded: taipeiVerticalSigns gates on h < 10 and its panel
      // count is not band-separable, and a sign's placement floats
      // were never pinned — a pulled lot's signs re-roll, and the
      // signed share stays inside its pinned band (measured
      // before/after in the #185 evidence).
      const MAT_H_PROBES = [6, 13, 18, 26, 33, 38, 50];
      const probeLot = { ...lot };
      const mats0 = MAT_H_PROBES.map((h) => { probeLot.h = h; return facadeMatFor(probeLot); });
      const visualSame = (nx, nz) => {
        probeLot.x = nx; probeLot.z = nz;
        for (let k = 0; k < MAT_H_PROBES.length; k++) {
          probeLot.h = MAT_H_PROBES[k];
          if (facadeMatFor(probeLot) !== mats0[k]) return false;
        }
        return true;
      };
      const nv = pullV.state === 'pull' ? pullV.n : [0, 0];
      const nu = pullU.state === 'pull' ? pullU.n : [0, 0];
      // Candidate displacements [av, au, sv, su]: pull amounts on
      // the two axes plus shifts along them (sv along U, su along
      // V). The position hash means most exact landings re-roll the
      // facade family, so the search walks offsets — pull
      // reductions (fine steps inside the flush band, then coarser
      // ones: a perpendicular ribbon clipping the pulled face's
      // corner can sit metres deep, and a lot pulled 3 m less is
      // still on its street) and shifts of up to 3 m ALONG the
      // face, which re-roll the hash without changing the face's
      // setback at all. Ordered by total offset, so the
      // least-moved acceptable position wins; the
      // gauntlet gets at most sixteen visual-passing candidates
      // per lot.
      const cands = [];
      if (pv && pu) {
        cands.push([pv, pu, 0, 0]);
        // The all-band facade probe passes only ~1 position in
        // 80, so the exact landing also gets a shift lattice
        // (shifts along the faces re-roll the hash; the overlap
        // and ribbon guards arbitrate the slide).
        for (const sv of [0.6, -0.6, 1.2, -1.2, 1.8, -1.8, 2.4, -2.4]) for (const su of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8, 2.4, -2.4]) cands.push([pv, pu, sv, su]);
        for (let k = 1; k <= 9; k++) {
          const dv = Math.max(0, pv - k / 10), du = Math.max(0, pu - k / 10);
          cands.push([dv, pu, 0, 0], [pv, du, 0, 0], [dv, du, 0, 0]);
        }
        // One flush face beats two almost-flush faces: the
        // single-axis fallbacks come before the deep reductions.
        cands.push([pv, 0, 0, 0], [0, pu, 0, 0]);
        for (const red of [1.4, 2.0, 2.8]) {
          const dv = Math.max(0, pv - red), du = Math.max(0, pu - red);
          cands.push([dv, pu, 0, 0], [pv, du, 0, 0], [dv, du, 0, 0]);
        }
      } else if (pv || pu) {
        const p = pv || pu;
        const pairs = [];
        for (let k = 0; k <= 9; k++) for (const s of [0, 0.25, -0.25, 0.5, -0.5, 0.75, -0.75, 1.0, -1.0, 1.25, -1.25, 1.5, -1.5, 1.75, -1.75, 2.0, -2.0, 2.25, -2.25, 2.5, -2.5, 2.75, -2.75, 3.0, -3.0]) pairs.push([k / 10, s]);
        for (const red of [1.2, 1.6, 2.0, 2.6, 3.2]) for (const s of [0, 0.75, -0.75, 1.5, -1.5, 2.25, -2.25, 3.0, -3.0]) pairs.push([red, s]);
        pairs.sort((a, b) => (a[0] + Math.abs(a[1])) - (b[0] + Math.abs(b[1])) || a[0] - b[0] || Math.abs(a[1]) - Math.abs(b[1]));
        for (const [red, s] of pairs) {
          if (pv) cands.push([Math.max(0, p - red), 0, s, 0]);
          else cands.push([0, Math.max(0, p - red), 0, s]);
        }
      }
      const seenPos = new Set([`${lot.x},${lot.z}`]);
      let applied = false, gauntletTries = 0;
      for (const [av, au, sv, su] of cands) {
        const nx = Math.round((lot.x + nv[0] * av + nu[0] * au + U[0] * sv + V[0] * su) * 10) / 10;
        const nz = Math.round((lot.z + nv[1] * av + nu[1] * au + U[1] * sv + V[1] * su) * 10) / 10;
        const posKey = `${nx},${nz}`;
        if (seenPos.has(posKey)) continue;
        seenPos.add(posKey);
        if (!visualSame(nx, nz)) continue;
        if (++gauntletTries > 16) break;
        if (!pullClear(lot, i, rec, nx, nz)) continue;
        stats.frontagePullMetres += Math.round(Math.hypot(nx - lot.x, nz - lot.z) * 10) / 10;
        lot.x = nx;
        lot.z = nz;
        stats.lotsFrontagePulled++;
        applied = true;
        break;
      }
      if (!applied) stats.lotsFrontageHeldBlocked++;
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
  return { lots, tower, landmarkTowers, siteStructures, stats, schools: schoolPlan.report };
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
// The Xinyi planning district rectangle on its own: issue #142
// scopes its white-tower revision to the district alone, NOT to
// the station-front band — officeCoreFor below is the union of
// the two, and the #136 hold survives in the station half.
export function xinyiDistrictFor(lot) {
  return lot.x >= -450 && lot.x <= 1000 && lot.z >= -1000 && lot.z <= 170;
}
export function officeCoreFor(lot) {
  if (xinyiDistrictFor(lot)) return true; // Xinyi planning district
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
// stays a glass district — until issue #142, see below); outside
// them, lots of 40 m or more wear
// the Taiwan tile types (tallTaiwanTypeFor) with only a small glass
// accent, and the 22–40 m glass share drops from a half to a fifth.
// Issue #142 revises the Xinyi half of that core rule afterwards:
// see xinyiGlassOrLight below.
function facadeMatFor(lot) {
  const seed = (Math.imul(Math.round(lot.x * 10), 73856093) ^ Math.imul(Math.round(lot.z * 10), 19349663) ^ 0x101) | 0;
  const r = hash01(seed);
  const core = officeCoreFor(lot);
  if (lot.h >= 40) {
    if (core) return xinyiGlassOrLight(lot, seed, [3, 4, 5][Math.floor(r * 3) % 3]);
    if (r < 0.12) { const u = r / 0.12; return [3, 4, 5][Math.floor(u * 3) % 3]; } // glass accent: the curtain-wall 豪宅 minority
    return tallTaiwanTypeFor(lot, seed);
  }
  if (lot.h >= 22) {
    if (core) {
      if (r < 0.5) return xinyiGlassOrLight(lot, seed, [3, 4, 5][Math.floor(r * 6) % 3]); // glass half (issue #142 may trade tall Xinyi glass for light)
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

// Issue #142: the user, looking at the #136 result, asked for MORE
// WHITE tall buildings in Xinyi — the one district #136 held glass
// exactly. Reality backs a mix there: the planning district pairs
// its dark curtain-glass landmarks (Taipei 101, Nan Shan — registry
// structures, not plan lots, so this rule can never touch them)
// with many light stone/white towers — the residential slabs south
// of Zhuangjing Rd and the pale office slabs along Keelung Rd and
// Songgao Rd. So inside the district rectangle ONLY, a tall glass
// lot (>= 30 m) trades its glass for a white/light Taiwan family on
// a seeded coin flip: XINYI_WHITE_SHARE of them convert. At 0.5 the
// >= 40 m band goes from 100% glass to about half, and the district
// keeps a real dark-glass minority — it still carries far more
// glass than anywhere else in the tile, so it keeps reading as the
// office core, just no longer as a dark monoculture. Deterministic
// from the lot's own seed, like every other facade rule: the same
// lot converts (or not) on every build. The station-front band is
// NOT in scope — its lots fail the xinyiDistrictFor test and keep
// the #136 hold verbatim, as does every lot under 30 m.
const XINYI_WHITE_SHARE = 0.5;
function xinyiGlassOrLight(lot, seed, glassMat) {
  if (lot.h < 30 || !xinyiDistrictFor(lot)) return glassMat;
  if (hash01(seed ^ 0x1420) >= XINYI_WHITE_SHARE) return glassMat;
  return xinyiLightTypeFor(lot, seed);
}

// The light pick for a converted Xinyi tower: the white/cream tile
// shophouse (6 — its palette is four warm whites and creams) and
// the pebble-dash (9 — four pale stone greys, the light-stone slab
// read) split the conversions evenly; the walk-up slab (8) takes a
// minority share — its palette carries the warm white 0xe6dcc9
// beside the beige anchor, and the district's south strip is
// residential slabs in reality. Family 7 stays out: the arcade
// colonnade is a street-wall ground floor, not a tower language.
function xinyiLightTypeFor(lot, seed) {
  const weights = [[6, 3.0], [9, 3.0], [8, 1.5]];
  const total = weights.reduce((s, [, w]) => s + w, 0);
  let pick = hash01(seed ^ 0x1421) * total;
  for (const [mat, w] of weights) {
    if (pick < w) return mat;
    pick -= w;
  }
  return 6;
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
// Issue #208: the hut record also carries a seeded detail vocabulary
// (roof form, patched sheet panels, a roof bump) — see the hut block.
export const TAIPEI_TANK_RATE = 0.14;
export const TAIPEI_HUT_RATE = 0.12;
// Issue #208: the palette grows from four to six — the original
// weathered red / green / grey-blue / rust plus a galvanized
// grey-green and a weathered off-white, the two other staples of
// the real roofscape. (The renderer's hutPalette in js/buildings.js
// mirrors this list; the hut's colorIdx is drawn modulo its length.)
export const TAIPEI_HUT_COLORS = [0x9e3d34, 0x4a6b52, 0x7d8894, 0x8a4a3a, 0x8fa08f, 0xcac2ae];
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
    const colorIdx = Math.floor(hash01(seed ^ 0x6667) * TAIPEI_HUT_COLORS.length) % TAIPEI_HUT_COLORS.length;
    const hut = {
      x: lot.x0 + w / 2, y: roofY, z: lot.z0 + d / 2, w: hw, d: hd,
      h: 2.5 + hash01(seed ^ 0x2227) * 0.6,
      pitch,
      axis,
      dir: hash01(seed ^ 0x5557) < 0.5 ? -1 : 1,
      colorIdx,
      // Issue #208 detail vocabulary — all drawn from FRESH salts,
      // so which lots carry a hut, their pitch/axis/dir/height and
      // the tank roll are exactly the pre-#208 selection; only the
      // garnish is new. Form: about a third of huts are gable-roofed
      // （雙斜） instead of the single-pitch lean-to sheet （單斜）.
      form: hash01(seed ^ 0x8887) < 0.35 ? 'gable' : 'single',
      patches: [],
      bump: null,
    };
    // Patched panels: ~58% of huts carry one or two replacement
    // sheets on the roof slope, in a contrasting palette tone
    // (rust / galvanized / off-white — never the hut's own colour).
    const patchRoll = hash01(seed ^ 0x9997);
    const patchCount = patchRoll < 0.28 ? 2 : patchRoll < 0.58 ? 1 : 0;
    for (let i = 0; i < patchCount; i++) {
      const ps = (seed ^ (0xaa07 + i * 0x1f3b)) >>> 0;
      let tone = [3, 4, 5][Math.floor(hash01(ps ^ 0x101) * 3) % 3];
      if (tone === colorIdx) tone = (tone + 1) % TAIPEI_HUT_COLORS.length;
      hut.patches.push({
        u: 0.2 + hash01(ps ^ 0x202) * 0.6,        // along the slope, high edge -> low
        v: (hash01(ps ^ 0x303) * 2 - 1) * 0.3,    // across, fraction of the sheet width
        w: 1.2 + hash01(ps ^ 0x404) * 1.6,        // across, metres
        d: 0.9 + hash01(ps ^ 0x505) * 1.1,        // along the slope, metres
        side: hash01(ps ^ 0x606) < 0.5 ? -1 : 1,  // gable: which slope; single: unused
        colorIdx: tone,
      });
    }
    // Roof bump: ~25% of huts carry a small annex box standing on
    // the sheet near the high side (the 加蓋-on-加蓋 stairwell /
    // storage bump of the real roofscape), with its own flat sheet.
    if (hash01(seed ^ 0xbb17) < 0.25) {
      const bs = (seed ^ 0xcc27) >>> 0;
      hut.bump = {
        wFrac: 0.34 + hash01(bs ^ 0x111) * 0.16,  // across, fraction of the hut's across
        dAlong: 2.2 + hash01(bs ^ 0x222) * 1.0,   // along the slope, metres
        h: 1.1 + hash01(bs ^ 0x333) * 0.6,
        colorIdx: hash01(bs ^ 0x444) < 0.5 ? colorIdx : 4, // own colour, or galvanized
      };
    }
    huts.push(hut);
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
    // Issue #207: colliders collected — Taipei's buildings are
    // solid (the pre-#207 visual-only parity is reversed by the
    // issue). buildCityBlocks emits one base collider per lot
    // plus one per part above its 26 m block top, exactly the
    // set Manhattan collides with.
    colliders: true,
    // Issue #240: lot facade materials fade their procedural detail
    // with distance — far buildings stay visible as faint flat
    // boxes. Specials are exempt because their factories never
    // receive this flag (their materials cannot take the faded path).
    farFade: true,
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
// ---- Issue #244: merge + instance the landmark/site-structure path ----
// The old builder emitted one THREE.Mesh per part: 10,447 meshes /
// 2.27M tris for the 196 school campuses alone (dome canopies at
// 28x14 segments dominate), every one a draw call in every pass, with
// no merging, instancing, streaming or LOD. The restructure below
// keeps the near visuals byte-identical in geometry and materials and
// only changes how they reach the GPU:
//  - box/cylinder/dome parts merge per structure per material object
//    (transforms baked from the same meshes the old path built, so
//    the triangles are the same triangles);
//  - school trees (1 trunk colour, 3 canopy colours, uniform shapes)
//    become per-campus InstancedMeshes over shared unit geometries
//    with the exact current segment counts near;
//  - far away, each campus swaps ONLY its trees for low-poly instanced
//    canopies (trunks dropped: sub-pixel past the switch distance).
//    Slabs, track, fences and gates never change, so there is nothing
//    to pop except a few-pixel canopy silhouette.
// Frustum/ridge/wheel parts (registry-only shapes) keep individual
// meshes: their custom soups don't share the mergeable attribute set.
export const SCHOOL_DOME_WIDTH_SEGMENTS = 28;
export const SCHOOL_DOME_HEIGHT_SEGMENTS = 14;
// Far canopies: 12x6 segments (132 tris vs 756). At the 700 m switch
// a ~5 m canopy spans ~8 px; the facet sagitta is ~0.15 px.
export const SCHOOL_LOD_FAR_DOME_WIDTH_SEGMENTS = 12;
export const SCHOOL_LOD_FAR_DOME_HEIGHT_SEGMENTS = 6;
// Hysteresis band: swap to far beyond 700 m, back to near inside 600 m,
// so a camera hovering at the switch distance never flickers.
export const SCHOOL_LOD_FAR_M = 700;
export const SCHOOL_LOD_NEAR_M = 600;

export function domeTriangleCount(widthSegments, heightSegments) {
  return widthSegments * (heightSegments - 1) * 2 + widthSegments;
}

// Concatenate indexed geometries that share the position/normal/uv
// attribute set into one geometry (single material; groups dropped).
// Returns null when the set doesn't match, so the caller can fall back
// to individual meshes instead of corrupting a structure.
function mergePartGeometries(THREE, geometries) {
  let vTotal = 0, iTotal = 0;
  for (const g of geometries) {
    if (!g.index || !g.attributes.position || !g.attributes.normal || !g.attributes.uv) return null;
    if (g.attributes.position.itemSize !== 3 || g.attributes.normal.itemSize !== 3 || g.attributes.uv.itemSize !== 2) return null;
    vTotal += g.attributes.position.count;
    iTotal += g.index.count;
  }
  const position = new Float32Array(vTotal * 3);
  const normal = new Float32Array(vTotal * 3);
  const uv = new Float32Array(vTotal * 2);
  const index = new Uint32Array(iTotal);
  let vOff = 0, iOff = 0;
  for (const g of geometries) {
    position.set(g.attributes.position.array, vOff * 3);
    normal.set(g.attributes.normal.array, vOff * 3);
    uv.set(g.attributes.uv.array, vOff * 2);
    const src = g.index.array;
    for (let i = 0; i < src.length; i++) index[iOff + i] = src[i] + vOff;
    vOff += g.attributes.position.count;
    iOff += src.length;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  merged.setIndex(new THREE.BufferAttribute(index, 1));
  merged.computeBoundingSphere();
  return merged;
}

// Issue #255: far despawn for fence-like site structures (the
// CKS Memorial Hall perimeter wall runs) and the Xinyi
// skybridges. A 3 m wall run at the despawn distance spans
// ~1–2 px — measured from frames, see
// xinyi255-evidence/MEASUREMENT.md. Hysteresis band, the #244
// pattern: hide past FAR, show again inside NEAR.
export const DESPAWN_FAR_M = 1500;
export const DESPAWN_NEAR_M = 1300;

// Per-frame far despawn. `entries` carry the toggled object, its
// plan position and its current state — pure visibility flags,
// no geometry work per frame. Shared by the CKS fence runs
// (taipei-buildings.js, stashed on the landmark group) and the
// skybridge chains (taipei-skybridges.js, stashed on the
// skybridge group); the two updaters below are thin wrappers
// over this core so both stay testable with fake objects.
export function updateDespawnEntries(entries, camX, camZ) {
  for (const e of entries) {
    const dx = e.x - camX, dz = e.z - camZ;
    const d2 = dx * dx + dz * dz;
    if (e.shown && d2 > DESPAWN_FAR_M * DESPAWN_FAR_M) {
      e.shown = false;
      e.mesh.visible = false;
    } else if (!e.shown && d2 < DESPAWN_NEAR_M * DESPAWN_NEAR_M) {
      e.shown = true;
      e.mesh.visible = true;
    }
  }
}

export function updateDespawnGroup(group, camX, camZ) {
  const entries = group && group.userData ? group.userData.despawn : null;
  if (entries && entries.length) updateDespawnEntries(entries, camX, camZ);
}

// Per-frame far swap for school campuses. `entries` is the array the
// builder stashes on the group (see createTaipeiLandmarkTowers); each
// entry carries its near/far tree groups, its plan position and its
// current mode. Pure visibility flags — no geometry work per frame.
export function updateSchoolLod(entries, camX, camZ) {
  for (const e of entries) {
    const dx = e.x - camX, dz = e.z - camZ;
    const d2 = dx * dx + dz * dz;
    if (e.mode !== 'far' && d2 > SCHOOL_LOD_FAR_M * SCHOOL_LOD_FAR_M) {
      e.mode = 'far';
      e.near.visible = false;
      e.far.visible = true;
    } else if (e.mode !== 'near' && d2 < SCHOOL_LOD_NEAR_M * SCHOOL_LOD_NEAR_M) {
      e.mode = 'near';
      e.near.visible = true;
      e.far.visible = false;
    }
  }
}

export function updateSchoolLodGroup(group, camX, camZ) {
  const entries = group && group.userData ? group.userData.schoolLod : null;
  if (entries && entries.length) updateSchoolLod(entries, camX, camZ);
}

// Issue #255: the same 700/600 m swap for registry specials with
// farParts — the entry's near subgroup (full detail) hides past
// SCHOOL_LOD_FAR_M and its far subgroup (simplified massing)
// shows; the massing itself never despawns, only simplifies.
export function updateSpecialLodGroup(group, camX, camZ) {
  const entries = group && group.userData ? group.userData.specialLod : null;
  if (entries && entries.length) updateSchoolLod(entries, camX, camZ);
}

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
  // Issue #244: shared unit geometries for instanced school trees.
  const nearTrunkGeo = new THREE.CylinderGeometry(1, 1, 1, 24);
  const nearDomeGeo = new THREE.SphereGeometry(1, SCHOOL_DOME_WIDTH_SEGMENTS, SCHOOL_DOME_HEIGHT_SEGMENTS, 0, Math.PI * 2, 0, Math.PI / 2);
  const farDomeGeo = new THREE.SphereGeometry(1, SCHOOL_LOD_FAR_DOME_WIDTH_SEGMENTS, SCHOOL_LOD_FAR_DOME_HEIGHT_SEGMENTS, 0, Math.PI * 2, 0, Math.PI / 2);
  const lodEntries = [];
  const specialLodEntries = [];
  const despawnEntries = [];
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
    // Issue #255: fence-like parts (despawnFar) leave the merged
    // path — one group per run (parts sharing a centre + rotY),
    // toggled whole by the despawn updater. Their geometry is
    // unchanged (same constructors, same transforms); only the
    // delivery differs, and runs are never merged across runs
    // so each run despawns on its own distance.
    const fenceRuns = new Map();
    // Issue #244: bucket mergeable parts per material object, and
    // divert school trees into per-campus instanced meshes. Meshes
    // are still built exactly as before (same constructors, same
    // transforms); only their delivery to the GPU changes.
    const buckets = new Map();
    const treeBuckets = s.school ? new Map() : null;
    const isTreeTrunk = (part) => part.type === 'cylinder' && part.flat === SCHOOL_TRUNK_COLOR;
    const isTreeCanopy = (part) => part.type === 'dome' && typeof part.flat === 'number' &&
      SCHOOL_CANOPY_COLORS.includes(part.flat) && !part.flip;
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
        mesh = new THREE.Mesh(new THREE.SphereGeometry(1, SCHOOL_DOME_WIDTH_SEGMENTS, SCHOOL_DOME_HEIGHT_SEGMENTS, 0, Math.PI * 2, 0, Math.PI / 2), partMaterial(part, false));
        mesh.scale.set(part.rx, part.h, part.rz);
        mesh.position.set(s.x + (part.dx || 0), y0, s.z + (part.dz || 0));
        // flip: the same hemisphere hung below its base plane —
        // the bottom half of a full ellipsoid (the TPAC sphere,
        // issue #144) without a second geometry type; the plan
        // disc the issue-#42 audit tests is unchanged.
        if (part.flip) mesh.rotation.x = Math.PI;
      } else if (part.type === 'frustum') {
        mesh = new THREE.Mesh(frustumGeometry(THREE, part), partMaterial(part, true));
        mesh.position.set(s.x, y0, s.z);
      } else if (part.type === 'ridge') {
        mesh = new THREE.Mesh(ridgeGeometry(THREE, part), partMaterial(part, true));
        mesh.position.set(s.x, y0, s.z);
      } else if (part.type === 'wheel') {
        // Ferris wheel (issue #186, Miramar): authored as y0 = the
        // wheel's bottom elevation and h = its diameter, so the
        // landmark test's part-top formula (y0 + h) reads the apex.
        // The wheel stands in the tile x-y plane (axle along z);
        // its ground contact is the separate pylon boxes in the
        // registry entry, which the issue-#42 audit sees — the
        // wheel part itself is airborne mass (rim, spokes, cabins)
        // and stays out of the audit's part vocabulary on purpose.
        const g = new THREE.Group();
        const R = part.h / 2, cy = y0 + R;
        const rimMat = partMaterial(part, false);
        const cabinMat = part.cabinFlat !== undefined ? flatPartMaterial(part.cabinFlat, false) : rimMat;
        const addMesh = (geo, mat, x, y, z, rz) => {
          const m = new THREE.Mesh(geo, mat);
          m.position.set(x, y, z);
          if (rz) m.rotation.z = rz;
          m.castShadow = true;
          g.add(m);
        };
        addMesh(new THREE.TorusGeometry(R - 1.0, 1.05, 8, 56), rimMat, 0, cy, 0);
        addMesh(new THREE.TorusGeometry(R * 0.86, 0.55, 6, 48), rimMat, 0, cy, 0);
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          addMesh(new THREE.BoxGeometry(0.5, R * 0.86, 0.5), rimMat, Math.cos(a) * R * 0.43, cy + Math.sin(a) * R * 0.43, 0, a - Math.PI / 2);
        }
        addMesh(new THREE.BoxGeometry(5.2, 5.2, 5.6), rimMat, 0, cy, 0);
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          addMesh(new THREE.BoxGeometry(3.6, 3.9, 3.4), cabinMat, Math.cos(a) * (R - 1.0), cy + Math.sin(a) * (R - 1.0) - 1.4, 0);
        }
        g.position.set(s.x + (part.dx || 0), 0, s.z + (part.dz || 0));
        mesh = g;
      }
      if (!mesh) continue;
      if (part.despawnFar) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const key = `${part.dx || 0}|${part.dz || 0}|${part.rotY || 0}`;
        let run = fenceRuns.get(key);
        if (!run) fenceRuns.set(key, (run = { meshes: [], x: s.x + (part.dx || 0), z: s.z + (part.dz || 0) }));
        run.meshes.push(mesh);
        continue;
      }
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (treeBuckets && (isTreeTrunk(part) || isTreeCanopy(part))) {
        // School trees: keep the mesh's matrix, deliver it as an
        // instance of a shared unit geometry instead of a mesh.
        // The trunk mesh bakes (r, h) into its geometry, so the
        // instance matrix re-applies them as a scale on the right.
        mesh.updateMatrix();
        const mtx = mesh.matrix.clone();
        if (isTreeTrunk(part)) mtx.multiply(new THREE.Matrix4().makeScale(part.r, part.h, part.rz || part.r));
        let b = treeBuckets.get(mesh.material);
        if (!b) treeBuckets.set(mesh.material, (b = { trunks: [], canopies: [] }));
        (isTreeTrunk(part) ? b.trunks : b.canopies).push(mtx);
      } else if (part.type === 'box' || part.type === 'cylinder' || part.type === 'dome') {
        let list = buckets.get(mesh.material);
        if (!list) buckets.set(mesh.material, (list = []));
        list.push(mesh);
      } else {
        sub.add(mesh); // frustum / ridge / wheel: individual meshes
      }
    }
    for (const [material, meshes] of buckets) {
      if (meshes.length === 1) { sub.add(meshes[0]); continue; }
      const geos = meshes.map((m) => { m.updateMatrix(); return m.geometry.clone().applyMatrix4(m.matrix); });
      const merged = mergePartGeometries(THREE, geos);
      if (!merged) { for (const m of meshes) sub.add(m); continue; }
      const mergedMesh = new THREE.Mesh(merged, material);
      mergedMesh.castShadow = true;
      mergedMesh.receiveShadow = true;
      sub.add(mergedMesh);
    }
    if (treeBuckets && treeBuckets.size) {
      const nearTrees = new THREE.Group();
      nearTrees.name = `${s.id}-trees-near`;
      const farTrees = new THREE.Group();
      farTrees.name = `${s.id}-trees-far`;
      farTrees.visible = false;
      for (const [material, b] of treeBuckets) {
        if (b.trunks.length) {
          const im = new THREE.InstancedMesh(nearTrunkGeo, material, b.trunks.length);
          b.trunks.forEach((mtx, i) => im.setMatrixAt(i, mtx));
          im.instanceMatrix.needsUpdate = true;
          im.castShadow = true;
          im.receiveShadow = true;
          nearTrees.add(im);
        }
        if (b.canopies.length) {
          const im = new THREE.InstancedMesh(nearDomeGeo, material, b.canopies.length);
          b.canopies.forEach((mtx, i) => im.setMatrixAt(i, mtx));
          im.instanceMatrix.needsUpdate = true;
          im.castShadow = true;
          im.receiveShadow = true;
          nearTrees.add(im);
          const far = new THREE.InstancedMesh(farDomeGeo, material, b.canopies.length);
          b.canopies.forEach((mtx, i) => far.setMatrixAt(i, mtx));
          far.instanceMatrix.needsUpdate = true;
          far.castShadow = true;
          far.receiveShadow = true;
          farTrees.add(far);
        }
      }
      sub.add(nearTrees);
      sub.add(farTrees);
      lodEntries.push({ near: nearTrees, far: farTrees, x: s.x, z: s.z, mode: 'near' });
    }
    const signMesh = landmarkSignMesh(THREE, s);
    if (signMesh) sub.add(signMesh);
    if (fenceRuns.size) {
      let runIndex = 0;
      for (const run of fenceRuns.values()) {
        const runGroup = new THREE.Group();
        runGroup.name = `${s.id}-fence-${runIndex++}`;
        for (const m of run.meshes) runGroup.add(m);
        group.add(runGroup);
        despawnEntries.push({ mesh: runGroup, x: run.x, z: run.z, shown: true });
      }
    }
    if (s.farParts && s.farParts.length) {
      // Issue #255: simplified far massing — flat materials only,
      // no sign, no thin members. The near subgroup hides past
      // the LOD distance and this one shows; the structure
      // itself stays visible (the #240 rule for specials).
      const farSub = new THREE.Group();
      farSub.name = `${s.id}-far`;
      farSub.visible = false;
      const farFlat = (part) => flatPartMaterial(
        part.flat !== undefined && part.flat !== null ? part.flat : s.color, false);
      const farBuckets = new Map();
      for (const part of s.farParts) {
        const y0 = part.y0 || 0;
        let mesh = null;
        if (part.type === 'box') {
          mesh = new THREE.Mesh(new THREE.BoxGeometry(part.w, part.h, part.d), farFlat(part));
          mesh.position.set(s.x + (part.dx || 0), y0 + part.h / 2, s.z + (part.dz || 0));
          if (part.rotY) mesh.rotation.y = -part.rotY;
        } else if (part.type === 'cylinder') {
          mesh = new THREE.Mesh(new THREE.CylinderGeometry(part.r, part.r, part.h, 24), farFlat(part));
          if (part.rz) mesh.scale.z = part.rz / part.r;
          mesh.position.set(s.x + (part.dx || 0), y0 + part.h / 2, s.z + (part.dz || 0));
        } else if (part.type === 'dome') {
          mesh = new THREE.Mesh(new THREE.SphereGeometry(1, SCHOOL_DOME_WIDTH_SEGMENTS, SCHOOL_DOME_HEIGHT_SEGMENTS, 0, Math.PI * 2, 0, Math.PI / 2), farFlat(part));
          mesh.scale.set(part.rx, part.h, part.rz);
          mesh.position.set(s.x + (part.dx || 0), y0, s.z + (part.dz || 0));
          if (part.flip) mesh.rotation.x = Math.PI;
        } else if (part.type === 'frustum') {
          mesh = new THREE.Mesh(frustumGeometry(THREE, part), flatPartMaterial(
            part.flat !== undefined && part.flat !== null ? part.flat : s.color, true));
          mesh.position.set(s.x, y0, s.z);
        }
        if (!mesh) continue;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        if (part.type === 'frustum') { farSub.add(mesh); continue; }
        let list = farBuckets.get(mesh.material);
        if (!list) farBuckets.set(mesh.material, (list = []));
        list.push(mesh);
      }
      for (const [material, meshes] of farBuckets) {
        if (meshes.length === 1) { farSub.add(meshes[0]); continue; }
        const geos = meshes.map((m) => { m.updateMatrix(); return m.geometry.clone().applyMatrix4(m.matrix); });
        const merged = mergePartGeometries(THREE, geos);
        if (!merged) { for (const m of meshes) farSub.add(m); continue; }
        const mergedMesh = new THREE.Mesh(merged, material);
        mergedMesh.castShadow = true;
        mergedMesh.receiveShadow = true;
        farSub.add(mergedMesh);
      }
      group.add(farSub);
      specialLodEntries.push({ near: sub, far: farSub, x: s.x, z: s.z, mode: 'near' });
    }
    group.add(sub);
  }
  group.userData.schoolLod = lodEntries;
  group.userData.specialLod = specialLodEntries;
  group.userData.despawn = despawnEntries;
  return group;
}
