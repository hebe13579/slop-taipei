// Issue #114 enforcement: green land carries NO urban lots.
//
// The planner drops lots on parks and water, but until this issue the
// geodata's only green layer was leisure=park (+ landuse grass/forest/
// meadow). Land OSM tags as farmland, nature or recreation ground —
// the Guandu plain (Taipei's largest farmland), the riverside 河濱
// bands, Xiangshan's wooded slopes — was subdivided into city blocks
// and planted. The fix extracts a green-land layer (osm_green.json →
// geodata.green, classes from extract-from-pbf.py's green_class) and
// drops urban lots on it with the same centre/corner verdicts as
// park/water, counted in stats.lotsDroppedGreen / blocksSkippedGreen.
//
// This audit pins the NAMED areas the user called out. Each area is
// defined from the sourced polygons themselves (by OSM name or by tag
// class + the area's real geography), never by a hand-waved box alone:
// the test fails if an area's polygons disappear from the data, and
// fails if any planned lot centre stands inside them. A "before" plan
// (same geodata with the green layer stripped) proves the audit bites:
// it must still find the old plantings on the Guandu farmland.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { planTaipeiBuildings, pointInRing, latLonToTile } from '../js/taipei-buildings.js';

const plan = planTaipeiBuildings(TAIPEI_GEO);
const beforePlan = planTaipeiBuildings({ ...TAIPEI_GEO, green: [] });

const ringArea = (ring) => {
  let a = 0;
  for (let i = 0; i + 3 < ring.length; i += 2) {
    a += ring[i] * ring[i + 3] - ring[i + 2] * ring[i + 1];
  }
  return Math.abs(a / 2);
};
const ringCentroid = (ring) => {
  let x = 0, z = 0;
  for (let i = 0; i + 1 < ring.length; i += 2) { x += ring[i]; z += ring[i + 1]; }
  return [x / (ring.length / 2), z / (ring.length / 2)];
};
const withBb = (p) => {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i + 1 < p.ring.length; i += 2) {
    if (p.ring[i] < minX) minX = p.ring[i];
    if (p.ring[i] > maxX) maxX = p.ring[i];
    if (p.ring[i + 1] < minZ) minZ = p.ring[i + 1];
    if (p.ring[i + 1] > maxZ) maxZ = p.ring[i + 1];
  }
  return { ...p, bb: { minX, maxX, minZ, maxZ } };
};
const lotsInside = (lots, polys) => {
  let n = 0;
  for (const lot of lots) {
    for (const p of polys) {
      if (lot.x < p.bb.minX || lot.x > p.bb.maxX || lot.z < p.bb.minZ || lot.z > p.bb.maxZ) continue;
      if (pointInRing(lot.x, lot.z, p.ring)) { n++; break; }
    }
  }
  return n;
};
// Tile metres -> lon/lat box test, via the frame's own projection.
const ORIGIN = TAIPEI_GEO.frame.originLatLon;
const inLonLat = (x, z, w, e, s, n) => {
  const [x0, z1] = latLonToTile(s, w, ORIGIN);
  const [x1, z0] = latLonToTile(n, e, ORIGIN);
  return x >= x0 && x <= x1 && z >= z0 && z <= z1;
};

const green = (TAIPEI_GEO.green || []).map(withBb);
const openLand = [...(TAIPEI_GEO.parks || []), ...(TAIPEI_GEO.green || [])].map(withBb);

test('green layer exists and the planner counts its drops', (t) => {
  assert.ok(green.length > 200, `green polygons ${green.length}`);
  const farmland = green.filter((p) => p.cls === 'landuse:farmland');
  const farmKm2 = farmland.reduce((s, p) => s + ringArea(p.ring), 0) / 1e6;
  t.diagnostic(`green: ${green.length} polys; farmland ${farmland.length} polys, ${farmKm2.toFixed(2)} km2; stats ${JSON.stringify(plan.stats)}`);
  assert.ok(farmKm2 > 1, `farmland area ${farmKm2.toFixed(2)} km2`);
  assert.ok(plan.stats.lotsDroppedGreen > 0, 'planner dropped lots on green land');
});

test('global invariant: no planned lot centre inside any green polygon', () => {
  assert.equal(lotsInside(plan.lots, green), 0, 'a lot stands on green land');
});

test('Guandu plain core: farmland polygons present, planted before, empty now', (t) => {
  // The plain in-tile: Box 4's west, between the Tamsui bank and the
  // MRT/hills edge (lon <= 121.492), lat 25.113-25.140.
  const plain = green.filter((p) => p.cls === 'landuse:farmland'
    && inLonLat(...ringCentroid(p.ring), 121.464, 121.492, 25.113, 25.140));
  const km2 = plain.reduce((s, p) => s + ringArea(p.ring), 0) / 1e6;
  t.diagnostic(`Guandu plain farmland: ${plain.length} polys, ${km2.toFixed(2)} km2; lots before ${lotsInside(beforePlan.lots, plain)}, after ${lotsInside(plan.lots, plain)}`);
  assert.ok(plain.length >= 5, `plain farmland polygons ${plain.length}`);
  assert.ok(km2 > 2, `plain farmland area ${km2.toFixed(2)} km2`);
  assert.ok(lotsInside(beforePlan.lots, plain) > 0, 'the pre-fix plan planted the plain (audit would have caught it)');
  assert.equal(lotsInside(plan.lots, plain), 0, 'lots on Guandu farmland');
});

test('riverside parks (河濱): named polygons present and lot-free', (t) => {
  for (const name of ['大佳河濱公園', '彩虹河濱公園', '關渡自然公園']) {
    const polys = openLand.filter((p) => p.name === name);
    assert.ok(polys.length >= 1, `${name} missing from parks/green data`);
    const after = lotsInside(plan.lots, polys);
    t.diagnostic(`${name}: ${polys.length} polys, lots after ${after}`);
    assert.equal(after, 0, `lots inside ${name}`);
  }
  // 古亭河濱公園 (way 301927905, lat 25.0115-25.0215) and 中正河濱公園
  // (way 349570046, lat 25.0206-25.0239) lie entirely SOUTH of the
  // tile union (south edge lat 25.0285): no tile ground exists there,
  // so no polygon reaches the geodata. Pin their real footprints as
  // zero-lot ground — true today by the union drop, and it stays the
  // requirement if the tile ever grows south to meet them.
  for (const [name, w, e, s, n] of [
    ['古亭河濱公園', 121.5166, 121.5281, 25.0115, 25.0215],
    ['中正河濱公園', 121.5064, 121.5164, 25.0206, 25.0239],
  ]) {
    const inside = plan.lots.filter((l) => inLonLat(l.x, l.z, w, e, s, n)).length;
    t.diagnostic(`${name}: south of tile, lots in footprint ${inside}`);
    assert.equal(inside, 0, `lots on ${name} ground`);
  }
  // The whole 河濱 family, wherever the tile carries it:
  const riverside = openLand.filter((p) => p.name && p.name.includes('河濱公園'));
  assert.ok(riverside.length >= 8, `riverside park polygons ${riverside.length}`);
  assert.equal(lotsInside(plan.lots, riverside), 0, 'lots inside a riverside park');
});

test('Xiangshan slopes: wooded/park polygons at the SE tile edge are lot-free', (t) => {
  const slopes = openLand.filter((p) => {
    if (p.name === '象山公園') return true;
    if (p.cls !== 'natural:wood' && p.cls !== 'landuse:forest') return false;
    return inLonLat(...ringCentroid(p.ring), 121.566, 121.580, 25.0285, 25.042);
  });
  t.diagnostic(`Xiangshan slope polygons: ${slopes.length} (${slopes.map((p) => p.name || p.cls).join(', ')})`);
  assert.ok(slopes.length >= 1, 'no Xiangshan slope polygon in the data');
  assert.equal(lotsInside(plan.lots, slopes), 0, 'lots on Xiangshan slopes');
});
