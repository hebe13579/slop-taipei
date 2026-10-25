import assert from 'node:assert/strict';
import test from 'node:test';

import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { ribbonPoly, pointInPoly } from '../js/taipei-painted.js';
import {
  DASH_LEN, DASH_GAP, STRIPE_W, STRIPE_PITCH, CROSSWALK_DEPTH,
  buildLaneDividers, detectJunctions, buildJunctionFurniture, buildRoadMarkings,
} from '../js/taipei-markings.js';

// Issue #90 — shader markings. The PLAN (dashes / stripes enumerated
// by taipei-markings.js) is unchanged and pinned by
// taipei-markings.test.mjs; this file pins the SHADER FORM derived
// from it: dashStrips (ribbons carrying a continuous centreline-arc
// `along`) and crosswalk bands (one quad per crossing carrying the
// stripe phase). If the plan and the shader form ever drift apart,
// dashes would paint where no dash was planned or stripes would
// restart mid-crossing — these are the invariants that catch it.

const bed = (name, highway, width, ways = [1], pts = [0, 0, 100, 0]) => ({
  name, highway, width, pedestrianLayout: 'sidewalk', pts, sourceWayIds: ways,
});
const quadCentre = (q) => [(q[0] + q[2] + q[4] + q[6]) / 4, (q[1] + q[3] + q[5] + q[7]) / 4];
// A strip's ribbon as a polygon: hi corners forward, lo corners back.
const stripPoly = (s) => [...s.map((f) => [f.hx, f.hz]), ...[...s].reverse().map((f) => [f.lx, f.lz])];
const stripCentre = (f) => [(f.hx + f.lx) / 2, (f.hz + f.lz) / 2];

test('dash strips: along is the bed arc — continuous across polyline vertices', () => {
  // Collinear 3-segment bed: vertices at arc 60 and 130 must NOT
  // restart the rhythm — the strip sections carry the raw arc.
  const ew = bed('EW Blvd', 'secondary', 30, [1, 2], [-100, 0, -40, 0, 30, 0, 100, 0]);
  const { dashStrips } = buildLaneDividers([ew]);
  assert.ok(dashStrips.length > 0);
  for (const s of dashStrips) {
    for (let i = 1; i < s.length; i++) assert.ok(s[i].along > s[i - 1].along, 'along strictly increases within a strip');
  }
  // Some strip spans the arc-60 vertex without breaking (its section
  // list has sections on both sides), and a section sits AT the
  // vertex arc.
  assert.ok(dashStrips.some((s) => s[0].along < 60 && s[s.length - 1].along > 60), 'a strip crosses the 60 m vertex unbroken');
  assert.ok(dashStrips.some((s) => s.some((f) => Math.abs(f.along - 60) < 0.01)), 'a section sits at the vertex arc 60');
  assert.ok(dashStrips.some((s) => s.some((f) => Math.abs(f.along - 130) < 0.01)), 'a section sits at the vertex arc 130');
});

test('dash strips: every planned dash lies on a strip; strips break at occluders', () => {
  const ew = bed('EW Blvd', 'secondary', 30, [1, 2], [-100, 0, 100, 0]);
  const ns = bed('NS Ave', 'residential', 24, [9], [0, -100, 0, 100]); // occluder only
  const { dashes, dashStrips } = buildLaneDividers([ew, ns]);
  const polys = dashStrips.map(stripPoly);
  assert.ok(dashes.length > 0 && polys.length > 0);
  for (const q of dashes) {
    const c = quadCentre(q);
    assert.ok(polys.some((p) => pointInPoly(c, p)), `dash centre ${c} not covered by any strip`);
  }
  // No strip span crosses the occluding carriageway: each span's
  // centreline midpoint stays out of the NS ribbon.
  const nsPoly = ribbonPoly(ns);
  for (const s of dashStrips) {
    for (let i = 0; i + 1 < s.length; i++) {
      const a = stripCentre(s[i]), b = stripCentre(s[i + 1]);
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      assert.ok(!pointInPoly(mid, nsPoly), `strip span midpoint ${mid} inside the crossing road`);
    }
  }
});

test('dash strips: bent bed keeps its dashes covered (miter sections at the vertex)', () => {
  const bent = bed('Bent Rd', 'secondary', 30, [1, 2], [0, 0, 100, 0, 100, 100]);
  const { dashes, dashStrips } = buildLaneDividers([bent]);
  const polys = dashStrips.map(stripPoly);
  assert.ok(dashes.length > 0);
  let inside = 0;
  for (const q of dashes) if (polys.some((p) => pointInPoly(quadCentre(q), p))) inside++;
  assert.ok(inside / dashes.length > 0.95, `${inside}/${dashes.length} dash centres covered on the bent bed`);
  // The bend itself is a section: some strip has a section at arc ≈ 100.
  assert.ok(dashStrips.some((s) => s.some((f) => Math.abs(f.along - 100) < 0.01)), 'vertex section at the bend');
});

test('crosswalk bands: one band per crossing, exactly the union of its stripes', () => {
  const beds = [
    bed('EW Blvd', 'secondary', 30, [1, 2], [-100, 0, 0, 0]),
    bed('EW Blvd', 'secondary', 30, [1, 2], [0, 0, 100, 0]),
    bed('NS Ave', 'primary', 24, [3], [0, -100, 0, 0]),
    bed('NS Ave', 'primary', 24, [3], [0, 0, 0, 100]),
  ];
  const f = buildJunctionFurniture(beds, detectJunctions(beds));
  assert.equal(f.bands.length, 4);
  assert.equal(f.bands.length, f.stats.crosswalks);
  assert.deepEqual(f.bandJunction, [0, 0, 0, 0]);
  // Stripe count implied by each band's width equals the planned
  // stripe count, band by band and in total.
  let implied = 0;
  for (const b of f.bands) {
    const gaps = (b.width - STRIPE_W) / STRIPE_PITCH;
    assert.ok(Math.abs(gaps - Math.round(gaps)) < 1e-6, `band width ${b.width} is a whole number of stripe pitches`);
    implied += Math.round(gaps) + 1;
    // Band area = width × depth (it is the stripes' bounding band).
    const q = b.quad;
    const area = Math.abs(
      (q[0] * q[3] - q[2] * q[1]) + (q[2] * q[5] - q[4] * q[3]) +
      (q[4] * q[7] - q[6] * q[5]) + (q[6] * q[1] - q[0] * q[7])) / 2;
    assert.ok(Math.abs(area - b.width * CROSSWALK_DEPTH) < 1e-6, `band area ${area}`);
    // Every band corner coincides with a stripe corner (same FP
    // expressions in the planner).
    for (let k = 0; k < 8; k += 2) {
      const pt = [q[k], q[k + 1]];
      assert.ok(f.stripes.some((sq) => {
        for (let j = 0; j < 8; j += 2) if (Math.hypot(sq[j] - pt[0], sq[j + 1] - pt[1]) < 1e-9) return true;
        return false;
      }), `band corner ${pt} matches no stripe corner`);
    }
  }
  // Every stripe lies inside exactly one band — the band IS the
  // union extent of its stripes: no stripe pokes out of the band
  // set, none is clipped, and bands never share a stripe.
  const inQuad = (pt, q) => {
    const poly = [[q[0], q[1]], [q[2], q[3]], [q[4], q[5]], [q[6], q[7]]];
    if (pointInPoly(pt, poly)) return true;
    for (let k = 0; k < 4; k++) {
      const a = poly[k], b = poly[(k + 1) % 4];
      if (Math.hypot(pt[0] - a[0], pt[1] - a[1]) < 1e-9) return true;
      const vx = b[0] - a[0], vz = b[1] - a[1], wx = pt[0] - a[0], wz = pt[1] - a[1];
      const t = Math.max(0, Math.min(1, (wx * vx + wz * vz) / ((vx * vx + vz * vz) || 1)));
      if (Math.hypot(wx - vx * t, wz - vz * t) < 1e-9) return true;
    }
    return false;
  };
  for (const sq of f.stripes) {
    const homes = f.bands.filter((b) => [0, 2, 4, 6].every((k) => inQuad([sq[k], sq[k + 1]], b.quad)));
    assert.equal(homes.length, 1, `stripe at ${quadCentre(sq)} belongs to ${homes.length} bands`);
  }
  assert.equal(implied, f.stripes.length, 'band-implied stripe count == planned stripe count');
});

test('geodata: shader form matches the plan tile-wide; triangles collapse', () => {
  const r = buildRoadMarkings(TAIPEI_GEO.roadbeds);
  assert.equal(r.bands.length, r.stats.crosswalks, 'one band per planned crosswalk');
  let implied = 0;
  for (const b of r.bands) implied += Math.round((b.width - STRIPE_W) / STRIPE_PITCH) + 1;
  assert.equal(implied, r.stripes.length, 'band-implied stripes == planned stripes, tile-wide');
  for (const s of r.dashStrips) {
    for (let i = 1; i < s.length; i++) assert.ok(s[i].along > s[i - 1].along, 'along increases within every strip');
  }
  // Sampled coverage: every 61st planned dash centre lies on a
  // strip ribbon (0.1 m neighbour tolerance — the ribbon chords
  // the sampled offset polyline between sections; measured worst
  // residual at the tile's sharpest divider bends is ~0.06 m).
  const polys = r.dashStrips.map(stripPoly);
  const grid = new Map();
  polys.forEach((poly, i) => {
    const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
    for (let gx = Math.floor(Math.min(...xs) / 100); gx <= Math.floor(Math.max(...xs) / 100); gx++)
      for (let gz = Math.floor(Math.min(...zs) / 100); gz <= Math.floor(Math.max(...zs) / 100); gz++) {
        const k = `${gx},${gz}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(i);
      }
  });
  const covered = (c) => {
    const cand = grid.get(`${Math.floor(c[0] / 100)},${Math.floor(c[1] / 100)}`) || [];
    for (const dx of [0, 0.1, -0.1]) for (const dz of [0, 0.1, -0.1])
      for (const ci of cand) if (pointInPoly([c[0] + dx, c[1] + dz], polys[ci])) return true;
    return false;
  };
  let sampled = 0, hit = 0;
  for (let i = 0; i < r.dashes.length; i += 61) { sampled++; if (covered(quadCentre(r.dashes[i]))) hit++; }
  assert.ok(hit / sampled > 0.99, `${hit}/${sampled} sampled dash centres covered by strips`);
  // Static triangles: the whole point of the representation.
  const oldTris = (r.dashes.length + r.stripes.length + r.stopLines.length) * 2;
  const newTris = r.dashStrips.reduce((a, s) => a + (s.length - 1) * 2, 0) + r.bands.length * 2 + r.stopLines.length * 2;
  assert.ok(newTris < oldTris * 0.25, `marking triangles ${oldTris} -> ${newTris}`);
});

test('pattern constants: shader duty/period derive from the plan constants', () => {
  assert.equal(DASH_LEN / (DASH_LEN + DASH_GAP), 0.4);
  assert.equal(STRIPE_W / STRIPE_PITCH, 0.5);
});
