import assert from 'node:assert/strict';
import test from 'node:test';

import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { ribbonPoly, pointInPoly } from '../js/taipei-painted.js';
import { medianStripWidth } from '../js/taipei-surfaces.js';
import * as markings from '../js/taipei-markings.js';
import {
  LANE_W, DASH_LEN, DASH_GAP, DIVIDER_W,
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
  assert.ok(r.stats.signalized >= 120 && r.stats.signalized <= 200, `signalized ${r.stats.signalized}`);
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
