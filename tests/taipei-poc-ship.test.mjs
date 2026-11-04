// #214 ship decision (2026-11-03, "use your best judgement"):
// G1 divided-avenue zebras + G2 corner clamp ship ON by default;
// R1 creek-water clip stays flag-gated OFF — it drops 2 caps on
// bridge decks (ji1079 + ji2121) and its fix is a separate
// follow-up. The boot (js/taipei-boot.js) is the only place the
// defaults live: the library functions (planJunctionCaps,
// buildRoadMarkings) still default their opts off, so the POC tests
// in taipei-junctions.test.mjs and taipei-markings.test.mjs keep
// pinning flag-on behaviour at function level. This file pins that
// the BOOT ships G1+G2 on and R1 off.
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

test('#214 ship: R1 water clip stays opt-in only (source contract)', () => {
  assert.match(bootSource, /poc\.waterClip \? capWaterPolys\(geo\) : null/,
    'waterClip is passed only when deps.poc.waterClip is set — off by default');
  assert.doesNotMatch(bootSource, /waterClip: poc\.waterClip !== false/,
    'waterClip must NOT default on');
});
