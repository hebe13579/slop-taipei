// Prototype the dominant-cluster blockOrientation (issue #386, part 2).
// Compares the CURRENT 4θ-resultant estimator against a MODE-SEEKING
// estimator over every geodata block: bin segment directions (mod 90°)
// into 5° bins weighted by clipped length, take the peak bin, recompute
// the 4θ resultant over segments within ±10° (mod 90°) of the peak, and
// require window weight / total weight ≥ ORIENT_MIN_COHERENCE.
// Reports: how many blocks change, the coherence distribution of the
// changed ones, and the Linsen/Xinyi pin districts.
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

// Collect clipped segments for a block (same bbox growth as blockOrientation).
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

function blockOrientationMode(index, block, winDeg = 10, binDeg = 5) {
  const segs = blockSegs(index, block);
  if (!segs.length) return { theta: 0, coh: 0, wsum: 0, winW: 0 };
  let wsum = 0;
  for (const s of segs) wsum += s.w;
  // bin directions mod 90° (binDeg bins)
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
  if (coh < ORIENT_MIN_COHERENCE) return { theta: 0, coh, wsum, winW };
  let theta = Math.atan2(sy, sx) / 4;
  if (theta < 0) theta += Math.PI / 2;
  const dev = Math.min(theta, Math.PI / 2 - theta);
  if (dev <= ORIENT_EPS_RAD) return { theta: 0, coh, wsum, winW };
  return { theta, coh, wsum, winW };
}

const index = buildFrontageIndex(TAIPEI_GEO.roadbeds);
const blocks = TAIPEI_GEO.blocks || [];
const deg = (r) => (r * 180) / Math.PI;
const devDeg = (t) => Math.min(deg(t), 90 - deg(t));

let n = 0, changed = 0, newlyTurned = 0, newlyFlat = 0, cohHist = {};
const changedSamples = [];
for (const b of blocks) {
  if (!(b.area >= 150)) continue;
  n++;
  const oldT = blockOrientation(index, b);
  const { theta: newT, coh } = blockOrientationMode(index, b);
  const d = Math.abs(devDeg(oldT) - devDeg(newT));
  const cohKey = coh === 0 ? 'none' : coh < 0.35 ? '<0.35' : coh < 0.5 ? '0.35-0.5' : coh < 0.65 ? '0.5-0.65' : coh < 0.85 ? '0.65-0.85' : '0.85+';
  if (d > 1) {
    changed++;
    cohHist[cohKey] = (cohHist[cohKey] || 0) + 1;
    if (oldT === 0 && newT !== 0) newlyTurned++;
    if (oldT !== 0 && newT === 0) newlyFlat++;
    if (changedSamples.length < 25) changedSamples.push({ cx: +b.cx.toFixed(0), cz: +b.cz.toFixed(0), old: +devDeg(oldT).toFixed(1), nw: +devDeg(newT).toFixed(1), coh: +coh.toFixed(2) });
  }
}
console.log(`blocks>=150m2: ${n}; changed>1deg: ${changed} (newly turned ${newlyTurned}, newly flat ${newlyFlat})`);
console.log('changed-by-coherence:', cohHist);
console.log('changed samples (cx,cz,oldDev,newDev,coh):', JSON.stringify(changedSamples));

// pin districts
function blocksNear(lat, lon, radius, minArea) {
  const [x, z] = latLonToTile(lat, lon, TAIPEI_GEO.frame.originLatLon);
  return TAIPEI_GEO.blocks.filter((b) => b.area >= minArea && Math.hypot(b.cx - x, b.cz - z) < radius);
}
const linsen = blocksNear(25.0495, 121.5275, 260, 800);
const linOld = linsen.filter((b) => { const d = devDeg(blockOrientation(index, b)); return d >= 8 && d <= 22; }).length;
const linNew = linsen.filter((b) => { const d = devDeg(blockOrientationMode(index, b).theta); return d >= 8 && d <= 22; }).length;
console.log(`Linsen: ${linOld}/${linsen.length} old in 8-22deg; ${linNew}/${linsen.length} new`);
const xinyi = blocksNear(25.036, 121.569, 260, 800);
const xinOld = xinyi.filter((b) => blockOrientation(index, b) === 0).length;
const xinNew = xinyi.filter((b) => blockOrientationMode(index, b).theta === 0).length;
console.log(`Xinyi core: ${xinOld}/${xinyi.length} old exactly 0; ${xinNew}/${xinyi.length} new exactly 0`);
// Beitou + station change counts
const dist = (lat, lon, r) => blocksNear(lat, lon, r, 150);
for (const [name, lat, lon] of [['station', 25.0478, 121.5170], ['beitou', 25.1319, 121.5005]]) {
  const bs = dist(lat, lon, 800);
  let ch = 0, nt = 0;
  for (const b of bs) {
    const o = blockOrientation(index, b), nw = blockOrientationMode(index, b).theta;
    if (Math.abs(devDeg(o) - devDeg(nw)) > 1) { ch++; if (o === 0 && nw !== 0) nt++; }
  }
  console.log(`${name}: ${bs.length} blocks, ${ch} changed, ${nt} newly turned`);
}
