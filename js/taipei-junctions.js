// js/taipei-junctions.js — junction caps for the Taipei tile
// (issues #66, #75, #81, #145): paved treatment per detected
// junction. Since #145 ONE construction serves every junction —
// the OVERLAP cap: the polygon of the arms' own crossing
// geometry, nothing beyond it.
//
//   The base is the junction BOX of the #75 audit: each arm's
//   cross-section line at reach = crossHalf (the widest crossing
//   arm's half width), corners from adjacent arms' line
//   intersections (main + edge corners, locality-gated), the
//   polygon the convex hull of corners + cross-section segment
//   endpoints + the junction centre. At a main x main crossing
//   that is exactly the clean rectangle of the two road widths
//   (a parallelogram at skewed crossings); at a T it is the
//   strip where the minor arm meets the main road — the minor
//   ribbon stops at the main road's edge line and the main road
//   runs straight through (the user's rules, issue #145).
//
//   On top of the box, MAJOR junctions (any arm arterial/deck
//   class) and signalized minor junctions add MOUTH SEGMENTS
//   ONLY: each arm's cross-section endpoints pushed out to the
//   mouth reach (the bed-end slide, capped at crossHalf +
//   BOX_MOUTH_SLIDE_MAX_M; on signalized junctions at least the
//   furniture reach, so the junction's own crosswalks and stop
//   lines — placed by the same crossHalf arithmetic in
//   taipei-markings.js — sit on the cap or on the arm's ribbon,
//   never on bare ground). No corner is ever taken from an
//   extended line: a corner's distance scales multiplicatively
//   with the reaches of the two lines that make it (the #81
//   slab spikes), and the #145 census showed the flares the
//   extended corners paved are corner-block ground, not
//   carriageway. What the pre-#145 constructions paved past
//   the overlap — the #66 fitted hulls over scattered bed ends
//   (discs to 105 m radius over alley webs), the #75/#81
//   margin-line corners and displaced-mouth flares (the #134
//   census's >25 m offenders, worst vertex 38.4 m past its
//   box) — is gone: total cap area 1,028,652 -> 703,160 m²,
//   worst vertex past its box 20.1 m (a mouth segment endpoint
//   on its own arm), corner overshoot at the named offenders
//   zero. `kind` still records the junction class ('box'
//   major, 'fitted' minor) for the census and the boot log;
//   the construction no longer differs by it.
//
//   Issue #163 (junction fix v2) adds ONE thing to the fitted
//   class: ARM EXTENSION STRIPS (armExtension below). The #145
//   overlap rule is exact where beds physically meet, but OSM
//   beds are finite — tile-wide 54% of cap arms end more than
//   2 m short of their box edge (71% of street arms at divided
//   junctions), and the ground between a short bed end and the
//   box edge was left bare (the user's regression: median
//   strips and lane dashes crossing a pale patch at 民生東路三段
//   × 127/140巷）. The user's approved rule (junction-poc2) is
//   to extend each arm's ribbon along its own direction to the
//   box edge and take the junction surface from the EXTENDED
//   ribbons. A strip is that extension for one arm — its own
//   bed end, direction and width, reaching exactly the box
//   edge and never past it (a minor's extension stops at the
//   major's kerb: no tongue). Box caps are untouched: majors'
//   mouth segments already slide to their bed ends.
//
//   Issue #171 (cap outline discipline — the #169 sweep's
//   WEB / TONGUE / SPIKE classes) adds three geometry rules
//   on top of the #168 construction, all inside this module:
//     - A pair's MAIN corner is kept only while it lies on
//       the two arms' own carriageway strips (lateral offset
//       within either arm's half width +
//       MAIN_CORNER_STRIP_TOL_M). Past that it is a fan
//       vertex over the corner plot (WEB) or, at near-reflex
//       pairs whose cross lines run near-parallel, a spike
//       tens of metres long (SPIKE, ji2643); the hull falls
//       back to the pair's edge corner, the honest bend
//       corner.
//     - When the caller passes the GREEN layer
//       (capClipPolys), rings and strips are cut against it
//       — with each green polygon first eroded by the
//       junction's own corridor union, because the land
//       data runs beneath the carriageways themselves (see
//       planJunctionCaps).
//     - An arm strip that crosses a FOREIGN carriageway and
//       leaves it for bare plot stops at that road's far
//       kerb (TONGUE, ji394).
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
// the median strips at 0.062). The RENDERED tone is ONE tone per
// junction — the width-weighted mean of the incident arms'
// surface tones — shared flat by the ring, the #171 clipped
// pieces and the #163 strips alike (issue #172, see capBlendTones
// below). Issue #91's per-vertex angular blend met every arm in
// its own tone, but each piece fans from its own origin, so the
// same field interpolated differently per piece and a mixed
// junction rendered as 3-5 stepped grey plates (the #169 sweep's
// SEAM class; a fan-exact probe measured up to 90 distinct tones
// and a full arterial<->lane luminance spread inside one
// surface). A constant is the only field every triangulation
// agrees on everywhere. `cls` still records the widest arm's
// class (the census / audit metadata it has always been); it no
// longer colours the cap. They are also the hard occluder for the painted layers: taipei-painted,
// taipei-surfaces (medians) and taipei-markings (dashes) take the
// cap polygons and drop any band / strip / dash quad whose centre
// lands inside one, so no paint crosses a junction core.
// Crosswalk stripes and stop lines are exempt by design — they
// are junction furniture placed by the same crossHalf arithmetic;
// the mouth segments above keep them on the cap itself or on the
// arm's own ribbon at the junctions that carry them.

import { surfaceClass, SURFACE_TONES } from './taipei-surfaces.js';
import { ribbonPoly, buildPolyGrid, pointInAnyPoly, pointInPoly } from './taipei-painted.js';

export const CAP_Y = 0.061;               // between carriageways (0.06) and medians (0.062)
export const CAP_END_OVERLAP_M = 1.5;     // mouth segments reach this far past an arm's bed end
export const ISLAND_Y = 0.0635;           // roundabout islands: above caps, below painted bands (0.065)

// Overlap-cap constants. BOX_MARGIN_M: a mouth cross-section
// sits this far past its nominal reach and widens by it, so the
// cap's mouth edge overlaps the arm ribbon's mouth (the border
// treatment — no pale wedge can open between cap and bed).
// BOX_FURNITURE_REACH_M mirrors the furniture set-backs in
// taipei-markings.js (CROSSWALK_GAP 0.8 + CROSSWALK_DEPTH 3.2 +
// STOP_LINE_GAP 0.9 + STOP_LINE_W 0.4, + 0.4 slack = 5.7); it is
// kept local because taipei-markings imports THIS module.
export const BOX_MARGIN_M = 1.0;
export const BOX_FURNITURE_REACH_M = 5.7;
// Issue #171: a pair's main corner (cross-section line
// intersection) is a junction-box corner only within this
// tolerance past either arm's own segment end along its cross
// line — i.e. while it still lies on the two carriageways'
// overlap. Past it the "corner" is a fan vertex over the
// corner plot (the #169 sweep's WEB class) or, at near-reflex
// pairs whose lines run near-parallel, a spike (SPIKE class).
export const MAIN_CORNER_STRIP_TOL_M = 1.0;
// The mouth (bed-end) slide is capped at crossHalf + this: a
// through bed's far end (a divided boulevard passing a fragment
// cluster) sits 30+ m out and must not drag the cap with it.
export const BOX_MOUTH_SLIDE_MAX_M = 20;

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

// The overlap cap for one junction (issue #145): the junction
// BOX (cross-section lines at crossHalf, corners from adjacent
// arms' line intersections, segment endpoints where lines are
// parallel or the angular gap is reflex — T mouths, bends), plus
// — at major junctions and signalized minors — MOUTH SEGMENTS
// ONLY at the mouth reach, plus the junction centre. One
// construction for every junction; this function IS the box the
// #75 audit spec (mirrored in tests/taipei-junctions.test.mjs)
// measures coverage against.
function overlapRing(j) {
  const arms = [...j.arms].sort((a, b) => Math.atan2(a.dirZ, a.dirX) - Math.atan2(b.dirZ, b.dirX));
  const lineOf = (a) => ({ a, px: j.x + a.dirX * a.crossHalf, pz: j.z + a.dirZ * a.crossHalf, nx: -a.dirZ, nz: a.dirX });
  const lines = arms.map(lineOf);
  const pts = [];
  for (const L of lines) {
    const h = L.a.width / 2;
    pts.push([L.px + L.nx * h, L.pz + L.nz * h]);
    pts.push([L.px - L.nx * h, L.pz - L.nz * h]);
  }
  const maxR = Math.max(...arms.map((a) => a.crossHalf + a.width / 2));
  // A corner must be LOCAL to the mouth it closes: within
  // (hA+hB)/sin(gap)+6 of one of the two arms' segment ends.
  // Fragment arms otherwise throw line intersections tens of
  // metres away (a 3.2 m sliver's edge line meeting a wide arm's
  // cross line 48 m south at 忠孝×中山) and the "box" stops
  // being the junction.
  const local = (p, A, B, gap) => {
    const bound = (A.a.width / 2 + B.a.width / 2) / Math.sin(gap) + 6;
    const ends = [
      [A.px + A.nx * (A.a.width / 2), A.pz + A.nz * (A.a.width / 2)],
      [A.px - A.nx * (A.a.width / 2), A.pz - A.nz * (A.a.width / 2)],
      [B.px + B.nx * (B.a.width / 2), B.pz + B.nz * (B.a.width / 2)],
      [B.px - B.nx * (B.a.width / 2), B.pz - B.nz * (B.a.width / 2)],
    ];
    return Math.min(...ends.map((e) => Math.hypot(p[0] - e[0], p[1] - e[1]))) <= bound;
  };
  const sane = (p, A, B, gap) =>
    Math.hypot(p[0] - j.x, p[1] - j.z) <= maxR + 45 &&
    (p[0] - j.x) * A.a.dirX + (p[1] - j.z) * A.a.dirZ >= A.a.crossHalf - 0.01 &&
    (p[0] - j.x) * B.a.dirX + (p[1] - j.z) * B.a.dirZ >= B.a.crossHalf - 0.01 &&
    local(p, A, B, gap);
  // The main + edge corners of one adjacent arm pair, from the
  // pair's BOX lines (never an extended line — see the header).
  const collectPair = (A, B) => {
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
        // Issue #171 (WEB/SPIKE): the main corner is a box
        // corner only where it lies on the crossing geometry
        // itself — within BOTH arms' carriageway strips (its
        // lateral offset from each arm's axis no more than that
        // arm's half width + the corner tolerance). Where the
        // two cross-section LINES meet outside both strips —
        // the outside of a bend (gap > 90°: the lines diverge
        // past the arms' edges) or a near-reflex pair (gap ->
        // 170°: the lines run near-parallel and their meeting
        // flies tens of metres out) — the point is a fan/spike
        // vertex over the corner plot, not carriageway: the
        // POC rule paves the arm corridors + the two ribbons'
        // overlap, nothing more. The pair's EDGE corners (the
        // kerb turn where one arm's edge meets the other's
        // cross line, gated local below) still close the mouth;
        // the hull falls back to them and the segment ends.
        const sA = (p[0] - j.x) * A.nx + (p[1] - j.z) * A.nz;
        const sB = (p[0] - j.x) * B.nx + (p[1] - j.z) * B.nz;
        if (Math.abs(sA) <= A.a.width / 2 + MAIN_CORNER_STRIP_TOL_M &&
            Math.abs(sB) <= B.a.width / 2 + MAIN_CORNER_STRIP_TOL_M &&
            sane(p, A, B, gap)) pts.push(p);
      }
      // Edge corners: each arm's cross-section EXTENDED to the
      // box edge — the intersection of one arm's lateral edge
      // line with the other's cross-section line. Without them
      // the hull chord between two cross-section ends cuts the
      // mouth corner where the arm's own edge runs — the #75
      // audit's missing corners and off-cap crosswalk stripes
      // at skewed mouths live exactly there. B is CCW from A,
      // so the shared side is +n on A and −n on B.
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
      const hA = A.a.width / 2, hB = B.a.width / 2;
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
  for (let i = 0; i < lines.length; i++)
    collectPair(lines[i], lines[(i + 1) % lines.length]);
  // Mouth segments (major junctions + signalized minors): the
  // cross-section endpoints pushed out to the mouth reach —
  // the bed-end slide (a staggered mouth's furniture stands on
  // its own arm past the box edge), and on signalized junctions
  // at least the furniture reach — widened by the margin. They
  // contribute NO corners: the hull edges between a mouth
  // segment and its neighbouring box corners run along the
  // arm's own mouth, which is carriageway or kerb corner in
  // reality, never a diagonal slab across the block.
  if (isMajorJunction(j) || j.signalized) {
    for (const a of arms) {
      let reach = a.crossHalf + BOX_MARGIN_M;
      const sd = (a.endX - j.x) * a.dirX + (a.endZ - j.z) * a.dirZ;
      if (sd > 0) reach = Math.max(reach, Math.min(sd + CAP_END_OVERLAP_M, a.crossHalf + BOX_MOUTH_SLIDE_MAX_M));
      if (j.signalized) reach = Math.max(reach, a.crossHalf + BOX_FURNITURE_REACH_M);
      const nx = -a.dirZ, nz = a.dirX, half = a.width / 2 + BOX_MARGIN_M;
      const px = j.x + a.dirX * reach, pz = j.z + a.dirZ * reach;
      pts.push([px + nx * half, pz + nz * half]);
      pts.push([px - nx * half, pz - nz * half]);
    }
  }
  // The junction centre itself is junction ground by definition;
  // at fragment clusters it can sit outside the cross-section
  // hull (all arms to one side), so pin it explicitly.
  pts.push([j.x, j.z]);
  return convexHull(pts);
}

// Each cap carries `tones`: { centre, origin, ring } — sRGB
// [r, g, b] triples in 0..1. `ring` aligns with the cap's ring
// points; `centre` is the tone at `origin`, the fan centre the
// renderer triangulates from.
//
// Issue #172 — ONE asphalt voice per junction. The tone rule is:
// the junction tone = the arms' SURFACE_TONES entries weighted
// by arm width (the width-weighted mean — the value #91 computed
// for the centre), and EVERY vertex of EVERY piece of the
// junction — ring, #171 clipped pieces, #163 strips — carries
// exactly that tone. #91's angular-kernel field (cos^12 around
// the point's direction, mouths taking their arm's tone) made
// each piece fan interpolate the same field through a different
// triangulation, so overlaps and joins stepped plate-to-plate:
// the #169 sweep's SEAM class. The fan-exact probe in
// seam172-evidence (28 stratified junctions) measured the field
// before this change at 14-90 distinct tones per mixed surface,
// luminance ranges up to the full arterial<->lane spread (0.068)
// and 75-93% of samples off the modal tone; the real-boot pixel
// probe found 2-4 tone clusters per mixed junction.
// Single-class junctions were already flat under both probes,
// so the fix is scoped to this field, not to any construction
// subset. A flat tone is tessellation-proof by construction:
// any fan of a constant is the constant, so ring, pieces and
// strips agree at every point, and at a single-class junction
// the tone equals the arm ribbons' exactly (no boundary step at
// all). At a mixed junction each mouth steps once, cleanly, from
// its ribbon to the shared tone — bounded by the arms' own
// spread and weighted toward the wide arms that dominate the
// junction visually. The blend #91 wanted at the boundary
// survives only in that choice of value, not as an in-surface
// gradient.
//
// The result is a pure function of the arms and the ring
// (deterministic, no iteration state), applies to box and fitted
// caps alike, and is a convex combination — every component
// stays inside the arms' tone envelope.
//
// origin is the junction centre when it lies inside the ring
// (all but a handful of ramp-cluster caps), else the ring's
// centroid, which a convex ring always contains — the renderer's
// fan must start inside the polygon it fans.

const toneRGB = (cls) => {
  const t = SURFACE_TONES[cls];
  return [((t >> 16) & 255) / 255, ((t >> 8) & 255) / 255, (t & 255) / 255];
};
const round4 = (v) => Math.round(v * 10000) / 10000;

export function capBlendTones(j, ringPts) {
  const arms = j.arms.map((a) => ({
    width: a.width,
    rgb: toneRGB(surfaceClass({ highway: a.highway })),
  }));
  const totW = arms.reduce((s, a) => s + a.width, 0) || 1;
  const centre = [0, 1, 2].map((k) => round4(arms.reduce((s, a) => s + a.width * a.rgb[k], 0) / totW));
  const origin = pointInPoly([j.x, j.z], ringPts)
    ? [j.x, j.z]
    : [
        ringPts.reduce((s, p) => s + p[0], 0) / ringPts.length,
        ringPts.reduce((s, p) => s + p[1], 0) / ringPts.length,
      ];
  return { centre, origin, ring: ringPts.map(() => centre) };
}

// ---------------------------------------------------------------------
// Issue #163: arm extension strips (fitted caps only).
//
// armExtension(j, a, roadbeds) -> { pts, area, origin } | null.
// An arm needs a strip when its bed END falls short of the
// junction box: the end sits FARTHER from the centre than the
// box edge on its side (sd > crossHalf — the ribbon stops
// before it reaches the junction, the specimen being ji562's
// avenue arms at sd 9.0/16.1 m against a 1.6 m box edge: a
// 25 m band of avenue corridor paved by neither ribbon nor
// ring). The strip is the arm's own corridor across that gap:
// anchored ON the bed end point (so it continues the ribbon
// exactly, lateral offset and all), following the bed's own
// initial chord direction (the same 12 m chord the arm
// direction is measured on in detectJunctions), at the arm's
// own width, running INWARD from the bed end to the box edge
// and tucking EXT_PAST_BOX_M past it, under the ring — the
// strip stops at the box: it never crosses the junction, so a
// minor's extension never tongues into the major's
// carriageway (junction-poc2 rule 3); the crossing road's own
// surface (ring, its ribbons, its strips) paves the rest.
// Behind the bed end the strip overlaps the ribbon butt by
// EXT_JOIN_M and widens by the same per side, so no seam or
// pale wedge can open at the join; the overlaps sit 0.5 mm
// under the box ring at render (boot), so they never z-fight
// the ring, and overlapping strips of one junction share that
// junction's single tone field (capBlendTones is a pure
// function of position), so a strip crossing a wider arm's
// strip in a corner quadrant blends to the same colour from
// either layer.
//
// Returns null when there is nothing to pave: the ribbon
// already reaches into the box (sd <= crossHalf + EXT_MIN_GAP_M
// — a through bed, a bed end inside the box range, or the
// butt's own rounding), or the gap is past EXT_STRIP_MAX_M.
// The cap is the honesty bound: a bed end scattered further
// than that from its box is a fragment of the 40 m cluster
// merge, not this junction's mouth (ji273's warren arms sit
// at sd up to 71 m) — it gets NO strip and NO slab, and the
// census counts the skips so the uncovered remainder is a
// measured number. A bed that leaves its own junction
// backwards (chord direction against the arm axis) is
// likewise not a mouth.
export const EXT_STRIP_MAX_M = 30;
export const EXT_MIN_GAP_M = 0.3;
const EXT_JOIN_M = 0.5;
const EXT_PAST_BOX_M = 0.25;
const EXT_CHORD_M = 12;

// The chord direction of a bed from one end, `dist` metres in —
// the local mirror of taipei-markings' pointAlongBed chord
// (kept local: taipei-markings imports THIS module, the same
// one-way dependency as BOX_FURNITURE_REACH_M above).
const bedChordDir = (bed, end, dist = EXT_CHORD_M) => {
  const pts = ptsOf(bed);
  if (pts.length < 2) return null;
  const seq = end === 0 ? pts : [...pts].reverse();
  const [ex, ez] = seq[0];
  let acc = 0;
  let tx = seq[seq.length - 1][0], tz = seq[seq.length - 1][1];
  for (let i = 0; i + 1 < seq.length; i++) {
    const [ax, az] = seq[i], [bx, bz] = seq[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (acc + len >= dist) {
      const t = len > 0 ? (dist - acc) / len : 0;
      tx = ax + (bx - ax) * t;
      tz = az + (bz - az) * t;
      break;
    }
    acc += len;
  }
  const dx = tx - ex, dz = tz - ez, n = Math.hypot(dx, dz);
  return n > 1e-6 ? [dx / n, dz / n] : null;
};

export function armExtension(j, a, roadbeds, kerbCtx = null) {
  const sd = (a.endX - j.x) * a.dirX + (a.endZ - j.z) * a.dirZ;
  const gap = sd - a.crossHalf;
  if (gap < EXT_MIN_GAP_M || gap > EXT_STRIP_MAX_M) return null;
  // dir: OUTWARD along the bed from its end (into the bed).
  const dir = bedChordDir(roadbeds[a.bed], a.end) || [a.dirX, a.dirZ];
  const along = dir[0] * a.dirX + dir[1] * a.dirZ;
  if (along < 0.3) return null;
  // Inward run: from the bed end toward the centre until the
  // strip's far edge sits at axis crossHalf - EXT_PAST_BOX_M.
  const tIn = (gap + EXT_PAST_BOX_M) / along;
  const w2 = a.width / 2 + EXT_JOIN_M;
  const px = -dir[1], pz = dir[0];
  const x0 = a.endX + dir[0] * EXT_JOIN_M, z0 = a.endZ + dir[1] * EXT_JOIN_M;
  const x1 = a.endX - dir[0] * tIn, z1 = a.endZ - dir[1] * tIn;
  let pts = [
    [x0 + px * w2, z0 + pz * w2],
    [x1 + px * w2, z1 + pz * w2],
    [x1 - px * w2, z1 - pz * w2],
    [x0 - px * w2, z0 - pz * w2],
  ];
  // Issue #171 TONGUE: stop at a crossed foreign road's far kerb
  // (or drop a stub that stops just short of one, far from its
  // own ring — ji394). See kerbStopStrip.
  if (kerbCtx) {
    pts = kerbStopStrip(pts, a.bed, kerbCtx);
    if (!pts) return null;
  }
  return {
    pts,
    area: polyArea(pts),
    origin: [
      round4(pts.reduce((s, p) => s + p[0], 0) / pts.length),
      round4(pts.reduce((s, p) => s + p[1], 0) / pts.length),
    ],
  };
}

// ---------------------------------------------------------------------
// Issue #171 geometry helpers: exact polygon difference for the
// green clip, a fan-origin (kernel) test for the pieces it
// produces, and the strip kerb stop.

// The GREEN layer as the boot renders it since #161 — the
// polygons a cap may not pave over: the green landuse layer,
// the park polygons and the Tamsui riverside band. Returned as
// point arrays in this module's shape.
export function capClipPolys(geodata) {
  const out = [];
  const seen = new Set();
  const push = (ring) => {
    if (!ring || ring.length < 6) return;
    const pts = [];
    for (let i = 0; i + 1 < ring.length; i += 2) pts.push([ring[i], ring[i + 1]]);
    if (pts.length < 3) return;
    // the same polygon can appear in two sets (a park that is
    // also a green landuse): keep one copy (see polyCanonKey)
    const key = polyCanonKey(pts);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(pts);
  };
  for (const g of geodata.green || []) push(g.ring);
  for (const g of geodata.parks || []) push(g.ring);
  for (const g of (geodata.riverside && geodata.riverside.polys) || []) push(g.ring);
  return out;
}

const signedArea2 = (pts) => {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return a;
};
const ccwOf = (pts) => {
  const p = pts.map((q) => [q[0], q[1]]);
  if (signedArea2(p) < 0) p.reverse();
  return p;
};
const bboxOfPts = (pts) => {
  let x0 = 1e18, z0 = 1e18, x1 = -1e18, z1 = -1e18;
  for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[1] < z0) z0 = p[1]; if (p[0] > x1) x1 = p[0]; if (p[1] > z1) z1 = p[1]; }
  return [x0, z0, x1, z1];
};
const segPtDist = (p, a, b) => {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const L2 = dx * dx + dz * dz;
  let t = L2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dz * t));
};
const onOrInPoly = (p, poly) => {
  if (pointInPoly(p, poly)) return true;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if (segPtDist(p, poly[j], poly[i]) <= 1e-7) return true;
  return false;
};
const centroidOf = (pts) => [
  pts.reduce((s, p) => s + p[0], 0) / pts.length,
  pts.reduce((s, p) => s + p[1], 0) / pts.length,
];
// proper (interior) segment crossing test for bridge visibility
const segProperCross = (a, b, p, q) => {
  const d1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const d2 = (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]);
  const d3 = (q[0] - p[0]) * (a[1] - p[1]) - (q[1] - p[1]) * (a[0] - p[0]);
  const d4 = (q[0] - p[0]) * (b[1] - p[1]) - (q[1] - p[1]) * (b[0] - p[0]);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
};

// subtractPolys(subject, clips) -> [piece, ...]
// Exact difference of one simple polygon minus a union of
// simple polygons, by edge subdivision + directed boundary
// stitching. Returned pieces are simple polygons (CCW); a
// piece whose interior is pierced by a clip (a hole — a green
// island wholly inside the cap) is returned as ear-clipped
// triangles instead of one holed ring, because the cap fan
// needs simple polygons. Areas conserve: the pieces' total
// area equals area(subject) - area(subject ∩ ∪clips).
// Canonical key for a polygon ring (start point and winding
// normalized): the same green polygon can arrive twice — once
// per data set it appears in — and exact-duplicate clips
// neutralise each other in the difference's edge
// classification (each copy's boundary lies "inside" its twin).
const polyCanonKey = (pts) => {
  const seq = pts.map((p) => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`);
  let best = null;
  for (const s of [seq, [...seq].reverse()]) {
    for (let r = 0; r < s.length; r++) {
      const rot = s.slice(r).concat(s.slice(0, r)).join(';');
      if (best === null || rot < best) best = rot;
    }
  }
  return best;
};

export function subtractPolys(subjectIn, clipsIn) {
  const subject = ccwOf((subjectIn || []).filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]));
  if (subject.length < 3) return [];
  const clips = [];
  const seenClip = new Set();
  for (const c of clipsIn || []) {
    const cc = ccwOf(c.filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]));
    if (cc.length < 3) continue;
    const key = polyCanonKey(cc);
    if (seenClip.has(key)) continue;
    seenClip.add(key);
    clips.push(cc);
  }
  if (!clips.length) return [subject];
  // Segment table with split points at every mutual crossing.
  const segs = [];
  const addRing = (pts, owner) => {
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) segs.push({ ax: pts[j][0], az: pts[j][1], bx: pts[i][0], bz: pts[i][1], owner });
  };
  addRing(subject, -1);
  clips.forEach((c, ci) => addRing(c, ci));
  const keyOf = (x, z) => `${Math.round(x * 1e6)},${Math.round(z * 1e6)}`;
  const nodePt = new Map();
  const splits = segs.map(() => new Map());
  const addSplit = (si, x, z) => {
    const k = keyOf(x, z);
    if (!nodePt.has(k)) nodePt.set(k, [x, z]);
    if (!splits[si].has(k)) splits[si].set(k, nodePt.get(k));
  };
  segs.forEach((s, si) => { addSplit(si, s.ax, s.az); addSplit(si, s.bx, s.bz); });
  const sbb = segs.map((s) => [Math.min(s.ax, s.bx), Math.min(s.az, s.bz), Math.max(s.ax, s.bx), Math.max(s.az, s.bz)]);
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const A = segs[i], B = segs[j];
      if (A.owner === B.owner) continue;
      if (sbb[i][0] > sbb[j][2] || sbb[j][0] > sbb[i][2] || sbb[i][1] > sbb[j][3] || sbb[j][1] > sbb[i][3]) continue;
      const d1x = A.bx - A.ax, d1z = A.bz - A.az, d2x = B.bx - B.ax, d2z = B.bz - B.az;
      const rx = B.ax - A.ax, rz = B.az - A.az;
      const det = d1x * d2z - d1z * d2x;
      if (Math.abs(det) > 1e-12) {
        const t = (rx * d2z - rz * d2x) / det, u = (rx * d1z - rz * d1x) / det;
        if (t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) {
          const tc = Math.max(0, Math.min(1, t));
          addSplit(i, A.ax + d1x * tc, A.az + d1z * tc);
          addSplit(j, A.ax + d1x * tc, A.az + d1z * tc);
        }
      } else {
        const len1 = Math.hypot(d1x, d1z);
        if (len1 > 0 && Math.abs(rx * d1z - rz * d1x) / len1 < 1e-7) {
          for (const q of [[B.ax, B.az], [B.bx, B.bz]]) {
            const t = ((q[0] - A.ax) * d1x + (q[1] - A.az) * d1z) / (len1 * len1);
            if (t > 1e-9 && t < 1 - 1e-9) { addSplit(i, q[0], q[1]); addSplit(j, q[0], q[1]); }
          }
          const len2 = Math.hypot(d2x, d2z);
          if (len2 > 0) for (const q of [[A.ax, A.az], [A.bx, A.bz]]) {
            const u = ((q[0] - B.ax) * d2x + (q[1] - B.az) * d2z) / (len2 * len2);
            if (u > 1e-9 && u < 1 - 1e-9) { addSplit(i, q[0], q[1]); addSplit(j, q[0], q[1]); }
          }
        }
      }
    }
  }
  // Atomic edges, classified by a probe point nudged to the
  // relevant interior side (boundary-coincident cases resolve
  // to the side the probe lands on).
  const DELTA = 1e-4;
  const kept = []; // directed: difference interior on the left
  segs.forEach((s, si) => {
    const pts = [...splits[si].values()];
    const dx = s.bx - s.ax, dz = s.bz - s.az;
    pts.sort((p, q) => ((p[0] - s.ax) * dx + (p[1] - s.az) * dz) - ((q[0] - s.ax) * dx + (q[1] - s.az) * dz));
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k], b = pts[k + 1];
      const elen = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (elen < 1e-7) continue;
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      const lx = -(b[1] - a[1]) / elen, lz = (b[0] - a[0]) / elen; // left of travel
      if (s.owner === -1) {
        const pin = [mx + lx * DELTA, mz + lz * DELTA];
        if (clips.some((c) => onOrInPoly(pin, c))) continue;
        kept.push({ a, b });
      } else {
        const pClipIn = [mx + lx * DELTA, mz + lz * DELTA]; // this clip's interior side
        const pDiff = [mx - lx * DELTA, mz - lz * DELTA];   // difference side
        if (!onOrInPoly(pClipIn, subject) || !onOrInPoly(pDiff, subject)) continue;
        if (clips.some((c, ci) => ci !== s.owner && onOrInPoly(pDiff, c))) continue;
        kept.push({ a: b, b: a }); // reversed: clip interior leaves the left side
      }
    }
  });
  // Stitch directed edges into loops. At a node with several
  // unused outgoing edges (touching configurations), take the
  // sharpest clockwise turn from the reverse incoming direction
  // — the standard face walk that keeps the region on the left.
  const outOf = new Map();
  kept.forEach((e, ei) => {
    const k = keyOf(e.a[0], e.a[1]);
    if (!outOf.has(k)) outOf.set(k, []);
    outOf.get(k).push(ei);
  });
  const used = new Array(kept.length).fill(false);
  const loops = [];
  for (let start = 0; start < kept.length; start++) {
    if (used[start]) continue;
    const loop = [];
    let ei = start, guard = 0, closed = false;
    while (ei !== -1 && guard++ < kept.length + 2) {
      if (used[ei]) break;
      used[ei] = true;
      const e = kept[ei];
      loop.push(e.a);
      const endKey = keyOf(e.b[0], e.b[1]);
      if (loop.length >= 3 && endKey === keyOf(loop[0][0], loop[0][1])) { closed = true; break; }
      const cands = (outOf.get(endKey) || []).filter((ci) => !used[ci]);
      if (!cands.length) break;
      if (cands.length === 1) { ei = cands[0]; continue; }
      const backAng = Math.atan2(-(e.b[1] - e.a[1]), -(e.b[0] - e.a[0]));
      let bestCw = Infinity;
      ei = cands[0];
      for (const ci of cands) {
        const ce = kept[ci];
        const ang = Math.atan2(ce.b[1] - ce.a[1], ce.b[0] - ce.a[0]);
        let cw = (backAng - ang) % (Math.PI * 2);
        if (cw < 0) cw += Math.PI * 2;
        if (cw < bestCw) { bestCw = cw; ei = ci; }
      }
    }
    if (closed && loop.length >= 3) {
      const a2 = signedArea2(loop);
      if (Math.abs(a2) > 2e-4) loops.push({ pts: loop, area: a2 / 2 });
    }
  }
  // Assemble pieces: CCW loops are outers, CW loops are holes.
  const outers = loops.filter((L) => L.area > 0);
  const holes = loops.filter((L) => L.area < 0);
  const pieces = [];
  for (const o of outers) {
    const mine = holes.filter((h) => pointInPoly(h.pts[0], o.pts) || onOrInPoly(h.pts[0], o.pts));
    if (!mine.length) { pieces.push(o.pts); continue; }
    let ring = o.pts;
    let ok = true;
    for (const h of mine) {
      ring = bridgeHole(ring, h.pts);
      if (!ring) { ok = false; break; }
    }
    const tris = ok ? triangulateSimple(ring) : [];
    if (tris.length) pieces.push(...tris);
    else pieces.push(o.pts); // last resort: keep the outer (probe-counted)
  }
  return pieces;
}

// Splice a hole loop into an outer ring with a bridge edge pair
// (outer stays CCW; the hole loop arrives CW). Returns the
// weakly-simple combined ring, or null when no clean bridge
// vertex pair exists.
function bridgeHole(outer, hole) {
  let hi = 0;
  hole.forEach((p, i) => { if (p[0] > hole[hi][0]) hi = i; });
  const h = hole[hi];
  const order = outer.map((v, vi) => ({ v, vi, d: Math.hypot(v[0] - h[0], v[1] - h[1]) })).sort((a, b) => a.d - b.d);
  for (const { v, vi } of order) {
    const midPt = [(h[0] + v[0]) / 2, (h[1] + v[1]) / 2];
    if (!pointInPoly(midPt, outer)) continue;
    let bad = false;
    for (let i = 0, j = outer.length - 1; i < outer.length && !bad; j = i++) {
      const p = outer[j], q = outer[i];
      if (q === v || p === v) continue;
      if (segProperCross(h, v, p, q)) bad = true;
    }
    for (let i = 0, j = hole.length - 1; i < hole.length && !bad; j = i++) {
      const p = hole[j], q = hole[i];
      if (q === h || p === h) continue;
      if (segProperCross(h, v, p, q)) bad = true;
    }
    if (bad) continue;
    const holeRot = [...hole.slice(hi), ...hole.slice(0, hi)];
    return [...outer.slice(0, vi + 1), ...holeRot, h, v, ...outer.slice(vi + 1)];
  }
  return null;
}

// Ear-clipping triangulation of a simple (possibly weakly
// simple, after hole bridging) polygon. Returns triangles as
// point triples, or [] if clipping stalls.
export function triangulateSimple(ptsIn) {
  const P = ccwOf(ptsIn);
  if (P.length < 3) return [];
  if (P.length === 3) return [P];
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const tris = [];
  const idx = P.map((_, i) => i);
  let guard = 0;
  while (idx.length > 3 && guard++ < 20000) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const ia = idx[(k + idx.length - 1) % idx.length], ib = idx[k], ic = idx[(k + 1) % idx.length];
      const a = P[ia], b = P[ib], c = P[ic];
      if (cross(a, b, c) <= 1e-12) continue;
      let ok = true;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        const p = P[j];
        if (cross(a, b, p) > 1e-12 && cross(b, c, p) > 1e-12 && cross(c, a, p) > 1e-12) { ok = false; break; }
        // a vertex on the ear's diagonal blocks the ear
        if (Math.abs(cross(a, c, p)) <= 1e-12 && segPtDist(p, a, c) <= 1e-9 && Math.hypot(p[0] - a[0], p[1] - a[1]) > 1e-9 && Math.hypot(p[0] - c[0], p[1] - c[1]) > 1e-9) { ok = false; break; }
      }
      if (!ok) continue;
      tris.push([a, b, c]);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) return [];
  }
  if (idx.length === 3) tris.push([P[idx[0]], P[idx[1]], P[idx[2]]]);
  return tris.length ? tris : [];
}

// A point in the polygon's kernel (the region that sees the
// whole ring — the fan origin must live there), or null when
// the kernel is empty. Prefers `prefer` when it is in the
// kernel. Computed by half-plane intersection of the edges.
export function kernelPoint(pts, prefer = null) {
  const P = ccwOf(pts);
  const bb = bboxOfPts(P);
  const M = 10;
  let poly = [[bb[0] - M, bb[1] - M], [bb[2] + M, bb[1] - M], [bb[2] + M, bb[3] + M], [bb[0] - M, bb[3] + M]];
  const inKernel = (p) => {
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const a = P[j], b = P[i];
      if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) < -1e-9) return false;
    }
    return true;
  };
  if (prefer && inKernel(prefer)) return [prefer[0], prefer[1]];
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[j], b = P[i];
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const next = [];
    for (let k = 0, m = poly.length - 1; k < poly.length; m = k++) {
      const p = poly[k], q = poly[m];
      const dp = ex * (p[1] - a[1]) - ez * (p[0] - a[0]);
      const dq = ex * (q[1] - a[1]) - ez * (q[0] - a[0]);
      const pin = dp >= -1e-12, qin = dq >= -1e-12;
      if (pin !== qin) {
        const t = dq / (dq - dp);
        next.push([q[0] + (p[0] - q[0]) * t, q[1] + (p[1] - q[1]) * t]);
      }
      if (pin) next.push(p);
    }
    poly = next;
    if (!poly.length) return null;
  }
  if (!poly.length) return null;
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
  const cz = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  return [cx, cz];
}

// flat ring writer for clipped pieces: 1 mm grid (ringOf's
// 0.1 m grid would let piece edges drift back over the clip
// boundary by up to ~7 cm).
const flatRing = (pts) => {
  const out = [];
  for (const p of pts) {
    const x = Math.round(p[0] * 1000) / 1000, z = Math.round(p[1] * 1000) / 1000;
    if (out.length && out[out.length - 2] === x && out[out.length - 1] === z) continue;
    out.push(x, z);
  }
  if (out.length >= 4 && out[0] === out[out.length - 2] && out[1] === out[out.length - 1]) out.length -= 2;
  return out;
};

// Sutherland–Hodgman clip of a simple polygon by a CONVEX
// window (either winding). Used to localize green polygons to
// a cap's footprint before the exact difference.
function clipByConvexPoly(subject, window) {
  const wsign = Math.sign(signedArea2(window)) || 1;
  let out = subject.map((p) => [p[0], p[1]]);
  for (let e = 0; e < window.length; e++) {
    const a = window[e], b = window[(e + 1) % window.length];
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const side = (p) => wsign * (ex * (p[1] - a[1]) - ez * (p[0] - a[0]));
    const inp = [];
    for (let i = 0, j = out.length - 1; i < out.length; j = i++) {
      const p = out[i], q = out[j];
      const dp = side(p), dq = side(q);
      const pin = dp >= -1e-9, qin = dq >= -1e-9;
      if (pin !== qin) {
        const t = dq / (dq - dp);
        inp.push([q[0] + (p[0] - q[0]) * t, q[1] + (p[1] - q[1]) * t]);
      }
      if (pin) inp.push(p);
    }
    out = inp;
    if (!out.length) break;
  }
  return out;
}

// Turn raw difference pieces into renderable cap pieces
// ({ pts, area, origin }): each piece must be fan-valid from
// its origin, so pieces with an empty kernel are triangulated.
function fanPieces(j, rawPieces) {
  const out = [];
  for (const raw of rawPieces) {
    if (raw.length < 3) continue;
    const a = polyArea(raw);
    if (!(a > 0.005)) continue;
    const centre = [j.x, j.z];
    const origin = kernelPoint(raw, centre) || kernelPoint(raw, centroidOf(raw));
    if (origin) { out.push({ pts: raw, area: a, origin }); continue; }
    for (const tri of triangulateSimple(raw)) out.push({ pts: tri, area: polyArea(tri), origin: centroidOf(tri) });
  }
  return out;
}

// ---------------------------------------------------------------------
// TONGUE (issue #171): the strip kerb stop. ctx carries the
// junction's ring points plus the ground ribbons near the
// junction (deck beds excluded — an elevated line's ground
// projection is not a kerb). Walk the strip centreline from the
// bed end (outer) to the ring end (inner). A strip that ENDS on
// the ring or on a carriageway is a through joint (ji562's
// strips cross a lane and re-enter their ring; the #163
// synthetic strip ends inside the crossed road) and is kept
// whole. The tongue signature needs the end on open ground at
// least 4 m from the ring, plus one of:
//   CROSSED — the path crossed a FOREIGN ribbon (not its own
//     bed, not another arm of this junction, not a same-named
//     segment of its own road) and left it with at least 1.5 m
//     of bare tail: cut at that road's far kerb + tuck.
//   STUB — the path never crossed a foreign ribbon, but the
//     end stops within 2 m of a foreign kerb after at least
//     3 m of bare run: the strip was aimed at that road and
//     stopped at the box plane instead of the kerb (ji394's
//     service-lane strip, ending 1.7 m short of 莊敬路325巷's
//     kerb and 7.6 m from its own ring). A strip may not be
//     extended, so the stub is cut at its last carriageway
//     contact + tuck — which normally drops it.
function kerbStopStrip(pts, ownBedIdx, ctx) {
  const inC = [(pts[1][0] + pts[2][0]) / 2, (pts[1][1] + pts[2][1]) / 2];
  const outC = [(pts[0][0] + pts[3][0]) / 2, (pts[0][1] + pts[3][1]) / 2];
  const L = Math.hypot(inC[0] - outC[0], inC[1] - outC[1]);
  if (!(L > 0.5)) return pts;
  const ownName = ctx.bedName[ownBedIdx] || '';
  const isForeign = (b) => b !== ownBedIdx && !ctx.armBeds.has(b) && (ctx.bedName[b] || '') !== ownName;
  const ribbonsAt = (p) => {
    const cand = ctx.ribbonGrid.get(`${Math.floor(p[0] / 100)},${Math.floor(p[1] / 100)}`) || [];
    const hits = [];
    for (const ci of cand) if (pointInPoly(p, ctx.ribbonPolys[ci])) hits.push(ctx.ribbonBed[ci]);
    return hits;
  };
  const STEP = 0.25;
  const n = Math.max(2, Math.ceil(L / STEP));
  const cov = [];
  for (let s = 0; s <= n; s++) {
    const t = s / n;
    const p = [outC[0] + (inC[0] - outC[0]) * t, outC[1] + (inC[1] - outC[1]) * t];
    cov.push({ t, p, ring: pointInPoly(p, ctx.ringPts), beds: ribbonsAt(p) });
  }
  const end = cov[cov.length - 1];
  if (end.ring || end.beds.length) return pts; // ends on a surface: a joint
  let dHull = Infinity;
  for (let i = 0, j = ctx.ringPts.length - 1; i < ctx.ringPts.length; j = i++) dHull = Math.min(dHull, segPtDist(inC, ctx.ringPts[j], ctx.ringPts[i]));
  if (dHull < 4) return pts;
  // CROSSED: the last foreign interval whose exit leaves only
  // bare ground behind it
  let cut = null;
  for (let s = cov.length - 1; s >= 0; s--) {
    if (!cov[s].beds.some(isForeign)) continue;
    let e = s;
    while (e + 1 < cov.length && (cov[e + 1].beds.some(isForeign) || cov[e + 1].ring)) e++;
    if (e + 1 >= cov.length) continue;
    const tail = cov.slice(e + 1);
    if (tail.some((c2) => c2.ring || c2.beds.length)) continue;
    cut = { lc: e, beds: new Set(cov[e].beds.filter(isForeign)), ring: false, minTail: 1.5 };
    break;
  }
  if (!cut) {
    // STUB: end within 2 m of a foreign kerb, bare tail >= 3 m
    let dRibF = Infinity;
    const cand = ctx.ribbonGrid.get(`${Math.floor(inC[0] / 100)},${Math.floor(inC[1] / 100)}`) || [];
    for (const ci of cand) {
      if (!isForeign(ctx.ribbonBed[ci])) continue;
      const poly = ctx.ribbonPolys[ci];
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) dRibF = Math.min(dRibF, segPtDist(inC, poly[j], poly[i]));
    }
    if (dRibF > 2) return pts;
    let lc = -1;
    for (let s = cov.length - 1; s >= 0; s--) if (cov[s].ring || cov[s].beds.length) { lc = s; break; }
    if (lc < 0 || lc + 1 >= cov.length) return pts;
    cut = { lc, beds: new Set(cov[lc].beds), ring: cov[lc].ring, minTail: 3 };
  }
  if ((1 - cov[cut.lc].t) * L < cut.minTail) return pts;
  // exit boundary between cov[lc] and cov[lc + 1], by bisection
  // on the coverage predicate of the contact being exited
  const lcBeds = cut.beds;
  const lcRing = cut.ring;
  const coveredAt = (t) => {
    const p = [outC[0] + (inC[0] - outC[0]) * t, outC[1] + (inC[1] - outC[1]) * t];
    if (lcRing && pointInPoly(p, ctx.ringPts)) return true;
    return ribbonsAt(p).some((b) => lcBeds.has(b));
  };
  let lo = cov[cut.lc].t, hi = cov[cut.lc + 1].t;
  for (let it = 0; it < 24; it++) {
    const tm = (lo + hi) / 2;
    if (coveredAt(tm)) lo = tm; else hi = tm;
  }
  const bp = [outC[0] + (inC[0] - outC[0]) * hi, outC[1] + (inC[1] - outC[1]) * hi];
  // the exit edge: nearest edge of the exited ribbon(s), or of
  // the ring itself when the strip exits its own ring
  let bestEdge = null, bestD = 1.5;
  ctx.ribbonPolys.forEach((poly, ci) => {
    if (!lcBeds.has(ctx.ribbonBed[ci])) return;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const d = segPtDist(bp, poly[j], poly[i]);
      if (d < bestD) { bestD = d; bestEdge = [poly[j], poly[i], poly]; }
    }
  });
  if (!bestEdge && lcRing) {
    for (let i = 0, j = ctx.ringPts.length - 1; i < ctx.ringPts.length; j = i++) {
      const d = segPtDist(bp, ctx.ringPts[j], ctx.ringPts[i]);
      if (d < bestD) { bestD = d; bestEdge = [ctx.ringPts[j], ctx.ringPts[i], ctx.ringPts]; }
    }
  }
  if (!bestEdge) return pts;
  const [ea, eb, ribbon] = bestEdge;
  const ex = eb[0] - ea[0], ez = eb[1] - ea[1];
  const elen = Math.hypot(ex, ez) || 1;
  // outward normal: away from the exited polygon's centroid
  const rc = centroidOf(ribbon);
  let nx = -ez / elen, nz = ex / elen;
  if ((rc[0] - ea[0]) * nx + (rc[1] - ea[1]) * nz > 0) { nx = -nx; nz = -nz; }
  const ox = ea[0] + nx * EXT_PAST_BOX_M, oz = ea[1] + nz * EXT_PAST_BOX_M;
  // keep the side of the offset line that contains outC
  const side = (p) => ex * (p[1] - oz) - ez * (p[0] - ox);
  const keepSign = Math.sign(side(outC)) || 1;
  const clipped = [];
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const p = pts[i], q = pts[j];
    const dp = side(p) * keepSign, dq = side(q) * keepSign;
    const pin = dp >= -1e-12, qin = dq >= -1e-12;
    if (pin !== qin) {
      const t = dq / (dq - dp);
      clipped.push([q[0] + (p[0] - q[0]) * t, q[1] + (p[1] - q[1]) * t]);
    }
    if (pin) clipped.push(p);
  }
  if (clipped.length < 3 || !(polyArea(clipped) >= 1)) return null;
  return clipped;
}

// planJunctionCaps(roadbeds, junctions, sitesIn?, clipPolysIn?)
// -> [{ x, z, ring, radius, cls, tones, arms, signalized, area,
// kind, extras, extraArea, pieces }]
// junctions: detectJunctions() output (js/taipei-markings.js) — the
// caller detects once and shares the result with the markings
// builder. One cap per detected junction with >= 2 arms that no
// roundabout site claims. kind is 'box' for major junctions,
// 'fitted' for minor ones — the junction class, kept for the
// census and the boot log; since issue #145 both classes take
// the same overlapRing construction (the mouth segments apply
// at major junctions and at signalized minors). ring is a flat
// [x, z, …] array in hull order; cls is the surfaceClass of the
// widest incident arm (census/metadata — the rendered tone is
// `tones`, the single junction tone above). `area` is the RING's
// area (the #145 census semantics — rings are unchanged by
// #163); fitted caps additionally carry `extras`: the #163 arm
// extension strips, each { ring, tones, area } in the same
// shapes as a cap (tones from capBlendTones over the strip's
// own vertices, fan origin at the strip's centroid), and
// `extraArea`, their summed area. The cap's full paved surface
// for occlusion consumers is ring + extras + pieces
// (capSurfacePolys).
//
// Issue #171: when clipPolysIn is given (the GREEN layer, see
// capClipPolys), every ring and strip is cut against it: the
// pieces that survive are the cap's ring (largest piece), its
// `pieces` (the remaining ring-derived pieces, same shape as a
// cap) and clipped strip pieces in `extras`; `area` /
// `extraArea` still sum the FULL surface so the census
// accounting identity holds. The cut is against green ERODED
// BY THE JUNCTION'S OWN CORRIDORS (the arms' cross-section
// rectangles + the incident ground ribbons): the land data is
// drawn beneath the carriageways themselves (on main 7beef3c8,
// 12,945 of 29,155 m² of cap-on-green lies under the arms' own
// ribbons), and a junction's carriageway is not a green
// incursion — the WEB defect is asphalt BEYOND the corridors
// (16,210 m² before, 0 after). `radius` stays the unclipped
// hull's design envelope.
export function planJunctionCaps(roadbeds, junctions, sitesIn = null, clipPolysIn = null) {
  const sites = sitesIn || planRoundabouts(roadbeds, junctions);
  const claimed = new Set(sites.flatMap((s) => s.claimedJunctions));
  const clip = clipPolysIn && clipPolysIn.length ? { polys: clipPolysIn, grid: buildPolyGrid(clipPolysIn) } : null;
  // Ground ribbons near each junction serve two #171 rules: the
  // TONGUE kerb stop (foreign carriageways a strip crosses) and
  // the green clip's corridor erosion. Deck beds are excluded —
  // an elevated line's ground projection is not a kerb, and the
  // land beneath a viaduct is not its carriageway.
  const bedCell = new Map();
  roadbeds.forEach((b, bi) => {
    let x0 = 1e18, z0 = 1e18, x1 = -1e18, z1 = -1e18;
    for (let i = 0; i + 1 < b.pts.length; i += 2) { x0 = Math.min(x0, b.pts[i]); x1 = Math.max(x1, b.pts[i]); z0 = Math.min(z0, b.pts[i + 1]); z1 = Math.max(z1, b.pts[i + 1]); }
    for (let gx = Math.floor(x0 / 100); gx <= Math.floor(x1 / 100); gx++)
      for (let gz = Math.floor(z0 / 100); gz <= Math.floor(z1 / 100); gz++) {
        const k = `${gx},${gz}`;
        if (!bedCell.has(k)) bedCell.set(k, []);
        bedCell.get(k).push(bi);
      }
  });
  const ribbonCache = new Map();
  const ribbonOf = (bi) => {
    if (!ribbonCache.has(bi)) ribbonCache.set(bi, roadbeds[bi].deck ? null : ribbonPoly(roadbeds[bi]));
    return ribbonCache.get(bi);
  };
  const nearRibbons = (j, reachM) => {
    const idx = new Set();
    for (let gx = Math.floor((j.x - reachM) / 100); gx <= Math.floor((j.x + reachM) / 100); gx++)
      for (let gz = Math.floor((j.z - reachM) / 100); gz <= Math.floor((j.z + reachM) / 100); gz++)
        for (const bi of bedCell.get(`${gx},${gz}`) || []) idx.add(bi);
    const polys = [], bedOf = [];
    for (const bi of idx) {
      const rp = ribbonOf(bi);
      if (rp) { polys.push(rp); bedOf.push(bi); }
    }
    return { polys, bedOf };
  };
  const caps = [];
  (junctions || []).forEach((j, ji) => {
    if (!j.arms || j.arms.length < 2) return;
    if (claimed.has(ji)) return;
    const kind = isMajorJunction(j) ? 'box' : 'fitted';
    const hull = overlapRing(j);
    if (hull.length < 3) return;
    const area = polyArea(hull);
    if (!(area > 1)) return;
    let radius = 0;
    for (const [px, pz] of hull) radius = Math.max(radius, Math.hypot(px - j.x, pz - j.z));
    let widest = j.arms[0];
    for (const a of j.arms) if (a.width > widest.width) widest = a;
    // #171 green clip: effective clips for this junction. The
    // erosion is LOCAL: each green polygon is first intersected
    // with the cap's own footprint (the hull — strips are
    // clipped by their own overlaps in the strip pass below),
    // and only that overlap is eroded by the junction's
    // corridor union. Green data includes tile-scale landuse
    // polygons (the Guandu plain is one 3.3 km² ring); eroding
    // those whole would bury the boolean in corridor holes.
    let effClips = null;
    let corr = null;
    if (clip) {
      const bb = bboxOfPts(hull);
      const gIdx = new Set();
      for (let gx = Math.floor(bb[0] / 100); gx <= Math.floor(bb[2] / 100); gx++)
        for (let gz = Math.floor(bb[1] / 100); gz <= Math.floor(bb[3] / 100); gz++)
          for (const gi of clip.grid.get(`${gx},${gz}`) || []) gIdx.add(gi);
      if (gIdx.size) {
        corr = [];
        const mouthArms = isMajorJunction(j) || j.signalized;
        for (const a of j.arms) {
          const nx = -a.dirZ, nz = a.dirX, ch = a.crossHalf;
          // The arm's corridor: its cross-section rectangle run
          // out over the arm's own mouth reach (the bed end +
          // CAP_END_OVERLAP_M — the territory the ring's mouth
          // segments and the #163 strips legitimately pave),
          // widened by the box margin at mouth junctions.
          const sdA = (a.endX - j.x) * a.dirX + (a.endZ - j.z) * a.dirZ;
          const tMax = Math.max(ch, sdA + CAP_END_OVERLAP_M);
          const w2 = a.width / 2 + (mouthArms ? BOX_MARGIN_M : 0);
          corr.push([
            [j.x - a.dirX * ch - nx * w2, j.z - a.dirZ * ch - nz * w2],
            [j.x + a.dirX * tMax - nx * w2, j.z + a.dirZ * tMax - nz * w2],
            [j.x + a.dirX * tMax + nx * w2, j.z + a.dirZ * tMax + nz * w2],
            [j.x - a.dirX * ch + nx * w2, j.z - a.dirZ * ch + nz * w2],
          ]);
          const rp = ribbonOf(a.bed);
          if (rp) corr.push(rp);
        }
        effClips = [];
        for (const gi of gIdx) {
          const overlap = clipByConvexPoly(clip.polys[gi], hull);
          if (overlap.length < 3) continue;
          for (const piece of subtractPolys(overlap, corr)) if (polyArea(piece) > 0.01) effClips.push(piece);
        }
        if (!effClips.length) effClips = null;
      }
    }
    // Ring surface: unclipped (the pre-#171 path, byte-identical)
    // or the clipped pieces (largest = the ring, rest in pieces).
    let ring, ringTones, capPieces = [], ringArea = area;
    if (!effClips) {
      ring = ringOf(hull);
      const ringPts = [];
      for (let i = 0; i + 1 < ring.length; i += 2) ringPts.push([ring[i], ring[i + 1]]);
      ringTones = capBlendTones(j, ringPts);
    } else {
      let pieces = fanPieces(j, subtractPolys(hull, effClips)).sort((p, q) => q.area - p.area);
      if (!pieces.length) {
        // Defensive: the corridor union always intersects the
        // hull (every arm's segment triangle), so a difference
        // that comes back empty is a boolean failure, not a
        // fully-green junction — fall back to the hull's
        // corridor parts rather than dropping the cap.
        const corrParts = [];
        for (const cp of corr || []) {
          const q = clipByConvexPoly(cp, hull);
          if (q.length >= 3) corrParts.push(q);
        }
        pieces = fanPieces(j, corrParts).sort((p, q) => q.area - p.area);
      }
      const main = pieces[0];
      ring = flatRing(main.pts);
      const t = capBlendTones(j, main.pts);
      ringTones = { centre: t.centre, origin: main.origin, ring: t.ring };
      ringArea = 0;
      for (const p of pieces) {
        ringArea += p.area;
        if (p === main) continue;
        const tp = capBlendTones(j, p.pts);
        capPieces.push({ ring: flatRing(p.pts), tones: { centre: tp.centre, origin: p.origin, ring: tp.ring }, area: Math.round(p.area) });
      }
    }
    const extras = [];
    let extraArea = 0;
    if (kind === 'fitted') {
      let kerbCtx = null;
      const needKerb = j.arms.some((a) => {
        const sd = (a.endX - j.x) * a.dirX + (a.endZ - j.z) * a.dirZ;
        const gap = sd - a.crossHalf;
        return gap >= EXT_MIN_GAP_M && gap <= EXT_STRIP_MAX_M;
      });
      if (needKerb) {
        const maxCh = Math.max(...j.arms.map((a) => a.crossHalf));
        const near = nearRibbons(j, maxCh + EXT_STRIP_MAX_M + 20);
        kerbCtx = {
          ringPts: hull,
          ribbonPolys: near.polys,
          ribbonGrid: buildPolyGrid(near.polys),
          ribbonBed: near.bedOf,
          armBeds: new Set(j.arms.map((a) => a.bed)),
          bedName: roadbeds.map((b) => b.name || ''),
        };
      }
      for (const a of j.arms) {
        const ext = armExtension(j, a, roadbeds, kerbCtx);
        if (!ext) continue;
        const t = capBlendTones(j, ext.pts);
        // The strip's own green overlaps (it reaches past the
        // hull): erode them by the same corridor union.
        let sEff = effClips;
        if (clip && corr) {
          const sb = bboxOfPts(ext.pts);
          const sg = new Set();
          for (let gx = Math.floor(sb[0] / 100); gx <= Math.floor(sb[2] / 100); gx++)
            for (let gz = Math.floor(sb[1] / 100); gz <= Math.floor(sb[3] / 100); gz++)
              for (const gi of clip.grid.get(`${gx},${gz}`) || []) sg.add(gi);
          if (sg.size) {
            sEff = effClips ? [...effClips] : [];
            for (const gi of sg) {
              const overlap = clipByConvexPoly(clip.polys[gi], ext.pts);
              if (overlap.length < 3) continue;
              for (const piece of subtractPolys(overlap, corr)) if (polyArea(piece) > 0.01) sEff.push(piece);
            }
            if (!sEff.length) sEff = null;
          }
        }
        if (!sEff) {
          extras.push({
            ring: ringOf(ext.pts),
            tones: { centre: t.centre, origin: ext.origin, ring: t.ring },
            area: Math.round(ext.area),
          });
          extraArea += ext.area;
        } else {
          for (const p of fanPieces(j, subtractPolys(ext.pts, sEff))) {
            const tp = capBlendTones(j, p.pts);
            extras.push({
              ring: flatRing(p.pts),
              tones: { centre: tp.centre, origin: p.origin, ring: tp.ring },
              area: Math.round(p.area),
            });
            extraArea += p.area;
          }
        }
      }
    }
    caps.push({
      x: j.x, z: j.z,
      ring,
      radius: Math.round(radius * 10) / 10,
      cls: surfaceClass({ highway: widest.highway }),
      tones: ringTones,
      arms: j.arms.length,
      signalized: !!j.signalized,
      area: Math.round(ringArea),
      kind,
      extras,
      extraArea: Math.round(extraArea),
      pieces: capPieces,
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

// A cap's FULL paved surface as polygon point arrays: the ring
// plus its #163 extension strips and any #171 clipped ring
// pieces. Every occlusion consumer
// (median bite, painted bands, dash clipping, tree exclusions)
// must clip against this, not the ring alone — a median strip
// or dash that stops at the ring but crosses a strip is back
// on the regression screenshot.
export const capSurfacePolys = (cap) => {
  const polys = [ringPoints(cap.ring)];
  for (const ex of cap.extras || []) polys.push(ringPoints(ex.ring));
  for (const p of cap.pieces || []) polys.push(ringPoints(p.ring));
  return polys;
};

// Issue #173 (DASH class): the roundabout dash occluders. Claimed
// roundabout junctions get NO cap, so the cap occlusion set never
// covered their ground, and entry lane lines fanned across the
// planted gore wedges between the disc rim and the island (the
// ji161 fan in the #169 sweep). The occluders are placement
// semantics, not more surface area: each site's ISLAND ring, its
// apron rings, and the parts of the caller's park/green polygons
// that fall inside the disc (the wedge parcels — clipped exactly
// with subtractPolys: green − (green − disc)). Dashes on the
// circulatory carriageway itself stay untouched: the annulus
// between island and rim is not in any occluder.
export function roundaboutDashOccluders(sites, greenPolys = []) {
  const bboxOf = (pts) => {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const p of pts) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minZ) minZ = p[1];
      if (p[1] > maxZ) maxZ = p[1];
    }
    return [minX, minZ, maxX, maxZ];
  };
  const out = [];
  for (const s of sites || []) {
    if (s.island?.ring) out.push(ringPoints(s.island.ring));
    for (const a of s.aprons || []) out.push(ringPoints(a.ring));
    if (!s.disc?.ring || !greenPolys.length) continue;
    const disc = ringPoints(s.disc.ring);
    const db = bboxOf(disc);
    for (const g of greenPolys) {
      if (!g || g.length < 3) continue;
      const gb = bboxOf(g);
      if (gb[0] > db[2] || gb[2] < db[0] || gb[1] > db[3] || gb[3] < db[1]) continue;
      const outside = subtractPolys(g, [disc]);
      if (!outside.length) { out.push(g); continue; }
      out.push(...subtractPolys(g, outside));
    }
  }
  return out;
}
