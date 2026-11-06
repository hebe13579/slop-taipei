// Issue #221 enforcement: procedural school campuses.
//
// The generator (planSchoolCampuses in js/taipei-buildings.js)
// turns every OSM education ground in geodata.schools into a
// campus — red track or courts, classroom slabs, concrete fence,
// gate, trees — seeded by the ground's OSM id, in the
// site-structures idiom. These audits pin the issue's acceptance
// terms: (a) the geodata carries the layer, (b) the census
// decomposition closes (generated + skipped-with-reason = every
// ground), (c) the three #166 handcrafted campuses are skipped as
// registry grounds, (d) a fully-built ground with no track-scale
// sports surface (NTUT) grows no fictional track while a ground
// with a mapped track keeps one, (e) NO procedural lot stands on
// campus land, (f) generated parts stay on their own ground, and
// (g) generation is deterministic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { planTaipeiBuildings } from '../js/taipei-buildings.js';

const plan = planTaipeiBuildings(TAIPEI_GEO);
const report = plan.schools || [];
const campuses = (plan.siteStructures || []).filter((s) => s.school);

const inRing = (ring, x, z) => {
  let c = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i], zi = ring[i + 1], xj = ring[j], zj = ring[j + 1];
    if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) c = !c;
  }
  return c;
};
const distToRing = (ring, x, z) => {
  let best = Infinity;
  for (let i = 0; i + 1 < ring.length; i += 2) {
    const ax = ring[i], az = ring[i + 1];
    const bx = ring[(i + 2) % ring.length], bz = ring[(i + 3) % ring.length];
    const dx = bx - ax, dz = bz - az;
    const L2 = dx * dx + dz * dz || 1;
    let t = ((x - ax) * dx + (z - az) * dz) / L2;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(ax + t * dx - x, az + t * dz - z));
  }
  return best;
};
const bboxOf = (ring) => {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i + 1 < ring.length; i += 2) {
    if (ring[i] < minX) minX = ring[i];
    if (ring[i] > maxX) maxX = ring[i];
    if (ring[i + 1] < minZ) minZ = ring[i + 1];
    if (ring[i + 1] > maxZ) maxZ = ring[i + 1];
  }
  return { minX, maxX, minZ, maxZ };
};
// Main piece ring per OSM element (the piece the generator used).
const mainRingByKey = new Map();
for (const s of TAIPEI_GEO.schools || []) {
  const k = `${s.osmType}/${s.osmId}`;
  const cur = mainRingByKey.get(k);
  if (!cur || s.area > cur.area) mainRingByKey.set(k, s);
}

test('geodata carries the schools layer (issue #221)', () => {
  const pieces = TAIPEI_GEO.schools;
  assert.ok(Array.isArray(pieces), 'TAIPEI_GEO.schools emitted by the geodata builder');
  assert.equal(pieces.length, 300, 'clipped ground pieces in tile (246 on the pre-#258 main; +54 in the #258 south expansion — NTU, Shida, Gongguan/Guting/Yonghe grounds in box 7-south + the Box A west strip)');
  for (const p of pieces) {
    assert.ok(p.osmId && p.kind && Array.isArray(p.ring) && p.ring.length >= 8, 'piece shape');
    assert.ok(p.area >= 100, 'builder drops sub-100 m² pieces');
  }
  assert.equal(mainRingByKey.size, 255, 'distinct OSM education grounds in tile (218 on the pre-#258 main; +37 grounds in the #258 south expansion)');
});

test('census decomposition closes: generated + skipped-with-reason = every ground', () => {
  assert.equal(report.length, 255, 'one report row per ground');
  const generated = report.filter((r) => !r.skip);
  const skipped = report.filter((r) => r.skip);
  assert.equal(generated.length, 226); // 196 on the pre-#258 main; +30 of the 37 new grounds generate (NTU + Shida Heping are registry-skipped; the other 5 new skipped grounds are no-fit/building-footprint-scale/subsumed)
  assert.equal(skipped.length, 29); // 22 on the pre-#258 main; +7 (NTU + Shida Heping as registry campuses, +5 new no-fit/building-footprint-scale grounds, −1 subsumed that flipped to no-fit when the NTU/Shida kit campuses were suppressed)
  assert.equal(generated.length + skipped.length, report.length, 'no ground unaccounted');
  for (const r of skipped) assert.ok(typeof r.skip === 'string' && r.skip.length > 4, `skip reason recorded for ${r.key}`);
  assert.equal(campuses.length, generated.length, 'one site structure per generated campus');
  const reasons = {};
  for (const r of skipped) reasons[r.skip.split(' (')[0].split(' by ')[0]] = (reasons[r.skip.split(' (')[0].split(' by ')[0]] || 0) + 1;
  assert.deepEqual(reasons, { 'registry campus': 5, 'no-fit': 10, subsumed: 1, 'building-footprint-scale': 13 });
});

test('the #258 handcrafted campuses are skipped as registry grounds', () => {
  for (const name of ['國立臺灣大學', '國立臺灣師範大學和平校區']) {
    const row = report.find((r) => r.name === name);
    assert.ok(row, `${name} is in the census`);
    assert.ok(row.skip && row.skip.startsWith('registry campus'), `${name} skipped as registry, got: ${row.skip}`);
  }
  assert.ok(!campuses.some((s) => ['國立臺灣大學', '國立臺灣師範大學和平校區'].includes(s.nameZh)), 'no generated structure duplicates a #258 registry campus');
  // NTNU Gongguan gets NO registry entry (only a 49 m sliver is in-tile, no campus buildings in it), so it still generates a kit campus.
  const gongguan = report.find((r) => r.name === '國立臺灣師範大學公館校區');
  assert.ok(gongguan && !gongguan.skip, 'NTNU Gongguan generates (no registry entry by design)');
});

test('the #166 handcrafted campuses are skipped as registry grounds', () => {
  for (const name of ['建國中學', '石牌國中', '清江國小']) {
    const row = report.find((r) => r.name === name);
    assert.ok(row, `${name} is in the census`);
    assert.ok(row.skip && row.skip.startsWith('registry campus'), `${name} skipped as registry, got: ${row.skip}`);
  }
  assert.ok(!campuses.some((s) => ['建國中學', '石牌國中', '清江國小'].includes(s.nameZh)), 'no generated structure duplicates a registry campus');
});

test('content join arbitrates the track: NTUT grows none, a mapped track is kept', () => {
  const ntut = report.find((r) => r.osmType === 'relation' && r.osmId === 4790876);
  assert.ok(ntut, 'NTUT in the census');
  assert.ok(ntut.stats && ntut.stats.buildings >= 10 && !ntut.stats.hasTrack && (ntut.stats.largestPitchM2 || 0) < 3000,
    `NTUT reads dense-built in the data (got ${JSON.stringify(ntut.stats)})`);
  assert.equal(ntut.trackClass, null, 'NTUT gets no running track');
  assert.ok(ntut.archetype && ntut.archetype.includes('dense'), `NTUT archetype is the dense-built one (got ${ntut.archetype})`);
  const shida = report.find((r) => r.osmType === 'relation' && r.osmId === 4730350);
  assert.ok(shida && shida.stats && shida.stats.hasTrack, '師大附中 carries a mapped track');
  assert.ok(shida.trackClass, '師大附中 keeps a track class');
  const trackParts = campuses.find((s) => s.school.key === 'relation/4730350').parts
    .filter((p) => p.flat === 0xa04a30);
  assert.ok(trackParts.length >= 3, 'the kept track renders (capsule box + end caps)');
});

test('no procedural lot stands on campus land', () => {
  const pieces = (TAIPEI_GEO.schools || []).map((s) => ({ ring: s.ring, bb: bboxOf(s.ring) }));
  const lotCorners = (lot) => {
    if (lot.rot === undefined) {
      return [[lot.x - lot.w / 2, lot.z - lot.d / 2], [lot.x + lot.w / 2, lot.z - lot.d / 2],
              [lot.x + lot.w / 2, lot.z + lot.d / 2], [lot.x - lot.w / 2, lot.z + lot.d / 2]];
    }
    const c = Math.cos(lot.rot), s = Math.sin(lot.rot), hw = lot.w / 2, hd = lot.d / 2;
    return [
      [lot.x + hw * c - hd * s, lot.z + hw * s + hd * c],
      [lot.x + hw * c + hd * s, lot.z + hw * s - hd * c],
      [lot.x - hw * c + hd * s, lot.z - hw * s - hd * c],
      [lot.x - hw * c - hd * s, lot.z - hw * s + hd * c],
    ];
  };
  let violations = 0;
  for (const lot of plan.lots) {
    const pts = [[lot.x, lot.z], ...lotCorners(lot)];
    const reach = Math.hypot(lot.w, lot.d) / 2 + 1;
    for (const p of pieces) {
      if (lot.x < p.bb.minX - reach || lot.x > p.bb.maxX + reach || lot.z < p.bb.minZ - reach || lot.z > p.bb.maxZ + reach) continue;
      // A point counts only when it is inside AND more than the
      // emitted-plan rounding slop (0.2 m) from the boundary —
      // the planner's own corner guard works at full precision
      // with a 0.08 m clearance (issue #102's epsilon rule).
      if (pts.some(([x, z]) => inRing(p.ring, x, z) && distToRing(p.ring, x, z) > 0.2)) { violations++; break; }
    }
  }
  assert.equal(violations, 0, 'zero lots (centre or corner) inside any school ground');
  assert.ok(plan.stats.blocksSkippedSchool > 0 && plan.stats.lotsDroppedSchool > 0,
    'the school exclusion verdicts actually fired');
});

test('generated parts stay on their own ground; every campus has fence + slabs', () => {
  const FENCE = 0xd8d4c8, TRACK_RED = 0xa04a30;
  for (const s of campuses) {
    const main = mainRingByKey.get(s.school.key);
    assert.ok(main, `main ring for ${s.school.key}`);
    let fence = 0, slabs = 0;
    for (const p of s.parts) {
      if (p.flat === FENCE) fence++;
      if (p.type === 'box' && p.flat === undefined && p.h >= 7) slabs++;
      const audited = (p.type === 'box' && p.flat === undefined && p.h >= 7) || p.flat === TRACK_RED ||
        p.flat === 0x3f6d8e || p.flat === 0x3f7d6b;
      if (audited) {
        const x = s.x + (p.dx || 0), z = s.z + (p.dz || 0);
        assert.ok(inRing(main.ring, x, z), `${s.school.key}: part centre on its ground (${x}, ${z})`);
      }
    }
    assert.ok(fence >= 4, `${s.school.key}: perimeter fence present (${fence} segments)`);
    assert.ok(slabs >= 1, `${s.school.key}: at least one classroom slab`);
  }
});

test('generation is deterministic and the plan counts are pinned', () => {
  const again = planTaipeiBuildings(TAIPEI_GEO);
  assert.equal(JSON.stringify(again.siteStructures.filter((s) => s.school)),
    JSON.stringify(campuses), 'same geodata, same campuses, byte for byte');
  // Issue #258: plan 68,472 -> 76,367 (+7,895) — the south expansion adds 1,356 blocks (7-south + Box A west strip). Lot diff vs main (proven by cross-run): identical 67,450, changed 632, missing 390, added 8,285 (south 6,972 + west strip 922 + old-interior 234 + seam 157). The old-interior delta (changed 433 + missing 235 + added 234 = 902 lots, 1.3%) is the justified seam-road boundary effect: the seam roads extend south, so their roadbeds were re-merged, which legitimately changes frontage angles along those roads; heights are preserved (only 59 height-only changes).
  // Issue #278: plan 76,367 -> 76,209 (-158 net) — the 3 new registry sites exclude 160 lots (153 by body-overlap in the rects, 5 edge drops just outside them, 2 re-seats net 0) and add 2 re-seats; 84 lots change height via the #128 field blend, all within 100 m of a rect (lot-by-lot diff on this tree).
  assert.equal(plan.lots.length, 76260); // re-pinned for #326: 76,209 -> 76,260 (+51 net: 127 added, 76 removed — lot diff in ntsec326-evidence/lotdiff326.log)
  assert.equal(plan.stats.blocksSkippedSchool, 292);
  // Issue #258: lotsDroppedSchool 3,327 -> 4,267 (+940) — the 37 new south grounds exclude their campus lots.
  // Issue #326: lotsDroppedSchool 4,267 -> 4,255 (−12) — the re-site frees lots the old (wrong) rects excluded, so 12 fewer lots are dropped on school land; measured on this tree.
  assert.equal(plan.stats.lotsDroppedSchool, 4255);
  assert.equal(plan.stats.lotsDroppedSchool, 4255);
});
