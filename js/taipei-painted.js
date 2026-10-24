// js/taipei-painted.js — painted-walkway (標線型人行道) band construction
// for Taipei roadbeds, pure geometry (no three.js) so node tests and the
// issue #25 audit can run the exact code the renderer draws with.
//
// A band is a solid green strip on ONE side of the carriageway (side from
// a stable hash of the roadbed's provenance), bounded by white lines on
// both edges — TAIWAN_STREETSCAPE.md §c.3, as shipped for issue #16.
//
// Issue #25: the pre-fix builder ran every band the full length of its
// roadbed centreline, and roadbed centrelines end at the CENTRE of every
// crossing road (the shared junction node) — so a side street's band
// sliced straight across the main carriageway it joins, and bands drew
// over junction boxes tile-wide (measured on main d3c34359: 362 of 2,051
// band quads lay on a foreign carriageway, 153 of them on a primary/trunk
// or > 12 m bed). Real painted walkways stop at junctions. This builder
// therefore densifies each painted centreline and drops every band run
// whose band centre or corners fall inside another roadbed's ribbon
// (beds sharing a source way — the same physical road split into beds —
// are not "another roadbed"). Classification is the other half of the
// fix: tools/taipei/pedestrian-layout.mjs never assigns 'painted' to a
// main-road class, so no band is ever born on a trunk/primary/secondary
// carriageway in the first place.

export const PAINTED_BAND_W = 1.35;     // §c.3 band width 1.1–1.8 m
export const PAINTED_LINE_W = 0.10;     // §c.3 white border lines 0.10–0.15 m
export const PAINTED_EDGE_INSET = 0.05; // outer white line sits just inside the carriageway edge
const SAMPLE_STEP_M = 2;                // band runs are sampled at most this far apart
const GRID_M = 100;

export function paintedSide(r) {
  const key = `${r.sourceWayIds?.[0] ?? ''}|${r.name || ''}|${r.pts[0]},${r.pts[1]}`;
  let h = 2166136261; // FNV-1a
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 2 === 0 ? 1 : -1;
}

const ptsOf = (b) => {
  const p = [];
  for (let i = 0; i < b.pts.length; i += 2) p.push([b.pts[i], b.pts[i + 1]]);
  return p;
};

// Ribbon polygon for a roadbed (same offset math as the ground renderer).
export function ribbonPoly(b) {
  const pts = ptsOf(b);
  const half = Math.max((b.width || 3) / 2, 0.75);
  const L = [], R = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], c = pts[Math.min(pts.length - 1, i + 1)];
    let dx = c[0] - a[0], dz = c[1] - a[1];
    const n = Math.hypot(dx, dz) || 1; dx /= n; dz /= n;
    L.push([pts[i][0] - dz * half, pts[i][1] + dx * half]);
    R.push([pts[i][0] + dz * half, pts[i][1] - dx * half]);
  }
  return [...L, ...R.reverse()];
}

export function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > p[1]) !== (zj > p[1]) && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// Generic polygon grid + membership test (the junction-cap occluder
// of issue #66 reuses this shape): buildPolyGrid indexes polygons by
// the grid cells their bounding boxes touch; pointInAnyPoly answers
// "is p inside any of the indexed polygons".
export function buildPolyGrid(polys, cellM = GRID_M) {
  const grid = new Map();
  (polys || []).forEach((poly, i) => {
    const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
    for (let gx = Math.floor(Math.min(...xs) / cellM); gx <= Math.floor(Math.max(...xs) / cellM); gx++)
      for (let gz = Math.floor(Math.min(...zs) / cellM); gz <= Math.floor(Math.max(...zs) / cellM); gz++) {
        const k = `${gx},${gz}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(i);
      }
  });
  return grid;
}

export function pointInAnyPoly(grid, polys, p, cellM = GRID_M) {
  if (!grid || !polys || !polys.length) return false;
  const cand = grid.get(`${Math.floor(p[0] / cellM)},${Math.floor(p[1] / cellM)}`) || [];
  for (const ci of cand) if (pointInPoly(p, polys[ci])) return true;
  return false;
}

// Densify a centreline to points at most SAMPLE_STEP_M apart (vertices kept).
function densify(pts) {
  const out = [pts[0]];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(len / SAMPLE_STEP_M));
    for (let s = 1; s <= steps; s++) out.push([ax + ((bx - ax) * s) / steps, az + ((bz - az) * s) / steps]);
  }
  return out;
}

// buildPaintedBands(roadbeds, capPolys = null) -> { band, edges }
// roadbeds: ALL carriageway roadbeds (geodata shape: pts/width/name/
// highway/pedestrianLayout/sourceWayIds). band/edges are arrays of quads;
// a quad is [x1,z1, x2,z2, x3,z3, x4,z4] in strip order (a+p, b+p, b+q,
// a+q for offsets p = max, q = min) so the renderer emits two triangles
// (1,2,3), (1,3,4) per quad with upward normals, exactly as the pre-fix
// stripQuad did. capPolys (issue #66): junction-cap polygons as point
// arrays — a band sample inside any cap is blocked, so no band leaks
// into a junction corner the bed ribbons themselves don't cover.
export function buildPaintedBands(roadbeds, capPolys = null) {
  const capGrid = capPolys ? buildPolyGrid(capPolys) : null;
  const capBlocked = (p) => pointInAnyPoly(capGrid, capPolys, p);
  const polys = roadbeds.map(ribbonPoly);
  const grid = new Map();
  polys.forEach((poly, i) => {
    const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
    for (let gx = Math.floor(Math.min(...xs) / GRID_M); gx <= Math.floor(Math.max(...xs) / GRID_M); gx++)
      for (let gz = Math.floor(Math.min(...zs) / GRID_M); gz <= Math.floor(Math.max(...zs) / GRID_M); gz++) {
        const k = `${gx},${gz}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(i);
      }
  });
  const foreignBlocked = (p, selfIdx, selfWays) => {
    const cand = grid.get(`${Math.floor(p[0] / GRID_M)},${Math.floor(p[1] / GRID_M)}`) || [];
    for (const ci of cand) {
      if (ci === selfIdx) continue;
      if (roadbeds[ci].sourceWayIds.some((w) => selfWays.has(w))) continue;
      if (pointInPoly(p, polys[ci])) return true;
    }
    return false;
  };

  const band = [], edges = [];
  roadbeds.forEach((r, selfIdx) => {
    if (r.pedestrianLayout !== 'painted') return;
    const half = Math.max((r.width || 3) / 2, 0.75);
    // Band + both lines must fit on one side without crossing the centre.
    if (half < PAINTED_EDGE_INSET + PAINTED_LINE_W * 2 + PAINTED_BAND_W + 0.1) return;
    const s = paintedSide(r);
    const outer1 = s * (half - PAINTED_EDGE_INSET);
    const outer2 = s * (half - PAINTED_EDGE_INSET - PAINTED_LINE_W);
    const inner1 = s * (half - PAINTED_EDGE_INSET - PAINTED_LINE_W - PAINTED_BAND_W);
    const inner2 = s * (half - PAINTED_EDGE_INSET - PAINTED_LINE_W * 2 - PAINTED_BAND_W);
    const midOff = (outer2 + inner1) / 2;
    const selfWays = new Set(r.sourceWayIds);
    const pts = densify(ptsOf(r));
    // Per-sample frame + blocked flags (band centre and both band corners).
    const frames = pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], c = pts[Math.min(pts.length - 1, i + 1)];
      let dx = c[0] - a[0], dz = c[1] - a[1];
      const n = Math.hypot(dx, dz) || 1; dx /= n; dz /= n;
      const nx = -dz, nz = dx;
      const blocked =
        foreignBlocked([p[0] + nx * midOff, p[1] + nz * midOff], selfIdx, selfWays) ||
        foreignBlocked([p[0] + nx * outer2, p[1] + nz * outer2], selfIdx, selfWays) ||
        foreignBlocked([p[0] + nx * inner1, p[1] + nz * inner1], selfIdx, selfWays) ||
        capBlocked([p[0] + nx * midOff, p[1] + nz * midOff]) ||
        capBlocked([p[0] + nx * outer2, p[1] + nz * outer2]) ||
        capBlocked([p[0] + nx * inner1, p[1] + nz * inner1]);
      return { p, nx, nz, blocked };
    });
    const quad = (f0, f1, o1, o2, sink) => {
      const hi = Math.max(o1, o2), lo = Math.min(o1, o2);
      sink.push([
        f0.p[0] + f0.nx * hi, f0.p[1] + f0.nz * hi,
        f1.p[0] + f1.nx * hi, f1.p[1] + f1.nz * hi,
        f1.p[0] + f1.nx * lo, f1.p[1] + f1.nz * lo,
        f0.p[0] + f0.nx * lo, f0.p[1] + f0.nz * lo,
      ]);
    };
    for (let i = 0; i + 1 < frames.length; i++) {
      const f0 = frames[i], f1 = frames[i + 1];
      if (f0.blocked || f1.blocked) continue;
      // Midpoint of the band-centre run must also stay off foreign beds,
      // so no emitted quad's centre can dip into a crossing carriageway.
      const midAt = (off) => [(f0.p[0] + f1.p[0]) / 2 + ((f0.nx + f1.nx) / 2) * off,
                              (f0.p[1] + f1.p[1]) / 2 + ((f0.nz + f1.nz) / 2) * off];
      const mid = midAt(midOff);
      if (foreignBlocked(mid, selfIdx, selfWays) || capBlocked(mid) ||
          capBlocked(midAt((outer1 + outer2) / 2)) || capBlocked(midAt((inner1 + inner2) / 2))) continue;
      quad(f0, f1, outer2, inner1, band);
      quad(f0, f1, outer1, outer2, edges);
      quad(f0, f1, inner1, inner2, edges);
    }
  });
  return { band, edges };
}
