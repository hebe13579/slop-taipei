// Issue #42 regression: landmarks do not overlap roads.
//
// The user's rule is about the modelled footprint — the union of the
// parts the landmark renderer actually builds (boxes at centre+dx/dz,
// frustum/ridge plans centred on the axis, cylinders/domes as
// ellipses; for Taipei 101 the podium rect, its widest part) —
// against the rendered roadbed polygons: the per-segment butt-cap
// rectangles ribbonsGeometry draws for geo.roadbeds (half-width
// max(width/2, 0.75)). Intersection is exact Sutherland–Hodgman
// convex clipping; any part/segment pair over 0.05 m² fails.
//
// The lot-exclusion site rects are NOT the footprint (they are
// invisible keep-clear rectangles and predate this rule; several
// span forecourt drives by design). Lot exclusion itself is pinned
// by the "landmark structures" test in taipei.test.mjs.
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
  const polys = [];
  for (const part of s.parts) {
    const cx = s.x + (part.dx || 0), cz = s.z + (part.dz || 0);
    if (part.type === 'box') polys.push(rotRect(cx, cz, part.w, part.d, part.rotY || 0));
    else if (part.type === 'frustum') polys.push(rotRect(s.x, s.z, Math.max(part.wB, part.wT), Math.max(part.dB, part.dT), 0));
    else if (part.type === 'ridge') polys.push(rotRect(s.x, s.z, part.w, part.d, 0));
    else if (part.type === 'cylinder') polys.push(ellipsePoly(cx, cz, part.r, part.rz || part.r));
    else if (part.type === 'dome') polys.push(ellipsePoly(cx, cz, part.rx, part.rz));
  }
  return polys;
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

test('landmarks never overlap roadbeds (issue #42)', () => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  const rects = segmentRects(TAIPEI_GEO);
  const structures = plan.landmarkTowers.map((s) => ({ id: s.id, polys: partPolygons(s) }));
  assert.ok(plan.tower, 'taipei 101 plan present');
  structures.push({
    id: 'taipei-101',
    polys: [rotRect(plan.tower.x, plan.tower.z, plan.tower.podium.w, plan.tower.podium.d, 0)],
  });
  // Sanity positives: these three were already clean before the fix
  // and must stay in the audited set.
  for (const id of ['taipei-101', 'taipei-dome', 'sun-yat-sen-memorial-hall']) {
    assert.ok(structures.some((s) => s.id === id), `${id} audited`);
  }
  for (const s of structures) {
    const [fx0, fx1, fz0, fz1] = s.polys.reduce(
      (acc, p) => { const b = bboxOf(p); return [Math.min(acc[0], b[0]), Math.max(acc[1], b[1]), Math.min(acc[2], b[2]), Math.max(acc[3], b[3])]; },
      [Infinity, -Infinity, Infinity, -Infinity]);
    for (const r of rects) {
      const [rx0, rx1, rz0, rz1] = bboxOf(r.poly);
      if (rx1 < fx0 || rx0 > fx1 || rz1 < fz0 || rz0 > fz1) continue;
      for (const fp of s.polys) {
        const a = clipArea(fp, r.poly);
        assert.ok(a <= 0.05, `${s.id} footprint overlaps road "${r.name}" by ${a.toFixed(2)} m²`);
      }
    }
  }
});
