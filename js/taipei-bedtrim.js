// js/taipei-bedtrim.js — issue #389 (C5 graph-first junctions).
//
// Clip roadbed centrelines against junction polygons so the ribbons and
// the junction caps TILE instead of overlapping: a bed's polyline is cut
// wherever it enters a junction polygon, and the portions inside are
// removed. The junction polygon (the cap ring, a roundabout disc or an
// entry apron) then paves exactly the ground the bed no longer covers.
//
// trimBedsAtPolys(beds, polys) -> sub-beds. Each input bed becomes 0..n
// sub-beds carrying the parent's metadata (name, width, highway,
// pedestrianLayout, sourceWayIds, deck) with a clipped `pts` array,
// plus provenance fields the dash-suppression translation needs:
//   trimParent    — the parent bed's index in the input array
//   trimStartArc  — arc distance along the parent from its start to
//                   this sub-bed's start
//   trimEndArc    — arc distance along the parent to this sub-bed's end
//   trimParentLen — the parent's total arc length
// A bed no polygon touches comes back as a shallow copy with
// trimStartArc 0 / trimEndArc = its length (provenance intact, pts
// shared). With no polygons at all the input array is returned as-is.
// A bed whose centreline only grazes a polygon edge keeps the grazing
// run: a point on a polygon boundary counts as OUTSIDE, so a segment
// running along an interface line is not eaten by rounding.
//
// The clip is per-segment interval math, not a point test: for each
// segment, all crossings with nearby polygon boundaries are collected,
// the segment is split at them, and each sub-interval is kept when its
// midpoint lies outside every polygon. That makes the result correct
// for concave polygons (clipped ring pieces) and for segments crossing
// several polygons. Pure and node-testable; no geodata access.
//
// LEAF MODULE: this file imports nothing. pointInPoly and the
// polygon grid below are small copies of taipei-painted.js's
// (the canonical versions) so the trim stays a leaf — painted,
// surfaces and markings all import it, and importing painted back
// would be the codebase's first import cycle.

const EPS = 1e-9;
const BOUNDARY_EPS = 1e-6;

// Ray-casting point-in-polygon (copy of taipei-painted.js pointInPoly).
function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > p[1]) !== (zj > p[1]) && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// Polygon-bbox grid (copy of taipei-painted.js buildPolyGrid, 100 m cells).
function buildPolyGrid(polys) {
  const grid = new Map();
  (polys || []).forEach((poly, i) => {
    const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
    for (let gx = Math.floor(Math.min(...xs) / 100); gx <= Math.floor(Math.max(...xs) / 100); gx++)
      for (let gz = Math.floor(Math.min(...zs) / 100); gz <= Math.floor(Math.max(...zs) / 100); gz++) {
        const k = `${gx},${gz}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(i);
      }
  });
  return grid;
}

// True when p lies on (within BOUNDARY_EPS of) any edge of poly.
function onBoundary(p, poly) {
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j], [bx, bz] = poly[i];
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz;
    let t = l2 > 0 ? ((p[0] - ax) * dx + (p[1] - az) * dz) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const ex = ax + dx * t - p[0], ez = az + dz * t - p[1];
    if (ex * ex + ez * ez <= BOUNDARY_EPS * BOUNDARY_EPS) return true;
  }
  return false;
}

// Strict point-in-polygon: boundary points read as outside.
function insideStrict(p, poly) {
  if (onBoundary(p, poly)) return false;
  return pointInPoly(p, poly);
}

// Intersection parameter t along AB (0..1) where AB meets CD, or null
// when the segments do not cross at a single interior point (parallel
// and collinear pairs are not crossings — the midpoint test decides
// those runs).
function crossT(ax, az, bx, bz, cx, cz, dx, dz) {
  const rx = bx - ax, rz = bz - az;
  const sx = dx - cx, sz = dz - cz;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((cx - ax) * sz - (cz - az) * sx) / den;
  const u = ((cx - ax) * rz - (cz - az) * rx) / den;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  return Math.max(0, Math.min(1, t));
}

// Clip one polyline (flat [x,z,...]) against a set of polygons.
// Returns an array of { pts, startArc, endArc } (the kept runs, with
// their arc interval along the input polyline). A polyline no polygon
// touches returns [{ pts, startArc: 0, endArc: totalLen }] with pts
// the SAME array (identity, so callers can tell it was untouched).
export function clipPolylineAtPolys(pts, polys, polyGrid) {
  const n = pts.length / 2;
  if (n < 2 || !polys.length) return [{ pts, startArc: 0, endArc: 0 }];
  const runs = [];
  let cur = null; // current kept run, flat array
  let curStartArc = 0;
  let dropped = false; // any sub-interval removed (else the bed is untouched)
  let acc = 0; // arc at the current segment's start
  const pushPt = (x, z) => {
    if (!cur) cur = [];
    const m = cur.length;
    if (m >= 2 && Math.hypot(cur[m - 2] - x, cur[m - 1] - z) < 1e-9) return;
    cur.push(x, z);
  };
  const flush = (endArc) => {
    if (cur && cur.length >= 4) runs.push({ pts: cur, startArc: curStartArc, endArc });
    cur = null;
  };
  for (let i = 0; i + 1 < n; i++) {
    const ax = pts[i * 2], az = pts[i * 2 + 1];
    const bx = pts[i * 2 + 2], bz = pts[i * 2 + 3];
    const segLen = Math.hypot(bx - ax, bz - az);
    if (segLen < 1e-9) continue;
    // Nearby polygons: those whose bbox cell the segment touches.
    const near = new Set();
    const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx);
    const z0 = Math.min(az, bz), z1 = Math.max(az, bz);
    for (let gx = Math.floor(x0 / 100); gx <= Math.floor(x1 / 100); gx++)
      for (let gz = Math.floor(z0 / 100); gz <= Math.floor(z1 / 100); gz++)
        for (const pi of polyGrid.get(`${gx},${gz}`) || []) near.add(pi);
    // Crossing parameters along this segment.
    const ts = [0, 1];
    for (const pi of near) {
      const poly = polys[pi];
      for (let k = 0, j = poly.length - 1; k < poly.length; j = k++) {
        const t = crossT(ax, az, bx, bz, poly[j][0], poly[j][1], poly[k][0], poly[k][1]);
        if (t !== null && t > EPS && t < 1 - EPS) ts.push(t);
      }
    }
    ts.sort((a, b) => a - b);
    for (let s = 0; s + 1 < ts.length; s++) {
      const t0 = ts[s], t1 = ts[s + 1];
      if (t1 - t0 < 1e-9) continue;
      const mx = ax + (bx - ax) * ((t0 + t1) / 2);
      const mz = az + (bz - az) * ((t0 + t1) / 2);
      let inside = false;
      for (const pi of near) {
        if (insideStrict([mx, mz], polys[pi])) { inside = true; break; }
      }
      if (inside) { dropped = true; flush(acc + t0 * segLen); continue; }
      if (!cur) curStartArc = acc + t0 * segLen;
      pushPt(ax + (bx - ax) * t0, az + (bz - az) * t0);
      pushPt(ax + (bx - ax) * t1, az + (bz - az) * t1);
    }
    acc += segLen;
  }
  flush(acc);
  // A polyline no polygon touches keeps its identity (same pts array).
  if (!dropped) return [{ pts, startArc: 0, endArc: acc }];
  return runs;
}

function bedArcLength(pts) {
  let acc = 0;
  for (let i = 0; i + 2 < pts.length; i += 2) acc += Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
  return acc;
}

// trimBedsAtPolys(beds, polys) -> sub-beds (see the header).
export function trimBedsAtPolys(beds, polys) {
  if (!polys || !polys.length) return beds;
  const grid = buildPolyGrid(polys);
  const out = [];
  beds.forEach((bed, bi) => {
    const pts = bed.pts;
    if (!pts || pts.length < 4) { out.push({ ...bed, trimParent: bi, trimStartArc: 0, trimEndArc: 0, trimParentLen: 0 }); return; }
    const runs = clipPolylineAtPolys(pts, polys, grid);
    if (runs.length === 1 && runs[0].pts === pts) {
      out.push({ ...bed, trimParent: bi, trimStartArc: 0, trimEndArc: runs[0].endArc, trimParentLen: runs[0].endArc });
      return;
    }
    const parentLen = bedArcLength(pts);
    for (const run of runs) {
      out.push({ ...bed, pts: run.pts, trimParent: bi, trimStartArc: run.startArc, trimEndArc: run.endArc, trimParentLen: parentLen });
    }
  });
  return out;
}

// translateSuppress is gone with the end-based suppress map: the
// furniture now emits arc intervals (see buildJunctionFurniture),
// and the divider/centreline builders map them onto trimmed beds
// through the trimParent/trimStartArc provenance above.
