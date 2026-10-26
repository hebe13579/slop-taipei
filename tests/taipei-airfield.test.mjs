// Issue #135 enforcement: Songshan Airport's site structures
// and airfield paint.
//
// Part B of #135 puts the T1/T2 terminal complex and the
// car parks on the #134 aerodrome site as SITE structures —
// resolved through the landmark massing path but deliberately
// NOT registry landmarks (no pins, no search names) — and
// paints the field: runway threshold keys, designators 10/28,
// centreline dashes, edge lines and aiming-point bars in
// white; taxiway centrelines, edge double-lines and stand
// lead-ins in yellow. The paint is a surface layer only: this
// audit pins that (a) the geodata carries the paint source
// geometry, (b) every paint quad stays inside the aerodrome
// site ring, (c) both designators are actually painted, (d)
// the #134 exclusion counts do not regress, and (e) the
// terminal structures stand where the OSM outlines put them,
// at their pinned tops, with no procedural lot on their site
// rects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { planTaipeiBuildings, taipeiLandmarkStructures } from '../js/taipei-buildings.js';
import { buildAirfieldPaint, AIRPORT_PARKING_PADS } from '../js/taipei-airfield.js';

const plan = planTaipeiBuildings(TAIPEI_GEO);
const paint = buildAirfieldPaint(TAIPEI_GEO.airfield);

const inRing = (ring, x, z) => {
  let c = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i], zi = ring[i + 1], xj = ring[j], zj = ring[j + 1];
    if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) c = !c;
  }
  return c;
};

test('geodata carries the paint source geometry (issue #135)', () => {
  const p = TAIPEI_GEO.airfield.paint;
  assert.ok(p, 'airfield.paint emitted by the geodata builder');
  assert.equal(p.runway.length, 1, 'one runway');
  assert.equal(p.runway[0].ref, '10/28', 'Songshan is a single 10/28 runway');
  assert.equal(p.taxiways.length, 38, 'taxiway centrelines as mapped');
  assert.equal(p.stands.length, 44, 'parking positions as mapped');
});

test('paint stays on the site and costs what the PR states', (t) => {
  const site = TAIPEI_GEO.airfield.site[0].ring;
  let outside = 0;
  for (const list of [paint.white, paint.yellowCentre, paint.yellowEdge]) {
    for (const q of list) {
      const cx = (q[0] + q[4]) / 2, cz = (q[1] + q[5]) / 2;
      if (!inRing(site, cx, cz)) outside++;
    }
  }
  assert.equal(outside, 0, 'no paint quad centre leaves the aerodrome site');
  for (const ring of paint.pads) {
    for (let i = 0; i < ring.length; i += 2) assert.ok(inRing(site, ring[i], ring[i + 1]), 'car-park pad corner inside the site');
  }
  t.diagnostic(`airfield paint: ${JSON.stringify(paint.stats)}`);
  assert.equal(paint.stats.quads, paint.white.length + paint.yellowCentre.length + paint.yellowEdge.length);
  assert.equal(paint.stats.triangles, paint.stats.quads * 2);
  assert.ok(paint.stats.triangles < 5000, `paint is a light surface layer (${paint.stats.triangles} tris)`);
  assert.ok(Math.abs(paint.stats.taxiwayCentreM - 8490) < 100, 'taxiway centrelines painted at the mapped length');
  assert.equal(paint.stats.stands, 44, 'every stand gets its lead-in line');
});

test('every paint quad faces up (the winding the renderer culls on)', () => {
  // quadsGeometry builds triangles (0,1,2)(0,2,3) and the boot
  // materials are single-sided: a quad wound the wrong way is
  // invisible from the air. This is the invariant the first
  // #135 render pass missed — the paint existed, faced down,
  // and only the close-up threshold renders caught it.
  for (const list of [paint.white, paint.yellowCentre, paint.yellowEdge]) {
    for (const q of list) {
      const ax = q[2] - q[0], az = q[3] - q[1];
      const bx = q[4] - q[0], bz = q[5] - q[1];
      assert.ok(az * bx - ax * bz > 0, `quad at ${q[0]},${q[1]} faces up`);
    }
  }
});

test('both runway designators are painted, thresholds keyed', () => {
  // Glyph-cell quads are 2.6 m squares; count white quads whose
  // centres fall in each threshold's designator zone (boxes
  // measured on the built geometry: the west threshold sits at
  // the centreline's west end, the east at its east end).
  const inBox = (q, x0, x1, z0, z1) => {
    const cx = (q[0] + q[4]) / 2, cz = (q[1] + q[5]) / 2;
    return cx >= x0 && cx <= x1 && cz >= z0 && cz <= z1;
  };
  const west = paint.white.filter((q) => inBox(q, -2560, -2400, -4170, -4040));
  const east = paint.white.filter((q) => inBox(q, -110, 40, -4080, -3940));
  assert.ok(west.length >= 30, `west threshold zone painted (${west.length} quads: keys + "10" cells)`);
  assert.ok(east.length >= 30, `east threshold zone painted (${east.length} quads: keys + "28" cells)`);
  // Runway body paint exists between the thresholds: edge lines
  // and centreline dashes along the middle kilometre (measured
  // 9 quads with centres in this box: 2 edge strips + 7 dash
  // pieces — the invariant is presence, not the exact census).
  const mid = paint.white.filter((q) => inBox(q, -1500, -1100, -4150, -3980));
  assert.ok(mid.length >= 8, `mid-runway paint present (${mid.length} quads)`);
});

test('the #134 site exclusion does not regress', () => {
  assert.equal(plan.stats.blocksSkippedAirfield, 45, 'airfield blocks skipped, as #134');
  assert.equal(plan.stats.lotsDroppedAirfield, 218, 'airfield lots dropped, as #134');
});

test('terminal site structures: placed, topped, lot-free, off the registry', () => {
  const byId = Object.fromEntries(plan.siteStructures.map((s) => [s.id, s]));
  const expected = {
    'songshan-terminal-t1-west': { x: -1318, z: -3427, top: 17.6 },
    'songshan-terminal-t1-east': { x: -1138, z: -3462, top: 17.6 },
    'songshan-terminal-t2': { x: -1496, z: -3426, top: 14.4 },
    'songshan-observation-deck': { x: -1473, z: -3485, top: 10 },
  };
  assert.deepEqual(Object.keys(byId).sort(), Object.keys(expected).sort(), 'the four terminal structures');
  for (const [id, e] of Object.entries(expected)) {
    const s = byId[id];
    assert.ok(Math.abs(s.x - e.x) <= 1 && Math.abs(s.z - e.z) <= 1, `${id} at its OSM-measured centre (${s.x}, ${s.z})`);
    const top = Math.max(...s.parts.map((p) => (p.y0 || 0) + p.h + (p.ridgeH || 0)));
    assert.ok(Math.abs(top - e.top) < 0.01, `${id} tops at ${e.top} (got ${top})`);
    // No procedural lot on the structure's site rect.
    const r = s.sites[0];
    for (const lot of plan.lots) {
      const hw = (lot.w || 10) / 2, hd = (lot.d || 10) / 2;
      assert.ok(!(lot.x + hw > r.minX && lot.x - hw < r.maxX && lot.z + hd > r.minZ && lot.z - hd < r.maxZ), `lot intrudes ${id}'s site rect`);
    }
  }
  // Site structures are NOT registry landmarks: no pins/search.
  const registry = taipeiLandmarkStructures(TAIPEI_GEO);
  assert.ok(!registry.some((s) => Object.hasOwn(expected, s.id)), 'terminal structures stay off the landmark registry');
  assert.ok(registry.some((s) => s.id === 'taipei-twin-towers'), 'the Twin Towers ARE on the registry');
  assert.ok(AIRPORT_PARKING_PADS.length === 3, 'three satellite-measured car-park pads');
});
