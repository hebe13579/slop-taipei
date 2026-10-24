// Issue #65 regression: planned lots never intersect roadbeds, and
// never stand in a divided road's median span.
//
// The pre-#65 planner sampled a lot's centre and four corners against
// ribbon centrelines; a ribbon slicing a lot through two edges (a
// diagonal lane crossing a block bbox's concave notch) touches
// neither, and 2,606 of the 2,621 lot∩roadbed intersections citywide
// were exactly that case. The planner now tests exactly (margin-grown
// footprint vs per-segment butt-cap rectangles — the same rectangles
// the renderer draws, half = max(width/2, 0.75)); this test re-derives
// the intersection independently and requires zero area citywide.
//
// The median half: where a boulevard's carriageways are separate
// roadbeds (Dunhua's fast lanes, slow lanes and their planted
// separators), the strip between them intersects NO ribbon, so the
// intersection test alone cannot see the lot columns that stood on
// the Dunhua medians. The planner drops a lot flanked on opposite
// sides by same-name carriageway ribbons (each edge within 20 m,
// measured at the ribbon's true crossing of the lot's centre line —
// a slanted segment's bbox overhangs its rect and is not a
// substitute). This test re-derives that flank condition
// independently and requires zero such lots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { planTaipeiBuildings } from '../js/taipei-buildings.js';

function segmentRects(geo) {
  const rects = [];
  for (const bed of geo.roadbeds || []) {
    const half = Math.max((bed.width || 3) / 2, 0.75);
    const pts = bed.pts;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3];
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
      if (len < 0.01) continue;
      const nx = (-dz / len) * half, nz = (dx / len) * half;
      rects.push({
        name: bed.name || '',
        poly: [[ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz], [ax - nx, az - nz]],
      });
    }
  }
  return rects;
}
function clipArea(subject, clip) {
  let poly = subject;
  for (let i = 0; i < clip.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const inside = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) <= 1e-9;
    const inter = (p, q) => {
      const d1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
      const d2 = (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]);
      const t = d1 / (d1 - d2);
      return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    };
    const out = [];
    for (let j = 0; j < poly.length; j++) {
      const cur = poly[j], prev = poly[(j + poly.length - 1) % poly.length];
      if (inside(cur)) { if (!inside(prev)) out.push(inter(prev, cur)); out.push(cur); }
      else if (inside(prev)) out.push(inter(prev, cur));
    }
    poly = out;
    if (!poly.length) return 0;
  }
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i], [x2, z2] = poly[(i + 1) % poly.length];
    area += x1 * z2 - x2 * z1;
  }
  return Math.abs(area / 2);
}
const bboxOf = (poly) => {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of poly) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minZ, maxZ };
};
function buildGrid(items) {
  const CELL = 64, grid = new Map();
  const key = (gx, gz) => gx * 100003 + gz;
  items.forEach((it, idx) => {
    const bb = bboxOf(it.poly);
    it.bb = bb;
    for (let gx = Math.floor(bb.minX / CELL); gx <= Math.floor(bb.maxX / CELL); gx++)
      for (let gz = Math.floor(bb.minZ / CELL); gz <= Math.floor(bb.maxZ / CELL); gz++) {
        const k = key(gx, gz);
        let b = grid.get(k);
        if (!b) grid.set(k, b = []);
        b.push(idx);
      }
  });
  return { grid, key, CELL };
}
function candidatesFor(g, bb) {
  const seen = new Set();
  for (let gx = Math.floor(bb.minX / g.CELL); gx <= Math.floor(bb.maxX / g.CELL); gx++)
    for (let gz = Math.floor(bb.minZ / g.CELL); gz <= Math.floor(bb.maxZ / g.CELL); gz++) {
      const b = g.grid.get(g.key(gx, gz));
      if (b) for (const i of b) seen.add(i);
    }
  return seen;
}
// Interval where a polygon crosses the horizontal line z (or null).
function spanAtZ(poly, z) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const x1 = poly[j][0], z1 = poly[j][1], x2 = poly[i][0], z2 = poly[i][1];
    if (z1 === z) { if (x1 < lo) lo = x1; if (x1 > hi) hi = x1; }
    if ((z1 < z && z2 > z) || (z2 < z && z1 > z)) {
      const x = x1 + ((z - z1) * (x2 - x1)) / (z2 - z1);
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
  }
  return lo <= hi ? [lo, hi] : null;
}
function spanAtX(poly, x) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const x1 = poly[j][0], z1 = poly[j][1], x2 = poly[i][0], z2 = poly[i][1];
    if (x1 === x) { if (z1 < lo) lo = z1; if (z1 > hi) hi = z1; }
    if ((x1 < x && x2 > x) || (x2 < x && x1 > x)) {
      const z = z1 + ((x - x1) * (z2 - z1)) / (x2 - x1);
      if (z < lo) lo = z;
      if (z > hi) hi = z;
    }
  }
  return lo <= hi ? [lo, hi] : null;
}
const lotPoly = (lot) => {
  const hw = lot.w / 2, hd = lot.d / 2;
  return [[lot.x - hw, lot.z - hd], [lot.x + hw, lot.z - hd], [lot.x + hw, lot.z + hd], [lot.x - hw, lot.z + hd]];
};

const GAP_MAX = 20; // mirrors CORRIDOR_GAP_MAX_M in js/taipei-buildings.js

test('planned lots never intersect roadbed ribbons (issue #65)', () => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  const rects = segmentRects(TAIPEI_GEO);
  const g = buildGrid(rects);
  assert.ok(plan.lots.length > 5000, `city still planned (${plan.lots.length} lots)`);
  for (const lot of plan.lots) {
    const poly = lotPoly(lot);
    const bb = bboxOf(poly);
    for (const ri of candidatesFor(g, bb)) {
      const r = rects[ri];
      if (r.bb.maxX < bb.minX || r.bb.minX > bb.maxX || r.bb.maxZ < bb.minZ || r.bb.minZ > bb.maxZ) continue;
      const a = clipArea(poly, r.poly);
      assert.ok(a <= 0.05, `lot at ${lot.x},${lot.z} overlaps roadbed "${r.name}" by ${a.toFixed(2)} m²`);
    }
  }
});

test('no planned lot stands in a divided road median span (issue #65)', () => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  const rects = segmentRects(TAIPEI_GEO).filter((r) => r.name);
  const g = buildGrid(rects);
  // The corridor-gap rule must actually be firing on this data —
  // Dunhua's three sections alone contributed ~92 median lots before
  // the fix; a dead rule would show up here as a zero.
  assert.ok(plan.stats.lotsDroppedMedian > 50, `median rule firing (dropped ${plan.stats.lotsDroppedMedian})`);
  for (const lot of plan.lots) {
    const minX = lot.x - lot.w / 2, maxX = lot.x + lot.w / 2;
    const minZ = lot.z - lot.d / 2, maxZ = lot.z + lot.d / 2;
    // Nearby rects: the lot's bbox grown by GAP_MAX on every side.
    const near = { minX: minX - GAP_MAX, maxX: maxX + GAP_MAX, minZ: minZ - GAP_MAX, maxZ: maxZ + GAP_MAX };
    const west = new Map(), east = new Map(), north = new Map(), south = new Map();
    for (const ri of candidatesFor(g, near)) {
      const r = rects[ri];
      if (r.bb.maxX < near.minX || r.bb.minX > near.maxX || r.bb.maxZ < near.minZ || r.bb.minZ > near.maxZ) continue;
      const spanZ = spanAtZ(r.poly, lot.z);
      if (spanZ) {
        if (spanZ[1] <= minX + 0.5) {
          const d = minX - spanZ[1];
          if (d < (west.get(r.name) ?? Infinity)) west.set(r.name, d);
        }
        if (spanZ[0] >= maxX - 0.5) {
          const d = spanZ[0] - maxX;
          if (d < (east.get(r.name) ?? Infinity)) east.set(r.name, d);
        }
      }
      const spanX = spanAtX(r.poly, lot.x);
      if (spanX) {
        if (spanX[1] <= minZ + 0.5) {
          const d = minZ - spanX[1];
          if (d < (north.get(r.name) ?? Infinity)) north.set(r.name, d);
        }
        if (spanX[0] >= maxZ - 0.5) {
          const d = spanX[0] - maxZ;
          if (d < (south.get(r.name) ?? Infinity)) south.set(r.name, d);
        }
      }
    }
    for (const [name, d] of west) {
      assert.ok(!(d <= GAP_MAX && (east.get(name) ?? Infinity) <= GAP_MAX),
        `lot at ${lot.x},${lot.z} stands in the median span of "${name}"`);
    }
    for (const [name, d] of north) {
      assert.ok(!(d <= GAP_MAX && (south.get(name) ?? Infinity) <= GAP_MAX),
        `lot at ${lot.x},${lot.z} stands in the median span of "${name}"`);
    }
  }
});
