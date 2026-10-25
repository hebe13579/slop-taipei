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
// Issue #139: the at-grade stations north of Beitou join the defs
// with kind 'at-grade' (platforms + small hall, no guideway box).
export const MRT_ATGRADE_STATIONS = ['復興崗', '忠義', '關渡'];
export const MRT_STATION_KINDS = {
  劍潭: 'jiantan', 北投: 'beitou', 新北投: 'xinbeitou',
  復興崗: 'at-grade', 忠義: 'at-grade', 關渡: 'at-grade',
};
const SEGMENT_FORM_DEFAULTS = {
  '民權西路>圓山': 'elevated',
  '北投>復興崗': 'at-grade',
  '復興崗>忠義': 'at-grade',
  '忠義>關渡': 'at-grade',
};
const DEFAULT_LENGTH = { standard: 112, jiantan: 150, beitou: 150, xinbeitou: 105, 'at-grade': 112 };
// Body-width clamps per kind when the digest measures the station's
// track span: [min, max] metres.
export const MRT_STATION_WIDTH_LIMITS = {
  standard: [21.5, 27], jiantan: [24, 29], beitou: [33, 40], xinbeitou: [21.5, 27],
  'at-grade': [14, 20],
};
// Margin added to the measured track span to size a station body:
// elevated boxes cover the span plus one girder width; at-grade
// stations also carry a side platform on each side.
const STATION_WIDTH_MARGIN = { 'at-grade': 9.5 };
const DEFAULT_WIDTH_MARGIN = 6.8;
export const MRT_DECK_TOP = 9.0;
const TWIN_WIDTH = 5.6, SINGLE_WIDTH = 10.4;

// Issue #139: the Beitou depot （北投機廠） halls, hand-authored from
// the OSM building outlines (the railways extract carries no
// buildings, so — like the segment-form table — the measured facts
// live here as a table). Corners are [lat, lon] quads ordered
// SW, NW, NE, SE from OSM ways 87530097 (the main shed,
// building=depot / building:levels=1), 87530145 and 87530147 (the
// secondary halls). Heights are estimates for single-storey
// maintenance halls of these spans; the footprints are measured.
const DEPOT_HALLS = [
  { way: 87530097, h: 13, corners: [[25.133948, 121.480618], [25.135520, 121.479848], [25.136745, 121.482771], [25.135113, 121.483565]] },
  { way: 87530145, h: 11, corners: [[25.133441, 121.481663], [25.134223, 121.481273], [25.134834, 121.482897], [25.134099, 121.483256]] },
  { way: 87530147, h: 9, corners: [[25.135522, 121.484896], [25.135921, 121.484701], [25.136475, 121.486247], [25.136155, 121.486408]] },
];

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
    const twin = sib >= 2.5 && sib <= 10;
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
      lineWidth: twin ? TWIN_WIDTH : SINGLE_WIDTH,
      // Issue #139: where this way's tracks sit across its width —
      // a twin way carries one track on its centreline; a single
      // (shared-formation) way carries both, at the ~6 m track
      // spacing the twin ways measure. The viaduct renderer draws
      // the brown track strips at these offsets.
      lineTracks: twin ? [0] : [-3, 3],
    });
  }

  // station defs (the ten elevated stations + the three at-grade
  // stations north of Beitou, issue #139)
  const stations = [];
  for (const name of [...MRT_ELEVATED_STATIONS, ...MRT_ATGRADE_STATIONS]) {
    const a = anchor.get(name);
    const kind = MRT_STATION_KINDS[name] || 'standard';
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
    let yaw = 0.5 * Math.atan2(sz, sx);
    let dirx = Math.sin(yaw), dirz = Math.cos(yaw);
    // Issue #139: at-grade stations take their frame from the
    // platform ways, not the line cloud. At Fuxinggang the line
    // cloud includes the Beitou depot's throat leads (mapped as
    // running-line ways), which drag the yaw and the across-centre
    // off the served pair; the platforms flank that pair by
    // definition. (Zhongyi / Guandu measure the same either way —
    // no leads there.)
    const platWays = kind === 'at-grade'
      ? stationWays.filter((w) => (w.tags || {}).railway === 'platform' &&
          (w.pts || []).some((p) => Math.hypot(p[0] - a.x, p[1] - a.z) < 170))
      : [];
    if (platWays.length) {
      let psx = 0, psz = 0;
      for (const w of platWays) {
        for (let i = 1; i < w.pts.length; i++) {
          const dx = w.pts[i][0] - w.pts[i - 1][0];
          const dz = w.pts[i][1] - w.pts[i - 1][1];
          const th = Math.atan2(dx, dz);
          const l = Math.hypot(dx, dz);
          psx += Math.cos(2 * th) * l;
          psz += Math.sin(2 * th) * l;
        }
      }
      if (psx || psz) {
        yaw = 0.5 * Math.atan2(psz, psx);
        dirx = Math.sin(yaw);
        dirz = Math.cos(yaw);
      }
    }
    // length: extent of nearby station/platform ways along the yaw.
    // At-grade stations measure from their PLATFORM ways only —
    // Fuxinggang's station-building way traces 146 m of entrances
    // and would inflate the platform structure past its platforms.
    let lo = Infinity, hi = -Infinity;
    for (const w of stationWays) {
      if (kind === 'at-grade' && (w.tags || {}).railway !== 'platform') continue;
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
      const need = (hi - lo) + (STATION_WIDTH_MARGIN[kind] ?? DEFAULT_WIDTH_MARGIN); // span + margin (see the table)
      const lim = MRT_STATION_WIDTH_LIMITS[kind];
      width = Math.round(Math.max(lim[0], Math.min(lim[1], need)) * 10) / 10;
    }
    if (platWays.length) {
      // Issue #139 (see the frame note above): re-centre on the
      // platform cloud's middle, and size the width to the served
      // pair only — track samples within 12 m across of the
      // platform centre (the throat leads run 20+ m out).
      const dirC2 = [Math.cos(yaw), -Math.sin(yaw)];
      const dirA2 = [Math.sin(yaw), Math.cos(yaw)];
      let loA = Infinity, hiA = -Infinity, loC = Infinity, hiC = -Infinity;
      for (const w of platWays) for (const p of w.pts) {
        const dx = p[0] - a.x, dz = p[1] - a.z;
        const al = dx * dirA2[0] + dz * dirA2[1];
        const ac = dx * dirC2[0] + dz * dirC2[1];
        if (al < loA) loA = al;
        if (al > hiA) hiA = al;
        if (ac < loC) loC = ac;
        if (ac > hiC) hiC = ac;
      }
      snapX = a.x + dirA2[0] * ((loA + hiA) / 2) + dirC2[0] * ((loC + hiC) / 2);
      snapZ = a.z + dirA2[1] * ((loA + hiA) / 2) + dirC2[1] * ((loC + hiC) / 2);
      const pair = [];
      for (const w of lineList) {
        for (let i = 1; i < w.pts.length; i++) {
          const ax2 = w.pts[i - 1][0], az2 = w.pts[i - 1][1];
          const bx2 = w.pts[i][0], bz2 = w.pts[i][1];
          const steps = Math.max(1, Math.ceil(Math.hypot(bx2 - ax2, bz2 - az2) / 5));
          for (let s = 0; s < steps; s++) {
            const px = ax2 + (bx2 - ax2) * (s / steps), pz = az2 + (bz2 - az2) * (s / steps);
            const dx = px - snapX, dz = pz - snapZ;
            const al = dx * dirA2[0] + dz * dirA2[1];
            const ac = dx * dirC2[0] + dz * dirC2[1];
            if (Math.abs(al) <= 35 && Math.abs(ac) <= 12) pair.push(ac);
          }
        }
      }
      if (pair.length >= 4) {
        // Centre on the pair itself: the platform cloud's middle
        // can sit a metre off the tracks (one platform wider, a
        // footbridge landing in the outline), and the slabs must
        // flank the rails symmetrically.
        const mid = (Math.max(...pair) + Math.min(...pair)) / 2;
        snapX += dirC2[0] * mid;
        snapZ += dirC2[1] * mid;
        const need = (Math.max(...pair) - Math.min(...pair)) + (STATION_WIDTH_MARGIN[kind] ?? DEFAULT_WIDTH_MARGIN);
        const lim = MRT_STATION_WIDTH_LIMITS[kind];
        width = Math.round(Math.max(lim[0], Math.min(lim[1], need)) * 10) / 10;
      }
    }
    const slug = (a.nameEn || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    stations.push({
      id: `mrt-${slug || 'station'}`, name, nameEn: a.nameEn || '',
      x: Math.round(snapX * 10) / 10, z: Math.round(snapZ * 10) / 10,
      yaw, kind, length, ...(width ? { width } : {}),
    });
  }

  // ---- Beitou depot (issue #139) ----
  // The depot fan: subway ways tagged service=yard/siding/spur that
  // no station path used, clustered on the Fuxinggang anchor. The
  // radii are measured (mrt2-evidence probe 5b): the depot's own
  // ways form a clean cluster — 57 centroids within 1.2 km, then a
  // gap to the next depot's ways at 3.5 km — and 700/900 keeps the
  // whole fan while dropping the two longest through-leads
  // (1.3-1.5 km) that run out toward Beitou and Guandu: those are
  // main-line throats, and the running-line renderer already draws
  // the line there. The fan plus the hand-authored halls form one
  // special structure on the stations' non-registry path.
  const fxg = anchor.get('復興崗');
  const yardWays = [];
  let yardKm = 0;
  if (fxg) {
    for (const w of trackWays) {
      if (!['yard', 'siding', 'spur'].includes(w.tags.service || '')) continue;
      if (lineWays.has(w.id) || !w.pts.length) continue;
      let cx = 0, cz = 0, maxd = 0;
      for (const p of w.pts) {
        cx += p[0]; cz += p[1];
        const d = Math.hypot(p[0] - fxg.x, p[1] - fxg.z);
        if (d > maxd) maxd = d;
      }
      cx /= w.pts.length; cz /= w.pts.length;
      if (Math.hypot(cx - fxg.x, cz - fxg.z) <= 700 && maxd <= 900) {
        yardWays.push(w);
        yardKm += w.len / 1000;
      }
    }
  }
  let depot = null;
  if (yardWays.length) {
    const rectOf = (corners) => {
      const cs = corners.map(([la, lo]) => project(la, lo));
      const mid = (i, j) => [(cs[i][0] + cs[j][0]) / 2, (cs[i][1] + cs[j][1]) / 2];
      const mW = mid(0, 1), mE = mid(2, 3), mN = mid(1, 2), mS = mid(0, 3);
      const along = [mE[0] - mW[0], mE[1] - mW[1]];
      const len = Math.hypot(along[0], along[1]);
      return {
        x: (cs[0][0] + cs[2][0]) / 2, z: (cs[0][1] + cs[2][1]) / 2,
        yaw: Math.atan2(along[0], along[1]),
        len, wid: Math.hypot(mN[0] - mS[0], mN[1] - mS[1]),
        corners: cs,
      };
    };
    const halls = DEPOT_HALLS.map((hd) => {
      const r = rectOf(hd.corners);
      return {
        x: Math.round(r.x * 10) / 10, z: Math.round(r.z * 10) / 10,
        yaw: Math.round(r.yaw * 10000) / 10000,
        len: Math.round(r.len), wid: Math.round(r.wid), h: hd.h, way: hd.way,
        corners: r.corners,
      };
    });
    // Site frame: origin at the main shed centre, +along on its
    // long axis. The site rect covers the yard point cloud and the
    // hall footprints, padded — the fenced depot ground.
    const main = halls[0];
    const dirA = [Math.sin(main.yaw), Math.cos(main.yaw)];
    const dirC = [Math.cos(main.yaw), -Math.sin(main.yaw)];
    let aLo = Infinity, aHi = -Infinity, cLo = Infinity, cHi = -Infinity;
    const eat = (x, z) => {
      const rx = x - main.x, rz = z - main.z;
      const al = rx * dirA[0] + rz * dirA[1];
      const ac = rx * dirC[0] + rz * dirC[1];
      if (al < aLo) aLo = al;
      if (al > aHi) aHi = al;
      if (ac < cLo) cLo = ac;
      if (ac > cHi) cHi = ac;
    };
    for (const w of yardWays) for (const p of w.pts) eat(p[0], p[1]);
    for (const h of halls) for (const c of h.corners) eat(c[0], c[1]);
    const PAD = 6;
    depot = {
      x: main.x, z: main.z, yaw: main.yaw,
      site: {
        dAlong: Math.round(((aLo + aHi) / 2) * 10) / 10,
        dAcross: Math.round(((cLo + cHi) / 2) * 10) / 10,
        along: Math.round(aHi - aLo + 2 * PAD),
        across: Math.round(cHi - cLo + 2 * PAD),
      },
      halls: halls.map(({ corners, ...h }) => h),
      yard: yardWays.map((w) => w.pts.flatMap((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10])),
    };
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
    yardWays: yardWays.length,
    yardKm: +yardKm.toFixed(1),
    depotHalls: depot ? depot.halls.length : 0,
  };
  return { records, stations, depot, stats };
}
