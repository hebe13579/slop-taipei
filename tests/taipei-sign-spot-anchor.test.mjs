// Upstream storefront sign/spotlight anchor fix (#381, cherry-pick 2:
// upstream commit 6b191ee "Fix storefront sign/spotlight anchor heights
// and below-grade floor0 mask"), ported by hand onto Taipei's files.
//
// These values are runtime rendering anchors — they only show up as
// sign/spotlight placement in a live browser, so no behaviour test can
// observe them in Node. This test pins the ported literals in source
// instead, so a later edit that reverts an anchor fails loudly. It
// proves the code says what the port says, not that a sign sits right
// on a slope (that is unmeasured headlessly — see the PR).
//
// Taipei effect, measured before porting: every awning that gets a
// sign/spotlight has y = 3.8 (the #390 narrow-shophouse awnings carry
// noSign: true, so they never reach this code), so the sign/spot
// anchors are numerically identical in Taipei today (3.8 + 0.88 = 4.68;
// 3.8 + 0.55 = 4.35; 3.8 - 3.8 = 0.0) — the port makes the anchor
// follow the awning if a future awning carries a different y. The
// distance term DOES change: (3.8 - camY)^2 replaces camY^2, which
// shifts the 28-spot pool order and fade slightly at street level.
// The floor0 mask is a no-op in Taipei today (no procedural facade
// box has y0 < 0 — the only negative-y0 boxes are landmark registry
// parts rendered with flat materials, not createFacadeBoxes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => readFileSync(join(root, f), 'utf8');

test('upstream 6b191ee: fascia sign anchors to the awning height (buildings.js)', () => {
  const s = src('js/buildings.js');
  assert.match(s, /dummy\.position\.set\(a\.x, a\.y \+ 0\.88, a\.z\);/);
  assert.doesNotMatch(s, /dummy\.position\.set\(a\.x, 4\.68, a\.z\);/);
});

test('upstream 6b191ee: spotlight distance uses the awning-camera dy (buildings.js)', () => {
  const s = src('js/buildings.js');
  assert.match(s, /const dy = a\.y - camY;/);
  assert.match(s, /const d2 = dx \* dx \+ dz \* dz \+ dy \* dy;/);
  assert.doesNotMatch(s, /const d2 = dx \* dx \+ dz \* dz \+ camY \* camY;/);
});

test('upstream 6b191ee: spotlight position/target anchor to the awning height (buildings.js)', () => {
  const s = src('js/buildings.js');
  assert.match(s, /spot\.position\.set\(a\.x \+ outX \* 0\.45, a\.y \+ 0\.55, a\.z \+ outZ \* 0\.45\);/);
  assert.match(s, /spot\.target\.position\.set\(a\.x \+ outX \* 1\.85, a\.y - 3\.8, a\.z \+ outZ \* 1\.85\);/);
  assert.doesNotMatch(s, /spot\.position\.set\(a\.x \+ outX \* 0\.45, 4\.35, a\.z \+ outZ \* 0\.45\);/);
  assert.doesNotMatch(s, /spot\.target\.position\.set\(a\.x \+ outX \* 1\.85, 0\.0, a\.z \+ outZ \* 1\.85\);/);
});

test('upstream 6b191ee: floor0 mask excludes below-grade vertices (tsl-materials.js)', () => {
  const s = src('js/tsl-materials.js');
  assert.match(s, /const floor0 = step\(0\.0, gridV\)\.mul\(float\(1\.0\)\.sub\(step\(1\.0, gridV\)\)\);/);
  assert.doesNotMatch(s, /const floor0 = float\(1\.0\)\.sub\(step\(1\.0, gridV\)\);/);
  // The shopDoor pin from #390 still holds — the mask change must not
  // have touched the door wiring.
  assert.ok(s.includes('const shopDoor = floor0.mul(isGroundFloor)'));
});
