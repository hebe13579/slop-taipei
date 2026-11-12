// Issue #356: working traffic signals — the rendered heads and the
// traffic AI share one phase assignment, computed once in
// js/taipei-markings.js (junctionPhaseGroups) and copied by the
// network (js/road-network.js), so the lens a driver sees and the
// phase the car obeys can never disagree.
//
// Proves, against the real geodata: (a) the grouping rule itself
// on synthetic junctions — widest road group 0, every other
// approach group 1, and two sightings of one approach (nearly
// parallel arms) share a group; (b) every rendered signal unit
// carries its junction's group, and the unit/junction assignment
// agrees everywhere; (c) the live network marks exactly the
// signalized junctions' nodes (never a shape node, never a
// non-general node), and every arriving edge at a signalized node
// agrees with the head guarding its approach.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { buildRoadMarkings, detectJunctions, junctionPhaseGroups } from '../js/taipei-markings.js';
import { taipeiTrafficEnv, taipeiSignalJunctions } from '../js/taipei-traffic.js';
import { buildRoadNetwork } from '../js/road-network.js';

// A synthetic junction arm: the grouping rule only reads
// dirX/dirZ/width.
function arm(dirX, dirZ, width) { return { dirX, dirZ, width }; }
function junction(...arms) { return { x: 0, z: 0, arms }; }

test('junctionPhaseGroups: widest road is group 0, the rest group 1 (issue #356)', () => {
  // A 4-way: a 20 m road crossing a 10 m road.
  const groups = junctionPhaseGroups(junction(
    arm(1, 0, 20), arm(-1, 0, 20), arm(0, 1, 10), arm(0, -1, 10),
  ));
  assert.deepEqual(groups, [0, 0, 1, 1]);
  // A T: a 16 m stem meeting a 9.6 m through road.
  const t = junctionPhaseGroups(junction(
    arm(1, 0, 9.6), arm(-1, 0, 9.6), arm(0, 1, 16),
  ));
  assert.deepEqual(t, [1, 1, 0]);
  // A 3-way where the widest road is the pair, not a single arm.
  // No two arms pair (all dots -0.5), so three single-arm roads:
  // the two 12.8 m arms outrank the 6.4 m one, and only the FIRST
  // road in the (stable) rank order is group 0 — the other 12.8 m
  // arm is group 1. (The grouping has exactly two phases.)
  const y = junctionPhaseGroups(junction(
    arm(1, 0, 6.4), arm(-0.5, 0.866, 12.8), arm(-0.5, -0.866, 12.8),
  ));
  assert.deepEqual(y, [1, 0, 1]);
});

test('junctionPhaseGroups: two sightings of one approach share a group (issue #356)', () => {
  // The junction detector merges crossings within 40 m, so one
  // approach can appear twice — two arms ~10° apart on the same
  // side, paired with different opposite arms. Both sightings are
  // the same road and must share a phase, or the network arm for
  // that approach (which matches one sighting by direction) would
  // disagree with the rendered unit on the other.
  const groups = junctionPhaseGroups(junction(
    arm(1, 0, 20), arm(-1, 0, 20), // through road, 20 m
    arm(0.985, 0.174, 9.6), arm(-0.985, -0.174, 9.6), // the same cross road, sighted twice (10° apart)
    arm(0, 1, 9.6), arm(0, -1, 9.6), // a third road
  ));
  // The two 9.6 m sightings share a group (and the 20 m road is 0).
  assert.equal(groups[0], 0);
  assert.equal(groups[1], 0);
  assert.equal(groups[2], groups[3]);
  assert.equal(groups[4], 1);
  assert.equal(groups[5], 1);
});

test('taipeiSignalJunctions: 480 signalized junctions, both phases present (issue #356)', () => {
  const js = taipeiSignalJunctions();
  assert.equal(js.length, 480);
  let noGroup1 = [];
  for (const j of js) {
    assert.ok(j.arms.length >= 2);
    const groups = new Set(j.arms.map((a) => a.group));
    assert.ok(groups.has(0), 'every signalized junction has a group-0 approach');
    for (const a of j.arms) assert.ok(a.group === 0 || a.group === 1);
    if (!groups.has(1)) noGroup1.push([j.x.toFixed(0), j.z.toFixed(0)]);
  }
  // Exactly one junction has no group-1 arm: the 14-arm
  // 南京東路六段 / 環東大道 interchange, whose arms fan around
  // the circle in <18° steps, so the same-direction merge chains
  // every road into one. All its heads show one phase and all its
  // cars obey it — no contradiction, just one phase for the whole
  // interchange (throughput, not correctness).
  assert.deepEqual(noGroup1, [['1176', '-2362']]);
});

const key = (x, z) => `${x.toFixed(2)},${z.toFixed(2)}`;

test('signal units carry their junction group, consistently (issue #356)', () => {
  const junctions = detectJunctions(TAIPEI_GEO.roadbeds).filter((j) => j.signalized);
  const markings = buildRoadMarkings(TAIPEI_GEO.roadbeds);
  const units = markings.signals;
  // Issue #356: the same-direction merge flips the duplicate
  // sightings of the widest road from group 1 to group 0.
  assert.equal(units.length, 2034);
  assert.equal(units.filter((u) => u.group === 0).length, 829);
  assert.equal(units.filter((u) => u.group === 1).length, 1205);
  // Every unit's group matches the phase assignment of the arm it
  // faces (found by face direction — the unit's face dir IS its
  // arm's dir, dot ~ 1.0).
  let mismatches = 0;
  for (const u of units) {
    let bj = null, ba = -1, bdot = -2;
    junctions.forEach((j) => j.arms.forEach((a, i) => {
      const d = u.faceX * a.dirX + u.faceZ * a.dirZ;
      if (d > bdot) { bdot = d; bj = j; ba = i; }
    }));
    assert.ok(bdot > 0.99, 'every unit faces an arm of a signalized junction');
    if (junctionPhaseGroups(bj)[ba] !== u.group) mismatches++;
  }
  assert.equal(mismatches, 0);
});

test('live network: signal nodes are the signalized junctions, and the phases agree (issue #356)', () => {
  const env = taipeiTrafficEnv(200);
  const net = buildRoadNetwork([], [], env.networkEnv);
  const nodes = net.nodes;
  const sigNodes = nodes.filter((n) => n.signal);
  // 437 of 480 signalized junctions have a general non-shape node
  // within 20 m; the other 43 are highway interchanges, bridge
  // ramps, tunnel mouths and one mountain trail junction, with no
  // drivable node anywhere near — no AI car can reach them, so
  // staying unmarked is correct. (Measured 2026-11-11: 9 of the 43
  // have a general node within 30 m; the 20 m radius is kept so a
  // neighbouring unsignalized node is never marked by mistake —
  // 0 signalized junction pairs sit within 30 m of each other.)
  // A junction with two carriageway crossings marks both nodes, so
  // 437 junctions mark 691 nodes in all.
  assert.equal(sigNodes.length, 691);
  assert.equal(sigNodes.filter((n) => n.shape).length, 0);
  assert.equal(sigNodes.filter((n) => !n.general).length, 0);
  const junctionsClaimed = new Set(sigNodes.map((n) => key(n.signalJunction.x, n.signalJunction.z)));
  assert.equal(junctionsClaimed.size, 437);

  // Driver view, tight match: for every signal unit whose approach
  // has an arriving edge at the junction's node(s) — aligned to
  // <8° (dot > 0.99) — the edge's axisIndex must agree with the
  // unit's group (axis 0 iff group 0). A looser threshold matches
  // a neighbouring road's edge and proves nothing; the tight one
  // is the approach the unit guards. Before the #356
  // same-direction merge this found 8 real mismatches (collinear
  // duplicate arms with opposite groups); after it, zero.
  const junctions = detectJunctions(TAIPEI_GEO.roadbeds).filter((j) => j.signalized);
  const markings = buildRoadMarkings(TAIPEI_GEO.roadbeds);
  const units = markings.signals;
  const nodesByJunction = new Map();
  for (const n of sigNodes) {
    const k = key(n.signalJunction.x, n.signalJunction.z);
    if (!nodesByJunction.has(k)) nodesByJunction.set(k, []);
    nodesByJunction.get(k).push(n);
  }
  let checked = 0, bad = 0;
  for (const u of units) {
    let bj = null, bdot = -2;
    junctions.forEach((j) => j.arms.forEach((a) => {
      const d = u.faceX * a.dirX + u.faceZ * a.dirZ;
      if (d > bdot) { bdot = d; bj = j; }
    }));
    const jnodes = nodesByJunction.get(key(bj.x, bj.z)) || [];
    for (const n of jnodes) {
      let be = null, edot = 0.99;
      for (const e of n.in || []) {
        const d = e.inArm.ux * u.faceX + e.inArm.uz * u.faceZ;
        if (d > edot) { edot = d; be = e; }
      }
      if (!be) continue;
      checked++;
      if ((be.axisIndex === 0) !== (u.group === 0)) bad++;
    }
  }
  assert.ok(checked > 800, `expected ~891 tight checks, got ${checked}`);
  assert.equal(bad, 0);
});
