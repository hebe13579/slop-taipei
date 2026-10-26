// Issue #118: MRT Red Line （淡水信義線） elevated completion.
// Pins the user's ground-truth spec against the emitted geodata:
// underground through 民權西路 (nothing at surface), a portal ramp
// inside 民權西路→圓山， the guideway at full height 圓山→北投
// inclusive plus the 新北投支線， an at-grade low bed after Beitou
// through 復興崗/忠義/關渡， the deck discipline (6% ramps, no
// floating ends, piers off lots and crossing carriageways), and the
// elevated station defs + geometry (Yuanshan-pattern standard,
// Jiantan / Beitou / Xinbeitou iconic kinds).
//
// Issue #139 (MRT completion) extends this file: the brown track
// treatment on every deck line (ballast + rails, data-driven track
// offsets), the track-corridor clearance census (no lot on the
// at-grade bed, none piercing the guideway, low lots under the
// deck kept), the Beitou depot （北投機廠） as a non-registry
// special structure, and the three at-grade stations
// 復興崗/忠義/關渡 on the same station path.
//
// Issue #146 (Wenhu / Brown Line) extends it again: the rubber-
// tyred line on CONCRETE GUIDEWAYS (a per-line track treatment —
// pale strips + guide bars, no ballast) up the Fuxing Rd median,
// elevated at full height past 大安/忠孝復興/南京復興/中山國中，
// curving east on Minzu E. Rd and diving underground before
// Songshan Airport (the airport station is entrances only). Its
// four barrel-vault stations and three airport entrance
// headhouses join the same non-registry station path, and the
// #139 corridor clearance covers its guideway too.
import assert from 'node:assert/strict';
import test from 'node:test';
import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { ribbonPoly, buildPolyGrid, pointInAnyPoly, pointInPoly } from '../js/taipei-painted.js';
import { buildMedianStrips } from '../js/taipei-surfaces.js';
import { planTaipeiBuildings } from '../js/taipei-buildings.js';
import { buildMrtStationGeometry, buildMrtDepotGeometry, mrtStationFootprint } from '../js/taipei-mrt-stations.js';
import { buildDeckGeometry, groundContactPolys } from '../js/taipei-viaduct.js';

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
  // Wenhu (issue #146): the digest's station defs + the OSM
  // Songshan Airport station anchor (underground — no line).
  daanW: [-2160, 17], zhongxiaoF: [-2143, -879], nanjingF: [-2114, -2148],
  zhongshanJH: [-2098, -3078], songshanAirport: [-1351, -3333],
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

test('wenhu spec (issue #146): elevated at full height along Fuxing, Daan -> Zhongshan JHS', () => {
  const pairs = [
    ['daanW', 'zhongxiaoF'], ['zhongxiaoF', 'nanjingF'], ['nanjingF', 'zhongshanJH'],
  ];
  for (const [a, b] of pairs) {
    const prof = pairProfile(a, b);
    for (let i = 0; i < 10; i++) {
      assert.ok(prof[i] !== null, `${a}->${b}: alignment continuous (bin ${i})`);
      assert.ok(prof[i] >= 8.99, `${a}->${b}: full height in bin ${i} (h=${prof[i].toFixed(2)})`);
    }
  }
  for (const k of ['daanW', 'zhongxiaoF', 'nanjingF', 'zhongshanJH']) {
    const n = nearestLinePoint(AT[k][0], AT[k][1]);
    assert.ok(n && n.d < 40 && n.h >= 8.99, `${k} station on the full-height guideway`);
    assert.equal(n.line.trackStyle, 'guideway', `${k} served by a guideway line`);
  }
});

test('wenhu spec (issue #146): the dive — ramp down after Zhongshan JHS, nothing at the airport station', () => {
  const wenhu = lines.filter((l) => l.trackStyle === 'guideway');
  assert.equal(wenhu.length, 21, 'wenhu deck lines (twin pairs + shared crossovers + the two dive ramps)');
  let sawRamp = false, sawPortalBottom = false, sawFullNorth = false;
  for (const l of wenhu) {
    for (let i = 0; i < l.h.length; i++) {
      const x = l.pts[i * 2], z = l.pts[i * 2 + 1], h = l.h[i];
      if (h > 0.05 && h < 8.9) sawRamp = true;
      // The portal bottoms sit north of the airport anchor's
      // latitude, where the ramps meet the tunnel bores.
      if (h <= 0.01 && z < -3500) sawPortalBottom = true;
      if (h >= 8.99 && z < -3078 && z > -3560) sawFullNorth = true;
      // The underground stretch emits nothing: no guideway point
      // comes near the airport station anchor.
      assert.ok(Math.hypot(x - AT.songshanAirport[0], z - AT.songshanAirport[1]) > 200,
        'no surface guideway near the underground Songshan Airport station');
    }
  }
  assert.ok(sawFullNorth, 'guideway still at full height on the Minzu curve');
  assert.ok(sawRamp, 'a ramp (0.05 < h < 8.9) exists on the dive');
  assert.ok(sawPortalBottom, 'the dive reaches grade at the portal');
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
    // point at the same height), terminates inside a station
    // footprint (the Xinbeitou terminus buffer ends inside its
    // station box), or sits on the tile-union boundary — a line
    // that runs out of the tile continues beyond it (the road
    // decks' convention; issue #146: the Wenhu twins are clipped
    // at Box A's south edge, z = 498.5, at full height, because
    // the line runs on to 動物園）.
    for (const end of [0, l.pts.length - 2]) {
      const ex = l.pts[end], ez = l.pts[end + 1], eh = l.h[end / 2];
      if (eh <= 0.01) continue;
      let joined = false;
      for (const b of TAIPEI_GEO.frame.boxes) {
        const onZEdge = (Math.abs(ez - b.minZ) <= 2 || Math.abs(ez - b.maxZ) <= 2) && ex >= b.minX - 2 && ex <= b.maxX + 2;
        const onXEdge = (Math.abs(ex - b.minX) <= 2 || Math.abs(ex - b.maxX) <= 2) && ez >= b.minZ - 2 && ez <= b.maxZ + 2;
        if (onZEdge || onXEdge) { joined = true; break; }
      }
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
  // Median bands at any level (issue #167), as in the decks test.
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
  assert.ok(decks.piers.length >= 300, `${decks.piers.length} mrt piers`);
  // Merge note (PR #160 gate, wenhu-line × main e036a86b): crossing
  // failures are collected and pinned as a set because exactly ONE
  // pier legitimately stands in a crossing carriageway without
  // median cover — the Wenhu pier at (-2150.2, -528.3), on the
  // line's centreline (yaw -0.02) in the Fuxing median inside the
  // 復興×仁愛 junction, inside the ribbon of 仁愛路三段's 6.4 m
  // carriageway. Proven cause: on the branch base the uncapped
  // Fuxing median strip ran through the junction and exempted it;
  // main's #173 MEDTIP edge probes (cap bite at centre + edges)
  // and #178 minor-cross termination (a [4.5, 8) m bed crossing
  // the whole strip breaks it — the 6.4 m Renai carriageway is in
  // that band) now terminate the strip at the junction in both
  // the capped and uncapped builds, which is the intended render
  // (medians break at junction surfaces). A median pier standing
  // in its own junction is correct; any NEW pier in a crossing
  // carriageway fails this pin until individually justified.
  const crossingPiers = [];
  for (const p of decks.piers) {
    assert.ok(p.h > 0 && p.h <= 9, `pier height ${p.h}`);
    assert.ok(!inLot(p.x, p.z), `pier inside a building lot at (${p.x}, ${p.z})`);
    if (pointInAnyPoly(medGrid, medPolys, [p.x, p.z])) continue;
    const cellKey = `${Math.floor(p.x / 100)},${Math.floor(p.z / 100)}`;
    for (const ci of ribbonGrid.get(cellKey) || []) {
      if (!pointInPoly([p.x, p.z], ribbons[ci])) continue;
      if (!bedParallelNear(groundBeds[ci], p)) {
        crossingPiers.push(`${p.x.toFixed(1)},${p.z.toFixed(1)} in ${groundBeds[ci].name}`);
        break;
      }
    }
  }
  assert.deepEqual(crossingPiers, ['-2150.2,-528.3 in 仁愛路三段'],
    'piers in a crossing carriageway (pinned exception set — see comment above)');
});

test('stations: ten elevated + three at-grade (issue #139), kinds, on-alignment, sane geometry', () => {
  assert.equal(stations.length, 20, 'Red Line defs + the Wenhu defs of issue #146');
  const kinds = Object.fromEntries(stations.map((s) => [s.id, s.kind]));
  assert.equal(kinds['mrt-jiantan'], 'jiantan');
  assert.equal(kinds['mrt-beitou'], 'beitou');
  assert.equal(kinds['mrt-xinbeitou'], 'xinbeitou');
  // Issue #139: the at-grade stations after Beitou join the same
  // station path (non-registry, planner-excluded like the rest).
  assert.equal(kinds['mrt-fuxinggang'], 'at-grade');
  assert.equal(kinds['mrt-zhongyi'], 'at-grade');
  assert.equal(kinds['mrt-guandu'], 'at-grade');
  // Issue #146: the four Wenhu barrel-vault stations and the
  // three Songshan Airport entrance headhouses join the same
  // path. The entrances are exempt from the on-alignment loop
  // below (their station is underground; they are pinned by
  // their own test against the OSM entrance nodes).
  assert.equal(kinds['mrt-daan'], 'wenhu');
  assert.equal(kinds['mrt-zhongxiao-fuxing'], 'wenhu');
  assert.equal(kinds['mrt-nanjing-fuxing'], 'wenhu');
  assert.equal(kinds['mrt-zhongshan-junior-high-school'], 'wenhu');
  assert.equal(kinds['mrt-songshan-airport-exit-1'], 'entrance');
  assert.equal(kinds['mrt-songshan-airport-exit-2'], 'entrance');
  assert.equal(kinds['mrt-songshan-airport-exit-3'], 'entrance');
  for (const s of stations) {
    if (s.kind === 'entrance') continue;
    const n = nearestLinePoint(s.x, s.z);
    assert.ok(n && n.d < 12, `${s.id} centred on the guideway (${n?.d?.toFixed(1)} m to the nearest track)`);
    assert.ok(s.length >= 80 && s.length <= 190, `${s.id} length ${s.length}`);
    // Coverage: the tracks diverge around the island platforms
    // (centrelines 14-20 m apart at the stations), and every track
    // sample under the station's mid-section must lie within the
    // footprint's across half-width plus one girder margin.
    // Fuxinggang is exempt: the Beitou depot's throat leads run
    // parallel beside the served pair there (20+ m out), so its
    // mid-section legitimately carries tracks the footprint does
    // not cover — the served pair's flanking is pinned by the
    // at-grade test below instead.
    const { hw, hl } = mrtStationFootprint(s);
    const dirA = [Math.sin(s.yaw), Math.cos(s.yaw)];
    const dirC = [Math.cos(s.yaw), -Math.sin(s.yaw)];
    if (s.id !== 'mrt-fuxinggang') for (const l of lines) {
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
  assert.equal(g.stationCount, 20);
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

test('wenhu stations (issue #146): barrel-vault geometry over the guideways', () => {
  const wenhu = stations.filter((s) => s.kind === 'wenhu');
  assert.equal(wenhu.length, 4, 'four elevated Wenhu stations');
  for (const s of wenhu) {
    // Digest-measured defs: length = OSM platform extent + 16 m
    // (stairs/machine rooms), width = platform across extent +
    // 3 m, both from the level-tagged platform ways.
    assert.ok(s.length >= 88 && s.length <= 98, `${s.id} length ${s.length} (platforms 74-80 m + end rooms)`);
    assert.ok(s.width >= 16.5 && s.width <= 20, `${s.id} width ${s.width}`);
  }
  const g = buildMrtStationGeometry(wenhu);
  assert.equal(g.stationCount, 4);
  assert.ok(g.triCount > 1000, `${g.triCount} wenhu station triangles`);
  for (let i = 0; i < g.positions.length; i++) assert.ok(Number.isFinite(g.positions[i]), 'finite geometry');
  let maxY = 0;
  for (let i = 1; i < g.positions.length; i += 3) maxY = Math.max(maxY, g.positions[i]);
  // The vault crown: deck datum 9 + platform/screen tiers to the
  // 12.3 m springing + 2.2 m rise + the skylight strip — a low
  // shed over the tracks, nothing like Jiantan's pylons.
  assert.ok(maxY > 14 && maxY < 15.5, `wenhu vault crown ${maxY.toFixed(2)} m`);
});

test('songshan airport entrances (issue #146): three headhouses, OSM positions, no guideway', () => {
  const ents = stations.filter((s) => s.kind === 'entrance');
  assert.equal(ents.length, 3, 'the three OSM subway entrances');
  // Positions are the live-OSM entrance nodes (verified through
  // the OSM API 2026-10-25; see AIRPORT_ENTRANCES in
  // tools/taipei/build-mrt.mjs), in world metres.
  const want = {
    'mrt-songshan-airport-exit-1': [-1313, -3383],
    'mrt-songshan-airport-exit-2': [-1392, -3382],
    'mrt-songshan-airport-exit-3': [-1337, -3324],
  };
  for (const s of ents) {
    const [wx, wz] = want[s.id];
    assert.ok(Math.abs(s.x - wx) <= 3 && Math.abs(s.z - wz) <= 3, `${s.id} at (${s.x}, ${s.z}), OSM node at (${wx}, ${wz})`);
    assert.equal(s.length, 11);
    assert.equal(s.width, 7);
    // Inside the airport box (frame box 6-airport), on the
    // terminal side — the airfield's lot-free rule covers them.
    assert.ok(s.x >= -3229.5 && s.x <= 504.6 && s.z >= -4984.8 && s.z <= -2437, `${s.id} inside the airport box`);
  }
  const g = buildMrtStationGeometry(ents);
  assert.equal(g.stationCount, 3);
  let maxY = 0;
  for (let i = 1; i < g.positions.length; i += 3) maxY = Math.max(maxY, g.positions[i]);
  assert.ok(maxY > 2.6 && maxY < 2.85, `headhouse canopy top ${maxY.toFixed(2)} m — a pavilion, not a station box`);
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

// ---- Issue #139: tracks, clearance, depot ----

// Exact track-corridor audit geometry (mirrors the planner's
// rules in js/taipei-buildings.js): per deck segment a butt-cap
// rect at the line's width; a lot's margin-grown TRUE footprint
// (rotation-aware) tested by SAT; the underside sampled along
// the segment's run through the footprint.
const TRACK_DEPTH = decks.deckDepth, TRACK_MARGIN = 0.5, TRACK_CLEAR = 1.0;
const segRects = [];
for (const l of lines) {
  const half = Math.max((l.width || 6) / 2, 0.75);
  for (let i = 0; i + 3 < l.pts.length; i += 2) {
    const ax = l.pts[i], az = l.pts[i + 1], bx = l.pts[i + 2], bz = l.pts[i + 3];
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    if (len < 0.01) continue;
    const nx = (-dz / len) * half, nz = (dx / len) * half;
    segRects.push({
      ax, az, bx, bz, hA: l.h[i / 2], hB: l.h[i / 2 + 1],
      atGrade: Math.max(l.h[i / 2], l.h[i / 2 + 1]) < 0.5,
      corners: [[ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz], [ax - nx, az - nz]],
      minX: Math.min(ax + nx, bx + nx, bx - nx, ax - nx), maxX: Math.max(ax + nx, bx + nx, bx - nx, ax - nx),
      minZ: Math.min(az + nz, bz + nz, bz - nz, az - nz), maxZ: Math.max(az + nz, bz + nz, bz - nz, az - nz),
    });
  }
}
function quadsIntersect(A, B) {
  for (const Q of [A, B]) for (const i of [0, 1]) {
    const [x1, z1] = Q[i], [x2, z2] = Q[(i + 1) % 4];
    const ex = x2 - x1, ez = z2 - z1, len = Math.hypot(ex, ez) || 1;
    const ax = -ez / len, az = ex / len;
    let aMn = Infinity, aMx = -Infinity, bMn = Infinity, bMx = -Infinity;
    for (const [px, pz] of A) { const v = px * ax + pz * az; aMn = Math.min(aMn, v); aMx = Math.max(aMx, v); }
    for (const [px, pz] of B) { const v = px * ax + pz * az; bMn = Math.min(bMn, v); bMx = Math.max(bMx, v); }
    if (aMx < bMn || bMx < aMn) return false;
  }
  return true;
}
function trackClass(lot) {
  const w = lot.w + 2 * TRACK_MARGIN, d = lot.d + 2 * TRACK_MARGIN;
  let grown;
  if (!lot.rot) {
    grown = [[lot.x - w / 2, lot.z - d / 2], [lot.x + w / 2, lot.z - d / 2], [lot.x + w / 2, lot.z + d / 2], [lot.x - w / 2, lot.z + d / 2]];
  } else {
    const c = Math.cos(lot.rot), s = Math.sin(lot.rot), hw = w / 2, hd = d / 2;
    grown = [
      [lot.x + hw * c - hd * s, lot.z + hw * s + hd * c],
      [lot.x + hw * c + hd * s, lot.z + hw * s - hd * c],
      [lot.x - hw * c + hd * s, lot.z - hw * s - hd * c],
      [lot.x - hw * c - hd * s, lot.z - hw * s + hd * c],
    ];
  }
  const gMinX = Math.min(...grown.map((p) => p[0])), gMaxX = Math.max(...grown.map((p) => p[0]));
  const gMinZ = Math.min(...grown.map((p) => p[1])), gMaxZ = Math.max(...grown.map((p) => p[1]));
  let bed = false, under = Infinity;
  for (const r of segRects) {
    if (r.maxX < gMinX || r.minX > gMaxX || r.maxZ < gMinZ || r.minZ > gMaxZ) continue;
    if (!quadsIntersect(grown, r.corners)) continue;
    if (r.atGrade) { bed = true; continue; }
    const dx = r.bx - r.ax, dz = r.bz - r.az, L2 = dx * dx + dz * dz || 1e-9;
    let lo = 0, hi = 1, ok = true;
    for (const [p, qv] of [[-dx, r.ax - gMinX], [dx, gMaxX - r.ax], [-dz, r.az - gMinZ], [dz, gMaxZ - r.az]]) {
      if (Math.abs(p) < 1e-12) { if (qv < 0) { ok = false; break; } continue; }
      const t = qv / p;
      if (p < 0) lo = Math.max(lo, t); else hi = Math.min(hi, t);
      if (lo > hi) { ok = false; break; }
    }
    const ts = ok ? [lo, hi] : [];
    const tc = ((lot.x - r.ax) * dx + (lot.z - r.az) * dz) / L2;
    ts.push(Math.max(0, Math.min(1, tc)));
    for (const t of ts) under = Math.min(under, r.hA + (r.hB - r.hA) * t - TRACK_DEPTH);
  }
  return { bed, under };
}

test('tracks (issue #139): every deck line carries its track offsets in the data', () => {
  // Issue #146: the Wenhu Line adds 21 guideway lines to the
  // Red Line's 54 — the line count moves, the Red Line's own
  // track data is byte-identical.
  assert.equal(lines.length, 75, '54 Red Line + 21 Wenhu deck lines');
  assert.equal(lines.filter((l) => l.trackStyle === 'guideway').length, 21, 'wenhu guideway lines');
  for (const l of lines) {
    assert.ok(Array.isArray(l.tracks), `${l.name} carries tracks`);
    if (l.trackStyle === 'guideway') {
      // Wenhu (issue #146): concrete guideways at the measured
      // 4.3 m twin spacing (OSM centrelines 4.1-4.4 m apart).
      if (l.width <= 6.5) assert.deepEqual(l.tracks, [0], `${l.name}: wenhu twin line, one guideway on its centreline`);
      else assert.deepEqual(l.tracks, [-2.15, 2.15], `${l.name}: wenhu shared formation, two guideways at 4.3 m`);
    } else if (l.width <= 6.5) assert.deepEqual(l.tracks, [0], `${l.name}: twin line, one track on its centreline`);
    else assert.deepEqual(l.tracks, [-3, 3], `${l.name}: shared-formation line, two tracks at the measured 6 m spacing`);
  }
});

test('tracks (issue #139): the renderer draws ballast + rails only in track mode, concrete untouched', () => {
  const plain = buildDeckGeometry(decks);
  assert.equal(plain.ballast.positions.length, 0, 'no ballast without track mode (road decks unaffected)');
  assert.equal(plain.rails.positions.length, 0, 'no rails without track mode');
  assert.ok(plain.asphalt.positions.length > 0, 'road-mode asphalt ribbon still emitted');
  const tracked = buildDeckGeometry(decks, { tracks: true });
  assert.ok(tracked.ballast.positions.length > 0, 'ballast strips emitted');
  assert.ok(tracked.rails.positions.length > 0, 'rail ribbons emitted');
  assert.equal(tracked.asphalt.positions.length, 0, 'track mode replaces the asphalt ribbon');
  assert.deepEqual([...tracked.concrete.positions], [...plain.concrete.positions], 'concrete sink identical — the road deck path is byte-stable');
  assert.equal(tracked.lineCount, plain.lineCount, 'same line count');
  for (let i = 0; i < tracked.ballast.positions.length; i++) assert.ok(Number.isFinite(tracked.ballast.positions[i]), 'finite ballast');
  for (let i = 0; i < tracked.rails.positions.length; i++) assert.ok(Number.isFinite(tracked.rails.positions[i]), 'finite rails');
  // Ballast tops sit on the deck surface: at-grade strips crest at
  // ~0.24 m, elevated at deck height + 0.24.
  let maxBalY = 0;
  for (let i = 1; i < tracked.ballast.positions.length; i += 3) maxBalY = Math.max(maxBalY, tracked.ballast.positions[i]);
  assert.ok(maxBalY > 9.2 && maxBalY < 9.3, `elevated ballast crest ${maxBalY.toFixed(2)} (deck 9 + ballast 0.24)`);
  // Issue #146: the guideway treatment is Wenhu-only — plain
  // (road) mode emits none, the road decks never carry it, and
  // in track mode the concrete strips crest just above the
  // Wenhu deck surface (9 + 0.16 strip), below the ballast crest.
  assert.equal(plain.guideway.positions.length, 0, 'no guideway strips without track mode');
  assert.ok(tracked.guideway.positions.length > 0, 'guideway strips emitted for the Wenhu lines');
  const roadTracked = buildDeckGeometry(TAIPEI_GEO.elevatedRoads, { tracks: true });
  assert.equal(roadTracked.guideway.positions.length, 0, 'road decks never carry the guideway treatment');
  let maxGuideY = 0;
  for (let i = 1; i < tracked.guideway.positions.length; i += 3) maxGuideY = Math.max(maxGuideY, tracked.guideway.positions[i]);
  assert.ok(maxGuideY > 9.1 && maxGuideY < 9.22, `elevated guideway crest ${maxGuideY.toFixed(2)} (deck 9 + strip 0.16)`);
  for (let i = 0; i < tracked.guideway.positions.length; i++) assert.ok(Number.isFinite(tracked.guideway.positions[i]), 'finite guideway');
});

test('portal (issue #173): a lone dive end gets a shaped portal mouth; a grade join and road mode do not', () => {
  const dive = {
    lines: [{ pts: [0, 0, 100, 0], width: 10.4, h: [9, 0], tracks: [-3, 3] }],
    piers: [], deckDepth: 1.8,
  };
  const g = buildDeckGeometry(dive, { tracks: true });
  assert.ok(g.portal.positions.length > 0, 'headwall + wing geometry emitted at the dive end');
  assert.ok(g.portalDark.positions.length > 0, 'dark opening emitted');
  // The headwall faces back along the line (the line runs +x and
  // dives at x=100): the first portal quad's flat normal is -x.
  assert.ok(g.portal.normals[0] < -0.99 && Math.abs(g.portal.normals[1]) < 0.01 && Math.abs(g.portal.normals[2]) < 0.01,
    `headwall normal (${g.portal.normals[0]}, ${g.portal.normals[1]}, ${g.portal.normals[2]}) faces -x`);
  // Headwall height is the module's portal height.
  let maxY = 0;
  for (let i = 1; i < g.portal.positions.length; i += 3) maxY = Math.max(maxY, g.portal.positions[i]);
  assert.ok(Math.abs(maxY - 5.2) < 1e-6, `headwall tops at ${maxY} m`);
  // A continuation line ending at the same point makes it a grade
  // join (the Beitou descent pattern), not a portal.
  const joined = {
    lines: [
      { pts: [0, 0, 100, 0], width: 10.4, h: [9, 0], tracks: [-3, 3] },
      { pts: [100, 0, 200, 0], width: 10.4, h: [0, 0], tracks: [-3, 3] },
    ],
    piers: [], deckDepth: 1.8,
  };
  const gj = buildDeckGeometry(joined, { tracks: true });
  assert.equal(gj.portal.positions.length, 0, 'no portal where another line continues the dive at grade');
  // Road mode never grows portals (the road-deck path stays stable).
  const gr = buildDeckGeometry(dive);
  assert.equal(gr.portal.positions.length, 0, 'no portal geometry in road mode');
  assert.equal(gr.portalDark.positions.length, 0);
});

test('portal (issue #173): the real tile has exactly the four dive mouths (Minquan + Wenhu twins)', () => {
  const tracked = buildDeckGeometry(decks, { tracks: true });
  // Portal ends: per end, headwall 2 piers + lintel + 2 wings =
  // 5 quads = 10 triangles, and one dark opening quad = 2
  // triangles. On main (Red Line only) this pinned 2 mouths —
  // the twin trackways of the 民權西路 dive. Merged with issue
  // #146 (PR #160 gate): the Wenhu twin trackways dive before
  // Songshan Airport and #173's rule dresses their ends
  // identically — 2 more mouths, measured at the gate as portal
  // clusters at (-4633, -3507) (Minquan) and (-1858, -3564)
  // (Wenhu), 20 triangles each. 4 mouths total.
  assert.equal(tracked.portal.positions.length / 9, 40, 'portal concrete triangles (4 mouths × 5 quads)');
  assert.equal(tracked.portalDark.positions.length / 9, 8, 'portal opening triangles (4 mouths × 1 quad)');
});

test('portal trees (issue #173): ground-contact polygons cover at-grade and dive segments only', () => {
  const mk = (h) => ({ lines: [{ pts: [0, 0, 50, 0, 100, 0], width: 10.4, h, tracks: [-3, 3] }], piers: [] });
  assert.equal(groundContactPolys(mk([9, 9, 9])).length, 0, 'fully elevated: nothing touches ground');
  assert.equal(groundContactPolys(mk([9, 0, 0])).length, 2, 'the dive segment and the at-grade segment both count');
  assert.equal(groundContactPolys(mk([0, 0, 9])).length, 2, 'an at-grade segment plus the ramp rising from grade (its low end touches)');
  const real = groundContactPolys(decks);
  // 124 on the Red-only field (main's pin, reproduced exactly by
  // partitioning the merged field on trackStyle) + 2 from issue
  // #146 (PR #160 gate): each Wenhu twin line's dive ramp has
  // exactly one ground-touching segment at its foot (h starts at
  // 0), so the Wenhu dive contributes one contact polygon per
  // trackway.
  assert.equal(real.length, 126, 'real-tile ground-contact segments (at-grade Beitou + the portal ramps + the Wenhu dive feet)');
  // Every polygon is a quad around its segment.
  for (const p of real) assert.equal(p.length, 4);
});

test('clearance (issue #139): census by counterfactual, audit exact', (t) => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  // Counterfactual: the pre-#139 plan on this same tree — strip
  // the track data, the depot and the at-grade stations, and the
  // plan reproduces 38,857 lots exactly (the #134+#137 plan as
  // composed with #136; on the pre-expansion tree this reproduced
  // 34,645, the #106+#118 plan).
  // Composed with issue #144 on this merged tree: the TPAC
  // landmark's site exclusion removes its 7 parcel lots in
  // BOTH plans (the site rule is not a #139 input), so both
  // anchors drop by 7 and the #139 delta below is unchanged
  // at 461 (measured at the #144 gate).
  // Composed with issue #135 on this merged tree: the Twin
  // Towers parcel exclusions remove 47 lots from BOTH plans —
  // both anchors drop by 47 more (counterfactual 38,803).
  // Composed with issue #146 on this merged tree: the
  // counterfactual also strips the Wenhu station defs (the
  // 'wenhu' + 'entrance' kinds did not exist pre-#146), so the
  // 38,803 anchor still reproduces; the shipped plan drops 2
  // more lots, both pierce drops flanking the Wenhu dive north
  // of Zhongshan JHS, where the descending guideway's underside
  // meets their tops (a proc lot, h 14.5 at (-1869, -3587),
  // and a door-tier lot, h 15.5 at (-2018, -3685); both
  // masonry family — diffed lot by lot at the #146 gate).
  const before = planTaipeiBuildings({
    ...TAIPEI_GEO,
    mrtDecks: undefined, mrtDepot: undefined,
    mrtStations: stations.filter((s) => s.kind !== 'at-grade' && s.kind !== 'wenhu' && s.kind !== 'entrance'),
  });
  assert.equal(before.lots.length, 38803, 'counterfactual plan reproduces the pre-#139 lot count, less the #144 site lots (7) and the #135 parcel exclusions (47)');
  // 463 lots removed on this tree (524 on the pre-expansion
  // tree): 433 inside the Beitou depot + at-grade station sites
  // (398 with centres inside the depot site rect alone; the rest
  // are margin-grown corner hits at the site edges), 13 standing
  // on the at-grade track bed, 17 tall enough to pierce a
  // guideway (15 Red Line + the 2 Wenhu dive lots of issue #146;
  // planner counters below; classification by lot centre
  // against the site rects on this tree).
  assert.equal(plan.lots.length, 38340, 'shipped plan lot count after the #139 removals, the #144 site exclusion, the #135 parcel exclusions and the #146 dive drops');
  assert.equal(plan.stats.lotsDroppedTrackBed, 13, 'planner bed drops agree with the census');
  assert.equal(plan.stats.lotsDroppedTrackPierce, 17, 'planner pierce drops agree with the census (15 Red + 2 Wenhu, issue #146)');
  let bed = 0, pierce = 0, keptUnder = 0;
  for (const lot of plan.lots) {
    const c = trackClass(lot);
    if (c.bed) bed++;
    else if (c.under < Infinity) {
      if (lot.h > c.under - TRACK_CLEAR) pierce++;
      else keptUnder++;
    }
  }
  assert.equal(bed, 0, 'no lot stands on the at-grade track bed');
  assert.equal(pierce, 0, 'no lot pierces the guideway');
  // The counter-case the spec demands: a low lot UNDER the
  // elevated line near Beitou (h 6.0, underside 7.2) is real and
  // stays — the audit must see at least that one kept lot.
  assert.ok(keptUnder >= 1, `${keptUnder} low lot(s) kept under the guideway`);
  t.diagnostic(`clearance: bed ${bed}, pierce ${pierce}, kept under deck ${keptUnder}`);
});

test('depot (issue #139): the Beitou depot def vs the satellite, geometry, empty site', () => {
  const dep = TAIPEI_GEO.mrtDepot;
  assert.ok(dep, 'geodata carries mrtDepot');
  assert.equal(dep.halls.length, 3, 'three maintenance halls');
  const main = dep.halls[0];
  // User's satellite screenshot + OSM way 87530097 (min-area rect):
  // the main shed measures 325 x 198 m.
  assert.ok(main.len >= 318 && main.len <= 332, `main shed length ${main.len} m (satellite ~325)`);
  assert.ok(main.wid >= 190 && main.wid <= 204, `main shed width ${main.wid} m (satellite ~198)`);
  assert.ok(dep.yard.length >= 35, `${dep.yard.length} yard lines in the fan`);
  let yardKm = 0;
  for (const flat of dep.yard) {
    assert.ok(flat.length >= 4 && flat.length % 2 === 0, 'yard line is a flat point array');
    for (let i = 2; i < flat.length; i += 2) yardKm += Math.hypot(flat[i] - flat[i - 2], flat[i + 1] - flat[i - 1]) / 1000;
  }
  assert.ok(yardKm > 15, `${yardKm.toFixed(1)} km of yard track`);
  const g = buildMrtDepotGeometry(dep);
  assert.ok(g.triCount > 1000, `${g.triCount} depot triangles (halls + fan)`);
  for (let i = 0; i < g.positions.length; i++) assert.ok(Number.isFinite(g.positions[i]), 'finite depot geometry');
  // No planned lot inside the depot site rect (the planner's
  // rotated-frame test, candidate AABB corners in the site frame).
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  const cy = Math.cos(dep.yaw), sy = Math.sin(dep.yaw);
  for (const lot of plan.lots) {
    let pts;
    if (!lot.rot) pts = [[lot.x - lot.w / 2, lot.z - lot.d / 2], [lot.x + lot.w / 2, lot.z - lot.d / 2], [lot.x + lot.w / 2, lot.z + lot.d / 2], [lot.x - lot.w / 2, lot.z + lot.d / 2]];
    else {
      const c = Math.cos(lot.rot), s = Math.sin(lot.rot), hw = lot.w / 2, hd = lot.d / 2;
      pts = [
        [lot.x + hw * c - hd * s, lot.z + hw * s + hd * c],
        [lot.x + hw * c + hd * s, lot.z + hw * s - hd * c],
        [lot.x - hw * c + hd * s, lot.z - hw * s - hd * c],
        [lot.x - hw * c - hd * s, lot.z - hw * s + hd * c],
      ];
    }
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
    const hwA = (Math.max(...xs) - Math.min(...xs)) / 2, hdA = (Math.max(...zs) - Math.min(...zs)) / 2;
    let mnA = Infinity, mxA = -Infinity, mnL = Infinity, mxL = -Infinity;
    for (const [ox, oz] of [[-hwA, -hdA], [hwA, -hdA], [hwA, hdA], [-hwA, hdA]]) {
      const dx = lot.x + ox - dep.x, dz = lot.z + oz - dep.z;
      const la = dx * cy - dz * sy, ll = dx * sy + dz * cy;
      mnA = Math.min(mnA, la); mxA = Math.max(mxA, la); mnL = Math.min(mnL, ll); mxL = Math.max(mxL, ll);
    }
    const hit = mxA >= dep.site.dAcross - dep.site.across / 2 && mnA <= dep.site.dAcross + dep.site.across / 2 &&
                mxL >= dep.site.dAlong - dep.site.along / 2 && mnL <= dep.site.dAlong + dep.site.along / 2;
    assert.ok(!hit, `lot at (${lot.x.toFixed(0)}, ${lot.z.toFixed(0)}) inside the depot site`);
  }
});

test('at-grade stations (issue #139): ground-level geometry — platforms under a bridge hall', () => {
  const atGrade = stations.filter((s) => s.kind === 'at-grade');
  assert.equal(atGrade.length, 3);
  const g = buildMrtStationGeometry(atGrade);
  assert.equal(g.stationCount, 3);
  assert.ok(g.triCount > 100, `${g.triCount} at-grade station triangles`);
  let maxY = 0;
  for (let i = 1; i < g.positions.length; i += 3) maxY = Math.max(maxY, g.positions[i]);
  // Bridge hall roof at ~7.65 m — a small ground station, nothing
  // like the elevated structures (guideway datum 9 m + train box).
  assert.ok(maxY > 7.5 && maxY < 7.8, `at-grade roof top ${maxY.toFixed(2)} m`);
  for (const s of atGrade) {
    const n = nearestLinePoint(s.x, s.z);
    assert.ok(n && n.d < 12 && n.h <= 0.01, `${s.id} sits on the at-grade bed`);
    assert.ok(s.length >= 110 && s.length <= 160, `${s.id} length ${s.length} (OSM platforms ~110-145 m)`);
    // The platform inner edges must flank the served pair: sampled
    // along both edges (the renderer's platIn rule, mirrored from
    // js/taipei-mrt-stations.js), the distance to the nearest
    // track centreline stays in the prototypical band — the check
    // that caught Fuxinggang's first def, which the depot throat
    // leads had dragged ~15 m off the pair.
    const Wd = s.width || 16.5;
    const platIn = Math.min(Math.max(4.7, Wd / 2 - 3.4), 5.4);
    const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw);
    for (const side of [1, -1]) {
      let okCount = 0, total = 0;
      for (let al = -s.length / 2 + 15; al <= s.length / 2 - 15; al += 10) {
        const px = s.x + side * platIn * cy + al * sy;
        const pz = s.z - side * platIn * sy + al * cy;
        let bd = Infinity;
        for (const l of lines) {
          for (let i = 0; i + 3 < l.pts.length; i += 2) {
            const ax = l.pts[i], az = l.pts[i + 1], bx = l.pts[i + 2], bz = l.pts[i + 3];
            const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
            let tt = ((px - ax) * dx + (pz - az) * dz) / L2;
            tt = Math.max(0, Math.min(1, tt));
            bd = Math.min(bd, Math.hypot(ax + tt * dx - px, az + tt * dz - pz));
          }
        }
        total++;
        if (bd >= 1.2 && bd <= 3.5) okCount++;
      }
      assert.ok(okCount / total >= 0.9, `${s.id} side ${side}: platform edge flanks a track (${okCount}/${total} samples in 1.2-3.5 m)`);
    }
  }
});
