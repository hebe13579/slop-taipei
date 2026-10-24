// js/taipei-junctions.js — junction caps for the Taipei tile
// (issue #66): one paved cap per detected junction, filling the
// junction box the arm ribbons leave bare or overlapped. Pure data +
// geometry (no three.js), mirroring taipei-painted.js /
// taipei-surfaces.js, so node tests and the renderer run the exact
// same rules.
//
// WHY CAPS. The audit (junction-evidence/AUDIT.md) measured the
// failure classes on current data: roadbeds end at — or short of —
// the centre of every crossing road, so nothing paves the junction
// box itself. 879 of 3,817 arms (23%, in 390 of 894 junctions) end
// more than 2 m short of the box edge; the extreme is the #45
// acceptance junction 信義路×松仁路， where all four arms stop
// ~30–36 m out and the core is bare ground. Where arms do meet,
// their butt-ended ribbons overlap in fan wedges at the same Y
// (0.06) in per-class tones, and the wedge gaps show the pale
// sidewalk/path layers diagonally across the corners.
//
// The sc0Vu reference closes its junctions with a disc of radius =
// widest arm half-width at every graph node. That shape does not
// survive our data: at a boulevard×lane mouth (the common junction
// here) a 22 m disc spills ~19 m onto the blocks beside a 6 m lane,
// and at an equal-arm 4-way it leaves the box corners round. Our cap
// is the same node-cap idea fitted to the arms: the CONVEX HULL of
// the arms' cross-sections, each cross-section placed along its arm
// at reach = max(crossHalf, bedEnd + 1.5 m) — the junction box edge,
// extended to swallow the arm's own bed end where the data ends it
// short (class 1) — with the arm's own half width across. Reach
// extension is capped at crossHalf + 30 m so a merged interchange
// cluster cannot grow a cap across the block between two crossings.
//
// Caps render at y = 0.061 (above the carriageways at 0.06, below
// the median strips at 0.062) in the surface tone of the widest
// incident arm — the dominant road owns its junction. They are also
// the hard occluder for the painted layers: taipei-painted,
// taipei-surfaces (medians) and taipei-markings (dashes) take the
// cap polygons and drop any band / strip / dash quad whose centre
// lands inside one, so no paint crosses a junction core (the #25
// clip only tested foreign bed ribbons, which is why corner leaks
// survived it). Crosswalk stripes and stop lines are exempt by
// design — they are junction furniture placed by the same
// crossHalf arithmetic, and at short-arm junctions they land on
// the cap's own asphalt at the mouth (measured: 3,953 stripe
// centres inside their OWN cap, 0 inside a foreign one).

import { surfaceClass } from './taipei-surfaces.js';

export const CAP_Y = 0.061;               // between carriageways (0.06) and medians (0.062)
export const CAP_END_OVERLAP_M = 1.5;     // cap reaches this far past an arm's bed end
export const CAP_MAX_EXTRA_REACH_M = 30;  // reach extension cap beyond the box edge

// Monotone-chain convex hull over [x, z] points. Returns the hull
// vertices in order (either winding — the renderer's triangulator
// and pointInPoly are both winding-agnostic).
export function convexHull(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const uniq = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
  if (uniq.length < 3) return [];
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of uniq) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = uniq.length - 1; i >= 0; i--) {
    const p = uniq[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return [...lower, ...upper];
}

const polyArea = (ring) => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(a / 2);
};

// planJunctionCaps(roadbeds, junctions) -> [{ x, z, ring, radius,
// cls, arms, signalized, area }]
// junctions: detectJunctions() output (js/taipei-markings.js) — the
// caller detects once and shares the result with the markings
// builder. ring is a flat [x, z, …] array in hull order; cls is the
// surfaceClass of the widest incident arm (its SURFACE_TONES entry
// is the cap's tone).
export function planJunctionCaps(roadbeds, junctions) {
  const caps = [];
  for (const j of junctions || []) {
    if (!j.arms || j.arms.length < 2) continue;
    let widest = j.arms[0];
    const corners = [];
    for (const a of j.arms) {
      if (a.width > widest.width) widest = a;
      // Signed distance of the arm's bed end along its own direction
      // (negative when the end overshoots past the centre).
      const sd = (a.endX - j.x) * a.dirX + (a.endZ - j.z) * a.dirZ;
      const reach = Math.max(
        a.crossHalf,
        Math.min(sd + CAP_END_OVERLAP_M, a.crossHalf + CAP_MAX_EXTRA_REACH_M),
        0.5,
      );
      const nx = -a.dirZ, nz = a.dirX, half = a.width / 2;
      const cx = j.x + a.dirX * reach, cz = j.z + a.dirZ * reach;
      corners.push([cx + nx * half, cz + nz * half]);
      corners.push([cx - nx * half, cz - nz * half]);
      // The arm's own bed end joins the hull too: on curved or
      // fragment arms the end sits off the centre->dir axis, and a
      // cross-section-only hull leaves its butt end on bare ground
      // at the junction fringe (measured on current data: junction
      // #3's unnamed fragment arm, end 4+ m outside its cap).
      corners.push([a.endX, a.endZ]);
    }
    const hull = convexHull(corners);
    if (hull.length < 3) continue;
    const area = polyArea(hull);
    if (!(area > 1)) continue;
    let radius = 0;
    for (const [px, pz] of hull) radius = Math.max(radius, Math.hypot(px - j.x, pz - j.z));
    caps.push({
      x: j.x, z: j.z,
      ring: hull.flatMap(([px, pz]) => [Math.round(px * 10) / 10, Math.round(pz * 10) / 10]),
      radius: Math.round(radius * 10) / 10,
      cls: surfaceClass({ highway: widest.highway }),
      arms: j.arms.length,
      signalized: !!j.signalized,
      area: Math.round(area),
    });
  }
  return caps;
}

// ---------------------------------------------------------------------
// Cap occlusion for the painted layers: the pure builders take the
// caps as plain polygon point arrays (ringPoints output) and test
// with taipei-painted.js's generic polygon grid (buildPolyGrid /
// pointInAnyPoly), so no builder imports this module.

export const ringPoints = (ring) => {
  const pts = [];
  for (let i = 0; i + 1 < ring.length; i += 2) pts.push([ring[i], ring[i + 1]]);
  return pts;
};
