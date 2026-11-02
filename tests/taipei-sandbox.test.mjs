import assert from 'node:assert/strict';
import test from 'node:test';

import { TAIPEI_GEO as TAIPEI_GEO_FULL } from '../js/taipei-geodata.js';
import { planTaipeiBuildings } from '../js/taipei-buildings.js';
import {
  TAIPEI_GEO,
  SANDBOX_BOX,
  SANDBOX_ACTIVE,
  SANDBOX_PRESETS,
  SANDBOX_RADIUS_MIN_M,
  SANDBOX_RADIUS_MAX_M,
  latLonToTileXY,
  tileXYToLatLon,
  parseSandboxParam,
  filterGeoToBox,
  sandboxEmptiness,
  clipPolylineToBox,
  clipPolylineWithValuesToBox,
  clipRingToBox,
  pointInBox,
} from '../js/taipei-sandbox.js';

// Sandbox / demo mode (?sandbox=<lat>,<lng>,<radius_m> or a district
// preset). The headline invariant: with no param the module exports the
// generated geo itself — the identical object — so the plan is
// byte-identical by construction (the full battery's existing
// fingerprints, e.g. taipei-settings' 68,482 lots, pin the plan itself).

test('no param in Node: sandbox off, TAIPEI_GEO is the generated geo itself', () => {
  assert.equal(SANDBOX_ACTIVE, false);
  assert.equal(SANDBOX_BOX, null);
  assert.equal(TAIPEI_GEO, TAIPEI_GEO_FULL);
  assert.equal(parseSandboxParam('').status, 'off');
  assert.equal(parseSandboxParam('?city=taipei').status, 'off');
  assert.equal(parseSandboxParam('?sandbox=').status, 'off');
});

test('lat/lng to tile x/z: the origin maps to (0, 0), round-trip is exact', () => {
  const origin = latLonToTileXY(25.0330, 121.5650);
  assert.equal(origin.x, 0);
  assert.equal(origin.z, 0);
  // 0.01 deg north = 1109.9 m south in tile space (z is south, negative north).
  const north = latLonToTileXY(25.0430, 121.5650);
  assert.equal(north.x, 0);
  assert.ok(Math.abs(north.z - -1109.9) < 0.01);
  // 0.01 deg east = 1008.4 m.
  const east = latLonToTileXY(25.0330, 121.5750);
  assert.ok(Math.abs(east.x - 1008.4) < 0.01);
  assert.equal(east.z, 0);
  for (const [lat, lon] of [[25.0330, 121.5650], [25.1367, 121.5065], [25.0259, 121.5364]]) {
    const { x, z } = latLonToTileXY(lat, lon);
    const back = tileXYToLatLon(x, z);
    assert.ok(Math.abs(back.lat - lat) < 1e-9);
    assert.ok(Math.abs(back.lon - lon) < 1e-9);
  }
});

test('parseSandboxParam: presets resolve to named lat/lng + radius', () => {
  const xinyi = parseSandboxParam('?sandbox=xinyi');
  assert.equal(xinyi.status, 'active');
  assert.equal(xinyi.preset, 'xinyi');
  assert.equal(xinyi.lat, 25.0330);
  assert.equal(xinyi.lon, 121.5650);
  assert.equal(xinyi.radius, 800);
  assert.deepEqual(xinyi.box, { minX: -800, maxX: 800, minZ: -800, maxZ: 800 });
  // Case-insensitive preset name.
  assert.equal(parseSandboxParam('?sandbox=XINYI').preset, 'xinyi');
  // Every preset is a real spot inside the tile with a radius in range.
  for (const [name, def] of Object.entries(SANDBOX_PRESETS)) {
    const p = parseSandboxParam(`?sandbox=${name}`);
    assert.equal(p.status, 'active', name);
    assert.equal(p.lat, def.lat);
    assert.equal(p.lon, def.lon);
    assert.equal(p.radius, def.radius);
    assert.ok(p.radius >= SANDBOX_RADIUS_MIN_M && p.radius <= SANDBOX_RADIUS_MAX_M, name);
    const { x, z } = p.centre;
    assert.ok(x >= TAIPEI_GEO_FULL.frame.bbox.minX && x <= TAIPEI_GEO_FULL.frame.bbox.maxX, `${name} centre x`);
    assert.ok(z >= TAIPEI_GEO_FULL.frame.bbox.minZ && z <= TAIPEI_GEO_FULL.frame.bbox.maxZ, `${name} centre z`);
  }
});

test('parseSandboxParam: lat/lng form, default radius, and the radius clamp', () => {
  const p = parseSandboxParam('?sandbox=25.0330,121.5650,800');
  assert.equal(p.status, 'active');
  assert.equal(p.preset, null);
  assert.equal(p.radius, 800);
  assert.equal(p.clamped, false);
  const noRadius = parseSandboxParam('?sandbox=25.0330,121.5650');
  assert.equal(noRadius.radius, 800);
  const small = parseSandboxParam('?sandbox=25.0330,121.5650,100');
  assert.equal(small.radius, SANDBOX_RADIUS_MIN_M);
  assert.equal(small.clamped, true);
  const huge = parseSandboxParam('?sandbox=25.0330,121.5650,9000');
  assert.equal(huge.radius, SANDBOX_RADIUS_MAX_M);
  assert.equal(huge.clamped, true);
  // A huge radius is clamped, never silently the full city: the box stays
  // a 6000 m square, far smaller than the tile.
  assert.deepEqual(huge.box, { minX: -3000, maxX: 3000, minZ: -3000, maxZ: 3000 });
});

test('parseSandboxParam: unknown preset and malformed values are invalid', () => {
  for (const bad of ['?sandbox=atlantis', '?sandbox=abc,def', '?sandbox=25.0330', '?sandbox=25.0330,121.5650,800,1', '?sandbox=100,121.5650', '?sandbox=25.0330,121.5650,-5', '?sandbox=25.0330,121.5650,0']) {
    const p = parseSandboxParam(bad);
    assert.equal(p.status, 'invalid', bad);
    assert.ok(p.reason.length > 0, bad);
  }
});

test('clipPolylineToBox: a road crossing the edge is cut at the edge', () => {
  const box = { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };
  assert.deepEqual(clipPolylineToBox([-100, 0, 100, 0], box), [[-50, 0, 50, 0]]);
  // Fully outside: nothing. Fully inside: unchanged.
  assert.deepEqual(clipPolylineToBox([-100, 0, -80, 0], box), []);
  assert.deepEqual(clipPolylineToBox([-10, 0, 10, 0], box), [[-10, 0, 10, 0]]);
  // Exits and re-enters at a different edge: two pieces, never a chord
  // across the outside (the path leaves north, travels outside the box,
  // and comes back in from the east).
  const reentrant = clipPolylineToBox([-100, 0, 0, 0, 0, 100, 100, 100, 100, 0, 0, 0, -100, 0], box);
  assert.equal(reentrant.length, 2);
  assert.deepEqual(reentrant[0], [-50, 0, 0, 0, 0, 50]);
  assert.deepEqual(reentrant[1], [50, 0, 0, 0, -50, 0]);
});

test('clipPolylineWithValuesToBox: parallel values interpolate at the clip', () => {
  const box = { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };
  // Heights 0 at x=-100 rising to 100 at x=100: at the box edges they
  // are 25 and 75.
  const pieces = clipPolylineWithValuesToBox([-100, 0, 100, 0], [0, 100], box);
  assert.equal(pieces.length, 1);
  assert.deepEqual(pieces[0].pts, [-50, 0, 50, 0]);
  assert.deepEqual(pieces[0].values, [25, 75]);
  // A scalar value carries through unchanged.
  const scalar = clipPolylineWithValuesToBox([-100, 0, 100, 0], 30, box);
  assert.equal(scalar[0].values, 30);
});

test('clipRingToBox: straddling rings clip, outside rings vanish, containing rings become the box', () => {
  const box = { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };
  // Fully inside: unchanged (still closed).
  const inside = clipRingToBox([-10, -10, 10, -10, 10, 10, -10, 10, -10, -10], box);
  assert.deepEqual(inside, [-10, -10, 10, -10, 10, 10, -10, 10, -10, -10]);
  // Fully outside: null.
  assert.equal(clipRingToBox([100, 100, 120, 100, 120, 120, 100, 120, 100, 100], box), null);
  // Straddling: the clipped ring is closed and stays inside the box.
  const clipped = clipRingToBox([-100, -100, 100, -100, 100, 100, -100, 100, -100, -100], box);
  assert.ok(clipped);
  assert.equal(clipped[0], clipped[clipped.length - 2]);
  assert.equal(clipped[1], clipped[clipped.length - 1]);
  for (let i = 0; i + 1 < clipped.length; i += 2) {
    assert.ok(pointInBox(clipped[i], clipped[i + 1], box), `vertex ${clipped[i]},${clipped[i + 1]} inside`);
  }
  // A ring fully containing the box clips to the box itself.
  const containing = clipRingToBox([-1000, -1000, 1000, -1000, 1000, 1000, -1000, 1000, -1000, -1000], box);
  assert.ok(containing);
  assert.equal((containing.length - 2) / 2, 4);
});

test('filterGeoToBox: per-section rules on a synthetic geo', () => {
  const box = { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };
  const geo = {
    version: 1,
    frame: { origin: 'Taipei 101 (25.0330, 121.5650)', originLatLon: [25.033, 121.565], bearingDeg: 0, units: 'm', bbox: { minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 }, boxes: [{ name: 'A', minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 }] },
    roads: [
      { name: 'crossing', pts: [-100, 0, 100, 0] },
      { name: 'outside', pts: [100, 100, 200, 100] },
      { name: 'inside', pts: [-10, 0, 10, 0] },
    ],
    roadbeds: [{ name: 'bed', pts: [-100, 5, 100, 5] }],
    blocks: [
      { cx: 0, cz: 0, area: 100, bbox: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 } },
      { cx: 500, cz: 500, area: 100, bbox: { minX: 490, maxX: 510, minZ: 490, maxZ: 510 } },
    ],
    water: [{ name: 'pond', ring: [-100, -100, 100, -100, 100, 100, -100, 100, -100, -100] }],
    parks: [],
    green: [],
    loopSites: [],
    schools: [],
    heights: {
      footprints: [{ src: 'permit', floors: 6, height: null, ring: [-100, -100, 100, -100, 100, 100, -100, 100, -100, -100] }],
      doors: [0, 0, 6, 500, 500, 6],
    },
    landmarks: {
      'Taipei 101': { x: 0, z: 0, w: 100, d: 100, name: 'Taipei 101' },
      Far: { x: 500, z: 500, w: 10, d: 10, name: 'Far' },
    },
    mrtStations: [
      { id: 'near', x: 0, z: 0, yaw: 0, kind: 'standard', length: 139, width: 21.5 },
      { id: 'far', x: 500, z: 500, yaw: 0, kind: 'standard', length: 139, width: 21.5 },
    ],
    mrtDecks: { lines: [{ wayId: 1, name: 'deck', highway: 'rail', layer: 1, width: 8, pts: [-100, 0, 100, 0], h: [9, 9], tracks: 2 }] },
    elevatedRoads: { lines: [] },
    mrtDepot: { x: 500, z: 500, yaw: 0, site: { dAlong: 0, dAcross: 0, along: 1590, across: 483 }, halls: [], yard: [] },
    skybridges: [{ pts: [-100, 0, 100, 0], sw: [3, 3] }],
    parkSports: [{ kind: 'court', x: 0, z: 0, rot: 0, w: 28, d: 14, sport: 'tennis', park: '', src: 'way:1' }],
    riverside: { bandM: 30, polys: [{ name: 'river', ring: [100, 100, 120, 100, 120, 120, 100, 120, 100, 100] }] },
    airfield: { site: [{ name: 'field', ring: [100, 100, 120, 100, 120, 120, 100, 120, 100, 100] }], surfaces: [], paint: { runway: [], taxiways: [], stands: [] }, roadTunnels: [] },
    npmSite: { site: [] },
    terrain: { source: 'srtm', grids: [{ box: 'A', x0: -1000, z0: -1000, x1: 1000, z1: 1000, h: [] }] },
    roadGraph: { nodes: [-100, 0, 100, 0, 0, 0, 500, 500, 10, 10, 20, 20], edges: [{ a: 0, b: 1 }, { a: 0, b: 2 }, { a: 2, b: 3 }, { a: 4, b: 5 }] },
  };
  const out = filterGeoToBox(geo, box);
  // The input is not mutated.
  assert.equal(geo.roads.length, 3);
  assert.equal(geo.landmarks['Taipei 101'].x, 0);
  // Roads: the crossing road is clipped to the edge, the outside road
  // is gone, the inside road is unchanged.
  assert.deepEqual(out.roads.map((r) => r.name), ['crossing', 'inside']);
  assert.deepEqual(out.roads[0].pts, [-50, 0, 50, 0]);
  assert.deepEqual(out.roadbeds[0].pts, [-50, 5, 50, 5]);
  // Blocks: only the intersecting one.
  assert.equal(out.blocks.length, 1);
  assert.equal(out.blocks[0].cx, 0);
  // Rings: clipped to the box, still closed.
  assert.ok(out.water[0].ring);
  assert.equal(out.water[0].ring[0], out.water[0].ring[out.water[0].ring.length - 2]);
  // Heights: the footprint clips, the inside door stays, the far door goes.
  assert.equal(out.heights.footprints.length, 1);
  assert.deepEqual(out.heights.doors, [0, 0, 6]);
  // Landmarks: the 101 pin stays (so plan.tower builds), the far pin goes.
  assert.deepEqual(Object.keys(out.landmarks), ['Taipei 101']);
  // MRT: the near station stays, the far one goes; the deck clips with
  // its heights interpolated; the depot is KEPT here — its centre is
  // 450 m outside the box but within the 800 m margin (its site is
  // 1590 x 483 m, so a centre just outside the box still overlaps it).
  // A depot far outside the margin drops (undefined is supported).
  assert.deepEqual(out.mrtStations.map((s) => s.id), ['near']);
  assert.deepEqual(out.mrtDecks.lines[0].pts, [-50, 0, 50, 0]);
  assert.deepEqual(out.mrtDecks.lines[0].h, [9, 9]);
  assert.equal(out.mrtDepot, geo.mrtDepot);
  const farDepot = filterGeoToBox({ ...geo, mrtDepot: { ...geo.mrtDepot, x: 5000, z: 5000 } }, box);
  assert.equal(farDepot.mrtDepot, undefined);
  // Skybridge kept (it intersects); park sport kept (point inside);
  // riverside polys and the airfield site drop (no intersection — the
  // airfield becomes null, which downstream supports).
  assert.equal(out.skybridges.length, 1);
  assert.equal(out.parkSports.length, 1);
  assert.equal(out.riverside.polys.length, 0);
  assert.equal(out.airfield, null);
  // Terrain grids: the intersecting grid stays.
  assert.equal(out.terrain.grids.length, 1);
  // Road graph: nodes stay (edge indices must stay valid); only the
  // edge with BOTH endpoints inside survives.
  assert.equal(out.roadGraph.nodes, geo.roadGraph.nodes);
  assert.deepEqual(out.roadGraph.edges, [{ a: 4, b: 5 }]);
  // Frame: the box becomes the tile, originLatLon NEVER changes (the
  // registry resolves its pins through it).
  assert.deepEqual(out.frame.bbox, box);
  assert.deepEqual(out.frame.boxes, [{ name: 'sandbox', minX: -50, maxX: 50, minZ: -50, maxZ: 50 }]);
  assert.deepEqual(out.frame.originLatLon, [25.033, 121.565]);
  assert.equal(sandboxEmptiness(out).empty, false);
});

test('filterGeoToBox: an empty box filters to nothing and reports empty', () => {
  const ocean = parseSandboxParam('?sandbox=25.0000,121.4000,800');
  assert.equal(ocean.status, 'active');
  const out = filterGeoToBox(TAIPEI_GEO_FULL, ocean.box);
  assert.equal(out.blocks.length, 0);
  assert.equal(out.roads.length, 0);
  assert.equal(out.roadbeds.length, 0);
  assert.deepEqual(out.landmarks, {});
  assert.equal(out.airfield, null);
  assert.equal(sandboxEmptiness(out).empty, true);
  assert.ok(sandboxEmptiness(out).reason.length > 0);
});

test('planner bounds: Xinyi keeps the 101 tower and in-box landmarks, Beitou drops the tower', () => {
  const xinyi = parseSandboxParam('?sandbox=xinyi');
  const xinyiGeo = filterGeoToBox(TAIPEI_GEO_FULL, xinyi.box);
  const xinyiPlan = planTaipeiBuildings(xinyiGeo, { bounds: xinyi.box });
  assert.ok(xinyiPlan.lots.length > 0, 'xinyi plans lots');
  assert.ok(xinyiPlan.tower, 'xinyi keeps the 101 tower');
  assert.ok(xinyiPlan.landmarkTowers.length > 0, 'xinyi keeps in-box landmarks');
  for (const lot of xinyiPlan.lots) {
    assert.ok(pointInBox(lot.x, lot.z, xinyi.box), `lot ${lot.x},${lot.z} inside`);
  }
  for (const s of [...xinyiPlan.landmarkTowers, ...xinyiPlan.siteStructures]) {
    assert.ok(pointInBox(s.x, s.z, xinyi.box), `structure ${s.id} inside`);
  }
  const beitou = parseSandboxParam('?sandbox=beitou');
  const beitouGeo = filterGeoToBox(TAIPEI_GEO_FULL, beitou.box);
  const beitouPlan = planTaipeiBuildings(beitouGeo, { bounds: beitou.box });
  assert.ok(beitouPlan.lots.length > 0, 'beitou plans lots');
  assert.equal(beitouPlan.tower, null, 'beitou has no 101 tower');
  assert.equal(beitouPlan.landmarkTowers.length, 0, 'beitou has no registry landmarks in the box');
  for (const lot of beitouPlan.lots) {
    assert.ok(pointInBox(lot.x, lot.z, beitou.box), `lot ${lot.x},${lot.z} inside`);
  }
});
