// js/taipei-pedestrians.js
// Issue #262: Taipei pedestrians — a runtime layer of simple
// low-poly people walking the walking network
// (js/taipei-pedestrian-network.js: one line per side per roadbed,
// offset by the bed's pedestrianLayout). Built and destroyed live
// from the settings gear, like traffic but independent of it: the
// vehicle env keeps pedestrians: false (the upstream pedestrian
// system is fed by NYC block data), and this layer never touches
// the vehicle system, the geodata, or the building plan.
//
// People are instanced box figures in the project's low-poly style
// — torso, head, two arms, two legs per person, six instanced
// meshes total — with a procedural stride (legs and arms swing,
// torso bobs; no skinned rig). A fixed pool recycles around the
// camera focus the way the traffic pool does: spawn within
// PEDESTRIAN_SPAWN_RADIUS_M, retire beyond the retire radius.
// Density/range are the layer's own constants — the gear row is a
// plain on/off switch (default off, like traffic), per issue #262's
// dispatch decision: own row, not the traffic sliders.
//
// People walk their lines and step onto any incident line at a
// junction node (corners and crossings); they do not interact with
// vehicles (no yielding either way) and the 小綠人 signal figures
// stay static — this layer animates people, not pictograms.

import * as THREE from 'three/webgpu';
import { TAIPEI_GEO } from './taipei-sandbox.js'; // sandbox wrapper: filtered when ?sandbox= is set
import { drapeHeight } from './taipei-drape.js'; // the ground the rendered streets sit on (0 when the drape is off)
import { buildPedestrianNetwork, linePointAt, PED_CELL_M } from './taipei-pedestrian-network.js';

export const PEDESTRIAN_COUNT = 220;
export const PEDESTRIAN_SPAWN_RADIUS_M = 320;
export const PEDESTRIAN_RETIRE_RADIUS_M = 370;
const MIN_SPAWN_DIST_M = 30; // never pop a person in right at the camera
const MAX_SPAWNS_PER_UPDATE = 8; // spread pop-in over a few frames

const networkCache = new WeakMap(); // geo object -> network (the sandbox wrapper swaps the object)
function pedestrianNetwork() {
  let net = networkCache.get(TAIPEI_GEO);
  if (!net) {
    net = buildPedestrianNetwork(TAIPEI_GEO);
    networkCache.set(TAIPEI_GEO, net);
  }
  return net;
}

const hash = (i, salt) => {
  const v = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

const TORSO_COLOURS = [0xb8503f, 0x3f5f8a, 0x4a7a52, 0xd9d3c3, 0x59555e, 0xc7a23a, 0x7a4a63, 0x2f6f6a, 0xe3e1da, 0x333a44];
const LEG_COLOURS = [0x2b2f36, 0x4a4238, 0x5a6270, 0x3a3f4a, 0x6b5a44];
const HEAD_COLOURS = [0xf2c9a4, 0xe8b48c, 0xd9a066, 0xc68850];

export function createTaipeiPedestrians(scene) {
  const network = pedestrianNetwork();
  const group = new THREE.Group();
  group.name = 'TaipeiPedestrians';

  // Figure parts, each an InstancedMesh with one slot per person.
  // Geometries are pre-translated so the instance origin is the
  // part's pivot: legs at the hip, arms at the shoulder, torso and
  // head at their bases.
  const legGeo = new THREE.BoxGeometry(0.17, 0.78, 0.19);
  legGeo.translate(0, -0.39, 0);
  const armGeo = new THREE.BoxGeometry(0.11, 0.62, 0.13);
  armGeo.translate(0, -0.31, 0);
  const torsoGeo = new THREE.BoxGeometry(0.44, 0.64, 0.25);
  torsoGeo.translate(0, 0.32, 0);
  const headGeo = new THREE.BoxGeometry(0.25, 0.27, 0.25);
  headGeo.translate(0, 0.135, 0);
  const mat = () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  const legs = new THREE.InstancedMesh(legGeo, mat(), PEDESTRIAN_COUNT * 2);
  const arms = new THREE.InstancedMesh(armGeo, mat(), PEDESTRIAN_COUNT * 2);
  const torsos = new THREE.InstancedMesh(torsoGeo, mat(), PEDESTRIAN_COUNT);
  const heads = new THREE.InstancedMesh(headGeo, mat(), PEDESTRIAN_COUNT);
  const colour = new THREE.Color();
  for (let i = 0; i < PEDESTRIAN_COUNT; i++) {
    torsos.setColorAt(i, colour.setHex(TORSO_COLOURS[Math.floor(hash(i, 11) * TORSO_COLOURS.length)]));
    heads.setColorAt(i, colour.setHex(HEAD_COLOURS[Math.floor(hash(i, 12) * HEAD_COLOURS.length)]));
    const leg = colour.setHex(LEG_COLOURS[Math.floor(hash(i, 13) * LEG_COLOURS.length)]);
    legs.setColorAt(i * 2, leg);
    legs.setColorAt(i * 2 + 1, leg);
    const arm = colour.setHex(TORSO_COLOURS[Math.floor(hash(i, 11) * TORSO_COLOURS.length)]).multiplyScalar(0.85);
    arms.setColorAt(i * 2, arm);
    arms.setColorAt(i * 2 + 1, arm);
  }
  for (const m of [legs, arms, torsos, heads]) {
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    group.add(m);
  }
  torsos.castShadow = true;
  heads.castShadow = true;

  const peds = [];
  for (let i = 0; i < PEDESTRIAN_COUNT; i++) {
    peds.push({
      placed: false, line: -1, s: 0, dir: 1,
      speed: 1.1 + hash(i, 3) * 0.5,
      phase: hash(i, 5) * Math.PI * 2,
      scale: 0.92 + hash(i, 4) * 0.13,
      x: 0, z: 0, heading: 0,
    });
  }

  const dummy = new THREE.Object3D();
  dummy.rotation.order = 'YXZ';
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const hide = (i) => {
    torsos.setMatrixAt(i, zero);
    heads.setMatrixAt(i, zero);
    legs.setMatrixAt(i * 2, zero);
    legs.setMatrixAt(i * 2 + 1, zero);
    arms.setMatrixAt(i * 2, zero);
    arms.setMatrixAt(i * 2 + 1, zero);
  };
  for (let i = 0; i < PEDESTRIAN_COUNT; i++) hide(i);

  // Candidate lines near the focus, from the network's spatial
  // hash; rebuilt when the focus crosses into another cell ring.
  let candCellX = Infinity, candCellZ = Infinity, candidates = [];
  const refreshCandidates = (fx, fz) => {
    const cx = Math.floor(fx / PED_CELL_M), cz = Math.floor(fz / PED_CELL_M);
    if (cx === candCellX && cz === candCellZ) return;
    candCellX = cx; candCellZ = cz;
    const span = Math.ceil(PEDESTRIAN_RETIRE_RADIUS_M / PED_CELL_M);
    const seen = new Set();
    candidates = [];
    for (let ix = cx - span; ix <= cx + span; ix++) {
      for (let iz = cz - span; iz <= cz + span; iz++) {
        for (const li of network.cells.get(`${ix},${iz}`) || []) {
          if (!seen.has(li)) { seen.add(li); candidates.push(li); }
        }
      }
    }
  };

  const trySpawn = (p, fx, fz) => {
    for (let attempt = 0; attempt < 10 && candidates.length; attempt++) {
      const li = candidates[Math.floor(Math.random() * candidates.length)];
      const line = network.lines[li];
      const s = Math.random() * line.len;
      const pt = linePointAt(line, s);
      const d = Math.hypot(pt.x - fx, pt.z - fz);
      if (d < MIN_SPAWN_DIST_M || d > PEDESTRIAN_SPAWN_RADIUS_M) continue;
      p.line = li; p.s = s; p.dir = Math.random() < 0.5 ? 1 : -1;
      p.x = pt.x; p.z = pt.z; p.placed = true;
      return true;
    }
    return false;
  };

  // Step onto a connected line at the node the walker just reached,
  // preferring the exit whose direction best continues the current
  // heading (a straight-on sidewalk beats a turn, a turn beats
  // crossing to the far side), with noise so crowds do not lockstep.
  const advanceLine = (p, hx, hz) => {
    const line = network.lines[p.line];
    const node = network.nodes[p.dir > 0 ? line.toNode : line.fromNode];
    const arrivedEnd = p.dir > 0 ? 1 : 0;
    let best = null, bestScore = -Infinity;
    for (const e of node.ends) {
      if (e.line === p.line && e.end === arrivedEnd) continue;
      const nl = network.lines[e.line];
      const away = e.end === 0 ? linePointAt(nl, 0) : linePointAt(nl, nl.len);
      const ax = e.end === 0 ? away.dx : -away.dx;
      const az = e.end === 0 ? away.dz : -away.dz;
      const score = ax * hx + az * hz + Math.random() * 0.7 - (e.line === p.line ? 2 : 0);
      if (score > bestScore) { bestScore = score; best = e; }
    }
    if (!best) { // dead end: turn around on the same line
      p.dir = -p.dir;
      p.s = Math.max(0, Math.min(line.len, p.s));
      return;
    }
    p.line = best.line;
    if (best.end === 0) { p.s = 0; p.dir = 1; } else { p.s = network.lines[best.line].len; p.dir = -1; }
  };

  const writeFigure = (i, p) => {
    const k = p.scale;
    const y0 = drapeHeight(p.x, p.z);
    const swing = Math.sin(p.phase) * 0.55;
    const bob = Math.abs(Math.cos(p.phase)) * 0.05;
    const hipY = y0 + 0.78 * k + bob * 0.4;
    const sin = Math.sin(p.heading), cos = Math.cos(p.heading);
    // right vector in the facing frame
    const rx = cos, rz = -sin;
    dummy.rotation.set(0, p.heading, 0);
    dummy.scale.setScalar(k);
    dummy.position.set(p.x, hipY, p.z);
    dummy.updateMatrix();
    torsos.setMatrixAt(i, dummy.matrix);
    dummy.position.set(p.x, hipY + 0.66 * k + bob, p.z);
    dummy.updateMatrix();
    heads.setMatrixAt(i, dummy.matrix);
    for (const sideSign of [-1, 1]) {
      const slot = i * 2 + (sideSign < 0 ? 0 : 1);
      const sw = sideSign < 0 ? swing : -swing;
      dummy.rotation.set(sw, p.heading, 0);
      dummy.position.set(p.x + rx * 0.10 * k * sideSign, hipY, p.z + rz * 0.10 * k * sideSign);
      dummy.updateMatrix();
      legs.setMatrixAt(slot, dummy.matrix);
      dummy.rotation.set(-sw * 0.7, p.heading, 0);
      dummy.position.set(p.x + rx * 0.28 * k * sideSign, hipY + 0.58 * k + bob, p.z + rz * 0.28 * k * sideSign);
      dummy.updateMatrix();
      arms.setMatrixAt(slot, dummy.matrix);
    }
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(1);
  };

  let disposed = false;
  const update = (dt, focusX, focusZ) => {
    if (disposed) return;
    const step = Math.max(0, Math.min(dt || 0, 0.05));
    refreshCandidates(focusX, focusZ);
    let spawns = 0;
    for (let i = 0; i < PEDESTRIAN_COUNT; i++) {
      const p = peds[i];
      if (p.placed) {
        const d = Math.hypot(p.x - focusX, p.z - focusZ);
        if (d > PEDESTRIAN_RETIRE_RADIUS_M) { p.placed = false; hide(i); continue; }
        if (step > 0) {
          p.s += p.dir * p.speed * step;
          p.phase += step * p.speed * 3.6;
          const line = network.lines[p.line];
          if (p.s < 0 || p.s > line.len) {
            const pt0 = linePointAt(line, Math.max(0, Math.min(line.len, p.s)));
            advanceLine(p, pt0.dx * p.dir, pt0.dz * p.dir);
          }
          const pt = linePointAt(network.lines[p.line], p.s);
          p.x = pt.x; p.z = pt.z;
          p.heading = Math.atan2(pt.dx * p.dir, pt.dz * p.dir);
        }
        writeFigure(i, p);
      } else if (spawns < MAX_SPAWNS_PER_UPDATE) {
        if (trySpawn(p, focusX, focusZ)) { spawns++; writeFigure(i, p); }
      }
    }
    torsos.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
    legs.instanceMatrix.needsUpdate = true;
    arms.instanceMatrix.needsUpdate = true;
  };

  scene.add(group);

  return {
    group,
    update,
    stats: () => ({
      placed: peds.reduce((a, p) => a + (p.placed ? 1 : 0), 0),
      total: PEDESTRIAN_COUNT,
      lines: network.stats.lines,
      nodes: network.stats.nodes,
    }),
    dispose: () => {
      disposed = true;
      scene.remove(group);
      for (const m of [legs, arms, torsos, heads]) {
        m.geometry.dispose();
        m.material.dispose();
      }
    },
  };
}
