// js/taipei-markings.js — road detail for the Taipei tile (issue #45):
// dashed white lane dividers, zebra crosswalks + stop lines at
// signalized junctions, and static traffic-signal units. Pure data +
// geometry (no three.js), mirroring taipei-painted.js /
// taipei-surfaces.js, so node tests, the evidence audit and the
// renderer all run the exact same rules.
//
// SCOPE (user, 2026-10-24): scooter waiting boxes （機車停等區） are
// OUT — cut from this increment entirely. Traffic lights are STATIC
// geometry for now: pole + horizontal 3-lamp head, lenses modelled
// unlit (muted lens colours); no phase cycle, and traffic AI does not
// obey them (a later increment). Pedestrian signals are a small box
// with a STATIC lit red panel — no animated little-green-man figure
// and no countdown digits (standing user directive).
//
// LANE RULE. The generated roadbeds carry no lane tags (the generator
// baked lanes into width at 3.2 m per lane — tools/taipei), so lane
// counts are recovered from bed width: total ≈ round(width / 3.2).
// A merged bed (sourceWayIds ≥ 2) is two carriageways split by its
// median strip when taipei-surfaces gives it one (the strip's width
// is reused, so dividers can never land on a median); an unmerged
// bed is read as a two-way single carriageway, lanes split evenly
// (beds carry no oneway flag — stated limit). Dividers are the white
// dashed separators between SAME-direction lanes only: the centre
// boundary of a two-way bed and the median get none. Rule inputs:
// bed class tertiary-or-above (surface ranks 1–3) and ≥ 2 lanes per
// direction. Dash pattern 3 m line / 4.5 m gap, line width 0.15 m —
// a denser urban read of the Taiwan 車道線 spec (4 m / 6 m on fast
// roads) so the tile's short inter-junction bed segments still show
// dashes; stated as a simplification.
//
// JUNCTIONS. There is no junction object in the geodata: beds end at
// (or near) the centre of every crossing road, so junctions are
// recovered by clustering bed endpoints — union-find over endpoints
// within 22 m, then a second pass merging candidate centroids within
// 40 m (divided boulevards end their carriageways at twin nodes up
// to ~40 m apart; that is one signalized junction, not two). Arms
// are the clustered bed ends, deduplicated by (name, direction
// within 25°), keeping the widest bed per approach — on an unmerged
// divided road the approach width is therefore the widest single
// bed, not the full pair (stated limit). An arm's direction walks
// its own bed, so curved approaches keep their real heading. The
// junction centre is the centroid of the kept arms' endpoints (a
// merged-in fragment cluster's centroid can sit metres off the
// true crossing, and every furniture set-back measures from the
// centre — measured on the acceptance junction: cluster centroid
// (343, 21) vs arm-endpoint centroid (339.5, 19.4), worth ~4 m of
// crosswalk placement on the west approach).
//
// SIGNALIZED RULE. A junction is signalized when arms of class
// tertiary-or-above from at least two differently-named roads cross
// at 35–145° (a continuation at ~180° or a merge at ~0° does not
// count). Crosswalks go across every arm ≥ 7 m wide; stop lines and
// signal units serve the tertiary-or-above arms only.

import { ribbonPoly, pointInPoly, buildPolyGrid, pointInAnyPoly } from './taipei-painted.js';
import { medianKind, medianStripWidth, buildMedianStrips } from './taipei-surfaces.js';
import { planJunctionCaps, planRoundabouts, ringPoints } from './taipei-junctions.js';

export const LANE_W = 3.2;               // generator's width-per-lane conversion
export const DASH_LEN = 3;               // m of paint per dash
export const DASH_GAP = 4.5;             // m of gap per dash cycle
export const DIVIDER_W = 0.15;           // lane line width
export const DIVIDER_MIN_RANK = 1;       // tertiary and above get dividers
const SAMPLE_STEP_M = 1.5;               // divider sampling step
const GRID_M = 100;

export const CROSSWALK_DEPTH = 3.2;      // band depth along the crossed road
export const CROSSWALK_GAP = 0.8;        // clear space between junction box and band
export const STRIPE_W = 0.45;            // zebra stripe width (across the road)
export const STRIPE_PITCH = 0.9;         // stripe repeat across the road
export const STOP_LINE_W = 0.4;          // stop line thickness along the road
export const STOP_LINE_GAP = 0.9;        // between crosswalk band and stop line
export const CROSSWALK_MIN_ARM_W = 7;    // narrower mouths get no zebra

export const JUNCTION_CLUSTER_M = 22;    // endpoint clustering radius
export const JUNCTION_MERGE_M = 40;      // candidate-centroid merge radius

// Signal placement (issue #64, user rule 2026-10-24): a unit stands
// at the SIDE of the road — the far right-hand corner of its
// approach, clear of every carriageway — never mid-junction. A
// mast-arm (T) unit is used ONLY where the approach is divided
// (approachDivided below); everywhere else a plain corner pole.
export const SIGNAL_SIDE_MARGIN = 0.9;   // corner clearance past the approach's right edge
export const SIGNAL_BOX_MARGIN = 1.2;    // corner clearance past the junction box (crossing road's far edge)
export const SIGNAL_ESCAPE_STEP = 0.5;   // clearance-solver step, m
export const SIGNAL_ESCAPE_MAX = 80;     // solver budget: 40 m of diagonal escape (interchange-scale junctions)
export const SIGNAL_SEARCH_MAX = 30;     // quadrant lattice search radius, m (Manhattan)
export const MAST_ARM_MIN = 4;           // mast-arm reach clamps, m
export const MAST_ARM_MAX = 13;

// Class rank shared with the signalized/divider rules: 3 trunk /
// primary, 2 secondary, 1 tertiary, 0 everything else (links take
// their parent class, as in taipei-surfaces' surfaceClass).
export function classRank(highway) {
  const hw = highway || '';
  if (hw.startsWith('trunk') || hw.startsWith('primary')) return 3;
  if (hw.startsWith('secondary')) return 2;
  if (hw.startsWith('tertiary')) return 1;
  return 0;
}

const ptsOf = (b) => {
  const p = [];
  for (let i = 0; i < b.pts.length; i += 2) p.push([b.pts[i], b.pts[i + 1]]);
  return p;
};

// laneLayout(bed) -> { boundaries: [signed centreline offsets of the
// white dashed lane separators], medianHalf, perSide, total }
// Offsets are in the bed frame (normal = (-dz, dx) of travel along
// pts). The centre boundary of a two-way bed is never a divider.
export function laneLayout(bed) {
  const w = bed?.width || 0;
  const half = w / 2;
  const merged = Array.isArray(bed?.sourceWayIds) && bed.sourceWayIds.length >= 2;
  const boundaries = [];
  let medianHalf = 0, perSide = 0, total = Math.max(1, Math.round(w / LANE_W));
  if (merged) {
    medianHalf = medianKind(bed) ? medianStripWidth(bed) / 2 : 0;
    const cw = half - medianHalf; // one carriageway's width
    perSide = Math.max(1, Math.round(cw / LANE_W));
    total = perSide * 2;
    if (perSide >= 2) {
      const laneW = cw / perSide;
      for (const s of [1, -1]) for (let k = 1; k < perSide; k++) boundaries.push(s * (medianHalf + k * laneW));
    }
  } else {
    perSide = Math.floor(total / 2);
    if (perSide >= 2) {
      const laneW = half / perSide;
      for (const s of [1, -1]) for (let k = 1; k < perSide; k++) boundaries.push(s * k * laneW);
    }
  }
  return { boundaries, medianHalf, perSide, total };
}

export const dividersFor = (bed) =>
  !!bed && classRank(bed.highway) >= DIVIDER_MIN_RANK && laneLayout(bed).boundaries.length > 0;

// Densify a centreline to points at most stepM apart (vertices kept).
function densify(pts, stepM) {
  const out = [pts[0]];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(len / stepM));
    for (let s = 1; s <= steps; s++) out.push([ax + ((bx - ax) * s) / steps, az + ((bz - az) * s) / steps]);
  }
  return out;
}

// Walk a bed from one end: point + heading at arc distance s from
// that end. dir points AWAY from the end into the bed. Past the far
// end the walk extrapolates along the last segment's heading —
// junction-fragment beds are often shorter than the crosswalk set-
// back they must carry, and their approaches run straight.
export function pointAlongBed(bed, end, s) {
  const pts = ptsOf(bed);
  const seq = end === 0 ? pts : [...pts].reverse();
  let acc = 0;
  for (let i = 0; i + 1 < seq.length; i++) {
    const [ax, az] = seq[i], [bx, bz] = seq[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const n = len || 1;
    if (acc + len >= s) {
      const t = len > 0 ? Math.min(1, Math.max(0, (s - acc) / len)) : 0;
      return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, dx: (bx - ax) / n, dz: (bz - az) / n, len: acc + len };
    }
    acc += len;
    if (i + 2 === seq.length) {
      const over = s - acc;
      return { x: bx + ((bx - ax) / n) * over, z: bz + ((bz - az) / n) * over, dx: (bx - ax) / n, dz: (bz - az) / n, len: acc };
    }
  }
  const [lx, lz] = seq[seq.length - 1];
  return { x: lx, z: lz, dx: 0, dz: 0, len: acc };
}

export const bedLength = (bed) => {
  const pts = ptsOf(bed);
  let acc = 0;
  for (let i = 0; i + 1 < pts.length; i++) acc += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  return acc;
};

// ---------------------------------------------------------------------
// Lane dividers.

// buildLaneDividers(roadbeds, suppress, medianStrips?, capPolys?)
// -> { dashes, stats }
// suppress: Map `${bedIndex}:${end}` -> arc metres from that bed end
// where dashes stay off (the stop-line zone at signalized junctions,
// passed in by buildRoadMarkings). medianStrips: an optional
// buildMedianStrips() result to clip dashes against (the boot passes
// the strips it already built for its own layers; standalone callers
// get them built here). capPolys (issue #66): junction-cap polygons
// as point arrays — a dash sample inside any cap is blocked, so no
// lane line crosses a junction core. dashes are quads [x1,z1,…] in
// the strip order taipei-painted's quadsGeometry consumes.
export function buildLaneDividers(roadbeds, suppress = new Map(), medianStrips = null, capPolys = null) {
  const capGrid = capPolys ? buildPolyGrid(capPolys) : null;
  const capBlocked = (p) => pointInAnyPoly(capGrid, capPolys, p);
  const polys = roadbeds.map(ribbonPoly);
  const grid = new Map();
  polys.forEach((poly, i) => {
    const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
    for (let gx = Math.floor(Math.min(...xs) / GRID_M); gx <= Math.floor(Math.max(...xs) / GRID_M); gx++)
      for (let gz = Math.floor(Math.min(...zs) / GRID_M); gz <= Math.floor(Math.max(...zs) / GRID_M); gz++) {
        const k = `${gx},${gz}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(i);
      }
  });
  const foreignBlocked = (p, selfIdx, selfWays) => {
    const cand = grid.get(`${Math.floor(p[0] / GRID_M)},${Math.floor(p[1] / GRID_M)}`) || [];
    for (const ci of cand) {
      if (ci === selfIdx) continue;
      if ((roadbeds[ci].sourceWayIds || []).some((w) => selfWays.has(w))) continue;
      if (pointInPoly(p, polys[ci])) return true;
    }
    return false;
  };
  // Median strips are hard occluders for EVERY dash — including the
  // dash bed's own strip and same-way neighbours'. Lane boundaries
  // are computed to clear the strip, but near complex junctions
  // overlapping same-road beds (the 光復南路 × 市民大道 interchange
  // is the measured case: 108 dash centres) lay one bed's strip
  // across another's carriageway where the foreign-bed clip cannot
  // see it, because the beds share source ways. The strip polygons
  // taipei-surfaces actually draws are the ground truth: no dash
  // sample may fall inside any of them.
  const strips = medianStrips || buildMedianStrips(roadbeds);
  const stripPolys = [...strips.planted, ...strips.plain].map((q) => [[q[0], q[1]], [q[2], q[3]], [q[4], q[5]], [q[6], q[7]]]);
  const STRIP_GRID_M = 25; // small cells: few candidate quads per lookup
  const stripGrid = new Map();
  stripPolys.forEach((poly, i) => {
    const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
    for (let gx = Math.floor(Math.min(...xs) / STRIP_GRID_M); gx <= Math.floor(Math.max(...xs) / STRIP_GRID_M); gx++)
      for (let gz = Math.floor(Math.min(...zs) / STRIP_GRID_M); gz <= Math.floor(Math.max(...zs) / STRIP_GRID_M); gz++) {
        const k = `${gx},${gz}`;
        if (!stripGrid.has(k)) stripGrid.set(k, []);
        stripGrid.get(k).push(i);
      }
  });
  const inMedianStrip = (p) => {
    const cand = stripGrid.get(`${Math.floor(p[0] / STRIP_GRID_M)},${Math.floor(p[1] / STRIP_GRID_M)}`) || [];
    for (const ci of cand) if (pointInPoly(p, stripPolys[ci])) return true;
    return false;
  };

  const dashes = [];
  const stats = { beds: 0, dashQuads: 0, dividerKm: 0, medianBlockedSamples: 0 };
  roadbeds.forEach((bed, selfIdx) => {
    if (!dividersFor(bed)) return;
    const { boundaries } = laneLayout(bed);
    const selfWays = new Set(bed.sourceWayIds || []);
    const pts = densify(ptsOf(bed), SAMPLE_STEP_M);
    // Arc distance of every sample from both bed ends.
    const arc = [0];
    for (let i = 1; i < pts.length; i++) arc.push(arc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const totalLen = arc[arc.length - 1];
    const supStart = suppress.get(`${selfIdx}:0`) || 0;
    const supEnd = suppress.get(`${selfIdx}:1`) || 0;
    const frames = pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], c = pts[Math.min(pts.length - 1, i + 1)];
      let dx = c[0] - a[0], dz = c[1] - a[1];
      const n = Math.hypot(dx, dz) || 1; dx /= n; dz /= n;
      return { p, nx: -dz, nz: dx, arc: arc[i], suppressed: arc[i] < supStart || totalLen - arc[i] < supEnd };
    });
    stats.beds++;
    for (const off of boundaries) {
      const lo = off - DIVIDER_W / 2, hi = off + DIVIDER_W / 2;
      const blockedAt = (f) => {
        const pc = [f.p[0] + f.nx * off, f.p[1] + f.nz * off];
        const pl = [f.p[0] + f.nx * lo, f.p[1] + f.nz * lo];
        const ph = [f.p[0] + f.nx * hi, f.p[1] + f.nz * hi];
        if (inMedianStrip(pc) || inMedianStrip(pl) || inMedianStrip(ph)) { stats.medianBlockedSamples++; return true; }
        if (capBlocked(pc)) return true;
        return f.suppressed || foreignBlocked(pc, selfIdx, selfWays) || foreignBlocked(pl, selfIdx, selfWays) || foreignBlocked(ph, selfIdx, selfWays);
      };
      const flags = frames.map(blockedAt);
      for (let i = 0; i + 1 < frames.length; i++) {
        const f0 = frames[i], f1 = frames[i + 1];
        if (flags[i] || flags[i + 1]) continue;
        const midArc = (f0.arc + f1.arc) / 2;
        if (midArc % (DASH_LEN + DASH_GAP) >= DASH_LEN) continue; // in the gap
        const mid = [(f0.p[0] + f1.p[0]) / 2 + ((f0.nx + f1.nx) / 2) * off,
                     (f0.p[1] + f1.p[1]) / 2 + ((f0.nz + f1.nz) / 2) * off];
        if (foreignBlocked(mid, selfIdx, selfWays) || inMedianStrip(mid) || capBlocked(mid)) continue;
        dashes.push([
          f0.p[0] + f0.nx * hi, f0.p[1] + f0.nz * hi,
          f1.p[0] + f1.nx * hi, f1.p[1] + f1.nz * hi,
          f1.p[0] + f1.nx * lo, f1.p[1] + f1.nz * lo,
          f0.p[0] + f0.nx * lo, f0.p[1] + f0.nz * lo,
        ]);
        stats.dashQuads++;
        stats.dividerKm += Math.hypot(f1.p[0] - f0.p[0], f1.p[1] - f0.p[1]) / 1000;
      }
    }
  });
  return { dashes, stats };
}

// ---------------------------------------------------------------------
// Junction detection.

// detectJunctions(roadbeds) -> [{ x, z, signalized, arms }]
// arm: { bed, end, name, highway, rank, width, dirX, dirZ, endX, endZ,
//        crossHalf } — dir points away from the junction along the
// arm's own bed; crossHalf is the junction box's extent along this
// arm (the widest crossing arm's half width).
export function detectJunctions(roadbeds) {
  const ends = [];
  roadbeds.forEach((bed, bi) => {
    const pts = ptsOf(bed);
    if (pts.length < 2) return;
    ends.push({ bed: bi, end: 0, x: pts[0][0], z: pts[0][1] });
    ends.push({ bed: bi, end: 1, x: pts[pts.length - 1][0], z: pts[pts.length - 1][1] });
  });
  const cluster = (items, radius, keyOf) => {
    const parent = items.map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const grid = new Map();
    items.forEach((it, i) => {
      const [x, z] = keyOf(it);
      const gx = Math.floor(x / radius), gz = Math.floor(z / radius);
      for (let ax = gx - 1; ax <= gx + 1; ax++) for (let az = gz - 1; az <= gz + 1; az++)
        for (const j of grid.get(`${ax},${az}`) || []) {
          const [ox, oz] = keyOf(items[j]);
          if (Math.hypot(ox - x, oz - z) <= radius) { const ri = find(i), rj = find(j); if (ri !== rj) parent[ri] = rj; }
        }
      const k = `${gx},${gz}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    });
    const groups = new Map();
    items.forEach((it, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(it); });
    return [...groups.values()];
  };

  // Pass 1: endpoint clusters. Pass 2: merge candidate centroids —
  // divided roads end at twin nodes one junction apart, not two.
  let candidates = cluster(ends, JUNCTION_CLUSTER_M, (e) => [e.x, e.z])
    .filter((g) => g.length >= 3)
    .map((g) => ({
      x: g.reduce((s, e) => s + e.x, 0) / g.length,
      z: g.reduce((s, e) => s + e.z, 0) / g.length,
      ends: g,
    }));
  candidates = cluster(candidates, JUNCTION_MERGE_M, (c) => [c.x, c.z]).map((g) => ({
    x: g.reduce((s, c) => s + c.x * c.ends.length, 0) / g.reduce((s, c) => s + c.ends.length, 0),
    z: g.reduce((s, c) => s + c.z * c.ends.length, 0) / g.reduce((s, c) => s + c.ends.length, 0),
    ends: g.flatMap((c) => c.ends),
  }));

  const junctions = [];
  for (const cand of candidates) {
    // Arm direction: from a centre estimate through a point well
    // along the arm's own bed (past the endpoint scatter, onto the
    // road itself).
    const armDir = (cx, cz, e) => {
      const along = Math.max(12, Math.hypot(e.x - cx, e.z - cz) + 10);
      const p = pointAlongBed(roadbeds[e.bed], e.end, along);
      let dx = p.x - cx, dz = p.z - cz;
      const n = Math.hypot(dx, dz) || 1;
      return [dx / n, dz / n];
    };
    let arms = cand.ends.map((e) => {
      const bed = roadbeds[e.bed];
      const [dx, dz] = armDir(cand.x, cand.z, e);
      return {
        bed: e.bed, end: e.end, name: bed.name || '', highway: bed.highway,
        rank: classRank(bed.highway), width: bed.width || 3,
        dirX: dx, dirZ: dz, endX: e.x, endZ: e.z, crossHalf: 0,
      };
    });
    // Deduplicate approaches: same road, same heading (within 25°)
    // — fragment beds of one approach collapse to the widest bed.
    // A much narrower arm (under half the width) pointing the same
    // way (within 15°) as a kept arm is a slip/fragment of that
    // approach whatever its name — ramps and frontage stubs ending
    // at the same corner — and folds into it too.
    arms.sort((a, b) => b.width - a.width);
    const kept = [];
    for (const a of arms) {
      const dot = (k) => k.dirX * a.dirX + k.dirZ * a.dirZ;
      if (kept.some((k) => k.name === a.name && dot(k) > Math.cos((25 * Math.PI) / 180))) continue;
      if (kept.some((k) => dot(k) > Math.cos((15 * Math.PI) / 180) && k.width >= a.width * 2.2)) continue;
      kept.push(a);
    }
    arms = kept;
    // Recentring: the merged-cluster centroid can sit metres off
    // the true crossing (a merged-in fragment cluster drags it), and
    // every set-back measures from the centre — so the junction
    // centre is the centroid of the KEPT arms' own endpoints, and
    // the arm directions are recomputed against it.
    cand.x = arms.reduce((s, a) => s + a.endX, 0) / arms.length;
    cand.z = arms.reduce((s, a) => s + a.endZ, 0) / arms.length;
    for (const a of arms) {
      const [dx, dz] = armDir(cand.x, cand.z, { bed: a.bed, end: a.end, x: a.endX, z: a.endZ });
      a.dirX = dx; a.dirZ = dz;
    }
    for (const a of arms) {
      let cross = 0;
      for (const b of arms) {
        if (b === a) continue;
        const ang = Math.acos(Math.max(-1, Math.min(1, a.dirX * b.dirX + a.dirZ * b.dirZ))) * 180 / Math.PI;
        if (ang >= 35 && ang <= 145) cross = Math.max(cross, b.width / 2);
      }
      a.crossHalf = cross || Math.max(...arms.filter((b) => b !== a).map((b) => b.width / 2), 0);
    }
    const sig = arms.filter((a) => a.rank >= 1);
    let signalized = false;
    outer: for (const a of sig) for (const b of sig) {
      if (a.name === b.name) continue;
      const ang = Math.acos(Math.max(-1, Math.min(1, a.dirX * b.dirX + a.dirZ * b.dirZ))) * 180 / Math.PI;
      if (ang >= 35 && ang <= 145) { signalized = true; break outer; }
    }
    junctions.push({ x: cand.x, z: cand.z, arms, signalized });
  }
  return junctions;
}

// ---------------------------------------------------------------------
// Junction furniture: crosswalks, stop lines, signal placements.

// junctionArmDivided(junction, arm, roadbeds): the approach runs
// on a divided roadbed — a merged bed whose median strip
// taipei-surfaces draws (the same median laneLayout splits at), or
// a paired-carriageway approach whose twin bed survived arm dedupe
// alongside it (same name, near-parallel, same side of the
// junction). Divided approaches get the mast-arm unit; all others
// the plain corner pole.
export function junctionArmDivided(junction, arm, roadbeds) {
  if (laneLayout(roadbeds[arm.bed]).medianHalf > 0) return true;
  // Paired-carriageway twin: same name, near-parallel heading, a
  // different bed ending at the same junction on the same side.
  for (const b of junction.arms) {
    if (b === arm || b.bed === arm.bed || b.name !== arm.name) continue;
    if (b.dirX * arm.dirX + b.dirZ * arm.dirZ > Math.cos((25 * Math.PI) / 180)) return true;
  }
  return false;
}

// buildJunctionFurniture(roadbeds, junctions) ->
// { stripes, stopLines, signals, suppress, stats }
// stripes / stopLines are quads for the renderer's quadsGeometry.
// signals: { x, z, faceX, faceZ, kind, armLen, bed } — a static unit
// per tertiary-or-above approach, standing on the far right-hand
// CORNER of the approach (issue #64): anchored on the approach's
// own centreline at the junction box's far edge, offset past the
// approach's right carriageway edge, then verified against every
// roadbed ribbon and escaped diagonally off the corner until clear
// — a unit never stands on a carriageway. kind is 'mast' (T-shape
// mast arm over the approach) on divided approaches only, 'pole'
// (plain corner pole) elsewhere; armLen is the mast arm's reach.
// suppress feeds buildLaneDividers' stop-line zones.
export function buildJunctionFurniture(roadbeds, junctions) {
  const stripes = [], stopLines = [], signals = [];
  // Provenance (issue #75 audit/tests): the junction index that
  // generated each stripe / stop-line quad, aligned with the
  // stripes / stopLines arrays.
  const stripeJunction = [], stopLineJunction = [];
  const suppress = new Map();
  const stats = {
    junctions: 0, crosswalks: 0, stopLines: 0, signals: 0, skippedArms: 0,
    mastSignals: 0, poleSignals: 0, clearanceMoved: 0, clearanceUnresolved: 0, clearanceFallback: 0,
    ringArmsSkipped: 0,
  };
  // Roundabout claims (issue #75): at a junction a roundabout site
  // claims, arms running on the site's ring carriageway get NO
  // furniture — the #66 audit measured their zebras spraying
  // diagonally across the ring. Entry arms keep their furniture,
  // so crossings stand on the ring entries only.
  const sites = planRoundabouts(roadbeds, junctions);
  const claimOf = new Map();
  for (const s of sites) for (const ji of s.claimedJunctions) claimOf.set(ji, s);
  // Ribbon index for the signal clearance solver (built once; the
  // divider builder rebuilds its own for dashes).
  const ribbonPolys = roadbeds.map(ribbonPoly);
  const ribbonGrid = new Map();
  ribbonPolys.forEach((poly, i) => {
    const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
    for (let gx = Math.floor(Math.min(...xs) / GRID_M); gx <= Math.floor(Math.max(...xs) / GRID_M); gx++)
      for (let gz = Math.floor(Math.min(...zs) / GRID_M); gz <= Math.floor(Math.max(...zs) / GRID_M); gz++) {
        const k = `${gx},${gz}`;
        if (!ribbonGrid.has(k)) ribbonGrid.set(k, []);
        ribbonGrid.get(k).push(i);
      }
  });
  const insideRibbon = (x, z) => {
    const cand = ribbonGrid.get(`${Math.floor(x / GRID_M)},${Math.floor(z / GRID_M)}`) || [];
    for (const ci of cand) if (pointInPoly([x, z], ribbonPolys[ci])) return true;
    return false;
  };
  junctions.forEach((j, ji) => {
    if (!j.signalized) return;
    stats.junctions++;
    const site = claimOf.get(ji);
    for (const arm of j.arms) {
      const bed = roadbeds[arm.bed];
      if (site && site.ringName && bed.name === site.ringName) { stats.ringArmsSkipped++; continue; }
      const half = arm.width / 2;
      // Arc position along the arm's own bed, measured from the
      // junction centre: the bed end sits at signed distance sd from
      // the centre along the arm direction, so the crosswalk centre
      // (crossHalf + gap + half depth out from the centre) is at arc
      // crossHalf + CROSSWALK_GAP + DEPTH/2 − sd from the bed end.
      const sd = (arm.endX - j.x) * arm.dirX + (arm.endZ - j.z) * arm.dirZ;
      const sCross = arm.crossHalf + CROSSWALK_GAP + CROSSWALK_DEPTH / 2 - sd;
      if (arm.width >= CROSSWALK_MIN_ARM_W) {
        if (sCross > 0.5) {
          const c = pointAlongBed(bed, arm.end, sCross);
          const ux = c.dx, uz = c.dz, vx = -uz, vz = ux; // v = left of travel away from junction
          for (let o = -half + 0.35 + STRIPE_W / 2; o <= half - 0.35 - STRIPE_W / 2 + 1e-6; o += STRIPE_PITCH) {
            const oHi = o + STRIPE_W / 2, oLo = o - STRIPE_W / 2;
            const d = CROSSWALK_DEPTH / 2;
            stripes.push([
              c.x - ux * d + vx * oHi, c.z - uz * d + vz * oHi,
              c.x + ux * d + vx * oHi, c.z + uz * d + vz * oHi,
              c.x + ux * d + vx * oLo, c.z + uz * d + vz * oLo,
              c.x - ux * d + vx * oLo, c.z - uz * d + vz * oLo,
            ]);
            stripeJunction.push(ji);
          }
          stats.crosswalks++;
        } else stats.skippedArms++;
      }
      if (arm.rank >= 1) {
        // Stop line on the approach half. Travel toward the junction
        // is −dir; the driver's right is the −v side of the bed frame,
        // so the line spans [−half + margin, −inner] in v offsets.
        const sStop = sCross + CROSSWALK_DEPTH / 2 + STOP_LINE_GAP + STOP_LINE_W / 2;
        {
          const c = pointAlongBed(bed, arm.end, sStop);
          const ux = c.dx, uz = c.dz, vx = -uz, vz = ux;
          const { medianHalf } = laneLayout(bed);
          const oHi = -half + 0.25, oLo = -(medianHalf ? medianHalf + 0.15 : 0.2);
          const d = STOP_LINE_W / 2;
          if (oLo - oHi > 1) {
            stopLines.push([
              c.x - ux * d + vx * oLo, c.z - uz * d + vz * oLo,
              c.x + ux * d + vx * oLo, c.z + uz * d + vz * oLo,
              c.x + ux * d + vx * oHi, c.z + uz * d + vz * oHi,
              c.x - ux * d + vx * oHi, c.z - uz * d + vz * oHi,
            ]);
            stopLineJunction.push(ji);
            stats.stopLines++;
          }
        }
        // Keep dashes out of the stop-line zone on this approach.
        const key = `${arm.bed}:${arm.end}`;
        suppress.set(key, Math.max(suppress.get(key) || 0, sStop + STOP_LINE_W / 2 + 0.6));
        // Signal unit at the far right-hand CORNER of the approach
        // (issue #64). Driver travels −dir; their right normal is
        // (dirZ, −dirX) of the arm dir. The corner is anchored on
        // the approach's OWN centreline — walked from the arm's bed
        // end, not measured from the junction centroid: bed ends
        // scatter metres off the centroid, and the old
        // centroid-relative formula put 59% of units inside a
        // carriageway (audit, issue #64). The box extent along
        // this arm is angle-corrected: a crossing ribbon of half
        // width w met at angle θ ends (w / sinθ) from the centre
        // along this axis, not w.
        const rx = arm.dirZ, rz = -arm.dirX;
        let tBox = arm.crossHalf;
        for (const b of j.arms) {
          if (b === arm) continue;
          const dot = Math.max(-1, Math.min(1, arm.dirX * b.dirX + arm.dirZ * b.dirZ));
          const ang = (Math.acos(dot) * 180) / Math.PI;
          if (ang >= 35 && ang <= 145) tBox = Math.max(tBox, b.width / 2 / Math.sin((ang * Math.PI) / 180));
        }
        const sdEnd = (arm.endX - j.x) * arm.dirX + (arm.endZ - j.z) * arm.dirZ;
        let px = arm.endX - arm.dirX * (sdEnd + tBox + SIGNAL_BOX_MARGIN) + rx * (half + SIGNAL_SIDE_MARGIN);
        let pz = arm.endZ - arm.dirZ * (sdEnd + tBox + SIGNAL_BOX_MARGIN) + rz * (half + SIGNAL_SIDE_MARGIN);
        // Clearance solver: the formula owns the simple crossings;
        // the corner is then verified against EVERY roadbed ribbon
        // and moved until it stands on no carriageway. Real corners
        // are covered by more than the two arm ribbons — through
        // beds that cross the junction without ending there,
        // junction-fan aprons, frontage traces alongside the
        // boulevards, deck ribbons — none of which the arm-based
        // formula can see. Phases, in preference order:
        //   1. escape along the far-right corner diagonal;
        //   2. lattice search of the far-right quadrant (a further
        //      past the box along −dir, b further past the approach
        //      edge along +r), growing Manhattan distance;
        //   3. lattice search of the NEAR-right quadrant (the
        //      driver's own side, before the junction — a real
        //      near-side pole position);
        //   4. lattice search of the far-LEFT quadrant (last
        //      resort: a corner at the side of the road still
        //      beats the middle of it — measured 1 unit tile-wide).
        if (insideRibbon(px, pz)) {
          const fx = px, fz = pz;
          let ex = -arm.dirX + rx, ez = -arm.dirZ + rz;
          const en = Math.hypot(ex, ez) || 1; ex /= en; ez /= en;
          let steps = 0;
          while (steps < SIGNAL_ESCAPE_MAX && insideRibbon(px, pz)) {
            px += ex * SIGNAL_ESCAPE_STEP; pz += ez * SIGNAL_ESCAPE_STEP; steps++;
          }
          const lattice = (ux, uz, vx, vz) => {
            for (let d = 1; d <= SIGNAL_SEARCH_MAX; d++) {
              for (let a = 0; a <= d; a++) {
                const b = d - a;
                if (!insideRibbon(fx + ux * a + vx * b, fz + uz * a + vz * b)) return [fx + ux * a + vx * b, fz + uz * a + vz * b];
                if (a !== b && !insideRibbon(fx + ux * b + vx * a, fz + uz * b + vz * a)) return [fx + ux * b + vx * a, fz + uz * b + vz * a];
              }
            }
            return null;
          };
          let solvedAt = 0;
          if (!insideRibbon(px, pz)) solvedAt = 1;
          if (!solvedAt) {
            const hit = lattice(-arm.dirX, -arm.dirZ, rx, rz);
            if (hit) { [px, pz] = hit; solvedAt = 2; }
          }
          if (!solvedAt) {
            const hit = lattice(arm.dirX, arm.dirZ, rx, rz);
            if (hit) { [px, pz] = hit; solvedAt = 3; }
          }
          if (!solvedAt) {
            const hit = lattice(-arm.dirX, -arm.dirZ, -rx, -rz);
            if (hit) { [px, pz] = hit; solvedAt = 4; }
          }
          if (!solvedAt) stats.clearanceUnresolved++;
          else {
            stats.clearanceMoved++;
            if (solvedAt >= 3) stats.clearanceFallback++;
          }
        }
        // Mast-arm (T) ONLY on a divided approach (user rule);
        // its arm reaches from the corner pole across the approach
        // carriageway to the median edge.
        const divided = junctionArmDivided(j, arm, roadbeds);
        const { medianHalf } = laneLayout(bed);
        const armLen = divided
          ? Math.max(MAST_ARM_MIN, Math.min(MAST_ARM_MAX, half + SIGNAL_SIDE_MARGIN - medianHalf))
          : 0;
        signals.push({
          x: px, z: pz,
          faceX: arm.dirX, faceZ: arm.dirZ,
          kind: divided ? 'mast' : 'pole', armLen, bed: arm.bed,
        });
        stats.signals++;
        if (divided) stats.mastSignals++; else stats.poleSignals++;
      }
    }
  });
  return { stripes, stopLines, signals, suppress, stats, stripeJunction, stopLineJunction };
}

// buildRoadMarkings(roadbeds, medianStrips?, caps?, junctions?)
// -> everything the renderer needs, with the divider suppression
// wired from the junction furniture. medianStrips is forwarded to
// the divider builder (see buildLaneDividers). caps / junctions
// (issue #66): the boot detects junctions once and shares them —
// caps default to planJunctionCaps over the detected junctions and
// are forwarded to the divider builder as occluders. The junction
// FURNITURE (crosswalks, stop lines) is deliberately NOT cap-
// filtered: crosswalks are placed by the same crossHalf arithmetic
// the caps are built from — at major junctions the #75 box cap
// reaches past the stop line, so the furniture sits ON its own
// junction's plain asphalt field (junction2-evidence/AUDIT.md).
// At roundabout-claimed junctions, ring-carriageway arms get no
// furniture at all (see buildJunctionFurniture): the crossings
// stand on the ring entries only.
export function buildRoadMarkings(roadbeds, medianStrips = null, caps = null, junctionsIn = null) {
  const junctions = junctionsIn || detectJunctions(roadbeds);
  if (!caps) caps = planJunctionCaps(roadbeds, junctions);
  const capPolys = caps.map((c) => ringPoints(c.ring));
  const furniture = buildJunctionFurniture(roadbeds, junctions);
  const dividers = buildLaneDividers(roadbeds, furniture.suppress, medianStrips, capPolys);
  return {
    junctions,
    caps,
    dashes: dividers.dashes,
    stripes: furniture.stripes,
    stopLines: furniture.stopLines,
    stripeJunction: furniture.stripeJunction,
    stopLineJunction: furniture.stopLineJunction,
    signals: furniture.signals,
    stats: {
      junctions: junctions.length,
      signalized: furniture.stats.junctions,
      dividerBeds: dividers.stats.beds,
      dashQuads: dividers.stats.dashQuads,
      dividerKm: dividers.stats.dividerKm,
      medianBlockedSamples: dividers.stats.medianBlockedSamples,
      crosswalks: furniture.stats.crosswalks,
      stopLines: furniture.stats.stopLines,
      signalUnits: furniture.stats.signals,
      signalMast: furniture.stats.mastSignals,
      signalPole: furniture.stats.poleSignals,
      clearanceMoved: furniture.stats.clearanceMoved,
      clearanceUnresolved: furniture.stats.clearanceUnresolved,
      clearanceFallback: furniture.stats.clearanceFallback,
      skippedArms: furniture.stats.skippedArms,
      ringArmsSkipped: furniture.stats.ringArmsSkipped,
    },
  };
}
