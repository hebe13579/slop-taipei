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
// plus the tower's signature eight stacked, flared trapezoid tiers and
// a spire, at the landmark's true 508 m overall height, in dark
// glass-green. It stands on the northern part of the landmark site so
// the tile's spawn points (at the landmark point, south of it) stay in
// the open. Detailed facade treatment is later scope.
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
        if (towerSite && cx + w / 2 > towerSite.minX && cx - w / 2 < towerSite.maxX && cz + d / 2 > towerSite.minZ && cz - d / 2 < towerSite.maxZ) {
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

  // Taipei 101 massing (see header): podium + 8 flared trapezoid tiers
  // + spire at the true 508 m overall height, centred on the northern
  // part of the landmark site so the spawn points stay clear.
  let tower = null;
  if (t101) {
    const tx = t101.x - 10, tz = t101.z - 45;
    const podium = { w: 76, d: 64, h: 9 };
    const tierTop = 458, tiers = [];
    const jointHW = (i) => 25 - (13 * i) / 8; // half-width at each of the 9 tier joints
    for (let i = 0; i < 8; i++) {
      tiers.push({
        y0: podium.h + ((tierTop - podium.h) * i) / 8,
        h: (tierTop - podium.h) / 8,
        hwBottom: jointHW(i) - (i > 0 ? 1.4 : 0), // step in at each bamboo joint
        hwTop: jointHW(i + 1) + 1.2,              // flare out to the tier's lip
      });
    }
    tower = { x: tx, z: tz, podium, tiers, spire: { y0: tierTop, h: 508 - tierTop, w: 2.4 }, totalHeight: 508 };
  }
  return { lots, tower, stats };
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

// The Taipei 101 massing as plain meshes (podium + eight flared tiers +
// spire, dark glass-green). `THREE` is passed in (the boot module owns
// the three import) so the planner above stays three-free and
// unit-testable in plain node. Returns null when the geodata has no
// Taipei 101 landmark.
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
  const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.4, t.spire.h, 6), glassMat);
  spire.position.set(t.x, t.spire.y0 + t.spire.h / 2, t.z);
  spire.castShadow = true;
  towerGroup.add(spire);
  return towerGroup;
}
