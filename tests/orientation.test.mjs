// Issue #62: per-block lot orientation — the planner turns a block's
// lot grid to the angle of the streets that front it.
//
// Pins:
//  - the angle source itself: blocks in the 七條通/Linsen district
//    derive that district's ~14° street angle, while blocks on the
//    Xinyi grid (within ~3° of the tile axes) derive 0 and keep the
//    axis grid;
//  - the turned lots' TRUE footprints (re-derived here from the
//    emitted x/z/w/d/rot, independently of the planner) intersect
//    no roadbed ribbon — the #65 audit only ever sees the axis
//    twin, so this is the test that watches the real geometry;
//  - every turned lot's true corners stay inside the tile union
//    and out of every park/water polygon.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { planTaipeiBuildings, buildFrontageIndex, blockOrientation, latLonToTile, pointInRing } from '../js/taipei-buildings.js';

const devDeg = (theta) => {
  const d = (theta * 180) / Math.PI;
  return Math.min(d, 90 - d);
};
function blocksNear(lat, lon, radius, minArea) {
  const [x, z] = latLonToTile(lat, lon, TAIPEI_GEO.frame.originLatLon);
  return TAIPEI_GEO.blocks.filter((b) => b.area >= minArea && Math.hypot(b.cx - x, b.cz - z) < radius);
}

test('angle source: angled districts derive their angle, grid districts keep the axis', () => {
  const index = buildFrontageIndex(TAIPEI_GEO.roadbeds);
  // Linsen / 七條通: the bar-district grid runs ~14° off the tile
  // axes (measured from the roadbeds: the blocks' resultants cluster
  // at 14–17° with coherence ~1.0).
  const linsen = blocksNear(25.0495, 121.5275, 260, 800);
  assert.ok(linsen.length >= 20, `sampled the district (${linsen.length} blocks)`);
  const angled = linsen.filter((b) => {
    const dev = devDeg(blockOrientation(index, b));
    return dev >= 8 && dev <= 22;
  });
  assert.ok(angled.length / linsen.length >= 0.6,
    `most Linsen blocks derive the district angle (${angled.length}/${linsen.length})`);
  // Xinyi core: a true grid within ~1° of the axes — every block
  // must keep the axis grid (theta exactly 0).
  const xinyi = blocksNear(25.036, 121.569, 260, 800);
  assert.ok(xinyi.length >= 4, `sampled the core (${xinyi.length} blocks)`);
  for (const b of xinyi) {
    assert.equal(blockOrientation(index, b), 0, `core block at ${b.cx},${b.cz} keeps the axis grid`);
  }
});

// --- independent geometry (mirrors tests/lot-road-overlap.test.mjs) ---
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
      rects.push({ poly: [[ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz], [ax - nx, az - nz]] });
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
// A turned lot's true footprint from the emitted plan data alone.
const turnedPoly = (lot) => {
  const c = Math.cos(lot.rot), s = Math.sin(lot.rot);
  const hw = lot.w / 2, hd = lot.d / 2;
  return [
    [lot.x + hw * c - hd * s, lot.z + hw * s + hd * c],
    [lot.x + hw * c + hd * s, lot.z + hw * s - hd * c],
    [lot.x - hw * c + hd * s, lot.z - hw * s - hd * c],
    [lot.x - hw * c - hd * s, lot.z - hw * s + hd * c],
  ];
};

test('the plan turns lots, and only where streets actually angle', (t) => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  t.diagnostic(`blocksRotated ${plan.stats.blocksRotated}, lotsRotated ${plan.stats.lotsRotated} of ${plan.lots.length} lots`);
  assert.ok(plan.stats.blocksRotated > 1000, `angled blocks turn (${plan.stats.blocksRotated})`);
  assert.ok(plan.stats.lotsRotated > 3000, `turned lots planted in real numbers (${plan.stats.lotsRotated})`);
  assert.equal(plan.lots.filter((l) => l.rot).length, plan.stats.lotsRotated, 'rot field matches the counter');
  for (const lot of plan.lots) {
    if (!lot.rot) continue;
    assert.ok(lot.rot > 0 && lot.rot < Math.PI / 2, 'rot is a frame angle in (0, 90°)');
    assert.ok(devDeg(lot.rot) > 2.9, `turned lot at ${lot.x},${lot.z} is past the axis epsilon (dev ${devDeg(lot.rot).toFixed(1)}°)`);
  }
});

test('turned lots: true footprints intersect no roadbed ribbon', () => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  const rects = segmentRects(TAIPEI_GEO);
  const g = buildGrid(rects);
  let checked = 0;
  for (const lot of plan.lots) {
    if (!lot.rot) continue;
    checked++;
    const poly = turnedPoly(lot);
    const bb = bboxOf(poly);
    for (const ri of candidatesFor(g, bb)) {
      const r = rects[ri];
      if (r.bb.maxX < bb.minX || r.bb.minX > bb.maxX || r.bb.maxZ < bb.minZ || r.bb.minZ > bb.maxZ) continue;
      const a = clipArea(poly, r.poly);
      assert.ok(a <= 0.05, `turned lot at ${lot.x},${lot.z} (rot ${lot.rot}) overlaps a roadbed by ${a.toFixed(2)} m²`);
    }
  }
  assert.ok(checked > 3000, `audited the turned lots (${checked})`);
});

test('turned lots: true corners stay in the union and out of parks/water', () => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  const boxes = TAIPEI_GEO.frame.boxes;
  const inUnion = (x, z) => boxes.some((b) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ);
  const ringPairs = (ring) => { const out = []; for (let i = 0; i + 1 < ring.length; i += 2) out.push([ring[i], ring[i + 1]]); return out; };
  const polys = [...(TAIPEI_GEO.parks || []), ...(TAIPEI_GEO.water || [])].map((p) => ({ ring: p.ring, bb: bboxOf(ringPairs(p.ring)) }));
  const polyHit = (x, z) => polys.some((p) => x >= p.bb.minX && x <= p.bb.maxX && z >= p.bb.minZ && z <= p.bb.maxZ && pointInRing(x, z, p.ring));
  for (const lot of plan.lots) {
    if (!lot.rot) continue;
    for (const [px, pz] of turnedPoly(lot)) {
      assert.ok(inUnion(px, pz), `turned lot corner (${px.toFixed(1)},${pz.toFixed(1)}) of lot at ${lot.x},${lot.z} leaves the union`);
      assert.ok(!polyHit(px, pz), `turned lot corner (${px.toFixed(1)},${pz.toFixed(1)}) of lot at ${lot.x},${lot.z} inside a park/water polygon`);
    }
  }
});
