// Issue #118: digest the MRT Red Line （淡水信義線） out of
// osm_railways.json into deck records + elevated station defs for
// buildMrtDecks (build-elevated.mjs) and the station geometry module.
//
// The line is identified as a GRAPH problem, not a tag query (see
// ~/workspace evidence audit: OSM maps the two tracks as separate
// near-coincident ways and the Beitou depot fan shares the corridor):
// node graph over railway=subway ways, connected component seeded at
// 民權西路， then per station pair a Dijkstra path A plus a second
// path B with A's edges banned (the twin track). Depot sidings and
// the rest of the network never enter a station-to-station path.
//
// FORM per way: tags win (tunnel=yes / layer<0 = tunnel;
// layer>=1 / bridge = elevated); untagged ways take the SEGMENT
// default — the hand-authored override list, keyed by the station
// pair whose corridor the way's midpoint falls in:
//   民權西路>圓山  elevated  (the emerging piece between the tunnel
//                             tags and the viaduct tags — the portal
//                             segment; the deck core ramps it)
//   北投>復興崗， 復興崗>忠義， 忠義>關渡  at-grade
//   everything else           elevated
// Tagged 北投>復興崗 geometry (flying junction + descent viaduct)
// stays elevated because tags win.
//
// Station defs: OSM station anchors (node railway=station/stop, else
// station/platform way centroid), yaw from the length-weighted track
// direction around the anchor, length from the station/platform way
// extent along that yaw (fallback by kind). Stations are NOT
// landmark-registry entries — they straddle the running corridor, so
// the plan-view no-overlap invariant cannot hold for them; they ship
// as plain geodata defs rendered by js/taipei-mrt-stations.js.

export const MRT_MAIN_STATIONS = [
  '民權西路', '圓山', '劍潭', '士林', '芝山', '明德', '石牌', '唭哩岸',
  '奇岩', '北投', '復興崗', '忠義', '關渡',
];
export const MRT_BRANCH_STATIONS = ['新北投'];
export const MRT_ELEVATED_STATIONS = [
  '圓山', '劍潭', '士林', '芝山', '明德', '石牌', '唭哩岸', '奇岩',
  '北投', '新北投',
];
export const MRT_STATION_KINDS = {
  劍潭: 'jiantan', 北投: 'beitou', 新北投: 'xinbeitou',
};
const SEGMENT_FORM_DEFAULTS = {
  '民權西路>圓山': 'elevated',
  '北投>復興崗': 'at-grade',
  '復興崗>忠義': 'at-grade',
  '忠義>關渡': 'at-grade',
};
const DEFAULT_LENGTH = { standard: 112, jiantan: 150, beitou: 150, xinbeitou: 105 };
// Body-width clamps per kind when the digest measures the station's
// track span: [min, max] metres.
export const MRT_STATION_WIDTH_LIMITS = {
  standard: [21.5, 27], jiantan: [24, 29], beitou: [33, 40], xinbeitou: [21.5, 27],
};
export const MRT_DECK_TOP = 9.0;
const TWIN_WIDTH = 5.6, SINGLE_WIDTH = 10.4;

function formOfTags(t) {
  const layer = parseInt(t.layer || '0', 10);
  if (t.tunnel === 'yes' || layer < 0) return 'tunnel';
  if (layer >= 1 || (t.bridge && t.bridge !== 'no')) return 'elevated';
  return null;
}

function dijkstra(adj, src, dst, banned) {
  const dist = new Map([[src, 0]]);
  const prev = new Map();
  const pq = [[0, src]];
  while (pq.length) {
    let bi = 0;
    for (let i = 1; i < pq.length; i++) if (pq[i][0] < pq[bi][0]) bi = i;
    const [d, n] = pq.splice(bi, 1)[0];
    if (d > (dist.get(n) ?? Infinity)) continue;
    if (n === dst) break;
    for (const e of adj.get(n) || []) {
      if (banned && banned.has(`${n}|${e.to}|${e.wid}`)) continue;
      const nd = d + e.len;
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd);
        prev.set(e.to, { from: n, wid: e.wid });
        pq.push([nd, e.to]);
      }
    }
  }
  if (!dist.has(dst)) return null;
  const edges = new Set();
  const ways = new Set();
  let cur = dst;
  while (cur !== src) {
    const p = prev.get(cur);
    if (!p) break;
    edges.add(`${p.from}|${cur}|${p.wid}`);
    ways.add(p.wid);
    cur = p.from;
  }
  return { len: dist.get(dst), edges, ways };
}

// elements: osm_railways.json elements (ways carry {lat,lon}
// geometry + node refs, station nodes carry lat/lon); project is the
// pipeline's toWorld(lat, lon) -> [x, z]. Returns
// { records, stations, stats }.
export function digestRedLine(elements, project) {
  const ways = [];
  for (const el of elements || []) {
    if (el.type === 'way') ways.push(el);
  }
  const trackWays = ways.filter((w) => w.tags && w.tags.railway === 'subway');
  for (const w of trackWays) {
    w.pts = (w.geometry || []).map((g) => project(g.lat, g.lon));
    w.len = 0;
    w.segLen = [];
    for (let i = 1; i < w.pts.length; i++) {
      const l = Math.hypot(w.pts[i][0] - w.pts[i - 1][0], w.pts[i][1] - w.pts[i - 1][1]);
      w.segLen.push(l);
      w.len += l;
    }
  }
  // Station anchors from OSM station features. Transfer stations
  // （民權西路） carry one station node PER LINE with the same name,
  // so keep ALL candidates per name; the winner is chosen after the
  // line's component is known (the candidate nearest the line's own
  // track graph).
  const anchorCands = new Map(); // zh name -> [{x, z, nameEn, rank}]
  const consider = (name, nameEn, x, z, rank) => {
    if (!name) return;
    if (!anchorCands.has(name)) anchorCands.set(name, []);
    anchorCands.get(name).push({ x, z, nameEn: nameEn || '', rank });
  };
  for (const el of elements || []) {
    if (el.type !== 'node') continue;
    const t = el.tags || {};
    if (t.railway === 'station' || t.railway === 'stop' || t.public_transport === 'station') {
      const [x, z] = project(el.lat, el.lon);
      consider(t.name, t['name:en'], x, z, t.railway === 'station' ? 0 : 1);
    }
  }
  const stationWays = ways.filter((w) => {
    const t = w.tags || {};
    return t.railway === 'station' || t.railway === 'platform' ||
      t.public_transport === 'station' || t.public_transport === 'platform';
  });
  for (const w of stationWays) {
    w.pts = (w.geometry || []).map((g) => project(g.lat, g.lon));
    if (!w.pts.length) continue;
    let cx = 0, cz = 0;
    for (const p of w.pts) { cx += p[0]; cz += p[1]; }
    consider(w.tags.name, w.tags['name:en'], cx / w.pts.length, cz / w.pts.length, 2);
  }
  const wanted = [...MRT_MAIN_STATIONS, ...MRT_BRANCH_STATIONS];
  const missing = wanted.filter((n) => !anchorCands.has(n));
  if (missing.length) throw new Error(`digestRedLine: station anchors missing: ${missing.join(', ')}`);

  // node graph + component from the Minquan seed
  const nodePos = new Map();
  const adj = new Map();
  const addAdj = (a, b, len, wid) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push({ to: b, len, wid });
  };
  for (const w of trackWays) {
    for (let i = 0; i < w.pts.length; i++) {
      const n = (w.nodes || [])[i];
      if (n === undefined) continue;
      if (!nodePos.has(n)) nodePos.set(n, w.pts[i]);
      if (i > 0 && (w.nodes || [])[i - 1] !== undefined) {
        addAdj(w.nodes[i - 1], n, w.segLen[i - 1], w.id);
        addAdj(n, w.nodes[i - 1], w.segLen[i - 1], w.id);
      }
    }
  }
  // Component choice: 民權西路 is a transfer station — its name also
  // labels the crossing 中和新蘆線's station node, and a naive seed
  // can land in the wrong line's graph. Try the nearest graph nodes
  // as seeds and keep the component that threads the most station
  // anchors (the Red Line passes all 14; a crossing line passes 1-2).
  const componentOf = (seedNode) => {
    const seen = new Set([seedNode]);
    const st = [seedNode];
    while (st.length) {
      const n = st.pop();
      for (const e of adj.get(n) || []) {
        if (!seen.has(e.to)) { seen.add(e.to); st.push(e.to); }
      }
    }
    return seen;
  };
  const seedPts = anchorCands.get('民權西路');
  const seedCands = [...nodePos.entries()]
    .map(([n, p]) => ({ n, d: Math.min(...seedPts.map((a) => Math.hypot(p[0] - a.x, p[1] - a.z))) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 8);
  let comp = null, compScore = -1;
  for (const { n } of seedCands) {
    const c = componentOf(n);
    let score = 0;
    for (const name of wanted) {
      let hit = false;
      for (const a of anchorCands.get(name)) {
        for (const cn of c) {
          const p = nodePos.get(cn);
          if (Math.hypot(p[0] - a.x, p[1] - a.z) < 150) { hit = true; break; }
        }
        if (hit) break;
      }
      if (hit) score++;
    }
    if (score > compScore || (score === compScore && c.size > (comp ? comp.size : 0))) {
      comp = c;
      compScore = score;
    }
  }
  const nearestNode = (pt) => {
    let best = null, bd = Infinity;
    for (const n of comp) {
      const p = nodePos.get(n);
      const d = Math.hypot(p[0] - pt.x, p[1] - pt.z);
      if (d < bd) { bd = d; best = n; }
    }
    return { node: best, dist: bd };
  };
  // Resolve one anchor per station: the candidate (best feature rank
  // first) whose nearest component node is closest — this picks the
  // Red Line's own 民權西路 node over the crossing line's.
  const anchor = new Map();
  for (const name of wanted) {
    let best = null, bKey = null;
    for (const c of anchorCands.get(name)) {
      const { dist } = nearestNode(c);
      const key = [Math.round(dist), c.rank];
      if (!bKey || key[0] < bKey[0] || (key[0] === bKey[0] && key[1] < bKey[1])) {
        bKey = key;
        best = c;
      }
    }
    anchor.set(name, best);
  }

  // station-pair paths
  const pairs = [];
  for (let i = 0; i + 1 < MRT_MAIN_STATIONS.length; i++) {
    pairs.push([MRT_MAIN_STATIONS[i], MRT_MAIN_STATIONS[i + 1]]);
  }
  pairs.push(['北投', '新北投']);
  const wayById = new Map(trackWays.map((w) => [w.id, w]));
  const lineWays = new Map(); // wid -> Set of pair keys
  let pathsFound = 0;
  const pathPts = [];
  for (const [fa, fb] of pairs) {
    const a = nearestNode(anchor.get(fa)).node;
    const b = nearestNode(anchor.get(fb)).node;
    const pA = dijkstra(adj, a, b, null);
    if (!pA) continue;
    pathsFound++;
    const set = [pA];
    const pB = dijkstra(adj, a, b, pA.edges);
    // Twin-track sanity: B must hug A's polyline (twin tracks run
    // ~6 m apart); a B that dives off through connecting tunnels is
    // a graph artefact, not the second track.
    if (pB && pB.len < 1.6 * pA.len) {
      const aSegs = [];
      for (const wid of pA.ways) aSegs.push(...wayById.get(wid).pts);
      let hugging = true;
      for (const wid of pB.ways) {
        for (const p of wayById.get(wid).pts) {
          let bd = Infinity;
          for (const q of aSegs) {
            const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
            if (d < bd) bd = d;
          }
          if (bd > 60) { hugging = false; break; }
        }
        if (!hugging) break;
      }
      if (hugging) set.push(pB);
    }
    for (const p of set) {
      for (const wid of p.ways) {
        if (!lineWays.has(wid)) lineWays.set(wid, new Set());
        lineWays.get(wid).add(`${fa}>${fb}`);
      }
    }
    for (const wid of pA.ways) pathPts.push(...wayById.get(wid).pts);
  }
  // crossover catch: elevated-tagged component ways within 40 m of
  // the path polyline that no path used (junction throats, scissors)
  let crossoverWays = 0;
  for (const w of trackWays) {
    if (lineWays.has(w.id) || !w.nodes.some((n) => comp.has(n))) continue;
    if (formOfTags(w.tags) !== 'elevated') continue;
    // Beitou depot leads (service=yard/siding/spur) are not the
    // running line: one elevated yard connector north of Beitou
    // would otherwise enter here and dangle where its untagged
    // continuation peels into the depot fan.
    if (['yard', 'siding', 'spur'].includes(w.tags.service || '')) continue;
    let near = false;
    for (const p of w.pts) {
      for (const q of pathPts) {
        if (Math.abs(p[0] - q[0]) < 40 && Math.abs(p[1] - q[1]) < 40 &&
            Math.hypot(p[0] - q[0], p[1] - q[1]) < 40) { near = true; break; }
      }
      if (near) break;
    }
    if (near) {
      lineWays.set(w.id, new Set(['crossover']));
      crossoverWays++;
    }
  }
  // forms helper (used by the bridge catch as well)
  const segmentOfPoint = (x, z) => {
    let best = null, bd = Infinity;
    for (const [fa, fb] of pairs) {
      const A2 = anchor.get(fa), B2 = anchor.get(fb);
      const dx = B2.x - A2.x, dz = B2.z - A2.z;
      const L2 = dx * dx + dz * dz || 1e-9;
      let t = ((x - A2.x) * dx + (z - A2.z) * dz) / L2;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(A2.x + t * dx - x, A2.z + t * dz - z);
      if (d < bd) { bd = d; best = `${fa}>${fb}`; }
    }
    return best;
  };
  // bridge catch: the second track's portal throat south of
  // Yuanshan is mapped UNTAGGED and sits on no station path (the
  // pair runs single there), yet without it that track's deck ends
  // mid-air at full height; the same stitching is needed where the
  // junction tracks north of Beitou step down to the at-grade ways.
  // A bridge way must lie ENTIRELY on the station-path alignment
  // (every vertex within 45 m of a path segment — measured against
  // the fixed path set, so the Beitou depot fan, which only hugs
  // itself, can never chain in) and be short (a throat, <= 400 m).
  // Its form comes from the segment-default table: elevated at the
  // portal (it earns its own ramp off the tunnel portal node),
  // at-grade in the descent segments (it becomes the portal the
  // elevated track ramps down to).
  let bridgeWays = 0;
  let tunnelMates = 0;
  {
    const pathSegs = [];
    for (const wid of lineWays.keys()) {
      const w = wayById.get(wid);
      for (let i = 1; i < w.pts.length; i++) pathSegs.push([w.pts[i - 1], w.pts[i]]);
    }
    const distToPath = (p) => {
      let bd = Infinity;
      for (const [a, b] of pathSegs) {
        const dx = b[0] - a[0], dz = b[1] - a[1];
        const L2 = dx * dx + dz * dz || 1e-9;
        let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2;
        t = Math.max(0, Math.min(1, t));
        bd = Math.min(bd, Math.hypot(a[0] + t * dx - p[0], a[1] + t * dz - p[1]));
      }
      return bd;
    };
    for (const w of trackWays) {
      if (lineWays.has(w.id) || !w.nodes.some((n) => comp.has(n))) continue;
      if (formOfTags(w.tags) !== null) continue;
      if (w.len > 400) continue;
      if (!w.pts.every((p) => distToPath(p) <= 45)) continue;
      lineWays.set(w.id, new Set(['bridge']));
      bridgeWays++;
    }
    // tunnel catch: the OTHER track's tunnel chain, same test —
    // graph-only records (never emitted) that give the bridged
    // track its own portal node to ramp from. A crossing line's
    // tunnel way fails the every-vertex test except at the crossing
    // point itself, so it cannot sneak in whole.
    for (const w of trackWays) {
      if (lineWays.has(w.id) || !w.nodes.some((n) => comp.has(n))) continue;
      if (formOfTags(w.tags) !== 'tunnel') continue;
      if (!w.pts.every((p) => distToPath(p) <= 45)) continue;
      lineWays.set(w.id, new Set(['tunnel-mate']));
      tunnelMates++;
    }
  }
  const formOf = new Map();
  for (const [wid, pairSet] of lineWays) {
    const w = wayById.get(wid);
    let f = formOfTags(w.tags);
    if (!f) {
      const mid = w.pts[Math.floor(w.pts.length / 2)];
      const seg = segmentOfPoint(mid[0], mid[1]);
      f = SEGMENT_FORM_DEFAULTS[seg] || 'elevated';
    }
    formOf.set(wid, f);
  }

  // widths: twin where a sibling line way runs 2.5..10 m alongside
  const lineList = [...lineWays.keys()].map((id) => wayById.get(id));
  const nearestSibling = (w) => {
    const samples = [];
    for (let i = 0; i < w.pts.length; i += Math.max(1, Math.floor(w.pts.length / 6))) {
      samples.push(w.pts[i]);
    }
    const ds = [];
    for (const s of samples) {
      let best = Infinity;
      for (const o of lineList) {
        if (o === w) continue;
        for (let i = 1; i < o.pts.length; i++) {
          const ax = o.pts[i - 1][0], az = o.pts[i - 1][1];
          const bx = o.pts[i][0], bz = o.pts[i][1];
          const dx = bx - ax, dz = bz - az;
          const L2 = dx * dx + dz * dz || 1e-9;
          let t = ((s[0] - ax) * dx + (s[1] - az) * dz) / L2;
          t = Math.max(0, Math.min(1, t));
          const d = Math.hypot(ax + t * dx - s[0], az + t * dz - s[1]);
          if (d < best) best = d;
        }
      }
      ds.push(best);
    }
    ds.sort((a, b) => a - b);
    return ds[Math.floor(ds.length / 2)];
  };

  const records = [];
  const byForm = { elevated: 0, 'at-grade': 0, tunnel: 0 };
  for (const w of lineList) {
    const f = formOf.get(w.id);
    byForm[f] += w.len;
    const pairSet = lineWays.get(w.id);
    const branch = [...pairSet].some((p) => p === '北投>新北投');
    const sib = nearestSibling(w);
    records.push({
      id: w.id,
      nodeIds: w.nodes || [],
      pts: w.pts,
      form: f,
      inSet: f === 'elevated',
      emit: f !== 'tunnel',
      targetTop: f === 'elevated' ? MRT_DECK_TOP : 0,
      lineName: branch ? '新北投支線' : '淡水信義線',
      lineHighway: 'subway',
      lineLayer: parseInt(w.tags.layer || '1', 10) || 1,
      lineWidth: sib >= 2.5 && sib <= 10 ? TWIN_WIDTH : SINGLE_WIDTH,
    });
  }

  // station defs (elevated stations only)
  const stations = [];
  for (const name of MRT_ELEVATED_STATIONS) {
    const a = anchor.get(name);
    // yaw: length-weighted track direction near the anchor (double
    // angle so opposing directions don't cancel)
    let sx = 0, sz = 0;
    for (const w of lineList) {
      for (let i = 1; i < w.pts.length; i++) {
        const mx = (w.pts[i][0] + w.pts[i - 1][0]) / 2;
        const mz = (w.pts[i][1] + w.pts[i - 1][1]) / 2;
        if (Math.hypot(mx - a.x, mz - a.z) > 120) continue;
        const dx = w.pts[i][0] - w.pts[i - 1][0];
        const dz = w.pts[i][1] - w.pts[i - 1][1];
        const th = Math.atan2(dx, dz); // deck yaw convention
        const l = Math.hypot(dx, dz);
        sx += Math.cos(2 * th) * l;
        sz += Math.sin(2 * th) * l;
      }
    }
    const yaw = 0.5 * Math.atan2(sz, sx);
    const dirx = Math.sin(yaw), dirz = Math.cos(yaw);
    // length: extent of nearby station/platform ways along the yaw
    let lo = Infinity, hi = -Infinity;
    for (const w of stationWays) {
      const g = w.pts || [];
      let near = false;
      for (const p of g) if (Math.hypot(p[0] - a.x, p[1] - a.z) < 170) { near = true; break; }
      if (!near) continue;
      for (const p of g) {
        const t = (p[0] - a.x) * dirx + (p[1] - a.z) * dirz;
        if (t < lo) lo = t;
        if (t > hi) hi = t;
      }
    }
    const kind = MRT_STATION_KINDS[name] || 'standard';
    let length = hi > lo ? hi - lo : 0;
    if (!(length >= 60 && length <= 200)) length = DEFAULT_LENGTH[kind];
    length = Math.round(Math.max(80, Math.min(190, length)));
    // Xinbeitou's OSM station outline traces the whole fenced
    // facility (~141 m); the train shed itself is ~110 m, and the
    // terminus box is capped to the shed so it doesn't dwarf the
    // branch. Beitou (145 m) and Jiantan (154 m) measured extents
    // match their real sheds and stand.
    if (kind === 'xinbeitou') length = Math.min(length, 118);
    // Snap the anchor onto the track centreline: OSM station nodes
    // often sit at an entrance, up to ~25 m off the alignment, and a
    // straddling station box must be centred on the guideway.
    let snapX = a.x, snapZ = a.z, sbd = Infinity;
    for (const w of lineList) {
      for (let i = 1; i < w.pts.length; i++) {
        const ax = w.pts[i - 1][0], az = w.pts[i - 1][1];
        const bx = w.pts[i][0], bz = w.pts[i][1];
        const dx = bx - ax, dz = bz - az;
        const L2 = dx * dx + dz * dz || 1e-9;
        let t = ((a.x - ax) * dx + (a.z - az) * dz) / L2;
        t = Math.max(0, Math.min(1, t));
        const px = ax + t * dx, pz = az + t * dz;
        const d = Math.hypot(px - a.x, pz - a.z);
        if (d < sbd) { sbd = d; snapX = px; snapZ = pz; }
      }
    }
    if (sbd > 60) { snapX = a.x; snapZ = a.z; }
    // Centre BETWEEN the tracks and size the box to them: at the
    // island-platform stations the tracks diverge around the
    // platform (measured centrelines 14-20 m apart here, ~6 m
    // between stations), so the box centres on the across-median of
    // the nearby track samples and widens to cover the span plus a
    // girder margin.
    const dirC = [Math.cos(yaw), -Math.sin(yaw)];
    const dirA = [Math.sin(yaw), Math.cos(yaw)];
    const across = [];
    for (const w of lineList) {
      for (let i = 1; i < w.pts.length; i++) {
        const ax = w.pts[i - 1][0], az = w.pts[i - 1][1];
        const bx = w.pts[i][0], bz = w.pts[i][1];
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 5));
        for (let s = 0; s < steps; s++) {
          const px = ax + (bx - ax) * (s / steps), pz = az + (bz - az) * (s / steps);
          const dx = px - snapX, dz = pz - snapZ;
          const al = dx * dirA[0] + dz * dirA[1];
          const ac = dx * dirC[0] + dz * dirC[1];
          if (Math.abs(al) <= 35 && Math.abs(ac) <= 45) across.push(ac);
        }
      }
    }
    let width = null;
    if (across.length >= 8) {
      const lo = Math.min(...across), hi = Math.max(...across);
      const centre = (lo + hi) / 2;
      snapX += dirC[0] * centre;
      snapZ += dirC[1] * centre;
      const need = (hi - lo) + 6.8; // span + one girder width of margin
      const lim = MRT_STATION_WIDTH_LIMITS[kind];
      width = Math.round(Math.max(lim[0], Math.min(lim[1], need)) * 10) / 10;
    }
    const slug = (a.nameEn || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    stations.push({
      id: `mrt-${slug || 'station'}`, name, nameEn: a.nameEn || '',
      x: Math.round(snapX * 10) / 10, z: Math.round(snapZ * 10) / 10,
      yaw, kind, length, ...(width ? { width } : {}),
    });
  }

  const stats = {
    componentWays: trackWays.filter((w) => w.nodes.some((n) => comp.has(n))).length,
    lineWays: lineList.length,
    pathsFound,
    crossoverWays,
    bridgeWays,
    tunnelMates,
    byFormKm: Object.fromEntries(Object.entries(byForm).map(([k, v]) => [k, +(v / 1000).toFixed(2)])),
    stationsFound: stations.length,
  };
  return { records, stations, stats };
}
