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

// Issue #137 enforcement: the Tamsui River + its riverside band is
// non-buildable BY RULE, on both banks, wherever the tile carries
// it — not only where OSM happens to tag a park. The mechanism:
// the extractor's two-pass relation stitch recovers the true bank
// polygons (relation 4010571 — the old build saw only the
// centreline and buffered it to a ~160 m ribbon where the river
// runs 450-900 m wide, which is how the #125 audit found 740 lots
// standing in the water); the geodata flags those polygons
// river: 'tamsui'; the planner drops any lot whose centre or
// turned corners come within RIVERSIDE_BAND_M (30 m — measured
// against satellite: the levee/wharf strip is 15-30 m, while the
// first real housing row on Shezi's west shore stands 35-60 m
// from the bank, so 30 m clears the phantoms and spares the row)
// of a flagged ring; the boot renders the band as park-tone ground.
const distToRing = (x, z, ring) => {
  if (pointInRing(x, z, ring)) return 0;
  let best = Infinity;
  for (let i = 0; i + 3 < ring.length; i += 2) {
    const ax = ring[i], az = ring[i + 1], bx = ring[i + 2], bz = ring[i + 3];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    let tt = L2 > 0 ? ((x - ax) * dx + (z - az) * dz) / L2 : 0;
    tt = Math.max(0, Math.min(1, tt));
    best = Math.min(best, Math.hypot(x - (ax + tt * dx), z - (az + tt * dz)));
  }
  return best;
};

test('issue #137: the Tamsui stem is real water and its band is lot-free on both banks', (t) => {
  const tamsui = (TAIPEI_GEO.water || []).filter((p) => p.river === 'tamsui').map(withBb);
  const km2 = tamsui.reduce((s, p) => s + ringArea(p.ring), 0) / 1e6;
  t.diagnostic(`Tamsui flagged: ${tamsui.length} polys, ${km2.toFixed(2)} km2 in tile; band ${JSON.stringify(TAIPEI_GEO.riverside && { bandM: TAIPEI_GEO.riverside.bandM, polys: TAIPEI_GEO.riverside.polys.length })}; stats riverside drops ${plan.stats.lotsDroppedRiverside}`);
  assert.ok(tamsui.length >= 3, `Tamsui stem polygons flagged (${tamsui.length})`);
  assert.ok(km2 > 2, `Tamsui water in tile ${km2.toFixed(2)} km2 (the centreline ribbon carried ~0.8)`);
  assert.equal(lotsInside(plan.lots, tamsui), 0, 'lots standing in the Tamsui (the #125 phantom finding)');
  // The band itself: rendered riverside polygons carry no lot
  // centre, and the planner's drop counter proves the rule engaged.
  const band = (TAIPEI_GEO.riverside?.polys || []).map(withBb);
  assert.equal(TAIPEI_GEO.riverside?.bandM, 30, 'riverside band is 30 m (measured: levee strip yes, first housing row no)');
  assert.ok(band.length >= 5, `riverside band polygons ${band.length}`);
  assert.equal(lotsInside(plan.lots, band), 0, 'lots inside the riverside band');
  assert.ok(plan.stats.lotsDroppedRiverside > 0, 'the band rule dropped lots (it engages)');
  // The audit bites: strip the river flags (the rule's switch)
  // and the levee strip plants again.
  const noRule = planTaipeiBuildings({
    ...TAIPEI_GEO,
    water: TAIPEI_GEO.water.map((p) => ({ ...p, river: undefined })),
  });
  assert.ok(lotsInside(noRule.lots, band) > 0, 'without the rule the band plants (audit would have caught it)');
  // Named Tamsui-frontage parks, east and west banks: present in
  // the sourced polygons and lot-free.
  for (const name of ['延平河濱公園', '龍山河濱公園', '大稻埕公園', '福安河濱公園', '淡水河畔公園']) {
    const polys = openLand.filter((p) => p.name === name);
    assert.ok(polys.length >= 1, `${name} missing from parks/green data`);
    assert.equal(lotsInside(plan.lots, polys), 0, `lots inside ${name}`);
  }
  // Shezi's Tamsui shore wetland, at the island's NW tip:
  const shezi = openLand.filter((p) => p.name === '社子島溼地');
  assert.ok(shezi.length >= 1, '社子島溼地 missing from parks/green data');
  assert.equal(lotsInside(plan.lots, shezi), 0, 'lots inside 社子島溼地');
  // 馬場町紀念公園 lies entirely SOUTH of the tile union, like
  // 古亭/中正河濱公園 above: pin its ground as zero-lot.
  const machang = plan.lots.filter((l) => inLonLat(l.x, l.z, 121.500, 121.505, 25.020, 25.027)).length;
  assert.equal(machang, 0, 'lots on 馬場町紀念公園 ground (south of tile)');
  // Dadaocheng reach: the real fabric WEST of the levee line
  // (lon 121.5085) survives — the band must not eat the city —
  // but every surviving lot stands clear of the true bank
  // (test frame = the full reach lon 121.494-121.5085 x lat
  // 25.045-25.075, both banks: 1,317 lots, min centre distance
  // 60 m — twice the band; the narrower audit frame in the #134
  // evidence counted its 129 east-bank lots at min 106 m. The
  // phantom neighbours the old build planted on the strip and
  // in the river are gone — the zero asserts above).
  const frame = plan.lots.filter((l) => inLonLat(l.x, l.z, 121.494, 121.5085, 25.045, 25.075));
  let minD = Infinity;
  for (const l of frame) for (const p of tamsui) minD = Math.min(minD, distToRing(l.x, l.z, p.ring));
  t.diagnostic(`Dadaocheng frame west of 121.5085: ${frame.length} lots, min distance to the true bank ${minD.toFixed(0)} m`);
  assert.ok(frame.length >= 100, `the Dadaocheng fabric survives (${frame.length} lots)`);
  assert.ok(minD >= 50, `every frame lot clears the bank (min ${minD.toFixed(0)} m)`);
});

test('issue #134: Songshan Airport is a special site — no procedural lots on airfield ground', (t) => {
  const af = TAIPEI_GEO.airfield;
  assert.ok(af, 'geodata carries the airfield layer');
  const site = (af.site || []).map(withBb);
  const km2 = site.reduce((s, p) => s + ringArea(p.ring), 0) / 1e6;
  t.diagnostic(`airfield: site ${site.length} polys ${km2.toFixed(2)} km2, surfaces ${(af.surfaces || []).length}; stats ${JSON.stringify({ blocksSkippedAirfield: plan.stats.blocksSkippedAirfield, lotsDroppedAirfield: plan.stats.lotsDroppedAirfield })}`);
  assert.equal(site.length, 1, 'the aerodrome boundary (OSM relation 5421750) is one site ring');
  assert.ok(km2 > 2, `aerodrome site area ${km2.toFixed(2)} km2 (ring clipped to the union)`);
  assert.ok((af.surfaces || []).length >= 50, 'runway/taxiway/apron surfaces carried for the renderer');
  assert.equal(lotsInside(plan.lots, site), 0, 'lots on the airfield');
  assert.ok(plan.stats.blocksSkippedAirfield > 0 && plan.stats.lotsDroppedAirfield > 0,
    'the site exclusion engaged (blocks skipped / lots dropped)');
  // The audit bites: strip the layer and the field plants.
  const noSite = planTaipeiBuildings({ ...TAIPEI_GEO, airfield: null });
  assert.ok(lotsInside(noSite.lots, site) > 0, 'without the site rule the airfield plants (audit would have caught it)');
  // The ground AROUND the field is ordinary city and stays built:
  // the airport box (minus the site) carries its Dunhua/Minquan
  // fabric.
  const boxLots = plan.lots.filter((l) => inLonLat(l.x, l.z, 121.533, 121.570, 25.055, 25.078));
  t.diagnostic(`airport box lots (outside the site): ${boxLots.length}`);
  assert.ok(boxLots.length > 3000, `airport box fabric present (${boxLots.length} lots)`);
});
