import test from 'node:test';
import assert from 'node:assert/strict';

// Issue #60: the Taipei tile is a UNION of boxes (tools/taipei/
// tile-boxes.json). These tests pin the union contract end to end:
//   - the generated frame carries the boxes and the bounding rect;
//   - every generated coordinate and every raster block stays inside
//     the union (the dropped bands carry no data at all);
//   - the exclusion rects the controllers clamp against are exactly
//     the complement of the box union (one NE notch for the A+B
//     base; five rects since issue #102 added the northern boxes);
//   - the building planner never plans a lot outside the union;
//   - the in-game map's land shape is the boxes, not the bbox.

import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { pointInBoxes, unionExclusionRects, clipRectToBoxes } from '../js/taipei-union.js';
import { planTaipeiBuildings } from '../js/taipei-buildings.js';
import { buildTileMapModel } from '../js/tile-map.js';
import { TAIPEI_TILE } from '../js/taipei-tile.js';

const bb = TAIPEI_GEO.frame.bbox;
const boxes = TAIPEI_GEO.frame.boxes;

test('frame carries the five boxes and their bounding rect', () => {
  // Issue #102 (northern phase 1), FINAL footprint per amendment 2
  // (user, 2026-10-24 23:42 — the live footprint is frozen as the
  // base): live A + live B (whole, exactly as PR #70 shipped it) +
  // the 3-corridor + the 4-beitou Guandu box + the 5-incinerator
  // connector. The southern band from the original #102 text was
  // removed by the user, and the core-ne-notch restore was
  // reversed (the notch was never live, so it is not added).
  assert.ok(Array.isArray(boxes) && boxes.length === 5, 'five boxes in the phase-1 footprint');
  const byName = Object.fromEntries(boxes.map((b) => [b.name, b]));
  const [a, b, cor, bei, inc] = [byName.A, byName.B, byName['3-corridor'], byName['4-beitou'], byName['5-incinerator']];
  assert.ok(a && b && cor && bei && inc, 'boxes A, B, 3-corridor, 4-beitou, 5-incinerator all present');
  // World frame values from the builder's own frame math, ±1 m.
  assert.ok(Math.abs(a.minX - -6257.2) < 1 && Math.abs(a.maxX - 1513.8) < 1, `box A x span ${a.minX}..${a.maxX}`);
  assert.ok(Math.abs(a.maxZ - 498.5) < 1, `box A south edge ${a.maxZ}`);
  // Box B exactly as live: lon 121.503..121.535, lat 25.055..25.060.
  assert.ok(Math.abs(b.maxX - -3027.7) < 1, `box B east edge ${b.maxX} = lon 121.535`);
  assert.ok(Math.abs(b.minZ - -2990.9) < 1, `box B north edge ${b.minZ} = lat 25.060`);
  assert.ok(Math.abs(cor.maxX - -3229.5) < 1, `corridor east edge ${cor.maxX} = lon 121.533`);
  assert.ok(Math.abs(cor.minZ - -11077.3) < 1, `corridor north edge ${cor.minZ} = lat 25.133`);
  assert.ok(Math.abs(bei.minX - -10193.2) < 1 && Math.abs(bei.maxX - -5550.8) < 1, `beitou x span ${bei.minX}..${bei.maxX}`);
  assert.ok(Math.abs(bei.minZ - -12960.5) < 1 && Math.abs(bei.maxZ - -8861.9) < 1, `beitou z span ${bei.minZ}..${bei.maxZ} (lat 25.150..25.113)`);
  assert.ok(Math.abs(inc.minX - -7165.5) < 1 && Math.abs(inc.maxZ - -7864.9) < 1, `connector span ${inc.minX}..${inc.maxX} / ${inc.minZ}..${inc.maxZ}`);
  // Abutments and the one deliberate overlap: A and B abut on the
  // shared lat 25.055 edge; the corridor starts on the same edge
  // and OVERLAPS B in 121.503..121.533 x 25.055..25.060 (union
  // semantics — amendment 2: B's ground stays whole, the corridor
  // does not absorb it); the connector abuts the corridor's west
  // edge and Beitou's south edge (lat 25.113).
  assert.equal(a.minZ, b.maxZ, 'A and B abut on the shared lat 25.055 edge');
  assert.equal(a.minZ, cor.maxZ, 'the corridor starts on the shared lat 25.055 edge');
  assert.equal(cor.minX, inc.maxX, 'the connector abuts the corridor on lon 121.503');
  assert.equal(bei.maxZ, inc.minZ, 'the connector abuts Beitou on the shared lat 25.113 edge');
  assert.equal(bb.minX, Math.min(...boxes.map((b) => b.minX)));
  assert.equal(bb.maxX, Math.max(...boxes.map((b) => b.maxX)));
  assert.equal(bb.minZ, Math.min(...boxes.map((b) => b.minZ)));
  assert.equal(bb.maxZ, Math.max(...boxes.map((b) => b.maxZ)));
});

test('unionExclusionRects: the five-box union leaves exactly five exclusion rects', () => {
  // Re-pinned for issue #102 (final footprint, amendment 2): five
  // rects — the north strip east of Beitou, the NE notch east of
  // the corridor, the strip east of B above A (the A+B era's own
  // notch, back because the notch box was NOT added), and the
  // L-shaped west notch beside the connector/corridor in two
  // strips. The rects are computed from the frame (coordinate
  // compression over the box edges), so this pins the computed
  // geometry itself.
  const rects = unionExclusionRects(boxes, bb);
  assert.equal(rects.length, 5, `expected five exclusion rects, got ${JSON.stringify(rects)}`);
  const near = (r, minX, maxX, minZ, maxZ) =>
    Math.abs(r.minX - minX) < 1 && Math.abs(r.maxX - maxX) < 1 && Math.abs(r.minZ - minZ) < 1 && Math.abs(r.maxZ - maxZ) < 1;
  assert.ok(rects.some((r) => near(r, -5550.8, 1513.8, -12960.5, -11077.3)), 'north strip east of Beitou (above the corridor)');
  assert.ok(rects.some((r) => near(r, -3229.5, 1513.8, -11077.3, -2990.9)), 'NE notch east of the corridor (west edge = lon 121.533)');
  assert.ok(rects.some((r) => near(r, -3027.7, 1513.8, -2990.9, -2437)), 'strip east of B, north of A (the live tile notch)');
  assert.ok(rects.some((r) => near(r, -10193.2, -7165.5, -8861.9, 498.5)), 'west notch, north strip (west of the connector)');
  assert.ok(rects.some((r) => near(r, -7165.5, -6257.2, -7864.9, 498.5)), 'west notch, south strip (west of the corridor/A)');
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
  // The dropped bands of the five-box union are exactly the five
  // exclusion rects. Nothing may sit in any of them — no block
  // centroid, no roadbed vertex.
  const rects = unionExclusionRects(boxes, bb);
  const inRect = (x, z, r) => x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ;
  for (const b of TAIPEI_GEO.blocks)
    for (const r of rects) assert.ok(!inRect(b.cx, b.cz, r), `block centroid (${b.cx}, ${b.cz}) in an exclusion rect`);
  for (const bed of TAIPEI_GEO.roadbeds)
    for (let i = 0; i + 1 < bed.pts.length; i += 2)
      for (const r of rects) assert.ok(!inRect(bed.pts[i], bed.pts[i + 1], r), `roadbed ${bed.name || ''} vertex in an exclusion rect`);
  // Amendment 2's other direction (no live ground lost): B's
  // eastern sliver — lon 121.533..121.535 x lat 25.055..25.060 —
  // is LIVE ground and must still carry its data (baseline census:
  // 28 roadbeds / 20 blocks in the strip). Assert presence, the
  // mirror image of the emptiness sweep above.
  const sliverBeds = TAIPEI_GEO.roadbeds.filter((bed) => {
    const cx = bed.pts.reduce((s, v, i) => (i % 2 === 0 ? s + v : s), 0) / (bed.pts.length / 2);
    const cz = bed.pts.reduce((s, v, i) => (i % 2 === 1 ? s + v : s), 0) / (bed.pts.length / 2);
    return cx > -3229.5 && cx < -3027.7 && cz < -2437 && cz > -2990.9;
  });
  assert.ok(sliverBeds.length >= 20, `B sliver still carries its roadbeds (${sliverBeds.length})`);
  const sliverBlocks = TAIPEI_GEO.blocks.filter((b) => b.cx > -3229.5 && b.cx < -3027.7 && b.cz < -2437 && b.cz > -2990.9);
  assert.ok(sliverBlocks.length >= 15, `B sliver still carries its blocks (${sliverBlocks.length})`);
});

test('clipRectToBoxes keeps only in-union pieces', () => {
  // A rect straddling the notch corner between Beitou's east edge
  // and the corridor's north edge (the inside corner at
  // (-5550.8, -11077.3)) keeps its two in-union pieces: one in
  // 4-beitou (west), one in 3-corridor (south).
  const straddle = { minX: -5800, maxX: -5300, minZ: -11200, maxZ: -10900 };
  const pieces = clipRectToBoxes(straddle, boxes);
  assert.equal(pieces.length, 2);
  for (const p of pieces) {
    assert.ok(pointInBoxes((p.minX + p.maxX) / 2, (p.minZ + p.maxZ) / 2, boxes));
  }
  // A rect fully inside the NE notch clips to nothing.
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
