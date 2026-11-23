// tests/taipei-pedestrians.test.mjs
// Issue #262: the pedestrian walking network (js/taipei-pedestrian-
// network.js) — pure geometry over the geodata roadbeds. The pins
// below were measured on the shipped geodata (2026-11-22): the
// census, the clearance invariants (no walking point on a
// carriageway, ever, for sidewalk/arcade lines), the exclusion
// rules (no decks, no vehicle-only classes), and node integrity
// (a walker can always continue or turn around, and never leaves
// the city frame). The THREE layer (js/taipei-pedestrians.js) is
// covered by the frame evidence in the PR; the settings surface
// is pinned in tests/taipei-settings.test.mjs.

import assert from 'node:assert/strict';
import test from 'node:test';

import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import {
  PED_EXCLUDED_HIGHWAYS,
  walkOffsetFor,
  linePointAt,
  buildPedestrianNetwork,
} from '../js/taipei-pedestrian-network.js';

const net = buildPedestrianNetwork(TAIPEI_GEO);
const beds = TAIPEI_GEO.roadbeds;

const distToPolyline = (x, z, pts) => {
  let best = Infinity;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3];
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
    if (d < best) best = d;
  }
  return best;
};
const halfOf = (bed) => Math.max((bed.width || 3) / 2, 0.75);
const isOutside = (line) => line.layout === 'sidewalk' || line.layout === 'arcade';
const minClearOf = (bed) => {
  const half = halfOf(bed);
  if (bed.pedestrianLayout === 'sidewalk' || bed.pedestrianLayout === 'arcade') return half + 0.3;
  return Math.min(walkOffsetFor(bed), Math.max(half * 0.45, 0.45));
};

test('pedestrian network census: lines, nodes, length (issue #262)', () => {
  assert.equal(net.stats.lines, 32503);
  assert.equal(net.stats.nodes, 36878);
  assert.equal(net.stats.joinedNodes, 19224);
  assert.equal(net.stats.totalKm, 3731.9);
  const byLayout = {};
  for (const line of net.lines) byLayout[line.layout] = (byLayout[line.layout] || 0) + 1;
  assert.deepEqual(byLayout, { painted: 3314, shared: 25017, sidewalk: 4172 });
});

test('walk offsets: layout decides the side of the carriageway edge', () => {
  assert.equal(walkOffsetFor(null), null);
  assert.equal(walkOffsetFor({ deck: true, highway: 'residential', width: 6, pedestrianLayout: 'shared' }), null, 'deck beds carry no line');
  assert.equal(walkOffsetFor({ highway: 'motorway', width: 20, pedestrianLayout: 'shared' }), null, 'vehicle-only classes carry no line');
  const sw = walkOffsetFor({ highway: 'secondary', width: 20, pedestrianLayout: 'sidewalk' });
  assert.ok(sw > 10, 'a sidewalk line runs outside the carriageway (half width 10)');
  const sh = walkOffsetFor({ highway: 'residential', width: 3, pedestrianLayout: 'shared' });
  assert.ok(Math.abs(sh - 0.675) < 1e-9, 'a narrow shared lane keeps to 45% of its half width');
  const pt = walkOffsetFor({ highway: 'residential', width: 8, pedestrianLayout: 'painted' });
  assert.equal(pt, 3, 'a painted strip sits a step inside the edge');
});

test('no line on a deck bed or a vehicle-only class', () => {
  for (const line of net.lines) {
    const bed = beds[line.bed];
    assert.ok(!bed.deck, `line on deck bed ${line.name}`);
    assert.ok(!PED_EXCLUDED_HIGHWAYS.has(bed.highway), `line on ${bed.highway} bed ${line.name}`);
    assert.ok(line.len >= 6, 'every line is at least the minimum walk length');
  }
});

test('clearance invariant: every line vertex keeps its clearance from its own centreline', () => {
  // The builder guarantees this by construction (bend clamp +
  // split); the test re-measures it independently against the raw
  // bed polylines. For sidewalk/arcade lines the clearance floor
  // is half width + 0.3 m — the vertex is never on the carriageway.
  let checked = 0;
  for (const line of net.lines) {
    const bed = beds[line.bed];
    const floor = minClearOf(bed) - 0.06;
    for (let i = 0; i < line.pts.length; i += 2) {
      const d = distToPolyline(line.pts[i], line.pts[i + 1], bed.pts);
      assert.ok(d >= floor, `${line.name} (${line.layout}) vertex at ${d.toFixed(2)} m from centreline, floor ${floor.toFixed(2)}`);
      checked++;
    }
  }
  assert.ok(checked > 400000, `vertex check covered ${checked} points`);
});

test('clearance invariant: sampled walks stay off the carriageway on sidewalk lines', () => {
  // Walkers interpolate between vertices, so sample the walked
  // path itself: on sidewalk/arcade lines no sample may cross the
  // carriageway edge (measured worst margin +0.11 m).
  let worst = Infinity;
  for (const line of net.lines) {
    if (!isOutside(line)) continue;
    const bed = beds[line.bed];
    const half = halfOf(bed);
    for (let s = 0; s <= line.len; s += 1.2) {
      const p = linePointAt(line, s);
      const margin = distToPolyline(p.x, p.z, bed.pts) - half;
      if (margin < worst) worst = margin;
    }
  }
  assert.ok(worst >= -0.02, `worst sidewalk margin ${worst.toFixed(3)} m`);
});

test('clearance invariant: inside lines keep to their side of the lane', () => {
  // Painted/shared lines run inside the carriageway edge by design;
  // the floor is that a walker essentially never collapses to the
  // centreline (measured: 29 of 901,510 samples below 0.3 * half,
  // all at hairpin folds; the pin allows 0.01%).
  let total = 0, below = 0;
  for (const line of net.lines) {
    if (isOutside(line)) continue;
    const bed = beds[line.bed];
    const floor = 0.3 * halfOf(bed);
    for (let s = 0; s <= line.len; s += 1.2) {
      const p = linePointAt(line, s);
      total++;
      if (distToPolyline(p.x, p.z, bed.pts) < floor) below++;
    }
  }
  assert.ok(total > 800000, `inside-line check covered ${total} samples`);
  assert.ok(below / total <= 0.0001, `${below} of ${total} inside samples below the floor`);
});

test('node integrity: line ends and node ends reference each other', () => {
  for (let li = 0; li < net.lines.length; li++) {
    const line = net.lines[li];
    assert.ok(line.fromNode >= 0 && line.fromNode < net.nodes.length);
    assert.ok(line.toNode >= 0 && line.toNode < net.nodes.length);
    assert.ok(net.nodes[line.fromNode].ends.some((e) => e.line === li && e.end === 0), `line ${li} start not registered at its node`);
    assert.ok(net.nodes[line.toNode].ends.some((e) => e.line === li && e.end === 1), `line ${li} end not registered at its node`);
  }
  for (let ni = 0; ni < net.nodes.length; ni++) {
    for (const e of net.nodes[ni].ends) {
      const line = net.lines[e.line];
      assert.equal(e.end === 0 ? line.fromNode : line.toNode, ni, `node ${ni} end does not point back`);
    }
  }
});

test('random walk: a walker following nodes never leaves the city frame', () => {
  let seed = 262;
  const rnd = () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const bed of beds) {
    for (let i = 0; i < bed.pts.length; i += 2) {
      minX = Math.min(minX, bed.pts[i]); maxX = Math.max(maxX, bed.pts[i]);
      minZ = Math.min(minZ, bed.pts[i + 1]); maxZ = Math.max(maxZ, bed.pts[i + 1]);
    }
  }
  let li = Math.floor(rnd() * net.lines.length);
  let end = 1;
  for (let hop = 0; hop < 2000; hop++) {
    const line = net.lines[li];
    const node = net.nodes[end === 1 ? line.toNode : line.fromNode];
    assert.ok(node.x >= minX - 30 && node.x <= maxX + 30 && node.z >= minZ - 30 && node.z <= maxZ + 30,
      `hop ${hop} left the frame at ${node.x},${node.z}`);
    const options = node.ends.filter((e) => !(e.line === li && e.end === end));
    if (!options.length) { end = end === 1 ? 0 : 1; continue; } // dead end: turn around
    const pick = options[Math.floor(rnd() * options.length)];
    li = pick.line;
    end = pick.end === 0 ? 1 : 0; // walk away from the node we arrived through
  }
});

test('linePointAt: endpoints, clamping, unit direction', () => {
  const line = net.lines.find((l) => l.len > 50);
  const a = linePointAt(line, 0);
  assert.equal(a.x, line.pts[0]);
  assert.equal(a.z, line.pts[1]);
  const b = linePointAt(line, line.len + 100);
  assert.equal(b.x, line.pts[line.pts.length - 2]);
  assert.equal(b.z, line.pts[line.pts.length - 1]);
  const mid = linePointAt(line, line.len / 2);
  assert.ok(Math.abs(Math.hypot(mid.dx, mid.dz) - 1) < 1e-9, 'direction is a unit vector');
});
