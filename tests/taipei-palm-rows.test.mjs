// Issue #316: NTU 椰林大道 royal-palm rows — the new 'palm' part
// type along the campus avenue. Pins the row as authored: two rows
// (54 north + 54 south = 108 palms) at ±10 m from the avenue's
// geodata centreline, heights 13–17 m, all inside the campus site
// rect (so they stand on open ground, never on a generated lot),
// and no two palms closer than 7.5 m (one south-row station is
// skipped where the avenue's west-end bend compresses the inner
// row, and 12 more stations are skipped where campus drives cross
// the rows — see palmRowParts). The roadbed clearance itself is
// enforced by the issue-#42 overlap test (palm trunks are audited
// as trunk discs); this test pins the row's geometry against the
// geodata road centrelines directly.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import {
  planTaipeiBuildings,
  PALM_UNIT_H,
  PALM_TRUNK_R0,
  PALM_CROWN_SLIM,
  palmTrunkRadius,
} from '../js/taipei-buildings.js';

const plan = planTaipeiBuildings(TAIPEI_GEO);
const ntu = plan.landmarkTowers.find((s) => s.id === 'ntu-main-campus');
const palms = ntu.parts.filter((p) => p.type === 'palm');

// The avenue's two tertiary road centrelines (the gate loop is a
// tertiary_link and is not part of the through section). The roads
// carry the dense centreline pts the rows were computed from; the
// roadbeds chord them by up to ~0.22 m, so the beds are NOT the
// reference here (their clearance is the overlap test's job).
const avenueRoads = TAIPEI_GEO.roads.filter(
  (r) => r.name === '椰林大道' && r.highway === 'tertiary',
);
const distToSegment = (x, z, ax, az, bx, bz) => {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 === 0 ? 0 : ((x - ax) * dx + (z - az) * dz) / len2;
  t = Math.min(1, Math.max(0, t));
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
};
const distToRoads = (x, z) => {
  let best = Infinity;
  for (const road of avenueRoads) {
    const pts = road.pts;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      best = Math.min(best, distToSegment(x, z, pts[i], pts[i + 1], pts[i + 2], pts[i + 3]));
    }
  }
  return best;
};

test('palm unit constants: 6.15 m tall, slim crown, trunk radius formula', () => {
  assert.equal(PALM_UNIT_H, 6.15, 'unit height is the boot palm (trunk 5.8 + crown to 6.15)');
  assert.equal(PALM_TRUNK_R0, 0.15, 'unit trunk base radius');
  assert.equal(PALM_CROWN_SLIM, 0.7, 'mature royal palms are slimmer than the stylised unit');
  assert.ok(Math.abs(palmTrunkRadius(6.15) - 0.15 * 0.7) < 1e-9, 'unit-height palm trunk');
  // A 15 m avenue palm: 0.15 x (15/6.15) x 0.7 = 0.256 m at grade.
  assert.ok(Math.abs(palmTrunkRadius(15) - 0.2561) < 0.0005, '15 m palm trunk radius');
});

test('NTU palm rows: 108 palms, 54 north + 54 south, heights 13–17 m', () => {
  // 29 pre-#316 parts + the 108 palms = 137. (121 stations at 8 m
  // along the 491 m through section, minus 1 skipped at the
  // west-end bend and 12 skipped at drive crossings.)
  assert.equal(ntu.parts.length, 137, 'NTU part count pinned (issue #316)');
  assert.equal(palms.length, 108, 'two rows, 54 north + 54 south');
  for (const p of palms) {
    assert.ok(p.h >= 13 && p.h <= 17, `palm height ${p.h} in [13, 17] m`);
    assert.ok(p.rotY >= 0 && p.rotY < Math.PI * 2 + 0.01, `palm rotY ${p.rotY} in [0, 2pi)`);
  }
  const heights = palms.map((p) => p.h);
  assert.ok(Math.min(...heights) < 14 && Math.max(...heights) > 16, 'heights vary across the 13–17 m band');
});

test('palm rows flank the avenue at ±10 m, inside the site rect', () => {
  assert.equal(avenueRoads.length, 2, 'two tertiary 椰林大道 roads');
  const site = ntu.sites[0];
  for (const p of palms) {
    const x = ntu.x + p.dx, z = ntu.z + p.dz;
    const d = distToRoads(x, z);
    // 10 m offset from the centreline; the 0.1 m rounding of the
    // authored dx/dz sets the tolerance.
    assert.ok(d >= 9.9 && d <= 10.1, `palm at (${p.dx}, ${p.dz}) is ${d.toFixed(2)} m from the avenue centreline, expected 10 m`);
    assert.ok(x >= site.minX && x <= site.maxX && z >= site.minZ && z <= site.maxZ,
      `palm at (${p.dx}, ${p.dz}) stands inside the NTU site rect`);
  }
  // The rows span the through section: east-most palm near the
  // 小椰林道 junction, west-most near the gate loop, 480 m apart.
  const dxs = palms.map((p) => p.dx);
  assert.ok(Math.max(...dxs) > -70 && Math.min(...dxs) < -545, 'rows span the through avenue');
  assert.ok(Math.max(...dxs) - Math.min(...dxs) > 475, 'row span over 475 m');
});

test('palm rows are staggered: no two palms closer than 7.5 m', () => {
  // Same-row neighbours sit 8 m apart (the station spacing); the
  // rows are staggered by half a spacing, so the closest pair
  // anywhere is 8 m, minus the 0.1 m rounding (the 7.90 m pair is
  // that rounding). Anything under 7.5 m would mean two stations
  // collapsed onto one spot — the west-end bend skip exists
  // precisely to prevent that (see palmRowParts).
  const pts = palms.map((p) => [ntu.x + p.dx, ntu.z + p.dz]);
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
      assert.ok(d >= 7.5, `palms ${i} and ${j} only ${d.toFixed(2)} m apart`);
    }
  }
});
