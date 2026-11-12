// Prototype v2 — FALLBACK design for blockOrientation (issue #386, part 2).
// Keep the current 4θ-resultant estimator as primary; only when it
// returns 0, try the mode estimator (peak 5° bin of directions mod 90°,
// windowed 4θ resultant). Sweep window widths 10/15/20 and report, for
// the blocks the primary leaves flat: how many newly turn, their
// coherence histogram, and the Linsen/Xinyi pin districts.
import { TAIPEI_GEO } from './js/taipei-geodata.js';
import { buildFrontageIndex, blockOrientation, latLonToTile } from './js/taipei-buildings.js';

const FRONTAGE_REACH_M = 18;
const ORIENT_EPS_RAD = (3 * Math.PI) / 180;
const ORIENT_MIN_COHERENCE = 0.5;
const FRONTAGE_CELL = 96;

function clippedSegLen(ax, az, bx, bz, minX, maxX, minZ, maxZ) {
  const dx = bx - ax, dz = bz - az;
  let t0 = 0, t1 = 1;
  const p = [-dx, dx, -dz, dz], q = [ax - minX, maxX - ax, az - minZ, maxZ - az];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return 0; continue; }
    const r = q[i] / p[i];
    if (p[i] < 0) { if (r > t1) return 0; if (r > t0) t0 = r; }
    else { if (r < t0) return 0; if (r < t1) t1 = r; }
  }
  return Math.max(0, t1 - t0) * Math.hypot(dx, dz);
}
function blockSegs(index, block) {
  const minX = block.bbox.minX - FRONTAGE_REACH_M, maxX = block.bbox.maxX + FRONTAGE_REACH_M;
  const minZ = block.bbox.minZ - FRONTAGE_REACH_M, maxZ = block.bbox.maxZ + FRONTAGE_REACH_M;
  const seen = new Set();
  const segs = [];
  const gx0 = Math.floor(minX / FRONTAGE_CELL), gx1 = Math.floor(maxX / FRONTAGE_CELL);
  const gz0 = Math.floor(minZ / FRONTAGE_CELL), gz1 = Math.floor(maxZ / FRONTAGE_CELL);
  for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
    const bucket = index.grid.get(index.key(gx, gz));
    if (!bucket) continue;
    for (const s of bucket) {
      if (seen.has(s)) continue;
      seen.add(s);
      const w = clippedSegLen(s.ax, s.az, s.bx, s.bz, minX, maxX, minZ, maxZ);
      if (w <= 0) continue;
      segs.push({ w, c4: s.c4, s4: s.s4, phi: Math.atan2(s.bz - s.az, s.bx - s.ax) });
    }
  }
  return segs;
}
const mod90 = (a) => { let m = a % (Math.PI / 2); if (m < 0) m += Math.PI / 2; return m; };
const angDiff90 = (a, b) => { let d = Math.abs(mod90(a) - mod90(b)); return Math.min(d, Math.PI / 2 - d); };

// Precompute per-block segments once (blocks >= 150 m2, the planner's cut).
const index = buildFrontageIndex(TAIPEI_GEO.roadbeds);
const deg = (r) => (r * 180) / Math.PI;
const devDeg = (t) => Math.min(deg(t), 90 - deg(t));
const blocks = (TAIPEI_GEO.blocks || []).filter((b) => b.area >= 150);
const prepared = blocks.map((b) => ({ b, old: blockOrientation(index, b), segs: blockSegs(index, b) }));

function modeTheta(segs, winDeg, binDeg = 5) {
  if (!segs.length) return { theta: 0, coh: 0 };
  let wsum = 0;
  for (const s of segs) wsum += s.w;
  const nBin = Math.round(90 / binDeg);
  const bins = new Array(nBin).fill(0);
  for (const s of segs) bins[Math.floor(mod90(s.phi) / (Math.PI / 180) / binDeg) % nBin] += s.w;
  let peak = 0;
  for (let i = 1; i < nBin; i++) if (bins[i] > bins[peak]) peak = i;
  const peakAng = (peak + 0.5) * binDeg * (Math.PI / 180);
  const win = (winDeg * Math.PI) / 180;
  let sx = 0, sy = 0, winW = 0;
  for (const s of segs) {
    if (angDiff90(s.phi, peakAng) > win) continue;
    sx += s.w * s.c4; sy += s.w * s.s4; winW += s.w;
  }
  const coh = winW / wsum;
  if (coh < ORIENT_MIN_COHERENCE) return { theta: 0, coh };
  let theta = Math.atan2(sy, sx) / 4;
  if (theta < 0) theta += Math.PI / 2;
  const dev = Math.min(theta, Math.PI / 2 - theta);
  if (dev <= ORIENT_EPS_RAD) return { theta: 0, coh };
  return { theta, coh };
}

for (const winDeg of [10, 15, 20]) {
  let flat = 0, newly = 0;
  const hist = {};
  for (const { old, segs } of prepared) {
    if (old !== 0) continue;
    flat++;
    const { theta, coh } = modeTheta(segs, winDeg);
    if (theta !== 0) {
      newly++;
      const k = coh < 0.55 ? '0.50-0.55' : coh < 0.65 ? '0.55-0.65' : coh < 0.8 ? '0.65-0.80' : '0.80+';
      hist[k] = (hist[k] || 0) + 1;
    }
  }
  console.log(`window ±${winDeg}°: primary-flat blocks ${flat}, fallback newly turns ${newly} (${(100 * newly / flat).toFixed(1)}%), by coh:`, JSON.stringify(hist));
}

// pin districts under the fallback (window 15)
function blocksNear(lat, lon, radius, minArea) {
  const [x, z] = latLonToTile(lat, lon, TAIPEI_GEO.frame.originLatLon);
  return TAIPEI_GEO.blocks.filter((b) => b.area >= minArea && Math.hypot(b.cx - x, b.cz - z) < radius);
}
const withFallback = (b, winDeg) => {
  const o = blockOrientation(index, b);
  if (o !== 0) return o;
  return modeTheta(blockSegs(index, b), winDeg).theta;
};
const linsen = blocksNear(25.0495, 121.5275, 260, 800);
const linOld = linsen.filter((b) => { const d = devDeg(blockOrientation(index, b)); return d >= 8 && d <= 22; }).length;
const linFb = linsen.filter((b) => { const d = devDeg(withFallback(b, 15)); return d >= 8 && d <= 22; }).length;
console.log(`Linsen fallback±15: ${linOld}/${linsen.length} old in 8-22deg; ${linFb}/${linsen.length} with fallback`);
const xinyi = blocksNear(25.036, 121.569, 260, 800);
const xinFb = xinyi.filter((b) => withFallback(b, 15) === 0).length;
console.log(`Xinyi core fallback±15: ${xinFb}/${xinyi.length} exactly 0`);
for (const [name, lat, lon] of [['station', 25.0478, 121.5170], ['beitou', 25.1319, 121.5005]]) {
  const bs = blocksNear(lat, lon, 800, 150);
  let nt = 0;
  for (const b of bs) { const o = blockOrientation(index, b); if (o === 0 && withFallback(b, 15) !== 0) nt++; }
  console.log(`${name}: ${bs.length} blocks, fallback±15 newly turns ${nt}`);
}
