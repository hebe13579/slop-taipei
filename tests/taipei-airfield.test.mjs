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
import { buildAirfieldPaint, buildRoadTunnelPortals, AIRPORT_PARKING_PADS } from '../js/taipei-airfield.js';

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
  // Issue #124: 222 — the fine grid around the field puts four
  // more candidate centres inside the exclusion polygon; the
  // exclusion itself is unchanged and still drops every one.
  assert.equal(plan.stats.lotsDroppedAirfield, 222, 'airfield lots dropped, as #134');
});

// Issue #183: 復興北路 dives UNDER the field through the
// 復興北路車行地下道 (OSM ways 95015334 + 137317902, tunnel=yes,
// layer=-1). The generation map's rework v5 suppresses the bed's
// run inside the aerodrome site (the MRT digest's emit:false
// treatment for tunnel records) and records it in
// airfield.roadTunnels; the surface aprons outside the site stay
// as beds, both mouths get the #173 portal form, and the drive
// graph (built from the raw roads) keeps the route whole.
test('airfield road tunnel: the dive is suppressed, the mouths dressed, the route whole (issue #183)', () => {
  const tunnels = TAIPEI_GEO.airfield.roadTunnels;
  assert.ok(Array.isArray(tunnels), 'airfield.roadTunnels emitted by the geodata builder');
  assert.equal(tunnels.length, 1, 'exactly one road tunnel crosses the airfield site (the census: every other site road is at grade)');
  const t = tunnels[0];
  assert.equal(t.name, '復北地下道');
  assert.deepEqual(t.sourceWayIds, [95015334, 137317902], 'the two tunnel=yes carriageways');
  assert.equal(t.runs.length, 1, 'one suppressed run');
  assert.equal(t.mouths.length, 2, 'a mouth at each site-boundary crossing');
  assert.ok(t.lengthM > 470 && t.lengthM < 480, `suppressed length ${t.lengthM} m (473.2 m of run + the sub-apron scrap at the south fence)`);
  // The suppressed run lies inside the site ring.
  const ring = TAIPEI_GEO.airfield.site[0].ring;
  const run = t.runs[0];
  for (let i = 0; i + 3 < run.length; i += 2) {
    const mx = (run[i] + run[i + 2]) / 2, mz = (run[i + 1] + run[i + 3]) / 2;
    assert.ok(inRing(ring, mx, mz), `suppressed segment midpoint (${mx}, ${mz}) inside the site`);
  }
  // No bed carrying the tunnel ways survives at all: the v5 north
  // apron stub lay inside the #196 approach cut and was clipped
  // with it (generation-map rework v6).
  const beds = TAIPEI_GEO.roadbeds.filter((b) => b.sourceWayIds.some((w) => t.sourceWayIds.includes(w)));
  assert.equal(beds.length, 0, 'no surface bed of the tunnel ways survives (the north apron is inside the approach cut)');
  // Issue #196: every mouth records its approach cut, and no flat
  // bed remains inside either cut corridor — the trench floor
  // replaces them. (The one exception is documented in the map:
  // the 迴轉道 loop bed crosses the north corridor mid-bed and
  // stays whole as a bridge over the cut.)
  const corridorOf = (m) => {
    const hw = t.width / 2 + 0.3;
    const ux = -m.tx, uz = -m.tz, nx = -uz, nz = ux;
    const ex = m.x + ux * m.cut.lenM, ez = m.z + uz * m.cut.lenM;
    return [[m.x + nx * hw, m.z + nz * hw], [ex + nx * hw, ez + nz * hw], [ex - nx * hw, ez - nz * hw], [m.x - nx * hw, m.z - nz * hw]];
  };
  for (const m of t.mouths) {
    assert.ok(m.cut && m.cut.lenM > 20, `mouth (${m.x}, ${m.z}) carries an approach cut (${m.cut?.lenM} m)`);
    const corr = corridorOf(m);
    for (const b of TAIPEI_GEO.roadbeds) {
      if (b.sourceWayIds.includes(381570082)) continue; // the bridge exemption
      for (let i = 0; i + 3 < b.pts.length; i += 2) {
        const mx = (b.pts[i] + b.pts[i + 2]) / 2, mz = (b.pts[i + 1] + b.pts[i + 3]) / 2;
        assert.ok(!inRing(corr.flatMap((p) => p), mx, mz), `bed "${b.name}" segment midpoint (${mx}, ${mz}) inside a portal cut corridor`);
      }
    }
  }
  // Portal geometry (issue #196 trench form): 2 mouths × (4
  // headwall + 2 retaining walls + 2 copings) concrete quads, 2
  // dark bores and 1 asphalt floor quad per mouth, every face
  // pointing the right way.
  const portals = buildRoadTunnelPortals(TAIPEI_GEO.airfield);
  assert.equal(portals.stats.tunnels, 1);
  assert.equal(portals.stats.mouths, 2);
  assert.equal(portals.concrete.positions.length, 2 * 8 * 6 * 3, 'concrete soup: 8 quads per mouth');
  assert.equal(portals.dark.positions.length, 2 * 2 * 6 * 3, 'dark soup: 2 bores per mouth');
  assert.equal(portals.floor.positions.length, 2 * 1 * 6 * 3, 'floor soup: 1 quad per mouth');
  const quadNormal = (arr, qi) => {
    const o = qi * 18;
    return [arr[o], arr[o + 1], arr[o + 2]];
  };
  t.mouths.forEach((m, mi) => {
    const ux = -m.tx, uz = -m.tz; // out of the tunnel
    const nx = -uz, nz = ux;
    for (let qi = 0; qi < 4; qi++) {
      const n = quadNormal(portals.concrete.normals, mi * 8 + qi);
      assert.ok(n[0] * ux + n[2] * uz > 0.99, `mouth ${mi} headwall quad ${qi} faces out of the tunnel`);
    }
    for (let qi = 0; qi < 2; qi++) {
      const n = quadNormal(portals.dark.normals, mi * 2 + qi);
      assert.ok(n[0] * ux + n[2] * uz > 0.99, `mouth ${mi} bore ${qi} faces out of the tunnel`);
    }
    // Retaining walls: normals point INTO the cutting (±n by
    // side); copings face up; the floor faces up the ramp.
    const w0 = quadNormal(portals.concrete.normals, mi * 8 + 4);
    const w1 = quadNormal(portals.concrete.normals, mi * 8 + 6);
    assert.ok(w0[0] * nx + w0[2] * nz > 0.9, `mouth ${mi} -n wall faces into the cut`);
    assert.ok(w1[0] * -nx + w1[2] * -nz > 0.9, `mouth ${mi} +n wall faces into the cut`);
    for (const qi of [5, 7]) {
      const n = quadNormal(portals.concrete.normals, mi * 8 + qi);
      assert.ok(n[1] > 0.99, `mouth ${mi} coping quad ${qi} faces up`);
    }
    const fl = quadNormal(portals.floor.normals, mi);
    assert.ok(fl[1] > 0.9, `mouth ${mi} trench floor faces up`);
    // The face is seated at the trench bottom: the mouth's
    // concrete spans from below the trench floor to about grade.
    let mn = Infinity, mx = -Infinity;
    for (let v = 0; v < 8 * 6; v++) {
      const y = portals.concrete.positions[(mi * 8 * 6 + v) * 3 + 1];
      mn = Math.min(mn, y); mx = Math.max(mx, y);
    }
    assert.ok(Math.abs(mn - -5.9) < 1e-6 && Math.abs(mx - 0.35) < 1e-6, `mouth ${mi} face spans ${mn}..${mx} m (trench bottom to grade)`);
  });
  // The drive graph never lost the route: both tunnel carriageway
  // edges exist and each connects its south portal node to its
  // north portal node inside the main component.
  const g = TAIPEI_GEO.roadGraph;
  const tun = g.edges.filter((e) => e.name === '復北地下道');
  assert.equal(tun.length, 2, 'both carriageways are graph edges');
  const adj = new Map();
  for (const e of g.edges) {
    if (!adj.has(e.a)) adj.set(e.a, []);
    if (!adj.has(e.b)) adj.set(e.b, []);
    adj.get(e.a).push(e.b);
    adj.get(e.b).push(e.a);
  }
  for (const e of tun) {
    const za = g.nodes[e.a * 2 + 1], zb = g.nodes[e.b * 2 + 1];
    const south = za > zb ? e.a : e.b, north = south === e.a ? e.b : e.a;
    const seen = new Set([south]);
    const queue = [south];
    while (queue.length) {
      const n = queue.pop();
      for (const m of adj.get(n) || []) if (!seen.has(m)) { seen.add(m); queue.push(m); }
    }
    assert.ok(seen.has(north), 'south portal node reaches the north portal node (graph unbroken end to end)');
  }
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
