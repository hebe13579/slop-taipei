// Issue #257: the National Taiwan Museum as a registry special.
//
// The pin is the OSM building outline's centroid (way 1050624691,
// 91.0 x 32.1 m, axis-aligned, in 228 Peace Memorial Park); the
// resolved tile position must land on it, the wall boxes must sit
// inside the outline, the portico must face north with six columns,
// the dome must top out at the published 30 m, the farParts must
// stay inside the near footprint, and the LOD swap must follow the
// 700 m out / 600 m back hysteresis. The park setting is pinned by
// the park ring containing the pin and by zero lots inside the
// site/plaza exclusion rects.
import assert from 'node:assert/strict';
import test from 'node:test';

import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { planTaipeiBuildings, updateSpecialLodGroup } from '../js/taipei-buildings.js';

// OSM outline (way 1050624691) in tile coords: x -5087.2..-4996.2,
// z -1097.8..-1065.7, centroid (-5040.9, -1081.9).
const OUTLINE = { minX: -5087.2, maxX: -4996.2, minZ: -1097.8, maxZ: -1065.7 };
const PIN = { x: -5040.9, z: -1081.9 };

function museum(plan) {
  const s = plan.landmarkTowers.find((t) => t.id === 'national-taiwan-museum');
  assert.ok(s, 'national-taiwan-museum missing from the plan');
  return s;
}

function partBox(s, part) {
  const cx = s.x + (part.dx || 0), cz = s.z + (part.dz || 0);
  if (part.type === 'box') return [cx - part.w / 2, cx + part.w / 2, cz - part.d / 2, cz + part.d / 2];
  if (part.type === 'cylinder') return [cx - part.r, cx + part.r, cz - part.r, cz + part.r];
  if (part.type === 'dome') return [cx - part.rx, cx + part.rx, cz - part.rz, cz + part.rz];
  return null;
}

function partTop(part) {
  return (part.y0 || 0) + (part.h || 0);
}

test('museum resolves on the OSM outline centroid with the published height', () => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  const s = museum(plan);
  assert.equal(s.lat, 25.042767);
  assert.equal(s.lon, 121.515052);
  assert.ok(Math.abs(s.x - PIN.x) <= 0.1, `x ${s.x} off the outline centroid`);
  assert.ok(Math.abs(s.z - PIN.z) <= 0.1, `z ${s.z} off the outline centroid`);
  assert.equal(s.realHeight, 30);
  assert.equal(s.parts.length, 28);
  assert.equal(s.farParts.length, 4);
});

test('museum wall boxes sit inside the OSM outline; portico projects north only', () => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  const s = museum(plan);
  // Wall boxes: pavilions, wings, hall, rear block, attic block.
  const wallBoxes = s.parts.filter((p) => p.type === 'box' && (p.y0 || 0) === 0 && p.h >= 13.5 && p.h <= 18.5);
  assert.equal(wallBoxes.length, 6);
  for (const part of wallBoxes) {
    const [x0, x1, z0, z1] = partBox(s, part);
    assert.ok(x0 >= OUTLINE.minX - 0.2 && x1 <= OUTLINE.maxX + 0.2, `wall box x ${x0}..${x1} escapes the outline`);
    assert.ok(z0 >= OUTLINE.minZ - 0.2 && z1 <= OUTLINE.maxZ + 0.2, `wall box z ${z0}..${z1} escapes the outline`);
  }
  // Nothing extends north past the bottom front step (z -1106.5),
  // which stays ~35 m clear of the Xiangyang Rd carriageway.
  for (const part of s.parts) {
    const b = partBox(s, part);
    assert.ok(b[2] >= -1106.6, `part extends north past the front steps: z0 ${b[2]}`);
  }
});

test('museum portico is a north-facing hexastyle with a fitted frieze sign', () => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  const s = museum(plan);
  const columns = s.parts.filter((p) => p.type === 'cylinder' && p.r === 0.75);
  assert.equal(columns.length, 6, 'the portico must have exactly 6 columns');
  const dzs = new Set(columns.map((c) => c.dz));
  assert.equal(dzs.size, 1, 'columns must share one line');
  const xs = columns.map((c) => c.dx).sort((a, b) => a - b);
  // 3.8 m bays with a wider 4.0 m central bay for the main doorway,
  // as on the real portico's central intercolumniation.
  const gaps = [3.8, 3.8, 4.0, 3.8, 3.8];
  for (let i = 1; i < xs.length; i++) {
    assert.ok(Math.abs(xs[i] - xs[i - 1] - gaps[i - 1]) < 0.01, `column spacing ${xs[i] - xs[i - 1]} is not ${gaps[i - 1]} m`);
  }
  // Columns stand north of the hall's north face (smaller z).
  const hall = s.parts.find((p) => p.type === 'box' && p.w === 23.3);
  const hallNorth = s.z + hall.dz - hall.d / 2;
  assert.ok(s.z + columns[0].dz < hallNorth, 'columns must stand proud of the hall face');
  // The frieze sign faces north (rotY pi) and sits on the
  // entablature's north face, within 0.5 m of it.
  const entablature = s.parts.find((p) => p.type === 'box' && p.w === 27 && (p.y0 || 0) === 12.8);
  const entNorth = s.z + entablature.dz - entablature.d / 2;
  assert.equal(s.sign.glyphs, 7);
  assert.equal(s.sign.rotY, Math.PI);
  assert.ok(Math.abs(s.z + s.sign.dz - entNorth) <= 0.5, 'frieze sign is not fitted to the entablature face');
});

test('museum dome tops out at 30 m and no part rises above it', () => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  const s = museum(plan);
  const dome = s.parts.find((p) => p.type === 'dome');
  assert.ok(dome, 'no dome part');
  assert.equal(partTop(dome), 30);
  assert.equal(dome.rx, 9);
  for (const part of s.parts) {
    assert.ok(partTop(part) <= 30 + 1e-9, `part tops out at ${partTop(part)} above the dome`);
  }
});

test('museum farParts stay inside the near footprint and simplify only', () => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  const s = museum(plan);
  const nearBoxes = s.parts.map((p) => partBox(s, p));
  const nx0 = Math.min(...nearBoxes.map((b) => b[0])), nx1 = Math.max(...nearBoxes.map((b) => b[1]));
  const nz0 = Math.min(...nearBoxes.map((b) => b[2])), nz1 = Math.max(...nearBoxes.map((b) => b[3]));
  for (const part of s.farParts) {
    assert.ok(['box', 'cylinder', 'dome'].includes(part.type), `far part type ${part.type} outside the LOD vocabulary`);
    const b = partBox(s, part);
    assert.ok(b[0] >= nx0 - 0.01 && b[1] <= nx1 + 0.01 && b[2] >= nz0 - 0.01 && b[3] <= nz1 + 0.01, 'far part escapes the near footprint');
    assert.ok(partTop(part) <= 30, 'far part tops out above the dome');
  }
  // No columns, steps or sign in the far version: no thin cylinders.
  assert.ok(!s.farParts.some((p) => p.type === 'cylinder' && p.r < 2), 'far version keeps thin members');
  const farDome = s.farParts.find((p) => p.type === 'dome');
  assert.equal(partTop(farDome), 30);
});

test('museum LOD swap follows the 700 m out / 600 m back hysteresis', () => {
  const near = { visible: true }, far = { visible: false };
  const group = { userData: { specialLod: [{ near, far, x: PIN.x, z: PIN.z, mode: 'near' }] } };
  updateSpecialLodGroup(group, PIN.x + 800, PIN.z);
  assert.equal(near.visible, false);
  assert.equal(far.visible, true);
  assert.equal(group.userData.specialLod[0].mode, 'far');
  // Inside the hysteresis band the far state holds.
  updateSpecialLodGroup(group, PIN.x + 650, PIN.z);
  assert.equal(near.visible, false);
  assert.equal(far.visible, true);
  // Back inside 600 m the near detail returns.
  updateSpecialLodGroup(group, PIN.x + 500, PIN.z);
  assert.equal(near.visible, true);
  assert.equal(far.visible, false);
  assert.equal(group.userData.specialLod[0].mode, 'near');
  // A group without specials LOD entries is a no-op, not a throw.
  updateSpecialLodGroup({ userData: {} }, 0, 0);
  updateSpecialLodGroup(null, 0, 0);
});

test('museum adds no lots and keeps the park setting: site, plaza and park ring', () => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  const s = museum(plan);
  assert.equal(plan.lots.length, 68570, 'museum site/plaza must not move the plan');
  assert.equal(plan.landmarkTowers.length, 39);
  for (const rect of s.sites) {
    const inside = plan.lots.filter((l) => l.x > rect.minX && l.x < rect.maxX && l.z > rect.minZ && l.z < rect.maxZ);
    assert.equal(inside.length, 0, `lot inside museum exclusion rect ${JSON.stringify(rect)}`);
  }
  // The park ring still contains the pin: the park is kept, not
  // flattened or cut around the building.
  const inRing = (ring, x, z) => {
    let inside = false;
    for (let i = 0, j = ring.length - 2; i < ring.length; i += 2) {
      const xi = ring[i], zi = ring[i + 1], xj = ring[j], zj = ring[j + 1];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
      j = i;
    }
    return inside;
  };
  const parkHit = (TAIPEI_GEO.parks || []).some((p) => p.ring && inRing(p.ring, s.x, s.z));
  assert.ok(parkHit, 'no park ring contains the museum pin — the park setting is lost');
});
