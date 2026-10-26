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
  // Re-pinned for issue #102 (northern phase 1): the added boxes
  // take roadbeds 5,708 -> 11,804; the northern network is
  // lane-heavy (Shilin/Beitou residential + foothill lanes) with a
  // thick elevated layer — deck 141 -> 181, arterial 612 -> 905,
  // collector 579 -> 899, lane 4,376 -> 9,819. Per-box census in
  // the #102 evidence.
  // Re-pinned for issue #134: the airport box + corridor strip
  // take roadbeds 11,804 -> 13,578 — deck 181 -> 207 (the
  // riverside expressway system), arterial 905 -> 1,130,
  // collector 899 -> 1,015, lane 9,819 -> 11,226.
  assert.deepEqual(counts, { deck: 207, arterial: 1130, collector: 1015, lane: 11226 });
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
  // Re-pinned for issue #102 (northern phase 1): the corridor's
  // divided boulevards （承德路, 中山北路五段 on, 大度路） take
  // planted 96 -> 152 and plain 251 -> 397 (rendered 22.4 planted
  // km / 72.3 plain km); excludedUnderpass stays 3 — the northern
  // boxes add no wide underpass beds （自強隧道 sits east of the
  // corridor edge, outside the tile).
  // Re-pinned for issue #134: the airport box's divided grid
  // （敦化北路， 民權東路， 民族東路） and the strip's 重慶北路 take
  // planted 152 -> 195 and plain 397 -> 464 (rendered 30.7 planted
  // km / 87.6 plain km — the km bands below move with them);
  // excludedUnderpass 3 -> 4: the 復北地下道 (secondary, 16.2 m,
  // inside the airport box) joins the 象山隧道 x3.
  assert.equal(planted, 195);
  assert.equal(plain, 464);
  const { stats } = buildMedianStrips(TAIPEI_GEO.roadbeds);
  assert.equal(stats.plantedBeds, 195);
  assert.equal(stats.plainBeds, 464);
  assert.equal(stats.excludedUnderpass, 4); // 象山隧道 x3 + 復北地下道
  assert.ok(stats.plantedKm > 28 && stats.plantedKm < 36, `planted rendered ${stats.plantedKm} km`);
  assert.ok(stats.plainKm > 85 && stats.plainKm < 95, `plain rendered ${stats.plainKm} km`);
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
  assert.equal(plazas.length, 24); // pinned on post-#30 data; re-pinned 2026-10-24 (issue #60: +中山堂/行旅/西本願寺/北門 and other west-side 廣場); re-pinned for issue #102 (+6 measured against the baseline list: 北投3號廣場, 青春82廣場, 微風廣場, 關渡自然公園 x2 賞鳥廣場, and a second 大同16號廣場 piece); re-pinned for issue #134 (+1: a second 厚生廣場 piece on the west bank, recovered by the extractor's two-pass relation stitch — the plaza stands in the corridor's new west strip)
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

// ---------------------------------------------------------------------
// Issue #173 (MEDTIP class): median strips terminate at junction
// surfaces with the painted bands' discipline — the cap test probes
// centre + both edges per frame (and the interval mid-edges), not
// the centre point alone.

test('medtip (issue #173): a median corner may not enter a cap the centre clears', () => {
  // A divided boulevard running east; the cap square starts at
  // x=80 and covers the strip's north edge line (strip half is
  // 1.2 m; the square spans z in [-3, 0.6]) — the strip's centre
  // stays clear of it, its north corner does not. With the old
  // centre-only cap test the strip dragged quads across the
  // square; with edge parity it ends before it.
  const blvd = bed('仁愛路四段', 'secondary', 30, [1, 2], [-100, 0, 100, 0]);
  const cap = [[80, -3], [130, -3], [130, -0.9], [80, -0.9]];
  const { planted } = buildMedianStrips([blvd], [cap]);
  assert.ok(planted.length > 0, 'the strip still runs west of the cap');
  const signed = (p) => p.reduce((s, pt, i, a) => s + pt[0] * a[(i + 1) % a.length][1] - a[(i + 1) % a.length][0] * pt[1], 0) / 2;
  const clipArea = (subject, clip) => {
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
  for (const q of planted) {
    const qp = [[q[0], q[1]], [q[2], q[3]], [q[4], q[5]], [q[6], q[7]]];
    assert.ok(clipArea(qp, cap) < 0.02, `median quad ${q} overlaps the cap`);
  }
});

test('medtip (issue #173): boot-path census — median overlap of junction surfaces is ~zero', async () => {
  const { detectJunctions } = await import('../js/taipei-markings.js');
  const { planJunctionCaps, planRoundabouts, ringPoints, capSurfacePolys, capClipPolys } = await import('../js/taipei-junctions.js');
  const beds = TAIPEI_GEO.roadbeds;
  const junctions = detectJunctions(beds);
  const sites = planRoundabouts(beds, junctions);
  const caps = planJunctionCaps(beds, junctions, sites, capClipPolys(TAIPEI_GEO));
  const capPolys = [...caps.flatMap((c) => capSurfacePolys(c)), ...sites.flatMap((s) => [s.disc, ...s.aprons]).map((c) => ringPoints(c.ring))];
  const { planted, plain, stats } = buildMedianStrips(beds, capPolys);
  // Before #173 this wiring measured 86 quads / 26.2 m² of median
  // over junction surfaces; the edge-parity cap test leaves at
  // most a sub-0.05 m² graze.
  const { buildPolyGrid, pointInAnyPoly } = await import('../js/taipei-painted.js');
  const grid = buildPolyGrid(capPolys, 60);
  let cornersIn = 0;
  for (const q of [...planted, ...plain]) {
    for (let i = 0; i < 8; i += 2) if (pointInAnyPoly(grid, capPolys, [q[i], q[i + 1]])) cornersIn++;
  }
  assert.equal(cornersIn, 0, 'no median quad corner inside a junction surface');
  assert.ok(stats.plantedKm > 28 && stats.plantedKm < 29, `planted ${stats.plantedKm} km on the boot path`);
  assert.ok(stats.plainKm > 81 && stats.plainKm < 82, `plain ${stats.plainKm} km on the boot path`);
});
