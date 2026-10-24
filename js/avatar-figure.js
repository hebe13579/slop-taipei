import * as THREE from 'three/webgpu';

// js/avatar-figure.js
// A CPU-posed low-poly stand-in for the two single-person PersonCrowds of
// js/controllers.js (the walk-mode player avatar and the cyclist's rider).
//
// Why this exists (issue #12): PersonCrowd's material reads its pose from a
// storage buffer with computed indices (pose.element(instanceIndex * STRIDE
// + bone)). three r187dev's WebGL2 backend miscompiles those reads — the
// generated GLSL collapses every element() read into one unindexed
// per-vertex attribute fetch, discarding the index — so on any client that
// falls back from WebGPU to WebGL2 (this project's headless VM, and the
// user's Android phone) the skinned avatars garble into giant streaks that
// tank the frame rate. The same pattern renders correctly on real WebGPU,
// which is why upstream never sees it. Rather than rewrite the crowd
// material (shared with NYC's 340-pedestrian crowd), tile mode swaps ONLY
// its two avatar crowds for this figure whenever the renderer reports the
// WebGL backend: plain meshes posed on the CPU from the same PersonRig
// pose buffer the crowd would have consumed, so the gait, the riding pose
// and the helmet alignment are unchanged — only the rendering tech differs.
// On a real WebGPU renderer nothing changes anywhere (see taipei-boot.js).

// Bone indices in the PersonRig pose buffer (mirrors BONE in pedestrians.js;
// each bone is 8 floats: quaternion xyzw, translation xyz, scale).
const BONE = {
  PELVIS: 0, CHEST: 1, HEAD: 2,
  UPPER_ARM_L: 3, FOREARM_L: 4, UPPER_ARM_R: 5, FOREARM_R: 6,
  THIGH_L: 7, SHIN_L: 8, FOOT_L: 9, TOE_L: 10,
  THIGH_R: 11, SHIN_R: 12, FOOT_R: 13, TOE_R: 14
};

// The forearm bone's local frame points its -Y along the arm at bind; the
// arm hangs at ARM_BIND_ABDUCTION (pedestrians.js) from vertical, so the
// elbow->wrist direction in bone space is (side * sin, -cos, 0) of that
// angle, extended past the wrist into the hand.
const ARM_ABDUCTION = 0.14;
const FOREARM_REACH = 0.375; // FOREARM (0.255) + most of the hand

function quatRotate(qx, qy, qz, qw, vx, vy, vz) {
  // v + 2 * cross(q.xyz, cross(q.xyz, v) + v * q.w)
  const cx = qy * vz - qz * vy + qw * vx;
  const cy = qz * vx - qx * vz + qw * vy;
  const cz = qx * vy - qy * vx + qw * vz;
  return [
    vx + 2 * (qy * cz - qz * cy),
    vy + 2 * (qz * cx - qx * cz),
    vz + 2 * (qx * cy - qy * cx)
  ];
}

function boneQuat(pose, bone) {
  const o = bone * 8;
  return [pose[o], pose[o + 1], pose[o + 2], pose[o + 3]];
}

// Bind-pose joint positions (metres, person at the origin facing +Z) —
// mirrors bindJoints() in pedestrians.js. The pose buffer does NOT store
// joint positions: writeBone stores translation = joint - q * bind * s
// (so the shader can transform bind-space vertices with q * v + t). The
// world joint is recovered by adding the rotated bind offset back.
function bindJoints(female) {
  const sh = female ? [0.165, 1.415] : [0.185, 1.43];
  const ax = Math.sin(ARM_ABDUCTION) * 0.3; // UPPER_ARM
  const ay = -Math.cos(ARM_ABDUCTION) * 0.3;
  const j = [];
  j[BONE.PELVIS] = [0, 0.96, 0];
  j[BONE.CHEST] = [0, 1.12, -0.01];
  j[BONE.HEAD] = [0, 1.52, -0.012];
  for (const [side, sign] of [[BONE.UPPER_ARM_L, 1], [BONE.UPPER_ARM_R, -1]]) {
    j[side] = [sign * sh[0], sh[1], -0.015];
  }
  j[BONE.FOREARM_L] = [sh[0] + ax, sh[1] + ay, -0.015];
  j[BONE.FOREARM_R] = [-(sh[0] + ax), sh[1] + ay, -0.015];
  j[BONE.THIGH_L] = [0.09, 0.92, 0];
  j[BONE.THIGH_R] = [-0.09, 0.92, 0];
  j[BONE.SHIN_L] = [0.09, 0.50, 0];
  j[BONE.SHIN_R] = [-0.09, 0.50, 0];
  j[BONE.FOOT_L] = [0.09, 0.08, 0];
  j[BONE.FOOT_R] = [-0.09, 0.08, 0];
  j[BONE.TOE_L] = [0.09, 0.02, 0.135];
  j[BONE.TOE_R] = [-0.09, 0.02, 0.135];
  return j;
}

function boneJoint(pose, bind, bone, s) {
  const o = bone * 8;
  const q = boneQuat(pose, bone);
  const b = bind[bone];
  const r = quatRotate(q[0], q[1], q[2], q[3], b[0] * s, b[1] * s, b[2] * s);
  return [pose[o + 4] + r[0], pose[o + 5] + r[1], pose[o + 6] + r[2]];
}

// Joint world positions implied by a PersonRig pose buffer. Pure array math
// (exported for unit tests): every joint is recovered from its bone (see
// bindJoints above), except the wrists (projected from the elbow along the
// forearm bone's frame) and the head centre (projected up the head bone's
// frame).
export function poseJoints(pose) {
  const s = pose[BONE.PELVIS * 8 + 7] || 1;
  const female = pose[121] > 0.5; // info vec4 at floats 120..123: (seed, female, girth, hair)
  const bind = bindJoints(female);
  const joints = {
    pelvis: boneJoint(pose, bind, BONE.PELVIS, s),
    chest: boneJoint(pose, bind, BONE.CHEST, s),
    headBase: boneJoint(pose, bind, BONE.HEAD, s),
    shoulderL: boneJoint(pose, bind, BONE.UPPER_ARM_L, s),
    elbowL: boneJoint(pose, bind, BONE.FOREARM_L, s),
    shoulderR: boneJoint(pose, bind, BONE.UPPER_ARM_R, s),
    elbowR: boneJoint(pose, bind, BONE.FOREARM_R, s),
    hipL: boneJoint(pose, bind, BONE.THIGH_L, s),
    kneeL: boneJoint(pose, bind, BONE.SHIN_L, s),
    ankleL: boneJoint(pose, bind, BONE.FOOT_L, s),
    toeL: boneJoint(pose, bind, BONE.TOE_L, s),
    hipR: boneJoint(pose, bind, BONE.THIGH_R, s),
    kneeR: boneJoint(pose, bind, BONE.SHIN_R, s),
    ankleR: boneJoint(pose, bind, BONE.FOOT_R, s),
    toeR: boneJoint(pose, bind, BONE.TOE_R, s),
    scale: s,
    headQuat: boneQuat(pose, BONE.HEAD)
  };
  for (const side of ['L', 'R']) {
    const sign = side === 'L' ? 1 : -1;
    const elbow = joints[`elbow${side}`];
    const q = boneQuat(pose, side === 'L' ? BONE.FOREARM_L : BONE.FOREARM_R);
    const d = quatRotate(q[0], q[1], q[2], q[3],
      sign * Math.sin(ARM_ABDUCTION), -Math.cos(ARM_ABDUCTION), 0);
    joints[`wrist${side}`] = [
      elbow[0] + d[0] * FOREARM_REACH * s,
      elbow[1] + d[1] * FOREARM_REACH * s,
      elbow[2] + d[2] * FOREARM_REACH * s
    ];
  }
  const hq = joints.headQuat;
  const up = quatRotate(hq[0], hq[1], hq[2], hq[3], 0, 1, 0);
  joints.headCentre = [
    joints.headBase[0] + up[0] * 0.115 * s,
    joints.headBase[1] + up[1] * 0.115 * s,
    joints.headBase[2] + up[2] * 0.115 * s
  ];
  return joints;
}

// Midpoint / direction / length of the segment a->b (pure, for tests).
export function segmentTransform(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const length = Math.hypot(dx, dy, dz) || 1e-6;
  return {
    mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
    dir: [dx / length, dy / length, dz / length],
    length
  };
}

// Palettes mirror pedestrians.js so the figure reads as the same person the
// skinned material would have drawn for this seed.
const SKIN_COLORS = [0xc68863, 0xa96f4c, 0x8a5535, 0x6b3d24, 0xd9a077];
const HAIR_COLORS = [0x1a1512, 0x3a2a1a, 0x584022, 0x6e6862, 0x2a2624, 0x8f6d43, 0x5e3020];
const COAT_COLORS = [0x2b3a52, 0x33332f, 0x8a6a44, 0x5a2f2f, 0x4f5238, 0x6a6a66, 0x222024, 0x7d3f22];
const LEG_COLORS = [0x22242c, 0x35485b, 0x51473d, 0x7c7160, 0x252526];
const SHOE_COLOR = 0x2a2a2e;

function lane(seed, salt) {
  const v = Math.sin(seed + salt * 12.9898) * 43758.5453;
  return v - Math.floor(v);
}
const pick = (palette, seed, salt) => palette[Math.floor(lane(seed, salt) * palette.length) % palette.length];

const UP = new THREE.Vector3(0, 1, 0);

// One box segment between two joints, re-posed every frame. Segments are
// world-space (the group sits at the origin), exactly like the crowd's
// world-space skinning.
class Segment {
  constructor(geometry, material, thickness) {
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.thickness = thickness;
    this.dirVec = new THREE.Vector3();
  }

  pose(a, b, girth) {
    const t = segmentTransform(a, b);
    this.mesh.position.set(t.mid[0], t.mid[1], t.mid[2]);
    this.dirVec.set(t.dir[0], t.dir[1], t.dir[2]);
    this.mesh.quaternion.setFromUnitVectors(UP, this.dirVec);
    this.mesh.scale.set(this.thickness * girth, t.length, this.thickness * 0.82 * girth);
  }
}

export class AvatarFigure {
  // `appearance` mirrors the PersonRig options ({seed, scale, girth, hair});
  // scale is already baked into the rig's pose translations, so only the
  // seed/girth/hair shape this figure.
  constructor({ seed = 1, girth = 1.0, hair = 0.15 } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'AvatarFigure';
    this.girth = girth;

    const mat = (hex) => new THREE.MeshStandardNodeMaterial({ color: hex, roughness: 0.92, metalness: 0 });
    const skinMat = mat(pick(SKIN_COLORS, seed, 17.0));
    const hairMat = mat(pick(HAIR_COLORS, seed, 3.0));
    const coatMat = mat(pick(COAT_COLORS, seed, 29.0));
    const legMat = mat(pick(LEG_COLORS, seed, 47.0));
    const shoeMat = mat(SHOE_COLOR);

    const box = new THREE.BoxGeometry(1, 1, 1);
    const seg = (material, thickness) => {
      const sgm = new Segment(box, material, thickness);
      this.group.add(sgm.mesh);
      return sgm;
    };
    this.segments = {
      hips: seg(coatMat, 0.30),
      torso: seg(coatMat, 0.27),
      shoulders: seg(coatMat, 0.095),
      upperArmL: seg(coatMat, 0.088),
      upperArmR: seg(coatMat, 0.088),
      forearmL: seg(skinMat, 0.07),
      forearmR: seg(skinMat, 0.07),
      thighL: seg(legMat, 0.135),
      thighR: seg(legMat, 0.135),
      shinL: seg(legMat, 0.105),
      shinR: seg(legMat, 0.105),
      footL: seg(shoeMat, 0.085),
      footR: seg(shoeMat, 0.085)
    };

    // Head: skull + hair mass in a small group riding the head bone's frame.
    this.headGroup = new THREE.Group();
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.102, 14, 12), skinMat);
    skull.castShadow = true;
    skull.position.y = 0.115;
    this.headGroup.add(skull);
    if (hair > 0.02) {
      const hairMesh = new THREE.Mesh(new THREE.SphereGeometry(0.107, 14, 12), hairMat);
      hairMesh.castShadow = true;
      hairMesh.scale.set(1.0, 0.78 + hair * 0.5, 1.0);
      hairMesh.position.set(0, 0.115 + 0.028 + hair * 0.02, -0.014 - hair * 0.03);
      this.headGroup.add(hairMesh);
    }
    this.group.add(this.headGroup);
    this.headQuat = new THREE.Quaternion();
  }

  // Pose every segment from a PersonRig's current pose buffer (the rig has
  // already been updated / ridden for this frame by the controllers).
  poseFromRig(rig) {
    const j = poseJoints(rig.pose);
    const g = this.girth * (j.scale || 1);
    const S = this.segments;
    S.hips.pose(j.pelvis, j.chest, g);
    S.torso.pose(j.chest, j.headBase, g);
    S.shoulders.pose(j.shoulderL, j.shoulderR, g);
    S.upperArmL.pose(j.shoulderL, j.elbowL, g);
    S.upperArmR.pose(j.shoulderR, j.elbowR, g);
    S.forearmL.pose(j.elbowL, j.wristL, g);
    S.forearmR.pose(j.elbowR, j.wristR, g);
    S.thighL.pose(j.hipL, j.kneeL, g);
    S.thighR.pose(j.hipR, j.kneeR, g);
    S.shinL.pose(j.kneeL, j.ankleL, g);
    S.shinR.pose(j.kneeR, j.ankleR, g);
    S.footL.pose(j.ankleL, j.toeL, g);
    S.footR.pose(j.ankleR, j.toeR, g);
    this.headGroup.position.set(j.headBase[0], j.headBase[1], j.headBase[2]);
    this.headQuat.set(j.headQuat[0], j.headQuat[1], j.headQuat[2], j.headQuat[3]);
    this.headGroup.quaternion.copy(this.headQuat);
    const hs = j.scale || 1;
    this.headGroup.scale.set(hs, hs, hs);
  }
}
