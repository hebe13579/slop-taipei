// js/taipei-junctions.js — junction caps for the Taipei tile
// (issues #66, #75): paved treatment per detected junction, in
// three classes:
//
//   MAJOR junctions (any arm arterial/deck class) get a BOX cap
//   (issue #75): the full junction box, corner to corner — each
//   arm's cross-section line placed by pure crossHalf arithmetic
//   (extended to meet a short bed end, and, at signalized
//   junctions, far enough out that the junction's own crosswalks
//   and stop lines sit ON the cap), the box corners taken from
//   adjacent arms' line intersections, the polygon the convex
//   hull of corners + cross-section ends. One plain asphalt
//   field, no fitted-hull fans or spikes. The #75 audit measured
//   the old fitted hulls on major junctions: of 320 major
//   junctions, 213 failed — 180 left > 1% of the box uncovered,
//   187 missed at least one box corner, and only 46% of
//   crosswalk stripe centres sat on a cap. After this change
//   every major junction's box measures coverage 1.000 with all
//   corners covered (AUDIT.md in the #75 evidence).
//
//   MINOR junctions keep the #66 fitted hull: the CONVEX HULL of
//   the arms' cross-sections, each placed at reach =
//   max(crossHalf, bedEnd + 1.5 m) — at a boulevard×lane mouth
//   (the common minor case) a box/disc spills metres onto the
//   blocks beside the lane, which is why the fitted shape stays
//   for the minor class.
//
//   ROUNDABOUTS get neither generic cap (issue #75, user
//   direction): planRoundabouts below handcrafts each site — a
//   plain asphalt DISC (the annulus field, drawn full and then
//   covered by the island) plus a defined central ISLAND
//   (planted where the real island is planted, plaza paving at
//   北門）. Junctions a site claims get no cap at all, and the
//   markings builder drops ring-arm furniture there so crossings
//   stand only on the ring entries.
//
// Caps render at y = 0.061 (above the carriageways at 0.06, below
// the median strips at 0.062). The RENDERED tone is a per-vertex
// blend of the incident arms' surface tones (issue #91, see
// capBlendTones below): a cap meets every arm in that arm's own
// tone and blends across the middle, instead of wearing the
// widest arm's flat tone across the whole junction — at mixed
// junctions (a wide collector crossing arterials, an arterial
// plugging into lane mouths) the flat rule read as a mismatched
// slab. `cls` still records the widest arm's class (the census /
// audit metadata it has always been); it no longer colours the
// cap. They are also the hard occluder for the painted layers: taipei-painted,
// taipei-surfaces (medians) and taipei-markings (dashes) take the
// cap polygons and drop any band / strip / dash quad whose centre
// lands inside one, so no paint crosses a junction core.
// Crosswalk stripes and stop lines are exempt by design — they
// are junction furniture placed by the same crossHalf arithmetic;
// at major junctions the box reach puts them on the cap itself.

import { surfaceClass, SURFACE_TONES } from './taipei-surfaces.js';
import { ribbonPoly, buildPolyGrid, pointInAnyPoly, pointInPoly } from './taipei-painted.js';

export const CAP_Y = 0.061;               // between carriageways (0.06) and medians (0.062)
export const CAP_END_OVERLAP_M = 1.5;     // cap reaches this far past an arm's bed end
export const CAP_MAX_EXTRA_REACH_M = 30;  // reach extension cap beyond the box edge
export const ISLAND_Y = 0.0635;           // roundabout islands: above caps, below painted bands (0.065)

// Box-cap constants (issue #75). BOX_MARGIN_M: box lines sit this
// far past the nominal crossHalf edge, so corners are covered
// with slack and cap borders overlap the arm ribbons' mouths (the
// border treatment — no pale wedge can open between cap and bed).
// BOX_FURNITURE_REACH_M mirrors the furniture set-backs in
// taipei-markings.js (CROSSWALK_GAP 0.8 + CROSSWALK_DEPTH 3.2 +
// STOP_LINE_GAP 0.9 + STOP_LINE_W 0.4, + 0.4 slack = 5.7); it is
// kept local because taipei-markings imports THIS module.
export const BOX_MARGIN_M = 1.0;
export const BOX_FURNITURE_REACH_M = 5.7;
// Issue #81: the box cap's mouth (bed-end) slide is capped at
// crossHalf + this, NOT the fitted cap's crossHalf + 30
// (CAP_MAX_EXTRA_REACH_M, fitted construction unchanged): a
// through bed's far end (a divided boulevard passing a fragment
// cluster) sits 30+ m out and must not drag the box with it.
export const BOX_MOUTH_SLIDE_MAX_M = 20;
// Issue #81: a mouth is DISPLACED when its bed end sits more
// than this far past the box edge (sd − crossHalf). Displaced
// mouths are genuine second mouth lines (staggered carriageways,
// spread fragment clusters): their flare corners are collected
// from the mouth lines themselves. Undisplaced mouths take
// their corners from the box+margin lines only — corners taken
// at furniture/slide-inflated reaches were the slab spikes of
// the #81 report (a corner's distance scales multiplicatively
// with the reaches of the two lines that make it).
export const BOX_DISPLACED_MOUTH_M = 12;

const MAJOR_CLS = new Set(['arterial', 'deck']);
export const isMajorJunction = (j) =>
  !!j && Array.isArray(j.arms) && j.arms.some((a) => MAJOR_CLS.has(surfaceClass({ highway: a.highway })));

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

const ptsOf = (b) => {
  const p = [];
  for (let i = 0; i < b.pts.length; i += 2) p.push([b.pts[i], b.pts[i + 1]]);
  return p;
};
const round1 = (v) => Math.round(v * 10) / 10;
const ringOf = (pts) => pts.flatMap(([px, pz]) => [round1(px), round1(pz)]);

// ---------------------------------------------------------------------
// Roundabouts (issue #75): handcrafted sites, never generic caps.
//
// Ring sites are keyed by the OSM ring-carriageway name — the tile
// data names its circulating carriageways, which is the honest
// signal (same reasoning as the underpass name rule in
// taipei-surfaces.js). The centre and radii are FITTED from the
// ring beds' own geometry by radial ribbon coverage, so a data
// regen re-fits the same sites. 北門 has no ring-named beds — its
// circulation is a plaza loop — so its treatment is a fully
// handcrafted table entry: a plain asphalt disc over the gate
// junction apron plus a paved capsule island where the gate
// stands (the gate structure itself is landmark follow-up work).
// 南門圓環 exists in the data only as a degenerate zero-length
// stub — no circulating carriageway — so it is NOT a site (audit
// verdict in junction2-evidence/AUDIT.md).

export const ROUNDABOUT_RING_SITES = [
  { id: 'renai-dunhua', ringName: '仁愛敦南圓環', island: 'planted' },
  { id: 'dongmen', ringName: '東門圓環', island: 'planted' },
];

// 北門 (Cheng-en Gate), handcrafted. Centre = the gate's position
// (25.04774 N, 121.51133 E in the tile frame). The apron is an
// ELLIPSE fitted to the junction (a r=80 disc paved park corners
// and side streets — measured in the #75 work rasters): it spans
// the gate junction between 忠孝西路 (north), the gate link
// (east), the turnaround loop (south) and the plaza edge (west).
// The island is a capsule along the 忠孝西路 axis (axis = that
// road's heading at the gate, from its generated bed), sized to
// sit between those carriageways; its east kerb tucks over the
// gate link's first metres, the way the lane ends at the island
// in reality. The 博愛路/延平南路 knot 70 m south is a separate
// minor junction and keeps its fitted cap — it is not claimed.
export const BEIMEN_SITE = {
  id: 'beimen', island: 'plaza',
  x: -5418, z: -1614, discRx: 62, discRz: 44,
  islandCapsule: { x: -5412, z: -1622, axisX: -0.848, axisZ: -0.531, halfLen: 20, halfWid: 12 },
};

const discRing = (x, z, r, n) => {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([x + Math.cos(a) * r, z + Math.sin(a) * r]);
  }
  return pts;
};

const ellipseRing = (x, z, rx, rz, n) => {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([x + Math.cos(a) * rx, z + Math.sin(a) * rz]);
  }
  return pts;
};

function capsuleRing(c) {
  const pts = [];
  for (const s of [1, -1]) {
    const ex = c.x + c.axisX * c.halfLen * s, ez = c.z + c.axisZ * c.halfLen * s;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      pts.push([ex + Math.cos(a) * c.halfWid, ez + Math.sin(a) * c.halfWid]);
    }
  }
  return convexHull(pts);
}

// Radial ribbon coverage around (cx, cz): for radii in steps,
// the fraction of 72 rays whose point lies inside some carriageway
// ribbon. The annulus band of a ring site is the longest run of
// radii at >= 45% coverage.
function radialBand(roadbeds, cx, cz) {
  const polys = roadbeds.map(ribbonPoly);
  const grid = buildPolyGrid(polys);
  const RAYS = 72, STEP = 2, RMAX = 150;
  const cov = [];
  for (let r = STEP; r <= RMAX; r += STEP) {
    let hit = 0;
    for (let k = 0; k < RAYS; k++) {
      const a = (k / RAYS) * Math.PI * 2;
      if (pointInAnyPoly(grid, polys, [cx + Math.cos(a) * r, cz + Math.sin(a) * r])) hit++;
    }
    cov.push([r, hit / RAYS]);
  }
  let best = null, run = null;
  for (const [r, c] of cov) {
    if (c >= 0.45) { run = run || { start: r, end: r }; run.end = r; }
    else { if (run && (!best || run.end - run.start > best.end - best.start)) best = run; run = null; }
  }
  if (run && (!best || run.end - run.start > best.end - run.start)) best = run;
  return best; // { start, end } radii of the annulus band, or null
}

function fitRingSite(roadbeds, def) {
  const ringBeds = roadbeds.filter((b) => b.name === def.ringName);
  if (!ringBeds.length) return null;
  let verts = ringBeds.flatMap(ptsOf);
  let cx = verts.reduce((s, p) => s + p[0], 0) / verts.length;
  let cz = verts.reduce((s, p) => s + p[1], 0) / verts.length;
  // Trimmed-centroid fit: ring-named beds include entry flares
  // whose far vertices drag a plain centroid off the circle.
  for (let it = 0; it < 4; it++) {
    const ds = verts.map((p) => Math.hypot(p[0] - cx, p[1] - cz)).sort((a, b) => a - b);
    const med = ds[Math.floor(ds.length / 2)];
    const keep = verts.filter((p) => Math.hypot(p[0] - cx, p[1] - cz) <= Math.max(30, med * 1.5));
    if (keep.length < 8) break;
    cx = keep.reduce((s, p) => s + p[0], 0) / keep.length;
    cz = keep.reduce((s, p) => s + p[1], 0) / keep.length;
    verts = keep;
  }
  const band = radialBand(roadbeds, cx, cz);
  if (!band || band.end - band.start < 8) return null;
  return { cx, cz, islandR: Math.max(6, band.start - 1.0), discR: band.end + 2.0 };
}

const siteCache = new WeakMap();

// planRoundabouts(roadbeds, junctions) -> [{ id, x, z, discR,
// islandR, islandKind, ringName|null, disc: {ring, cls, area},
// island: {ring, kind}, aprons: [{x, z, r, ring}],
// claimedJunctions: [indices into the junctions array] }]
// A junction is claimed when its centre lies inside the site's
// disc (ellipse at 北門）, or — ring sites only — when any of its
// arms runs on the site's ring carriageway AND it sits within
// discR + 26 m of the centre (the ring name also runs on the
// outer frontage arc, whose junctions are ordinary and keep
// their caps). Claimed junctions at the disc's rim get a 12 m
// entry apron so their entry crosswalks land on asphalt.
export function planRoundabouts(roadbeds, junctions) {
  // Site geometry is fitted once per roadbeds array (the radial
  // fits are the only expensive part); claims are recomputed per
  // call since they index into the caller's junctions array.
  let raw = siteCache.get(roadbeds);
  if (!raw) {
    raw = [];
    for (const def of ROUNDABOUT_RING_SITES) {
      const fit = fitRingSite(roadbeds, def);
      if (!fit) continue;
      raw.push({
        id: def.id, ringName: def.ringName, islandKind: def.island,
        x: round1(fit.cx), z: round1(fit.cz), discR: round1(fit.discR), islandR: round1(fit.islandR),
        claimRx: fit.discR, claimRz: fit.discR,
        islandPts: discRing(fit.cx, fit.cz, fit.islandR, 48),
        discPts: discRing(fit.cx, fit.cz, fit.discR, 64),
      });
    }
    const b = BEIMEN_SITE;
    raw.push({
      id: b.id, ringName: null, islandKind: b.island,
      x: b.x, z: b.z, discR: Math.max(b.discRx, b.discRz), islandR: null,
      claimRx: b.discRx, claimRz: b.discRz,
      islandPts: capsuleRing(b.islandCapsule),
      discPts: ellipseRing(b.x, b.z, b.discRx, b.discRz, 64),
    });
    siteCache.set(roadbeds, raw);
  }
  return raw.map((s) => finishSite(s, roadbeds, junctions));
}

function claimsOf(s, roadbeds, junctions) {
  const out = [];
  (junctions || []).forEach((j, ji) => {
    const ex = (j.x - s.x) / s.claimRx, ez = (j.z - s.z) / s.claimRz;
    if (ex * ex + ez * ez <= 1) { out.push(ji); return; }
    // Ring-name arms claim only NEAR the circle: the ring name
    // also runs on the outer frontage arc (~90 m out at Renai),
    // whose junctions are ordinary street junctions and keep
    // their caps — the handcrafted treatment is for the
    // circulatory area and its immediate mouths.
    if (!s.ringName || !j.arms) return;
    if (Math.hypot(j.x - s.x, j.z - s.z) > s.discR + 26) return;
    if (j.arms.some((a) => (roadbeds[a.bed] || {}).name === s.ringName)) out.push(ji);
  });
  return out;
}

const APRON_R = 12;

function finishSite(s, roadbeds, junctions) {
  const claimed = claimsOf(s, roadbeds, junctions);
  // Disc tone: the widest arm across the claimed junctions owns
  // the apron; default arterial. Deliberately NOT the #91 blend:
  // the blend is a junction-cap treatment, and a roundabout's arms
  // are the ring itself — near-uniform around the disc, whose
  // centre the island covers — so no clash arises here (the 北門
  // disc in the #91 evaluation renders identically under every
  // candidate rule).
  let cls = 'arterial', widest = null;
  for (const ji of claimed) for (const a of junctions[ji].arms || [])
    if (!widest || a.width > widest.width) widest = a;
  if (widest) cls = surfaceClass({ highway: widest.highway });
  // Entry aprons: a claimed junction whose centre pokes past the
  // disc leaves a bare wedge between the entry bed's end and the
  // disc edge — exactly where its entry crosswalk lands (the
  // Renai NE mouth measured 21 stripe centres up to 2.7 m off
  // asphalt). A 12 m disc at the junction centre paves the flare,
  // same tone as the site disc.
  const aprons = [];
  for (const ji of claimed) {
    const j = junctions[ji];
    // Only junctions at the disc's rim (or beyond it) leave a
    // wedge; a junction ON the ring band is already paved by
    // the disc itself.
    if (Math.hypot(j.x - s.x, j.z - s.z) > s.discR - 6)
      aprons.push({ x: round1(j.x), z: round1(j.z), r: APRON_R, ring: ringOf(discRing(j.x, j.z, APRON_R, 32)) });
  }
  return {
    id: s.id, x: s.x, z: s.z, discR: s.discR, islandR: s.islandR, islandKind: s.islandKind,
    ringName: s.ringName, claimedJunctions: claimed, aprons,
    disc: { ring: ringOf(s.discPts), cls, area: Math.round(polyArea(s.discPts)) },
    island: { ring: ringOf(s.islandPts), kind: s.islandKind },
  };
}

// ---------------------------------------------------------------------
// Caps.

// The fitted #66 cap for one junction (minor class, unchanged).
function fittedRing(j) {
  const corners = [];
  for (const a of j.arms) {
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
    // at the junction fringe (measured on #66 data: junction #3's
    // unnamed fragment arm, end 4+ m outside its cap).
    corners.push([a.endX, a.endZ]);
  }
  return convexHull(corners);
}

// The box cap for one major junction (issue #75): cross-section
// lines at reach_a (see header), corners from adjacent arms' line
// intersections, hull of corners + cross-section endpoints. The
// segment endpoints alone close the polygon where lines are
// parallel or the angular gap is reflex (T mouths, bends).
//
// Issue #81 re-split the collection into three passes. The #75
// construction ran its corners on the EXTENDED lines (mouth slide
// to crossHalf + 30, furniture reach on signalized junctions) —
// and at skewed/multi-arm fragment junctions EVERY hull vertex
// came from that pass: a corner's distance from the junction
// scales multiplicatively with the reach of the two lines that
// make it, so the extended corners (and the +30 slide's segment
// endpoints) paved rotated slabs up to 4.5× the pure box hull,
// 30–53 m out over blocks and park corners. Now:
//   pure    — crossHalf lines, segments + corners (the box);
//   margin  — crossHalf + BOX_MARGIN_M lines, segments + corners
//             (the default corner source);
//   mouth   — SEGMENTS ONLY at the furniture/bed-end reach
//             (slide capped at crossHalf + BOX_MOUTH_SLIDE_MAX_M):
//             the cap's edges still meet staggered mouths and
//             keep the furniture strip along each mouth, but no
//             segment endpoint is dragged 30 m down a through
//             boulevard either;
//   displaced-mouth supplement — for an arm pair where a mouth
//             is genuinely displaced (bed end > BOX_DISPLACED_
//             MOUTH_M past the box edge), the pair's corners are
//             ALSO collected from the mouth lines: the flare
//             between a far mouth and its neighbour is real
//             junction ground (基隆路×永吉路's 東興路 mouth),
//             while undisplaced pairs never see inflated lines.
function boxRing(j) {
  const arms = [...j.arms].sort((a, b) => Math.atan2(a.dirZ, a.dirX) - Math.atan2(b.dirZ, b.dirX));
  const lineOf = (a, reach) => ({ px: j.x + a.dirX * reach, pz: j.z + a.dirZ * reach, nx: -a.dirZ, nz: a.dirX });
  const reachOf = (a, slideCap, furniture) => {
    let reach = a.crossHalf + BOX_MARGIN_M;
    const sd = (a.endX - j.x) * a.dirX + (a.endZ - j.z) * a.dirZ;
    if (sd > 0) reach = Math.max(reach, Math.min(sd + CAP_END_OVERLAP_M, a.crossHalf + slideCap));
    if (furniture && j.signalized) reach = Math.max(reach, a.crossHalf + BOX_FURNITURE_REACH_M);
    return reach;
  };
  const pts = [];
  const mkLines = (reachFn) => arms.map((a) => {
    const reach = reachFn(a);
    return { a, reach, ...lineOf(a, reach) };
  });
  const lines = mkLines((a) => reachOf(a, BOX_MOUTH_SLIDE_MAX_M, true));
  const maxR = Math.max(...lines.map((l) => l.reach + l.a.width / 2));
  // A corner must be LOCAL to the mouth it closes: within
  // (hA+hB)/sin(gap)+6 of one of the two arms' segment ends.
  // Fragment arms otherwise throw line intersections tens of
  // metres away (a 3.2 m sliver's edge line meeting a wide arm's
  // cross line 48 m south at 忠孝×中山) and the "box" stops
  // being the junction.
  const local = (p, A, B, gap) => {
    const bound = (A.a.width / 2 + BOX_MARGIN_M + B.a.width / 2 + BOX_MARGIN_M) / Math.sin(gap) + 6;
    const ends = [
      [A.px + A.nx * (A.a.width / 2 + BOX_MARGIN_M), A.pz + A.nz * (A.a.width / 2 + BOX_MARGIN_M)],
      [A.px - A.nx * (A.a.width / 2 + BOX_MARGIN_M), A.pz - A.nz * (A.a.width / 2 + BOX_MARGIN_M)],
      [B.px + B.nx * (B.a.width / 2 + BOX_MARGIN_M), B.pz + B.nz * (B.a.width / 2 + BOX_MARGIN_M)],
      [B.px - B.nx * (B.a.width / 2 + BOX_MARGIN_M), B.pz - B.nz * (B.a.width / 2 + BOX_MARGIN_M)],
    ];
    return Math.min(...ends.map((e) => Math.hypot(p[0] - e[0], p[1] - e[1]))) <= bound;
  };
  const sane = (p, A, B, gap) =>
    Math.hypot(p[0] - j.x, p[1] - j.z) <= maxR + 45 &&
    (p[0] - j.x) * A.a.dirX + (p[1] - j.z) * A.a.dirZ >= A.a.crossHalf - 0.01 &&
    (p[0] - j.x) * B.a.dirX + (p[1] - j.z) * B.a.dirZ >= B.a.crossHalf - 0.01 &&
    local(p, A, B, gap);
  // The main + edge corners of one adjacent arm pair, from the
  // pair's line objects (any pass's lines).
  const collectPair = (A, B, edgeHalf) => {
    {
      let gap = Math.atan2(B.a.dirZ, B.a.dirX) - Math.atan2(A.a.dirZ, A.a.dirX);
      if (gap <= 0) gap += Math.PI * 2;
      // Corners exist only where two arms actually CROSS: the
      // same 35° floor the crossHalf arithmetic uses (below it
      // the arms are one corridor and near-parallel line
      // intersections fly tens of metres off the junction — the
      // #75 audit's false corners at ramp merges), and the 170°
      // ceiling leaves reflex gaps (T mouths) to the segment
      // endpoints.
      if (gap < (35 * Math.PI) / 180 || gap > (170 * Math.PI) / 180) return;
      const det = A.nx * B.nz - A.nz * B.nx;
      if (Math.abs(det) >= 1e-6) {
        const t = ((B.px - A.px) * B.nz - (B.pz - A.pz) * B.nx) / det;
        const p = [A.px + A.nx * t, A.pz + A.nz * t];
        // Acceptance is judged against the arms' crossHalf (the
        // pure box), not the extended reach: a corner inside the
        // cap's own reach along one arm still belongs to the
        // hull when it closes the box along the other.
        if (sane(p, A, B, gap)) pts.push(p);
      }
      // Edge corners: each arm's cross-section EXTENDED to the
      // box edge (the brief's construction) — the intersection
      // of one arm's lateral edge line with the other's
      // cross-section line. Without them the hull chord between
      // two cross-section ends cuts the mouth corner where the
      // arm's own edge runs — the #75 audit's missing corners
      // and off-cap crosswalk stripes at skewed mouths live
      // exactly there. B is CCW from A, so the shared side is
      // +n on A and −n on B.
      const edgeCorner = (edge, cross, hEdge, hCross) => {
        // edge: {px, pz (point on the edge line), dx, dz (along
        // the arm)}, cross: {px, pz, nx, nz (cross-section line)}.
        const d = edge.dx * cross.nz - edge.dz * cross.nx;
        if (Math.abs(d) < 0.05) return; // near-parallel: the main corner already closes this side
        const t = ((cross.px - edge.px) * cross.nz - (cross.pz - edge.pz) * cross.nx) / d;
        // The edge line may run at most one cross-arm
        // half-width (+slack) past its own segment end: beyond
        // that the "corner" is the crossing arm's own mouth,
        // already paved by its ribbon and segment — thin
        // diagonal fragments otherwise throw corners ~19 m down
        // the crossing street (仁愛×復興 SW fragment, #75
        // audit).
        if (t < -1 || t > hCross + 6) return;
        const p = [edge.px + edge.dx * t, edge.pz + edge.dz * t];
        // And the point must stay within the cross arm's own
        // mouth span (+slack): past it, the "corner" is the
        // edge line crossing the cross-section LINE extended
        // sideways — a phantom (the kerb actually turns at the
        // cross arm's own edge, which the other edge corner /
        // main corner already close). 信義×松仁's west edge
        // corners sat 21–25 m along the cross line, outside
        // the cap by 6–10 m.
        const s = (p[0] - cross.px) * cross.nx + (p[1] - cross.pz) * cross.nz;
        if (Math.abs(s) > hCross + 6) return;
        if (sane(p, A, B, gap)) pts.push(p);
      };
      const hA = edgeHalf(A.a), hB = edgeHalf(B.a);
      edgeCorner(
        { px: A.px + A.nx * hA, pz: A.pz + A.nz * hA, dx: A.a.dirX, dz: A.a.dirZ },
        { px: B.px, pz: B.pz, nx: B.nx, nz: B.nz },
        hA, hB,
      );
      edgeCorner(
        { px: B.px - B.nx * hB, pz: B.pz - B.nz * hB, dx: B.a.dirX, dz: B.a.dirZ },
        { px: A.px, pz: A.pz, nx: A.nx, nz: A.nz },
        hB, hA,
      );
    }
  };
  // One pass over a line set: segment endpoints (widened by the
  // margin), plus main/edge corners when `withCorners`. The pure
  // pass's gates accept everything the audit accepts, so the
  // cap's input set contains the box's input set and hull
  // monotonicity gives cap ⊇ box BY CONSTRUCTION — the #75
  // audit's corner invariant.
  const collect = (ls, edgeHalf, withCorners) => {
    for (const L of ls) {
      const h = L.a.width / 2 + BOX_MARGIN_M;
      pts.push([L.px + L.nx * h, L.pz + L.nz * h]);
      pts.push([L.px - L.nx * h, L.pz - L.nz * h]);
    }
    if (withCorners) for (let i = 0; i < ls.length; i++)
      collectPair(ls[i], ls[(i + 1) % ls.length], edgeHalf);
  };
  collect(lines, (a) => a.width / 2 + BOX_MARGIN_M, false);
  collect(mkLines((a) => a.crossHalf + BOX_MARGIN_M), (a) => a.width / 2 + BOX_MARGIN_M, true);
  collect(mkLines((a) => a.crossHalf), (a) => a.width / 2, true);
  // Displaced-mouth supplement (issue #81): where a mouth is
  // genuinely displaced (its bed end sits > BOX_DISPLACED_MOUTH_M
  // past the box edge), the flare corner between it and its
  // neighbour is paved at the mouth lines themselves — the box
  // lines would leave the far mouth's furniture strip on bare
  // ground (基隆路一段×永吉路： 東興路's mouth sits 15 m past
  // the box; its stop line stands in exactly that flare).
  const displaced = (a) => {
    const sd = (a.endX - j.x) * a.dirX + (a.endZ - j.z) * a.dirZ;
    return sd - a.crossHalf > BOX_DISPLACED_MOUTH_M;
  };
  for (let i = 0; i < arms.length; i++) {
    if (!displaced(arms[i]) && !displaced(arms[(i + 1) % arms.length])) continue;
    collectPair(lines[i], lines[(i + 1) % lines.length], (a) => a.width / 2 + BOX_MARGIN_M);
  }
  // The junction centre itself is junction ground by definition;
  // at fragment clusters it can sit outside the cross-section
  // hull (all arms to one side), so pin it explicitly.
  pts.push([j.x, j.z]);
  return convexHull(pts);
}

// ---------------------------------------------------------------------
// Cap tones (issue #91): per-vertex blend of the incident arms.
//
// Each cap carries `tones`: { centre, origin, ring } — sRGB
// [r, g, b] triples in 0..1. `ring` aligns with the cap's ring
// points; `centre` is the tone at `origin`, the fan centre the
// renderer triangulates from. The tone at a point is the arms'
// SURFACE_TONES entries weighted by arm width and an angular
// kernel around the point's direction from the junction centre:
// a vertex sitting at an arm's mouth (its angle ≈ the arm's
// direction, where the hull vertices live) takes that arm's tone
// almost purely; a corner between two arms mixes the two
// neighbours; the centre mixes all arms by width. The kernel
// cos^12 falls fast (a vertex 45° from an arm keeps under 2% of
// it) yet keeps width in play at mid angles, and it is steep
// enough that a vertex at a narrow arm's own mouth — within
// ~13° of its axis — is owned by that arm even against a 5×
// width disadvantage (measured on the synthetic 30 m arterial ×
// 6 m lane junction in tests/taipei-captone.test.mjs): narrow
// lane mouths lose their seam too, not just wide-road mouths.
// The result is a pure function of the arms and the ring
// (deterministic, no iteration state), applies to box and fitted
// caps alike, and is a convex combination — every component
// stays inside the arms' tone envelope.
//
// origin is the junction centre when it lies inside the ring
// (all but a handful of ramp-cluster caps), else the ring's
// centroid, which a convex ring always contains — the renderer's
// fan must start inside the polygon it fans.

export const CAP_BLEND_KERNEL = 12;

const toneRGB = (cls) => {
  const t = SURFACE_TONES[cls];
  return [((t >> 16) & 255) / 255, ((t >> 8) & 255) / 255, (t & 255) / 255];
};
const round4 = (v) => Math.round(v * 10000) / 10000;

export function capBlendTones(j, ringPts) {
  const arms = j.arms.map((a) => ({
    width: a.width,
    ang: Math.atan2(a.dirZ, a.dirX),
    rgb: toneRGB(surfaceClass({ highway: a.highway })),
  }));
  const totW = arms.reduce((s, a) => s + a.width, 0) || 1;
  const centre = [0, 1, 2].map((k) => round4(arms.reduce((s, a) => s + a.width * a.rgb[k], 0) / totW));
  const at = (px, pz) => {
    const th = Math.atan2(pz - j.z, px - j.x);
    let den = 0;
    const num = [0, 0, 0];
    for (const a of arms) {
      const d = Math.cos(th - a.ang);
      if (d <= 0) continue;
      const w = a.width * Math.pow(d, CAP_BLEND_KERNEL);
      den += w;
      for (let k = 0; k < 3; k++) num[k] += w * a.rgb[k];
    }
    if (den < 1e-9) return centre;
    return num.map((v) => round4(v / den));
  };
  const origin = pointInPoly([j.x, j.z], ringPts)
    ? [j.x, j.z]
    : [
        ringPts.reduce((s, p) => s + p[0], 0) / ringPts.length,
        ringPts.reduce((s, p) => s + p[1], 0) / ringPts.length,
      ];
  return { centre, origin, ring: ringPts.map(([px, pz]) => at(px, pz)) };
}

// planJunctionCaps(roadbeds, junctions, sitesIn?) -> [{ x, z,
// ring, radius, cls, tones, arms, signalized, area, kind }]
// junctions: detectJunctions() output (js/taipei-markings.js) — the
// caller detects once and shares the result with the markings
// builder. One cap per detected junction with >= 2 arms that no
// roundabout site claims. kind is 'box' for major junctions,
// 'fitted' for minor ones. ring is a flat [x, z, …] array in hull
// order; cls is the surfaceClass of the widest incident arm
// (census/metadata — the rendered tone is `tones`, the per-vertex
// blend above).
export function planJunctionCaps(roadbeds, junctions, sitesIn = null) {
  const sites = sitesIn || planRoundabouts(roadbeds, junctions);
  const claimed = new Set(sites.flatMap((s) => s.claimedJunctions));
  const caps = [];
  (junctions || []).forEach((j, ji) => {
    if (!j.arms || j.arms.length < 2) return;
    if (claimed.has(ji)) return;
    const kind = isMajorJunction(j) ? 'box' : 'fitted';
    const hull = kind === 'box' ? boxRing(j) : fittedRing(j);
    if (hull.length < 3) return;
    const area = polyArea(hull);
    if (!(area > 1)) return;
    let radius = 0;
    for (const [px, pz] of hull) radius = Math.max(radius, Math.hypot(px - j.x, pz - j.z));
    let widest = j.arms[0];
    for (const a of j.arms) if (a.width > widest.width) widest = a;
    const ring = ringOf(hull);
    const ringPts = [];
    for (let i = 0; i + 1 < ring.length; i += 2) ringPts.push([ring[i], ring[i + 1]]);
    caps.push({
      x: j.x, z: j.z,
      ring,
      radius: Math.round(radius * 10) / 10,
      cls: surfaceClass({ highway: widest.highway }),
      tones: capBlendTones(j, ringPts),
      arms: j.arms.length,
      signalized: !!j.signalized,
      area: Math.round(area),
      kind,
    });
  });
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
