import test from 'node:test';
import assert from 'node:assert/strict';

// Issue #60: the Taipei tile is a UNION of boxes (tools/taipei/
// tile-boxes.json). These tests pin the union contract end to end:
//   - the generated frame carries the boxes and the bounding rect;
//   - every generated coordinate and every raster block stays inside
//     the union (the dropped bands carry no data at all);
//   - the exclusion rects the controllers clamp against are exactly
//     the north-east notch for the A+B base;
//   - the building planner never plans a lot outside the union;
//   - the in-game map's land shape is the boxes, not the bbox.

import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { pointInBoxes, unionExclusionRects, clipRectToBoxes } from '../js/taipei-union.js';
import { planTaipeiBuildings } from '../js/taipei-buildings.js';
import { buildTileMapModel } from '../js/tile-map.js';
import { TAIPEI_TILE } from '../js/taipei-tile.js';

const bb = TAIPEI_GEO.frame.bbox;
const boxes = TAIPEI_GEO.frame.boxes;

test('frame carries the A+B boxes and their bounding rect', () => {
  assert.ok(Array.isArray(boxes) && boxes.length === 2, 'two boxes in the base footprint');
  const [a, b] = boxes;
  // Box A: lon 121.503..121.580, lat 25.0285..25.055; Box B: the west
  // column lon 121.503..121.535 up to lat 25.060 (world frame values
  // from the builder's own frame math, ±1 m).
  assert.ok(Math.abs(a.minX - -6257.2) < 1 && Math.abs(a.maxX - 1513.8) < 1, `box A x span ${a.minX}..${a.maxX}`);
  assert.ok(Math.abs(a.maxZ - 498.5) < 1, `box A south edge ${a.maxZ}`);
  assert.ok(Math.abs(b.maxX - -3027.7) < 1, `box B east edge ${b.maxX}`);
  assert.ok(Math.abs(b.minZ - -2990.9) < 1, `box B north edge ${b.minZ}`);
  assert.equal(a.minZ, b.maxZ, 'the boxes abut on the shared lat 25.055 edge');
  assert.equal(bb.minX, Math.min(a.minX, b.minX));
  assert.equal(bb.maxX, Math.max(a.maxX, b.maxX));
  assert.equal(bb.minZ, Math.min(a.minZ, b.minZ));
  assert.equal(bb.maxZ, Math.max(a.maxZ, b.maxZ));
});

test('unionExclusionRects: the A+B base has exactly the NE notch', () => {
  const rects = unionExclusionRects(boxes, bb);
  assert.equal(rects.length, 1, `expected one exclusion rect, got ${JSON.stringify(rects)}`);
  const [r] = rects;
  assert.ok(Math.abs(r.minX - -3027.7) < 1, 'notch west edge = lon 121.535');
  assert.equal(r.maxX, bb.maxX);
  assert.equal(r.minZ, bb.minZ);
  assert.ok(Math.abs(r.maxZ - boxes[0].minZ) < 0.01, 'notch south edge = box A north edge (lat 25.055)');
  // Abutting full coverage -> no exclusions; no boxes -> no exclusions.
  assert.deepEqual(unionExclusionRects([bb], bb), []);
  assert.deepEqual(unionExclusionRects(null, bb), []);
  assert.deepEqual(unionExclusionRects([], bb), []);
});

test('every generated ring, run and block stays inside the union', (t) => {
  let checked = 0;
  const checkPt = (x, z, what) => {
    checked++;
    assert.ok(pointInBoxes(x, z, boxes), `${what} point (${x}, ${z}) is outside the union`);
  };
  for (const p of [...TAIPEI_GEO.parks, ...TAIPEI_GEO.water]) {
    for (let i = 0; i + 1 < p.ring.length; i += 2) checkPt(p.ring[i], p.ring[i + 1], `${p.name || 'polygon'}`);
  }
  for (const r of TAIPEI_GEO.roads) for (let i = 0; i + 1 < r.pts.length; i += 2) checkPt(r.pts[i], r.pts[i + 1], `road ${r.name || r.id}`);
  for (const r of TAIPEI_GEO.roadbeds) for (let i = 0; i + 1 < r.pts.length; i += 2) checkPt(r.pts[i], r.pts[i + 1], `roadbed ${r.name || ''}`);
  for (const b of TAIPEI_GEO.blocks) checkPt(b.cx, b.cz, 'block centroid');
  t.diagnostic(`union containment: ${checked} points inside the union`);
});

test('the dropped bands really are empty of data', () => {
  // South band (lat < 25.0285): Da\'an Forest Park is fully in, but
  // nothing may sit south of box A\'s south edge.
  for (const b of TAIPEI_GEO.blocks) assert.ok(b.cz <= boxes[0].maxZ + 1, 'no block centroid in the south band');
  // NE notch: no block centroid north of lat 25.055 east of lon 121.535.
  for (const b of TAIPEI_GEO.blocks) {
    assert.ok(!(b.cx > boxes[1].maxX && b.cz < boxes[0].minZ), `block centroid (${b.cx}, ${b.cz}) in the NE notch`);
  }
});

test('clipRectToBoxes keeps only in-union pieces', () => {
  // A rect straddling the notch corner keeps its two in-union pieces.
  const straddle = { minX: -3100, maxX: -2900, minZ: boxes[0].minZ - 100, maxZ: boxes[0].minZ + 100 };
  const pieces = clipRectToBoxes(straddle, boxes);
  assert.equal(pieces.length, 2);
  for (const p of pieces) {
    assert.ok(pointInBoxes((p.minX + p.maxX) / 2, (p.minZ + p.maxZ) / 2, boxes));
  }
  // A rect fully inside the notch clips to nothing.
  assert.deepEqual(clipRectToBoxes({ minX: 0, maxX: 100, minZ: bb.minZ + 10, maxZ: boxes[0].minZ - 10 }, boxes), []);
});

test('the building plan never leaves the union', (t) => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  t.diagnostic(`plan: ${plan.lots.length} lots; union stats ${JSON.stringify({
    blocksSkippedOutsideUnion: plan.stats.blocksSkippedOutsideUnion,
    lotsDroppedOutsideUnion: plan.stats.lotsDroppedOutsideUnion,
  })}`);
  for (const lot of plan.lots) {
    assert.ok(pointInBoxes(lot.x, lot.z, boxes), `lot centre (${lot.x}, ${lot.z}) outside the union`);
    for (const [ox, oz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      assert.ok(
        pointInBoxes(lot.x + (ox * lot.w) / 2, lot.z + (oz * lot.d) / 2, boxes),
        `lot corner outside the union (lot at ${lot.x}, ${lot.z})`);
    }
  }
});

test('the tile map land shape is the boxes, not the bounding rect', () => {
  const model = buildTileMapModel(TAIPEI_TILE);
  assert.deepEqual(model.landRects, boxes.map((b) => ({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ })));
  // Model bounds still span the union bounding rect (view fitting).
  assert.deepEqual(model.bounds, { minX: bb.minX, maxX: bb.maxX, minZ: bb.minZ, maxZ: bb.maxZ });
});
