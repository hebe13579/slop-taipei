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
        // Stub bounds wide enough to cover the Da'an centroid (-3004.9,
        // 228.7): the full park entered the tile with the west
        // expansion (issue #60), moving its centre west of -3000.
        CENTRAL_PARK_BOUNDS: { minX: -3100, maxX: -2800, minZ: 200, maxZ: 500 },
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
  const { unionExclusionRects } = await import('../js/taipei-union.js');
  const bb = TAIPEI_GEO.frame.bbox;
  return {
    geodata: TAIPEI_GEO,
    opts: {
      bounds: { minX: bb.minX, maxX: bb.maxX, minZ: bb.minZ, maxZ: bb.maxZ },
      excludeRects: unionExclusionRects(TAIPEI_GEO.frame.boxes, bb),
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

// --- speedScale (user request 2026-10-23: double top speed in Taipei) ---
// The tile boot passes speedScale 2; every mode's top-speed caps double,
// acceleration/braking/drag (the driving feel) do not. Without the option
// (NYC) the caps are the upstream values, pinned numerically below.

function speedHarness(Class, worldOpts) {
  const controller = bareManager(Class, worldOpts);
  controller._deriveSpeedTables();
  controller.keys = Object.fromEntries(
    ['forward', 'backward', 'left', 'right', 'up', 'down', 'boost'].map((a) => [a, false]));
  return controller;
}

test('speedScale 2: derived caps are exactly double, feel parameters unchanged', () => {
  const Class = loadManagerClass();
  const taipei = speedHarness(Class, { speedScale: 2 });
  assert.equal(taipei.carDrive.speed, 47);
  assert.equal(taipei.carDrive.boostSpeed, 72);
  assert.equal(taipei.carDrive.reverseSpeed, 21);
  assert.equal(taipei.carDrive.acceleration, 14, 'acceleration is not a cap: unchanged');
  assert.equal(taipei.carDrive.boostAcceleration, 21);
  assert.equal(taipei.carDrive.brake, 9);
  assert.equal(taipei.carDrive.drag, 0.0004);
  assert.equal(taipei.bicycleDrive.speed, 25.6);
  assert.equal(taipei.bicycleDrive.boostSpeed, 38);
  assert.equal(taipei.bicycleDrive.reverseSpeed, 9);
  assert.equal(taipei.bicycleDrive.acceleration, 9);
  assert.deepEqual({ ...taipei.personSpeed }, { walk: 8.8, run: 16.4 });
  assert.deepEqual({ ...taipei.heliSpeed }, { cruise: 64, boost: 104, vertical: 32 });
});

test('no speedScale (NYC default): derived caps are the upstream values', () => {
  const Class = loadManagerClass();
  for (const worldOpts of [{}, { speedScale: 1 }, { speedScale: 0 }, { speedScale: NaN }]) {
    const nyc = speedHarness(Class, worldOpts);
    assert.equal(nyc.carDrive.speed, 23.5);
    assert.equal(nyc.carDrive.boostSpeed, 36);
    assert.equal(nyc.carDrive.reverseSpeed, 10.5);
    assert.equal(nyc.bicycleDrive.speed, 12.8);
    assert.equal(nyc.bicycleDrive.boostSpeed, 19);
    assert.equal(nyc.bicycleDrive.reverseSpeed, 4.5);
    assert.deepEqual({ ...nyc.personSpeed }, { walk: 4.4, run: 8.2 });
    assert.deepEqual({ ...nyc.heliSpeed }, { cruise: 32, boost: 52, vertical: 16 });
  }
});

function carEntity() {
  return {
    position: { x: 0, y: 0, z: 0 }, heading: 0, speed: 0,
    vx: 0, vz: 0, angularVel: 0, steerAngle: 0,
    pitchVel: 0, rollVel: 0, heaveVel: 0, heaveY: 0, wheelSpin: 0,
    chassisPivot: { rotation: { x: 0, z: 0 }, position: { y: 0 } },
    wheels: [], carState: null
  };
}

test('speedScale in the loop: car tops out at the doubled caps, NYC at the originals', async () => {
  const Class = loadManagerClass();
  const { opts } = await taipeiWorldOpts();
  const run = (worldOpts, keys) => {
    const controller = speedHarness(Class, worldOpts);
    const car = carEntity();
    controller.entities = { car };
    Object.assign(controller.keys, keys);
    for (let i = 0; i < 3600; i++) controller.updateCar(1 / 60);
    return car.speed;
  };
  assert.ok(Math.abs(run({ ...opts, speedScale: 2 }, { forward: true }) - 47) < 0.05, 'Taipei cruise cap 47 m/s');
  assert.ok(Math.abs(run({ ...opts, speedScale: 2 }, { forward: true, boost: true }) - 72) < 0.05, 'Taipei boost cap 72 m/s');
  assert.ok(Math.abs(run({ ...opts, speedScale: 2 }, { backward: true }) + 21) < 0.05, 'Taipei reverse cap −21 m/s');
  assert.ok(Math.abs(run({ ...opts }, { forward: true, boost: true }) - 36) < 0.05, 'no option: boost cap stays 36 m/s');
});

test('speedScale in the loop: person, cyclist and helicopter caps', async () => {
  const Class = loadManagerClass();
  const { opts } = await taipeiWorldOpts();

  const personRun = (worldOpts, keys) => {
    const controller = speedHarness(Class, worldOpts);
    const person = { position: { x: 0, y: 0, z: 0 }, heading: 0, speed: 0, verticalVel: 0 };
    controller.entities = { person };
    Object.assign(controller.keys, keys);
    for (let i = 0; i < 1200; i++) controller.updatePerson(1 / 60);
    return person.speed;
  };
  assert.ok(Math.abs(personRun({ ...opts, speedScale: 2 }, { forward: true, boost: true }) - 16.4) < 0.01, 'Taipei run cap 16.4 m/s');
  assert.ok(Math.abs(personRun({ ...opts, speedScale: 2 }, { forward: true }) - 8.8) < 0.01, 'Taipei walk cap 8.8 m/s');
  assert.ok(Math.abs(personRun({ ...opts }, { forward: true, boost: true }) - 8.2) < 0.01, 'no option: run cap stays 8.2 m/s');

  const cyclistRun = (worldOpts) => {
    const controller = speedHarness(Class, worldOpts);
    const cyclist = {
      position: { x: 0, y: 0, z: 0 }, heading: 0, speed: 0, leanAngle: 0, pedalPhase: 0,
      leanPivot: { rotation: { z: 0 } }, frontWheel: { rotation: { x: 0 } },
      rearWheel: { rotation: { x: 0 } }, crankPivot: { rotation: { x: 0 } }, pedals: []
    };
    controller.entities = { cyclist };
    Object.assign(controller.keys, { forward: true, boost: true });
    for (let i = 0; i < 3600; i++) controller.updateCyclist(1 / 60);
    return cyclist.speed;
  };
  assert.ok(Math.abs(cyclistRun({ ...opts, speedScale: 2 }) - 38) < 0.05, 'Taipei cyclist boost cap 38 m/s');
  assert.ok(Math.abs(cyclistRun({ ...opts }) - 19) < 0.05, 'no option: cyclist boost cap stays 19 m/s');

  const heliRun = (worldOpts) => {
    const controller = speedHarness(Class, worldOpts);
    const helicopter = {
      position: { x: 0, y: 100, z: 0 }, heading: 0, speed: 0, verticalSpeed: 0,
      pitchAngle: 0, rollAngle: 0,
      tiltPivot: { rotation: { x: 0, z: 0 }, position: { y: 0 } }
    };
    controller.entities = { helicopter };
    Object.assign(controller.keys, { forward: true, boost: true, up: true });
    for (let i = 0; i < 1200; i++) controller.updateHelicopter(1 / 60, 0);
    return helicopter;
  };
  const taipeiHeli = heliRun({ ...opts, speedScale: 2 });
  assert.ok(Math.abs(taipeiHeli.speed - 104) < 1e-6, 'Taipei heli boost cap 104 m/s');
  assert.ok(Math.abs(taipeiHeli.verticalSpeed - 32) < 1e-6, 'Taipei heli vertical cap 32 m/s');
  const nycHeli = heliRun({ ...opts });
  assert.ok(Math.abs(nycHeli.speed - 52) < 1e-6, 'no option: heli boost cap stays 52 m/s');
  assert.ok(Math.abs(nycHeli.verticalSpeed - 16) < 1e-6, 'no option: heli vertical cap stays 16 m/s');
});

// --- heliCeiling + heliVerticalScale (user request 2026-10-24) ---------
// Taipei flies higher and climbs faster: ceiling 750 m (above the
// requested 600 m and Taipei 101's 508 m) and the vertical cap ×5 over
// the current in-Taipei rate (16 × speedScale 2 × 5 = 160 m/s, ascend
// and descend alike). NYC (no options) keeps 380 m and 16 m/s exactly.

test('heli options: derived vertical cap and ceiling honour the options, NYC defaults pinned', () => {
  const Class = loadManagerClass();
  const taipei = speedHarness(Class, { speedScale: 2, heliVerticalScale: 5, heliCeiling: 750 });
  assert.deepEqual({ ...taipei.heliSpeed }, { cruise: 64, boost: 104, vertical: 160 },
    'vertical scale touches the vertical cap only, on top of speedScale');
  assert.equal(taipei._heliCeiling(), 750);
  const vOnly = speedHarness(Class, { heliVerticalScale: 5 });
  assert.deepEqual({ ...vOnly.heliSpeed }, { cruise: 32, boost: 52, vertical: 80 },
    'heliVerticalScale alone: 16 x 5 = 80 m/s');
  for (const worldOpts of [{}, { heliVerticalScale: 1 }, { heliVerticalScale: 0 }, { heliVerticalScale: NaN },
    { heliCeiling: 0 }, { heliCeiling: NaN }, { heliCeiling: -5 }]) {
    const nyc = speedHarness(Class, worldOpts);
    assert.equal(nyc.heliSpeed.vertical, 16, 'no valid heliVerticalScale: upstream vertical cap');
    assert.equal(nyc._heliCeiling(), 380, 'no valid heliCeiling: upstream ceiling');
  }
  const bare = bareManager(Class, null);
  assert.equal(bare._heliCeiling(), 380, 'no worldOpts at all: upstream ceiling');
});

test('heli options in the loop: Taipei climbs/descends at 160 m/s to a 750 m ceiling, NYC caps stay', async () => {
  const Class = loadManagerClass();
  const { opts } = await taipeiWorldOpts();
  const heliRun = (worldOpts, keys) => {
    const controller = speedHarness(Class, worldOpts);
    const helicopter = {
      position: { x: 0, y: 100, z: 0 }, heading: 0, speed: 0, verticalSpeed: 0,
      pitchAngle: 0, rollAngle: 0,
      tiltPivot: { rotation: { x: 0, z: 0 }, position: { y: 0 } }
    };
    controller.entities = { helicopter };
    Object.assign(controller.keys, keys);
    for (let i = 0; i < 3600; i++) controller.updateHelicopter(1 / 60, 0);
    return helicopter;
  };
  const taipeiOpts = { ...opts, speedScale: 2, heliVerticalScale: 5, heliCeiling: 750 };
  const climber = heliRun(taipeiOpts, { up: true });
  assert.ok(Math.abs(climber.verticalSpeed - 160) < 1e-6, 'Taipei ascend cap 160 m/s');
  assert.equal(climber.position.y, 750, 'Taipei ceiling clamps altitude at 750 m');
  const descender = heliRun(taipeiOpts, { down: true });
  assert.ok(Math.abs(descender.verticalSpeed + 160) < 1e-6, 'Taipei descend cap -160 m/s');
  const nyc = heliRun({ ...opts }, { up: true });
  assert.ok(Math.abs(nyc.verticalSpeed - 16) < 1e-6, 'no options: ascend cap stays 16 m/s');
  assert.equal(nyc.position.y, 380, 'no options: ceiling stays 380 m');
});

test('heli ceiling: teleport/restore altitude clamps to the world ceiling', async () => {
  const Class = loadManagerClass();
  const { opts } = await taipeiWorldOpts();
  const run = (worldOpts, savedAltitude) => {
    const controller = bareManager(Class, worldOpts);
    const position = (x = 0, y = 0, z = 0) => ({ x, y, z, copy(p) { this.x = p.x; this.y = p.y; this.z = p.z; } });
    const pivot = () => ({ position: position(), rotation: { x: 0, y: 0, z: 0 } });
    const ent = {
      type: 'helicopter', position: position(0, 100, 0), heading: 0, speed: 3, verticalSpeed: 2,
      pitchAngle: 0, rollAngle: 0, mesh: pivot(), tiltPivot: pivot()
    };
    controller.activeMode = 'helicopter';
    controller.entities = { helicopter: ent };
    controller.keys = Object.fromEntries(['forward', 'backward', 'left', 'right', 'up', 'down', 'boost'].map((a) => [a, false]));
    controller._pressedCodes = new Set();
    controller.resetInput = Class.prototype.resetInput;
    controller.teleportActiveTo(0, 0, 0, savedAltitude);
    return ent.position.y;
  };
  assert.equal(run({ ...opts, heliCeiling: 750 }, 900), 750, 'saved altitude above the Taipei ceiling clamps to 750 m');
  assert.equal(run({ ...opts, heliCeiling: 750 }, 700), 700, 'saved altitude under the ceiling is kept');
  assert.equal(run({ ...opts }, 900), 380, 'no option: restore clamps to the upstream 380 m');
});

test('taipei speedScale wiring (source contract)', () => {
  const boot = readFileSync(join(__dirname, '../js/taipei-boot.js'), 'utf8');
  assert.match(boot, /speedScale: 2/);
  assert.match(boot, /heliCeiling: 750/, 'tile boot raises the helicopter ceiling to 750 m');
  assert.match(boot, /heliVerticalScale: 5/, 'tile boot multiplies helicopter ascend/descend by 5');
  const main = readFileSync(join(__dirname, '../js/main.js'), 'utf8');
  assert.match(main, /controllerManager\.worldOpts\?\.speedScale/, 'HUD meter full scale follows the controller speedScale');
});

// --- excludeRects (issue #60): the union's dropped bands have no
// ground; ground modes are pushed out, the helicopter is not. ---

test('taipei world: the NE notch pushes ground modes out to its nearest edge', async () => {
  const Class = loadManagerClass();
  const { geodata, opts } = await taipeiWorldOpts();
  assert.equal(opts.excludeRects.length, 1, 'the A+B union has exactly one exclusion rect');
  const notch = opts.excludeRects[0];
  const taipei = bareManager(Class, opts);
  taipei.activeMode = 'person';

  // A point in the notch (old tile's Songshan fringe) nearer its
  // southern edge (lat 25.055) is pushed out through that edge.
  const pos = { x: 0, y: 0, z: notch.maxZ - 100 };
  taipei.resolveHorizontalCollision(pos, 0.48, 1);
  assert.ok(!(pos.x > notch.minX && pos.x < notch.maxX && pos.z > notch.minZ && pos.z < notch.maxZ),
    `pushed out of the notch, now at (${pos.x}, ${pos.z})`);
  assert.equal(pos.z, notch.maxZ, 'nearest edge is the notch south edge');

  // A point just inside the west edge is pushed west instead.
  const pos2 = { x: notch.minX + 5, y: 0, z: (notch.minZ + notch.maxZ) / 2 };
  taipei.resolveHorizontalCollision(pos2, 0.48, 1);
  assert.equal(pos2.x, notch.minX);

  // A point exactly ON an edge is not inside and stays put.
  const pos3 = { x: 0, y: 0, z: notch.maxZ };
  taipei.resolveHorizontalCollision(pos3, 0.48, 1);
  assert.deepEqual([pos3.x, pos3.z], [0, notch.maxZ]);

  // The helicopter flies over the notch freely.
  const heli = bareManager(Class, opts);
  heli.activeMode = 'helicopter';
  const pos4 = { x: 0, y: 100, z: geodata.frame.bbox.minZ + 100 };
  heli.resolveHorizontalCollision(pos4, 0.48, 1);
  assert.deepEqual([pos4.x, pos4.z], [0, geodata.frame.bbox.minZ + 100], 'helicopter is not pushed');
});

test('taipei world: without excludeRects the notch is reachable (NYC-style default)', async () => {
  const Class = loadManagerClass();
  const { geodata, opts } = await taipeiWorldOpts();
  const { excludeRects, ...noExcl } = opts;
  const m = bareManager(Class, noExcl);
  m.activeMode = 'person';
  const pos = { x: 0, y: 0, z: geodata.frame.bbox.minZ + 100 };
  m.resolveHorizontalCollision(pos, 0.48, 1);
  assert.deepEqual([pos.x, pos.z], [0, geodata.frame.bbox.minZ + 100]);
});

test('taipei-boot wires the tile world into main.js (source contract)', () => {
  const boot = readFileSync(join(__dirname, '../js/taipei-boot.js'), 'utf8');
  assert.match(boot, /export function controllerOptions\(tile, env = \{\}\)/);
  assert.match(boot, /bounds:\s*\{\s*minX: bb\.minX, maxX: bb\.maxX, minZ: bb\.minZ, maxZ: bb\.maxZ \}/);
  assert.match(boot, /clampToShore: false/);
  assert.match(boot, /groundHeight: \(\) => 0/);
  // Issue #60: the union's dropped bands reach the controllers.
  assert.match(boot, /excludeRects: unionExclusionRects\(tile\.geodata\.frame\.boxes, bb\)/);
  assert.match(source, /excludeRects: Array\.isArray\(opts\.excludeRects\)/);
  assert.match(boot, /spawnByMode:/);
  // Issue #12: on the WebGL fallback the tile boot swaps the avatar crowds
  // for CPU-posed figures; on WebGPU the factory stays null.
  assert.match(boot, /avatarFigureFactory: env\.webglFallback \? \(appearance\) => new AvatarFigure\(appearance\) : null/);
  const main = readFileSync(join(__dirname, '../js/main.js'), 'utf8');
  assert.match(main, /tileBoot\.controllerOptions\(activeTile, \{ webglFallback: renderer\.backend\?\.isWebGLBackend === true \}\)/);
  assert.match(main, /: undefined/);
});
