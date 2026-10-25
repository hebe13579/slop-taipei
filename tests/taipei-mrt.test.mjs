// Issue #118: MRT Red Line （淡水信義線） elevated completion.
// Pins the user's ground-truth spec against the emitted geodata:
// underground through 民權西路 (nothing at surface), a portal ramp
// inside 民權西路→圓山， the guideway at full height 圓山→北投
// inclusive plus the 新北投支線， an at-grade low bed after Beitou
// through 復興崗/忠義/關渡， the deck discipline (6% ramps, no
// floating ends, piers off lots and crossing carriageways), and the
// elevated station defs + geometry (Yuanshan-pattern standard,
// Jiantan / Beitou / Xinbeitou iconic kinds).
import assert from 'node:assert/strict';
import test from 'node:test';
import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { ribbonPoly, buildPolyGrid, pointInAnyPoly, pointInPoly } from '../js/taipei-painted.js';
import { buildMedianStrips } from '../js/taipei-surfaces.js';
import { planTaipeiBuildings } from '../js/taipei-buildings.js';
import { buildMrtStationGeometry, mrtStationFootprint } from '../js/taipei-mrt-stations.js';

const decks = TAIPEI_GEO.mrtDecks;
const lines = decks?.lines || [];
const stations = TAIPEI_GEO.mrtStations || [];

// Station anchors (OSM-derived positions, snapped to the alignment
// by the digest) — the spec's checkpoints, in world metres.
const AT = {
  minquan: [-4583, -3219], yuanshan: [-4528, -4256], jiantan: [-4039, -5682],
  shilin: [-3923, -6697], zhishan: [-4287, -7755], mingde: [-4678, -8546],
  shipai: [-4993, -9040], qilian: [-5941, -9738], qiyan: [-6445, -10258],
  beitou: [-6702, -10959], fuxinggang: [-8024, -11575], zhongyi: [-9247, -10850],
  guandu: [-9878, -10269], xinbeitou: [-6240, -11516],
};
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

function nearestLinePoint(x, z) {
  let best = null, bd = Infinity;
  for (const l of lines) {
    for (let i = 0; i + 3 < l.pts.length; i += 2) {
      const ax = l.pts[i], az = l.pts[i + 1], bx = l.pts[i + 2], bz = l.pts[i + 3];
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
      let t = ((x - ax) * dx + (z - az) * dz) / L2;
      t = Math.max(0, Math.min(1, t));
      const px = ax + t * dx, pz = az + t * dz;
      const d = Math.hypot(px - x, pz - z);
      if (d < bd) { bd = d; best = { d, h: l.h[i / 2] + (l.h[i / 2 + 1] - l.h[i / 2]) * t, line: l }; }
    }
  }
  return best;
}

test('mrt data present: sibling field, corridor scale', () => {
  assert.ok(decks, 'geodata carries mrtDecks');
  assert.ok(lines.length >= 30, `${lines.length} mrt deck lines`);
  assert.ok(decks.stats.lineKm >= 25, `${decks.stats.lineKm} km of mrt line`);
  assert.equal(decks.deckDepth, TAIPEI_GEO.elevatedRoads.deckDepth, 'same box-section depth as road decks');
  for (const l of lines) assert.equal(l.pts.length, l.h.length * 2, 'pts/h arrays aligned');
});

test('spec: underground through Minquan West Road — no surface line at the station', () => {
  const near = nearestLinePoint(AT.minquan[0], AT.minquan[1]);
  assert.ok(!near || near.d > 120, `nearest mrt line to 民權西路 is ${near?.d?.toFixed(0)} m away (tunnel emits nothing)`);
});

test('spec: portal ramp inside Minquan -> Yuanshan, full height by Yuanshan', () => {
  // Along the segment there is a below-height point (the ramp) and
  // the guideway reaches full height before 圓山 station.
  let sawRamp = false, sawFull = false;
  for (let t = 0.25; t < 1.0; t += 0.05) {
    const x = AT.minquan[0] + (AT.yuanshan[0] - AT.minquan[0]) * t;
    const z = AT.minquan[1] + (AT.yuanshan[1] - AT.minquan[1]) * t;
    const n = nearestLinePoint(x, z);
    if (!n || n.d > 60) continue;
    if (n.h < 8.9) sawRamp = true;
    if (n.h >= 8.99) sawFull = true;
  }
  assert.ok(sawRamp, 'a ramp (h < 8.9) exists in the portal segment');
  assert.ok(sawFull, 'full height reached before Yuanshan');
  const atStation = nearestLinePoint(AT.yuanshan[0], AT.yuanshan[1]);
  assert.ok(atStation && atStation.d < 30 && atStation.h >= 8.99, 'Yuanshan station sits on the full-height guideway');
});

// The real alignment S-curves between stations (the Jiantan ->
// Shilin chord midpoint sits 165 m off the tracks), so pair checks
// follow the alignment itself: line vertices near the chord, binned
// along it — every bin must be populated (continuity) and carry the
// expected height.
function pairProfile(a, b) {
  const A = AT[a], B = AT[b];
  const dx = B[0] - A[0], dz = B[1] - A[1];
  const L2 = dx * dx + dz * dz || 1e-9;
  const bins = Array.from({ length: 10 }, () => []);
  for (const l of lines) {
    for (let i = 0; i + 3 < l.pts.length; i += 2) {
      const ax = l.pts[i], az = l.pts[i + 1], bx = l.pts[i + 2], bz = l.pts[i + 3];
      const segLen = Math.hypot(bx - ax, bz - az);
      const steps = Math.max(1, Math.ceil(segLen / 25));
      for (let s = 0; s <= steps; s++) {
        const f = s / steps;
        const px = ax + (bx - ax) * f, pz = az + (bz - az) * f;
        const t = ((px - A[0]) * dx + (pz - A[1]) * dz) / L2;
        if (t < 0 || t > 1) continue;
        const d = Math.hypot(A[0] + t * dx - px, A[1] + t * dz - pz);
        if (d > 260) continue;
        bins[Math.min(9, Math.floor(t * 10))].push(l.h[i / 2] + (l.h[i / 2 + 1] - l.h[i / 2]) * f);
      }
    }
  }
  return bins.map((hs) => (hs.length ? hs.sort((x, y) => x - y)[Math.floor(hs.length / 2)] : null));
}

test('spec: elevated at full height, Yuanshan -> Beitou inclusive + Xinbeitou branch', () => {
  const pairs = [
    ['yuanshan', 'jiantan'], ['jiantan', 'shilin'], ['shilin', 'zhishan'],
    ['zhishan', 'mingde'], ['mingde', 'shipai'], ['shipai', 'qilian'],
    ['qilian', 'qiyan'], ['qiyan', 'beitou'],
  ];
  for (const [a, b] of pairs) {
    const prof = pairProfile(a, b);
    for (let i = 0; i < 10; i++) {
      assert.ok(prof[i] !== null, `${a}->${b}: alignment continuous (bin ${i})`);
      assert.ok(prof[i] >= 8.99, `${a}->${b}: full height in bin ${i} (h=${prof[i].toFixed(2)})`);
    }
  }
  for (const k of ['jiantan', 'shilin', 'zhishan', 'mingde', 'shipai', 'qilian', 'qiyan', 'beitou', 'xinbeitou']) {
    const n = nearestLinePoint(AT[k][0], AT[k][1]);
    assert.ok(n && n.d < 40 && n.h >= 8.99, `${k} station on the full-height guideway`);
  }
});

test('spec: Xinbeitou branch — connected at full height from Beitou to the terminus', () => {
  // The branch leaves Beitou on a flying-junction loop that no
  // straight chord follows, so continuity is checked on the emitted
  // lines' own shared vertices.
  const key = (x, z) => `${Math.round(x * 10)},${Math.round(z * 10)}`;
  const byVertex = new Map();
  lines.forEach((l, li) => {
    for (let i = 0; i < l.pts.length; i += 2) {
      const k = key(l.pts[i], l.pts[i + 1]);
      if (!byVertex.has(k)) byVertex.set(k, []);
      byVertex.get(k).push(li);
    }
  });
  const distTo = (l, x, z) => {
    let bd = Infinity;
    for (let i = 0; i < l.pts.length; i += 2) bd = Math.min(bd, Math.hypot(l.pts[i] - x, l.pts[i + 1] - z));
    return bd;
  };
  const seen = new Set();
  const queue = [];
  lines.forEach((l, li) => { if (distTo(l, AT.beitou[0], AT.beitou[1]) < 60) { seen.add(li); queue.push(li); } });
  assert.ok(queue.length > 0, 'a line touches Beitou');
  while (queue.length) {
    const li = queue.pop();
    for (let i = 0; i < lines[li].pts.length; i += 2) {
      for (const o of byVertex.get(key(lines[li].pts[i], lines[li].pts[i + 1])) || []) {
        if (!seen.has(o)) { seen.add(o); queue.push(o); }
      }
    }
  }
  let reachedTerminus = false, branchKm = 0;
  for (const li of seen) {
    const l = lines[li];
    if (distTo(l, AT.xinbeitou[0], AT.xinbeitou[1]) < 60) reachedTerminus = true;
    for (let i = 0; i < l.h.length; i++) {
      if (l.pts[i * 2] > -6950 && l.pts[i * 2] < -6050 && l.pts[i * 2 + 1] > -11650 && l.pts[i * 2 + 1] < -10950) {
        assert.ok(l.h[i] >= 8.99, 'branch runs at full height');
      }
    }
    for (let i = 1; i < l.pts.length / 2; i++) branchKm += Math.hypot(l.pts[i * 2] - l.pts[i * 2 - 2], l.pts[i * 2 + 1] - l.pts[i * 2 - 1]) / 1000;
  }
  assert.ok(reachedTerminus, 'the connected deck network reaches Xinbeitou');
});

test('spec: at-grade after Beitou through Fuxinggang / Zhongyi / Guandu', () => {
  for (const [a, b] of [['fuxinggang', 'zhongyi'], ['zhongyi', 'guandu']]) {
    const prof = pairProfile(a, b);
    for (let i = 0; i < 10; i++) {
      assert.ok(prof[i] !== null, `${a}->${b}: alignment continuous (bin ${i})`);
      assert.ok(prof[i] <= 0.01, `${a}->${b}: at grade in bin ${i} (h=${prof[i].toFixed(2)})`);
    }
  }
  // The descent happens north of Beitou: somewhere between the
  // Beitou and Fuxinggang anchors the height leaves 9 and reaches 0.
  let saw9 = false, saw0 = false;
  for (let t = 0.02; t < 1.0; t += 0.02) {
    const x = AT.beitou[0] + (AT.fuxinggang[0] - AT.beitou[0]) * t;
    const z = AT.beitou[1] + (AT.fuxinggang[1] - AT.beitou[1]) * t;
    const n = nearestLinePoint(x, z);
    if (!n || n.d > 80) continue;
    if (n.h >= 8.99) saw9 = true;
    if (n.h <= 0.01) saw0 = true;
  }
  assert.ok(saw9 && saw0, 'descent profile present Beitou -> Fuxinggang');
});

test('deck discipline: heights in [0, 9], ramps within 6%, no floating ends', () => {
  for (const l of lines) {
    for (let i = 0; i < l.h.length; i++) {
      assert.ok(l.h[i] >= -1e-9 && l.h[i] <= 9.051, `h in range (${l.h[i]})`);
      if (i > 0) {
        const run = Math.hypot(l.pts[i * 2] - l.pts[i * 2 - 2], l.pts[i * 2 + 1] - l.pts[i * 2 - 1]);
        if (run > 0.01) {
          // Same form as the road-deck pin: the 6% cap binds the
          // graph, the +0.11 covers the geodata height quantization.
          assert.ok(Math.abs(l.h[i] - l.h[i - 1]) <= 0.06 * run + 0.11, `slope ${(Math.abs(l.h[i] - l.h[i - 1]) / run).toFixed(3)} on ${l.name}`);
        }
      }
    }
    // A line end is either at grade, joins another line end (shared
    // point at the same height), or terminates inside a station
    // footprint (the Xinbeitou terminus buffer ends inside its
    // station box).
    for (const end of [0, l.pts.length - 2]) {
      const ex = l.pts[end], ez = l.pts[end + 1], eh = l.h[end / 2];
      if (eh <= 0.01) continue;
      let joined = false;
      for (const o of lines) {
        if (o === l) continue;
        for (let i = 0; i < o.pts.length; i += 2) {
          if (Math.hypot(o.pts[i] - ex, o.pts[i + 1] - ez) < 0.6 && Math.abs(o.h[i / 2] - eh) < 0.05) { joined = true; break; }
        }
        if (joined) break;
      }
      if (!joined) {
        for (const s of stations) {
          const { hw, hl } = mrtStationFootprint(s);
          const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw);
          const dx = ex - s.x, dz = ez - s.z;
          const lx = dx * cy - dz * sy, lz = dx * sy + dz * cy;
          // +4 m: at a terminus the twin tracks fan slightly past
          // the snapped station centreline before the buffer stops.
          if (Math.abs(lx) <= hw + 4 && Math.abs(lz) <= hl + 4) { joined = true; break; }
        }
      }
      assert.ok(joined, `no floating end at (${ex.toFixed(0)}, ${ez.toFixed(0)}) h=${eh.toFixed(1)} on ${l.name}`);
    }
  }
});

test('piers: never in a lot, never in a crossing street (same rule as road decks)', () => {
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
  const medPolys = [...med.plain, ...med.planted].map((quad) => [[quad[0], quad[1]], [quad[2], quad[3]], [quad[4], quad[5]], [quad[6], quad[7]]]);
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
  assert.ok(decks.piers.length >= 300, `${decks.piers.length} mrt piers`);
  for (const p of decks.piers) {
    assert.ok(p.h > 0 && p.h <= 9, `pier height ${p.h}`);
    assert.ok(!inLot(p.x, p.z), `pier inside a building lot at (${p.x}, ${p.z})`);
    if (pointInAnyPoly(medGrid, medPolys, [p.x, p.z])) continue;
    const cellKey = `${Math.floor(p.x / 100)},${Math.floor(p.z / 100)}`;
    for (const ci of ribbonGrid.get(cellKey) || []) {
      if (!pointInPoly([p.x, p.z], ribbons[ci])) continue;
      assert.ok(bedParallelNear(groundBeds[ci], p), `pier in a crossing carriageway (${groundBeds[ci].name}) at (${p.x}, ${p.z})`);
    }
  }
});

test('stations: the ten elevated stations, kinds, on-alignment, sane geometry', () => {
  assert.equal(stations.length, 10, 'ten elevated station defs');
  const kinds = Object.fromEntries(stations.map((s) => [s.id, s.kind]));
  assert.equal(kinds['mrt-jiantan'], 'jiantan');
  assert.equal(kinds['mrt-beitou'], 'beitou');
  assert.equal(kinds['mrt-xinbeitou'], 'xinbeitou');
  for (const s of stations) {
    const n = nearestLinePoint(s.x, s.z);
    assert.ok(n && n.d < 12, `${s.id} centred on the guideway (${n?.d?.toFixed(1)} m to the nearest track)`);
    assert.ok(s.length >= 80 && s.length <= 190, `${s.id} length ${s.length}`);
    // Coverage: the tracks diverge around the island platforms
    // (centrelines 14-20 m apart at the stations), and every track
    // sample under the station's mid-section must lie within the
    // footprint's across half-width plus one girder margin.
    const { hw, hl } = mrtStationFootprint(s);
    const dirA = [Math.sin(s.yaw), Math.cos(s.yaw)];
    const dirC = [Math.cos(s.yaw), -Math.sin(s.yaw)];
    for (const l of lines) {
      for (let i = 0; i + 3 < l.pts.length; i += 2) {
        const ax = l.pts[i], az = l.pts[i + 1], bx = l.pts[i + 2], bz = l.pts[i + 3];
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 10));
        for (let k = 0; k < steps; k++) {
          const px = ax + (bx - ax) * (k / steps), pz = az + (bz - az) * (k / steps);
          const dx = px - s.x, dz = pz - s.z;
          const al = dx * dirA[0] + dz * dirA[1];
          const ac = dx * dirC[0] + dz * dirC[1];
          if (Math.abs(al) <= hl * 0.8 && Math.abs(ac) <= hw + 30) {
            assert.ok(Math.abs(ac) <= hw + 4, `${s.id}: track sample at across ${ac.toFixed(1)} escapes the footprint (hw ${hw.toFixed(1)})`);
          }
        }
      }
    }
  }
  const g = buildMrtStationGeometry(stations);
  assert.equal(g.stationCount, 10);
  assert.ok(g.triCount > 800, `${g.triCount} station triangles`);
  for (let i = 0; i < g.positions.length; i++) assert.ok(Number.isFinite(g.positions[i]), 'finite geometry');
  // Jiantan's pylons are the tallest station structure on the line.
  let maxY = 0;
  for (let i = 1; i < g.positions.length; i += 3) maxY = Math.max(maxY, g.positions[i]);
  assert.ok(maxY > 36 && maxY < 42, `jiantan pylon top ${maxY.toFixed(1)} m`);
  // Beitou is the widest station footprint.
  const widths = stations.map((s) => mrtStationFootprint(s).hw * 2);
  const beitouW = mrtStationFootprint(stations.find((s) => s.id === 'mrt-beitou')).hw * 2;
  assert.equal(Math.max(...widths), beitouW, 'beitou widest');
});

test('stations: no planned lot overlaps a station footprint', () => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  for (const s of stations) {
    const { hw, hl } = mrtStationFootprint(s);
    const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw);
    for (const lot of plan.lots) {
      const dx = lot.x - s.x, dz = lot.z - s.z;
      const lx = dx * cy - dz * sy, lz = dx * sy + dz * cy;
      const hit = Math.abs(lx) < hw + lot.w / 2 - 1 && Math.abs(lz) < hl + lot.d / 2 - 1;
      assert.ok(!hit, `lot at (${lot.x.toFixed(0)}, ${lot.z.toFixed(0)}) inside ${s.id}`);
    }
  }
});
