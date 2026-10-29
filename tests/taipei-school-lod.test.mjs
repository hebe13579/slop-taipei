import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import {
  planTaipeiBuildings,
  updateSchoolLod,
  domeTriangleCount,
  SCHOOL_DOME_WIDTH_SEGMENTS,
  SCHOOL_DOME_HEIGHT_SEGMENTS,
  SCHOOL_LOD_FAR_DOME_WIDTH_SEGMENTS,
  SCHOOL_LOD_FAR_DOME_HEIGHT_SEGMENTS,
  SCHOOL_LOD_FAR_M,
  SCHOOL_LOD_NEAR_M,
} from '../js/taipei-buildings.js';

const plan = planTaipeiBuildings(TAIPEI_GEO);
const schools = plan.siteStructures.filter((s) => s.school);

// The renderer (createTaipeiLandmarkTowers) diverts exactly these
// parts into instanced trees: trunks are cylinders in the single
// trunk colour, canopies are domes in one of the three canopy colours.
// The colour constants live in the planner; the signatures below are
// the values it emits (kept in sync by the pairing test).
const TRUNK_COLOR = 0x6b4f35;
const CANOPY_COLORS = new Set([0x4a7038, 0x557c40, 0x3d6335]);
const isTrunk = (p) => p.type === 'cylinder' && p.flat === TRUNK_COLOR;
const isCanopy = (p) => p.type === 'dome' && typeof p.flat === 'number' && CANOPY_COLORS.has(p.flat) && !p.flip;
// A 24-segment closed cylinder: 24 quad sides + 2 fans of 24.
const CYLINDER_24_TRIS = 96;

test('far swap: hysteresis band, sticky inside it, swaps both ways', () => {
  const near = { visible: true }, far = { visible: false };
  const entries = [{ near, far, x: 0, z: 0, mode: 'near' }];
  assert.ok(SCHOOL_LOD_FAR_M > SCHOOL_LOD_NEAR_M, 'the hysteresis band is non-empty');
  updateSchoolLod(entries, 10, 10);
  assert.equal(entries[0].mode, 'near');
  updateSchoolLod(entries, SCHOOL_LOD_FAR_M + 50, 0);
  assert.equal(entries[0].mode, 'far');
  assert.equal(near.visible, false);
  assert.equal(far.visible, true);
  updateSchoolLod(entries, (SCHOOL_LOD_FAR_M + SCHOOL_LOD_NEAR_M) / 2, 0);
  assert.equal(entries[0].mode, 'far', 'inside the band the mode sticks');
  updateSchoolLod(entries, SCHOOL_LOD_NEAR_M - 50, 0);
  assert.equal(entries[0].mode, 'near');
  assert.equal(near.visible, true);
  assert.equal(far.visible, false);
  updateSchoolLod(entries, 0, 0);
  assert.equal(entries[0].mode, 'near', 'no-op when already near');
});

test('every school campus carries trees, paired trunk + canopy', () => {
  assert.equal(schools.length, 196, 'campus count pinned (issue #221)');
  for (const s of schools) {
    const trunks = s.parts.filter(isTrunk).length;
    const canopies = s.parts.filter(isCanopy).length;
    assert.ok(trunks > 0, `${s.id} has trees (the LOD entry exists)`);
    assert.equal(trunks, canopies, `${s.id}: every trunk pairs with a canopy`);
    assert.ok(s.parts.every((p) => ['box', 'cylinder', 'dome'].includes(p.type)),
      `${s.id}: only mergeable part types (no frustum/ridge/wheel)`);
  }
});

test('far representation: tri budget pinned, most of the tree cost goes away', () => {
  assert.ok(domeTriangleCount(SCHOOL_DOME_WIDTH_SEGMENTS, SCHOOL_DOME_HEIGHT_SEGMENTS) === 756);
  assert.ok(domeTriangleCount(SCHOOL_LOD_FAR_DOME_WIDTH_SEGMENTS, SCHOOL_LOD_FAR_DOME_HEIGHT_SEGMENTS) === 132);
  let trunks = 0, canopies = 0;
  for (const s of schools) {
    trunks += s.parts.filter(isTrunk).length;
    canopies += s.parts.filter(isCanopy).length;
  }
  const nearTreeTris = trunks * CYLINDER_24_TRIS + canopies * 756;
  const farTreeTris = canopies * 132; // trunks dropped far: sub-pixel past 700 m
  assert.equal(trunks, 2538, 'trunk count pinned');
  assert.equal(canopies, 2538, 'canopy count pinned');
  assert.equal(nearTreeTris, 2162376, 'near tree tris (the bulk of the 2.27M school total)');
  assert.equal(farTreeTris, 335016, 'far tree tris');
  assert.ok(farTreeTris < nearTreeTris * 0.2, 'far trees cost under a fifth of near trees');
  // Note: the plan carries 3,090 cylinders in total — the other 552
  // are track-end discs and similar non-tree parts, which merge as
  // ordinary parts and are not diverted into tree instancing.
});

test('far swap keeps every campus visible: no campus drops out', () => {
  // The swap toggles tree groups only; slabs, track, fences and
  // gates are shared between near and far and never hide. The
  // entries the builder stashes are one per campus with trees:
  // assert the plan side of that contract — every campus has a
  // plan position and tree parts, so every campus gets an entry.
  for (const s of schools) {
    assert.equal(typeof s.x, 'number');
    assert.equal(typeof s.z, 'number');
    assert.ok(s.parts.some(isTrunk) && s.parts.some(isCanopy));
  }
});
