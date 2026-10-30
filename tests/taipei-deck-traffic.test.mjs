// Issue #254: cars driving on elevated decks (height-aware traffic).
//
// Proves, against the real geodata: (a) deck height profiles match
// the rendered digest (sampled heights agree with the drive model's
// independent sampling, ramps climb, cruises hold, every digest
// line is represented); (b) routing joins levels only at ramps —
// no move joins heights differing by more than the 0.6 m join
// tolerance, every deck edge is reachable from the ground and can
// return to it; (c) the ground-level graph pins from #252 are
// unchanged. A synthetic source proves the join rule and the
// unplaced-edge drop in isolation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { buildTaipeiRoadGraph, taipeiTrafficEnv } from '../js/taipei-traffic.js';
import { buildRoadNetwork } from '../js/road-network.js';
import { buildDriveModel } from '../js/taipei-drive.js';

const deck = buildTaipeiRoadGraph(TAIPEI_GEO, { includeDecks: true });
const ground = buildTaipeiRoadGraph(TAIPEI_GEO);

test('deck census: profiles ride the graph, ground pins unchanged (issue #254)', () => {
  // The deck graph is a superset of the ground graph: the 1,183
  // dropped deck/ramp edges return except 32 the digest cannot
  // place (mis-tagged ground alleys and scooter-lane fragments
  // whose chords follow no digest line within 4 m). Every digest
  // line is still represented at its height (see the coverage
  // test below), and no profile is broken (deckInvalidEdges 0:
  // the whole-edge line match never flips carriageways mid-span).
  // The default graph is byte-identical to the #252 pins.
  assert.equal(deck.stats.deckMode, true);
  assert.equal(deck.stats.drivableEdges, 25674);
  assert.equal(deck.stats.links, 12098);
  assert.equal(deck.stats.keptKm, 1255.5);
  assert.equal(deck.stats.deckLinks, 297);
  assert.equal(deck.stats.deckKm, 137.9);
  assert.equal(deck.stats.droppedLevelEdges, 32);
  assert.equal(deck.stats.droppedLevelKm, 2.8);
  assert.equal(deck.stats.deckInvalidEdges, 0);
  assert.equal(deck.stats.heightSplits, 1);
  assert.equal(ground.stats.deckMode, false);
  assert.equal(ground.stats.drivableEdges, 24523);
  assert.equal(ground.stats.links, 11942);
  assert.equal(ground.stats.keptKm, 1161.0);
  assert.equal(ground.stats.droppedLevelEdges, 1183);
  assert.equal(ground.stats.keptLevelEdges, 518);
  assert.equal(ground.stats.deckLinks, 0);
});

test('profiles: every digest line is represented, at its height (issue #254)', () => {
  const names = deck.roadGraph.names;
  const bestByName = new Map();
  for (const L of deck.roadGraph.links) {
    if (!L[7]) continue;
    const mh = Math.max(...L[7].h);
    const n = names[L[2]];
    if (!bestByName.has(n) || bestByName.get(n) < mh) bestByName.set(n, mh);
  }
  for (const line of TAIPEI_GEO.elevatedRoads.lines) {
    const need = Math.max(...line.h);
    if (need < 0.5) continue;
    const got = bestByName.get(line.name);
    assert.ok(got !== undefined, `no profiled link for digest line ${line.name}`);
    assert.ok(got >= need - 2, `${line.name}: profiled max ${got} vs digest max ${need}`);
  }
});

test('profiles: shape invariants on every profiled link (issue #254)', () => {
  // No interior near-zero sample (a dip to the ground mid-deck)
  // and no jump over 1.5 m between adjacent samples (the steepest
  // real ramp is 9.5%, under 0.8 m per 8 m sample): a car
  // following any profile never teleports vertically.
  let profiled = 0;
  for (const L of deck.roadGraph.links) {
    if (!L[7]) continue;
    profiled++;
    const { s, h } = L[7];
    assert.equal(s.length, h.length, 's/h arrays align');
    assert.ok(s[0] === 0, 'profile starts at 0');
    for (let i = 1; i < s.length; i++) assert.ok(s[i] > s[i - 1], 's strictly increases');
    for (let i = 1; i < h.length; i++) {
      assert.ok(Math.abs(h[i] - h[i - 1]) <= 1.5, `jump ${h[i - 1]} -> ${h[i]} in ${deck.roadGraph.names[L[2]]}`);
    }
    for (let i = 1; i + 1 < h.length; i++) {
      assert.ok(!(h[i] < 0.5 && h[i - 1] > 0.5 && h[i + 1] > 0.5), `interior dip in ${deck.roadGraph.names[L[2]]}`);
    }
  }
  assert.ok(profiled > 250, `expected hundreds of profiled links, got ${profiled}`);
});

test('profiles: the 洲美 interchange ramp climbs 0 to the deck (issue #254)', () => {
  // 大業路入口匝道, the on-ramp at 公舘路 / 承德路七段: the digest
  // climbs 0 -> 15 m to meet the 洲美快速道路 deck. The link
  // profile must start at the ground, climb without dipping, and
  // end at deck height.
  const names = deck.roadGraph.names;
  const ramps = deck.roadGraph.links.filter((L) => L[7] && names[L[2]] === '大業路入口匝道');
  assert.ok(ramps.length >= 1, 'ramp link exists');
  for (const L of ramps) {
    const h = L[7].h;
    assert.ok(h[0] <= 0.5, `ramp starts at the ground, got ${h[0]}`);
    assert.ok(h[h.length - 1] >= 14, `ramp ends at deck height, got ${h[h.length - 1]}`);
    for (let i = 1; i < h.length; i++) assert.ok(h[i] >= h[i - 1] - 0.6, 'ramp never dips');
  }
});

test('profiles: sampled heights agree with the drive model at every vertex (issue #254)', () => {
  // Independent cross-check: buildDriveModel samples the same
  // digest with its own closest-to-hint rule (the rule the
  // renderer and the driving colliders use). At every polyline
  // vertex of every profiled link — points lying exactly on the
  // digest polyline — the two must agree within a metre. Vertices
  // outside the drive model's corridor interior (within 0.5 m of
  // its edge, where its exact-half corridor and this sampler's
  // +1.5 m margin legitimately differ — e.g. the scooter lane
  // running along a bridge deck's edge) are skipped: there the
  // drive model sees the ground, not the deck.
  const drive = buildDriveModel(TAIPEI_GEO.elevatedRoads);
  const segs = [];
  for (const line of TAIPEI_GEO.elevatedRoads.lines) {
    const half = (line.width || 6) / 2;
    for (let i = 0; i + 1 < line.pts.length / 2; i++) {
      segs.push([line.pts[2 * i], line.pts[2 * i + 1], line.pts[2 * i + 2], line.pts[2 * i + 3], half]);
    }
  }
  const corridor = (x, z) => {
    let best = Infinity, bestHalf = 0;
    for (const [ax, az, bx, bz, half] of segs) {
      const dx = bx - ax, dz = bz - az;
      const len2 = dx * dx + dz * dz;
      const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
      const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
      if (d < best) { best = d; bestHalf = half; }
    }
    return best <= bestHalf - 0.5;
  };
  const nodes = deck.roadGraph.nodes;
  let checked = 0;
  let skipped = 0;
  let worst = 0;
  let worstName = '';
  for (const L of deck.roadGraph.links) {
    if (!L[7]) continue;
    const { s, h } = L[7];
    const pts = [[nodes[L[0] * 2], nodes[L[0] * 2 + 1]]];
    for (let k = 0; k < L[6].length; k += 2) pts.push([L[6][k], L[6][k + 1]]);
    pts.push([nodes[L[1] * 2], nodes[L[1] * 2 + 1]]);
    const arc = [0];
    for (let k = 1; k < pts.length; k++) arc.push(arc[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
    for (let k = 0; k < pts.length; k++) {
      if (!corridor(pts[k][0], pts[k][1])) { skipped++; continue; }
      const a = arc[k];
      let lo = 0;
      while (lo + 1 < s.length && s[lo + 1] <= a) lo++;
      const f = s[lo + 1] !== undefined && s[lo + 1] > s[lo] ? (a - s[lo]) / (s[lo + 1] - s[lo]) : 0;
      const expected = h[lo] + ((h[lo + 1] ?? h[lo]) - h[lo]) * Math.max(0, Math.min(1, f));
      const got = drive.sample(pts[k][0], pts[k][1], expected);
      const diff = Math.abs(got - expected);
      if (diff > worst) { worst = diff; worstName = deck.roadGraph.names[L[2]]; }
      checked++;
    }
  }
  assert.ok(checked > 1000, `checked ${checked} vertices`);
  assert.ok(worst <= 1.0, `worst sampler disagreement ${worst.toFixed(2)} m on ${worstName}`);
});

function deckNetwork() {
  const env = taipeiTrafficEnv(200);
  return buildRoadNetwork([], [], env.networkEnv);
}

test('join rule: no move joins heights differing by more than 0.6 m (issue #254)', () => {
  const net = deckNetwork();
  let moves = 0;
  for (const e of net.edges) {
    assert.ok(e.moves.length > 0, 'every edge has a way on');
    for (const m of e.moves) {
      moves++;
      assert.ok(
        Math.abs((e.y1 || 0) - (m.to.y0 || 0)) <= 0.6,
        `move joins ${(e.y1 || 0).toFixed(1)} m to ${(m.to.y0 || 0).toFixed(1)} m`,
      );
    }
  }
  assert.ok(moves > 15000, `checked ${moves} moves`);
});

test('reachability: every deck edge is reachable from the ground and returns to it (issue #254)', () => {
  const net = deckNetwork();
  const isDeck = (e) => Math.max(e.y0 || 0, e.y1 || 0) > 0.5;
  const isGround = (e) => !isDeck(e);
  const succ = new Map();
  const pred = new Map();
  for (const e of net.edges) {
    succ.set(e, e.moves.map((m) => m.to));
    for (const f of succ.get(e)) {
      if (!pred.has(f)) pred.set(f, []);
      pred.get(f).push(e);
    }
  }
  const bfs = (starts, next) => {
    const seen = new Set(starts);
    const stack = [...starts];
    while (stack.length) {
      const e = stack.pop();
      for (const f of next.get(e) || []) {
        if (!seen.has(f)) { seen.add(f); stack.push(f); }
      }
    }
    return seen;
  };
  const groundEdges = net.edges.filter(isGround);
  const deckEdges = net.edges.filter(isDeck);
  assert.ok(deckEdges.length > 200, `expected hundreds of deck edges, got ${deckEdges.length}`);
  const fromGround = bfs(groundEdges, succ);
  const toGround = bfs(groundEdges, pred);
  const stranded = deckEdges.filter((e) => !fromGround.has(e) || !toGround.has(e));
  assert.equal(stranded.length, 0, `${stranded.length} deck edges unreachable from, or unable to return to, the ground`);
  // The acceptance route, concretely: a ground edge by 公舘路
  // reaches a 洲美快速道路 deck edge over 10 m up, and the deck
  // reaches the ground again — through ramps only.
  const nearGongguan = groundEdges.filter((e) => Math.hypot(e.x0 + 6403, e.z0 + 9592) < 400);
  assert.ok(nearGongguan.length > 0, 'ground edges by the interchange');
  const reached = bfs(nearGongguan, succ);
  const highDeck = [...reached].filter((e) => Math.max(e.y0 || 0, e.y1 || 0) > 10);
  assert.ok(highDeck.length > 0, 'a deck over 10 m is reachable from the interchange streets');
  assert.ok([...bfs(highDeck, succ)].some(isGround), 'the high deck returns to the ground');
});

test('ground core: the #252 network is unchanged (issue #254)', () => {
  // Cross-run proof for the re-pin in taipei-traffic.test.mjs: the
  // ground-only graph on this geodata builds the exact #252 core.
  const env = taipeiTrafficEnv(200);
  const g = buildTaipeiRoadGraph(TAIPEI_GEO);
  const net = buildRoadNetwork([], [], { ...env.networkEnv, roadGraph: g.roadGraph });
  assert.equal(net.nodes.length, 6890);
  assert.equal(net.edges.length, 15229);
  assert.equal(net.paintEdges.length, 20984);
  for (const e of net.edges) {
    assert.equal(e.y0 || 0, 0, 'ground edges carry no heights');
    assert.equal(e.y1 || 0, 0, 'ground edges carry no heights');
  }
});

test('pocket: the NW Huanhe pocket rejoins the core, both directions, deck at height (issues #254/#274)', () => {
  // GRAPH-INPUT STATEMENT: buildTaipeiRoadGraph({ includeDecks: true })
  // starts from the UNFILTERED drivable edges (rg.edges) — the #252
  // drop rule is bypassed in deck mode; only unplaceable level >= 2
  // edges (32) and broken profiles (0) leave. The Huanhe census
  // (huanhe-evidence/census3.mjs) measured the NW pocket — nodes of
  // 環河北*/重陽* edges with either endpoint x < -6200, 141 nodes —
  // at 71/141 in the main strongly-connected component unfiltered
  // vs 10/141 under the #252 filter. The deck network must
  // restore-or-beat 71: buildRoadNetwork step 7 keeps only the main
  // SCC, so a surviving edge through the pocket IS the core.
  // Measured on this tree (huanhe-evidence/measure-deck-pocket.mjs):
  // 98/141 pocket nodes within 20 m of a surviving deck-network
  // edge (20 m absorbs junction-collapse shifts; the chained runs
  // are straight chords), 51 northbound + 63 southbound
  // ground-loop edges through the pocket box, 15 deck edges >= 5 m
  // within 300 m of the 重陽橋 east landing, 1 approach edge
  // climbing > 3 m in the 三段 box. The ground network on the same
  // tree covers 22/141 with 0 northbound / 1 southbound loop edge
  // — the pocket stays stranded there, which is #274's separate
  // height-independent defect, not this test's. Floors below are
  // the census baselines, not the measured values, so the test
  // fails only if the pocket actually strands again.
  const rg = TAIPEI_GEO.roadGraph;
  const gNodes = rg.nodes;
  const pocket = new Set();
  for (const e of rg.edges) {
    const n = e.name || '';
    if (!n.includes('環河北') && !n.includes('重陽')) continue;
    if (gNodes[e.a * 2] < -6200 || gNodes[e.b * 2] < -6200) { pocket.add(e.a); pocket.add(e.b); }
  }
  assert.equal(pocket.size, 141, 'pocket node set matches the census definition');
  const net = deckNetwork();
  const distToSeg = (px, pz, ax, az, bx, bz) => {
    const dx = bx - ax, dz = bz - az;
    const L2 = dx * dx + dz * dz;
    let t = L2 ? ((px - ax) * dx + (pz - az) * dz) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
  };
  let covered = 0;
  for (const i of pocket) {
    const x = gNodes[i * 2], z = gNodes[i * 2 + 1];
    let best = Infinity;
    for (const e of net.edges) {
      const d = distToSeg(x, z, e.sx, e.sz, e.sx + e.dx * e.len, e.sz + e.dz * e.len);
      if (d < best) best = d;
      if (best <= 20) break;
    }
    if (best <= 20) covered++;
  }
  assert.ok(covered >= 71, `pocket rejoins the core: ${covered}/141 covered, baseline 71`);
  let north = 0, south = 0, landingDeck = 0, approach = 0;
  for (const e of net.edges) {
    const mx = e.sx + e.dx * e.len / 2, mz = e.sz + e.dz * e.len / 2;
    const hi = Math.max(e.y0 || 0, e.y1 || 0);
    if (mx < -6200 && mz >= -6170 && mz <= -4580 && hi <= 0.5 && Math.abs(e.dz) > Math.abs(e.dx)) {
      if (e.dz < 0) north++;
      else south++;
    }
    if (Math.hypot(mx + 5491, mz + 6001) <= 300 && hi >= 5) landingDeck++;
    if (mx >= -5765 && mx <= -5711 && mz >= -5268 && mz <= -5087 && e.yProf) {
      let mn = Infinity, mxh = -Infinity;
      for (const h of e.yProf) { if (h < mn) mn = h; if (h > mxh) mxh = h; }
      if (mxh - mn > 3) approach++;
    }
  }
  assert.ok(north >= 10 && south >= 10, `bend loop drives both directions: north ${north}, south ${south}`);
  assert.ok(landingDeck >= 5, `bridge deck at height by the east landing: ${landingDeck} edges`);
  assert.ok(approach >= 1, '三段 approach climbs onto the deck');
});

test('synthetic: ramp joins levels, false joins do not, unplaced decks drop (issue #254)', () => {  // A ground street (nodes 0-1-2), an on-ramp (1-4, digest 0 ->
  // 9), a two-way deck (4-3, digest flat 9), an off-ramp (3-2,
  // digest 9 -> 0), a ground street (2-3) sharing the deck's end
  // node (the false join), and a deck chord (2-3) with no digest
  // line at all. The on-ramp, deck, and off-ramp form a cycle
  // with the streets, so the deck survives the strongly-connected
  // cut; the chord drops, and no move crosses the false join.
  const nodes = [0, 0, 100, 0, 200, 0, 200, 100, 100, 100];
  const edge = (a, b, name, highway, level, oneway = false) => ({
    a, b, name, highway, oneway, width: 8, pedestrianLayout: 'sidewalk', length: 100, level,
  });
  const source = {
    roadGraph: {
      nodes,
      edges: [
        edge(0, 1, 'Street', 'tertiary', 0),
        edge(1, 2, 'Street', 'tertiary', 0),
        edge(1, 4, 'Ramp', 'trunk_link', 1, true),
        edge(4, 3, 'Deck', 'trunk', 2),
        edge(3, 2, 'OffRamp', 'trunk_link', 1, true),
        edge(2, 3, 'Street2', 'tertiary', 0),
        edge(2, 3, 'Chord', 'trunk', 2, true),
      ],
    },
    elevatedRoads: {
      lines: [
        { wayId: 1, name: 'Ramp', highway: 'trunk_link', layer: 1, width: 8, pts: [100, 0, 100, 100], h: [0, 9] },
        { wayId: 2, name: 'Deck', highway: 'trunk', layer: 2, width: 12, pts: [100, 100, 200, 100], h: [9, 9] },
        { wayId: 3, name: 'OffRamp', highway: 'trunk_link', layer: 1, width: 8, pts: [200, 100, 200, 0], h: [9, 0] },
      ],
      piers: [], deckDepth: 1.8, stats: {},
    },
  };
  const built = buildTaipeiRoadGraph(source, { includeDecks: true });
  const names = built.roadGraph.names;
  assert.ok(!names.includes('Chord'), 'deck chord with no digest line drops');
  const rampLinks = built.roadGraph.links.filter((L) => names[L[2]] === 'Ramp');
  assert.equal(rampLinks.length, 1, 'one ramp link');
  const rh = rampLinks[0][7].h;
  assert.ok(rh[0] <= 0.5 && rh[rh.length - 1] >= 8, `ramp profile climbs 0 -> 9, got ${rh[0]} -> ${rh[rh.length - 1]}`);
  const offLinks = built.roadGraph.links.filter((L) => names[L[2]] === 'OffRamp');
  assert.equal(offLinks.length, 1, 'one off-ramp link');
  const oh = offLinks[0][7].h;
  assert.ok(oh[0] >= 8 && oh[oh.length - 1] <= 0.5, `off-ramp profile falls 9 -> 0, got ${oh[0]} -> ${oh[oh.length - 1]}`);
  const deckLinks = built.roadGraph.links.filter((L) => names[L[2]] === 'Deck');
  assert.equal(deckLinks.length, 1, 'one deck link');
  assert.ok(deckLinks[0][7].h.every((h) => Math.abs(h - 9.03) < 0.6), 'deck profile holds 9 m');
  const streetLinks = built.roadGraph.links.filter((L) => names[L[2]] === 'Street');
  assert.ok(streetLinks.every((L) => L.length === 7), 'ground links stay 7-tuples');

  const net = buildRoadNetwork([], [], {
    roadGraph: built.roadGraph, avenues: [], streets: [], medians: [], onLand: () => true,
  });
  const byEnds = (y0, y1) => net.edges.filter((e) => Math.abs((e.y0 || 0) - y0) < 0.6 && Math.abs((e.y1 || 0) - y1) < 0.6);
  const ramps = byEnds(0, 9);
  const decks = byEnds(9, 9);
  const offRamps = byEnds(9, 0);
  assert.ok(ramps.length >= 1 && decks.length >= 1 && offRamps.length >= 1, 'ramp, deck, and off-ramp edges survive with heights');
  // Ramp -> deck -> off-ramp is a route; deck -> ground street is not.
  assert.ok(ramps.some((r) => r.moves.some((m) => decks.includes(m.to))), 'ramp joins the deck');
  assert.ok(decks.some((d) => d.moves.some((m) => offRamps.includes(m.to))), 'deck joins the off-ramp');
  const groundAtDeckEnd = net.edges.filter((e) => (e.y0 || 0) === 0 && (e.y1 || 0) === 0);
  assert.ok(decks.every((d) => d.moves.every((m) => !groundAtDeckEnd.includes(m.to))), 'no move from the deck to the ground');
  assert.ok(groundAtDeckEnd.some((g) => g.moves.some((m) => ramps.includes(m.to))), 'the street joins the ramp foot');
});
