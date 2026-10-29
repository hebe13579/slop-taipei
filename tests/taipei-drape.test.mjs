// Issue #132: the Beitou + Yuanshan terrain drape. Pins the shared
// height field (js/taipei-drape.js), the kill-switch, the deck/MRT
// lift invariance (js/taipei-viaduct.js), the lot plinth rule
// (js/taipei-buildings.js options), the ribbon densifier
// (js/taipei-ribbons.js), the bridge no-op on current data
// (js/taipei-bridges.js), the drape-aware drive sampler
// (js/taipei-drive.js), the patch grids, and the drape setting
// (js/settings.js) — on synthetic digests and on the real tile.
import assert from 'node:assert/strict';
import test from 'node:test';
import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { drapeHeight, drapeDem, drapeWeight, drapeEnabled, setDrapeEnabled, buildDrapePatchGrids, DRAPE_FEATHER } from '../js/taipei-drape.js';
import { buildDeckGeometry, LOW_BED_H, PARAPET_H } from '../js/taipei-viaduct.js';
import { buildBridgeGeometry } from '../js/taipei-bridges.js';
import { buildDriveModel } from '../js/taipei-drive.js';
import { densifyPts } from '../js/taipei-ribbons.js';
import { planTaipeiBuildings, taipeiCityBlocksOptions } from '../js/taipei-buildings.js';
import { resolveSettings, persistSettings, DEFAULT_SETTINGS } from '../js/settings.js';

// --- the height field ------------------------------------------------

test('drapeHeight is exactly 0 outside the rects + feather', () => {
  // A ring of points 1 km outside both rects, plus the far tile corners.
  const pts = [[0, 0], [-2000, -2000], [-12000, -8000], [-12000, -14000], [-3000, -3000], [-3000, -6000], [-6000, -4000], [5000, 5000]];
  for (const [x, z] of pts) assert.equal(drapeHeight(x, z), 0, `(${x}, ${z})`);
});

test('drapeHeight equals the DEM inside a rect (weight 1)', () => {
  // Deep inside the Beitou rect: weight is 1, so the height is the
  // smoothed DEM exactly.
  for (const [x, z] of [[-8000, -11000], [-7000, -10000], [-9000, -12000]]) {
    assert.equal(drapeHeight(x, z), drapeDem(x, z));
    assert.ok(drapeHeight(x, z) > 0);
  }
});

test('drapeHeight feathers 1 -> 0 across the 200 m band', () => {
  // The Beitou rect's west edge is x = -10193.2; walk east across it.
  const edge = -10193.2;
  const wIn = drapeWeight(edge + 10, -11000), wMid = drapeWeight(edge - 100, -11000), wOut = drapeWeight(edge - DRAPE_FEATHER - 10, -11000);
  assert.equal(wIn, 1);
  assert.ok(wMid > 0 && wMid < 1, `feather weight ${wMid}`);
  assert.equal(wOut, 0);
  assert.ok(drapeHeight(edge - 100, -11000) < drapeHeight(edge + 10, -11000));
});

test('Grand Hotel site height is ~40 m', () => {
  // The registry landmark's own centre: the bake prints raw 38.8 /
  // smoothed 40.2 at the hotel point.
  const hotel = drapedPlan.landmarkTowers.find((s) => s.id === 'grand-hotel');
  const h = drapeHeight(hotel.x, hotel.z);
  assert.ok(Math.abs(h - 40.2) < 0.5, `hotel ground ${h}`);
});

// --- the kill-switch ---------------------------------------------------

test('kill-switch: setDrapeEnabled(false) makes drapeHeight identically 0', () => {
  try {
    setDrapeEnabled(false);
    assert.equal(drapeEnabled(), false);
    for (let x = -11000; x <= -3000; x += 500) {
      for (let z = -13500; z <= -4000; z += 500) assert.equal(drapeHeight(x, z), 0, `(${x}, ${z})`);
    }
    // The patch grids collapse to the flat -0.02 sheet (no pins: the
    // in-water test needs y > -0.02, which never holds at height 0).
    const grids = buildDrapePatchGrids((TAIPEI_GEO.water || []).map((w) => w.ring));
    assert.equal(grids.length, 2);
    for (const g of grids) {
      for (let i = 1; i < g.positions.length; i += 3) assert.ok(Math.abs(g.positions[i] + 0.02) < 1e-6);
    }
  } finally {
    setDrapeEnabled(true);
    assert.equal(drapeEnabled(), true);
  }
});

// --- deck lift invariance ----------------------------------------------

const flatDeck = {
  deckDepth: 1.8,
  piers: [],
  lines: [{ wayId: 1, name: 'synthetic', highway: 'secondary', layer: 1, width: 14, pts: [0, 0, 100, 0, 200, 0, 300, 0], h: [9, 9, 9, 9] }],
};

test('deck lift: a uniform ground lift shifts every vertex exactly, triCount unchanged', () => {
  const flat = buildDeckGeometry(flatDeck);
  const lifted = buildDeckGeometry(flatDeck, { groundAt: () => 10 });
  assert.equal(lifted.triCount, flat.triCount);
  assert.equal(lifted.concrete.positions.length, flat.concrete.positions.length);
  let maxErr = 0;
  for (let i = 0; i < flat.concrete.positions.length; i += 3) {
    const dy = lifted.concrete.positions[i + 1] - flat.concrete.positions[i + 1];
    maxErr = Math.max(maxErr, Math.abs(dy - 10));
    assert.equal(lifted.concrete.positions[i], flat.concrete.positions[i]);
    assert.equal(lifted.concrete.positions[i + 2], flat.concrete.positions[i + 2]);
  }
  assert.ok(maxErr < 1e-4, `uniform lift error ${maxErr}`);
});

test('deck lift: a graded ground keeps the deck level across its width', () => {
  // The line runs straight along x, so every vertex at station x
  // lifts by the centreline ground there, x * 0.01 — the whole
  // cross-section (slab, parapets) rides one value per station.
  const flat = buildDeckGeometry(flatDeck);
  const lifted = buildDeckGeometry(flatDeck, { groundAt: (x) => x * 0.01 });
  assert.equal(lifted.triCount, flat.triCount);
  let maxErr = 0;
  for (let i = 0; i < flat.concrete.positions.length; i += 3) {
    const x = flat.concrete.positions[i];
    const dy = lifted.concrete.positions[i + 1] - flat.concrete.positions[i + 1];
    maxErr = Math.max(maxErr, Math.abs(dy - x * 0.01));
  }
  assert.ok(maxErr < 1e-4, `graded lift error ${maxErr}`);
});

test('deck lift: a low bed lifts to ground + 0.25, form decided on authored height', () => {
  const low = { deckDepth: 1.8, piers: [], lines: [{ wayId: 2, name: 'low', highway: 'tertiary', layer: 1, width: 10, pts: [0, 0, 100, 0], h: [0, 0] }] };
  const flat = buildDeckGeometry(low);
  const lifted = buildDeckGeometry(low, { groundAt: () => 10 });
  const ys = (g) => [...g.positions].filter((_, i) => i % 3 === 1);
  assert.ok(Math.abs(Math.max(...ys(flat.concrete)) - LOW_BED_H) < 1e-6, `flat low-bed top ${Math.max(...ys(flat.concrete))}`);
  assert.ok(Math.abs(Math.max(...ys(lifted.concrete)) - (10 + LOW_BED_H)) < 1e-6);
  assert.ok(Math.abs(Math.min(...ys(lifted.concrete)) - 10) < 1e-6);
  // No parapets on a low bed, lifted or not: the top stays the max.
  assert.ok(Math.max(...ys(lifted.concrete)) < 10 + LOW_BED_H + PARAPET_H);
});

test('deck lift: dive portals on real data are identical (all outside the regions)', () => {
  const flat = buildDeckGeometry(TAIPEI_GEO.mrtDecks, { tracks: true });
  const lifted = buildDeckGeometry(TAIPEI_GEO.mrtDecks, { tracks: true, groundAt: drapeHeight });
  assert.equal(lifted.portal.positions.length, flat.portal.positions.length);
  for (let i = 0; i < flat.portal.positions.length; i++) {
    assert.equal(lifted.portal.positions[i], flat.portal.positions[i]);
  }
});

// --- bridges -------------------------------------------------------------

test('bridges: groundAt moves nothing visible on current data (fringe only)', () => {
  const flat = buildBridgeGeometry(TAIPEI_GEO);
  const lifted = buildBridgeGeometry(TAIPEI_GEO, { groundAt: drapeHeight });
  assert.equal(lifted.triCount, flat.triCount);
  assert.equal(lifted.positions.length, flat.positions.length);
  // 社子大橋's frames graze the Beitou rect's feather fringe: the
  // measured max lift is 0.059 m (a rigid centre lift on a deck
  // 6 m+ up — invisible). Anything bigger would mean a bridge
  // centre sits on real hillside and needs a re-think.
  let maxD = 0;
  for (let i = 0; i < flat.positions.length; i++) maxD = Math.max(maxD, Math.abs(lifted.positions[i] - flat.positions[i]));
  assert.ok(maxD < 0.1, `bridge lift ${maxD}`);
});

// --- densifier ------------------------------------------------------------

test('densifyPts caps segments, preserves endpoints exactly', () => {
  const pts = [0, 0, 100, 0, 100, 30];
  const out = densifyPts(pts, 14);
  assert.equal(out[0], 0);
  assert.equal(out[1], 0);
  assert.equal(out[out.length - 2], 100);
  assert.equal(out[out.length - 1], 30);
  for (let i = 0; i + 3 < out.length; i += 2) {
    assert.ok(Math.hypot(out[i + 2] - out[i], out[i + 3] - out[i + 1]) <= 14 + 1e-9);
  }
  // Already-short polylines come back equal-valued; zero-length
  // segments are dropped without breaking continuity.
  assert.deepEqual(densifyPts([0, 0, 5, 0], 14), [0, 0, 5, 0]);
  assert.deepEqual(densifyPts([0, 0, 0, 0, 10, 0], 14), [0, 0, 10, 0]);
});

// --- drive sampler -----------------------------------------------------------

test('drive sampler: the ground candidate is the draped height', () => {
  const m = buildDriveModel(flatDeck, { groundAt: () => 10 });
  // On the deck with a ground-level hint, the caller stands on the
  // draped ground, not under the deck.
  assert.equal(m.sample(150, 0, 0), 10);
  // A hint on the deck stays on the deck (9 + asphalt 0.03 + 10).
  assert.ok(Math.abs(m.sample(150, 0, 19.03) - 19.03) < 0.02);
  // Off the deck, the sample is the draped ground.
  assert.equal(m.sample(150, 50, 0), 10);
  // The flat model is unchanged: ground 0, deck at 9.03.
  const f = buildDriveModel(flatDeck);
  assert.equal(f.sample(150, 0, 0), 0);
  assert.ok(Math.abs(f.sample(150, 0, 9.03) - 9.03) < 0.02);
});

test('drive sampler: ground-bearing still reads the authored profile', () => {
  // The ramp foot (profile 0.43 m) stays mountable from the draped
  // ground: the ground-bearing test must NOT use the lifted profile.
  const ramp = { deckDepth: 1.8, piers: [], lines: [{ wayId: 1, name: 'ramp', highway: 'secondary', layer: 1, width: 14, pts: [0, 0, 100, 0, 200, 0, 300, 0], h: [0, 8.6, 9, 0] }] };
  const m = buildDriveModel(ramp, { groundAt: () => 10 });
  const s = m.sample(5, 0, 10);
  assert.ok(s > 10 && s < 11, `ramp foot surface ${s} (ground 10 + profile ~0.43 + asphalt)`);
});

// --- plan lifts + lot seating ---------------------------------------------

const drapedPlan = planTaipeiBuildings(TAIPEI_GEO, { groundAt: drapeHeight });
const flatPlan = planTaipeiBuildings(TAIPEI_GEO);

test('plan: lifts appear only with groundAt, and only the hotel + one school lift', () => {
  assert.equal(flatPlan.landmarkTowers.filter((s) => s.lift).length, 0);
  assert.equal(flatPlan.siteStructures.filter((s) => s.lift).length, 0);
  const lifted = drapedPlan.landmarkTowers.filter((s) => s.lift);
  assert.deepEqual(lifted.map((s) => s.id).sort(), ['grand-hotel', 'qingjiang-elementary']);
  const hotel = drapedPlan.landmarkTowers.find((s) => s.id === 'grand-hotel');
  assert.ok(Math.abs(hotel.lift - 40.2) < 0.5, `hotel lift ${hotel.lift}`);
  assert.equal(drapedPlan.lots.length, flatPlan.lots.length);
});

test('lot seating: flat lots are untouched, steep lots seat with the roofline preserved', () => {
  const flatOpts = taipeiCityBlocksOptions(TAIPEI_GEO, flatPlan);
  assert.equal(flatOpts.lots.filter((l) => l.y !== undefined).length, 0);
  const opts = taipeiCityBlocksOptions(TAIPEI_GEO, drapedPlan, { groundAt: drapeHeight });
  let seated = 0;
  for (let i = 0; i < drapedPlan.lots.length; i++) {
    const lot = drapedPlan.lots[i], r = opts.lots[i];
    if (r.y === undefined) {
      assert.equal(r.h, lot.h);
      continue;
    }
    seated++;
    // Roofline: base + extended height == centre ground + authored height.
    assert.ok(Math.abs((r.y + r.h) - (drapeHeight(lot.x, lot.z) + lot.h)) < 1e-6, `roofline lot ${i}`);
    assert.ok(r.h >= lot.h);
  }
  assert.ok(seated > 8000, `seated lots ${seated}`);
});

test('lot seating: a synthetic slope seats at the lowest corner', () => {
  const plan = { lots: [{ x: 0, z: 0, w: 20, d: 20, h: 12, rot: 0, color: 0 }] };
  const opts = taipeiCityBlocksOptions(TAIPEI_GEO, plan, { groundAt: (x) => 10 + x * 0.1 });
  const r = opts.lots[0];
  // Corners at x = -10..10 -> ground 9..11; centre 10.
  assert.equal(r.y, 9);
  assert.equal(r.h, 13);
  assert.equal(r.y + r.h, 22);
});

// --- patch grids -------------------------------------------------------------

test('patch grids: two grids at h-0.02, water pins at -0.05, valid indices', () => {
  const grids = buildDrapePatchGrids((TAIPEI_GEO.water || []).map((w) => w.ring));
  assert.equal(grids.length, 2);
  let pinned = 0;
  for (const g of grids) {
    assert.equal(g.triCount, g.nx * g.nz * 2);
    assert.equal(g.indices.length, g.triCount * 3);
    for (const ix of g.indices) assert.ok(ix < (g.nx + 1) * (g.nz + 1));
    for (let i = 0; i < g.positions.length; i += 3) {
      const x = g.positions[i], y = g.positions[i + 1], z = g.positions[i + 2];
      const h = drapeHeight(x, z);
      // Float32 storage + float32-rounded sample positions: allow
      // ~1 mm for the height at a re-read vertex on a steep slope.
      if (Math.abs(y + 0.05) < 1e-6) { pinned++; assert.ok(h > 0, 'a pin needs ground above the water'); }
      else assert.ok(Math.abs(y - (h - 0.02)) < 1e-3, `patch vertex y ${y} vs h ${h}`);
      assert.ok(y >= -0.05 - 1e-6);
    }
  }
  assert.ok(pinned > 0, 'no water-pinned vertices found');
});

// --- settings ------------------------------------------------------------------

test('settings: drape defaults on, resolves from storage and ?drape=', () => {
  assert.equal(DEFAULT_SETTINGS.drape, true);
  assert.equal(resolveSettings({}).drape, true);
  assert.equal(resolveSettings({ search: '?drape=off' }).drape, false);
  assert.equal(resolveSettings({ search: '?drape=0' }).drape, false);
  assert.equal(resolveSettings({ search: '?drape=on' }).drape, true);
  assert.equal(resolveSettings({ stored: { drape: false } }).drape, false);
  // URL wins over storage.
  assert.equal(resolveSettings({ search: '?drape=on', stored: { drape: false } }).drape, true);
  assert.equal(resolveSettings({ search: '?drape=off', stored: { drape: true } }).drape, false);
  // Other fields are untouched by the drape default.
  const s = resolveSettings({ search: '?drape=off' });
  assert.equal(s.density, 'fine');
  assert.equal(s.specials, true);
});

test('settings: persist round-trips the drape flag', () => {
  let saved = null;
  const storage = { getItem: () => saved, setItem: (k, v) => { saved = v; } };
  assert.equal(persistSettings(storage, { ...DEFAULT_SETTINGS, drape: false }), true);
  assert.equal(JSON.parse(saved).drape, false);
  assert.equal(resolveSettings({ stored: saved }).drape, false);
});
