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
import { drapeHeight, drapeDem, drapeWeight, drapeEnabled, setDrapeEnabled, flatSiteFactor, buildDrapePatchGrids, buildAdaptiveDrapeGround, buildDrapeRefineMask, drapeTerrainColor, DRAPE_GROUND_TOL_M, DRAPE_GROUND_MAX_DEPTH, DRAPE_RECTS, DRAPE_FLAT_SITES, DRAPE_FEATHER } from '../js/taipei-drape.js';
import { portalTrenchSlots } from '../js/taipei-viaduct.js';
import { roadTrenchSlots } from '../js/taipei-airfield.js';
import { buildDeckGeometry, LOW_BED_H, PARAPET_H } from '../js/taipei-viaduct.js';
import { buildBridgeGeometry } from '../js/taipei-bridges.js';
import { buildDriveModel } from '../js/taipei-drive.js';
import { densifyPts } from '../js/taipei-ribbons.js';
import { planTaipeiBuildings, taipeiCityBlocksOptions } from '../js/taipei-buildings.js';
import { resolveSettings, persistSettings, DEFAULT_SETTINGS } from '../js/settings.js';

// --- the height field ------------------------------------------------

test('drapeHeight is exactly 0 outside the rects + feather', () => {
  // A ring of points 1 km outside both rects, plus the far tile corners.
  // Issue #263: the point (-3000, -6000) used to sit here — the
  // extended Yuanshan rect (east to lon 121.558, north to lat 25.108)
  // now covers it (drapeHeight 93.8 m on 劍潭山), so it moved east
  // to (0, -6000), outside the rect + feather.
  const pts = [[0, 0], [-2000, -2000], [-12000, -8000], [-12000, -14000], [-3000, -3000], [0, -6000], [-6000, -4000], [5000, 5000]];
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

test('flat site: the 故宮 grounds stay flat inside the npm ring (issue #263)', () => {
  // The #186 flat-convention pin: the museum grounds are flat while
  // the hills around them get terrain. The ring is baked from
  // geodata's npmSite at bake time (tools/taipei/build-drape-dem.py);
  // pin the baked copy == geodata's ring so a geodata edit that
  // moves the grounds is caught here, not on the live page.
  const ring = TAIPEI_GEO.npmSite.site[0].ring;
  assert.equal(DRAPE_FLAT_SITES.length, 1);
  assert.equal(DRAPE_FLAT_SITES[0].name, 'npm');
  assert.deepEqual(DRAPE_FLAT_SITES[0].ring, ring);
  assert.equal(DRAPE_FLAT_SITES[0].feather, 200);
  // Inside the ring the field is 0 even though the DEM is 23-93 m:
  // the ring centre (DEM 36.9 m) and the forecourt steps.
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    minX = Math.min(minX, ring[i]); maxX = Math.max(maxX, ring[i]);
    minZ = Math.min(minZ, ring[i + 1]); maxZ = Math.max(maxZ, ring[i + 1]);
  }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  assert.equal(drapeHeight(cx, cz), 0, 'ring centre must be flat');
  assert.ok(drapeDem(cx, cz) > 20, `centre DEM ${drapeDem(cx, cz)} (the carve-out must be doing work)`);
  assert.equal(drapeHeight(-1636, -7500), 0, 'forecourt steps must be flat');
  // The museum itself does not lift: it is a landmarkTower with no lift.
  // Without the carve-out it would lift 44.4 m as a rigid body on
  // ground varying 37.8-52.5 m under its podium (float up to 6.6 m,
  // bury up to 8.1 m — measured 2026-11-04).
  const npm = drapedPlan.landmarkTowers.find((s) => s.id === 'national-palace-museum');
  assert.ok(npm, 'national-palace-museum missing from the plan');
  assert.equal(npm.lift, undefined);
  assert.equal(drapeHeight(npm.x, npm.z), 0);
  // The factor feathers 0 -> 1 across the 200 m band outside the ring:
  // 100 m south of the ring's south edge it is mid-ramp, 300 m south
  // the field is the full DEM (the hills return).
  assert.ok(flatSiteFactor(cx, maxZ + 100) > 0 && flatSiteFactor(cx, maxZ + 100) < 1, `ramp factor ${flatSiteFactor(cx, maxZ + 100)}`);
  assert.equal(flatSiteFactor(cx, maxZ + 300), 1);
  assert.ok(drapeHeight(cx, maxZ + 300) > 0, 'south of the ring the hills return');
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

test('deck lift: dive portals ride the draped ground (issue #263)', () => {
  // The portals used to sit entirely outside the regions, so the
  // lifted and flat portals were identical. Issue #263 extends the
  // Yuanshan rect east to lon 121.558, which covers the Wenhu Line's
  // dive portal at 大直 (121.5512, 25.0855): the ground there is
  // ~11 m (DEM 10.8-11.0), so the portal lifts ~11 m. The portal
  // is a rigid structure whose lift is sampled at the snapped
  // centreline point, not at each vertex, so the lift matches the
  // ground at each vertex only within the snapping error on the
  // slope (measured max 0.31 m) — the bound is 0.5 m.
  const flat = buildDeckGeometry(TAIPEI_GEO.mrtDecks, { tracks: true });
  const lifted = buildDeckGeometry(TAIPEI_GEO.mrtDecks, { tracks: true, groundAt: drapeHeight });
  assert.equal(lifted.portal.positions.length, flat.portal.positions.length);
  let moved = 0, maxErr = 0;
  for (let i = 0; i < flat.portal.positions.length; i += 3) {
    const x = flat.portal.positions[i], z = flat.portal.positions[i + 2];
    const lift = lifted.portal.positions[i + 1] - flat.portal.positions[i + 1];
    if (Math.abs(lift) > 0.01) moved++;
    const err = Math.abs(lift - drapeHeight(x, z));
    maxErr = Math.max(maxErr, err);
    assert.ok(err < 0.5, `portal vertex (${x}, ${z}) lift ${lift} vs ground ${drapeHeight(x, z)}`);
  }
  // The 大直 portal is the only one that moves (120 of 264 vertices).
  assert.ok(moved > 0 && moved < flat.portal.positions.length / 3, `moved portal vertices ${moved}`);
  assert.ok(maxErr > 0, 'no portal moved — the 大直 portal should lift');
});

// --- bridges -------------------------------------------------------------

test('bridges: groundAt lifts each signature bridge rigidly by its centre ground (issue #263)', () => {
  const flat = buildBridgeGeometry(TAIPEI_GEO);
  const lifted = buildBridgeGeometry(TAIPEI_GEO, { groundAt: drapeHeight });
  assert.equal(lifted.triCount, flat.triCount);
  assert.equal(lifted.positions.length, flat.positions.length);
  // Issue #263: the extended Yuanshan rect now covers the 大直橋 —
  // its centre is over the 基隆河 at DEM 1.6 m, so it lifts 1.58 m,
  // invisible on a 69 m cable-stayed bridge. The other four
  // signature bridges sit on flat ground (centre ground 0). Each
  // bridge lifts rigidly by exactly the draped ground at its centre.
  for (const b of flat.bridges) {
    const lb = lifted.bridges.find((x) => x.id === b.id);
    const lift = lb.maxY - b.maxY;
    assert.ok(Math.abs(lift - drapeHeight(b.centre[0], b.centre[1])) < 1e-6, `${b.id} lift ${lift} vs centre ground ${drapeHeight(b.centre[0], b.centre[1])}`);
  }
  // The deck ribbons follow the terrain under each vertex (the
  // #132 deckTopNear rule), so the overall max move is the max
  // ground under a deck vertex: 4.87 m, the riverbank at the
  // Zhongshan Bridge's south landing (DEM 4.8 m) — the decks sit
  // ON the ground there, they do not float above it.
  let maxD = 0;
  for (let i = 0; i < flat.positions.length; i++) maxD = Math.max(maxD, Math.abs(lifted.positions[i] - flat.positions[i]));
  assert.ok(maxD < 5, `bridge lift ${maxD}`);
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

test('plan: lifts appear only with groundAt, and only the hotel + three more lift', () => {
  assert.equal(flatPlan.landmarkTowers.filter((s) => s.lift).length, 0);
  assert.equal(flatPlan.siteStructures.filter((s) => s.lift).length, 0);
  const lifted = drapedPlan.landmarkTowers.filter((s) => s.lift);
  // Issue #263: the extended Yuanshan rect (north to lat 25.108, east
  // to lon 121.558) newly lifts the Miramar park (7.0 m, on the 大直
  // hillside) and the Taipei Performing Arts Center (1.0 m, a feather
  // graze); the hotel (40.2 m) and Qingjiang Elementary (11.4 m) are
  // unchanged. Dayeh Takashimaya and Tianmu Stadium do NOT lift: the
  // north edge stops at 25.108 so they stay outside the feather (the
  // store would otherwise lift 24.9 m and float up to 9.7 m).
  // The 國立故宮博物院 does not lift either — the npm flat site keeps
  // its grounds at 0 (see the flat-site test above).
  assert.deepEqual(lifted.map((s) => s.id).sort(), ['grand-hotel', 'miramar-entertainment-park', 'qingjiang-elementary', 'taipei-performing-arts-center']);
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
  // Issue #263: the extended rect covers the 天母/士林/大直 lots, so
  // the seated count rises from 8,811 (measured 2026-10-30) to 16,065
  // (measured 2026-11-04 on the #263 tree).
  assert.ok(seated > 16000, `seated lots ${seated}`);
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

// --- adaptive drape ground (issue #285) ----------------------------------
// The flat block layer chorded up to +1.20 m above the roads (S3) and
// the 28 m patch up to +1.76 m; the adaptive ground replaces both
// inside the footprint. The builder is pure (js/taipei-drape.js);
// the boot wraps it in meshes (js/taipei-boot.js
// buildAdaptiveDrapeGroundMeshes) and cuts the flat block rects back
// to outside the footprint.

test('adaptive ground: refine mask marks near-road cells only', () => {
  const mask = buildDrapeRefineMask([[0, 0, 100, 0]]);
  assert.equal(mask.needsRefine(0, 0), true);
  assert.equal(mask.needsRefine(50, 0), true);
  assert.equal(mask.needsRefine(90, 0), true);
  assert.equal(mask.needsRefine(140, 0), true);
  assert.equal(mask.needsRefine(300, 0), false);
  assert.equal(mask.needsRefine(500, 0), false);
  assert.equal(mask.needsRefine(0, 500), false);
  assert.equal(buildDrapeRefineMask([]).needsRefine(0, 0), false);
});

test('adaptive ground: colour rule matches the patch THREE colours', () => {
  // Linear-sRGB values of the patch hexes, computed independently
  // (Python sRGB transfer function) — this pins the conversion
  // drapeTerrainColor must reproduce, not the formula itself.
  const close = (got, want) => { for (let i = 0; i < 3; i++) assert.ok(Math.abs(got[i] - want[i]) < 1e-5, `${got} vs ${want}`); };
  close(drapeTerrainColor(0.6, 10), [0.254152, 0.234551, 0.187821]); // rock, steep
  close(drapeTerrainColor(0, 0), [0.184475, 0.242281, 0.107023]); // low, h = 0
  close(drapeTerrainColor(0, 18), [0.061246, 0.138432, 0.046665]); // mid, h = 18
  close(drapeTerrainColor(0, 108), [0.158961, 0.205079, 0.138432]); // high, h = 108
  // Lerp structure: halfway between low and mid at h = 9.
  const mid = drapeTerrainColor(0, 9);
  close(mid, [0.122861, 0.190357, 0.076844]);
});

// The real-tile adaptive ground, built once and shared by the
// seating tests below (the build takes a few seconds; the plan
// below it takes minutes, as the rest of this file already does).
const adaptiveRoads = (TAIPEI_GEO.roadbeds || []).map((b) => b.pts).filter((p) => p && p.length >= 4);
// Issue #263: the adaptive ground skips the trench slots (the
// Wenhu Line dive portal + the 復北地下道 cuts) so the trenches
// stay open — the same slots the boot passes in.
const adaptiveTrenchSlots = [
  ...portalTrenchSlots(TAIPEI_GEO.mrtDecks || { lines: [] }),
  ...roadTrenchSlots(TAIPEI_GEO.airfield),
];
const adaptiveGround = buildAdaptiveDrapeGround((TAIPEI_GEO.water || []).map((w) => w.ring), { roads: adaptiveRoads, trenchSlots: adaptiveTrenchSlots });

test('adaptive ground: stats pin the build (counts, depth, residual)', () => {
  const s = adaptiveGround.stats;
  assert.equal(s.blockTris + s.patchTris, s.totalTris);
  // Each split turns one quad (2 tris) into four (8 tris): +6.
  // Each skipped trench-slot quad removes its 2 tris again.
  assert.equal(s.totalTris, 2 * (s.refinedCells + s.coarseCells) + 6 * s.splits - 2 * s.slotSkippedQuads);
  assert.ok(s.slotSkippedQuads > 0, `slotSkippedQuads ${s.slotSkippedQuads}`);
  assert.ok(s.totalTris > 100000 && s.totalTris < 1000000, `totalTris ${s.totalTris}`);
  assert.ok(s.maxDepth <= DRAPE_GROUND_MAX_DEPTH, `maxDepth ${s.maxDepth}`);
  assert.ok(s.maxResidualOver <= 0.1, `maxResidualOver ${s.maxResidualOver}`);
  // Issue #263: the residual-under bound rises 0.15 -> 0.30. The
  // extended rect + the npm carve-out ramp put refined cells on
  // steeper convex ground (the hillside west of the museum grounds)
  // that does not converge by depth 4: measured 0.272 m at
  // (-1681.5, -7851.8), 135 m from the nearest roadbed, a sag (a gap
  // under the ground) not a burial — the no-road-covered test below
  // still passes, and no road runs over the worst cell.
  assert.ok(s.maxResidualUnder <= 0.3, `maxResidualUnder ${s.maxResidualUnder}`);
  assert.ok(s.refinedCells > 20000 && s.coarseCells > 1000);
  assert.ok(s.blockTris > s.patchTris, 'most of the ground is the pale block tone');
});

// Spatial hash over the adaptive triangle soup for point lookups.
function adaptiveGroundAt(x, z) {
  const CELL = 50;
  const key = (cx, cz) => cx + ',' + cz;
  if (!adaptiveGroundAt.hash) {
    const hash = new Map();
    const add = (arr, base, kind) => {
      const xs = [arr[base], arr[base + 3], arr[base + 6]], zs = [arr[base + 2], arr[base + 5], arr[base + 8]];
      for (let cx = Math.floor(Math.min(...xs) / CELL); cx <= Math.floor(Math.max(...xs) / CELL); cx++) {
        for (let cz = Math.floor(Math.min(...zs) / CELL); cz <= Math.floor(Math.max(...zs) / CELL); cz++) {
          const k = key(cx, cz);
          if (!hash.has(k)) hash.set(k, []);
          hash.get(k).push([arr, base, kind]);
        }
      }
    };
    for (let b = 0; b < adaptiveGround.block.length; b += 9) add(adaptiveGround.block, b, 'block');
    for (const p of adaptiveGround.patch) for (let b = 0; b < p.positions.length; b += 9) add(p.positions, b, 'patch');
    adaptiveGroundAt.hash = hash;
  }
  const list = adaptiveGroundAt.hash.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (!list) return null;
  let best = null;
  for (const [arr, b, kind] of list) {
    const x0 = arr[b], y0 = arr[b + 1], z0 = arr[b + 2];
    const x1 = arr[b + 3], y1 = arr[b + 4], z1 = arr[b + 5];
    const x2 = arr[b + 6], y2 = arr[b + 7], z2 = arr[b + 8];
    const d = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
    if (Math.abs(d) < 1e-9) continue;
    const w0 = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / d;
    const w1 = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / d;
    const w2 = 1 - w0 - w1;
    if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
    const y = w0 * y0 + w1 * y1 + w2 * y2;
    if (!best || y > best.y) best = { y, kind };
  }
  return best;
}

test('adaptive ground: no road is covered (mesh below the ribbon)', () => {
  // Every 5 m along every roadbed inside the footprint: the topmost
  // ground surface must sit below the road ribbon (DEM + 0.06).
  // The pre-fix mesh covered 24 km of road by up to +0.77 m.
  // Issue #263: points inside a trench slot are skipped — the road
  // there dives through the open cut, where the adaptive ground
  // has no mesh by design (the trench-stays-open test pins that).
  // The skip is conservative (whole quads), so the hole extends up
  // to one coarse cell (30.8 m) past the slot's edge — points
  // within 35 m of a slot are the open-cut approach, not a missing
  // ground mesh, so they are skipped too.
  const nearSlot = (x, z) => {
    for (const s of adaptiveTrenchSlots) {
      const xs = s.map((p) => p[0]), zs = s.map((p) => p[1]);
      const dx = Math.max(Math.min(...xs) - x, 0, x - Math.max(...xs));
      const dz = Math.max(Math.min(...zs) - z, 0, z - Math.max(...zs));
      if (Math.hypot(dx, dz) < 35) return true;
    }
    return false;
  };
  let sampled = 0, maxOver = -Infinity, worst = null;
  for (const pts of adaptiveRoads) {
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const x0 = pts[i], z0 = pts[i + 1], x1 = pts[i + 2], z1 = pts[i + 3];
      const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(len / 5));
      for (let k = 0; k <= n; k++) {
        const x = x0 + (x1 - x0) * k / n, z = z0 + (z1 - z0) * k / n;
        const h = drapeHeight(x, z);
        if (h <= 0) continue;
        if (nearSlot(x, z)) continue;
        sampled++;
        const m = adaptiveGroundAt(x, z);
        assert.ok(m, `no ground mesh at road point (${x}, ${z})`);
        const over = m.y - (h + 0.06);
        if (over > maxOver) { maxOver = over; worst = [x, z]; }
        assert.ok(over <= 0, `road covered by ${over.toFixed(3)} m at (${x.toFixed(1)}, ${z.toFixed(1)})`);
      }
    }
  }
  assert.ok(sampled > 50000, `sampled ${sampled}`);
  assert.ok(maxOver <= 0 && maxOver > -0.1, `maxOver ${maxOver} at ${worst}`);
});

test('adaptive ground: sample points seat within tolerance', () => {
  // The probe's points: S1 崇仰一路 (drape 17.83), S3 前港街26巷
  // (drape 10.66, the +1.20 m burial — issue #263 moved S3 from the
  // rect's north feather, where the field read 1.42 m, into the rect
  // interior, where it reads the real 10.7 m DEM), S2 圓山大飯店 approach. The
  // topmost surface must be within the tolerance of the DEM and
  // below the ribbon. S4 （信義路五段） is the flat control: it sits
  // outside the footprint, so the adaptive ground has no mesh there
  // (the flat block layer covers it) and the DEM is 0.
  for (const [name, x, z] of [
    ['S1', -5429.7, -10223.35], ['S2', -3905, -5013],
    ['S3', -4320, -5692.9],
  ]) {
    const h = drapeHeight(x, z);
    const m = adaptiveGroundAt(x, z);
    assert.ok(m, `${name}: no ground mesh at (${x}, ${z})`);
    assert.ok(Math.abs(m.y - h) <= 0.1, `${name}: top ${m.y} vs DEM ${h}`);
    assert.ok(m.y <= h + 0.06, `${name}: top ${m.y} above ribbon ${h + 0.06}`);
  }
  assert.equal(drapeHeight(-47, 68), 0, 'S4 flat control must have no drape');
  assert.equal(adaptiveGroundAt(-47, 68), null, 'S4 is outside the footprint');
});

test('adaptive ground: kill-switch makes it flat', () => {
  try {
    setDrapeEnabled(false);
    const flat = buildAdaptiveDrapeGround((TAIPEI_GEO.water || []).map((w) => w.ring), { roads: adaptiveRoads });
    for (let i = 1; i < flat.block.length; i += 3) assert.ok(Math.abs(flat.block[i] - 0.02) < 1e-6, `block y ${flat.block[i]}`);
    for (const p of flat.patch) for (let i = 1; i < p.positions.length; i += 3) assert.ok(Math.abs(p.positions[i] + 0.02) < 1e-6, `patch y ${p.positions[i]}`);
  } finally {
    setDrapeEnabled(true);
  }
});

test('adaptive ground: the two trench slots inside the footprint stay open (issue #263)', () => {
  // Issue #263 extends the Yuanshan rect north, so two trench slots
  // now sit inside the drape footprint: the Wenhu Line dive portal
  // at 大直 and the 復北地下道 approach cut. The boot cuts the flat
  // block rects back to outside the footprint, and the adaptive
  // ground skips quads intersecting a slot — so the trench stays
  // open instead of being bridged (before this fix the underpass
  // read as a filled-in slab). The other three slots sit far
  // outside both rects + feather.
  assert.ok(adaptiveTrenchSlots.length > 0, 'no trench slots found');
  const touching = [];
  for (const s of adaptiveTrenchSlots) {
    const xs = s.map((p) => p[0]), zs = s.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const overlaps = DRAPE_RECTS.some((r) =>
      maxX >= r.minX - DRAPE_FEATHER && minX <= r.maxX + DRAPE_FEATHER
      && maxZ >= r.minZ - DRAPE_FEATHER && minZ <= r.maxZ + DRAPE_FEATHER);
    if (overlaps) touching.push({ minX, maxX, minZ, maxZ });
  }
  assert.equal(touching.length, 2, `touching slots ${JSON.stringify(touching)}`);
  // Pin the two slots (rounded to 0.1 m): the Wenhu dive portal at
  // 大直 and the 復北地下道 cut.
  const close = (a, b) => Math.abs(a - b) < 0.2;
  const expect = (box, name) => {
    const hit = touching.find((t) => close(t.minX, box[0]) && close(t.minZ, box[1]) && close(t.maxX, box[2]) && close(t.maxZ, box[3]));
    assert.ok(hit, `${name} slot missing from ${JSON.stringify(touching)}`);
    return hit;
  };
  const portal = expect([-1399.4, -5845.6, -1341.0, -5813.9], 'Wenhu portal');
  const fubei = expect([-2098.3, -4328.3, -2079.9, -4232.5], '復北地下道');
  // No adaptive-ground mesh inside either slot: the centre and four
  // interior points (0.2 of the bbox from the centre) must all be
  // uncovered, so the trench reads open.
  for (const t of [portal, fubei]) {
    const cx = (t.minX + t.maxX) / 2, cz = (t.minZ + t.maxZ) / 2;
    const dx = (t.maxX - t.minX) * 0.2, dz = (t.maxZ - t.minZ) * 0.2;
    for (const [x, z] of [[cx, cz], [cx - dx, cz - dz], [cx + dx, cz - dz], [cx - dx, cz + dz], [cx + dx, cz + dz]]) {
      assert.equal(adaptiveGroundAt(x, z), null, `adaptive ground covers trench slot at (${x.toFixed(1)}, ${z.toFixed(1)})`);
    }
  }
  assert.ok(adaptiveGround.stats.slotSkippedQuads > 0, `slotSkippedQuads ${adaptiveGround.stats.slotSkippedQuads}`);
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
