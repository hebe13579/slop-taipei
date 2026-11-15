import assert from 'node:assert/strict';
import test from 'node:test';

import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { planTaipeiBuildings } from '../js/taipei-buildings.js';
import { planStreetTrees, planStreetLamps, distToSegment } from '../js/taipei-streetscape.js';
import { planStreetAmenities, STREET_AMENITY_CAPS } from '../js/taipei-street-amenities.js';

// Issue #362: street amenities (benches, chairs, bins, bus-stop
// signs, street bushes) along the sidewalk bands. The planner is
// pure, so these tests run it against synthetic streets and the
// real tile and pin the invariants the renderer relies on —
// furniture on the band, never on a carriageway, in a lot, in a
// park, on water, or on a lamp post / tree trunk.

const bed = (name, highway, width, layout, pts, ways = [1]) => ({
  name, highway, width, pedestrianLayout: layout, pts, sourceWayIds: ways,
});
const geo = (beds, roads = []) => ({ roadbeds: beds, roads, parks: [], water: [] });
const emptyPlan = { lots: [], tower: null, landmarkTowers: [] };

test('deterministic: identical inputs plan identical furniture', () => {
  const g = geo([
    bed('A', 'secondary', 20, 'sidewalk', [0, 0, 500, 0]),
    bed('B', 'residential', 9, 'sidewalk', [0, 40, 500, 40]),
  ]);
  const a = planStreetAmenities(g, emptyPlan);
  const b = planStreetAmenities(g, emptyPlan);
  assert.deepEqual(a, b);
});

test('furniture stays on the band, off the carriageway and out of lots', () => {
  const lot = { x: 250, z: 0, w: 30, d: 20, rot: 0 };
  const g = geo([
    bed('A', 'secondary', 20, 'sidewalk', [0, 0, 500, 0]),
    bed('B', 'residential', 9, 'sidewalk', [0, 40, 500, 40]),
  ]);
  const out = planStreetAmenities(g, { lots: [lot], tower: null, landmarkTowers: [] });
  for (const [kind, list] of Object.entries(out.items)) {
    for (const it of list) {
      // Off every carriageway: at least the bed half-width away
      // from every centreline except its own bed's (the item
      // stands on its own band by construction).
      for (const b of g.roadbeds) {
        const half = Math.max((b.width || 3) / 2, 0.75);
        for (let i = 0; i + 3 < b.pts.length; i += 2) {
          const d = distToSegment(it.x, it.z, b.pts[i], b.pts[i + 1], b.pts[i + 2], b.pts[i + 3]);
          assert.ok(d >= half - 0.01 || Math.abs(it.z) < 0.01, `${kind} at ${it.x.toFixed(1)},${it.z.toFixed(1)} on ${b.name} carriageway (d=${d.toFixed(2)} < half=${half})`);
        }
      }
      // Out of the lot (with the planner's 0.3 m pad).
      assert.ok(Math.abs(it.x - lot.x) > lot.w / 2 + 0.3 || Math.abs(it.z - lot.z) > lot.d / 2 + 0.3, `${kind} inside the lot`);
    }
  }
});

test('bus stops only on arterials; bushes only on wide bands', () => {
  const g = geo([
    bed('A', 'primary', 30, 'sidewalk', [0, 0, 2000, 0]),
    bed('B', 'residential', 9, 'sidewalk', [0, 40, 2000, 40]),
    bed('C', 'tertiary', 14, 'sidewalk', [0, 80, 2000, 80]),
  ]);
  const out = planStreetAmenities(g, emptyPlan);
  for (const s of out.items.busStop) {
    assert.ok(['primary', 'secondary', 'tertiary'].includes(s.highway), `bus stop on ${s.highway}`);
  }
  assert.ok(out.items.busStop.length > 0, 'arterials get bus stops');
  // The residential bed (1.5 m band) gets benches but no bushes.
  const resBushes = out.items.bush.filter((b) => b.highway === 'residential');
  assert.equal(resBushes.length, 0, 'no bushes on 1.5 m residential bands');
});

test('avoid points keep furniture off lamp posts and tree trunks', () => {
  const g = geo([bed('A', 'secondary', 20, 'sidewalk', [0, 0, 500, 0])]);
  const avoid = [{ x: 100, z: 11.1, r: 0.5 }, { x: 200, z: -11.1, r: 0.5 }];
  const out = planStreetAmenities(g, emptyPlan, { avoid });
  for (const list of Object.values(out.items)) {
    for (const it of list) {
      for (const a of avoid) {
        assert.ok(Math.hypot(it.x - a.x, it.z - a.z) >= a.r + 0.35 - 1e-9, `item ${it.x.toFixed(1)},${it.z.toFixed(1)} on avoid point`);
      }
    }
  }
});

// Real tile: the full census. The plan + lamp/tree plans are
// computed once at module scope (same as streetscape2.test.mjs).
const plan = planTaipeiBuildings(TAIPEI_GEO);
const streetTrees = planStreetTrees(TAIPEI_GEO, plan);
const lamps = planStreetLamps(TAIPEI_GEO, plan);
const street = planStreetAmenities(TAIPEI_GEO, plan, {
  avoid: [
    ...lamps.lamps.map((l) => ({ x: l.x, z: l.z, r: 0.4 })),
    ...streetTrees.trees.map((t) => ({ x: t.x, z: t.z, r: 0.5 })),
  ],
});

test('real tile: counts within caps and every kind present', (t) => {
  const counts = Object.fromEntries(Object.entries(street.items).map(([k, v]) => [k, v.length]));
  t.diagnostic(`street amenities ${street.stats.total}: ${JSON.stringify(counts)}`);
  for (const [kind, cap] of Object.entries(STREET_AMENITY_CAPS)) {
    assert.ok(counts[kind] <= cap, `${kind} over cap (${counts[kind]} > ${cap})`);
    assert.ok(counts[kind] > 0, `no ${kind} placed`);
  }
  assert.ok(street.stats.total > 3000, `street layer is sparse (${street.stats.total})`);
  // Exact pins (measured 2026-11-13, issue #362): the planner is
  // fully deterministic, so the census is pinned, not ranged.
  // No exclusions are passed here — the same convention as the
  // park amenities test, which pins 23,314 without exclusions
  // (my census reproduces that pin exactly). The boot passes
  // junction-cap exclusions, so the live count is a few lower.
  assert.equal(counts.bench, 2461, 'bench count');
  assert.equal(counts.chair, 557, 'chair count');
  assert.equal(counts.bin, 1305, 'bin count');
  assert.equal(counts.busStop, 497, 'bus-stop count');
  assert.equal(counts.bush, 1836, 'bush count');
  assert.equal(street.stats.total, 6656, 'total street amenities');
  // Bushes only where the band is wide enough: primary (2.5 m)
  // and secondary (2.2 m) bands carry them; tertiary (2.0 m),
  // residential (1.5 m) and unclassified bands do not.
  assert.equal(street.stats.byHighway.tertiary.bush, 0, 'no bushes on tertiary bands');
  assert.equal(street.stats.byHighway.residential.bush, 0, 'no bushes on residential bands');
  assert.ok(street.stats.byHighway.secondary.bush > 1000, 'secondary bands carry most bushes');
});

test('real tile: no item on a carriageway, in a lot, or on a lamp/tree', () => {
  const ways = (TAIPEI_GEO.roads || []).filter((r) => !['footway', 'path', 'steps', 'pedestrian', 'cycleway', 'corridor', 'elevator', 'crossing', 'platform', 'traffic_island'].includes(r.highway));
  // Per-way bounding boxes, so each item only tests the ways near
  // it. The planner's own check uses the same rule (within half +
  // 0.35 m of a way centreline = on the carriageway); this audit
  // re-derives it by brute force over the ways rather than through
  // the planner's segment grid, so a grid bug would show up here.
  const wayBoxes = ways.map((w) => {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i + 1 < w.pts.length; i += 2) {
      minX = Math.min(minX, w.pts[i]); maxX = Math.max(maxX, w.pts[i]);
      minZ = Math.min(minZ, w.pts[i + 1]); maxZ = Math.max(maxZ, w.pts[i + 1]);
    }
    return { w, half: Math.max((w.width || 3) / 2, 0.75), minX, minZ, maxX, maxZ };
  });
  const all = Object.entries(street.items).flatMap(([kind, list]) => list.map((it) => ({ kind, ...it })));
  for (const it of all) {
    for (const { w, half, minX, minZ, maxX, maxZ } of wayBoxes) {
      if (it.x < minX - half - 1 || it.x > maxX + half + 1) continue;
      if (it.z < minZ - half - 1 || it.z > maxZ + half + 1) continue;
      for (let i = 0; i + 3 < w.pts.length; i += 2) {
        const d = distToSegment(it.x, it.z, w.pts[i], w.pts[i + 1], w.pts[i + 2], w.pts[i + 3]);
        assert.ok(d >= half + 0.35 - 0.01, `${it.kind} at ${it.x.toFixed(1)},${it.z.toFixed(1)} inside a carriageway (d=${d.toFixed(2)} < half+0.35=${(half + 0.35).toFixed(2)})`);
      }
    }
  }
  // No item within the avoid radius of a lamp post or tree trunk.
  const avoid = [
    ...lamps.lamps.map((l) => ({ x: l.x, z: l.z, r: 0.4 })),
    ...streetTrees.trees.map((t) => ({ x: t.x, z: t.z, r: 0.5 })),
  ];
  let checked = 0;
  for (const it of all) {
    for (const a of avoid) {
      if (Math.abs(it.x - a.x) > 2 || Math.abs(it.z - a.z) > 2) continue;
      checked++;
      assert.ok(Math.hypot(it.x - a.x, it.z - a.z) >= a.r + 0.35 - 1e-9, `${it.kind} at ${it.x.toFixed(1)},${it.z.toFixed(1)} on a lamp/tree`);
    }
  }
  assert.ok(checked > 0, 'avoid audit examined near pairs');
});
