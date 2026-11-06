// Issue #128 enforcement: the real-height join.
// The planner used to draw every lot height from procedural bands
// (core / frontage / lane). The #115 study measured those bands
// against Taipei's open data and found them badly understating the
// city (lots >= 30 m: 1.5% procedural vs 16.2% real on the pre-#106
// plan). This issue adopts the join the study recommended:
//
//   tools/taipei/build-heights.py fetches the two OGDL datasets
//   (permit footprints 151936, door plate points 155472 — both from
//   data.gov.tw / data.taipei) + OSM footprints with height/levels
//   tags from the pipeline PBF, and emits data/osm_heights.json;
//   build-taipei-geodata.mjs carries it as geodata.heights; the
//   planner samples it per lot in strict priority order —
//   permit > OSM height > OSM levels > block-face door median >
//   neighbourhood field (estimated) > procedural bands — and labels
//   every lot with its source (hSrc), so real and estimated heights
//   stay distinguishable in the data.
//
// These tests pin (a) the layer's presence and provenance, (b) the
// join census on the real geodata — exact per-source counts, the
// way the glass census is pinned in taipei.test.mjs: re-pins need a
// proven delta measured on the tree + a written reason, (c) the
// no-clamp rule (real towers stand above the procedural caps), and
// (d) the join mechanics on a synthetic geodata, including the
// fall-back's byte-stability: a lot the join leaves procedural
// keeps the exact height the pre-#128 planner drew for it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { planTaipeiBuildings, pointInRing, HEIGHT_JOIN } from '../js/taipei-buildings.js';

const plan = planTaipeiBuildings(TAIPEI_GEO);
const REAL = ['permit', 'osm-height', 'osm-levels', 'door'];

test('height layer present, provenanced, factors agree with the planner', () => {
  const h = TAIPEI_GEO.heights;
  assert.ok(h, 'geodata carries the heights layer');
  // Footprint/door counts re-pinned for issue #134: the layer is
  // re-clipped to the enlarged union (airport box + corridor strip),
  // so both pools grow with the tile.
  // Issue #258: the south expansion adds box 7-south + the Box A
  // west strip — the layer grows with the tile again (permit
  // 6,012 -> 6,567, OSM 15,459 -> 20,436). Only new-area entries
  // are appended: the rebuild also surfaced 1,067 footprints +
  // 6,667 doors in the OLD interior that main's Oct-25 layer never
  // had (a pre-existing staleness gap, not part of #258) — those
  // are EXCLUDED here and filed as a follow-up, so the old city
  // keeps its heights.
  assert.equal(h.footprints.length, 27003, 'signal footprints (6,567 permit + 20,436 OSM)');
  assert.equal(h.doors.length / 3, 155762, 'door plate points in tile');
  assert.match(h.sources.permits.dataset, /151936/, 'permit source is data.gov.tw 151936');
  assert.match(h.sources.doors.dataset, /155472/, 'door source is data.gov.tw 155472');
  assert.match(h.sources.permits.licence, /OGDL/, 'OGDL v1 licence recorded');
  // The builder writes the validated factors into the layer header;
  // the planner carries its own copy. They must never drift apart.
  assert.deepEqual(h.factors, {
    osmLevels: HEIGHT_JOIN.osmLevelsM,
    permit: HEIGHT_JOIN.permitM,
    door: HEIGHT_JOIN.doorM,
  });
});

test('join census: every lot labelled, per-source counts pinned', (t) => {
  const lots = plan.lots;
  // Issue #110: plan 68,482 -> 68,472 — 23 bridge links re-admitted + 71 bed-end fusions re-seat 1,282 lots near the changed roadbeds (net -10).
  // Issue #258: plan 68,472 -> 76,367 (+7,895) — the south expansion (box 7-south + Box A west strip) seats 8,285 new lots (south 6,972 + west strip 922 + old-interior 234 + seam 157) and drops 390 (old-interior 235 + seam 155); the old-interior delta is the justified seam-road boundary effect (see the schools test). Per-source net deltas: permit +504, osm-height +260, osm-levels +1,262, door +723, field +4,166, proc +980 — the south fabric is mixed (Gongguan/Guting mid-rise hears the real tiers; the NTU/Shida campus clearing removes the kit campuses' lots); real-signal 25,464 -> 28,213 (36.9% of the plan).
  assert.equal(lots.length, 76260, 'the join moves heights only — the lot count is the #106 plan as composed with #118, #134 and #137, less the #139 removals, the #144 site exclusion (7 lots), the #135 Twin Towers parcel exclusions (47 lots: 21 in the C1 site rect, 26 in the D1 plaza rect, counted on the pre-#135 plan), the 2 #146 Wenhu dive drops, the 31 #165 site exclusions (29 on the Four Seasons D3 parcel, 2 under the Mitsukoshi A4 hall) and the 141 #166 site exclusions, as re-subdivided by the #124 fine-grain rule (46,402 fine lots tile-wide after #186; the composition above is untouched on the blocks the rule leaves coarse), and extended by issue #186 (the airport-north strip: +3,919 fine lots, less the 29 lots the NPM/Miramar registry sites clear); composed with issue #226 (the Beitou/Tianmu creeks at channel width: +120 lots on the released bank land, every changed lot diffed into the creek corridors; 46,460 fine lots tile-wide); composed with issue #213 (interchange-loop interiors non-buildable: −131 lots net, 46,426 fine lots); composed with issue #221 (school campuses are site structures, not lots: −6,819 lots — 193 campus blocks skipped, 3,323 lots dropped on campus land and the lots those blocks would have carried; per-source removals permit 524 / osm-height 44 / osm-levels 548 / door 376 / field 4,442 / proc 885; composed with issue #255 (4 new registry sites exclude 32 lots: 17 TWTC Hall 1, 4 Grand Hyatt, 7 ATT 4 FUN, 4 Bellavita — counted lot-by-lot on the pre-#255 plan; the A4/A8 sites exclude none, already lot-free); composed with issue #289 (4 new registry sites exclude 56 lots net: A21 9, Cathay 20, Walsin 14, VieShow 13 — counted by body-overlap on the pre-#289 plan; 9 further lots re-seat heights via the #128 field blend, not removals; the two plazas exclude none, already lot-free); composed with issue #278 (3 new registry sites exclude 158 lots net: planetarium 8, NTSEC 38, VGH 107 by body-overlap, plus 5 edge drops just outside the rects and 2 re-seats net 0 — counted lot-by-lot on this tree; 84 further lots re-seat heights via the #128 field blend, all within 100 m of a rect); Issue #326: 76,209 -> 76,260 (+51 net: 127 lots added, 76 removed — lot-by-lot diff in ntsec326-evidence/lotdiff326.log; the re-site frees the old (wrong) site rects — the 280x160 ring rect and the 160x110 drum rect at the beige complex — and the old road chords, while the correct site rects + re-routed roads exclude lots in their place)');
  for (const lot of lots) assert.ok([...REAL, 'field', 'proc'].includes(lot.hSrc), `lot labelled (${lot.hSrc})`);
  const c = {};
  for (const lot of lots) c[lot.hSrc] = (c[lot.hSrc] || 0) + 1;
  t.diagnostic(`height census: ${JSON.stringify(c)}`);
  // Census measured on this tree (main bc3d82f incl. #118 + this
  // branch) at the #128 gate. Permit 3,420 = 9.9% of lots (the
  // study's 9.9% with its own join). OSM: on the pre-#118 tree
  // 5,702 lot centres (16.4% — the study's figure exactly) sat
  // inside a signal footprint, 787 of them also inside a permit,
  // and permits speak first — so the OSM tiers land at 4,898 here
  // (osm-height 920 + osm-levels 3,978). Doors speak for 7,049
  // lots — far under the study's 63.3% nearest-door figure BY
  // DESIGN: that join let any door within 20 m speak for any lot
  // (the oscillation the face median exists to kill); here a door
  // speaks only for lots standing in its block face, pooled with
  // the face's other doors (87% of eligible face lots are served;
  // pools of 0/1 doors fall through). Interior lots hear the
  // field instead — field + real = 81.4% of lots carry a
  // data-derived height; 18.6% stay purely procedural.
  // Census re-pinned for issue #134 (+ #137), measured on this
  // tree: the plan grows to 38,857 lots (airport box + corridor
  // strip join, old ground sheds its in-water/band lots — see the
  // glass re-pin in taipei.test.mjs) and the join re-runs over the
  // enlarged layer: permit 3,420 -> 3,505, osm-height 920 ->
  // 1,112, osm-levels 3,978 -> 4,743, door 7,049 -> 8,102, field
  // 12,825 -> 14,429, proc 6,453 -> 6,966. Real-signal lots
  // 15,367 -> 17,462 = 44.9% of the plan, inside the band below.
  // Issue #139 composition (MRT completion), diffed lot by lot on
  // this tree: the track-corridor clearance and the Beitou depot
  // + at-grade station sites removed 461 lots (38,857 -> 38,396;
  // census in taipei-mrt.test.mjs). The removed lots' sources on
  // the counterfactual plan: proc 256, field 115, osm-levels 66,
  // permit 11, door 9, osm-height 4 — mostly procedural/field
  // stock on the depot fringe and the at-grade corridor. The
  // shipped census below is the #134 census minus those removals
  // and a few lots more where the field tier re-pools around the
  // removals (net: permit 3,494, osm-height 1,108, osm-levels
  // 4,677, door 8,093, field 14,298, proc 6,726; real-signal
  // 17,372 = 45.2%).
  // Issue #135 composition (Twin Towers), diffed lot by lot on
  // this tree: the C1/D1 parcel rects remove 47 lots (permit 37,
  // field 10 — every one >= 60 m: the parcels' own permit stock),
  // and the field tier re-pools on the blocks around the site —
  // 11 kept lots change (7 field heights collapse from borrowed
  // tall signals to ~10-12.5 m, 4 lots fall through field ->
  // proc). Net: permit 3,457, field 14,284, proc 6,730;
  // real-signal 17,335 = 45.2%.
  // Issue #144 composition (TPAC landmark), diffed lot by lot
  // on this merged tree against the #134+#137+#139 tree: the
  // site exclusion removes the 7 lots that stand on the parcel
  // on this tree (38,396 -> 38,389; the #134 data refresh
  // re-packed the parcel's block — all 7 are permit lots of
  // h 36, the enlarged layer's uniform signal for the block).
  // The field tier is a block-face statistic: with the face's
  // permit anchors gone, two lots across the north lane fall
  // out of the tier to procedural (field 6.5 -> proc 8.5;
  // field 15.5 -> proc 27.0) and seven more field lots keep
  // the tier with new heights. Net: permit -7, field -2,
  // proc +2; the door and OSM tiers are untouched, and
  // real-signal lots go 17,372 -> 17,365.
  // Issue #146 composition (Wenhu Line), diffed lot by lot on
  // this merged tree: the Wenhu guideway clearance drops
  // exactly 2 lots, both piercing the descending guideway
  // north of Zhongshan JHS (census in taipei-mrt.test.mjs) —
  // one door lot (h 15.5) and one proc lot (h 14.5). Net:
  // door -1, proc -1.
  // Merged-tree composition (#135 + #144 + #146): the three
  // sites are kilometres apart and their deltas are
  // independent — permit 3,487 - 37 = 3,450, osm tiers
  // untouched, door 8,093 - 1 (#146) = 8,092, field
  // 14,296 - 14 = 14,282, proc 6,728 + 4 (#135 re-pool)
  // - 1 (#146) = 6,731; real-signal
  // 17,365 - 37 - 1 = 17,327; lots 38,342 - 2 = 38,340.
  // Issue #165 composition (Xinyi landmark batch), diffed lot
  // by lot on this tree: the six new registry sites remove
  // exactly 31 lots — the D3 parcel's 29 (permit 5, field 18,
  // door 6) and 2 permit lots under the Mitsukoshi A4 hall;
  // the Farglory / A8 / A9 / A11 sites remove none. The field
  // tier re-pools around the parcel: 3 lots south of it fall
  // through field -> proc (their heights rise 45.5 ->
  // 56.5/56/57 on the procedural draw) and 5 more neighbours
  // keep the tier with new heights. Net: permit 3,450 - 7 =
  // 3,443, door 8,092 - 6 = 8,086, field 14,282 - 18 - 3 =
  // 14,261, proc 6,731 + 3 = 6,734; real-signal
  // 17,327 - 13 = 17,314; lots 38,340 - 31 = 38,309.
  // Issue #124 composition: the fine-grain re-subdivision
  // re-samples every tier — more centres land inside real
  // footprints (permit 5,481, osm-height 2,238, osm-levels
  // 7,768) and on real door faces (door 11,276), while the
  // block interiors the coarse grid never sampled fall to the
  // field and proc tiers (36,240 / 8,581). Real-signal lots
  // RISE 17,314 -> 26,763, but their SHARE dilutes to 37.4%
  // because the added interior lots are the least labelled
  // fabric in the city — the band below widens to hold the
  // new census; a collapse of the join would still trip it.
  // Issue #166 composition (Tianmu/Beitou batch), diffed lot
  // by lot on this merged tree against the same plan without
  // the five registry entries: the sites remove 141 fine lots
  // (proc 89, field 42, osm-levels 5, permit 4, door 1 — the
  // campuses and stadium grounds stand on low, weakly-labelled
  // fabric) and the field tier re-pools around them: 17 kept
  // lots fall through field -> proc and 38 more keep their tier
  // with new heights. Net: permit 5,481 - 4 = 5,477, osm-levels
  // 7,768 - 5 = 7,763, door 11,276 - 1 = 11,275, field
  // 36,240 - 42 - 17 = 36,181, proc 8,581 - 89 + 17 = 8,509;
  // real-signal 26,763 - 10 = 26,753.
  // Issue #186 composition, measured on the merged tree at the
  // gate against the pre-#186 main plan (71,443): net +3,957
  // lots = the strip's 3,919 fine lots + 67 net boundary-churn
  // lots on the re-cut airport/strip edges - the 29 lots the
  // #201 registry sites clear. Per-source net deltas: permit
  // +345, osm-height +1, osm-levels +5, door +1, field +1,114,
  // proc +2,491 — the strip's fabric is weakly labelled (the
  // Dazhi / museum-grounds stock mostly hears the field tier
  // or falls through to procedural), so real-signal lots rise
  // only 26,753 -> 27,105 (35.9% of the enlarged plan).
  // Issue #226 composition, measured on the merged tree at the
  // gate against the post-#186 main plan (75,400): the creeks
  // ship at channel width — the derived buffers shrink ~864k m²
  // and 520 fewer candidate lots drown (lotsDroppedParkWater
  // 15,123 -> 14,603); the shipped plan nets +120 lots, every
  // changed lot diffed into the Beitou/Tianmu creek corridors.
  // Per-source net deltas: permit +5, osm-levels +2, door +8,
  // field +63, proc +42; real-signal 27,105 -> 27,120 (35.9%).
  // Issue #213 composition, measured on the merged tree at the
  // #227 gate against the post-#226 plan (75,520): the loop
  // exclusion drops 364 candidates (58 blocks skipped whole)
  // and nets −131 lots. Per-source net deltas: door −1, field
  // −14, proc −116 (the phantom infield fabric was almost all
  // procedural); real-signal 27,120 -> 27,119 (35.9%).
  // Issue #219 composition, measured on the merged tree at the
  // #228 gate: the join's sanity guards block 18 donors (16
  // parcel-scale, 2 extreme — the worker's census counts
  // reproduce exactly) and their lots fall through to the
  // lower tiers (permit −67, osm-height −47, field −27, proc
  // +141 net); stepped massing then steps 3,653 sibling lots
  // in 1,213 shared-footprint groups (hSrc unchanged — the
  // massing is an estimate of the complex, not a new source).
  // Real-signal 27,119 -> 27,005 (35.8%).
  // Issue #221 composition (merge gate): campus clearing removes permit 524 / osm-height 44 / osm-levels 548 / door 376 / field 4,442 / proc 885; real-signal 27,005 -> 25,513 (37.2%).
  // Issue #110: permit 5,208 -> 5,215 (+7) — the re-seated lots re-pool heights (the permit donor layer covers 7 more re-seated lots).
  // Issue #258: permit 5,215 -> 5,719 (+504) — the south expansion's real permit stock (Gongguan/Guting mid-rise).
  assert.equal(c.permit, 5687); // issue #289: the 4 registry sites exclude 56 lots net — permit 17, osm-height 12, field 23, proc 4 (lot-by-lot diff; the 9 field re-seats are field lots whose heights change, not removals); issue #278: the 3 registry sites exclude 158 lots net — permit 32, osm-height 1, osm-levels 3, field 100, proc 23 (lot-by-lot diff; the 57 field->proc flips are kept lots re-pooling when the removed real lots leave their 100 m neighbourhoods)
  // Issue #258: osm-height 2,136 -> 2,396 (+260).
  assert.equal(c['osm-height'], 2395); // issue #278: −1 (see the permit line)
  // Issue #110: osm-levels 7,222 -> 7,208 (-14) — the re-seated lots lose their osm-levels donors.
  // Issue #258: osm-levels 7,208 -> 8,470 (+1,262).
  assert.equal(c['osm-levels'], 8467); // issue #278: −3 (see the permit line)
  // Issue #110: door 10,907 -> 10,905 (-2).
  // Issue #258: door 10,905 -> 11,628 (+723).
  assert.equal(c.door, 11628); // issue #278: unchanged — no door lot stands inside the 3 site rects
  // Issue #258: field 32,842 -> 37,008 (+4,166); proc 10,166 -> 11,146 (+980) — the south fabric's interior lots hear the field tier or fall through to procedural.
  assert.equal(c.field, 36851); // issue #289: −29 net — 23 field lots removed, 6 kept lots re-roll field -> proc in the field re-pool (the removed real lots leave their 100 m neighbourhoods; lot-by-lot diff); issue #278: −157 net — 100 field lots removed, 57 kept lots re-roll field -> proc in the field re-pool (lot-by-lot diff)
  assert.equal(c.proc, 11181); // issue #289: +2 net — 4 proc lots removed, 6 kept lots enter proc from the field re-pool (lot-by-lot diff); issue #278: +35 net — 23 proc lots removed, 1 added re-seat (proc), 57 kept lots enter proc from the field re-pool (lot-by-lot diff)
  assert.equal(plan.stats.heightsGuardParcel, 16, 'issue #219: parcel-scale donors blocked (uncorroborated)');
  assert.equal(plan.stats.heightsGuardExtreme, 2, 'issue #219: extreme donors blocked (uncorroborated)');
  // Issue #110: stepped groups 1,179 -> 1,180 (+1) — the re-seated lots create one more stepped complex.
  // Issue #258: stepped groups 1,180 -> 1,319 (+139); stepped lots 3,539 -> 3,921 (+382) — the south expansion's shared-footprint complexes step like the old city's.
  assert.equal(plan.stats.heightsSteppedGroups, 1317, 'issue #219: shared footprints stepped as complexes (issue #289: −4 — the removed lots included stepped siblings; issue #278: −2, same reason — the removed lots included stepped siblings, incl. the VGH 112 m stand-ins)');
  assert.equal(plan.stats.heightsSteppedLots, 3913, 'issue #219: sibling lots stepped down (issue #289: −24, same reason; issue #278: −8, same reason)');
  assert.equal(plan.stats.heightsPermit, c.permit, 'stats census agrees (permit)');
  assert.equal(plan.stats.heightsDoor, c.door, 'stats census agrees (door)');
  assert.equal(plan.stats.heightsField, c.field, 'stats census agrees (field)');
  assert.equal(plan.stats.heightsProc, c.proc, 'stats census agrees (proc)');
  const real = REAL.reduce((s, k) => s + c[k], 0);
  // Issue #110: real-signal lots 25,473 -> 25,464 (-9) — the re-seated lots lose 9 real-signal (permit/osm-height/door) labels.
  // Issue #258: real-signal lots 25,464 -> 28,213 (+2,749; 36.9% of the plan) — the south expansion's real stock.
  // Issue #278: real-signal lots 28,213 -> 28,177 (-36) — the 3 registry sites exclude 32 permit + 1 osm-height + 3 osm-levels lots, 0 door lots (lot-by-lot diff).
  assert.equal(real, 28177, 'real-signal lots (27,005 before issue #221 cleared 1,492 real-signal lots off campus land; issue #255 clears 11 permit lots; issue #289 clears 17 permit + 12 osm-height lots; issue #278 clears 32 permit + 1 osm-height + 3 osm-levels lots)');
  assert.ok(real / lots.length > 0.35 && real / lots.length < 0.50, 'real coverage in the measured band');
});

test('joined skyline: the >=30 m share lands on the study’s real figure', () => {
  // The study's prototype join (its own priority/factors) put the
  // tile's >=30 m share at 16.2% real vs 1.5% procedural (pre-#106
  // plan; this tree's procedural share is 3.7%). This join:
  // 5,500 of 34,645 = 15.9% — the small gap to 16.2% is the door
  // tier's stricter face rule plus the levels factor (3.0 vs the
  // prototype's 3.3 for OSM levels — see build-heights.py FACTORS).
  // Re-pinned for issue #134: 6,059 of 38,857 = 15.6% — the share
  // holds on the enlarged tile (the airport box's real office
  // stock replaces the strip's low fabric in the mix).
  // Issue #139: 8 of the >=30 m lots were among the corridor /
  // depot removals (all 8 in the Beitou box) — 6,051 of 38,396
  // = 15.8%.
  // Issue #144: the 7 parcel lots were all >= 30 m (permit
  // h 36) — 6,044 of 38,389 = 15.7%.
  // Issue #135: the 47 parcel removals were all >= 60 m and 7
  // more >= 30 m lots fell in the field re-pool (see the census
  // note) — 5,990 of 38,342 = 15.6% on this merged tree;
  // >= 60 m: 1,038 - 47 - 7 = 984 (the #144 lots, at h 36,
  // never touched the >= 60 m class).
  // Issue #146: both Wenhu dive drops are < 30 m (h 14.5 /
  // 15.5) — the count holds at 5,990 of 38,340 = 15.6%.
  // Issue #165: all 29 D3-parcel removals stood >= 30 m (the
  // A4 pair, at h 27, did not) — 5,961 of 38,309 = 15.6%;
  // >= 60 m: the parcel's five 93 m permit lots plus one
  // neighbour whose field height re-pooled 62 -> 51 m across
  // the line — 984 - 6 = 978.
  // Issue #124: 9,416 of 71,584 = 13.2% — the count rises
  // (+3,455: real tall fabric gets more, finer lots) while
  // the share dilutes toward the walk-up reality, the 46,277
  // fine lots being overwhelmingly low stock; >= 60 m: 1,318.
  // Issue #166: 4 of the 141 site removals stood >= 30 m —
  // 9,412 of 71,443 = 13.2%; the >= 60 m class is untouched.
  // Issue #186: 9,710 of 75,400 = 12.9% — the count rises +298
  // on the strip's real tall fabric (Dazhi / Neihu Rd towers)
  // while the share dilutes a notch on the strip's mostly-low
  // stock; >= 60 m: 1,318 -> 1,366 (+48).
  // Issue #226: 9,727 of 75,520 = 12.9% (+17 — the creek
  // corridors' own tall stock re-draws on the released bank
  // blocks); >= 60 m: 1,366 -> 1,370 (+4).
  // Issue #213: 9,704 of 75,389 = 12.9% (−23 — tall candidates
  // on loop-adjacent blocks re-draw); >= 60 m holds at 1,370.
  // Issue #219: 6,492 of 75,389 = 8.6%; >= 60 m: 593. The
  // guards remove the two absurd claims outright, and stepped
  // massing steps most shared-footprint siblings below the
  // bands — what remains >= 30 m is the centre lot of each
  // real complex plus the lone-footprint towers, which is
  // the shape the census on the issue asked for.
  const tall = plan.lots.filter((l) => l.h >= 30).length;
  // Issue #110: 7 more lots stand >= 30 m — the re-seated lots near the fused roadbeds re-pool heights (field re-pool).
  // Issue #258: tall 6,273 -> 6,932 (+659) — the south expansion's real mid/high-rise stock (Gongguan/Guting towers) plus finer sampling of the south fabric.
  assert.equal(tall, 6923); // 6,492 before issue #221 (−159 tall lots on campus land); issue #255: 18 removed lots stand >= 30 m, 5 kept neighbours re-pool upward across the band (field re-pool, as at #144/#135) — net −13, lot-by-lot diff; issue #289: net −54 — the removed lots include the tall stand-ins on the four sites (the A21 pair at 129 m, the Cathay 105 m lot, the Walsin 134.5 m lot) and the field re-pool moves 9 kept neighbours, two of them across the band (lot-by-lot diff); issue #278: net −9 — 9 tall lots removed (the VGH 112 m stand-ins among them), 0 added, no kept lot crosses the band (lot-by-lot diff)
  const g60 = plan.lots.filter((l) => l.h >= 60).length;
  // Issue #258: g60 559 -> 646 (+87) — the south expansion's >= 60 m stock.
  assert.equal(g60, 646, 'a >=60 m class exists at all (procedural plan: 5 lots); issue #289: net −17, the tall stand-ins on the four sites');
});

test('real heights are never clamped to the procedural bands', () => {
  // 745 lots carry a real signal taller than the 60 m core-band cap
  // (the tallest, 222 m, is a 74F permit at 3.0 m/f). If a future
  // change re-imposes a cap, this count collapses — that is the
  // steam-cap failure the study warned about.
  // Re-pinned for issue #134: 857 lots (the tallest is still the
  // same 222 m permit — the max assert below is unedited).
  // Issue #135: 820 — of the 47 parcel removals 30 stood > 60 m
  // (17 sat at exactly 60.0 m: 20F permits x 3.0 m/f), and 7
  // more fell in the field re-pool.
  // Issue #165: 815 — the D3 parcel's five 93 m permit lots
  // were the only > 60 m real-signal removals (the 62 -> 51 m
  // re-pool casualty is a field lot, not a real signal).
  // Issue #124: 1,113 — finer lots land more centres inside
  // real > 60 m footprints (the same join, more samples of it).
  const over = plan.lots.filter((l) => REAL.includes(l.hSrc) && l.h > 60).length;
  // Issue #186: 1,142 (+29 real > 60 m samples in the strip).
  // Issue #226: 1,145 (+3 real > 60 m samples on the re-drawn
  // creek-corridor blocks).
  // Issue #219: 528 — stepped massing steps the SIBLING lots
  // of real > 60 m footprints down (the centre lots keep
  // their heights — the max assert below), and the two
  // blocked donors' > 60 m claims fall through entirely.
  // Issue #258: over 498 -> 579 (+81) — the south expansion's real > 60 m stock (the 162 m max is unchanged: the south adds no taller tower).
  assert.equal(over, 579); // 528 before issue #221; issue #289: −16 — the removed real > 60 m lots are the tall stand-ins on the four sites (lot-by-lot diff)
  assert.equal(Math.max(...plan.lots.map((l) => l.h)), 162, 'issue #219: the plan max is the corroborated 162 m, not the blocked 165 m parcel claim');
  assert.ok(Math.max(...plan.lots.map((l) => l.h)) <= 250, 'no absurd heights (tallest real signal is 222 m)');
});

test('Beitou: the hot-spring towers exist now', () => {
  // Beitou box: lat 25.113..25.150, lon 121.464..121.510. Before
  // the join the box held 39 lots >= 30 m (procedural bands barely
  // reach it); the real stock (resort/hot-spring towers along the
  // MRT corridor) puts 403 data-derived lots there.
  const bei = plan.lots.filter((l) => l.x >= -10193.2 && l.x <= -5550.8 && l.z >= -12960.5 && l.z <= -8861.9);
  const tall = bei.filter((l) => l.h >= 30 && l.hSrc !== 'proc');
  // Re-pinned for issue #134: 403 -> 350. The box itself sheds 133
  // lots (4,685 -> 4,552) to the #114/#137 exclusions working
  // inside it (the Guandu plain's recovered water/green polygons
  // and the riverside band), and the pipeline regeneration re-cut
  // the box's blocks, shifting door-face medians — and with them
  // tier assignments — at the margin (permit 478 -> 438, field
  // 1,972 -> 1,733 in the box census). The invariant this test
  // protects is untouched: the hot-spring towers stand (350
  // data-derived tall lots vs 39 procedural).
  // Issue #139: 350 -> 342 — 8 of these towers were among the
  // depot/corridor removals (the same 8 as the >=30 m census
  // delta above; the box plan is 4,095 lots after #139).
  // Issue #124: 702 — the box's MRT-corridor fabric classes
  // fine on its door density, so the hot-spring parcels
  // subdivide and more of the real towers carry their own
  // data-derived heights (the stock was always there; the
  // coarse grid merged it into fewer, bigger lots).
  // Issue #186 gate: 696 — diffed lot by lot against the
  // pre-#186 plan: no lot is removed (box lots 8,042 -> 8,044)
  // and every real-signal tower count is identical (permit
  // 351, door 14, osm-levels 20, osm-height 2); the whole -6
  // is one block face at Fuxinggang (25.1316, 121.4992) whose
  // six FIELD-tier lots re-pool 31-35 m -> 26.5-28.5 m on the
  // merged fabric — field estimates moving at the margin,
  // not towers lost.
  // Issue #226: 705 — the box's creek blocks （磺港溪/貴子坑溪
  // corridors) re-draw on the released bank land: +9
  // data-derived tall lots at the channel margins, no tower
  // removed (the box only gains/re-pools along the creeks).
  // Issue #219: 378 — stepped massing again: the box's
  // hot-spring complexes share footprints, so most of their
  // sibling lots step below 30 m (each complex keeps one
  // full-height lot), and the blocked 112 m / 165 m-span
  // Beitou outline's 43 lots fall through to low tiers.
  assert.equal(tall.length, 354); // 378 before issue #221 (Beitou/Shilin campuses clear 24)
});

test('fallback byte-stability: untouched lots keep their procedural heights exactly', () => {
  const bare = planTaipeiBuildings({ ...TAIPEI_GEO, heights: null });
  // Issue #139 composition: placement itself is height-sensitive
  // now — the track pierce test drops a lot whose top would reach
  // the MRT guideway's underside, so the two plans differ by
  // exactly one lot: the low building under the Beitou guideway
  // whose REAL height (6.0 m, OSM levels) keeps it under the
  // 7.2 m underside, but whose procedural height pierces and
  // drops it. The flip is the clearance rule working as designed
  // in both regimes; every other lot is placed identically.
  // (Measured identically on the #134+#137 tree: the same single
  // flipped lot, h 6.0, osm-levels.)
  // Issue #124: the two regimes are no longer key-comparable lot
  // for lot, by design — the fine-grain classifier reads the door
  // layer, so the bare regime (no layer) plans the COARSE plan:
  // 38,308 lots, the pinned composition less the guideway flip,
  // byte-stable as a regime of its own. The full plan's 46,313
  // plan-only keys are the 46,277 fine lots plus 36 coarse
  // placements whose keys move with real heights (the flip among
  // them; the rest are tall-frontage packing and door-face pool
  // outcomes at fine/coarse borders). The flip's own guard lives
  // in the taipei-mrt clearance audit now. What this test still
  // guarantees is the loop below: the lots the regimes SHARE
  // (25,271 common keys; 25,203 after #166) keep their drawn procedural heights
  // exactly where the full plan also labels them proc.
  // Issue #186: the bare regime plans the strip coarse too —
  // 38,221 -> 42,030 (+3,809 coarse strip lots); plan-only lots
  // 46,240 -> 46,438 (46,402 fine + the same 36 height-moved
  // coarse placements); shared-key proc lots 4,153 -> 6,637
  // (+2,484, nearly all the strip's procedural stock standing
  // on coarse keys both regimes share).
  // Issue #226: the bare regime releases the creek banks too —
  // 42,030 -> 42,107 (+77 coarse lots); plan-only lots 46,438
  // -> 46,496 (46,460 fine + the same 36 height-moved coarse
  // placements); shared-key proc lots 6,637 -> 6,658 (+21),
  // with zero height mismatches on the shared keys.
  // Issue #213: the bare regime clears the loops too —
  // 42,107 -> 42,004 (−103 coarse); plan-only lots 46,496 ->
  // 46,462 (46,426 fine + the same 36 height-moved coarse
  // placements); shared-key proc lots 6,658 -> 6,571 (−87),
  // zero height mismatches on the shared keys.
  // Issue #110: the bare (coarse) regime gains 4 lots — the re-admitted links/fused beds change the coarse fabric near the changed roadbeds.
  // Issue #258: the bare regime 36,107 -> 39,574 (+3,467) — the south expansion plans coarse too (7-south + west strip, no door layer, no fine blocks).
  assert.equal(bare.lots.length, 39433, 'the bare regime is the coarse plan (issue #124: no door layer, no fine blocks; issue #166: less the five sites\' 87 coarse lots; issue #186: plus the strip planned coarse; issue #226: plus the released creek banks planned coarse; issue #213: less the loop interiors; issue #221: less the campus land in the coarse regime too, −5,813; issue #255: −32 site lots in the coarse regime too (same 4 site rects); issue #289: −56 site lots in the coarse regime too (same 4 site rects); issue #278: −141 site lots in the coarse regime too (same 3 site rects))');
  const key = (l) => `${l.x}|${l.z}|${l.w}|${l.d}`;
  const bareByKey = new Map(bare.lots.map((l) => [key(l), l]));
  const missing = plan.lots.filter((l) => !bareByKey.has(key(l)));
  // Issue #216: the facing pass turns lots toward the road they
  // front, and the turn outcome is neighbour-sensitive, so 31
  // lots' geometry keys stop matching between the regimes (a
  // lot turns in one regime and holds or shrinks differently
  // in the other, where its neighbours differ) — 44,957 ->
  // 44,988, of which 31 are facing-moved and the same 34 are
  // height-moved. Proven by cross-run: with { facing: false }
  // in BOTH regimes the count returns to exactly 44,957 and
  // the residue to 34, with zero shared-key height mismatches
  // (facing216b-evidence/proof-heights-off.mjs). No height
  // changed: the shared-key loop below still passes.
  // Issue #110: plan-only keys 44,988 -> 44,973 (measured on this tree).
  // Issue #258: plan-only keys 44,973 -> 50,870 (+5,897) — the south expansion adds 5,896 fine lots (the plan-only count tracks lotsFine, which grows 44,907 -> 50,803); the residue below moves 66 -> 67 (one more height-moved coarse placement on the new ground).
  // Issue #278: plan-only keys 50,870 -> 50,846 (−24) — the 3 registry sites exclude 24 fine lots (lotsFine 50,803 -> 50,779); the residue below stays 67.
  assert.equal(missing.length, 50846, 'plan-only lots: the #124 fine lots plus height-sensitive coarse placements (46,462 before issue #221: 1,503 fine lots on skipped campus blocks and 2 of the height-moved coarse placements stood on campus land; issue #216: plus 31 facing-moved keys)');
  // Issue #110: the residue is 66 — the height-moved count is 35 (was 34, measured with facing:false in both regimes), facing-moved stays 31.
  // Issue #258: the residue is 67 — one more height-moved coarse placement on the new ground (35 -> 36), facing-moved stays 31.
  assert.equal(missing.length - plan.stats.lotsFine, 67, 'of which 34 are coarse placements moved by real heights (the guideway flip among them) and 31 are facing-moved keys whose turn outcome differs between the regimes');
  let procChecked = 0;
  for (const a of plan.lots) {
    const b = bareByKey.get(key(a));
    if (!b) continue;
    if (a.hSrc === 'proc') {
      assert.equal(a.h, b.h, `proc lot at ${a.x},${a.z} keeps its drawn height`);
      procChecked++;
    }
  }
  // Issue #110: procChecked 5,644 -> 5,649 (+5) — the re-seated lots put 5 more shared keys in proc (field re-pool flips), zero height mismatches.
  // Issue #258: procChecked 5,649 -> 6,123 (+474) — the south expansion's shared coarse keys enter proc, zero height mismatches.
  assert.equal(procChecked, 6110); // the proc census, re-pinned with it for issues #134 + #139; +2 for #144 (the face-statistic flips, see the census diff), +4 for #135 (the field re-pool flips, see the census diff), -1 for #146 (one of the two Wenhu dive drops is a proc lot), +3 for #165 (the D3-parcel field re-pool flips, see the census diff); issue #255: −17 net — 21 counted proc lots removed, 4 kept lots enter the shared-key set (lot-by-lot diff on this tree); issue #124: 4,204 — the census covers the regime-shared lots only (25,271 common keys); the fine lots have no bare counterpart to be checked against; issue #166: 4,153 — the shared keys drop to 25,203 as the five sites remove their coarse lots from both regimes and the field re-pool flips 17 shared lots out of proc's neighbours (see the census diff); issue #186: 6,637 — the strip's coarse keys join both regimes (see the composition note above); issue #226: 6,658 — the creek re-draws put 21 more shared keys in proc (see the composition note above); issue #213: 6,571 — the loop clearing removes 87 shared proc keys (see the composition note above); issue #219: 6,712 — the blocked donors' fall-throughs land 141 more shared-key lots on proc, and their procedural draws check byte-identical against the bare regime like any other proc lot; issue #221: 5,662 — campus clearing removes 1,050 shared proc keys; issue #216: 5,659 — 3 of the 31 facing-moved keys were proc-labelled shared keys, so the census loses exactly those 3 (proven by the facing:false cross-run, which returns 5,662 with zero mismatches); issue #255 (gate, merged tree): 5,642 — the PR-side 5,645 was measured on its stale pre-#216 base; the composed value is main's 5,659 − 17 for #255, measured on the merged tree with zero height mismatches; issue #289: +2 net — the field re-pool flips shared keys into proc (see the census diff), zero height mismatches; issue #278: −13 net — 23 shared proc keys removed by the 3 sites, 10 shared keys flip into proc from the field re-pool (lot-by-lot diff on this tree), zero height mismatches
  assert.ok(bare.lots.every((l) => l.hSrc === 'proc'), 'no layer, no labels but proc');
});

// ---- mechanics on a synthetic geodata ----
// One populated block (footprints + doors) and one empty block far
// away. Coordinates sit far outside the real tile so no landmark
// site or union box interferes; there are no roads, so every face
// is a lane face and the procedural fallback is the 8–18 m band.
const rect = (x0, z0, x1, z1) => [x0, z0, x1, z0, x1, z1, x0, z1, x0, z0];
function syntheticGeo() {
  const blockA = { cx: 30000, cz: 30000, area: 120 * 66, bbox: { minX: 29940, maxX: 30060, minZ: 29967, maxZ: 30033 } };
  const blockB = { cx: 30800, cz: 30000, area: 120 * 66, bbox: { minX: 30740, maxX: 30860, minZ: 29967, maxZ: 30033 } };
  return {
    frame: { originLatLon: [25.033, 121.565], bbox: { minX: 0, maxX: 40000, minZ: 0, maxZ: 40000 } },
    parks: [], water: [], green: [], roads: [], roadbeds: [], landmarks: {},
    blocks: [blockA, blockB],
    heights: {
      sources: {}, factors: { osmLevels: 3.0, permit: 3.0, door: 3.85 },
      footprints: [
        // west half: a 10F permit (wins over the OSM height below where they overlap)
        { src: 'permit', floors: 10, height: null, ring: rect(29940, 29967, 30000, 30033) },
        // north-east: an OSM height tag; overlaps the permit in x 29985..30000
        { src: 'osm', floors: null, height: 44, ring: rect(29985, 29967, 30030, 30000) },
        // east column: OSM levels only, 7F (edges kept off the lot
        // grid lines — a centre exactly on a ring edge is outside
        // by ray casting, in the oracle just as in the planner)
        { src: 'osm', floors: 7, height: null, ring: rect(30028, 29975, 30060, 30033) },
      ],
      // three plate points just inside the south face of block A (floors 4/5/6)
      doors: [30005, 30028, 4, 30015, 30028, 5, 30025, 30028, 6],
    },
  };
}

test('join mechanics: priority, face median, field, proc fallback', () => {
  const geo = syntheticGeo();
  const p = planTaipeiBuildings(geo);
  const inA = p.lots.filter((l) => l.x < 30100);
  const inB = p.lots.filter((l) => l.x > 30600);
  assert.ok(inA.length > 8, `block A planned (${inA.length} lots)`);
  assert.ok(inB.length > 0, 'block B planned');
  // Tier oracle for tiers 1–2: recompute the expected label from the
  // footprints alone (permit first, then OSM height, then levels).
  const fps = geo.heights.footprints;
  for (const lot of inA) {
    const permit = fps.find((f) => f.src === 'permit' && pointInRing(lot.x, lot.z, f.ring));
    const osm = fps.find((f) => f.src === 'osm' && pointInRing(lot.x, lot.z, f.ring));
    if (permit) {
      assert.equal(lot.hSrc, 'permit', `lot ${lot.x},${lot.z} under a permit`);
      // Issue #219: the permit footprint spans 66 m, so its lots
      // are a stepped group — the tallest stands at the full
      // joined height (30 = floors x 3.0, unclamped by the 8-18 m
      // lane band; the witness below pins one), siblings step
      // down from it but never above it.
      assert.ok(lot.h <= 30, 'permit lot at or below the joined height (stepped massing)');
      assert.ok(lot.h >= 15, 'permit lot still speaks (the deepest step keeps 0.55 x the joined height)');
    } else if (osm && osm.height) {
      assert.equal(lot.hSrc, 'osm-height');
      // Same stepped-group contract (span 45 m, joined 44 m).
      assert.ok(lot.h <= 44 && lot.h > 18, 'osm-height lot at or below the joined height (stepped massing)');
    } else if (osm) {
      assert.equal(lot.hSrc, 'osm-levels');
      assert.equal(lot.h, 21, 'levels 7 x 3.0');
    }
  }
  // Witnesses: every tier actually fires somewhere in block A.
  assert.ok(inA.some((l) => l.hSrc === 'permit' && l.h === 30), 'permit tier fires');
  assert.ok(inA.some((l) => l.hSrc === 'osm-height' && l.h === 44), 'osm-height tier fires');
  assert.ok(inA.some((l) => l.hSrc === 'osm-levels' && l.h === 21), 'osm-levels tier fires');
  // Tier 3: a south-row lot in the door span, under no footprint,
  // takes the face median (4,5,6 -> 5) x 3.85 = 19.25 -> 19.5.
  const doorLots = inA.filter((l) => l.hSrc === 'door');
  assert.ok(doorLots.length >= 1, 'door tier fires');
  assert.ok(doorLots.every((l) => l.h === 19.5), `door lots take the pooled median height (${doorLots.map((l) => l.h)})`);
  // Tier 4/5: block B hears nothing — beyond the field of block A
  // (800 m away) and signal-free, so purely procedural.
  assert.ok(inB.every((l) => l.hSrc === 'proc'), 'empty block stays procedural');
  assert.ok(inB.every((l) => l.h >= 8 && l.h <= 18), 'lane band heights');
  // Determinism: the same geodata plans byte-identical heights.
  const p2 = planTaipeiBuildings(geo);
  assert.deepEqual(p2.lots.map((l) => [l.x, l.z, l.h, l.hSrc]), p.lots.map((l) => [l.x, l.z, l.h, l.hSrc]));
});

test('a single door on a face does not speak (pool minimum)', () => {
  const geo = syntheticGeo();
  geo.heights.doors = [30015, 30028, 40]; // one 40F plate point
  const p = planTaipeiBuildings(geo);
  assert.ok(!p.lots.some((l) => l.hSrc === 'door'), 'no lot takes a one-door face median');
  assert.ok(!p.lots.some((l) => l.h === 40 * HEIGHT_JOIN.doorM), 'the lone tall door leaks nowhere');
});

// ---- issue #219: the join's sanity guards + stepped massing ----
// The census (on the issue) found the join trusting two absurd
// record classes: parcel-scale outlines donating a whole block's
// floor count to every lot inside, and extreme single-source
// claims with no corroboration. The guards live in the planner,
// so these fixtures exercise them on synthetic layers: the same
// records in a refreshed dataset hit the same verdicts.
function guardGeo(cx, footprints, doors = []) {
  const block = { cx, cz: 30000, area: 120 * 66, bbox: { minX: cx - 60, maxX: cx + 60, minZ: 29967, maxZ: 30033 } };
  return {
    frame: { originLatLon: [25.033, 121.565], bbox: { minX: 0, maxX: 90000, minZ: 0, maxZ: 40000 } },
    parks: [], water: [], green: [], roads: [], roadbeds: [], landmarks: {},
    blocks: [block],
    heights: { sources: {}, factors: { osmLevels: 3.0, permit: 3.0, door: 3.85 }, footprints, doors },
  };
}

test('issue #219: a parcel-scale donor cannot donate its floor count', () => {
  const geo = guardGeo(40000, [
    { src: 'permit', floors: 50, height: null, ring: rect(39945, 29970, 40075, 30030) }, // 130 x 60 m parcel outline
  ]);
  const p = planTaipeiBuildings(geo);
  assert.ok(p.lots.length > 0, 'the block still plans');
  assert.equal(p.stats.heightsGuardParcel, 1, 'the parcel donor is blocked');
  assert.ok(!p.lots.some((l) => l.hSrc === 'permit'), 'the parcel claim speaks nowhere');
  assert.ok(p.lots.every((l) => l.h <= 18), 'its lots fall through to the procedural band like signal-less lots');
});

test('issue #219: an uncorroborated extreme claim is blocked at building scale too', () => {
  const geo = guardGeo(42000, [
    { src: 'permit', floors: 50, height: null, ring: rect(41985, 29985, 42025, 30025) }, // 40 x 40 m, 150 m claim, nothing near
  ]);
  const p = planTaipeiBuildings(geo);
  assert.equal(p.stats.heightsGuardExtreme, 1, 'the extreme donor is blocked');
  assert.ok(!p.lots.some((l) => l.hSrc === 'permit'), 'the extreme claim speaks nowhere');
});

test('issue #219: corroborated extreme claims stand (footprint and door corroboration)', () => {
  const byFootprint = planTaipeiBuildings(guardGeo(44000, [
    { src: 'permit', floors: 50, height: null, ring: rect(43985, 29985, 44025, 30025) },
    { src: 'osm', floors: null, height: 80, ring: rect(44010, 29985, 44045, 30025) }, // overlaps the permit; 80 >= 0.5 x 150
  ]));
  assert.equal(byFootprint.stats.heightsGuardExtreme, 0, 'a second tall footprint corroborates');
  assert.ok(byFootprint.lots.some((l) => l.hSrc === 'permit' && l.h === 150), 'the 150 m claim stands at its tallest lot');
  const byDoors = planTaipeiBuildings(guardGeo(46000, [
    { src: 'permit', floors: 50, height: null, ring: rect(45985, 29985, 46025, 30025) },
  ], [46000, 30005, 40, 46010, 30005, 41])); // 40F plates at the door factor support the claim
  assert.equal(byDoors.stats.heightsGuardExtreme, 0, 'tall door plates corroborate');
  assert.ok(byDoors.lots.some((l) => l.hSrc === 'permit' && l.h === 150), 'the 150 m claim stands at its tallest lot');
});

test('issue #219: sibling lots share one footprint as stepped massing', () => {
  const mk = () => guardGeo(48000, [
    { src: 'osm', floors: 14, height: null, ring: rect(47972, 29975, 48028, 30025) }, // 56 x 50 m complex footprint
  ]);
  const p = planTaipeiBuildings(mk());
  const group = p.lots.filter((l) => l.hSrc === 'osm-levels');
  assert.ok(group.length >= 3, `the footprint subdivides into sibling lots (${group.length})`);
  assert.equal(group.filter((l) => l.h === 42).length, 1, 'exactly one lot keeps the joined height');
  assert.ok(group.every((l) => l.h <= 42 && l.h >= 21), 'siblings step down from the joined height, bounded at half');
  const p2 = planTaipeiBuildings(mk());
  assert.deepEqual(p2.lots.map((l) => [l.x, l.z, l.h, l.hSrc]), p.lots.map((l) => [l.x, l.z, l.h, l.hSrc]), 'stepping is deterministic');
});

test('issue #219: the absurd donors are gone, the corroborated towers stand (real geodata)', () => {
  // Type site A: the Shilin parcel (55F on a 161 x 152 m outline
  // at world (-5176, -7489)) made the plan's tallest lots. Its
  // lots now fall through to low-rise signals.
  const shilin = plan.lots.filter((l) => Math.hypot(l.x - -5176, l.z - -7489) <= 110);
  assert.ok(shilin.length > 0 && Math.max(...shilin.map((l) => l.h)) < 30, 'Shilin parcel: the tallest lot nearby is low-rise (measured 23.5 m, a field lot)');
  assert.ok(!plan.lots.some((l) => l.h === 165), 'no 165 m lot anywhere in the plan');
  // The second absurd cluster: the 112 m height tag on a
  // 165 m-span OSM outline at (-4525, -9702) — 43 lots stood at
  // 112 m; the tallest lot near it measured 21 m once the guard
  // blocked the donor. Issue #278: the outline is the real
  // Chung-cheng Building (Taipei Veterans General Hospital) —
  // the VGH registry site now covers it, so 0 lots stand within
  // 110 m and 0 lots stand at 112 m anywhere; the building is
  // modelled as a landmark at its published 112 m instead (the
  // guard still blocks the donor — no 112 m lot — and the
  // landmark carries the height now).
  const outline = plan.lots.filter((l) => Math.hypot(l.x - -4525, l.z - -9702) <= 110);
  assert.equal(outline.length, 0, 'the 112 m outline: no lots stand within 110 m — the VGH site covers it');
  assert.equal(plan.lots.filter((l) => l.h === 112).length, 0, 'no 112 m lot anywhere in the plan');
  assert.ok(plan.landmarkTowers.some((s) => s.id === 'taipei-veterans-general-hospital' && s.realHeight === 112 && s.estimated === false), 'the Chung-cheng Building stands as a landmark at its published 112 m');
  // The corroborated extremes keep their heights — one full-
  // height lot per footprint, siblings stepped.
  assert.equal(plan.lots.filter((l) => l.h === 162 && l.hSrc === 'permit').length, 1, 'the Xinyi 54F permit (corroborated by an OSM 266 m outline + 54F doors) stands at 162 m');
  // Issue #289: the twin Xinyi 43F permits no longer stand as lots —
  // their two 129 m stand-ins stood inside the A21 site and are
  // displaced by the real tower, which models the same 43F
  // development at its published 232.7 m (see the #289 registry
  // entry and its test). The corroboration story is unchanged: the
  // permits still corroborate each other in the layer, and the
  // 162 m Xinyi 54F permit above still stands as a lot.
  assert.equal(plan.lots.filter((l) => l.h === 129 && l.hSrc === 'permit').length, 0, 'the twin Xinyi 43F permits\u2019 lots are displaced by the #289 A21 structure (same development, modelled at 232.7 m)');
  assert.ok(plan.landmarkTowers.some((s) => s.id === 'nan-shan-xinyi-a21' && s.realHeight === 232.7), 'the A21 tower stands as a landmark at its published height');
  // Type site B: the twin 14-level footprints at Fuguo x Chengde
  // (centres (-4349, -7712) and (-4343, -7670)) — four lots, one
  // full height per footprint, the siblings stepped.
  const fuguo = plan.lots.filter((l) => Math.hypot(l.x - -4346, l.z - -7691) <= 60 && l.hSrc === 'osm-levels');
  assert.deepEqual(fuguo.map((l) => l.h).sort((a, b) => a - b), [36.5, 37, 42, 42], 'Fuguo complex: 42/37 + 42/36.5, not four identical 42 m slabs');
});
