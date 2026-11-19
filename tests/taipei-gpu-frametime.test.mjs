// Upstream GPU frame-time optimisation (#381, cherry-pick 1: upstream
// commit c8a904d "Optimize GPU frame time, shadow cascades, and
// instanced culling"), ported by hand onto Taipei's files.
//
// These values are runtime rendering configuration — they only show
// up as GPU frame time / shadow quality in a live browser, so no
// behaviour test can observe them in Node. This test pins the ported
// literals in source instead, so a later edit that reverts a threshold
// fails loudly. It proves the code says what the port says, not that
// the frame time improved (that is unmeasured headlessly — see the PR).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => readFileSync(join(root, f), 'utf8');

test('upstream c8a904d: curbs do not cast shadows (city-grid.js)', () => {
  const s = src('js/city-grid.js');
  assert.match(s, /mergeInto\(curbGeos, curbMat, false\);/);
  assert.match(s, /curbInstanced\.castShadow = false;/);
  // The sidewalk slabs and hedges keep casting (upstream only changed curbs).
  assert.match(s, /mergeInto\(hedgeGeos, medianHedgeMat, true\);/);
});

test('upstream c8a904d: shadow atlas fixed at 2048px tiles, far 220 m (lighting.js)', () => {
  const s = src('js/lighting.js');
  assert.match(s, /const tile = 2048;/);
  assert.doesNotMatch(s, /maxTex >= 6144 \? 3072 : 2048/);
  assert.match(s, /this\.sunLight\.shadow\.camera\.far = 220;/);
  assert.match(s, /Math\.max\(220, Math\.min\(600, 200 \+ altitude \* 1\.5\)\)/);
});

test('upstream c8a904d: MSAA disabled on Firefox only (main.js)', () => {
  const s = src('js/main.js');
  assert.ok(s.includes("const isFirefox = typeof navigator !== 'undefined' && /Firefox\\//.test(navigator.userAgent);"));
  assert.match(s, /antialias: !isFirefox,/);
});

test('upstream c8a904d: bloom resolution scale 0.35 (post-processing.js)', () => {
  const s = src('js/post-processing.js');
  assert.match(s, /bloomPass\.setResolutionScale\(0\.35\);/);
});

test('upstream c8a904d: lowered culling thresholds (scene-culling.js)', () => {
  const s = src('js/scene-culling.js');
  assert.match(s, /o\.count < 32 \|\| o\.count !== o\.instanceMatrix\.count/);
  assert.match(s, /o\.count \* triangleCount\(o\.geometry\) < 8000 && o\.userData\.cullDistance == null/);
  assert.match(s, /o\.boundingSphere\.radius < 800\) return;/);
  assert.match(s, /if \(tris < 8000\) return;/);
  assert.match(s, /if \(radius > 350\) sources\.push\(o\);/);
  // The #245 cullDistance exception survives the port.
  assert.match(s, /o\.userData\.cullDistance == null/);
});
