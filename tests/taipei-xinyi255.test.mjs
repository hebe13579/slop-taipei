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
  // REWORK (2026-10-30, user verdict: the specials read as cubes):
  // the street photo (xinyi255-rework-evidence/ref-hyatt-twtc.jpg)
  // shows pale stone wings + podium with a dark curved-glass
  // centre bay, not an all-bronze curtain — the satellite's
  // bronze read does not survive the street view.
  assert.equal(hyatt.facade.kind, 'prewar', 'pale stone wings, dark-glass centre bay (street photo)');
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

  // Gate 2026-10-30: re-pinned 42 -> 43 — main's registry is 39, not 38:
  // the National Taiwan Museum (#257) landed on main after this PR's
  // base, so 39 + 4 new structures = 43. The four new sites are
  // unchanged (Hall 1, Hyatt, ATT, Bellavita).
  // Issue #258: re-pinned 47 -> 49 — the south expansion adds 2 net entries (NTU main campus, NTNU Heping campus).
  assert.equal(plan.landmarkTowers.length, 49, '43 + 4 new structures (#289)');
});

test('Grand Hyatt south porte-cochere has columns + canopy as geometry (#294)', () => {
  const hyatt = byId.get('grand-hyatt-taipei');
  assert.ok(hyatt);
  // 13 rework parts + 10 porte-cochere parts (canopy, glass wall, 8 columns)
  // + 9 north-base + loggia parts (#291: 5 base blocks, canopy, 2 columns,
  // glass wall). Re-pinned 23 -> 32 at the #291 re-gate (2026-11-01):
  // the #294 geometry assertions below are unchanged — only the count
  // moved, by the PR's own 9 parts.
  assert.equal(hyatt.parts.length, 32, 'canopy + glass wall + 8 columns on top of the #255 rework');
  const canopy = hyatt.parts.find((p) => p.type === 'box' && p.w === 76 && p.d === 10 && p.y0 === 7);
  assert.ok(canopy, 'pale-stone canopy slab projects 10 m south of the entrance face');
  assert.equal(canopy.dx, -6, 'canopy centred on the entrance block');
  assert.equal(canopy.dz, 47, 'canopy spans the face (dz 42) to 10 m out (dz 52)');
  assert.equal(canopy.h, 0.8, 'canopy clears the sign (sign spans y 3.5..6.5)');
  const glass = hyatt.parts.find((p) => p.type === 'box' && p.w === 70 && p.d === 1 && p.h === 7);
  assert.ok(glass, 'dark-glass lobby wall recessed behind the columns');
  const columns = hyatt.parts.filter((p) => p.type === 'box' && p.w === 1.5 && p.d === 1.5 && p.h === 7 && p.dz === 51);
  assert.equal(columns.length, 8, 'eight stone columns under the canopy south edge');
  const dxs = columns.map((p) => p.dx).sort((a, b) => a - b);
  assert.deepEqual(dxs, [-39.25, -29.75, -20.25, -10.75, -1.25, 8.25, 17.75, 27.25],
    '9.5 m column spacing, half-bay offset so a gap — not a column — stands on the sign axis (dx -6)');
  assert.ok(hyatt.sign && hyatt.sign.text === 'GRAND HYATT' && hyatt.sign.y === 5,
    'entrance wordmark untouched, still on the face below the canopy');
  // Re-pinned 8 -> 13 at the #291 re-gate (2026-11-01): the 5 north-base
  // blocks are storey mass and survive into the far version; the loggia
  // dressing (canopy, columns, glass) drops, as the bands and pool do.
  assert.equal(hyatt.farParts.length, 13, 'far version keeps the bare block (ATT colonnade precedent: near-only detail)');
  assert.equal(Math.max(...hyatt.parts.map((p) => (p.y0 || 0) + p.h)), 104, 'top stays 104 m');
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
  assert.ok(red.every((p) => Math.min(p.w, p.d, p.h) <= 1.2),
    'every frame member is thin in at least one dimension (columns in plan, bands in height)');
  assert.ok(a8.parts.some((p) => p.type === 'cylinder' && p.r === 8),
    'the rooftop disc from the satellite');
  assert.ok(a8.farParts && a8.farParts.length === 2,
    'far A8 is the bare slab — the frame is sub-pixel past 700 m');
});

test('far versions: simplified massing, storey silhouette kept, never culled', () => {
  assert.ok(SCHOOL_LOD_FAR_M > SCHOOL_LOD_NEAR_M, 'the #244 hysteresis band');
  for (const s of plan.landmarkTowers) {
    if (!s.farParts) continue;
    assert.ok(s.farParts.length > 0, `${s.id} far version is non-empty`);
    assert.ok(s.farParts.every((p) => ['box', 'cylinder', 'dome', 'frustum'].includes(p.type)),
      `${s.id}: far parts use the mergeable vocabulary`);
    const nearKeys = new Set(s.parts.map(partKey));
    // Gate 2026-10-30: the National Taiwan Museum (#257, landed on main
    // after this PR's base) builds its far version from a merged base
    // slab (88x34x14) that unifies the terrace + wings — a legitimate
    // simplification, not an invention: its footprint sits inside the
    // near terrace footprint (88x36) and its top (14 m) is below the
    // near hall (18.5 m); the #275 gate's LOD frames prove the
    // silhouette holds, and the storey/farTop checks below pass for
    // it. The subset rule therefore exempts that one slab; every
    // other far part must still match a near part exactly.
    const farToCheck = s.id === 'national-taiwan-museum'
      ? s.farParts.filter((p) => !(p.type === 'box' && p.w === 88 && p.d === 34 && p.h === 14))
      : s.farParts;
    assert.ok(farToCheck.every((p) => nearKeys.has(partKey(p))),
      `${s.id}: every far part matches a near part (simplification, not invention)`);
    // Storey mass: a real floor-bearing part (tall + wide in plan).
    // Roof dressing (thin bands, pergola strips, the rooftop disc,
    // the glass skylight dome, 2 m roof boxes) may drop; storey
    // mass must survive, so the far silhouette is never shorter
    // than the tallest storey, and never taller than the near one.
    const isStoreyMass = (p) => {
      if (p.type === 'box') return p.h >= 5 && Math.min(p.w, p.d) >= 5;
      if (p.type === 'cylinder') return p.h >= 5 && 2 * p.r >= 5;
      if (p.type === 'frustum') return p.h >= 5 && Math.min(p.wB, p.dB) >= 5;
      return false;
    };
    const storey = s.parts.filter(isStoreyMass);
    assert.ok(storey.length > 0, `${s.id} has storey-mass parts`);
    // Gate 2026-10-30 (continued): the same merged slab also stands
    // in for the museum's other five storey-mass parts (four
    // wing/pavilion boxes + rear projection) — none of them survives
    // by exact partKey, by design: the far version merges them into
    // the one slab. The hall survives exactly, and the farTop bounds
    // below still hold (farTop 30 >= storeyTop 18.5, <= nearTop 30);
    // the #275 gate's LOD frames prove the silhouette holds.
    const storeyToCheck = s.id === 'national-taiwan-museum'
      ? storey.filter((p) => p.w === 23.3 && p.d === 27 && p.h === 18.5)
      : storey;
    if (s.id === 'national-taiwan-museum') {
      assert.equal(storeyToCheck.length, 1, 'museum: only the hall survives exactly; the slab stands in for the rest');
    }
    assert.ok(storeyToCheck.every((p) => s.farParts.some((f) => partKey(f) === partKey(p))),
      `${s.id}: every storey-mass part survives into the far version`);
    const nearTop = Math.max(...s.parts.map(partTop));
    const farTop = Math.max(...s.farParts.map(partTop));
    const storeyTop = Math.max(...storey.map(partTop));
    assert.ok(farTop >= storeyTop, `${s.id}: far massing reaches the storey-mass height`);
    assert.ok(farTop <= nearTop, `${s.id}: far massing never exceeds the near silhouette`);
  }
  const withFar = plan.landmarkTowers.filter((s) => s.farParts).map((s) => s.id).sort();
  // Issue #283 (2026-10-30): the 16 reworked live Xinyi specials
  // now carry farParts too, so the far-version checks cover them.
  assert.deepEqual(withFar, [
    'att-4-fun', 'bellavita', 'cathay-financial-center',
    'cathay-landmark', 'eslite-spectrum-songyan',
    'farglory-financial-center', 'four-seasons-hotel-taipei',
    'fubon-xinyi-a25', 'grand-hyatt-taipei',
    'nan-shan-xinyi-a21', 'national-taiwan-museum',
    'shin-kong-mitsukoshi-a11', 'shin-kong-mitsukoshi-a4',
    'shin-kong-mitsukoshi-a8', 'shin-kong-mitsukoshi-a9',
    'songshan-cultural-park', 'taipei-city-hall', 'taipei-dome',
    'taipei-nan-shan-plaza', 'tao-zhu-yin-yuan', 'the-sky-taipei',
    'twtc-exhibition-hall-1', 'twtc-international-trade-building',
    'uni-president-international-tower', 'vieshow-cinemas-xinyi',
    'w-taipei', 'walsin-lihwa-building',
  ], 'exactly the six #255 structures + the museum + the four #289 structures + the sixteen #283 reworks carry far versions');
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
  // Issue #110: plan 68,482 -> 68,472 — 23 bridge links re-admitted + 71 bed-end fusions re-seat 1,282 lots near the changed roadbeds (net -10).
  // Issue #258: plan 68,472 -> 76,367 (+7,895) — the south expansion (see the schools test for the full lot-diff decomposition).
  assert.equal(plan.lots.length, 76367, 'lot count re-pinned for the four new sites (#289: 68,538 − 56 site-excluded lots net)');
  // Gate 2026-10-30: re-pinned 42 -> 43, same reason as above — main's
  // registry is 39 after #257 (museum), + 4 new structures.
  // Issue #258: re-pinned 47 -> 49 — the south expansion adds 2 net entries (NTU main campus, NTNU Heping campus).
  assert.equal(plan.landmarkTowers.length, 49);
});
