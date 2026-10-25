import assert from 'node:assert/strict';
import test from 'node:test';

import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { planTaipeiBuildings } from '../js/taipei-buildings.js';
import { detectJunctions } from '../js/taipei-markings.js';
import { planJunctionCaps, planRoundabouts, ringPoints } from '../js/taipei-junctions.js';
import { buildPolyGrid, pointInAnyPoly } from '../js/taipei-painted.js';
import {
  buildSidewalkBands,
  planStreetTrees,
  planParkTrees,
  sidewalkBandWidth,
  buildSegmentGrid,
  distToSegment,
  pointInRing,
  TREE_CAP,
  PARK_TREE_CAP,
} from '../js/taipei-streetscape.js';

// Issues #27 (sidewalks) and #28 (street trees): the geometry/placement
// layer is pure, so these tests run it against synthetic junctions and
// the real generated tile and pin the invariants the renderer relies
// on — bands only where the layout says sidewalk, bands never crossing
// a junction carriageway, trees never on asphalt or inside a lot.

const bed = (name, highway, width, layout, pts, ways = [1]) => ({
  name, highway, width, pedestrianLayout: layout, pts, sourceWayIds: ways,
});

test('sidewalk band width follows road class (§c.1)', () => {
  assert.equal(sidewalkBandWidth(bed('a', 'primary', 30, 'sidewalk', [0, 0, 10, 0])), 2.5);
  assert.equal(sidewalkBandWidth(bed('a', 'trunk', 30, 'sidewalk', [0, 0, 10, 0])), 2.5);
  assert.equal(sidewalkBandWidth(bed('a', 'secondary', 20, 'sidewalk', [0, 0, 10, 0])), 2.2);
  assert.equal(sidewalkBandWidth(bed('a', 'tertiary', 14, 'sidewalk', [0, 0, 10, 0])), 2.0);
  assert.equal(sidewalkBandWidth(bed('a', 'residential', 9, 'sidewalk', [0, 0, 10, 0])), 1.5);
  assert.equal(sidewalkBandWidth(bed('a', 'secondary_link', 12, 'sidewalk', [0, 0, 10, 0])), 1.5);
  // A narrow way with an explicit sidewalk tag never grows an outsized band.
  assert.ok(sidewalkBandWidth(bed('a', 'primary', 2.4, 'sidewalk', [0, 0, 10, 0])) <= 1.2 + 1e-9);
});

test('bands are emitted only for sidewalk-layout beds', () => {
  const others = [
    bed('p', 'tertiary', 10, 'painted', [0, 0, 100, 0]),
    bed('s', 'residential', 6, 'shared', [0, 20, 100, 20]),
    bed('a', 'secondary', 14, 'arcade', [0, 40, 100, 40]),
  ];
  assert.equal(buildSidewalkBands(others, 0.045).quadCount, 0);
  const one = [bed('w', 'tertiary', 10, 'sidewalk', [0, 0, 100, 0])];
  const out = buildSidewalkBands(one, 0.045);
  assert.ok(out.quadCount > 0 && out.totalBandLength > 150, 'both edges of a 100 m street');
});

test('bands stop at junction carriageways instead of crossing them', () => {
  // A horizontal sidewalk street crossed at x=50 by a vertical one.
  const cross = [
    bed('H', 'secondary', 12, 'sidewalk', [0, 0, 100, 0], [11]),
    bed('V', 'secondary', 12, 'sidewalk', [50, -50, 50, 50], [22]),
  ];
  const out = buildSidewalkBands(cross, 0.045);
  const raw = buildSidewalkBands(cross, 0.045, { clip: false });
  assert.ok(out.totalBandLength < raw.totalBandLength - 20, `trimming removed band at the junction (${out.totalBandLength.toFixed(0)} vs ${raw.totalBandLength.toFixed(0)})`);
  // No emitted quad centre may sit inside the OTHER bed's carriageway.
  for (let q = 0; q < out.quadCount; q++) {
    const o = q * 18;
    const cx = (out.positions[o] + out.positions[o + 3] + out.positions[o + 6]) / 3;
    const cz = (out.positions[o + 2] + out.positions[o + 5] + out.positions[o + 8]) / 3;
    const onH = Math.abs(cz) <= 6 && cx >= 0 && cx <= 100; // quad belongs to H's band line
    const other = onH ? cross[1] : cross[0];
    const d = distToSegment(cx, cz, other.pts[0], other.pts[1], other.pts[2], other.pts[3]);
    assert.ok(d >= 6 - 0.05, `quad centre ${cx},${cz} inside crossing carriageway (d=${d})`);
  }
  // A bed continuing the same road (shared endpoint, same name) is not trimmed.
  const cont = [
    bed('H', 'secondary', 12, 'sidewalk', [0, 0, 50, 0], [11]),
    bed('H', 'secondary', 12, 'sidewalk', [50, 0, 100, 0], [12]),
  ];
  const contOut = buildSidewalkBands(cont, 0.045);
  const contRaw = buildSidewalkBands(cont, 0.045, { clip: false });
  assert.equal(contOut.quadCount, contRaw.quadCount, 'continuation beds keep their full bands');
});

test('real tile: bands cover the arterials and respect every crossing carriageway (sampled)', (t) => {
  const beds = TAIPEI_GEO.roadbeds;
  const out = buildSidewalkBands(beds, 0.045);
  t.diagnostic(`band quads ${out.quadCount}, band-km ${(out.totalBandLength / 1000).toFixed(1)}`);
  // Quad count is segment-based: after issue #30's centreline
  // simplification (Douglas-Peucker eps 1.5 m) the same coverage is
  // fewer, longer quads (6,425 quads/181.4 km before, 3,449/190.5 km
  // after). The coverage invariant is the band length, not the count.
  assert.ok(out.quadCount > 3000);
  assert.ok(out.totalBandLength > 170000);
  assert.ok(out.bandLengthByClass.primary > 0 && out.bandLengthByClass.secondary > 0);
  // Every sampled quad centre must clear every carriageway it does not
  // belong to: find the quad's owner (the sidewalk bed whose band line
  // the centre sits on), then require clearance from all beds that are
  // neither the owner nor a same-name continuation of it. (A band on
  // the inside of its own bed's bend legitimately nears its own next
  // segment — that is ribbon geometry, not a junction crossing.)
  const grid = buildSegmentGrid(beds, 30);
  const nearSegs = (x, z) => grid.near(x, z).map((s) => ({ ...s, d: distToSegment(x, z, s.ax, s.az, s.bx, s.bz) }));
  for (let q = 0; q < out.quadCount; q += 7) {
    const o = q * 18;
    const cx = (out.positions[o] + out.positions[o + 3] + out.positions[o + 6]) / 3;
    const cz = (out.positions[o + 2] + out.positions[o + 5] + out.positions[o + 8]) / 3;
    const segs = nearSegs(cx, cz);
    let owner = -1, ownerDev = Infinity;
    for (const s of segs) {
      const b = beds[s.idx];
      if (b.pedestrianLayout !== 'sidewalk') continue;
      const dev = Math.abs(s.d - (s.half + sidewalkBandWidth(b) / 2));
      if (dev < ownerDev) { ownerDev = dev; owner = s.idx; }
    }
    assert.ok(owner >= 0 && ownerDev < 1.2, `band quad at ${cx.toFixed(0)},${cz.toFixed(0)} has no owner bed`);
    for (const s of segs) {
      if (s.idx === owner) continue;
      const other = beds[s.idx];
      if (other.name && other.name === beds[owner].name) continue; // continuation corridor
      assert.ok(s.d >= s.half - 0.05, `band quad at ${cx.toFixed(0)},${cz.toFixed(0)} inside carriageway of ${other.name} (d=${s.d.toFixed(2)} < half=${s.half})`);
    }
  }
});

test('real tile: trees are capped, deterministic, and never on asphalt or in a lot', (t) => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  const a = planStreetTrees(TAIPEI_GEO, plan);
  const b = planStreetTrees(TAIPEI_GEO, plan);
  t.diagnostic(`trees ${a.trees.length} (sidewalk ${a.stats.sidewalk}, median ${a.stats.median}), rejected ${JSON.stringify(a.stats.rejected)}`);
  assert.ok(a.trees.length > 1500 && a.trees.length <= TREE_CAP);
  assert.deepEqual(
    a.trees.map((x) => [x.x, x.z, x.kind]),
    b.trees.map((x) => [x.x, x.z, x.kind]),
    'identical inputs plant identical trees',
  );
  const ways = TAIPEI_GEO.roads.filter((r) => !['footway', 'path', 'steps', 'pedestrian', 'cycleway', 'corridor', 'elevator', 'crossing', 'platform', 'traffic_island'].includes(r.highway));
  const wayGrid = buildSegmentGrid(ways, 30);
  for (const tree of a.trees) {
    for (const s of wayGrid.near(tree.x, tree.z)) {
      const d = distToSegment(tree.x, tree.z, s.ax, s.az, s.bx, s.bz);
      assert.ok(d >= s.half - 0.01, `tree at ${tree.x.toFixed(0)},${tree.z.toFixed(0)} inside carriageway way (d=${d.toFixed(2)} < half=${s.half})`);
    }
    for (const lot of plan.lots) {
      assert.ok(
        Math.abs(tree.x - lot.x) > lot.w / 2 || Math.abs(tree.z - lot.z) > lot.d / 2,
        `tree at ${tree.x.toFixed(0)},${tree.z.toFixed(0)} inside a building lot`,
      );
    }
  }
});

test('synthetic: trees keep out of lots and junctions, medians need a merged surface boulevard', () => {
  const geo = {
    roadbeds: [
      bed('B', 'primary', 30, 'sidewalk', [-100, 0, 100, 0], [1, 2]), // merged boulevard
      bed('X', 'tertiary', 8, 'sidewalk', [0, -60, 0, 60], [3]),       // crossing street
      bed('T', 'trunk', 40, 'sidewalk', [-100, 200, 100, 200], [4, 5]), // trunk: no median row
      bed('象山隧道', 'secondary', 40, 'sidewalk', [-100, 300, 100, 300], [6, 7]), // tunnel: no trees at all
      bed('S', 'primary', 30, 'shared', [-100, 400, 100, 400], [8, 9]), // merged boulevard whose layout resolved to shared: median row still plants
    ],
    roads: [
      // the boulevard's two real carriageways, 9 m wide, centres at z=±8
      { name: 'B', highway: 'primary', width: 9, pts: [-100, -8, 100, -8] },
      { name: 'B', highway: 'primary', width: 9, pts: [-100, 8, 100, 8] },
      { name: 'X', highway: 'tertiary', width: 8, pts: [0, -60, 0, 60] },
      { name: 'T', highway: 'trunk', width: 40, pts: [-100, 200, 100, 200] },
      { name: '象山隧道', highway: 'secondary', width: 40, pts: [-100, 300, 100, 300] },
      { name: 'S', highway: 'primary', width: 9, pts: [-100, 392, 100, 392] },
      { name: 'S', highway: 'primary', width: 9, pts: [-100, 408, 100, 408] },
    ],
    water: [],
    parks: [],
  };
  const plan = { lots: [{ x: 30, z: 17.5, w: 12, d: 5, h: 20, color: 0 }], tower: null };
  const { trees } = planStreetTrees(geo, plan);
  assert.ok(trees.some((x) => x.kind === 'median' && Math.abs(x.z) < 1), 'median row planted on the boulevard');
  assert.ok(trees.some((x) => x.kind === 'sidewalk' && Math.abs(Math.abs(x.z) - 16.25) < 1.5), 'sidewalk rows planted');
  assert.ok(!trees.some((x) => Math.abs(x.z - 200) < 25), 'no trees on the trunk bed');
  assert.ok(!trees.some((x) => Math.abs(x.z - 300) < 25), 'no trees on the tunnel bed');
  assert.ok(trees.some((x) => x.kind === 'median' && Math.abs(x.z - 400) < 1), 'median row plants on a shared-layout merged boulevard');
  assert.ok(!trees.some((x) => Math.abs(x.z - 400) < 25 && x.kind === 'sidewalk'), 'no sidewalk rows without a sidewalk layout');
  assert.ok(!trees.some((x) => Math.abs(x.x - 30) < 8 && Math.abs(x.z - 17.5) < 5), 'lot footprint stays empty');
  assert.ok(!trees.some((x) => Math.abs(x.x) < 6 && Math.abs(x.z) < 20 && x.kind === 'median'), 'median row breaks at the crossing street');
});

// ---------------------------------------------------------------------
// Issue #41 — park trees

test('synthetic: park planting skips plazas and respects water, paths, lots and sites', () => {
  const geo = {
    roadbeds: [],
    roads: [{ name: '', highway: 'footway', width: 3, pts: [0, 150, 200, 150] }],
    water: [{ name: 'pond', ring: [80, 80, 120, 80, 120, 120, 80, 120] }],
    parks: [
      { name: 'Test Park', ring: [0, 0, 200, 0, 200, 200, 0, 200] },
      // Overlaps the first park's corner: a plaza here must still win —
      // it is paved, not planting ground.
      { name: '市民廣場', ring: [150, 150, 260, 150, 260, 260, 150, 260] },
    ],
  };
  const plan = {
    lots: [{ x: 30, z: 30, w: 40, d: 40, h: 10, color: 0 }],
    tower: null,
    landmarkTowers: [{ sites: [{ minX: 150, maxX: 190, minZ: 10, maxZ: 50 }] }],
  };
  const { trees, stats } = planParkTrees(geo, plan);
  assert.ok(trees.length > 50, `park planted (${trees.length} trees)`);
  assert.ok(trees.every((t) => t.kind === 'park'));
  // All inside the green park; the overlapping plaza polygon is
  // skipped whole as a planting SOURCE (it is paved, #29).
  assert.ok(trees.every((t) => pointInRing(t.x, t.z, geo.parks[0].ring)), 'every tree inside the source park');
  assert.ok(trees.every((t) => t.park === 'Test Park'), 'plaza never a planting source');
  assert.ok(!trees.some((t) => t.x >= 80 && t.x <= 120 && t.z >= 80 && t.z <= 120), 'pond stays empty');
  assert.ok(!trees.some((t) => Math.abs(t.z - 150) < 3.3 - 0.01), 'footpath margin stays empty');
  assert.ok(!trees.some((t) => Math.abs(t.x - 30) <= 20.3 && Math.abs(t.z - 30) <= 20.3), 'lot footprint stays empty');
  assert.ok(!trees.some((t) => t.x >= 149.5 && t.x <= 190.5 && t.z >= 9.5 && t.z <= 50.5), 'landmark site stays empty');
  assert.ok(stats.rejected.water > 0 && stats.rejected.path > 0, 'exclusions actually engaged');
});

test('real tile: park trees are deterministic, capped, and Da-an reads as woodland', (t) => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  const a = planParkTrees(TAIPEI_GEO, plan);
  const b = planParkTrees(TAIPEI_GEO, plan);
  t.diagnostic(`park trees ${a.trees.length}, by class ${JSON.stringify(Object.fromEntries(Object.entries(a.stats.byClass).map(([k, v]) => [k, v.trees])))}`);
  assert.deepEqual(
    a.trees.map((x) => [x.x, x.z]),
    b.trees.map((x) => [x.x, x.z]),
    'identical inputs plant identical park trees',
  );
  assert.ok(a.trees.length > 3000 && a.trees.length <= PARK_TREE_CAP, `combined planting in budget (${a.trees.length})`);
  const daan = a.trees.filter((x) => x.park === '大安森林公園').length;
  t.diagnostic(`Da-an Forest Park trees ${daan}`);
  // Re-based for issue #102 (northern phase 1): PARK_TREE_CAP is a
  // fixed instance budget (7,500). The A+B tile planted ~8.7k raw
  // candidates, so Da-an kept 844 of them; the five-box tile plants
  // ~49k raw candidates over 9.42 km2 of parks (Beitou's foothill
  // parks alone offer ~22.7k), and the same budget spread evenly
  // leaves Da-an 201. The trees are the same planting, thinned by
  // the shared stride — no park lost its planting logic. Raising
  // the cap is a phone-budget call, flagged in the #102 PR for the
  // gate (≈29k would restore the A+B-era density); the band below
  // pins the measured spread so a further silent thinning fails.
  assert.ok(daan >= 150 && daan <= 1600, `Da-an woodland density (${daan})`);
  const capped = planParkTrees(TAIPEI_GEO, plan, { cap: 400 });
  assert.equal(capped.trees.length, 400, 'cap hits exactly');
  // The subset invariant is against the UNTHINNED plan: since the west
  // expansion (issue #60) the tile's raw planting exceeds PARK_TREE_CAP,
  // so the default plan `a` is itself stride-thinned and a 400-cap
  // thinning (different per-park strides) is not a subset of it. What
  // must hold — and what this pins — is that thinning never invents
  // trees: every capped tree exists in the unthinned plan.
  const unthinned = planParkTrees(TAIPEI_GEO, plan, { cap: Number.MAX_SAFE_INTEGER });
  t.diagnostic(`unthinned park planting ${unthinned.trees.length} (default cap ${PARK_TREE_CAP})`);
  const full = new Set(unthinned.trees.map((x) => `${x.x},${x.z}`));
  assert.ok(capped.trees.every((x) => full.has(`${x.x},${x.z}`)), 'capped plan is a subset of the unthinned plan');
  assert.ok(a.trees.every((x) => full.has(`${x.x},${x.z}`)), 'default plan is a subset of the unthinned plan');
});

test('real tile: park tree exclusion audit (brute force)', () => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  const { trees } = planParkTrees(TAIPEI_GEO, plan);
  const withBB = (ring) => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < ring.length; i += 2) {
      minX = Math.min(minX, ring[i]); maxX = Math.max(maxX, ring[i]);
      minZ = Math.min(minZ, ring[i + 1]); maxZ = Math.max(maxZ, ring[i + 1]);
    }
    return { ring, minX, maxX, minZ, maxZ };
  };
  const inAny = (list, x, z) => list.some((p) => x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ && pointInRing(x, z, p.ring));
  const plantable = TAIPEI_GEO.parks.filter((p) => !(p.name || '').includes('廣場')).map((p) => withBB(p.ring));
  const waterBB = TAIPEI_GEO.water.map((w) => withBB(w.ring));
  const bedGrid = buildSegmentGrid(TAIPEI_GEO.roadbeds, 60);
  const pathGrid = buildSegmentGrid(TAIPEI_GEO.roads.filter((r) => ['footway', 'path', 'steps', 'pedestrian', 'cycleway', 'corridor', 'elevator', 'crossing', 'platform', 'traffic_island'].includes(r.highway)), 60);
  const towerHalf = plan.tower ? (plan.tower.podium?.w || 76) / 2 + 1 : 0;
  const sites = [
    ...(plan.tower ? [{ minX: plan.tower.x - towerHalf, maxX: plan.tower.x + towerHalf, minZ: plan.tower.z - towerHalf, maxZ: plan.tower.z + towerHalf }] : []),
    ...(plan.landmarkTowers || []).flatMap((lt) => lt.sites || []),
  ];
  for (const tree of trees) {
    assert.ok(inAny(plantable, tree.x, tree.z), `tree at ${tree.x.toFixed(0)},${tree.z.toFixed(0)} outside every plantable park`);
    assert.ok(!inAny(waterBB, tree.x, tree.z), `tree in water at ${tree.x.toFixed(0)},${tree.z.toFixed(0)}`);
    for (const s of bedGrid.near(tree.x, tree.z)) {
      const d = distToSegment(tree.x, tree.z, s.ax, s.az, s.bx, s.bz);
      assert.ok(d >= s.half + 0.9 - 0.01, `tree inside a carriageway (d=${d.toFixed(2)}, half=${s.half})`);
    }
    for (const s of pathGrid.near(tree.x, tree.z)) {
      const d = distToSegment(tree.x, tree.z, s.ax, s.az, s.bx, s.bz);
      assert.ok(d >= s.half + 1.8 - 0.01, `tree on a park path (d=${d.toFixed(2)}, half=${s.half})`);
    }
    assert.ok(!plan.lots.some((lot) => Math.abs(tree.x - lot.x) <= lot.w / 2 + 0.3 && Math.abs(tree.z - lot.z) <= lot.d / 2 + 0.3), `tree inside a lot at ${tree.x.toFixed(0)},${tree.z.toFixed(0)}`);
    assert.ok(!sites.some((r) => tree.x >= r.minX - 0.5 && tree.x <= r.maxX + 0.5 && tree.z >= r.minZ - 0.5 && tree.z <= r.maxZ + 0.5), `tree inside a landmark site at ${tree.x.toFixed(0)},${tree.z.toFixed(0)}`);
  }
  // Grid-free spot check on a stride sample: full segment scans, no
  // index trust (mirrors PR #34's brute-force standard).
  const allSegs = (items) => items.flatMap((r) => {
    const out = [];
    for (let i = 0; i + 3 < r.pts.length; i += 2) out.push({ ax: r.pts[i], az: r.pts[i + 1], bx: r.pts[i + 2], bz: r.pts[i + 3], half: Math.max((r.width || 3) / 2, 0.75) });
    return out;
  });
  const bedSegs = allSegs(TAIPEI_GEO.roadbeds);
  for (let i = 0; i < trees.length; i += 37) {
    const tree = trees[i];
    for (const s of bedSegs) {
      const d = distToSegment(tree.x, tree.z, s.ax, s.az, s.bx, s.bz);
      assert.ok(d >= s.half + 0.9 - 0.01, `sampled tree inside a carriageway (d=${d.toFixed(2)}, half=${s.half})`);
    }
  }
});

test('issue #81: with boot-style exclusions, no tree stands on junction asphalt', () => {
  // The boot (taipei-boot.js) plans trees AFTER the junction caps
  // and roundabout sites and passes their rings as exclusion
  // polygons: the planners' own carriageway checks test
  // centreline distance, and a cap corner can sit 20+ m from
  // every centreline. Measured before the exclusion: 147 planned
  // trees inside cap polygons tile-wide (a tree standing in the
  // reported junction's field among them).
  const geo = TAIPEI_GEO;
  const plan = planTaipeiBuildings(geo);
  const beds = geo.roadbeds;
  const junctions = detectJunctions(beds);
  const sites = planRoundabouts(beds, junctions);
  const caps = planJunctionCaps(beds, junctions, sites);
  const exclusions = [
    ...caps.map((c) => c.ring),
    ...sites.flatMap((s) => [s.disc.ring, ...s.aprons.map((a) => a.ring)]),
  ];
  const polys = exclusions.map((r) => ringPoints(r));
  const grid = buildPolyGrid(polys);
  const street = planStreetTrees(geo, plan, { exclusions });
  const park = planParkTrees(geo, plan, { exclusions });
  // The exclusion actually bites (it is not a no-op on this data).
  assert.ok(street.stats.rejected.cap > 0, `street candidates rejected by caps: ${street.stats.rejected.cap}`);
  assert.ok(park.stats.rejected.cap > 0, `park candidates rejected by caps: ${park.stats.rejected.cap}`);
  assert.ok(street.stats.rejected.cap + park.stats.rejected.cap >= 100,
    `cap rejections ${street.stats.rejected.cap} + ${park.stats.rejected.cap} (147 trees stood inside caps before)`);
  for (const t of [...street.trees, ...park.trees])
    assert.ok(!pointInAnyPoly(grid, polys, [t.x, t.z]), `tree at ${t.x},${t.z} inside a junction cap/disc`);
});
