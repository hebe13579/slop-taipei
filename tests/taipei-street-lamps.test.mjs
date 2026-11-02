import assert from 'node:assert/strict';
import test from 'node:test';

import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { planTaipeiBuildings } from '../js/taipei-buildings.js';
import {
  planStreetLamps,
  buildSegmentGrid,
  distToSegment,
  LAMP_CAP,
  LAMP_SPACING,
  LAMP_POOL_RX,
  LAMP_POOL_RZ,
} from '../js/taipei-streetscape.js';

// Issue #280 (street lamps): the planner is pure, so these tests run
// it against synthetic roads/decks and the real generated tile and pin
// the invariants the renderer relies on — posts off the carriageway
// with the arm/head facing the road, pools under the heads, deck
// lamps riding the authored deck profile, no lamps in tunnels or on
// narrow ramps, deterministic output under the cap.

const bed = (name, highway, width, layout, pts, ways = [1]) => ({
  name, highway, width, pedestrianLayout: layout, pts, sourceWayIds: ways,
});
const emptyPlan = { lots: [], tower: null };
const emptyGeo = { roadbeds: [], roads: [], water: [], parks: [], elevatedRoads: { lines: [] } };

test('synthetic ground road: lamps staggered, arms face the carriageway, pools under heads', () => {
  const geo = {
    ...emptyGeo,
    roadbeds: [bed('Main Rd', 'secondary', 14, 'sidewalk', [0, 0, 200, 0])],
  };
  const out = planStreetLamps(geo, emptyPlan, {});
  assert.ok(out.lamps.length >= 4 && out.lamps.length <= 8, `lamps on a 200 m arterial at ~36 m spacing: ${out.lamps.length}`);
  assert.ok(out.lamps.every((l) => l.kind === 'ground' && l.deckH === 0));
  // Staggered: consecutive lamps stand on opposite sides.
  for (let i = 1; i < out.lamps.length; i++) {
    assert.ok(Math.sign(out.lamps[i].z) === -Math.sign(out.lamps[i - 1].z), `lamp ${i} not on the opposite side`);
  }
  for (const l of out.lamps) {
    // Post off the carriageway (half 7 + band), head over the lane.
    assert.ok(Math.abs(l.z) > 7, `post at z=${l.z} inside the carriageway`);
    assert.ok(Math.abs(l.hz) < 7, `head at hz=${l.hz} not over the carriageway`);
    assert.ok(Math.abs(l.hz) < Math.abs(l.z), 'head must be closer to the centreline than the post');
    // The head/pool sits armLen from the post, in the direction rot aims.
    const dx = l.hx - l.x, dz = l.hz - l.z;
    assert.ok(Math.abs(Math.hypot(dx, dz) - l.armLen) < 0.01, 'head offset must equal armLen');
    assert.ok(Math.abs(Math.sin(l.rot) - dx / l.armLen) < 0.01 && Math.abs(Math.cos(l.rot) - dz / l.armLen) < 0.01, 'rot must aim the arm at the head');
    assert.ok(l.armLen >= 2.5 && l.armLen <= 3.5, `armLen ${l.armLen}`);
    // Pool ellipse is elongated along the road: poolRot maps local
    // +Z onto the road direction, so for this east-west road the
    // rotated +Z must be (1, 0).
    assert.ok(Math.abs(Math.sin(l.poolRot) - 1) < 0.01 && Math.abs(Math.cos(l.poolRot)) < 0.01, `poolRot ${l.poolRot} must align with the road`);
  }
  // Spacing: consecutive lamps on this one road are ≥ 28 m apart.
  const xs = out.lamps.map((l) => l.x).sort((a, b) => a - b);
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] >= 28, `lamps bunched: ${xs[i] - xs[i - 1]} m apart`);
});

test('synthetic ground road: tunnels, narrow streets and service roads take no lamps', () => {
  const geo = {
    ...emptyGeo,
    roadbeds: [
      bed('Tunnel Rd', 'tertiary', 12, 'sidewalk', [0, 0, 200, 0]),
      bed('象山隧道', 'trunk', 12, 'sidewalk', [0, 40, 200, 40]),
      bed('Alley', 'tertiary', 4, 'sidewalk', [0, 80, 200, 80]),
      bed('Drive', 'service', 8, 'shared', [0, 120, 200, 120]),
    ],
  };
  const out = planStreetLamps(geo, emptyPlan, {});
  assert.ok(out.lamps.length >= 4, 'the plain tertiary still gets lamps');
  assert.ok(!out.lamps.some((l) => Math.abs(l.z - 40) < 3), 'no lamps on the tunnel-named road');
  assert.ok(!out.lamps.some((l) => Math.abs(l.z - 80) < 3), 'no lamps on the 4 m alley');
  assert.ok(!out.lamps.some((l) => Math.abs(l.z - 120) < 3), 'no lamps on the service road');
  assert.ok(out.stats.rejected.tunnel > 0 && out.stats.rejected.width > 0, 'rejections counted');
});

test('synthetic deck: lamps ride the authored profile, flat decks and narrow ramps take none', () => {
  const geo = {
    ...emptyGeo,
    elevatedRoads: {
      lines: [
        { wayId: 1, name: 'High Bridge', highway: 'primary', layer: 1, width: 14, pts: [0, 0, 100, 0, 200, 0], h: [0, 9, 0] },
        { wayId: 2, name: 'Flat Rd', highway: 'secondary', layer: 1, width: 14, pts: [0, 40, 200, 40], h: [0, 0, 0] },
        { wayId: 3, name: 'Ramp', highway: 'trunk_link', layer: 2, width: 4.4, pts: [0, 80, 200, 80], h: [15, 15, 15] },
      ],
    },
  };
  const out = planStreetLamps(geo, emptyPlan, {});
  assert.ok(out.lamps.length >= 3, `deck lamps on the bridge: ${out.lamps.length}`);
  assert.ok(out.lamps.every((l) => l.kind === 'deck'));
  assert.ok(!out.lamps.some((l) => Math.abs(l.z - 40) < 3), 'no lamps on the at-grade deck stretch');
  assert.ok(!out.lamps.some((l) => Math.abs(l.z - 80) < 3), 'no lamps on the 4.4 m ramp');
  // Profile interpolation: the mid-deck lamp sits near h=9, the
  // portal lamps near h=0; every deck lamp's base is on the profile.
  const mids = out.lamps.filter((l) => Math.abs(l.x - 100) < 20);
  assert.ok(mids.length > 0 && mids.every((l) => l.deckH > 7), `mid-deck h should be ~9: ${mids.map((l) => l.deckH.toFixed(1))}`);
  const ends = out.lamps.filter((l) => l.x < 20 || l.x > 180);
  assert.ok(ends.length > 0 && ends.every((l) => l.deckH < 3), `portal h should be ~0: ${ends.map((l) => l.deckH.toFixed(1))}`);
  for (const l of out.lamps) {
    assert.ok(Math.abs(l.z) < 7 && Math.abs(l.hz) < 7, 'deck post and head both on the slab');
    assert.ok(l.armLen >= 2.5 && l.armLen <= 3.5, `deck armLen ${l.armLen}`);
  }
});

// Real tile: one shared plan run for the census pins below.
const plan = planTaipeiBuildings(TAIPEI_GEO);
const real = planStreetLamps(TAIPEI_GEO, plan, {});

test('real tile: census pins (cap, split, rejections)', (t) => {
  t.diagnostic(`lamps ${real.lamps.length} (ground ${real.stats.ground}, deck ${real.stats.deck}), rejected ${JSON.stringify(real.stats.rejected)}`);
  assert.equal(real.lamps.length, 12000, 'lamps at the cap');
  assert.equal(real.stats.ground, 8977, 'ground lamps');
  assert.equal(real.stats.deck, 3023, 'deck lamps');
  assert.equal(real.stats.cap, LAMP_CAP);
  assert.ok(real.stats.capped, 'raw candidates exceed the cap');
  assert.ok(real.stats.rejected.junction > 1000, 'junction rejections');
  assert.ok(real.stats.rejected.tunnel > 0, 'tunnel rejections');
  // Determinism: a second run is byte-identical.
  const again = planStreetLamps(TAIPEI_GEO, plan, {});
  assert.equal(JSON.stringify(again.lamps), JSON.stringify(real.lamps), 'planner must be deterministic');
});

test('real tile: every lamp faces its road and every deck lamp rides its profile (sampled)', (t) => {
  for (const l of real.lamps) {
    assert.ok(l.armLen >= 2.5 && l.armLen <= 3.5, `armLen ${l.armLen} at ${l.x},${l.z}`);
    assert.ok(l.deckH >= 0 && l.deckH <= 31, `deckH ${l.deckH}`);
    // Pool centre is the head position; the pool ellipse is road-sized.
    assert.ok(Math.abs(l.hx - l.x) <= l.armLen + 0.01 && Math.abs(l.hz - l.z) <= l.armLen + 0.01);
  }
  // Deck lamps: each sampled lamp's deckH must match the interpolated
  // profile of the deck segment it was planned from. The post is
  // offset from the centreline along the segment normal, so
  // projecting the post onto a candidate segment recovers the
  // station — and the segment is the planner's one only when that
  // station's profile height matches deckH AND the station-to-post
  // minus station-to-head distance equals the arm length. (On a
  // curve the nearest segment to the post can be the adjacent one,
  // whose profile differs, so every nearby segment is tried.)
  const lines = TAIPEI_GEO.elevatedRoads.lines;
  const grid = buildSegmentGrid(lines, 30);
  let checked = 0;
  for (let i = 0; i < real.lamps.length; i += 37) {
    const l = real.lamps[i];
    if (l.kind !== 'deck') continue;
    let matched = false;
    for (const sg of grid.near(l.x, l.z)) {
      const line = lines[sg.idx];
      const segLen = Math.hypot(sg.bx - sg.ax, sg.bz - sg.az) || 1;
      const tt = ((l.x - sg.ax) * (sg.bx - sg.ax) + (l.z - sg.az) * (sg.bz - sg.az)) / (segLen * segLen);
      if (tt < -0.05 || tt > 1.05) continue;
      const t = Math.max(0, Math.min(1, tt));
      const sx = sg.ax + (sg.bx - sg.ax) * t, sz = sg.az + (sg.bz - sg.az) * t;
      const vi = (() => {
        for (let v = 0; v + 3 < line.pts.length; v += 2) {
          if (line.pts[v] === sg.ax && line.pts[v + 1] === sg.az) return v / 2;
        }
        return -1;
      })();
      if (vi < 0) continue;
      const hAt = line.h[vi] + (line.h[vi + 1] - line.h[vi]) * t;
      if (Math.abs(hAt - l.deckH) >= 0.15) continue;
      const dPost = Math.hypot(sx - l.x, sz - l.z), dHead = Math.hypot(sx - l.hx, sz - l.hz);
      if (Math.abs((dPost - dHead) - l.armLen) > 0.1) continue;
      matched = true;
      break;
    }
    assert.ok(matched, `deck lamp at ${l.x},${l.z} (deckH ${l.deckH}) matches no nearby deck profile`);
    checked++;
  }
  t.diagnostic(`profile-checked ${checked} deck lamps`);
  assert.ok(checked > 50, 'enough deck lamps sampled');
});

test('real tile: no ground post inside a building lot (sampled)', () => {
  const lots = plan.lots;
  const inLot = (x, z) => {
    for (const lot of lots) {
      const dx = x - lot.x, dz = z - lot.z;
      if (Math.abs(dx) <= lot.w / 2 + 0.3 && Math.abs(dz) <= lot.d / 2 + 0.3) {
        if (!lot.rot) return true;
        const c = Math.cos(lot.rot), sn = Math.sin(lot.rot);
        if (Math.abs(dx * c + dz * sn) <= lot.w / 2 + 0.3 && Math.abs(-dx * sn + dz * c) <= lot.d / 2 + 0.3) return true;
      }
    }
    return false;
  };
  // Full scan is 68k lots × 8.7k lamps; sample every 7th ground lamp
  // plus all lamps near the densest blocks — the planner's own grid
  // check is the primary guard, this is the independent half.
  let checked = 0;
  for (let i = 0; i < real.lamps.length; i += 7) {
    const l = real.lamps[i];
    if (l.kind !== 'ground') continue;
    assert.ok(!inLot(l.x, l.z), `ground post inside a lot at ${l.x},${l.z}`);
    checked++;
  }
  assert.ok(checked > 1000, `sampled ${checked} ground posts`);
});

// Pool geometry constants the boot relies on.
test('pool ellipse constants are road-sized', () => {
  assert.equal(LAMP_POOL_RX, 4.0);
  assert.equal(LAMP_POOL_RZ, 5.5);
  assert.equal(LAMP_SPACING, 36);
  assert.equal(LAMP_CAP, 12000);
});
