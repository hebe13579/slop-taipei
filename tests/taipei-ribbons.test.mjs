import assert from 'node:assert/strict';
import test from 'node:test';

import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { ribbonsQuads, ribbonVertexFrames, jointFramesFor } from '../js/taipei-ribbons.js';
import { ribbonPoly } from '../js/taipei-painted.js';

// Issue #173 (NOTCH class, from the #169 road-surface sweep): the
// renderer's ribbons were per-segment quads with square butt ends,
// leaving a triangular wedge of bare ground on the outside of
// every bend (the Beitou stretch wedges; the scalloped edge where
// a lane curves around a block at ji1923) and across mid-block
// continuation joints. js/taipei-ribbons.js builds the quads from
// per-vertex miter frames — the planner's ribbonPoly outline —
// plus shared end frames at continuation joints. These tests pin
// the construction on synthetic roads and on the real tile.

const inQuad = (p, q) => {
  // Same-side test for a convex quad given in boundary order.
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = [q[i * 2], q[i * 2 + 1]], b = [q[((i + 1) % 4) * 2], q[((i + 1) % 4) * 2 + 1]];
    const c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (Math.abs(c) < 1e-9) continue;
    if (sign && Math.sign(c) !== sign) return false;
    sign = Math.sign(c);
  }
  return true;
};
const inAnyQuad = (p, quads) => quads.some((q) => inQuad(p, q));

test('notch: a bend vertex leaves no wedge — the miter covers the joint triangle', () => {
  // East then north, 10 m wide: with square butt ends the triangle
  // (40,0) (40,-5) (45,0) on the outside of the bend is bare.
  const road = { pts: [0, 0, 40, 0, 40, 40], width: 10 };
  const { quads, stats } = ribbonsQuads([road]);
  assert.equal(quads.length, 2, 'one quad per segment');
  assert.equal(stats.miterVertices, 1);
  const centroid = [(40 + 40 + 45) / 3, (0 - 5 + 0) / 3];
  assert.ok(inAnyQuad(centroid, quads), `wedge centroid ${centroid} is paved by the miter quad`);
  // The other (inside) triangle stays covered too.
  assert.ok(inAnyQuad([(40 + 40 + 35) / 3, (0 + 5 + 0) / 3], quads), 'inside joint triangle covered');
});

test('notch: the rendered miter covers the planner ribbon outline at a bend', () => {
  // ribbonPoly is the bevelled inscribed outline the planners test
  // against (plain half width along the averaged normal); the true
  // miter the renderer draws must contain every one of its points,
  // or occlusion decisions and the visible road would disagree.
  const road = { pts: [0, 0, 40, 0, 40, 40], width: 10 };
  const { quads } = ribbonsQuads([road]);
  for (const p of ribbonPoly(road)) {
    assert.ok(inAnyQuad(p, quads), `planner outline point ${p} is covered by the rendered ribbon`);
  }
});

test('notch: continuation joints share one end frame; junctions and sharp turns do not', () => {
  const a = { pts: [0, 0, 50, 0], width: 10 };
  const b = { pts: [50, 0, 100, 0], width: 10 };
  const joints = jointFramesFor([a, b]);
  assert.ok(joints.has('50,0'), 'collinear continuation qualifies');
  const { quads, stats } = ribbonsQuads([a, b], joints);
  assert.equal(stats.jointEnds, 2, 'both ends take the shared frame');
  // The shared edge: a's end corners and b's start corners coincide.
  const aEnd = [quads[0][4], quads[0][5], quads[0][6], quads[0][7]].sort();
  const bStart = [quads[1][0], quads[1][1], quads[1][2], quads[1][3]].sort();
  assert.deepEqual(aEnd, bStart, 'the two ribbons meet on one edge');
  // A third road at the same point (a junction) disqualifies it.
  const c = { pts: [50, 0, 50, 50], width: 6 };
  assert.ok(!jointFramesFor([a, b, c]).has('50,0'), 'three ends at a point is a junction, not a continuation');
  // A sharp turn at the shared point is not a continuation either.
  const d = { pts: [50, 0, 50, -50], width: 10 };
  assert.ok(!jointFramesFor([a, d]).has('50,0'), 'a 90-degree meeting keeps square ends');
});

test('notch: straight roads are unchanged (vertex frames equal segment frames)', () => {
  const road = { pts: [0, 0, 30, 0, 80, 0], width: 8 };
  const { frames } = ribbonVertexFrames(road.pts, road.width);
  for (const f of frames) {
    assert.ok(Math.abs(f.nx) < 1e-12 && Math.abs(f.nz - 1) < 1e-12, 'frame normal is the segment normal');
    assert.ok(Math.abs(f.h - 4) < 1e-12, 'no miter growth on a straight run');
  }
});

test('notch: real-tile census — miters and joints across the carriageway set', () => {
  const beds = TAIPEI_GEO.roadbeds;
  const { quads, stats } = ribbonsQuads(beds);
  const segments = beds.reduce((s, r) => s + Math.max(0, r.pts.length / 2 - 1), 0);
  assert.equal(quads.length, segments, 'one quad per bed segment');
  assert.ok(stats.miterVertices > 10000, `${stats.miterVertices} mitered vertices`);
  assert.ok(stats.jointEnds > 2000, `${stats.jointEnds} joint ends share a frame`);
  assert.equal(stats.hairpins, 0, 'no hairpin fallbacks on the real tile');
  for (const q of quads) for (const v of q) assert.ok(Number.isFinite(v), 'finite quad');
});
