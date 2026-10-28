// js/taipei-park-amenities.js
// Park amenity dressing (issue #222): benches, lamp poles, litter
// bins, vending-machine clusters, restroom blocks, sculptures,
// drinking fountains and bush clusters, planned procedurally over
// the geodata park polygons — seeded per park, density by park
// area and path length, hard per-park caps per kit class. Pure
// functions over the geodata shapes (no three.js), the
// taipei-streetscape.js pattern; js/taipei-boot.js turns the plan
// into one InstancedMesh per kit class.
//
// Placement doctrine (the issue's rules, as the data supports):
//   - Everything is anchored to the park's own path network (the
//     non-carriageway ways that cross the ring) or to its
//     entrances (path x boundary crossings). Furniture stands
//     BESIDE paths, never on them; through-routes stay clear.
//   - A park with no mapped interior path gets NO furniture —
//     there is no faithful place to put it (1,114 of 1,575
//     dressed parks at the #222 census; they still receive the
//     varied-tree scatter from planParkTrees).
//   - Nothing lands on water, a carriageway, a building lot, a
//     landmark site, or a caller-supplied exclusion polygon
//     (junction caps, MRT ground beds, trench slots — the boot
//     passes the same list the tree planners get).
//   - The geodata carries no playground/pitch layer inside
//     parks, so there is nothing finer to exclude against; the
//     path-anchored offsets are the proxy (census note on #222).
//   - 廣場-named polygons are paved civic squares (#29) and are
//     skipped whole, exactly as planParkTrees skips them.
//
// Budgets: per-park caps by the park-tree area classes, so the
// riverside strips (12+ km of path inside one polygon) cannot
// run away — tile-wide totals are pinned by
// tests/taipei-parks.test.mjs. One InstancedMesh per kit class
// in the boot: ~13 added draw calls, low-poly parts throughout.

import {
  hash01, distToSegment, buildSegmentGrid, pointInRing, ringArea, parkSizeClass,
} from './taipei-streetscape.js';

const NON_CARRIAGEWAY = new Set(['footway', 'path', 'steps', 'pedestrian', 'cycleway', 'corridor', 'elevator', 'crossing', 'platform', 'traffic_island']);
const isPlazaName = (name) => (name || '').includes('廣場');

// Per-park hard caps by area class (parkSizeClass ids).
export const AMENITY_CAPS = {
  bench: { large: 64, medium: 24, small: 8, tiny: 2 },
  lamp: { large: 48, medium: 16, small: 5, tiny: 0 },
  bin: { large: 36, medium: 14, small: 5, tiny: 1 },
  bush: { large: 260, medium: 80, small: 24, tiny: 6 },
};
export const VENDING_MIN_AREA = 4000;   // m2 — below this, no machines
export const RESTROOM_MIN_AREA = 15000; // m2 — one block per such park
export const SCULPTURE_MIN_AREA = 40000; // m2 — large class only, ~50%
export const FOUNTAIN_MIN_AREA = 100000; // m2 — rare, ~60%, at most one

const BENCH_SPACING = 24, BENCH_ACCEPT = 0.5, BENCH_PAIR = 0.25;
const LAMP_SPACING = 28, LAMP_ACCEPT = 0.85;
const BUSH_SPACING = 9, BUSH_ACCEPT = 0.4;
const BIN_PER_BENCH = 0.45, BIN_PER_ENTRANCE = 1, BIN_ENTRANCE_MAX = 4;

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

const segCross = (ax, az, bx, bz, cx, cz, dx, dz) => {
  const d1 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx);
  const d2 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  const d3 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const d4 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
  if (!(((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)))) return null;
  const r1 = bx - ax, r2 = bz - az, s1 = dx - cx, s2 = dz - cz;
  const den = r1 * s2 - r2 * s1;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((cx - ax) * s2 - (cz - az) * s1) / den;
  return [ax + r1 * t, az + r2 * t];
};

export function planParkAmenities(geodata, plan, opts = {}) {
  const parks = geodata.parks || [];
  const beds = geodata.roadbeds || [];
  const pathWays = (geodata.roads || []).filter((r) => NON_CARRIAGEWAY.has(r.highway));

  const maxHalf = (items) => (items.length ? Math.max(...items.map((r) => Math.max((r.width || 3) / 2, 0.75))) : 0);
  const bedGrid = buildSegmentGrid(beds, maxHalf(beds) + 2);
  const pathGrid = buildSegmentGrid(pathWays, maxHalf(pathWays) + 4);

  // Way-bbox grid so each park only walks the paths that touch it.
  const WCELL = 200;
  const wayGrid = new Map();
  const wkey = (cx, cz) => `${cx},${cz}`;
  pathWays.forEach((r, ri) => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < r.pts.length; i += 2) {
      minX = Math.min(minX, r.pts[i]); maxX = Math.max(maxX, r.pts[i]);
      minZ = Math.min(minZ, r.pts[i + 1]); maxZ = Math.max(maxZ, r.pts[i + 1]);
    }
    for (let cx = Math.floor(minX / WCELL); cx <= Math.floor(maxX / WCELL); cx++) {
      for (let cz = Math.floor(minZ / WCELL); cz <= Math.floor(maxZ / WCELL); cz++) {
        const k = wkey(cx, cz);
        if (!wayGrid.has(k)) wayGrid.set(k, []);
        wayGrid.get(k).push(ri);
      }
    }
  });
  const waysNear = (minX, maxX, minZ, maxZ) => {
    const out = new Set();
    for (let cx = Math.floor(minX / WCELL); cx <= Math.floor(maxX / WCELL); cx++) {
      for (let cz = Math.floor(minZ / WCELL); cz <= Math.floor(maxZ / WCELL); cz++) {
        for (const ri of wayGrid.get(wkey(cx, cz)) || []) out.add(ri);
      }
    }
    return [...out].sort((a, b) => a - b);
  };

  // Water / lots / sites / caller exclusions — the same exclusion
  // shapes planParkTrees builds (kept local so this module does
  // not reach into the tree planner's internals).
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
  const exclPolys = (opts.exclusions || []).map((ring) => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < ring.length; i += 2) {
      minX = Math.min(minX, ring[i]); maxX = Math.max(maxX, ring[i]);
      minZ = Math.min(minZ, ring[i + 1]); maxZ = Math.max(maxZ, ring[i + 1]);
    }
    return { ring, minX, maxX, minZ, maxZ };
  });
  const inExclusion = (x, z) => exclPolys.some((p) => x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ && pointInRing(x, z, p.ring));
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
  const inLot = (x, z, pad) => {
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
  const siteRects = [];
  const tower = plan?.tower || null;
  if (tower) {
    const w = (tower.podium?.w || 76) / 2 + 1, d = (tower.podium?.d || 76) / 2 + 1;
    siteRects.push({ minX: tower.x - w, maxX: tower.x + w, minZ: tower.z - d, maxZ: tower.z + d });
  }
  for (const lt of plan?.landmarkTowers || []) for (const s of lt.sites || []) siteRects.push(s);
  const inSite = (x, z, pad) => siteRects.some((r) => x >= r.minX - pad && x <= r.maxX + pad && z >= r.minZ - pad && z <= r.maxZ + pad);

  const items = { bench: [], lamp: [], bin: [], vending: [], restroom: [], sculpture: [], fountain: [], bush: [] };
  const stats = {
    parksTotal: 0, parksPlaza: 0, parksPathless: 0, parksDressed: 0,
    byClass: {}, rejected: { water: 0, carriageway: 0, path: 0, lot: 0, site: 0, placed: 0, outside: 0 },
    skipped: { restroom: 0, sculpture: 0, fountain: 0, vending: 0 },
    perKitParks: { bench: 0, lamp: 0, bin: 0, vending: 0, restroom: 0, sculpture: 0, fountain: 0, bush: 0 },
    topParks: [],
  };
  for (const id of ['large', 'medium', 'small', 'tiny']) stats.byClass[id] = { parks: 0, items: 0 };
  const perParkCounts = [];

  for (const park of parks) {
    stats.parksTotal++;
    if (isPlazaName(park.name)) { stats.parksPlaza++; continue; }
    const ring = park.ring;
    if (!ring || ring.length < 6) continue;
    const area = ringArea(ring);
    const cls = parkSizeClass(area).id;
    stats.byClass[cls].parks++;
    const key = `amen|${park.name || ''}|${ring[0]},${ring[1]}|${ring.length}`;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < ring.length; i += 2) {
      minX = Math.min(minX, ring[i]); maxX = Math.max(maxX, ring[i]);
      minZ = Math.min(minZ, ring[i + 1]); maxZ = Math.max(maxZ, ring[i + 1]);
    }
    const cenX = (minX + maxX) / 2, cenZ = (minZ + maxZ) / 2;

    // This park's path ways + in-park path length.
    const wayIdx = waysNear(minX, maxX, minZ, maxZ);
    const myWays = [];
    let pathLen = 0;
    for (const ri of wayIdx) {
      const w = pathWays[ri];
      const half = Math.max((w.width || 3) / 2, 0.75);
      let inside = 0;
      for (let i = 0; i + 3 < w.pts.length; i += 2) {
        const mx = (w.pts[i] + w.pts[i + 2]) / 2, mz = (w.pts[i + 1] + w.pts[i + 3]) / 2;
        if (mx >= minX && mx <= maxX && mz >= minZ && mz <= maxZ && pointInRing(mx, mz, ring)) {
          inside += Math.hypot(w.pts[i + 2] - w.pts[i], w.pts[i + 3] - w.pts[i + 1]);
        }
      }
      if (inside > 0) { myWays.push({ pts: w.pts, half, len: inside }); pathLen += inside; }
    }

    // Entrances: path x boundary crossings, deduped at 10 m,
    // busiest (most path endpoints nearby) first.
    const crossings = [];
    for (const ri of wayIdx) {
      const p = pathWays[ri].pts;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3];
        if (Math.max(ax, bx) < minX || Math.min(ax, bx) > maxX || Math.max(az, bz) < minZ || Math.min(az, bz) > maxZ) continue;
        for (let j = 0; j + 2 < ring.length; j += 2) {
          const hit = segCross(ax, az, bx, bz, ring[j], ring[j + 1], ring[j + 2], ring[j + 3]);
          if (!hit) continue;
          // Inward = toward whichever segment endpoint is inside.
          let ix = cenX - hit[0], iz = cenZ - hit[1];
          const aIn = pointInRing(ax, az, ring), bIn = pointInRing(bx, bz, ring);
          if (aIn !== bIn) { const [ex, ez] = aIn ? [ax, az] : [bx, bz]; ix = ex - hit[0]; iz = ez - hit[1]; }
          const il = Math.hypot(ix, iz) || 1;
          crossings.push({ x: hit[0], z: hit[1], ix: ix / il, iz: iz / il, half: Math.max((pathWays[ri].width || 3) / 2, 0.75) });
        }
      }
    }
    const entrances = [];
    for (const c of crossings) {
      if (!entrances.some((e) => Math.hypot(e.x - c.x, e.z - c.z) < 10)) entrances.push(c);
    }
    for (const e of entrances) {
      e.busy = 0;
      for (const ri of wayIdx) {
        const p = pathWays[ri].pts;
        for (let i = 0; i < p.length; i += 2) {
          if (Math.hypot(p[i] - e.x, p[i + 1] - e.z) < 16) e.busy++;
        }
      }
    }
    entrances.sort((a, b) => b.busy - a.busy);

    if (!myWays.length) { stats.parksPathless++; continue; }
    stats.parksDressed++;

    // Per-park placement context. checkOK is pure (returns the
    // rejection reason or null) so search-style placements can
    // evaluate candidate configurations speculatively; spotOK
    // wraps it with the census counters.
    const placed = []; // {x, z, r}
    const hitsPlaced = (x, z, r, slack = 0) => placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r - slack);
    const checkOK = (x, z, r) => {
      if (!pointInRing(x, z, ring)) return 'outside';
      if (inWater(x, z)) return 'water';
      for (const s of bedGrid.near(x, z)) {
        if (distToSegment(x, z, s.ax, s.az, s.bx, s.bz) < s.half + r + 0.35) return 'carriageway';
      }
      for (const s of pathGrid.near(x, z)) {
        if (distToSegment(x, z, s.ax, s.az, s.bx, s.bz) < s.half + r) return 'path';
      }
      if (inLot(x, z, r)) return 'lot';
      if (inSite(x, z, r)) return 'site';
      if (inExclusion(x, z)) return 'outside';
      if (hitsPlaced(x, z, r)) return 'placed';
      return null;
    };
    const spotOK = (x, z, r) => {
      const why = checkOK(x, z, r);
      if (why) { stats.rejected[why]++; return false; }
      return true;
    };
    const counts = { bench: 0, lamp: 0, bin: 0, vending: 0, restroom: 0, sculpture: 0, fountain: 0, bush: 0 };
    const put = (kind, item, r) => {
      items[kind].push(item);
      placed.push({ x: item.x, z: item.z, r });
      counts[kind]++;
      stats.byClass[cls].items++;
    };
    const yawTo = (dx, dz) => Math.atan2(dx, dz);

    // --- restroom (first: the biggest footprint claims its spot)
    if (area >= RESTROOM_MIN_AREA) {
      let done = false;
      // Anchors: the four busiest entrances, then the longest
      // path's midpoint lawns. A headline entrance can sit in a
      // path braid no search ring escapes (Da'an's 信義路 main
      // entrance: fifty tries, all on paths) — the block belongs
      // NEAR an entrance, not necessarily the busiest one.
      const anchors = entrances.slice(0, 4).map((e, ei) => {
        const side = hash01(`${key}|wc|side|${ei}`) < 0.5 ? 1 : -1;
        return {
          x: e.x + e.ix * 7 + (-e.iz) * side * (e.half + 4.4),
          z: e.z + e.iz * 7 + (e.ix) * side * (e.half + 4.4),
          face: e,
        };
      });
      if (myWays.length) {
        const w = myWays.reduce((a, b) => (b.len > a.len ? b : a));
        const st = walkStations(w.pts, Math.max(w.len, 1), w.len / 2)[0];
        if (st) {
          for (const sgn of [1, -1]) {
            anchors.push({ x: st.x + st.nx * sgn * (w.half + 6), z: st.z + st.nz * sgn * (w.half + 6), face: null });
          }
        }
      }
      for (const a of anchors) {
        if (done) break;
        const tries = [[a.x, a.z]];
        for (const rr of [3.5, 7, 10.5, 15]) for (let k = 0; k < 8; k++) {
          const t = (k / 8) * Math.PI * 2 + hash01(`${key}|wc|${rr}`) * 0.6;
          tries.push([a.x + Math.cos(t) * rr, a.z + Math.sin(t) * rr]);
        }
        for (const [x, z] of tries) {
          if (!spotOK(x, z, 3.6)) continue;
          const fx = a.face ? a.face.x - x : cenX - x, fz = a.face ? a.face.z - z : cenZ - z;
          put('restroom', { x, z, rot: yawTo(fx, fz), park: park.name || '' }, 3.6);
          done = true;
          break;
        }
      }
      if (!done) stats.skipped.restroom++;
    }

    // --- sculpture (large parks, seeded ~50%)
    let sculptureSpot = null;
    if (area >= SCULPTURE_MIN_AREA && hash01(`${key}|sculpt|roll`) < 0.5) {
      const w = myWays.reduce((a, b) => (b.len > a.len ? b : a));
      const tries = [];
      for (const f of [0.35, 0.5, 0.65]) {
        const sts = walkStations(w.pts, Math.max(w.len, 1), w.len * f);
        if (sts[0]) for (const sgn of [1, -1]) {
          tries.push([sts[0].x + sts[0].nx * sgn * (w.half + 5.5), sts[0].z + sts[0].nz * sgn * (w.half + 5.5)]);
        }
      }
      for (let k = 0; k < 6; k++) {
        const t = hash01(`${key}|sculpt|a${k}`) * Math.PI * 2, rr = 4 + k * 3.5;
        tries.push([cenX + Math.cos(t) * rr, cenZ + Math.sin(t) * rr]);
      }
      for (const [x, z] of tries) {
        if (!spotOK(x, z, 2.2)) continue;
        const form = Math.floor(hash01(`${key}|sculpt|form`) * 3) % 3;
        put('sculpture', { x, z, rot: hash01(`${key}|sculpt|rot`) * Math.PI * 2, form, park: park.name || '' }, 2.2);
        sculptureSpot = { x, z };
        break;
      }
      if (!sculptureSpot) stats.skipped.sculpture++;
    }

    // --- drinking fountain (rare: biggest parks, at most one)
    if (area >= FOUNTAIN_MIN_AREA && hash01(`${key}|fountain|roll`) < 0.6) {
      const tries = [];
      if (entrances.length) {
        const e = entrances[0];
        for (const lat of [0, 2.6, -2.6]) {
          tries.push([e.x + e.ix * 6 - e.iz * lat, e.z + e.iz * 6 + e.ix * lat]);
        }
      }
      if (sculptureSpot) tries.push([sculptureSpot.x + 4.5, sculptureSpot.z + 1.5]);
      if (entrances.length) {
        const e = entrances[0];
        for (const rr of [9, 12]) for (let k = 0; k < 6; k++) {
          const t = (k / 6) * Math.PI * 2 + hash01(`${key}|fountain|spiral`) * 0.8;
          tries.push([e.x + e.ix * 6 + Math.cos(t) * rr * 0.4, e.z + e.iz * 6 + Math.sin(t) * rr * 0.4]);
        }
      }
      let done = false;
      for (const [x, z] of tries) {
        if (!spotOK(x, z, 0.8)) continue;
        put('fountain', { x, z, rot: hash01(`${key}|fountain|rot`) * Math.PI * 2, park: park.name || '' }, 0.8);
        done = true;
        break;
      }
      if (!done) stats.skipped.fountain++;
    }

    // --- vending clusters at the busiest entrances. Entrances
    // are path junctions by nature — converging paths crowd the
    // first metres inside the boundary — so the row searches a
    // small deterministic configuration set (side x depth x
    // lateral offset) and keeps the configuration where the
    // most machines fit; the row runs beside the entrance path
    // and faces it.
    if (area >= VENDING_MIN_AREA && entrances.length) {
      const use = cls === 'large' ? entrances.slice(0, 2) : entrances.slice(0, 1);
      for (const e of use) {
        if (counts.vending >= 6) break;
        const n = 2 + (hash01(`${key}|vend|n|${e.x},${e.z}`) < 0.45 ? 1 : 0);
        const firstSide = hash01(`${key}|vend|side|${e.x},${e.z}`) < 0.5 ? 1 : -1;
        let best = null;
        for (const side of [firstSide, -firstSide]) {
          for (const depth of [3.0, 4.5, 6.5]) {
            for (const lat of [1.15, 1.95]) {
              const cxp = e.x + e.ix * depth + (-e.iz) * side * (e.half + lat);
              const czp = e.z + e.iz * depth + (e.ix) * side * (e.half + lat);
              const spots = [];
              for (let k = 0; k < n; k++) {
                const off = (k - (n - 1) / 2) * 1.08;
                const x = cxp + e.ix * off, z = czp + e.iz * off;
                if (!checkOK(x, z, 0.62)) spots.push([x, z, k]);
              }
              if (!best || spots.length > best.spots.length) best = { side, spots };
              if (best.spots.length === n) break;
            }
            if (best && best.spots.length === n) break;
          }
          if (best && best.spots.length === n) break;
        }
        if (!best || !best.spots.length) { stats.skipped.vending++; continue; }
        for (const [x, z, k] of best.spots) {
          if (counts.vending >= 6) break;
          if (!spotOK(x, z, 0.62)) continue;
          put('vending', {
            x, z,
            rot: yawTo(e.iz * best.side, -e.ix * best.side),
            tint: Math.floor(hash01(`${key}|vend|tint|${e.x},${e.z}|${k}`) * 4) % 4,
            park: park.name || '',
          }, 0.62);
        }
      }
    }

    // --- path stations: benches, lamps, bushes
    const stationsFor = (spacing, tag) => {
      const out = [];
      for (const w of myWays) {
        const phase = hash01(`${key}|${tag}|phase|${w.pts[0]},${w.pts[1]}`) * spacing;
        for (const st of walkStations(w.pts, spacing, phase)) {
          if (st.x < minX || st.x > maxX || st.z < minZ || st.z > maxZ) continue;
          if (!pointInRing(st.x, st.z, ring)) continue;
          out.push({ ...st, half: w.half });
        }
      }
      return out;
    };
    for (const st of stationsFor(BENCH_SPACING, 'bench')) {
      if (counts.bench >= AMENITY_CAPS.bench[cls]) break;
      if (hash01(`${key}|bench|roll|${st.x.toFixed(1)},${st.z.toFixed(1)}`) >= BENCH_ACCEPT) continue;
      const side = hash01(`${key}|bench|side|${st.x.toFixed(1)},${st.z.toFixed(1)}`) < 0.5 ? 1 : -1;
      const mk = (sgn) => {
        const x = st.x + st.nx * sgn * (st.half + 0.85);
        const z = st.z + st.nz * sgn * (st.half + 0.85);
        if (!spotOK(x, z, 0.55)) return false;
        put('bench', { x, z, rot: yawTo(-st.nx * sgn, -st.nz * sgn), park: park.name || '' }, 0.55);
        return true;
      };
      if (!mk(side)) continue;
      if (counts.bench < AMENITY_CAPS.bench[cls]
        && hash01(`${key}|bench|pair|${st.x.toFixed(1)},${st.z.toFixed(1)}`) < BENCH_PAIR) mk(-side);
    }
    for (const st of stationsFor(LAMP_SPACING, 'lamp')) {
      if (counts.lamp >= AMENITY_CAPS.lamp[cls]) break;
      if (hash01(`${key}|lamp|roll|${st.x.toFixed(1)},${st.z.toFixed(1)}`) >= LAMP_ACCEPT) continue;
      const side = (Math.floor(hash01(`${key}|lamp|side|${st.x.toFixed(1)},${st.z.toFixed(1)}`) * 2) % 2) ? 1 : -1;
      const x = st.x + st.nx * side * (st.half + 0.7);
      const z = st.z + st.nz * side * (st.half + 0.7);
      if (!spotOK(x, z, 0.3)) continue;
      put('lamp', { x, z, rot: yawTo(-st.nx * side, -st.nz * side), park: park.name || '' }, 0.3);
    }
    // Bins ride along with benches (after benches exist) + entrances.
    const myBenches = items.bench.slice(items.bench.length - counts.bench);
    for (const b of myBenches) {
      if (counts.bin >= AMENITY_CAPS.bin[cls]) break;
      const dx = Math.sin(b.rot), dz = Math.cos(b.rot); // bench front dir
      const along = hash01(`${key}|bin|along|${b.x.toFixed(1)},${b.z.toFixed(1)}`) < 0.5 ? 1 : -1;
      // Step sideways from the bench (perpendicular to its front).
      const x = b.x + dz * along * 1.35, z = b.z - dx * along * 1.35;
      if (hash01(`${key}|bin|roll|${b.x.toFixed(1)},${b.z.toFixed(1)}`) >= BIN_PER_BENCH) continue;
      if (!spotOK(x, z, 0.35)) continue;
      put('bin', { x, z, rot: b.rot, park: park.name || '' }, 0.35);
    }
    for (const e of entrances.slice(0, BIN_ENTRANCE_MAX)) {
      if (counts.bin >= AMENITY_CAPS.bin[cls]) break;
      const side = hash01(`${key}|bin|eside|${e.x},${e.z}`) < 0.5 ? 1 : -1;
      const x = e.x + e.ix * 2.0 + (-e.iz) * side * (e.half + 0.9);
      const z = e.z + e.iz * 2.0 + (e.ix) * side * (e.half + 0.9);
      if (!spotOK(x, z, 0.35)) continue;
      put('bin', { x, z, rot: yawTo(e.ix, e.iz), park: park.name || '' }, 0.35);
    }
    for (const st of stationsFor(BUSH_SPACING, 'bush')) {
      if (counts.bush >= AMENITY_CAPS.bush[cls]) break;
      if (hash01(`${key}|bush|roll|${st.x.toFixed(1)},${st.z.toFixed(1)}`) >= BUSH_ACCEPT) continue;
      const side = hash01(`${key}|bush|side|${st.x.toFixed(1)},${st.z.toFixed(1)}`) < 0.5 ? 1 : -1;
      const off = st.half + 1.25 + hash01(`${key}|bush|off|${st.x.toFixed(1)},${st.z.toFixed(1)}`) * 1.3;
      const x = st.x + st.nx * side * off;
      const z = st.z + st.nz * side * off;
      // Bushes may nestle (slack), but still respect every hard
      // exclusion in spotOK except the placed-overlap one.
      if (hitsPlaced(x, z, 0.75, 0.45)) { stats.rejected.placed++; continue; }
      if (!pointInRing(x, z, ring) || inWater(x, z) || inLot(x, z, 0.5) || inSite(x, z, 0.5) || inExclusion(x, z)) continue;
      let bad = false;
      for (const s of bedGrid.near(x, z)) if (distToSegment(x, z, s.ax, s.az, s.bx, s.bz) < s.half + 0.8) { bad = true; break; }
      if (bad) continue;
      for (const s of pathGrid.near(x, z)) if (distToSegment(x, z, s.ax, s.az, s.bx, s.bz) < s.half + 0.55) { bad = true; break; }
      if (bad) continue;
      put('bush', {
        x, z,
        rot: hash01(`${key}|bush|rot|${st.x.toFixed(1)},${st.z.toFixed(1)}`) * Math.PI * 2,
        scale: 0.55 + hash01(`${key}|bush|scale|${st.x.toFixed(1)},${st.z.toFixed(1)}`) * 0.85,
        park: park.name || '',
      }, 0.75);
    }

    for (const k of Object.keys(counts)) if (counts[k] > 0) stats.perKitParks[k]++;
    const totalHere = Object.values(counts).reduce((s, v) => s + v, 0);
    if (totalHere > 0) perParkCounts.push({ name: park.name || '', cls, area: Math.round(area), items: totalHere, counts });
  }

  stats.topParks = perParkCounts.sort((a, b) => b.items - a.items).slice(0, 8);
  return { items, stats };
}
