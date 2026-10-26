// Issue #173 (NOTCH class, from the #169 road-surface sweep): the
// renderer drew every road ribbon as independent per-segment quads
// with SQUARE BUTT ENDS at each vertex. On the outside of every bend
// the two square ends leave a triangular wedge of bare ground inside
// the road's own outline (the audit's mid-block white wedges/spikes
// on the Beitou stretches and the scalloped "battlement" edge where
// a curving lane hugs a block at ji1923), and at a mid-block node
// where one road continues as two beds the two butt ends leave the
// same wedge across the joint. The PLANNER never had the defect —
// ribbonPoly (js/taipei-painted.js) builds outlines from
// neighbour-averaged vertex normals — only the renderer's geometry
// construction differed. This module is that construction, shared
// by every ribbon layer in taipei-boot.js: per-vertex MITER frames
// (the averaged normal, the half-width grown by 1/cos(half-angle)
// with the same 0.25 clamp the planners use — ribbonPoly's outline
// is the bevelled inscribed version of the same joint, and the
// miter covers it), plus cross-road CONTINUATION
// JOINTS: an endpoint shared by exactly two roads whose through
// directions agree within JOINT_MAX_TURN_DEG gets one shared end
// frame, so the continuation reads as one ribbon. Junction
// endpoints (3+ roads) keep their square ends — the junction cap
// paves that ground. Pure and node-testable like the other
// taipei-* planners.

export const JOINT_MAX_TURN_DEG = 30;

const segFrame = (ax, az, bx, bz) => {
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len < 1e-9) return null;
  return { tx: dx / len, tz: dz / len, nx: -dz / len, nz: dx / len };
};

// Per-vertex frames for one polyline: vertex 0 and the last vertex
// take their single segment's frame; interior vertices average the
// two segment normals (a hairpin whose normals cancel keeps the
// outgoing segment's frame — a safe square-ish joint, counted).
// The half-width keeps the renderer's historic 0.75 m floor.
export function ribbonVertexFrames(pts, width) {
  const half = Math.max((width || 3) / 2, 0.75);
  const n = pts.length / 2;
  const segs = [];
  for (let i = 0; i + 1 < n; i++) segs.push(segFrame(pts[i * 2], pts[i * 2 + 1], pts[i * 2 + 2], pts[i * 2 + 3]));
  // Zero-length segments (duplicate vertices) borrow a neighbour's
  // frame so no NaN can reach the geometry.
  for (let i = 0; i < segs.length; i++) {
    if (segs[i]) continue;
    segs[i] = segs[i - 1] || segs[i + 1] || { tx: 1, tz: 0, nx: 0, nz: 1 };
  }
  const frames = [];
  let hairpins = 0;
  for (let i = 0; i < n; i++) {
    if (i === 0 || i === n - 1) {
      const s = i === 0 ? segs[0] : segs[segs.length - 1];
      frames.push({ nx: s.nx, nz: s.nz, h: half });
      continue;
    }
    const a = segs[i - 1], b = segs[i];
    let mx = a.nx + b.nx, mz = a.nz + b.nz;
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-9) {
      hairpins++;
      frames.push({ nx: b.nx, nz: b.nz, h: half });
      continue;
    }
    const nx = mx / ml, nz = mz / ml;
    const dot = nx * b.nx + nz * b.nz; // == cos(half-angle), as ribbonPoly's oB
    frames.push({ nx, nz, h: half / Math.max(0.25, dot) });
  }
  return { frames, hairpins };
}

// Continuation joints over a whole road set: a map from an endpoint
// key ("x,z", the exact shared node coordinates) to the shared end
// frame's normal. An endpoint qualifies when exactly two DIFFERENT
// roads end there and their through directions (into the node for
// an end vertex, away from it for a start vertex) agree within
// JOINT_MAX_TURN_DEG — a genuine continuation, not a junction arm.
export function jointFramesFor(roads, maxTurnDeg = JOINT_MAX_TURN_DEG) {
  const ends = new Map();
  const add = (key, entry) => {
    if (!ends.has(key)) ends.set(key, []);
    ends.get(key).push(entry);
  };
  roads.forEach((road, ri) => {
    const pts = road.pts;
    if (!pts || pts.length < 4) return;
    const n = pts.length / 2;
    const first = segFrame(pts[0], pts[1], pts[2], pts[3]);
    const last = segFrame(pts[(n - 2) * 2], pts[(n - 2) * 2 + 1], pts[(n - 1) * 2], pts[(n - 1) * 2 + 1]);
    if (first) add(`${pts[0]},${pts[1]}`, { ri, tx: first.tx, tz: first.tz });
    if (last) add(`${pts[(n - 1) * 2]},${pts[(n - 1) * 2 + 1]}`, { ri, tx: last.tx, tz: last.tz });
  });
  const cosMax = Math.cos((maxTurnDeg * Math.PI) / 180);
  const joints = new Map();
  for (const [key, list] of ends) {
    if (list.length !== 2 || list[0].ri === list[1].ri) continue;
    const [a, b] = list;
    if (a.tx * b.tx + a.tz * b.tz < cosMax) continue; // not a continuation
    let mx = a.tx + b.tx, mz = a.tz + b.tz;
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-9) continue;
    // The shared end edge is perpendicular to the through direction;
    // its sign is irrelevant (the frame is used symmetrically).
    joints.set(key, { nx: -(mz / ml), nz: mx / ml });
  }
  return joints;
}

// All quads for a road set: one quad per segment from the per-vertex
// frames, with shared joint frames substituted at qualifying ends.
export function ribbonsQuads(roads, jointFrames = null) {
  const joints = jointFrames || jointFramesFor(roads);
  const quads = [];
  let miterVertices = 0, hairpins = 0, jointEnds = 0;
  for (const road of roads) {
    const pts = road.pts;
    if (!pts || pts.length < 4) continue;
    const width = road.width || 3;
    const half = Math.max(width / 2, 0.75);
    const { frames, hairpins: hp } = ribbonVertexFrames(pts, width);
    hairpins += hp;
    miterVertices += Math.max(0, frames.length - 2);
    const startJoint = joints.get(`${pts[0]},${pts[1]}`);
    if (startJoint) { frames[0] = { nx: startJoint.nx, nz: startJoint.nz, h: half }; jointEnds++; }
    const endJoint = joints.get(`${pts[pts.length - 2]},${pts[pts.length - 1]}`);
    if (endJoint) { frames[frames.length - 1] = { nx: endJoint.nx, nz: endJoint.nz, h: half }; jointEnds++; }
    for (let i = 0; i + 1 < frames.length; i++) {
      const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[i * 2 + 2], bz = pts[i * 2 + 3];
      const fa = frames[i], fb = frames[i + 1];
      quads.push([
        ax - fa.nx * fa.h, az - fa.nz * fa.h,
        ax + fa.nx * fa.h, az + fa.nz * fa.h,
        bx + fb.nx * fb.h, bz + fb.nz * fb.h,
        bx - fb.nx * fb.h, bz - fb.nz * fb.h,
      ]);
    }
  }
  return { quads, stats: { quads: quads.length, miterVertices, hairpins, jointEnds } };
}
