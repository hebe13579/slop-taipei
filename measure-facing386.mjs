// Aerial facing investigation — CORRECTED re-measurement.
// Same plan run and same roadbed segment grid as aerial-facing.mjs, but
// the measure is fixed in two ways (see RESUME.md):
//  1. UNFOLDED facing: mis = |fold90(rot - roadAng)| in [0,90] — the angle
//     between the lot's front facade line (its w direction, rot) and the
//     road line. The old measure additionally folded 90-m when m > 45,
//     which scored a lot whose facade is PERPENDICULAR to its road as
//     green (mis 0). No 90-m fold here.
//  2. FRONTAGE-road preference: instead of the merely-nearest segment,
//     pick the road the building fronts — among segments with gap <= 26,
//     prefer those parallel to the facade (|fold90(rot-ang)| <= 45),
//     then highest rank, then smallest gap. If no parallel candidate
//     exists, fall back to the nearest segment overall (frontage=false).
// Runs on current main only (no code changes to the repo).
import { writeFileSync } from 'node:fs';
import { TAIPEI_GEO } from './js/taipei-geodata.js';
import { planTaipeiBuildings } from './js/taipei-buildings.js';

const CLASS_RANK = { motorway: 6, trunk: 5, primary: 4, secondary: 3, tertiary: 2 };
const rankOf = (hw) => CLASS_RANK[hw] || 1;
const toTile = (lat, lon) => ({ x: (lon - 121.5650) * 100840, z: (25.0330 - lat) * 110990 });

const CELL = 96;
const key = (gx, gz) => gx * 100003 + gz;
const grid = new Map();
for (const bed of TAIPEI_GEO.roadbeds || []) {
  const pts = bed.pts || [];
  const half = Math.max((bed.width || 3) / 2, 0.75);
  const rank = rankOf(bed.highway);
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const s = { ax: pts[i], az: pts[i + 1], bx: pts[i + 2], bz: pts[i + 3], half, rank, name: bed.name || '' };
    const gx0 = Math.floor((Math.min(s.ax, s.bx) - 40) / CELL), gx1 = Math.floor((Math.max(s.ax, s.bx) + 40) / CELL);
    const gz0 = Math.floor((Math.min(s.az, s.bz) - 40) / CELL), gz1 = Math.floor((Math.max(s.az, s.bz) + 40) / CELL);
    for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
      const k = key(gx, gz);
      let b = grid.get(k); if (!b) grid.set(k, b = []);
      b.push(s);
    }
  }
}
const fold90 = (a) => { while (a > Math.PI / 2) a -= Math.PI; while (a <= -Math.PI / 2) a += Math.PI; return a; };
const deg = (r) => (r * 180) / Math.PI;
// OLD folded measure (aerial-facing.mjs verbatim)
const misOld = (rot, roadAng) => {
  let m = Math.abs(deg(fold90(rot - roadAng)));
  if (m > 45) m = 90 - m;
  return m;
};
// NEW unfolded measure: angle between facade line and road line, [0,90]
const misNew = (rot, roadAng) => Math.abs(deg(fold90(rot - roadAng)));

// OLD closest segment (nearest by centreline distance; scored iff gap <= 26)
function closestSeg(x, z) {
  const gx = Math.floor(x / CELL), gz = Math.floor(z / CELL);
  let best = null;
  const seen = new Set();
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const bucket = grid.get(key(gx + dx, gz + dz));
    if (!bucket) continue;
    for (const sg of bucket) {
      if (seen.has(sg)) continue; seen.add(sg);
      const ddx = sg.bx - sg.ax, ddz = sg.bz - sg.az, L2 = ddx * ddx + ddz * ddz || 1e-9;
      let t = ((x - sg.ax) * ddx + (z - sg.az) * ddz) / L2;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(sg.ax + t * ddx - x, sg.az + t * ddz - z);
      if (!best || d < best.d) best = { d, gap: d - sg.half, rank: sg.rank, ang: Math.atan2(ddz, ddx), name: sg.name };
    }
  }
  return best;
}
// Candidates with gap <= 26 (for the frontage pick)
function candidates(x, z) {
  const gx = Math.floor(x / CELL), gz = Math.floor(z / CELL);
  const seen = new Set();
  const out = [];
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const bucket = grid.get(key(gx + dx, gz + dz));
    if (!bucket) continue;
    for (const sg of bucket) {
      if (seen.has(sg)) continue; seen.add(sg);
      const ddx = sg.bx - sg.ax, ddz = sg.bz - sg.az, L2 = ddx * ddx + ddz * ddz || 1e-9;
      let t = ((x - sg.ax) * ddx + (z - sg.az) * ddz) / L2;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(sg.ax + t * ddx - x, sg.az + t * ddz - z);
      const gap = d - sg.half;
      if (gap <= 26) out.push({ d, gap, rank: sg.rank, ang: Math.atan2(ddz, ddx), name: sg.name });
    }
  }
  return out;
}
// Frontage pick: parallel-to-facade candidates first, then highest rank, then smallest gap.
// Falls back to nearest overall when no parallel candidate exists.
function pickFrontage(rot, cands) {
  const par = cands.filter((c) => Math.abs(deg(fold90(rot - c.ang))) <= 45);
  const pool = par.length ? par : cands;
  pool.sort((a, b) => (b.rank - a.rank) || (a.gap - b.gap));
  return { seg: pool[0], frontage: par.length > 0 };
}

console.log('planning (facing ON)...');
const t0 = Date.now();
const plan = planTaipeiBuildings(TAIPEI_GEO);
console.log(`ON took ${((Date.now() - t0) / 1000).toFixed(1)}s; lots=${plan.lots.length}`);
const s = plan.stats;
console.log(`facing turned: ${s.lotsFacingTurned} (full ${s.lotsFacingTurnedFull}, partial ${s.lotsFacingTurnedPartial}); held ${s.lotsFacingHeld}`);

const TAG = process.argv[2] || 'baseline';
const OUT = '/home/hatch/workspace/slop-taipei/facing386-evidence/';
const bucket = (m) => (m <= 5 ? '0-5' : m <= 15 ? '5-15' : m <= 45 ? '15-45' : '45-90');

function sampleDistrict(name, lat, lon, radius, slug) {
  const c = toTile(lat, lon);
  const lots = [];
  let n = 0, nearOld = 0, nearNew = 0;
  const bkOld = { '0-5': 0, '5-15': 0, '15-30': 0, '30-45': 0 };
  const bkSame = { '0-5': 0, '5-15': 0, '15-45': 0, '45-90': 0 }; // unfolded, old (nearest) road
  const bkNew = { '0-5': 0, '5-15': 0, '15-45': 0, '45-90': 0 };   // unfolded, frontage road
  let refChanged = 0, fallback = 0, oldGreenNewRed = 0, oldGreenNewYellow = 0, oldGreenStayGreen = 0;
  let foldSaved = 0; // lots where the fold alone moved the verdict (old green, unfolded red on the same road)
  const byStreet = new Map(); // new reference road name -> stats
  for (let i = 0; i < plan.lots.length; i++) {
    const lot = plan.lots[i];
    if (Math.hypot(lot.x - c.x, lot.z - c.z) > radius) continue;
    n++;
    const rot = lot.rot || 0;
    const cs = closestSeg(lot.x, lot.z);
    let mOld = null, mSame = null, mNew = null;
    let oldName = '', oldRank = 0, oldGap = null;
    let newName = '', newRank = 0, newGap = null, frontage = false, changed = false;
    if (cs && cs.gap <= 26) {
      nearOld++;
      mOld = misOld(rot, cs.ang);
      mSame = misNew(rot, cs.ang);
      oldName = cs.name; oldRank = cs.rank; oldGap = +cs.gap.toFixed(1);
      const bk = mOld <= 5 ? '0-5' : mOld <= 15 ? '5-15' : mOld <= 30 ? '15-30' : '30-45';
      bkOld[bk]++;
    }
    const cands = candidates(lot.x, lot.z);
    if (cands.length) {
      nearNew++;
      const { seg, frontage: fr } = pickFrontage(rot, cands);
      frontage = fr;
      if (!fr) fallback++;
      mNew = misNew(rot, seg.ang);
      newName = seg.name; newRank = seg.rank; newGap = +seg.gap.toFixed(1);
      changed = !(cs && cs.gap <= 26 && seg.name === cs.name && Math.abs(seg.ang - cs.ang) < 1e-9 && Math.abs(seg.gap - cs.gap) < 0.01);
      if (changed) refChanged++;
      bkNew[bucket(mNew)]++;
      const nm = newName || '(unnamed)';
      let st = byStreet.get(nm);
      if (!st) byStreet.set(nm, st = { n: 0, red: 0, misSum: 0, sx: 0, sz: 0, rank2n: 0, rank2red: 0 });
      st.n++; st.misSum += mNew; st.sx += lot.x; st.sz += lot.z;
      if (mNew > 15) st.red++;
      if (newRank >= 2) { st.rank2n++; if (mNew > 15) st.rank2red++; }
    }
    if (mSame !== null) bkSame[bucket(mSame)]++;
    if (mOld !== null && mOld <= 5) {
      if (mSame > 15) foldSaved++;
      if (mNew === null) { /* unscored under new measure */ }
      else if (mNew > 15) oldGreenNewRed++;
      else if (mNew > 5) oldGreenNewYellow++;
      else oldGreenStayGreen++;
    }
    lots.push({
      x: +lot.x.toFixed(1), z: +lot.z.toFixed(1), w: +lot.w.toFixed(1), d: +lot.d.toFixed(1),
      rot: +rot.toFixed(4),
      mis: mNew === null ? null : +mNew.toFixed(1),          // corrected measure (frontage road, unfolded)
      misOld: mOld === null ? null : +mOld.toFixed(1),       // old folded measure (nearest road)
      misSame: mSame === null ? null : +mSame.toFixed(1),    // unfolded, nearest road (fold effect isolated)
      name: newName, rank: newRank, gap: newGap, frontage,
      oldName, oldRank, oldGap, refChanged: changed,
    });
  }
  const pct = (a, b) => b ? ((100 * a) / b).toFixed(1) + '%' : 'n/a';
  console.log(`\n== ${name} (r=${radius}m): ${n} lots ==`);
  console.log(`scored (old nearest, gap<=26): ${nearOld}; scored (new frontage, gap<=26): ${nearNew}`);
  console.log(`OLD folded measure (nearest road):`, bkOld, `-> within 5°: ${pct(bkOld['0-5'], nearOld)}; >15° off: ${pct(bkOld['15-30'] + bkOld['30-45'], nearOld)}`);
  console.log(`UNFOLDED, same nearest road:`, bkSame, `-> within 5°: ${pct(bkSame['0-5'], nearOld)}; >15° off: ${pct(bkSame['15-45'] + bkSame['45-90'], nearOld)}`);
  console.log(`CORRECTED (unfolded + frontage road):`, bkNew, `-> within 5°: ${pct(bkNew['0-5'], nearNew)}; >15° off: ${pct(bkNew['15-45'] + bkNew['45-90'], nearNew)}`);
  console.log(`reference road changed: ${refChanged} of ${nearNew}; side-road fallback (no parallel candidate): ${fallback}`);
  console.log(`old-green lots: stayed green ${oldGreenStayGreen}, went yellow ${oldGreenNewYellow}, went red ${oldGreenNewRed} (of ${oldGreenStayGreen + oldGreenNewYellow + oldGreenNewRed} old-green scored under new measure)`);
  console.log(`fold alone rescued ${foldSaved} lots (old green, unfolded red on the SAME road)`);
  const streets = [...byStreet.entries()].map(([nm, st]) => ({
    name: nm, n: st.n, red: st.red, redShare: +(100 * st.red / st.n).toFixed(1),
    meanMis: +(st.misSum / st.n).toFixed(1), cx: +(st.sx / st.n).toFixed(0), cz: +(st.sz / st.n).toFixed(0),
    rank2n: st.rank2n, rank2red: st.rank2red,
  }));
  const byShare = streets.filter((st) => st.n >= 10).sort((a, b) => b.redShare - a.redShare || b.red - a.red);
  const byCount = [...streets].sort((a, b) => b.red - a.red);
  console.log(`worst streets (CORRECTED) by red share (n>=10):`);
  for (const st of byShare.slice(0, 20)) console.log('  ', JSON.stringify(st));
  console.log(`worst streets (CORRECTED) by red count:`);
  for (const st of byCount.slice(0, 15)) console.log('  ', JSON.stringify(st));
  writeFileSync(`${OUT}lots-${slug}-${TAG}.json`, JSON.stringify({ centre: c, radius, lots }));
  return {
    name, n, nearOld, nearNew, bkOld, bkSame, bkNew, refChanged, fallback,
    oldGreen: { stay: oldGreenStayGreen, yellow: oldGreenNewYellow, red: oldGreenNewRed }, foldSaved,
    streets: byShare.slice(0, 20), streetsByCount: byCount.slice(0, 15),
  };
}

const a = sampleDistrict('台北車站 Taipei Main Station', 25.0478, 121.5170, 800, 'station');
const b = sampleDistrict('北投 Beitou', 25.1319, 121.5005, 800, 'beitou');

// city-wide (all lots, same per-lot computation)
console.log('\n== CITY-WIDE ==');
{
  let n = 0, nearOld = 0, nearNew = 0;
  const bkOld = { '0-5': 0, '5-15': 0, '15-30': 0, '30-45': 0 };
  const bkSame = { '0-5': 0, '5-15': 0, '15-45': 0, '45-90': 0 };
  const bkNew = { '0-5': 0, '5-15': 0, '15-45': 0, '45-90': 0 };
  let refChanged = 0, fallback = 0, oldGreenNewRed = 0, oldGreenNewYellow = 0, oldGreenStayGreen = 0, foldSaved = 0;
  for (let i = 0; i < plan.lots.length; i++) {
    const lot = plan.lots[i];
    n++;
    const rot = lot.rot || 0;
    const cs = closestSeg(lot.x, lot.z);
    let mOld = null, mSame = null, mNew = null;
    if (cs && cs.gap <= 26) {
      nearOld++;
      mOld = misOld(rot, cs.ang);
      mSame = misNew(rot, cs.ang);
      const bk = mOld <= 5 ? '0-5' : mOld <= 15 ? '5-15' : mOld <= 30 ? '15-30' : '30-45';
      bkOld[bk]++;
      bkSame[bucket(mSame)]++;
    }
    const cands = candidates(lot.x, lot.z);
    if (cands.length) {
      nearNew++;
      const { seg, frontage: fr } = pickFrontage(rot, cands);
      if (!fr) fallback++;
      mNew = misNew(rot, seg.ang);
      bkNew[bucket(mNew)]++;
      const changed = !(cs && cs.gap <= 26 && seg.name === cs.name && Math.abs(seg.ang - cs.ang) < 1e-9 && Math.abs(seg.gap - cs.gap) < 0.01);
      if (changed) refChanged++;
    }
    if (mOld !== null && mOld <= 5) {
      if (mSame > 15) foldSaved++;
      if (mNew === null) { /* unscored under new */ }
      else if (mNew > 15) oldGreenNewRed++;
      else if (mNew > 5) oldGreenNewYellow++;
      else oldGreenStayGreen++;
    }
  }
  const pct = (x, y) => y ? ((100 * x) / y).toFixed(1) + '%' : 'n/a';
  console.log(`lots: ${n}; scored old: ${nearOld}; scored new: ${nearNew}`);
  console.log(`OLD folded:`, bkOld, `-> within 5°: ${pct(bkOld['0-5'], nearOld)}; >15° off: ${pct(bkOld['15-30'] + bkOld['30-45'], nearOld)}`);
  console.log(`UNFOLDED, same nearest road:`, bkSame, `-> within 5°: ${pct(bkSame['0-5'], nearOld)}; >15° off: ${pct(bkSame['15-45'] + bkSame['45-90'], nearOld)}`);
  console.log(`CORRECTED (unfolded + frontage):`, bkNew, `-> within 5°: ${pct(bkNew['0-5'], nearNew)}; >15° off: ${pct(bkNew['15-45'] + bkNew['45-90'], nearNew)}`);
  console.log(`reference road changed: ${refChanged} of ${nearNew}; side-road fallback: ${fallback}`);
  console.log(`old-green lots: stayed green ${oldGreenStayGreen}, went yellow ${oldGreenNewYellow}, went red ${oldGreenNewRed}`);
  console.log(`fold alone rescued ${foldSaved} lots`);
  var citywide = {
    name: 'city-wide', n, nearOld, nearNew, bkOld, bkSame, bkNew, refChanged, fallback,
    oldGreen: { stay: oldGreenStayGreen, yellow: oldGreenNewYellow, red: oldGreenNewRed }, foldSaved,
  };
}
writeFileSync(`${OUT}summary-${TAG}.json`, JSON.stringify({ station: a, beitou: b, citywide }, null, 1));
// compact plan dump for later diffing (x,z,w,d,rot only)
writeFileSync(`${OUT}plan-${TAG}.json`, JSON.stringify(plan.lots.map((l) => ({ x: +l.x.toFixed(1), z: +l.z.toFixed(1), w: +l.w.toFixed(1), d: +l.d.toFixed(1), rot: +(l.rot || 0).toFixed(4) }))));
writeFileSync(`${OUT}stats-${TAG}.json`, JSON.stringify(plan.stats, null, 1));
console.log(`dumped lots-*-${TAG}.json + summary-${TAG}.json + plan-${TAG}.json + stats-${TAG}.json.`);

