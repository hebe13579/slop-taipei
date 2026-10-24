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
  // Census re-pinned for issue #74 (station-district landmarks):
  // the memorial-park service-drive exclusion removed 22 minor
  // service beds inside 中正紀念公園, taking 6 fitted-cap junctions
  // with them — junctions 1,158 -> 1,152, caps 1,151 -> 1,145,
  // fitted 838 -> 832 (box caps unchanged at 313; one box cap by
  // the park loses a service arm and 13 m²). Total paved
  // 503,740 m², fitted 188,484 m².
  assert.equal(junctions.length, 1152, `junctions ${junctions.length}`);
  assert.equal(caps.length, 1145, `caps ${caps.length}`);
  assert.equal(caps.filter((c) => c.kind === 'box').length, 313, 'box caps');
  assert.equal(caps.filter((c) => c.kind === 'fitted').length, 832, 'fitted caps');
  assert.equal(Math.round(caps.reduce((s, c) => s + c.area, 0)), 503740, 'cap area census');
  assert.equal(Math.round(caps.filter((c) => c.kind === 'fitted').reduce((s, c) => s + c.area, 0)), 188484,
    'fitted cap area census (construction unchanged since #73)');
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
    // Arm ends: the fitted cap hulls contain the raw bed ends by
    // construction (#73 pin, measured max distance 0.0). The box
    // cap is axis-true — it covers its junction BOX (pinned by
    // the #75 test below), and a curved or overshooting bed end
    // is the ribbon's business, not the box's.
    if (cap.kind === 'fitted')
      for (const a of j.arms)
        assert.ok(distToPoly([a.endX, a.endZ], poly) <= 2.5,
          `junction ${ji} arm ${a.name} end (${a.endX}, ${a.endZ}) covered by its cap`);
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
  // Bite re-pinned for issue #74: band and edge counts unchanged;
  // medians 2,107 -> 2,108 — the box cap by 中正紀念公園 that lost
  // its service arm (see the census re-pin above) reshaped enough
  // to cover one more unclipped median quad centre. The clipped
  // builders still put exactly 0 there.
  const unclipped = buildPaintedBands(beds);
  assert.equal(unclipped.band.filter(inOcc).length, 1022,
    `unclipped bands inside occluders: ${unclipped.band.filter(inOcc).length}`);
  assert.equal(unclipped.edges.filter(inOcc).length, 2032,
    `unclipped edges inside occluders: ${unclipped.edges.filter(inOcc).length}`);
  const unclippedMedians = buildMedianStrips(beds);
  assert.equal([...unclippedMedians.plain, ...unclippedMedians.planted].filter(inOcc).length, 2108,
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
    for (const v of poly)
      assert.ok(distToPoly(v, box) <= 40, `junction ${ji} cap vertex overshoots the box by ${distToPoly(v, box).toFixed(1)} m`);
  });
  assert.equal(major, 313, `major junctions audited ${major}`);
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
  assert.ok(off.length <= 6, `off-asphalt furniture centres at major junctions: ${off.length}`);
  for (const { ji, c } of off) {
    let best = Infinity;
    for (const poly of asphalt) best = Math.min(best, distToPoly(c, poly));
    assert.ok(best <= 1.5, `junction ${ji} furniture centre ${best.toFixed(2)} m off asphalt`);
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
