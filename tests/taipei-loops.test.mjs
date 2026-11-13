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
  // Issue #110: loop sites 62 -> 64 — the re-derived sites at the interchanges (10 removed + 12 added) ship with the roadbeds.
  // Issue #258: loop sites 64 -> 67 — the south expansion's interchanges add 3 sites (Jianguo / Xinhai / Keelung elevated junctions in 7-south); the derivation re-run on the merged layers reproduces the shipped section ring-for-ring (asserted below).
  assert.equal(sites.length, 67, 'loop sites emitted by the geodata builder');
  let area = 0;
  for (const s of sites) {
    assert.ok(Array.isArray(s.ring) && s.ring.length >= 8, 'every site is a real ring');
    for (const v of s.ring) assert.ok(Number.isFinite(v), 'finite ring geometry');
    area += Math.abs(ringArea(s.ring));
  }
  t.diagnostic(`loop sites: ${sites.length} rings, ${(area / 1e4).toFixed(2)} ha`);
  // Issue #110: site area 131,512 -> 128,784 m2 (-2.1%) — the re-derived loop sites (10 removed + 12 added at the interchanges) cover less raster area.
  // Issue #258: site area 128,784 -> 130,788 m2 (+1.6%) — the 3 new south interchange sites add their infield area.
  assert.ok(Math.abs(area - 130788) / 130788 < 0.01, `site area ${Math.round(area)} m2 (the derivation's raster area, exact at build)`);
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
  // Issue #110: blocksSkippedLoop 58 -> 61 — the re-derived loop sites cover 3 more block centroids.
  // Issue #258: blocksSkippedLoop 61 -> 64 (+3) — the 3 new south loop sites each cover one more block centroid. lotsDroppedLoop holds at 354: the new sites sit on already-road-cleared interchange land, so no lot candidates are lost.
  assert.equal(plan.stats.blocksSkippedLoop, 64, 'blocks whose centroid falls in a loop site');
  // Issue #110: lotsDroppedLoop 363 -> 354 — the re-derived loop sites exclude 9 fewer lots (the new sites sit on already-road-cleared interchange land).
  assert.equal(plan.stats.lotsDroppedLoop, 366, 'lot candidates dropped by the loop tests (364 on the pre-#221 tree; issue #221 composition at the merge gate: one loop candidate stands on campus land and the school exclusion drops it first — probed with the schools layer off, the count reproduces 364 and blocksSkippedLoop stays 58)'); // Issue #386: lotsDroppedLoop 354 -> 366 (+12 - the rotated grids re-seat loop-interior candidates; blocksSkippedLoop stays 64)
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
  // Issue #110: plan 68,482 -> 68,472 — 23 bridge links re-admitted + 71 bed-end fusions re-seat 1,282 lots near the changed roadbeds (net -10). (loopSites re-derived with the roadbeds: 62 -> 64.)
  // Issue #258: plan 68,472 -> 76,367 (+7,895) — the south expansion (see the schools test for the full lot-diff decomposition); the loop counters above reproduce on the new ground (64/354).
  assert.equal(plan.lots.length, 76253, 'plan lot count with the loop exclusion live (75,389 before issue #221; the #221 merge gate re-pin — campus clearing removes 6,819 lots, loop counters 61/354 reproduce as re-pinned above; the #255 re-pin — 4 new registry sites exclude 32 lots: 17 TWTC Hall 1, 4 Grand Hyatt, 7 ATT 4 FUN, 4 Bellavita, counted on the pre-#255 plan; the #289 re-pin — 4 new registry sites exclude 56 lots net: A21 9, Cathay 20, Walsin 14, VieShow 13, counted by body-overlap on the pre-#289 plan; the #278 re-pin — 3 new registry sites exclude 158 lots net: planetarium 8, NTSEC 38, VGH 107 by body-overlap, plus 5 edge drops and 2 re-seats net 0, counted lot-by-lot on this tree); Issue #326: 76,209 -> 76,260 (+51 net: 127 lots added, 76 removed — lot-by-lot diff in ntsec326-evidence/lotdiff326.log; the re-site frees the old (wrong) site rects — the 280x160 ring rect and the 160x110 drum rect at the beige complex — and the old road chords, while the correct site rects + re-routed roads exclude lots in their place)'); // Issue #313: 76,260 -> 76,650 (+390 net: 3,016 added, 2,626 removed - every changed lot at z < -7000 in the Beitou creek corridors; full-JSON plan diff in blocks313-evidence/plan-diff-ordered313.log) // Issue #314: 76,650 -> 77,808 (+1,158 net: 3,583 added, 2,425 removed full-JSON - every changed lot inside x -3265..494, z -8184..-4923 in the old interior; the new door plates flip 82 blocks to fine grain, re-subdividing them; plan diff in heights314-evidence/plan-diff-full-transplant314.log) // Issue #386: 77,808 -> 76,253 (-1,555 - part 2 re-lays 454 more blocks on rotated grids; a rotated grid's corner lots fall outside the inset bbox)
  assert.equal(plan.stats.blocksSkippedAirfield, 45, 'airfield exclusion unmoved (#134)');
  // Issue #110: airfield exclusion 222 -> 221 — moved by the ROADBED change (a re-seated lot stands off the field), not by the loop change; the loop re-derivation itself moves nothing on the field.
  assert.equal(plan.stats.lotsDroppedAirfield, 221, 'airfield exclusion unmoved (#134)');
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
