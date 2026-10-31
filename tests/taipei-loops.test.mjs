// Issue #213 enforcement: interchange-loop interiors are
// non-buildable ground.
//
// The lot gauntlet always cleared the carriageways themselves;
// the ground they enclose — cloverleaf infields, the pockets
// between an interchange's carriageways — was no exclusion class
// at all, and OSM's green layer tags only some infields (the
// 濱江 interchange's south loops were already clean; its north
// loop carried 26 phantom buildings). The geodata builder now
// derives the enclosed components from the roadbed/water/green
// layers (tools/taipei/build-loops.mjs: a land component is a
// loop site when it is 400..60000 m2, holds at most one door
// plate, is under half park/green, touches no tile edge, fills
// >= 0.15 of its bbox, and has >= 2/3 of its boundary against
// interchange carriageways — deck beds, motorway/trunk beds and
// *_link beds). The rule was verified component-by-component
// against Esri satellite overlays before it shipped
// (cloverleaf213-evidence/): every lot-bearing site is grass
// infield or carriageway verge in reality.
//
// This audit pins (a) the shipped geodata carries exactly the
// sites the derivation rule produces — re-derived here from the
// shipped layers, so the section can never drift into a hand
// list; (b) the planner's counts; (c) the acceptance invariant:
// no surviving lot's centre or footprint corner inside any site
// ring; (d) the grass tint reads the sites without touching the
// #141 green layers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { planTaipeiBuildings } from '../js/taipei-buildings.js';
import { buildLoopTintLayers, LOOP_TINT_TONE } from '../js/taipei-green.js';
import { deriveLoopSites } from '../tools/taipei/build-loops.mjs';

const sites = TAIPEI_GEO.loopSites || [];
const ringArea = (ring) => {
  let a = 0;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) a += (ring[j] - ring[i]) * (ring[j + 1] + ring[i + 1]);
  return a / 2;
};
const inRing = (ring, x, z) => {
  let c = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i], zi = ring[i + 1], xj = ring[j], zj = ring[j + 1];
    if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) c = !c;
  }
  return c;
};
const inAnySite = (x, z) => sites.some((s) => inRing(s.ring, x, z));

test('geodata carries the derived loop sites (issue #213)', (t) => {
  assert.equal(sites.length, 62, 'loop sites emitted by the geodata builder');
  let area = 0;
  for (const s of sites) {
    assert.ok(Array.isArray(s.ring) && s.ring.length >= 8, 'every site is a real ring');
    for (const v of s.ring) assert.ok(Number.isFinite(v), 'finite ring geometry');
    area += Math.abs(ringArea(s.ring));
  }
  t.diagnostic(`loop sites: ${sites.length} rings, ${(area / 1e4).toFixed(2)} ha`);
  assert.ok(Math.abs(area - 131512) / 131512 < 0.01, `site area ${Math.round(area)} m2 (the derivation's raster area, exact at build)`);
});

test('the shipped sites are the derivation rule output, re-derived', () => {
  // ~40 s: the full raster census over the shipped layers. The
  // shipped section must equal the rule's output ring for ring —
  // a hand-edited or stale section fails here.
  const { sites: derived, stats } = deriveLoopSites({ ...TAIPEI_GEO, loopSites: undefined });
  assert.equal(stats.droppedMismatch, 0, 'every derived ring rasterises back onto its component');
  assert.deepEqual(derived, sites, 'shipped loopSites == deriveLoopSites(shipped layers)');
});

test('type sites: infields in, the real neighbourhood out', () => {
  // 重慶北路 × 汐止高架橋 (the issue's type site): the centroid of
  // the big west loop infield, satellite-verified grass.
  assert.ok(inAnySite(-7016, -4845), 'type-site loop infield is a loop site');
  // The residential fabric west of the interchange (31 real lots,
  // boundary 44% interchange): NOT a site — enclosure share and
  // occupation both say city block.
  assert.ok(!inAnySite(-6937, -4924), 'the neighbourhood west of the type site stays buildable');
  // 大直橋 south interchange infield (20 phantom lots before).
  assert.ok(inAnySite(-3250, -4330), 'Dazhi Bridge interchange infield is a loop site');
  // 濱江 / 中山高 north loop infield (26 phantom lots before; its
  // single door plate is geocoding spill, satellite shows grass).
  assert.ok(inAnySite(-5222, -5062), 'Binjiang interchange north loop is a loop site');
});

test('the planner clears the loops — and only the loops move', () => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  assert.equal(plan.stats.blocksSkippedLoop, 58, 'blocks whose centroid falls in a loop site');
  assert.equal(plan.stats.lotsDroppedLoop, 363, 'lot candidates dropped by the loop tests (364 on the pre-#221 tree; issue #221 composition at the merge gate: one loop candidate stands on campus land and the school exclusion drops it first — probed with the schools layer off, the count reproduces 364 and blocksSkippedLoop stays 58)');
  // 71,315 on the worker's base: the #213 A/B there is 71,446
  // -> 71,315 (-131 net: the 125 lots that stood inside loop
  // rings, the remaining candidates of the 58 skipped blocks,
  // and the frontage/packing knock-ons of the removed fabric —
  // every other stat delta is attribution moving off the
  // vanished candidates). The 71,446 baseline is itself a full
  // rebuild of main: the committed geodata's plan is 71,443,
  // and one MRT pier cluster near Beitou re-arranges on any
  // rebuild (555 -> 554 piers; pre-existing drift, identical
  // in a pristine rebuild of main — not a #213 effect).
  // Re-pinned at the #227 merge gate on the merged tree: the
  // A/B against the shipped pre-#213 plan (75,520, post-#226)
  // is the same -131 net (75,389) and the 58/364 counters
  // above reproduce exactly — the loop fabric is untouched by
  // #186/#226, and the derivation on merged inputs accepts
  // the same 62 components at 131,508 m2 vs 131,512 m2 (a
  // 4 m2 boundary shift from the #226 creek narrowing).
  assert.equal(plan.lots.length, 68538, 'plan lot count with the loop exclusion live (75,389 before issue #221; the #221 merge gate re-pin — campus clearing removes 6,819 lots, loop counters 58/363 reproduce as re-pinned above; the #255 re-pin — 4 new registry sites exclude 32 lots: 17 TWTC Hall 1, 4 Grand Hyatt, 7 ATT 4 FUN, 4 Bellavita, counted on the pre-#255 plan)');
  assert.equal(plan.stats.blocksSkippedAirfield, 45, 'airfield exclusion unmoved (#134)');
  assert.equal(plan.stats.lotsDroppedAirfield, 222, 'airfield exclusion unmoved (#134)');
  let inside = 0;
  for (const lot of plan.lots) {
    const hw = lot.w / 2, hd = lot.d / 2;
    const pts = [[lot.x, lot.z], [lot.x - hw, lot.z - hd], [lot.x + hw, lot.z - hd], [lot.x + hw, lot.z + hd], [lot.x - hw, lot.z + hd]];
    if (pts.some(([x, z]) => inAnySite(x, z))) inside++;
  }
  assert.equal(inside, 0, 'no surviving lot centre or corner inside any loop site');
});

test('loop tint: one grass layer over exactly the sites, green untouched', () => {
  const layers = buildLoopTintLayers(sites);
  assert.equal(layers.length, 1, 'one tone layer');
  assert.equal(layers[0].tone, LOOP_TINT_TONE, 'the sampled open-grass tone');
  assert.equal(layers[0].rings.length, sites.length, 'every site ring tinted');
  const tintArea = layers[0].rings.reduce((s, r) => s + Math.abs(ringArea(r)), 0);
  const siteArea = sites.reduce((s, x) => s + Math.abs(ringArea(x.ring)), 0);
  assert.ok(Math.abs(tintArea - siteArea) < 1, 'tint coverage equals site coverage');
  assert.deepEqual(buildLoopTintLayers(undefined), [], 'no sites, no tint (older geodata boots as before)');
  assert.deepEqual(buildLoopTintLayers([]), [], 'empty sites, no tint');
});
