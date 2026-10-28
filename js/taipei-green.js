// js/taipei-green.js — green-layer ground tint (issue #141): pure
// geometry + tone assignment for the #114 green layer, no three.js
// here — taipei-boot.js wraps the layers into meshes, so node tests
// pin the geometry directly (the taipei-terrain.js pattern).
//
// Issue #206 adds the family's overlap discipline at the bottom:
// consumeGreenFamilyOverlaps() makes exactly one green-family
// surface win per area before the boot meshes anything.
import { subtractPolys } from './taipei-junctions.js';
import { buildPolyGrid, pointInPoly } from './taipei-painted.js';
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

// ---------------------------------------------------------------------
// Issue #206 — one green surface wins per area.
//
// The Y stack alone did not keep the family apart: the tint tones
// all share GREEN_TINT_Y exactly, and the source polygons overlap
// (a nature reserve drawn over the farmland and wetland it sits
// in), so on the Guandu plain 1.897 km2 was double-painted by two
// different tones at the identical height — exactly co-planar,
// the worst z-fight there is — with the cross-layer pairs on top
// (tint x parks 1.028 km2 at dy 0.0165, tint x water 715k m2 at
// 0.0065, water x parks 212k m2 at 0.01; census in
// tools/taipei/census-green-overlaps.mjs). The fix is the #171
// cap discipline applied to the whole family: process the flat
// green-family surfaces in stack order, highest first, and
// subtract every survivor from the surfaces below it with
// subtractPolys. The visible winner of every overlap is exactly
// the one the Y order already picked — the loser simply stops
// being drawn underneath it. Within the tint, tone layers keep
// buildGreenTintLayers' first-use order (earlier tone wins);
// rings inside ONE set keep their overlaps (one mesh, one tone:
// the loser's colour is the winner's, so nothing can shimmer).
//
// Pure: inputs are read, never mutated (the geodata byte-identity
// pins stand); the boot draws the returned rings instead of the
// raw ones. Rings are flat [x, z, ...] in and out.
const OCC_CELL_M = 100; // buildPolyGrid cell size for occluder lookup
const ringToPts = (ring) => {
  const pts = [];
  for (let i = 0; i + 1 < ring.length; i += 2) pts.push([ring[i], ring[i + 1]]);
  if (pts.length > 1) {
    const f = pts[0], l = pts[pts.length - 1];
    if (Math.abs(f[0] - l[0]) < 0.01 && Math.abs(f[1] - l[1]) < 0.01) pts.pop();
  }
  return pts;
};
const ptsToRing = (pts) => {
  const flat = [];
  for (const p of pts) flat.push(p[0], p[1]);
  return flat;
};
const bboxOfPts = (pts) => {
  let x0 = 1e18, z0 = 1e18, x1 = -1e18, z1 = -1e18;
  for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[1] < z0) z0 = p[1]; if (p[0] > x1) x1 = p[0]; if (p[1] > z1) z1 = p[1]; }
  return [x0, z0, x1, z1];
};
const bboxHit = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
const ptsArea = (pts) => {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return Math.abs(a / 2);
};

export function consumeGreenFamilyOverlaps(family) {
  const occPts = [];       // surviving higher-precedence rings (point form)
  const occBbs = [];       // their bboxes, index-aligned with occPts
  let occGrid = new Map(); // buildPolyGrid over occPts
  const candidatesFor = (bb) => {
    const seen = new Set();
    for (let gx = Math.floor(bb[0] / OCC_CELL_M); gx <= Math.floor(bb[2] / OCC_CELL_M); gx++) {
      for (let gz = Math.floor(bb[1] / OCC_CELL_M); gz <= Math.floor(bb[3] / OCC_CELL_M); gz++) {
        for (const i of occGrid.get(`${gx},${gz}`) || []) seen.add(i);
      }
    }
    return [...seen].filter((i) => bboxHit(bb, occBbs[i])).map((i) => occPts[i]);
  };
  // Two measured rules keep the subtraction exact AND fast:
  //
  // (1) Pre-clip every candidate clip to the subject's bbox + 1 m.
  // subtractPolys canonicalises each clip ring in O(n^2) string
  // work (and pairs every subject segment with every clip
  // segment), so passing a 2,482-point park ring whole costs ~1 s
  // PER CALL — and the big park's bbox makes it a candidate for
  // dozens of subjects. The local piece of it is a handful of
  // points; clip n subject is unchanged by construction, and the
  // piece's bridge edges land 1 m outside the subject, where the
  // difference never reaches. Subjects are NEVER split:
  // Sutherland-Hodgman pieces are weakly simple, and the stitch
  // walk drops lobes off them as subjects (measured: 1.05 km2 of
  // the Guandu plain). As clips, pre-clipped pieces conserve the
  // family footprint to the square metre.
  //
  // (2) Mind the HOLES. A difference whose interior is pierced
  // by clips comes back from subtractPolys as hole-bridged
  // ear-clipped triangles — and when the bridging stalls, its
  // documented last resort keeps the WHOLE outer ring, hole and
  // all. One call against the ~200 farmland cells inside the
  // Guandu reserve ring silently kept the reserve drawn over all
  // of them (~150k m2 of residual overlap, raster-measured).
  // So the clips go in SMALL BATCHES (a handful of holes per call
  // stays in the regime the junction caps prove in production),
  // and afterwards a verification pass probes every surviving
  // piece with each local clip's interior sample point: a clip
  // whose sample still lands inside a piece is a hole the batch
  // kept, and it is retried singly — one hole per call, the
  // primitive's best case. Residues the probes cannot clear are
  // counted in the returned stats. Triangulated spill is cleaned
  // by rule (3) in consumeSet (centroid drop + dedupe).
  const CLIP_BATCH_MAX = 6;    // clips per subtractPolys call
  const CLIP_BATCH_PTS = 300;  // or this many clip points, whichever first
  // An interior sample point of a clip ring: midpoint of its
  // longest edge, nudged to whichever side is inside. Null for a
  // degenerate ring (no probe possible; the batch result stands).
  const clipSample = (pts) => {
    let bi = -1, bl = -1;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const L = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
      if (L > bl) { bl = L; bi = j; }
    }
    if (bi < 0 || bl <= 0) return null;
    const a = pts[bi], b = pts[(bi + 1) % pts.length];
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    const nx = -(b[1] - a[1]) / bl, nz = (b[0] - a[0]) / bl;
    for (const s of [0.05, -0.05]) {
      const p = [mx + nx * s, mz + nz * s];
      if (pointInPoly(p, pts)) return p;
    }
    return null;
  };
  let unresolved = 0;
  // Consume one set against everything already stacked above it,
  // then stack its survivors as occluders for the sets below.
  // Returns { rings (flat), removed } with removed in m2.
  const consumeSet = (rings) => {
    const out = [];
    let inArea = 0, outArea = 0;
    for (const ring of rings || []) {
      const pts = ringToPts(ring);
      if (pts.length < 3) continue;
      inArea += ringArea(ring);
      const sbb = bboxOfPts(pts);
      const local = [];
      for (const cand of candidatesFor(sbb)) {
        const clipped = clipRingToRect(ptsToRing(cand), sbb[0] - 1, sbb[2] + 1, sbb[1] - 1, sbb[3] + 1);
        if (clipped) { const cp = ringToPts(clipped); local.push({ pts: cp, bb: bboxOfPts(cp), sample: clipSample(cp) }); }
      }
      if (!local.length) { out.push(pts); outArea += ptsArea(pts); continue; }
      let pieces = [{ pts, bb: sbb }];
      // Subtract a clip batch from every piece it touches; pieces
      // it misses pass through untouched (the common case — most
      // pieces never meet most clips).
      const subtractFromPieces = (clips) => {
        const next = [];
        for (const p of pieces) {
          const hit = clips.filter((c) => bboxHit(p.bb, c.bb)).map((c) => c.pts);
          if (!hit.length) { next.push(p); continue; }
          for (const q of subtractPolys(p.pts, hit)) {
            if (q.length >= 3) next.push({ pts: q, bb: bboxOfPts(q) });
          }
        }
        pieces = next;
      };
      for (let ci = 0; ci < local.length && pieces.length;) {
        const batch = [];
        let acc = 0;
        while (ci < local.length && batch.length < CLIP_BATCH_MAX) {
          if (batch.length && acc + local[ci].pts.length > CLIP_BATCH_PTS) break;
          batch.push(local[ci]);
          acc += local[ci].pts.length;
          ci++;
        }
        subtractFromPieces(batch);
      }
      // Verification: probe every surviving piece with each local
      // clip's interior sample. A sample inside a piece means the
      // batch kept that hole — retry the pair singly, then probe
      // the replacements again. What still probes positive after
      // the retry is counted unresolved in the returned stats.
      for (let pi = 0; pi < pieces.length; pi++) {
        for (const clip of local) {
          if (!clip.sample) continue;
          const inside = (p) => clip.sample[0] >= p.bb[0] && clip.sample[0] <= p.bb[2]
            && clip.sample[1] >= p.bb[1] && clip.sample[1] <= p.bb[3]
            && pointInPoly(clip.sample, p.pts);
          if (!inside(pieces[pi])) continue;
          const res = subtractPolys(pieces[pi].pts, [clip.pts])
            .filter((q) => q.length >= 3)
            .map((q) => ({ pts: q, bb: bboxOfPts(q) }));
          pieces.splice(pi, 1, ...res);
          if (res.some(inside)) unresolved++; // the hole survived even a solo call: count it and move on
          else pi--; // cleared: re-probe the replacements against the other clips
          break;
        }
      }
      // Rule (3): triangulated differences over-cover slightly
      // (the bridged ear-clip spills slivers into the holes it
      // cuts and can emit a fan triangle twice — measured +231 m²
      // on a two-hole synthetic). A triangle piece whose centroid
      // lands inside a local clip is mostly spill: drop it, and
      // drop exact-duplicate pieces. Legit-area loss from the
      // centroid rule is raster-verified negligible (the Guandu
      // box keeps its visible areas; see the #206 census).
      const seenPiece = new Set();
      for (const p of pieces) {
        if (p.pts.length === 3) {
          const c = [(p.pts[0][0] + p.pts[1][0] + p.pts[2][0]) / 3, (p.pts[0][1] + p.pts[1][1] + p.pts[2][1]) / 3];
          if (local.some((clip) => c[0] >= clip.bb[0] && c[0] <= clip.bb[2] && c[1] >= clip.bb[1] && c[1] <= clip.bb[3] && pointInPoly(c, clip.pts))) continue;
        }
        const key = p.pts.map((q) => `${Math.round(q[0] * 1000)},${Math.round(q[1] * 1000)}`).sort().join(';');
        if (seenPiece.has(key)) continue;
        seenPiece.add(key);
        out.push(p.pts);
        outArea += ptsArea(p.pts);
      }
    }
    for (const p of out) { occPts.push(p); occBbs.push(bboxOfPts(p)); }
    occGrid = buildPolyGrid(occPts, OCC_CELL_M);
    return { rings: out.map(ptsToRing), removed: Math.max(0, inArea - outArea) };
  };
  const plaza = consumeSet(family.plaza);
  const parks = consumeSet(family.parks);
  const water = consumeSet(family.water);
  const band = consumeSet(family.band);
  const tintIn = (family.tint || []).reduce((s, l) => s + l.rings.reduce((a, r) => a + ringArea(r), 0), 0);
  let tintOut = 0;
  const tint = (family.tint || []).map((layer) => {
    const c = consumeSet(layer.rings);
    tintOut += c.rings.reduce((a, r) => a + ringArea(r), 0);
    return { tone: layer.tone, rings: c.rings };
  });
  return {
    tint, band: band.rings, water: water.rings, parks: parks.rings, plaza: plaza.rings,
    removed: {
      plaza: plaza.removed, parks: parks.removed, water: water.removed, band: band.removed,
      tint: Math.max(0, tintIn - tintOut),
    },
    unresolved,
  };
}
