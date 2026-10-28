// tools/taipei/build-skybridges.mjs — the Xinyi pedestrian
// skybridge network (issue #212), derived from the OSM roads
// extract exactly as the census on the issue measured it.
//
// The district's 空橋 ways are already in osm_roads.json as
// highway=footway/steps with bridge=yes + layer=1 (13 of them
// named 人行空橋）, but the road pass treats footways as
// non-carriageway with no pedestrian layout, so nothing elevated
// is drawn. This derive step lifts the network out as its own
// geodata section (world-frame centrelines, chained at shared
// endpoints); js/taipei-skybridges.js draws the decks.
//
// Selection rules (the census verdicts, so a data refresh cannot
// silently grow or shrink the network):
//   - pedestrian classes only (footway / steps / path /
//     pedestrian), carrying bridge=yes/viaduct or layer >= 1;
//   - every vertex inside the district window below (the
//     network's own extent, with margin) — footbridges elsewhere
//     in the tile are not this feature;
//   - closed rings are excluded: the one in the data (way
//     462045632) is the 101 podium's terrace ring, an isolated
//     building terrace, not a through span;
//   - chains shorter than 8 m after chaining are dropped as
//     fragments (landing stubs chain into their parents first).
//
// Widths: 5 m typical (satellite-measured 4–5 m decks); the
// flagship 101<->A11 crossing of Songzhi Rd measures ~8 m, so
// segments whose midpoint falls in the flagship box below are
// emitted at 8 m.

const PED_CLASSES = new Set(['footway', 'steps', 'path', 'pedestrian']);
// District window (lon/lat): the network spans the WTC in the
// west to Songren Rd in the east, Xinyi Rd to Songgao Rd. The
// west edge deliberately stops east of Guangfu S. Rd: the
// standalone accessible footbridge by Sun Yat-Sen Memorial
// Hall (way 312174842 and its links, lon ~121.5601-121.5605)
// is a separate park crossing, not part of the shopping-
// district system.
const WIN = { w: 121.5620, e: 121.5720, s: 25.0315, n: 25.0425 };
// Flagship box (world frame): the Songzhi Rd carriageway band
// at the Songshou latitude — x from the road query in the
// census (Songzhi centreline x -4..57, ~30 m carriageway),
// z for lat 25.0343..25.0355.
const FLAGSHIP = { minX: -25, maxX: 75, minZ: -280, maxZ: -140 };
const WIDTH_DEFAULT = 5, WIDTH_FLAGSHIP = 8;
const MIN_CHAIN_M = 8;

const q = (v) => Math.round(v * 10) / 10;

export function deriveSkybridges(roadsElements, toWorld) {
  const stats = { waysSeen: 0, waysKept: 0, excludedRings: 0, excludedOutside: 0, fragmentsDropped: 0, chains: 0, totalLenM: 0, flagshipSegs: 0 };
  const ways = []; // { pts: [[x,z],...] }
  for (const el of roadsElements) {
    if (el.type !== 'way' || !el.tags || !el.geometry || el.geometry.length < 2) continue;
    const t = el.tags;
    if (!PED_CLASSES.has(t.highway)) continue;
    const bridged = (t.bridge && t.bridge !== 'no') || parseInt(t.layer || '0', 10) >= 1;
    if (!bridged) continue;
    stats.waysSeen++;
    if (!el.geometry.every((g) => g.lon >= WIN.w && g.lon <= WIN.e && g.lat >= WIN.s && g.lat <= WIN.n)) {
      stats.excludedOutside++;
      continue;
    }
    let pts = el.geometry.map((g) => { const [x, z] = toWorld(g.lon, g.lat); return [q(x), q(z)]; });
    pts = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
    if (pts.length < 2) continue;
    const [fx, fz] = pts[0], [lx, lz] = pts[pts.length - 1];
    if (Math.hypot(fx - lx, fz - lz) < 0.5) { stats.excludedRings++; continue; }
    ways.push({ pts });
  }
  stats.waysKept = ways.length;

  // ---- chain ways at shared endpoints ----
  // Endpoint incidence: key -> [{ way, end }] (end 0 = first
  // point, 1 = last). A chain walks through an endpoint only
  // when exactly two way-ends meet there; junctions (3+) and
  // dead ends stop the walk, so chains break at network nodes
  // and the renderer draws them joint-to-joint.
  const keyOf = (p) => `${p[0]},${p[1]}`;
  const incidence = new Map();
  ways.forEach((w, wi) => {
    for (const end of [0, 1]) {
      const k = keyOf(end === 0 ? w.pts[0] : w.pts[w.pts.length - 1]);
      if (!incidence.has(k)) incidence.set(k, []);
      incidence.get(k).push({ way: wi, end });
    }
  });
  const used = new Array(ways.length).fill(false);
  const chains = [];
  const walkFrom = (startWi) => {
    const chain = [];
    let wi = startWi, end = 1; // grow forward from the way's last point; may flip below
    used[wi] = true;
    chain.push(...ways[wi].pts);
    for (;;) {
      const k = keyOf(chain[chain.length - 1]);
      const inc = incidence.get(k) || [];
      const next = inc.find((e) => !used[e.way]);
      if (!next || inc.length !== 2) break;
      used[next.way] = true;
      const wpts = ways[next.way].pts;
      const ordered = next.end === 0 ? wpts : [...wpts].reverse();
      chain.push(...ordered.slice(1));
    }
    // Also grow backwards from the chain's head when the walk
    // started mid-chain (a loop component with no dead end).
    for (;;) {
      const k = keyOf(chain[0]);
      const inc = incidence.get(k) || [];
      const next = inc.find((e) => !used[e.way]);
      if (!next || inc.length !== 2) break;
      used[next.way] = true;
      const wpts = ways[next.way].pts;
      const ordered = next.end === 1 ? wpts : [...wpts].reverse();
      chain.unshift(...ordered.slice(0, -1));
    }
    return chain;
  };
  // Start walks at ways touching a non-degree-2 endpoint first
  // (real chain ends), then mop up pure loop components.
  const startOrder = ways.map((w, wi) => wi).sort((a, b) => {
    const deg = (wi) => Math.min(...[0, 1].map((end) => (incidence.get(keyOf(end === 0 ? ways[wi].pts[0] : ways[wi].pts[ways[wi].pts.length - 1])) || []).length));
    return deg(a) - deg(b);
  });
  for (const wi of startOrder) {
    if (used[wi]) continue;
    chains.push(walkFrom(wi));
  }

  // ---- emit segments with per-segment widths ----
  const segments = [];
  for (const chain of chains) {
    let len = 0;
    const sw = [];
    for (let i = 0; i < chain.length - 1; i++) {
      const [ax, az] = chain[i], [bx, bz] = chain[i + 1];
      len += Math.hypot(bx - ax, bz - az);
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const flagship = mx >= FLAGSHIP.minX && mx <= FLAGSHIP.maxX && mz >= FLAGSHIP.minZ && mz <= FLAGSHIP.maxZ;
      if (flagship) stats.flagshipSegs++;
      sw.push(flagship ? WIDTH_FLAGSHIP : WIDTH_DEFAULT);
    }
    if (len < MIN_CHAIN_M) { stats.fragmentsDropped++; continue; }
    stats.totalLenM += len;
    segments.push({ pts: chain.flatMap(([x, z]) => [x, z]), sw });
  }
  stats.chains = segments.length;
  stats.totalLenM = Math.round(stats.totalLenM);
  return { segments, stats };
}
