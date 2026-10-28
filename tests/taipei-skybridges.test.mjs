// Issue #212 enforcement: the Xinyi pedestrian skybridge
// network （信義商圈空橋系統） is drawn, at its real
// second-floor level, from the OSM bridge ways — and its
// supports never stand in a carriageway.
//
// The census (issue #212, posted before the build): OSM maps
// the system as highway=footway/steps with bridge=yes +
// layer=1 — 24 ways in the district window, 2,137 m, chaining
// into one connected graph; the real system totals ~2.293 km
// (Wikipedia), the difference being in-building links. The
// geodata builder derives the section from the roads extract
// (tools/taipei/build-skybridges.mjs): the 101-podium terrace
// ring is excluded as a non-span, sub-8 m fragments drop, and
// the Songzhi Rd flagship crossing is widened to its
// satellite-measured 8 m.
//
// This audit pins (a) the shipped section is EXACTLY what the
// derivation rule produces from the shipped extract —
// re-derived here, so the section can never drift into a hand
// list; (b) the census numbers; (c) the drawn geometry: deck
// at 7.0 m, canopy crown 9.75 m; (d) every support footing
// clears every roadbed, and every carriageway crossing is
// flanked by supports; (e) the lot plan is untouched — the
// network displaces zero buildings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { planTaipeiBuildings } from '../js/taipei-buildings.js';
import { buildSkybridgeGeometry, SKYBRIDGE_STYLE } from '../js/taipei-skybridges.js';
import { deriveSkybridges } from '../tools/taipei/build-skybridges.mjs';

// The builder's tangent-plane conversion, mirrored (the
// bridges test pins the same pair of converters equal).
const [LAT0, LON0] = TAIPEI_GEO.frame.originLatLon;
const A = 6378137.0, E2 = 6.69437999014e-3;
const PHI0 = (LAT0 * Math.PI) / 180, SIN0 = Math.sin(PHI0);
const NRAD = A / Math.sqrt(1 - E2 * SIN0 * SIN0);
const MRAD = (A * (1 - E2)) / Math.pow(1 - E2 * SIN0 * SIN0, 1.5);
const KX = (Math.PI / 180) * NRAD * Math.cos(PHI0);
const KY = (Math.PI / 180) * MRAD;
const toWorld = (lon, lat) => [(lon - LON0) * KX, -(lat - LAT0) * KY];

const sky = TAIPEI_GEO.skybridges || [];
const chainLen = (seg) => {
  let L = 0;
  for (let k = 0; k + 3 <= seg.pts.length; k += 2) L += Math.hypot(seg.pts[k + 2] - seg.pts[k], seg.pts[k + 3] - seg.pts[k + 1]);
  return L;
};
// Independent roadbed clearance (point-to-centreline distance
// minus half width), written for this test — negative = the
// point stands inside a carriageway ribbon.
function clearance(x, z) {
  let best = Infinity;
  for (const b of TAIPEI_GEO.roadbeds) {
    const pts = b.pts, half = (b.width || 6) / 2;
    for (let k = 0; k + 3 <= pts.length; k += 2) {
      const ax = pts[k], az = pts[k + 1], bx = pts[k + 2], bz = pts[k + 3];
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
      let t = l2 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)) - half);
    }
  }
  return best;
}

test('the shipped section re-derives exactly from the roads extract', () => {
  const elements = JSON.parse(fs.readFileSync(new URL('../tools/taipei/data/osm_roads.json', import.meta.url), 'utf8')).elements;
  const derived = deriveSkybridges(elements, toWorld);
  assert.deepEqual(sky, derived.segments, 'geodata.skybridges == deriveSkybridges(osm_roads.json)');
  assert.equal(derived.stats.waysKept, 23, 'OSM bridge ways inside the district window');
  assert.equal(derived.stats.excludedRings, 1, 'the 101-podium terrace ring is excluded');
  assert.equal(derived.stats.fragmentsDropped, 2, 'sub-8 m fragments dropped after chaining');
});

test('network census: chains, length, flagship width', () => {
  assert.equal(sky.length, 15, 'chained polylines');
  const total = sky.reduce((s, seg) => s + chainLen(seg), 0);
  assert.equal(Math.round(total), 1997, 'drawn length (census: 2,019 m of ways in the core window; 22 m of landing fragments drop)');
  let flagship = 0;
  for (const seg of sky) {
    for (const w of seg.sw) {
      assert.ok(w === 5 || w === 8, `width ${w} is a measured class`);
      if (w === 8) flagship++;
    }
    // No closed chains (the terrace ring class stays out) and
    // every point inside the district window (world frame).
    const n = seg.pts.length;
    assert.ok(Math.hypot(seg.pts[0] - seg.pts[n - 2], seg.pts[1] - seg.pts[n - 1]) > 0.5, 'chain is not closed');
    for (let k = 0; k < n; k += 2) {
      assert.ok(seg.pts[k] >= -303 && seg.pts[k] <= 707 && seg.pts[k + 1] >= -1010 && seg.pts[k + 1] <= 200, 'point inside the district window');
    }
  }
  assert.equal(flagship, 4, 'flagship-width segments on the Songzhi Rd crossing');
});

test('drawn geometry: deck at the second floor, canopy above', () => {
  const G = buildSkybridgeGeometry(TAIPEI_GEO);
  assert.equal(G.chains.length, 15);
  assert.ok(G.triCount > 5000, `triCount ${G.triCount}`);
  assert.equal(G.positions.length, G.triCount * 9);
  assert.equal(G.maxY, SKYBRIDGE_STYLE.canopyTop, 'canopy crown at 9.75 m');
  let deckTopSeen = false;
  for (let i = 1; i < G.positions.length; i += 3) {
    if (Math.abs(G.positions[i] - SKYBRIDGE_STYLE.deckTop) < 0.01) { deckTopSeen = true; break; }
  }
  assert.ok(deckTopSeen, 'deck top face at 7.0 m');
});

test('supports clear every carriageway and flank every crossing', () => {
  const G = buildSkybridgeGeometry(TAIPEI_GEO);
  assert.ok(G.supports.length >= 20, `supports ${G.supports.length}`);
  for (const [x, z] of G.supports) {
    assert.ok(clearance(x, z) >= 0.99, `support at ${x.toFixed(0)},${z.toFixed(0)} clears roadbeds (clearance ${clearance(x, z).toFixed(2)})`);
  }
  // Every maximal over-carriageway run of >= 8 m that does not
  // run off a chain end (a building landing) has a support
  // within 13 m of both ends. (The wide avenues read as twin
  // ~10 m runs split by their medians — each is flanked.)
  sky.forEach((seg, ci) => {
    const P = [];
    for (let k = 0; k + 1 < seg.pts.length; k += 2) P.push([seg.pts[k], seg.pts[k + 1]]);
    const chain = [0];
    for (let i = 1; i < P.length; i++) chain.push(chain[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const total = chain[chain.length - 1];
    const at = (d) => {
      let i = 1; while (i < chain.length - 1 && chain[i] < d) i++;
      const t = (d - chain[i - 1]) / Math.max(chain[i] - chain[i - 1], 1e-6);
      return [P[i - 1][0] + (P[i][0] - P[i - 1][0]) * t, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * t];
    };
    const sup = G.chains[ci].supports;
    let run = null;
    const runs = [];
    for (let d = 0; d <= total; d += 2) {
      const [x, z] = at(d);
      if (clearance(x, z) < 0.5) { if (!run) run = { a: d, x0: x, z0: z }; run.b = d; run.x1 = x; run.z1 = z; }
      else if (run) { runs.push(run); run = null; }
    }
    if (run) runs.push(run);
    for (const r of runs) {
      if (r.b - r.a < 8 || r.a <= 0.01 || r.b >= total - 2.01) continue;
      const near = (x, z) => sup.some(([sx, sz]) => Math.hypot(sx - x, sz - z) <= 13);
      assert.ok(near(r.x0, r.z0), `chain ${ci} crossing at ${r.a.toFixed(0)} m has a near-side support`);
      assert.ok(near(r.x1, r.z1), `chain ${ci} crossing at ${r.a.toFixed(0)} m has a far-side support`);
    }
  });
});

test('the lot plan is untouched: zero buildings displaced', () => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  assert.equal(plan.lots.length, 75389, 'the shipped plan count on this base — the scenery section feeds no planner input');
});
