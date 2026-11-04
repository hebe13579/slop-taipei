// #214 ship decision (2026-11-03, "use your best judgement"):
// G1 divided-avenue zebras + G2 corner clamp ship ON by default
// (PR #309); R1 creek-water clip ships ON by default with the
// sole-crossing guard (this PR) — a cap that is the only paving
// over a creek is kept whole (ji1079 + ji2121). The boot
// (js/taipei-boot.js) is the only place the defaults live: the
// library functions (planJunctionCaps, buildRoadMarkings) still
// default their opts off, so the POC tests in
// taipei-junctions.test.mjs and taipei-markings.test.mjs keep
// pinning flag-on behaviour at function level. This file pins
// that the BOOT ships G1+G2+R1 on.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const bootSource = readFileSync(new URL('../js/taipei-boot.js', import.meta.url), 'utf8');

test('#214 ship: G1 + G2 are on by default in the boot (source contract)', () => {
  assert.match(bootSource, /\{\s*cornerClamp: poc\.cornerClamp !== false\s*\}/,
    'G2 corner clamp defaults on (deps.poc.cornerClamp: false turns it off)');
  assert.match(bootSource, /\{\s*dividedPoc: poc\.divided !== false\s*\}/,
    'G1 divided-avenue zebras default on (deps.poc.divided: false turns them off)');
});

test('#214 ship: R1 water clip is on by default in the boot (source contract)', () => {
  assert.match(bootSource, /poc\.waterClip !== false \? capWaterPolys\(geo\) : null/,
    'waterClip defaults on (deps.poc.waterClip: false turns it off)');
  assert.doesNotMatch(bootSource, /poc\.waterClip \? capWaterPolys\(geo\) : null/,
    'waterClip must NOT stay opt-in only');
});
