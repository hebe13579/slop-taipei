// Issue #271 enforcement: 堤防 flood walls along the riverbanks
// (Tamsui, Keelung, Xindian — both sides), 6.0 m tall, plain
// concrete with a lighter cap and an ivy-green foot strip on the
// land side, toggleable via the Special buildings gear and
// despawned when far.
//
// The wall line is the water ring offset landward by up to 28 m
// (the riverside band's outer edge), pulled river-ward where the
// road pinches so it always clears every roadbed by >= 1.5 m,
// cut at roadbed/path crossings, with fragment closing edges
// (across the river at bridges, tile edges and fragment joins)
// dropped and duplicate chains deduped.
//
// This audit pins (a) the census — the shipped chains are EXACTLY
// what the derivation rule produces from the shipped geodata,
// re-derived here, so the walls can never drift into a hand list;
// (b) the drawn geometry: 6.0 m body, 1.0 m thick, cap to 6.20 m
// above y=0 (base sunk 0.05), green foot strip; (c) every wall
// point clears every roadbed by >= 1.5 m (independent clearance,
// all roadbeds), and no wall segment crosses a roadbed or path
// centreline; (d) the wall hugs the bank — every point within
// 70 m of the water (28 m on a straight reach, up to the 2.5x
// miter cap at a sharp corner) — and no chain's midpoint stands
// in the river; (e) a wall stands at the user's photo site
// (環河北路二段 near 重陽橋）; (f) the lot plan is untouched —
// the walls displace zero buildings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { planTaipeiBuildings } from '../js/taipei-buildings.js';
import {
  planDifangWalls, buildDifangWallGeometry, difangChainSlices,
  roadbedClearance, pointInWater, pointInRing, DIFANG_STYLE,
  DIFANG_PATH_CLASSES,
} from '../js/taipei-difang.js';

const { chains, stats } = planDifangWalls(TAIPEI_GEO);
const geo = buildDifangWallGeometry(chains);

// The builder's tangent-plane conversion, mirrored (the bridges
// test pins the same pair of converters equal).
const [LAT0, LON0] = TAIPEI_GEO.frame.originLatLon;
const A = 6378137.0, E2 = 6.69437999014e-3;
const PHI0 = (LAT0 * Math.PI) / 180, SIN0 = Math.sin(PHI0);
const NRAD = A / Math.sqrt(1 - E2 * SIN0 * SIN0);
const MRAD = (A * (1 - E2)) / Math.pow(1 - E2 * SIN0 * SIN0, 1.5);
const KX = (Math.PI / 180) * NRAD * Math.cos(PHI0);
const KY = (Math.PI / 180) * MRAD;
const toWorld = (lon, lat) => [(lon - LON0) * KX, -(lat - LAT0) * KY];

// Huanhebei/Chongyang photo site: 環河北路二段 near 重陽橋.
const SITE = toWorld(121.5085, 25.0617);

// Distance from a point to the nearest water-ring edge (all water
// polygons, bbox pre-filtered with an 80 m pad: the miter at a
// sharp corner pushes the offset up to 2.5x28 = 70 m from the ring).
function distToWater(x, z) {
  let best = Infinity;
  for (const w of TAIPEI_GEO.water) {
    const ring = w.ring || [];
    if (ring.length < 6) continue;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i + 1 < ring.length; i += 2) {
      x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]);
      z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1]);
    }
    if (x < x0 - 80 || x > x1 + 80 || z < z0 - 80 || z > z1 + 80) continue;
    for (let k = 0; k + 3 <= ring.length; k += 2) {
      const ax = ring[k], az = ring[k + 1], bx = ring[k + 2], bz = ring[k + 3];
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
      let t = l2 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
    }
  }
  return best;
}

test('difang census: chains and lengths by river and bank', () => {
  assert.equal(chains.length, 199);
  assert.equal(Math.round(stats.totalLengthM), 49198);
  assert.deepEqual(
    Object.fromEntries(Object.entries(stats.byRiver).map(([k, v]) => [k, [v.chains, Math.round(v.lengthM)]])),
    { keelung: [84, 16489], tamsui: [81, 24040], xindian: [34, 8668] },
  );
  assert.deepEqual(
    Object.fromEntries(Object.entries(stats.byBank).map(([k, v]) => [k, [v.chains, Math.round(v.lengthM)]])),
    {
      'keelung/north': [44, 8975],
      'keelung/south': [40, 7514],
      'tamsui/east': [30, 10889],
      'tamsui/west': [51, 13151],
      'xindian/north': [21, 4688],
      'xindian/south': [13, 3980],
    },
  );
  // Derivation counters (the rule's own bookkeeping).
  assert.equal(stats.fragments, 10);
  assert.equal(stats.droppedClosing, 239);
  assert.equal(stats.crossingsRoad, 49);
  assert.equal(stats.crossingsPath, 325);
  assert.equal(stats.droppedDuplicate, 13);
  assert.equal(stats.droppedInWater, 2);
  assert.equal(stats.droppedClearance, 9);
});

test('difang geometry: 6 m body, cap, green foot strip', () => {
  assert.equal(DIFANG_STYLE.height, 6.0);
  assert.equal(DIFANG_STYLE.thickness, 1.0);
  assert.equal(geo.triCount, 86112);
  // Base sunk 0.05 (no floating gap over the ground layer);
  // body top at 5.95, cap top at 6.20 above y=0. (Float32Array
  // storage, so compare within 1e-6.)
  let minY = Infinity, maxY = -Infinity;
  for (let i = 1; i < geo.positions.length; i += 3) {
    minY = Math.min(minY, geo.positions[i]);
    maxY = Math.max(maxY, geo.positions[i]);
  }
  assert.ok(Math.abs(minY - -0.05) < 1e-6, `minY ${minY}`);
  assert.ok(Math.abs(maxY - 6.2) < 1e-6, `maxY ${maxY}`);
  // Colours: grey concrete body (#323: user asked for grey; was
  // grey-brown 0x8a8178), lighter grey cap (was 0xa39a8c),
  // ivy-green foot strip (unchanged — planting, not the wall).
  // The green strip sits at the foot (y <= 0.95) on the land side;
  // the cap reaches the top (y 6.20).
  const rgb = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
  const isCol = (i, hex) => {
    const [r, g, b] = rgb(hex);
    return Math.abs(geo.colors[i] - r) < 1e-6 && Math.abs(geo.colors[i + 1] - g) < 1e-6 && Math.abs(geo.colors[i + 2] - b) < 1e-6;
  };
  let green = 0, greenTop = -Infinity, cap = 0, capTop = -Infinity, concrete = 0;
  for (let i = 0; i < geo.colors.length; i += 3) {
    const y = geo.positions[(i / 3) * 3 + 1];
    if (isCol(i, 0x5a7a4a)) { green++; greenTop = Math.max(greenTop, y); }
    else if (isCol(i, 0xa3a3a3)) { cap++; capTop = Math.max(capTop, y); }
    else if (isCol(i, 0x8a8a8a)) concrete++;
  }
  assert.ok(green > 0, 'green foot strip present');
  assert.ok(Math.abs(greenTop - 0.95) < 1e-6, `greenTop ${greenTop}`);
  assert.ok(cap > 0, 'cap coping present');
  assert.ok(Math.abs(capTop - 6.2) < 1e-6, `capTop ${capTop}`);
  assert.ok(concrete > 0, 'concrete body present');
  // Per-chain slices tile the merged arrays exactly.
  const { slices, triCount } = difangChainSlices(chains, geo);
  assert.equal(slices.length, chains.length);
  assert.equal(triCount, geo.triCount);
  assert.equal(slices.reduce((s, x) => s + x.triCount, 0), geo.triCount);
});

test('difang winding: every wall face winds outward (#323)', () => {
  // The old box helper used the same vertex order for the river and
  // land faces, so both got the same computed normal (s x up) and
  // exactly one face per segment was back-face-culled: 167/199
  // chains showed only the river face, 6 only the land face, 26
  // mixed — the wall was invisible from the road side at the
  // Huanhebei photo site. The sign flips along a chain (the
  // chain-averaged land normal is not perpendicular to every
  // segment), so the fix must be per-face. This test walks the
  // emitted geometry in emission order (per segment: body, cap, ivy
  // boxes; per box: river, land, top, bottom, start, end faces) and
  // checks each quad's stored normal against the face's outward
  // direction: river -n, land +n, top +up, bottom -up, start -s,
  // end +s (n = the box's land normal, s = the segment direction).
  // Side/cap dots can be as small as 0.0056 where a segment runs
  // nearly parallel to the chain normal (28 segments under 0.1),
  // so the check is the sign, not the magnitude.
  const FACES = ['river', 'land', 'top', 'bottom', 'start', 'end'];
  const bad = Object.fromEntries(FACES.map((f) => [f, 0]));
  let v = 0, quads = 0;
  for (const ch of chains) {
    const n = ch.landNormal || [0, 0];
    for (let i = 0; i + 2 < ch.pts.length; i += 2) {
      const dx = ch.pts[i + 2] - ch.pts[i], dz = ch.pts[i + 3] - ch.pts[i + 1];
      const L = Math.hypot(dx, dz) || 1;
      const nn = (n[0] || n[1]) ? n : [-dz / L, dx / L];
      const s = [dx / L, dz / L];
      const out = {
        river: [-nn[0], 0, -nn[1]],
        land: [nn[0], 0, nn[1]],
        top: [0, 1, 0],
        bottom: [0, -1, 0],
        start: [-s[0], 0, -s[1]],
        end: [s[0], 0, s[1]],
      };
      for (let b = 0; b < 3; b++) {
        for (let f = 0; f < 6; f++) {
          const o = out[FACES[f]];
          const dot = geo.normals[v * 3] * o[0] + geo.normals[v * 3 + 1] * o[1] + geo.normals[v * 3 + 2] * o[2];
          quads++;
          if (dot <= 0) bad[FACES[f]]++;
          v += 6;
        }
      }
    }
  }
  assert.equal(quads, 43056, `quads checked ${quads}`);
  assert.equal(v * 3, geo.normals.length, 'walk consumed the whole normals array');
  assert.deepEqual(bad, { river: 0, land: 0, top: 0, bottom: 0, start: 0, end: 0 }, `inward faces ${JSON.stringify(bad)}`);
});

test('difang clearance: every wall point clears every roadbed by >= 1.5 m', () => {
  let worst = Infinity, worstAt = null;
  for (const c of chains) {
    for (let i = 0; i + 1 < c.pts.length; i += 2) {
      const cl = roadbedClearance(TAIPEI_GEO.roadbeds, c.pts[i], c.pts[i + 1]);
      if (cl < worst) { worst = cl; worstAt = [c.pts[i], c.pts[i + 1]]; }
    }
  }
  assert.ok(worst >= DIFANG_STYLE.clearM, `worst clearance ${worst.toFixed(2)} m at ${worstAt}`);
});

test('difang gaps: no wall segment crosses a roadbed centreline, and every path it meets is a weave', () => {
  const beds = TAIPEI_GEO.roadbeds;
  const paths = TAIPEI_GEO.roads.filter((r) => DIFANG_PATH_CLASSES.has(r.highway));
  // Bbox index over centreline segments (coarse, 200 m cells).
  const cell = 200;
  const index = new Map();
  const addSeg = (ax, az, bx, bz, kind, poly) => {
    const x0 = Math.floor(Math.min(ax, bx) / cell), x1 = Math.floor(Math.max(ax, bx) / cell);
    const z0 = Math.floor(Math.min(az, bz) / cell), z1 = Math.floor(Math.max(az, bz) / cell);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = `${cx},${cz}`;
        if (!index.has(k)) index.set(k, []);
        index.get(k).push([ax, az, bx, bz, kind, poly]);
      }
    }
  };
  for (const b of beds) {
    const pts = b.pts || [];
    for (let k = 0; k + 3 <= pts.length; k += 2) addSeg(pts[k], pts[k + 1], pts[k + 2], pts[k + 3], 'road', pts);
  }
  for (const p of paths) {
    const pts = p.pts || [];
    for (let k = 0; k + 3 <= pts.length; k += 2) addSeg(pts[k], pts[k + 1], pts[k + 2], pts[k + 3], 'path', pts);
  }
  // A path genuinely crosses the wall only when its vertices near
  // the crossing lie on BOTH sides of the wall line (a riverside
  // path weaving along the wall stays on one side and must not
  // cut it — the planner's rule, re-derived here from the wall
  // segment's own direction).
  const crossT = (ax, az, bx, bz, cx, cz, dx, dz) => {
    const rx = bx - ax, rz = bz - az, sx = dx - cx, sz = dz - cz;
    const den = rx * sz - rz * sx;
    if (Math.abs(den) < 1e-12) return null;
    const t = ((cx - ax) * sz - (cz - az) * sx) / den;
    const u = ((cx - ax) * rz - (cz - az) * rx) / den;
    if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
    return t;
  };
  let roadCrossings = 0, pathWeaves = 0, pathGenuine = 0;
  for (const c of chains) {
    for (let i = 0; i + 2 < c.pts.length; i += 2) {
      const ax = c.pts[i], az = c.pts[i + 1], bx = c.pts[i + 2], bz = c.pts[i + 3];
      const near = new Set();
      const x0 = Math.floor(Math.min(ax, bx) / cell), x1 = Math.floor(Math.max(ax, bx) / cell);
      const z0 = Math.floor(Math.min(az, bz) / cell), z1 = Math.floor(Math.max(az, bz) / cell);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
          for (const s of index.get(`${cx},${cz}`) || []) near.add(s);
        }
      }
      for (const s of near) {
        const t = crossT(ax, az, bx, bz, s[0], s[1], s[2], s[3]);
        if (t === null) continue;
        if (s[4] === 'road') { roadCrossings++; continue; }
        // Path: check both sides near the crossing point.
        const cx = ax + (bx - ax) * t, cz = az + (bz - az) * t;
        const dx = bx - ax, dz = bz - az;
        let pos = false, neg = false;
        const poly = s[5];
        for (let k = 0; k + 1 < poly.length; k += 2) {
          if (Math.hypot(poly[k] - cx, poly[k + 1] - cz) > 30) continue;
          const side = dx * (poly[k + 1] - cz) - dz * (poly[k] - cx);
          if (side > 0.5) pos = true;
          else if (side < -0.5) neg = true;
        }
        if (pos && neg) pathGenuine++;
        else pathWeaves++;
      }
    }
  }
  assert.equal(roadCrossings, 0, `wall segments crossing a roadbed centreline: ${roadCrossings}`);
  assert.equal(pathGenuine, 0, `wall segments a path genuinely crosses: ${pathGenuine}`);
  assert.ok(pathWeaves > 0, 'expected some riverside-path weaves along the wall');
});

test('difang placement: the wall hugs the bank and never stands in the river', () => {
  let farthest = 0;
  let inWaterPoints = 0;
  for (const c of chains) {
    for (let i = 0; i + 1 < c.pts.length; i += 2) {
      farthest = Math.max(farthest, distToWater(c.pts[i], c.pts[i + 1]));
      if (pointInWater(TAIPEI_GEO, c.pts[i], c.pts[i + 1])) inWaterPoints++;
    }
    // No chain's midpoint stands in the river (a cross-river stub).
    const mid = Math.floor((c.pts.length / 2) / 2) * 2;
    assert.equal(pointInWater(TAIPEI_GEO, c.pts[mid], c.pts[mid + 1]), false, `${c.id} midpoint in the river`);
  }
  // The wall hugs the bank: at most the miter cap (2.5x28 = 70 m)
  // from the water at a sharp corner, 28 m on a straight reach.
  assert.ok(farthest <= 70, `farthest wall point from the water: ${farthest.toFixed(1)} m`);
  // Bend clips only: a handful of single vertices where the offset
  // line cuts a sharp river bend. Re-pin deliberately if this moves.
  assert.equal(inWaterPoints, 5);
});

test('difang photo site: a wall stands at 環河北路 near 重陽橋', () => {
  let best = Infinity, bestChain = null;
  for (const c of chains) {
    for (let i = 0; i + 1 < c.pts.length; i += 2) {
      const d = Math.hypot(c.pts[i] - SITE[0], c.pts[i + 1] - SITE[1]);
      if (d < best) { best = d; bestChain = c; }
    }
  }
  assert.ok(best < 25, `nearest wall to the photo site: ${best.toFixed(1)} m`);
  assert.equal(bestChain.river, 'tamsui');
  assert.equal(bestChain.bank, 'east');
});

test('difang plan: the walls displace zero buildings', () => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  assert.equal(plan.lots.length, 76253); // re-pinned for #326: 76,209 -> 76,260 (+51 net: 127 added, 76 removed — lot diff in ntsec326-evidence/lotdiff326.log; the re-site frees the old wrong rects and the old road chords, the correct rects + re-routed roads exclude lots in their place) // Issue #313: 76,260 -> 76,650 (+390 net: 3,016 added, 2,626 removed - every changed lot at z < -7000 in the Beitou creek corridors; full-JSON plan diff in blocks313-evidence/plan-diff-ordered313.log) // Issue #314: 76,650 -> 77,808 (+1,158 net: 3,583 added, 2,425 removed full-JSON - every changed lot inside x -3265..494, z -8184..-4923 in the old interior; the new door plates flip 82 blocks to fine grain, re-subdividing them; plan diff in heights314-evidence/plan-diff-full-transplant314.log) // Issue #386: 77,808 -> 76,253 (-1,555 - part 2 re-lays 454 more blocks on rotated grids; a rotated grid's corner lots fall outside the inset bbox)
});
