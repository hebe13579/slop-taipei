// js/taipei-green.js — green-layer ground tint (issue #141): pure
// geometry + tone assignment for the #114 green layer, no three.js
// here — taipei-boot.js wraps the layers into meshes, so node tests
// pin the geometry directly (the taipei-terrain.js pattern).
//
// Until this issue the green layer (geodata.green: farmland, wood,
// wetland, nature reserves — osm_green.json via the geodata build)
// was PLANNER-ONLY: it kept urban lots off green land, but the
// ground under it rendered as the pale block grey, so the Guandu
// plain read grey from the air where the satellite reads green.
// This module gives every green polygon a ground tint by OSM class.
//
// Tones are sampled from Esri World Imagery over the actual polygons
// (greentint-evidence/sample.py: interior points, water/park polys
// excluded since those layers draw above the tint; per-class median
// of 95–420 samples), then set in the game's tuned-green discipline
// with the park lawn 0x56854a as the family anchor — Esri's read is
// hazy/desaturated next to the game's rig, so the hexes keep the
// samples' hue and ordering at game depth (the #129 terrain-skin
// method). Sampled satellite medians (sRGB):
//   farmland (105,114,80)   wood (57,73,50)     wetland (76,82,58)
//   nature_reserve (107,108,88)   orchard (85,103,76)
//   grassland (66,84,54)
// Meadow, scrub and recreation ground are microscopic (0.03 km2
// combined) and, measured on the geodata, lie entirely inside park
// polygons (meadow/scrub) or a single 0.001 km2 patch
// (recreation_ground) — the park layer draws over them, so their
// tones are family assignments, stated as such.
//
// Farmland gets a PALETTE, not one tone: the per-polygon satellite
// medians across the plain's fields spread from dry fallow
// (145,137,88) through mid field green (105,114,80) to dark wet
// plots (73,86,58) — the patchwork IS the Guandu read. The palette
// below is those sampled tones in game discipline; each polygon (or
// grid cell, for the big ones) picks from it by stable hashes —
// the game's per-lot hash-variation idiom — with one refinement:
// cells of a split polygon take a base tone per 2x2-cell block and
// jitter at most one palette step per cell, so neighbouring cells
// cluster the way neighbouring plots under one crop do instead of
// salt-and-peppering. Polygons over FARMLAND_SPLIT_AREA are cut on
// a world-aligned FARMLAND_CELL grid first: the plain's largest
// single OSM polygon is 245 ha, one tone over it would read as a
// slab, not fields, and 140 m cells sit at the plain's real plot
// scale (the audit frame check: 200 m cells read as a quilt).

// Draw height: the ground stack is a Y discipline (land 0, blocks
// 0.02, podium 0.021, airfield site 0.022, airfield surfaces 0.024,
// riverside band 0.025, water 0.03, parks 0.04 — js/taipei-boot.js).
// The tint sits at 0.0235: above the block/podium greys it exists to
// cover, below everything that must win an overlap — measured on
// the built geodata, green overlaps water by 1.09 km2 (wetland
// channels and ponds stay water at 0.03) and parks by 1.23 km2
// (park lawn/plaza tones stay on top at 0.04+), and the riverside
// band keeps its park tone along the banks at 0.025. Airfield
// surfaces (0.024) measure zero overlap with green. Against the
// terrain skin the tint is flat-ground only: the skin hides 0.3 m
// UNDER the land planes on the basin floor (so the tint shows on
// the Guandu plain and the flat woods), and where the skin rises
// (DEM > ~45 m) it covers the tint — the hills keep the #129
// deep-forest skin, which is the same green story told by the DEM.
export const GREEN_TINT_Y = 0.0235;

export const GREEN_CLASS_TONES = {
  'natural:wood': 0x3d6335,              // deepest — canopy (sat 57,73,50)
  'natural:wetland': 0x6b7f47,           // marsh olive (sat 76,82,58)
  'leisure:nature_reserve': 0x77854c,    // pale marsh grass (sat 107,108,88)
  'landuse:orchard': 0x557c40,           // tree rows (sat 85,103,76)
  'landuse:vineyard': 0x557c40,          // orchard family (not in current extract)
  'natural:grassland': 0x4c7038,         // open grass (sat 66,84,54)
  'landuse:grassland': 0x4c7038,         // same class, landuse spelling
  'landuse:meadow': 0x5c8544,            // family (inside parks; never visible today)
  'natural:scrub': 0x466b36,             // family (inside parks; never visible today)
  'leisure:recreation_ground': 0x56854a, // open lawn — the park tone itself
};
// Fallback for a future class the table has not met: a mid field
// green. The test pins every class in the shipped geodata to an
// explicit entry, so this only guards a future extract.
export const GREEN_FALLBACK_TONE = 0x5d8140;

// Farmland field palette, dry -> wet (satellite per-polygon medians
// in game discipline; see the header).
export const FARMLAND_TONES = [0x868f52, 0x7ba24f, 0x6f9048, 0x5d8140, 0x4f7839];
export const FARMLAND_SPLIT_AREA = 80000; // m2 — split polygons larger than this
export const FARMLAND_CELL = 140;         // m — world-aligned grid for the split

// Shoelace over the ring as a closed loop (wrap edge included):
// geodata rings repeat their first point, clipped rings do not, and
// with world coords in the thousands the wrap edge is what makes
// the large terms cancel — omitting it leaves a phantom area.
const ringArea = (ring) => {
  const n = ring.length / 2;
  let a = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1];
  }
  return Math.abs(a / 2);
};

// Stable integer hash of a world position (0.1 m data precision):
// the same point always picks the same tone, in the planner, the
// boot and the tests.
export const toneHash = (x, z) => {
  let h = (Math.round(x * 10) * 374761393 + Math.round(z * 10) * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0);
};

const farmToneAt = (x, z) => FARMLAND_TONES[toneHash(x, z) % FARMLAND_TONES.length];

// Tone for one grid cell of a split polygon: the 2x2-cell block
// picks the base tone, the cell itself jitters at most one step —
// field-group coherence without losing the patchwork.
const farmCellTone = (gx, gz) => {
  const bx = (Math.floor(gx / 2) * 2 + 1) * FARMLAND_CELL;
  const bz = (Math.floor(gz / 2) * 2 + 1) * FARMLAND_CELL;
  const base = toneHash(bx, bz) % FARMLAND_TONES.length;
  const jitter = (toneHash((gx + 0.5) * FARMLAND_CELL, (gz + 0.5) * FARMLAND_CELL) % 3) - 1;
  const idx = Math.max(0, Math.min(FARMLAND_TONES.length - 1, base + jitter));
  return FARMLAND_TONES[idx];
};

// Sutherland–Hodgman clip of a flat ring [x,z,...] against one
// half-plane; axis is 0 for x, 1 for z; keep the side <= or >= bound.
function clipHalf(pts, axis, bound, keepBelow) {
  const out = [];
  const val = (p) => (axis === 0 ? p[0] : p[1]);
  const inside = (p) => (keepBelow ? val(p) <= bound : val(p) >= bound);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const ain = inside(a), bin = inside(b);
    if (ain) out.push(a);
    if (ain !== bin) {
      const t = (bound - val(a)) / (val(b) - val(a));
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

function clipRingToRect(ring, minX, maxX, minZ, maxZ) {
  let pts = [];
  for (let i = 0; i + 1 < ring.length; i += 2) pts.push([ring[i], ring[i + 1]]);
  if (pts.length > 1) {
    const f = pts[0], l = pts[pts.length - 1];
    if (Math.abs(f[0] - l[0]) < 0.01 && Math.abs(f[1] - l[1]) < 0.01) pts.pop();
  }
  pts = clipHalf(pts, 0, minX, false);
  pts = clipHalf(pts, 0, maxX, true);
  pts = clipHalf(pts, 1, minZ, false);
  pts = clipHalf(pts, 1, maxZ, true);
  if (pts.length < 3) return null;
  const flat = [];
  for (const [x, z] of pts) flat.push(x, z);
  return ringArea(flat) >= 1 ? flat : null;
}

// buildGreenTintLayers(green) -> [{ tone, rings: [flatRing, ...] }]
// One entry per distinct tone, in first-use order; every input
// polygon contributes its full area exactly once. Pure: the input
// is read, never mutated (the planner's byte-identity pin depends
// on geodata.green staying exactly as the build emitted it).
export function buildGreenTintLayers(green) {
  const byTone = new Map();
  const add = (tone, ring) => {
    if (!byTone.has(tone)) byTone.set(tone, []);
    byTone.get(tone).push(ring);
  };
  for (const poly of green || []) {
    const ring = poly.ring;
    if (!ring || ring.length < 6) continue;
    if (poly.cls !== 'landuse:farmland') {
      add(GREEN_CLASS_TONES[poly.cls] ?? GREEN_FALLBACK_TONE, ring);
      continue;
    }
    if (ringArea(ring) <= FARMLAND_SPLIT_AREA) {
      let cx = 0, cz = 0;
      for (let i = 0; i + 1 < ring.length; i += 2) { cx += ring[i]; cz += ring[i + 1]; }
      add(farmToneAt(cx / (ring.length / 2), cz / (ring.length / 2)), ring);
      continue;
    }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i + 1 < ring.length; i += 2) {
      minX = Math.min(minX, ring[i]); maxX = Math.max(maxX, ring[i]);
      minZ = Math.min(minZ, ring[i + 1]); maxZ = Math.max(maxZ, ring[i + 1]);
    }
    const gx0 = Math.floor(minX / FARMLAND_CELL), gx1 = Math.floor(maxX / FARMLAND_CELL);
    const gz0 = Math.floor(minZ / FARMLAND_CELL), gz1 = Math.floor(maxZ / FARMLAND_CELL);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gz = gz0; gz <= gz1; gz++) {
        const cell = clipRingToRect(ring, gx * FARMLAND_CELL, (gx + 1) * FARMLAND_CELL, gz * FARMLAND_CELL, (gz + 1) * FARMLAND_CELL);
        if (cell) add(farmCellTone(gx, gz), cell);
      }
    }
  }
  return [...byTone.entries()].map(([tone, rings]) => ({ tone, rings }));
}
