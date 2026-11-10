// Issue #317: the HEAD builder (tools/taipei/build-taipei-geodata.mjs)
// did not emit `level` on roadGraph edges — its graphSequences.push and
// its buildRoadGraph edge object carried no level. The committed
// js/taipei-geodata.js roadGraph section (55,515 edges, all with level)
// was a transplanted artifact from tools/taipei/rebuild-roadgraph.mjs,
// so a future rebuild would silently drop the traffic level rule
// (the #258 failure mode: the traffic probe showed droppedLevelEdges 0 /
// keptLevelEdges 0, decks and ramps leaking into the drivable graph).
//
// Fix: the HEAD builder emits `level` on every roadGraph edge via
// wayLevel() (explicit OSM `layer` wins, else bridge = 1, tunnel = -1,
// else 0 — copied verbatim from rebuild-roadgraph.mjs, issue #252).
// Proof (level317-evidence/): the fixed builder run on HEAD data
// reproduces the committed roadGraph section EXACTLY (nodes identical,
// 0 of 55,515 edges differing, level distributions identical), and
// rebuild-roadgraph.mjs agrees with it exactly too; the unfixed builder
// on the same data reproduced the committed section exactly only with
// level stripped, and emitted level on 0 edges. The traffic probe on
// the fixed builder's output reproduces all 10 pinned census values in
// tests/taipei-traffic.test.mjs, while the level-stripped control
// reproduces the #258 failure mode (droppedLevelEdges 0 /
// keptLevelEdges 0, drivableEdges 27,742 -> 29,167).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TAIPEI_GEO } from '../js/taipei-geodata.js';

const root = fileURLToPath(new URL('../', import.meta.url));

// The committed level distribution, measured on main 89c5caa6
// (level317-evidence/measure-committed.mjs): 55,515 edges, all with
// level. Re-measure with an `// Issue #317:` reason if a future
// geodata change legitimately moves the roadGraph.
const LEVEL_DIST = { 0: 52740, 1: 1024, 2: 752, 3: 435, 4: 85, 5: 6, '-1': 468, '-2': 5 };

test('issue #317: every committed roadGraph edge carries its OSM level', () => {
  const rg = TAIPEI_GEO.roadGraph;
  assert.equal(rg.edges.length, 55515, 'roadGraph edge count');
  assert.equal(rg.nodes.length / 2, 45513, 'roadGraph node count');
  const byLevel = {};
  for (const e of rg.edges) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(e, 'level'),
      `edge ${e.a}->${e.b} (${e.name || e.highway}) has no level`,
    );
    assert.ok(Number.isInteger(e.level), `edge ${e.a}->${e.b} level is not an integer: ${e.level}`);
    byLevel[e.level] = (byLevel[e.level] || 0) + 1;
  }
  assert.deepEqual(byLevel, LEVEL_DIST, 'level distribution');
});

test('issue #317: the HEAD builder reproduces the committed roadGraph exactly, level included', { timeout: 600000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taipei-roadgraph-level-'));
  try {
    const out = path.join(dir, 'taipei-geodata.js');
    const result = spawnSync(
      process.execPath,
      ['--max-old-space-size=8192', path.join(root, 'tools/taipei/build-taipei-geodata.mjs'), out],
      { encoding: 'utf8', env: { ...process.env }, timeout: 540000 },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const { TAIPEI_GEO: fresh } = await import(pathToFileURL(out).href);
    // Full-field deep-equal: nodes in order, every edge field (a, b,
    // name, highway, oneway, width, pedestrianLayout, length, level).
    // Other sections are NOT compared here — blocks/heights/roads are
    // known transplants that the HEAD builder re-derives differently
    // (#313 blocks, #314 heights order, #313 roads seam stubs).
    assert.deepEqual(fresh.roadGraph, TAIPEI_GEO.roadGraph, 'builder roadGraph == committed roadGraph');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
