// Issue #207: the driving model — drivable elevated road decks +
// solid buildings. Pins js/taipei-drive.js on synthetic digests
// (surface sampling, the ground-bearing / hint rules, parapet
// colliders, registry/station collider frames) and on the real
// tile geodata (the type-site bridge profile, collider counts,
// and that the MRT digest is never a surface).
import assert from 'node:assert/strict';
import test from 'node:test';
import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { buildDriveModel, structureColliders, stationColliders, taipei101Colliders, taipeiExtraColliders, MOUNT_REACH_M } from '../js/taipei-drive.js';
import { planTaipeiBuildings } from '../js/taipei-buildings.js';
import { LOW_BED_H, ASPHALT_LIFT, PARAPET_H } from '../js/taipei-viaduct.js';

const LOW_SURF = LOW_BED_H + ASPHALT_LIFT;

// A synthetic digest: one east-running bridge line, ground at both
// ends, 9 m at the crest (the 承德橋 profile shape).
const bridgeDigest = {
  deckDepth: 1.8,
  piers: [],
  lines: [{ wayId: 1, name: 'synthetic', highway: 'secondary', layer: 1, width: 14, pts: [0, 0, 100, 0, 200, 0, 300, 0], h: [0, 8.6, 9, 0] }],
};

test('surface: ramp foot is ground-bearing and mountable from the ground', () => {
  const m = buildDriveModel(bridgeDigest);
  // t=0.05 up the first segment: profile 0.43 m, surface ~0.46.
  const s = m.sample(5, 0, 0);
  assert.ok(Math.abs(s - (0.43 + ASPHALT_LIFT)) < 0.02, `foot surface ${s}`);
  // Far up the same ramp the profile is above the ground-bearing
  // band: a caller at ground height is beside the formation, not
  // on it, and stays on the ground.
  assert.equal(m.sample(50, 0, 0), 0);
  // ...but a caller whose height tracks the ramp stays on it.
  assert.ok(Math.abs(m.sample(50, 0, 4.3) - (4.3 + ASPHALT_LIFT)) < 0.02);
});

test('surface: on the crest the hint decides — deck for the deck driver, ground below', () => {
  const m = buildDriveModel(bridgeDigest);
  assert.ok(Math.abs(m.sample(150, 0, 8.8) - (8.8 + ASPHALT_LIFT)) < 0.02, 'crest interpolated');
  assert.equal(m.sample(150, 0, 0), 0, 'the street under the bridge stays on the ground');
  assert.equal(m.sample(150, 0, null), 0, 'no hint defaults to the ground');
  assert.equal(m.sample(150, 40, 8.8), 0, 'outside the corridor there is no deck');
  assert.equal(m.sample(5000, 5000, 9), 0, 'empty cells answer the ground');
});

test('surface: a low-bed segment drives at the rendered flat height', () => {
  const m = buildDriveModel({
    deckDepth: 1.8, piers: [],
    lines: [{ wayId: 2, width: 10, pts: [0, 0, 80, 0], h: [0.2, 0.4] }],
  });
  assert.equal(m.sample(40, 0, 0), LOW_SURF, 'flat low bed, not the 0.2-0.4 profile');
});

test('surface: stacked crossings keep the caller on its own level', () => {
  const m = buildDriveModel({
    deckDepth: 1.8, piers: [],
    lines: [
      { wayId: 3, width: 12, pts: [-100, 0, 100, 0], h: [9, 9] },
      { wayId: 4, width: 12, pts: [0, -100, 0, 100], h: [15, 15] },
    ],
  });
  assert.equal(m.sample(0, 0, 9), 9 + ASPHALT_LIFT, 'lower deck driver stays low');
  assert.equal(m.sample(0, 0, 15), 15 + ASPHALT_LIFT, 'upper deck driver stays high');
  assert.equal(m.sample(0, 0, 0), 0, 'ground driver passes under both');
});

test('parapets: one oriented strip per elevated segment edge, floored at the slab underside', () => {
  const m = buildDriveModel(bridgeDigest);
  // 3 segments, all elevated -> 6 strips.
  assert.equal(m.parapetColliders.length, 6);
  const crest = m.parapetColliders.filter((c) => Math.abs(c.obb.cx - 150) < 1);
  assert.equal(crest.length, 2, 'the crest segment (x 100..200) carries both edges');
  for (const c of crest) {
    assert.ok(Math.abs(c.maxY - (9 + PARAPET_H)) < 0.01, 'parapet top = crest + 1.1');
    assert.ok(Math.abs(c.minY - (8.6 - 1.8)) < 0.01, 'minY = lower end top - deckDepth');
    assert.ok(c.obb, 'oriented');
    // The strips sit inside the 14 m corridor: offset half -
    // PARAPET_T/2 = 6.875 m across the centreline (here: in z).
    assert.ok(Math.abs(Math.abs(c.obb.cz) - 6.875) < 0.01, 'strip centre on the parapet line');
  }
  // Low-bed segments render no parapets and get none.
  const low = buildDriveModel({ deckDepth: 1.8, piers: [], lines: [{ wayId: 5, width: 10, pts: [0, 0, 80, 0], h: [0.2, 0.4] }] });
  assert.equal(low.parapetColliders.length, 0);
  assert.equal(low.stats.elevatedSegments, 0);
});

test('registry colliders: box parts mirror the renderer placement, y0 becomes minY', () => {
  // Beimen-shaped: a gatehouse wall bridging a passage at y0 5.2.
  const structs = [{
    id: 'gate', x: 100, z: 200,
    parts: [
      { type: 'box', w: 10, d: 4, h: 5.2 },
      { type: 'box', w: 10, d: 4, h: 4.6, y0: 5.2, rotY: 0.5 },
      { type: 'cylinder', r: 3, h: 20 },
      { type: 'frustum', wB: 30, dB: 24, wT: 20, dT: 16, h: 12 },
      { type: 'ridge', w: 18, d: 12, h: 6, ridgeH: 3, y0: 12 },
    ],
  }];
  const cs = structureColliders(structs);
  assert.equal(cs.length, 5);
  const ground = cs[0];
  assert.deepEqual([ground.minX, ground.maxX, ground.minZ, ground.maxZ, ground.maxY], [95, 105, 198, 202, 5.2]);
  assert.equal(ground.minY, undefined, 'ground parts carry no minY');
  const bridge = cs[1];
  assert.ok(bridge.obb, 'rotated part is oriented');
  assert.equal(bridge.minY, 5.2, 'the bridging part floors at its y0 — the passage stays open');
  assert.equal(bridge.maxY, 9.8);
  // The tile-plane rotY convention: cs = cos, sn = -sin.
  assert.ok(Math.abs(bridge.obb.cs - Math.cos(0.5)) < 1e-9 && Math.abs(bridge.obb.sn + Math.sin(0.5)) < 1e-9);
  assert.equal(cs[2].maxY, 20, 'cylinder top');
  assert.deepEqual([cs[3].minX, cs[3].maxX], [85, 115], 'frustum base extents at the structure centre');
  assert.equal(cs[4].maxY, 12 + 6 + 3, 'ridge top includes the ridge height');
  assert.equal(cs[4].minY, 12);
});

test('station colliders: elevated bodies floored at their floor, at-grade ground-solid', () => {
  const stations = [
    { id: 'a', x: 0, z: 0, yaw: 0, kind: 'standard', length: 139, width: 21.5 },
    { id: 'b', x: 500, z: 0, yaw: 0, kind: 'at-grade', length: 100, width: 16.5 },
    { id: 'c', x: 1000, z: 0, yaw: 0, kind: 'jiantan', length: 139, width: 24 },
  ];
  const cs = stationColliders(stations, null);
  assert.equal(cs.length, 4, 'jiantan contributes concourse + hull');
  const std = cs[0];
  assert.equal(std.minY, 4.6, 'standard body starts at its floor — the street passes under');
  assert.equal(std.maxY, 16.4);
  assert.equal(std.obb.hz, 139 / 2, 'along half extent from the footprint helper');
  const ag = cs[1];
  assert.equal(ag.minY, undefined, 'at-grade station is ground-solid');
  assert.equal(ag.maxY, 7.65);
  const [conc, hull] = [cs[2], cs[3]];
  assert.equal(conc.minY, undefined);
  assert.equal(conc.maxY, 4.4);
  assert.equal(hull.minY, 5.0);
});

test('real tile: the model covers the digest and never samples the MRT', () => {
  const m = buildDriveModel(TAIPEI_GEO.elevatedRoads);
  assert.equal(m.stats.segments, 2108, 'every digest segment registered (count re-pin: issue #207, measured on main a467e6e7)');
  assert.equal(m.stats.elevatedSegments, 2060);
  assert.equal(m.parapetColliders.length, 4120, 'two parapet strips per elevated segment');
  // Type site: the 承德橋 digest line (wayId 24006864) — crest
  // between its h 8.6 / 9 points reads ~8.9 from the deck hint,
  // and the ground from the ground hint.
  const line = TAIPEI_GEO.elevatedRoads.lines.find((l) => l.wayId === 24006864);
  assert.ok(line, 'type-site line present');
  const cx = (line.pts[2] + line.pts[4]) / 2, cz = (line.pts[3] + line.pts[5]) / 2;
  const top = m.sample(cx, cz, 8.8);
  assert.ok(Math.abs(top - (8.8 + ASPHALT_LIFT)) < 0.05, `crest sample ${top}`);
  assert.equal(m.sample(cx, cz, 0), 0, 'under the bridge is ground');
  // A point on the Red Line guideway away from any road deck must
  // not become a surface: mrtDecks are never read. (Sampled at a
  // station centre: stations are colliders, not surfaces.)
  const st = TAIPEI_GEO.mrtStations[0];
  assert.equal(m.sample(st.x, st.z, 9) === 9 + ASPHALT_LIFT, false, 'no MRT surface at deck height');
});

test('real tile: extra colliders assemble from plan + geodata', () => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  const extra = taipeiExtraColliders(TAIPEI_GEO, plan);
  const parapets = buildDriveModel(TAIPEI_GEO.elevatedRoads).parapetColliders.length;
  assert.ok(extra.length > parapets, 'registry + stations + 101 add to the parapets');
  // 492 authored parts across the registry + site structures,
  // minus the collider-less decorative types (shell etc.).
  const parts = [...plan.landmarkTowers, ...plan.siteStructures]
    .reduce((n, s) => n + (s.parts || []).filter((p) => ['box', 'cylinder', 'dome', 'frustum', 'ridge'].includes(p.type)).length, 0);
  const stations = stationColliders(TAIPEI_GEO.mrtStations, TAIPEI_GEO.mrtDepot).length;
  const tower = taipei101Colliders(plan.tower).length;
  assert.equal(extra.length, parapets + parts + stations + tower,
    `composition: ${parapets} parapets + ${parts} parts + ${stations} stations/depot + ${tower} taipei101`);
  for (const c of extra) {
    assert.ok(Number.isFinite(c.minX) && c.minX < c.maxX && c.minZ < c.maxZ && c.maxY > 0, 'collider well-formed');
    if (c.minY != null) assert.ok(c.minY < c.maxY, 'floor below top');
  }
});

test('mount reach constant is the documented step', () => {
  assert.equal(MOUNT_REACH_M, 1.0);
});
