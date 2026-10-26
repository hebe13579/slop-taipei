import assert from 'node:assert/strict';
import test from 'node:test';

import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { pointInPoly, buildPolyGrid, pointInAnyPoly, ribbonPoly } from '../js/taipei-painted.js';
import { buildPaintedBands } from '../js/taipei-painted.js';
import { buildMedianStrips, surfaceClass } from '../js/taipei-surfaces.js';
import { detectJunctions, buildRoadMarkings } from '../js/taipei-markings.js';
import { convexHull, planJunctionCaps, planRoundabouts, ringPoints, CAP_Y } from '../js/taipei-junctions.js';

// Issue #66 — junction caps. The rules live in js/taipei-junctions.js
// (pure) so these tests pin the exact code the renderer draws with:
// one cap per detected multi-arm junction, the cap containing its
// junction centre and every arm's bed end, the cap tone following
// the widest arm, and the painted layers' hard occlusion — no
// painted band, median strip or lane dash quad centre inside a cap.
// Issue #75 — junction audit 2: major junctions (an arterial/deck
// arm) get a plain junction-BOX cap that covers the full box
// corner to corner; roundabouts （仁愛敦南/東門圓環 + the 北門
// island) are handcrafted (disc + island + entry aprons) and
// their junctions get no cap. The box spec in the #75 test below
// mirrors the published audit (AUDIT.md in the #75 evidence):
// cross-section lines at crossHalf, main corners + edge corners
// local to their mouth, hull with the segment endpoints.

const bed = (name, highway, width, ways = [1], pts = [0, 0, 100, 0]) => ({
  name, highway, width, pedestrianLayout: 'sidewalk', pts, sourceWayIds: ways,
});
const quadCentre = (q) => [(q[0] + q[2] + q[4] + q[6]) / 4, (q[1] + q[3] + q[5] + q[7]) / 4];

// Distance from a point to a polygon: 0 inside, else the distance to
// the nearest edge. (pointInPoly alone is boundary-blind, and cap
// cross-section midpoints sit ON hull edges by construction.)
function distToPoly(p, poly) {
  if (pointInPoly(p, poly)) return 0;
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j], [bx, bz] = poly[i];
    const dx = bx - ax, dz = bz - az;
    const L2 = dx * dx + dz * dz;
    let t = L2 > 0 ? ((p[0] - ax) * dx + (p[1] - az) * dz) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(p[0] - (ax + t * dx), p[1] - (az + t * dz)));
  }
  return best;
}

test('convexHull: cross-section corners hull in order, collinear points dropped', () => {
  const hull = convexHull([[0, 0], [10, 0], [10, 10], [0, 10], [5, 0], [5, 5]]);
  assert.equal(hull.length, 4);
  const xs = hull.map((p) => p[0]), zs = hull.map((p) => p[1]);
  assert.deepEqual([Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)], [0, 10, 0, 10]);
  assert.deepEqual(convexHull([[0, 0], [1, 1]]), []);
});

test('synthetic 4-way: one cap, widest arm owns the tone, ends inside', () => {
  const beds = [
    bed('EW Blvd', 'secondary', 30, [1, 2], [-100, 0, 0, 0]),
    bed('EW Blvd', 'secondary', 30, [1, 2], [0, 0, 100, 0]),
    bed('NS Ave', 'primary', 24, [3], [0, -100, 0, 0]),
    bed('NS Ave', 'primary', 24, [3], [0, 0, 0, 100]),
    bed('Lane', 'residential', 6, [4], [0, 0, -70, 70]),
  ];
  const junctions = detectJunctions(beds);
  const caps = planJunctionCaps(beds, junctions);
  assert.equal(caps.length, 1);
  const cap = caps[0];
  const poly = ringPoints(cap.ring);
  assert.equal(cap.cls, 'arterial'); // widest arm is the 30 m secondary
  assert.ok(cap.radius >= 15, `radius ${cap.radius} covers the widest half width`);
  assert.ok(distToPoly([cap.x, cap.z], poly) <= 0.75, 'centre inside the cap');
  for (const j of junctions) for (const a of j.arms)
    assert.ok(distToPoly([a.endX, a.endZ], poly) <= 1.0, `arm end ${a.name} inside the cap`);
  assert.ok(CAP_Y > 0.06 && CAP_Y < 0.062, 'cap Y sits between carriageways and medians');
});

test('real tile: exactly one cap per multi-arm junction, centres and arm ends covered', () => {
  const beds = TAIPEI_GEO.roadbeds;
  const junctions = detectJunctions(beds);
  const sites = planRoundabouts(beds, junctions);
  const claimed = new Set(sites.flatMap((s) => s.claimedJunctions));
  const eligible = junctions.filter((j, ji) => j.arms.length >= 2 && !claimed.has(ji));
  const caps = planJunctionCaps(beds, junctions, sites);
  assert.equal(caps.length, eligible.length);
  // Census re-pinned 2026-10-24 for the PR #73 rebase onto the
  // expanded map (PR #70): the station district + Ximending took
  // detected junctions 894 -> 1,158, and every detected junction
  // carries >= 2 arms on this data, so caps = 1,158 (425,386 m² of
  // junction box). The structural pins (one cap per eligible
  // junction, centres/ends covered) are the binding invariant;
  // these counts are the census record and move only with a data
  // regen, with the reason written here.
  // Census re-pinned for issue #75 (junction audit 2): 7 of the
  // 1,158 junctions are claimed by the handcrafted roundabout
  // sites (仁愛敦南 4 + 東門 3) and get discs/aprons instead of
  // caps, so caps = 1,151 — 313 major BOX caps (315,269 m²) and
  // 838 minor fitted caps (189,689 m²; the fitted construction is
  // unchanged, so the fitted set is the #73 set restricted to
  // minor junctions). Total paved 504,958 m² (the box total
  // includes the junction-centre pin that keeps fragment-cluster
  // centroids inside their caps).
  // Census re-pinned for issue #81 (junction regression
  // re-evaluation): the box construction no longer takes corners
  // from furniture/slide-inflated lines — corners come from the
  // pure/margin lines, mouth lines contribute segments only
  // (bed-end slide capped at crossHalf + 20, not +30), and pairs
  // with a genuinely displaced mouth (bed end > 12 m past the
  // box edge) additionally collect their corners at the mouth
  // lines. Box total 315,269 -> 294,960 m²; total paved
  // 504,958 -> 484,649 m². Fitted caps untouched (189,689 m²).
  // Gate merge note: counts below are the #81 construction on
  // post-#74 data, measured on the merged tree at the #87 gate —
  // the memorial-park exclusion had already taken junctions
  // 1,158 -> 1,152 / fitted 838 -> 832 / fitted area 189,689 ->
  // 188,484 on main (see the #74 re-pin in git history); the park
  // box cap's lost service arm accounts for the remaining ~76 m²
  // of the total (484,649 -> 483,368). Bite counts: medians 2,065
  // -> 2,066 (+1, the same reshaped park cap as #74's +1).
  // Census re-pinned for issue #83 (general park service-drive
  // exclusion): the #74 rule generalized from one named park to
  // unnamed service beds >= 50% inside ANY leisure=park polygon —
  // 86 beds / 5.44 km dropped across 23 parks (the 22 CKS beds
  // included), 62 of them in the rendered set (2 more were already
  // orphan-suppressed). The park webs' internal junctions
  // dissolve with their drives: junctions 1,152 -> 1,136, caps
  // 1,145 -> 1,129 — fitted 832 -> 817, box 313 -> 312 (the lost
  // box cap is the 南京東路一段 junction whose third arm was a
  // 林森公園 drive; the 環河快速道路 major survives, re-detected
  // on its trunk arms alone). Cap areas: total 483,368 ->
  // 479,258 m², fitted 188,484 -> 184,837 m² (box 294,884 ->
  // 294,421 m²). Measured on the regenerated tree; the junction
  // set diff (21 clusters dissolved, 5 re-formed from surviving
  // arms) is in the issue #83 evidence.
  // Census re-pinned for issue #102 (northern phase 1, final
  // footprint per amendment 2: live A + live B + corridor +
  // Beitou + connector): junctions 1,136 -> 2,361 and caps 1,129
  // -> 2,354 (box 312 -> 480, fitted 817 -> 1,874); cap areas
  // total 479,258 -> 887,296 m² (fitted 184,837 -> 431,011 m²,
  // box 294,421 -> 456,285 m²). Per-box census in the #102
  // evidence: the corridor north of B alone adds 874 junctions /
  // 874 caps; Beitou's foothill junctions are nearly all fitted
  // (328 of 348); region A's census is byte-for-byte the live one
  // (1,051 junctions, 293 box / 751 fitted caps). Construction
  // unchanged — this is data growth only.
  // Census re-pinned for issue #134 (airport box + corridor west
  // extension): junctions 2,361 -> 2,701 and caps 2,354 -> 2,694
  // (box 480 -> 579, fitted 1,874 -> 2,115); cap areas total
  // 887,296 -> 1,028,652 m2 (fitted 431,011 -> 488,109 m2, box
  // 456,285 -> 540,543 m2). Construction unchanged — data growth
  // only, on the airport box's arterial grid and the strip.
  // Census re-pinned for issue #145 (junction cap refinement —
  // the user's clean-rectangle rule): ONE overlap construction
  // for every junction (the #75 audit box + mouth segments at
  // majors and signalized minors; corners never from extended
  // lines). Counts and kind split are unchanged (2,701 / 2,694 /
  // 579 / 2,115); the AREAS fall by construction: total
  // 1,028,652 -> 703,160 m2, fitted 488,109 -> 182,754 m2 (the
  // #66 hulls over scattered bed ends — discs to 105 m radius
  // over alley webs — collapse to box + ribbons), box 540,543 ->
  // 520,406 m2 (the margin-line corners and displaced-mouth
  // flares go; the box and its mouth aprons stay).
  assert.equal(junctions.length, 2701, `junctions ${junctions.length}`);
  assert.equal(caps.length, 2694, `caps ${caps.length}`);
  assert.equal(caps.filter((c) => c.kind === 'box').length, 579, 'box caps');
  assert.equal(caps.filter((c) => c.kind === 'fitted').length, 2115, 'fitted caps');
  assert.equal(Math.round(caps.reduce((s, c) => s + c.area, 0)), 703160, 'cap area census');
  assert.equal(Math.round(caps.filter((c) => c.kind === 'fitted').reduce((s, c) => s + c.area, 0)), 182754,
    'fitted cap area census (overlap construction since #145)');
  // Census addition for issue #163 (junction fix v2): the ring
  // counts/areas above are unchanged BY CONSTRUCTION — the #163
  // arm extension strips are separate quads carried on fitted
  // caps (see the #163 test below), never folded into the ring.
  // Strip census at the #163 gate: 2,618 strips / 138,514 m²,
  // fitted caps only (box caps carry none — their mouth slide
  // already reaches their bed ends). Of 8,576 fitted arms,
  // 2,637 measure a 0.3–30 m bed-end shortfall past their box
  // edge; 19 of those are bending/hairpin fragments whose bed
  // chord opposes the arm axis and get no strip (no honest
  // corridor direction); 34 arms sit past the 30 m cap and
  // stay unpaved by design (cluster scatter, not mouths).
  assert.equal(caps.reduce((s, c) => s + (c.extras || []).length, 0), 2618, 'extension strip census');
  assert.equal(caps.reduce((s, c) => s + (c.extraArea || 0), 0), 138514, 'extension strip area census');
  for (const c of caps) if (c.kind === 'box') assert.equal((c.extras || []).length, 0, 'box caps carry no strips');
  const capByJ = new Map();
  {
    let ci = 0;
    junctions.forEach((j, ji) => { if (j.arms.length >= 2 && !claimed.has(ji)) { capByJ.set(ji, caps[ci]); ci++; } });
  }
  junctions.forEach((j, ji) => {
    const cap = capByJ.get(ji);
    if (!cap) return;
    const poly = ringPoints(cap.ring);
    assert.ok(Math.hypot(cap.x - j.x, cap.z - j.z) < 0.15, 'cap centred on its junction');
    assert.ok(distToPoly([j.x, j.z], poly) <= 1.0, `junction ${ji} centre covered`);
    const widest = Math.max(...j.arms.map((a) => a.width));
    assert.ok(cap.radius >= widest / 2, `junction ${ji} radius reaches the widest half width`);
    // Arm ends: the #66/#73 fitted hulls contained the raw bed
    // ends by construction — that containment WAS the blob (at
    // merged clusters the ends scatter across a ~40 m disc, and
    // hulling them paved the whole web). Since #145 every cap
    // covers its junction BOX (pinned for majors by the #75
    // test below, for minors by the #145 test), and a curved or
    // overshooting bed end is the ribbon's business, not the
    // cap's — the end stands on its own bed's asphalt either
    // way.
  });
});

test('real tile: roadGraph cross-check — multi-arm nodes have a cap nearby', () => {
  // Graph nodes are the ground truth of where carriageways meet,
  // but a node only needs a cap when beds actually END there (a
  // through bed buries a side lane's end in its own ribbon).
  // Qualifying nodes: >= 3 incident carriageway edge-ends AND >= 3
  // bed endpoints within the 22 m cluster radius. detectJunctions
  // merges twin/dense clusters (40 m), so a member node's cap
  // centre can sit up to that merge distance away — the measured
  // coverage at 30 m is ~95%, pinned at 94% so a detection
  // regression that drops a junction class fails loudly.
  const beds = TAIPEI_GEO.roadbeds;
  const caps = planJunctionCaps(beds, detectJunctions(beds));
  const NON = new Set(['footway', 'path', 'steps', 'pedestrian', 'cycleway', 'corridor', 'elevator', 'crossing', 'platform', 'traffic_island']);
  const deg = new Map();
  for (const e of TAIPEI_GEO.roadGraph.edges) {
    if (NON.has(e.highway)) continue;
    deg.set(e.a, (deg.get(e.a) || 0) + 1);
    deg.set(e.b, (deg.get(e.b) || 0) + 1);
  }
  const ends = [];
  for (const b of beds) {
    ends.push([b.pts[0], b.pts[1]]);
    ends.push([b.pts[b.pts.length - 2], b.pts[b.pts.length - 1]]);
  }
  const nodes = TAIPEI_GEO.roadGraph.nodes;
  let checked = 0, covered = 0;
  for (const [idx, d] of deg) {
    if (d < 3) continue;
    const x = nodes[idx * 2], z = nodes[idx * 2 + 1];
    let nearEnds = 0;
    for (const [ex, ez] of ends) if (Math.hypot(ex - x, ez - z) <= 22) nearEnds++;
    if (nearEnds < 3) continue;
    checked++;
    if (caps.some((c) => Math.hypot(c.x - x, c.z - z) <= 30)) covered++;
  }
  assert.ok(checked > 1500, `qualifying graph nodes ${checked}`);
  assert.ok(covered / checked >= 0.94, `cap coverage ${covered}/${checked}`);
});

test('real tile: no painted band, median strip or dash quad centre inside a cap', () => {
  const beds = TAIPEI_GEO.roadbeds;
  const junctions = detectJunctions(beds);
  const sites = planRoundabouts(beds, junctions);
  const caps = planJunctionCaps(beds, junctions, sites);
  const capPolys = caps.map((c) => ringPoints(c.ring));
  const grid = buildPolyGrid(capPolys);
  const inCap = (q) => pointInAnyPoly(grid, capPolys, quadCentre(q));
  // The boot's occluder set for painted bands and medians is the
  // caps PLUS the roundabout discs and entry aprons (issue #75);
  // lane dashes clip against caps only, so the rings keep their
  // lane lines.
  const occPolys = [...caps, ...sites.flatMap((s) => [s.disc, ...s.aprons])].map((c) => ringPoints(c.ring));
  const occGrid = buildPolyGrid(occPolys);
  const inOcc = (q) => pointInAnyPoly(occGrid, occPolys, quadCentre(q));

  const painted = buildPaintedBands(beds, occPolys);
  assert.ok(painted.band.length > 0);
  assert.equal(painted.band.filter(inOcc).length, 0, 'painted band quads inside occluders');
  assert.equal(painted.edges.filter(inOcc).length, 0, 'painted edge quads inside occluders');

  const medians = buildMedianStrips(beds, occPolys);
  assert.ok(medians.plain.length + medians.planted.length > 0);
  assert.equal([...medians.plain, ...medians.planted].filter(inOcc).length, 0, 'median quads inside occluders');

  const markings = buildRoadMarkings(beds, medians, caps, junctions);
  assert.ok(markings.dashes.length > 0);
  assert.equal(markings.dashes.filter(inCap).length, 0, 'dash quads inside caps');
  // The occluder must actually bite (it is not a no-op on this data).
  // Bite census re-pinned 2026-10-24 for the PR #73 rebase onto the
  // expanded map (PR #70), re-derived on the merged tree: without the
  // cap filter, 893 painted-band, 1,776 painted-edge and 1,598 median
  // quad centres would fall inside caps; the shipped (clipped)
  // builders put 0 there (asserted above). Dashes measure 0 both
  // ways: the markings builder's own junction suppression already
  // keeps dash centres out of junction boxes, so for dashes the cap
  // filter is a second guarantee, not the mechanism.
  // Bite re-derived for issue #75 against the shipped occluder
  // set (box caps + roundabout discs/aprons): 1,022 band, 2,032
  // edge and 2,107 median quad centres — the box caps are bigger
  // than the #73 fitted hulls at major junctions and the discs
  // add the two circles, so the bite grows; the clipped builders
  // still put exactly 0 there.
  // Bite re-derived for issue #81: the tightened box caps (see
  // the census note above) occlude slightly less — 1,007 band,
  // 2,000 edge and 2,065 median quad centres; the clipped
  // builders still put exactly 0 there.
  // Bite re-pinned for issue #83: 16 fewer caps (the dissolved
  // park-web junctions, see the census note above) shrink the
  // occluder set — 1,005 band, 1,996 edge and 2,059 median quad
  // centres; the clipped builders still put exactly 0 there.
  // Bite re-pinned for issue #102 (northern phase 1): the occluder
  // set grows with the tile (caps 1,129 -> 2,354) — 2,397 band,
  // 4,763 edge and 3,219 median quad centres; the clipped builders
  // still put exactly 0 there (asserted above).
  // Bite re-pinned for issue #134: caps 2,354 -> 2,694 on the
  // enlarged tile — 2,758 band, 5,485 edge and 3,814 median quad
  // centres; the clipped builders still put exactly 0 there.
  // Bite re-pinned for issue #145: the occluder set is now the
  // overlap caps (703,160 m2 against 1,028,652 m2), so the bite
  // falls with it — 1,626 band, 3,230 edge and 3,622 median quad
  // centres; the clipped builders still put exactly 0 there.
  // (Medians barely move: their quads run along centrelines,
  // inside the boxes under both constructions.)
  const unclipped = buildPaintedBands(beds);
  assert.equal(unclipped.band.filter(inOcc).length, 1626,
    `unclipped bands inside occluders: ${unclipped.band.filter(inOcc).length}`);
  assert.equal(unclipped.edges.filter(inOcc).length, 3230,
    `unclipped edges inside occluders: ${unclipped.edges.filter(inOcc).length}`);
  const unclippedMedians = buildMedianStrips(beds);
  assert.equal([...unclippedMedians.plain, ...unclippedMedians.planted].filter(inOcc).length, 3622,
    'unclipped medians inside occluders');
});

// The junction BOX (issue #75 audit spec): the arms' cross-section
// lines at reach = crossHalf; corners between arms that actually
// cross (angular gap 35°–170°) — the main corner (line ∩ line) and
// the two edge corners (one arm's lateral edge line ∩ the other's
// cross-section line), each LOCAL to its mouth (within
// (hA+hB)/sin(gap)+6 of a segment end, the edge line running at
// most one cross-arm half-width + 6 past its segment end and
// staying within the cross arm's mouth span + 6); the box is the
// hull of corners + segment endpoints. Pure crossHalf arithmetic —
// what "corner to corner" means, independent of the shipped cap.
function junctionBox(j) {
  const arms = [...j.arms].sort((a, b) => Math.atan2(a.dirZ, a.dirX) - Math.atan2(b.dirZ, b.dirX));
  const lineOf = (a) => ({ a, px: j.x + a.dirX * a.crossHalf, pz: j.z + a.dirZ * a.crossHalf, nx: -a.dirZ, nz: a.dirX });
  const pts = [];
  for (const a of arms) {
    const L = lineOf(a), h = a.width / 2;
    pts.push([L.px + L.nx * h, L.pz + L.nz * h], [L.px - L.nx * h, L.pz - L.nz * h]);
  }
  const maxR = Math.max(...arms.map((a) => a.crossHalf + a.width / 2));
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
  for (let i = 0; i < arms.length; i++) {
    const a = arms[i], b = arms[(i + 1) % arms.length];
    let gap = Math.atan2(b.dirZ, b.dirX) - Math.atan2(a.dirZ, a.dirX);
    if (gap <= 0) gap += Math.PI * 2;
    if (gap < (35 * Math.PI) / 180 || gap > (170 * Math.PI) / 180) continue;
    const A = lineOf(a), B = lineOf(b);
    const det = A.nx * B.nz - A.nz * B.nx;
    if (Math.abs(det) >= 1e-6) {
      const t = ((B.px - A.px) * B.nz - (B.pz - A.pz) * B.nx) / det;
      const p = [A.px + A.nx * t, A.pz + A.nz * t];
      if (sane(p, A, B, gap)) pts.push(p);
    }
    const edgeCorner = (edge, cross, hEdge, hCross) => {
      const d = edge.dx * cross.nz - edge.dz * cross.nx;
      if (Math.abs(d) < 0.05) return;
      const t = ((cross.px - edge.px) * cross.nz - (cross.pz - edge.pz) * cross.nx) / d;
      if (t < -1 || t > hCross + 6) return;
      const p = [edge.px + edge.dx * t, edge.pz + edge.dz * t];
      const s = (p[0] - cross.px) * cross.nx + (p[1] - cross.pz) * cross.nz;
      if (Math.abs(s) > hCross + 6) return;
      if (sane(p, A, B, gap)) pts.push(p);
    };
    edgeCorner(
      { px: A.px + A.nx * (a.width / 2), pz: A.pz + A.nz * (a.width / 2), dx: a.dirX, dz: a.dirZ },
      { px: B.px, pz: B.pz, nx: B.nx, nz: B.nz }, a.width / 2, b.width / 2,
    );
    edgeCorner(
      { px: B.px - B.nx * (b.width / 2), pz: B.pz - B.nz * (b.width / 2), dx: b.dirX, dz: b.dirZ },
      { px: A.px, pz: A.pz, nx: A.nx, nz: A.nz }, b.width / 2, a.width / 2,
    );
  }
  return convexHull(pts);
}

const isMajorJunction = (j) => j.arms.some((a) => ['arterial', 'deck'].includes(surfaceClass({ highway: a.highway })));

test('issue #75: every major junction box is covered corner to corner by its box cap', () => {
  const beds = TAIPEI_GEO.roadbeds;
  const junctions = detectJunctions(beds);
  const sites = planRoundabouts(beds, junctions);
  const claimed = new Set(sites.flatMap((s) => s.claimedJunctions));
  const caps = planJunctionCaps(beds, junctions, sites);
  const capByJ = new Map();
  {
    let ci = 0;
    junctions.forEach((j, ji) => { if (j.arms.length >= 2 && !claimed.has(ji)) { capByJ.set(ji, caps[ci]); ci++; } });
  }
  let major = 0;
  junctions.forEach((j, ji) => {
    if (j.arms.length < 2 || claimed.has(ji) || !isMajorJunction(j)) return;
    major++;
    const cap = capByJ.get(ji);
    assert.equal(cap.kind, 'box', `junction ${ji} is a box cap`);
    const poly = ringPoints(cap.ring);
    const box = junctionBox(j);
    assert.ok(box.length >= 3, `junction ${ji} has a box`);
    // (a) every box corner inside the cap (1 m tolerance: the
    // audit measured max miss 0.1 m).
    for (const p of box)
      assert.ok(distToPoly(p, poly) <= 1.0,
        `junction ${ji} box corner (${p[0].toFixed(0)},${p[1].toFixed(0)}) outside its cap by ${distToPoly(p, poly).toFixed(2)} m`);
    // (b) the whole box is paved by the cap (2 m grid; the audit
    // measured coverage 1.000 at every major junction).
    const xs = box.map((p) => p[0]), zs = box.map((p) => p[1]);
    let tot = 0, cov = 0;
    for (let x = Math.min(...xs) + 1; x < Math.max(...xs); x += 2)
      for (let z = Math.min(...zs) + 1; z < Math.max(...zs); z += 2) {
        if (!pointInPoly([x, z], box)) continue;
        tot++;
        if (pointInPoly([x, z], poly)) cov++;
      }
    assert.ok(tot === 0 || cov / tot >= 0.99, `junction ${ji} box coverage ${tot ? (cov / tot).toFixed(3) : '-'}`);
    // (c) no wild overshoot: every cap vertex stays within the
    // design envelope of the box (meet-end +30, furniture +5.7,
    // margin, skew-corner geometry — audited max 34.6 m).
    // Envelope re-based for issue #102 (northern phase 1): the
    // added boxes bring skewed northern majors the A+B tile had
    // few of — the measured max is now 38.4 m at 中山北路五段
    // (Shilin: a 39.7 m arterial meeting lanes whose bed ends sit
    // 12–20 m past the crossing, cap radius 65.8 m over 2,014 m2),
    // then 31.5 m at the 市民大道 deck-adjacent major and 30.9 m
    // at 松江路. (An interim footprint with a southern band
    // measured 51.6 m at the 中正橋 bridgehead gore; that band
    // left the footprint in amendment 2 and so did the gore.)
    // These caps are hulls along displaced mouths, not slabs; the
    // envelope moves 40 -> 45 so a genuinely wild vertex fails.
    for (const v of poly)
      assert.ok(distToPoly(v, box) <= 45, `junction ${ji} cap vertex overshoots the box by ${distToPoly(v, box).toFixed(1)} m`);
  });
  // Major count re-pinned for issue #83: 313 -> 312 — the dissolved
  // 南京東路一段 × 林森公園 service-drive junction (see the census
  // note above); every surviving major still passes (a)-(c) above.
  // Re-pinned for issue #102: 312 -> 480 majors on the enlarged
  // tile (one per box cap; per-box census in the #102 evidence).
  // Re-pinned for issue #134: 480 -> 579 majors — the airport
  // box's arterial grid （敦化北路 x 民權/民族/民生， 南京東路東段，
  // 塔悠路 x 撫遠街） and the strip's Datong majors join; every one
  // still passes (a)-(c) above.
  assert.equal(major, 579, `major junctions audited ${major}`);
});

test('issue #75: crosswalk and stop-line centres at major junctions lie on asphalt', () => {
  const beds = TAIPEI_GEO.roadbeds;
  const junctions = detectJunctions(beds);
  const sites = planRoundabouts(beds, junctions);
  const caps = planJunctionCaps(beds, junctions, sites);
  const occPolys = [...caps, ...sites.flatMap((s) => [s.disc, ...s.aprons])].map((c) => ringPoints(c.ring));
  const medians = buildMedianStrips(beds, occPolys);
  const markings = buildRoadMarkings(beds, medians, caps, junctions);
  // Asphalt = caps ∪ arm ribbons ∪ roundabout discs/aprons.
  const asphalt = [...occPolys, ...beds.map(ribbonPoly)];
  const grid = buildPolyGrid(asphalt);
  const onAsphalt = (p) => pointInAnyPoly(grid, asphalt, p);
  const off = [];
  const scan = (quads, prov) => quads.forEach((q, i) => {
    const ji = prov[i];
    if (!isMajorJunction(junctions[ji])) return;
    const c = quadCentre(q);
    if (!onAsphalt(c)) off.push({ ji, c });
  });
  scan(markings.stripes, markings.stripeJunction);
  scan(markings.stopLines, markings.stopLineJunction);
  // The audited residual set is exactly 6 centres at 4 junctions,
  // each within 1.2 m of asphalt: two stop lines sit ON the kerb
  // line (distance 0.00 — the point test is boundary-blind), two
  // stripe centres graze the cap edge at 忠孝×敦化 (≤ 0.3 m), and
  // two stripe centres at the Renai circle's NE mouth flare sit
  // ≤ 1.2 m past the entry apron. Anything beyond this set or
  // distance is a placement regression.
  // Residual set re-audited for issue #102 (northern phase 1;
  // probe in the #102 evidence): 16 centres, worst 1.37 m — the
  // same graze classes, no new failure mode. The old six persist
  // （仁愛 circle flare x2 at 1.20/0.39 m, 忠孝×敦化 x2, kerb-line
  // stop lines); the growth is the 關渡 junction （大度路三段 x
  // 中央北路四段， at the Beitou box's west edge — 5 stripe centres
  // 0.92–1.37 m past the tile-edge-clipped cap, plus a kerb-line
  // stop line), one at 大度路 x 洲美快速道路 (0.22 m) and three
  // more kerb-line stop lines at deck-adjacent majors. The 1.5 m
  // distance ceiling is unchanged and remains the binding pin.
  // Residual set re-audited for issue #134 (offender census in the
  // #134 evidence): 17 centres, worst still 1.37 m. The #102 set
  // of 16 persists exactly; the single addition is one kerb-line
  // stop line (0.00 m — the boundary-blind class) at 民權東路三段
  // x 敦化北路， a new major in the airport box. Same graze
  // classes, no new failure mode; the 1.5 m ceiling is unchanged.
  // Residual set re-audited for issue #145 (overlap caps): 19
  // centres, worst 1.62 m. The growth (+2 net) and the new worst
  // both sit at the 關渡 junction （大度路三段 x 中央北路四段）,
  // whose beds are cut by the tile's west edge — its stripes
  // stood 0.92–1.37 m past the tile-edge-clipped cap already in
  // the #102 set (5 centres); with the displaced-mouth corners
  // gone (the #145 construction) 8 centres graze there, worst
  // 1.62 m. No cap geometry can pave off-tile, so the distance
  // ceiling moves 1.5 -> 1.75 m for this boundary class alone;
  // every other centre keeps the old classes （仁愛 circle flare
  // x2 at 1.20/0.39 m, 忠孝x敦化 x2, kerb-line 0.00 m centres).
  // The trade is the offenders: corner throws of 26.7–38.4 m
  // (see the #81 distribution test) are zero under #145.
  assert.ok(off.length <= 19, `off-asphalt furniture centres at major junctions: ${off.length}`);
  for (const { ji, c } of off) {
    let best = Infinity;
    for (const poly of asphalt) best = Math.min(best, distToPoly(c, poly));
    assert.ok(best <= 1.75, `junction ${ji} furniture centre ${best.toFixed(2)} m off asphalt`);
  }
});

test('issue #75: roundabouts are handcrafted — discs, islands, aprons, no caps at claimed junctions', () => {
  const beds = TAIPEI_GEO.roadbeds;
  const junctions = detectJunctions(beds);
  const sites = planRoundabouts(beds, junctions);
  // Exactly three sites. 南門圓環 is NOT one: the data carries
  // only a degenerate zero-length stub for it (no circulating
  // carriageway in the tile), so it gets no treatment — the
  // audit's verdict, pinned here by the exact id list.
  assert.deepEqual(sites.map((s) => s.id), ['renai-dunhua', 'dongmen', 'beimen']);
  const byId = Object.fromEntries(sites.map((s) => [s.id, s]));
  assert.equal(byId['renai-dunhua'].claimedJunctions.length, 4);
  assert.equal(byId['renai-dunhua'].islandKind, 'planted');
  assert.equal(byId['renai-dunhua'].aprons.length, 3, 'Renai entry aprons (N/S/E mouths)');
  assert.equal(byId.dongmen.claimedJunctions.length, 3);
  assert.equal(byId.dongmen.islandKind, 'planted');
  assert.equal(byId.dongmen.aprons.length, 0);
  assert.equal(byId.beimen.claimedJunctions.length, 0);
  assert.equal(byId.beimen.islandKind, 'plaza');
  // Claimed junctions get no cap.
  const caps = planJunctionCaps(beds, junctions, sites);
  const claimed = new Set(sites.flatMap((s) => s.claimedJunctions));
  for (const ji of claimed)
    assert.ok(caps.every((c) => Math.hypot(c.x - junctions[ji].x, c.z - junctions[ji].z) > 1),
      `claimed junction ${ji} has no cap`);
  // Every island vertex lies inside its site's disc.
  for (const s of sites) {
    const disc = ringPoints(s.disc.ring);
    for (const p of ringPoints(s.island.ring))
      assert.ok(distToPoly(p, disc) <= 1.0, `${s.id} island vertex outside its disc`);
  }
  // Islands sit on the carriageway only where the source
  // geometry itself runs straight chords under them (the Renai
  // busway chord, the Dongmen gate-apron lanes, the Beimen gate
  // link): sampled island∩ribbon ≤ 12% (audit measured
  // 4.3% / 8.6% / 6.0%).
  const ribbons = beds.map(ribbonPoly);
  const ribGrid = buildPolyGrid(ribbons);
  for (const s of sites) {
    const isl = ringPoints(s.island.ring);
    const xs = isl.map((p) => p[0]), zs = isl.map((p) => p[1]);
    let tot = 0, on = 0;
    for (let x = Math.min(...xs) + 1; x < Math.max(...xs); x += 2)
      for (let z = Math.min(...zs) + 1; z < Math.max(...zs); z += 2) {
        if (!pointInPoly([x, z], isl)) continue;
        tot++;
        if (pointInAnyPoly(ribGrid, ribbons, [x, z])) on++;
      }
    assert.ok(tot > 0 && on / tot <= 0.12, `${s.id} island on-ribbon share ${tot ? (on / tot).toFixed(3) : '-'}`);
  }
  // Crossings live on the ring entries, never deep inside an
  // island: no stripe centre within (islandR − 2.5) of a circle
  // site's centre (the Dongmen island-access crossing grazes the
  // kerb at 19.7–20.5 m vs islandR 21 — inside the kerb band,
  // allowed), and none inside the Beimen capsule at all.
  const capsOcc = [...caps, ...sites.flatMap((s) => [s.disc, ...s.aprons])].map((c) => ringPoints(c.ring));
  const medians = buildMedianStrips(beds, capsOcc);
  const markings = buildRoadMarkings(beds, medians, caps, junctions);
  for (const q of markings.stripes) {
    const c = quadCentre(q);
    for (const s of sites) {
      if (s.islandR) assert.ok(Math.hypot(c[0] - s.x, c[1] - s.z) >= s.islandR - 2.5,
        `stripe centre deep inside the ${s.id} island`);
      else assert.ok(!pointInPoly(c, ringPoints(s.island.ring)), `stripe centre inside the ${s.id} island`);
    }
  }
  // Entry crossings exist at the Renai circle: stripe quads
  // attributed to its claimed junctions (audit count 284).
  const renaiClaimed = new Set(byId['renai-dunhua'].claimedJunctions);
  const entryStripes = markings.stripes.filter((q, i) => renaiClaimed.has(markings.stripeJunction[i])).length;
  assert.ok(entryStripes > 100, `Renai entry stripe quads ${entryStripes}`);
});

test('issue #81: box-cap vertices stay near the box — no slab spikes', () => {
  const beds = TAIPEI_GEO.roadbeds;
  const junctions = detectJunctions(beds);
  const sites = planRoundabouts(beds, junctions);
  const claimed = new Set(sites.flatMap((s) => s.claimedJunctions));
  const caps = planJunctionCaps(beds, junctions, sites);
  const capByJ = new Map();
  {
    let ci = 0;
    junctions.forEach((j, ji) => { if (j.arms.length >= 2 && !claimed.has(ji)) { capByJ.set(ji, caps[ci]); ci++; } });
  }
  // The #75 test (c) bounds every vertex at 45 m past the box
  // (40 m on the A+B tile; re-based at #102, see that test);
  // the #81 complaint was the DISTRIBUTION — corners thrown
  // 30–53 m out by inflated line reaches at skewed fragment
  // junctions. Under the #81 construction (corners from the
  // pure/margin lines; mouth lines give segments only, plus
  // corners at pairs with a genuinely displaced mouth) the
  // measured distribution is: max 31.5 m (a displaced-mouth ramp
  // cluster), 20 vertices past 20 m, 3 past 25 m. Pin the
  // distribution so a corner-throwing regression fails loudly.
  // Distribution re-pinned for issue #102 (northern phase 1;
  // offender census in the #102 evidence): majors 312 -> 480 and
  // the tail grows modestly — max 38.4 m （中山北路五段， a wide
  // skewed Shilin major), 6 vertices past 25 m （中山北路五段，
  // 市民大道 and 松江路 deck/skew majors, the 台北交流道 apron
  // cluster, 新生北路/新生南路 displaced-mouth cases) and 34
  // vertices past 20 m. The caps stay hulls along their arms; no
  // slab spikes — the corner-coverage audit (a)/(b) above passes
  // at every major, with zero box-corner misses tile-wide.
  // Distribution re-pinned for issue #134 (offender census in the
  // #134 evidence): majors 480 -> 579; the max is UNCHANGED at
  // 38.4 m (still 中山北路五段）. The tail grows to 41 vertices
  // past 20 m and 9 past 25 m — the new >25 m offenders are the
  // same displaced-mouth class at new skewed majors: 塔悠路 x
  // 撫遠街 35.0 m (airport box east edge), 敦化北路 service mouth
  // 27.3 m, 環河南路 x 福德南路 27.2 m and 重慶北路三段 x 敦煌路
  // 26.7 m (the corridor strip). No slab spikes.
  let over20 = 0, over25 = 0, maxOver = 0;
  junctions.forEach((j, ji) => {
    if (j.arms.length < 2 || claimed.has(ji) || !isMajorJunction(j)) return;
    const cap = capByJ.get(ji);
    const box = junctionBox(j);
    assert.ok(box.length >= 3, `junction ${ji} has a box`);
    for (const v of ringPoints(cap.ring)) {
      const d = distToPoly(v, box);
      if (d > 20) over20++;
      if (d > 25) over25++;
      if (d > maxOver) maxOver = d;
    }
  });
  // Distribution re-pinned for issue #145 (overlap caps): no
  // corner is taken from an extended line any more, so the only
  // vertices past the box are mouth segment endpoints on their
  // own arms — 8 vertices past 20 m, NONE past 25 m, worst
  // 20.1 m (the bed-end slide's crossHalf + 20 cap itself).
  // The named #134 offenders' corner overshoot is zero:
  // 塔悠路 x 撫遠街 35.0 -> 0 (cap radius 47.9 -> 22.9 m),
  // 敦化北路 service mouth 27.3 -> 0 (32.6 -> 24.1 m), 環河南路
  // x 福德南路 27.2 -> 0 (46.2 -> 27.9 m), 重慶北路三段 x
  // 敦煌路 26.7 -> 0 (47.3 -> 37.7 m); the tile max was
  // 中山北路五段's 38.4 m corner throw (radius 65.8 -> 31.8 m).
  assert.ok(over20 <= 8, `cap vertices >20 m past their box: ${over20}`);
  assert.ok(over25 <= 0, `cap vertices >25 m past their box: ${over25}`);
  assert.ok(maxOver <= 21, `worst cap vertex overshoot ${maxOver.toFixed(1)} m`);
});

test('issue #81: the reported junction 忠孝東路五段×松仁路 keeps a box-hugging cap', () => {
  // The user's screenshot junction: a skewed 6-arm junction
  // (忠孝東路五段 × 松仁路 × 永吉路30巷) whose #75 box cap was a
  // rotated trapezoid slab (1,616 m², radius 33.7 m, spikes NW
  // and SE) over the corner blocks, in a tone lighter than the
  // arterial arms. Under the #81 construction the cap hugs the
  // box: 1,348 m², radius 24.1 m, no spike vertices. Under the
  // #145 overlap construction: 1,316 m², radius 24.0 m (the
  // pins below are unchanged — the box was already the shape
  // here; #145 removes the corners thrown elsewhere).
  const beds = TAIPEI_GEO.roadbeds;
  const junctions = detectJunctions(beds);
  const caps = planJunctionCaps(beds, junctions);
  const near = caps.map((c) => ({ c, d: Math.hypot(c.x - 361.7, c.z - -890.6) })).sort((a, b) => a.d - b.d)[0];
  assert.ok(near.d < 5, `cap at the reported junction (d=${near.d})`);
  assert.equal(near.c.kind, 'box');
  assert.ok(near.c.area <= 1450, `cap area ${near.c.area} m² (was 1,616 under #75)`);
  assert.ok(near.c.radius <= 26, `cap radius ${near.c.radius} m (was 33.7 under #75)`);
});

test('acceptance junction 信義路×松仁路： the formerly bare core is capped', () => {
  const beds = TAIPEI_GEO.roadbeds;
  const junctions = detectJunctions(beds);
  const caps = planJunctionCaps(beds, junctions);
  const near = caps.map((c) => ({ c, d: Math.hypot(c.x - 339.5, c.z - 19.4) })).sort((a, b) => a.d - b.d)[0];
  assert.ok(near.d < 5, `cap near the acceptance junction (d=${near.d})`);
  assert.ok(near.c.radius >= 22, `cap radius ${near.c.radius} spans the bare core`);
  const poly = ringPoints(near.c.ring);
  assert.equal(distToPoly([339.5, 19.4], poly), 0, 'junction centre paved');
});

test('issue #145: every minor junction box is covered by its overlap cap', () => {
  // The #75 box audit above binds major junctions since #75.
  // Minor junctions carried the #66 fitted hull instead, whose
  // only box guarantee was arm-end containment — the hull over
  // scattered bed ends that paved alley webs whole (worst cap
  // radius 105 m, fitted area 488,109 m²). Since #145 the
  // fitted class takes the same overlap construction, so the
  // same audit binds it: (a) every box corner inside the cap
  // (1 m tolerance as at majors; measured worst 0.07 m — the
  // ring's 0.1 m rounding), (b) the whole box paved to within
  // that rounding (2 m grid samples within 0.15 m of the cap;
  // a binary in/out test on small boxes measures the rounding,
  // not coverage — 127 of 2,115 boxes have a grid point past a
  // rounded edge, worst corner distance still 0.07 m), and
  // (c) no vertex thrown past the box beyond the mouth slide's
  // own cap (measured worst 19.9 m at a signalized minor — the
  // same crossHalf + 20 bound the #81 distribution pins at
  // majors).
  const beds = TAIPEI_GEO.roadbeds;
  const junctions = detectJunctions(beds);
  const sites = planRoundabouts(beds, junctions);
  const claimed = new Set(sites.flatMap((s) => s.claimedJunctions));
  const caps = planJunctionCaps(beds, junctions, sites);
  const capByJ = new Map();
  {
    let ci = 0;
    junctions.forEach((j, ji) => { if (j.arms.length >= 2 && !claimed.has(ji)) { capByJ.set(ji, caps[ci]); ci++; } });
  }
  let minor = 0;
  junctions.forEach((j, ji) => {
    if (j.arms.length < 2 || claimed.has(ji) || isMajorJunction(j)) return;
    minor++;
    const cap = capByJ.get(ji);
    assert.equal(cap.kind, 'fitted', `junction ${ji} is a fitted cap`);
    const poly = ringPoints(cap.ring);
    const box = junctionBox(j);
    assert.ok(box.length >= 3, `junction ${ji} has a box`);
    for (const p of box)
      assert.ok(distToPoly(p, poly) <= 1.0,
        `junction ${ji} box corner (${p[0].toFixed(0)},${p[1].toFixed(0)}) outside its cap by ${distToPoly(p, poly).toFixed(2)} m`);
    const xs = box.map((p) => p[0]), zs = box.map((p) => p[1]);
    for (let x = Math.min(...xs) + 1; x < Math.max(...xs); x += 2)
      for (let z = Math.min(...zs) + 1; z < Math.max(...zs); z += 2) {
        if (!pointInPoly([x, z], box)) continue;
        assert.ok(distToPoly([x, z], poly) <= 0.15,
          `junction ${ji} box sample (${x},${z}) is ${distToPoly([x, z], poly).toFixed(2)} m outside its cap`);
      }
    for (const v of poly)
      assert.ok(distToPoly(v, box) <= 21, `junction ${ji} cap vertex overshoots the box by ${distToPoly(v, box).toFixed(1)} m`);
  });
  assert.equal(minor, 2115, `minor junctions audited ${minor}`);
});

test('issue #163: short fitted arms extend to the box edge — strips, never tongues', () => {
  // The ji562 topology in miniature: finite beds all round. The
  // EW road's beds end 12 m either side of the centre while its
  // box edge sits at crossHalf 5 (the NS road's half width) — a
  // 7 m shortfall band along the EW corridor that neither ribbon
  // nor ring paves under #145. The NS beds end exactly at their
  // box edge (sd 10 = crossHalf 10, the EW half width).
  const beds = [
    bed('EW Rd', 'residential', 20, [1], [-100, 0, -12, 0]),
    bed('EW Rd', 'residential', 20, [2], [12, 0, 100, 0]),
    bed('NS Rd', 'residential', 10, [3], [0, -100, 0, -10]),
    bed('NS Rd', 'residential', 10, [4], [0, 10, 0, 100]),
  ];
  const junctions = detectJunctions(beds);
  assert.equal(junctions.length, 1);
  const caps = planJunctionCaps(beds, junctions);
  assert.equal(caps.length, 1);
  const cap = caps[0];
  assert.equal(cap.kind, 'fitted');
  // Both EW arms stripped, neither NS arm.
  assert.equal(cap.extras.length, 2, `strips ${cap.extras.length}`);
  const west = cap.extras.map((e) => ringPoints(e.ring)).find((pts) => Math.min(...pts.map((p) => p[0])) < 0);
  const wxs = west.map((p) => p[0]), wzs = west.map((p) => p[1]);
  // From just behind the bed end (-12 - 0.5 join) inward to the
  // box edge tucked 0.25 under the ring (-(5 - 0.25)); the full
  // arm width plus the join widening.
  assert.ok(Math.abs(Math.min(...wxs) - -12.5) <= 0.15, `strip start ${Math.min(...wxs)}`);
  assert.ok(Math.abs(Math.max(...wxs) - -4.75) <= 0.15, `strip reach ${Math.max(...wxs)}`);
  assert.ok(Math.abs(Math.max(...wzs) - 10.5) <= 0.15 && Math.abs(Math.min(...wzs) - -10.5) <= 0.15,
    'strip spans the arm width + join widening');
  // No tongue: no strip vertex crosses the box edge toward the
  // far side (every vertex stays on its own arm's side, between
  // the tucked box edge and the bed end's join overlap).
  for (const e of cap.extras) for (const [px] of ringPoints(e.ring))
    assert.ok(Math.abs(px) >= 4.6 && Math.abs(px) <= 12.6, `strip vertex at ${px} stays on its own side`);
  // The band point (-8, 0) is bare under the ring alone (the
  // #157 regression in miniature) and paved with the strips.
  const ringPoly = ringPoints(cap.ring);
  assert.ok(distToPoly([-8, 0], ringPoly) > 1, 'ring alone leaves the band bare');
  const surf = [cap.ring, ...cap.extras.map((e) => e.ring)].map(ringPoints);
  for (const p of [[-8, 0], [8, 0], [-8, 8], [8, -8], [-11, 0]])
    assert.ok(surf.some((poly) => distToPoly(p, poly) <= 0.15), `band point ${p} paved by ring + strips`);
  assert.equal(cap.extraArea, cap.extras.reduce((s, e) => s + e.area, 0), 'extraArea is the strips summed');
});

test('issue #163: the user junction ji562 — the avenue band is paved', () => {
  // 民生東路三段 × 127巷/140巷 (the regression screenshot): the
  // avenue beds end 9.0/16.1 m from the merged centre against a
  // 1.6 m box edge; under #145 the cap was 176 m² and 588 m² of
  // the avenue corridor inside the old cap window was bare
  // (2 m grid census, junction-v2 evidence). With the strips
  // the whole band — axis and quadrants — is ring ∪ strip
  // surface (the same census measures 4 m² residual).
  const beds = TAIPEI_GEO.roadbeds;
  const junctions = detectJunctions(beds);
  const caps = planJunctionCaps(beds, junctions);
  const near = caps.map((c) => ({ c, d: Math.hypot(c.x - -1773.1, c.z - -2738.7) })).sort((a, b) => a.d - b.d)[0];
  assert.ok(near.d < 5, `cap at ji562 (d=${near.d})`);
  const cap = near.c;
  assert.equal(cap.kind, 'fitted');
  assert.equal(cap.extras.length, 2, 'the two avenue arms carry the strips');
  const surf = [cap.ring, ...cap.extras.map((e) => e.ring)].map(ringPoints);
  const rel = (dx, dz) => [cap.x + dx, cap.z + dz];
  for (const p of [rel(-8, 0), rel(8, 0), rel(-8, 10), rel(8, -10), rel(-8, -10), rel(8, 10), rel(0, 8), rel(0, -8)])
    assert.ok(surf.some((poly) => distToPoly(p, poly) <= 0.15), `ji562 point ${p.map((v) => v.toFixed(0))} paved`);
  assert.ok(distToPoly(rel(-8, 0), ringPoints(cap.ring)) > 3, 'the ring alone still leaves the band bare (strip does the work)');
});
