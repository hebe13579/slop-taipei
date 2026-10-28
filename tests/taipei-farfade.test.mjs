import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { taipeiCityBlocksOptions } from '../js/taipei-buildings.js';

// Issue #240 — far buildings fade detail with distance, stay
// visible, specials never fade. The shader itself cannot execute
// in node (three.js/WebGPU), so this file pins everything that
// CAN be pinned without a browser: the Taipei-only opt-in, the
// exemption by construction (no landmark path can receive the
// flag), the fade band + uniform switch, and the never-transparent
// shape of the change. The render proof is the frame evidence
// (Beitou -> Taipei 101, fade-band sequence, aerial) plus the
// boot-smoke at the gate.

test('far fade: Taipei lot options opt in, and only there', () => {
  const opts = taipeiCityBlocksOptions(TAIPEI_GEO, { lots: [] });
  assert.equal(opts.farFade, true);
});

const tslSource = readFileSync(new URL('../js/tsl-materials.js', import.meta.url), 'utf8');
const buildingsSource = readFileSync(new URL('../js/buildings.js', import.meta.url), 'utf8');
const landmarksSource = readFileSync(new URL('../js/landmarks.js', import.meta.url), 'utf8');
const taipeiBuildingsSource = readFileSync(new URL('../js/taipei-buildings.js', import.meta.url), 'utf8');

test('far fade: the three lot factories take an opt-in flag, default off', () => {
  // Each factory's option defaults to NO fade, so every existing
  // caller (landmarks, Taipei 101, the terminal) keeps exactly its
  // pre-#240 shader unless it explicitly opts in.
  for (const factory of ['createCurtainWallMaterial', 'createPreWarBuildingMaterial', 'createTileShophouseMaterial']) {
    const body = tslSource.slice(tslSource.indexOf(`function ${factory}`));
    assert.match(body, /farFade = false/, `${factory} defaults farFade off`);
  }
  // The two string-keyed caches split on the flag; the shophouse
  // cache key is JSON.stringify(opts), so the flag splits it too.
  assert.match(tslSource, /_\$\{farFade\}/, 'curtain cache key splits on farFade');
  assert.match(tslSource, /_\$\{cornerPier\}_\$\{farFade\}/, 'prewar cache key splits on farFade');
});

test('far fade: band, uniform switch, and exports', () => {
  assert.match(tslSource, /const FAR_FADE_NEAR_M = 700;/);
  assert.match(tslSource, /const FAR_FADE_FAR_M = 2000;/);
  assert.match(tslSource, /farFadeUniform\.value = enabled \? 1 : 0;/);
  const helper = tslSource.slice(tslSource.indexOf('function farFadeFactorNode()'));
  assert.match(helper, /smoothstep\(FAR_FADE_NEAR_M, FAR_FADE_FAR_M, camDist\)/);
  assert.match(helper, /cameraPosition/);
  assert.match(tslSource, /setFarFadeEnabled,\n  FAR_FADE_NEAR_M,\n  FAR_FADE_FAR_M,/);
});

test('far fade: specials are exempt by construction', () => {
  // No landmark material factory call anywhere can receive the
  // flag: landmarks.js never mentions it, and the only farFade
  // token in taipei-buildings.js is the lot opt-in itself — the
  // registry facade data and the landmarkFacadeMaterial path
  // carry no such key, so a landmark material physically cannot
  // take the faded path.
  assert.equal((landmarksSource.match(/farFade/g) || []).length, 0, 'landmarks.js never mentions farFade');
  const farFadeLines = taipeiBuildingsSource.split('\n').filter((l) => l.includes('farFade'));
  assert.equal(farFadeLines.length, 1, 'exactly one farFade token in taipei-buildings.js');
  assert.match(farFadeLines[0], /farFade: true,/);
  for (const line of taipeiBuildingsSource.split('\n')) {
    if (line.includes('factories.create')) assert.doesNotMatch(line, /farFade/);
  }
});

test('far fade: the lot pools receive the flag from the build options', () => {
  // The single injection point: buildCityBlocks passes its opts'
  // farFade into every lot facade material it creates. The no-opts
  // Manhattan call passes nothing, so NYC materials are unchanged.
  assert.match(buildingsSource, /const lotFarFade = !!opts\?\.farFade;/);
  assert.match(buildingsSource, /farFade: lotFarFade \}\)\);/);
});

test('far fade: nothing is culled or made transparent', () => {
  // The fade is a colour mix only: no fade-related line touches
  // opacity, transparency, or visibility, and the uniform switch
  // only ever writes 1/0 to the shared uniform.
  for (const line of tslSource.split('\n')) {
    if (/farFade|fadeF|fadeOff/.test(line)) {
      assert.doesNotMatch(line, /opacity|transparent|\.visible/);
    }
  }
});
