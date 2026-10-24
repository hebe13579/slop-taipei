import assert from 'node:assert/strict';
import test from 'node:test';

import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { planTaipeiBuildings } from '../js/taipei-buildings.js';

// Issue #57: the landmark detail pass. Every registry structure must
// resolve a non-default facade treatment (a TSL factory assignment
// matched to the real building), so no landmark can silently fall
// back to the plain placeholder tint. The assignments are pinned
// per building: changing one is a deliberate edit to this table.

const EXPECTED_FACADES = {
  'taipei-nan-shan-plaza': 'curtain', // dark blue-grey glass shaft
  'the-sky-taipei': 'curtain', // pale pleated glass
  'fubon-xinyi-a25': 'prewar', // stone-and-glass grid
  'cathay-landmark': 'curtain', // two-slab curtain wall
  'uni-president-international-tower': 'prewar', // stone cladding
  'tao-zhu-yin-yuan': 'prewar', // residential stone slabs
  'twtc-international-trade-building': 'prewar', // brown-stone grid
  'taipei-city-hall': 'prewar', // formal municipal rhythm
  'taipei-dome': 'curtain', // panelled drum (tuned curtain)
  'sun-yat-sen-memorial-hall': 'prewar', // sandstone walls
  'w-taipei': 'curtain', // dark hotel grid
  'songshan-cultural-park': 'prewar', // brick factory hall
  'eslite-spectrum-songyan': 'prewar', // pale ribbon-window stone
  'taipei-arena': 'curtain', // silvery shell panels (tuned curtain)
  // Batch 4 (issue #74): the station district — all six are stone /
  // brick civic-era masses, so all six take the prewar grid.
  'shin-kong-life-tower': 'prewar', // beige stone-clad tower
  'taipei-main-station': 'prewar', // stone station house
  'chiang-kai-shek-memorial-hall': 'prewar', // white marble hall
  'national-concert-hall': 'prewar', // cream palace walls
  'national-theater': 'prewar', // cream palace walls
  'presidential-office-building': 'prewar', // red-brick baroque block
  // Batch 5 (issue #86): Beimen — red-brick gatehouse walls.
  'beimen': 'prewar',
};

// The only Latin wordmarks a landmark sign may carry — the ones the
// real buildings carry. Everything else is abstract glyph blocks.
const EXPECTED_SIGNS = {
  'taipei-nan-shan-plaza': { text: 'Breeze' },
  'cathay-landmark': { text: 'Breeze' },
  'w-taipei': { text: 'W' },
  'eslite-spectrum-songyan': { text: 'eslite' },
  'taipei-dome': { glyphs: 7 },
  'sun-yat-sen-memorial-hall': { glyphs: 6 },
  'songshan-cultural-park': { glyphs: 6 },
  // Batch 4 (issue #74): the rooftop 新光人壽 band and the station's
  // 臺北車站 entrance band — abstract glyphs, as on the real signs.
  'shin-kong-life-tower': { glyphs: 4 },
  'taipei-main-station': { glyphs: 4 },
};

test('every landmark resolves its pinned facade treatment', () => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  assert.equal(plan.landmarkTowers.length, Object.keys(EXPECTED_FACADES).length);
  const seeds = new Set();
  for (const s of plan.landmarkTowers) {
    const kind = EXPECTED_FACADES[s.id];
    assert.ok(kind, `unexpected landmark in plan: ${s.id}`);
    assert.ok(s.facade, `${s.id} resolves no facade treatment (plain placeholder)`);
    assert.equal(s.facade.kind, kind, `${s.id} facade kind drifted from its pin`);
    // A distinct seed per building keeps each factory material out
    // of every other style's cache entry.
    assert.equal(typeof s.facade.seed, 'number', `${s.id} facade has no seed`);
    assert.ok(!seeds.has(s.facade.seed), `${s.id} shares facade seed ${s.facade.seed}`);
    seeds.add(s.facade.seed);
    assert.ok(s.facade.windowWidth >= 2 && s.facade.windowWidth <= 9, `${s.id} windowWidth out of range`);
    assert.ok(s.facade.floorHeight >= 3 && s.facade.floorHeight <= 6, `${s.id} floorHeight out of range`);
    // Part-level assignments, where present, are the same data shape.
    for (const part of s.parts) {
      if (part.facade) {
        assert.ok(part.facade.kind === 'curtain' || part.facade.kind === 'prewar', `${s.id} part facade kind`);
        assert.equal(typeof part.facade.seed, 'number', `${s.id} part facade has no seed`);
      }
      if (part.flat !== undefined) {
        const c = typeof part.flat === 'number' ? part.flat : part.flat.color;
        assert.ok(Number.isInteger(c) && c >= 0 && c <= 0xffffff, `${s.id} flat override is not a colour`);
        if (typeof part.flat === 'object') {
          assert.ok(part.flat.roughness >= 0 && part.flat.roughness <= 1, `${s.id} flat roughness out of range`);
          assert.ok(part.flat.metalness >= 0 && part.flat.metalness <= 1, `${s.id} flat metalness out of range`);
        }
      }
    }
  }
});

test('landmark signs are pinned, placed on a real face and wordmark-restricted', () => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  for (const s of plan.landmarkTowers) {
    const expected = EXPECTED_SIGNS[s.id];
    if (!expected) {
      assert.equal(s.sign, null, `${s.id} gained an unpinned sign`);
      continue;
    }
    assert.ok(s.sign, `${s.id} lost its pinned sign`);
    if (expected.text) assert.equal(s.sign.text, expected.text, `${s.id} sign wordmark drifted`);
    if (expected.glyphs) {
      assert.equal(s.sign.glyphs, expected.glyphs, `${s.id} sign glyph count drifted`);
      assert.ok(!s.sign.text, `${s.id} glyph sign must not carry text`);
    }
    for (const k of ['w', 'h', 'y', 'dz']) {
      assert.ok(Number.isFinite(s.sign[k]), `${s.id} sign ${k} is not finite`);
    }
    assert.ok(s.sign.w >= 10 && s.sign.h >= 2.5, `${s.id} sign implausibly small`);
    assert.ok(s.sign.y - s.sign.h / 2 >= 0 && s.sign.y + s.sign.h / 2 <= s.realHeight, `${s.id} sign escapes its structure's height`);
    assert.match(s.sign.bg, /^#[0-9a-f]{6}$/i, `${s.id} sign bg`);
    assert.match(s.sign.fg, /^#[0-9a-f]{6}$/i, `${s.id} sign fg`);
  }
});

test('facade and sign data stay deterministic across plans', () => {
  const a = planTaipeiBuildings(TAIPEI_GEO);
  const b = planTaipeiBuildings(TAIPEI_GEO);
  assert.deepEqual(
    a.landmarkTowers.map((s) => ({ id: s.id, facade: s.facade, sign: s.sign })),
    b.landmarkTowers.map((s) => ({ id: s.id, facade: s.facade, sign: s.sign }))
  );
});
