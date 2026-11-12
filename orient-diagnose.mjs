// Diagnose: blocks where the NEW blockOrientation returns 0 but the
// prototype modeTheta (±15°) returns non-zero. Prints the direction
// histogram + primary/mode numbers for the first few.
import { TAIPEI_GEO } from './js/taipei-geodata.js';
import { buildFrontageIndex, blockOrientation } from './js/taipei-buildings.js';

const FRONTAGE_REACH_M = 18;
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
const deg = (r) => (r * 180) / Math.PI;

const index = buildFrontageIndex(TAIPEI_GEO.roadbeds);
let disagree = 0;
const thetas = [];
for (const b of TAIPEI_GEO.blocks || []) {
  if (!(b.area >= 150)) continue;
  const nw = blockOrientation(index, b);
  if (nw !== 0) continue;
  const segs = blockSegs(index, b);
  // replicate prototype modeTheta ±15°
  let wsum = 0;
  for (const s of segs) wsum += s.w;
  if (!wsum) continue;
  const bins = new Array(18).fill(0);
  for (const s of segs) bins[Math.floor(mod90(s.phi) / (Math.PI / 180) / 5) % 18] += s.w;
  let peak = 0;
  for (let i = 1; i < 18; i++) if (bins[i] > bins[peak]) peak = i;
  const peakAng = (peak + 0.5) * 5 * (Math.PI / 180);
  const win = (15 * Math.PI) / 180;
  let sx = 0, sy = 0, winW = 0;
  for (const s of segs) {
    let d = Math.abs(mod90(s.phi) - mod90(peakAng));
    d = Math.min(d, Math.PI / 2 - d);
    if (d > win) continue;
    sx += s.w * s.c4; sy += s.w * s.s4; winW += s.w;
  }
  const coh = winW / wsum;
  if (coh < ORIENT_MIN_COHERENCE) continue;
  let theta = Math.atan2(sy, sx) / 4;
  if (theta < 0) theta += Math.PI / 2;
  const dev = Math.min(theta, Math.PI / 2 - theta);
  if (dev <= (3 * Math.PI) / 180) continue;
  disagree++;
  thetas.push(deg(dev));
  if (disagree <= 5) {
    // primary resultant for this block
    let psx = 0, psy = 0;
    for (const s of segs) { psx += s.w * s.c4; psy += s.w * s.s4; }
    const pcoh = Math.hypot(psx, psy) / wsum;
    const ptheta = Math.atan2(psy, psx) / 4;
    const pdev = Math.min(ptheta < 0 ? ptheta + Math.PI / 2 : ptheta, Math.PI / 2 - (ptheta < 0 ? ptheta + Math.PI / 2 : ptheta));
    const hist = bins.map((w, i) => (w > 0 ? `${i * 5}°:${w.toFixed(0)}` : null)).filter(Boolean).join(' ');
    console.log(`block (${b.cx.toFixed(0)},${b.cz.toFixed(0)}): primary coh ${pcoh.toFixed(2)} thetaDev ${deg(pdev).toFixed(1)} | mode peakBin ${peak} (${((peak + 0.5) * 5).toFixed(1)}°) coh ${coh.toFixed(2)} thetaDev ${deg(dev).toFixed(1)} | hist ${hist}`);
  }
}
thetas.sort((a,b)=>a-b);
console.log('disagreements:', disagree, 'mode theta deg: min', thetas[0].toFixed(1), 'median', thetas[Math.floor(thetas.length/2)].toFixed(1), 'p90', thetas[Math.floor(thetas.length*0.9)].toFixed(1), 'max', thetas[thetas.length-1].toFixed(1));
