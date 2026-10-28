import assert from 'node:assert/strict';
import test from 'node:test';

import { TAIPEI_GEO } from '../js/taipei-geodata.js';

// Issue #223 — the Beitou/Tianmu creeks （貴子坑溪， 磺港溪， 磺溪，
// 水磨坑溪， …) exist in OSM as waterway=river centrelines only, and
// the geodata builder buffered them at the flat 160 m RIVER default:
// 貴子坑溪 shipped 161–165 m wide through the Guandu plain and
// swallowed both bank lanes （中央北路二段257巷 / 承德路七段401巷620弄）.
// The builder now defaults polygon-uncovered ways by class (20 m for
// 溪-named/unnamed, 160 m kept for 河-named), caps each vertex by the
// clearance to the nearest parallel carriageway, and drops duplicate
// water rings from the overlapping-box clip. These tests pin the
// outcome on the shipped geodata.

const LAT0 = 25.0330, LON0 = 121.5650;
const A = 6378137.0, E2 = 6.69437999014e-3;
const PHI0 = LAT0 * Math.PI / 180, SIN0 = Math.sin(PHI0);
const NRAD = A / Math.sqrt(1 - E2 * SIN0 * SIN0);
const MRAD = (A * (1 - E2)) / Math.pow(1 - E2 * SIN0 * SIN0, 1.5);
const KX = (Math.PI / 180) * NRAD * Math.cos(PHI0);
const KY = (Math.PI / 180) * MRAD;
const toLon = (x) => LON0 + x / KX;

const water = TAIPEI_GEO.water || [];
const ringArea = (ring) => {
  let a = 0;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) a += ring[2 * j] * ring[2 * i + 1] - ring[2 * i] * ring[2 * j + 1];
  return Math.abs(a / 2);
};
const pointInRing = (x, z, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i], zi = ring[i + 1], xj = ring[j], zj = ring[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
// Total water span (m) across a latitude scanline within a lon window.
const waterWidthAt = (lat, lonMin, lonMax) => {
  const z = -(lat - LAT0) * KY;
  const xMin = (lonMin - LON0) * KX, xMax = (lonMax - LON0) * KX;
  let total = 0;
  for (const p of water) {
    const pts = p.ring, xs = [];
    for (let i = 0; i < pts.length; i += 2) {
      const j = (i + 2) % pts.length;
      const x1 = pts[i], z1 = pts[i + 1], x2 = pts[j], z2 = pts[j + 1];
      if ((z1 - z) * (z2 - z) <= 0 && z1 !== z2) xs.push(x1 + (z - z1) * (x2 - x1) / (z2 - z1));
    }
    if (xs.length >= 2) {
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const a = Math.max(xs[i], xMin), b = Math.min(xs[i + 1], xMax);
        if (b > a) total += b - a;
      }
    }
  }
  return total;
};

test('type site: 貴子坑溪 at the issue scanlines is a channel, not a lake', () => {
  // Issue #223's measured table (main 1301d547): 161/161/165/165 m.
  // After the fix: 12/11/13/12 m. Satellite: the canal between the
  // bank lanes is ~12–15 m. Pin < 30 m so a regression to anything
  // like the river default fails loudly.
  for (const lat of [25.1175, 25.1200, 25.1225, 25.1250]) {
    const w = waterWidthAt(lat, 121.4840, 121.4880);
    assert.ok(w > 3 && w < 30, `lat ${lat}: water width ${w.toFixed(1)} m — expected the ~12 m channel`);
  }
});

test('type site: neither bank lane is under water', () => {
  // Before the fix, 15/15 sampled bank-lane segment midpoints in the
  // reach were inside a water ring; the road cap must keep it at 0.
  let sampled = 0, wet = 0;
  for (const b of TAIPEI_GEO.roadbeds || []) {
    if (!/257巷|620弄/.test(b.name || '')) continue;
    const p = b.pts;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const mx = (p[i] + p[i + 2]) / 2, mz = (p[i + 1] + p[i + 3]) / 2;
      if (mx < -8200 || mx > -7700 || mz < -10400 || mz > -8900) continue;
      sampled++;
      if (water.some((w) => pointInRing(mx, mz, w.ring))) wet++;
    }
  }
  assert.ok(sampled >= 10, `expected the bank-lane sample to exist, got ${sampled}`);
  assert.equal(wet, 0, `${wet} bank-lane segment midpoints still under water`);
});

test('creek buffers: per-creek derived area stays at channel scale', () => {
  // Measured after the fix (builder output, this tree). Bounds carry
  // ~25% headroom over the measured totals; the pre-fix values
  // （貴子坑溪 544,402 / 磺港溪 211,668 / 五分港溪 190,936 m²) would
  // fail every one of these.
  const bounds = {
    貴子坑溪: 90000, 磺港溪: 65000, 五分港溪: 90000, 磺溪: 105000,
    水磨坑溪: 48000, 樹梅坑溪: 30000, 永春寮溪: 20000, 行義溪: 16000, 北投溪: 4000,
  };
  const totals = new Map();
  for (const w of water) {
    if (!w.derived) continue;
    totals.set(w.name, (totals.get(w.name) || 0) + ringArea(w.ring));
  }
  for (const [name, bound] of Object.entries(bounds)) {
    const total = totals.get(name) || 0;
    assert.ok(total > 0, `${name}: derived buffer vanished entirely`);
    assert.ok(total < bound, `${name}: derived area ${Math.round(total)} m² exceeds the channel-scale bound ${bound}`);
  }
});

test('no duplicate water rings ship', () => {
  // Before the fix: 22 exact-duplicate rings (45,997 m²) plus the
  // contained 磺港溪 clip sibling (56,309 m² inside its 69,107 m²
  // twin). Exact copies are checked across all names; containment
  // uses the builder's own narrow rule (named rings, container at
  // most 2× the candidate).
  const seen = new Set();
  for (const w of water) {
    const key = w.name + '|' + w.ring.join(',');
    assert.ok(!seen.has(key), `exact-duplicate water ring ships: ${w.name}`);
    seen.add(key);
  }
  const segDist = (px, pz, ax, az, bx, bz) => {
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    const t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2)) : 0;
    return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
  };
  const inOrNear = (x, z, ring) => {
    if (pointInRing(x, z, ring)) return true;
    let m = Infinity;
    for (let i = 0; i < ring.length; i += 2) {
      const j = (i + 2) % ring.length;
      m = Math.min(m, segDist(x, z, ring[i], ring[i + 1], ring[j], ring[j + 1]));
    }
    return m <= 1.5;
  };
  const byName = new Map();
  for (const w of water) {
    if (!w.name) continue;
    if (!byName.has(w.name)) byName.set(w.name, []);
    byName.get(w.name).push(w);
  }
  for (const [name, rings] of byName) {
    for (const cand of rings) {
      for (const cont of rings) {
        if (cont === cand || ringArea(cont.ring) < ringArea(cand.ring) || ringArea(cont.ring) > 2 * ringArea(cand.ring)) continue;
        let allIn = true;
        for (let i = 0; i < cand.ring.length; i += 2) if (!inOrNear(cand.ring[i], cand.ring[i + 1], cont.ring)) { allIn = false; break; }
        assert.ok(!allIn, `${name}: a ring ships contained inside a near-equal same-name sibling`);
      }
    }
  }
});

test('true polygons untouched: non-derived water area is exactly the pre-fix distinct total', () => {
  // The genuinely wide rivers （基隆河/淡水河） and every mapped pond
  // are collected polygons, not buffers. Before the fix the distinct
  // non-derived rings summed to 5,126,411 m² on the pre-#186 tile; the
  // shipped file also carried exact-duplicate copies of 20 of them.
  // The #186 strip added 104,858 m² of polygon water （基隆河/外雙溪）,
  // so on the merged tile the distinct total is 5,231,269 m² — verified
  // at the #226 gate to equal current main's distinct non-derived
  // total to the metre, with zero distinct rings missing. After the
  // fix the non-derived total must equal that distinct total exactly —
  // proof the creek fix ate nothing real.
  const total = water.filter((w) => !w.derived).reduce((s, w) => s + ringArea(w.ring), 0);
  assert.ok(Math.abs(total - 5231269) < 1, `non-derived water area ${Math.round(total)} m² ≠ 5,231,269 m²`);
});
