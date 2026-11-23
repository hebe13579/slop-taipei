// Issue #217 — non-rectangular footprints: wedge / L / stepped
// fills for corner and diagonal lots.
//
// The rule, in one paragraph: a planned lot keeps its rectangle.
// Where the road verdicts killed a neighbouring grid cell (a corner
// remainder, a diagonal street's triangular bite, an irregular
// leftover), the surviving lot beside the dead cell may grow ONE
// rectangular band into it — the union of rectangle + bands is the
// non-rectangular footprint, carried as polygon data (lot.shape:
// centre-relative [u0, v0, u1, v1] rects in the lot's own frame)
// through the adapter into the renderer's union-of-rects massing.
// Vacancy, median, park/green, site and track cells are never
// filled. A band is admitted only through the full lot gauntlet at
// its final size, and re-validated after the frontage pull and the
// facing pass (the repair pass): it must still abut its lot, still
// clear every verdict, and not collide with another lot.
//
// These tests re-derive the invariants from the emitted plan,
// independently of the planner's own predicates: bands never touch
// a roadbed (the #65 clip method), band x lot collisions stay under
// the repair pass's area rule, bands abut their own rect, and the
// plan's rectangles are byte-identical to the pre-#217 plan (only
// the `shape` field is new).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { planTaipeiBuildings, taipeiCityBlocksOptions } from '../js/taipei-buildings.js';

const plan = planTaipeiBuildings(TAIPEI_GEO);
const shaped = plan.lots.filter((l) => Array.isArray(l.shape));
const bands = [];
for (const lot of shaped) for (const band of lot.shape) bands.push({ lot, band });

const quadOf = (cx, cz, w, d, rot) => {
  const c = Math.cos(rot || 0), s = Math.sin(rot || 0), hw = w / 2, hd = d / 2;
  return [
    [cx + hw * c - hd * s, cz + hw * s + hd * c],
    [cx + hw * c + hd * s, cz + hw * s - hd * c],
    [cx - hw * c + hd * s, cz - hw * s - hd * c],
    [cx - hw * c - hd * s, cz - hw * s + hd * c],
  ];
};
const bandQuad = (lot, [u0, v0, u1, v1]) => {
  const rot = lot.rot || 0, c = Math.cos(rot), s = Math.sin(rot);
  const ou = (u0 + u1) / 2, ov = (v0 + v1) / 2;
  return quadOf(lot.x + ou * c - ov * s, lot.z + ou * s + ov * c, u1 - u0, v1 - v0, rot);
};
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
const CELL = 64;
function gridOf(items) {
  const grid = new Map();
  const key = (gx, gz) => gx * 100003 + gz;
  items.forEach((it, idx) => {
    const bb = bboxOf(it.poly);
    it.bb = bb;
    for (let gx = Math.floor(bb.minX / CELL); gx <= Math.floor(bb.maxX / CELL); gx++)
      for (let gz = Math.floor(bb.minZ / CELL); gz <= Math.floor(bb.maxZ / CELL); gz++) {
        const k = key(gx, gz);
        let arr = grid.get(k);
        if (!arr) grid.set(k, arr = []);
        arr.push(idx);
      }
  });
  return { grid, key };
}
function candidates(g, bb) {
  const seen = new Set();
  for (let gx = Math.floor(bb.minX / CELL); gx <= Math.floor(bb.maxX / CELL); gx++)
    for (let gz = Math.floor(bb.minZ / CELL); gz <= Math.floor(bb.maxZ / CELL); gz++) {
      const arr = g.grid.get(g.key(gx, gz));
      if (arr) for (const i of arr) seen.add(i);
    }
  return seen;
}

test('footprints: census — bands grow only into road-dropped cells', () => {
  // Measured on the branch plan (footprints217-evidence/CENSUS.md):
  // 99,524 road-dropped cells sat in blocks with a surviving lot;
  // 46,133 grew a band; the repair pass dropped 18,732 of them at
  // final positions (pull/facing moves + real collisions with other
  // blocks' rects), leaving 27,401 bands on 23,075 lots.
  assert.equal(plan.stats.shapeCellsRoad, 99524);
  assert.equal(plan.stats.shapeCellsFilled, 46133);
  assert.equal(plan.stats.shapeBands, 46133);
  assert.equal(plan.stats.shapeBandsWedge, 29796);
  assert.equal(plan.stats.shapeBandsStep, 16337);
  assert.equal(plan.stats.shapeBandsWedge + plan.stats.shapeBandsStep, plan.stats.shapeBands, 'wedge + step == all bands');
  assert.equal(plan.stats.shapeAreaM2, 6306112);
  assert.equal(plan.stats.shapeBandsDroppedRepair, 18732);
  assert.equal(plan.stats.shapeLots, 23075);
  assert.equal(plan.stats.shapeLotsWrap, 97);
  assert.equal(bands.length, plan.stats.shapeBands - plan.stats.shapeBandsDroppedRepair, 'surviving bands match the counters');
  assert.equal(shaped.length, plan.stats.shapeLots, 'shaped lots match the counter');
});

test('footprints: the plan rectangles are byte-identical to the pre-#217 plan', () => {
  // The lotsHash method of the plan snapshots (sha256 of the JSON,
  // 16 hex): with `shape` stripped, the plan is exactly the shipped
  // 76,253-lot plan — #217 moves no rectangle, height or colour.
  const stripped = plan.lots.map((l) => {
    const { shape, ...rest } = l;
    return rest;
  });
  const hash = createHash('sha256').update(JSON.stringify(stripped)).digest('hex').slice(0, 16);
  assert.equal(plan.lots.length, 76253);
  assert.equal(hash, '4bb006206c974f85', 'rect-only plan hash is the pre-#217 hash');
  for (const l of plan.lots) {
    for (const k of Object.keys(l)) {
      assert.ok(['x', 'z', 'w', 'd', 'h', 'color', 'hSrc', 'rot', 'shape'].includes(k), `no unexpected lot field ${k}`);
    }
  }
});

test('footprints: every band abuts its own rect and respects the size floors', () => {
  for (const { lot, band } of bands) {
    const [u0, v0, u1, v1] = band;
    assert.ok(u1 - u0 >= 1.9 && v1 - v0 >= 1.9, `band at ${lot.x},${lot.z} keeps the depth floor (${JSON.stringify(band)})`);
    assert.ok(Math.max(u1 - u0, v1 - v0) >= 3.7, 'band span floor (4 m rule, less the outer shrink)');
    const hw = lot.w / 2, hd = lot.d / 2;
    // Abut: at least one side sits on a rect edge (within the
    // 0.06 m the repair pass allows) — a u-low band's high edge
    // meets the rect's low edge (-hw), a u-high band's low edge
    // meets +hw, and mirror for v.
    const onU = Math.abs(u1 + hw) < 0.06 || Math.abs(u0 - hw) < 0.06;
    const onV = Math.abs(v1 + hd) < 0.06 || Math.abs(v0 - hd) < 0.06;
    assert.ok(onU || onV, `band at ${lot.x},${lot.z} abuts a rect edge (${JSON.stringify(band)} vs w ${lot.w} d ${lot.d})`);
    // No real intrusion into its own rect (the frame overlap of the
    // two intervals on BOTH axes is the intrusion box; 0.06 m is the
    // repair pass's tolerance — the emitted lot centre is rounded to
    // 0.1 m, so a band can sit at most ~0.05 m into the rect edge).
    // Measured worst on the branch plan: 0.050 m (audit217.mjs).
    const iu = Math.min(u1, hw) - Math.max(u0, -hw);
    const iv = Math.min(v1, hd) - Math.max(v0, -hd);
    assert.ok(Math.min(iu, iv) <= 0.06, `band at ${lot.x},${lot.z} does not intrude into its rect`);
  }
});

test('footprints: bands never touch a roadbed (issue #65 clip method)', () => {
  const rects = [];
  for (const bed of TAIPEI_GEO.roadbeds || []) {
    const half = Math.max((bed.width || 3) / 2, 0.75);
    const pts = bed.pts;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3];
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
      if (len < 0.01) continue;
      const nx = (-dz / len) * half, nz = (dx / len) * half;
      rects.push({ name: bed.name || '', poly: [[ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz], [ax - nx, az - nz]] });
    }
  }
  const g = gridOf(rects);
  let worst = 0, worstInfo = null;
  for (const { lot, band } of bands) {
    const poly = bandQuad(lot, band);
    const bb = bboxOf(poly);
    for (const ri of candidates(g, bb)) {
      const r = rects[ri];
      if (r.bb.maxX < bb.minX || r.bb.minX > bb.maxX || r.bb.maxZ < bb.minZ || r.bb.minZ > bb.maxZ) continue;
      const a = clipArea(poly, r.poly);
      if (a > worst) { worst = a; worstInfo = { lot: [lot.x, lot.z], road: r.name }; }
    }
  }
  assert.ok(worst <= 0.05, `worst band x roadbed overlap ${worst.toFixed(3)} m2 ${JSON.stringify(worstInfo)}`);
});

test('footprints: band collisions stay under the repair area rule', () => {
  const lotItems = plan.lots.map((l) => ({ poly: quadOf(l.x, l.z, l.w, l.d, l.rot) }));
  const lotGrid = gridOf(lotItems);
  const bandItems = bands.map(({ lot, band }) => ({ poly: bandQuad(lot, band) }));
  const bandGrid = gridOf(bandItems);
  let worstLot = 0, worstBand = 0;
  bands.forEach(({ lot, band }, bi) => {
    const poly = bandItems[bi].poly;
    const bb = bboxOf(poly);
    for (const li of candidates(lotGrid, bb)) {
      if (plan.lots[li] === lot) continue;
      const a = clipArea(poly, lotItems[li].poly);
      if (a > worstLot) worstLot = a;
    }
    for (const bj of candidates(bandGrid, bb)) {
      if (bj <= bi) continue;
      const a = clipArea(poly, bandItems[bj].poly);
      if (a > worstBand) worstBand = a;
    }
  });
  // The repair pass drops a band only past 1.0 m2 against another
  // lot (the shipped plan's own rects overlap across block lines by
  // far more); bands among themselves stay clean.
  assert.ok(worstLot <= 1.0, `worst band x lot overlap ${worstLot.toFixed(3)} m2`);
  assert.ok(worstBand <= 0.05, `worst band x band overlap ${worstBand.toFixed(3)} m2`);
});

test('footprints: adapter carries bands to the renderer (newer apartments excluded)', () => {
  const opts = taipeiCityBlocksOptions(TAIPEI_GEO, plan);
  let adapterShaped = 0, newerShaped = 0;
  opts.lots.forEach((r, i) => {
    const lot = plan.lots[i];
    if (!Array.isArray(lot.shape)) {
      assert.ok(!('shape' in r), 'unshaped lot carries no adapter shape');
      return;
    }
    if (r.mat === 10 || r.mat === 11) {
      newerShaped++;
      assert.ok(!('shape' in r), 'newer-apartment lots drop their bands at the adapter (disclosed scope cut)');
      return;
    }
    adapterShaped++;
    assert.ok(Array.isArray(r.shape) && r.shape.length === lot.shape.length, 'adapter shape mirrors the plan bands');
    r.shape.forEach(([x0, z0, x1, z1], bi) => {
      assert.ok(x0 < x1 && z0 < z1, 'adapter band rect well-formed');
      // The v-flip conversion: local z comes from the band's v.
      const [u0, v0, u1, v1] = lot.shape[bi];
      assert.ok(Math.abs(x0 - (lot.x + u0)) < 0.03 && Math.abs(x1 - (lot.x + u1)) < 0.03, 'adapter band u matches the plan');
      assert.ok(Math.abs(z0 - (lot.z - v1)) < 0.03 && Math.abs(z1 - (lot.z - v0)) < 0.03, 'adapter band v is flipped per the renderer frame');
    });
  });
  assert.equal(adapterShaped, 22911);
  assert.equal(newerShaped, 164);
  assert.equal(adapterShaped + newerShaped, shaped.length);
});

test('footprints: renderer masses the union (source pins)', () => {
  const src = readFileSync(new URL('../js/buildings.js', import.meta.url), 'utf8');
  const pop = src.slice(src.indexOf('function populatePlannedLot'));
  assert.match(pop, /const additions = Array\.isArray\(lot\.shape\)/, 'populatePlannedLot reads lot.shape');
  assert.match(pop, /mass\(b, additions, 0, floors\)/, 'arcade/storefront paths mass bands at full height');
  assert.match(pop, /additions && !additionsMassed \? additions : \[\]/, 'plain path masses bands with the main rect');
  assert.match(pop, /pushCollider\(a\.x0 \+ 0\.5, a\.x1 - 0\.5, a\.z0 \+ 0\.5, a\.z1 - 0\.5/, 'bands get base colliders like the main rect');
});
