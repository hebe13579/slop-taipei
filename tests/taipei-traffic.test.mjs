// Issue #210 EXPERIMENT: Taipei traffic behind ?traffic= (default off).
//
// These pins cover the experiment's data path only — the chained road graph
// js/taipei-traffic.js builds from TAIPEI_GEO.roadGraph, the flag parsing, and
// the drivable network the generic half of buildRoadNetwork derives from it.
// Behaviour with the flag off is main's inert stub and is covered by the
// existing suite (boot-smoke + the NYC traffic tests); nothing here spawns a
// vehicle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaipeiRoadGraph, taipeiTrafficEnv, trafficCountFromSearch } from '../js/taipei-traffic.js';
import { buildRoadNetwork } from '../js/road-network.js';

const built = buildTaipeiRoadGraph();
const { roadGraph, stats } = built;

test('chained graph: segment census pins (issue #210, #252)', () => {
  // 42,770 source segments on the PR base; non-drivable classes (service
  // aisles, tracks, busways, construction, proposed...) drop to 23,576;
  // chaining through degree-2 vertices yields 11,285 junction-to-junction
  // links. Re-pinned at the merge gate on the composed tile: the roadGraph
  // grew with the #186 strip fabric (identical code on the PR-base geodata
  // reproduces every pin above exactly — probed at the gate), so the
  // census moves to 47,190 / 25,706 / 12,103 / 2,019.7 / 1,258.3, and one
  // closed ring in the new fabric needs a loop split (loopSplits 0 -> 1,
  // the chaining code's own ring handling, not a defect).
  // Re-pinned again for issue #252 (level rule): the level-tagged
  // geodata is unchanged in size (47,190 source segments), but deck and
  // ramp segments leave the drivable set — 24,523 drivable, 11,942
  // links, 1,161.0 km kept, one more ring split (loopSplits 1 -> 2:
  // dropping the deck chord leaves a ground ring the chaining splits).
  // Cross-run proof: the level-ignorant builder on THIS geodata (levels
  // stripped) reproduces 25,706 / 12,103 / 1,258.3 / loopSplits 1
  // exactly, so the whole delta is the level rule and nothing else.
  // 1,183 segments / 97.3 km dropped (ramps + |level| >= 2 decks);
  // 518 segments / 47.1 km of level ±1 crossings kept (bridges/tunnels).
  assert.equal(stats.sourceEdges, 47190);
  assert.equal(stats.drivableEdges, 24523);
  assert.equal(stats.links, 11942);
  assert.equal(stats.loopSplits, 2);
  assert.equal(stats.rawKm, 2019.7);
  assert.equal(stats.keptKm, 1161.0);
  assert.equal(stats.droppedLevelEdges, 1183);
  assert.equal(stats.droppedLevelKm, 97.3);
  assert.equal(stats.keptLevelEdges, 518);
  assert.equal(stats.keptLevelKm, 47.1);
});

test('level rule: deck and ramp segments drop, bridge/tunnel crossings stay (issue #252)', () => {
  // Synthetic source: a ground street A-B-C, a level-2 deck chord A-C,
  // a level-1 ramp B-D, and a level-1 bridge A-B carrying a second name.
  // The deck and the ramp must leave the graph; the bridge must stay and
  // chain with nothing (different name from the street).
  const nodes = [0, 0, 100, 0, 200, 0, 100, 100];
  const edge = (a, b, name, highway, level, oneway = false) => ({
    a, b, name, highway, oneway, width: 8, pedestrianLayout: 'sidewalk', length: 100, level,
  });
  const source = {
    roadGraph: {
      nodes,
      edges: [
        edge(0, 1, 'Street', 'tertiary', 0),
        edge(1, 2, 'Street', 'tertiary', 0),
        edge(0, 2, 'Expressway', 'trunk', 2, true),
        edge(1, 3, 'Ramp', 'trunk_link', 1, true),
        edge(0, 1, 'Bridge', 'primary', 1),
      ],
    },
    frame: { bbox: { minX: -500, maxX: 500, minZ: -500, maxZ: 500 } },
  };
  const built = buildTaipeiRoadGraph(source);
  assert.equal(built.stats.droppedLevelEdges, 2);
  assert.equal(built.stats.keptLevelEdges, 1);
  const names = built.roadGraph.names;
  assert.ok(names.includes('Street'), 'ground street survives');
  assert.ok(names.includes('Bridge'), 'level-1 bridge survives');
  assert.ok(!names.includes('Expressway'), 'level-2 deck drops');
  assert.ok(!names.includes('Ramp'), 'level-1 ramp drops');
  // The dropped deck chord must not shortcut the street: no link spans
  // A-C directly on the Expressway name, and the street still chains.
  assert.ok(built.roadGraph.links.some((L) => names[L[2]] === 'Street'));
});

test('level rule: the reported junction keeps surface streets, loses decks and ramps (issue #252)', () => {
  // 公舘路 / 承德路七段, game (-6403, -9592): before the rule the
  // 120 m neighbourhood held 洲美快速道路 deck links and 大業路 ramp
  // links; after it, only surface streets and the 朝籟橋 crossing.
  const CX = -6403, CZ = -9592;
  const nodes = roadGraph.nodes;
  const near = new Set();
  for (const [a, b, ni, , , , inner] of roadGraph.links) {
    const pts = [[nodes[a * 2], nodes[a * 2 + 1]]];
    for (let k = 0; k < inner.length; k += 2) pts.push([inner[k], inner[k + 1]]);
    pts.push([nodes[b * 2], nodes[b * 2 + 1]]);
    if (pts.some(([x, z]) => Math.hypot(x - CX, z - CZ) < 120)) near.add(roadGraph.names[ni]);
  }
  assert.ok(near.has('公舘路'), 'Gongguan Rd present');
  assert.ok(near.has('承德路七段'), 'Chengde Rd present');
  assert.ok(near.has('朝籟橋'), 'bridge crossing present');
  assert.ok(![...near].some((n) => n.includes('洲美快速道路')), 'no expressway deck links');
  assert.ok(![...near].some((n) => n.includes('匝道')), 'no ramp links');
});

test('chained graph: link shape and length conservation', () => {
  const nodes = roadGraph.nodes;
  let oneWay = 0;
  let polyKm = 0;
  for (const [a, b, , , , dir, inner] of roadGraph.links) {
    assert.notEqual(a, b, 'no self-loop links');
    assert.ok(dir === 0 || dir === 1, 'dir is 0 (two-way) or 1 (a->b only)');
    if (dir === 1) oneWay++;
    // Polyline length through the inner shape points must conserve the
    // source segments' length (chaining neither stretches nor cuts streets).
    let px = nodes[a * 2], pz = nodes[a * 2 + 1];
    for (let k = 0; k < inner.length; k += 2) {
      polyKm += Math.hypot(inner[k] - px, inner[k + 1] - pz) / 1000;
      px = inner[k]; pz = inner[k + 1];
    }
    polyKm += Math.hypot(nodes[b * 2] - px, nodes[b * 2 + 1] - pz) / 1000;
  }
  assert.equal(oneWay, 5767); // 5,922 before #252; the dropped deck/ramp links were mostly one-way
  assert.ok(Math.abs(polyKm - stats.keptKm) < 0.2, `polyline ${polyKm.toFixed(1)} km vs kept ${stats.keptKm} km`);
});

test('flag parsing: default off, pool sizes clamp', () => {
  assert.equal(trafficCountFromSearch(''), 0);
  assert.equal(trafficCountFromSearch('?city=taipei'), 0);
  assert.equal(trafficCountFromSearch('?traffic=0'), 0);
  assert.equal(trafficCountFromSearch('?traffic=off'), 0);
  assert.equal(trafficCountFromSearch('?traffic='), 200);
  assert.equal(trafficCountFromSearch('?traffic=1'), 200);
  assert.equal(trafficCountFromSearch('?traffic=on'), 200);
  assert.equal(trafficCountFromSearch('?traffic=60'), 60);
  assert.equal(trafficCountFromSearch('?traffic=5'), 10);
  assert.equal(trafficCountFromSearch('?traffic=9999'), 400);
});

test('env: no grid, no signals source, pedestrians off, bus scaling, spawn radius', () => {
  const env = taipeiTrafficEnv(200);
  assert.equal(env.pedestrians, false);
  assert.equal(env.carCount, 200);
  assert.equal(env.busCount, 12);
  assert.deepEqual(env.networkEnv.avenues, []);
  assert.deepEqual(env.networkEnv.streets, []);
  assert.deepEqual(env.networkEnv.medians, []);
  assert.equal(taipeiTrafficEnv(60).busCount, 4);
  // Issue #252: the spawn-range knob rides the env only when chosen —
  // an unset env behaves exactly as before (js/traffic.js defaults).
  assert.ok(!('trafficRadius' in env), 'no radius key unless the caller chose one');
  assert.equal(taipeiTrafficEnv(200, { trafficRadius: 600 }).trafficRadius, 600);
  assert.equal(taipeiTrafficEnv(200, { trafficRadius: 200 }).trafficRadius, 200);
});

test('network: generic builder keeps a strongly connected drivable core', () => {
  // The largest strongly connected set is the routing-safety property: no
  // vehicle can reach a dead end. 19,314 directed lane edges are built,
  // 14,921 survive the SCC cut (77%), over 6,857 nodes; no junction is
  // signalized (Taipei has no node-level signal table — right of way is the
  // step-9 arm groups). Re-pinned at the merge gate: the same A/B as the
  // census above — 21,397 / 16,332 / 7,495 on the composed tile, the
  // strip fabric's streets joining the same strongly connected core.
  // Re-pinned for issue #252 (same cross-run proof as the census test):
  // the deck/ramp drop costs 6% of the core — 20,984 / 15,229 / 6,890 —
  // because the bridge/tunnel crossings stay in the graph.
  // Re-pinned for issue #254: taipeiTrafficEnv now serves the DECK
  // graph (ramps + decks rejoin through the level-join rule), so the
  // core grows to 21,385 / 16,328 / 7,493 — 1,099 more directed
  // edges, 603 more nodes, all of them deck/ramp fabric attached to
  // the same core through ramps. Cross-run proof: the ground-only
  // builder on THIS geodata reproduces 20,984 / 15,229 / 6,890
  // exactly (asserted in tests/taipei-deck-traffic.test.mjs), so the
  // whole delta is the deck graph and nothing else.
  const env = taipeiTrafficEnv(200);
  const net = buildRoadNetwork([], [], env.networkEnv);
  assert.equal(net.nodes.length, 7493);
  assert.equal(net.edges.length, 16328);
  assert.equal(net.paintEdges.length, 21385);
});
