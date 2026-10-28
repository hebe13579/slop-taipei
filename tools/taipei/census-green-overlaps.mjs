#!/usr/bin/env node
// tools/taipei/census-green-overlaps.mjs — issue #206 census.
//
// Every pair of overlapping GREEN-FAMILY ground surfaces in a
// lon/lat box (default: the Guandu box, 121.464-121.510 x
// 25.113-25.150), with overlap areas and the Y gap of each pair.
// The green family is the flat ground stack the boot draws over
// the Guandu plain: the #141 green tint (one mesh per tone, all
// at GREEN_TINT_Y), the #137 Tamsui riverside band (0.025), water
// (0.03), park lawns (0.04) and plaza paving (0.041) — plus the
// DEM terrain skin, sampled per posting. Near-coplanar overlaps
// in this family are the z-fight suspects behind the Guandu
// flicker: the census names them before anyone fixes them.
//
// Two tables: the SOURCE sets (the raw geodata polygons) and the
// AS-DRAWN sets (after js/taipei-green.js consumeGreenFamily-
// Overlaps, the #206 fix the boot applies). The fix is proven
// here: as-drawn cross overlaps at zero while the family
// FOOTPRINT (union of all sets) is conserved — consumption only
// ever redistributes which surface owns an area, it never
// creates or destroys covered ground.
//
// Measurement note: overlap/union areas here are analytic
// (subtractPolys differences). On the SOURCE sets (simple
// polygons) that is exact. On the AS-DRAWN sets — which contain
// the subtraction's own triangulated pieces — the raw primitive
// mis-measures its own output (drawn footprint reads ~0.7%
// low; one farmland tone pair overstates ~9k m²). The pixel-
// exact raster in ~/workspace/slop-taipei/guandu206-evidence/
// is authoritative for the drawn state: footprint conserved to
// -0.017%, eroded (>=2 m deep) cross-tone residue 8 m² total,
// tint x water 3.0k m² in the wetland channels. The cross-set
// pairs below agree with the raster.
//
// Overlap areas are EXACT polygon differences (subtractPolys,
// the #171 primitive): overlap(A,B) = area(A) - area(A - B),
// summed per ring against the union of the other set. Self
// overlap of a set = sum of ring areas - union area.
//
// Usage: node tools/taipei/census-green-overlaps.mjs [--json out.json]
//        [--box lon0,lat0,lon1,lat1]
import fs from 'node:fs';
import { TAIPEI_GEO } from '../../js/taipei-geodata.js';
import { buildGreenTintLayers, consumeGreenFamilyOverlaps, GREEN_TINT_Y } from '../../js/taipei-green.js';
import { subtractPolys } from '../../js/taipei-junctions.js';
import { pointInPoly } from '../../js/taipei-painted.js';
import { isPlazaPark } from '../../js/taipei-surfaces.js';
import { terrainEdgeFade, TERRAIN_GAIN_LO, TERRAIN_GAIN_HI, TERRAIN_SINK } from '../../js/taipei-terrain.js';

// ---- frame (same tangent-plane math as build-taipei-geodata.mjs) ----
const LAT0 = 25.0330, LON0 = 121.5650;
const A = 6378137.0, E2 = 6.69437999014e-3;
const PHI0 = (LAT0 * Math.PI) / 180, SIN0 = Math.sin(PHI0);
const NRAD = A / Math.sqrt(1 - E2 * SIN0 * SIN0);
const MRAD = (A * (1 - E2)) / Math.pow(1 - E2 * SIN0 * SIN0, 1.5);
const KX = (Math.PI / 180) * NRAD * Math.cos(PHI0);
const KY = (Math.PI / 180) * MRAD;
const toWorld = (lon, lat) => [(lon - LON0) * KX, -(lat - LAT0) * KY];

const args = process.argv.slice(2);
const jsonPath = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const boxArg = args.includes('--box') ? args[args.indexOf('--box') + 1] : null;
const [blon0, blat0, blon1, blat1] = (boxArg || '121.464,25.113,121.510,25.150').split(',').map(Number);
const [bx0, bz1] = toWorld(blon0, blat1); // north-west corner (z is south-positive)
const [bx1, bz0] = toWorld(blon1, blat0);
const BOX = { minX: Math.min(bx0, bx1), maxX: Math.max(bx0, bx1), minZ: Math.min(bz0, bz1), maxZ: Math.max(bz0, bz1) };

// ---- ring helpers ----
const ringToPts = (ring) => {
  const pts = [];
  for (let i = 0; i + 1 < ring.length; i += 2) pts.push([ring[i], ring[i + 1]]);
  if (pts.length > 1) {
    const f = pts[0], l = pts[pts.length - 1];
    if (Math.abs(f[0] - l[0]) < 0.01 && Math.abs(f[1] - l[1]) < 0.01) pts.pop();
  }
  return pts;
};
const areaOf = (pts) => {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return Math.abs(a / 2);
};
const bboxOf = (pts) => {
  let x0 = 1e18, z0 = 1e18, x1 = -1e18, z1 = -1e18;
  for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[1] < z0) z0 = p[1]; if (p[0] > x1) x1 = p[0]; if (p[1] > z1) z1 = p[1]; }
  return [x0, z0, x1, z1];
};
const bboxHit = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
// Sutherland-Hodgman clip of a point ring against the census box.
function clipToBox(pts) {
  let out = pts;
  const half = (axis, bound, keepBelow) => {
    const next = [];
    const val = (p) => p[axis];
    const inside = (p) => (keepBelow ? val(p) <= bound : val(p) >= bound);
    for (let i = 0; i < out.length; i++) {
      const a = out[i], b = out[(i + 1) % out.length];
      const ain = inside(a), bin = inside(b);
      if (ain) next.push(a);
      if (ain !== bin) {
        const t = (bound - val(a)) / (val(b) - val(a));
        next.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    out = next;
  };
  half(0, BOX.minX, false); half(0, BOX.maxX, true);
  half(1, BOX.minZ, false); half(1, BOX.maxZ, true);
  return out.length >= 3 && areaOf(out) >= 0.5 ? out : null;
}
const prepSet = (rings) => {
  const out = [];
  for (const ring of rings) {
    const pts = ringToPts(ring);
    if (pts.length < 3) continue;
    if (!bboxHit(bboxOf(pts), [BOX.minX, BOX.minZ, BOX.maxX, BOX.maxZ])) continue;
    const clipped = clipToBox(pts);
    if (clipped) out.push({ pts: clipped, bb: bboxOf(clipped), area: areaOf(clipped) });
  }
  return out;
};
// area(A) - area(A - union(B)), per ring of A against all of B.
const overlapArea = (setA, setB) => {
  let total = 0;
  for (const a of setA) {
    const cand = setB.filter((b) => bboxHit(a.bb, b.bb)).map((b) => b.pts);
    if (!cand.length) continue;
    const pieces = subtractPolys(a.pts, cand);
    const rest = pieces.reduce((s, p) => s + areaOf(p), 0);
    total += Math.max(0, a.area - rest);
  }
  return total;
};
const unionArea = (set) => {
  const acc = [];
  let total = 0;
  for (const r of set) {
    if (!acc.length) { total += r.area; acc.push(r.pts); continue; }
    const cand = acc.filter((p) => bboxHit(r.bb, bboxOf(p)));
    const pieces = cand.length ? subtractPolys(r.pts, cand) : [r.pts];
    total += pieces.reduce((s, p) => s + areaOf(p), 0);
    acc.push(r.pts);
  }
  return total;
};

// ---- the family, raw and as-drawn ----
const geo = TAIPEI_GEO;
const rawTintLayers = buildGreenTintLayers(geo.green);
const lawnRaw = (geo.parks || []).filter((p) => !isPlazaPark(p)).map((p) => p.ring);
const plazaRaw = (geo.parks || []).filter((p) => isPlazaPark(p)).map((p) => p.ring);
const bandRaw = ((geo.riverside && geo.riverside.polys) || []).map((p) => p.ring);
const waterRaw = (geo.water || []).map((p) => p.ring);
const fam = consumeGreenFamilyOverlaps({
  tint: rawTintLayers, band: bandRaw, water: waterRaw, parks: lawnRaw, plaza: plazaRaw,
});

const fmt = (m2) => m2 >= 1e6 ? `${(m2 / 1e6).toFixed(3)} km2` : m2 >= 1000 ? `${(m2 / 1000).toFixed(2)}k m2` : `${m2.toFixed(0)} m2`;
const report = { box: { lon: [blon0, blon1], lat: [blat0, blat1], world: BOX }, raw: {}, drawn: {}, footprint: {} };

const buildSets = (tintLayers, band, water, parks, plaza) => ({
  toneSets: tintLayers.map((l) => ({
    id: `tint 0x${l.tone.toString(16).padStart(6, '0')}`, y: GREEN_TINT_Y, set: prepSet(l.rings),
  })).filter((s) => s.set.length),
  sets: {
    tint: { label: 'green tint (all tones)', y: GREEN_TINT_Y, set: prepSet(tintLayers.flatMap((l) => l.rings)) },
    band: { label: 'riverside band', y: 0.025, set: prepSet(band) },
    water: { label: 'water', y: 0.03, set: prepSet(water) },
    parks: { label: 'park lawns', y: 0.04, set: prepSet(parks) },
    plaza: { label: 'plaza paving', y: 0.041, set: prepSet(plaza) },
  },
});
const censusSide = (name, { toneSets, sets }) => {
  const side = { sets: {}, pairs: [], tonePairs: [], self: [], footprint: 0 };
  console.log(`\n===== ${name} =====`);
  for (const [k, s] of Object.entries(sets)) {
    const sum = s.set.reduce((a, r) => a + r.area, 0);
    const uni = unionArea(s.set);
    side.sets[k] = { label: s.label, y: s.y, rings: s.set.length, ringAreaSum: sum, unionArea: uni };
    console.log(`${s.label.padEnd(24)} y=${s.y}  rings=${s.set.length}  ring-area sum=${fmt(sum)}  union=${fmt(uni)}`);
    if (sum - uni > 1) side.self.push({ set: k, overlap: sum - uni });
  }
  side.footprint = unionArea(Object.values(sets).flatMap((s) => s.set));
  console.log(`family footprint (union of all sets): ${fmt(side.footprint)}`);
  console.log('--- cross pairs (overlap area, Y gap) ---');
  const keys = Object.keys(sets);
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const A = sets[keys[i]], B = sets[keys[j]];
      const ov = overlapArea(A.set, B.set);
      side.pairs.push({ a: keys[i], b: keys[j], overlap: ov, yGap: Math.abs(A.y - B.y) });
      console.log(`${A.label.padEnd(24)} x ${B.label.padEnd(16)} overlap=${fmt(ov).padStart(10)}  dy=${Math.abs(A.y - B.y).toFixed(4)} m`);
    }
  }
  console.log('--- tint tone x tone pairs (ALL at the same Y — dy = 0) ---');
  for (let i = 0; i < toneSets.length; i++) {
    for (let j = i + 1; j < toneSets.length; j++) {
      const ov = overlapArea(toneSets[i].set, toneSets[j].set);
      if (ov > 1) {
        side.tonePairs.push({ a: toneSets[i].id, b: toneSets[j].id, overlap: ov });
        console.log(`${toneSets[i].id} x ${toneSets[j].id}  overlap=${fmt(ov)}`);
      }
    }
  }
  for (const s of side.self) console.log(`SELF-OVERLAP ${sets[s.set].label}: ${fmt(s.overlap)} (one mesh, one tone — same colour wins, cannot shimmer)`);
  return side;
};

console.log(`# Green-family overlap census — box lon ${blon0}-${blon1} x lat ${blat0}-${blat1}`);
console.log(`# world x ${BOX.minX.toFixed(0)}..${BOX.maxX.toFixed(0)}, z ${BOX.minZ.toFixed(0)}..${BOX.maxZ.toFixed(0)}`);
const drawn = buildSets(fam.tint, fam.band, fam.water, fam.parks, fam.plaza);
report.raw = censusSide('SOURCE SETS (raw geodata, pre-#206)', buildSets(rawTintLayers, bandRaw, waterRaw, lawnRaw, plazaRaw));
report.drawn = censusSide('AS-DRAWN SETS (after consumeGreenFamilyOverlaps, the #206 fix)', drawn);
report.footprint = { raw: report.raw.footprint, drawn: report.drawn.footprint };

// ---- terrain skin, sampled per posting, against the AS-DRAWN sets ----
const sstep = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const NEAR = 0.02; // m: |skinY - layerY| under this counts as near-coplanar
const flatSets = Object.entries(drawn.sets).filter(([, s]) => s.set.length);
report.skin = [];
for (const grid of geo.terrain?.grids || []) {
  const { cols, rows, x0, z0, x1, z1, h, mask } = grid;
  if (!cols || !rows || !h || !mask) continue;
  const dx = (x1 - x0) / (cols - 1), dz = (z1 - z0) / (rows - 1);
  const cell = Math.abs(dx * dz);
  const stat = new Map(flatSets.map(([k]) => [k, { near: 0, covers: 0 }]));
  let postings = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = x0 + c * dx, z = z0 + r * dz;
      if (x < BOX.minX || x > BOX.maxX || z < BOX.minZ || z > BOX.maxZ) continue;
      const i = r * cols + c;
      const skinY = h[i] * sstep(TERRAIN_GAIN_LO, TERRAIN_GAIN_HI, h[i]) * mask[i] * terrainEdgeFade(grid, r, c) - TERRAIN_SINK;
      postings++;
      for (const [k, s] of flatSets) {
        const hit = s.set.some((ring) => bboxHit([x, z, x, z], ring.bb) && pointInPoly([x, z], ring.pts));
        if (!hit) continue;
        if (Math.abs(skinY - s.y) <= NEAR) stat.get(k).near += cell;
        else if (skinY > s.y + NEAR) stat.get(k).covers += cell;
      }
    }
  }
  if (postings) {
    console.log(`--- terrain skin (grid ${grid.box}): ${postings} postings in box, cell ${cell.toFixed(0)} m2 ---`);
    for (const [k, v] of stat) {
      report.skin.push({ grid: grid.box, set: k, nearCoplanar: v.near, covers: v.covers });
      console.log(`skin x ${drawn.sets[k].label.padEnd(24)} near-coplanar (|dy|<=${NEAR} m)=${fmt(v.near)}  skin-above=${fmt(v.covers)}`);
    }
  }
}
if (jsonPath) { fs.writeFileSync(jsonPath, JSON.stringify(report, null, 1)); console.log('wrote', jsonPath); }
