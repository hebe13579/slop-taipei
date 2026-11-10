// Issue #42 regression: landmarks do not overlap roads.
//
// The user's rule is about the modelled footprint — the union of the
// parts the landmark renderer actually builds (boxes at centre+dx/dz,
// frustum plans at centre+dx/dz (issue #299: frustums honour dx/dz
// like boxes — only the Grand Hyatt's carries dx/dz, so this changes
// nothing for the others), ridge plans at centre+dx/dz
// (issue #273: ridges honour dx/dz and rotY like boxes — pre-#273
// ridges all sit at the anchor with rotY 0, so this changes nothing
// for them), cylinders/domes as ellipses; for Taipei 101 the podium
// rect, its widest part) — against the rendered roadbed polygons: the per-segment butt-cap
// rectangles ribbonsGeometry draws for geo.roadbeds (half-width
// max(width/2, 0.75)). Intersection is exact Sutherland–Hodgman
// convex clipping; any part/segment pair over 0.05 m² fails.
//
// The lot-exclusion site rects are NOT the footprint (they are
// invisible keep-clear rectangles and predate this rule; several
// span forecourt drives by design). Lot exclusion itself is pinned
// by the "landmark structures" test in taipei.test.mjs.
//
// Issue #344 exception (narrow, jianguo-high-school only): this test is
// a 2D, height-blind check, and these eight pairs are real, photo-verified
// geometry that no faithful model can avoid. Each entry names the exact
// part (by type + dx/dz + size, the static registry literals) and its
// reason; the road is always the unnamed 5 m entrance-drive service road.
// The test asserts the exception hits are EXACTLY this set — a new overlap,
// or one of these stopping, fails the test, so the exception cannot grow
// silently and cannot go stale.
//   (a) Gate structures spanning the entrance drive they serve — the
//       canopy (y0 3.6, cars drive under it) and the closed iron leaves'
//       rails. Reference: 2023 elevated photo from across Nanhai Rd
//       (jianguo334-evidence/Red_Building_of_CKHS_20230620.jpg) — the
//       white flat canopy spans the driveway.
//   (b) Roundabout ground features at a road terminus — the curb and the
//       flower bed. OSM draws the connecting service ways to the
//       roundabout's centre, so their 5 m roadbed rects terminate inside
//       the planter; the real drive circles the continuous circular flower
//       bed. Reference: 2023 central photo
//       (jianguo334-evidence/Red_Building_central_of_CKHS_20230620.jpg).
//   (c) East pier + cap — the geodata drive centreline sits 5 m east of
//       the building axis while the real drive is centred on the gate (same
//       elevated photo), so the real pier stands 2.45 m clear of the real
//       drive; only the geodata offset clips it.
// The fence itself is NOT excepted: no fence part overlaps any roadbed.
// The gate is NOT moved to the geodata drive centreline (u=+5.1) — that
// would put it off the building axis and still not fix the canopy/leaves
// span. The planter is NOT shrunk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { planTaipeiBuildings } from '../js/taipei-buildings.js';

function rotRect(cx, cz, w, d, rotY) {
  const hw = w / 2, hd = d / 2, c = Math.cos(rotY), sn = Math.sin(rotY);
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([lx, lz]) => [
    cx + lx * c - lz * sn, cz + lx * sn + lz * c,
  ]);
}
function ellipsePoly(cx, cz, rx, rz, n = 48) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([cx + rx * Math.cos(a), cz + rz * Math.sin(a)]);
  }
  return pts;
}
function partPolygons(s) {
  const out = [];
  for (const part of s.parts) {
    const cx = s.x + (part.dx || 0), cz = s.z + (part.dz || 0);
    let poly = null;
    if (part.type === 'box') poly = rotRect(cx, cz, part.w, part.d, part.rotY || 0);
    else if (part.type === 'frustum') poly = rotRect(cx, cz, Math.max(part.wB, part.wT), Math.max(part.dB, part.dT), 0);
    else if (part.type === 'ridge') poly = rotRect(cx, cz, part.w, part.d, part.rotY || 0);
    else if (part.type === 'cylinder') poly = ellipsePoly(cx, cz, part.r, part.rz || part.r);
    else if (part.type === 'dome') poly = ellipsePoly(cx, cz, part.rx, part.rz);
    if (poly) out.push({ part, poly });
  }
  return out;
}
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
        name: bed.name || '(unnamed)',
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
  const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
  return [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
};

// Issue #344: the documented exception set. `hits` is the exact number of
// (part, unnamed-drive-segment) pairs over 0.05 m² measured on the #344
// tree (see honglou344-evidence/overlap344.mjs): curb 18.62 + 0.35, bed
// 14.44, canopy 10.15, pier cap 1.21, pier 0.81, east-leaf rails 0.17 x2.
// `why` is unique per entry and is the key the test asserts on.
const JIANGUO_344_EXCEPTIONS = [
  { type: 'cylinder', dx: -41.7, dz: -84, r: 7, hits: 2, why: '(b) roundabout curb' },
  { type: 'cylinder', dx: -41.7, dz: -84, r: 6.2, hits: 1, why: '(b) roundabout bed' },
  { type: 'box', dx: -46.5, dz: -101.9, w: 12, d: 3, hits: 1, why: '(a) gate canopy' },
  { type: 'box', dx: -41.7, dz: -103.2, w: 0.9, d: 0.9, hits: 1, why: '(c) east pier' },
  { type: 'box', dx: -41.7, dz: -103.2, w: 1.1, d: 1.1, hits: 1, why: '(c) east pier cap' },
  { type: 'box', dx: -44.1, dz: -102.5, w: 4.5, d: 0.08, hits: 2, why: '(a) east leaf rails' },
];
const numEq = (a, b) => Math.abs(a - b) < 1e-9;
function exceptionFor(id, part, roadName) {
  if (id !== 'jianguo-high-school' || roadName !== '(unnamed)' || !part) return null;
  return JIANGUO_344_EXCEPTIONS.find((e) => {
    if (e.type !== part.type) return false;
    if (!numEq(e.dx, part.dx || 0) || !numEq(e.dz, part.dz || 0)) return false;
    if (e.type === 'box') return numEq(e.w, part.w) && numEq(e.d, part.d);
    if (e.type === 'cylinder') return numEq(e.r, part.r);
    return false;
  }) || null;
}

test('landmarks never overlap roadbeds (issue #42)', () => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  const rects = segmentRects(TAIPEI_GEO);
  const structures = plan.landmarkTowers.map((s) => ({ id: s.id, pairs: partPolygons(s) }));
  assert.ok(plan.tower, 'taipei 101 plan present');
  structures.push({
    id: 'taipei-101',
    pairs: [{ part: { type: 'box' }, poly: rotRect(plan.tower.x, plan.tower.z, plan.tower.podium.w, plan.tower.podium.d, 0) }],
  });
  // Sanity positives: these three were already clean before the fix
  // and must stay in the audited set.
  for (const id of ['taipei-101', 'taipei-dome', 'sun-yat-sen-memorial-hall']) {
    assert.ok(structures.some((s) => s.id === id), `${id} audited`);
  }
  const violations = [];
  const exceptionHits = new Map();
  for (const s of structures) {
    const [fx0, fx1, fz0, fz1] = s.pairs.reduce(
      (acc, { poly: p }) => { const b = bboxOf(p); return [Math.min(acc[0], b[0]), Math.max(acc[1], b[1]), Math.min(acc[2], b[2]), Math.max(acc[3], b[3])]; },
      [Infinity, -Infinity, Infinity, -Infinity]);
    for (const r of rects) {
      const [rx0, rx1, rz0, rz1] = bboxOf(r.poly);
      if (rx1 < fx0 || rx0 > fx1 || rz1 < fz0 || rz0 > fz1) continue;
      for (const { part, poly: fp } of s.pairs) {
        const a = clipArea(fp, r.poly);
        if (a <= 0.05) continue;
        const exc = exceptionFor(s.id, part, r.name);
        if (exc) exceptionHits.set(exc.why, (exceptionHits.get(exc.why) || 0) + 1);
        else violations.push(`${s.id} footprint overlaps road "${r.name}" by ${a.toFixed(2)} m² (part ${part.type} dx=${part.dx} dz=${part.dz})`);
      }
    }
  }
  assert.deepEqual(violations, [], 'landmark footprints overlap roadbeds');
  // The #344 exception set must fire exactly as documented — no more, no fewer.
  const expectedHits = new Map(JIANGUO_344_EXCEPTIONS.map((e) => [e.why, e.hits]));
  assert.deepEqual([...exceptionHits.entries()].sort(), [...expectedHits.entries()].sort(), 'issue #344 exception hits differ from the documented set');
});
