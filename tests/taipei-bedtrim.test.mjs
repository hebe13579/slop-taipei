// Issue #389 (C5 graph-first junctions): the bed trim.
// trimBedsAtPolys cuts roadbed centrelines at junction polygons so
// the ribbons and the caps TILE instead of overlapping. These tests
// pin the clip's contract on synthetic geometry; the real-tile
// behaviour (caps, strips, furniture) is pinned by the census
// tests in taipei-junctions.test.mjs and taipei-markings.test.mjs.
import assert from 'node:assert/strict';
import test from 'node:test';

import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { trimBedsAtPolys } from '../js/taipei-bedtrim.js';
import { detectJunctions } from '../js/taipei-markings.js';

const bed = (name, pts, extra = {}) => ({ name, highway: 'residential', width: 6, sourceWayIds: [1], pts, ...extra });
const square = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const flat = (subs) => subs.map((s) => s.pts);

test('trim: a bed straight through a square is cut into two stubs', () => {
  const out = trimBedsAtPolys([bed('EW', [0, 0, 100, 0])], [square(40, -10, 60, 10)]);
  assert.equal(out.length, 2, 'two stubs survive');
  assert.deepEqual(flat(out), [[0, 0, 40, 0], [60, 0, 100, 0]]);
  // Provenance: both stubs point at the parent, with arcs that
  // tile the parent's length.
  assert.equal(out[0].trimParent, 0);
  assert.equal(out[0].trimStartArc, 0);
  assert.equal(out[0].trimEndArc, 40);
  assert.equal(out[1].trimParent, 0);
  assert.equal(out[1].trimStartArc, 60);
  assert.equal(out[1].trimEndArc, 100);
  assert.equal(out[0].trimParentLen, 100);
  assert.equal(out[0].name, 'EW', 'parent metadata survives the cut');
});

test('trim: a bed ending inside a square leaves only its outside stub', () => {
  const out = trimBedsAtPolys([bed('E', [0, 0, 50, 0])], [square(40, -10, 60, 10)]);
  assert.equal(out.length, 1);
  assert.deepEqual(flat(out), [[0, 0, 40, 0]]);
  assert.equal(out[0].trimEndArc, 40);
});

test('trim: a bed wholly inside a square vanishes', () => {
  const out = trimBedsAtPolys([bed('in', [45, 0, 55, 0])], [square(40, -10, 60, 10)]);
  assert.equal(out.length, 0, 'no sub-bed survives');
});

test('trim: a bed outside every polygon comes back intact, with provenance', () => {
  const out = trimBedsAtPolys([bed('far', [0, 100, 100, 100])], [square(40, -10, 60, 10)]);
  assert.equal(out.length, 1);
  assert.deepEqual(flat(out), [[0, 100, 100, 100]]);
  assert.equal(out[0].trimParent, 0);
  assert.equal(out[0].trimStartArc, 0);
  assert.equal(out[0].trimEndArc, 100);
});

test('trim: a bed grazing a polygon edge is kept (boundary counts as outside)', () => {
  // The centreline runs exactly along the square's north edge
  // (z = 10) — it must survive whole, not be eaten by rounding.
  const out = trimBedsAtPolys([bed('graze', [0, 10, 100, 10])], [square(40, -10, 60, 10)]);
  assert.equal(out.length, 1, 'the grazing run is kept');
  assert.deepEqual(flat(out), [[0, 10, 100, 10]]);
});

test('trim: a bed crossing two squares is cut into three stubs', () => {
  const out = trimBedsAtPolys(
    [bed('EW', [0, 0, 100, 0])],
    [square(20, -10, 30, 10), square(70, -10, 80, 10)],
  );
  assert.equal(out.length, 3);
  assert.deepEqual(flat(out), [[0, 0, 20, 0], [30, 0, 70, 0], [80, 0, 100, 0]]);
});

test('trim: an L-shaped bed through a square keeps both outside legs', () => {
  const out = trimBedsAtPolys([bed('L', [0, 0, 50, 0, 50, 50])], [square(40, -10, 60, 10)]);
  assert.equal(out.length, 2);
  // The east leg survives up to the square's west edge (40, 0);
  // the north leg resumes where the centreline leaves the
  // square's north edge (50, 10) and runs to (50, 50).
  assert.deepEqual(flat(out), [[0, 0, 40, 0], [50, 10, 50, 50]]);
  assert.deepEqual(out[1].pts, [50, 10, 50, 50]);
});

test('trim: with no polygons the input array is returned as-is', () => {
  const beds = [bed('a', [0, 0, 10, 0]), bed('b', [0, 10, 10, 10])];
  assert.equal(trimBedsAtPolys(beds, []), beds, 'identity, same array');
  assert.equal(trimBedsAtPolys(beds, null), beds, 'identity, null polys');
});

// Graph derivation (issue #389): the junctions ARE the graph.
// Every junction centre is a roadGraph node, the count is the
// measured census, and the arm geometry is the graph's, not a
// cluster's.
test('graph derivation: every junction centre is a roadGraph node (or a twin centroid)', () => {
  const junctions = detectJunctions(TAIPEI_GEO.roadbeds, TAIPEI_GEO.roadGraph);
  assert.equal(junctions.length, 3323, `junction census ${junctions.length}`);
  const nodes = new Set();
  const g = TAIPEI_GEO.roadGraph;
  for (let i = 0; i + 1 < g.nodes.length; i += 2) nodes.add(`${g.nodes[i]},${g.nodes[i + 1]}`);
  // Most junctions sit exactly on a graph node; the rest are twin
  // groups (two carriageway nodes sharing one ending-bed set),
  // whose centre is the centroid of the member nodes — never
  // more than 12 m from a member node, never a free-floating
  // cluster centroid. Measured on this tree: 3,306 exact, 17
  // twin centroids, max member distance 11.78 m.
  let exact = 0, twin = 0, maxD = 0;
  for (const j of junctions) {
    if (nodes.has(`${j.x},${j.z}`)) { exact++; continue; }
    twin++;
    let bd = Infinity;
    for (let i = 0; i + 1 < g.nodes.length; i += 2)
      bd = Math.min(bd, Math.hypot(g.nodes[i] - j.x, g.nodes[i + 1] - j.z));
    maxD = Math.max(maxD, bd);
  }
  assert.equal(exact, 3306, `exact-node centres ${exact}`);
  assert.equal(twin, 17, `twin-group centroids ${twin}`);
  assert.ok(maxD < 12, `twin centroid max member distance ${maxD}`);
});

test('graph derivation: arm census and endpoint distances', () => {
  const junctions = detectJunctions(TAIPEI_GEO.roadbeds, TAIPEI_GEO.roadGraph);
  const hist = {};
  let throughArms = 0, totalArms = 0;
  for (const j of junctions) {
    hist[j.arms.length] = (hist[j.arms.length] || 0) + 1;
    for (const a of j.arms) {
      totalArms++;
      if (a.through) throughArms++;
    }
  }
  // Measured on this tree: the split junctions are mostly 3- and
  // 4-arm (the old clusterer's long tail of 5–19-arm mega-clusters
  // is gone — each twin carriageway is its own node now).
  assert.deepEqual(hist, { 1: 19, 2: 166, 3: 1792, 4: 1233, 5: 106, 6: 6, 7: 1 });
  assert.equal(totalArms, 11232, `total arms ${totalArms}`);
  assert.equal(throughArms, 401, `through arms ${throughArms}`);
  // Arm-bed endpoints sit on the centre (p50 0.0 m, p90 7.6 m):
  // an ending bed's end is the junction, not metres away from it.
  const beds = TAIPEI_GEO.roadbeds;
  const dists = [];
  for (const j of junctions) {
    for (const a of j.arms) {
      if (a.through) continue;
      const b = beds[a.bed];
      const ex = a.endX - j.x, ez = a.endZ - j.z;
      dists.push(Math.hypot(ex, ez));
    }
  }
  dists.sort((p, q) => p - q);
  const p50 = dists[Math.floor(dists.length * 0.5)];
  const p90 = dists[Math.floor(dists.length * 0.9)];
  assert.ok(p50 < 0.5, `endpoint p50 ${p50}`);
  assert.ok(p90 < 8, `endpoint p90 ${p90}`);
});

// The `way` field (issue #389): every roadGraph edge carries the
// OSM way id it came from, so junction detection can match beds to
// graph nodes by way. The builder check lives in
// tools/taipei/validate.mjs; this pins the committed geodata.
test('roadGraph: every edge carries a numeric way id', () => {
  const g = TAIPEI_GEO.roadGraph;
  assert.equal(g.edges.length, 55515, `edge count ${g.edges.length}`);
  assert.equal(g.nodes.length / 2, 45513, `node count ${g.nodes.length / 2}`);
  let missing = 0;
  for (const e of g.edges) if (typeof e.way !== 'number') missing++;
  assert.equal(missing, 0, `edges without a numeric way: ${missing}`);
});
