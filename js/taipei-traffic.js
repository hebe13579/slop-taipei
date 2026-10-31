import { TAIPEI_GEO } from './taipei-geodata.js';
import { ASPHALT_LIFT } from './taipei-viaduct.js'; // three-free geometry constants; the sampler below reuses the digest the renderer draws

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

// ------------------------------------------------------------------
// Issue #254: deck heights. The rendered digest (geodata.elevatedRoads)
// already carries the exact heights the renderer draws — per-point h
// from the build-time Dijkstra over shared OSM node keys, so a ramp's
// top vertex and the deck vertex it joins carry the SAME height.
// Cars sample the digest, not a new height table, and the match is
// per EDGE, not per sample: parallel carriageways of one bridge
// share a layer and overlap in plan, so per-sample nearest-centreline
// flips between their profiles mid-span (their climbs phase
// differently). Matching the whole edge to one digest line — the
// line whose polyline the edge's chord best follows — keeps each
// car on its own carriageway. No geodata change: this runs at
// traffic-env build time, memoized per digest.
// ------------------------------------------------------------------
const DECK_SAMPLE_STEP = 8; // m, max spacing of height samples along a deck edge
const HEIGHT_STEP_TOL = 1.0; // m, a larger step at a chained joint splits the run instead of climbing a cliff
const deckSamplerCache = new WeakMap();

function deckSampler(elevated) {
  if (!elevated || !(elevated.lines || []).length) return null;
  const hit = deckSamplerCache.get(elevated);
  if (hit) return hit;
  const CELL = 64;
  const cells = new Map();
  const key = (ix, iz) => (ix + 4096) * 8192 + (iz + 4096);
  const segsByLine = new Map(); // digest line -> its segments
  const segOwner = new Map(); // segment -> its digest line
  for (const line of elevated.lines) {
    const n = (line.pts?.length || 0) / 2;
    const half = (line.width || 6) / 2;
    const segs = [];
    segsByLine.set(line, segs);
    for (let i = 0; i + 1 < n; i++) {
      const ax = line.pts[2 * i], az = line.pts[2 * i + 1];
      const bx = line.pts[2 * i + 2], bz = line.pts[2 * i + 3];
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz);
      if (!(len > 0)) continue;
      const seg = {
        ax, az, ux: dx / len, uz: dz / len, len, half,
        hA: line.h?.[i] ?? 0, hB: line.h?.[i + 1] ?? 0, layer: line.layer ?? 1,
      };
      segs.push(seg);
      segOwner.set(seg, line);
      const minX = Math.min(ax, bx) - half, maxX = Math.max(ax, bx) + half;
      const minZ = Math.min(az, bz) - half, maxZ = Math.max(az, bz) + half;
      for (let ix = Math.floor(minX / CELL); ix <= Math.floor(maxX / CELL); ix++) {
        for (let iz = Math.floor(minZ / CELL); iz <= Math.floor(maxZ / CELL); iz++) {
          const k = key(ix, iz);
          let list = cells.get(k);
          if (!list) cells.set(k, (list = []));
          list.push(seg);
        }
      }
    }
  }
  const segDist = (seg, x, z) => {
    const px = x - seg.ax, pz = z - seg.az;
    const t = Math.max(0, Math.min(1, (px * seg.ux + pz * seg.uz) / seg.len));
    return { d: Math.hypot(px - seg.ux * seg.len * t, pz - seg.uz * seg.len * t), t };
  };
  // The digest line the edge (ax, az) -> (bx, bz) follows: among
  // the lines of the edge's layer reaching the edge's samples, the
  // one with the smallest mean distance from the chord (missing
  // coverage counts 25 m). The true line scores ~1 m (the chord is
  // the RDP-simplified way); a parallel carriageway scores its
  // separation (~10 m). Null when nothing fits: the edge is
  // unplaced and the caller drops it rather than driving it flat.
  const match = (ax, az, bx, bz, level) => {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(len / DECK_SAMPLE_STEP));
    const scores = new Map(); // line -> { total, count }
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      const list = cells.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
      if (!list) continue;
      const seen = new Map(); // line -> best distance at this point
      for (const seg of list) {
        if (seg.layer !== level) continue;
        const owner = segOwner.get(seg);
        const { d } = segDist(seg, x, z);
        if (d > seg.half + 1.5) continue;
        if (!seen.has(owner) || d < seen.get(owner)) seen.set(owner, d);
      }
      for (const [owner, d] of seen) {
        let s = scores.get(owner);
        if (!s) scores.set(owner, (s = { total: 0, count: 0 }));
        s.total += d;
        s.count++;
      }
    }
    let best = null, bestScore = Infinity;
    for (const [line, s] of scores) {
      // Points with no covering segment count 25 m against the line.
      const score = (s.total + (n + 1 - s.count) * 25) / (n + 1);
      if (score < bestScore) { bestScore = score; best = line; }
    }
    return bestScore <= 4 ? best : null;
  };
  // Height of `line` at (x, z): the projection onto its nearest
  // segment, interpolated h, plus ASPHALT_LIFT (the asphalt surface
  // the renderer draws).
  const heightOn = (line, x, z) => {
    let bestD = Infinity, bestH = 0;
    for (const seg of segsByLine.get(line) || []) {
      const { d, t } = segDist(seg, x, z);
      if (d >= bestD) continue;
      bestD = d;
      bestH = seg.hA + (seg.hB - seg.hA) * t;
    }
    return bestH + ASPHALT_LIFT;
  };
  const out = { match, heightOn };
  deckSamplerCache.set(elevated, out);
  return out;
}

// Height samples along one roadGraph edge, a -> b order, at most
// DECK_SAMPLE_STEP apart plus both endpoints, read off the ONE
// digest line the edge matches (see deckSampler.match). Returns
// null when the edge is flat (level <= 0, or its line is at
// ground height everywhere): flat edges need no profile and their
// links stay 7-tuples, exactly as before. Returns INVALID_PROFILE
// when the samples are not one continuous climb/cruise/fall — an
// interior near-zero sample, or a jump over 3 m between adjacent
// 8 m samples (the steepest real ramp is 9.5%, under 0.8 m per
// sample), means the match is broken and the profile would
// teleport a car. The caller drops such edges rather than driving
// a broken profile.
const INVALID_PROFILE = { invalid: true };

function deckEdgeProfile(sampler, edge, ax, az, bx, bz) {
  const level = edge.level || 0;
  if (!sampler || level < 1) return null;
  const line = sampler.match(ax, az, bx, bz, level);
  if (!line) return null;
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(len / DECK_SAMPLE_STEP));
  const values = [];
  let maxH = 0;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const h = sampler.heightOn(line, ax + (bx - ax) * t, az + (bz - az) * t);
    values.push(h);
    if (h > maxH) maxH = h;
  }
  if (!(maxH > 0)) return null;
  for (let i = 1; i < values.length; i++) {
    if (Math.abs(values[i] - values[i - 1]) > 3) return INVALID_PROFILE;
  }
  for (let i = 1; i + 1 < values.length; i++) {
    if (values[i] < 0.5 && values[i - 1] > 0.5 && values[i + 1] > 0.5) return INVALID_PROFILE;
  }
  return { step: len / n, len, values };
}

export function buildTaipeiRoadGraph(source = TAIPEI_GEO, opts = {}) {
  const rg = source.roadGraph;
  const nodes = rg.nodes;
  const pos = (i) => ({ x: nodes[i * 2], z: nodes[i * 2 + 1] });

  // ---------------------------------------------------------------
  // Issue #254: the deck graph. With includeDecks the deck and ramp
  // edges return, each carrying a sampled height profile (see
  // deckSampler above), and the level-join rule in road-network.js
  // keeps ground and deck joined only at ramps. The DEFAULT graph
  // (no opts) is byte-identical to the #252 ground pins: deck and
  // ramp segments leave the drivable set there.
  // ---------------------------------------------------------------
  const includeDecks = opts.includeDecks === true;
  const sampler = includeDecks ? deckSampler(source.elevatedRoads) : null;
  // Per-edge height profiles (deck mode only), a -> b order, keyed
  // by the edge object. Flat/absent profiles stay out of the map;
  // broken profiles (INVALID_PROFILE) go in the invalid set.
  const profiles = new Map();
  const invalidProfiles = new Set();
  if (sampler) {
    for (const e of rg.edges) {
      if (!DRIVABLE.has(e.highway) || (e.level || 0) < 1) continue;
      const p = deckEdgeProfile(sampler, e, nodes[e.a * 2], nodes[e.a * 2 + 1], nodes[e.b * 2], nodes[e.b * 2 + 1]);
      if (p === INVALID_PROFILE) invalidProfiles.add(e);
      else if (p) profiles.set(e, p);
    }
  }
  // Profile of one edge in travel order from `fromNode` (its a end
  // or its b end). Flat edges report a single 0: start and end are
  // both ground, and no interior sample exists to carry.
  const travelProfile = (e, fromNode) => {
    const p = profiles.get(e);
    if (!p) return [0];
    return fromNode === e.a ? p.values : [...p.values].reverse();
  };

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
  // Issue #254: in deck mode the rule above is replaced — ramps and
  // decks return, and the only drop is a level >= 2 edge the digest
  // cannot place at all (it would drive flat under its own deck).
  // Level-1 edges with no sampled height stay: their digest height
  // is legitimately 0 (at-grade bridges like 朝籟橋）.
  let droppedLevelEdges = 0;
  let droppedLevelKm = 0;
  let keptLevelEdges = 0;
  let keptLevelKm = 0;
  let deckInvalidEdges = 0;
  for (const e of rg.edges) {
    if (!DRIVABLE.has(e.highway)) continue;
    const lv = e.level || 0;
    if (includeDecks) {
      if (invalidProfiles.has(e)) {
        deckInvalidEdges++;
        droppedLevelEdges++;
        droppedLevelKm += e.length || 0;
        continue;
      }
      if (lv >= 2 && !profiles.has(e)) {
        droppedLevelEdges++;
        droppedLevelKm += e.length || 0;
        continue;
      }
    } else if (lv !== 0 && (e.highway.endsWith('_link') || Math.abs(lv) >= 2)) {
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
  let heightSplits = 0;
  let deckLinks = 0;
  let deckKm = 0;

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
    // Issue #254: height profile. Walk the edges in travel order and
    // concatenate their profiles; the joint sample of each following
    // edge is dropped (the incoming edge's end value is the height
    // at the shared node). s is plan distance along the run polyline.
    // The profile rides as an 8th tuple element, only when some
    // height is non-zero — ground links stay 7-tuples, as before.
    let heights = null;
    if (profiles.size) {
      const hs = [], ss = [];
      let dist = 0;
      for (let k = 0; k < runEdges.length; k++) {
        const e = runEdges[k];
        const entry = seqNodes[k];
        const trav = travelProfile(e, entry);
        const p = profiles.get(e);
        const step = p ? p.step : 0;
        for (let i = 0; i < trav.length; i++) {
          if (k > 0 && i === 0) continue;
          hs.push(trav[i]);
          ss.push(dist + i * step);
        }
        const exit = seqNodes[k + 1];
        dist += p ? p.len : Math.hypot(pos(exit).x - pos(entry).x, pos(exit).z - pos(entry).z);
      }
      let maxH = 0;
      for (const h of hs) if (h > maxH) maxH = h;
      // Attach only when some sample is genuinely above ground: a
      // flat bridge samples 0.03 (ASPHALT_LIFT) everywhere, and its
      // link stays a flat 7-tuple like every other ground link.
      if (maxH > 0.5) {
        heights = { s: ss, h: hs };
        deckLinks++;
        deckKm += len;
      }
    }
    const tuple = [seqNodes[0], seqNodes[seqNodes.length - 1], nameId(first.name || ''), width, 0, first.oneway ? 1 : 0, inner];
    if (heights) tuple.push(heights);
    links.push(tuple);
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
    // Issue #254: split a chained run at height steps. The chaining
    // above is purely 2D: a run that climbs from a street onto a
    // deck through a shared node must not become one link with a
    // cliff inside it. The step becomes a link boundary (each piece
    // keeps its own side's height at the shared node), and the move
    // filter in road-network.js then refuses the turn — ground and
    // deck join only where a ramp's profile meets both levels.
    const pieces = [[run, seq]];
    if (profiles.size && run.length > 1) {
      pieces.length = 0;
      let start = 0;
      for (let k = 0; k + 1 < run.length; k++) {
        const endA = travelProfile(run[k], seq[k]);
        const startB = travelProfile(run[k + 1], seq[k + 1]);
        if (Math.abs(endA[endA.length - 1] - startB[0]) > HEIGHT_STEP_TOL) {
          pieces.push([run.slice(start, k + 1), seq.slice(start, k + 2)]);
          heightSplits++;
          start = k + 1;
        }
      }
      pieces.push([run.slice(start), seq.slice(start)]);
    }
    for (const [pRun, pSeq] of pieces) {
      if (pSeq[0] === pSeq[pSeq.length - 1] && pSeq.length > 2) {
        // A closed ring of degree-2 nodes: split at the farthest node so both halves are
        // ordinary junction-to-junction links (the builder drops a===b links).
        const p0 = pos(pSeq[0]);
        let mid = 1;
        let bd = -1;
        for (let k = 1; k + 1 < pSeq.length; k++) {
          const p = pos(pSeq[k]);
          const d = Math.hypot(p.x - p0.x, p.z - p0.z);
          if (d > bd) { bd = d; mid = k; }
        }
        loopSplits++;
        emitRun(pRun.slice(0, mid), pSeq.slice(0, mid + 1));
        emitRun(pRun.slice(mid), pSeq.slice(mid));
      } else {
        emitRun(pRun, pSeq);
      }
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
      deckMode: includeDecks,
      deckLinks,
      deckKm: Math.round(deckKm / 100) / 10,
      heightSplits,
      deckInvalidEdges,
    },
  };
}

const cachedGraphs = new Map();

export function taipeiTrafficEnv(carCount, opts = {}) {
  // Issue #254: the live env always uses the deck graph — cars drive
  // the decks through the same gear switch as ground traffic. The
  // ground-only graph stays available from buildTaipeiRoadGraph()
  // with no options (the #252 pins test it).
  if (!cachedGraphs.has('deck')) cachedGraphs.set('deck', buildTaipeiRoadGraph(TAIPEI_GEO, { includeDecks: true }));
  const cachedGraph = cachedGraphs.get('deck');
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
