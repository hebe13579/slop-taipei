// js/taipei-streetscape.js
// Streetscape geometry for the Taipei tile (issues #27, #28): visible
// sidewalks (人行道) for sidewalk-layout roadbeds and deterministic
// street-tree placement. Pure functions over the geodata shapes — no
// three.js — so tests and evidence scripts can run them in node;
// js/taipei-boot.js turns the results into meshes.
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
    const r = Math.max(lot.w, lot.d) / 2 + 1;
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
      if (Math.abs(x - lot.x) <= lot.w / 2 + 0.3 && Math.abs(z - lot.z) <= lot.d / 2 + 0.3) return true;
    }
    return false;
  };

  const tower = plan?.tower || null;
  const inTowerSite = (x, z) => {
    if (!tower) return false;
    const w = (tower.podium?.w || 76) / 2 + 1, d = (tower.podium?.d || 76) / 2 + 1;
    return Math.abs(x - tower.x) <= w && Math.abs(z - tower.z) <= d;
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

  const rejected = { junction: 0, carriageway: 0, lot: 0, site: 0 };

  // One candidate through every exclusion. Returns null when planted.
  const tryPlant = (x, z, ownBedIdx) => {
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
