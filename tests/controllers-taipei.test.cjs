const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

// Fix-1 regression coverage: with tile world options (js/taipei-boot.js
// controllerOptions), the controllers must treat the Taipei tile as the
// world — its own bounds, no Manhattan shoreline clamp, flat ground — so
// the whole tile is reachable, including Da'an Forest Park at x ≈ −2906,
// which NYC's west shore (x ≈ −2056…−1917) used to clamp away. The NYC
// default instance (no worldOpts) must keep the legacy behaviour, which the
// paired assertions pin down.

const source = readFileSync(join(__dirname, '../js/controllers.js'), 'utf8');

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) || []) listener(event);
    }
  };
}

function loadManagerClass() {
  const window = eventTarget();
  const document = { ...eventTarget(), hidden: false };
  const { ThirdPersonControllerManager } = loadModule(source, {
    globals: { window, document },
    imports: {
      'three/webgpu': {},
      './city-config.js': {
        streetZ: () => 0,
        isTypingInField: () => false,
        ISLAND_BOUNDS: { minX: -500, maxX: 500, minZ: -500, maxZ: 500, sidewalkHeight: 0.22 },
        CENTRAL_PARK_BOUNDS: { minX: -3000, maxX: -2800, minZ: 200, maxZ: 500 },
        getIslandBoundsAtZ: () => ({ westX: -500, eastX: 500 }),
        blockAt: () => null
      },
      './tsl-materials.js': {},
      './actor-models.js': {},
      './pedestrians.js': {},
      './vehicle-lights.js': {},
      './landmarks.js': {}
    }
  });
  return ThirdPersonControllerManager;
}

// The world options js/taipei-boot.js builds for the tile, with the real
// frame from the generated geodata.
async function taipeiWorldOpts() {
  const { TAIPEI_GEO } = await import('../js/taipei-geodata.js');
  const bb = TAIPEI_GEO.frame.bbox;
  return {
    geodata: TAIPEI_GEO,
    opts: {
      bounds: { minX: bb.minX, maxX: bb.maxX, minZ: bb.minZ, maxZ: bb.maxZ },
      clampToShore: false,
      groundHeight: () => 0,
      spawnByMode: null,
      idleWalkZ: { min: bb.minZ + 30, max: bb.maxZ - 30 },
    },
  };
}

function daanCentroid(geodata) {
  const park = geodata.parks.find((p) => p.name === '大安森林公園');
  assert.ok(park, 'Da\'an Forest Park exists in the geodata');
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i + 1 < park.ring.length; i += 2) {
    minX = Math.min(minX, park.ring[i]); maxX = Math.max(maxX, park.ring[i]);
    minZ = Math.min(minZ, park.ring[i + 1]); maxZ = Math.max(maxZ, park.ring[i + 1]);
  }
  return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
}

function bareManager(Class, worldOpts) {
  const controller = Object.create(Class.prototype);
  controller.colliders = [];
  controller._colliderCells = null;
  if (worldOpts) controller.worldOpts = worldOpts;
  return controller;
}

test('taipei world: ground height at Da\'an Forest Park is the flat 0, not Central Park\'s 1.24', async () => {
  const Class = loadManagerClass();
  const { geodata, opts } = await taipeiWorldOpts();
  const park = daanCentroid(geodata);
  assert.ok(park.x < -2800 && park.x > -3027.7, `park centroid x=${park.x} is in the tile's western kilometre`);

  const taipei = bareManager(Class, opts);
  assert.equal(taipei.getGroundHeight(park.x, park.z, 'person'), 0);
  assert.equal(taipei.getGroundHeight(park.x, park.z, 'car'), 0);

  // The stub CENTRAL_PARK_BOUNDS above deliberately covers the park
  // centroid (as the real one overlaps NW Taipei): the NYC-default
  // instance still answers 1.24 there, the tile instance must not.
  const nyc = bareManager(Class, null);
  assert.equal(nyc.getGroundHeight(park.x, park.z, 'person'), 1.24);
});

test('taipei world: movement clamp keeps the park centroid, NYC clamp pushes it to the shore', async () => {
  const Class = loadManagerClass();
  const { geodata, opts } = await taipeiWorldOpts();
  const park = daanCentroid(geodata);

  const taipei = bareManager(Class, opts);
  taipei.activeMode = 'person';
  const pos = { x: park.x, y: 0, z: park.z };
  taipei.resolveHorizontalCollision(pos, 0.48, 1);
  assert.deepEqual([pos.x, pos.z], [park.x, park.z], 'the western kilometre of the tile stays reachable');

  const nyc = bareManager(Class, null);
  nyc.activeMode = 'person';
  const nycPos = { x: park.x, y: 0, z: park.z };
  nyc.resolveHorizontalCollision(nycPos, 0.48, 1);
  assert.equal(nycPos.x, -492, 'legacy behaviour: clamped to west shore + 8 m inset');
});

test('taipei world: _worldBounds/_shoreAt honour the options and the NYC defaults', async () => {
  const Class = loadManagerClass();
  const { opts } = await taipeiWorldOpts();
  const taipei = bareManager(Class, opts);
  assert.deepEqual(taipei._worldBounds(), opts.bounds);
  assert.equal(taipei._shoreAt(0), null, 'a flat tile has no shoreline clamp');

  const nyc = bareManager(Class, null);
  assert.equal(nyc._worldBounds().sidewalkHeight, 0.22, 'no options: Manhattan island bounds');
  assert.deepEqual({ ...nyc._shoreAt(0) }, { westX: -492, eastX: 492 }, 'no options: shoreline with the 8 m inset');
});

test('taipei world: a teleport lands exactly at Da\'an Forest Park centroid', async () => {
  const Class = loadManagerClass();
  const { geodata, opts } = await taipeiWorldOpts();
  const park = daanCentroid(geodata);
  const controller = bareManager(Class, opts);
  const position = (x = 0, y = 0, z = 0) => ({ x, y, z, copy(p) { this.x = p.x; this.y = p.y; this.z = p.z; } });
  const pivot = () => ({ position: position(), rotation: { x: 0, y: 0, z: 0 } });
  const ent = {
    type: 'person', chaseDistance: 4.3, chaseHeight: 1.95,
    position: position(0, 0, 0), heading: 0, speed: 5,
    mesh: pivot(), verticalVel: 1,
    rig: { reset(...args) { this.resetArgs = args; } },
    crowd: { begin() {}, add() {}, end() {} }
  };
  controller.activeMode = 'person';
  controller.entities = { person: ent };
  controller.keys = Object.fromEntries(['forward', 'backward', 'left', 'right', 'up', 'down', 'boost'].map((a) => [a, false]));
  controller._pressedCodes = new Set();
  controller.resetInput = Class.prototype.resetInput;
  const result = controller.teleportActiveTo(park.x, park.z, 0);
  assert.deepEqual({ ...result }, { x: park.x, z: park.z }, 'no shore clamp displaces the arrival');
  assert.equal(ent.position.y, 0, 'arrival stands on the flat tile ground');
});

test('taipei-boot wires the tile world into main.js (source contract)', () => {
  const boot = readFileSync(join(__dirname, '../js/taipei-boot.js'), 'utf8');
  assert.match(boot, /export function controllerOptions\(tile\)/);
  assert.match(boot, /bounds:\s*\{\s*minX: bb\.minX, maxX: bb\.maxX, minZ: bb\.minZ, maxZ: bb\.maxZ \}/);
  assert.match(boot, /clampToShore: false/);
  assert.match(boot, /groundHeight: \(\) => 0/);
  assert.match(boot, /spawnByMode:/);
  const main = readFileSync(join(__dirname, '../js/main.js'), 'utf8');
  assert.match(main, /tileBoot \? tileBoot\.controllerOptions\(activeTile\) : undefined/);
});
