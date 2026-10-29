// js/taipei-streetscape.js
// Streetscape geometry for the Taipei tile (issues #27, #28, #41):
// visible sidewalks (人行道) for sidewalk-layout roadbeds, deterministic
// street-tree placement, and park planting. Pure functions over the
// geodata shapes — no three.js — so tests and evidence scripts can run
// them in node; js/taipei-boot.js turns the results into meshes.
//
// Sidewalks (issue #27): a sidewalk-layout roadbed gets a paving band on
// BOTH edges, outside the carriageway, width by road class. Bands are
// trimmed where they would cross another carriageway's street section
// (junctions): a band sample is dropped when it falls inside a crossing
// bed's carriageway + its own band zone, so bands stop at junction
// mouths instead of striping across them or z-fighting a crossing band
// in the corner. Beds that continue the same road (shared endpoint,
// near-collinear, same name or shared source way) never trim each other.
//
// Street trees (issue #28): instanced-planting positions along the
// sidewalk bands of wide beds and along the medians of merged boulevard
// beds, spacing 10–13 m from a stable hash, every position verified off
// carriageways (against both the merged roadbeds and the raw ways — a
// median tree must sit between the two original carriageways, not on
// one), out of junctions, building lots, the Taipei 101 site, parks and
// water. A hard cap keeps the instance count in the low thousands for
// the phone WebGL fallback; thinning is a deterministic stride over the
// accepted list, so the same data always plants the same trees.

const NON_CARRIAGEWAY = new Set(['footway', 'path', 'steps', 'pedestrian', 'cycleway', 'corridor', 'elevator', 'crossing', 'platform', 'traffic_island']);

// Band reach of the non-sidewalk layouts when trimming (the arcade
// colonnade floor plate, TAIWAN_STREETSCAPE.md §c.2). Painted bands sit
// ON the carriageway and shared beds have no band, so their reach past
// the carriageway edge is 0.
export const ARCADE_BAND_W = 3.6;

// ---------------------------------------------------------------------
// small shared helpers (mirrors of the ones in taipei-buildings.js)

export function hash01(key) {
  let h = 2166136261; // FNV-1a
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

function bedKey(r) {
  return `${r.sourceWayIds?.[0] ?? ''}|${r.name || ''}|${r.pts[0]},${r.pts[1]}`;
}

export function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const ex = ax + dx * t - px, ez = az + dz * t - pz;
  return Math.hypot(ex, ez);
}

const GRID_CELL = 20;

// Segment index over beds (or ways): each segment is filed under every
// grid cell its bounding box, expanded by `reach`, touches; a query
// then only reads the one cell containing the point.
export function buildSegmentGrid(items, reach) {
  const grid = new Map();
  const key = (cx, cz) => `${cx},${cz}`;
  items.forEach((r, idx) => {
    const half = Math.max((r.width || 3) / 2, 0.75);
    for (let i = 0; i + 3 < r.pts.length; i += 2) {
      const ax = r.pts[i], az = r.pts[i + 1], bx = r.pts[i + 2], bz = r.pts[i + 3];
      const minCx = Math.floor((Math.min(ax, bx) - reach) / GRID_CELL);
      const maxCx = Math.floor((Math.max(ax, bx) + reach) / GRID_CELL);
      const minCz = Math.floor((Math.min(az, bz) - reach) / GRID_CELL);
      const maxCz = Math.floor((Math.max(az, bz) + reach) / GRID_CELL);
      for (let cx = minCx; cx <= maxCx; cx++) {
        for (let cz = minCz; cz <= maxCz; cz++) {
          const k = key(cx, cz);
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push({ ax, az, bx, bz, half, idx });
        }
      }
    }
  });
  return {
    near(x, z) {
      return grid.get(key(Math.floor(x / GRID_CELL), Math.floor(z / GRID_CELL))) || [];
    },
  };
}

export function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i], zi = ring[i + 1], xj = ring[j], zj = ring[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// Exclusion-polygon index: caller-supplied rings (junction caps,
// roundabout discs, trench slots, and — issue #246 — kit pads) are
// filed under every 64 m cell their bbox touches, so a query only
// tests the rings near the point. Behaviour-identical to the
// linear scan it replaces: a ring whose bbox contains the point is
// always filed in the point's cell, the same bbox + pointInRing
// tests run, and the result is a boolean OR (order-free).
const EXCLUSION_CELL = 64;
export function buildExclusionIndex(rings, cellSize = EXCLUSION_CELL) {
  const grid = new Map();
  const key = (cx, cz) => `${cx},${cz}`;
  for (const ring of rings || []) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < ring.length; i += 2) {
      minX = Math.min(minX, ring[i]); maxX = Math.max(maxX, ring[i]);
      minZ = Math.min(minZ, ring[i + 1]); maxZ = Math.max(maxZ, ring[i + 1]);
    }
    const p = { ring, minX, maxX, minZ, maxZ };
    for (let cx = Math.floor(minX / cellSize); cx <= Math.floor(maxX / cellSize); cx++) {
      for (let cz = Math.floor(minZ / cellSize); cz <= Math.floor(maxZ / cellSize); cz++) {
        const k = key(cx, cz);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(p);
      }
    }
  }
  return (x, z) => {
    const cell = grid.get(key(Math.floor(x / cellSize), Math.floor(z / cellSize)));
    if (!cell) return false;
    for (const p of cell) {
      if (x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ && pointInRing(x, z, p.ring)) return true;
    }
    return false;
  };
}

// ---------------------------------------------------------------------
// Issue #27 — sidewalk bands

// Band width by road class (§c.1 formal sidewalks): arterials get the
// wide 2.5 m pavement, minor streets the 1.5 m minimum. Links (ramps)
// keep the minor width. Clamped so a narrow way with an explicit OSM
// sidewalk tag never grows a band wider than half its carriageway.
export function sidewalkBandWidth(bed) {
  const hw = bed.highway || '';
  let w;
  if (hw.endsWith('_link')) w = 1.5;
  else if (hw === 'trunk' || hw === 'primary') w = 2.5;
  else if (hw === 'secondary') w = 2.2;
  else if (hw === 'tertiary') w = 2.0;
  else w = 1.5;
  const half = Math.max((bed.width || 3) / 2, 0.75);
  return Math.min(w, Math.max(1.2, half));
}

// How far a bed's street section reaches from its centreline: carriageway
// plus its band, for junction trimming.
function sectionReach(bed) {
  const half = Math.max((bed.width || 3) / 2, 0.75);
  if (bed.pedestrianLayout === 'sidewalk') return half + sidewalkBandWidth(bed);
  if (bed.pedestrianLayout === 'arcade') return half + ARCADE_BAND_W;
  return half;
}

// Pairs of beds that are the same road continuing (share an endpoint,
// leave it in near-opposite directions, and agree on name or source
// way). These must never junction-trim each other.
function continuationPairs(beds) {
  const byEnd = new Map();
  const endKey = (x, z) => `${Math.round(x * 2)},${Math.round(z * 2)}`;
  beds.forEach((b, i) => {
    const n = b.pts.length;
    for (const [x, z, end] of [[b.pts[0], b.pts[1], 0], [b.pts[n - 2], b.pts[n - 1], 1]]) {
      const k = endKey(x, z);
      if (!byEnd.has(k)) byEnd.set(k, []);
      byEnd.get(k).push({ i, x, z, end });
    }
  });
  // Unit direction pointing INTO the bed from the given end.
  const intoDir = (b, end) => {
    const p = b.pts;
    const a = end === 0 ? [p[0], p[1]] : [p[p.length - 2], p[p.length - 1]];
    const c = end === 0 ? [p[2], p[3]] : [p[p.length - 4], p[p.length - 3]];
    const dx = c[0] - a[0], dz = c[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    return [dx / l, dz / l];
  };
  const pairs = new Set();
  for (const bucket of byEnd.values()) {
    for (let a = 0; a < bucket.length; a++) {
      for (let c = a + 1; c < bucket.length; c++) {
        const A = bucket[a], B = bucket[c];
        if (A.i === B.i) continue;
        if (Math.hypot(A.x - B.x, A.z - B.z) > 0.75) continue;
        const ba = beds[A.i], bb = beds[B.i];
        const sameName = ba.name && ba.name === bb.name;
        const sharedWay = (ba.sourceWayIds || []).some((id) => (bb.sourceWayIds || []).includes(id));
        if (!sameName && !sharedWay) continue;
        const da = intoDir(ba, A.end), db = intoDir(bb, B.end);
        if (Math.abs(da[0] * db[0] + da[1] * db[1]) < 0.5) continue;
        pairs.add(`${Math.min(A.i, B.i)}:${Math.max(A.i, B.i)}`);
      }
    }
  }
  return pairs;
}

const SAMPLE_STEP = 1.0;   // m between junction-trim samples along a segment
const CUT_GAP = 0.15;      // m shaved off a run where the trim cut it
const MIN_RUN = 0.75;      // m — shorter runs are slivers, dropped
const OVERLAP_TOL = 0.3;   // m of section overlap tolerated before trimming

// Builds the flat band quads for every sidewalk-layout bed in `beds`
// (the full carriageway list — other layouts only feed the trim index).
// Returns { positions, quadCount, bandLengthByClass, totalBandLength }:
// positions is a Float32Array of xyz triples (6 vertices per quad) at
// height y, wound so computed normals point up (same convention as
// ribbonsGeometry/stripQuad in taipei-boot.js). opts.clip=false keeps
// the bands untrimmed (diagnostics / before-renders only).
export function buildSidewalkBands(beds, y = 0.045, opts = {}) {
  const clip = opts.clip !== false;
  const reach = Math.max(...beds.map(sectionReach)) + 1.5;
  const grid = buildSegmentGrid(beds, clip ? reach : 0);
  const cont = clip ? continuationPairs(beds) : new Set();
  const reaches = beds.map(sectionReach);
  const positions = [];
  const bandLengthByClass = {};
  let quadCount = 0;

  const isBlocked = (x, z, ownIdx, bandW) => {
    for (const s of grid.near(x, z)) {
      if (s.idx === ownIdx) continue;
      const pair = `${Math.min(ownIdx, s.idx)}:${Math.max(ownIdx, s.idx)}`;
      if (cont.has(pair)) continue;
      const limit = reaches[s.idx] + bandW / 2 - OVERLAP_TOL;
      if (distToSegment(x, z, s.ax, s.az, s.bx, s.bz) < limit) return true;
    }
    return false;
  };

  const pushQuad = (ax, az, bx, bz, nx, nz, o1, o2) => {
    const p = Math.max(o1, o2), q = Math.min(o1, o2);
    positions.push(
      ax + nx * p, y, az + nz * p, bx + nx * p, y, bz + nz * p, bx + nx * q, y, bz + nz * q,
      ax + nx * p, y, az + nz * p, bx + nx * q, y, bz + nz * q, ax + nx * q, y, az + nz * q,
    );
    quadCount++;
  };

  beds.forEach((bed, bedIdx) => {
    if (bed.pedestrianLayout !== 'sidewalk') return;
    const bandW = sidewalkBandWidth(bed);
    const half = Math.max((bed.width || 3) / 2, 0.75);
    for (let i = 0; i + 3 < bed.pts.length; i += 2) {
      const ax = bed.pts[i], az = bed.pts[i + 1], bx = bed.pts[i + 2], bz = bed.pts[i + 3];
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz);
      if (len < 0.01) continue;
      const nx = -dz / len, nz = dx / len;
      for (const side of [1, -1]) {
        const o1 = side * half, o2 = side * (half + bandW);
        const midOff = side * (half + bandW / 2);
        if (!clip) {
          pushQuad(ax, az, bx, bz, nx, nz, o1, o2);
          bandLengthByClass[bed.highway] = (bandLengthByClass[bed.highway] || 0) + len;
          continue;
        }
        const n = Math.max(1, Math.round(len / SAMPLE_STEP));
        const blocked = new Array(n);
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n;
          blocked[k] = isBlocked(ax + dx * t + nx * midOff, az + dz * t + nz * midOff, bedIdx, bandW);
        }
        let k = 0;
        while (k < n) {
          if (blocked[k]) { k++; continue; }
          let k1 = k;
          while (k1 + 1 < n && !blocked[k1 + 1]) k1++;
          let t0 = k / n, t1 = (k1 + 1) / n;
          if (k > 0) t0 += CUT_GAP / len;
          if (k1 < n - 1) t1 -= CUT_GAP / len;
          const runLen = (t1 - t0) * len;
          if (runLen >= MIN_RUN) {
            pushQuad(ax + dx * t0, az + dz * t0, ax + dx * t1, az + dz * t1, nx, nz, o1, o2);
            bandLengthByClass[bed.highway] = (bandLengthByClass[bed.highway] || 0) + runLen;
          }
          k = k1 + 1;
        }
      }
    }
  });

  const totalBandLength = Object.values(bandLengthByClass).reduce((s, v) => s + v, 0);
  return { positions: Float32Array.from(positions), quadCount, bandLengthByClass, totalBandLength };
}

// ---------------------------------------------------------------------
// Issue #28 — street trees

export const TREE_CAP = 3000;          // total instances, phone-fallback budget
export const TREE_SIDEWALK_MIN_W = 18; // sidewalk rows only on wide beds
export const TREE_MEDIAN_MIN_W = 24;   // median rows only on wide merged beds

// Stations along a polyline at `phase + k*spacing` metres of arc length.
// Returns [{ x, z, dx, dz, nx, nz }] with unit direction and left normal.
function walkStations(pts, spacing, phase) {
  const out = [];
  let nextAt = phase;
  let travelled = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3];
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) continue;
    while (nextAt <= travelled + len) {
      const t = (nextAt - travelled) / len;
      out.push({
        x: ax + dx * t, z: az + dz * t,
        dx: dx / len, dz: dz / len, nx: -dz / len, nz: dx / len,
      });
      nextAt += spacing;
    }
    travelled += len;
  }
  return out;
}

// Beds no tree may plant on, whatever their layout/width: expressways,
// tunnels and underpasses. The generated geodata carries no layer or
// tunnel tags (the classifier's deck guard only sees what OSM tagged),
// so wide merged beds of the 信義快速道路 / 象山隧道 still arrive with a
// 'sidewalk' layout — the name is the only honest signal available at
// this layer, and these names are unambiguous.
const UNPLANTABLE_NAME = /隧道|地下道|快速道路|高架/;
// Median rows belong on surface boulevards; trunk-class medians in
// Taiwan are expressway barriers, not planting strips. Sidewalk rows
// likewise stay off trunk-class beds (expressways and their ramps do
// not carry street trees, whatever layout the classifier assigned).
const MEDIAN_HIGHWAYS = new Set(['primary', 'secondary']);
const SIDEWALK_TREE_HIGHWAYS = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified']);

// Plans street trees for the tile. `geodata` is the TAIPEI_GEO-shaped
// object (roadbeds, roads, water, parks); `plan` is planTaipeiBuildings'
// result (lots + tower) so trees keep out of building lots and the 101
// site. Deterministic: identical inputs plant identical trees.
export function planStreetTrees(geodata, plan, opts = {}) {
  const cap = opts.cap ?? TREE_CAP;
  const beds = geodata.roadbeds || [];
  const ways = (geodata.roads || []).filter((r) => !NON_CARRIAGEWAY.has(r.highway));
  // The grids must reach as far as the widest carriageway half + margin:
  // a tree can sit inside a 55 m merged boulevard's polygon while being
  // planted on a narrow parallel bed 20+ m from that bed's centreline.
  const maxHalf = (items) => Math.max(...items.map((r) => Math.max((r.width || 3) / 2, 0.75)));
  const bedGrid = buildSegmentGrid(beds, maxHalf(beds) + 1.5);
  const wayGrid = buildSegmentGrid(ways, maxHalf(ways) + 1.5);

  const lots = plan?.lots || [];
  const lotGrid = new Map();
  const lotKey = (cx, cz) => `${cx},${cz}`;
  lots.forEach((lot, i) => {
    // Issue #62: a turned lot's corner reaches its half-diagonal.
    const r = (lot.rot ? Math.hypot(lot.w, lot.d) / 2 : Math.max(lot.w, lot.d) / 2) + 1;
    const minCx = Math.floor((lot.x - r) / 32), maxCx = Math.floor((lot.x + r) / 32);
    const minCz = Math.floor((lot.z - r) / 32), maxCz = Math.floor((lot.z + r) / 32);
    for (let cx = minCx; cx <= maxCx; cx++) for (let cz = minCz; cz <= maxCz; cz++) {
      const k = lotKey(cx, cz);
      if (!lotGrid.has(k)) lotGrid.set(k, []);
      lotGrid.get(k).push(i);
    }
  });
  const inLot = (x, z) => {
    const cell = lotGrid.get(lotKey(Math.floor(x / 32), Math.floor(z / 32))) || [];
    for (const i of cell) {
      const lot = lots[i];
      const dx = x - lot.x, dz = z - lot.z;
      if (Math.abs(dx) <= lot.w / 2 + 0.3 && Math.abs(dz) <= lot.d / 2 + 0.3) return true;
      // Issue #62: a turned lot's true footprint reaches outside its
      // axis rect along the diagonals — keep trees out of it too.
      if (lot.rot) {
        const c = Math.cos(lot.rot), sn = Math.sin(lot.rot);
        if (Math.abs(dx * c + dz * sn) <= lot.w / 2 + 0.3 && Math.abs(-dx * sn + dz * c) <= lot.d / 2 + 0.3) return true;
      }
    }
    return false;
  };

  const tower = plan?.tower || null;
  const inTowerSite = (x, z) => {
    if (!tower) return false;
    const w = (tower.podium?.w || 76) / 2 + 1, d = (tower.podium?.d || 76) / 2 + 1;
    if (Math.abs(x - tower.x) <= w && Math.abs(z - tower.z) <= d) return true;
    // Issue #40: the mall podium blocks stand beyond the tower-zone
    // base — keep trees out of their footprints too.
    for (const part of tower.podiumParts || []) {
      if (part.type !== 'box') continue;
      if (Math.abs(x - (tower.x + (part.dx || 0))) <= part.w / 2 + 1 && Math.abs(z - (tower.z + (part.dz || 0))) <= part.d / 2 + 1) return true;
    }
    return false;
  };

  const polys = [];
  for (const p of geodata.parks || []) polys.push(p.ring);
  for (const w of geodata.water || []) polys.push(w.ring);
  const polyBBoxes = polys.map((ring) => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < ring.length; i += 2) {
      minX = Math.min(minX, ring[i]); maxX = Math.max(maxX, ring[i]);
      minZ = Math.min(minZ, ring[i + 1]); maxZ = Math.max(maxZ, ring[i + 1]);
    }
    return { minX, maxX, minZ, maxZ };
  });
  const inParkOrWater = (x, z) => {
    for (let i = 0; i < polys.length; i++) {
      const bb = polyBBoxes[i];
      if (x < bb.minX || x > bb.maxX || z < bb.minZ || z > bb.maxZ) continue;
      if (pointInRing(x, z, polys[i])) return true;
    }
    return false;
  };

  // Issue #81: caller-supplied exclusion polygons (the boot passes
  // the junction cap rings + roundabout disc/apron rings): a tree
  // must never stand on junction asphalt. The planners' own
  // carriageway checks test centreline distance, and a cap corner
  // can sit 20+ m from every centreline — measured 147 planned
  // trees inside cap polygons tile-wide before this exclusion.
  const inExclusion = buildExclusionIndex(opts.exclusions);

  const rejected = { junction: 0, carriageway: 0, lot: 0, site: 0, cap: 0 };

  // One candidate through every exclusion. Returns null when planted.
  const tryPlant = (x, z, ownBedIdx) => {
    if (inExclusion(x, z)) { rejected.cap++; return false; }
    for (const s of bedGrid.near(x, z)) {
      if (s.idx === ownBedIdx) continue;
      if (distToSegment(x, z, s.ax, s.az, s.bx, s.bz) < s.half + 1.1) { rejected.junction++; return false; }
    }
    for (const s of wayGrid.near(x, z)) {
      if (distToSegment(x, z, s.ax, s.az, s.bx, s.bz) < s.half + 0.35) { rejected.carriageway++; return false; }
    }
    if (inLot(x, z)) { rejected.lot++; return false; }
    if (inTowerSite(x, z) || inParkOrWater(x, z)) { rejected.site++; return false; }
    return true;
  };

  const collect = (kind) => {
    const out = [];
    beds.forEach((bed, bedIdx) => {
      // Sidewalk rows plant on the band, so they follow the layout
      // strictly. Median rows sit between the carriageways of a merged
      // boulevard: the merge can resolve a boulevard's layout to
      // 'shared' when its widest constituent segment is untagged (much
      // of 仁愛路四段 east is one such merge), which must not cost the
      // boulevard its median planting — medians accept shared too.
      const layoutOk = kind === 'median'
        ? bed.pedestrianLayout === 'sidewalk' || bed.pedestrianLayout === 'shared'
        : bed.pedestrianLayout === 'sidewalk';
      if (!layoutOk) return;
      if (bed.name && UNPLANTABLE_NAME.test(bed.name)) return;
      const half = Math.max((bed.width || 3) / 2, 0.75);
      const key = bedKey(bed);
      if (kind === 'sidewalk') {
        if ((bed.width || 3) < TREE_SIDEWALK_MIN_W) return;
        if (!SIDEWALK_TREE_HIGHWAYS.has(bed.highway)) return;
        const spacing = 10 + hash01(`${key}|spacing`) * 3;
        const phase = hash01(`${key}|phase`) * spacing;
        const bandW = sidewalkBandWidth(bed);
        for (const st of walkStations(bed.pts, spacing, phase)) {
          for (const side of [1, -1]) {
            const j = (hash01(`${key}|${kind}|${out.length}`) - 0.5) * 2.4;
            const x = st.x + st.nx * side * (half + bandW / 2) + st.dx * j;
            const z = st.z + st.nz * side * (half + bandW / 2) + st.dz * j;
            if (tryPlant(x, z, bedIdx)) {
              out.push({ x, z, kind, scale: 0.85 + hash01(`${key}|scale|${out.length}`) * 0.5, rot: hash01(`${key}|rot|${out.length}`) * Math.PI * 2 });
            }
          }
        }
      } else {
        if ((bed.width || 3) < TREE_MEDIAN_MIN_W || (bed.sourceWayIds || []).length < 2) return;
        if (!MEDIAN_HIGHWAYS.has(bed.highway)) return;
        const spacing = 10 + hash01(`${key}|mspacing`) * 3;
        const phase = hash01(`${key}|mphase`) * spacing;
        for (const st of walkStations(bed.pts, spacing, phase)) {
          const j = (hash01(`${key}|${kind}|${out.length}`) - 0.5) * 2.4;
          const x = st.x + st.dx * j, z = st.z + st.dz * j;
          if (tryPlant(x, z, bedIdx)) {
            out.push({ x, z, kind, scale: 0.9 + hash01(`${key}|mscale|${out.length}`) * 0.5, rot: hash01(`${key}|mrot|${out.length}`) * Math.PI * 2 });
          }
        }
      }
    });
    return out;
  };

  let sidewalk = collect('sidewalk');
  let median = collect('median');
  const total = sidewalk.length + median.length;
  let capped = false;
  if (total > cap) {
    capped = true;
    const thin = (list, allowed) => {
      if (list.length <= allowed) return list;
      const out = [];
      for (let j = 0; j < allowed; j++) out.push(list[Math.floor((j * list.length) / allowed)]);
      return out;
    };
    const sideAllowed = Math.floor((cap * sidewalk.length) / total);
    median = thin(median, cap - sideAllowed);
    sidewalk = thin(sidewalk, sideAllowed);
  }

  return {
    trees: [...sidewalk, ...median],
    stats: { sidewalk: sidewalk.length, median: median.length, rejected, capped, cap },
  };
}

// ---------------------------------------------------------------------
// Issue #41 — trees inside parks
//
// Street trees (above) deliberately keep OUT of parks; this planner
// plants the park interiors. Placement is a hash-jittered grid over
// each park polygon, shaped by three fields, all deterministic:
//   - an edge bias (denser near the boundary, where real park planting
//     and street canopy meet),
//   - a path bias (slightly denser a few metres off the park's own
//     footpaths — but never ON one: a hard margin keeps every trunk
//     off paths, water, carriageways, lots and landmark sites),
//   - hash-placed clearing discs where the acceptance probability
//     collapses, so a big park reads as woodland WITH clearings (lawn,
//     amphitheatre apron, playground) instead of uniform fuzz.
// 廣場-named polygons are paved civic squares since #29 (see
// isPlazaPark in taipei-surfaces.js) — not planting ground, skipped
// whole. Density/spacing steps down with park size: big parks get
// woodland spacing, pocket parks a loose canopy.
//
// Budget: PARK_TREE_CAP park instances ON TOP of the street cap. One
// tree is 60 triangles (5-sided capped trunk 20 + two detail-0
// icosahedra 20 + 20), so the combined worst case is
// (3000 + 7500) × 60 = 630k triangles in ONE additional-free draw call
// (boot feeds both lists to the same InstancedMesh). If the raw plan
// exceeds the cap it is thinned per park, proportionally, by the same
// deterministic stride the street cap uses.

export const PARK_TREE_CAP = 7500;

export function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    a += (ring[j] + ring[i]) * (ring[j + 1] - ring[i + 1]);
  }
  return Math.abs(a / 2);
}

// [name, minArea, gridSpacing, baseAccept, clearingCount range, edgeZone]
const PARK_CLASSES = [
  { id: 'large', minArea: 40000, spacing: 9, accept: 0.68, clearings: [3, 6], edgeZone: 16 },
  { id: 'medium', minArea: 4000, spacing: 11, accept: 0.54, clearings: [1, 3], edgeZone: 14 },
  { id: 'small', minArea: 400, spacing: 12.5, accept: 0.46, clearings: [0, 1], edgeZone: 10 },
  { id: 'tiny', minArea: 0, spacing: 13, accept: 0.38, clearings: [0, 0], edgeZone: 8 },
];

export function parkSizeClass(area) {
  return PARK_CLASSES.find((c) => area >= c.minArea);
}

// Issue #222: park-tree canopy variants, mixed by the same hash
// stream as the rest of the planting (per park key + candidate
// index, so a park's mix is stable and a thinning stride never
// changes a survivor's variant). Shares are the hash bands:
// banyan 40% (the Taipei park default — broad shade canopies),
// palm 18%, conifer 20%, round 22%.
export const PARK_TREE_VARIANTS = ['banyan', 'palm', 'conifer', 'round'];
export function parkTreeVariant(key, ci) {
  const r = hash01(`${key}|variant|${ci}`);
  return r < 0.40 ? 'banyan' : r < 0.58 ? 'palm' : r < 0.78 ? 'conifer' : 'round';
}

// A park polygon whose name carries 廣場 is a paved square (#29), the
// same predicate taipei-surfaces.js renders by — mirrored here so this
// module stays dependency-free.
const isPlazaName = (name) => (name || '').includes('廣場');

export function planParkTrees(geodata, plan, opts = {}) {
  const cap = opts.cap ?? PARK_TREE_CAP;
  const parks = geodata.parks || [];
  const beds = geodata.roadbeds || [];
  const paths = (geodata.roads || []).filter((r) => NON_CARRIAGEWAY.has(r.highway));

  const maxHalf = (items) => (items.length ? Math.max(...items.map((r) => Math.max((r.width || 3) / 2, 0.75))) : 0);
  const bedGrid = buildSegmentGrid(beds, maxHalf(beds) + 1.5);
  const pathGrid = buildSegmentGrid(paths, maxHalf(paths) + 2.5);

  // Water polygons (bbox-prefiltered point-in-ring, as in the street
  // planner): a park pond or a river clipping a riverside park stays
  // unplanted.
  const water = (geodata.water || []).map((w) => {
    const ring = w.ring;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < ring.length; i += 2) {
      minX = Math.min(minX, ring[i]); maxX = Math.max(maxX, ring[i]);
      minZ = Math.min(minZ, ring[i + 1]); maxZ = Math.max(maxZ, ring[i + 1]);
    }
    return { ring, minX, maxX, minZ, maxZ };
  });
  const inWater = (x, z) => water.some((w) => x >= w.minX && x <= w.maxX && z >= w.minZ && z <= w.maxZ && pointInRing(x, z, w.ring));

  // Issue #81: caller-supplied exclusion polygons (junction caps +
  // roundabout discs/aprons from the boot), same treatment as
  // water: a park tree must never stand on junction asphalt either
  // (riverside-park ramp-merge caps carried 6 each).
  const inExclusion = buildExclusionIndex(opts.exclusions);

  // Building lots + the 101 site + landmark structure sites (SYS
  // Memorial Hall stands inside 中山公園, the Dome borders a park
  // strip): the same exclusion shapes the street planner uses (32 m
  // lot grid included — a naive scan is 21k lots per candidate),
  // plus the landmark rects planTaipeiBuildings resolved.
  const lots = plan?.lots || [];
  const lotGrid = new Map();
  const lotKey = (cx, cz) => `${cx},${cz}`;
  lots.forEach((lot, i) => {
    // Issue #62: a turned lot's corner reaches its half-diagonal.
    const r = (lot.rot ? Math.hypot(lot.w, lot.d) / 2 : Math.max(lot.w, lot.d) / 2) + 1;
    const minCx = Math.floor((lot.x - r) / 32), maxCx = Math.floor((lot.x + r) / 32);
    const minCz = Math.floor((lot.z - r) / 32), maxCz = Math.floor((lot.z + r) / 32);
    for (let cx = minCx; cx <= maxCx; cx++) for (let cz = minCz; cz <= maxCz; cz++) {
      const k = lotKey(cx, cz);
      if (!lotGrid.has(k)) lotGrid.set(k, []);
      lotGrid.get(k).push(i);
    }
  });
  const inLot = (x, z) => {
    const cell = lotGrid.get(lotKey(Math.floor(x / 32), Math.floor(z / 32))) || [];
    for (const i of cell) {
      const lot = lots[i];
      const dx = x - lot.x, dz = z - lot.z;
      if (Math.abs(dx) <= lot.w / 2 + 0.3 && Math.abs(dz) <= lot.d / 2 + 0.3) return true;
      // Issue #62: a turned lot's true footprint reaches outside its
      // axis rect along the diagonals — keep trees out of it too.
      if (lot.rot) {
        const c = Math.cos(lot.rot), sn = Math.sin(lot.rot);
        if (Math.abs(dx * c + dz * sn) <= lot.w / 2 + 0.3 && Math.abs(-dx * sn + dz * c) <= lot.d / 2 + 0.3) return true;
      }
    }
    return false;
  };
  const siteRects = [];
  const tower = plan?.tower || null;
  if (tower) {
    const w = (tower.podium?.w || 76) / 2 + 1, d = (tower.podium?.d || 76) / 2 + 1;
    siteRects.push({ minX: tower.x - w, maxX: tower.x + w, minZ: tower.z - d, maxZ: tower.z + d });
  }
  for (const lt of plan?.landmarkTowers || []) for (const s of lt.sites || []) siteRects.push(s);
  const inSite = (x, z) => siteRects.some((r) => x >= r.minX - 0.5 && x <= r.maxX + 0.5 && z >= r.minZ - 0.5 && z <= r.maxZ + 0.5);

  const rejected = { water: 0, carriageway: 0, path: 0, lot: 0, site: 0, cap: 0, probability: 0 };
  const byClass = {};
  for (const c of PARK_CLASSES) byClass[c.id] = { parks: 0, area: 0, candidates: 0, trees: 0 };
  const perPark = []; // { name, cls, area, trees[] } — cap thinning is per park

  for (const park of parks) {
    if (isPlazaName(park.name)) continue;
    const ring = park.ring;
    if (!ring || ring.length < 6) continue;
    const area = ringArea(ring);
    const cls = parkSizeClass(area);
    const st = byClass[cls.id];
    st.parks++; st.area += area;
    const key = `park|${park.name || ''}|${ring[0]},${ring[1]}|${ring.length}`;
    const trees = [];

    // Ring segments + bbox (boundary-distance field for the edge bias;
    // each segment carries its bbox so the distance loop can skip
    // segments that cannot beat the current best).
    const segs = [];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < ring.length; i += 2) {
      minX = Math.min(minX, ring[i]); maxX = Math.max(maxX, ring[i]);
      minZ = Math.min(minZ, ring[i + 1]); maxZ = Math.max(maxZ, ring[i + 1]);
      const j = (i + 2) % ring.length;
      segs.push({
        ax: ring[i], az: ring[i + 1], bx: ring[j], bz: ring[j + 1],
        minX: Math.min(ring[i], ring[j]), maxX: Math.max(ring[i], ring[j]),
        minZ: Math.min(ring[i + 1], ring[j + 1]), maxZ: Math.max(ring[i + 1], ring[j + 1]),
      });
    }
    // Clearings: hash points inside the bbox, kept only when they land
    // in the ring; radius scales with the park's own size.
    const nClear = cls.clearings[0] + Math.floor(hash01(`${key}|nclear`) * (cls.clearings[1] - cls.clearings[0] + 1));
    const clearings = [];
    for (let c = 0; c < nClear; c++) {
      const cx = minX + hash01(`${key}|clear${c}x`) * (maxX - minX);
      const cz = minZ + hash01(`${key}|clear${c}z`) * (maxZ - minZ);
      if (!pointInRing(cx, cz, ring)) continue;
      const r = (0.10 + hash01(`${key}|clear${c}r`) * 0.14) * Math.sqrt(area);
      clearings.push({ x: cx, z: cz, r });
    }
    // Jittered grid in a hash-rotated frame: no axis-aligned orchard.
    const ang = hash01(`${key}|rot`) * (Math.PI / 6);
    const cos = Math.cos(ang), sin = Math.sin(ang);
    const cxm = (minX + maxX) / 2, czm = (minZ + maxZ) / 2;
    const diag = Math.hypot(maxX - minX, maxZ - minZ) / 2 + cls.spacing;
    const step = cls.spacing;
    let candIdx = 0;
    for (let gy = -diag; gy <= diag; gy += step) {
      for (let gx = -diag; gx <= diag; gx += step) {
        const jx = (hash01(`${key}|jx|${gx.toFixed(1)},${gy.toFixed(1)}`) - 0.5) * step * 0.64;
        const jz = (hash01(`${key}|jz|${gx.toFixed(1)},${gy.toFixed(1)}`) - 0.5) * step * 0.64;
        const x = cxm + (gx + jx) * cos - (gy + jz) * sin;
        const z = czm + (gx + jx) * sin + (gy + jz) * cos;
        if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
        if (!pointInRing(x, z, ring)) continue;
        st.candidates++;
        const ci = candIdx++;
        // Hard exclusions first (each counted once, in check order).
        if (inWater(x, z)) { rejected.water++; continue; }
        let bad = false;
        for (const s of bedGrid.near(x, z)) {
          if (distToSegment(x, z, s.ax, s.az, s.bx, s.bz) < s.half + 0.9) { rejected.carriageway++; bad = true; break; }
        }
        if (bad) continue;
        for (const s of pathGrid.near(x, z)) {
          if (distToSegment(x, z, s.ax, s.az, s.bx, s.bz) < s.half + 1.8) { rejected.path++; bad = true; break; }
        }
        if (bad) continue;
        if (inLot(x, z)) { rejected.lot++; continue; }
        if (inSite(x, z)) { rejected.site++; continue; }
        if (inExclusion(x, z)) { rejected.cap++; continue; }
        // Acceptance field: base × edge bias × path bias ÷ clearings.
        let p = cls.accept;
        let dEdge = Infinity;
        for (const s of segs) {
          const dx = Math.max(s.minX - x, 0, x - s.maxX);
          const dz = Math.max(s.minZ - z, 0, z - s.maxZ);
          if (dx * dx + dz * dz >= dEdge * dEdge) continue;
          dEdge = Math.min(dEdge, distToSegment(x, z, s.ax, s.az, s.bx, s.bz));
        }
        if (dEdge < cls.edgeZone) p *= 1 + 0.35 * (1 - dEdge / cls.edgeZone);
        let dPath = Infinity;
        for (const s of pathGrid.near(x, z)) dPath = Math.min(dPath, distToSegment(x, z, s.ax, s.az, s.bx, s.bz) - s.half);
        if (dPath < 7) p *= 1.2;
        for (const c of clearings) {
          const d = Math.hypot(x - c.x, z - c.z);
          if (d < c.r) p *= d < 0.65 * c.r ? 0.03 : 0.03 + 0.97 * ((d - 0.65 * c.r) / (0.35 * c.r));
        }
        if (hash01(`${key}|roll|${ci}`) >= Math.min(p, 1)) { rejected.probability++; continue; }
        trees.push({
          x, z, kind: 'park', park: park.name || '',
          scale: 0.85 + hash01(`${key}|scale|${ci}`) * 0.6,
          rot: hash01(`${key}|trot|${ci}`) * Math.PI * 2,
          // Issue #222: seeded canopy variant — the boot renders
          // park trees from per-variant geometries (broad
          // banyan-like, palm, conifer-like, round) so the park
          // population reads distinct from the street trees,
          // which keep the single original look. Placement,
          // scale and rotation are untouched by the variant.
          variant: parkTreeVariant(key, ci),
        });
      }
    }
    st.trees += trees.length;
    perPark.push({ name: park.name || '', cls: cls.id, area, trees });
  }

  let total = perPark.reduce((s, p) => s + p.trees.length, 0);
  let capped = false;
  if (total > cap) {
    capped = true;
    // Proportional per-park allocation (floored), then the flooring
    // remainder is handed back in park order — stride-thinned, the
    // street cap's method, so a capped plan is the same plan, sparser.
    const keeps = perPark.map((p) => Math.floor((cap * p.trees.length) / total));
    let leftover = cap - keeps.reduce((s, k) => s + k, 0);
    perPark.forEach((p, i) => {
      if (leftover <= 0) return;
      const add = Math.min(leftover, p.trees.length - keeps[i]);
      keeps[i] += add;
      leftover -= add;
    });
    perPark.forEach((p, i) => {
      const keep = keeps[i];
      if (keep > 0 && p.trees.length > keep) {
        const out = [];
        for (let j = 0; j < keep; j++) out.push(p.trees[Math.floor((j * p.trees.length) / keep)]);
        p.trees = out;
      } else if (keep === 0) p.trees = [];
    });
    total = perPark.reduce((s, p) => s + p.trees.length, 0);
    for (const c of PARK_CLASSES) byClass[c.id].trees = 0;
    for (const p of perPark) byClass[p.cls].trees += p.trees.length;
  }

  const trees = perPark.flatMap((p) => p.trees);
  const topParks = [...perPark]
    .filter((p) => p.trees.length > 0)
    .sort((a, b) => b.trees.length - a.trees.length)
    .slice(0, 8)
    .map((p) => ({ name: p.name, area: Math.round(p.area), trees: p.trees.length }));

  return {
    trees,
    stats: { byClass, topParks, rejected, capped, cap, totalCandidates: Object.values(byClass).reduce((s, c) => s + c.candidates, 0) },
  };
}
