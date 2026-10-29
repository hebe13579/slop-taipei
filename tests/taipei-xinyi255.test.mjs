// Issue #255 enforcement: the five Xinyi specials (TWTC Hall 1,
// Grand Hyatt, ATT 4 FUN, A4 upgrade, Bellavita) + the A8 red-frame
// correction + LOD far versions for specials + far despawn for the
// CKS perimeter wall runs and the skybridge chains.
//
// The registry facts are pinned from the reference pack
// (xinyi255-evidence/REFERENCE_PACK.md): OSM way outlines, the
// Esri/OSM overlay that proves the red frame is A8's, and the
// cited Wikipedia figures. Heights flagged `estimated` stay
// estimated — the pins below assert the flag, not false
// precision. The LOD/despawn updaters are behaviour-tested with
// fake objects (the #244 school-LOD pattern); the distances
// themselves are measured from frames (MEASUREMENT.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import {
  planTaipeiBuildings,
  updateSchoolLod,
  updateDespawnEntries,
  SCHOOL_LOD_FAR_M,
  SCHOOL_LOD_NEAR_M,
  DESPAWN_FAR_M,
  DESPAWN_NEAR_M,
} from '../js/taipei-buildings.js';
import {
  buildSkybridgeGeometry,
  skybridgeChainSlices,
} from '../js/taipei-skybridges.js';

const plan = planTaipeiBuildings(TAIPEI_GEO);
const byId = new Map(plan.landmarkTowers.map((s) => [s.id, s]));

const partTop = (p) => (p.y0 || 0) + p.h;
const partKey = (p) => [p.type, p.w, p.d, p.h, p.dx || 0, p.dz || 0, p.y0 || 0,
  p.wB, p.dB, p.wT, p.dT, p.r, p.rx, p.rz].join('|');

test('the five #255 structures are registered with the reference-pack facts', () => {
  const hall = byId.get('twtc-exhibition-hall-1');
  assert.ok(hall, 'TWTC Exhibition Hall 1 registered');
  assert.equal(hall.realHeight, 38);
  assert.equal(hall.estimated, true, 'Hall 1 height is estimated (no published figure)');
  assert.equal(hall.facade.kind, 'curtain', 'green-tinted glass terraces');
  assert.ok(hall.sign && hall.sign.glyphs === 6, 'glyph band for the Chinese name');

  const hyatt = byId.get('grand-hyatt-taipei');
  assert.ok(hyatt, 'Grand Hyatt registered');
  assert.equal(hyatt.realHeight, 104, 'published 104 m (OSM 85 superseded, see entry comment)');
  assert.equal(hyatt.estimated, false);
  assert.equal(hyatt.facade.kind, 'curtain', 'brown-bronze curtain wall, not OSM wheat');
  assert.ok(hyatt.sign && hyatt.sign.text === 'GRAND HYATT', 'entrance wordmark');

  const att = byId.get('att-4-fun');
  assert.ok(att, 'ATT 4 FUN registered');
  assert.equal(att.realHeight, 46);
  assert.equal(att.estimated, true, '11 floors (zh-Wikipedia) x 4.2 m, flagged');
  assert.ok(att.sign && att.sign.text === 'ATT 4 FUN');

  const bella = byId.get('bellavita');
  assert.ok(bella, 'Bellavita registered');
  assert.equal(bella.realHeight, 42);
  assert.equal(bella.estimated, true, '9 floors x ~4.5 m + pavilions, flagged');
  assert.equal(bella.facade.kind, 'prewar', 'cream palace stone');
  assert.ok(bella.sign && bella.sign.text === 'BELLAVITA');
  assert.ok(bella.parts.some((p) => p.type === 'dome' && p.rx === 26 && p.rz === 17),
    'the oval glass skylight dome');

  assert.equal(plan.landmarkTowers.length, 42, '38 + 4 new structures');
});

test('A4 keeps its geometry, goes glassier, and carries NO red frame', () => {
  const a4 = byId.get('shin-kong-mitsukoshi-a4');
  assert.ok(a4);
  assert.equal(a4.facade.kind, 'curtain', 'gleaming-glass halls (see entry comment)');
  assert.ok(a4.sign && a4.sign.glyphs === 4, 'logo band');
  assert.equal(a4.parts.filter((p) => p.flat === 0xb02a1e).length, 0,
    'the red frame is A8\u2019s, not A4\u2019s (satellite overlay proof)');
  assert.ok(a4.farParts && a4.farParts.length === a4.parts.length,
    'A4 far version keeps the whole slab, drops only the sign');
});

test('A8 carries the red exoskeleton (the user-photo correction)', () => {
  const a8 = byId.get('shin-kong-mitsukoshi-a8');
  assert.ok(a8);
  assert.equal(a8.facade.kind, 'curtain', 'dark glass + pale frame bands');
  const red = a8.parts.filter((p) => p.flat === 0xb02a1e);
  assert.equal(red.length, 23, 'corner + face columns, band courses, pergola grid');
  assert.ok(red.every((p) => p.type === 'box'), 'frame members are thin boxes');
  assert.ok(red.every((p) => Math.min(p.w, p.d) <= 1.2), 'no frame member is a slab');
  assert.ok(a8.parts.some((p) => p.type === 'cylinder' && p.r === 8),
    'the rooftop disc from the satellite');
  assert.ok(a8.farParts && a8.farParts.length === 2,
    'far A8 is the bare slab — the frame is sub-pixel past 700 m');
});

test('far versions: simplified massing, same height, never culled', () => {
  assert.ok(SCHOOL_LOD_FAR_M > SCHOOL_LOD_NEAR_M, 'the #244 hysteresis band');
  for (const s of plan.landmarkTowers) {
    if (!s.farParts) continue;
    assert.ok(s.farParts.length > 0, `${s.id} far version is non-empty`);
    assert.ok(s.farParts.every((p) => ['box', 'cylinder', 'dome', 'frustum'].includes(p.type)),
      `${s.id}: far parts use the mergeable vocabulary`);
    const nearKeys = new Set(s.parts.map(partKey));
    assert.ok(s.farParts.every((p) => nearKeys.has(partKey(p))),
      `${s.id}: every far part matches a near part (simplification, not invention)`);
    const nearTop = Math.max(...s.parts.map(partTop));
    const farTop = Math.max(...s.farParts.map(partTop));
    assert.equal(farTop, nearTop, `${s.id}: far massing reaches the same height`);
    assert.ok(s.farParts.every((p) => p.type !== 'box' || Math.min(p.w, p.d) >= 1.5 || p.h >= 5),
      `${s.id}: no thin frame member survives into the far version`);
  }
  const withFar = plan.landmarkTowers.filter((s) => s.farParts).map((s) => s.id).sort();
  assert.deepEqual(withFar, [
    'att-4-fun', 'bellavita', 'grand-hyatt-taipei',
    'shin-kong-mitsukoshi-a4', 'shin-kong-mitsukoshi-a8',
    'twtc-exhibition-hall-1',
  ], 'exactly the six #255 structures carry far versions');
});

test('special LOD swap: hysteresis band, sticky inside it, swaps both ways', () => {
  const near = { visible: true }, far = { visible: false };
  const entries = [{ near, far, x: 0, z: 0, mode: 'near' }];
  updateSchoolLod(entries, 10, 10);
  assert.equal(entries[0].mode, 'near');
  updateSchoolLod(entries, SCHOOL_LOD_FAR_M + 50, 0);
  assert.equal(entries[0].mode, 'far');
  assert.equal(near.visible, false);
  assert.equal(far.visible, true);
  updateSchoolLod(entries, (SCHOOL_LOD_FAR_M + SCHOOL_LOD_NEAR_M) / 2, 0);
  assert.equal(entries[0].mode, 'far', 'inside the band the mode sticks');
  updateSchoolLod(entries, SCHOOL_LOD_NEAR_M - 50, 0);
  assert.equal(entries[0].mode, 'near');
  assert.equal(near.visible, true);
  assert.equal(far.visible, false);
});

test('CKS perimeter wall: 18 parts flagged, 9 wall+cap runs', () => {
  const cks = byId.get('chiang-kai-shek-memorial-hall');
  assert.ok(cks);
  const flagged = cks.parts.filter((p) => p.despawnFar);
  assert.equal(flagged.length, 18, '9 white runs + 9 blue caps');
  assert.ok(flagged.every((p) => p.type === 'box' && p.h <= 3),
    'only the low wall runs despawn — hall, stairs and arch stay');
  const runs = new Map();
  for (const p of flagged) {
    const key = `${p.dx}|${p.dz}|${p.rotY}`;
    if (!runs.has(key)) runs.set(key, []);
    runs.get(key).push(p);
  }
  assert.equal(runs.size, 9, 'one run per wall segment');
  for (const [key, parts] of runs) {
    assert.equal(parts.length, 2, `run ${key} is a wall + its cap`);
    assert.ok(parts.some((p) => p.flat === 0xe9e4d4) && parts.some((p) => p.flat === 0x2c4a7c));
  }
  // The arch assembly is NOT flagged: the gate stays visible.
  assert.ok(cks.parts.length > 40, 'hall + stairs + arch parts untouched');
  assert.ok(cks.parts.filter((p) => p.despawnFar).length < cks.parts.length);
});

test('despawn updater: hysteresis band, sticky inside it, restores on approach', () => {
  assert.ok(DESPAWN_FAR_M > DESPAWN_NEAR_M, 'the despawn hysteresis band is non-empty');
  const mesh = { visible: true };
  const entries = [{ mesh, x: 0, z: 0, shown: true }];
  updateDespawnEntries(entries, 10, 10);
  assert.equal(entries[0].shown, true);
  updateDespawnEntries(entries, DESPAWN_FAR_M + 50, 0);
  assert.equal(entries[0].shown, false);
  assert.equal(mesh.visible, false);
  updateDespawnEntries(entries, (DESPAWN_FAR_M + DESPAWN_NEAR_M) / 2, 0);
  assert.equal(entries[0].shown, false, 'inside the band the hidden state sticks');
  updateDespawnEntries(entries, DESPAWN_NEAR_M - 50, 0);
  assert.equal(entries[0].shown, true);
  assert.equal(mesh.visible, true);
});

test('skybridge chain slices: same triangles, per-chain centroids', () => {
  const g = buildSkybridgeGeometry(TAIPEI_GEO);
  const sliced = skybridgeChainSlices(TAIPEI_GEO);
  assert.equal(sliced.slices.length, 15, 'one slice per chain');
  assert.equal(sliced.triCount, g.triCount, 'slicing preserves the merged total');
  assert.equal(sliced.triCount, 10800, 'tri total pinned (issue #212)');
  let triSum = 0;
  for (const s of sliced.slices) {
    triSum += s.triCount;
    assert.equal(s.positions.length, s.triCount * 9, '9 floats per triangle');
    assert.equal(s.normals.length, s.positions.length);
    assert.equal(s.colors.length, s.positions.length);
    assert.ok(Number.isFinite(s.cx) && Number.isFinite(s.cz), 'centroid is finite');
    assert.ok(s.cx >= -303 && s.cx <= 707 && s.cz >= -1010 && s.cz <= 200,
      'centroid inside the district window');
  }
  assert.equal(triSum, g.triCount, 'slice triangles sum to the merged total');
});

test('plan census: four new sites displace only their own lots', () => {
  // 68,570 (post-#221/#213/#230 composition) -> 68,538: the four
  // new sites (Hall 1, Hyatt, ATT, Bellavita) exclude 32 lots
  // between them; A4/A8 already excluded theirs. Proven by the
  // cross-run in the gate notes (old registry on new code
  // reproduces 68,570 — the delta is the sites only).
  assert.equal(plan.lots.length, 68538, 'lot count re-pinned for the four new sites');
  assert.equal(plan.landmarkTowers.length, 42);
});
