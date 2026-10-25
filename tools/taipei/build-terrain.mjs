// tools/taipei/build-terrain.mjs — terrain skin bake (issue #129).
//
// Bakes the visual-only DEM terrain skin's data asset,
// tools/taipei/data/terrain-grids.json, from SRTM GL1 elevation data.
// One heightfield grid per terrain-enabled box in tile-boxes.json
// (box.terrain.grid = the grid's lon/lat extent). Grid postings sit on
// the global 2-arc-second SRTM lattice (~56 m), so two grids that
// share an edge sample identical vertices along it and the meshes the
// boot builds from them (js/taipei-terrain.js) meet without a seam.
//
// Per vertex the asset stores:
//   h    — DEM height in whole metres (bilinear off the SRTM grid)
//   mask — road-distance mask: 0 within 35 m of a roadbed centreline,
//          1 beyond 120 m (smoothstep between). The mask is what keeps
//          the skin visual-only: every road keeps its flat bench and
//          the mesh never rises where the player can reach. Roadbeds
//          come from the generation map (tools/taipei/data/
//          generation-map.json), the same centrelines the boot draws.
// The runtime applies gain (smoothstep 15 m -> 45 m, so the basin
// floor stays at zero), the mask, the per-edge fades recorded here
// (outer edges fade out over 4 postings; shared edges and the north
// horizon edge do not) and the -0.3 m sink — see js/taipei-terrain.js.
//
// DEM source: SRTM GL1 (1 arc-second) tile N25E121, the public AWS
// Terrain Tiles skadi mirror — the same source the issue #117 study
// fetched and validated (terrarium cross-check agreed <= 1 m). The
// tile is a static release; its gzip md5 is pinned below as the
// provenance check (a changed DEM must fail the bake, not silently
// change the shipped grid — that pin is the data's date/identity, so
// no wall-clock fetch date is written into the asset). The downloaded
// tile is cached under tools/taipei/data/dem/ (not committed).
// Taiwan's official 20 m DEM (data.gov.tw #35430, OGDL v1) is the
// better source on paper and drops into the same grid contract when
// it can be fetched past the TGOS host block (issue #117 report).
//
// usage: node tools/taipei/build-terrain.mjs [--dem <N25E121.hgt.gz>]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.TAIPEI_DATA || path.join(HERE, 'data');
const OUT = path.join(DATA, 'terrain-grids.json');
const DEM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/skadi/N25/N25E121.hgt.gz';
const DEM_MD5 = '668b240a03ff4bbd6a4731567d8b15ee'; // verified twice in the #117 study (cache + fresh fetch)
const DEM_CACHE = path.join(DATA, 'dem', 'N25E121.hgt.gz');

const TILE_CFG = JSON.parse(fs.readFileSync(path.join(HERE, 'tile-boxes.json'), 'utf8'));

// ---- frame (copied tangent-plane math from build-taipei-geodata.mjs) ----
const LAT0 = 25.0330, LON0 = 121.5650;
const A = 6378137.0, E2 = 6.69437999014e-3;
const PHI0 = (LAT0 * Math.PI) / 180, SIN0 = Math.sin(PHI0);
const NRAD = A / Math.sqrt(1 - E2 * SIN0 * SIN0);
const MRAD = (A * (1 - E2)) / Math.pow(1 - E2 * SIN0 * SIN0, 1.5);
const KX = (Math.PI / 180) * NRAD * Math.cos(PHI0); // metres per degree lon
const KY = (Math.PI / 180) * MRAD;                  // metres per degree lat
const toWorld = (lon, lat) => [(lon - LON0) * KX, -(lat - LAT0) * KY]; // [x, z]

const STEP_DEG = 2 / 3600; // 2 arc-seconds, the study's ~56 m postings
const MASK_NEAR = 35, MASK_FAR = 120; // metres from a roadbed centreline
const sstep = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---- DEM ----
async function loadDem() {
  const argDem = process.argv.includes('--dem') ? process.argv[process.argv.indexOf('--dem') + 1] : null;
  let gz;
  if (argDem) {
    gz = fs.readFileSync(argDem);
    console.log(`[taipei-terrain] DEM from --dem ${argDem}`);
  } else if (fs.existsSync(DEM_CACHE)) {
    gz = fs.readFileSync(DEM_CACHE);
    console.log(`[taipei-terrain] DEM from cache ${path.relative(process.cwd(), DEM_CACHE)}`);
  } else {
    console.log(`[taipei-terrain] fetching DEM ${DEM_URL}`);
    const res = await fetch(DEM_URL);
    if (!res.ok) throw new Error(`DEM fetch failed: HTTP ${res.status}`);
    gz = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(path.dirname(DEM_CACHE), { recursive: true });
    fs.writeFileSync(DEM_CACHE, gz);
  }
  const md5 = crypto.createHash('md5').update(gz).digest('hex');
  if (md5 !== DEM_MD5) throw new Error(`DEM md5 mismatch: got ${md5}, expected ${DEM_MD5} — the source tile changed; re-validate before updating the pin`);
  const raw = zlib.gunzipSync(gz);
  const N = 3601; // SRTM GL1: 3601 x 3601 postings per 1-degree tile
  if (raw.length !== N * N * 2) throw new Error(`DEM size mismatch: ${raw.length} bytes`);
  let voids = 0;
  const elev = (lat, lon) => { // bilinear, lat/lon within the N25E121 tile
    const fx = (lon - 121.0) * (N - 1), fy = (26.0 - lat) * (N - 1);
    const x0 = Math.min(N - 2, Math.max(0, Math.floor(fx))), y0 = Math.min(N - 2, Math.max(0, Math.floor(fy)));
    const dx = fx - x0, dy = fy - y0;
    const v = (xx, yy) => { const h = raw.readInt16BE((yy * N + xx) * 2); if (h === -32768) { voids++; return 0; } return h; };
    return v(x0, y0) * (1 - dx) * (1 - dy) + v(x0 + 1, y0) * dx * (1 - dy)
         + v(x0, y0 + 1) * (1 - dx) * dy + v(x0 + 1, y0 + 1) * dx * dy;
  };
  return { elev, voids: () => voids };
}

// ---- roadbed segment index (for the distance mask) ----
function loadSegments() {
  const gm = JSON.parse(fs.readFileSync(path.join(DATA, 'generation-map.json'), 'utf8'));
  const segs = [];
  for (const b of gm.roadbeds) {
    const p = b.centreline;
    for (let i = 0; i + 3 < p.length; i += 2) segs.push([p[i], p[i + 1], p[i + 2], p[i + 3]]);
  }
  const CELL = 128;
  const buckets = new Map();
  const key = (cx, cz) => `${cx},${cz}`;
  segs.forEach((s, idx) => {
    const x0 = Math.floor(Math.min(s[0], s[2]) / CELL), x1 = Math.floor(Math.max(s[0], s[2]) / CELL);
    const z0 = Math.floor(Math.min(s[1], s[3]) / CELL), z1 = Math.floor(Math.max(s[1], s[3]) / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const k = key(cx, cz); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(idx);
    }
  });
  const segDist = (px, pz, ax, az, bx, bz) => {
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    const t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2)) : 0;
    return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
  };
  const nearest = (x, z) => {
    // Any segment within MASK_FAR of the point has its bbox intersecting
    // the square below, hence sits in one of the buckets it overlaps.
    const x0 = Math.floor((x - MASK_FAR) / CELL), x1 = Math.floor((x + MASK_FAR) / CELL);
    const z0 = Math.floor((z - MASK_FAR) / CELL), z1 = Math.floor((z + MASK_FAR) / CELL);
    let best = Infinity;
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const list = buckets.get(key(cx, cz)); if (!list) continue;
      for (const idx of list) { const s = segs[idx]; const d = segDist(x, z, s[0], s[1], s[2], s[3]); if (d < best) best = d; }
    }
    return best;
  };
  return { count: segs.length, nearest };
}

// ---- bake ----
const enabled = TILE_CFG.boxes.filter((b) => b.terrain?.grid);
if (!enabled.length) { console.error('[taipei-terrain] no terrain-enabled boxes in tile-boxes.json'); process.exit(1); }
for (const b of enabled) {
  const g = b.terrain.grid;
  for (const k of ['w', 'e', 's', 'n']) {
    const steps = g[k] / STEP_DEG;
    if (Math.abs(steps - Math.round(steps)) > 1e-6) throw new Error(`box ${b.name}: grid ${k}=${g[k]} is not on the 2-arc-second lattice`);
  }
  if (!(g.e > g.w && g.n > g.s)) throw new Error(`box ${b.name}: degenerate terrain grid`);
}
// A grid edge is shared when another enabled grid has the coincident
// edge (same line, overlapping span). Shared edges and the north edge
// never fade; every other edge fades out over 4 postings so the skin
// tucks under the flat ground instead of ending on a cliff.
function edgeFades(g, all) {
  const shareW = all.some((o) => o !== g && Math.abs(o.e - g.w) < 1e-9 && Math.max(g.s, o.s) < Math.min(g.n, o.n));
  const shareE = all.some((o) => o !== g && Math.abs(o.w - g.e) < 1e-9 && Math.max(g.s, o.s) < Math.min(g.n, o.n));
  const shareS = all.some((o) => o !== g && Math.abs(o.n - g.s) < 1e-9 && Math.max(g.w, o.w) < Math.min(g.e, o.e));
  return { w: !shareW, e: !shareE, s: !shareS, n: false };
}

const dem = await loadDem();
const road = loadSegments();
console.log(`[taipei-terrain] roadbed segments indexed: ${road.count}`);

const grids = [];
for (const b of enabled) {
  const g = b.terrain.grid;
  const cols = Math.round((g.e - g.w) / STEP_DEG) + 1;
  const rows = Math.round((g.n - g.s) / STEP_DEG) + 1;
  const h = new Array(cols * rows), mask = new Array(cols * rows);
  let maxH = 0, fullMask = 0;
  for (let r = 0; r < rows; r++) {
    const lat = g.n - r * STEP_DEG; // row 0 = north edge
    for (let c = 0; c < cols; c++) {
      const lon = g.w + c * STEP_DEG;
      const d = Math.round(dem.elev(lat, lon));
      const [x, z] = toWorld(lon, lat);
      const m = sstep(MASK_NEAR, MASK_FAR, road.nearest(x, z));
      const i = r * cols + c;
      h[i] = d; mask[i] = Math.round(m * 1000) / 1000;
      if (d > maxH) maxH = d;
      if (m === 1) fullMask++;
    }
  }
  const [x0, z0] = toWorld(g.w, g.n); // NW corner
  const [x1, z1] = toWorld(g.e, g.s); // SE corner
  const round3 = (v) => Math.round(v * 1000) / 1000;
  grids.push({
    box: b.name, w: g.w, e: g.e, s: g.s, n: g.n, cols, rows,
    x0: round3(x0), z0: round3(z0), x1: round3(x1), z1: round3(z1),
    fade: edgeFades(g, enabled.map((o) => o.terrain.grid)), h, mask,
  });
  console.log(`[taipei-terrain] ${b.name}: ${cols}x${rows} postings (${((cols - 1) * (rows - 1) * 2).toLocaleString('en-US')} tris), DEM max ${maxH} m, mask=1 at ${(100 * fullMask / (cols * rows)).toFixed(1)}% of postings`);
}

const asset = {
  source: 'SRTM GL1 (1 arc-second) tile N25E121 via AWS Terrain Tiles (skadi); public NASA/USGS SRTM distribution',
  demUrl: DEM_URL, demMd5: DEM_MD5,
  stepDeg: STEP_DEG, maskNearM: MASK_NEAR, maskFarM: MASK_FAR,
  grids,
};
fs.writeFileSync(OUT, JSON.stringify(asset) + '\n');
console.log(`[taipei-terrain] wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB); DEM voids treated as 0: ${dem.voids()}`);
