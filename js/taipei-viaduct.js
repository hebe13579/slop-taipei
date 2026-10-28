// js/taipei-viaduct.js — elevated highway decks (issue #61): pure
// geometry for the deck structures the pipeline pass
// (tools/taipei/build-elevated.mjs) emits into geodata.elevatedRoads.
// No three.js here — taipei-boot.js wraps the arrays into meshes, so
// node tests pin the geometry directly.
//
// The model is deliberately minimal (simplicity over fidelity):
// each deck line becomes a box-section slab following its per-point
// height profile — top, bottom and side faces — with a parapet strip
// on both edges and an asphalt ribbon on top inside the parapets.
// Stretches whose profile stays under LOW_BED_MAX are at-grade
// ramps: they render as a low 0.25 m bed instead of a deck, so a
// descending ramp foot meets the ground streets without a step.
// Piers arrive pre-placed from the pipeline (32 m rhythm, twin
// carriageways merged to central piers, carriageway/lot rejection
// applied there); this module only shapes the pier box.
//
// Decks are DRAWN, NOT DRIVEN: no collision, no traffic, no deck
// markings. Ground systems (junction caps, markings, signals,
// medians) keep treating the deck roadbeds as ground beds exactly
// as before — only their ground ribbons are replaced by the deck.
//
// Winding convention (verified by tests/taipei-decks.test.mjs on a
// synthetic east-running line): in the world frame (x east, z
// south, y up) with the bufferLine left normal n = (-dz, dx), the
// quad corner orders below give outward face normals — deck top
// +y, bottom -y, left side +n, right side -n.

export const PARAPET_H = 1.1;      // parapet height above deck top, m
export const PARAPET_T = 0.25;     // parapet thickness, m
export const ASPHALT_LIFT = 0.03;  // asphalt ribbon above the slab top, m
export const LOW_BED_MAX = 0.5;    // profiles below this render as a low bed
export const LOW_BED_H = 0.25;     // low-bed slab height, m
export const PIER_W = 1.6;         // pier box crosswise, m
export const PIER_D = 2.24;        // pier box along-road, m
// Issue #139: the MRT track treatment (opts.tracks) — a brown
// ballast/plinth strip per track on the running surface, with two
// steel rail ribbons on it. Offsets per track come from the line's
// `tracks` field (digest: [0] on a twin way, [-3, 3] on a shared
// formation); the strip replaces the asphalt ribbon in this mode.
export const BALLAST_H = 0.24;     // strip height above the running surface, m
export const BALLAST_HALF = 1.7;   // half width of one track's strip, m
export const RAIL_OFF = 0.72;      // rail centre offset from the track centre (1435 mm gauge), m
export const RAIL_W = 0.15;        // rail ribbon width, m
export const RAIL_LIFT = 0.06;     // rail ribbon above the strip top, m
// Issue #146: the Wenhu guideway treatment (line.trackStyle ===
// 'guideway') — a rubber-tyred VAL runs on pale CONCRETE strips,
// not ballast: one raised concrete strip per track (its own sink,
// so the boot can give it a pale concrete material), with the
// steel GUIDE BARS as thin ribbons just outside the strip edges
// (the bars stand at the beam's edges at running-surface level;
// the rails sink carries them, same steel as the Red Line rails).
export const GUIDE_H = 0.16;       // guideway strip height above the running surface, m
export const GUIDE_HALF = 1.05;    // half width of one track's concrete strip, m
export const BAR_OFF = 1.13;       // guide bar centre offset from the track centre, m
export const BAR_W = 0.12;         // guide bar ribbon width, m
export const BAR_LIFT = 0.05;      // guide bar ribbon above the strip top, m
// Issue #173 (PORTAL class, from the #169 sweep): a TRUE dive portal
// — a track-mode line end at grade whose neighbour is elevated and
// which no other line continues (a grade join is not a portal) —
// gets a shaped end instead of the ballast strips stopping square
// on the grass: a concrete headwall across the formation with a
// dark opening the tracks run into, and short wing walls flanking
// the ramp foot. Track mode only; the road-deck path is untouched.
export const PORTAL_HEADWALL_H = 5.2;  // headwall height above grade, m
export const PORTAL_OPENING_H = 4.4;   // dark opening height, m
export const PORTAL_WING_M = 9;        // wing wall run back along the ramp, m
export const PORTAL_JOIN_TOL_M = 2;    // an end this close to another line's end is a join, not a portal
// Issue #184: a narrow single-track guideway ribbon (2.6 m) cannot
// seat #173's portal surround on its own — the per-line fin reads as
// a floating black door (the Wenhu dive). When two such guideway
// dive ends sit close together (the Wenhu twin trackways), they
// share ONE portal block: a concrete headwall spanning both
// trackways with one dark opening per track, a base apron carried
// to grade, and wing walls on the combined flanks. Formations wide
// enough to seat their own surround (the Red Line's ballast
// formations) keep #173's form byte-identical.
export const PORTAL_PAIR_DIST_M = 10;   // twin guideway ends this close share one block, m
export const PORTAL_PAIR_MAX_W = 4;     // a line narrower than this is a single-track ribbon, m
export const PORTAL_BLOCK_D = 1.5;      // headwall block depth behind the face, m
export const PORTAL_APRON_H = 0.1;      // base apron slab height, m
export const PORTAL_APRON_RUN_M = 10;   // apron + wing run back along the ramp, m
export const PORTAL_GUIDE_OPEN_HALF = 1.4; // dark opening half width around a guideway track centre, m
export const PORTAL_SURROUND_M = 1.1;   // concrete surround beyond the outer trackway edge, m
export const MRT_TREE_MARGIN_M = 1;    // tree-exclusion margin around ground-contact MRT beds, m
// Issue #196: a portal is not a slab standing on the ground — it is
// the bottom of an open cut. The dive run of every firing portal end
// is RE-PROFILED at render time (the digest heights stay as data;
// only the drawn profile changes): the running surface leaves the
// line's cruise height and descends linearly by arc length to
// PORTAL_DIVE_DEPTH_M below grade at the portal face, so the track
// ramps down into a trench flanked by retaining walls, and the
// #173/#184 headwall form is re-seated at the trench bottom with
// its crest at about grade. This supersedes #184's "Red s09
// byte-identical" control by design: the Red mouths change form
// too — the twin ballast trackways share one cutting, like the
// Wenhu pair shares its block. The trench length is whatever the
// dive run gives (the whole ramp from cruise height), ~59 m of it
// below grade on both real dives.
export const PORTAL_DIVE_DEPTH_M = 5.2;  // running surface at the portal face, below grade, m
export const PORTAL_FACE_TOP_M = 0.35;  // re-seated headwall crest above grade, m
export const PORTAL_FACE_BASE_M = 0.55;  // headwall foot below the running surface, m
export const PORTAL_WALL_OFF_M = 0.35;  // retaining-wall plane beyond the formation edge, m
export const PORTAL_WALL_BASE_M = 0.4;   // wall foot below the trench floor, m
export const PORTAL_WALL_TOP_M = 0.12;   // wall coping above grade, m
export const PORTAL_COPING_M = 0.75;     // coping flange out from the wall top, m
export const PORTAL_RUN_DIP_M = 0.15;    // digest noise tolerated inside a dive run, m
export const PORTAL_CRUISE_M = 8.9;      // a dive run tops out at the line's cruise height, m
export const PORTAL_CLUSTER_M = 12;      // dive ends this close share one cutting, m

const ptsOf = (line) => {
  const p = [];
  for (let i = 0; i < line.pts.length; i += 2) p.push([line.pts[i], line.pts[i + 1]]);
  return p;
};

// Per-point horizontal normals (neighbour-averaged, the bufferLine
// construction the ground ribbons use).
function pointNormals(pts) {
  return pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1];
    const L = Math.hypot(dx, dz) || 1;
    dx /= L; dz /= L;
    return [-dz, dx];
  });
}

// ---- issue #196: dive re-profiling ---------------------------------
// The #173 firing test, shared by the geometry builder, the
// ground-contact polygons and the boot's slot/pier helpers: a line
// end at grade whose neighbour is elevated and which no other line
// continues at grade is a true dive portal.
function firingEnds(lines) {
  const out = [];
  for (const line of lines) {
    const pts = ptsOf(line);
    if (pts.length < 2) continue;
    for (const endIdx of [0, pts.length - 1]) {
      const hEnd = line.h?.[endIdx] ?? 0;
      const nIdx = endIdx === 0 ? 1 : pts.length - 2;
      const hNbr = line.h?.[nIdx] ?? 0;
      if (!(hEnd < LOW_BED_MAX && hNbr >= LOW_BED_MAX)) continue;
      const E = pts[endIdx];
      const joined = lines.some((l2) => {
        if (l2 === line) return false;
        const p2 = ptsOf(l2);
        if (p2.length < 2) return false;
        return [p2[0], p2[p2.length - 1]].some((q) => Math.hypot(q[0] - E[0], q[1] - E[1]) <= PORTAL_JOIN_TOL_M);
      });
      if (joined) continue;
      out.push({ line, endIdx, E, P: pts[nIdx] });
    }
  }
  return out;
}

// computeDives(lines) -> {
//   eff: Map(line -> { pts, h, trenchSegs: Set<segIdx> }),
//   dives: [dive], clusters: [cluster],
// }
// A dive is one firing end plus its re-profiled run: the chain of
// points from the end while the digest heights climb (a dip of at
// most PORTAL_RUN_DIP_M is digest noise, ironed out) up to the
// cruise height. Effective heights are linear in arc length from
// -PORTAL_DIVE_DEPTH_M at the end to the run's top height; the
// grade crossing point is inserted into the effective chain so the
// trench (below grade) and the ramp (above) split exactly at y=0.
// Lines without a firing end are absent from `eff` (identity).
export function computeDives(lines) {
  const eff = new Map();
  const dives = [];
  for (const fe of firingEnds(lines)) {
    const { line, endIdx } = fe;
    const pts = ptsOf(line);
    const n = pts.length;
    const step = endIdx === 0 ? 1 : -1;
    // Walk the run in walk order (end first).
    const chainIdx = [endIdx];
    let hTop = line.h?.[endIdx] ?? 0;
    for (let i = endIdx + step; i >= 0 && i < n; i += step) {
      const h = line.h?.[i] ?? 0;
      if (h >= PORTAL_CRUISE_M) { chainIdx.push(i); hTop = h; break; }
      if (h > hTop - PORTAL_RUN_DIP_M) { chainIdx.push(i); hTop = Math.max(hTop, h); continue; }
      break;
    }
    if (chainIdx.length < 2) continue;
    if (dives.some((d) => d.line === line)) continue; // one dive per line in practice; the first end wins
    const chain = chainIdx.map((idx) => ({ x: pts[idx][0], z: pts[idx][1], idx }));
    let s = 0;
    chain.forEach((c, i) => {
      if (i) s += Math.hypot(c.x - chain[i - 1].x, c.z - chain[i - 1].z);
      c.s = s;
    });
    const runLen = s;
    const effH = (arc) => -PORTAL_DIVE_DEPTH_M + (hTop + PORTAL_DIVE_DEPTH_M) * (runLen ? arc / runLen : 0);
    chain.forEach((c) => { c.h = effH(c.s); });
    const crossS = runLen * PORTAL_DIVE_DEPTH_M / (hTop + PORTAL_DIVE_DEPTH_M);
    // The grade crossing point, interpolated along the chain.
    let crossPt = null;
    for (let i = 0; i + 1 < chain.length; i++) {
      const a = chain[i], b = chain[i + 1];
      if (a.s <= crossS && crossS <= b.s) {
        const f = (crossS - a.s) / ((b.s - a.s) || 1);
        crossPt = [a.x + (b.x - a.x) * f, a.z + (b.z - a.z) * f];
        break;
      }
    }
    if (!crossPt) continue;
    const dive = {
      line, endIdx, E: fe.E, chain, runLen, hTop, crossS, crossPt,
      tHat: (() => { const dx = fe.E[0] - fe.P[0], dz = fe.E[1] - fe.P[1]; const L = Math.hypot(dx, dz) || 1; return [dx / L, dz / L]; })(),
    };
    dives.push(dive);
    // Splice the effective chain into the line's point/height lists
    // (in line order), inserting the crossing between the stations
    // that straddle it.
    const walkPts = chain.map((c) => [c.x, c.z]);
    const walkH = chain.map((c) => c.h);
    const crossWalkIdx = chain.findIndex((c) => c.s > crossS);
    walkPts.splice(crossWalkIdx, 0, crossPt);
    walkH.splice(crossWalkIdx, 0, 0);
    const trenchSegs = new Set();
    const runSegs = new Set();
    let rec = eff.get(line);
    if (!rec) {
      rec = { pts: pts.map((p) => [p[0], p[1]]), h: pts.map((_, i) => line.h?.[i] ?? 0), trenchSegs, runSegs };
      eff.set(line, rec);
    }
    const W = walkPts.length;
    if (endIdx === 0) {
      rec.pts.splice(0, chain.length, ...walkPts);
      rec.h.splice(0, chain.length, ...walkH);
      for (let k = 0; k < crossWalkIdx; k++) trenchSegs.add(k);
      for (let k = 0; k < W - 1; k++) runSegs.add(k);
    } else {
      const start = rec.pts.length - chain.length;
      const revPts = [...walkPts].reverse(), revH = [...walkH].reverse();
      rec.pts.splice(start, chain.length, ...revPts);
      rec.h.splice(start, chain.length, ...revH);
      const crossEffIdx = rec.pts.length - 1 - crossWalkIdx;
      for (let k = crossEffIdx; k < rec.pts.length - 1; k++) trenchSegs.add(k);
      for (let k = rec.pts.length - W; k < rec.pts.length - 1; k++) runSegs.add(k);
    }
    dive.trenchSegs = trenchSegs;
    dive.effRec = rec;
  }
  // Cluster dives whose ends sit close together: they share one
  // cutting (the Red twin ballast trackways exactly like the Wenhu
  // guideway pair — two separate trenches would not fit between
  // them). Deterministic: sorted by end position, union-find.
  const clusters = [];
  {
    const sorted = [...dives].sort((a, b) => (a.E[0] - b.E[0]) || (a.E[1] - b.E[1]));
    const parent = sorted.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length; j++) {
      if (Math.hypot(sorted[i].E[0] - sorted[j].E[0], sorted[i].E[1] - sorted[j].E[1]) <= PORTAL_CLUSTER_M) {
        const a = find(i), b = find(j); if (a !== b) parent[a] = b;
      }
    }
    const groups = new Map();
    sorted.forEach((d, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(d); });
    for (const members of groups.values()) {
      let tx = 0, tz = 0;
      for (const d of members) { tx += d.tHat[0]; tz += d.tHat[1]; }
      const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const tHat = [tx, tz], nHat = [-tz, tx];
      const M = [members.reduce((s2, d) => s2 + d.E[0], 0) / members.length, members.reduce((s2, d) => s2 + d.E[1], 0) / members.length];
      for (const d of members) {
        d.c = (d.E[0] - M[0]) * nHat[0] + (d.E[1] - M[1]) * nHat[1];
        const w = d.line.width || 6;
        const offs = d.line.tracks?.length ? d.line.tracks : [0];
        d.oHalf = d.line.trackStyle === 'guideway'
          ? PORTAL_GUIDE_OPEN_HALF
          : Math.min(w / 2 - 0.5, Math.max(...offs.map((o) => Math.abs(o))) + BALLAST_HALF);
      }
      members.sort((a, b) => a.c - b.c);
      const spanLo = Math.min(...members.map((d) => d.c - (d.line.width || 6) / 2));
      const spanHi = Math.max(...members.map((d) => d.c + (d.line.width || 6) / 2));
      const rep = members.reduce((a, b) => (b.runLen > a.runLen ? b : a), members[0]);
      // Below-grade stations along the cluster centre line: the
      // representative chain's stations up to the grade crossing
      // (projected laterally onto the centre line), heights from
      // the re-profiled run.
      const stations = [];
      for (const c of rep.chain) {
        if (c.s > rep.crossS) break;
        stations.push({ x: c.x, z: c.z, s: c.s, y: c.h });
      }
      stations.push({ x: rep.crossPt[0], z: rep.crossPt[1], s: rep.crossS, y: 0 });
      for (const st of stations) {
        const lat = (st.x - M[0]) * nHat[0] + (st.z - M[1]) * nHat[1];
        st.x += nHat[0] * ((spanLo + spanHi) / 2 - lat);
        st.z += nHat[1] * ((spanLo + spanHi) / 2 - lat);
      }
      clusters.push({
        members, M, tHat, nHat, spanLo, spanHi, rep, stations,
        centreOff: (spanLo + spanHi) / 2, formHalf: (spanHi - spanLo) / 2,
        profileAt: (arc) => {
          const ch = rep.chain;
          if (arc <= 0) return ch[0].h;
          for (let i = 0; i + 1 < ch.length; i++) {
            if (arc <= ch[i + 1].s) { const f = (arc - ch[i].s) / ((ch[i + 1].s - ch[i].s) || 1); return ch[i].h + (ch[i + 1].h - ch[i].h) * f; }
          }
          return ch[ch.length - 1].h;
        },
      });
    }
  }
  return { eff, dives, clusters };
}

// The trench footprints of every portal cluster (issue #196): the
// slot the flat ground layers must leave open — from the portal
// face back along the cutting to the grade crossing, a wall's
// width beyond the formation on both flanks. Point-array quads.
export function portalTrenchSlots(elevated) {
  const { clusters } = computeDives(elevated?.lines || []);
  return clusters.map((c) => {
    const half = c.formHalf + PORTAL_WALL_OFF_M + 0.7;
    // centre the slot on the formation centre, not on M
    const mid = [(c.M[0] + c.nHat[0] * c.centreOff), (c.M[1] + c.nHat[1] * c.centreOff)];
    const Cmid = [mid[0] - c.tHat[0] * c.rep.crossS, mid[1] - c.tHat[1] * c.rep.crossS];
    return [
      [mid[0] + c.nHat[0] * half, mid[1] + c.nHat[1] * half],
      [Cmid[0] + c.nHat[0] * half, Cmid[1] + c.nHat[1] * half],
      [Cmid[0] - c.nHat[0] * half, Cmid[1] - c.nHat[1] * half],
      [mid[0] - c.nHat[0] * half, mid[1] - c.nHat[1] * half],
    ];
  });
}

// Piers under a re-profiled dive run would poke through the lowered
// ramp (their heights were computed against the digest profile):
// clamp each pier inside a dive corridor to the re-profiled deck
// underside. A pier whose underside reaches grade is buried to a
// stub — the ramp is ground-bearing there. Records are not edited;
// the boot passes the adjusted list to the pier mesh.
export function diveAdjustedPiers(elevated) {
  const piers = elevated?.piers || [];
  const { clusters } = computeDives(elevated?.lines || []);
  if (!clusters.length || !piers.length) return piers;
  const depth = elevated?.deckDepth ?? 1.8;
  let changed = false;
  const out = piers.map((p) => {
    let h = p.h;
    for (const c of clusters) {
      const rx = p.x - c.M[0], rz = p.z - c.M[1];
      const s = -(rx * c.tHat[0] + rz * c.tHat[1]);
      const lat = rx * c.nHat[0] + rz * c.nHat[1];
      if (s < -2 || s > c.rep.runLen + 2) continue;
      if (Math.abs(lat - c.centreOff) > c.formHalf + 2.5) continue;
      h = Math.min(h, Math.max(c.profileAt(Math.max(0, s)) - depth, 0.01));
    }
    if (h !== p.h) { changed = true; return { ...p, h }; }
    return p;
  });
  return changed ? out : piers;
}

// ---- issue #239: parapet trims at merge/branch mouths --------------
// Parapets are emitted per line along its whole length, with no join
// awareness — so at every merge/branch mouth the branch's inner
// parapet runs across the main deck's driving surface (and across
// the branch's own mouth) until the two centrelines separate by
// more than the deck half-width, and every line end that lands on
// another deck carries a full-width end-cap wall across the mouth.
// parapetTrims() computes, once per digest, the kept fraction
// intervals of every parapet strip plus which terminal end caps
// survive, under one rule: a strip (or cap) is suppressed over the
// stretch where it lies inside ANOTHER line's driving corridor at
// the same level. The fence starts where the branch corridor
// actually separates from the main line. The visual strips
// (buildDeckGeometry, roads mode only) and the drive-model
// colliders (js/taipei-drive.js) consume the same trims, so what
// you see is what blocks the car — never a visible fence with no
// collider, or a collider with no visible fence.
//
// Pair eligibility keeps the rule off the cases that must keep
// their fences: a pair counts only when its centrelines approach
// within JOIN_APPROACH_M (a shared junction node or a plan
// crossing), pure continuations are excluded (one shared node
// where the two lines leave in nearly opposite directions — the
// same road passing through under a new way id), and stacked
// crossings are excluded by the same-level test (|Δh| above
// PARAPET_JOIN_DH_M keeps its fences).
export const PARAPET_JOIN_DH_M = 2.0;      // same-level band for a mouth, m
export const PARAPET_TRIM_STEP_M = 1.0;    // strip sampling step, m
export const PARAPET_TRIM_MIN_KEEP_M = 1.0; // kept slivers shorter than this are suppressed
export const PARAPET_JOIN_APPROACH_M = 2.0; // centreline approach that makes a mouth, m
export const PARAPET_CONTINUATION_DEG = 140; // outward chords past this = through road, deg
export const PARAPET_CHORD_M = 20;         // chord length for the continuation test, m

const _trimCache = new WeakMap();

function _segSegDist(ax, az, bx, bz, cx, cz, dx, dz) {
  // Exact 2D segment-segment distance (0 when the segments cross).
  const d1x = bx - ax, d1z = bz - az, d2x = dx - cx, d2z = dz - cz;
  const den = d1x * d2z - d1z * d2x;
  if (den !== 0) {
    const t = ((cx - ax) * d2z - (cz - az) * d2x) / den;
    const u = ((cx - ax) * d1z - (cz - az) * d1x) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
  }
  const ptSeg = (px, pz, x1, z1, x2, z2) => {
    const ex = x2 - x1, ez = z2 - z1, L2 = ex * ex + ez * ez || 1;
    const t = Math.max(0, Math.min(1, ((px - x1) * ex + (pz - z1) * ez) / L2));
    return Math.hypot(px - (x1 + ex * t), pz - (z1 + ez * t));
  };
  return Math.min(
    ptSeg(ax, az, cx, cz, dx, dz), ptSeg(bx, bz, cx, cz, dx, dz),
    ptSeg(cx, cz, ax, az, bx, bz), ptSeg(dx, dz, ax, az, bx, bz));
}

function _chordFrom(L, endIdx, chordLen) {
  const n = L.pts.length / 2;
  let x, z, step;
  if (endIdx === 0) { x = L.pts[0]; z = L.pts[1]; step = 1; }
  else { x = L.pts[n * 2 - 2]; z = L.pts[n * 2 - 1]; step = -1; }
  let acc = 0, cx = x, cz = z;
  for (let k = 0; k + 1 < n; k++) {
    const j = step === 1 ? k : n - 2 - k;
    const ax = L.pts[2 * j], az = L.pts[2 * j + 1], bx = L.pts[2 * j + 2], bz = L.pts[2 * j + 3];
    const dl = Math.hypot(bx - ax, bz - az);
    if (acc + dl >= chordLen) {
      const t = dl ? (chordLen - acc) / dl : 0;
      cx = ax + (bx - ax) * t; cz = az + (bz - az) * t;
      break;
    }
    acc += dl; cx = bx; cz = bz;
  }
  const d = Math.hypot(cx - x, cz - z) || 1;
  return [(cx - x) / d, (cz - z) / d];
}

// Kept parapet intervals + surviving end caps for one digest.
// Returns { lines: [{ segments: [{ left, right }], capStart, capEnd }],
//           stats: { blockedM, totalM, suppressedCaps, affectedStrips } }
// where left/right are kept [t0, t1] fraction lists along the
// segment (left = the +normal side, the renderer's L parapet and
// the drive model's s = +1 strip) and capStart/capEnd say whether
// the line's terminal end-cap quad is drawn.
export function parapetTrims(elevated) {
  if (!elevated || !Array.isArray(elevated.lines)) {
    return { lines: [], stats: { blockedM: 0, totalM: 0, suppressedCaps: 0, affectedStrips: 0 } };
  }
  const hit = _trimCache.get(elevated);
  if (hit) return hit;
  const lines = elevated.lines;
  const out = { lines: [], stats: { blockedM: 0, totalM: 0, suppressedCaps: 0, affectedStrips: 0 } };
  _trimCache.set(elevated, out);

  // Segment list + spatial hash (the drive model's 48 m cell idiom).
  const CELL = 48;
  const ckey = (ix, iz) => (ix + 4096) * 8192 + (iz + 4096);
  const segs = [];
  const cells = new Map();
  for (let li = 0; li < lines.length; li++) {
    const L = lines[li], n = L.pts.length / 2, half = (L.width || 6) / 2;
    const lineSegs = [];
    for (let i = 0; i + 1 < n; i++) {
      const ax = L.pts[2 * i], az = L.pts[2 * i + 1], bx = L.pts[2 * i + 2], bz = L.pts[2 * i + 3];
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
      const s = {
        li, i, ax, az, bx, bz, len, half,
        ux: len ? dx / len : 0, uz: len ? dz / len : 0,
        hA: L.h?.[i] ?? 0, hB: L.h?.[i + 1] ?? 0,
      };
      segs.push(s);
      lineSegs.push(s);
      if (len > 0) {
        const minX = Math.min(ax, bx) - half, maxX = Math.max(ax, bx) + half;
        const minZ = Math.min(az, bz) - half, maxZ = Math.max(az, bz) + half;
        for (let ix = Math.floor(minX / CELL); ix <= Math.floor(maxX / CELL); ix++) {
          for (let iz = Math.floor(minZ / CELL); iz <= Math.floor(maxZ / CELL); iz++) {
            const k = ckey(ix, iz);
            if (!cells.has(k)) cells.set(k, []);
            cells.get(k).push(s);
          }
        }
      }
    }
    out.lines.push({ segments: lineSegs.map(() => ({ left: [[0, 1]], right: [[0, 1]] })), capStart: true, capEnd: true });
  }

  // Pair eligibility: centrelines approach within JOIN_APPROACH_M,
  // excluding pure continuations.
  const eligible = new Set();
  {
    const pairMin = new Map(); // "li|oi" -> min centreline distance
    const seenSegPairs = new Set();
    for (const list of cells.values()) {
      for (let a = 0; a < list.length; a++) {
        for (let b = a + 1; b < list.length; b++) {
          const s = list[a], o = list[b];
          if (s.li === o.li) continue;
          const pk = s.li + ':' + s.i + '|' + o.li + ':' + o.i;
          if (seenSegPairs.has(pk)) continue;
          seenSegPairs.add(pk);
          const d = _segSegDist(s.ax, s.az, s.bx, s.bz, o.ax, o.az, o.bx, o.bz);
          const key = s.li < o.li ? s.li + '|' + o.li : o.li + '|' + s.li;
          if (d < (pairMin.get(key) ?? Infinity)) pairMin.set(key, d);
        }
      }
    }
    const endsOf = (L) => [[L.pts[0], L.pts[1], 0], [L.pts[L.pts.length - 2], L.pts[L.pts.length - 1], 1]];
    for (const [key, dmin] of pairMin) {
      const [li, oi] = key.split('|').map(Number);
      const A = lines[li], B = lines[oi];
      const nodes = [];
      for (const [ax, az, ai] of endsOf(A)) {
        for (const [bx, bz, bi] of endsOf(B)) {
          if (Math.hypot(ax - bx, az - bz) <= PARAPET_JOIN_APPROACH_M) nodes.push([ai, bi, ax, az]);
        }
      }
      // NOTE (issue #239 scope): twin carriageways of one bridge
      // whose digest corridors overlap without ever approaching
      // within 2 m (福林橋: 8.6 m apart, 10.8 m wide each) are
      // deliberately NOT eligible here — their inner fences are
      // the directions' median, and whether the digest widths
      // overstate the decks is a separate widths question, not a
      // merge mouth. Only pairs that meet at a mouth are trimmed.
      if (dmin > PARAPET_JOIN_APPROACH_M) continue;
      let continuation = false;
      if (nodes.length === 1) {
        const [ai, bi] = nodes[0];
        const ca = _chordFrom(A, ai, PARAPET_CHORD_M), cb = _chordFrom(B, bi, PARAPET_CHORD_M);
        const cos = Math.max(-1, Math.min(1, ca[0] * cb[0] + ca[1] * cb[1]));
        const angle = Math.acos(cos) * 180 / Math.PI;
        if (angle > PARAPET_CONTINUATION_DEG) {
          // A through road can still braid elsewhere: the pair is a
          // continuation only if the lines meet nowhere else. The
          // incident end segments are the junction itself; any
          // other segment pair within approach distance elsewhere
          // makes it a junction pair.
          const [nx, nz] = [nodes[0][2], nodes[0][3]];
          const incident = (s) => {
            const L = lines[s.li];
            const n = L.pts.length / 2;
            return (s.i === 0 && Math.hypot(L.pts[0] - nx, L.pts[1] - nz) <= PARAPET_JOIN_APPROACH_M) ||
              (s.i === n - 2 && Math.hypot(L.pts[n * 2 - 2] - nx, L.pts[n * 2 - 1] - nz) <= PARAPET_JOIN_APPROACH_M);
          };
          let elsewhere = false;
          for (const s of segs) {
            if (s.li !== li && s.li !== oi) continue;
            if (incident(s)) continue;
            // Every cell the segment's corridor bbox touches (the
            // midpoint cell alone misses meetings away from it).
            const minX = Math.min(s.ax, s.bx) - s.half, maxX = Math.max(s.ax, s.bx) + s.half;
            const minZ = Math.min(s.az, s.bz) - s.half, maxZ = Math.max(s.az, s.bz) + s.half;
            for (let ix = Math.floor(minX / CELL); ix <= Math.floor(maxX / CELL) && !elsewhere; ix++) {
              for (let iz = Math.floor(minZ / CELL); iz <= Math.floor(maxZ / CELL) && !elsewhere; iz++) {
                for (const o of cells.get(ckey(ix, iz)) || []) {
                  if ((o.li === li || o.li === oi) && o.li !== s.li && !incident(o)) {
                    if (_segSegDist(s.ax, s.az, s.bx, s.bz, o.ax, o.az, o.bx, o.bz) <= PARAPET_JOIN_APPROACH_M) { elsewhere = true; break; }
                  }
                }
              }
            }
            if (elsewhere) break;
          }
          continuation = !elsewhere;
        }
      }
      if (!continuation) eligible.add(key);
    }
  }

  const insideOther = (x, z, h, excludeLi) => {
    const k = ckey(Math.floor(x / CELL), Math.floor(z / CELL));
    for (const s of cells.get(k) || []) {
      if (s.li === excludeLi) continue;
      const key = excludeLi < s.li ? excludeLi + '|' + s.li : s.li + '|' + excludeLi;
      if (!eligible.has(key)) continue;
      const px = x - s.ax, pz = z - s.az;
      const t = s.len ? Math.max(0, Math.min(1, (px * s.ux + pz * s.uz) / s.len)) : 0;
      const cx = s.ax + s.ux * s.len * t, cz = s.az + s.uz * s.len * t;
      if (Math.hypot(x - cx, z - cz) > s.half + 0.1) continue;
      const hM = s.hA + (s.hB - s.hA) * t;
      if (Math.abs(h - hM) <= PARAPET_JOIN_DH_M) return true;
    }
    return false;
  };

  // Per-strip kept intervals from 1 m samples along the strip centre.
  for (const s of segs) {
    if (!(s.len > 0)) continue;
    const off = s.half - PARAPET_T / 2, nx = -s.uz, nz = s.ux;
    for (const side of [1, -1]) {
      const steps = Math.max(1, Math.ceil(s.len / PARAPET_TRIM_STEP_M));
      const inside = [];
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const x = s.ax + (s.bx - s.ax) * t + side * nx * off;
        const z = s.az + (s.bz - s.az) * t + side * nz * off;
        const h = s.hA + (s.hB - s.hA) * t;
        inside.push(insideOther(x, z, h, s.li));
        out.stats.totalM += s.len / steps;
      }
      // Suppressed runs -> kept complement; drop kept slivers.
      const kept = [];
      let runStart = null;
      for (let k = 0; k <= steps; k++) {
        if (!inside[k] && runStart == null) runStart = k;
        if ((inside[k] || k === steps) && runStart != null) {
          kept.push([runStart / steps, k / steps]);
          runStart = null;
        }
      }
      const filtered = kept.filter(([t0, t1]) => (t1 - t0) * s.len >= PARAPET_TRIM_MIN_KEEP_M);
      let anyInside = false;
      for (let k = 0; k <= steps; k++) {
        if (inside[k]) { anyInside = true; out.stats.blockedM += s.len / steps; }
      }
      if (anyInside) out.stats.affectedStrips++;
      out.lines[s.li].segments[s.i][side === 1 ? 'left' : 'right'] = filtered;
    }
  }

  // Terminal end caps: suppressed when the terminal cross-section
  // centre lies inside another eligible line's corridor at the
  // same level (the cap is a full-width wall across the mouth).
  for (let li = 0; li < lines.length; li++) {
    const L = lines[li], n = L.pts.length / 2;
    if (n < 2) continue;
    // Caps below LOW_BED_MAX are never drawn anyway; only count
    // suppressions that change the render.
    if ((L.h?.[0] ?? 0) >= LOW_BED_MAX && insideOther(L.pts[0], L.pts[1], L.h?.[0] ?? 0, li)) { out.lines[li].capStart = false; out.stats.suppressedCaps++; }
    if ((L.h?.[n - 1] ?? 0) >= LOW_BED_MAX && insideOther(L.pts[n * 2 - 2], L.pts[n * 2 - 1], L.h?.[n - 1] ?? 0, li)) { out.lines[li].capEnd = false; out.stats.suppressedCaps++; }
  }
  return out;
}

// buildDeckGeometry(elevated, opts) -> {
//   concrete: { positions, normals },  // slab + parapets, flat-shaded
//   asphalt:  { positions, normals },  // deck-top ribbon inside parapets
//   ballast:  { positions, normals },  // MRT track strips (opts.tracks)
//   rails:    { positions, normals },  // MRT rail ribbons (opts.tracks)
//   guideway: { positions, normals },  // Wenhu concrete strips (guideway lines)
//   portal:   { positions, normals },  // dive-portal headwalls + wings (opts.tracks, issue #173)
//   portalDark: { positions, normals },// the portal openings (opts.tracks, issue #173)
//   triCount, lineCount, pierCount,
// }
// Positions are non-indexed triangles (6 vertices per quad face) in
// world metres, y-up; normals are per-face (flat shading).
export function buildDeckGeometry(elevated, opts = {}) {
  const tracks = !!opts.tracks;
  const depth = elevated?.deckDepth ?? 1.8;
  const lines = elevated?.lines || [];
  const concrete = { pos: [], nor: [] };
  const asphalt = { pos: [], nor: [] };
  const ballast = { pos: [], nor: [] };
  const rails = { pos: [], nor: [] };
  const guideway = { pos: [], nor: [] };
  const portal = { pos: [], nor: [] };
  const portalDark = { pos: [], nor: [] };
  // Append one quad (corners in boundary order) as two triangles
  // with the quad's flat normal.
  const quad = (sink, a, b, c, d) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz) || 1;
    nx /= L; ny /= L; nz /= L;
    for (const p of [a, b, c, a, c, d]) { sink.pos.push(p[0], p[1], p[2]); sink.nor.push(nx, ny, nz); }
  };
  // Issue #139: one track's ballast strip + rails over a segment.
  // (pA, nA, yA) / (pB, nB, yB) are the ends' centre points, point
  // normals and running-surface heights (deck top, or LOW_BED_H on
  // at-grade stretches); `o` is the track's offset from the line
  // centreline along the normal.
  const trackStrip = (pA, nA, yA, pB, nB, yB, o) => {
    const corner = (p, n, off, y) => [p[0] + n[0] * off, y, p[1] + n[1] * off];
    const aL = corner(pA, nA, o + BALLAST_HALF, yA + BALLAST_H), aR = corner(pA, nA, o - BALLAST_HALF, yA + BALLAST_H);
    const bL = corner(pB, nB, o + BALLAST_HALF, yB + BALLAST_H), bR = corner(pB, nB, o - BALLAST_HALF, yB + BALLAST_H);
    const aLb = corner(pA, nA, o + BALLAST_HALF, yA), aRb = corner(pA, nA, o - BALLAST_HALF, yA);
    const bLb = corner(pB, nB, o + BALLAST_HALF, yB), bRb = corner(pB, nB, o - BALLAST_HALF, yB);
    quad(ballast, aL, bL, bR, aR);       // strip top
    quad(ballast, aL, aLb, bLb, bL);     // left side
    quad(ballast, aR, bR, bRb, aRb);     // right side
    for (const s of [-RAIL_OFF, RAIL_OFF]) {
      const raL = corner(pA, nA, o + s + RAIL_W / 2, yA + BALLAST_H + RAIL_LIFT);
      const raR = corner(pA, nA, o + s - RAIL_W / 2, yA + BALLAST_H + RAIL_LIFT);
      const rbL = corner(pB, nB, o + s + RAIL_W / 2, yB + BALLAST_H + RAIL_LIFT);
      const rbR = corner(pB, nB, o + s - RAIL_W / 2, yB + BALLAST_H + RAIL_LIFT);
      quad(rails, raL, rbL, rbR, raR);
    }
  };
  // Issue #146: one track's concrete guideway strip + guide bars
  // over a segment — the trackStrip shape (top + two sides) in the
  // guideway sink, the bars as flat steel ribbons in the rails
  // sink just outside the strip's edges.
  const guideStrip = (pA, nA, yA, pB, nB, yB, o) => {
    const corner = (p, n, off, y) => [p[0] + n[0] * off, y, p[1] + n[1] * off];
    const aL = corner(pA, nA, o + GUIDE_HALF, yA + GUIDE_H), aR = corner(pA, nA, o - GUIDE_HALF, yA + GUIDE_H);
    const bL = corner(pB, nB, o + GUIDE_HALF, yB + GUIDE_H), bR = corner(pB, nB, o - GUIDE_HALF, yB + GUIDE_H);
    const aLb = corner(pA, nA, o + GUIDE_HALF, yA), aRb = corner(pA, nA, o - GUIDE_HALF, yA);
    const bLb = corner(pB, nB, o + GUIDE_HALF, yB), bRb = corner(pB, nB, o - GUIDE_HALF, yB);
    quad(guideway, aL, bL, bR, aR);       // strip top
    quad(guideway, aL, aLb, bLb, bL);     // left side
    quad(guideway, aR, bR, bRb, aRb);     // right side
    for (const s of [-BAR_OFF, BAR_OFF]) {
      const raL = corner(pA, nA, o + s + BAR_W / 2, yA + GUIDE_H + BAR_LIFT);
      const raR = corner(pA, nA, o + s - BAR_W / 2, yA + GUIDE_H + BAR_LIFT);
      const rbL = corner(pB, nB, o + s + BAR_W / 2, yB + GUIDE_H + BAR_LIFT);
      const rbR = corner(pB, nB, o + s - BAR_W / 2, yB + GUIDE_H + BAR_LIFT);
      quad(rails, raL, rbL, rbR, raR);
    }
  };

  // Issue #196: the dive computation (re-profiled runs, trench
  // segments, portal clusters) — track mode only; the road-deck
  // path never re-profiles.
  const diveData = tracks ? computeDives(lines) : null;

  // Issue #196: one portal cluster's trench. The face is the
  // #173/#184 headwall form re-seated at the trench bottom: piers
  // and a lintel around one dark opening per member trackway,
  // spanning wall to wall, foot at the trench floor, crest at
  // PORTAL_FACE_TOP_M above grade. Retaining walls flank the
  // cutting from the face back to the grade crossing, their feet
  // below the floor, their tops at coping height with a flange
  // out over the slotted ground edge. The floor is one strip
  // following the re-profiled descent (ballast sink for ballast
  // lines, guideway sink for the Wenhu plinth); the members' own
  // track strips are emitted separately, per line, over their
  // trench segments. Corner orders: the face mirrors #173's (its
  // normal faces back along the descent); wall orders are chosen
  // per side so the visible face points into the cutting; floor
  // and coping orders give +y normals.
  const emitTrench = (c) => {
    const [nx, nz] = c.nHat;
    const M = c.M;
    const faceLo = c.spanLo - PORTAL_WALL_OFF_M, faceHi = c.spanHi + PORTAL_WALL_OFF_M;
    const baseY = -PORTAL_DIVE_DEPTH_M - PORTAL_FACE_BASE_M;
    const openTop = -PORTAL_DIVE_DEPTH_M + PORTAL_OPENING_H;
    const at = (off, y, back = 0) => [M[0] + nx * off - c.tHat[0] * back, y, M[1] + nz * off - c.tHat[1] * back];
    const openings = c.members.map((d) => [d.c - d.oHalf, d.c + d.oHalf]).sort((a, b) => a[0] - b[0]);
    const piers = [];
    let lo = faceLo;
    for (const [oLo, oHi] of openings) { piers.push([lo, oLo]); lo = oHi; }
    piers.push([lo, faceHi]);
    for (const [pLo, pHi] of piers) quad(portal, at(pLo, baseY), at(pHi, baseY), at(pHi, PORTAL_FACE_TOP_M), at(pLo, PORTAL_FACE_TOP_M));
    quad(portal, at(faceLo, openTop), at(faceHi, openTop), at(faceHi, PORTAL_FACE_TOP_M), at(faceLo, PORTAL_FACE_TOP_M));
    for (const [oLo, oHi] of openings) {
      const dk = (off, y) => at(off, y, -0.06);
      quad(portalDark, dk(oLo, -PORTAL_DIVE_DEPTH_M), dk(oHi, -PORTAL_DIVE_DEPTH_M), dk(oHi, openTop), dk(oLo, openTop));
    }
    // Retaining walls + coping along the below-grade stations.
    const floorSink = c.rep.line.trackStyle === 'guideway' ? guideway : ballast;
    const floorHalf = c.formHalf + PORTAL_WALL_OFF_M + 0.3;
    const stAt = (st, off) => [st.x + nx * off, st.z + nz * off];
    for (let i = 0; i + 1 < c.stations.length; i++) {
      const A = c.stations[i], B = c.stations[i + 1];
      // Floor strip (top at the running-surface profile).
      const aA = stAt(A, c.centreOff - floorHalf), aB = stAt(B, c.centreOff - floorHalf);
      const bA = stAt(A, c.centreOff + floorHalf), bB = stAt(B, c.centreOff + floorHalf);
      quad(floorSink, [aA[0], A.y, aA[1]], [aB[0], B.y, aB[1]], [bB[0], B.y, bB[1]], [bA[0], A.y, bA[1]]);
      for (const s of [-1, 1]) {
        const wallOff = (s < 0 ? c.spanLo : c.spanHi) + s * PORTAL_WALL_OFF_M;
        const wA = stAt(A, wallOff), wB = stAt(B, wallOff);
        const botA = [wA[0], A.y - PORTAL_WALL_BASE_M, wA[1]], botB = [wB[0], B.y - PORTAL_WALL_BASE_M, wB[1]];
        const topA = [wA[0], PORTAL_WALL_TOP_M, wA[1]], topB = [wB[0], PORTAL_WALL_TOP_M, wB[1]];
        if (s < 0) quad(portal, botA, topA, topB, botB);
        else quad(portal, botA, botB, topB, topA);
        const cA = stAt(A, wallOff + s * PORTAL_COPING_M), cB = stAt(B, wallOff + s * PORTAL_COPING_M);
        const inA = [wA[0], PORTAL_WALL_TOP_M, wA[1]], inB = [wB[0], PORTAL_WALL_TOP_M, wB[1]];
        const outA = [cA[0], PORTAL_WALL_TOP_M, cA[1]], outB = [cB[0], PORTAL_WALL_TOP_M, cB[1]];
        if (s < 0) quad(portal, outA, outB, inB, inA);
        else quad(portal, inA, inB, outB, outA);
      }
    }
    // The members' track strips over their trench segments.
    for (const d of c.members) {
      const rec = diveData.eff.get(d.line);
      const n2 = pointNormals(rec.pts);
      const offs = d.line.tracks?.length ? d.line.tracks : [0];
      const fn = d.line.trackStyle === 'guideway' ? guideStrip : trackStrip;
      for (const si of d.trenchSegs) for (const o of offs) fn(rec.pts[si], n2[si], rec.h[si], rec.pts[si + 1], n2[si + 1], rec.h[si + 1], o);
    }
  };

  // Issue #239: parapet trims at merge/branch mouths, roads mode
  // only — MRT guideway edges keep their full strips.
  const trims = tracks ? null : parapetTrims(elevated);

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const effRec = diveData?.eff.get(line);
    const pts = effRec ? effRec.pts : ptsOf(line);
    if (pts.length < 2) continue;
    const normals = pointNormals(pts);
    const trackOffs = tracks ? (line.tracks?.length ? line.tracks : [0]) : [];
    const stripFn = line.trackStyle === 'guideway' ? guideStrip : trackStrip;
    const half = (line.width || 6) / 2;
    const inner = half - PARAPET_T;
    // Cross-section corners per point: slab TL/TR (top) and BL/BR
    // (bottom, clamped to grade), parapet outer/inner base+top on
    // both edges, and the asphalt ribbon corners. Issue #196: the
    // cross-sections follow the re-profiled heights on dive lines.
    const cs = pts.map((p, i) => {
      const h = effRec ? effRec.h[i] : (line.h[i] ?? 0);
      const [nx, nz] = normals[i];
      const lx = p[0] + nx * half, lz = p[1] + nz * half;
      const rx = p[0] - nx * half, rz = p[1] - nz * half;
      const ilx = p[0] + nx * inner, ilz = p[1] + nz * inner;
      const irx = p[0] - nx * inner, irz = p[1] - nz * inner;
      const yB = Math.max(h - depth, 0);
      const yP = h + PARAPET_H, yA = h + ASPHALT_LIFT;
      return {
        h,
        TL: [lx, h, lz], TR: [rx, h, rz], BL: [lx, yB, lz], BR: [rx, yB, rz],
        oL: [lx, h, lz], oLt: [lx, yP, lz], iL: [ilx, h, ilz], iLt: [ilx, yP, ilz],
        oR: [rx, h, rz], oRt: [rx, yP, rz], iR: [irx, h, irz], iRt: [irx, yP, irz],
        aL: [ilx, yA, ilz], aR: [irx, yA, irz],
      };
    });
    for (let i = 0; i + 1 < cs.length; i++) {
      const A = cs[i], B = cs[i + 1];
      // Issue #196: a dive run's below-grade segments are the
      // trench emitter's (floor + track strips), and its above-grade
      // segments keep the slab section all the way down to the
      // grade crossing — no flat low bed on the ramp.
      if (effRec && effRec.trenchSegs.has(i)) continue;
      if (Math.max(A.h, B.h) < LOW_BED_MAX && !(effRec && effRec.runSegs.has(i))) {
        // At-grade stretch: a low flat bed (top LOW_BED_H, no
        // parapets) with its asphalt on top — the ramp foot's
        // pavement where the ground bed is suppressed.
        const flat = (c, key) => [c[key][0], LOW_BED_H, c[key][2]];
        const bot = (c, key) => [c[key][0], 0, c[key][2]];
        const aT = flat(A, 'TL'), aTb = flat(B, 'TL'), aR = flat(A, 'TR'), aRb = flat(B, 'TR');
        const aBl = bot(A, 'TL'), aBlb = bot(B, 'TL'), aBr = bot(A, 'TR'), aBrb = bot(B, 'TR');
        quad(concrete, aT, aTb, aRb, aR);          // top
        quad(concrete, aBl, aBr, aBrb, aBlb);      // bottom
        quad(concrete, aT, aBl, aBlb, aTb);        // left side
        quad(concrete, aR, aRb, aBrb, aBr);        // right side
        if (!tracks) {
          const asph = (c, key) => [c[key][0], LOW_BED_H + ASPHALT_LIFT, c[key][2]];
          quad(asphalt, asph(A, 'aL'), asph(B, 'aL'), asph(B, 'aR'), asph(A, 'aR'));
        } else {
          for (const o of trackOffs) stripFn(pts[i], normals[i], LOW_BED_H, pts[i + 1], normals[i + 1], LOW_BED_H, o);
        }
        continue;
      }
      // Slab box section.
      quad(concrete, A.TL, B.TL, B.TR, A.TR);      // top
      quad(concrete, A.BL, A.BR, B.BR, B.BL);      // bottom
      quad(concrete, A.TL, A.BL, B.BL, B.TL);      // left side
      quad(concrete, A.TR, B.TR, B.BR, A.BR);      // right side
      // Parapets: outer, inner and top strips on both edges.
      // Issue #239: over the kept intervals only — a strip inside
      // another deck's corridor at the same level is the mouth's
      // paved gore, not a fence. Untrimmed strips take the original
      // path byte for byte; trimmed strips interpolate the
      // cross-section corners over each kept interval.
      const emitParapets = (P, Q) => {
        quad(concrete, P.oLt, P.oL, Q.oL, Q.oLt);    // left outer
        quad(concrete, P.iLt, Q.iLt, Q.iL, P.iL);    // left inner
        quad(concrete, P.oLt, Q.oLt, Q.iLt, P.iLt);  // left top
        quad(concrete, P.oRt, Q.oRt, Q.oR, P.oR);    // right outer
        quad(concrete, P.iRt, P.iR, Q.iR, Q.iRt);    // right inner
        quad(concrete, P.iRt, Q.iRt, Q.oRt, P.oRt);  // right top
      };
      const segTrim = trims?.lines[li]?.segments[i];
      const full = (list) => list.length === 1 && list[0][0] === 0 && list[0][1] === 1;
      if (!segTrim || (full(segTrim.left) && full(segTrim.right))) {
        emitParapets(A, B);
      } else {
        const CORNER_KEYS = ['TL', 'TR', 'BL', 'BR', 'oL', 'oLt', 'iL', 'iLt', 'oR', 'oRt', 'iR', 'iRt', 'aL', 'aR'];
        const lerpC = (t) => {
          const o = { h: A.h + (B.h - A.h) * t };
          for (const k of CORNER_KEYS) o[k] = [A[k][0] + (B[k][0] - A[k][0]) * t, A[k][1] + (B[k][1] - A[k][1]) * t, A[k][2] + (B[k][2] - A[k][2]) * t];
          return o;
        };
        const emitSide = (list, leftSide) => {
          for (const [t0, t1] of list) {
            if (!(t1 > t0)) continue;
            const P = lerpC(t0), Q = lerpC(t1);
            if (leftSide) {
              quad(concrete, P.oLt, P.oL, Q.oL, Q.oLt);
              quad(concrete, P.iLt, Q.iLt, Q.iL, P.iL);
              quad(concrete, P.oLt, Q.oLt, Q.iLt, P.iLt);
            } else {
              quad(concrete, P.oRt, Q.oRt, Q.oR, P.oR);
              quad(concrete, P.iRt, P.iR, Q.iR, Q.iRt);
              quad(concrete, P.iRt, Q.iRt, Q.oRt, P.oRt);
            }
          }
        };
        emitSide(segTrim.left, true);
        emitSide(segTrim.right, false);
      }
      // Top ribbon inside the parapets: the asphalt ribbon, or in
      // track mode the ballast strips + rails on the slab top.
      if (!tracks) quad(asphalt, A.aL, B.aL, B.aR, A.aR);
      else for (const o of trackOffs) stripFn(pts[i], normals[i], A.h, pts[i + 1], normals[i + 1], B.h, o);
    }
    // End caps where the line ends in the air (portal ends sit at
    // h ~ 0 and need none; tile-edge ends close the box).
    const cap = (c, flip) => {
      if (c.h < LOW_BED_MAX) return;
      if (flip) quad(concrete, c.TL, c.BL, c.BR, c.TR);
      else quad(concrete, c.TL, c.TR, c.BR, c.BL);
    };
    // Issue #239: a terminal cap inside another deck's corridor at
    // the same level is a wall across the mouth — suppressed.
    const lineTrim = trims?.lines[li];
    if (!lineTrim || lineTrim.capStart) cap(cs[0], false);
    if (!lineTrim || lineTrim.capEnd) cap(cs[cs.length - 1], true);
    // Issue #196: this line's portal clusters emit their trenches
    // (face, retaining walls, floor, trench track strips) once,
    // from the cluster's first member's turn.
    if (tracks && diveData) {
      for (const c of diveData.clusters) if (c.members[0].line === line) emitTrench(c);
    }
  }

  const triCount = (concrete.pos.length + asphalt.pos.length + ballast.pos.length + rails.pos.length + guideway.pos.length + portal.pos.length + portalDark.pos.length) / 9;
  return {
    concrete: { positions: new Float32Array(concrete.pos), normals: new Float32Array(concrete.nor) },
    asphalt: { positions: new Float32Array(asphalt.pos), normals: new Float32Array(asphalt.nor) },
    ballast: { positions: new Float32Array(ballast.pos), normals: new Float32Array(ballast.nor) },
    rails: { positions: new Float32Array(rails.pos), normals: new Float32Array(rails.nor) },
    guideway: { positions: new Float32Array(guideway.pos), normals: new Float32Array(guideway.nor) },
    portal: { positions: new Float32Array(portal.pos), normals: new Float32Array(portal.nor) },
    portalDark: { positions: new Float32Array(portalDark.pos), normals: new Float32Array(portalDark.nor) },
    triCount,
    lineCount: lines.length,
    pierCount: (elevated?.piers || []).length,
  };
}

// Issue #173: ground-contact polygons for the MRT beds — the
// segments whose lower end touches the ground (at-grade stretches
// and the dive ramps' fan-out at the portals). The tree planners'
// exclusion rings gain these so no tree stands on the ballast the
// way one did at the s09 dive in the #169 sweep frame; elevated
// segments keep their under-planting (the formation is above the
// canopy there). Returns point-array polygons like the junction
// module's rings.
export function groundContactPolys(elevated, marginM = MRT_TREE_MARGIN_M) {
  const polys = [];
  // Issue #196: contact is judged on the re-profiled heights — a
  // dive's whole descent (the above-grade ramp foot and the trench
  // below it) is ground the trees must keep off.
  const { eff } = computeDives(elevated?.lines || []);
  for (const line of elevated?.lines || []) {
    const rec = eff.get(line);
    const pts = rec ? rec.pts : ptsOf(line);
    if (pts.length < 2) continue;
    const normals = pointNormals(pts);
    const half = (line.width || 6) / 2 + marginM;
    for (let i = 0; i + 1 < pts.length; i++) {
      const hA = rec ? rec.h[i] : (line.h?.[i] ?? 0), hB = rec ? rec.h[i + 1] : (line.h?.[i + 1] ?? 0);
      if (Math.min(hA, hB) > LOW_BED_MAX) continue;
      const A = pts[i], B = pts[i + 1], nA = normals[i], nB = normals[i + 1];
      polys.push([
        [A[0] + nA[0] * half, A[1] + nA[1] * half],
        [B[0] + nB[0] * half, B[1] + nB[1] * half],
        [B[0] - nB[0] * half, B[1] - nB[1] * half],
        [A[0] - nA[0] * half, A[1] - nA[1] * half],
      ]);
    }
  }
  return polys;
}
