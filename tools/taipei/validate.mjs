// tools/taipei/validate.mjs — M0 spike checks on the generated js/taipei-geodata.js.
// usage: node tools/taipei/validate.mjs
import { TAIPEI_GEO as G } from '../../js/taipei-geodata.js';

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};
const bb = G.frame.bbox;
const MARGIN = 1; // builder clips to the frame bbox; allow rounding slack

// 1. All coordinates inside the frame bbox (the tile is offset from the origin:
//    it spans x -3027.7..1513.8, z -2990.9..1440.1, so max |coord| is ~3028 m,
//    not ~2600 m as first guessed — the origin at Taipei 101 is not tile-centred).
let maxAbs = 0, outOfBounds = 0;
const scan = (flatArr) => {
  for (let i = 0; i + 1 < flatArr.length; i += 2) {
    const x = flatArr[i], z = flatArr[i + 1];
    maxAbs = Math.max(maxAbs, Math.abs(x), Math.abs(z));
    if (x < bb.minX - MARGIN || x > bb.maxX + MARGIN || z < bb.minZ - MARGIN || z > bb.maxZ + MARGIN) outOfBounds++;
  }
};
G.roads.forEach((r) => scan(r.pts));
G.water.forEach((w) => scan(w.ring));
G.parks.forEach((p) => scan(p.ring));
G.blocks.forEach((b) => scan([b.bbox.minX, b.bbox.minZ, b.bbox.maxX, b.bbox.maxZ]));
check(outOfBounds === 0, 'all coords within frame bbox', `max |coord| ${maxAbs.toFixed(1)} m, bbox x[${bb.minX}, ${bb.maxX}] z[${bb.minZ}, ${bb.maxZ}]`);

// 2. Taipei 101 landmark exists near origin
const t101 = G.landmarks['Taipei 101'];
check(!!t101, "landmarks['Taipei 101'] exists");
if (t101) {
  const d = Math.hypot(t101.x, t101.z);
  check(d < 300, 'Taipei 101 within 300 m of origin', `at (${t101.x}, ${t101.z}), ${d.toFixed(0)} m from origin`);
}

// 3. A water polygon in the northern part of the tile (Keelung River, z < -1500)
const ringCentroidZ = (ring) => { let s = 0; for (let i = 1; i < ring.length; i += 2) s += ring[i]; return s / (ring.length / 2); };
const northWater = G.water.filter((w) => ringCentroidZ(w.ring) < -1500);
check(northWater.length > 0, 'water polygon(s) in northern tile (Keelung River)', `${northWater.length} found, names: ${[...new Set(northWater.map((w) => w.name || '(unnamed)'))].join(', ')}`);

// 4. Road length > 100 km
let totalKm = 0, carriageKm = 0;
const NON_CARRIAGE = new Set(['footway', 'path', 'steps', 'pedestrian', 'cycleway', 'corridor', 'elevator', 'crossing', 'platform']);
for (const r of G.roads) {
  let len = 0;
  for (let i = 2; i < r.pts.length; i += 2) len += Math.hypot(r.pts[i] - r.pts[i - 2], r.pts[i + 1] - r.pts[i - 1]);
  totalKm += len / 1000;
  if (!NON_CARRIAGE.has(r.highway)) carriageKm += len / 1000;
}
check(totalKm > 100, 'total road length > 100 km', `${totalKm.toFixed(1)} km all highway ways, ${carriageKm.toFixed(1)} km excluding footway/path/steps/etc.`);

// 5. Blocks > 100
check(G.blocks.length > 100, 'blocks count > 100', `${G.blocks.length} blocks`);

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
