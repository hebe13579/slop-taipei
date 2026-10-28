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

test('chained graph: segment census pins (issue #210)', () => {
  // 42,770 source segments; non-drivable classes (service aisles, tracks,
  // busways, construction, proposed...) drop to 23,576; chaining through
  // degree-2 vertices yields 11,285 junction-to-junction links.
  assert.equal(stats.sourceEdges, 42770);
  assert.equal(stats.drivableEdges, 23576);
  assert.equal(stats.links, 11285);
  assert.equal(stats.loopSplits, 0);
  assert.equal(stats.rawKm, 1872.6);
  assert.equal(stats.keptKm, 1167.4);
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
  assert.equal(oneWay, 5638);
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

test('env: no grid, no signals source, pedestrians off, bus scaling', () => {
  const env = taipeiTrafficEnv(200);
  assert.equal(env.pedestrians, false);
  assert.equal(env.carCount, 200);
  assert.equal(env.busCount, 12);
  assert.deepEqual(env.networkEnv.avenues, []);
  assert.deepEqual(env.networkEnv.streets, []);
  assert.deepEqual(env.networkEnv.medians, []);
  assert.equal(taipeiTrafficEnv(60).busCount, 4);
});

test('network: generic builder keeps a strongly connected drivable core', () => {
  // The largest strongly connected set is the routing-safety property: no
  // vehicle can reach a dead end. 19,314 directed lane edges are built,
  // 14,921 survive the SCC cut (77%), over 6,857 nodes; no junction is
  // signalized (Taipei has no node-level signal table — right of way is the
  // step-9 arm groups).
  const env = taipeiTrafficEnv(200);
  const net = buildRoadNetwork([], [], env.networkEnv);
  assert.equal(net.nodes.length, 6857);
  assert.equal(net.edges.length, 14921);
  assert.equal(net.paintEdges.length, 19314);
});
