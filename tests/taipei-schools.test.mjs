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
import { drapeHeight } from '../js/taipei-drape.js';

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

test('issue #328: the two registry campuses have perimeter fences; Qingjiang track is an oval capsule', () => {
  const FENCE = 0xd8d4c8, GATE = 0xb9b2a2, GUARD = 0xcfc8b8, TRUNK = 0x6b4f35;
  const CANOPY = [0x4a7038, 0x557c40, 0x3d6335];
  const TRACK_RED = 0xa04a30, FIELD_GREEN = 0x4e7d32, COURT_BLUE = 0x3f6d8e;
  const towers = plan.landmarkTowers || [];
  const shipai = towers.find((s) => s.id === 'shipai-junior-high');
  const qingjiang = towers.find((s) => s.id === 'qingjiang-elementary');
  assert.ok(shipai, 'Shipai Junior High is a registry landmark');
  assert.ok(qingjiang, 'Qingjiang Elementary is a registry landmark');
  // Fences: the generator's schoolFenceParts output for each OSM ring,
  // precomputed (planSchoolCampuses with the registry skip lifted) and
  // pasted as static parts. Registry campuses are skipped by the
  // generator, so the fence was missing entirely on both. Counts are
  // exact — the fence is static data, not generated at boot.
  const fenceParts = (s) => s.parts.filter((p) => p.flat === FENCE || p.flat === GATE || p.flat === GUARD ||
    (p.type === 'cylinder' && p.flat === TRUNK) ||
    (p.type === 'dome' && CANOPY.includes(p.flat)));
  assert.equal(fenceParts(shipai).length, 45, 'Shipai fence: 14 walls + gate (3) + 28 tree parts');
  assert.equal(fenceParts(qingjiang).length, 44, 'Qingjiang fence: 12 walls + gate (3) + guard house (1) + 28 tree parts');
  for (const [s, name, osmId] of [[shipai, '石牌國中', 4630268], [qingjiang, '清江國小', 4793835]]) {
    const ring = (TAIPEI_GEO.schools || []).find((g) => g.osmId === osmId).ring;
    const walls = s.parts.filter((p) => p.flat === FENCE);
    assert.ok(walls.length >= 4, `${name}: perimeter fence present (${walls.length} segments)`);
    for (const w of walls) {
      const d = distToRing(ring, s.x + (w.dx || 0), s.z + (w.dz || 0));
      assert.ok(d < 1, `${name}: fence wall centre on the OSM ring (got ${d.toFixed(2)} m at ${w.dx}, ${w.dz})`);
    }
    assert.ok(s.parts.some((p) => p.flat === GATE && p.h === 0.8 && p.y0 === 3.2), `${name}: gate lintel present`);
  }
  // Qingjiang track: the 小操場 way (224826678) outlines the basketball
  // court, not the running track — the #166 build modelled it as two
  // flat rectangles (rust-red 36x30 over green 31x25). The real track
  // is the oval capsule below (box + two end cylinders, rust-red;
  // green infield the same), and the way's rectangle is a blue court slab.
  const capBox = qingjiang.parts.find((p) => p.type === 'box' && p.flat === TRACK_RED && p.w === 54 && p.d === 44);
  assert.ok(capBox, 'Qingjiang capsule straight section (54 x 44) present');
  assert.equal(capBox.dx, -62, 'capsule centre 62 m west of the anchor');
  assert.equal(capBox.dz, -1, 'capsule centre 1 m north of the anchor');
  assert.equal(capBox.rotY, -0.55, 'capsule axis -0.55 rad (NE-SW, the campus diagonal)');
  const capEnds = qingjiang.parts.filter((p) => p.type === 'cylinder' && p.flat === TRACK_RED);
  assert.equal(capEnds.length, 2, 'capsule has two rust-red end caps (oval, not a rectangle)');
  const fieldEnds = qingjiang.parts.filter((p) => p.type === 'cylinder' && p.flat === FIELD_GREEN);
  assert.equal(fieldEnds.length, 2, 'green infield has two end caps');
  const court = qingjiang.parts.find((p) => p.type === 'box' && p.flat === COURT_BLUE);
  assert.ok(court, 'basketball court is a blue slab');
  assert.equal(court.dx, 31.3, 'court at the OSM way footprint');
  assert.equal(court.dz, -3.3, 'court at the OSM way footprint');
  assert.ok(Math.abs(court.rotY - (-0.6)) < 0.001, `court rotation corrected to -0.6 (was +0.601), got ${court.rotY}`);
  // Shipai's track was already an oval capsule — it is untouched.
  const shipaiCaps = shipai.parts.filter((p) => p.type === 'cylinder' && p.flat === TRACK_RED);
  assert.equal(shipaiCaps.length, 2, 'Shipai track keeps its two end caps');
});

test('issue #334: Jianguo fence (red brick + iron bars), Honglou detail, statue', () => {
  const BRICK = 0x9c4a36, IRON = 0x232323, STONE = 0x9f988e, PLINTH = 0x1c4536, DARK = 0x2a2a2a;
  const towers = plan.landmarkTowers || [];
  const jianguo = towers.find((s) => s.id === 'jianguo-high-school');
  assert.ok(jianguo, 'Jianguo High School is a registry landmark');
  // Fence (#334): the generator's fence LINE (planSchoolCampuses with the
  // registry skip lifted, re-based to the anchor) in the school's real
  // FORM — red-brick base + vertical iron bars — generated by
  // jianguoFenceParts() from 26 segments. Where a roadbed crosses the
  // OSM ring (four unnamed 5 m driveways/entrances cut across the
  // boundary; the ring itself sits inside the roadbed there, worst
  // 2.44 m), the fence leaves a gap — a gate opening — instead of
  // stepping back into the road's path. One long north stretch runs
  // parallel-close to the road and is stepped back 1.4 m.
  // 26 bases + 26 rails + 3402 bars + 127 piers (25 ring joints + 102
  // intermediate, each a pier + a cap) = 3708 fence parts.
  const bases = jianguo.parts.filter((p) => p.type === 'box' && p.flat === BRICK && p.h === 1.0 && p.d === 0.35);
  assert.equal(bases.length, 26, 'fence has 26 brick bases (22 generator walls, 1 stepped back, 5 road crossings + 1 corner left as gaps)');
  const bars = jianguo.parts.filter((p) => p.type === 'box' && p.flat === IRON && p.h === 1.1 && p.w === 0.06);
  assert.equal(bars.length, 3402, 'fence has 3402 vertical iron bars (every 0.3 m along the fence)');
  const rails = jianguo.parts.filter((p) => p.type === 'box' && p.flat === IRON && p.h === 0.08 && p.d === 0.1 && p.w !== 4.5);
  assert.equal(rails.length, 26, 'fence has 26 top rails');
  const piers = jianguo.parts.filter((p) => p.type === 'box' && p.flat === BRICK && p.h === 2.3 && p.w === 0.6);
  assert.equal(piers.length, 127, 'fence has 127 brick piers (25 joints + 102 intermediate)');
  const caps = jianguo.parts.filter((p) => p.type === 'box' && p.flat === STONE && p.h === 0.12 && p.w === 0.75);
  assert.equal(caps.length, 127, 'every pier has a stone cap');
  // Every fence base centre sits on or just inside the OSM ring
  // (relation 3392608): on the ring where it can be, stepped back at
  // most 1.4 m (the one parallel-close north stretch; the road
  // crossings are gaps, not setbacks — see above).
  const ring = (TAIPEI_GEO.schools || []).find((g) => g.osmId === 3392608).ring;
  for (const b of bases) {
    const d = distToRing(ring, jianguo.x + (b.dx || 0), jianguo.z + (b.dz || 0));
    assert.ok(d < 2, `fence base on/near the OSM ring (got ${d.toFixed(2)} m at ${b.dx}, ${b.dz})`);
  }
  // Main gate: south edge, on the entrance axis from the roundabout.
  // Two tall brick piers + white flat canopy + two closed iron leaves.
  const gatePiers = jianguo.parts.filter((p) => p.type === 'box' && p.flat === BRICK && p.h === 3.4);
  assert.equal(gatePiers.length, 2, 'main gate has two tall brick piers');
  assert.ok(gatePiers.some((p) => p.dx === -25.2 && p.dz === 120.8), 'east gate pier at (-25.2, 120.8)');
  assert.ok(gatePiers.some((p) => p.dx === -34.8 && p.dz === 123.2), 'west gate pier at (-34.8, 123.2)');
  const canopy = jianguo.parts.find((p) => p.type === 'box' && p.flat === 0xf4f1ea && p.w === 12 && p.h === 0.3);
  assert.ok(canopy, 'white flat canopy over the gate');
  assert.equal(canopy.dx, -30, 'canopy centred on the gate (-30, 122)');
  assert.equal(canopy.dz, 122, 'canopy centred on the gate (-30, 122)');
  const leafBars = jianguo.parts.filter((p) => p.type === 'box' && p.flat === IRON && p.h === 2.0 && p.w === 0.06);
  assert.equal(leafBars.length, 20, 'two closed gate leaves, 10 vertical bars each');
  // The gate faces a road: nearest roadbed vertex within 15 m.
  let nearest = Infinity;
  for (const bed of TAIPEI_GEO.roadbeds || []) {
    const pts = bed.pts;
    for (let i = 0; i + 1 < pts.length; i += 2) {
      nearest = Math.min(nearest, Math.hypot(pts[i] - (jianguo.x - 30), pts[i + 1] - (jianguo.z + 122)));
    }
  }
  assert.ok(nearest < 15, `gate faces a road (nearest roadbed vertex ${nearest.toFixed(1)} m)`);
  // Honglou (#334): the towers flank the ~15 m central block at u = +/-14 m
  // (the old +/-40 m put them at the building's ends — wrong, per the 2018
  // close-up photo). The main box is kept; the flat roof slab is a pitched
  // ridge; the central gable, emblem, balcony and colonnade are new.
  const honglouTowers = jianguo.parts.filter((p) => p.type === 'box' && p.w === 13 && p.d === 19 && p.h === 16);
  assert.equal(honglouTowers.length, 2, 'Honglou has two guard towers');
  assert.ok(honglouTowers.some((p) => p.dx === -47.6 && p.dz === -51.9), 'west tower at u = -14 m');
  assert.ok(honglouTowers.some((p) => p.dx === -20.5 && p.dz === -59.2), 'east tower at u = +14 m');
  const gable = jianguo.parts.find((p) => p.type === 'ridge' && p.d === 15 && p.ridgeH === 3.4);
  assert.ok(gable, 'central gable (triangular pediment) present');
  assert.ok(Math.abs(gable.rotY - 1.309) < 0.001, `gable rotated 90 deg so its triangle faces south (got ${gable.rotY})`);
  const balcony = jianguo.parts.find((p) => p.type === 'box' && p.flat === STONE && p.w === 15 && p.h === 0.3 && p.y0 === 5.5);
  assert.ok(balcony, 'stone balustrade balcony across the central block');
  const balusters = jianguo.parts.filter((p) => p.type === 'box' && p.flat === 0xd9d4cb && p.h === 0.9 && p.w === 0.08);
  assert.equal(balusters.length, 25, 'balcony has 25 balusters');
  const colonnadePiers = jianguo.parts.filter((p) => p.type === 'box' && p.flat === STONE && p.h === 4.2 && p.w === 0.9);
  assert.equal(colonnadePiers.length, 4, 'entrance colonnade has 4 grey stone piers');
  const doorways = jianguo.parts.filter((p) => p.type === 'box' && p.flat === DARK && p.h === 4.2 && p.w === 3.8);
  assert.equal(doorways.length, 3, 'entrance colonnade has 3 dark arched doorways');
  const archDomes = jianguo.parts.filter((p) => p.type === 'dome' && p.rx === 1.9 && p.h === 1.9);
  assert.equal(archDomes.length, 3, 'three white dome arch tops over the doorways');
  const roofRidge = jianguo.parts.find((p) => p.type === 'ridge' && p.w === 100 && p.d === 18 && p.ridgeH === 2.6);
  assert.ok(roofRidge, 'pitched grey roof ridge replaces the flat slab');
  // Statue (#334): the Chiang Kai-shek bronze (1975) — a STANDING figure
  // on a dark-green marble plinth — at the roundabout, 20 m south of the
  // Honglou front face on the entrance axis.
  const plinth = jianguo.parts.find((p) => p.type === 'box' && p.flat === PLINTH && p.w === 1.6 && p.h === 2.4);
  assert.ok(plinth, 'dark-green marble plinth present');
  assert.equal(plinth.dx, -26.9, 'plinth at the roundabout centre (-26.9, -29.0)');
  assert.equal(plinth.dz, -29, 'plinth at the roundabout centre (-26.9, -29.0)');
  const curb = jianguo.parts.find((p) => p.type === 'cylinder' && p.r === 7 && p.flat === BRICK);
  assert.ok(curb, 'roundabout curb (r 7 m) present');
  assert.equal(curb.dx, -26.9, 'roundabout centred on the entrance axis');
  const head = jianguo.parts.find((p) => p.type === 'cylinder' && p.r === 0.16 && p.flat === 0x8a5a3a);
  assert.ok(head, 'bronze figure head present');
  assert.ok(Math.abs(head.y0 - 5.85) < 0.01, `figure stands ~2.05 m on the plinth (head y0 ${head.y0})`);
  // The whole entry: 150 Honglou + 3708 fence + 51 statue/gate/guard +
  // 28 trees + 21 classroom/court/track parts = 3958.
  assert.equal(jianguo.parts.length, 3958, 'Jianguo part count pinned');
});

test('issue #333: Qingjiang track is a draped mesh on a groundAt plan', () => {
  // The capsule sits on a saddle (drape 9.6..12.4 m across it, varying
  // along the axis as well as across it), so no flat or terraced box
  // construction can seat it. On a draped plan the planner swaps the
  // flat capsule for two baked-vertex mesh parts following groundAt;
  // the bare plan keeps the flat capsule (pinned by the #328 test
  // above). Mesh layout (js/taipei-buildings.js): ring verts are outer
  // top [0..n), inner top [n..2n), skirt-top duplicates [2n..3n),
  // skirt bottom [3n..4n); field verts are inner top [0..n), mid top
  // [n..2n), centre [2n].
  const TRACK_RED = 0xa04a30, FIELD_GREEN = 0x4e7d32;
  const draped = planTaipeiBuildings(TAIPEI_GEO, { groundAt: drapeHeight });
  const q = draped.landmarkTowers.find((s) => s.id === 'qingjiang-elementary');
  assert.ok(q, 'Qingjiang Elementary is a registry landmark');
  assert.ok(Math.abs(q.lift - 11.42) < 0.01, `Qingjiang lift is the drape at its anchor (got ${q.lift})`);
  const meshes = q.parts.filter((p) => p.type === 'mesh');
  assert.equal(meshes.length, 2, 'ring + field mesh parts replace the flat capsule');
  assert.ok(!q.parts.some((p) => p.type === 'capsule'), 'no placeholder reaches the plan');
  assert.ok(!q.parts.some((p) => p.type === 'box' && p.flat === TRACK_RED && p.w === 54), 'no flat capsule box on the draped plan');
  assert.ok(!q.parts.some((p) => p.type === 'cylinder' && p.flat === TRACK_RED), 'no flat capsule end caps on the draped plan');
  const ring = meshes.find((p) => p.flat === TRACK_RED);
  const field = meshes.find((p) => p.flat === FIELD_GREEN);
  assert.ok(ring && field, 'ring rust-red, field green');
  // Same outline, centre and axis as the flat capsule.
  assert.equal(ring.verts.length / 3, 256, 'ring verts: 64 outer + 64 inner + 64 skirt-top + 64 skirt-bottom');
  assert.equal(ring.tris.length / 3, 256, 'ring tris: 128 strip + 128 skirt');
  assert.equal(field.verts.length / 3, 129, 'field verts: 64 inner + 64 mid + centre');
  assert.equal(field.tris.length / 3, 192, 'field tris: 128 strip + 64 fan');
  const toLocal = (x, z) => {
    const c = Math.cos(-0.55), s = Math.sin(-0.55);
    const dx = x - (-62), dz = z - (-1);
    return [dx * c + dz * s, -dx * s + dz * c];
  };
  const bounds = (m) => {
    let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
    for (let i = 0; i < m.verts.length; i += 3) {
      const [u, v] = toLocal(m.verts[i], m.verts[i + 2]);
      umin = Math.min(umin, u); umax = Math.max(umax, u);
      vmin = Math.min(vmin, v); vmax = Math.max(vmax, v);
    }
    return [umin, umax, vmin, vmax];
  };
  assert.deepEqual(bounds(ring).map((v) => Math.round(v * 100) / 100), [-49, 49, -22, 22], 'ring outline is the flat capsule footprint (98 x 44)');
  assert.deepEqual(bounds(field).map((v) => Math.round(v * 100) / 100), [-45, 45, -18, 18], 'field outline is the flat infield footprint (90 x 36)');
  // Every vertex sits at the draped ground + 0.32 (ring top) / + 0.38
  // (field top), except the skirt bottoms at ground - 0.02 — so the
  // surface clears the ground everywhere and never floats.
  const offOf = (m, i) => m.verts[i * 3 + 1] - (drapeHeight(q.x + m.verts[i * 3], q.z + m.verts[i * 3 + 2]) - q.lift);
  let ringTop = 0, ringSkirt = 0;
  for (let i = 0; i < ring.verts.length / 3; i++) {
    const d = offOf(ring, i);
    if (Math.abs(d - 0.32) < 1e-6) ringTop++;
    else if (Math.abs(d - (-0.02)) < 1e-6) ringSkirt++;
    else assert.fail(`ring vertex ${i} at unexpected offset ${d}`);
  }
  assert.equal(ringTop, 192, 'ring top verts (outer + inner + skirt-top)');
  assert.equal(ringSkirt, 64, 'skirt bottom verts');
  for (let i = 0; i < field.verts.length / 3; i++) {
    assert.ok(Math.abs(offOf(field, i) - 0.38) < 1e-6, `field vertex ${i} at ground + 0.38`);
  }
  // Winding: top triangles face up (signed area in (x,z) < 0), skirt
  // triangles are vertical (signed area 0). A skirt triangle is one
  // that references a skirt-bottom vertex.
  const signedArea = (m, a, b, c) => {
    const ax = m.verts[a * 3], az = m.verts[a * 3 + 2];
    const bx = m.verts[b * 3], bz = m.verts[b * 3 + 2];
    const cx = m.verts[c * 3], cz = m.verts[c * 3 + 2];
    return 0.5 * ((bx - ax) * (cz - az) - (cx - ax) * (bz - az));
  };
  for (const m of meshes) {
    for (let t = 0; t < m.tris.length; t += 3) {
      const idx = [m.tris[t], m.tris[t + 1], m.tris[t + 2]];
      const isSkirt = idx.some((i) => Math.abs(offOf(m, i) - (-0.02)) < 1e-6);
      const a = signedArea(m, idx[0], idx[1], idx[2]);
      if (isSkirt) assert.ok(Math.abs(a) < 1e-6, `skirt triangle is vertical (signed area ${a})`);
      else assert.ok(a < -1e-9, `top triangle faces up (signed area ${a})`);
    }
  }
  // Deterministic: a second draped plan carries the identical mesh.
  const again = planTaipeiBuildings(TAIPEI_GEO, { groundAt: drapeHeight });
  const q2 = again.landmarkTowers.find((s) => s.id === 'qingjiang-elementary');
  assert.equal(JSON.stringify(q2.parts), JSON.stringify(q.parts), 'draped capsule deterministic across runs');
  // The swap moves no lots: the draped plan's lots equal the bare plan's.
  assert.equal(draped.lots.length, plan.lots.length, 'mesh swap moves no lots');
});
