import assert from 'node:assert/strict';
import test from 'node:test';

import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { ribbonPoly, pointInPoly } from '../js/taipei-painted.js';
import { medianStripWidth } from '../js/taipei-surfaces.js';
import * as markings from '../js/taipei-markings.js';
import {
  LANE_W, DASH_LEN, DASH_GAP, DIVIDER_W, MAST_ARM_MIN, MAST_ARM_MAX,
  laneLayout, dividersFor, buildLaneDividers,
  detectJunctions, buildJunctionFurniture, buildRoadMarkings,
} from '../js/taipei-markings.js';

// Issue #45 — road markings + static signals. The rules live in
// js/taipei-markings.js (pure) so these tests pin the exact code the
// renderer draws with: the width-derived lane rule (no lane tags in
// the geodata), junction detection from bed endpoints, the
// signalized rule, crosswalk / stop-line placement, and the two user
// scope cuts (no scooter boxes at all; signals static, no phase
// logic) — on synthetic beds and on the real generated tile.

const bed = (name, highway, width, ways = [1], pts = [0, 0, 100, 0]) => ({
  name, highway, width, pedestrianLayout: 'sidewalk', pts, sourceWayIds: ways,
});
const quadCentre = (q) => [(q[0] + q[2] + q[4] + q[6]) / 4, (q[1] + q[3] + q[5] + q[7]) / 4];

// A 4-way junction the way the generation map actually emits one:
// every road split into beds that END at the shared junction node.
const fourWay = () => [
  bed('EW Blvd', 'secondary', 30, [1, 2], [-100, 0, 0, 0]),
  bed('EW Blvd', 'secondary', 30, [1, 2], [0, 0, 100, 0]),
  bed('NS Ave', 'primary', 24, [3], [0, -100, 0, 0]),
  bed('NS Ave', 'primary', 24, [3], [0, 0, 0, 100]),
];

test('scope cuts are structural: no scooter-box or phase machinery exists', () => {
  for (const key of Object.keys(markings)) {
    assert.ok(!/scooter/i.test(key), `unexpected scooter export ${key}`);
    assert.ok(!/phase|cycle/i.test(key), `unexpected signal-phase export ${key}`);
  }
});

test('laneLayout: merged bed splits at its median, boundaries stay off the strip', () => {
  const b = bed('仁愛路四段', 'secondary', 30, [1, 2]);
  const l = laneLayout(b);
  const medianHalf = medianStripWidth(b) / 2;
  assert.equal(l.medianHalf, medianHalf);
  assert.equal(l.perSide, 4); // (15 − 1.2) / 3.2 ≈ 4.3 → 4 lanes per carriageway
  assert.equal(l.boundaries.length, 6); // 3 per carriageway
  for (const o of l.boundaries) assert.ok(Math.abs(o) > medianHalf + 1, `boundary ${o} clears the median`);
  // Symmetric: same offsets each side (two carriageways of one bed).
  const sorted = [...l.boundaries].sort((x, y) => x - y);
  const expected = [-11.55, -8.1, -4.65, 4.65, 8.1, 11.55];
  assert.equal(sorted.length, expected.length);
  sorted.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 0.01, `boundary ${v} ≈ ${expected[i]}`));
});

test('laneLayout: unmerged two-way bed never divides its centre line', () => {
  const l = laneLayout(bed('x', 'secondary', 14, [7]));
  assert.equal(l.perSide, 2); // round(14 / 3.2) = 4 total, 2 per direction
  assert.deepEqual(l.boundaries, [3.5, -3.5]);
  assert.ok(!l.boundaries.includes(0));
  // 3-lane and narrower two-way beds: one lane per direction, nothing to divide.
  assert.equal(laneLayout(bed('x', 'tertiary', 11, [7])).boundaries.length, 0);
  assert.equal(laneLayout(bed('x', 'tertiary', 9.6, [7])).boundaries.length, 0);
});

test('dividersFor: class gate — tertiary and above only', () => {
  assert.ok(dividersFor(bed('x', 'secondary', 30, [1, 2])));
  assert.ok(dividersFor(bed('x', 'tertiary', 21.7, [1, 2])));
  assert.ok(!dividersFor(bed('x', 'residential', 30, [1, 2])), 'a wide lane-class bed gets no dividers');
  assert.ok(!dividersFor(bed('x', 'secondary', 11, [7])), 'too few lanes per direction');
  assert.ok(!dividersFor(null));
  // Issue #162: the deck flag is a hard gate at any class — an
  // elevated bed's lane lines are never ground markings. An
  // unflagged trunk bed is drawn at grade and keeps its dividers:
  // the flag, not the class, is the predicate (as for furniture,
  // issue #88).
  assert.ok(!dividersFor({ ...bed('x', 'trunk', 30, [1, 2]), deck: true }), 'deck-flagged bed gets no dividers');
  assert.ok(dividersFor(bed('x', 'trunk', 30, [1, 2])), 'unflagged trunk bed keeps dividers');
});

test('dividers (issue #162): a deck-flagged bed paints nothing on the ground under it', () => {
  // A ground boulevard crossed by an elevated expressway (one
  // deck-flagged bed). The expressway's own lane lines used to be
  // planned at ground Y along its whole corridor.
  const ew = bed('EW Blvd', 'secondary', 30, [1, 2], [-100, 0, 100, 0]);
  const nsDeck = { ...bed('NS Expy', 'trunk', 24, [3], [0, -100, 0, 100]), deck: true };
  const { dashes, dashStrips, stats } = buildLaneDividers([ew, nsDeck]);
  assert.equal(stats.beds, 1, 'only the ground bed is planned');
  assert.equal(stats.deckBedsSkipped, 1, 'the qualifying deck bed is counted as skipped');
  assert.ok(dashes.length > 0, 'the ground boulevard keeps its dividers');
  const nsPoly = ribbonPoly(nsDeck);
  for (const q of dashes) assert.ok(!pointInPoly(quadCentre(q), nsPoly), `dash centre ${quadCentre(q)} under the elevated road`);
  // Strips: the system's crossing invariant (span midpoints stay
  // out of the crossed ribbon — a boundary frame may sit on the
  // ribbon edge, as at every ground crossing).
  for (const s of dashStrips) {
    for (let i = 0; i + 1 < s.length; i++) {
      const mid = [(s[i].hx + s[i + 1].hx) / 2, (s[i].hz + s[i + 1].hz) / 2];
      assert.ok(!pointInPoly(mid, nsPoly), `strip span midpoint ${mid} under the elevated road`);
    }
  }
  // The same bed WITHOUT the flag is an at-grade carriageway and
  // is planned normally.
  const nsGround = bed('NS Expy', 'trunk', 24, [3], [0, -100, 0, 100]);
  const r2 = buildLaneDividers([ew, nsGround]);
  assert.equal(r2.stats.beds, 2);
  assert.equal(r2.stats.deckBedsSkipped, 0);
  assert.ok(r2.dashes.some((q) => pointInPoly(quadCentre(q), nsPoly)), 'unflagged bed paints its dividers');
});

test('dividers: dashes break at a crossing carriageway and resume past it', () => {
  const ew = bed('EW Blvd', 'secondary', 30, [1, 2], [-100, 0, 100, 0]);
  const ns = bed('NS Ave', 'residential', 24, [9], [0, -100, 0, 100]); // occluder only (lane class draws none)
  const { dashes, stats } = buildLaneDividers([ew, ns]);
  assert.ok(dashes.length > 0 && stats.dividerKm > 0);
  const nsPoly = ribbonPoly(ns);
  for (const q of dashes) assert.ok(!pointInPoly(quadCentre(q), nsPoly), `dash centre ${quadCentre(q)} inside the crossing road`);
  assert.ok(dashes.some((q) => quadCentre(q)[0] > 20), 'dashes resume east of the junction');
  assert.ok(dashes.some((q) => quadCentre(q)[0] < -20), 'dashes resume west of the junction');
});

test('dividers: no dash lands on the median strip', () => {
  const ew = bed('EW Blvd', 'secondary', 30, [1, 2], [-100, 0, 100, 0]);
  const { dashes } = buildLaneDividers([ew]);
  const medianHalf = medianStripWidth(ew) / 2;
  assert.ok(dashes.length > 0);
  for (const q of dashes) {
    const [, cz] = quadCentre(q);
    assert.ok(Math.abs(cz) > medianHalf + DIVIDER_W, `dash at z=${cz} overlaps the median (half ${medianHalf})`);
  }
});

test('dividers: dash pattern is 3 m paint / 4.5 m gap along a straight bed', () => {
  assert.equal(DASH_LEN, 3);
  assert.equal(DASH_GAP, 4.5);
  assert.equal(LANE_W, 3.2);
  const ew = bed('EW Blvd', 'secondary', 30, [1, 2], [-100, 0, 100, 0]);
  const { dashes, stats } = buildLaneDividers([ew]);
  // Painted fraction of the line ≈ DASH_LEN / (DASH_LEN + DASH_GAP).
  const lineLength = 200 * laneLayout(ew).boundaries.length;
  const painted = stats.dividerKm * 1000;
  assert.ok(Math.abs(painted / lineLength - DASH_LEN / (DASH_LEN + DASH_GAP)) < 0.08, `painted fraction ${painted / lineLength}`);
});

test('junctions: the split-bed 4-way is one signalized junction with 4 arms', () => {
  const js = detectJunctions(fourWay());
  assert.equal(js.length, 1);
  assert.equal(js[0].signalized, true);
  assert.equal(js[0].arms.length, 4);
  assert.deepEqual(js[0].arms.map((a) => a.name).sort(), ['EW Blvd', 'EW Blvd', 'NS Ave', 'NS Ave']);
});

test('junctions: a lane T-ing into an arterial is a junction but NOT signalized', () => {
  const beds = [
    bed('Main Rd', 'secondary', 20, [1], [-100, 0, 0, 0]),
    bed('Main Rd', 'secondary', 20, [1], [0, 0, 100, 0]),
    bed('Lane 5', 'residential', 6, [2], [0, 0, 0, 80]),
  ];
  const js = detectJunctions(beds);
  assert.equal(js.length, 1);
  assert.equal(js[0].signalized, false); // only one tertiary-or-above road
});

test('junctions: parallel roads that never meet produce none', () => {
  const beds = [bed('A Rd', 'secondary', 20, [1], [0, 0, 100, 0]), bed('B Rd', 'secondary', 20, [2], [0, 50, 100, 50])];
  assert.equal(detectJunctions(beds).length, 0);
});

test('furniture: 4-way gets a crosswalk, stop line and signal per approach', () => {
  const beds = fourWay();
  const js = detectJunctions(beds);
  const f = buildJunctionFurniture(beds, js);
  assert.equal(f.stats.crosswalks, 4);
  assert.equal(f.stats.stopLines, 4);
  assert.equal(f.stats.signals, 4);
  assert.equal(f.signals.length, 4);
  // Crosswalks on all four arms: stripe centres in each arm's zone,
  // outside the junction box (past the crossing road's half width).
  const centres = f.stripes.map(quadCentre);
  assert.ok(centres.some(([x, z]) => x > 12 && Math.abs(z) < 16), 'east arm zebra');
  assert.ok(centres.some(([x, z]) => x < -12 && Math.abs(z) < 16), 'west arm zebra');
  assert.ok(centres.some(([x, z]) => z > 15 && Math.abs(x) < 13), 'south arm zebra');
  assert.ok(centres.some(([x, z]) => z < -15 && Math.abs(x) < 13), 'north arm zebra');
  // The east approach's stop line sits on the driver's right half
  // (travel is westward, right hand is north = −z in this frame).
  const stopCentres = f.stopLines.map(quadCentre);
  assert.ok(stopCentres.some(([x, z]) => x > 12 && z < 0), 'east stop line on the approach half');
  // The east approach's signal stands on the FAR side (x < 0),
  // driver's right (z < 0), facing back down the approach (+x).
  const east = f.signals.find((s) => s.faceX > 0.9);
  assert.ok(east && east.x < 0 && east.z < 0, `east signal at ${east?.x},${east?.z}`);
});

test('furniture (issue #88): a deck-flagged arm gets no ground furniture', () => {
  // The 4-way, but the NS road is an elevated carriageway (deck-
  // flagged, the generator's flag for beds the viaduct layer
  // draws instead of the ground ribbons): its two approaches are
  // not at grade, so they get no crosswalk, stop line or signal.
  // The ground EW approaches keep theirs, and the junction stays
  // signalized (detection is untouched by the rule).
  const beds = fourWay();
  for (const b of beds) if (b.name === 'NS Ave') b.deck = true;
  const js = detectJunctions(beds);
  assert.equal(js.length, 1);
  assert.equal(js[0].signalized, true);
  const f = buildJunctionFurniture(beds, js);
  assert.equal(f.stats.deckArmsSkipped, 2);
  assert.equal(f.stats.crosswalks, 2);
  assert.equal(f.stats.stopLines, 2);
  assert.equal(f.stats.signals, 2);
  // No stripe centre on the deck (z-axis) approaches.
  const centres = f.stripes.map(quadCentre);
  assert.ok(!centres.some(([x, z]) => Math.abs(x) < 13 && Math.abs(z) > 15), 'no zebra on the deck approaches');
  // A deck-CLASS bed without the flag is drawn at grade and keeps
  // its furniture (the flag, not the class, is the predicate).
  const beds2 = fourWay();
  for (const b of beds2) if (b.name === 'NS Ave') b.highway = 'trunk';
  const f2 = buildJunctionFurniture(beds2, detectJunctions(beds2));
  assert.equal(f2.stats.deckArmsSkipped, 0);
  assert.equal(f2.stats.crosswalks, 4);
  assert.equal(f2.stats.signals, 4);
});

test('signals (issue #64): every unit stands on a corner, outside every carriageway', () => {
  const beds = fourWay();
  const f = buildJunctionFurniture(beds, detectJunctions(beds));
  const polys = beds.map(ribbonPoly);
  assert.equal(f.signals.length, 4);
  for (const s of f.signals) {
    for (const p of polys) assert.ok(!pointInPoly([s.x, s.z], p), `signal at ${s.x},${s.z} inside a carriageway ribbon`);
  }
  // A skewed (45°) crossing — the angle-corrected box extent and
  // the clearance solver keep the corners clear there too.
  const skew = [
    bed('EW Blvd', 'secondary', 20, [1], [-100, 0, 0, 0]),
    bed('EW Blvd', 'secondary', 20, [1], [0, 0, 100, 0]),
    bed('Diag Rd', 'primary', 16, [2], [0, 0, -70, -70]),
    bed('Diag Rd', 'primary', 16, [2], [0, 0, 70, 70]),
  ];
  const js = detectJunctions(skew);
  assert.equal(js.length, 1);
  assert.equal(js[0].signalized, true);
  const f2 = buildJunctionFurniture(skew, js);
  assert.equal(f2.signals.length, 4);
  const polys2 = skew.map(ribbonPoly);
  for (const s of f2.signals) {
    for (const p of polys2) assert.ok(!pointInPoly([s.x, s.z], p), `skew signal at ${s.x},${s.z} inside a carriageway ribbon`);
  }
});

test('signals (issue #64): mast-arm (T) only on divided approaches, corner pole elsewhere', () => {
  const beds = fourWay(); // EW: 30 m merged bed with a median; NS: 24 m single carriageway
  const f = buildJunctionFurniture(beds, detectJunctions(beds));
  const ewSignals = f.signals.filter((s) => beds[s.bed].name === 'EW Blvd');
  const nsSignals = f.signals.filter((s) => beds[s.bed].name === 'NS Ave');
  assert.equal(ewSignals.length, 2);
  assert.equal(nsSignals.length, 2);
  for (const s of ewSignals) {
    assert.equal(s.kind, 'mast', 'divided EW approach gets the mast-arm unit');
    assert.ok(s.armLen >= MAST_ARM_MIN && s.armLen <= MAST_ARM_MAX, `armLen ${s.armLen} in clamps`);
  }
  for (const s of nsSignals) {
    assert.equal(s.kind, 'pole', 'undivided NS approach gets the plain corner pole');
    assert.equal(s.armLen, 0);
  }
  assert.equal(f.stats.mastSignals, 2);
  assert.equal(f.stats.poleSignals, 2);
});

test('furniture: non-signalized junctions get nothing', () => {
  const beds = [
    bed('Main Rd', 'secondary', 20, [1], [-100, 0, 0, 0]),
    bed('Main Rd', 'secondary', 20, [1], [0, 0, 100, 0]),
    bed('Lane 5', 'residential', 6, [2], [0, 0, 0, 80]),
  ];
  const f = buildJunctionFurniture(beds, detectJunctions(beds));
  assert.equal(f.stripes.length + f.stopLines.length + f.signals.length, 0);
});

test('geodata: tile-wide marking counts are in the audited bands', () => {
  const r = buildRoadMarkings(TAIPEI_GEO.roadbeds);
  // Band re-based 2026-10-24 (issue #60 west expansion): the station
  // district's dense old-city grid took signalized junctions 165 ->
  // 241 (junctions 897 -> 1,158); the old 200 ceiling was an M0-tile
  // figure, not a rule.
  // Band re-based for issue #102 (northern phase 1): junctions
  // 1,136 -> 2,361 across the corridor, Beitou and the connector,
  // but the north signalizes sparsely (Shilin/Beitou arterials,
  // long rural stretches) — signalized 241 -> 344.
  assert.ok(r.stats.signalized >= 120 && r.stats.signalized <= 450, `signalized ${r.stats.signalized}`);
  // Census pin (PR #72 rebase, 2026-10-24, on PR #70's data): the
  // expanded map's signalized count is exactly 241.
  // Re-pinned for issue #102: exactly 344 (per-box census in the
  // #102 evidence: A 231, B 9, corridor 85, Beitou 18, connector 1
  // — region A's 231 is its live count, untouched).
  // Re-pinned for issue #134: exactly 392 (+48). Bed-midpoint
  // subset census attributes 40 signalized junctions to the
  // airport box and 16 to the corridor strip; seam junctions
  // account for the difference against the tile-wide delta.
  assert.equal(r.stats.signalized, 392, `signalized census ${r.stats.signalized}`);
  assert.ok(r.stats.dividerKm > 50, `divider km ${r.stats.dividerKm}`);
  // Issue #162 re-pin: lane dividers are no longer planned for
  // deck-flagged beds (they painted at ground Y under their own
  // viaducts). Measured on the pre-fix tree by a per-bed
  // instrumented census of this pipeline: 91 deck beds passed the
  // class + lane gates, carrying 23,378 dash quads / 34.88 km of
  // paint — the same deck delta on this default path (181,812 ->
  // 158,434 quads, dividerKm 270.65 -> 235.77, beds 1,101 ->
  // 1,010) and on the boot's cap-clipped path (181,402 -> 158,024,
  // 270.06 -> 235.19). Ground-bed output proven byte-identical on
  // both paths: the post-fix dash and strip arrays equal the
  // pre-fix arrays with the deck beds' own entries removed, order
  // preserved; stripes / stop lines / signals identical (furniture
  // untouched — deck arms were already skipped, issue #88).
  // Issue #163 re-pin (on top of #162's): buildRoadMarkings now
  // clips dashes against the caps' full paved surface — ring +
  // the fitted caps' arm extension strips (capSurfacePolys) —
  // not the ring alone, so dashes whose centres land on an
  // extension strip (junction mouth ground paved by #163) are
  // clipped too. Proven delta, measured on this tree by running
  // buildLaneDividers with ring-only vs ring+strip occluders:
  // 158,434 -> 158,099 quads (-335) and 235.77 -> 235.28 km
  // (-0.49); the ring-only run reproduces the #162 pins above
  // exactly, so the whole delta is the strip clipping. (On the
  // pre-#162 tree the same delta measured -359; the difference
  // is deck-bed dashes #162 removed first.)
  // Issue #171 re-pin (on top of #163's): the cap surface the
  // dashes clip against shrinks by the outline discipline —
  // rings by the main-corner gate (703,160 -> 660,401 m²) and
  // strips by the kerb stop (138,514 -> 129,142 m²) — so dash
  // centres that landed on the removed fan corners and tongues
  // are no longer occluded: 158,099 -> 158,190 quads (+91) and
  // 235.28 -> 235.41 km (+0.13).
  // Issue #173 re-pin (on top of #171's): two placement rules —
  // the X-pair cull (divider centrelines may not properly cross:
  // 258 crossing pairs among emittable intervals, 975 samples
  // blocked, both intervals of a pair dropped so the lines end
  // at the gore) and the roundabout occluders (island + apron
  // polygons join the dash occlusion set; the boot path also
  // passes the park/green polys for the disc-clipped wedge
  // occluders). Measured on this path: 158,190 -> 157,589 quads
  // (-601) and 235.41 -> 234.55 km (-0.86). The boot path moves
  // 158,202 -> 157,599 by the same rules plus its wedge greens
  // and roundabout-planned caps.
  // Issue #182 re-pin (on top of #173's): dash quads and dash
  // strips now also yield to the crosswalk furniture itself —
  // buildRoadMarkings passes the placed band/stripe polygons to
  // the divider builder, which culls a quad overlapping one by
  // more than the 0.05 m2 hairline and splits strips at segments
  // whose centreline crosses one. Proven delta, measured on this
  // path by a before/after dump diff: the after-dashes are an
  // order-preserving subsequence of the pre-fix dashes and the
  // removed set is exactly the 7 quads whose band/stripe overlap
  // exceeded the hairline (157,589 -> 157,582 quads, 234.550 ->
  // 234.539 km, inside the band below); no surviving quad
  // overlaps a band or stripe at all (max 0.0000 m2), furniture /
  // signals / X-pair counts are byte-identical, and 13 strip
  // segments were split at furniture crossings (strips 6,989 ->
  // 6,986: 5 strips fully crossed, 2 split). The sweep probes
  // re-measure the class at zero: dash x band/stripe 20 pairs ->
  // 0, strip paint over bands/stripes 16.43 m -> 0 m.
  assert.equal(r.stats.dashQuads, 157582, `dash quads ${r.stats.dashQuads}`);
  assert.equal(r.stats.crossPairs, 258, `X pairs culled ${r.stats.crossPairs}`);
  assert.equal(r.stats.dividerBeds, 1010, `divider beds ${r.stats.dividerBeds}`);
  assert.equal(r.stats.deckDividerBedsSkipped, 91, `deck divider beds skipped ${r.stats.deckDividerBedsSkipped}`);
  assert.ok(Math.abs(r.stats.dividerKm - 234.55) < 0.05, `divider km ${r.stats.dividerKm}`);
  assert.ok(r.stats.crosswalks > 400, `crosswalks ${r.stats.crosswalks}`);
  assert.ok(r.stats.signalUnits >= r.stats.stopLines && r.stats.stopLines > 600,
    `signals ${r.stats.signalUnits} / stop lines ${r.stats.stopLines}`);
});

test('geodata: acceptance junction 信義路五段 × 松仁路 is signalized and furnished', () => {
  const r = buildRoadMarkings(TAIPEI_GEO.roadbeds);
  const acc = r.junctions.filter((j) => j.signalized && Math.hypot(j.x - 343, j.z - 21) < 25);
  assert.equal(acc.length, 1, 'exactly one signalized junction at the acceptance corner');
  const names = new Set(acc[0].arms.map((a) => a.name));
  assert.ok(names.has('信義路五段') && names.has('松仁路'), `arms: ${[...names]}`);
  assert.ok(acc[0].arms.length >= 4, 'four approaches after dedupe');
  const near = r.stripes.filter((q) => Math.hypot(quadCentre(q)[0] - 343, quadCentre(q)[1] - 21) < 45);
  assert.ok(near.length > 40, `${near.length} zebra stripes around the acceptance junction`);
  const sigNear = r.signals.filter((s) => Math.hypot(s.x - 343, s.z - 21) < 45);
  assert.equal(sigNear.length, 4, 'one signal unit per approach');
  // Dividers keep out of the junction box: no dash centre inside
  // the OVERLAP of the two carriageways' ribbons (each road's own
  // mid-block dashes inside its own ribbon are of course fine).
  const songrenPolys = TAIPEI_GEO.roadbeds.filter((b) => b.name === '松仁路' && b.width > 20).map(ribbonPoly);
  const xinyiPolys = TAIPEI_GEO.roadbeds.filter((b) => b.name === '信義路五段' && b.width > 20).map(ribbonPoly);
  for (const q of r.dashes) {
    const c = quadCentre(q);
    if (Math.hypot(c[0] - 343, c[1] - 21) > 45) continue;
    const inSongren = songrenPolys.some((p) => pointInPoly(c, p));
    const inXinyi = xinyiPolys.some((p) => pointInPoly(c, p));
    assert.ok(!(inSongren && inXinyi), `dash centre ${c} inside the junction box (both ribbons)`);
  }
});

test('geodata (issue #64): no signal stands on a carriageway; mast-arms only on divided approaches', () => {
  const beds = TAIPEI_GEO.roadbeds;
  const r = buildRoadMarkings(beds);
  // 0 units inside any roadbed ribbon, tile-wide (the audit metric
  // of issue #64: 468 of 787 inside before the rework, 116 of them
  // inside two or more ribbons — the middle of the junction).
  const polys = beds.map(ribbonPoly);
  const GRID = 100;
  const grid = new Map();
  polys.forEach((poly, i) => {
    const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
    for (let gx = Math.floor(Math.min(...xs) / GRID); gx <= Math.floor(Math.max(...xs) / GRID); gx++)
      for (let gz = Math.floor(Math.min(...zs) / GRID); gz <= Math.floor(Math.max(...zs) / GRID); gz++) {
        const k = `${gx},${gz}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(i);
      }
  });
  const insideAny = (x, z) => {
    const cand = grid.get(`${Math.floor(x / GRID)},${Math.floor(z / GRID)}`) || [];
    return cand.some((ci) => pointInPoly([x, z], polys[ci]));
  };
  for (const s of r.signals) {
    assert.ok(!insideAny(s.x, s.z), `signal at ${Math.round(s.x)},${Math.round(s.z)} inside a roadbed ribbon`);
  }
  assert.equal(r.stats.clearanceUnresolved, 0, 'every corner resolved clear of the carriageways');
  // Counts by kind: every unit is one kind or the other, and the
  // mast-arm share is the divided-boulevard share of approaches.
  // Census re-pinned 2026-10-24 for the PR #72 rebase onto the
  // expanded map (PR #70): the station district + Ximending took the
  // tile from 787 units (268 mast / 519 pole) to 1,196 units —
  // exact split re-derived on the merged tree: 386 mast-arm /
  // 810 corner-pole. The 0-inside invariant above is the binding
  // pin; these counts are the census record and move only with a
  // data regen, with the reason written here.
  // Re-pinned again for issue #75 (junction audit 2): the
  // handcrafted roundabout sites suppress furniture on their
  // ring arms — 34 ring-arm approaches at the 7 claimed
  // junctions (仁愛敦南圓環 + 東門圓環） each lose the corner-pole
  // unit they would have carried: 1,196 -> 1,162 units, all 34
  // from the pole split (810 -> 776); mast-arm units are
  // unaffected (386). stats.ringArmsSkipped = 34 records the
  // suppressed arms.
  // Re-pinned for issue #88 (ramp-weave re-evaluation): deck-flagged
  // arms are elevated carriageways, not at-grade approaches, and no
  // longer receive ground furniture — 71 deck arms at signalized
  // junctions (stats.deckArmsSkipped) each lose their unit: 1,162 ->
  // 1,091 units, split 27 mast (386 -> 359) / 44 pole (776 -> 732).
  // The same suppression takes out 30 crosswalks (843 -> 813) and
  // 71 stop lines (1,162 -> 1,091) that were painted for roads not
  // drawn at ground level. Detection, caps and every ground arm's
  // furniture are unchanged.
  // Re-pinned for issue #102 (northern phase 1): signalized
  // junctions 241 -> 344 on the enlarged tile take units 1,091 ->
  // 1,489 (mast 359 -> 506, pole 732 -> 983); the northern
  // elevated network's deck arms at signalized junctions take
  // deckArmsSkipped 71 -> 127. The 0-inside invariant and the
  // mast<->divided audit below are unchanged and pass tile-wide.
  // Re-pinned for issue #134: signalized junctions 344 -> 392
  // take units 1,489 -> 1,686 (mast 506 -> 579, pole 983 ->
  // 1,107); the airport box's riverside expressway arms take
  // deckArmsSkipped 127 -> 147. Same invariants, unchanged.
  assert.equal(r.stats.signalMast + r.stats.signalPole, r.stats.signalUnits);
  assert.equal(r.stats.signalUnits, 1686, `signal units ${r.stats.signalUnits}`);
  assert.equal(r.stats.signalMast, 579, `mast units ${r.stats.signalMast}`);
  assert.equal(r.stats.signalPole, 1107, `pole units ${r.stats.signalPole}`);
  assert.equal(r.stats.deckArmsSkipped, 147, `deck arms skipped ${r.stats.deckArmsSkipped}`);
  // Mast ⟺ divided, recomputed independently of the planner's own
  // helper: the approach bed splits at a drawn median, or a
  // same-name near-parallel twin arm shares its junction.
  const sigJunctions = r.junctions.filter((j) => j.signalized);
  for (const s of r.signals) {
    const j = sigJunctions.find((jj) => jj.arms.some((a) => a.bed === s.bed
      && Math.abs(a.dirX - s.faceX) < 0.01 && Math.abs(a.dirZ - s.faceZ) < 0.01));
    assert.ok(j, `signal for bed ${s.bed} joins a signalized junction`);
    const arm = j.arms.find((a) => a.bed === s.bed && Math.abs(a.dirX - s.faceX) < 0.01 && Math.abs(a.dirZ - s.faceZ) < 0.01);
    let divided = laneLayout(beds[s.bed]).medianHalf > 0;
    if (!divided) {
      divided = j.arms.some((b) => b !== arm && b.bed !== arm.bed && b.name === arm.name
        && b.dirX * arm.dirX + b.dirZ * arm.dirZ > Math.cos((25 * Math.PI) / 180));
    }
    assert.equal(s.kind === 'mast', divided,
      `${divided ? 'divided' : 'undivided'} approach (bed ${beds[s.bed].name}) got kind ${s.kind}`);
    if (s.kind === 'mast') assert.ok(s.armLen >= MAST_ARM_MIN && s.armLen <= MAST_ARM_MAX, `armLen ${s.armLen}`);
    else assert.equal(s.armLen, 0);
  }
});

// ---------------------------------------------------------------------
// Issue #173 (DASH class): X-pair cull + roundabout occluders.

const segCrossProper = (a, b, p, q) => {
  const d1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const d2 = (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]);
  const d3 = (q[0] - p[0]) * (a[1] - p[1]) - (q[1] - p[1]) * (a[0] - p[0]);
  const d4 = (q[0] - p[0]) * (b[1] - p[1]) - (q[1] - p[1]) * (b[0] - p[0]);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
};
const dashSeg = (q) => [[(q[0] + q[6]) / 2, (q[1] + q[7]) / 2], [(q[2] + q[4]) / 2, (q[3] + q[5]) / 2]];
const countDashCrossings = (dashes) => {
  const cell = 8;
  const g = new Map();
  dashes.forEach((q, i) => {
    const c = quadCentre(q);
    const k = `${Math.floor(c[0] / cell)},${Math.floor(c[1] / cell)}`;
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(i);
  });
  let n = 0;
  dashes.forEach((q, i) => {
    const c = quadCentre(q);
    const [a, b] = dashSeg(q);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      for (const j of g.get(`${Math.floor(c[0] / cell) + dx},${Math.floor(c[1] / cell) + dz}`) || []) {
        if (j <= i) continue;
        const [p, r] = dashSeg(dashes[j]);
        if (segCrossProper(a, b, p, r)) n++;
      }
    }
  });
  return n;
};

test('dash X-cull (issue #173): braided same-way beds never paint a crossing pair', () => {
  // Two wide divided beds sharing a source way (the braid pattern
  // the foreign-ribbon clip cannot see): their divider centrelines
  // cross live all along the braid. Without the cull the crossing
  // intervals paint X pairs; with it both sides end at the gore.
  const a = bed('A Blvd', 'secondary', 36, [1, 2], [-100, 0, 100, 0]);
  const b = bed('B Blvd', 'secondary', 36, [1, 3], [-100, 8, 100, -8]);
  const { dashes, dashStrips, stats } = buildLaneDividers([a, b]);
  assert.ok(stats.crossPairs > 0, `crossing pairs detected (${stats.crossPairs})`);
  assert.ok(stats.crossBlockedSamples > 0, 'samples blocked by the cull');
  assert.equal(countDashCrossings(dashes), 0, 'no emitted dash centreline properly crosses another');
  assert.ok(dashStrips.length > 0, 'shader strips still emitted away from the crossings');
});

test('dash X-cull (issue #173): the real tile emits zero crossing pairs', () => {
  const r = buildRoadMarkings(TAIPEI_GEO.roadbeds);
  assert.equal(countDashCrossings(r.dashes), 0, 'tile-wide emitted crossings');
});

// Issue #182: dashes yield to the crosswalk furniture itself.
// Helpers mirror the sweep probes (roadsweep3): convex clip area
// and a strict segment-interior crossing test.
const furnClipArea = (subject, clip) => {
  let poly = subject.map((p) => [...p]);
  const cc = [clip.reduce((s, p) => s + p[0], 0) / clip.length, clip.reduce((s, p) => s + p[1], 0) / clip.length];
  for (let e = 0; e < clip.length && poly.length; e++) {
    const a = clip[e], b = clip[(e + 1) % clip.length];
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const side = (p) => ex * (p[1] - a[1]) - ez * (p[0] - a[0]);
    const ref = side(cc);
    const next = [];
    for (let i = 0; i < poly.length; i++) {
      const cur = poly[i], prv = poly[(i + poly.length - 1) % poly.length];
      const ci = side(cur) * ref >= 0, pi = side(prv) * ref >= 0;
      if (ci !== pi) { const t = side(prv) / (side(prv) - side(cur)); next.push([prv[0] + (cur[0] - prv[0]) * t, prv[1] + (cur[1] - prv[1]) * t]); }
      if (ci) next.push(cur);
    }
    poly = next;
  }
  if (poly.length < 3) return 0;
  return Math.abs(poly.reduce((s, p, i, a) => s + p[0] * a[(i + 1) % a.length][1] - a[(i + 1) % a.length][0] * p[1], 0) / 2);
};
const quadPtsOf = (q) => [[q[0], q[1]], [q[2], q[3]], [q[4], q[5]], [q[6], q[7]]];
const segCrossesPoly = (ax, az, bx, bz, poly) => {
  if (pointInPoly([ax, az], poly) || pointInPoly([bx, bz], poly)) return true;
  for (let e = 0; e < poly.length; e++) {
    const [px, pz] = poly[e], [qx, qz] = poly[(e + 1) % poly.length];
    if (segCrossProper([ax, az], [bx, bz], [px, pz], [qx, qz])) return true;
  }
  return false;
};

test('dash x furniture (issue #182): a band across the road culls and splits dashes', () => {
  const b = bed('Band Blvd', 'secondary', 36, [1, 2], [-100, 0, 100, 0]);
  const band = [[-3, -30], [3, -30], [3, 30], [-3, 30]];
  const base = buildLaneDividers([b]);
  assert.ok(base.dashes.length > 0 && base.dashStrips.length > 0, 'synthetic dividers exist');
  const furn = buildLaneDividers([b], new Map(), null, null, [band]);
  assert.ok(furn.stats.furnBlockedQuads > 0, `quads culled at the band (${furn.stats.furnBlockedQuads})`);
  assert.ok(furn.dashes.length < base.dashes.length, 'fewer dashes survive');
  for (const q of furn.dashes) {
    assert.ok(furnClipArea(quadPtsOf(q), band) <= markings.DASH_FURN_OVERLAP_M2,
      'no surviving dash overlaps the band beyond the hairline');
  }
  assert.ok(furn.stats.furnStripSegmentsClipped > 0, 'strip segments clipped at the band');
  for (const strip of furn.dashStrips) {
    for (let k = 0; k + 1 < strip.length; k++) {
      const a = strip[k], c = strip[k + 1];
      assert.ok(!segCrossesPoly((a.hx + a.lx) / 2, (a.hz + a.lz) / 2, (c.hx + c.lx) / 2, (c.hz + c.lz) / 2, band),
        'no surviving strip segment crosses the band');
    }
  }
  // No furniture (or an empty set) changes nothing for a caller.
  const empty = buildLaneDividers([b], new Map(), null, null, []);
  assert.deepEqual(empty.dashes, base.dashes, 'empty furniture set: dashes identical');
  assert.deepEqual(empty.dashStrips, base.dashStrips, 'empty furniture set: strips identical');
});

test('dash x furniture (issue #182): the real tile paints no dash over a zebra', () => {
  const r = buildRoadMarkings(TAIPEI_GEO.roadbeds);
  // The measured #182 delta on this path (see the census re-pin
  // comment in the counts test): exactly 7 quads culled and 13
  // strip segments clipped.
  assert.equal(r.stats.furnBlockedQuads, 7, `quads culled at furniture (${r.stats.furnBlockedQuads})`);
  assert.equal(r.stats.furnStripSegmentsClipped, 13, `strip segments clipped (${r.stats.furnStripSegmentsClipped})`);
  const furnPolys = [...r.bands.map((b) => b.quad), ...r.stripes].map(quadPtsOf);
  const CELL = 25;
  const grid = new Map();
  furnPolys.forEach((poly, i) => {
    const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
    for (let gx = Math.floor(Math.min(...xs) / CELL); gx <= Math.floor(Math.max(...xs) / CELL); gx++)
      for (let gz = Math.floor(Math.min(...zs) / CELL); gz <= Math.floor(Math.max(...zs) / CELL); gz++) {
        const k = `${gx},${gz}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i);
      }
  });
  let worst = 0;
  for (const q of r.dashes) {
    const P = quadPtsOf(q);
    const xs = P.map((p) => p[0]), zs = P.map((p) => p[1]);
    const seen = new Set();
    for (let gx = Math.floor(Math.min(...xs) / CELL); gx <= Math.floor(Math.max(...xs) / CELL); gx++)
      for (let gz = Math.floor(Math.min(...zs) / CELL); gz <= Math.floor(Math.max(...zs) / CELL); gz++)
        for (const i of grid.get(`${gx},${gz}`) || []) {
          if (seen.has(i)) continue; seen.add(i);
          const a = furnClipArea(P, furnPolys[i]); if (a > worst) worst = a;
        }
  }
  assert.ok(worst <= markings.DASH_FURN_OVERLAP_M2, `worst surviving dash x furniture overlap ${worst} m2`);
  let crossSegs = 0;
  for (const strip of r.dashStrips) {
    for (let k = 0; k + 1 < strip.length; k++) {
      const a = strip[k], c = strip[k + 1];
      const ax = (a.hx + a.lx) / 2, az = (a.hz + a.lz) / 2, bx = (c.hx + c.lx) / 2, bz = (c.hz + c.lz) / 2;
      const seen = new Set();
      for (let gx = Math.floor(Math.min(ax, bx) / CELL); gx <= Math.floor(Math.max(ax, bx) / CELL); gx++)
        for (let gz = Math.floor(Math.min(az, bz) / CELL); gz <= Math.floor(Math.max(az, bz) / CELL); gz++)
          for (const i of grid.get(`${gx},${gz}`) || []) {
            if (seen.has(i)) continue; seen.add(i);
            if (segCrossesPoly(ax, az, bx, bz, furnPolys[i])) crossSegs++;
          }
    }
  }
  assert.equal(crossSegs, 0, `strip segments crossing furniture (${crossSegs})`);
});

test('roundabout occluders (issue #173): helper clips wedge greens to the disc', async () => {
  const { roundaboutDashOccluders, ringPoints } = await import('../js/taipei-junctions.js');
  // Square disc 100x100 centred on the origin; a green square
  // straddling its east rim (x 30..70, z -10..10).
  const site = {
    island: { ring: [-10, -10, 10, -10, 10, 10, -10, 10] },
    aprons: [],
    disc: { ring: [-50, -50, 50, -50, 50, 50, -50, 50] },
  };
  const green = [[30, -10], [70, -10], [70, 10], [30, 10]];
  const occ = roundaboutDashOccluders([site], [green]);
  assert.equal(occ.length, 2, 'island + one wedge piece');
  const wedge = occ[1];
  for (const p of wedge) assert.ok(p[0] <= 50.01, `wedge point ${p} stays inside the disc`);
  const area = Math.abs(wedge.reduce((s, p, i, a) => s + p[0] * a[(i + 1) % a.length][1] - a[(i + 1) % a.length][0] * p[1], 0) / 2);
  assert.ok(Math.abs(area - 400) < 1, `wedge piece is the in-disc half of the green (${area} m² of 800)`);
  assert.deepEqual(ringPoints(site.island.ring).length, 4, 'ringPoints sanity');
});

test('roundabout occluders (issue #173): no dash overlaps an island or apron on the real tile', async () => {
  const { planRoundabouts, ringPoints } = await import('../js/taipei-junctions.js');
  const beds = TAIPEI_GEO.roadbeds;
  const r = buildRoadMarkings(beds);
  const sites = planRoundabouts(beds, r.junctions);
  assert.equal(sites.length, 3, 'the three roundabout sites');
  const clipArea = (subject, clip) => {
    let area = 0;
    const signed = (p) => p.reduce((s, pt, i, a) => s + pt[0] * a[(i + 1) % a.length][1] - a[(i + 1) % a.length][0] * pt[1], 0) / 2;
    let cl = signed(clip) < 0 ? [...clip].reverse() : clip;
    let out = subject;
    for (let i = 0; i < cl.length; i++) {
      const A = cl[i], B = cl[(i + 1) % cl.length];
      const inp = out; out = [];
      if (!inp.length) break;
      const cross = (p) => (B[0] - A[0]) * (p[1] - A[1]) - (B[1] - A[1]) * (p[0] - A[0]);
      for (let j = 0; j < inp.length; j++) {
        const cur = inp[j], prv = inp[(j + inp.length - 1) % inp.length];
        const cc = cross(cur), pc = cross(prv);
        const inter = () => { const t = pc / (pc - cc); return [prv[0] + (cur[0] - prv[0]) * t, prv[1] + (cur[1] - prv[1]) * t]; };
        if (cc >= -1e-9) { if (pc < -1e-9) out.push(inter()); out.push(cur); }
        else if (pc >= -1e-9) out.push(inter());
      }
    }
    return Math.abs(signed(out));
  };
  for (const s of sites) {
    const polys = [ringPoints(s.island.ring), ...s.aprons.map((a) => ringPoints(a.ring))];
    let bad = 0;
    for (const q of r.dashes) {
      const c = quadCentre(q);
      if (Math.hypot(c[0] - s.x, c[1] - s.z) > s.discR + 20) continue;
      const qp = [[q[0], q[1]], [q[2], q[3]], [q[4], q[5]], [q[6], q[7]]];
      if (polys.some((p) => clipArea(qp, p) > 0.02)) bad++;
    }
    assert.equal(bad, 0, `${s.id}: dashes overlapping island/aprons`);
  }
});
