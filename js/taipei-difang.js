// js/taipei-difang.js — 堤防 flood walls along the riverbanks (issue #271).
//
// Pure geometry, the taipei-skybridges.js pattern — no three.js here,
// taipei-boot.js wraps the arrays into one mesh per chain, so node
// tests pin the geometry directly.
//
// The walls follow the riverbank on the LAND side of the water edge,
// offset landward by up to 28 m — the riverside band's outer edge
// (tools/taipei/build-taipei-geodata.mjs: the 30 m band is "the
// levee/wharf strip between the bank line and the first carriageway").
// At the user's photo site (環河北路二段 near 重陽橋) the 28 m offset
// line runs exactly along 環河北路. Where the road pinches toward the
// river the wall pulls river-ward so it always clears every roadbed
// ribbon by >= 1.5 m; where it cannot clear, the vertex drops and the
// chain gaps. Gaps are also cut wherever the wall line crosses a
// roadbed centreline (bridges, ramps) or a path centreline (park
// entrances). No wall footprint overlaps a roadbed.
//
// Height 6.0 m: the 1971 Taipei flood plan's standard levee
// (117 km floodwall, 6.00-9.50 m; crest EL 9.65 m); the user's photo
// agrees (the wall is ~2x a ~3 m dump truck above the road).
// Colours from the photo: weathered concrete grey-brown, lighter cap
// coping, ivy-green strip at the foot on the land (road) side.
//
// Scope: the three main rivers only, from water polygons with
// area >= 90,000 m^2, excluding named creeks (外雙溪 / 磺溪 / 五分港溪).
// The wall follows the riverbank on both sides wherever the offset
// line exists — the levee is a real structure whether it fronts a
// road, as at 環河北路， or runs through a riverside park, as on the
// Xindian north bank and the Keelung north bank. Fragment closing
// edges (across the river at bridges, tile edges and fragment joins)
// are dropped, and chains duplicated by overlapping fragments are
// deduped, so no wall runs across a river and no bank is doubled.

export const DIFANG_STYLE = {
  height: 6.0,        // standard 6 m levee (1971 flood plan; photo agrees)
  thickness: 1.0,     // vertical concrete wall
  capH: 0.25,         // coping on top
  capOverhang: 0.1,   // coping overhang each side
  greenH: 1.0,        // ivy strip at the foot, land side
  greenT: 0.15,       // ivy strip thickness
  offsetM: 28,        // wall line = water ring offset landward (band outer edge)
  clearM: 1.5,        // min clearance from the wall line to any roadbed ribbon edge
  minOffsetM: 2,      // closest the wall may sit to the water edge
  gapPathM: 4,        // half-gap cut at path-centreline crossings
  // (road gaps are angle-aware: (halfWidth + clearM)/sin(angle) + 2,
  // capped at 40 m — a shallow ramp crossing needs a longer gap
  // than a perpendicular bridge)
  minChainM: 60,      // shorter chains drop as fragments
  minAreaM2: 90000,   // water polygons below this are ponds/creeks, not rivers
};

// Creeks whose banks are small concrete channels, not 6 m flood walls.
export const DIFANG_EXCLUDED_NAMES = new Set(['外雙溪', '磺溪', '五分港溪']);
// Footways / paths whose centrelines cut gaps in the wall (park entrances).
export const DIFANG_PATH_CLASSES = new Set([
  'footway', 'path', 'cycleway', 'pedestrian', 'steps', 'corridor',
]);

// Polygon area (m^2) by the shoelace formula; ring is a flat [x, z, ...] array.
export function ringAreaM2(ring) {
  let a = 0;
  for (let i = 0; i + 1 < ring.length; i += 2) {
    const x1 = ring[i], z1 = ring[i + 1];
    const x2 = ring[(i + 2) % ring.length], z2 = ring[(i + 3) % ring.length];
    a += x1 * z2 - x2 * z1;
  }
  return Math.abs(a) / 2;
}

function ringBBox(ring) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i + 1 < ring.length; i += 2) {
    x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]);
    z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1]);
  }
  return { x0, x1, z0, z1 };
}

function bboxOverlaps(a, b, pad = 0) {
  return a.x0 - pad <= b.x1 && a.x1 + pad >= b.x0 && a.z0 - pad <= b.z1 && a.z1 + pad >= b.z0;
}

// The big-river fragments the walls follow: water polygons with
// area >= minAreaM2, excluding named creeks.
export function selectRiverFragments(geo) {
  const out = [];
  for (const w of geo?.water || []) {
    const ring = w.ring || [];
    if (ring.length < 6) continue;
    if (DIFANG_EXCLUDED_NAMES.has(w.name || '')) continue;
    const area = ringAreaM2(ring);
    if (area < DIFANG_STYLE.minAreaM2) continue;
    out.push({ name: w.name || '', river: w.river || '', ring, area });
  }
  return out;
}

// Densify an offset ring so no segment exceeds maxSeg metres.
// The source rings are coarse (the 0.26M Tamsui piece has 17 points
// for a 500 m-wide river), so a fragment closing edge can be a
// SINGLE long segment: its two endpoint vertices sit near the banks
// and survive every vertex test, and the wall then jumps straight
// across the river. Subdividing to <= 25 m puts intermediate
// vertices mid-river, where the 1.5x closing test drops them and
// the run breaks. Base points, normals and miter distances are
// interpolated together (normals renormalised).
export function densifyOffset(off, maxSeg = 25) {
  const pts = [], normals = [], base = [], dist = [];
  const n = off.pts.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = off.pts[i], p1 = off.pts[i + 1];
    const b0 = off.base[i], b1 = off.base[i + 1];
    const n0 = off.normals[i], n1 = off.normals[i + 1];
    const d0 = off.dist[i], d1 = off.dist[i + 1];
    const segLen = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const steps = Math.max(1, Math.ceil(segLen / maxSeg));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const lerp = (a, b) => a + (b - a) * t;
      pts.push([lerp(p0[0], p1[0]), lerp(p0[1], p1[1])]);
      base.push([lerp(b0[0], b1[0]), lerp(b0[1], b1[1])]);
      let nx = lerp(n0[0], n1[0]), nz = lerp(n0[1], n1[1]);
      const L = Math.hypot(nx, nz) || 1;
      normals.push([nx / L, nz / L]);
      dist.push(lerp(d0, d1));
    }
  }
  pts.push(off.pts[n - 1]);
  base.push(off.base[n - 1]);
  normals.push(off.normals[n - 1]);
  dist.push(off.dist[n - 1]);
  return { pts, normals, base, dist };
}

// Point-in-ring (ray casting) on one flat [x, z, ...] ring.
export function pointInRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; i += 2) {
    const xi = ring[i], zi = ring[i + 1];
    const xj = ring[j], zj = ring[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    j = i;
  }
  return inside;
}

// Offset a ring outward by d (port of tools/taipei/build-taipei-geodata.mjs
// offsetRingOutward: >=12 m decimation, per-vertex bisector normals).
// Outward is chosen by a point-in-ring test, NOT by the build script's
// centroid test: the centroid test fails on long thin fragments (a
// west-bank vertex at the fragment's far south end is south of the
// centroid, so a landward normal pointing south-west dot-products
// negative and gets flipped INTO the river). 5 m along the outward
// normal must be outside the water; 5 m the other way must be in it.
// (Closing-edge vertices have water on both sides — either direction
// is along the river, and the 1.5x test in the planner drops them.)
// Returns {pts, normals, base, dist} — pts[i] is base[i] + normals[i]
// * dist[i] (dist is the miter-scaled offset distance, >= d at sharp
// corners), closed (last point repeats the first).
export function offsetRingOutward(ring, d) {
  let pts = [];
  for (let i = 0; i + 1 < ring.length; i += 2) pts.push([ring[i], ring[i + 1]]);
  if (pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.01) pts.pop();
  const dec = pts.length ? [pts[0]] : [];
  for (let i = 1; i < pts.length; i++) {
    if (Math.hypot(pts[i][0] - dec[dec.length - 1][0], pts[i][1] - dec[dec.length - 1][1]) >= 12) dec.push(pts[i]);
  }
  if (dec.length < 3) return null;
  pts = dec;
  const nrm = (u, v) => {
    const dx = v[0] - u[0], dz = v[1] - u[1], L = Math.hypot(dx, dz) || 1;
    return [-dz / L, dx / L];
  };
  const out = [], normals = [], dist = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], a = pts[(i + pts.length - 1) % pts.length], b = pts[(i + 1) % pts.length];
    const n1 = nrm(a, p), n2 = nrm(p, b);
    let mx = n1[0] + n2[0], mz = n1[1] + n2[1];
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-6) { mx = n1[0]; mz = n1[1]; } else { mx /= ml; mz /= ml; }
    // Outward = the side whose 5 m probe is outside the water.
    const tIn = pointInRing(ring, p[0] + mx * 5, p[1] + mz * 5);
    const bIn = pointInRing(ring, p[0] - mx * 5, p[1] - mz * 5);
    if (tIn && !bIn) { mx = -mx; mz = -mz; }
    const cosHalf = Math.max(0.35, Math.abs(mx * n1[0] + mz * n1[1]));
    const dd = Math.min(d / cosHalf, 2.5 * d);
    out.push([p[0] + mx * dd, p[1] + mz * dd]);
    normals.push([mx, mz]);
    dist.push(dd);
  }
  out.push(out[0]);
  normals.push(normals[0]);
  dist.push(dist[0]);
  return { pts: out, normals, base: [...pts, pts[0]], dist };
}

// Signed clearance from a point to the nearest roadbed edge:
// distance to the bed's centreline minus its half width
// (negative = inside the carriageway). Mirrors
// js/taipei-skybridges.js roadbedClearance.
export function roadbedClearance(beds, x, z) {
  let best = Infinity;
  for (const b of beds || []) {
    const pts = b.pts || [];
    const half = (b.width || 6) / 2;
    for (let k = 0; k + 3 <= pts.length; k += 2) {
      const ax = pts[k], az = pts[k + 1], bx = pts[k + 2], bz = pts[k + 3];
      const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
      let t = len2 ? ((x - ax) * dx + (z - az) * dz) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t)) - half;
      if (d < best) best = d;
    }
  }
  return best;
}

// Distance from a point to the nearest centreline segment in a list
// of polylines (each a flat [x, z, ...] array).
function minCentrelineDist(polylines, x, z) {
  let best = Infinity;
  for (const pts of polylines) {
    for (let k = 0; k + 3 <= pts.length; k += 2) {
      const ax = pts[k], az = pts[k + 1], bx = pts[k + 2], bz = pts[k + 3];
      const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
      let t = len2 ? ((x - ax) * dx + (z - az) * dz) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
      if (d < best) best = d;
    }
  }
  return best;
}

// Intersection of segments (a,b) and (c,d) as t along (a,b), or null.
// Inclusive: a path ending at the wall is a park entrance and still
// cuts a gap. Parallel/collinear overlaps return null (the clearance
// clamp keeps the wall off every roadbed, so a collinear overlap
// cannot happen for roadbeds).
function segmentCrossT(ax, az, bx, bz, cx, cz, dx, dz) {
  const rx = bx - ax, rz = bz - az, sx = dx - cx, sz = dz - cz;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((cx - ax) * sz - (cz - az) * sx) / den;
  const u = ((cx - ax) * rz - (cz - az) * rx) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return Math.max(0, Math.min(1, t));
}

// Point-in-polygon (ray casting) against the water list, bbox
// pre-filtered. A point inside any water polygon is in the river.
export function pointInWater(geo, x, z) {
  for (const w of geo?.water || []) {
    const ring = w.ring || [];
    if (ring.length < 6) continue;
    const bb = ringBBox(ring);
    if (x < bb.x0 || x > bb.x1 || z < bb.z0 || z > bb.z1) continue;
    let inside = false;
    for (let i = 0, j = ring.length - 2; i < ring.length; i += 2) {
      const xi = ring[i], zi = ring[i + 1];
      const xj = ring[j], zj = ring[j + 1];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
      j = i;
    }
    if (inside) return true;
  }
  return false;
}

// River label for a fragment: the geodata name when it names the
// river, else by position (Xindian is the southern river).
function riverOf(frag) {
  if (frag.name === '基隆河' || frag.river === 'keelung') return 'keelung';
  const bb = ringBBox(frag.ring);
  const cz = (bb.z0 + bb.z1) / 2;
  if (cz > 1000) return 'xindian';
  return 'tamsui';
}

// Cut a polyline (flat [x, z, ...] pts) at crossings: `crossings` is
// [{s, gap}] arc positions with the half-gap to remove on either
// side. Arc-length based, endpoints interpolated. Returns sub-polylines.
function cutAtCrossings(pts, crossings) {
  if (!crossings.length) return [pts];
  const n = pts.length / 2;
  const cum = [0];
  for (let i = 1; i < n; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i * 2] - pts[(i - 1) * 2], pts[i * 2 + 1] - pts[(i - 1) * 2 + 1]));
  }
  const total = cum[n - 1];
  const gaps = crossings.map((c) => [Math.max(0, c.s - c.gap), Math.min(total, c.s + c.gap)])
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const g of gaps) {
    if (merged.length && g[0] <= merged[merged.length - 1][1]) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], g[1]);
    } else merged.push([...g]);
  }
  const pointAt = (s) => {
    if (s <= 0) return [pts[0], pts[1]];
    if (s >= total) return [pts[(n - 1) * 2], pts[(n - 1) * 2 + 1]];
    let i = 1;
    while (i < n && cum[i] < s) i++;
    const segLen = cum[i] - cum[i - 1] || 1;
    const t = (s - cum[i - 1]) / segLen;
    return [
      pts[(i - 1) * 2] + (pts[i * 2] - pts[(i - 1) * 2]) * t,
      pts[(i - 1) * 2 + 1] + (pts[i * 2 + 1] - pts[(i - 1) * 2 + 1]) * t,
    ];
  };
  const kept = [];
  let cur = 0;
  for (const [g0, g1] of [...merged, [Infinity, Infinity]]) {
    if (g0 > cur) {
      const sub = [];
      const a = pointAt(cur), b = pointAt(Math.min(g0, total));
      sub.push(a[0], a[1]);
      for (let i = 1; i < n - 1; i++) {
        if (cum[i] > cur && cum[i] < g0) sub.push(pts[i * 2], pts[i * 2 + 1]);
      }
      sub.push(b[0], b[1]);
      if (sub.length >= 4) kept.push(sub);
    }
    cur = Math.max(cur, g1);
    if (cur >= total) break;
  }
  return kept;
}

// Split a polyline into maximal runs of points that clear every
// roadbed by >= clearM. A final safety trim: cut endpoints are
// interpolated (their clearance was never clamped), and the
// offset clamp's binary search assumes clearance is monotone in
// the offset — which fails where a road stands on both sides of
// the wall. Splitting (never bridging) guarantees every surviving
// wall point clears every roadbed.
function splitByClearance(pts, beds, clearM) {
  const runs = [];
  let run = [];
  const flush = () => {
    if (run.length >= 4) runs.push(run);
    run = [];
  };
  for (let i = 0; i + 1 < pts.length; i += 2) {
    if (roadbedClearance(beds, pts[i], pts[i + 1]) >= clearM) {
      run.push(pts[i], pts[i + 1]);
    } else flush();
  }
  flush();
  return runs;
}

function chainLengthM(pts) {
  let L = 0;
  for (let i = 2; i < pts.length; i += 2) L += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
  return L;
}

// Plan the wall chains from the shipped geodata. Pure function of geo.
export function planDifangWalls(geo) {
  const S = DIFANG_STYLE;
  const beds = geo?.roadbeds || [];
  const paths = (geo?.roads || []).filter((r) => DIFANG_PATH_CLASSES.has(r.highway));
  const tile = geo?.frame?.bbox || { minX: -10193.2, maxX: 1513.8, minZ: -12960.5, maxZ: 2547.8 };
  const frags = selectRiverFragments(geo);
  const chains = [];
  const stats = {
    fragments: frags.length, offsetVertices: 0, droppedNoClearance: 0,
    droppedOutsideTile: 0, droppedClosing: 0, crossingsRoad: 0,
    crossingsPath: 0, crossingsPathWeave: 0, droppedShort: 0,
    droppedDuplicate: 0, droppedInWater: 0, droppedClearance: 0,
  };
  let chainId = 0;
  for (const frag of frags) {
    const river = riverOf(frag);
    const offRaw = offsetRingOutward(frag.ring, S.offsetM);
    if (!offRaw) continue;
    // Densify so a fragment closing edge (one long segment in the
    // coarse ring) gets mid-river vertices the closing test drops.
    const off = densifyOffset(offRaw, 25);
    const fbox = ringBBox(frag.ring);
    // Candidate roadbeds/paths: only those whose bbox overlaps the
    // fragment bbox expanded by 60 m (the wall never reaches further).
    const candBeds = beds.filter((b) => bboxOverlaps(ringBBox(b.pts || []), fbox, 60));
    const candBedPts = candBeds.map((b) => b.pts || []);
    const candPaths = paths.filter((p) => bboxOverlaps(ringBBox(p.pts || []), fbox, 60));
    const candPathPts = candPaths.map((p) => p.pts || []);
    stats.offsetVertices += off.pts.length;
    // Clamp each offset vertex river-ward so it clears every roadbed
    // by >= clearM. The clamp scales the miter offset distance: the
    // point at scale s is base + normal * (dist28 * s), so s = 1 is
    // the verified 28 m line and smaller s pulls river-ward along
    // the same ray. Drop the vertex if even minOffsetM cannot clear,
    // or if it falls outside the tile.
    const kept = []; // {x, z, nx, nz, idx}
    for (let i = 0; i < off.pts.length; i++) {
      const [vx, vz] = off.base[i];
      const [nx, nz] = off.normals[i];
      const dist28 = off.dist[i];
      let lo = S.minOffsetM / dist28, hi = 1, best = null;
      for (let it = 0; it < 8; it++) {
        const mid = (lo + hi) / 2;
        const x = vx + nx * dist28 * mid, z = vz + nz * dist28 * mid;
        if (roadbedClearance(candBeds, x, z) >= S.clearM) { best = mid; lo = mid; } else hi = mid;
      }
      if (best === null) { stats.droppedNoClearance++; continue; }
      const x = vx + nx * dist28 * best, z = vz + nz * dist28 * best;
      if (x < tile.minX || x > tile.maxX || z < tile.minZ || z > tile.maxZ) {
        stats.droppedOutsideTile++;
        continue;
      }
      // Closing-edge drop: the offset ring closes across the river
      // where a fragment was cut (bridges, tile edges, fragment
      // joins) — those edges are not banks. A genuine bank vertex
      // has land 42 m (1.5x the nominal offset) further out along
      // its normal; a closing-edge vertex has river there (the river
      // continues past the fragment boundary) or open ground past
      // the tile edge. Test the 42 m point against every water
      // polygon and the tile bbox. (The nominal 28 m, not the
      // miter-scaled distance, so a sharp corner's 70 m miter
      // cannot throw the probe across a bend into the river.)
      const px = vx + nx * S.offsetM * 1.5, pz = vz + nz * S.offsetM * 1.5;
      if (px < tile.minX || px > tile.maxX || pz < tile.minZ || pz > tile.maxZ || pointInWater(geo, px, pz)) {
        stats.droppedClosing++;
        continue;
      }
      kept.push({ x, z, nx, nz, idx: i });
    }
    // Runs of consecutive kept vertices (by offset-ring index) are
    // chains; a dropped vertex breaks the run.
    const runs = [];
    let run = [];
    for (const k of kept) {
      if (run.length && k.idx !== run[run.length - 1].idx + 1) {
        runs.push(run);
        run = [];
      }
      run.push(k);
    }
    if (run.length) runs.push(run);
    for (const r of runs) {
      if (r.length < 2) continue;
      const pts = [];
      for (const k of r) pts.push(k.x, k.z);
      const lenM = chainLengthM(pts);
      if (lenM < S.minChainM) { stats.droppedShort++; continue; }
      // Nearest roadbed distance along the run (a census stat, not
      // a filter: the levee is a real structure whether it fronts
      // a road, as at 環河北路， or runs through a riverside park,
      // as on the Xindian north bank and the Keelung north bank).
      let minRoadM = Infinity;
      for (let i = 0; i + 1 < pts.length; i += 2) {
        const d = minCentrelineDist(candBedPts, pts[i], pts[i + 1]);
        if (d < minRoadM) minRoadM = d;
      }
      // Cut at crossings with roadbed and path centrelines. A path
      // cuts only when it genuinely crosses the wall: its vertices
      // near the crossing must lie on BOTH sides of the wall line
      // (a riverside path weaving along the wall stays on one side
      // and must not cut it). The side test uses the wall segment's
      // own direction (a cross product) — the offset normal at the
      // nearest ring vertex is skewed at sharp corners and
      // misclassifies entrances as weaves. A roadbed always cuts,
      // with an angle-aware gap: the ribbon's extent along the
      // wall is halfWidth/sin(angle), so a shallow ramp crossing
      // (e.g. the 中興橋 entrance ramp) needs a longer gap than a
      // perpendicular bridge.
      const n = pts.length / 2;
      const cum = [0];
      for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i * 2] - pts[(i - 1) * 2], pts[i * 2 + 1] - pts[(i - 1) * 2 + 1]));
      const crossings = [];
      const pathCrossesWall = (cx, cz, pathPts, wdx, wdz) => {
        let land = false, river = false;
        for (let k = 0; k + 1 < pathPts.length; k += 2) {
          const px = pathPts[k], pz = pathPts[k + 1];
          if (Math.hypot(px - cx, pz - cz) > 30) continue;
          const side = wdx * (pz - cz) - wdz * (px - cx);
          if (side > 0.5) land = true;
          else if (side < -0.5) river = true;
          if (land && river) return true;
        }
        return false;
      };
      for (let i = 0; i < n - 1; i++) {
        const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[(i + 1) * 2], bz = pts[(i + 1) * 2 + 1];
        const segLen = cum[i + 1] - cum[i];
        const wdx = bx - ax, wdz = bz - az;
        for (const b of candBeds) {
          const bp = b.pts || [];
          const half = (b.width || 6) / 2;
          for (let k = 0; k + 3 <= bp.length; k += 2) {
            const t = segmentCrossT(ax, az, bx, bz, bp[k], bp[k + 1], bp[k + 2], bp[k + 3]);
            if (t === null) continue;
            const cdx = bp[k + 2] - bp[k], cdz = bp[k + 3] - bp[k + 1];
            const wL = Math.hypot(wdx, wdz) || 1, cL = Math.hypot(cdx, cdz) || 1;
            const sinA = Math.max(0.2, Math.abs(wdx * cdz - wdz * cdx) / (wL * cL));
            const gap = Math.min(40, (half + S.clearM) / sinA + 2);
            crossings.push({ s: cum[i] + t * segLen, gap });
            stats.crossingsRoad++;
          }
        }
        for (const p of candPaths) {
          const pp = p.pts || [];
          for (let k = 0; k + 3 <= pp.length; k += 2) {
            const t = segmentCrossT(ax, az, bx, bz, pp[k], pp[k + 1], pp[k + 2], pp[k + 3]);
            if (t === null) continue;
            const cx = ax + (bx - ax) * t, cz = az + (bz - az) * t;
            if (pathCrossesWall(cx, cz, pp, wdx, wdz)) {
              crossings.push({ s: cum[i] + t * segLen, gap: S.gapPathM });
              stats.crossingsPath++;
            } else stats.crossingsPathWeave++;
          }
        }
      }
      const subs = cutAtCrossings(pts, crossings);
      // Bank label by majority vote of the run's per-vertex normals
      // (a long chain curving around a bend has no meaningful
      // average normal; each vertex's normal points landward
      // locally, so the majority is the chain's bank).
      let east = 0, west = 0, south = 0, north = 0;
      for (const k of r) {
        if (river === 'tamsui') { if (k.nx > 0) east++; else west++; }
        else { if (k.nz > 0) south++; else north++; }
      }
      const bank = river === 'tamsui'
        ? (east >= west ? 'east' : 'west')
        : (south >= north ? 'south' : 'north');
      // Land-side normal for the geometry: the average offset normal
      // (points landward by construction).
      let anx = 0, anz = 0;
      for (const k of r) { anx += k.nx; anz += k.nz; }
      const al = Math.hypot(anx, anz) || 1;
      const landNormal = [anx / al, anz / al];
      for (const sub of subs) {
        // Final safety trim: drop/split where the clearance fails
        // (interpolated cut endpoints were never clamped).
        const trimmed = splitByClearance(sub, candBeds, S.clearM);
        if (trimmed.length !== 1) stats.droppedClearance += (sub.length / 2) - trimmed.reduce((s, t) => s + t.length / 2, 0);
        for (const piece of trimmed) {
          const subLen = chainLengthM(piece);
          if (subLen < S.minChainM) { stats.droppedShort++; continue; }
          let cx = 0, cz = 0;
          for (let i = 0; i + 1 < piece.length; i += 2) { cx += piece[i]; cz += piece[i + 1]; }
          const cnt = piece.length / 2;
          chains.push({
            id: `difang-${chainId++}`,
            river, bank,
            pts: piece,
            lengthM: subLen,
            cx: cx / cnt, cz: cz / cnt,
            landNormal,
            minRoadM,
          });
        }
      }
    }
  }
  // Dedupe: fragments overlap (the 0.26M Tamsui piece duplicates
  // the 1.99M fragment's banks), so the same bank stretch can be
  // planned twice. Drop a chain when >= 80% of its sampled points
  // lie within 3 m of a longer chain.
  const deduped = [];
  const byLen = [...chains].sort((a, b) => b.lengthM - a.lengthM);
  for (const c of byLen) {
    let dup = false;
    for (const k of deduped) {
      let near = 0, total = 0;
      for (let i = 0; i + 1 < c.pts.length; i += 2) {
        total++;
        if (minCentrelineDist([k.pts], c.pts[i], c.pts[i + 1]) < 3) near++;
      }
      if (total > 0 && near / total >= 0.8) { dup = true; break; }
    }
    if (dup) { stats.droppedDuplicate++; continue; }
    deduped.push(c);
  }
  // Safety net: a bank wall stands on land. Drop any chain whose
  // midpoint is in the water (a cross-river stub whose normals
  // flipped, or a closing-edge remnant the vertex tests missed).
  const finalChains = [];
  for (const c of deduped) {
    const mid = Math.floor((c.pts.length / 2) / 2) * 2;
    if (pointInWater(geo, c.pts[mid], c.pts[mid + 1])) { stats.droppedInWater++; continue; }
    finalChains.push(c);
  }
  finalChains.sort((a, b) => a.id.localeCompare(b.id));
  const byRiver = {}, byBank = {};
  let totalLengthM = 0;
  for (const c of finalChains) {
    totalLengthM += c.lengthM;
    byRiver[c.river] = byRiver[c.river] || { chains: 0, lengthM: 0 };
    byRiver[c.river].chains++;
    byRiver[c.river].lengthM += c.lengthM;
    const bk = `${c.river}/${c.bank}`;
    byBank[bk] = byBank[bk] || { chains: 0, lengthM: 0 };
    byBank[bk].chains++;
    byBank[bk].lengthM += c.lengthM;
  }
  return { chains: finalChains, stats: { ...stats, totalLengthM, byRiver, byBank } };
}

// ---- geometry ----
// Vertex-coloured wall boxes: body (concrete), cap coping (lighter),
// ivy strip at the foot on the land side. Same quad idiom as
// js/taipei-skybridges.js.
export function buildDifangWallGeometry(chains, opts = {}) {
  const S = DIFANG_STYLE;
  const groundAt = typeof opts.groundAt === 'function' ? opts.groundAt : () => 0;
  const pos = [], nor = [], col = [];
  const rgb = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
  const C = {
    concrete: 0x8a8178, // weathered concrete grey-brown (user's photo)
    cap: 0xa39a8c,      // lighter coping
    green: 0x5a7a4a,    // ivy at the foot, land side
  };
  const quad = (a, b, c, d, hex) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz) || 1;
    nx /= L; ny /= L; nz /= L;
    const [r, g, bl] = rgb(hex);
    for (const p of [a, b, c, a, c, d]) { pos.push(p[0], p[1], p[2]); nor.push(nx, ny, nz); col.push(r, g, bl); }
  };
  // Closed box along plan segment (p0, p1), cross-section w (side) x
  // (y1 - y0) vertical, centred on the segment; n is the land-side
  // unit normal in plan. y0/y1 are [at p0, at p1] endpoint heights.
  const box = (p0, p1, w, y0, y1, hex, n) => {
    const hw = w / 2;
    const lx = n[0] * hw, lz = n[1] * hw;
    const a = [p0[0] - lx, y0[0], p0[1] - lz], b = [p1[0] - lx, y0[1], p1[1] - lz];
    const c = [p1[0] + lx, y0[1], p1[1] + lz], d = [p0[0] + lx, y0[0], p0[1] + lz];
    const aT = [a[0], y1[0], a[2]], bT = [b[0], y1[1], b[2]];
    const cT = [c[0], y1[1], c[2]], dT = [d[0], y1[0], d[2]];
    quad(a, b, bT, aT, hex);       // river face
    quad(d, c, cT, dT, hex);       // land face
    quad(aT, bT, cT, dT, hex);     // top
    quad(a, d, c, b, hex);         // bottom (hidden, keeps the box closed)
    quad(a, aT, dT, d, hex);       // start cap
    quad(b, c, cT, bT, hex);       // end cap
  };
  const outChains = [];
  let triCount = 0;
  for (const ch of chains) {
    const startTri = triCount;
    const pts = ch.pts;
    // Land-side normal: the planner's averaged offset normal (points
    // landward by construction); fall back to the segment's left
    // normal if a chain was hand-built without one.
    const n = ch.landNormal || [0, 0];
    for (let i = 0; i + 2 < pts.length; i += 2) {
      const p0 = [pts[i], pts[i + 1]], p1 = [pts[i + 2], pts[i + 3]];
      const dx = p1[0] - p0[0], dz = p1[1] - p0[1];
      const L = Math.hypot(dx, dz) || 1;
      const nn = (n[0] || n[1]) ? n : [-dz / L, dx / L];
      const y0 = [groundAt(p0[0], p0[1]) - 0.05, groundAt(p1[0], p1[1]) - 0.05];
      const yTop = [y0[0] + S.height, y0[1] + S.height];
      const yCap = [yTop[0] + S.capH, yTop[1] + S.capH];
      // Body: 1.0 m thick, 6.0 m tall.
      box(p0, p1, S.thickness, y0, yTop, C.concrete, nn);
      // Cap coping: 1.2 m wide, 0.25 m tall.
      box(p0, p1, S.thickness + S.capOverhang * 2, yTop, yCap, C.cap, nn);
      // Ivy strip at the foot, land side: 0.15 m thick, 1.0 m tall,
      // centred 0.5 + 0.075 m landward of the wall centreline.
      const off = S.thickness / 2 + S.greenT / 2;
      const g0 = [p0[0] + nn[0] * off, p0[1] + nn[1] * off];
      const g1 = [p1[0] + nn[0] * off, p1[1] + nn[1] * off];
      const yGreen = [y0[0] + S.greenH, y0[1] + S.greenH];
      box(g0, g1, S.greenT, y0, yGreen, C.green, nn);
    }
    const tris = (pos.length / 9 - startTri);
    triCount += tris;
    outChains.push({ ...ch, triCount: tris });
  }
  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(nor),
    colors: new Float32Array(col),
    triCount,
    chains: outChains,
  };
}

// Slice the merged geometry per chain (the skybridgeChainSlices
// shape) so boot can build one mesh per chain for far despawn.
export function difangChainSlices(chains, g) {
  const slices = [];
  let triStart = 0;
  for (let i = 0; i < g.chains.length; i++) {
    const triCount = g.chains[i].triCount;
    const v0 = triStart * 9, v1 = (triStart + triCount) * 9;
    slices.push({
      positions: g.positions.slice(v0, v1),
      normals: g.normals.slice(v0, v1),
      colors: g.colors.slice(v0, v1),
      triCount,
      lenM: g.chains[i].lengthM,
      cx: g.chains[i].cx,
      cz: g.chains[i].cz,
    });
    triStart += triCount;
  }
  return { slices, triCount: g.triCount, chains: g.chains };
}
