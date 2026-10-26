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
//
// DECK ARMS (issue #88). An arm whose bed is deck-flagged is an
// elevated carriageway: the viaduct layer draws it and the ground
// ribbon layer does not, so it is not an at-grade approach and gets
// no ground furniture — no crosswalk across its ground projection,
// no stop line, no ground signal unit. The flag, not the surface
// class, is the predicate: deck-class beds the generator leaves
// unflagged (the 信義快速道路 at-grade terminus, the 象山隧道
// mouths) are drawn as ground carriageways and keep theirs. This
// mirrors the roundabout ring-arm exclusion in the furniture
// builder: furniture follows the carriageways at grade.
//
// DECK BEDS AND DIVIDERS (issue #162). The same flag predicate
// governs lane dividers, which are planned per bed, not per arm:
// a deck-flagged bed gets NO dividers. Until this fix the divider
// builder had no deck check, so every qualifying elevated bed
// (91 beds tile-wide) painted its lane lines at ground Y 0.068
// under its own viaduct — 23,378 dash quads, 34.9 km of paint on
// the surface below the decks (measured census in the tests).
// The ground beds under a deck (the at-grade street in the same
// corridor) are different beds and keep their dividers.
//
// FURNITURE DISCIPLINE (issue #170). The #169 tile-wide sweep found
// the furniture layer disagreeing with the junction surface v2
// built (#163) and with itself: crossings are placed per detected
// junction with no de-overlap pass, so at staggered / merged nodes
// two crossings of the SAME junction paint over each other
// (tile-wide census: 92 crossing pairs, 822 stripe pairs, 458 m2
// of double-painted zebra — all same-junction, axes within ~3
// degrees: duplicates, subsets and corner pairs, never crossing
// zebras); stop lines lie across zebras at 47 junctions; the v2
// arm strips paved ground the #64 ribbon clearance cannot see, so
// 95 signal units stand >= 5 m inside the paved surface; and 55
// stripes + 13 stop lines + 2 bands sit with their centres off
// asphalt entirely (roundabout-island strays, zebra tails onto
// green). The builders therefore run a discipline pass before
// returning: (1) XOFF — a stripe whose centre is off the asphalt
// (ribbons U junction surface) is culled; (2) XOVL — crossings are
// ranked by priority (arm class rank, then crossing width, then
// junction, then placement order) and a crossing >= 60% covered by
// higher-priority kept crossings is suppressed whole, otherwise
// its individually overlapping stripes are culled; stop lines
// always yield to stripes (a stop line overlapping a surviving
// stripe is dropped, as is one centred off asphalt); (3) FURN —
// a signal unit deeper than 2 m inside the full junction surface
// (capSurfacePolys: ring + strips) is relocated out along its
// corner diagonal, with nearest-boundary exits and the #64 ribbon
// solver as fallbacks; units are moved, never added or dropped.
// Surviving stripes of a crossing are trimmed to their longest
// contiguous run and the band is rebuilt from that run, so the
// band <-> stripe algebra of issue #90 (one band per crossing,
// width a whole number of stripe pitches) survives every cull.
//
// RENDER FORM (issue #90): the plan above is unchanged — dashes and
// stripes are still enumerated exactly as before (the tests pin
// them) — but the renderer no longer bakes them as solid quads.
// Alongside the plan, the builders emit the SHADER form: dashStrips
// (one ribbon per maximal unoccluded run of a divider line, carrying
// the centreline arc as a continuous `along`) and crosswalk bands
// (one quad per crossing, `along` = lateral distance from the band's
// low edge). A TSL material (createTaipeiMarkingMaterial in
// tsl-materials.js) evaluates the dash / stripe pattern from `along`
// in the fragment shader, so the pattern phase is the planner's own
// phase — dash rhythm is continuous along each bed (arc never
// restarts mid-bed) and a crossing's stripes share one band, one
// phase. Stop lines are single solid quads (not periodic) and stay
// on the solid path.

import { ribbonPoly, pointInPoly, buildPolyGrid, pointInAnyPoly } from './taipei-painted.js';
import { medianKind, medianStripWidth, buildMedianStrips } from './taipei-surfaces.js';
import { planJunctionCaps, planRoundabouts, ringPoints, capSurfacePolys, roundaboutDashOccluders } from './taipei-junctions.js';

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

// Furniture discipline (issue #170): the stripe-overlap census
// threshold of the #169 audit, the share of a crossing that must
// be covered by higher-priority crossings before the whole
// crossing is suppressed, and the signal surface-clearance
// tolerances (a unit may graze the surface edge by this much —
// the surface polygon spans corner to corner, sidewalks
// included — but never stand deep in the paved interior).
export const STRIPE_OVERLAP_M2 = 0.25;
export const XOVL_GROUP_SUPPRESS_SHARE = 0.6;
export const SIGNAL_SURFACE_GRAZE_M = 2;
export const SIGNAL_SURFACE_EXIT_M = 1;  // stand this far past the surface boundary after an exit
export const SIGNAL_SURFACE_WALK_MAX = 90; // corner-diagonal walk budget (0.5 m steps)
const SURF_GRID_M = 60;                  // surface-poly grid cell for depth queries

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
  !!bed && !bed.deck && classRank(bed.highway) >= DIVIDER_MIN_RANK && laneLayout(bed).boundaries.length > 0;

// Densify a centreline to points at most stepM apart (vertices kept).
function densify(pts, stepM) {
  return densifyPts(pts, stepM).pts;
}

// densifyPts: densify + a vertex flag per point (true where the
// point is an original polyline vertex). The dash-strip builder
// (issue #90) sections its ribbons at vertex points only — between
// vertices the offset line is straight and its arc is linear, so
// no section is lost.
function densifyPts(pts, stepM) {
  const out = [pts[0]];
  const vertex = [true];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(len / stepM));
    for (let s = 1; s <= steps; s++) {
      out.push([ax + ((bx - ax) * s) / steps, az + ((bz - az) * s) / steps]);
      vertex.push(s === steps);
    }
  }
  return { pts: out, vertex };
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
// -> { dashes, dashStrips, stats }
// suppress: Map `${bedIndex}:${end}` -> arc metres from that bed end
// where dashes stay off (the stop-line zone at signalized junctions,
// passed in by buildRoadMarkings). medianStrips: an optional
// buildMedianStrips() result to clip dashes against (the boot passes
// the strips it already built for its own layers; standalone callers
// get them built here). capPolys (issue #66): junction-cap polygons
// as point arrays — a dash sample inside any cap is blocked, so no
// lane line crosses a junction core. dashes are quads [x1,z1,…] in
// the strip order taipei-painted's quadsGeometry consumes.
// dashStrips (issue #90) are the shader render form of the same
// plan: per divider line, the maximal runs of consecutive
// UNBLOCKED sample intervals (dash phase NOT applied — the shader
// does that), each run a list of cross-sections { hx, hz, lx, lz,
// along } at the run's end frames, at every bed-polyline vertex
// inside it, and at the frames flanking those vertices. along is
// the centreline arc the dash phase already keys on, so shader
// paint lands where the plan's dashes are.
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

  const stats = { beds: 0, dashQuads: 0, dividerKm: 0, medianBlockedSamples: 0, deckBedsSkipped: 0, crossPairs: 0, crossBlockedSamples: 0 };

  // Pass 1: per divider bed, the densified frames and the base
  // occlusion flags per boundary offset (everything the pre-#173
  // inline loop computed, unchanged).
  const planned = [];
  roadbeds.forEach((bed, selfIdx) => {
    if (!dividersFor(bed)) {
      // Census only (issue #162): a deck-flagged bed that passes
      // the class + lane gates is counted, so the tile-wide count
      // re-pin is a measured deck delta, not a guess.
      if (bed && bed.deck && classRank(bed.highway) >= DIVIDER_MIN_RANK && laneLayout(bed).boundaries.length > 0) stats.deckBedsSkipped++;
      return;
    }
    const { boundaries } = laneLayout(bed);
    const selfWays = new Set(bed.sourceWayIds || []);
    const densified = densifyPts(ptsOf(bed), SAMPLE_STEP_M);
    const pts = densified.pts;
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
      return { p, nx: -dz, nz: dx, arc: arc[i], vertex: densified.vertex[i], suppressed: arc[i] < supStart || totalLen - arc[i] < supEnd };
    });
    stats.beds++;
    const flagsByOff = boundaries.map((off) => {
      const lo = off - DIVIDER_W / 2, hi = off + DIVIDER_W / 2;
      const blockedAt = (f) => {
        const pc = [f.p[0] + f.nx * off, f.p[1] + f.nz * off];
        const pl = [f.p[0] + f.nx * lo, f.p[1] + f.nz * lo];
        const ph = [f.p[0] + f.nx * hi, f.p[1] + f.nz * hi];
        if (inMedianStrip(pc) || inMedianStrip(pl) || inMedianStrip(ph)) { stats.medianBlockedSamples++; return true; }
        if (capBlocked(pc)) return true;
        return f.suppressed || foreignBlocked(pc, selfIdx, selfWays) || foreignBlocked(pl, selfIdx, selfWays) || foreignBlocked(ph, selfIdx, selfWays);
      };
      return { off, lo, hi, flags: frames.map(blockedAt) };
    });
    planned.push({ bed, selfIdx, frames, flagsByOff });
  });

  // Pass 2 (issue #173, DASH class): the X-pair cull. Divider
  // centrelines are polylines offset from kinked centrelines; at a
  // sharp vertex the inner offsets overshoot and two emittable
  // intervals PROPERLY CROSS — the X-pairs the #169 sweep counted at
  // junction mouths (7 at one 光復南路 mouth) and at the 敦化北路
  // merge kink south of 民權東路 (ji147). No real lane line crosses
  // another: both intervals of a crossing pair are blocked at the
  // sample level, so the quad plan and the shader strips break at
  // the same place and the lines end at the gore, as painted lines
  // do. Only intervals that pass every other occlusion test take
  // part — crossings inside caps or foreign ribbons are already
  // dead and don't count.
  {
    const chains = [];
    for (const pl of planned) {
      for (const fo of pl.flagsByOff) {
        const pts = pl.frames.map((f) => [f.p[0] + f.nx * fo.off, f.p[1] + f.nz * fo.off]);
        const live = [];
        for (let i = 0; i + 1 < pts.length; i++) if (!fo.flags[i] && !fo.flags[i + 1]) live.push(i);
        if (live.length) chains.push({ fo, pts, live });
      }
    }
    const CELL = 8;
    const segGrid = new Map();
    chains.forEach((ch, ci) => {
      for (const i of ch.live) {
        const [ax, az] = ch.pts[i], [bx, bz] = ch.pts[i + 1];
        for (let gx = Math.floor(Math.min(ax, bx) / CELL); gx <= Math.floor(Math.max(ax, bx) / CELL); gx++)
          for (let gz = Math.floor(Math.min(az, bz) / CELL); gz <= Math.floor(Math.max(az, bz) / CELL); gz++) {
            const k = `${gx},${gz}`;
            if (!segGrid.has(k)) segGrid.set(k, []);
            segGrid.get(k).push([ci, i]);
          }
      }
    });
    const orient = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const properCross = (a, b, p, q) => {
      const d1 = orient(a, b, p), d2 = orient(a, b, q), d3 = orient(p, q, a), d4 = orient(p, q, b);
      return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
    };
    const seenPair = new Set();
    for (const list of segGrid.values()) {
      for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
        const [ci, i] = list[x], [cj, j] = list[y];
        if (ci === cj && Math.abs(i - j) <= 1) continue;
        const pk = ci < cj || (ci === cj && i < j) ? `${ci}:${i}|${cj}:${j}` : `${cj}:${j}|${ci}:${i}`;
        if (seenPair.has(pk)) continue;
        seenPair.add(pk);
        const A = chains[ci], B = chains[cj];
        if (!properCross(A.pts[i], A.pts[i + 1], B.pts[j], B.pts[j + 1])) continue;
        stats.crossPairs++;
        for (const [ch, si] of [[A, i], [B, j]]) {
          for (const fi of [si, si + 1]) {
            if (!ch.fo.flags[fi]) { ch.fo.flags[fi] = true; stats.crossBlockedSamples++; }
          }
        }
      }
    }
  }

  // Pass 3: emission — the dash phase, the interval mid tests and
  // the shader strip runs, exactly as before, over the final flags.
  const dashes = [];
  const dashStrips = [];
  for (const { bed, selfIdx, frames, flagsByOff } of planned) {
    const selfWays = new Set(bed.sourceWayIds || []);
    for (const { off, lo, hi, flags } of flagsByOff) {
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
      // Shader strips (issue #90): group the same flags into runs
      // of consecutive unblocked intervals. Sections sit at the
      // run's end frames, at bed-polyline vertices inside the run,
      // and at the frames flanking each vertex — a frame's normal
      // blends its neighbours, so the offset edge eases around a
      // vertex over one sample on each side and the flanking
      // sections keep the ribbon on that ease (measured: dash
      // centres up to ~0.12 m off the chorded ribbon without them,
      // ~0.06 m worst-case residual at the sharpest bends with
      // them). Between vertices the offset edge is straight and
      // the arc linear in position, so the shader's interpolated
      // `along` stays the planner's arc (dash phase identical).
      let runStart = -1;
      const flushRun = (endFrame) => {
        const secs = [];
        for (let j = runStart; j <= endFrame; j++) {
          if (j !== runStart && j !== endFrame && !frames[j].vertex
            && !(j > 0 && frames[j - 1].vertex) && !(j + 1 < frames.length && frames[j + 1].vertex)) continue;
          const f = frames[j];
          secs.push({
            hx: f.p[0] + f.nx * hi, hz: f.p[1] + f.nz * hi,
            lx: f.p[0] + f.nx * lo, lz: f.p[1] + f.nz * lo,
            along: f.arc,
          });
        }
        if (secs.length >= 2) dashStrips.push(secs);
        runStart = -1;
      };
      for (let i = 0; i + 1 < frames.length; i++) {
        if (!flags[i]) { if (runStart < 0) runStart = i; }
        else if (runStart >= 0) flushRun(i);
      }
      if (runStart >= 0) flushRun(frames.length - 1);
    }
  }
  return { dashes, dashStrips, stats };
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
// { stripes, stopLines, signals, suppress, stats, bands, bandJunction }
// stripes / stopLines are quads for the renderer's quadsGeometry.
// bands are the shader render form of the stripes (issue #90): one
// band per crosswalk, bandJunction aligned with bands like
// stripeJunction is with stripes.
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
export function buildJunctionFurniture(roadbeds, junctions, capsIn = null) {
  let stripes = [], stopLines = [], signals = [];
  // Provenance (issue #75 audit/tests): the junction index that
  // generated each stripe / stop-line quad, aligned with the
  // stripes / stopLines arrays.
  let stripeJunction = [], stopLineJunction = [];
  // Shader render form (issue #90): one band per crosswalk,
  // spanning exactly the union of its stripe quads across the road
  // ({ quad in stripe-corner order, width = the band's extent
  // across the road }); the material stripes it from the band's
  // own low edge, so the stripe phase is the plan's phase.
  let bands = [], bandJunction = [];
  const suppress = new Map();
  const stats = {
    junctions: 0, crosswalks: 0, stopLines: 0, signals: 0, skippedArms: 0,
    mastSignals: 0, poleSignals: 0, clearanceMoved: 0, clearanceUnresolved: 0, clearanceFallback: 0,
    ringArmsSkipped: 0, deckArmsSkipped: 0,
    // Furniture discipline (issue #170): surface-relocated signal
    // units, units that stayed deep (no candidate qualified), and
    // the per-class cull counts of the discipline pass.
    surfaceMoved: 0, surfaceUnresolved: 0,
    xovlGroupsDropped: 0, xovlStripesDropped: 0, xoffStripesDropped: 0,
    xoffGroupsDropped: 0, trimStripesDropped: 0,
    zebraStopLinesDropped: 0, xoffStopLinesDropped: 0,
  };
  // Crosswalk groups (issue #170): one record per placed crossing
  // ({ ji, start, count, rank, width } into the stripes array, in
  // band order) — the discipline pass reasons per crossing, not
  // per stripe.
  const groups = [];
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
  // Junction surface for the discipline pass (issue #170): the
  // caps' full paved surface (ring + #163 arm strips,
  // capSurfacePolys). buildRoadMarkings passes its caps in; a
  // standalone caller gets them planned here (the roundabout
  // sites are already resolved above).
  const caps = capsIn || planJunctionCaps(roadbeds, junctions, sites);
  const surfPolys = caps.flatMap((c) => capSurfacePolys(c));
  const surfGrid = buildPolyGrid(surfPolys, SURF_GRID_M);
  const surfCands = (x, z) => surfGrid.get(`${Math.floor(x / SURF_GRID_M)},${Math.floor(z / SURF_GRID_M)}`) || [];
  // Depth of a point inside the surface: the smallest distance to
  // a containing polygon's edge (the #169 census3 measure), or -1
  // when the point stands outside every surface polygon.
  const surfDepth = (x, z) => {
    let depth = -1;
    for (const ci of surfCands(x, z)) {
      const poly = surfPolys[ci];
      if (!pointInPoly([x, z], poly)) continue;
      let d = Infinity;
      for (let k = 0; k < poly.length; k++) {
        const ax = poly[k][0], az = poly[k][1];
        const bx = poly[(k + 1) % poly.length][0], bz = poly[(k + 1) % poly.length][1];
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
        let t = ((x - ax) * dx + (z - az) * dz) / l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = ax + dx * t - x, ez = az + dz * t - z;
        if (ex * ex + ez * ez < d) d = ex * ex + ez * ez;
      }
      d = Math.sqrt(d);
      if (depth < 0 || d < depth) depth = d;
    }
    return depth;
  };
  // Ribbon clearance solver (issue #64), factored out (issue
  // #170) so the surface relocation can re-clear a candidate with
  // the identical machinery: diagonal escape off the corner, then
  // lattice searches of the far-right, near-right and far-left
  // quadrants, in that preference order. Returns [x, z, phase]
  // with phase 0 when the point still stands on a carriageway
  // after the full budget (position = the diagonal endpoint,
  // exactly where the inline solver used to leave it).
  const escapeRibbons = (x0, z0, arm, rx, rz) => {
    let px = x0, pz = z0;
    const fx = px, fz = pz;
    let ex = -arm.dirX + rx, ez = -arm.dirZ + rz;
    const en = Math.hypot(ex, ez) || 1; ex /= en; ez /= en;
    let steps = 0;
    while (steps < SIGNAL_ESCAPE_MAX && insideRibbon(px, pz)) {
      px += ex * SIGNAL_ESCAPE_STEP; pz += ez * SIGNAL_ESCAPE_STEP; steps++;
    }
    if (!insideRibbon(px, pz)) return [px, pz, 1];
    const diagX = px, diagZ = pz;
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
    const hit2 = lattice(-arm.dirX, -arm.dirZ, rx, rz);
    if (hit2) return [hit2[0], hit2[1], 2];
    const hit3 = lattice(arm.dirX, arm.dirZ, rx, rz);
    if (hit3) return [hit3[0], hit3[1], 3];
    const hit4 = lattice(-arm.dirX, -arm.dirZ, -rx, -rz);
    if (hit4) return [hit4[0], hit4[1], 4];
    return [diagX, diagZ, 0];
  };
  // Surface relocation (issue #170): from a point deep inside the
  // junction surface, find a nearby standing point outside the
  // surface (a graze of the edge is acceptable) and clear of every
  // ribbon. Preference: walk out along the corner diagonal (the
  // unit stays at its own corner, just further out); then the
  // nearest-boundary exits of the containing polygons, re-cleared
  // against the ribbons where needed. Returns [x, z, true] on
  // success, or the original point with false when nothing
  // qualifies (the unit keeps its #64 corner rather than landing
  // on a carriageway or deeper in the box).
  const relocateSurface = (x, z, arm, rx, rz) => {
    let ex = -arm.dirX + rx, ez = -arm.dirZ + rz;
    const en = Math.hypot(ex, ez) || 1; ex /= en; ez /= en;
    let best = null; // [x, z, depth] shallowest non-ribbon graze seen
    const judge = (cx, cz) => {
      if (insideRibbon(cx, cz)) return -1;
      const d = surfDepth(cx, cz);
      if (d < 0) return 1;
      if (!best || d < best[2]) best = [cx, cz, d];
      return 0;
    };
    for (let s = 1; s <= SIGNAL_SURFACE_WALK_MAX; s++) {
      const cx = x + ex * SIGNAL_ESCAPE_STEP * s, cz = z + ez * SIGNAL_ESCAPE_STEP * s;
      if (judge(cx, cz) === 1) return [cx, cz, true];
    }
    if (best && best[2] <= SIGNAL_SURFACE_GRAZE_M) return [best[0], best[1], true];
    for (const ci of surfCands(x, z)) {
      const poly = surfPolys[ci];
      if (!pointInPoly([x, z], poly)) continue;
      let cNear = null, dNear = Infinity;
      for (let k = 0; k < poly.length; k++) {
        const ax = poly[k][0], az = poly[k][1];
        const bx = poly[(k + 1) % poly.length][0], bz = poly[(k + 1) % poly.length][1];
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
        let t = ((x - ax) * dx + (z - az) * dz) / l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const exx = ax + dx * t - x, ezz = az + dz * t - z;
        if (exx * exx + ezz * ezz < dNear) { dNear = exx * exx + ezz * ezz; cNear = [ax + dx * t, az + dz * t]; }
      }
      if (!cNear) continue;
      let ox = cNear[0] - x, oz = cNear[1] - z;
      const on = Math.hypot(ox, oz);
      if (on < 1e-6) { ox = ex; oz = ez; } else { ox /= on; oz /= on; }
      const qx = cNear[0] + ox * SIGNAL_SURFACE_EXIT_M, qz = cNear[1] + oz * SIGNAL_SURFACE_EXIT_M;
      if (judge(qx, qz) === 1) return [qx, qz, true];
      if (insideRibbon(qx, qz)) {
        const [sx, sz, phase] = escapeRibbons(qx, qz, arm, rx, rz);
        if (phase && judge(sx, sz) === 1) return [sx, sz, true];
      }
    }
    if (best && best[2] <= SIGNAL_SURFACE_GRAZE_M) return [best[0], best[1], true];
    // 3. Radial search (last resort, measured 1 unit tile-wide):
    // in cap-cluster knots the diagonal and the boundary exits
    // all land on a neighbouring cap or ribbon, so sample a
    // bounded ring fan around the point — nearest radius first,
    // angles ordered from the corner diagonal — for any standing
    // point the judge accepts.
    const diagAng = Math.atan2(ez, ex);
    const angs = [];
    for (let k = 0; k < 24; k++) angs.push((k * Math.PI) / 12);
    angs.sort((a, b) => {
      const da = Math.abs(Math.atan2(Math.sin(a - diagAng), Math.cos(a - diagAng)));
      const db = Math.abs(Math.atan2(Math.sin(b - diagAng), Math.cos(b - diagAng)));
      return da - db || a - b;
    });
    for (let r = 3; r <= 30; r += 1.5) {
      for (const a of angs) {
        const cx = x + Math.cos(a) * r, cz = z + Math.sin(a) * r;
        if (judge(cx, cz) === 1) return [cx, cz, true];
      }
      if (best && best[2] <= SIGNAL_SURFACE_GRAZE_M) return [best[0], best[1], true];
    }
    return [x, z, false];
  };
  junctions.forEach((j, ji) => {
    if (!j.signalized) return;
    stats.junctions++;
    const site = claimOf.get(ji);
    for (const arm of j.arms) {
      const bed = roadbeds[arm.bed];
      if (site && site.ringName && bed.name === site.ringName) { stats.ringArmsSkipped++; continue; }
      // Deck arms (issue #88): the bed is drawn elevated, not at
      // grade — no crosswalk, stop line or signal for it (see the
      // DECK ARMS note in the header).
      if (bed.deck) { stats.deckArmsSkipped++; continue; }
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
          const d = CROSSWALK_DEPTH / 2;
          const gStart = stripes.length;
          let firstO = null, lastO = null;
          for (let o = -half + 0.35 + STRIPE_W / 2; o <= half - 0.35 - STRIPE_W / 2 + 1e-6; o += STRIPE_PITCH) {
            const oHi = o + STRIPE_W / 2, oLo = o - STRIPE_W / 2;
            stripes.push([
              c.x - ux * d + vx * oHi, c.z - uz * d + vz * oHi,
              c.x + ux * d + vx * oHi, c.z + uz * d + vz * oHi,
              c.x + ux * d + vx * oLo, c.z + uz * d + vz * oLo,
              c.x - ux * d + vx * oLo, c.z - uz * d + vz * oLo,
            ]);
            stripeJunction.push(ji);
            if (firstO === null) firstO = o;
            lastO = o;
          }
          // The band (issue #90): same corners as the union of the
          // stripe quads above — high edge = last stripe's high
          // edge, low edge = first stripe's low edge.
          if (firstO !== null) {
            const bHi = lastO + STRIPE_W / 2, bLo = firstO - STRIPE_W / 2;
            bands.push({
              quad: [
                c.x - ux * d + vx * bHi, c.z - uz * d + vz * bHi,
                c.x + ux * d + vx * bHi, c.z + uz * d + vz * bHi,
                c.x + ux * d + vx * bLo, c.z + uz * d + vz * bLo,
                c.x - ux * d + vx * bLo, c.z - uz * d + vz * bLo,
              ],
              width: bHi - bLo,
            });
            bandJunction.push(ji);
            groups.push({ ji, start: gStart, count: stripes.length - gStart, rank: arm.rank, width: arm.width });
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
          const [sx, sz, solvedAt] = escapeRibbons(px, pz, arm, rx, rz);
          px = sx; pz = sz;
          if (!solvedAt) stats.clearanceUnresolved++;
          else {
            stats.clearanceMoved++;
            if (solvedAt >= 3) stats.clearanceFallback++;
          }
        }
        // Surface clearance (issue #170): the ribbons end where
        // the #163 arm strips begin, so a unit can clear every
        // ribbon and still stand on junction asphalt — the sweep
        // measured 95 units >= 5 m inside the paved surface, two
        // of them mid-box. A unit deeper than the graze tolerance
        // inside the full surface is relocated out (never dropped:
        // the unit count and kind split are pinned invariants).
        if (surfDepth(px, pz) > SIGNAL_SURFACE_GRAZE_M) {
          const [sx, sz, ok] = relocateSurface(px, pz, arm, rx, rz);
          if (ok) { px = sx; pz = sz; stats.surfaceMoved++; }
          else stats.surfaceUnresolved++;
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
  // ---- furniture discipline pass (issue #170) -------------------
  // Runs over the placed furniture; the junction surfaces and the
  // dash suppression map are NOT touched. Planner quads are simple
  // boundary-ordered loops (rectangles), so pairwise overlap is a
  // direct Sutherland–Hodgman intersection area — no hull pass
  // needed (the census's hull step only re-orders the same four
  // corners). Candidate pairs come from a centre grid with a
  // circumradius filter: two quads can only overlap when their
  // centres are within the sum of their circumradii, so the
  // filter is complete.
  {
    const quadPts = (q) => [[q[0], q[1]], [q[2], q[3]], [q[4], q[5]], [q[6], q[7]]];
    const quadFrame = (q) => {
      const cx = (q[0] + q[2] + q[4] + q[6]) / 4, cz = (q[1] + q[3] + q[5] + q[7]) / 4;
      let r = 0;
      for (let k = 0; k < 8; k += 2) r = Math.max(r, Math.hypot(q[k] - cx, q[k + 1] - cz));
      return { cx, cz, r };
    };
    const polyArea = (p) => {
      let a = 0;
      for (let i = 0; i < p.length; i++) {
        const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length];
        a += x1 * y2 - x2 * y1;
      }
      return a / 2;
    };
    const clipArea = (subject, clip) => {
      if (polyArea(clip) < 0) clip = [...clip].reverse();
      let out = subject;
      for (let i = 0; i < clip.length; i++) {
        const a = clip[i], b = clip[(i + 1) % clip.length];
        const inp = out; out = [];
        if (!inp.length) break;
        const cross = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
        for (let j = 0; j < inp.length; j++) {
          const cur = inp[j], prv = inp[(j + inp.length - 1) % inp.length];
          const cc = cross(cur), pc = cross(prv);
          const inter = () => {
            const t = pc / (pc - cc);
            return [prv[0] + (cur[0] - prv[0]) * t, prv[1] + (cur[1] - prv[1]) * t];
          };
          if (cc >= -1e-9) { if (pc < -1e-9) out.push(inter()); out.push(cur); }
          else if (pc >= -1e-9) out.push(inter());
        }
      }
      return Math.abs(polyArea(out));
    };
    const coveredPt = (x, z) => insideRibbon(x, z) || surfDepth(x, z) >= 0;
    const PAIR_CELL = 4;
    const pairGrid = (frames) => {
      const grid = new Map();
      frames.forEach((f, i) => {
        const k = `${Math.floor(f.cx / PAIR_CELL)},${Math.floor(f.cz / PAIR_CELL)}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(i);
      });
      return grid;
    };
    // Indices in `frames` (indexed in `grid`) whose quad could
    // overlap the quad framed by f: centre within the summed
    // circumradii (plus the largest stripe radius the caller
    // pairs against).
    const nearIdx = (grid, frames, f, otherR) => {
      const out = [];
      const reach = Math.ceil((f.r + otherR) / PAIR_CELL);
      const gx = Math.floor(f.cx / PAIR_CELL), gz = Math.floor(f.cz / PAIR_CELL);
      for (let dx = -reach; dx <= reach; dx++) for (let dz = -reach; dz <= reach; dz++) {
        const cell = grid.get(`${gx + dx},${gz + dz}`);
        if (!cell) continue;
        for (const j of cell) {
          const o = frames[j];
          const rr = f.r + o.r;
          const ddx = f.cx - o.cx, ddz = f.cz - o.cz;
          if (ddx * ddx + ddz * ddz <= rr * rr) out.push(j);
        }
      }
      return out;
    };

    const sFrames = stripes.map(quadFrame);
    const stripeR = sFrames.reduce((m, f) => Math.max(m, f.r), 0);
    const dropCause = new Array(stripes.length).fill(null);
    // (1) XOFF: stripe centres off the asphalt are culled before
    // overlap judging, so a stray island crossing cannot outrank
    // a real one.
    stripes.forEach((q, i) => {
      const f = sFrames[i];
      if (!coveredPt(f.cx, f.cz)) dropCause[i] = 'xoff';
    });
    // (2) XOVL: crossings in priority order (arm class rank,
    // then width, then junction, then placement). `kept` holds
    // the surviving stripes of the crossings already judged; a
    // crossing mostly covered by them is suppressed whole,
    // otherwise only its overlapping stripes are culled.
    const sGrid = pairGrid(sFrames);
    const kept = new Set();
    const order = groups.map((g, gi) => gi).sort((a, b) =>
      groups[b].rank - groups[a].rank || groups[b].count - groups[a].count
      || groups[a].ji - groups[b].ji || a - b);
    for (const gi of order) {
      const g = groups[gi];
      const live = [];
      for (let k = g.start; k < g.start + g.count; k++) if (!dropCause[k]) live.push(k);
      if (!live.length) continue;
      const hit = new Set();
      for (const i of live) {
        for (const j of nearIdx(sGrid, sFrames, sFrames[i], stripeR)) {
          if (!kept.has(j)) continue;
          if (clipArea(quadPts(stripes[i]), quadPts(stripes[j])) > STRIPE_OVERLAP_M2) { hit.add(i); break; }
        }
      }
      if (hit.size / live.length >= XOVL_GROUP_SUPPRESS_SHARE) {
        for (const i of live) dropCause[i] = 'xovlGroup';
        stats.xovlGroupsDropped++;
      } else {
        for (const i of hit) dropCause[i] = 'xovl';
        for (const i of live) if (!hit.has(i)) kept.add(i);
      }
    }
    // (3) Rebuild stripes + bands: each surviving crossing keeps
    // its longest contiguous run of stripes (the band algebra
    // needs a contiguous run at the original pitch); stripes cut
    // off by that trim are counted separately from the two cull
    // classes. The band is rebuilt from the run — first stripe's
    // low edge, last stripe's high edge — so its corners still
    // coincide with stripe corners.
    const nStripes = [], nStripeJunction = [], nBands = [], nBandJunction = [];
    for (const g of groups) {
      const liveLocal = [];
      for (let k = 0; k < g.count; k++) if (!dropCause[g.start + k]) liveLocal.push(k);
      if (!liveLocal.length) {
        // A suppressed group was already counted at marking time;
        // a group that vanished any other way is counted by its
        // stripes' causes (all-off-asphalt, else overlap-led).
        let hasXovlGroup = false, allXoff = true;
        for (let k = 0; k < g.count; k++) {
          if (dropCause[g.start + k] === 'xovlGroup') hasXovlGroup = true;
          if (dropCause[g.start + k] !== 'xoff') allXoff = false;
        }
        if (!hasXovlGroup) {
          if (allXoff) stats.xoffGroupsDropped++;
          else stats.xovlGroupsDropped++;
        }
        continue;
      }
      let bestS = liveLocal[0], bestE = liveLocal[0], curS = liveLocal[0], curE = liveLocal[0];
      for (let t = 1; t < liveLocal.length; t++) {
        if (liveLocal[t] === curE + 1) curE = liveLocal[t];
        else {
          if (curE - curS > bestE - bestS) { bestS = curS; bestE = curE; }
          curS = curE = liveLocal[t];
        }
      }
      if (curE - curS > bestE - bestS) { bestS = curS; bestE = curE; }
      for (let k = 0; k < g.count; k++) {
        if (k >= bestS && k <= bestE) continue;
        if (!dropCause[g.start + k]) stats.trimStripesDropped++;
      }
      const first = stripes[g.start + bestS], last = stripes[g.start + bestE];
      for (let k = bestS; k <= bestE; k++) {
        nStripes.push(stripes[g.start + k]);
        nStripeJunction.push(g.ji);
      }
      nBands.push({
        quad: [last[0], last[1], last[2], last[3], first[4], first[5], first[6], first[7]],
        width: (bestE - bestS) * STRIPE_PITCH + STRIPE_W,
      });
      nBandJunction.push(g.ji);
    }
    for (const c of dropCause) {
      if (c === 'xovl' || c === 'xovlGroup') stats.xovlStripesDropped++;
      else if (c === 'xoff') stats.xoffStripesDropped++;
    }
    stripes = nStripes; stripeJunction = nStripeJunction;
    bands = nBands; bandJunction = nBandJunction;
    stats.crosswalks = bands.length;
    // (4) Stop lines yield to stripes: a line centred off the
    // asphalt, or lying across a surviving zebra, is dropped.
    // (The dash-suppression zones are arm geometry, computed at
    // placement — they do not follow the line quad.)
    const rFrames = stripes.map(quadFrame);
    const rGrid = pairGrid(rFrames);
    const nLines = [], nLineJunction = [];
    stopLines.forEach((q, li) => {
      const f = quadFrame(q);
      if (!coveredPt(f.cx, f.cz)) { stats.xoffStopLinesDropped++; return; }
      let onZebra = false;
      for (const j of nearIdx(rGrid, rFrames, f, stripeR)) {
        if (clipArea(quadPts(q), quadPts(stripes[j])) > STRIPE_OVERLAP_M2) { onZebra = true; break; }
      }
      if (onZebra) { stats.zebraStopLinesDropped++; return; }
      nLines.push(q); nLineJunction.push(stopLineJunction[li]);
    });
    stopLines = nLines; stopLineJunction = nLineJunction;
    stats.stopLines = stopLines.length;
  }
  return { stripes, stopLines, signals, suppress, stats, stripeJunction, stopLineJunction, bands, bandJunction };
}

// buildRoadMarkings(roadbeds, medianStrips?, caps?, junctions?)
// -> everything the renderer needs, with the divider suppression
// wired from the junction furniture. medianStrips is forwarded to
// the divider builder (see buildLaneDividers). caps / junctions
// (issue #66): the boot detects junctions once and shares them —
// caps default to planJunctionCaps over the detected junctions and
// are forwarded to the divider builder as occluders and (issue
// #170) to the furniture builder for its discipline pass. The
// junction FURNITURE placement itself is deliberately NOT cap-
// filtered: crosswalks are placed by the same crossHalf arithmetic
// the caps are built from — at major junctions the #75 box cap
// reaches past the stop line, so the furniture sits ON its own
// junction's plain asphalt field (junction2-evidence/AUDIT.md).
// At roundabout-claimed junctions, ring-carriageway arms get no
// furniture at all (see buildJunctionFurniture): the crossings
// stand on the ring entries only.
export function buildRoadMarkings(roadbeds, medianStrips = null, caps = null, junctionsIn = null, greenPolys = []) {
  const junctions = junctionsIn || detectJunctions(roadbeds);
  if (!caps) caps = planJunctionCaps(roadbeds, junctions);
  // Issue #163: dashes clip against the caps' full paved
  // surface (ring + arm extension strips), not the ring alone.
  // Issue #173: plus the roundabout occluders (islands, aprons and
  // the disc-clipped wedge greens) — claimed roundabout junctions
  // have no cap, so without these the entry lane lines fanned
  // across the planted wedges at the Renai circle.
  const sites = planRoundabouts(roadbeds, junctions);
  const capPolys = [...caps.flatMap((c) => capSurfacePolys(c)), ...roundaboutDashOccluders(sites, greenPolys)];
  const furniture = buildJunctionFurniture(roadbeds, junctions, caps);
  const dividers = buildLaneDividers(roadbeds, furniture.suppress, medianStrips, capPolys);
  return {
    junctions,
    caps,
    dashes: dividers.dashes,
    dashStrips: dividers.dashStrips,
    stripes: furniture.stripes,
    bands: furniture.bands,
    bandJunction: furniture.bandJunction,
    stopLines: furniture.stopLines,
    stripeJunction: furniture.stripeJunction,
    stopLineJunction: furniture.stopLineJunction,
    signals: furniture.signals,
    stats: {
      junctions: junctions.length,
      signalized: furniture.stats.junctions,
      dividerBeds: dividers.stats.beds,
      deckDividerBedsSkipped: dividers.stats.deckBedsSkipped,
      dashQuads: dividers.stats.dashQuads,
      dividerKm: dividers.stats.dividerKm,
      crossPairs: dividers.stats.crossPairs,
      crossBlockedSamples: dividers.stats.crossBlockedSamples,
      medianBlockedSamples: dividers.stats.medianBlockedSamples,
      crosswalks: furniture.stats.crosswalks,
      stopLines: furniture.stats.stopLines,
      signalUnits: furniture.stats.signals,
      signalMast: furniture.stats.mastSignals,
      signalPole: furniture.stats.poleSignals,
      clearanceMoved: furniture.stats.clearanceMoved,
      clearanceUnresolved: furniture.stats.clearanceUnresolved,
      clearanceFallback: furniture.stats.clearanceFallback,
      surfaceMoved: furniture.stats.surfaceMoved,
      surfaceUnresolved: furniture.stats.surfaceUnresolved,
      xovlGroupsDropped: furniture.stats.xovlGroupsDropped,
      xovlStripesDropped: furniture.stats.xovlStripesDropped,
      xoffStripesDropped: furniture.stats.xoffStripesDropped,
      xoffGroupsDropped: furniture.stats.xoffGroupsDropped,
      trimStripesDropped: furniture.stats.trimStripesDropped,
      zebraStopLinesDropped: furniture.stats.zebraStopLinesDropped,
      xoffStopLinesDropped: furniture.stats.xoffStopLinesDropped,
      skippedArms: furniture.stats.skippedArms,
      ringArmsSkipped: furniture.stats.ringArmsSkipped,
      deckArmsSkipped: furniture.stats.deckArmsSkipped,
    },
  };
}
