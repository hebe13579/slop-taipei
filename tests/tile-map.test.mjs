import assert from 'node:assert/strict';
import test from 'node:test';

import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { TAIPEI_TILE } from '../js/taipei-tile.js';
import { buildTileMapModel, TileMapView, TileMapSystem } from '../js/tile-map.js';

// Issue #7: the tile-driven in-game map. The model is built purely from the
// active tile's data (generation-map roadbeds, water & park polygons from the
// geodata, the tile's teleports & landmarks) — these tests pin the model to
// the source data and pin the world -> map transform at known places.

const model = buildTileMapModel(TAIPEI_TILE);
const bb = TAIPEI_GEO.frame.bbox;

test('map model counts match the tile geodata and tile definition', (t) => {
  const ringOk = (list) => (list || []).filter((p) => p && p.ring && p.ring.length >= 6).length;
  assert.equal(model.counts.roads, TAIPEI_GEO.roadbeds.length, 'one map road per generation-map roadbed');
  assert.equal(model.counts.water, ringOk(TAIPEI_GEO.water), 'one map water polygon per geodata water ring');
  assert.equal(model.counts.parks, ringOk(TAIPEI_GEO.parks), 'one map park per geodata park ring');
  assert.equal(model.counts.teleports, Object.keys(TAIPEI_TILE.teleports).length);
  assert.equal(model.counts.landmarks, TAIPEI_TILE.landmarks.length);
  t.diagnostic(`roads=${model.counts.roads} water=${model.counts.water} parks=${model.counts.parks} ` +
    `teleports=${model.counts.teleports} landmarks=${model.counts.landmarks} roadNames=${model.counts.roadNames}`);

  // Road names: the labelled streets are exactly the named roadbeds that
  // produced at least one label anchor, and the big boulevards are among them.
  const namedBeds = new Set(TAIPEI_GEO.roadbeds.map((b) => b.name).filter(Boolean));
  assert.ok(model.counts.roadNames > 1000, 'the tile has well over a thousand named streets');
  assert.ok(model.counts.roadNames <= namedBeds.size);
  for (const name of ['忠孝東路四段', '信義路五段', '敦化南路一段', '仁愛路四段']) {
    const label = model.roadLabels.find((l) => l.text === name);
    assert.ok(label, `${name} has a map label entry`);
    assert.ok(label.anchors.length > 0, `${name} has label anchors`);
    assert.ok(label.roads.length > 0, `${name} keeps its roadbeds for search highlight`);
    assert.equal(label.major, true, `${name} is a major road`);
  }
  for (const l of model.roadLabels) {
    for (const a of l.anchors) {
      assert.ok(a.x >= l.minX - 0.001 && a.x <= l.maxX + 0.001 && a.z >= l.minZ - 0.001 && a.z <= l.maxZ + 0.001,
        'label anchors live inside their street bounds');
    }
  }
});

test('every map geometry point lies inside the tile frame', () => {
  assert.deepEqual(model.bounds, { minX: bb.minX, maxX: bb.maxX, minZ: bb.minZ, maxZ: bb.maxZ });
  const slack = 1; // geodata coordinates are rounded to 0.1 m
  for (const r of model.roads) {
    for (let i = 0; i + 1 < r.pts.length; i += 2) {
      assert.ok(r.pts[i] >= bb.minX - slack && r.pts[i] <= bb.maxX + slack, 'road x inside the tile');
      assert.ok(r.pts[i + 1] >= bb.minZ - slack && r.pts[i + 1] <= bb.maxZ + slack, 'road z inside the tile');
    }
  }
  for (const p of [...model.water, ...model.parks]) {
    assert.ok(p.minX >= bb.minX - slack && p.maxX <= bb.maxX + slack, 'polygon x inside the tile');
    assert.ok(p.minZ >= bb.minZ - slack && p.maxZ <= bb.maxZ + slack, 'polygon z inside the tile');
  }
  for (const p of [...model.teleports, ...model.landmarks]) {
    assert.ok(p.x >= bb.minX && p.x <= bb.maxX && p.z >= bb.minZ && p.z <= bb.maxZ, 'place inside the tile');
  }
});

test('world -> map transform: origin, Taipei 101 and the tile corners', () => {
  // The tile frame origin is Taipei 101 (0, 0); the landmark site sits at a
  // known offset from it in the geodata.
  const lm101 = TAIPEI_GEO.landmarks['Taipei 101'];
  const tp101 = model.teleports.find((tp) => tp.name === 'Taipei 101');
  assert.ok(tp101, 'Taipei 101 is a map teleport');
  assert.equal(tp101.x, lm101.x);
  assert.equal(tp101.z, lm101.z);

  // A radar view centred on the landmark: the landmark is the centre pixel,
  // the world origin lands east-north of it by exactly the landmark offset.
  const s = 0.32;
  const v = new TileMapView(lm101.x, lm101.z, s, 256, 256, 1);
  assert.equal(v.toX(lm101.x), 0);
  assert.equal(v.toY(lm101.z), 0);
  assert.ok(Math.abs(v.toX(0) - (0 - lm101.x) * s) < 1e-9);
  assert.ok(Math.abs(v.toY(0) - (0 - lm101.z) * s) < 1e-9);

  // A view centred on the tile centre: the corners are half the tile away.
  assert.ok(Math.abs(model.centre.x - (bb.minX + bb.maxX) / 2) < 1e-9);
  assert.ok(Math.abs(model.centre.z - (bb.minZ + bb.maxZ) / 2) < 1e-9);
  const c = new TileMapView(model.centre.x, model.centre.z, 0.1, 800, 600, 1);
  assert.ok(Math.abs(c.toX(bb.minX) - (-model.widthM / 2) * 0.1) < 1e-6, 'west corner');
  assert.ok(Math.abs(c.toX(bb.maxX) - (model.widthM / 2) * 0.1) < 1e-6, 'east corner');
  assert.ok(Math.abs(c.toY(bb.minZ) - (-model.heightM / 2) * 0.1) < 1e-6, 'north corner (minZ is up)');
  assert.ok(Math.abs(c.toY(bb.maxZ) - (model.heightM / 2) * 0.1) < 1e-6, 'south corner');

  // The canvas world transform maps world metres through the same toX/toY.
  const calls = [];
  const ctx = { setTransform: (...args) => calls.push(args) };
  const w2 = new TileMapView(100, -50, 0.5, 400, 300, 2);
  w2.world(ctx);
  const [a, , , d, e, f] = calls[0];
  assert.equal(a, 0.5 * 2);
  assert.equal(d, 0.5 * 2);
  // world point (100, -50) (the view centre) must land on the canvas centre
  assert.ok(Math.abs((a * 100 + e) - 400) < 1e-9, 'centre x maps to canvas centre x (device px)');
  assert.ok(Math.abs((d * -50 + f) - 300) < 1e-9, 'centre z maps to canvas centre y (device px)');
});

test('full-map viewport math: screenToWorld inverts the render transform, teleports clamp to the tile', () => {
  const sys = Object.create(TileMapSystem.prototype);
  sys.model = model;
  sys.viewCenterX = -54.4;
  sys.viewCenterZ = -98.2;
  sys.viewZoom = 0.5;
  const back = sys.screenToWorld(200 + 25 * 0.5, 150 + -40 * 0.5, 400, 300);
  assert.ok(Math.abs(back.x - (-54.4 + 25)) < 1e-9, 'screen -> world x round-trips');
  assert.ok(Math.abs(back.z - (-98.2 + -40)) < 1e-9, 'screen -> world z round-trips');

  const clamped = sys.clampToTile({ x: bb.minX - 500, z: bb.maxZ + 500 });
  assert.equal(clamped.x, bb.minX + 25);
  assert.equal(clamped.z, bb.maxZ - 25);
  const inside = sys.clampToTile({ x: 0, z: 0 });
  assert.deepEqual(inside, { x: 0, z: 0 }, 'points inside the tile are untouched');

  // fitTile frames the whole 4.54 x 4.43 km tile in a 1200x800 canvas
  sys.fullCanvas = { width: 1200, height: 800 };
  sys.fullDpr = 1;
  sys.fitTile();
  assert.ok(Math.abs(sys.viewCenterX - model.centre.x) < 1e-9);
  assert.ok(Math.abs(sys.viewCenterZ - model.centre.z) < 1e-9);
  const expectZoom = Math.min(1200 / (model.widthM * 1.06), 800 / (model.heightM * 1.06));
  assert.ok(Math.abs(sys.viewZoom - expectZoom) < 1e-9, `fit zoom ${sys.viewZoom} == ${expectZoom}`);
  assert.ok(model.widthM * sys.viewZoom <= 1200 && model.heightM * sys.viewZoom <= 800, 'the whole tile fits');
});

test('a tile without a generation map falls back to raw roads', () => {
  const mini = buildTileMapModel({
    id: 'mini',
    geodata: {
      frame: { bbox: { minX: -30, maxX: 30, minZ: -30, maxZ: 30 }, bearingDeg: 0 },
      roads: [{ name: 'Only Road', width: 6, highway: 'residential', pts: [-24, 0, 24, 0] }],
      water: [], parks: [], landmarks: {}
    },
    teleports: {}, landmarks: []
  });
  assert.equal(mini.counts.roads, 1);
  assert.equal(mini.roadLabels.length, 1);
  assert.equal(mini.roadLabels[0].text, 'Only Road');
  assert.deepEqual(mini.centre, { x: 0, z: 0 });
  assert.equal(mini.widthM, 60);
});
