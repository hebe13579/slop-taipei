// js/taipei-union.js — union-of-boxes geometry for the Taipei tile
// (issue #60). The tile is the union of axis-aligned rectangles
// (geodata frame.boxes, from tools/taipei/tile-boxes.json) inside its
// bounding rect (frame.bbox). Everything outside the union — the
// dropped bands between/around the boxes — has no ground, no data and
// no gameplay. Pure functions on {minX, maxX, minZ, maxZ} rects; no
// three.js, no DOM, so the node test suite can import this directly.

/** Is (x, z) inside at least one box? Edges count as inside. */
export function pointInBoxes(x, z, boxes) {
  return Array.isArray(boxes) && boxes.some((b) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ);
}

/**
 * The parts of `bbox` NOT covered by `boxes`, as a list of disjoint
 * rects — the controller's exclusion zones. Coordinate compression:
 * every box edge is a cut line, so each elementary cell of the cut
 * grid is either fully covered or fully outside; uncovered cells are
 * then merged greedily (vertical strips first, then horizontally
 * across equal spans) into maximal rects. For the A+B base this
 * yields exactly one rect: the north-east notch (east of lon 121.535,
 * north of lat 25.055). Returns [] when boxes cover the bbox (or when
 * no boxes are given — a plain rectangular tile has no exclusions).
 */
export function unionExclusionRects(boxes, bbox) {
  if (!Array.isArray(boxes) || !boxes.length || !bbox) return [];
  const xs = new Set([bbox.minX, bbox.maxX]);
  const zs = new Set([bbox.minZ, bbox.maxZ]);
  for (const b of boxes) {
    xs.add(Math.max(bbox.minX, Math.min(bbox.maxX, b.minX)));
    xs.add(Math.max(bbox.minX, Math.min(bbox.maxX, b.maxX)));
    zs.add(Math.max(bbox.minZ, Math.min(bbox.maxZ, b.minZ)));
    zs.add(Math.max(bbox.minZ, Math.min(bbox.maxZ, b.maxZ)));
  }
  const X = [...xs].sort((a, b) => a - b);
  const Z = [...zs].sort((a, b) => a - b);
  // Elementary cells not covered by any box.
  const open = [];
  for (let j = 0; j + 1 < Z.length; j++) {
    for (let i = 0; i + 1 < X.length; i++) {
      const cx = (X[i] + X[i + 1]) / 2, cz = (Z[j] + Z[j + 1]) / 2;
      if (!pointInBoxes(cx, cz, boxes)) open.push({ i, j });
    }
  }
  // Merge: group open cells into vertical runs per column, then join
  // runs in adjacent columns that share the same z span.
  const byCol = new Map();
  for (const c of open) {
    if (!byCol.has(c.i)) byCol.set(c.i, []);
    byCol.get(c.i).push(c.j);
  }
  const rects = [];
  const used = new Set();
  const key = (i, j) => `${i}:${j}`;
  for (const c of open) {
    if (used.has(key(c.i, c.j))) continue;
    // vertical run in this column
    let j1 = c.j;
    while (byCol.get(c.i)?.includes(j1 + 1) && !used.has(key(c.i, j1 + 1))) j1++;
    // extend horizontally while the same z span is open
    let i1 = c.i;
    outer: while (true) {
      const col = byCol.get(i1 + 1);
      if (!col) break;
      for (let j = c.j; j <= j1; j++) if (!col.includes(j) || used.has(key(i1 + 1, j))) break outer;
      i1++;
    }
    for (let i = c.i; i <= i1; i++) for (let j = c.j; j <= j1; j++) used.add(key(i, j));
    rects.push({ minX: X[c.i], maxX: X[i1 + 1], minZ: Z[c.j], maxZ: Z[j1 + 1] });
  }
  return rects;
}

/** Intersection of two rects, or null when they do not overlap in area. */
export function rectIntersection(a, b) {
  const minX = Math.max(a.minX, b.minX), maxX = Math.min(a.maxX, b.maxX);
  const minZ = Math.max(a.minZ, b.minZ), maxZ = Math.min(a.maxZ, b.maxZ);
  return maxX > minX && maxZ > minZ ? { minX, maxX, minZ, maxZ } : null;
}

/**
 * Clip a rect to the union: the list of its intersections with the
 * boxes (empty when the rect lies entirely outside the union). Used
 * to keep raster-block ground pieces inside the union — a block whose
 * bbox wraps a union corner contributes only its in-union parts.
 */
export function clipRectToBoxes(rect, boxes) {
  if (!Array.isArray(boxes) || !boxes.length) return [rect];
  const out = [];
  for (const b of boxes) {
    const hit = rectIntersection(rect, b);
    if (hit) out.push(hit);
  }
  return out;
}
