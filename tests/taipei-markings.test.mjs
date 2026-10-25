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
  // 1,136 -> 2,707 across the S band, corridor, Beitou and the
  // connector, but the north signalizes sparsely (Shilin/Beitou
  // arterials, long rural stretches) — signalized 241 -> 393.
  assert.ok(r.stats.signalized >= 120 && r.stats.signalized <= 450, `signalized ${r.stats.signalized}`);
  // Census pin (PR #72 rebase, 2026-10-24, on PR #70's data): the
  // expanded map's signalized count is exactly 241.
  // Re-pinned for issue #102: exactly 393 (per-box census in the
  // #102 evidence: A 234, S 47, corridor 93, Beitou 18, connector 1).
  assert.equal(r.stats.signalized, 393, `signalized census ${r.stats.signalized}`);
  assert.ok(r.stats.dividerKm > 50, `divider km ${r.stats.dividerKm}`);
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
  // junctions 241 -> 393 on the enlarged tile take units 1,091 ->
  // 1,703 (mast 359 -> 584, pole 732 -> 1,119); the northern
  // elevated network's deck arms at signalized junctions take
  // deckArmsSkipped 71 -> 144. The 0-inside invariant and the
  // mast<->divided audit below are unchanged and pass tile-wide.
  assert.equal(r.stats.signalMast + r.stats.signalPole, r.stats.signalUnits);
  assert.equal(r.stats.signalUnits, 1703, `signal units ${r.stats.signalUnits}`);
  assert.equal(r.stats.signalMast, 584, `mast units ${r.stats.signalMast}`);
  assert.equal(r.stats.signalPole, 1119, `pole units ${r.stats.signalPole}`);
  assert.equal(r.stats.deckArmsSkipped, 144, `deck arms skipped ${r.stats.deckArmsSkipped}`);
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
