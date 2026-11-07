// Issue #279: cars descend through underpasses instead of driving flat
// at street level — the downward mirror of #254 (deck traffic).
//
// Proves, against the real geodata: (a) the 復北地下道 cars descend
// the rendered #196 trench (cut ramps -> bore floor at -5.35 m -> cut
// ramps) and the profiles are continuous across the shared nodes, so
// the ground and the tunnel join where the ramp meets grade; (b) no
// other tunnel descends — the other OSM tunnels have no rendered
// trench to follow, so inventing a depth would bury cars under the
// flat-rendered road, and they stay flat (a disclosed limitation);
// (c) the ground graph (#252) and the deck-only graph (#254) are
// unchanged. A synthetic source proves the ramp join and the
// false-join refusal in isolation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { buildTaipeiRoadGraph, taipeiTrafficEnv } from '../js/taipei-traffic.js';
import { buildRoadNetwork } from '../js/road-network.js';

const live = buildTaipeiRoadGraph(TAIPEI_GEO, { includeDecks: true, includeUnderpass: true });
const deck = buildTaipeiRoadGraph(TAIPEI_GEO, { includeDecks: true });
const ground = buildTaipeiRoadGraph(TAIPEI_GEO);
const TRENCH_FLOOR = -5.35; // ROAD_TRENCH_DEPTH_M, the #196 trench datum

const underpassLinks = (g) => g.roadGraph.links.filter((L) => L[7] && Math.min(...L[7].h) < -0.5);

test('underpass census: 6 links descend, decks and ground unchanged (issue #279)', () => {
  // The live graph is the deck graph plus the tunnel route: 2
  // 復北地下道 carriageways + 4 approach ramps (2 per direction),
  // 1.3 km. No link is added or removed (the 6 already existed as
  // flat 7-tuples in the deck graph); no height split fires (the
  // profiles are continuous across the shared nodes); no profile
  // is broken (underpassInvalidEdges 0: the trench function is
  // analytic, so a broken profile would mean the match failed).
  // The deck census is byte-identical to #254 and the ground
  // census to #252 (re-pinned for #284: five two-way level-2 spans
  // return — drivable 27,737 -> 27,742, links 13,233 -> 13,237,
  // keptKm 1,311.2 -> 1,311.7, droppedLevelEdges 1,430 -> 1,425).
  assert.equal(live.stats.underpassMode, true);
  assert.equal(live.stats.underpassLinks, 6);
  assert.equal(live.stats.underpassKm, 1.3);
  assert.equal(live.stats.underpassInvalidEdges, 0);
  assert.equal(live.stats.heightSplits, 1);
  assert.equal(live.stats.links, 13433);
  assert.equal(live.stats.deckLinks, 372);
  assert.equal(live.stats.deckKm, 163.7);
  assert.equal(live.stats.droppedLevelEdges, 32);
  assert.equal(deck.stats.underpassMode, false);
  assert.equal(deck.stats.underpassLinks, 0);
  assert.equal(deck.stats.deckLinks, 372);
  assert.equal(ground.stats.underpassMode, false);
  assert.equal(ground.stats.underpassLinks, 0);
  assert.equal(ground.stats.drivableEdges, 27742);
  assert.equal(ground.stats.links, 13237);
  assert.equal(ground.stats.keptKm, 1311.7);
  assert.equal(ground.stats.droppedLevelEdges, 1425);
});

test('profiles: the 復北地下道 descends to the trench floor (issue #279)', () => {
  // Both carriageways reach the bore floor (-5.35 m) and neither
  // goes below it; the approaches ramp from grade to the floor.
  // The floor the cars drive agrees with the floor the renderer
  // draws (the #196 cut floors: grade at the cut end, -5.35 m at
  // the face, -5.35 m through the bore).
  const ups = underpassLinks(live);
  assert.equal(ups.length, 6);
  const names = live.roadGraph.names;
  const tunnel = ups.filter((L) => names[L[2]] === '復北地下道');
  assert.equal(tunnel.length, 2, 'both tunnel carriageways descend');
  for (const L of tunnel) {
    const h = L[7].h;
    assert.ok(Math.min(...h) <= TRENCH_FLOOR + 0.05, `tunnel reaches the floor, min ${Math.min(...h)}`);
    assert.ok(Math.min(...h) >= TRENCH_FLOOR - 0.05, `tunnel never goes below the floor, min ${Math.min(...h)}`);
  }
  const approaches = ups.filter((L) => names[L[2]] !== '復北地下道');
  assert.equal(approaches.length, 4, 'four approach ramps');
  for (const L of approaches) {
    const h = L[7].h;
    assert.ok(Math.max(...h) >= -0.05, `approach meets grade, max ${Math.max(...h)}`);
    assert.ok(Math.min(...h) < -4, `approach reaches the trench, min ${Math.min(...h)}`);
    assert.ok(Math.min(...h) >= TRENCH_FLOOR - 0.05, 'approach never goes below the floor');
  }
});

test('profiles: shape invariants on every underpass link (issue #279)', () => {
  // The deck shape test's bounds, mirrored downward: no jump over
  // 1.5 m between adjacent samples (the north cut ramps 5.35 m
  // over 30 m, so the 4 m underpass sample step keeps jumps at
  // 0.72 m — an 8 m step would jump 1.43 m, inside the bound but
  // with almost no margin), and no interior near-zero sample
  // between deep samples (a car never pops up to grade mid-tunnel).
  for (const L of underpassLinks(live)) {
    const { s, h } = L[7];
    assert.equal(s.length, h.length, 's/h arrays align');
    assert.ok(s[0] === 0, 'profile starts at 0');
    for (let i = 1; i < s.length; i++) assert.ok(s[i] > s[i - 1], 's strictly increases');
    for (let i = 1; i < h.length; i++) {
      assert.ok(Math.abs(h[i] - h[i - 1]) <= 1.5, `jump ${h[i - 1]} -> ${h[i]} in ${live.roadGraph.names[L[2]] || '(unnamed)'}`);
    }
    for (let i = 1; i + 1 < h.length; i++) {
      assert.ok(!(h[i] > -0.5 && h[i - 1] < -0.5 && h[i + 1] < -0.5), `interior pop-up in ${live.roadGraph.names[L[2]] || '(unnamed)'}`);
    }
  }
});

test('profiles: only the rendered trench descends (issue #279)', () => {
  // Every underpass link is the 復北地下道 or one of its (unnamed)
  // approaches. The other named tunnels — 自強隧道, 象山隧道 and
  // the 車行地下道s — have no rendered trench, so their links stay
  // flat 7-tuples: a car there still drives at grade, as before,
  // rather than sinking under the flat-rendered road. That is the
  // disclosed scope limit, and this test pins it so a future
  // trench rendering (a tile-geometry change) is what extends it.
  const names = live.roadGraph.names;
  for (const L of underpassLinks(live)) {
    assert.ok(names[L[2]] === '復北地下道' || names[L[2]] === '', `unexpected underpass link ${names[L[2]]}`);
  }
  for (const n of ['自強隧道', '象山隧道', '基隆路車行地下道', '林森南路車行地下道', '辛亥路車行地下道', '忠孝西路地下道', '圓山隧道']) {
    const ls = live.roadGraph.links.filter((L) => names[L[2]] === n);
    assert.ok(ls.length >= 1, `${n} is in the graph`);
    assert.ok(ls.every((L) => !L[7] || Math.min(...L[7].h) >= -0.5), `${n} stays flat`);
  }
});

function liveNetwork() {
  const env = taipeiTrafficEnv(200);
  return buildRoadNetwork([], [], env.networkEnv);
}

test('join + reachability: the tunnel is entered and left through its ramps (issue #279)', () => {
  // The #254 join rule, on the live graph: no move joins heights
  // differing by more than 0.6 m (already asserted for every move
  // in the deck test — here the tunnel route concretely). A ground
  // edge by the north mouth reaches a bore edge below -5 m, and
  // the bore reaches the ground again south of the tunnel — through
  // the ramps only, never by jumping from a deep edge to a flat one.
  const net = liveNetwork();
  const isGround = (e) => Math.max(e.y0 || 0, e.y1 || 0) <= 0.5 && Math.min(e.y0 || 0, e.y1 || 0) >= -0.5;
  const isBore = (e) => Math.min(e.y0 || 0, e.y1 || 0) < -5;
  const bore = net.edges.filter(isBore);
  assert.ok(bore.length >= 2, `bore edges exist, got ${bore.length}`);
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
  const fromGround = bfs(groundEdges, succ);
  const toGround = bfs(groundEdges, pred);
  assert.ok(bore.every((e) => fromGround.has(e)), 'every bore edge is reachable from the ground');
  assert.ok(bore.every((e) => toGround.has(e)), 'every bore edge returns to the ground');
  // The acceptance route, concretely: ground by the north mouth
  // (-2088, -3700) reaches the bore, and the bore reaches ground
  // south of the tunnel (-2088, -4340).
  const nearNorth = groundEdges.filter((e) => Math.hypot(e.sx + 2088, e.sz + 3700) < 150);
  assert.ok(nearNorth.length > 0, 'ground edges by the north mouth');
  const reached = bfs(nearNorth, succ);
  assert.ok([...reached].some(isBore), 'the north-mouth streets reach the bore');
  const boreReached = [...reached].filter(isBore);
  const southGround = groundEdges.filter((e) => Math.hypot(e.sx + 2088, e.sz + 4340) < 150);
  assert.ok(southGround.length > 0, 'ground edges south of the tunnel');
  assert.ok(boreReached.some((e) => [...bfs([e], succ)].some((f) => southGround.includes(f))), 'the bore returns to the southern streets');
});

test('synthetic: ramp joins the tunnel, a flat street at the mouth does not (issue #279)', () => {
  // A two-way tunnel road with approach ramps (north cut 50 m,
  // bore 200 m, south cut 50 m) and a flat bypass joining the
  // CUT ENDS (nodes 1 and 4), where the ramps are at grade. The
  // bypass must NOT attach at the mouths (nodes 2 and 3): there
  // the ramp and the bore sit at -5.35 m, so the level-join rule
  // (JOIN_TOL 0.6) refuses a grade road's turn onto them, the
  // bypass edges become dead ends, the SCC drops them, and the
  // tunnel never survives — that was the first form of this test,
  // and it failed exactly that way. The tunnel link must hold the
  // floor, the approaches must ramp 0 -> floor -> 0, the streets
  // and the bypass stay 7-tuples, and the network must join the
  // tunnel only through the ramps — never from flat ground.
  const nodes = [0, 0, 0, 100, 0, 150, 0, 350, 0, 400, 0, 500, 100, 100, 100, 400];
  const edge = (a, b, name, highway, level, oneway = false) => ({
    a, b, name, highway, oneway, width: 8, pedestrianLayout: 'sidewalk', length: 100, level,
  });
  const source = {
    roadGraph: {
      nodes,
      edges: [
        edge(0, 1, 'Street', 'tertiary', 0),
        edge(1, 2, 'Approach', 'secondary', 0),
        edge(2, 3, 'Tunnel', 'secondary', -1),
        edge(3, 4, 'Approach', 'secondary', 0),
        edge(4, 5, 'Street', 'tertiary', 0),
        edge(1, 6, 'Bypass', 'tertiary', 0),
        edge(6, 7, 'Bypass', 'tertiary', 0),
        edge(7, 4, 'Bypass', 'tertiary', 0),
      ],
    },
    airfield: {
      roadTunnels: [{
        name: 'Test Tunnel', highway: 'secondary', width: 16,
        runs: [[0, 150, 0, 350]],
        mouths: [
          { x: 0, z: 150, tx: 0, tz: 1, cut: { lenM: 50, pts: [0, 150, 0, 100] } },
          { x: 0, z: 350, tx: 0, tz: -1, cut: { lenM: 50, pts: [0, 350, 0, 400] } },
        ],
        lengthM: 200,
      }],
    },
    frame: { bbox: { minX: -500, maxX: 500, minZ: -500, maxZ: 500 } },
  };
  // Fix the edge lengths to the real chord lengths (the helper above
  // writes 100 for every edge; the profile sampler uses plan
  // distance, but the stats and the run chaining use length).
  for (const e of source.roadGraph.edges) {
    e.length = Math.hypot(nodes[e.b * 2] - nodes[e.a * 2], nodes[e.b * 2 + 1] - nodes[e.a * 2 + 1]);
  }
  const built = buildTaipeiRoadGraph(source, { includeUnderpass: true });
  const names = built.roadGraph.names;
  assert.equal(built.stats.underpassLinks, 3, 'tunnel + two approaches');
  assert.equal(built.stats.underpassInvalidEdges, 0);
  const tunnelLinks = built.roadGraph.links.filter((L) => names[L[2]] === 'Tunnel');
  assert.equal(tunnelLinks.length, 1, 'one tunnel link');
  assert.ok(tunnelLinks[0][7].h.every((h) => Math.abs(h - TRENCH_FLOOR) < 0.05), `tunnel holds the floor, got ${tunnelLinks[0][7].h[0]}`);
  const approachLinks = built.roadGraph.links.filter((L) => names[L[2]] === 'Approach');
  assert.equal(approachLinks.length, 2, 'two approach links');
  const north = approachLinks.find((L) => L[7].h[0] >= -0.05);
  const south = approachLinks.find((L) => L[7].h[L[7].h.length - 1] >= -0.05);
  assert.ok(north, 'north approach starts at grade');
  assert.ok(Math.min(...north[7].h) <= TRENCH_FLOOR + 0.05, 'north approach reaches the floor');
  assert.ok(south, 'south approach ends at grade');
  assert.ok(Math.min(...south[7].h) <= TRENCH_FLOOR + 0.05, 'south approach reaches the floor');
  const flatLinks = built.roadGraph.links.filter((L) => names[L[2]] === 'Street' || names[L[2]] === 'Bypass');
  assert.ok(flatLinks.length >= 3, 'street and bypass links exist');
  assert.ok(flatLinks.every((L) => L.length === 7), 'ground links stay 7-tuples');

  const net = buildRoadNetwork([], [], {
    roadGraph: built.roadGraph, avenues: [], streets: [], medians: [], onLand: () => true,
  });
  const byEnds = (y0, y1) => net.edges.filter((e) => Math.abs((e.y0 || 0) - y0) < 0.6 && Math.abs((e.y1 || 0) - y1) < 0.6);
  const tunnelEdges = byEnds(TRENCH_FLOOR, TRENCH_FLOOR);
  assert.ok(tunnelEdges.length >= 1, 'tunnel edges survive with heights');
  const flatEdges = net.edges.filter((e) => (e.y0 || 0) === 0 && (e.y1 || 0) === 0);
  assert.ok(flatEdges.length >= 1, 'flat edges survive');
  // No move from a bore edge to a flat edge (the false join at the
  // mouth is refused); the bore joins the ramps, and the ramps join
  // the streets at grade. On the correct tree this first check is
  // vacuous — a flat edge touching a mouth is always a dead end
  // (its only onward edges sit 5.35 m below it) and the SCC drops
  // it — but it fails exactly when the join rule breaks, which is
  // what it guards.
  assert.ok(tunnelEdges.every((t) => t.moves.every((m) => !flatEdges.includes(m.to))), 'no move from the bore to flat ground');
  assert.ok(tunnelEdges.some((t) => t.moves.length > 0), 'the bore has a way on — through its ramps');
  const rampEdges = net.edges.filter((e) => Math.min(e.y0 || 0, e.y1 || 0) < -0.5 && Math.max(e.y0 || 0, e.y1 || 0) >= -0.05);
  assert.ok(rampEdges.length >= 1, 'ramp edges exist');
  assert.ok(flatEdges.some((g) => g.moves.some((m) => rampEdges.includes(m.to))), 'the street joins the ramp foot');
  assert.ok(rampEdges.some((r) => r.moves.some((m) => tunnelEdges.includes(m.to))), 'the ramp joins the bore');
});
