import { TAIPEI_GEO } from './taipei-geodata.js';

// js/taipei-traffic.js — issue #210 EXPERIMENT: traffic generation for the Taipei tile.
//
// Why Taipei has no traffic today: js/main.js creates the upstream traffic system only for
// NYC. buildRoadNetwork (js/road-network.js) derives its drivable graph from the Manhattan
// avenue/street grid in city-config.js (steps 2-4 and the step-8 signal table) PLUS a generic
// centreline graph (step 4b: GEO.roadGraph links), with steps 5-7 and 9 (directed edges,
// movements, largest strongly connected set, arms & right-of-way groups) fully generic. The
// tile stub in main.js ("traffic and pedestrians stay off until their data exists") exists
// because the grid half has no Taipei meaning.
//
// This module supplies the missing data, honestly:
// - buildTaipeiRoadGraph() converts TAIPEI_GEO.roadGraph (segment-level: 42,770 edges
//   between polyline vertices, 23% of them under 14 m) into the junction-to-junction link
//   tuples road-network.js step 4b consumes ([a, b, nameIndex, width, lanes, dir, inner]),
//   the same conversion js/taipei-adapter.js documents but chained: walks run through
//   degree-2 vertices while name and one-way-ness hold, so a run is one street between two
//   junctions with its bends as inner shape points. Non-drivable classes (service aisles,
//   tracks, busways, construction...) are dropped first.
// - GROUND + CROSSINGS (issue #252): every roadGraph edge carries its
//   OSM `level` (tools/taipei/rebuild-roadgraph.mjs). Deck and ramp
//   links are EXCLUDED — every *_link ramp, and every edge at
//   |level| >= 2: the vehicle system drives flat at y=0, so routing
//   onto one made cars drive at ground level through the interchange
//   below it (the off-road driving reported at 公舘路/承德路七段).
//   Level ±1 non-link edges (river bridges, tunnels) are KEPT: they
//   are the only crossings, and dropping them cut the routable core
//   from 7,495 nodes to 3,591. Deck driving with real heights is
//   issue #254.
// - taipeiTrafficEnv() is the environment buildRoadNetwork/createTrafficSystem accept:
//   no avenues/streets/medians, land = the tile bbox, NO signalized junctions (Taipei's
//   signal furniture exists as markings, but no node-level signal table exists, so every
//   junction is unsignalized and right of way falls to the step-9 arm groups), and
//   pedestrians OFF (createPedestrianRoutes is fed by NYC block data; Taipei pedestrian
//   space is per-road `pedestrianLayout`, a different model — vehicles only here).
//
// Vehicles therefore drive with the upstream machinery untouched: IDM car-following, lane
// choice, turn curves, junction box discipline. Spawning is upstream's local-population
// model: a fixed pool (carCount) recycles within the traffic radius of the camera,
// retiring far vehicles and respawning near ones; a vehicle that reaches a dead end simply never gets
// there — step 7 keeps only the largest strongly connected set of edges.
//
// The switch: the settings gear (issue #218 rows, #252) — on/off, density preset,
// spawn-range preset — resolved by js/settings.js (URL > stored > default off).
// The legacy ?traffic= flag still works: ?traffic=1 (pool of 200, the upstream NYC size)
// or ?traffic=<n> (pool of n, clamped 10..400). Absent/0/off = no traffic system at all,
// the pre-#210 stub — boot behaviour is byte-identical with the flag off.

const DRIVABLE = new Set([
  'motorway', 'motorway_link', 'trunk', 'trunk_link',
  'primary', 'primary_link', 'secondary', 'secondary_link',
  'tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street',
]);

export function buildTaipeiRoadGraph(source = TAIPEI_GEO) {
  const rg = source.roadGraph;
  const nodes = rg.nodes;
  const pos = (i) => ({ x: nodes[i * 2], z: nodes[i * 2 + 1] });

  const edges = [];
  const adj = new Map(); // node index -> edge indices (filtered graph)
  // Issue #252: drop deck/ramp links, keep bridge/tunnel crossings.
  // An edge whose OSM level is not 0 is a deck, a ramp, a bridge, or a
  // tunnel. The vehicle system drives flat at y=0, so routing onto a
  // deck or ramp link makes cars drive at ground level under/through
  // the structure — the off-road driving reported at 公舘路/承德路七段
  // (洲美快速道路 decks + 大業路 ramps in the flat graph). Dropped:
  // every *_link ramp at any level, and every edge at |level| >= 2
  // (expressway decks). Kept: level ±1 non-link edges — river bridges
  // and tunnels, the only crossings. Dropping those too was measured
  // first and rejected: it cut the routable core from 7,495 nodes to
  // 3,591, emptying the whole north-west (the Keelung River bridges
  // are level-1 links). Kept crossings still drive at y=0 — confined
  // to the span, documented here — and are removed by the height-aware
  // deck work in issue #254. Dropped edges stay in the geodata (with
  // their level) for that work.
  let droppedLevelEdges = 0;
  let droppedLevelKm = 0;
  let keptLevelEdges = 0;
  let keptLevelKm = 0;
  for (const e of rg.edges) {
    if (!DRIVABLE.has(e.highway)) continue;
    const lv = e.level || 0;
    if (lv !== 0 && (e.highway.endsWith('_link') || Math.abs(lv) >= 2)) {
      droppedLevelEdges++;
      droppedLevelKm += e.length || 0;
      continue;
    }
    if (lv !== 0) {
      keptLevelEdges++;
      keptLevelKm += e.length || 0;
    }
    const ei = edges.length;
    edges.push(e);
    for (const n of [e.a, e.b]) {
      if (!adj.has(n)) adj.set(n, []);
      adj.get(n).push(ei);
    }
  }
  const other = (e, n) => (e.a === n ? e.b : e.a);
  const used = new Uint8Array(edges.length);
  const names = [];
  const nameIndex = new Map();
  const nameId = (name) => {
    if (!nameIndex.has(name)) { nameIndex.set(name, names.length); names.push(name); }
    return nameIndex.get(name);
  };
  const links = [];
  let rawKm = 0;
  for (const e of rg.edges) rawKm += e.length || 0;
  let keptKm = 0;
  let loopSplits = 0;

  function emitRun(runEdges, seqNodes) {
    // seqNodes: [start, ...inner, end] node indices in travel order
    const first = runEdges[0];
    let width = Infinity;
    let len = 0;
    for (const e of runEdges) {
      if (e.width > 0) width = Math.min(width, e.width);
      len += e.length || 0;
    }
    if (!isFinite(width)) width = 0;
    keptKm += len;
    const inner = [];
    for (let k = 1; k + 1 < seqNodes.length; k++) {
      const p = pos(seqNodes[k]);
      inner.push(p.x, p.z);
    }
    links.push([seqNodes[0], seqNodes[seqNodes.length - 1], nameId(first.name || ''), width, 0, first.oneway ? 1 : 0, inner]);
  }

  for (let s = 0; s < edges.length; s++) {
    if (used[s]) continue;
    const e0 = edges[s];
    used[s] = 1;
    const run = [e0];
    const seq = [e0.a, e0.b]; // travel order; for a one-way edge a->b is the legal direction
    const sig = { name: e0.name || '', oneway: !!e0.oneway };
    // Extend at the end, then at the start, through degree-2 nodes while the signature holds
    // and (for one-way runs) the next edge's legal direction continues the travel direction.
    let grew = true;
    while (grew) {
      grew = false;
      for (const atEnd of [true, false]) {
        const n = atEnd ? seq[seq.length - 1] : seq[0];
        const endEdge = atEnd ? run[run.length - 1] : run[0];
        if ((adj.get(n) || []).length !== 2) continue;
        const nextEi = adj.get(n).find((ei) => edges[ei] !== endEdge);
        if (nextEi === undefined || used[nextEi]) continue;
        const ne = edges[nextEi];
        if ((ne.name || '') !== sig.name || !!ne.oneway !== sig.oneway) continue;
        if (ne.oneway) {
          // travel must leave n forwards at the end (ne.a === n) or arrive into n at the start (ne.b === n)
          if (atEnd ? ne.a !== n : ne.b !== n) continue;
        }
        used[nextEi] = 1;
        grew = true;
        if (atEnd) { run.push(ne); seq.push(other(ne, n)); }
        else { run.unshift(ne); seq.unshift(other(ne, n)); }
      }
    }
    if (seq[0] === seq[seq.length - 1] && seq.length > 2) {
      // A closed ring of degree-2 nodes: split at the farthest node so both halves are
      // ordinary junction-to-junction links (the builder drops a===b links).
      const p0 = pos(seq[0]);
      let mid = 1;
      let bd = -1;
      for (let k = 1; k + 1 < seq.length; k++) {
        const p = pos(seq[k]);
        const d = Math.hypot(p.x - p0.x, p.z - p0.z);
        if (d > bd) { bd = d; mid = k; }
      }
      loopSplits++;
      emitRun(run.slice(0, mid), seq.slice(0, mid + 1));
      emitRun(run.slice(mid), seq.slice(mid));
    } else {
      emitRun(run, seq);
    }
  }

  return {
    roadGraph: { nodes, links, names },
    stats: {
      sourceEdges: rg.edges.length,
      drivableEdges: edges.length,
      links: links.length,
      rawKm: Math.round(rawKm / 100) / 10,
      keptKm: Math.round(keptKm / 100) / 10,
      loopSplits,
      droppedLevelEdges,
      droppedLevelKm: Math.round(droppedLevelKm / 100) / 10,
      keptLevelEdges,
      keptLevelKm: Math.round(keptLevelKm / 100) / 10,
    },
  };
}

let cachedGraph = null;

export function taipeiTrafficEnv(carCount, opts = {}) {
  if (!cachedGraph) cachedGraph = buildTaipeiRoadGraph();
  const bb = TAIPEI_GEO.frame.bbox;
  // Spawn range: the radius around the camera the vehicle pool recycles
  // within (issue #252 gear control). js/traffic.js defaults it to its
  // historical 380 m when absent, so only pass it when the caller chose one.
  const trafficRadius = opts.trafficRadius != null ? opts.trafficRadius : undefined;
  return {
    networkEnv: {
      roadGraph: cachedGraph.roadGraph,
      avenues: [],
      streets: [],
      medians: [],
      // The tile is one land rectangle for lane-clearance purposes: Taipei's roads are
      // building-free by construction (the planner excludes every roadbed), so no obstacle
      // list is needed to keep lanes on the carriageway.
      onLand: (minX, maxX, minZ, maxZ) => minX >= bb.minX - 50 && maxX <= bb.maxX + 50 && minZ >= bb.minZ - 50 && maxZ <= bb.maxZ + 50,
    },
    pedestrians: false,
    carCount,
    busCount: Math.max(0, Math.min(12, Math.round(carCount / 16))),
    ...(trafficRadius !== undefined ? { trafficRadius } : {}),
  };
}

// ?traffic absent / 0 / off -> 0 (no traffic). 1 / on / true -> 200 (upstream pool size).
// A number clamps to 10..400.
export function trafficCountFromSearch(search) {
  const v = new URLSearchParams(search || '').get('traffic');
  if (v === null) return 0;
  const t = v.trim().toLowerCase();
  if (t === '' || t === '1' || t === 'on' || t === 'true') return 200;
  const n = Number(t);
  if (!isFinite(n) || n <= 0) return 0;
  return Math.max(10, Math.min(400, Math.round(n)));
}
