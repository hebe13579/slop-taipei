// js/taipei-street-amenities.js
// Street amenity dressing (issue #362): benches, litter bins, bus-stop
// signs, single chairs and street bushes along the sidewalk bands —
// the STREET / SIDEWALK pedestrian realm, so it reads lived-in, not
// bare. Park amenities live in taipei-park-amenities.js (#222/#246)
// and stay inside parks; street trees (planStreetTrees) and street
// lamps (planStreetLamps) already dress the same bands. This planner
// is the furniture layer between them: same anchor (the sidewalk
// band centre), same exclusions, collision-checked against the lamps
// + trees the boot already planned (opts.avoid: [{x, z, r}]).
//
// Bus stops are procedural, not OSM data: the geodata carries no
// bus-stop layer, and real Taipei stops sit roughly every 200-400 m
// on main roads, so a deterministic ~300 m spacing on arterials
// reads true. Issue #377 (sidewalk café/plaza scenes) overlaps the
// bench/tree part — its planner places café scenes in front of
// shops; this layer is the general street furniture. The two layers
// are distinct in code so they compose: #377's planner should take
// these items as avoid input (or vice versa), not rebuild them.
//
// Pure functions over the geodata shapes (no three.js), the
// taipei-streetscape.js pattern; js/taipei-boot.js turns the plan
// into one InstancedMesh per kit class.

import {
  hash01, distToSegment, buildSegmentGrid, buildExclusionIndex, pointInRing, sidewalkBandWidth,
} from './taipei-streetscape.js';

// Sidewalk rows only on these highways (the street-tree sidewalk
// set, minus trunk/motorway — expressways carry no furniture).
// Bus stops are arterials only (primary/secondary/tertiary).
const AMENITY_HIGHWAYS = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified']);
const BUS_HIGHWAYS = new Set(['primary', 'secondary', 'tertiary']);
// Same unplantable-name guard as the tree/lamp planners: tunnels,
// underpasses, expressways and elevated roads carry no furniture.
const UNPLACEABLE_NAME = /隧道|地下道|快速道路|高架/;

// Per-kind budgets (phone-fallback aware: ~8k instances over 6
// InstancedMeshes, on top of the 12k lamps + 3k street trees).
export const STREET_AMENITY_CAPS = { bench: 2600, chair: 800, bin: 1600, busStop: 700, bush: 2200 };
const BENCH_SPACING = 48, BENCH_ACCEPT = 0.55;
const CHAIR_PER_BENCH = 0.25;   // a chair beside one bench in four
const BUS_SPACING = 300;        // ~real Taipei stop spacing on arterials
const BUS_BENCH = 0.5;          // half the stops get a waiting bench
const BUSH_SPACING = 18, BUSH_ACCEPT = 0.4;
const BIN_PER_BENCH = 0.45;     // like the park bins-ride-benches rule
const BUSH_MIN_BAND_W = 2.2;    // bushes only where the band fits them

// Station walker over a flat pts polyline (the streetscape
// walkStations shape, local copy): stations carry the tangent
// (dx, dz) and the left normal (nx, nz).
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

function bedKey(r) {
  return `${r.sourceWayIds?.[0] ?? ''}|${r.name || ''}|${r.pts[0]},${r.pts[1]}`;
}

export function planStreetAmenities(geodata, plan, opts = {}) {
  const caps = { ...STREET_AMENITY_CAPS, ...(opts.caps || {}) };
  const beds = geodata.roadbeds || [];
  const ways = (geodata.roads || []).filter((r) => !['footway', 'path', 'steps', 'pedestrian', 'cycleway', 'corridor', 'elevator', 'crossing', 'platform', 'traffic_island'].includes(r.highway));

  const maxHalf = (items) => (items.length ? Math.max(...items.map((r) => Math.max((r.width || 3) / 2, 0.75))) : 0);
  const bedGrid = buildSegmentGrid(beds, maxHalf(beds) + 1.5);
  const wayGrid = buildSegmentGrid(ways, maxHalf(ways) + 1.5);

  // Lots / tower site / parks / water — the same shapes the street
  // lamp planner uses (32 m lot grid included).
  const lots = plan?.lots || [];
  const lotGrid = new Map();
  const lotKey = (cx, cz) => `${cx},${cz}`;
  lots.forEach((lot, i) => {
    const r = (lot.rot ? Math.hypot(lot.w, lot.d) / 2 : Math.max(lot.w, lot.d) / 2) + 1;
    for (let cx = Math.floor((lot.x - r) / 32); cx <= Math.floor((lot.x + r) / 32); cx++) {
      for (let cz = Math.floor((lot.z - r) / 32); cz <= Math.floor((lot.z + r) / 32); cz++) {
        const k = lotKey(cx, cz);
        if (!lotGrid.has(k)) lotGrid.set(k, []);
        lotGrid.get(k).push(i);
      }
    }
  });
  const inLot = (x, z, pad = 0.3) => {
    const cell = lotGrid.get(lotKey(Math.floor(x / 32), Math.floor(z / 32))) || [];
    for (const i of cell) {
      const lot = lots[i];
      const dx = x - lot.x, dz = z - lot.z;
      if (Math.abs(dx) <= lot.w / 2 + pad && Math.abs(dz) <= lot.d / 2 + pad) return true;
      if (lot.rot) {
        const c = Math.cos(lot.rot), sn = Math.sin(lot.rot);
        if (Math.abs(dx * c + dz * sn) <= lot.w / 2 + pad && Math.abs(-dx * sn + dz * c) <= lot.d / 2 + pad) return true;
      }
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
  const inExclusion = buildExclusionIndex(opts.exclusions);

  // Collision set: already-placed street items in this plan, plus
  // the caller-supplied avoid points (lamp posts + street trees —
  // both stand at the band centre, so a bench must not land on
  // one). Filed in an 8 m grid so a candidate only tests the points
  // near it: a naive scan is 15k avoid points per candidate.
  const placed = [];
  const GRID = 8;
  const gridKey = (cx, cz) => `${cx},${cz}`;
  const grid = new Map();
  const gridAdd = (p) => {
    const k = gridKey(Math.floor(p.x / GRID), Math.floor(p.z / GRID));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
  };
  for (const a of (opts.avoid || [])) gridAdd({ x: a.x, z: a.z, r: a.r ?? 0.6 });
  const hitsPlaced = (x, z, r, slack = 0) => {
    const cx = Math.floor(x / GRID), cz = Math.floor(z / GRID);
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gz = cz - 1; gz <= cz + 1; gz++) {
        for (const p of grid.get(gridKey(gx, gz)) || []) {
          if (Math.hypot(p.x - x, p.z - z) < p.r + r - slack) return true;
        }
      }
    }
    return false;
  };

  const rejected = { junction: 0, carriageway: 0, lot: 0, site: 0, placed: 0 };
  // One candidate through every exclusion. Returns the rejection
  // reason or null. `ownBedIdx` skips the candidate's own bed —
  // the item stands on that bed's band by construction.
  const checkOK = (x, z, r, ownBedIdx) => {
    if (inExclusion(x, z)) return 'junction';
    for (const s of bedGrid.near(x, z)) {
      if (s.idx === ownBedIdx) continue;
      if (distToSegment(x, z, s.ax, s.az, s.bx, s.bz) < s.half + r + 0.35) return 'carriageway';
    }
    for (const s of wayGrid.near(x, z)) {
      if (distToSegment(x, z, s.ax, s.az, s.bx, s.bz) < s.half + 0.35) return 'carriageway';
    }
    if (inLot(x, z, r)) return 'lot';
    if (inTowerSite(x, z) || inParkOrWater(x, z)) return 'site';
    if (hitsPlaced(x, z, r)) return 'placed';
    return null;
  };

  const items = { bench: [], chair: [], bin: [], busStop: [], bush: [] };
  const stats = { byHighway: {}, rejected };
  const yawTo = (dx, dz) => Math.atan2(dx, dz);
  const put = (kind, item, r) => {
    items[kind].push(item);
    placed.push({ x: item.x, z: item.z, r });
    gridAdd({ x: item.x, z: item.z, r });
  };

  beds.forEach((bed, bedIdx) => {
    if (bed.pedestrianLayout !== 'sidewalk') return;
    if (!AMENITY_HIGHWAYS.has(bed.highway)) return;
    if (bed.name && UNPLACEABLE_NAME.test(bed.name)) return;
    const half = Math.max((bed.width || 3) / 2, 0.75);
    const bandW = sidewalkBandWidth(bed);
    const key = bedKey(bed);
    stats.byHighway[bed.highway] = stats.byHighway[bed.highway] || { bench: 0, chair: 0, bin: 0, busStop: 0, bush: 0 };

    // --- benches (+ chairs beside them, + bins beside them)
    if (items.bench.length < caps.bench) {
      const spacing = BENCH_SPACING * (0.85 + hash01(`${key}|bench|spacing`) * 0.3);
      const phase = hash01(`${key}|bench|phase`) * spacing;
      for (const st of walkStations(bed.pts, spacing, phase)) {
        if (items.bench.length >= caps.bench) break;
        if (hash01(`${key}|bench|roll|${st.x.toFixed(1)},${st.z.toFixed(1)}`) >= BENCH_ACCEPT) continue;
        const side = hash01(`${key}|bench|side|${st.x.toFixed(1)},${st.z.toFixed(1)}`) < 0.5 ? 1 : -1;
        const x = st.x + st.nx * side * (half + bandW / 2);
        const z = st.z + st.nz * side * (half + bandW / 2);
        const why = checkOK(x, z, 0.55, bedIdx);
        if (why) { rejected[why]++; continue; }
        const rot = yawTo(-side * st.nx, -side * st.nz);
        put('bench', { x, z, rot, highway: bed.highway }, 0.55);
        stats.byHighway[bed.highway].bench++;
        // A chair beside one bench in four (same side, same
        // facing, 1.3 m along the road from the bench centre).
        if (items.chair.length < caps.chair
          && hash01(`${key}|chair|roll|${st.x.toFixed(1)},${st.z.toFixed(1)}`) < CHAIR_PER_BENCH) {
          const cx = x + st.dx * 1.3, cz = z + st.dz * 1.3;
          const cwhy = checkOK(cx, cz, 0.35, bedIdx);
          if (!cwhy) {
            put('chair', { x: cx, z: cz, rot, highway: bed.highway }, 0.35);
            stats.byHighway[bed.highway].chair++;
          } else rejected[cwhy]++;
        }
        // A bin beside ~half the benches (1.35 m sideways from
        // the bench, perpendicular to its front — the park rule).
        if (items.bin.length < caps.bin
          && hash01(`${key}|bin|roll|${st.x.toFixed(1)},${st.z.toFixed(1)}`) < BIN_PER_BENCH) {
          const along = hash01(`${key}|bin|along|${st.x.toFixed(1)},${st.z.toFixed(1)}`) < 0.5 ? 1 : -1;
          const dx = Math.sin(rot), dz = Math.cos(rot);
          const bx = x + dz * along * 1.35, bz = z - dx * along * 1.35;
          const bwhy = checkOK(bx, bz, 0.35, bedIdx);
          if (!bwhy) {
            put('bin', { x: bx, z: bz, rot, highway: bed.highway }, 0.35);
            stats.byHighway[bed.highway].bin++;
          } else rejected[bwhy]++;
        }
      }
    }

    // --- bus-stop signs (arterials only) — a sign pole at the band
    // centre, board faces along the road (visible to the oncoming
    // bus and to waiting passengers). Every stop gets a bin; half
    // get a waiting bench beside the sign.
    if (BUS_HIGHWAYS.has(bed.highway) && items.busStop.length < caps.busStop) {
      const spacing = BUS_SPACING * (0.9 + hash01(`${key}|bus|spacing`) * 0.2);
      const phase = hash01(`${key}|bus|phase`) * spacing;
      for (const st of walkStations(bed.pts, spacing, phase)) {
        if (items.busStop.length >= caps.busStop) break;
        const side = hash01(`${key}|bus|side|${st.x.toFixed(1)},${st.z.toFixed(1)}`) < 0.5 ? 1 : -1;
        const x = st.x + st.nx * side * (half + bandW / 2);
        const z = st.z + st.nz * side * (half + bandW / 2);
        const why = checkOK(x, z, 0.4, bedIdx);
        if (why) { rejected[why]++; continue; }
        const rot = yawTo(st.dx, st.dz);
        put('busStop', { x, z, rot, highway: bed.highway }, 0.4);
        stats.byHighway[bed.highway].busStop++;
        // Bin at every stop, 1.0 m along the road from the sign.
        if (items.bin.length < caps.bin) {
          const bx = x + st.dx * 1.0, bz = z + st.dz * 1.0;
          const bbwhy = checkOK(bx, bz, 0.35, bedIdx);
          if (!bbwhy) {
            put('bin', { x: bx, z: bz, rot, highway: bed.highway }, 0.35);
            stats.byHighway[bed.highway].bin++;
          } else rejected[bbwhy]++;
        }
        // Waiting bench at half the stops, 1.6 m along the road
        // on the other side of the sign, facing the road.
        if (items.bench.length < caps.bench
          && hash01(`${key}|busbench|roll|${st.x.toFixed(1)},${st.z.toFixed(1)}`) < BUS_BENCH) {
          const bx = x - st.dx * 1.6, bz = z - st.dz * 1.6;
          const brot = yawTo(-side * st.nx, -side * st.nz);
          const bswhy = checkOK(bx, bz, 0.55, bedIdx);
          if (!bswhy) {
            put('bench', { x: bx, z: bz, rot: brot, highway: bed.highway }, 0.55);
            stats.byHighway[bed.highway].bench++;
          } else rejected[bswhy]++;
        }
      }
    }

    // --- street bushes (wide bands only): compact shrubs at the
    // band centre, alternating sides, so the walking line keeps
    // gaps between them — same idiom as the street trees.
    if (bandW >= BUSH_MIN_BAND_W && items.bush.length < caps.bush) {
      const spacing = BUSH_SPACING * (0.9 + hash01(`${key}|bush|spacing`) * 0.2);
      const phase = hash01(`${key}|bush|phase`) * spacing;
      for (const st of walkStations(bed.pts, spacing, phase)) {
        if (items.bush.length >= caps.bush) break;
        if (hash01(`${key}|bush|roll|${st.x.toFixed(1)},${st.z.toFixed(1)}`) >= BUSH_ACCEPT) continue;
        const side = hash01(`${key}|bush|side|${st.x.toFixed(1)},${st.z.toFixed(1)}`) < 0.5 ? 1 : -1;
        const x = st.x + st.nx * side * (half + bandW / 2);
        const z = st.z + st.nz * side * (half + bandW / 2);
        const why = checkOK(x, z, 0.75, bedIdx);
        if (why) { rejected[why]++; continue; }
        put('bush', {
          x, z,
          rot: hash01(`${key}|bush|rot|${st.x.toFixed(1)},${st.z.toFixed(1)}`) * Math.PI * 2,
          scale: 0.5 + hash01(`${key}|bush|scale|${st.x.toFixed(1)},${st.z.toFixed(1)}`) * 0.3,
          highway: bed.highway,
        }, 0.75);
        stats.byHighway[bed.highway].bush++;
      }
    }
  });

  const total = Object.values(items).reduce((s, v) => s + v.length, 0);
  return { items, stats: { ...stats, total } };
}
