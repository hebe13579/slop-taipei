// Issue #239 enforcement: parapet trims at merge/branch mouths.
//
// Parapets were emitted per line along the line's whole length, so at
// every merge/branch mouth the branch's inner fence ran across the
// main deck's driving surface and across the branch's own mouth,
// and every line end landing on another deck carried a full-width
// end-cap wall across the mouth. parapetTrims() (js/taipei-viaduct.js)
// suppresses a strip — and a terminal cap — over the stretch where
// it lies inside another line's driving corridor at the same level.
// The visual strips and the drive-model colliders consume the same
// trims, so the fence a driver sees is the fence that blocks them.
//
// These audits pin the rule on a synthetic digest (a shallow Y, a
// collinear continuation, a stacked crossing, a parallel road) and
// on the real tile (census totals, the drive colliders end to end,
// the user's Zhoumei type site).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { buildDeckGeometry, parapetTrims, PARAPET_H } from '../js/taipei-viaduct.js';
import { buildDriveModel } from '../js/taipei-drive.js';

// Main east-west deck; a 14-degree branch off its middle; the main
// road continuing under a new way id; a stacked crossing 6 m above;
// a parallel deck 34 m away (clear of the branch's corridor — the
// branch ends at z 20, so 20 m would overlap its mouth zone). All
// at h 9 except the stacked line.
const digest = {
  deckDepth: 1.8,
  piers: [],
  lines: [
    { wayId: 1, name: 'main', width: 12, pts: [-60, 0, 60, 0], h: [9, 9] },
    { wayId: 2, name: 'branch', width: 8, pts: [0, 0, 80, 20], h: [9, 9] },
    { wayId: 3, name: 'continuation', width: 12, pts: [60, 0, 120, 0], h: [9, 9] },
    { wayId: 4, name: 'stacked', width: 10, pts: [0, -40, 0, 40], h: [15, 15] },
    { wayId: 5, name: 'parallel', width: 12, pts: [-60, 34, 60, 34], h: [9, 9] },
  ],
};

test('synthetic Y: the branch fence starts where the corridors separate', () => {
  const tr = parapetTrims(digest);
  const branch = tr.lines[1].segments[0];
  // The branch leaves south-east; its north (right) side faces the
  // main deck and is trimmed over the mouth, kept after the
  // centrelines separate (~t 0.49 by the corridor geometry). The
  // outer (left) side is trimmed only briefly at the node itself:
  // its strip offset carries it over the main deck's pavement for
  // the first ~t 0.12, which is gore paving too, not a fence.
  assert.equal(branch.left.length, 1);
  assert.ok(branch.left[0][0] > 0.08 && branch.left[0][0] < 0.16,
    `outer side resumes at t=${branch.left[0][0]}`);
  assert.equal(branch.left[0][1], 1);
  assert.equal(branch.right.length, 1);
  assert.ok(branch.right[0][0] > 0.4 && branch.right[0][0] < 0.55,
    `trimmed side resumes at t=${branch.right[0][0]}`);
  assert.equal(branch.right[0][1], 1);
  // The main deck's south (left) strip is trimmed across the gore
  // the branch corridor overlaps — a gap in the middle of the
  // segment, fence on both sides of it.
  const main = tr.lines[0].segments[0];
  assert.equal(main.left.length, 2, 'gore gap splits the main strip in two');
  assert.ok(main.left[0][1] > 0.5 && main.left[0][1] < 0.6, `gore starts t=${main.left[0][1]}`);
  assert.ok(main.left[1][0] > 0.8 && main.left[1][0] < 0.9, `gore ends t=${main.left[1][0]}`);
  assert.deepEqual(main.right, [[0, 1]]);
});

test('synthetic Y: continuations, stacked crossings and parallels keep their fences', () => {
  const tr = parapetTrims(digest);
  // The through road under a new way id: no trim at the shared node.
  assert.deepEqual(tr.lines[2].segments[0].left, [[0, 1]]);
  assert.deepEqual(tr.lines[2].segments[0].right, [[0, 1]]);
  // The stacked crossing 6 m above: no trim on either line.
  assert.deepEqual(tr.lines[3].segments[0].left, [[0, 1]]);
  assert.deepEqual(tr.lines[3].segments[0].right, [[0, 1]]);
  // The parallel deck 20 m away: no trim.
  assert.deepEqual(tr.lines[4].segments[0].left, [[0, 1]]);
  assert.deepEqual(tr.lines[4].segments[0].right, [[0, 1]]);
});

test('synthetic Y: end caps survive only where the road does not continue into another deck', () => {
  const tr = parapetTrims(digest);
  // The branch's start cap sits on the main deck: suppressed.
  assert.equal(tr.lines[1].capStart, false, 'branch mouth has no cap wall');
  assert.equal(tr.lines[1].capEnd, true);
  // The through-road way boundary: both caps survive — the road
  // continues, so there is no exposed face to close.
  assert.equal(tr.lines[0].capEnd, true, 'main end cap survives at the continuation');
  assert.equal(tr.lines[2].capStart, true, 'continuation start cap survives');
  assert.equal(tr.lines[0].capStart, true);
  assert.equal(tr.lines[3].capStart, true, 'stacked line caps survive');
  assert.equal(tr.lines[4].capEnd, true);
});

test('trims are deterministic and memoized', () => {
  const a = parapetTrims(digest);
  const b = parapetTrims(digest);
  assert.equal(a, b, 'same digest object, same trim object');
  const copy = { deckDepth: digest.deckDepth, piers: [], lines: digest.lines.map((l) => ({ ...l, pts: [...l.pts], h: [...l.h] })) };
  assert.deepEqual(parapetTrims(copy), a, 'same geometry, same trims');
});

test('renderer: no parapet top stands inside another same-level corridor at a mouth', () => {
  // Parapet top faces are the only concrete triangles whose three
  // vertices all sit at deck-top + 1.1 m. Their centroids must
  // never lie deep inside another eligible line's corridor at the
  // same level — that is the visible fence across a road. The
  // control digest (branch moved 200 m away, no mouth) must still
  // show such centroids: the fence exists where no mouth trims it.
  // (Triangle counts do not work here: a split strip emits one
  // quad per kept interval, so trimming can add quads.)
  const topCentroids = (geo) => {
    // Parapet-top heights per line (h + 1.1); slab tops sit at h
    // and cap quads mix heights, so neither is collected here.
    const topYs = new Set(digest.lines.flatMap((L) => L.h.map((h) => h + 1.1)));
    const out = [];
    const p = geo.concrete.positions;
    for (let i = 0; i + 8 < p.length; i += 9) {
      const ys = [p[i + 1], p[i + 4], p[i + 7]];
      const y0 = ys[0];
      if (ys.every((y) => Math.abs(y - y0) < 0.01) && [...topYs].some((ty) => Math.abs(y0 - ty) < 0.01)) {
        out.push([(p[i] + p[i + 3] + p[i + 6]) / 3, (p[i + 2] + p[i + 5] + p[i + 8]) / 3, y0]);
      }
    }
    return out;
  };
  // Rectangular corridor: the driving surface ends at the
  // segment's end planes. A capsule (distance to the clamped
  // nearest point) would flag a fence standing past a deck's end
  // corner — empty junction apron, not a road — as a hit (the
  // branch's fence 3 m past the parallel deck's end).
  const corridorHit = (x, z, y) => {
    for (const L of digest.lines) {
      const n = L.pts.length / 2, half = (L.width || 6) / 2;
      for (let i = 0; i + 1 < n; i++) {
        const ax = L.pts[2 * i], az = L.pts[2 * i + 1], bx = L.pts[2 * i + 2], bz = L.pts[2 * i + 3];
        const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1;
        const ux = dx / len, uz = dz / len;
        const along = (x - ax) * ux + (z - az) * uz;
        if (along < 0 || along > len) continue;
        const perp = Math.abs((x - ax) * uz - (z - az) * ux);
        if (perp > half - 1.0) continue;
        const hM = L.h[i] + (L.h[i + 1] - L.h[i]) * (along / len);
        if (Math.abs(y - hM) <= 2.0) return L.name;
      }
    }
    return null;
  };
  const merged = buildDeckGeometry(digest);
  const mergedHits = topCentroids(merged).map(([x, z, y]) => corridorHit(x, z, y)).filter(Boolean);
  assert.equal(mergedHits.length, 0, `parapet tops inside another corridor: ${mergedHits.join(', ')}`);
  // Wiring: every kept interval emits exactly one top quad (2
  // triangles) and suppressed stretches emit none; the asphalt
  // ribbons are untrimmed (one quad per segment whatever the trims).
  const tr = parapetTrims(digest);
  let expectedTopTris = 0, segments = 0;
  tr.lines.forEach((line) => line.segments.forEach((s) => {
    segments++;
    expectedTopTris += (s.left.length + s.right.length) * 2;
  }));
  assert.equal(topCentroids(merged).length, expectedTopTris,
    'one top quad per kept interval, none per suppressed stretch');
  assert.equal(merged.asphalt.positions.length, segments * 18,
    'one asphalt quad per segment, trims or no trims');
});

test('real tile: census totals pinned (issue #239, main 01c30cef)', () => {
  const tr = parapetTrims(TAIPEI_GEO.elevatedRoads);
  assert.equal(Math.round(tr.stats.blockedM), 13641,
    'blocked parapet metres, sample-counted (independent census probe: 13,461 m; interval length 13,319 m — the three agree within sampling tolerance)');
  assert.equal(tr.stats.suppressedCaps, 205, 'terminal caps inside another same-level corridor');
  assert.equal(tr.stats.affectedStrips, 594, 'strips carrying a suppressed stretch');
  // The user's type site: the 承德路入口匝道 mouth on the 洲美快速道路
  // is trimmed, and the 洲美 way's start cap at the 大業路 mouth is gone.
  const byWay = new Map(TAIPEI_GEO.elevatedRoads.lines.map((l, i) => [l.wayId, i]));
  const chengde = tr.lines[byWay.get(1118328900)];
  assert.ok(chengde.segments.some((s) => s.left.length !== 1 || s.right.length !== 1 || s.left[0][0] !== 0 || s.right[0][0] !== 0),
    'Chengde entry ramp has a trimmed strip at the Zhoumei mouth');
  assert.equal(tr.lines[byWay.get(33072354)].capStart, false, 'Zhoumei start cap at the Daye mouth suppressed');
});

test('real tile: no drive collider stands deep inside another same-level corridor at a mouth', () => {
  // Independent in-test corridor check over the drive model's own
  // parapet colliders: a collider centre more than 1 m inside
  // another line's corridor at the same level is a fence across a
  // road. The 1 m margin covers the trim sampler's 1 m grid.
  // Eligibility is reimplemented here from the issue spec, not
  // imported: a pair counts only if the centrelines approach
  // within 2 m (a mouth), excluding pure continuations unless
  // the pair also meets elsewhere. Twin carriageways that never
  // meet (福林橋: 8.6 m apart, digest corridors overlapping) are
  // NOT mouths — their inner fences are the directions' median,
  // a separate widths question — and are exempt here.
  const E = TAIPEI_GEO.elevatedRoads;
  const model = buildDriveModel(E);
  // Segment-segment distance plus the closest point on the FIRST
  // segment. The elsewhere rescue below must use the closest
  // point, NOT the segment-pair midpoint: a 261 m segment that
  // only touches the other line at its endpoint has a midpoint
  // ~80 m from the node and would falsely read as "meets
  // elsewhere" (the 正氣橋 continuation case).
  const segSeg = (ax, az, bx, bz, cx, cz, dx, dz) => {
    const ex = bx - ax, ez = bz - az, fx = dx - cx, fz = dz - cz;
    const den = ex * fz - ez * fx;
    if (den !== 0) {
      const t = ((cx - ax) * fz - (cz - az) * fx) / den, u = ((cx - ax) * ez - (cz - az) * ex) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return [0, ax + ex * t, az + ez * t];
    }
    const proj = (px, pz, x1, z1, gx, gz) => {
      const L2 = gx * gx + gz * gz || 1;
      const t = Math.max(0, Math.min(1, ((px - x1) * gx + (pz - z1) * gz) / L2));
      return [x1 + gx * t, z1 + gz * t, t];
    };
    const cands = [];
    for (const [px, pz] of [[cx, cz], [dx, dz]]) {
      const [qx, qz] = proj(px, pz, ax, az, ex, ez);
      cands.push([Math.hypot(px - qx, pz - qz), qx, qz]);
    }
    for (const [px, pz] of [[ax, az], [bx, bz]]) {
      const [qx, qz] = proj(px, pz, cx, cz, fx, fz);
      cands.push([Math.hypot(px - qx, pz - qz), px, pz]);
    }
    cands.sort((a, b) => a[0] - b[0]);
    return cands[0];
  };
  const endsOf = (L) => {
    const n = L.pts.length / 2;
    return [[L.pts[0], L.pts[1], 0], [L.pts[2 * n - 2], L.pts[2 * n - 1], n - 1]];
  };
  const eligible = new Set();
  const lines = E.lines;
  for (let a = 0; a < lines.length; a++) {
    for (let b = a + 1; b < lines.length; b++) {
      const A = lines[a], B = lines[b];
      const nodes = [];
      for (const [ax, az] of endsOf(A)) {
        for (const [bx, bz] of endsOf(B)) {
          if (Math.hypot(ax - bx, az - bz) <= 2) nodes.push([ax, az]);
        }
      }
      let meets = false, meetsElsewhere = false;
      const na = A.pts.length / 2, nb = B.pts.length / 2;
      for (let i = 0; i + 1 < na && !meetsElsewhere; i++) {
        for (let j = 0; j + 1 < nb; j++) {
          const ax = A.pts[2 * i], az = A.pts[2 * i + 1], bx = A.pts[2 * i + 2], bz = A.pts[2 * i + 3];
          const cx = B.pts[2 * j], cz = B.pts[2 * j + 1], dx = B.pts[2 * j + 2], dz = B.pts[2 * j + 3];
          if (Math.min(ax, bx) - 2 > Math.max(cx, dx) || Math.max(ax, bx) + 2 < Math.min(cx, dx) ||
              Math.min(az, bz) - 2 > Math.max(cz, dz) || Math.max(az, bz) + 2 < Math.min(cz, dz)) continue;
          const [dd, qx, qz] = segSeg(ax, az, bx, bz, cx, cz, dx, dz);
          if (dd <= 2) {
            meets = true;
            if (!nodes.some(([nx, nz]) => Math.hypot(qx - nx, qz - nz) <= 30)) { meetsElsewhere = true; break; }
          }
        }
      }
      if (!meets) continue;
      let continuation = false;
      if (nodes.length === 1 && !meetsElsewhere) {
        const [nx, nz] = nodes[0];
        const chord = (L, endIdx) => {
          const n = L.pts.length / 2;
          const step = (endIdx === 0 ? 1 : -1) * Math.min(20, n - 1);
          const ti = endIdx === 0 ? step : n - 1 + step;
          return [L.pts[2 * ti] - nx, L.pts[2 * ti + 1] - nz];
        };
        const aEnd = Math.hypot(A.pts[0] - nx, A.pts[1] - nz) <= 2 ? 0 : na - 1;
        const bEnd = Math.hypot(B.pts[0] - nx, B.pts[1] - nz) <= 2 ? 0 : nb - 1;
        const [u1, v1] = chord(A, aEnd), [u2, v2] = chord(B, bEnd);
        const dot = (u1 * u2 + v1 * v2) / (Math.hypot(u1, v1) * Math.hypot(u2, v2) || 1);
        continuation = dot < -0.766;
      }
      if (!continuation) eligible.add(`${a}|${b}`);
    }
  }
  const wayIndex = new Map(lines.map((L, i) => [L.wayId, i]));
  const CELL = 48;
  const cells = new Map();
  const ckey = (ix, iz) => (ix + 4096) * 8192 + (iz + 4096);
  const segs = [];
  for (let li = 0; li < lines.length; li++) {
    const L = lines[li];
    const n = L.pts.length / 2, half = (L.width || 6) / 2;
    for (let i = 0; i + 1 < n; i++) {
      const s = {
        li,
        ax: L.pts[2 * i], az: L.pts[2 * i + 1], bx: L.pts[2 * i + 2], bz: L.pts[2 * i + 3],
        half, hA: L.h?.[i] ?? 0, hB: L.h?.[i + 1] ?? 0,
      };
      s.len = Math.hypot(s.bx - s.ax, s.bz - s.az);
      s.ux = s.len ? (s.bx - s.ax) / s.len : 0; s.uz = s.len ? (s.bz - s.az) / s.len : 0;
      segs.push(s);
      const minX = Math.min(s.ax, s.bx) - half, maxX = Math.max(s.ax, s.bx) + half;
      const minZ = Math.min(s.az, s.bz) - half, maxZ = Math.max(s.az, s.bz) + half;
      for (let ix = Math.floor(minX / CELL); ix <= Math.floor(maxX / CELL); ix++) {
        for (let iz = Math.floor(minZ / CELL); iz <= Math.floor(maxZ / CELL); iz++) {
          const k = ckey(ix, iz);
          if (!cells.has(k)) cells.set(k, []);
          cells.get(k).push(s);
        }
      }
    }
  }
  let checked = 0;
  for (const c of model.parapetColliders) {
    const cx = c.obb.cx, cz = c.obb.cz;
    checked++;
    const ci = wayIndex.get(c.wayId);
    // The collider's OWN deck surface at the collider centre:
    // the level comparison must be surface-to-surface with the
    // same 2.0 m band the trim rule uses. The collider midY sits
    // ~0.35 m below the surface and the old 2.1 m window let a
    // 2.3 m grade separation (圓山交流道 diverging from the
    // 中山高速公路 mainline) read as "same level".
    let ownH = null;
    if (ci != null) {
      let bestPerp = Infinity;
      for (const s of segs) {
        if (s.li !== ci) continue;
        const px = cx - s.ax, pz = cz - s.az;
        const along = px * s.ux + pz * s.uz;
        if (along < 0 || along > s.len) continue;
        const perp = Math.abs(px * s.uz - pz * s.ux);
        if (perp < bestPerp) { bestPerp = perp; ownH = s.hA + (s.hB - s.hA) * (s.len ? along / s.len : 0); }
      }
    }
    if (ownH == null) ownH = (c.maxY + (c.minY ?? 0) + 0.7) / 2;
    for (const s of cells.get(ckey(Math.floor(cx / CELL), Math.floor(cz / CELL))) || []) {
      if (s.li === ci) continue;
      if (ci == null || !eligible.has(`${Math.min(ci, s.li)}|${Math.max(ci, s.li)}`)) continue;
      const px = cx - s.ax, pz = cz - s.az;
      // Rectangular corridor: the driving surface ends at the
      // segment's end planes (see the renderer test). A capsule
      // check flags fences in the empty apron past a deck's end.
      const along = px * s.ux + pz * s.uz;
      if (along < 0 || along > s.len) continue;
      const d = Math.abs(px * s.uz - pz * s.ux);
      if (d > s.half - 1.0) continue;
      const t = s.len ? along / s.len : 0;
      const hM = s.hA + (s.hB - s.hA) * t;
      assert.ok(Math.abs(ownH - hM) > 2.0,
        `collider at (${cx.toFixed(1)}, ${cz.toFixed(1)}) stands ${d.toFixed(2)} m inside a same-level corridor (other surface ${hM.toFixed(1)} m, own surface ${ownH.toFixed(1)} m)`);
    }
  }
  assert.ok(checked > 4000, `checked ${checked} parapet colliders`);
});
