import assert from 'node:assert/strict';
import test from 'node:test';

import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import {
  planTaipeiBuildings,
  chooseFacingFace,
  FACING_MAIN_RANK,
  FACING_MAIN_CLOSE_M,
} from '../js/taipei-buildings.js';

// Issue #216: building facing. The user-confirmed rule (2026-10-29):
// a frontage lot faces the CLOSEST road; if a MAIN road is close it
// faces the main road instead (mimic 文湖街 / 復興南路). "Main" is
// rank >= 3 (secondary or better); "close" is within 10 m of the
// closest face's gap.

test('chooseFacingFace: the closest road wins when no main road is close', () => {
  const faces = [
    { axis: 'v', dir: 1, rank: 2, gap: 2, segAng: 0 },
    { axis: 'u', dir: 1, rank: 4, gap: 20, segAng: 1 },
  ];
  assert.equal(chooseFacingFace(faces), faces[0]);
});

test('chooseFacingFace: a close main road wins over a closer lane', () => {
  const faces = [
    { axis: 'v', dir: 1, rank: 2, gap: 2, segAng: 0 },
    { axis: 'u', dir: 1, rank: 4, gap: 8, segAng: 1 },
  ];
  assert.equal(chooseFacingFace(faces), faces[1]);
  // Exactly at the margin still wins.
  faces[1].gap = 2 + FACING_MAIN_CLOSE_M;
  assert.equal(chooseFacingFace(faces), faces[1]);
});

test('chooseFacingFace: a main road past the margin loses', () => {
  const faces = [
    { axis: 'v', dir: 1, rank: 2, gap: 2, segAng: 0 },
    { axis: 'u', dir: 1, rank: 4, gap: 2 + FACING_MAIN_CLOSE_M + 0.5, segAng: 1 },
  ];
  assert.equal(chooseFacingFace(faces), faces[0]);
});

test('chooseFacingFace: ties and empty input', () => {
  // Two main roads: the higher rank wins, then the smaller gap.
  const faces = [
    { axis: 'v', dir: 1, rank: 3, gap: 6, segAng: 0 },
    { axis: 'u', dir: 1, rank: 4, gap: 9, segAng: 1 },
    { axis: 'u', dir: -1, rank: 4, gap: 5, segAng: 2 },
  ];
  assert.equal(chooseFacingFace(faces), faces[2]);
  // A gap tie goes to the higher rank.
  assert.equal(
    chooseFacingFace([
      { axis: 'v', dir: 1, rank: 2, gap: 4, segAng: 0 },
      { axis: 'u', dir: 1, rank: 3, gap: 4, segAng: 1 },
    ]).rank,
    3,
  );
  assert.equal(FACING_MAIN_RANK, 3);
  assert.equal(chooseFacingFace([]), null);
  assert.equal(chooseFacingFace(null), null);
});

// --- Census pairing, the issue #216 method verbatim: every lot's
// four edges (rotation-aware) paired with the roadbed segment that
// fronts the face midpoint (segment in front, running along it,
// carriageway edge within 26 m). Primary = highest rank, tie ->
// smallest gap. Baseline on the same plan with the pass disabled
// (opts.facing === false): 17,433 lots, 35.0% > 5° off, 20.5% > 10°.
const CLASS_RANK = { motorway: 6, trunk: 5, primary: 4, secondary: 3, tertiary: 2 };
function censusMismatch(lots) {
  const CELL = 96;
  const key = (gx, gz) => gx * 100003 + gz;
  const grid = new Map();
  for (const bed of TAIPEI_GEO.roadbeds || []) {
    const pts = bed.pts || [];
    const half = Math.max((bed.width || 3) / 2, 0.75);
    const rank = CLASS_RANK[bed.highway] || 1;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const s = { ax: pts[i], az: pts[i + 1], bx: pts[i + 2], bz: pts[i + 3], half, rank };
      const gx0 = Math.floor((Math.min(s.ax, s.bx) - 44) / CELL), gx1 = Math.floor((Math.max(s.ax, s.bx) + 44) / CELL);
      const gz0 = Math.floor((Math.min(s.az, s.bz) - 44) / CELL), gz1 = Math.floor((Math.max(s.az, s.bz) + 44) / CELL);
      for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
        const k = key(gx, gz);
        let b = grid.get(k); if (!b) grid.set(k, b = []);
        b.push(s);
      }
    }
  }
  const frontingSeg = (mx, mz, nx, nz, tx, tz) => {
    const bucket = grid.get(key(Math.floor(mx / CELL), Math.floor(mz / CELL)));
    if (!bucket) return null;
    let best = null;
    const seen = new Set();
    for (const sg of bucket) {
      if (seen.has(sg)) continue; seen.add(sg);
      const dx = sg.bx - sg.ax, dz = sg.bz - sg.az, L2 = dx * dx + dz * dz || 1e-9;
      let t = ((mx - sg.ax) * dx + (mz - sg.az) * dz) / L2;
      t = Math.max(0, Math.min(1, t));
      const vx = sg.ax + t * dx - mx, vz = sg.az + t * dz - mz;
      const d = Math.hypot(vx, vz);
      if (d <= sg.half) continue;
      if (vx * nx + vz * nz < 0.5 * d) continue;
      const sl = Math.sqrt(L2);
      const along = Math.abs((dx / sl) * tx + (dz / sl) * tz);
      if (along < 0.7) continue;
      const gap = d - sg.half;
      if (gap > 26) continue;
      const ang = Math.acos(Math.min(1, along)) * 180 / Math.PI;
      const cand = { gap, rank: sg.rank, ang };
      if (!best || gap < best.gap - 0.5 || (Math.abs(gap - best.gap) <= 0.5 && sg.rank > best.rank)) best = cand;
    }
    return best;
  };
  const buckets = { '0-2': 0, '2-5': 0, '5-10': 0, '10-20': 0, '20-45': 0 };
  let sample = 0;
  for (const lot of lots) {
    const rot = lot.rot || 0, c = Math.cos(rot), s = Math.sin(rot);
    const U = [c, s], V = [-s, c];
    const hw = lot.w / 2, hd = lot.d / 2;
    const edges = [
      { mx: lot.x - hd * V[0], mz: lot.z - hd * V[1], n: [-V[0], -V[1]], t: U },
      { mx: lot.x + hd * V[0], mz: lot.z + hd * V[1], n: V, t: U },
      { mx: lot.x - hw * U[0], mz: lot.z - hw * U[1], n: [-U[0], -U[1]], t: V },
      { mx: lot.x + hw * U[0], mz: lot.z + hw * U[1], n: U, t: V },
    ];
    const fronts = [];
    for (const e of edges) {
      const f = frontingSeg(e.mx, e.mz, e.n[0], e.n[1], e.t[0], e.t[1]);
      if (f) fronts.push(f);
    }
    const major = fronts.filter((f) => f.rank >= 2);
    if (!major.length) continue;
    sample++;
    const prim = major.slice().sort((a, b) => b.rank - a.rank || a.gap - b.gap)[0];
    const bk = prim.ang <= 2 ? '0-2' : prim.ang <= 5 ? '2-5' : prim.ang <= 10 ? '5-10' : prim.ang <= 20 ? '10-20' : '20-45';
    buckets[bk]++;
  }
  return { sample, buckets };
}

test('facing census: turns land, the #185 pull and heights are untouched', () => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  const off = planTaipeiBuildings(TAIPEI_GEO, { facing: false });
  // The pass turns lots and holds the rest; it never adds, drops,
  // or re-heights a lot. Baseline (pass disabled) on this tree:
  // 68,570 lots, pull 2929 / flush 76 / heldNoBed 5801 /
  // heldBlocked 3343.
  assert.equal(plan.lots.length, 68570);
  assert.equal(off.lots.length, plan.lots.length);
  assert.equal(plan.stats.lotsFrontagePulled, off.stats.lotsFrontagePulled);
  assert.equal(plan.stats.lotsFrontageFlush, off.stats.lotsFrontageFlush);
  assert.equal(plan.stats.lotsFrontageHeldNoBed, off.stats.lotsFrontageHeldNoBed);
  assert.equal(plan.stats.lotsFrontageHeldBlocked, off.stats.lotsFrontageHeldBlocked);
  assert.equal(plan.stats.frontagePullMetres, off.stats.frontagePullMetres);
  let diff = 0;
  for (let i = 0; i < plan.lots.length; i++) {
    const a = plan.lots[i], b = off.lots[i];
    assert.equal(a.h, b.h, 'a facing turn never re-heights a lot');
    assert.equal(a.hSrc, b.hSrc);
    assert.deepEqual(a.color, b.color, 'a facing turn never recolors a lot (color is drawn once, from the draw seed)');
    if (a.x !== b.x || a.z !== b.z || a.w !== b.w || a.d !== b.d || (a.rot || 0) !== (b.rot || 0)) diff++;
  }
  // Exactly the turned lots differ, and only in geometry.
  assert.equal(diff, plan.stats.lotsFacingTurned);
  // Census pins, measured on this tree (baseline with the pass
  // disabled: 8204 / 3132 / 2521 / 1425 / 2151 over 17,433).
  // The residual 20-45 bucket is the geometrically blocked
  // population: packed rows on diagonal corridors, where a
  // rectangle cannot turn without overlapping its neighbours —
  // that population is the #217 non-rectangular-footprint work.
  assert.deepEqual(plan.stats.lotsFacingTurned, 3106);
  assert.deepEqual(plan.stats.lotsFacingTurnedFull, 1677);
  assert.deepEqual(plan.stats.lotsFacingTurnedPartial, 1429);
  assert.deepEqual(plan.stats.lotsFacingHeld, 19865);
  assert.deepEqual(plan.stats.lotsFacingHeldNoFace, 8180);
  assert.deepEqual(plan.stats.lotsFacingHeldSmallTurn, 7309);
  assert.deepEqual(plan.stats.lotsFacingHeldFacade, 764);
  assert.deepEqual(plan.stats.lotsFacingHeldClear, 3595);
  assert.deepEqual(plan.stats.lotsFacingHeldAlignedMain, 17);
  const { sample, buckets } = censusMismatch(plan.lots);
  assert.equal(sample, 17441);
  assert.deepEqual(buckets, { '0-2': 9262, '2-5': 2997, '5-10': 2022, '10-20': 1191, '20-45': 1969 });
});

function lotCorners(cx, cz, w, d, c, s) {
  const hw = w / 2, hd = d / 2;
  return [
    [cx - hw * c + hd * s, cz - hw * s - hd * c],
    [cx + hw * c + hd * s, cz + hw * s - hd * c],
    [cx + hw * c - hd * s, cz + hw * s + hd * c],
    [cx - hw * c - hd * s, cz - hw * s + hd * c],
  ];
}
function quadsHit(a, b) {
  const axes = [];
  for (const q of [a, b]) {
    for (let i = 0; i < 4; i++) {
      const [x1, z1] = q[i], [x2, z2] = q[(i + 1) % 4];
      axes.push([-((z2 - z1)), x2 - x1]);
    }
  }
  for (const [ax, az] of axes) {
    let mnA = Infinity, mxA = -Infinity, mnB = Infinity, mxB = -Infinity;
    for (const [x, z] of a) { const p = x * ax + z * az; if (p < mnA) mnA = p; if (p > mxA) mxA = p; }
    for (const [x, z] of b) { const p = x * ax + z * az; if (p < mnB) mnB = p; if (p > mxB) mxB = p; }
    if (mxA <= mnB || mxB <= mnA) return false;
  }
  return true;
}

test('facing creates no new overlaps: lot-by-lot SAT over the whole plan', () => {
  // Overlapping footprints are INTENTIONAL in the base plan:
  // stepped siblings share a footprint (#219), so a whole-plan
  // SAT finds tens of thousands of pairs with the pass off too.
  // The facing invariant is narrower: no pair may overlap after
  // the pass that did not overlap before it. Lot order is
  // identical between the two plans, so index pairs compare.
  const hitKeys = (lots) => {
    const CELL = 32;
    const grid = new Map();
    const key = (gx, gz) => gx * 100003 + gz;
    const quads = lots.map((lot) => {
      const c = Math.cos(lot.rot || 0), s = Math.sin(lot.rot || 0);
      // The 0.12 shrink is pullClear's own: exact party-wall
      // touches of packed rows do not read as overlaps.
      return lotCorners(lot.x, lot.z, Math.max(lot.w - 0.12, 0.1), Math.max(lot.d - 0.12, 0.1), c, s);
    });
    quads.forEach((q, i) => {
      let mnX = Infinity, mxX = -Infinity, mnZ = Infinity, mxZ = -Infinity;
      for (const [x, z] of q) { if (x < mnX) mnX = x; if (x > mxX) mxX = x; if (z < mnZ) mnZ = z; if (z > mxZ) mxZ = z; }
      for (let gx = Math.floor(mnX / CELL); gx <= Math.floor(mxX / CELL); gx++) {
        for (let gz = Math.floor(mnZ / CELL); gz <= Math.floor(mxZ / CELL); gz++) {
          const k = key(gx, gz);
          let b = grid.get(k); if (!b) grid.set(k, b = []);
          b.push(i);
        }
      }
    });
    const hits = new Set();
    for (const bucket of grid.values()) {
      for (let a = 0; a < bucket.length; a++) {
        for (let b = a + 1; b < bucket.length; b++) {
          const i = bucket[a], j = bucket[b];
          const k = i < j ? i * 1000003 + j : j * 1000003 + i;
          if (hits.has(k)) continue;
          if (quadsHit(quads[i], quads[j])) hits.add(k);
        }
      }
    }
    return hits;
  };
  const on = planTaipeiBuildings(TAIPEI_GEO);
  const off = planTaipeiBuildings(TAIPEI_GEO, { facing: false });
  const offHits = hitKeys(off.lots);
  const onHits = hitKeys(on.lots);
  let fresh = 0;
  for (const k of onHits) if (!offHits.has(k)) fresh++;
  assert.equal(fresh, 0, `the facing pass creates ${fresh} new overlapping lot pairs`);
});
