// Issue #151: signature bridges （重陽橋 / 社子大橋 / 麥帥一橋 /
// 彩虹橋 / 大直橋）. The crossings' decks already render as plain
// slabs from the OSM bridge ways; js/taipei-bridges.js adds only
// the signature structure, snapped onto the drawn centrelines.
// These tests pin: the module's WGS84 converter against the
// building planner's, every def resolving onto a drawn deck near
// its satellite-measured anchor, the cited heights, every stay /
// hanger landing on a drawn deck, and nothing below grade.
import assert from 'node:assert/strict';
import test from 'node:test';
import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { latLonToTile } from '../js/taipei-buildings.js';
import { BRIDGE_DEFS, buildBridgeGeometry, bridgeLatLonToTile } from '../js/taipei-bridges.js';

const O = TAIPEI_GEO.frame.originLatLon;
const lines = TAIPEI_GEO.elevatedRoads.lines;
const G = buildBridgeGeometry(TAIPEI_GEO);
const byId = Object.fromEntries(G.bridges.map((b) => [b.id, b]));

function distToNearestLine(pt) {
  let best = Infinity;
  for (const L of lines) {
    for (let k = 0; k + 3 < L.pts.length + 1; k += 2) {
      if (k + 3 > L.pts.length - 1 && L.pts.length % 2) break;
      const ax = L.pts[k], az = L.pts[k + 1];
      const bx = L.pts[k + 2], bz = L.pts[k + 3];
      if (bx === undefined) break;
      const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
      let t = len2 ? ((pt[0] - ax) * dx + (pt[1] - az) * dz) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(pt[0] - (ax + dx * t), pt[1] - (az + dz * t));
      if (d < best) best = d;
    }
  }
  return best;
}

test('bridge converter matches the planner WGS84 conversion on every anchor', () => {
  const pts = [];
  for (const d of BRIDGE_DEFS) {
    if (d.towers) pts.push(...d.towers);
    if (d.anchor) pts.push(d.anchor);
    if (d.path) pts.push(...d.path);
  }
  assert.ok(pts.length >= 12);
  for (const [la, lo] of pts) {
    assert.deepEqual(bridgeLatLonToTile(la, lo, O), latLonToTile(la, lo, O), `${la},${lo}`);
  }
});

test('five bridges build non-trivial geometry', () => {
  assert.equal(G.bridges.length, 5);
  for (const b of G.bridges) {
    assert.ok(b.triCount > 150, `${b.id} triCount ${b.triCount}`);
    assert.ok(b.maxY > 20, `${b.id} maxY ${b.maxY}`);
  }
  assert.equal(G.triCount, G.bridges.reduce((s, b) => s + b.triCount, 0));
  assert.equal(G.positions.length, G.triCount * 9);
});

test('cited heights: tower/pylon/arch crowns match the references', () => {
  assert.ok(Math.abs(byId.chongyang.maxY - 72) < 0.6, `chongyang ${byId.chongyang.maxY}`);
  assert.ok(Math.abs(byId.shezi.maxY - 105) < 0.6, `shezi ${byId.shezi.maxY}`);
  // MacArthur crown is an absolute height over the water (rise 30 m
  // from the low real springings); the rib springs from the drawn
  // deck, so what is pinned is the crown itself.
  assert.ok(Math.abs(byId.macarthur.maxY - 37.3) < 0.8, `macarthur ${byId.macarthur.maxY}`);
  assert.ok(Math.abs(byId.rainbow.maxY - (6.4 + 18)) < 0.8, `rainbow ${byId.rainbow.maxY}`);
  assert.ok(Math.abs(byId.dazhi.maxY - 69.4) < 0.6, `dazhi ${byId.dazhi.maxY}`);
});

test('bridge centres sit at the satellite-measured anchors', () => {
  const expect = {
    chongyang: [25.085048, 121.50255], // midpoint of the two towers
    shezi: [25.110868, 121.495165],
    macarthur: [25.052, 121.572],
    rainbow: [25.052372, 121.576677],  // mid-path digitized point
    dazhi: [25.075641, 121.544373],
  };
  for (const [id, [la, lo]] of Object.entries(expect)) {
    const want = bridgeLatLonToTile(la, lo, O);
    const got = byId[id].centre;
    const d = Math.hypot(got[0] - want[0], got[1] - want[1]);
    assert.ok(d < 30, `${id} centre off by ${d.toFixed(1)} m`);
  }
});

test('every stay/hanger of the deck bridges lands on a drawn deck', () => {
  for (const id of ['chongyang', 'shezi', 'macarthur', 'dazhi']) {
    const b = byId[id];
    assert.ok(b.stays.length >= 8, `${id} stays ${b.stays.length}`);
    for (const s of b.stays) {
      const d = distToNearestLine([s[0], s[2]]);
      assert.ok(d < 14, `${id} stay at (${s[0].toFixed(0)}, ${s[2].toFixed(0)}) is ${d.toFixed(1)} m from any deck centreline`);
      assert.ok(s[1] > 0.5 && s[1] < 30, `${id} stay deck anchor y=${s[1].toFixed(1)}`);
    }
  }
  // Rainbow has no drawn deck (it IS the deck): its hangers land on
  // its own ribbon at deck-top height instead.
  for (const s of byId.rainbow.stays) {
    assert.ok(Math.abs(s[1] - 6.45) < 0.2, `rainbow hanger y=${s[1]}`);
  }
});

test('stay counts match the cited fans', () => {
  // Chongyang: 9 stays per fan (cited), symmetric in both
  // directions, two planes, two towers: 9 x 2 x 2 x 2 = 72.
  assert.equal(byId.chongyang.stays.length, 72);
  // Shezi: (9 main + 5 back) x two planes.
  assert.equal(byId.shezi.stays.length, 28);
  // Dazhi: 8 main + 4 back, single central plane.
  assert.equal(byId.dazhi.stays.length, 12);
  // MacArthur: vertical hangers across the 170 m span.
  assert.equal(byId.macarthur.stays.length, 14);
});

test('no bridge geometry below grade', () => {
  // Members that START at grade (pylon legs, the Dazhi column)
  // bury the lower corner of their first beam segment by the
  // cross-section depth (<=0.31 m measured) — invisible under the
  // ground/water surface and it closes any floating gap. Anything
  // deeper would be a placement bug.
  for (let i = 1; i < G.positions.length; i += 3) {
    assert.ok(G.positions[i] >= -0.5, `vertex y=${G.positions[i]}`);
  }
});
