// tools/taipei/census-park-amenities.mjs — issue #222 census:
// parks by area class, the path/entrance geometry the amenity
// dressing has to work with, and the projected kit counts under
// the budget rules the planner (js/taipei-park-amenities.js)
// implements. Run: node tools/taipei/census-park-amenities.mjs
import { TAIPEI_GEO } from '../../js/taipei-geodata.js';
import { ringArea, parkSizeClass, pointInRing } from '../../js/taipei-streetscape.js';

const NON_CARRIAGEWAY = new Set(['footway', 'path', 'steps', 'pedestrian', 'cycleway', 'corridor', 'elevator', 'crossing', 'platform', 'traffic_island']);
const isPlazaName = (name) => (name || '').includes('廣場');

const parks = TAIPEI_GEO.parks || [];
const paths = (TAIPEI_GEO.roads || []).filter((r) => NON_CARRIAGEWAY.has(r.highway));

// Path segments filed by 200 m grid cell over their bbox, so each
// park only tests the ways that can touch it.
const CELL = 200;
const grid = new Map();
const gkey = (cx, cz) => `${cx},${cz}`;
paths.forEach((r, ri) => {
  const p = r.pts;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    minX = Math.min(minX, p[i]); maxX = Math.max(maxX, p[i]);
    minZ = Math.min(minZ, p[i + 1]); maxZ = Math.max(maxZ, p[i + 1]);
  }
  for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
    for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
      const k = gkey(cx, cz);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(ri);
    }
  }
});
const waysNear = (minX, maxX, minZ, maxZ) => {
  const out = new Set();
  for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
    for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
      for (const ri of grid.get(gkey(cx, cz)) || []) out.add(ri);
    }
  }
  return out;
};

const segInt = (ax, az, bx, bz, cx, cz, dx, dz) => {
  const d1 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx);
  const d2 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  const d3 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const d4 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
};

// The budget rules the census projects (expectation values; the
// planner draws the same stations with per-park hashes).
export const KIT_RULES = {
  bench: { spacing: 24, accept: 0.5, pairBonus: 1.25, cap: { large: 48, medium: 24, small: 8, tiny: 2 } },
  lamp: { spacing: 28, accept: 0.85, cap: { large: 36, medium: 16, small: 5, tiny: 0 } },
  bin: { perBench: 0.45, perEntrance: 1, cap: { large: 30, medium: 14, small: 5, tiny: 1 } },
  vending: { minArea: 1500, perEntrance: 2.4, entrancesUsed: 2, cap: 6 },
  restroom: { minArea: 15000 },
  sculpture: { minArea: 40000, share: 0.5 },
  fountain: { minArea: 100000, share: 0.6 },
  bush: { spacing: 9, accept: 0.4, cap: { large: 200, medium: 80, small: 24, tiny: 6 } },
};

const rows = [];
let plazaCount = 0;
for (const park of parks) {
  if (isPlazaName(park.name)) { plazaCount++; continue; }
  const ring = park.ring;
  if (!ring || ring.length < 6) continue;
  const area = ringArea(ring);
  const cls = parkSizeClass(area).id;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    minX = Math.min(minX, ring[i]); maxX = Math.max(maxX, ring[i]);
    minZ = Math.min(minZ, ring[i + 1]); maxZ = Math.max(maxZ, ring[i + 1]);
  }
  let pathLen = 0, pathSegs = 0;
  const crossings = [];
  for (const ri of waysNear(minX, maxX, minZ, maxZ)) {
    const p = paths[ri].pts;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3];
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      if (mx >= minX && mx <= maxX && mz >= minZ && mz <= maxZ && pointInRing(mx, mz, ring)) {
        pathLen += Math.hypot(bx - ax, bz - az);
        pathSegs++;
      }
      // Boundary crossings -> entrances.
      for (let j = 0; j + 2 < ring.length; j += 2) {
        const cx = ring[j], cz = ring[j + 1], dx = ring[j + 2], dz = ring[j + 3];
        if (segInt(ax, az, bx, bz, cx, cz, dx, dz)) {
          // crossing point by line intersection
          const r1 = bx - ax, r2 = bz - az, s1 = dx - cx, s2 = dz - cz;
          const den = r1 * s2 - r2 * s1;
          if (Math.abs(den) < 1e-9) continue;
          const t = ((cx - ax) * s2 - (cz - az) * s1) / den;
          crossings.push([ax + r1 * t, az + r2 * t]);
        }
      }
    }
  }
  // Dedupe crossings 10 m apart -> entrances.
  const entrances = [];
  for (const c of crossings) {
    if (!entrances.some((e) => Math.hypot(e[0] - c[0], e[1] - c[1]) < 10)) entrances.push(c);
  }
  rows.push({ name: park.name || '', cls, area, pathLen, pathSegs, entrances: entrances.length });
}

const classes = ['large', 'medium', 'small', 'tiny'];
const sum = (arr, f) => arr.reduce((s, r) => s + f(r), 0);
console.log(`parks total ${parks.length} (plaza-named skipped: ${plazaCount}, dressed: ${rows.length})`);
console.log('class | parks | area km2 | withPaths | pathKm | entrances | parksNoPath');
const proj = { bench: 0, lamp: 0, bin: 0, vending: 0, restroom: 0, sculpture: 0, fountain: 0, bush: 0 };
for (const cls of classes) {
  const rs = rows.filter((r) => r.cls === cls);
  const withPaths = rs.filter((r) => r.pathLen > 0).length;
  console.log(`${cls} | ${rs.length} | ${(sum(rs, (r) => r.area) / 1e6).toFixed(2)} | ${withPaths} | ${(sum(rs, (r) => r.pathLen) / 1000).toFixed(1)} | ${sum(rs, (r) => r.entrances)} | ${rs.length - withPaths}`);
  for (const r of rs) {
    const R = KIT_RULES;
    proj.bench += Math.min(R.bench.cap[cls], (r.pathLen / R.bench.spacing) * R.bench.accept * R.bench.pairBonus);
    proj.lamp += Math.min(R.lamp.cap[cls], (r.pathLen / R.lamp.spacing) * R.lamp.accept);
    const b = Math.min(R.bench.cap[cls], (r.pathLen / R.bench.spacing) * R.bench.accept * R.bench.pairBonus);
    proj.bin += Math.min(R.bin.cap[cls], Math.min(r.entrances, 4) * R.bin.perEntrance + b * R.bin.perBench);
    proj.vending += r.area >= R.vending.minArea ? Math.min(R.vending.cap, Math.min(r.entrances, R.vending.entrancesUsed) * R.vending.perEntrance) : 0;
    proj.restroom += r.area >= R.restroom.minArea ? 1 : 0;
    proj.sculpture += r.area >= R.sculpture.minArea ? R.sculpture.share : 0;
    proj.fountain += r.area >= R.fountain.minArea ? R.fountain.share : 0;
    proj.bush += Math.min(R.bush.cap[cls], (r.pathLen / R.bush.spacing) * R.bush.accept);
  }
}
console.log('projected kit totals (expectation):', Object.fromEntries(Object.entries(proj).map(([k, v]) => [k, Math.round(v)])));
console.log('projected grand total:', Math.round(Object.values(proj).reduce((s, v) => s + v, 0)));
console.log('\nframe-site candidates:');
const pick = (label, r) => console.log(`${label}: ${r.name || '(unnamed)'} area=${Math.round(r.area)} pathLen=${Math.round(r.pathLen)} entrances=${r.entrances}`);
pick('daan', rows.find((r) => r.name.includes('大安森林')));
const mid = rows.filter((r) => r.area >= 8000 && r.area <= 30000 && r.name && r.pathLen > 200).sort((a, b) => b.pathLen - a.pathLen);
mid.slice(0, 6).forEach((r) => pick('mid?', r));
const small = rows.filter((r) => r.area >= 400 && r.area <= 4000 && r.name && r.pathLen > 60).sort((a, b) => b.pathLen - a.pathLen);
small.slice(0, 6).forEach((r) => pick('small?', r));
const river = rows.filter((r) => r.name.includes('河濱')).sort((a, b) => b.area - a.area);
river.slice(0, 4).forEach((r) => pick('riverside?', r));
