const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

// Issue #12 regression coverage. The two single-person PersonCrowds
// (walk-mode avatar, cyclist rider) skin from a storage buffer via
// pose.element(computedIndex); three r187dev's WebGL2 backend miscompiles
// those reads (every read collapses to one unindexed per-vertex attribute
// fetch), so on WebGL-fallback clients the avatars garble into screen-size
// streaks. Tile mode therefore swaps the avatar crowds for CPU-posed
// figures (js/avatar-figure.js) when the renderer is on the WebGL backend.
// These tests pin: (1) the figure's joint math against the rig's bind pose,
// (2) the controllers' wiring — figure only when a factory is supplied,
// crowd otherwise (the NYC default must stay byte-for-byte the old path).

const figureSource = readFileSync(join(__dirname, '../js/avatar-figure.js'), 'utf8');
const controllersSource = readFileSync(join(__dirname, '../js/controllers.js'), 'utf8');

// ---- minimal THREE stand-ins (only what the modules touch) ----
class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
}
class Quat {
  constructor() { this.x = 0; this.y = 0; this.z = 0; this.w = 1; }
  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  copy(q) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; }
  setFromUnitVectors(up, dir) { this.alignedTo = dir; return this; }
}
class Obj3 {
  constructor() {
    this.children = [];
    this.position = new V3();
    this.quaternion = new Quat();
    this.scale = new V3(1, 1, 1);
  }
  add(...kids) { this.children.push(...kids); }
  traverse(fn) { fn(this); for (const c of this.children) c.traverse?.(fn); }
}
class MeshStub extends Obj3 {
  constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; this.isMesh = true; }
}
const threeStub = {
  Vector3: V3,
  Quaternion: Quat,
  Group: Obj3,
  Mesh: MeshStub,
  BoxGeometry: class { },
  SphereGeometry: class { },
  PlaneGeometry: class { rotateX() { return this; } },
  MeshStandardNodeMaterial: class { constructor(opts) { Object.assign(this, opts); } }
};

function loadFigure() {
  return loadModule(figureSource, { imports: { 'three/webgpu': threeStub } });
}

// Male bind-pose joints (pedestrians.js bindJoints).
const BIND_JOINTS = [
  [0, 0.96, 0],        // PELVIS
  [0, 1.12, -0.01],    // CHEST
  [0, 1.52, -0.012],   // HEAD
  [0.185, 1.43, -0.015],               // UPPER_ARM_L (shoulder)
  [0.185 + Math.sin(0.14) * 0.3, 1.43 - Math.cos(0.14) * 0.3, -0.015], // FOREARM_L (elbow)
  [-0.185, 1.43, -0.015],              // UPPER_ARM_R
  [-(0.185 + Math.sin(0.14) * 0.3), 1.43 - Math.cos(0.14) * 0.3, -0.015], // FOREARM_R
  [0.09, 0.92, 0],     // THIGH_L (hip)
  [0.09, 0.50, 0],     // SHIN_L (knee)
  [0.09, 0.08, 0],     // FOOT_L (ankle)
  [0.09, 0.02, 0.135], // TOE_L
  [-0.09, 0.92, 0],    // THIGH_R
  [-0.09, 0.50, 0],    // SHIN_R
  [-0.09, 0.08, 0],    // FOOT_R
  [-0.09, 0.02, 0.135] // TOE_R
];

function qrot([qx, qy, qz, qw], [vx, vy, vz]) {
  const cx = qy * vz - qz * vy + qw * vx;
  const cy = qz * vx - qx * vz + qw * vy;
  const cz = qx * vy - qy * vx + qw * vz;
  return [vx + 2 * (qy * cz - qz * cy), vy + 2 * (qz * cx - qx * cz), vz + 2 * (qx * cy - qy * cx)];
}

// A PersonRig pose buffer (124 floats) in writeBone format: per bone the
// quat plus translation = joint - q * bind * s (NOT the joint itself), for
// a person standing in bind pose at the given offset. quats: {bone: quat}.
function bindPose(dx = 0, dy = 0, dz = 0, quats = {}) {
  const pose = new Float32Array(124);
  BIND_JOINTS.forEach((bind, bone) => {
    const o = bone * 8;
    const q = quats[bone] || [0, 0, 0, 1];
    const joint = [bind[0] + dx, bind[1] + dy, bind[2] + dz];
    const r = qrot(q, bind);
    pose[o] = q[0]; pose[o + 1] = q[1]; pose[o + 2] = q[2]; pose[o + 3] = q[3];
    pose[o + 4] = joint[0] - r[0]; pose[o + 5] = joint[1] - r[1]; pose[o + 6] = joint[2] - r[2];
    pose[o + 7] = 1; // scale
  });
  pose[120] = 4.2; // info: seed, female=0, girth, hair
  pose[122] = 1.02;
  pose[123] = 0.18;
  return pose;
}

function close(actual, expected, eps = 1e-4) {
  assert.equal(actual.length, expected.length);
  actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) <= eps, `${actual} != ${expected}`));
}

test('poseJoints: bind pose yields the rig joints plus projected wrist/head centre', () => {
  const { poseJoints } = loadFigure();
  const j = poseJoints(bindPose(10, 0, 20));
  close(j.pelvis, [10, 0.96, 20]);
  close(j.chest, [10, 1.12, 19.99]);
  close(j.headBase, [10, 1.52, 19.988]);
  close(j.headCentre, [10, 1.635, 19.988]);
  close(j.shoulderL, [10.185, 1.43, 19.985]);
  close(j.elbowL, [10.2268, 1.1329, 19.985]);
  // wrist = elbow + (sin 0.14, -cos 0.14, 0) * 0.375 along the forearm frame
  close(j.wristL, [10.2268 + Math.sin(0.14) * 0.375, 1.1329 - Math.cos(0.14) * 0.375, 19.985]);
  close(j.wristR, [9.7732 - Math.sin(0.14) * 0.375, 1.1329 - Math.cos(0.14) * 0.375, 19.985]);
  close(j.hipL, [10.09, 0.92, 20]);
  close(j.kneeL, [10.09, 0.50, 20]);
  close(j.ankleL, [10.09, 0.08, 20]);
  close(j.toeL, [10.09, 0.02, 20.135]);
  assert.equal(j.scale, 1);
});

test('poseJoints: bone quats steer the projected joints (head up, forearm reach)', () => {
  const { poseJoints } = loadFigure();
  const s = Math.sin(Math.PI / 4), c = Math.cos(Math.PI / 4);
  // HEAD and FOREARM_L bones pitched 90 deg about X, joints kept at bind:
  // head centre swings from +Y to +Z, wrist reach from -Y to -Z.
  const pose = bindPose(0, 0, 0, { 2: [s, 0, 0, c], 4: [s, 0, 0, c] });
  const j = poseJoints(pose);
  close(j.headCentre, [0, 1.52, -0.012 + 0.115], 1e-5);
  const d = [Math.sin(0.14), 0, -Math.cos(0.14)];
  const elbowL = [0.185 + Math.sin(0.14) * 0.3, 1.43 - Math.cos(0.14) * 0.3, -0.015];
  close(j.wristL, [elbowL[0] + d[0] * 0.375, elbowL[1], elbowL[2] + d[2] * 0.375], 1e-5);
  for (const v of Object.values(j)) {
    if (Array.isArray(v)) assert.ok(v.every(Number.isFinite), 'all joints finite');
  }
});

test('segmentTransform: midpoint, unit direction, length', () => {
  const { segmentTransform } = loadFigure();
  const t = segmentTransform([0, 0, 0], [0, 2, 0]);
  close(t.mid, [0, 1, 0]);
  close(t.dir, [0, 1, 0]);
  assert.equal(t.length, 2);
  const t2 = segmentTransform([1, 1, 1], [1, 1, 1]);
  assert.ok(t2.dir.every(Number.isFinite), 'degenerate segment stays finite');
});

test('AvatarFigure: builds segments + head and poses them from a rig pose', () => {
  const { AvatarFigure } = loadFigure();
  const fig = new AvatarFigure({ seed: 4.2, girth: 1.02, hair: 0.18 });
  assert.equal(fig.group.children.length, 14, '13 segments + head group');
  fig.poseFromRig({ pose: bindPose(3, 0, -7) });
  const hips = fig.segments.hips.mesh;
  close([hips.position.x, hips.position.y, hips.position.z], [3, (0.96 + 1.12) / 2, -7.005]);
  assert.ok(Math.abs(hips.scale.y - Math.hypot(0.16, 0.01)) < 1e-6, 'segment length = joint distance');
  close([fig.headGroup.position.x, fig.headGroup.position.y, fig.headGroup.position.z], [3, 1.52, -7.012]);
  const thigh = fig.segments.thighL.mesh;
  close([thigh.position.x, thigh.position.y, thigh.position.z], [3.09, (0.92 + 0.50) / 2, -7]);
});

// ---- controllers wiring ----

function loadManagerClass() {
  const crowdInstances = [];
  class PersonCrowdStub {
    constructor(n, opts) { this.meshes = [{}, {}]; crowdInstances.push(this); }
    begin() { } add() { } end() { }
  }
  class PersonRigStub { constructor(opts) { this.opts = opts; this.pose = new Float32Array(124); } }
  const window = {
    listeners: new Map(),
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
  };
  const { ThirdPersonControllerManager } = loadModule(controllersSource, {
    globals: { window, document: { ...window, hidden: false } },
    imports: {
      'three/webgpu': threeStub,
      './city-config.js': {
        streetZ: () => 0,
        isTypingInField: () => false,
        ISLAND_BOUNDS: { minX: -500, maxX: 500, minZ: -500, maxZ: 500, sidewalkHeight: 0.22 },
        CENTRAL_PARK_BOUNDS: { minX: -3000, maxX: -2800, minZ: 200, maxZ: 500 },
        getIslandBoundsAtZ: () => ({ westX: -500, eastX: 500 }),
        blockAt: () => null
      },
      './tsl-materials.js': { cityUniforms: {}, createCarPaintMaterial: () => ({}), createContactShadowMaterial: () => ({}) },
      './actor-models.js': {},
      './pedestrians.js': { PersonCrowd: PersonCrowdStub, PersonRig: PersonRigStub },
      './vehicle-lights.js': {},
      './landmarks.js': {}
    }
  });
  return { ThirdPersonControllerManager, crowdInstances };
}

function bareManager(Class, worldOpts) {
  const controller = Object.create(Class.prototype);
  controller.scene = { added: [], add(o) { this.added.push(o); } };
  controller.worldOpts = worldOpts;
  controller.colliders = [];
  return controller;
}

test('controllers: person entity uses the figure factory when supplied, crowd otherwise', () => {
  const { ThirdPersonControllerManager: Class, crowdInstances } = loadManagerClass();

  const fakeFigure = { group: { name: 'fake-figure' }, poseFromRig() { } };
  const withFactory = bareManager(Class, { avatarFigureFactory: () => fakeFigure });
  const entA = withFactory.createPersonEntity();
  assert.equal(entA.figure, fakeFigure);
  assert.equal(entA.crowd, null);
  assert.ok(withFactory.scene.added.includes(fakeFigure.group), 'figure group added to the scene');
  assert.equal(crowdInstances.length, 0, 'no crowd constructed on the figure path');

  // NYC default (no factory): the skinned crowd path, unchanged.
  const nyc = bareManager(Class, {});
  const entB = nyc.createPersonEntity();
  assert.equal(entB.figure, null);
  assert.ok(entB.crowd, 'crowd constructed without a factory');
  assert.equal(crowdInstances.length, 1);
  assert.equal(nyc.scene.added.length, 3, 'two crowd LOD meshes + entity root added');
});

test('controllers: poseCharacters drives figure vs crowd per entity', () => {
  const { ThirdPersonControllerManager: Class } = loadManagerClass();
  const calls = [];
  const rigStub = (name) => ({
    pose: new Float32Array(124),
    update() { calls.push(`${name}.update`); },
    ride() { calls.push(`${name}.ride`); },
    headQuaternion: new Quat(),
    headPosition: new V3()
  });
  const crowdStub = (name) => ({
    begin() { calls.push(`${name}.begin`); },
    add() { calls.push(`${name}.add`); },
    end() { calls.push(`${name}.end`); }
  });
  const figureStub = (name) => ({ poseFromRig() { calls.push(`${name}.figure`); } });
  const helmetStub = () => ({
    quaternion: { copy() { } },
    position: { set() { return { applyQuaternion() { return { add() { } }; } }; } }
  });
  const manager = bareManager(Class, { groundHeight: () => 0 });
  manager.entities = {
    person: {
      position: new V3(0, 0, 0), heading: 0,
      rig: rigStub('person'), crowd: crowdStub('person'), figure: figureStub('person')
    },
    cyclist: {
      leanPivot: {}, pedalPhase: 0, bikeFrame: {},
      riderRig: rigStub('rider'), riderCrowd: crowdStub('rider'), riderFigure: figureStub('rider'),
      helmet: helmetStub()
    }
  };
  manager.poseCharacters(0.016);
  assert.deepEqual(calls, ['person.update', 'person.figure', 'rider.ride', 'rider.figure'],
    'figure path: rigs still update/ride, figures pose, crowds untouched');

  calls.length = 0;
  manager.entities.person.figure = null;
  manager.entities.cyclist.riderFigure = null;
  manager.poseCharacters(0.016);
  assert.deepEqual(calls, [
    'person.update', 'person.begin', 'person.add', 'person.end',
    'rider.ride', 'rider.begin', 'rider.add', 'rider.end'
  ], 'crowd path (NYC default): the original begin/add/end sequence');
});
