// Issue #61: elevated highway decks. Pins the deck set's coverage
// of the deck-flagged roadbeds, the height function's discipline
// (portal-to-peak profiles, 6% ramp cap, shared-node continuity, no
// floating ends), the pier placement rule (median/parallel
// exemptions only, never a lot, never a crossing street), the
// viaduct renderer's geometry on synthetic + real data, the height
// function end-to-end on a synthetic extract, and that the ground
// network (junctions, caps) is exactly what it was before decks.
import assert from 'node:assert/strict';
import test from 'node:test';
import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { detectJunctions } from '../js/taipei-markings.js';
import { planJunctionCaps } from '../js/taipei-junctions.js';
import { ribbonPoly, buildPolyGrid, pointInAnyPoly, pointInPoly } from '../js/taipei-painted.js';
import { buildMedianStrips } from '../js/taipei-surfaces.js';
import { planTaipeiBuildings } from '../js/taipei-buildings.js';
import { buildDeckGeometry, PARAPET_H } from '../js/taipei-viaduct.js';
import { buildElevated, isElevatedTags, deckTopForLayer } from '../tools/taipei/build-elevated.mjs';

const elev = TAIPEI_GEO.elevatedRoads;
const lines = elev?.lines || [];
const carriageways = (TAIPEI_GEO.roadbeds || []).filter((r) => r.surfaceClass !== 'path');

const lineSegs = [];
for (const l of lines) for (let i = 0; i + 3 < l.pts.length; i += 2)
  lineSegs.push([l.pts[i], l.pts[i + 1], l.pts[i + 2], l.pts[i + 3]]);
function distToDeck(x, z) {
  let best = Infinity;
  for (const [ax, az, bx, bz] of lineSegs) {
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
    let t = ((x - ax) * dx + (z - az) * dz) / L2;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(ax + t * dx - x, az + t * dz - z));
  }
  return best;
}

test('elevated data present at corridor scale', () => {
  assert.ok(elev, 'geodata carries elevatedRoads');
  assert.ok(lines.length >= 140, `${lines.length} deck lines`);
  assert.ok(elev.stats.lineKm >= 40, `${elev.stats.lineKm} km of deck`);
  assert.ok(elev.piers.length >= 600, `${elev.piers.length} piers`);
  for (const l of lines) assert.equal(l.pts.length, l.h.length * 2, 'pts/h arrays aligned');
});

test('every deck-flagged roadbed is covered by deck geometry', () => {
  const deckBeds = TAIPEI_GEO.roadbeds.filter((b) => b.deck);
  // Re-pinned for issue #102 (northern phase 1): the added boxes
  // carry the northern elevated network （洲美快速道路， 環河快速，
  // 汐止五股高架， 中山高/台北交流道 ramps) — deck-flagged beds
  // 132 -> 275, deck lines 152 -> 329 (45.9 -> 93.1 km). Per-box
  // census in the #102 evidence.
  // The count is 275, not the 278 the raw regen first produced:
  // the merged-bed deck rule in build-generation-map now requires
  // the elevated members to carry >= 35% of a group's claimed
  // length (was: ANY member). Three 大度路 groups at Guandu are
  // ground boulevards whose chains include one short bridge
  // segment each (~4% share); under ANY-member they inherited the
  // flag with deck geometry under only 15% of their length — the
  // failure this test caught. Full-length twin structures with
  // one untagged carriageway （麥帥一橋， 環河快速道路， ~50% share)
  // keep the flag; the flag diff at #102 is exactly those 3 beds.
  // Census re-pinned for issue #134: deck-flagged beds 275 -> 336
  // — the airport box brings the Keelung riverside expressway
  // system （堤頂/環東堤防， 麥帥橋 approaches) and the corridor
  // strip adds the 環河南路/水源快速道路 beds; the deck LINES grow
  // 329 -> 397 (93.1 -> 129.5 km) on the same ground (validate.mjs
  // corroborates: 336 flagged beds agree across builders).
  assert.equal(deckBeds.length, 336, 'deck-flagged bed count');
  for (const b of deckBeds) {
    let samples = 0, covered = 0;
    for (let i = 0; i + 3 < b.pts.length; i += 2) {
      const ax = b.pts[i], az = b.pts[i + 1], bx = b.pts[i + 2], bz = b.pts[i + 3];
      const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 8));
      for (let s = 0; s <= n; s++) {
        samples++;
        if (distToDeck(ax + ((bx - ax) * s) / n, az + ((bz - az) * s) / n) <= Math.max(b.width / 2, 6)) covered++;
      }
    }
    assert.ok(covered / samples >= 0.85, `${b.name} (${b.highway}) only ${(100 * covered / samples).toFixed(0)}% covered by deck lines`);
  }
});

test('height discipline: bounds, layer tops, shared-node continuity', () => {
  const topOf = (layer) => deckTopForLayer(layer);
  // Max layer top among lines through each exact coordinate.
  const topAt = new Map();
  const hAt = new Map();
  let sharedChecked = 0;
  for (const l of lines) for (let i = 0; i < l.h.length; i++) {
    const k = `${Math.round(l.pts[2 * i] * 10)},${Math.round(l.pts[2 * i + 1] * 10)}`;
    topAt.set(k, Math.max(topAt.get(k) ?? 0, topOf(l.layer)));
    if (hAt.has(k)) {
      sharedChecked++;
      assert.ok(Math.abs(hAt.get(k) - l.h[i]) <= 0.11, `shared node heights disagree at ${k}: ${hAt.get(k)} vs ${l.h[i]} (a step where two deck lines join)`);
    } else hAt.set(k, l.h[i]);
  }
  assert.ok(sharedChecked > 100, `continuity actually exercised (${sharedChecked} shared points)`);
  for (const l of lines) for (let i = 0; i < l.h.length; i++) {
    assert.ok(l.h[i] >= 0 && l.h[i] <= 21.051, `h ${l.h[i]} out of [0, 21] on ${l.name}`);
    if (l.h[i] > topOf(l.layer) + 0.051) {
      // Excess over the line's own layer top is legitimate only near
      // a node shared with a higher-layer way (an L1 ramp climbing
      // to an L2 interchange): a +-3 point window must explain it.
      let allow = topOf(l.layer);
      for (let j = Math.max(0, i - 3); j <= Math.min(l.h.length - 1, i + 3); j++)
        allow = Math.max(allow, topAt.get(`${Math.round(l.pts[2 * j] * 10)},${Math.round(l.pts[2 * j + 1] * 10)}`) ?? 0);
      assert.ok(l.h[i] <= allow + 0.051, `${l.name} h ${l.h[i]} exceeds every nearby layer top (${allow})`);
    }
  }
  // Named corridors reach their design deck tops.
  const peak = (substr) => Math.max(...lines.filter((l) => (l.name || '').includes(substr)).flatMap((l) => l.h));
  assert.ok(peak('建國快速道路') >= 8.9, `建國 peak ${peak('建國快速道路')}`);
  assert.ok(peak('市民大道') >= 14.9, `市民大道 peak ${peak('市民大道')} (L2 decks)`);
});

test('ramp slope never exceeds 6%', () => {
  for (const l of lines) for (let i = 1; i < l.h.length; i++) {
    const d = Math.hypot(l.pts[2 * i] - l.pts[2 * i - 2], l.pts[2 * i + 1] - l.pts[2 * i - 1]);
    if (d > 0.01) assert.ok(Math.abs(l.h[i] - l.h[i - 1]) <= 0.06 * d + 0.11, `${l.name}: slope ${(Math.abs(l.h[i] - l.h[i - 1]) / d).toFixed(3)} > 0.06`);
  }
});

test('no floating line ends: ground, shared, tile edge, or the parking ramps', () => {
  const boxes = TAIPEI_GEO.frame.boxes;
  const onBoundary = (x, z) => boxes.some((b) =>
    ((Math.abs(x - b.minX) < 1.5 || Math.abs(x - b.maxX) < 1.5) && z >= b.minZ - 1.5 && z <= b.maxZ + 1.5) ||
    ((Math.abs(z - b.minZ) < 1.5 || Math.abs(z - b.maxZ) < 1.5) && x >= b.minX - 1.5 && x <= b.maxX + 1.5));
  // Coarse point index for "another line passes here".
  const cell = new Map();
  lines.forEach((l, li) => {
    for (let i = 0; i < l.pts.length; i += 2) {
      const k = `${Math.floor(l.pts[i] / 0.3)},${Math.floor(l.pts[i + 1] / 0.3)}`;
      if (!cell.has(k)) cell.set(k, new Set());
      cell.get(k).add(li);
    }
  });
  const shared = (x, z, self) => {
    for (let gx = Math.floor(x / 0.3) - 1; gx <= Math.floor(x / 0.3) + 1; gx++)
      for (let gz = Math.floor(z / 0.3) - 1; gz <= Math.floor(z / 0.3) + 1; gz++)
        for (const li of cell.get(`${gx},${gz}`) || []) if (li !== self) return true;
    return false;
  };
  lines.forEach((l, li) => {
    for (const end of [0, l.h.length - 1]) {
      const x = l.pts[2 * end], z = l.pts[2 * end + 1];
      if (l.h[end] <= 0.051) continue;                    // landed at a portal
      if (shared(x, z, li)) continue;                    // continues on another line
      if (onBoundary(x, z)) continue;                    // clipped by the tile edge
      // 洛陽停車場 access ramps terminate at the parking structure
      // they serve — the one legitimate mid-tile elevated end.
      assert.ok((l.name || '').includes('停車場'), `${l.name} (way ${l.wayId}) ends floating at h=${l.h[end]} near (${x}, ${z})`);
    }
  });
});

test('piers: never in a lot, never in a crossing street, rhythmic on the flagships', () => {
  const lots = planTaipeiBuildings(TAIPEI_GEO).lots;
  const lotGrid = new Map();
  for (const lot of lots) {
    const k = `${Math.floor(lot.x / 50)},${Math.floor(lot.z / 50)}`;
    if (!lotGrid.has(k)) lotGrid.set(k, []);
    lotGrid.get(k).push(lot);
  }
  const inLot = (x, z) => {
    for (let gx = Math.floor(x / 50) - 1; gx <= Math.floor(x / 50) + 1; gx++)
      for (let gz = Math.floor(z / 50) - 1; gz <= Math.floor(z / 50) + 1; gz++)
        for (const lot of lotGrid.get(`${gx},${gz}`) || [])
          if (Math.abs(x - lot.x) <= lot.w / 2 && Math.abs(z - lot.z) <= lot.d / 2) return true;
    return false;
  };
  const groundBeds = TAIPEI_GEO.roadbeds.filter((b) => !b.deck);
  const ribbons = groundBeds.map((b) => ribbonPoly(b));
  const ribbonGrid = buildPolyGrid(ribbons);
  const med = buildMedianStrips(TAIPEI_GEO.roadbeds, null);
  // Median bands at ANY level (issue #167): ground strips plus the
  // deck bands — a pier in its own deck's median band is the
  // pier-island case, not a pier in a crossing carriageway.
  const medPolys = [...med.plain, ...med.planted, ...med.deckBands].map((quad) => [[quad[0], quad[1]], [quad[2], quad[3]], [quad[4], quad[5]], [quad[6], quad[7]]]);
  const medGrid = buildPolyGrid(medPolys);
  const bedParallelNear = (bed, p) => {
    const pts = bed.pts || [];
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3];
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
      let t = ((p.x - ax) * dx + (p.z - az) * dz) / L2;
      t = Math.max(0, Math.min(1, t));
      if (Math.hypot(ax + t * dx - p.x, az + t * dz - p.z) > 4) continue;
      if (Math.abs(Math.cos(Math.atan2(dx, dz) - p.yaw)) > 0.9) return true;
    }
    return false;
  };
  for (const p of elev.piers) {
    assert.ok(p.h > 0 && p.h <= 21, `pier height ${p.h}`);
    assert.ok(!inLot(p.x, p.z), `pier inside a building lot at (${p.x}, ${p.z})`);
    if (pointInAnyPoly(medGrid, medPolys, [p.x, p.z])) continue;
    const cellKey = `${Math.floor(p.x / 100)},${Math.floor(p.z / 100)}`;
    for (const ci of ribbonGrid.get(cellKey) || []) {
      if (!pointInPoly([p.x, p.z], ribbons[ci])) continue;
      assert.ok(bedParallelNear(groundBeds[ci], p), `pier in a crossing carriageway (${groundBeds[ci].name}) at (${p.x}, ${p.z})`);
    }
  }
  // Rhythm: on the two flagship corridors, high deck samples are
  // never far from a pier (junction spans are the only long ones).
  const pierGrid = new Map();
  elev.piers.forEach((p, i) => {
    const k = `${Math.floor(p.x / 40)},${Math.floor(p.z / 40)}`;
    if (!pierGrid.has(k)) pierGrid.set(k, []);
    pierGrid.get(k).push(i);
  });
  const nearPier = (x, z) => {
    let best = Infinity;
    for (let gx = Math.floor(x / 40) - 2; gx <= Math.floor(x / 40) + 2; gx++)
      for (let gz = Math.floor(z / 40) - 2; gz <= Math.floor(z / 40) + 2; gz++)
        for (const i of pierGrid.get(`${gx},${gz}`) || []) best = Math.min(best, Math.hypot(elev.piers[i].x - x, elev.piers[i].z - z));
    return best;
  };
  for (const name of ['建國快速道路', '市民大道高架道路']) {
    let samples = 0, far = 0;
    for (const l of lines.filter((x) => x.name === name)) {
      for (let i = 0; i + 3 < l.pts.length; i += 2) {
        if ((l.h[i / 2] + l.h[i / 2 + 1]) / 2 - elev.deckDepth <= 2.5) continue;
        const n = Math.max(1, Math.round(Math.hypot(l.pts[i + 2] - l.pts[i], l.pts[i + 3] - l.pts[i + 1]) / 8));
        for (let s = 0; s <= n; s++) {
          samples++;
          if (nearPier(l.pts[i] + ((l.pts[i + 2] - l.pts[i]) * s) / n, l.pts[i + 1] + ((l.pts[i + 3] - l.pts[i + 1]) * s) / n) > 26) far++;
        }
      }
    }
    assert.ok(samples > 100 && far / samples <= 0.02, `${name}: ${(100 * far / samples).toFixed(1)}% of high samples >26 m from a pier`);
  }
});

test('ground network unchanged: beds, junctions and caps exactly as before decks', () => {
  // Census re-pinned for issue #74 (station-district landmarks):
  // the memorial-park service-drive exclusion removed 22 service
  // beds inside 中正紀念公園 (5,792 -> 5,770) and their 6 internal
  // junctions (1,158 -> 1,152; caps 1,151 -> 1,145). The invariant
  // this test protects is unchanged: decks do not remove a single
  // bed or cap — the delta is #74's, documented in the
  // generation-map rule and the taipei-junctions census re-pin.
  // Census re-pinned for issue #83 (general park service-drive
  // exclusion): the rule generalized to every park — 62 more
  // rendered beds dropped (5,770 -> 5,708) and the park webs'
  // internal junctions dissolved (1,152 -> 1,136; caps 1,145 ->
  // 1,129). The invariant is unchanged, same reasoning as #74:
  // the delta is #83's, documented in the generation-map rule and
  // the taipei-junctions census re-pin.
  // Census re-pinned for issue #102 (northern phase 1): the tile
  // grew by the Red Line corridor, the Beitou box and the
  // incinerator connector — roadbeds 5,708 -> 11,804, junctions
  // 1,136 -> 2,361, caps 1,129 -> 2,354, each measured per box in
  // the #102 evidence census. The invariant is unchanged: the deck
  // layer removes nothing from the ground network; the delta is
  // #102's data growth, not the deck pass.
  // Census re-pinned for issue #134: roadbeds 11,804 -> 13,578,
  // junctions 2,361 -> 2,701 and caps 2,354 -> 2,694 (still
  // junctions - 7 roundabout-claimed) on the enlarged tile.
  assert.equal(TAIPEI_GEO.roadbeds.length, 13578, 'roadbed count unchanged (deck beds are flagged, not removed)');
  const junctions = detectJunctions(carriageways);
  assert.equal(junctions.length, 2701, 'ground junction detection unchanged');
  const caps = planJunctionCaps(carriageways, junctions);
  // Gate re-pin (PR #78 onto post-#77 main): caps = junctions minus the 7
  // junctions claimed by #77's handcrafted roundabout sites (Renai 4 +
  // Dongmen 3). The invariant this test protects is unchanged: decks do not
  // remove a single cap — the delta is #77's, documented in its audit.
  assert.equal(caps.length, 2623, 'junction caps still planned over the full bed set, deck beds included (2701 detected − 7 roundabout-claimed, #77; − 71 groundless phantoms dropped by the issue #178 ORPHAN rule — 20 of them the deck-interchange clusters this layer sits on)');
});

test('viaduct renderer: synthetic box section with parapets', () => {
  const geo = buildDeckGeometry({
    deckDepth: 1.8, piers: [],
    lines: [{ width: 10, pts: [0, 0, 50, 0, 100, 0], h: [9, 9, 9] }],
  });
  assert.equal(geo.lineCount, 1);
  // Per segment: slab top/bottom/sides 8 + parapets 12 + asphalt 2
  // = 22 tris; two segments + two end caps (2 tris each) = 48.
  assert.equal(geo.triCount, 48);
  const pos = geo.concrete.positions, nor = geo.concrete.normals;
  let maxY = -Infinity, minY = Infinity, topFaces = 0, bottomFaces = 0;
  for (let i = 0; i < pos.length; i += 3) { maxY = Math.max(maxY, pos[i + 1]); minY = Math.min(minY, pos[i + 1]); assert.ok(Number.isFinite(pos[i])); }
  for (let i = 0; i < nor.length; i += 9) {
    if (Math.abs(nor[i + 1] - 1) < 1e-6) topFaces++;
    if (Math.abs(nor[i + 1] + 1) < 1e-6) bottomFaces++;
  }
  assert.ok(Math.abs(maxY - (9 + PARAPET_H)) < 1e-3, 'parapet tops at deck + 1.1 m');
  assert.ok(Math.abs(minY - (9 - 1.8)) < 1e-3, 'slab underside at deck - depth');
  assert.ok(topFaces > 0 && bottomFaces > 0, 'both horizontal faces present');
  const ap = geo.asphalt.positions;
  for (let i = 1; i < ap.length; i += 3) assert.ok(Math.abs(ap[i] - 9.03) < 1e-3, 'asphalt rides 3 cm over the slab');
  // A ground-touching line renders as the low bed, no parapets.
  const low = buildDeckGeometry({ deckDepth: 1.8, piers: [], lines: [{ width: 8, pts: [0, 0, 40, 0], h: [0.3, 0.3] }] });
  let lowMax = -Infinity;
  for (let i = 1; i < low.concrete.positions.length; i += 3) lowMax = Math.max(lowMax, low.concrete.positions[i]);
  assert.ok(Math.abs(lowMax - 0.25) < 1e-3, 'low line is a flush bed, no parapet walls');
});

test('viaduct renderer on real data: sane merged geometry', () => {
  const geo = buildDeckGeometry(elev);
  assert.equal(geo.lineCount, lines.length);
  assert.equal(geo.pierCount, elev.piers.length);
  // 857 long raw-vertex segments x 22 tris + end caps ~= 19.3k.
  assert.ok(geo.triCount > 15000 && geo.triCount < 60000, `${geo.triCount} deck triangles`);
  let maxY = -Infinity;
  for (let i = 1; i < geo.concrete.positions.length; i += 3) {
    assert.ok(Number.isFinite(geo.concrete.positions[i]));
    maxY = Math.max(maxY, geo.concrete.positions[i]);
  }
  assert.ok(Math.abs(maxY - (21 + PARAPET_H)) < 0.06, `highest parapet at ${maxY} (L3 cap + parapet)`);
});

test('height function + pier rules on a synthetic extract', () => {
  // Frame constants copied from the builders (WGS84 meridian/prime
  // vertical radii at the tile origin).
  const A = 6378137.0, E2 = 6.69437999014e-3, PHI0 = (25.0330 * Math.PI) / 180, S0 = Math.sin(PHI0);
  const KX = (Math.PI / 180) * (A / Math.sqrt(1 - E2 * S0 * S0)) * Math.cos(PHI0);
  const KY = (Math.PI / 180) * (A * (1 - E2)) / Math.pow(1 - E2 * S0 * S0, 1.5);
  const ll = (x, z) => ({ lat: 25.0330 - z / KY, lon: 121.5650 + x / KX });
  const way = (id, tags, worldPts, nodeIds) => ({
    type: 'way', id, tags, nodes: nodeIds,
    geometry: worldPts.map(([x, z]) => ll(x, z)),
  });
  // Elevated L1 way running 900 m east from a portal shared with a
  // ground way; the ground way continues north from the same node.
  const elevPts = [[-450, -200], [-150, -200], [150, -200], [450, -200]];
  const elements = [
    way(1, { highway: 'primary', layer: '1', name: '測試高架' }, elevPts, [11, 12, 13, 14]),
    way(2, { highway: 'secondary', name: '測試路' }, [[-450, -200], [-450, 100]], [11, 21]),
  ];
  // A ground bed crossing the deck line perpendicularly at x=150
  // (piers must not land in it) and a lot sitting on the line at
  // x=-150 (likewise), both fed to the pier rejection.
  const crossBed = { name: '測試路', highway: 'secondary', width: 20, pedestrianLayout: 'none', pts: [150, -320, 150, -80], sourceWayIds: [77] };
  const lots = [{ x: -150, z: -200, w: 36, d: 36 }];
  const out = buildElevated(elements, [crossBed], lots);
  assert.equal(out.lines.length, 1, 'one deck line');
  const l = out.lines[0];
  assert.equal(l.h[0], 0, 'portal end at ground level');
  assert.ok(Math.abs(l.h[l.h.length - 1] - 9) < 0.051, `far end at the L1 deck top (${l.h[l.h.length - 1]})`);
  for (let i = 1; i < l.h.length; i++) {
    const d = Math.hypot(l.pts[2 * i] - l.pts[2 * i - 2], l.pts[2 * i + 1] - l.pts[2 * i - 1]);
    assert.ok(Math.abs(l.h[i] - l.h[i - 1]) <= 0.06 * d + 0.11, 'synthetic ramp respects the 6% cap');
  }
  assert.ok(out.piers.length >= 8, `piers along the open stretches (${out.piers.length})`);
  for (const p of out.piers) {
    assert.ok(Math.abs(p.x - 150) > 12, `pier inside the crossing street at x=${p.x}`);
    assert.ok(!(Math.abs(p.x + 150) <= 18 && Math.abs(p.z + 200) <= 18), `pier inside the lot at (${p.x}, ${p.z})`);
  }
  // Tag rules underpinning the set.
  assert.equal(deckTopForLayer(1), 9);
  assert.equal(deckTopForLayer(2), 15);
  assert.equal(deckTopForLayer(4), 21, 'layer 4 capped at the L3 top');
  assert.ok(isElevatedTags({ layer: '1' }) && isElevatedTags({ bridge: 'viaduct' }) && !isElevatedTags({ bridge: 'no' }) && !isElevatedTags({}));
});
