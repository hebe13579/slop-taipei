import assert from 'node:assert/strict';
import test from 'node:test';

import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { planTaipeiBuildings } from '../js/taipei-buildings.js';
import {
  buildSidewalkBands,
  planStreetTrees,
  sidewalkBandWidth,
  buildSegmentGrid,
  distToSegment,
  TREE_CAP,
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
  assert.ok(out.quadCount > 4000);
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
