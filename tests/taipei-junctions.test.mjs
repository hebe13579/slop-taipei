import assert from 'node:assert/strict';
import test from 'node:test';

import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { pointInPoly, buildPolyGrid, pointInAnyPoly } from '../js/taipei-painted.js';
import { buildPaintedBands } from '../js/taipei-painted.js';
import { buildMedianStrips } from '../js/taipei-surfaces.js';
import { detectJunctions, buildRoadMarkings } from '../js/taipei-markings.js';
import { convexHull, planJunctionCaps, ringPoints, CAP_Y } from '../js/taipei-junctions.js';

// Issue #66 — junction caps. The rules live in js/taipei-junctions.js
// (pure) so these tests pin the exact code the renderer draws with:
// one cap per detected multi-arm junction, the cap containing its
// junction centre and every arm's bed end, the cap tone following
// the widest arm, and the painted layers' hard occlusion — no
// painted band, median strip or lane dash quad centre inside a cap.

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
  const eligible = junctions.filter((j) => j.arms.length >= 2);
  const caps = planJunctionCaps(beds, junctions);
  assert.equal(caps.length, eligible.length);
  // Census re-pinned 2026-10-24 for the PR #73 rebase onto the
  // expanded map (PR #70): the station district + Ximending took
  // detected junctions 894 -> 1,158, and every detected junction
  // carries >= 2 arms on this data, so caps = 1,158 (425,386 m² of
  // junction box). The structural pins (one cap per eligible
  // junction, centres/ends covered) are the binding invariant;
  // these counts are the census record and move only with a data
  // regen, with the reason written here.
  assert.equal(junctions.length, 1158, `junctions ${junctions.length}`);
  assert.equal(caps.length, 1158, `caps ${caps.length}`);
  junctions.forEach((j, ji) => {
    if (j.arms.length < 2) return;
    const cap = caps[junctions.filter((k, ki) => ki <= ji && k.arms.length >= 2).length - 1];
    const poly = ringPoints(cap.ring);
    assert.ok(Math.hypot(cap.x - j.x, cap.z - j.z) < 0.15, 'cap centred on its junction');
    assert.ok(distToPoly([j.x, j.z], poly) <= 1.0, `junction ${ji} centre covered`);
    const widest = Math.max(...j.arms.map((a) => a.width));
    assert.ok(cap.radius >= widest / 2, `junction ${ji} radius reaches the widest half width`);
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
  const caps = planJunctionCaps(beds, junctions);
  const capPolys = caps.map((c) => ringPoints(c.ring));
  const grid = buildPolyGrid(capPolys);
  const inCap = (q) => pointInAnyPoly(grid, capPolys, quadCentre(q));

  const painted = buildPaintedBands(beds, capPolys);
  assert.ok(painted.band.length > 0);
  assert.equal(painted.band.filter(inCap).length, 0, 'painted band quads inside caps');
  assert.equal(painted.edges.filter(inCap).length, 0, 'painted edge quads inside caps');

  const medians = buildMedianStrips(beds, capPolys);
  assert.ok(medians.plain.length + medians.planted.length > 0);
  assert.equal([...medians.plain, ...medians.planted].filter(inCap).length, 0, 'median quads inside caps');

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
  const unclipped = buildPaintedBands(beds);
  assert.equal(unclipped.band.filter(inCap).length, 893,
    `unclipped bands inside caps: ${unclipped.band.filter(inCap).length}`);
  assert.equal(unclipped.edges.filter(inCap).length, 1776,
    `unclipped edges inside caps: ${unclipped.edges.filter(inCap).length}`);
  const unclippedMedians = buildMedianStrips(beds);
  assert.equal([...unclippedMedians.plain, ...unclippedMedians.planted].filter(inCap).length, 1598,
    'unclipped medians inside caps');
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
