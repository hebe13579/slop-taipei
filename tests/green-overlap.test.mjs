// Issue #206: the Guandu green flicker — overlapping green-family
// surfaces z-fighting on the plain.
//
// The green family (green TINT tones all at GREEN_TINT_Y = 0.0235,
// the riverside band 0.025, water 0.03, parks 0.04, plaza 0.041)
// was drawn as independent layers over source polygons that
// overlap each other: on the Guandu plain alone, 1.897 km² was
// painted by two different tint tones at the IDENTICAL height
// (the reserve ring drawn over the farmland and wetland inside
// it), plus tint x parks 1.028 km², tint x water 715k m²,
// water x parks 212k m² (census: tools/taipei/
// census-green-overlaps.mjs, posted on issue #206). Co-planar
// double-painted ground is what shimmered under a moving camera.
//
// The fix is the #171 cap discipline generalised: ONE surface
// wins per area. consumeGreenFamilyOverlaps (js/taipei-green.js)
// processes the family in stack order — plaza > parks > water >
// band > tint tones in build order — and subtracts every survivor
// from the sets below it. The visible winner of every overlap is
// exactly the surface the Y stack already picked; the loser just
// stops being drawn underneath it.
//
// These pins: (1) synthetic precedence is exact, including a
// hole pierced through a lower surface; (2) within the tint, the
// earlier tone wins; (3) on the shipped geodata, the Guandu box
// carries no remaining cross-set or cross-tone double-painted
// sample beyond the small measured residue the subtraction
// primitive leaves in the wetland channels (~3k m² eroded,
// raster-measured — see the census), the removed areas match the
// census, and the probe-counted unresolved residue stays at its
// measured value; (4) consumption does not mutate its inputs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { buildGreenTintLayers, consumeGreenFamilyOverlaps } from '../js/taipei-green.js';
import { isPlazaPark } from '../js/taipei-surfaces.js';
import { pointInPoly } from '../js/taipei-painted.js';

const sq = (x0, z0, x1, z1) => [x0, z0, x1, z0, x1, z1, x0, z1];
const ringArea = (ring) => {
  const n = ring.length / 2;
  let a = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1];
  }
  return Math.abs(a / 2);
};
const setArea = (rings) => rings.reduce((s, r) => s + ringArea(r), 0);
const flatToPts = (ring) => {
  const pts = [];
  for (let i = 0; i + 1 < ring.length; i += 2) pts.push([ring[i], ring[i + 1]]);
  return pts;
};
const contains = (rings, x, z) => rings.some((r) => {
  const pts = flatToPts(r);
  let x0 = 1e18, z0 = 1e18, x1 = -1e18, z1 = -1e18;
  for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[1] < z0) z0 = p[1]; if (p[0] > x1) x1 = p[0]; if (p[1] > z1) z1 = p[1]; }
  return x >= x0 && x <= x1 && z >= z0 && z <= z1 && pointInPoly([x, z], pts);
});

test('synthetic precedence: each surface keeps exactly what the stack leaves it', () => {
  // Concentric-ish squares, each higher set overlapping the lower.
  const fam = consumeGreenFamilyOverlaps({
    tint: [{ tone: 1, rings: [sq(0, 0, 100, 100)] }],
    band: [sq(10, 10, 90, 90)],
    water: [sq(20, 20, 80, 80)],
    parks: [sq(30, 30, 70, 70)],
    plaza: [sq(40, 40, 60, 60)],
  });
  const areaEq = (rings, want) => Math.abs(setArea(rings) - want) < 0.01;
  assert.ok(areaEq(fam.plaza, 400));
  assert.ok(areaEq(fam.parks, 1600 - 400));
  assert.ok(areaEq(fam.water, 3600 - 1600));
  assert.ok(areaEq(fam.band, 6400 - 3600));
  assert.ok(areaEq(fam.tint[0].rings, 10000 - 6400));
  // Sample points in each overlap zone belong to the winner only.
  assert.ok(contains(fam.plaza, 50, 50) && !contains(fam.parks, 50, 50));
  assert.ok(contains(fam.parks, 35, 35) && !contains(fam.water, 35, 35));
  assert.ok(contains(fam.water, 25, 25) && !contains(fam.band, 25, 25));
  assert.ok(contains(fam.band, 15, 15) && !contains(fam.tint[0].rings, 15, 15));
  assert.ok(contains(fam.tint[0].rings, 5, 5));
  assert.equal(fam.unresolved, 0);
});

test('synthetic hole: a pond inside a field is cut out of the tint', () => {
  const fam = consumeGreenFamilyOverlaps({
    tint: [{ tone: 1, rings: [sq(0, 0, 100, 100)] }],
    band: [],
    water: [sq(40, 40, 60, 60)],
    parks: [],
    plaza: [],
  });
  assert.ok(!contains(fam.tint[0].rings, 50, 50), 'pond centre must not stay tinted');
  assert.ok(contains(fam.tint[0].rings, 10, 10));
  const kept = setArea(fam.tint[0].rings);
  assert.ok(kept < 10000 - 400 + 60 && kept > 10000 - 400 - 400,
    `tint keeps the field minus the pond (got ${kept.toFixed(0)}, exact 9600, triangulated differences over-cover slightly)`);
});

test('tint tones: the earlier layer wins the overlap', () => {
  const fam = consumeGreenFamilyOverlaps({
    tint: [
      { tone: 1, rings: [sq(0, 0, 60, 60)] },
      { tone: 2, rings: [sq(40, 40, 100, 100)] },
    ],
    band: [], water: [], parks: [], plaza: [],
  });
  assert.ok(Math.abs(setArea(fam.tint[0].rings) - 3600) < 0.01);
  assert.ok(Math.abs(setArea(fam.tint[1].rings) - (3600 - 400)) < 0.01);
  assert.ok(contains(fam.tint[0].rings, 50, 50) && !contains(fam.tint[1].rings, 50, 50));
});

test('inputs are not mutated', () => {
  const tint = [{ tone: 1, rings: [sq(0, 0, 50, 50)] }];
  const water = [sq(10, 10, 20, 20)];
  const before = JSON.stringify({ tint, water });
  consumeGreenFamilyOverlaps({ tint, band: [], water, parks: [], plaza: [] });
  assert.equal(JSON.stringify({ tint, water }), before);
});

// ---- shipped geodata: the Guandu box ------------------------------
const geo = TAIPEI_GEO;
const fam = consumeGreenFamilyOverlaps({
  tint: buildGreenTintLayers(geo.green),
  band: (geo.riverside?.polys || []).map((p) => p.ring),
  water: geo.water.map((w) => w.ring),
  parks: geo.parks.filter((p) => !isPlazaPark(p)).map((p) => p.ring),
  plaza: geo.parks.filter(isPlazaPark).map((p) => p.ring),
});

test('geodata: removed areas match the #206 census (tile-wide)', () => {
  // Measured 2026-10-27 on this geodata (census on issue #206).
  // Bands are ±3%: if the geodata is regenerated, re-measure
  // with tools/taipei/census-green-overlaps.mjs and re-pin.
  const near = (v, target) => Math.abs(v - target) <= target * 0.03;
  assert.ok(near(fam.removed.parks, 51347), `parks removed ${fam.removed.parks.toFixed(0)}`);
  // Water re-pinned at the #224 gate for issue #186: measured
  // 359,915 on the post-#186 tile — the strip's Keelung River
  // reach and Dazhi water add +12,642 m² (+3.6%) of
  // water-x-above-family overlap. Parks (51,347) and band
  // (3,013,763) reproduce the original census to <1 m² on the
  // same tree, and tint (3,726,596 measured) stays inside the
  // original ±3% band unedited.
  // Water re-pinned at the #226 gate for issue #223: measured
  // 312,277 — the creek buffers shrink ~864k m² of derived
  // water, so far less water sits under the above families to
  // be consumed (−47,638 vs the #224 pin). Parks and band
  // reproduce inside their bands unedited.
  assert.ok(near(fam.removed.water, 312277), `water removed ${fam.removed.water.toFixed(0)}`);
  assert.ok(near(fam.removed.band, 3013763), `band removed ${fam.removed.band.toFixed(0)}`);
  // Tint re-pinned at the same gate: measured 3,314,939.
  // Tint sits BELOW water in the consumption order, so the
  // narrowed creeks also uncover tint that the fat buffers
  // used to eat (−370,841 vs the original census pin).
  assert.ok(near(fam.removed.tint, 3314939), `tint removed ${fam.removed.tint.toFixed(0)}`);
  // Probe-counted residue tile-wide: holes the subtraction
  // primitive's last-resort fallback keeps even solo (their
  // sample probes still land inside afterwards). One on the
  // pre-#186 tile; the #186 strip's water/green geometry adds
  // a second of the same class. Raster puts the total
  // surviving cross-set overlap at ~3k m² in the wetland
  // corner — three orders below the 4.3 km² the census found
  // before.
  assert.ok(fam.unresolved <= 2, `unresolved ${fam.unresolved}`);
});

test('geodata: no double-painted samples left on the Guandu plain', () => {
  // Tangent-plane frame, same math as tools/taipei/census-green-overlaps.mjs.
  const LAT0 = 25.0330, LON0 = 121.5650;
  const EA = 6378137.0, E2 = 6.69437999014e-3;
  const PHI0 = (LAT0 * Math.PI) / 180, SIN0 = Math.sin(PHI0);
  const NRAD = EA / Math.sqrt(1 - E2 * SIN0 * SIN0);
  const MRAD = (EA * (1 - E2)) / (1 - E2 * SIN0 * SIN0) ** 1.5;
  const KX = (Math.PI / 180) * NRAD * Math.cos(PHI0), KY = (Math.PI / 180) * MRAD;
  const toWorld = (lon, lat) => [(lon - LON0) * KX, -(lat - LAT0) * KY];
  const [x0, z1] = toWorld(121.464, 25.150);
  const [x1, z0] = toWorld(121.510, 25.113);
  const step = 25;
  const sets = [
    ['plaza', fam.plaza], ['parks', fam.parks], ['water', fam.water], ['band', fam.band],
    ...fam.tint.map((l) => [`tone:${l.tone}`, l.rings]),
  ].map(([name, rings]) => ({
    name,
    rings: rings.map((r) => {
      const pts = flatToPts(r);
      let bx0 = 1e18, bz0 = 1e18, bx1 = -1e18, bz1 = -1e18;
      for (const p of pts) { if (p[0] < bx0) bx0 = p[0]; if (p[1] < bz0) bz0 = p[1]; if (p[0] > bx1) bx1 = p[0]; if (p[1] > bz1) bz1 = p[1]; }
      return { pts, bb: [bx0, bz0, bx1, bz1] };
    }),
  }));
  let crossSet = 0, crossTone = 0, samples = 0;
  for (let x = x0 + step / 2; x < x1; x += step) {
    for (let z = z1 + step / 2; z < z0; z += step) {
      samples++;
      const hits = [];
      for (const s of sets) {
        for (const r of s.rings) {
          if (x < r.bb[0] || x > r.bb[2] || z < r.bb[1] || z > r.bb[3]) continue;
          if (pointInPoly([x, z], r.pts)) { hits.push(s.name); break; }
        }
      }
      const tones = hits.filter((h) => h.startsWith('tone:'));
      if (new Set(tones).size > 1) crossTone++;
      const families = new Set(hits.map((h) => (h.startsWith('tone:') ? 'tint' : h)));
      if (families.size > 1) crossSet++;
    }
  }
  assert.ok(samples > 20000, `sampled ${samples}`);
  // The subtraction primitive leaves ~3k m² of eroded residual in
  // the wetland channels (raster-measured, census on the issue) —
  // at 25 m sampling that is a handful of double-hit samples.
  // Before the fix this count was in the thousands (1.9 km² of
  // co-planar tone overlap alone is ~3,000 samples).
  assert.ok(crossSet <= 10, `cross-set double-painted samples: ${crossSet}`);
  assert.ok(crossTone <= 4, `cross-tone double-painted samples: ${crossTone}`);
});
