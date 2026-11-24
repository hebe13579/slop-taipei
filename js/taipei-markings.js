// js/taipei-markings.js — road detail for the Taipei tile (issue #45):
// dashed white lane dividers, zebra crosswalks + stop lines at
// signalized junctions, and static traffic-signal units. Pure data +
// geometry (no three.js), mirroring taipei-painted.js /
// taipei-surfaces.js, so node tests, the evidence audit and the
// renderer all run the exact same rules.
//
// SCOPE (user, 2026-10-24): scooter waiting boxes （機車停等區） are
// OUT — cut from this increment entirely. Traffic lights are WORKING
// geometry (issue #356): pole + horizontal 3-lamp head, one unit per
// signalized approach, each stamped with its phase group (widest road
// = 0); the renderer lights the lenses from signalPhase and the
// traffic network marks the junction's node with the same assignment,
// so the AI obeys the heads it sees. Pedestrian signals are a small
// box with a STATIC lit red panel — no animated little-green-man
// figure and no countdown digits (standing user directive).
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
// JUNCTIONS (issue #389, C5 graph-first). There is no junction object
// in the geodata, but there IS a street graph: roadGraph splits ways
// at shared OSM nodes, and every edge carries its source OSM way id.
// Junctions are derived from it — a graph node of degree >= 3 with
// >= 3 incident beds ending near it (bed.sourceWayIds maps arms to
// beds exactly, no name/geometry tolerance). The graph supplies the
// exact centre, the junction existence and the arm set; each arm's
// direction walks its own bed. Twin nodes (divided-boulevard
// carriageway crossings) share the identical ending-bed set and are
// one junction, centred on their centroid. Through beds contribute
// arms but not junction-hood (an alley T's through bed already paves
// the crossing in one tone). Retired: endpoint clustering (22 m
// union-find + 40 m centroid merge), arm dedup by name/25° and
// width/15°, recentring — the cluster centroid could sit metres off
// the true crossing (measured ~4 m on the acceptance junction), and
// every furniture set-back measures from the centre. Without a graph
// (synthetic tests) the fallback is exact-endpoint coincidence only.
// An arm's direction walks its own bed, so curved approaches keep
// their real heading. On an unmerged divided road the approach width
// is the widest single bed, not the full pair (stated limit).
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
// its individually overlapping stripes are culled; (2b) BANDX —
// the same priority discipline applied to the crosswalk BAND
// quads the shader paints (bands overlap through their duty
// gaps where no stripe pair meets), suppressing a crossing
// whose band is >= 60% culled; stop lines
// always yield to stripes (a stop line overlapping a surviving
// stripe is dropped, as is one centred off asphalt) and, since
// issue #190, to the band quads themselves — a diagonal line
// crosses a band in sub-threshold stripe slices yet paints
// metres across the zebra the shader draws from the band, so
// step (4) judges the band overlap at the same threshold; (3) FURN —
// a signal unit deeper than 2 m inside the full junction surface
// (capSurfacePolys: ring + strips) is relocated out along its
// corner diagonal, with nearest-boundary exits and the #64 ribbon
// solver as fallbacks; units are moved, never added or dropped.
// Surviving stripes of a crossing are trimmed to their longest
// contiguous run and the band is rebuilt from that run, so the
// band <-> stripe algebra of issue #90 (one band per crossing,
// width a whole number of stripe pitches) survives every cull.
//
// DASH x FURNITURE (issue #182). The round-3 sweep censused a
// pair class every earlier census missed because it measured
// dashes against junction SURFACES only: dash quads and shader
// dash-strip paint overlapping the crosswalk furniture itself.
// Bands sit 0.8 m outside the junction box, off-cap, so a dash
// whose centre never enters a cap can still paint across a
// zebra — 31 quad pairs / 2.39 m2 tile-wide and ~16.4 m of
// strip paint over bands and stripes, worst at roundabout
// entries (ji149). Furniture outranks dashes, as in the #170
// discipline: buildRoadMarkings passes the placed band and
// stripe polygons to the divider builder, which culls a dash
// quad overlapping any of them by more than a hairline
// (DASH_FURN_OVERLAP_M2) and splits dash strips at every
// segment whose centreline crosses one — the #178 split, but
// with a segment-intersection test instead of the cap split's
// midpoint test, because the furniture sits off-cap where a
// crossing segment's midpoint usually stays clean. Stop lines
// are NOT dash occluders: a divider terminating at its stop
// line is adjacency, not paint over a crossing (the sweep's
// own severity note on its 35.71 m stop-line figure).
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

// CENTRE LINES (issue #249). Two-way roads carry a yellow centre
// line the divider rule deliberately never painted: double solid
// yellow (分向限制線, art. 165: 10 cm lines, 10 cm apart) on wide
// beds, single dashed yellow (行車分向線, art. 181: 4 m / 6 m,
// 10 cm) on narrower two-way beds >= 6 m. One-way beds carry the
// OSM oneway flag since #249 (see build-generation-map.mjs), merged
// beds are divided by their median, deck beds get no ground paint
// (issue #162) — all three are skipped, and the same cap / ribbon /
// median / furniture occlusion as the dividers applies, so no centre
// line crosses a junction core or a zebra. Rendered as solid quads
// in marking yellow by the boot (the shader-strip form is for
// periodic white patterns; a solid line is a quad run, like the
// stop lines).

import { ribbonPoly, pointInPoly, buildPolyGrid, pointInAnyPoly } from './taipei-painted.js';
import { trimBedsAtPolys } from './taipei-bedtrim.js'; // issue #389: beds are trimmed against junction caps before paint planning
import { medianKind, medianStripWidth, buildMedianStrips } from './taipei-surfaces.js';
import { planJunctionCaps, planRoundabouts, ringPoints, capSurfacePolys, roundaboutDashOccluders, isMajorJunction } from './taipei-junctions.js';

export const LANE_W = 3.2;               // generator's width-per-lane conversion
export const DASH_LEN = 3;               // m of paint per dash
export const DASH_GAP = 4.5;             // m of gap per dash cycle
export const DIVIDER_W = 0.15;           // lane line width
export const DIVIDER_MIN_RANK = 1;       // tertiary and above get dividers
export const CENTER_DOUBLE_MIN_W = 9.6;   // >= 3 lanes: double solid yellow
export const CENTER_MIN_W = 6;            // art. 181: dashed yellow from 6 m
export const CENTER_LINE_W = 0.10;        // art. 165/181: 10 cm lines
export const CENTER_DOUBLE_HALF = 0.15;   // line centres: 0.10 line + 0.10 gap
export const CENTER_DASH_LEN = 4;         // art. 181: 4 m line
export const CENTER_DASH_GAP = 6;         // art. 181: 6 m gap
const CENTER_EXCLUDED = new Set(['service', 'living_street', 'track', 'rest_area', 'services', 'busway']);

export const centerLinesFor = (bed) => {
  if (!bed || bed.deck || bed.oneway) return false;
  if (Array.isArray(bed.sourceWayIds) && bed.sourceWayIds.length >= 2) return false; // merged: median divides
  if (CENTER_EXCLUDED.has(bed.highway)) return false;
  return (bed.width || 0) >= CENTER_MIN_W;
};
const SAMPLE_STEP_M = 1.5;               // divider sampling step
const GRID_M = 100;

export const CROSSWALK_DEPTH = 3.2;      // band depth along the crossed road
export const CROSSWALK_GAP = 0.8;        // clear space between junction box and band
export const STRIPE_W = 0.45;            // zebra stripe width (across the road)
export const STRIPE_PITCH = 0.9;         // stripe repeat across the road
export const STOP_LINE_W = 0.4;          // stop line thickness along the road
export const STOP_LINE_GAP = 0.9;        // between crosswalk band and stop line
export const CROSSWALK_MIN_ARM_W = 7;    // narrower mouths get no zebra

export const JUNCTION_END_M = 22;        // a bed ends at a graph node when an endpoint is within this (issue #389; the old cluster radius — the generation map dilates merged beds 14 m and simplifies at 1.5 m, which bounds the slop)
export const JUNCTION_ARM_MIN_M = 8;      // a bed must extend this far from the centre to count as an approach (a stub ending just past the centre is not one)
export const JUNCTION_ARM_DIR_M = 12;     // arm direction is the chord from the centre to a point this far along the bed

// Signal placement (issue #64, user rule 2026-10-24): a unit stands
// at the SIDE of the road — the far right-hand corner of its
// approach, clear of every carriageway — never mid-junction. A
// mast-arm (T) unit is used ONLY where the approach is divided
// (approachDivided below); everywhere else a plain corner pole.
export const SIGNAL_SIDE_MARGIN = 0.9;   // corner clearance past the approach's right edge
export const SIGNAL_BOX_MARGIN = 1.2;    // corner clearance past the junction box (crossing road's far edge)
export const SIGNAL_ESCAPE_STEP = 0.5;   // clearance-solver step, m
export const SIGNAL_ESCAPE_MAX = 80;     // solver budget: 40 m of diagonal escape (interchange-scale junctions)
export const SIGNAL_SEARCH_MAX = 45;     // quadrant lattice search radius, m (Manhattan)
// (#258: the 辛亥路/基隆路 interchange's merged beds run 45-62 m
// wide, so a signal corner can sit 30+ m inside the ribbon
// tangle — at ji3172 the two 基隆路三段 corners needed Manhattan
// 32 and 34, just past the old 30 m budget, and the diagonal
// escape runs along the beds without exiting. 45 m covers a
// corner a full half-bed deep plus a diagonal exit.)
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

// Dash x furniture (issue #182): the largest dash-quad overlap
// with a crosswalk band or stripe polygon the divider builder
// tolerates — a hairline graze; anything larger culls the dash.
// Dash strip segments clip at the same furniture (see the split
// pass in buildLaneDividers).
export const DASH_FURN_OVERLAP_M2 = 0.05;
const FURN_GRID_M = 25;                  // furniture-poly grid cell for dash queries

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

// Shared paint occluders for the divider builder and the centre-
// line builder (issue #249): crosswalk furniture polygons,
// median-strip polygons and foreign-bed ribbons. Factored verbatim
// out of buildLaneDividers so both builders judge occlusion
// identically. Cap polygons are NOT occluders here any more
// (issue #389): the beds are trimmed against the caps before
// planning, so no dash is planned inside a junction at all —
// the capBlocked point test is retired with the occlusion it
// implemented.
function buildPaintOccluders(roadbeds, medianStrips, furnPolys) {
    const furnGrid = furnPolys ? buildPolyGrid(furnPolys, FURN_GRID_M) : null;
    // Candidate furniture polys for a query bbox (grid cells the
    // bbox touches) — the pair tests below stay local.
    const furnCands = (minx, minz, maxx, maxz) => {
      const out = [], seen = new Set();
      for (let gx = Math.floor(minx / FURN_GRID_M); gx <= Math.floor(maxx / FURN_GRID_M); gx++)
        for (let gz = Math.floor(minz / FURN_GRID_M); gz <= Math.floor(maxz / FURN_GRID_M); gz++) {
          for (const ci of furnGrid.get(`${gx},${gz}`) || []) if (!seen.has(ci)) { seen.add(ci); out.push(ci); }
        }
      return out;
    };
    // Area of subject ∩ clip for convex quads (Sutherland–Hodgman
    // against the clip's edges, side-tested against the clip
    // centroid so either winding works — the same construction
    // the #170 furniture pass and the sweep probes use).
    const overlapArea = (subject, clip) => {
      const ccx = clip.reduce((s, p) => s + p[0], 0) / clip.length;
      const ccz = clip.reduce((s, p) => s + p[1], 0) / clip.length;
      let poly = subject;
      for (let e = 0; e < clip.length && poly.length; e++) {
        const a = clip[e], b = clip[(e + 1) % clip.length];
        const ex = b[0] - a[0], ez = b[1] - a[1];
        const side = (p) => ex * (p[1] - a[1]) - ez * (p[0] - a[0]);
        const ref = side([ccx, ccz]);
        const inside = (p) => side(p) * ref >= 0;
        const next = [];
        for (let i = 0; i < poly.length; i++) {
          const cur = poly[i], prv = poly[(i + poly.length - 1) % poly.length];
          const ci = inside(cur), pi = inside(prv);
          if (ci !== pi) {
            const t = side(prv) / (side(prv) - side(cur));
            next.push([prv[0] + (cur[0] - prv[0]) * t, prv[1] + (cur[1] - prv[1]) * t]);
          }
          if (ci) next.push(cur);
        }
        poly = next;
      }
      if (poly.length < 3) return 0;
      let ar = 0;
      for (let i = 0; i < poly.length; i++) { const [x1, z1] = poly[i], [x2, z2] = poly[(i + 1) % poly.length]; ar += x1 * z2 - x2 * z1; }
      return Math.abs(ar) / 2;
    };
    // Largest single-pair overlap of a dash quad (flat [x,z]x4)
    // with any furniture poly whose bbox meets the quad's.
    const furnOverlap = (q) => {
      const pts = [[q[0], q[1]], [q[2], q[3]], [q[4], q[5]], [q[6], q[7]]];
      const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
      let worst = 0;
      for (const ci of furnCands(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs))) {
        const a = overlapArea(pts, furnPolys[ci]);
        if (a > worst) worst = a;
      }
      return worst;
    };
    // Does the segment a->b pass through a furniture poly's
    // interior? An endpoint inside, or a proper crossing of any
    // edge (the #173 strict-orientation test). A tangential touch
    // or a run along an edge paints nothing inside and stays.
    const orient2 = (ax, az, bx, bz, px, pz) => (bx - ax) * (pz - az) - (bz - az) * (px - ax);
    const segCrossesFurn = (ax, az, bx, bz) => {
      for (const ci of furnCands(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz))) {
        const poly = furnPolys[ci];
        if (pointInPoly([ax, az], poly) || pointInPoly([bx, bz], poly)) return true;
        for (let e = 0; e < poly.length; e++) {
          const [px, pz] = poly[e], [qx, qz] = poly[(e + 1) % poly.length];
          const d1 = orient2(ax, az, bx, bz, px, pz), d2 = orient2(ax, az, bx, bz, qx, qz);
          const d3 = orient2(px, pz, qx, qz, ax, az), d4 = orient2(px, pz, qx, qz, bx, bz);
          if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
        }
      }
      return false;
    };
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

  return { furnGrid, furnOverlap, segCrossesFurn, inMedianStrip, foreignBlocked };
}

// buildLaneDividers(roadbeds, suppress, medianStrips?, capPolys?)
// -> { dashes, dashStrips, stats }
// suppress: Map bedIndex -> [[fromArc, toArc], ...], arc intervals
// along the FULL bed where dashes stay off (the stop-line zone at
// signalized junctions, passed in by buildRoadMarkings — issue #389).
// medianStrips: an optional buildMedianStrips() result to clip
// dashes against (the boot passes the strips it already built for
// its own layers; standalone callers get them built here).
// capPolys (issue #389): junction-cap polygons as point arrays —
// the beds are TRIMMED against them here (trimBedsAtPolys), so no
// lane line is planned inside a junction at all; the old
// capBlocked point test is retired. dashes are quads [x1,z1,…] in
// the strip order taipei-painted's quadsGeometry consumes.
// dashStrips (issue #90) are the shader render form of the same
// plan: per divider line, the maximal runs of consecutive
// UNBLOCKED sample intervals (dash phase NOT applied — the shader
// does that), each run a list of cross-sections { hx, hz, lx, lz,
// along } at the run's end frames, at every bed-polyline vertex
// inside it, and at the frames flanking those vertices. along is
// the centreline arc the dash phase already keys on, so shader
// paint lands where the plan's dashes are.
// furnPolys (issue #182): crosswalk band and stripe polygons as
// point arrays — dash occluders of a different kind than the
// caps. A dash QUAD is culled when its own geometry overlaps
// one by more than DASH_FURN_OVERLAP_M2 (the cap tests are all
// point tests, and the furniture sits off-cap, so a crossing
// dash's centre can stay clean while its corner paints the
// zebra); a dash STRIP is split at every segment whose
// centreline crosses one. Callers that pass no furnPolys (the
// synthetic unit beds) get neither rule — byte-identical.
export function buildLaneDividers(roadbeds, suppress = new Map(), medianStrips = null, capPolys = null, furnPolys = null) {
  // Issue #389: trim the beds against the cap polygons first, so
  // the planner never sees a junction core. The suppress intervals
  // are keyed by full-bed index and mapped onto the trimmed beds
  // through their provenance (trimParent/trimStartArc).
  const beds = capPolys ? trimBedsAtPolys(roadbeds, capPolys) : roadbeds;
  // Issue #389: the trim cuts the bed CENTRELINE at the caps, but a
  // dash quad's centre is laterally offset from the centreline (the
  // lane boundary offset, up to ~half the bed width) — near a cap's
  // diagonal hull edge that offset can carry the centre inside the
  // cap even though the centreline point is outside. So the emitted
  // quads and the shader strips get a final centre guard (the
  // per-sample capBlocked test stays retired — this is one point
  // test per emitted quad / strip segment, not a threaded occluder).
  const capGrid = capPolys ? buildPolyGrid(capPolys) : null;
  const { furnGrid, furnOverlap, segCrossesFurn, inMedianStrip, foreignBlocked } =
    buildPaintOccluders(beds, medianStrips, furnPolys);

  const stats = { beds: 0, dashQuads: 0, dividerKm: 0, medianBlockedSamples: 0, deckBedsSkipped: 0, crossPairs: 0, crossBlockedSamples: 0, stripSegmentsClipped: 0, furnBlockedQuads: 0, furnStripSegmentsClipped: 0, capBlockedQuads: 0 };

  // Pass 1: per divider bed, the densified frames and the base
  // occlusion flags per boundary offset (everything the pre-#173
  // inline loop computed, unchanged).
  const planned = [];
  beds.forEach((bed, selfIdx) => {
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
    // Suppress intervals for this bed, mapped from the full bed's
    // arc coordinates onto this (possibly trimmed) bed: a sample's
    // parent arc is its own arc plus the trim offset.
    const intervals = suppress.get(bed.trimParent ?? selfIdx) || [];
    const startArc = bed.trimStartArc || 0;
    const frames = pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], c = pts[Math.min(pts.length - 1, i + 1)];
      let dx = c[0] - a[0], dz = c[1] - a[1];
      const n = Math.hypot(dx, dz) || 1; dx /= n; dz /= n;
      const parentArc = startArc + arc[i];
      return { p, nx: -dz, nz: dx, arc: arc[i], vertex: densified.vertex[i], suppressed: intervals.some(([a, b]) => parentArc >= a && parentArc <= b) };
    });
    stats.beds++;
    const flagsByOff = boundaries.map((off) => {
      const lo = off - DIVIDER_W / 2, hi = off + DIVIDER_W / 2;
      const blockedAt = (f) => {
        const pc = [f.p[0] + f.nx * off, f.p[1] + f.nz * off];
        const pl = [f.p[0] + f.nx * lo, f.p[1] + f.nz * lo];
        const ph = [f.p[0] + f.nx * hi, f.p[1] + f.nz * hi];
        if (inMedianStrip(pc) || inMedianStrip(pl) || inMedianStrip(ph)) { stats.medianBlockedSamples++; return true; }
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
        if (foreignBlocked(mid, selfIdx, selfWays) || inMedianStrip(mid)) continue;
        // Issue #389: the trim cuts the centreline, but this quad's
        // centre (mid) is laterally offset from it — drop the quad
        // when the offset centre falls inside a cap (see capGrid).
        if (capGrid && pointInAnyPoly(capGrid, capPolys, mid)) { stats.capBlockedQuads++; continue; }
        const quad = [
          f0.p[0] + f0.nx * hi, f0.p[1] + f0.nz * hi,
          f1.p[0] + f1.nx * hi, f1.p[1] + f1.nz * hi,
          f1.p[0] + f1.nx * lo, f1.p[1] + f1.nz * lo,
          f0.p[0] + f0.nx * lo, f0.p[1] + f0.nz * lo,
        ];
        // Issue #182: the point tests above cannot see this dash
        // painting a crosswalk — bands and stripes sit off-cap,
        // so the mid stays clean while a corner of the quad lies
        // across the zebra. Furniture outranks dashes: cull the
        // quad when its own overlap with any band or stripe
        // polygon exceeds the hairline.
        if (furnGrid && furnOverlap(quad) > DASH_FURN_OVERLAP_M2) { stats.furnBlockedQuads++; continue; }
        dashes.push(quad);
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
  // Issue #178 (dash-strip leak): the quad loop above tests every
  // interval's midpoint against the cap occluders, but the shader
  // strips were grouped from the per-frame flags alone, so a strip
  // run could bridge a junction surface between two unblocked
  // frames — the roadsweep-2 census counted 128 strip segments
  // whose centreline midpoint lies inside a cap/roundabout surface
  // (the sweep's ji1066 frame shows one running straight through
  // the cap). Split every strip at each segment whose midpoint —
  // the mean of its two section centres, the same point the census
  // probes — lies inside an occluder polygon, dropping that
  // segment; pieces keep the remaining sections verbatim (dash
  // phase is per-section `along`, so a split cannot shift paint).
  // Only runs when furniture polys were passed: standalone divider
  // calls (the #173 X-cull synthetics) stay byte-identical.
  // Issue #182: the split clips at the crosswalk furniture. A
  // segment is dropped when its centreline — the same section-
  // centre line the sweep's strip census samples — crosses a band
  // or stripe polygon. The midpoint test cannot be reused here:
  // the furniture sits off-cap on the arm, so a segment can paint
  // straight across a zebra with its midpoint on clean asphalt on
  // either side. The cap half of this split was retired with issue
  // #389 on the assumption that trimming the beds keeps every
  // strip segment out of the caps — that assumption is false for
  // the same lateral-offset reason as the quad guard above (the
  // trim cuts the centreline, the strip sections sit at the lane
  // offset), so the cap half is restored: a segment whose midpoint
  // lies inside a cap polygon is dropped and the strip split
  // there (stripSegmentsClipped counts those).
  if (furnGrid || capGrid) {
    const splitStrips = [];
    for (const strip of dashStrips) {
      let piece = [strip[0]];
      for (let k = 0; k + 1 < strip.length; k++) {
        const a = strip[k], b = strip[k + 1];
        const furnHit = furnGrid && segCrossesFurn((a.hx + a.lx) / 2, (a.hz + a.lz) / 2, (b.hx + b.lx) / 2, (b.hz + b.lz) / 2);
        const capHit = capGrid && pointInAnyPoly(capGrid, capPolys, [
          ((a.hx + a.lx) / 2 + (b.hx + b.lx) / 2) / 2,
          ((a.hz + a.lz) / 2 + (b.hz + b.lz) / 2) / 2,
        ]);
        if (furnHit || capHit) {
          if (furnHit) stats.furnStripSegmentsClipped++;
          if (capHit) stats.stripSegmentsClipped++;
          if (piece.length >= 2) splitStrips.push(piece);
          piece = [b];
        } else piece.push(b);
      }
      if (piece.length >= 2) splitStrips.push(piece);
    }
    dashStrips.length = 0;
    dashStrips.push(...splitStrips);
  }
  return { dashes, dashStrips, stats };
}

export function buildCenterLines(roadbeds, suppress = new Map(), medianStrips = null, capPolys = null, furnPolys = null) {
  // Issue #389: trim the beds against the cap polygons first (as
  // buildLaneDividers does) — the capBlocked point test is retired.
  const beds = capPolys ? trimBedsAtPolys(roadbeds, capPolys) : roadbeds;
  // Issue #389: beds lying wholly inside a cap produce no
  // sub-bed, so they are counted nowhere below — track them so
  // the tile-wide census still accounts for every roadbed.
  let fullyTrimmedBeds = 0;
  if (capPolys) {
    const parents = new Set(beds.map((b) => b.trimParent));
    fullyTrimmedBeds = roadbeds.length - parents.size;
  }
  const { furnGrid, furnOverlap, inMedianStrip, foreignBlocked } =
    buildPaintOccluders(beds, medianStrips, furnPolys);
  const stats = {
    beds: 0, doubleBeds: 0, dashBeds: 0,
    doubleKm: 0, dashKm: 0, doubleQuads: 0, dashQuads: 0,
    medianBlockedSamples: 0, furnBlockedQuads: 0,
    deckBedsSkipped: 0, onewayBedsSkipped: 0, mergedBedsSkipped: 0,
    narrowBedsSkipped: 0, excludedBedsSkipped: 0,
    fullyTrimmedBeds, trimmedBeds: beds.length,
  };
  const quads = [];
  beds.forEach((bed, selfIdx) => {
    if (!centerLinesFor(bed)) {
      // Census only, mirroring the divider builder's deck census:
      // each skipped bed is counted under its first failing gate
      // so the tile-wide pins decompose by rule, not by guess.
      if (bed && bed.deck && !bed.oneway && !(Array.isArray(bed.sourceWayIds) && bed.sourceWayIds.length >= 2)
        && !CENTER_EXCLUDED.has(bed.highway) && (bed.width || 0) >= CENTER_MIN_W) stats.deckBedsSkipped++;
      else if (bed && bed.oneway) stats.onewayBedsSkipped++;
      else if (bed && Array.isArray(bed.sourceWayIds) && bed.sourceWayIds.length >= 2) stats.mergedBedsSkipped++;
      else if (bed && (bed.width || 0) < CENTER_MIN_W) stats.narrowBedsSkipped++;
      else if (bed && CENTER_EXCLUDED.has(bed.highway)) stats.excludedBedsSkipped++;
      return;
    }
    const selfWays = new Set(bed.sourceWayIds || []);
    const densified = densifyPts(ptsOf(bed), SAMPLE_STEP_M);
    const pts = densified.pts;
    const arc = [0];
    for (let i = 1; i < pts.length; i++) arc.push(arc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    // Suppress intervals for this bed (issue #389): arc intervals
    // along the full bed, mapped onto this trimmed bed through its
    // provenance (trimParent/trimStartArc).
    const intervals = suppress.get(bed.trimParent ?? selfIdx) || [];
    const startArc = bed.trimStartArc || 0;
    const frames = pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], c = pts[Math.min(pts.length - 1, i + 1)];
      let dx = c[0] - a[0], dz = c[1] - a[1];
      const n = Math.hypot(dx, dz) || 1; dx /= n; dz /= n;
      const parentArc = startArc + arc[i];
      return { p, nx: -dz, nz: dx, arc: arc[i], suppressed: intervals.some(([a, b]) => parentArc >= a && parentArc <= b) };
    });
    const isDouble = (bed.width || 0) >= CENTER_DOUBLE_MIN_W;
    const offsets = isDouble ? [-CENTER_DOUBLE_HALF, CENTER_DOUBLE_HALF] : [0];
    stats.beds++;
    if (isDouble) stats.doubleBeds++; else stats.dashBeds++;
    const half = CENTER_LINE_W / 2;
    for (const off of offsets) {
      const lo = off - half, hi = off + half;
      const blocked = frames.map((f) => {
        const pc = [f.p[0] + f.nx * off, f.p[1] + f.nz * off];
        const pl = [f.p[0] + f.nx * lo, f.p[1] + f.nz * lo];
        const ph = [f.p[0] + f.nx * hi, f.p[1] + f.nz * hi];
        if (inMedianStrip(pc) || inMedianStrip(pl) || inMedianStrip(ph)) { stats.medianBlockedSamples++; return true; }
        return f.suppressed || foreignBlocked(pc, selfIdx, selfWays) || foreignBlocked(pl, selfIdx, selfWays) || foreignBlocked(ph, selfIdx, selfWays);
      });
      for (let i = 0; i + 1 < frames.length; i++) {
        if (blocked[i] || blocked[i + 1]) continue;
        const f0 = frames[i], f1 = frames[i + 1];
        if (!isDouble) {
          const midArc = (f0.arc + f1.arc) / 2;
          if (midArc % (CENTER_DASH_LEN + CENTER_DASH_GAP) >= CENTER_DASH_LEN) continue; // in the gap
        }
        const mid = [(f0.p[0] + f1.p[0]) / 2 + ((f0.nx + f1.nx) / 2) * off,
                     (f0.p[1] + f1.p[1]) / 2 + ((f0.nz + f1.nz) / 2) * off];
        if (foreignBlocked(mid, selfIdx, selfWays) || inMedianStrip(mid)) continue;
        const quad = [
          f0.p[0] + f0.nx * hi, f0.p[1] + f0.nz * hi,
          f1.p[0] + f1.nx * hi, f1.p[1] + f1.nz * hi,
          f1.p[0] + f1.nx * lo, f1.p[1] + f1.nz * lo,
          f0.p[0] + f0.nx * lo, f0.p[1] + f0.nz * lo,
        ];
        // Furniture outranks paint, as for the dashes (issue #182):
        // cull the quad when its own overlap with a band or stripe
        // polygon exceeds the hairline.
        if (furnGrid && furnOverlap(quad) > DASH_FURN_OVERLAP_M2) { stats.furnBlockedQuads++; continue; }
        quads.push(quad);
        const len = Math.hypot(f1.p[0] - f0.p[0], f1.p[1] - f0.p[1]) / 1000;
        if (isDouble) { stats.doubleQuads++; stats.doubleKm += len; }
        else { stats.dashQuads++; stats.dashKm += len; }
      }
    }
  });
  return { quads, stats };
}

// ---------------------------------------------------------------------
// Junction detection.

// detectJunctions(roadbeds, graph = null) -> [{ x, z, signalized, arms }]
// arm: { bed, end, farEnd, name, highway, rank, width, dirX, dirZ,
//        endX, endZ, crossHalf, through, centreArc } — dir points away
//        from the junction along the arm's own bed; crossHalf is the
//        junction box's extent along this arm (the widest crossing
//        arm's half width). `end` is the bed end AT the junction (the
//        old semantics — the ring builder and the #163 strips read
//        endX/endZ as the arm's root); for a through bed there is no
//        such end, so `end` is the end the arm points toward and
//        endX/endZ is the bed point nearest the centre. `farEnd` is
//        the bed end the arm points toward (the furniture's suppress
//        interval extends from the centre in that direction).
//        `centreArc` is the centre's arc along the bed.
//
// GRAPH-FIRST (issue #389, C5). With the road graph (geodata
// roadGraph: nodes flat [x,z,...], edges {a, b, way, ...} — ways split
// at shared OSM nodes, each edge carrying its source OSM way id), a
// junction is a graph node of degree >= 3 with >= 3 incident beds
// ENDING near it (a bed endpoint within JUNCTION_END_M of the node —
// the generation map dilates merged beds 14 m and simplifies at
// 1.5 m, which bounds the slop). The graph supplies the exact centre,
// the junction existence, and the arm set; the bed supplies each
// arm's direction. Through beds contribute arms but not
// junction-hood: most topological junctions are alley Ts whose
// through bed already paves the crossing in one tone, and a cap
// exists to give one surface where ribbons of different classes
// overlap or butt — so the ending-bed rule preserves the shipped
// cap set's shape while making its geometry exact. Twin nodes
// (divided-boulevard carriageway crossings) share the identical
// ending-bed set and are one junction, centred on their centroid.
// Retired with the clustering: the 22 m union-find, the 40 m
// centroid merge, arm dedup by name/25° and width/15°, recentring.
// Measured on main 82cb0642: 3,478 clustered junctions -> ~4,156
// graph junctions (853 endpoint-cluster phantoms dropped, merged
// alley clusters split into exact nodes, 57 genuinely missed
// junctions added, e.g. 文林路×福國路).
//
// WITHOUT a graph (synthetic tests, old callers) the fallback is
// exact-endpoint coincidence only: beds sharing an exact endpoint
// coordinate form a junction. No radius, no merge, no dedup — the
// graph algorithm applied to the beds themselves.
export function detectJunctions(roadbeds, graph = null) {
  if (graph && graph.nodes && graph.edges) return junctionsFromGraph(roadbeds, graph);
  return junctionsFromEndpoints(roadbeds);
}

// Nearest point on a bed's centreline to (x, z): { x, z, arc, dx, dz }
// (arc = distance along the bed from its start; dx/dz = the local
// tangent, pointing along increasing arc). Used by the furniture's
// centre-based walks and by the POC band placement.
export function bedNearestPoint(bed, x, z) {
  const pts = ptsOf(bed);
  let best = null, bestD2 = Infinity, acc = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz;
    let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = ax + dx * t, pz = az + dz * t;
    const d2 = (px - x) * (px - x) + (pz - z) * (pz - z);
    if (d2 < bestD2) {
      const n = Math.hypot(dx, dz) || 1;
      bestD2 = d2;
      best = { x: px, z: pz, arc: acc + Math.hypot(px - ax, pz - az), dx: dx / n, dz: dz / n };
    }
    acc += Math.hypot(dx, dz);
  }
  return best;
}

// Walk a bed from the point nearest (x, z), in the (dirX, dirZ)
// direction, for s metres: { x, z, dx, dz } at that point (dx/dz =
// the local tangent in the walking direction). Returns null when the
// bed does not reach that far in that direction. The furniture's
// crosswalk / stop-line / signal set-backs are measured from the
// junction centre this way, so a through bed's arm (which has no
// bed end at the junction) works exactly like an ending bed's.
export function pointAlongBedFrom(bed, x, z, dirX, dirZ, s) {
  const near = bedNearestPoint(bed, x, z);
  if (!near) return null;
  const pts = ptsOf(bed);
  // The nearest point lies on some segment; walk from it in the
  // direction whose tangent agrees with (dirX, dirZ).
  const forward = near.dx * dirX + near.dz * dirZ >= 0;
  const seq = [];
  // Rebuild the walk as an ordered list of (point, tangent) steps
  // starting at the nearest point.
  const idx = nearestSegmentIndex(pts, near);
  if (forward) {
    seq.push([near.x, near.z, near.dx, near.dz]);
    for (let i = idx + 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
      const n = Math.hypot(bx - ax, bz - az) || 1;
      seq.push([bx, bz, (bx - ax) / n, (bz - az) / n]);
    }
  } else {
    seq.push([near.x, near.z, -near.dx, -near.dz]);
    for (let i = idx; i >= 0; i--) {
      const [ax, az] = pts[i + 1], [bx, bz] = pts[i];
      const n = Math.hypot(bx - ax, bz - az) || 1;
      seq.push([bx, bz, (bx - ax) / n, (bz - az) / n]);
    }
  }
  let acc = 0;
  for (let i = 0; i + 1 < seq.length; i++) {
    const [ax, az] = seq[i];
    const [bx, bz] = seq[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const n = len || 1;
    const hx = (bx - ax) / n, hz = (bz - az) / n; // this segment's heading
    if (acc + len >= s) {
      const t = len > 0 ? Math.min(1, Math.max(0, (s - acc) / len)) : 0;
      return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, dx: hx, dz: hz };
    }
    acc += len;
    if (i + 2 === seq.length) {
      // Past the far end the walk extrapolates along the last
      // segment's heading (as pointAlongBed does) — fragment beds
      // are often shorter than the set-back they must carry, and
      // their approaches run straight. The #170 discipline pass
      // culls any crossing this lands off the asphalt.
      const over = s - acc;
      return { x: bx + hx * over, z: bz + hz * over, dx: hx, dz: hz };
    }
  }
  return null;
}

// Segment index whose span contains the nearest point (re-found by
// the same distance rule bedNearestPoint uses, so the walk starts on
// the right segment).
function nearestSegmentIndex(pts, near) {
  let best = 0, bestD2 = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz;
    let t = l2 > 0 ? ((near.x - ax) * dx + (near.z - az) * dz) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = ax + dx * t, pz = az + dz * t;
    const d2 = (px - near.x) * (px - near.x) + (pz - near.z) * (pz - near.z);
    if (d2 < bestD2) { bestD2 = d2; best = i; }
  }
  return best;
}

// Build the arm list for one junction group: one arm per incident
// bed per side the bed extends from the centre. `incident` is
// [{ bed, ends }] where ends is true when the bed ends near a member
// node. An arm exists in a direction when the bed extends at least
// JUNCTION_ARM_MIN_M from the centre that way — a stub ending just
// past the centre is not an approach. The arm direction is the chord
// from the centre to a point JUNCTION_ARM_DIR_M along the bed (the
// old code's "well along the arm" rule), so a curved approach keeps
// its real heading instead of its endpoint tangent.
function armsForGroup(roadbeds, cx, cz, incident) {
  const arms = [];
  for (const { bed: bi, ends } of incident) {
    const bed = roadbeds[bi];
    const pts = ptsOf(bed);
    if (pts.length < 2) continue;
    const near = bedNearestPoint(bed, cx, cz);
    if (!near) continue;
    const totalLen = bedLength(bed);
    // Extension of the bed from the centre in each direction.
    const extForward = totalLen - near.arc; // toward end 1
    const extBack = near.arc;               // toward end 0
    // The arm's ROOT (endX/endZ): the bed end at the junction for
    // an ending bed (the endpoint nearer the centre), the bed's
    // nearest point to the centre for a through bed (there is no
    // bed end at the junction). The ring builder, the #163 strips
    // and the tests all read the root as "where the arm meets the
    // junction" — the old arm.end semantics. `end` is that root's
    // bed end (for a through bed, the end the arm points toward —
    // bedChordDir is never called for through beds, because
    // armExtension returns null before it: a through bed's root
    // sits at the centre, inside the box). `farEnd` is the end the
    // arm points toward (the furniture's suppress interval extends
    // from the centre in that direction).
    const nearEnd = !ends ? -1
      : Math.hypot(pts[0][0] - cx, pts[0][1] - cz) <= Math.hypot(pts[pts.length - 1][0] - cx, pts[pts.length - 1][1] - cz) ? 0 : 1;
    const root = nearEnd === -1 ? [near.x, near.z] : pts[nearEnd === 0 ? 0 : pts.length - 1];
    const rootX = root[0], rootZ = root[1];
    const armDir = (dirX, dirZ) => {
      const probe = pointAlongBedFrom(bed, cx, cz, dirX, dirZ, JUNCTION_ARM_DIR_M);
      if (probe) {
        const dx = probe.x - cx, dz = probe.z - cz;
        const n = Math.hypot(dx, dz);
        if (n > 1e-6) return [dx / n, dz / n];
      }
      return [dirX, dirZ];
    };
    const mkArm = (dirX, dirZ, farEnd) => {
      const [ax, az] = armDir(dirX, dirZ);
      return {
        bed: bi, end: nearEnd === -1 ? farEnd : nearEnd, farEnd,
        name: bed.name || '', highway: bed.highway,
        rank: classRank(bed.highway), width: bed.width || 3,
        dirX: ax, dirZ: az,
        endX: rootX, endZ: rootZ,
        crossHalf: 0, through: false, centreArc: near.arc,
      };
    };
    if (extForward >= JUNCTION_ARM_MIN_M) {
      const a = mkArm(near.dx, near.dz, 1);
      a.through = extBack >= JUNCTION_ARM_MIN_M;
      arms.push(a);
    }
    if (extBack >= JUNCTION_ARM_MIN_M) {
      const a = mkArm(-near.dx, -near.dz, 0);
      a.through = extForward >= JUNCTION_ARM_MIN_M;
      arms.push(a);
    }
  }
  // Fragment collapse: the generation map splits one road into
  // several beds (raw OSM ways end at every side street), so one
  // approach can arrive as two beds of the same name in nearly the
  // same direction — keep the widest, as the old clusterer did.
  // This is NOT detection (the graph already fixed the arms); it
  // only stops one approach drawing two crosswalks and two signal
  // units at the same corner. A much narrower arm (under half the
  // width) pointing the same way (within 15°) as a kept arm is a
  // slip/fragment of that approach whatever its name — ramps and
  // frontage stubs ending at the same corner — and folds into it
  // too. Genuine forks (> 25° apart) are untouched.
  arms.sort((a, b) => b.width - a.width);
  const kept = [];
  for (const a of arms) {
    const dot = (k) => k.dirX * a.dirX + k.dirZ * a.dirZ;
    if (kept.some((k) => k.name === a.name && dot(k) > Math.cos((25 * Math.PI) / 180))) continue;
    if (kept.some((k) => dot(k) > Math.cos((15 * Math.PI) / 180) && k.width >= a.width * 2.2)) continue;
    kept.push(a);
  }
  arms.length = 0;
  arms.push(...kept);
  // crossHalf per arm: the junction box's extent along this arm is
  // the widest crossing arm's half width (unchanged arithmetic).
  for (const a of arms) {
    let cross = 0;
    for (const b of arms) {
      if (b === a) continue;
      const ang = Math.acos(Math.max(-1, Math.min(1, a.dirX * b.dirX + a.dirZ * b.dirZ))) * 180 / Math.PI;
      if (ang >= 35 && ang <= 145) cross = Math.max(cross, b.width / 2);
    }
    a.crossHalf = cross || Math.max(...arms.filter((b) => b !== a).map((b) => b.width / 2), 0);
  }
  return arms;
}

function signalizedOf(arms) {
  const sig = arms.filter((a) => a.rank >= 1);
  for (const a of sig) for (const b of sig) {
    if (a.name === b.name) continue;
    const ang = Math.acos(Math.max(-1, Math.min(1, a.dirX * b.dirX + a.dirZ * b.dirZ))) * 180 / Math.PI;
    if (ang >= 35 && ang <= 145) return true;
  }
  return false;
}

// Graph-first detection (see detectJunctions).
function junctionsFromGraph(roadbeds, graph) {
  const nodeCount = graph.nodes.length / 2;
  const nodeXY = (i) => [graph.nodes[i * 2], graph.nodes[i * 2 + 1]];
  // way -> bed indices (a bed carries every source way it was built from).
  const bedsByWay = new Map();
  roadbeds.forEach((bed, bi) => {
    for (const w of bed.sourceWayIds || []) {
      if (!bedsByWay.has(w)) bedsByWay.set(w, []);
      bedsByWay.get(w).push(bi);
    }
  });
  // Degree per node, and the incident edges per node.
  const degree = new Array(nodeCount).fill(0);
  const incidentEdges = Array.from({ length: nodeCount }, () => []);
  for (const e of graph.edges) {
    degree[e.a]++; degree[e.b]++;
    incidentEdges[e.a].push(e); incidentEdges[e.b].push(e);
  }
  // Candidate nodes: degree >= 3 with >= 3 incident beds ending near them.
  const candidates = []; // { node, x, z, ending: Set<bed>, incident: [{bed, ends}] }
  for (let ni = 0; ni < nodeCount; ni++) {
    if (degree[ni] < 3) continue;
    const [nx, nz] = nodeXY(ni);
    const incident = new Map(); // bed -> ends?
    for (const e of incidentEdges[ni]) {
      for (const bi of bedsByWay.get(e.way) || []) {
        if (!incident.has(bi)) incident.set(bi, false);
      }
    }
    if (!incident.size) continue;
    // A way can produce several beds (the generation map splits a
    // long way into runs), so sharing a way id is not enough: the
    // bed itself must pass near the node, or a distant fragment of
    // the same way (measured: a 12 m fragment 170 m from its node)
    // would count as an approach. The nearest-point test is the
    // guard; the endpoint test below is the ending test.
    for (const bi of [...incident.keys()]) {
      const near = bedNearestPoint(roadbeds[bi], nx, nz);
      if (!near || Math.hypot(near.x - nx, near.z - nz) > JUNCTION_END_M) incident.delete(bi);
    }
    if (!incident.size) continue;
    const ending = new Set();
    for (const bi of incident.keys()) {
      const pts = ptsOf(roadbeds[bi]);
      if (pts.length < 2) continue;
      const d0 = Math.hypot(pts[0][0] - nx, pts[0][1] - nz);
      const d1 = Math.hypot(pts[pts.length - 1][0] - nx, pts[pts.length - 1][1] - nz);
      if (Math.min(d0, d1) <= JUNCTION_END_M) {
        ending.add(bi);
        incident.set(bi, true);
      }
    }
    if (ending.size < 3) continue;
    candidates.push({ node: ni, x: nx, z: nz, ending, incident: [...incident.entries()].map(([bed, ends]) => ({ bed, ends })) });
  }
  // Twin grouping: candidates sharing the identical ending-bed set
  // are one junction (divided-boulevard carriageway crossings).
  const groups = new Map();
  for (const c of candidates) {
    const key = [...c.ending].sort((a, b) => a - b).join(',');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  const junctions = [];
  for (const members of groups.values()) {
    const cx = members.reduce((s, m) => s + m.x, 0) / members.length;
    const cz = members.reduce((s, m) => s + m.z, 0) / members.length;
    const incident = new Map();
    for (const m of members) for (const inc of m.incident) {
      if (!incident.has(inc.bed)) incident.set(inc.bed, inc);
      else if (inc.ends) incident.get(inc.bed).ends = true;
    }
    const arms = armsForGroup(roadbeds, cx, cz, [...incident.values()]);
    junctions.push({ x: cx, z: cz, arms, signalized: signalizedOf(arms) });
  }
  return junctions;
}

// Exact-endpoint fallback (see detectJunctions): beds sharing an
// exact endpoint coordinate form a junction; arms are the beds
// meeting there (one per bed per side, as in armsForGroup).
function junctionsFromEndpoints(roadbeds) {
  const byKey = new Map();
  roadbeds.forEach((bed, bi) => {
    const pts = ptsOf(bed);
    if (pts.length < 2) return;
    for (const end of [0, 1]) {
      const p = end === 0 ? pts[0] : pts[pts.length - 1];
      const k = `${p[0]},${p[1]}`;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(bi);
    }
  });
  const junctions = [];
  for (const [key, beds] of byKey) {
    const uniq = [...new Set(beds)];
    if (uniq.length < 3) continue;
    const [x, z] = key.split(',').map(Number);
    const incident = uniq.map((bed) => ({ bed, ends: true }));
    const arms = armsForGroup(roadbeds, x, z, incident);
    junctions.push({ x, z, arms, signalized: signalizedOf(arms) });
  }
  return junctions;
}

// ---------------------------------------------------------------------
// Junction furniture: crosswalks, stop lines, signal placements.

// Phase groups (issue #356): at a signalized junction, the
// approaches on the widest road form group 0 (the "avenue" phase);
// every other approach is group 1 (the "street" phase). The
// pairing mirrors sidesAndGroups in js/road-network.js — opposite
// arms (dot < -0.82, straightest first, exclusive mates) form a
// road, roads rank by their widest member's half width — and the
// network's signalized nodes take their arm groups from this
// function via the env (see there), so the group is computed once,
// here, and the rendered lens phase can never disagree with the
// phase js/traffic.js obeys. (A rank tie would make a mirrored
// rule order-dependent — measured 72 exact ties among the 480
// signalized junctions — which is why the network copies this
// assignment instead of re-deriving it.)
// Returns an array of groups aligned with junction.arms.
export function junctionPhaseGroups(junction) {
  const arms = junction.arms;
  const pairs = [];
  for (let i = 0; i < arms.length; i++) for (let j = i + 1; j < arms.length; j++) {
    const d = arms[i].dirX * arms[j].dirX + arms[i].dirZ * arms[j].dirZ;
    if (d < -0.82) pairs.push([d, arms[i], arms[j]]);
  }
  pairs.sort((p, q) => p[0] - q[0]);
  const mates = new Map();
  for (const [, a, b] of pairs) {
    if (mates.has(a) || mates.has(b)) continue;
    mates.set(a, b); mates.set(b, a);
  }
  const roads = [];
  const done = new Set();
  for (const a of arms) {
    if (done.has(a)) continue;
    done.add(a);
    const mate = mates.get(a);
    if (mate) done.add(mate);
    const members = mate ? [a, mate] : [a];
    roads.push({ members, rank: Math.max(...members.map((m) => m.width / 2)) });
  }
  // Issue #356: merge roads that run the same way. The junction
  // detector merges crossings within 40 m, so one approach can
  // appear twice — two sightings of the same road (a name change
  // at a section boundary, a fork just outside the box, the two
  // carriageways of a divided road) — pointing within ~18° of each
  // other but paired with different opposite arms, so the two
  // sightings land in different roads and get different groups.
  // The network then has one arm for that approach and must pick
  // one sighting by direction; the rendered unit on the other
  // sighting disagrees (measured: 8 tight mismatches, dots
  // 0.995–1.000, before this merge). Two arms pointing the same
  // way never conflict — their traffic flows together through the
  // box — so they belong in one road and share a phase. The merge
  // can only flip group-1 arms to group 0 (a merged road's rank is
  // the max of its constituents', so the widest road never
  // changes); it never flips a group-0 arm to group 1.
  const SAME_DIR_DOT = 0.95; // ~18°
  const parent = roads.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < roads.length; i++) for (let j = i + 1; j < roads.length; j++) {
    const sameDir = roads[i].members.some((a) => roads[j].members.some((b) => a.dirX * b.dirX + a.dirZ * b.dirZ > SAME_DIR_DOT));
    if (sameDir) { const ri = find(i), rj = find(j); if (ri !== rj) parent[ri] = rj; }
  }
  const merged = new Map();
  roads.forEach((r, i) => {
    const root = find(i);
    if (!merged.has(root)) merged.set(root, { members: [], rank: 0 });
    const m = merged.get(root);
    m.members.push(...r.members);
    m.rank = Math.max(m.rank, r.rank);
  });
  const mergedRoads = [...merged.values()];
  mergedRoads.sort((p, q) => q.rank - p.rank);
  const groupOf = new Map();
  mergedRoads.forEach((r, i) => { for (const m of r.members) groupOf.set(m, i === 0 ? 0 : 1); });
  return arms.map((a) => groupOf.get(a) ?? 1);
}

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

// POC (#214) G1 classifier: a fitted, unsignalized junction whose
// through road is divided (a merged bed carrying a median, or a
// same-name same-direction twin carriageway pair) and is crossed
// by a minor arm. Returns null, or the axis frame the zebra POC
// places against: { mode: 'merged' | 'twin', ux, uz (axis dir),
// axisArm, half, medianHalf (merged), twins (twin mode) }.
const crossAngleOk = (a, b) => {
  const dot = Math.max(-1, Math.min(1, a.dirX * b.dirX + a.dirZ * b.dirZ));
  const ang = (Math.acos(dot) * 180) / Math.PI;
  return ang >= 35 && ang <= 145;
};
export function dividedAvenueInfo(j, roadbeds) {
  if (!j || j.signalized || isMajorJunction(j)) return null;
  const arms = j.arms || [];
  const crossedByMinor = (a) => arms.some((c) =>
    c !== a && c.name !== a.name && crossAngleOk(a, c) && !roadbeds[c.bed].deck);
  for (const a of arms) {
    if (!medianKind(roadbeds[a.bed])) continue;
    if (!crossedByMinor(a)) continue;
    const { medianHalf } = laneLayout(roadbeds[a.bed]);
    return { mode: 'merged', ux: a.dirX, uz: a.dirZ, axisArm: a, half: roadbeds[a.bed].width / 2, medianHalf };
  }
  for (let i = 0; i < arms.length; i++) {
    for (let k = i + 1; k < arms.length; k++) {
      const a = arms[i], b = arms[k];
      if (!a.name || a.name !== b.name) continue;
      if (a.dirX * b.dirX + a.dirZ * b.dirZ < Math.cos((25 * Math.PI) / 180)) continue;
      if (!junctionArmDivided(j, a, roadbeds)) continue;
      if (!crossedByMinor(a)) continue;
      return { mode: 'twin', ux: a.dirX, uz: a.dirZ, axisArm: a, twins: [a, b] };
    }
  }
  return null;
}

// buildJunctionFurniture(roadbeds, junctions) ->
// { stripes, stopLines, signals, suppress, stats, bands, bandJunction }
// stripes / stopLines are quads for the renderer's quadsGeometry.
// bands are the shader render form of the stripes (issue #90): one
// band per crosswalk, bandJunction aligned with bands like
// stripeJunction is with stripes.
// signals: { x, z, faceX, faceZ, kind, armLen, bed, group } — a
// working unit per tertiary-or-above approach (issue #356),
// standing on the far right-hand CORNER of the approach (issue #64): anchored on the approach's
// own centreline at the junction box's far edge, offset past the
// approach's right carriageway edge, then verified against every
// roadbed ribbon and escaped diagonally off the corner until clear
// — a unit never stands on a carriageway. kind is 'mast' (T-shape
// mast arm over the approach) on divided approaches only, 'pole'
// (plain corner pole) elsewhere; armLen is the mast arm's reach.
// suppress feeds buildLaneDividers' / buildCenterLines' stop-line
// zones (issue #389): Map bedIndex -> [[fromArc, toArc], ...], arc
// intervals along the FULL bed from the junction centre out past the
// stop line, one per arm. The builders map them onto their trimmed
// beds through the trim provenance (trimParent/trimStartArc).
export function buildJunctionFurniture(roadbeds, junctions, capsIn = null, opts = {}) {
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
    dividedPocJunctions: 0, dividedPocCrosswalks: 0,
    mastSignals: 0, poleSignals: 0, clearanceMoved: 0, clearanceUnresolved: 0, clearanceFallback: 0,
    ringArmsSkipped: 0, deckArmsSkipped: 0,
    // Furniture discipline (issue #170): surface-relocated signal
    // units, units that stayed deep (no candidate qualified), and
    // the per-class cull counts of the discipline pass.
    surfaceMoved: 0, surfaceUnresolved: 0,
    xovlGroupsDropped: 0, xovlStripesDropped: 0, xoffStripesDropped: 0,
    xoffGroupsDropped: 0, trimStripesDropped: 0,
    bandStripesDropped: 0, bandGroupsDropped: 0,
    zebraStopLinesDropped: 0, xoffStopLinesDropped: 0, bandStopLinesDropped: 0,
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
    // Issue #356: this junction's phase groups (widest road = 0),
    // computed once — every signal unit on it carries its arm's
    // group, and the traffic network copies the same assignment
    // (js/road-network.js), so render and traffic cannot disagree.
    const phaseGroups = junctionPhaseGroups(j);
    const site = claimOf.get(ji);
    for (let ai = 0; ai < j.arms.length; ai++) {
      const arm = j.arms[ai];
      const bed = roadbeds[arm.bed];
      if (site && site.ringName && bed.name === site.ringName) { stats.ringArmsSkipped++; continue; }
      // Deck arms (issue #88): the bed is drawn elevated, not at
      // grade — no crosswalk, stop line or signal for it (see the
      // DECK ARMS note in the header).
      if (bed.deck) { stats.deckArmsSkipped++; continue; }
      const half = arm.width / 2;
      // Arc position along the arm's own bed, measured from the
      // junction centre (issue #389): the crosswalk centre sits
      // crossHalf + gap + half depth out from the centre, walked
      // from the bed point nearest the centre in the arm direction
      // — so a through bed's arm (no bed end at the junction) works
      // exactly like an ending bed's. The old formula measured from
      // the bed end (sCross = target − sd); the centre is a graph
      // node now, so the walk starts there.
      const sCross = arm.crossHalf + CROSSWALK_GAP + CROSSWALK_DEPTH / 2;
      if (arm.width >= CROSSWALK_MIN_ARM_W) {
        const c = pointAlongBedFrom(bed, j.x, j.z, arm.dirX, arm.dirZ, sCross);
        if (c) {
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
          // Centre-based walk (issue #389), as the crosswalk above.
          const c = pointAlongBedFrom(bed, j.x, j.z, arm.dirX, arm.dirZ, sStop);
          if (!c) { /* the bed does not reach the stop line */ } else {
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
        }
        // Keep dashes out of the stop-line zone on this approach
        // (issue #389): an ARC INTERVAL along the bed, from the
        // centre out past the stop line — not a distance from a bed
        // end, because a through bed's arm has no bed end at the
        // junction. The divider/centreline builders map the interval
        // onto their trimmed beds through the trim provenance
        // (trimParent/trimStartArc). arm.centreArc is the centre's
        // arc along this bed; the interval extends in the arm's
        // direction (toward end 1 when arm.farEnd is 1, else toward
        // end 0).
        const iv = arm.farEnd === 1
          ? [arm.centreArc, arm.centreArc + sStop + STOP_LINE_W / 2 + 0.6]
          : [arm.centreArc - sStop - STOP_LINE_W / 2 - 0.6, arm.centreArc];
        if (!suppress.has(arm.bed)) suppress.set(arm.bed, []);
        suppress.get(arm.bed).push(iv);
        // Signal unit at the far right-hand CORNER of the approach
        // (issue #64). Driver travels −dir; their right normal is
        // (dirZ, −dirX) of the arm dir. The corner is anchored on
        // the approach's OWN centreline, measured from the junction
        // centre (issue #389): the centre is a graph node now, so
        // the bed-end walk the old formula used is unnecessary —
        // and the old centroid-relative formula put 59% of units
        // inside a carriageway (audit, issue #64) precisely because
        // the centroid was not the crossing. The box extent along
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
        let px = j.x - arm.dirX * (tBox + SIGNAL_BOX_MARGIN) + rx * (half + SIGNAL_SIDE_MARGIN);
        let pz = j.z - arm.dirZ * (tBox + SIGNAL_BOX_MARGIN) + rz * (half + SIGNAL_SIDE_MARGIN);
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
          // Issue #356: the phase group of this approach (0 = the
          // junction's widest road, 1 = every other approach). The
          // renderer lights this unit's lenses from
          // signalPhase(elapsed, group === 0) and the traffic
          // network marks the junction's node with the same
          // assignment — one source of truth, in
          // junctionPhaseGroups above.
          group: phaseGroups[ai],
        });
        stats.signals++;
        if (divided) stats.mastSignals++; else stats.poleSignals++;
      }
    }
  });
  // ---- POC (#214) G1: divided-avenue zebras ----------------------
  // Flag-gated (opts.dividedPoc); off by default the furniture is
  // exactly the signalized-only set above. At a fitted junction
  // whose through road is divided, each minor arm's mouth gets a
  // zebra across EACH carriageway of the avenue, seated on the
  // cap: the band is perpendicular to the avenue, centred on the
  // minor arm's axis where it meets the avenue centreline, and
  // spans one carriageway (one half of a merged bed split by its
  // median, or one twin bed). Stripes use the same pitch/width/
  // depth as the signalized crossings and join the same groups,
  // so the #170 discipline pass below judges them identically.
  if (opts.dividedPoc) {
    const placePocBand = (cx, cz, ux, uz, vx, vz, spanHalf, ji, rank, width) => {
      const d = CROSSWALK_DEPTH / 2;
      const gStart = stripes.length;
      let firstO = null, lastO = null;
      for (let o = -spanHalf + 0.35 + STRIPE_W / 2; o <= spanHalf - 0.35 - STRIPE_W / 2 + 1e-6; o += STRIPE_PITCH) {
        const oHi = o + STRIPE_W / 2, oLo = o - STRIPE_W / 2;
        stripes.push([
          cx - ux * d + vx * oHi, cz - uz * d + vz * oHi,
          cx + ux * d + vx * oHi, cz + uz * d + vz * oHi,
          cx + ux * d + vx * oLo, cz + uz * d + vz * oLo,
          cx - ux * d + vx * oLo, cz - uz * d + vz * oLo,
        ]);
        stripeJunction.push(ji);
        if (firstO === null) firstO = o;
        lastO = o;
      }
      if (firstO !== null) {
        const bHi = lastO + STRIPE_W / 2, bLo = firstO - STRIPE_W / 2;
        bands.push({
          quad: [
            cx - ux * d + vx * bHi, cz - uz * d + vz * bHi,
            cx + ux * d + vx * bHi, cz + uz * d + vz * bHi,
            cx + ux * d + vx * bLo, cz + uz * d + vz * bLo,
            cx - ux * d + vx * bLo, cz - uz * d + vz * bLo,
          ],
          width: bHi - bLo,
        });
        bandJunction.push(ji);
        groups.push({ ji, start: gStart, count: stripes.length - gStart, rank, width });
        stats.dividedPocCrosswalks++;
      }
    };
    junctions.forEach((j, ji) => {
      if (claimOf.get(ji)) return;
      const info = dividedAvenueInfo(j, roadbeds);
      if (!info) return;
      stats.dividedPocJunctions++;
      const ux = info.ux, uz = info.uz, vx = -uz, vz = ux;
      const axisName = info.axisArm.name;
      for (const c of j.arms) {
        if (c.name === axisName) continue;
        if (roadbeds[c.bed].deck) continue;
        if (!crossAngleOk(info.axisArm, c)) continue;
        // Band centre from the bed's own geometry (issue #389):
        // the point on the minor bed nearest the centre, projected
        // onto the avenue frame — the old code projected the bed
        // END, which is meaningless for a through bed (its end is
        // far away on the far side).
        const nc = bedNearestPoint(roadbeds[c.bed], j.x, j.z);
        const sStar = nc ? (nc.x - j.x) * ux + (nc.z - j.z) * uz : 0;
        if (info.mode === 'merged') {
          const na = bedNearestPoint(roadbeds[info.axisArm.bed], j.x, j.z);
          const oAxis = na ? (na.x - j.x) * vx + (na.z - j.z) * vz : 0;
          for (const [lo, hi] of [[info.medianHalf, info.half], [-info.half, -info.medianHalf]]) {
            if (hi - lo < CROSSWALK_MIN_ARM_W) continue;
            const oMid = oAxis + (lo + hi) / 2;
            placePocBand(j.x + ux * sStar + vx * oMid, j.z + uz * sStar + vz * oMid,
              ux, uz, vx, vz, (hi - lo) / 2, ji, c.rank || 0, hi - lo);
          }
        } else {
          for (const t of info.twins) {
            if (t.width < CROSSWALK_MIN_ARM_W) continue;
            const nt = bedNearestPoint(roadbeds[t.bed], j.x, j.z);
            const oT = nt ? (nt.x - j.x) * vx + (nt.z - j.z) * vz : 0;
            placePocBand(j.x + ux * sStar + vx * oT, j.z + uz * sStar + vz * oT,
              ux, uz, vx, vz, t.width / 2, ji, c.rank || 0, t.width);
          }
        }
      }
    });
  }
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
    // (2b) BANDX (issue #178): XOVL judges stripe x stripe, but
    // the renderer paints the BAND quads (issue #90), and two
    // bands overlap wherever their spans cross — including the
    // duty-cycle gaps, where no stripe pair ever meets. The
    // roadsweep-2 census counted 158 band pairs overlapping by
    // > STRIPE_OVERLAP_M2 (878.5 m2 over 112 junctions, worst
    // 29.2 m2: interleaved duplicate crossings sharing a corner).
    // So each crossing's candidate band — the band step (3) would
    // rebuild from its longest surviving run — is judged against
    // the bands already kept, in the SAME priority order as XOVL
    // (arm rank, then crossing size, then junction, then
    // placement). Band-specific tie-break: a crossing's size for
    // this pass is its candidate RUN length in stripes, not the
    // placed stripe count XOVL sorts by — the band is the run, so
    // the wider surviving band outranks, exactly as stripe count
    // proxies width at placement. Against the worst kept band,
    // run stripes whose own quad overlaps it by > 0.02 m2 are
    // culled and the run re-forms; if the bands still overlap
    // with no stripe touching the offender (a gap-only overlap),
    // the run shrinks from the end nearer the overlap centroid.
    // The judged run is always the run step (3) would emit, re-
    // judged after every cull — killing the longest run promotes
    // a secondary run whose band must face the same test. A
    // crossing losing >= XOVL_GROUP_SUPPRESS_SHARE of the run
    // being judged is suppressed whole (every live stripe of the
    // group, as XOVL suppresses), stripes and band together — a
    // culled band region never leaves its stripes painted, nor
    // vice versa, because step (3) rebuilds both from the same
    // dropCause.
    {
      const longestRun = (g) => {
        let best = null, cur = null;
        for (let k = 0; k < g.count; k++) {
          if (dropCause[g.start + k]) { cur = null; continue; }
          if (cur) cur.e = k; else cur = { s: k, e: k };
          if (!best || cur.e - cur.s > best.e - best.s) best = { ...cur };
        }
        return best;
      };
      const bandQuadOf = (g, run) => {
        const first = stripes[g.start + run.s], last = stripes[g.start + run.e];
        return [last[0], last[1], last[2], last[3], first[4], first[5], first[6], first[7]];
      };
      // Convex clip returning the polygon (clipArea's sibling,
      // for the overlap centroid the shrink rule needs).
      const clipPolyOf = (subject, clip) => {
        let out = subject;
        for (let i = 0; i < clip.length; i++) {
          const a = clip[i], b = clip[(i + 1) % clip.length];
          const inp = out; out = [];
          if (!inp.length) break;
          const cross = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
          for (let j = 0; j < inp.length; j++) {
            const curp = inp[j], prv = inp[(j + inp.length - 1) % inp.length];
            const cc = cross(curp), pc = cross(prv);
            const inter = () => {
              const t = pc / (pc - cc);
              return [prv[0] + (curp[0] - prv[0]) * t, prv[1] + (curp[1] - prv[1]) * t];
            };
            if (cc >= -1e-9) { if (pc < -1e-9) out.push(inter()); out.push(curp); }
            else if (pc >= -1e-9) out.push(inter());
          }
        }
        return out;
      };
      const bandOrder = groups.map((g, gi) => ({ gi, run: longestRun(g) }))
        .filter((e) => e.run)
        .sort((a, b) => groups[b.gi].rank - groups[a.gi].rank
          || (b.run.e - b.run.s) - (a.run.e - a.run.s)
          || groups[a.gi].ji - groups[b.gi].ji || a.gi - b.gi);
      const keptBands = []; // { quad, frame }
      const kbFrames = [];
      const kbGrid = new Map();
      let kbMaxR = 0;
      const kbAdd = (entry) => {
        keptBands.push(entry); kbFrames.push(entry.frame);
        kbMaxR = Math.max(kbMaxR, entry.frame.r);
        const k = `${Math.floor(entry.frame.cx / PAIR_CELL)},${Math.floor(entry.frame.cz / PAIR_CELL)}`;
        if (!kbGrid.has(k)) kbGrid.set(k, []);
        kbGrid.get(k).push(keptBands.length - 1);
      };
      for (const { gi } of bandOrder) {
        const g = groups[gi];
        // Judge the run step (3) will actually emit, and re-judge
        // after every cull: killing the longest run promotes a
        // secondary run whose band was never judged (measured at
        // ji1739: the suppressed run's sibling emitted a band
        // overlapping a kept neighbour by 3.8 m2). Suppression
        // drops the whole group, as XOVL's does.
        let guard = 0;
        while (guard++ < 64) {
          const run = longestRun(g);
          if (!run) break;
          const runLen = run.e - run.s + 1;
          const bq = bandQuadOf(g, run);
          const bf = quadFrame(bq);
          let worst = null, worstArea = STRIPE_OVERLAP_M2;
          for (const ki of nearIdx(kbGrid, kbFrames, bf, kbMaxR)) {
            const a = clipArea(quadPts(bq), quadPts(keptBands[ki].quad));
            if (a > worstArea) { worstArea = a; worst = keptBands[ki]; }
          }
          if (!worst) { kbAdd({ quad: bq, frame: bf }); break; }
          // Cull the run stripes touching the offender band.
          let dropped = 0;
          for (let k = run.s; k <= run.e; k++) {
            if (clipArea(quadPts(stripes[g.start + k]), quadPts(worst.quad)) > 0.02) {
              dropCause[g.start + k] = 'bandx'; dropped++;
            }
          }
          if (!dropped) {
            // Gap-only overlap: shrink from the end nearer the
            // overlap centroid, projected on the band's lateral
            // axis (first stripe centre -> last stripe centre).
            const poly = clipPolyOf(quadPts(bq), quadPts(worst.quad));
            const cen = poly.reduce((acc, p) => [acc[0] + p[0] / poly.length, acc[1] + p[1] / poly.length], [0, 0]);
            const fs = sFrames[g.start + run.s], ls = sFrames[g.start + run.e];
            const ax = ls.cx - fs.cx, az = ls.cz - fs.cz;
            const mid = [(fs.cx + ls.cx) / 2, (fs.cz + ls.cz) / 2];
            const d = (cen[0] - mid[0]) * ax + (cen[1] - mid[1]) * az;
            dropCause[g.start + (d > 0 ? run.e : run.s)] = 'bandx'; dropped = 1;
          }
          if (dropped / runLen >= XOVL_GROUP_SUPPRESS_SHARE) {
            for (let k = 0; k < g.count; k++) {
              if (!dropCause[g.start + k] || dropCause[g.start + k] === 'bandx')
                dropCause[g.start + k] = 'bandxGroup';
            }
            stats.bandGroupsDropped++;
            break;
          }
        }
        // A group whose runs all emptied without a suppression is
        // accounted in step (3) with the other vanished groups.
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
        // Issue #178: 'bandxGroup' groups were counted by the
        // BANDX pass itself; a group killed purely by BANDX culls
        // counts as a band group here.
        let hasGroupCause = false, allXoff = true, allBandx = true;
        for (let k = 0; k < g.count; k++) {
          const c = dropCause[g.start + k];
          if (c === 'xovlGroup' || c === 'bandxGroup') hasGroupCause = true;
          if (c !== 'xoff') allXoff = false;
          if (c !== 'bandx' && c !== 'bandxGroup') allBandx = false;
        }
        if (!hasGroupCause) {
          if (allXoff) stats.xoffGroupsDropped++;
          else if (allBandx) stats.bandGroupsDropped++;
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
      else if (c === 'bandx' || c === 'bandxGroup') stats.bandStripesDropped++;
    }
    stripes = nStripes; stripeJunction = nStripeJunction;
    bands = nBands; bandJunction = nBandJunction;
    stats.crosswalks = bands.length;
    // (4) Stop lines yield to stripes AND bands: a line centred
    // off the asphalt, or lying across a surviving zebra, is
    // dropped. The stripe test alone cannot see the defect class
    // of issue #190: the renderer paints the BAND quads (issue
    // #90), and a diagonal stop line crosses a band in slices —
    // each stripe slice under STRIPE_OVERLAP_M2, the rest over
    // the band's duty-cycle gaps — so it survived step (4) while
    // painting up to 3.55 m2 across the zebra (tile-wide census:
    // 90 stop x band pairs over 0.005 m2, 92.23 m2 total, 87 stop
    // lines at 68 junctions, all same-junction; the type
    // specimen's line slices its band's stripes at 0.204 m2 max
    // but covers 1.260 m2 of the band). So the line is judged
    // against the surviving bands at the same threshold; stripe
    // cause keeps counting priority so the #170 history stays
    // comparable. (The dash-suppression zones are arm geometry,
    // computed at placement — they do not follow the line quad.)
    const rFrames = stripes.map(quadFrame);
    const rGrid = pairGrid(rFrames);
    const bFrames = bands.map((b) => quadFrame(b.quad));
    const bandR = bFrames.reduce((m, f) => Math.max(m, f.r), 0);
    const bGrid = pairGrid(bFrames);
    const nLines = [], nLineJunction = [];
    stopLines.forEach((q, li) => {
      const f = quadFrame(q);
      if (!coveredPt(f.cx, f.cz)) { stats.xoffStopLinesDropped++; return; }
      let onZebra = false;
      for (const j of nearIdx(rGrid, rFrames, f, stripeR)) {
        if (clipArea(quadPts(q), quadPts(stripes[j])) > STRIPE_OVERLAP_M2) { onZebra = true; break; }
      }
      if (onZebra) { stats.zebraStopLinesDropped++; return; }
      let onBand = false;
      for (const j of nearIdx(bGrid, bFrames, f, bandR)) {
        if (clipArea(quadPts(q), quadPts(bands[j].quad)) > STRIPE_OVERLAP_M2) { onBand = true; break; }
      }
      if (onBand) { stats.bandStopLinesDropped++; return; }
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
export function buildRoadMarkings(roadbeds, medianStrips = null, caps = null, junctionsIn = null, greenPolys = [], opts = {}) {
  const junctions = junctionsIn || detectJunctions(roadbeds, opts.graph || null);
  if (!caps) caps = planJunctionCaps(roadbeds, junctions);
  // Issue #163: dashes clip against the caps' full paved
  // surface (ring + arm extension strips), not the ring alone.
  // Issue #173: plus the roundabout occluders (islands, aprons and
  // the disc-clipped wedge greens) — claimed roundabout junctions
  // have no cap, so without these the entry lane lines fanned
  // across the planted wedges at the Renai circle.
  const sites = planRoundabouts(roadbeds, junctions);
  const capPolys = [...caps.flatMap((c) => capSurfacePolys(c)), ...roundaboutDashOccluders(sites, greenPolys)];
  const furniture = buildJunctionFurniture(roadbeds, junctions, caps, opts);
  // Issue #182: the placed crosswalk bands and stripes are dash
  // occluders too — the furniture is final here (the #170 pass
  // has already culled it), and the divider builder culls dash
  // quads and splits dash strips against exactly these polygons.
  const furnPolys = [...furniture.bands.map((b) => b.quad), ...furniture.stripes]
    .map((q) => [[q[0], q[1]], [q[2], q[3]], [q[4], q[5]], [q[6], q[7]]]);
  const dividers = buildLaneDividers(roadbeds, furniture.suppress, medianStrips, capPolys, furnPolys);
  const center = buildCenterLines(roadbeds, furniture.suppress, medianStrips, capPolys, furnPolys);
  return {
    junctions,
    caps,
    dashes: dividers.dashes,
    dashStrips: dividers.dashStrips,
    centerQuads: center.quads,
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
      centerBeds: center.stats.beds,
      centerDoubleBeds: center.stats.doubleBeds,
      centerDashBeds: center.stats.dashBeds,
      centerDoubleKm: center.stats.doubleKm,
      centerDashKm: center.stats.dashKm,
      centerDoubleQuads: center.stats.doubleQuads,
      centerDashQuads: center.stats.dashQuads,
      centerFurnBlockedQuads: center.stats.furnBlockedQuads,
      centerDeckBedsSkipped: center.stats.deckBedsSkipped,
      centerOnewayBedsSkipped: center.stats.onewayBedsSkipped,
      centerMergedBedsSkipped: center.stats.mergedBedsSkipped,
      centerNarrowBedsSkipped: center.stats.narrowBedsSkipped,
      centerExcludedBedsSkipped: center.stats.excludedBedsSkipped,
      centerFullyTrimmedBeds: center.stats.fullyTrimmedBeds,
      centerTrimmedBeds: center.stats.trimmedBeds,
      crossPairs: dividers.stats.crossPairs,
      crossBlockedSamples: dividers.stats.crossBlockedSamples,
      furnBlockedQuads: dividers.stats.furnBlockedQuads,
      furnStripSegmentsClipped: dividers.stats.furnStripSegmentsClipped,
      medianBlockedSamples: dividers.stats.medianBlockedSamples,
      crosswalks: furniture.stats.crosswalks,
      dividedPocJunctions: furniture.stats.dividedPocJunctions,
      dividedPocCrosswalks: furniture.stats.dividedPocCrosswalks,
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
      bandStripesDropped: furniture.stats.bandStripesDropped,
      bandGroupsDropped: furniture.stats.bandGroupsDropped,
      xoffStripesDropped: furniture.stats.xoffStripesDropped,
      xoffGroupsDropped: furniture.stats.xoffGroupsDropped,
      trimStripesDropped: furniture.stats.trimStripesDropped,
      zebraStopLinesDropped: furniture.stats.zebraStopLinesDropped,
      bandStopLinesDropped: furniture.stats.bandStopLinesDropped,
      xoffStopLinesDropped: furniture.stats.xoffStopLinesDropped,
      skippedArms: furniture.stats.skippedArms,
      ringArmsSkipped: furniture.stats.ringArmsSkipped,
      deckArmsSkipped: furniture.stats.deckArmsSkipped,
    },
  };
}
