// js/taipei-pedestrian-network.js
// Issue #262: the Taipei pedestrian walking network — pure geometry
// over the geodata roadbeds, no three.js, so tests and evidence
// scripts can run it in node; js/taipei-pedestrians.js turns it into
// walking people.
//
// Why not the upstream system: js/traffic.js's pedestrians ride
// createPedestrianRoutes (js/pedestrian-routes.js), which is fed by
// NYC block data (blockAt from js/city-config.js) and grid-shaped
// crosswalk geometry — a tile cannot honestly supply either, so the
// vehicle env keeps pedestrians OFF (js/taipei-traffic.js) and this
// layer leaves the vehicle system untouched. Taipei pedestrian space
// is per-road `pedestrianLayout` instead:
//   sidewalk — a paved band OUTSIDE the carriageway; the walking line
//              runs down its middle (band width from
//              js/taipei-streetscape.js sidewalkBandWidth, the same
//              width the rendered band is drawn at);
//   arcade   — the 騎樓 band outside the carriageway (ARCADE_BAND_W);
//   painted  — the painted walking strip inside the carriageway edge;
//   shared   — lanes and alleys where people and vehicles share the
//              street; the walking line keeps to the edge.
// One walking line per side per bed, following the bed polyline at
// the layout's offset. Lines join at junction nodes — bed endpoints
// that coincide, as OSM ways share junction nodes — and at a node a
// walker may step onto any incident line, which is how corners and
// crossings happen. Deck beds (bed.deck) and vehicle-only classes
// (motorways, trunks, links/ramps, busways, tracks, construction)
// never carry a line: nobody walks a deck edge or an expressway.
// Riverside park paths, the Guandu plain tracks and the Xiangshan
// trails are not roadbeds at all (footway/path/cycleway ways never
// become beds), so the green-land areas stay unwalked by
// construction. The network is a runtime layer: building it reads
// the geodata but changes nothing in it or in the building plan.

import { sidewalkBandWidth, ARCADE_BAND_W } from './taipei-streetscape.js';

// Vehicle-only or non-street classes: no walking line, ever.
export const PED_EXCLUDED_HIGHWAYS = new Set([
  'motorway', 'motorway_link', 'trunk', 'trunk_link',
  'primary_link', 'secondary_link', 'tertiary_link',
  'busway', 'track', 'construction', 'bus_stop', 'building_passage',
]);

const MIN_LINE_LEN_M = 6; // shorter stubs are junction aprons, not walks
const NODE_MERGE_M = 3; // bed endpoints closer than this are one junction
export const PED_CELL_M = 64; // spatial-hash cell for lines near a focus

// The walking line's offset from the bed centreline, or null when the
// bed carries no pedestrians.
export function walkOffsetFor(bed) {
  if (!bed || bed.deck) return null;
  const hw = bed.highway || '';
  if (PED_EXCLUDED_HIGHWAYS.has(hw)) return null;
  const half = Math.max((bed.width || 3) / 2, 0.75);
  switch (bed.pedestrianLayout) {
    case 'sidewalk': return half + sidewalkBandWidth(bed) / 2;
    case 'arcade': return half + ARCADE_BAND_W / 2;
    case 'painted':
    case 'shared':
      // Inside the edge: a step in from the carriageway boundary,
      // but never past the middle of a narrow lane.
      return Math.max(half - 1.0, half * 0.45);
    default: return null;
  }
}

// Point + direction at arc distance s along a line (s clamped).
// Returns { x, z, dx, dz } with (dx, dz) the unit travel direction.
export function linePointAt(line, s) {
  const { pts, cum } = line;
  const n = cum.length - 1;
  let t = Math.max(0, Math.min(s, line.len));
  let i = 0;
  while (i < n - 1 && cum[i + 1] < t) i++;
  const segLen = cum[i + 1] - cum[i] || 1;
  const f = (t - cum[i]) / segLen;
  const ax = pts[i * 2], az = pts[i * 2 + 1];
  const bx = pts[i * 2 + 2], bz = pts[i * 2 + 3];
  const dx = bx - ax, dz = bz - az;
  const dl = Math.hypot(dx, dz) || 1;
  return { x: ax + dx * f, z: az + dz * f, dx: dx / dl, dz: dz / dl };
}

export function buildPedestrianNetwork(geo) {
  const beds = (geo && geo.roadbeds) || [];
  const lines = [];

  for (let bi = 0; bi < beds.length; bi++) {
    const bed = beds[bi];
    const off = walkOffsetFor(bed);
    if (off === null) continue;
    const pts = bed.pts;
    if (!pts || pts.length < 4) continue;
    const srcN = pts.length / 2;
    // Centreline length first: a degenerate bed carries no line.
    let centreLen = 0;
    for (let i = 0; i + 1 < srcN; i++) centreLen += Math.hypot(pts[i * 2 + 2] - pts[i * 2], pts[i * 2 + 3] - pts[i * 2 + 1]);
    if (!(centreLen >= 4)) continue;
    // Densify a curving bed (any vertex turning more than ~6°) to
    // <= 5 m point spacing: walkers interpolate between line points,
    // and on sparse curving beds the chord between two honest points
    // sags metres toward the centreline. Straight beds keep their
    // sparse points — a chord on a straight line cannot sag.
    let cps = pts;
    let wasDensified = false;
    {
      let maxTurn = 0;
      for (let i = 1; i + 1 < srcN; i++) {
        const ax = pts[i * 2] - pts[i * 2 - 2], az = pts[i * 2 + 1] - pts[i * 2 - 1];
        const bx = pts[i * 2 + 2] - pts[i * 2], bz = pts[i * 2 + 3] - pts[i * 2 + 1];
        const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
        if (!(la > 0) || !(lb > 0)) continue;
        const dot = Math.max(-1, Math.min(1, (ax * bx + az * bz) / (la * lb)));
        maxTurn = Math.max(maxTurn, Math.acos(dot));
      }
      if (maxTurn > 0.1) {
        const dense = [];
        for (let i = 0; i + 1 < srcN; i++) {
          const ax = pts[i * 2], az = pts[i * 2 + 1];
          const dx = pts[i * 2 + 2] - ax, dz = pts[i * 2 + 3] - az;
          const segLen = Math.hypot(dx, dz);
          const steps = Math.max(1, Math.ceil(segLen / 5));
          for (let k = 0; k < steps; k++) dense.push(ax + dx * k / steps, az + dz * k / steps);
        }
        dense.push(pts[pts.length - 2], pts[pts.length - 1]);
        cps = dense;
        wasDensified = true;
      }
    }
    const n = cps.length / 2;
    // Bend clamp: the averaged vertex normal swings an offset point
    // inward at a bend, and at a hairpin the point can land on the
    // carriageway (measured worst: 10.6 m inside the edge) or on the
    // centreline itself. Every line point is therefore pushed out to
    // a minimum clearance from the bed's own centreline: outside
    // lines (sidewalk/arcade) stay off the carriageway entirely,
    // inside lines (painted/shared) never collapse past 45% of the
    // half width. A point that still fails after three pushes sits
    // in a true fold (the bed doubles back within its own width);
    // it is dropped and the line splits around it — the same places
    // the rendered sidewalk band is junction-trimmed away.
    const half = Math.max((bed.width || 3) / 2, 0.75);
    const outside = bed.pedestrianLayout === 'sidewalk' || bed.pedestrianLayout === 'arcade';
    const minClear = outside ? half + 0.3 : Math.min(off, Math.max(half * 0.45, 0.45));
    const clearance = (px, pz) => {
      let bx = 0, bz = 0, bd = Infinity;
      for (let i = 0; i + 1 < n; i++) {
        const ax = cps[i * 2], az = cps[i * 2 + 1];
        const dx = cps[i * 2 + 2] - ax, dz = cps[i * 2 + 3] - az;
        const l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
        const qx = ax + dx * t, qz = az + dz * t;
        const d = Math.hypot(px - qx, pz - qz);
        if (d < bd) { bd = d; bx = qx; bz = qz; }
      }
      return { d: bd, qx: bx, qz: bz };
    };
    for (const side of [-1, 1]) {
      const lp = []; // flat offset points, with `ok` per point
      const ok = [];
      for (let i = 0; i < n; i++) {
        // Direction at point i: the single segment at the ends, the
        // chord across i at interior points (smooths the corner).
        const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
        let dx = cps[i1 * 2] - cps[i0 * 2], dz = cps[i1 * 2 + 1] - cps[i0 * 2 + 1];
        const dl = Math.hypot(dx, dz);
        if (!(dl > 0)) { dx = 1; dz = 0; } else { dx /= dl; dz /= dl; }
        // Left normal of the direction of travel.
        const nx = -dz, nz = dx;
        // Miter scale: the chord normal is the bend's bisector, and
        // the true offset corner sits off / cos(half-turn) along it.
        // Without the scale the point sits inside the true offset
        // curve at a bend and the chord to the next point sags
        // metres toward the centreline (worst on wide boulevards:
        // off ~22 m). Capped so a near-reversal cannot spike.
        let miter = 1;
        if (i > 0 && i + 1 < n) {
          const ax = cps[i * 2] - cps[i * 2 - 2], az = cps[i * 2 + 1] - cps[i * 2 - 1];
          const bx = cps[i * 2 + 2] - cps[i * 2], bz = cps[i * 2 + 3] - cps[i * 2 + 1];
          const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
          if (la > 0 && lb > 0) {
            const dot = Math.max(-1, Math.min(1, (ax * bx + az * bz) / (la * lb)));
            miter = Math.min(2.5, 1 / Math.sqrt(Math.max(0.08, (1 + dot) / 2)));
          }
        }
        let px = cps[i * 2] + nx * side * off * miter, pz = cps[i * 2 + 1] + nz * side * off * miter;
        let good = false;
        for (let iter = 0; iter < 3 && !good; iter++) {
          const c = clearance(px, pz);
          if (c.d >= minClear - 0.05) { good = true; break; }
          if (c.d > 1e-6) { px = c.qx + (px - c.qx) / c.d * minClear; pz = c.qz + (pz - c.qz) / c.d * minClear; }
          else { px = c.qx + nx * side * minClear; pz = c.qz + nz * side * minClear; }
        }
        lp.push(px, pz);
        ok.push(good);
      }
      // Second pass: the vertex checks cannot see the chord between
      // two good points sagging across a kink (worst case: a spike
      // vertex in a wide boulevard bed). Mark a vertex bad when the
      // midpoint of either adjacent segment violates the clearance —
      // the line then splits around the kink instead of cutting its
      // corner. Outside lines always get the pass; inside lines only
      // on densified (curving) beds, since a straight bed's chord
      // cannot sag.
      if (outside || wasDensified) {
        const midBad = new Array(n).fill(false);
        for (let i = 0; i + 1 < n; i++) {
          if (!ok[i] && !ok[i + 1]) continue;
          const mx = (lp[i * 2] + lp[i * 2 + 2]) / 2, mz = (lp[i * 2 + 1] + lp[i * 2 + 3]) / 2;
          if (clearance(mx, mz).d < minClear - 0.05) { midBad[i] = true; midBad[i + 1] = true; }
        }
        for (let i = 0; i < n; i++) if (midBad[i]) ok[i] = false;
      }
      // Emit the maximal runs of good points as lines.
      let runStart = -1;
      const emit = (runEnd) => {
        if (runStart < 0 || runEnd - runStart < 1) return;
        const runPts = lp.slice(runStart * 2, (runEnd + 1) * 2);
        const cum = [0];
        for (let i = 0; i + 1 < runPts.length / 2; i++) cum.push(cum[i] + Math.hypot(runPts[i * 2 + 2] - runPts[i * 2], runPts[i * 2 + 3] - runPts[i * 2 + 1]));
        const len = cum[cum.length - 1];
        if (!(len >= MIN_LINE_LEN_M)) return;
        lines.push({
          pts: runPts, cum, len,
          bed: bi, highway: bed.highway || '', layout: bed.pedestrianLayout, name: bed.name || '',
          fromNode: -1, toNode: -1,
        });
      };
      for (let i = 0; i < n; i++) {
        if (ok[i]) { if (runStart < 0) runStart = i; }
        else { emit(i - 1); runStart = -1; }
      }
      emit(n - 1);
    }
  }

  // Junction nodes: merge line endpoints that coincide (shared OSM
  // junction nodes) or nearly (merged-bed seams). First-fit against
  // the nodes in the 3x3 cells around the point.
  const nodes = [];
  const cellNodes = new Map();
  const cellKey = (x, z) => `${Math.floor(x / NODE_MERGE_M)},${Math.floor(z / NODE_MERGE_M)}`;
  const nodeAt = (x, z) => {
    const cx = Math.floor(x / NODE_MERGE_M), cz = Math.floor(z / NODE_MERGE_M);
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iz = cz - 1; iz <= cz + 1; iz++) {
        for (const ni of cellNodes.get(`${ix},${iz}`) || []) {
          const nd = nodes[ni];
          if (Math.hypot(nd.x - x, nd.z - z) <= NODE_MERGE_M) return ni;
        }
      }
    }
    const ni = nodes.length;
    nodes.push({ x, z, ends: [] });
    const k = cellKey(x, z);
    if (!cellNodes.has(k)) cellNodes.set(k, []);
    cellNodes.get(k).push(ni);
    return ni;
  };
  lines.forEach((line, li) => {
    line.fromNode = nodeAt(line.pts[0], line.pts[1]);
    line.toNode = nodeAt(line.pts[line.pts.length - 2], line.pts[line.pts.length - 1]);
    nodes[line.fromNode].ends.push({ line: li, end: 0 });
    nodes[line.toNode].ends.push({ line: li, end: 1 });
  });

  // Spatial hash: line indices by the cells their points sample.
  const cells = new Map();
  const addToCell = (x, z, li) => {
    const k = `${Math.floor(x / PED_CELL_M)},${Math.floor(z / PED_CELL_M)}`;
    let arr = cells.get(k);
    if (!arr) cells.set(k, (arr = []));
    if (arr[arr.length - 1] !== li) arr.push(li);
  };
  lines.forEach((line, li) => {
    for (let s = 0; s <= line.len; s += 24) {
      const p = linePointAt(line, s);
      addToCell(p.x, p.z, li);
    }
    const p = linePointAt(line, line.len);
    addToCell(p.x, p.z, li);
  });

  let totalLen = 0;
  for (const line of lines) totalLen += line.len;
  let joinedNodes = 0;
  for (const nd of nodes) if (nd.ends.length >= 2) joinedNodes++;
  return {
    lines, nodes, cells,
    stats: {
      lines: lines.length,
      nodes: nodes.length,
      joinedNodes,
      totalKm: Math.round(totalLen / 100) / 10,
    },
  };
}
