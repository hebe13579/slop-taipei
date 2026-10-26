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
  assert.equal(h.footprints.length, 21471, 'signal footprints (6,012 permit + 15,459 OSM)');
  assert.equal(h.doors.length / 3, 137332, 'door plate points in tile');
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
  assert.equal(lots.length, 38340, 'the join moves heights only — the lot count is the #106 plan as composed with #118, #134 and #137, less the #139 removals, the #144 site exclusion (7 lots), the #135 Twin Towers parcel exclusions (47 lots: 21 in the C1 site rect, 26 in the D1 plaza rect, counted on the pre-#135 plan) and the 2 #146 Wenhu dive drops');
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
  assert.equal(c.permit, 3450);
  assert.equal(c['osm-height'], 1108);
  assert.equal(c['osm-levels'], 4677);
  assert.equal(c.door, 8092);
  assert.equal(c.field, 14282);
  assert.equal(c.proc, 6731);
  assert.equal(plan.stats.heightsPermit, c.permit, 'stats census agrees (permit)');
  assert.equal(plan.stats.heightsDoor, c.door, 'stats census agrees (door)');
  assert.equal(plan.stats.heightsField, c.field, 'stats census agrees (field)');
  assert.equal(plan.stats.heightsProc, c.proc, 'stats census agrees (proc)');
  const real = REAL.reduce((s, k) => s + c[k], 0);
  assert.equal(real, 17327, 'real-signal lots');
  assert.ok(real / lots.length > 0.40 && real / lots.length < 0.50, 'real coverage in the measured band');
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
  const tall = plan.lots.filter((l) => l.h >= 30).length;
  assert.equal(tall, 5990);
  const g60 = plan.lots.filter((l) => l.h >= 60).length;
  assert.equal(g60, 984, 'a >=60 m class exists at all (procedural plan: 5 lots)');
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
  const over = plan.lots.filter((l) => REAL.includes(l.hSrc) && l.h > 60).length;
  assert.equal(over, 820);
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
  assert.equal(tall.length, 342);
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
  assert.equal(bare.lots.length, plan.lots.length - 1, 'one height-flipped lot under the guideway');
  const key = (l) => `${l.x}|${l.z}|${l.w}|${l.d}`;
  const bareByKey = new Map(bare.lots.map((l) => [key(l), l]));
  const missing = plan.lots.filter((l) => !bareByKey.has(key(l)));
  assert.equal(missing.length, 1);
  assert.equal(missing[0].hSrc, 'osm-levels', 'the flipped lot carries a real height');
  assert.ok(missing[0].h <= 6.2, 'its real height clears the underside minus the 1 m clearance');
  let procChecked = 0;
  for (const a of plan.lots) {
    const b = bareByKey.get(key(a));
    if (!b) continue;
    if (a.hSrc === 'proc') {
      assert.equal(a.h, b.h, `proc lot at ${a.x},${a.z} keeps its drawn height`);
      procChecked++;
    }
  }
  assert.equal(procChecked, 6731); // the proc census, re-pinned with it for issues #134 + #139; +2 for #144 (the face-statistic flips, see the census diff), +4 for #135 (the field re-pool flips, see the census diff), -1 for #146 (one of the two Wenhu dive drops is a proc lot)
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
      assert.equal(lot.h, 30, 'permit floors x 3.0, unclamped by the 8-18 m lane band');
    } else if (osm && osm.height) {
      assert.equal(lot.hSrc, 'osm-height');
      assert.equal(lot.h, 44);
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
