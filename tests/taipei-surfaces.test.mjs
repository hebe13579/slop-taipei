import assert from 'node:assert/strict';
import test from 'node:test';

import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { ribbonPoly, pointInPoly } from '../js/taipei-painted.js';
import {
  SURFACE_TONES,
  surfaceClass,
  UNDERPASS_NAME,
  isUnderpassName,
  medianKind,
  medianStripWidth,
  buildMedianStrips,
  isPlazaPark,
  isPodiumBlock,
  podiumCentresOf,
} from '../js/taipei-surfaces.js';

// Issue #29 — road surface treatment. The rules live in
// js/taipei-surfaces.js (pure) so these tests pin the exact code the
// renderer draws with: palette tones, per-class classification, the
// median rule WITH the user's underpass exclusion, junction clipping,
// and the plaza/podium ground splits — on synthetic beds and on the
// real generated tile.

const bed = (name, highway, width, ways = [1], pts = [0, 0, 100, 0]) => ({
  name, highway, width, pedestrianLayout: 'sidewalk', pts, sourceWayIds: ways,
});

test('palette tones are the shipped issue #29 values', () => {
  assert.equal(SURFACE_TONES.deck, 0x2e3238);
  assert.equal(SURFACE_TONES.arterial, 0x33363b); // unchanged baseline
  assert.equal(SURFACE_TONES.collector, 0x383b40);
  assert.equal(SURFACE_TONES.lane, 0x4a4741);
  assert.equal(SURFACE_TONES.medianPlanted, 0x4c5c33);
  assert.equal(SURFACE_TONES.medianPlain, 0x8a867c);
  assert.equal(SURFACE_TONES.plaza, 0xa39d8f);
  assert.equal(SURFACE_TONES.podium, 0x99948a);
});

test('surfaceClass keys tones by road class', () => {
  assert.equal(surfaceClass(bed('x', 'trunk', 20)), 'deck');
  assert.equal(surfaceClass(bed('x', 'trunk_link', 10)), 'deck');
  assert.equal(surfaceClass(bed('x', 'primary', 30)), 'arterial');
  assert.equal(surfaceClass(bed('x', 'primary_link', 8)), 'arterial');
  assert.equal(surfaceClass(bed('x', 'secondary', 20)), 'arterial');
  assert.equal(surfaceClass(bed('x', 'secondary_link', 8)), 'arterial');
  assert.equal(surfaceClass(bed('x', 'tertiary', 14)), 'collector');
  assert.equal(surfaceClass(bed('x', 'tertiary_link', 8)), 'collector');
  for (const hw of ['residential', 'service', 'unclassified', 'living_street', 'busway', 'construction', 'track', '']) {
    assert.equal(surfaceClass(bed('x', hw, 6)), 'lane', hw);
  }
  assert.equal(surfaceClass({ pts: [0, 0, 1, 0] }), 'lane'); // no highway tag -> lane fabric
});

test('geodata: class populations cover every roadbed exactly once', () => {
  const counts = { deck: 0, arterial: 0, collector: 0, lane: 0 };
  for (const b of TAIPEI_GEO.roadbeds) counts[surfaceClass(b)]++;
  assert.equal(counts.deck + counts.arterial + counts.collector + counts.lane, TAIPEI_GEO.roadbeds.length);
  // Pinned from the regenerated evidence list (post-#51 data: five
  // duplicate 基隆路車行地下道 beds suppressed, one lane bed folded
  // into a merged group, one bed reclassed — see issue #51).
  // Re-pinned 2026-10-24 for the west-expansion data (issue #60):
  // roadbeds 4,387 -> 5,792 with the station district added.
  // Re-pinned for issue #74: the memorial-park service-drive
  // exclusion removed 22 lane-class beds inside 中正紀念公園
  // (5,792 -> 5,770 roadbeds), all other classes unchanged.
  // Re-pinned for issue #83: the exclusion generalized to every
  // park — 62 more lane-class (service) beds left the rendered
  // set (5,770 -> 5,708 roadbeds), all other classes unchanged.
  assert.deepEqual(counts, { deck: 141, arterial: 612, collector: 579, lane: 4376 });
});

test('medianKind: merged + width rule, planted only on wide secondary', () => {
  assert.equal(medianKind(bed('仁愛路四段', 'secondary', 30, [1, 2])), 'planted');
  assert.equal(medianKind(bed('仁愛路四段', 'secondary', 26, [1, 2])), 'planted');
  assert.equal(medianKind(bed('松山路', 'secondary', 25.9, [1, 2])), 'plain');
  assert.equal(medianKind(bed('忠孝東路四段', 'primary', 40, [1, 2])), 'plain'); // barrier in reality
  assert.equal(medianKind(bed('建國快速道路', 'trunk', 25.6, [1, 2])), 'plain'); // deck barrier; simple-boulevard treatment
  assert.equal(medianKind(bed('某三級路', 'tertiary', 20, [1, 2])), 'plain');
  assert.equal(medianKind(bed('narrow pair', 'secondary', 15.9, [1, 2])), null); // too tight
  assert.equal(medianKind(bed('unmerged', 'secondary', 30, [1])), null); // not a paired carriageway
  assert.equal(medianKind(bed('no ways', 'secondary', 30, undefined)), null);
  assert.equal(medianKind(null), null);
});

test('medianKind: underpass/tunnel names are EXCLUDED, never downgraded (user directive)', () => {
  // The research false positive: 34.3 m merged secondary — would be
  // 'planted' without the exclusion.
  assert.equal(medianKind(bed('辛亥路車行地下道', 'secondary', 34.3, [1, 2])), null);
  assert.equal(medianKind(bed('基隆路車行地下道', 'secondary', 20, [1, 2])), null);
  assert.equal(medianKind(bed('象山隧道', 'trunk', 47, [1, 2])), null);
  assert.equal(medianKind(bed('文山隧道', 'trunk', 48.9, [1, 2])), null);
  assert.equal(medianKind(bed('某地下道', 'primary', 30, [1, 2])), null);
  assert.ok(UNDERPASS_NAME.test('車行地下道'));
  assert.ok(isUnderpassName('辛亥路車行地下道'));
  assert.ok(!isUnderpassName('辛亥路二段'));
  assert.ok(!isUnderpassName(''));
  assert.ok(!isUnderpassName(undefined));
});

test('geodata: no median on any underpass-named bed in the real tile', () => {
  const named = TAIPEI_GEO.roadbeds.filter((b) => isUnderpassName(b.name));
  assert.ok(named.length > 0, 'the tile does contain underpass/tunnel beds');
  for (const b of named) assert.equal(medianKind(b), null, `${b.name} must not get a median`);
  // Issue #51 history: the 辛亥路車行地下道 pair folded into the parent
  // road's merged bed by family pairing. Since the west expansion
  // (issue #60) the whole 辛亥路 corridor sits in the dropped south
  // band (lat < 25.0285) and is no longer in the tile, so the #51
  // way-level assertion went with it; the exclusion above now guards
  // the remaining underpass/tunnel-named beds （基隆路車行地下道
  // singles, 林森南路車行地下道, 忠孝西路地下道, 象山隧道).
});

test('geodata: median bed counts match the regenerated evidence list', () => {
  let planted = 0, plain = 0;
  for (const b of TAIPEI_GEO.roadbeds) {
    const k = medianKind(b);
    if (k === 'planted') planted++;
    if (k === 'plain') plain++;
  }
  // Re-pinned 2026-10-24 for the west-expansion data (issue #60):
  // the station district's boulevards (忠孝西路, 中山北路, 館前路…)
  // take planted 72 -> 96 and plain 164 -> 251; excludedUnderpass
  // counts only beds wide/merged enough to otherwise earn a median:
  // 象山隧道 x3 now (文山隧道 left with the dropped south band).
  assert.equal(planted, 96);
  assert.equal(plain, 251);
  const { stats } = buildMedianStrips(TAIPEI_GEO.roadbeds);
  assert.equal(stats.plantedBeds, 96);
  assert.equal(stats.plainBeds, 251);
  assert.equal(stats.excludedUnderpass, 3); // 象山隧道 x3
  assert.ok(stats.plantedKm > 8 && stats.plantedKm < 13, `planted rendered ${stats.plantedKm} km`);
  assert.ok(stats.plainKm > 30 && stats.plainKm < 48, `plain rendered ${stats.plainKm} km`);
});

test('medianStripWidth clamps to 1.2–3.5 m at 8% of bed width', () => {
  assert.equal(medianStripWidth(bed('x', 'secondary', 30, [1, 2])), 2.4);
  assert.equal(medianStripWidth(bed('x', 'secondary', 100, [1, 2])), 3.5);
  assert.equal(medianStripWidth(bed('x', 'secondary', 10, [1, 2])), 1.2);
});

const quadCentre = (q) => [(q[0] + q[2] + q[4] + q[6]) / 4, (q[1] + q[3] + q[5] + q[7]) / 4];

test('median strips stop at a real junction (no divider across the crossing box)', () => {
  const ew = bed('EW Blvd', 'secondary', 30, [1, 2], [-100, 0, 100, 0]);
  const ns = bed('NS Ave', 'primary', 30, [3, 4], [0, -100, 0, 100]);
  const { planted, plain } = buildMedianStrips([ew, ns]);
  assert.ok(planted.length > 0, 'the boulevard keeps its planted strip mid-block');
  assert.ok(plain.length > 0, 'the primary keeps its plain strip mid-block');
  const nsPoly = ribbonPoly(ns), ewPoly = ribbonPoly(ew);
  for (const q of planted) assert.ok(!pointInPoly(quadCentre(q), nsPoly), `planted quad centre ${quadCentre(q)} inside the crossing avenue`);
  for (const q of plain) assert.ok(!pointInPoly(quadCentre(q), ewPoly), `plain quad centre ${quadCentre(q)} inside the crossing boulevard`);
  // …and both strips resume on the far side of the junction.
  assert.ok(planted.some((q) => quadCentre(q)[0] > 25), 'planted strip resumes east of the junction');
  assert.ok(plain.some((q) => quadCentre(q)[1] > 25), 'plain strip resumes south of the junction');
});

test('a narrow lane mouth does not break a median strip', () => {
  const blvd = bed('Blvd', 'secondary', 30, [1, 2], [-100, 0, 100, 0]);
  const lane = bed('Lane', 'service', 3.2, [3], [0, -50, 0, 50]);
  const { planted } = buildMedianStrips([blvd, lane]);
  // Coverage along x must be gapless across the lane mouth at x = 0.
  const intervals = planted
    .map((q) => [Math.min(q[0], q[2], q[4], q[6]), Math.max(q[0], q[2], q[4], q[6])])
    .sort((a, b) => a[0] - b[0]);
  let covered = -100;
  for (const [lo, hi] of intervals) {
    if (lo > covered + 0.01) break;
    covered = Math.max(covered, hi);
    if (covered >= 5) break;
  }
  assert.ok(covered >= 5, `strip coverage across the lane mouth reaches x=${covered}, expected past 5`);
});

test('an underpass bed emits no strip quads at all', () => {
  const up = bed('辛亥路車行地下道', 'secondary', 34.3, [1, 2], [-100, 500, 100, 500]);
  const { planted, plain, stats } = buildMedianStrips([up]);
  assert.equal(planted.length + plain.length, 0);
  assert.equal(stats.excludedUnderpass, 1);
});

test('plaza classification: 廣場 polygons are paving, real parks stay green', () => {
  const plazas = TAIPEI_GEO.parks.filter(isPlazaPark);
  const greens = TAIPEI_GEO.parks.filter((p) => !isPlazaPark(p));
  assert.equal(plazas.length + greens.length, TAIPEI_GEO.parks.length);
  assert.equal(plazas.length, 17); // pinned on post-#30 data; re-pinned 2026-10-24 (issue #60: +中山堂/行旅/西本願寺/北門 and other west-side 廣場)
  for (const name of ['台北市民廣場', '松壽廣場', '台北世貿廣場', '信義21號廣場', '忠信廣場']) {
    assert.ok(plazas.some((p) => p.name === name), `${name} classified as plaza paving`);
  }
  const daan = TAIPEI_GEO.parks.find((p) => (p.name || '').includes('大安森林公園'));
  assert.ok(daan, '大安森林公園 exists in the park data');
  assert.ok(!isPlazaPark(daan), '大安森林公園 stays a green park');
  assert.ok(!isPlazaPark({ name: null, ring: [] }));
  assert.ok(!isPlazaPark({ ring: [] }));
});

test('podium blocks: exactly the 101 and City Hall blocks, by landmark-centre containment', () => {
  const centres = podiumCentresOf(TAIPEI_GEO);
  assert.equal(centres.length, 2);
  const podium = TAIPEI_GEO.blocks.filter((b) => isPodiumBlock(b, centres));
  assert.equal(podium.length, 2);
  const t101 = TAIPEI_GEO.landmarks['Taipei 101'];
  const gov = TAIPEI_GEO.landmarks['Taipei City Government'];
  assert.ok(podium.some((b) => isPodiumBlock(b, [t101])), 'the 101 block is podium');
  assert.ok(podium.some((b) => isPodiumBlock(b, [gov])), 'the City Hall block is podium');
  assert.ok(podium[0] !== podium[1]);
  // Far-corner finder re-based for the union footprint (issue #60):
  // the old tile reached z > 1000 in the south band; the union's far
  // corner from both centres is the north-west (station district).
  const far = TAIPEI_GEO.blocks.find((b) => b.bbox.maxX < -4000 && b.bbox.minZ < -2000);
  assert.ok(far && !isPodiumBlock(far, centres), 'a far corner block is not podium');
  assert.ok(!isPodiumBlock(TAIPEI_GEO.blocks[0], []), 'no centres -> no podium');
});
