// js/taipei-bridges.js — signature bridge structures (issue #151):
// pure geometry, the taipei-mrt-stations.js pattern — no three.js
// here, taipei-boot.js wraps the arrays into one mesh, so node tests
// pin the geometry directly.
//
// The crossings' DECKS already render: the OSM bridge ways are in
// geodata.elevatedRoads (named lines — 重陽橋, 社子大橋, 麥帥一橋,
// 大直橋) and the deck system draws them as plain slabs with piers.
// What a plain slab cannot say is WHICH bridge it is. This module
// adds only the signature structure of five crossings, in the deck
// system's idiom (drawn geometry, never driven on, no roadbed or
// junction changes): two cable-stayed tower systems, one inclined
// A-pylon, one tied arch, one S-curve pedestrian arch, one curved
// fishing-rod pylon. Anchors are authored in lat/lon from satellite
// measurement and snapped onto the DRAWN deck centrelines at build
// time, so a signature can never drift off the deck it belongs to.
//
// Facts (measured/researched 2026-10-27, evidence in
// bridges151-evidence/):
//   chongyang 重陽橋 — 3-span twin-tower cable-stayed over the
//     Tamsui River (zh.wikipedia 重陽橋): H-frame RC towers 72 m,
//     symmetric fan, 9 stays per fan in TWO planes, main span 200 m,
//     towers cream/beige (repainted 2017). Tower positions read off
//     Esri World Imagery: both H towers stand IN the river, snapped
//     below onto the drawn 重陽橋 carriageways (satellite spacing
//     209 m vs the cited 200 m span — the towers keep their measured
//     positions, the span follows).
//   shezi 社子大橋 — self-anchored cable-stayed, single inclined
//     pylon at the WEST bank of its Keelung River crossing (CECI
//     Engineering project page, eng.ceci.com.tw/shetze-bridge):
//     ~250 m long, main span 180 m, white steel A-pylon 105 m
//     leaning at 78° (12° off vertical) toward the main span.
//     Pylon position read off satellite, snapped onto the drawn
//     社子大橋 twin carriageways (wayIds 241272979 pair).
//   macarthur 麥帥一橋 (First MacArthur Bridge, zh.wikipedia
//     麥帥橋): double-deck steel tied-arch, main span 170 m, arch
//     rise 30 m from its low springings (crown ≈37 m over the
//     water — height-limited by the Songshan flight path), single
//     central pale-green rib with vertical hangers. The sim draws
//     the two decks side by side at h≈21, so the rib springs from
//     the drawn deck top and rises 16 m to the true crown height.
//   rainbow 彩虹橋 — pedestrian tied-arch over the Keelung River
//     at Raohe (zh.wikipedia 彩虹橋 + Taipei Travel): 167 m total
//     = 17 + 133 + 17 m spans, deck 4.5 m wide at 6.4 m, S-curved
//     in plan, single RED steel rib. NOT in the deck data at all
//     (a footway — no vehicle deck exists), so this module also
//     draws its deck ribbon; digitized from satellite (deck centre
//     trace + landings), rib plan bowed west of the deck at
//     mid-span as the satellite shadow shows.
//   dazhi 大直橋 — fishing-rod (釣竿式) cable-stayed over the
//     Keelung River (zh.wikipedia 大直橋): 823 m, max span 172 m,
//     single WHITE pylon 69.4 m, curved in elevation, leaning north
//     over the main span from its south-bank pier; stays RED,
//     semi-fan, single central plane (Wikimedia photos "Dazhi
//     Bridge East View" + birdview). Pylon base position read off
//     satellite onto the drawn 大直橋 stub (the deck already runs
//     from the airport box edge, z −4985, to grade at −4433); the
//     top's plan offset (≈40 m north of the base at the crown) is
//     photo-derived — both photos agree the tip stands well north
//     of the base over the water.

// WGS84 radii conversion — a mirror of latLonToTile in
// js/taipei-buildings.js (kept local so this module does not pull
// the 2,900-line building planner into the boot graph; the test
// pins the two converters equal on every anchor below).
const FRAME_A = 6378137.0, FRAME_E2 = 6.69437999014e-3;
export function bridgeLatLonToTile(lat, lon, originLatLon) {
  const [lat0, lon0] = originLatLon;
  const phi0 = (lat0 * Math.PI) / 180, sin0 = Math.sin(phi0);
  const nRad = FRAME_A / Math.sqrt(1 - FRAME_E2 * sin0 * sin0);
  const mRad = (FRAME_A * (1 - FRAME_E2)) / Math.pow(1 - FRAME_E2 * sin0 * sin0, 1.5);
  const kx = (Math.PI / 180) * nRad * Math.cos(phi0);
  const ky = (Math.PI / 180) * mRad;
  return [Math.round((lon - lon0) * kx * 10) / 10, Math.round(-(lat - lat0) * ky * 10) / 10];
}

const C = {
  cream: 0xe9e1cb,      // Chongyang towers (2017 beige repaint)
  stayPale: 0xd9d9d6,   // stay cables, light steel
  white: 0xf2f3f0,      // Shezi + Dazhi pylons
  macGreen: 0x9dc3a6,   // MacArthur pale-green steel
  rainbowRed: 0xd63a2c, // Rainbow rib
  rainbowDeck: 0xcbb3ac, // Rainbow deck paving (pink tile field)
  rainbowDark: 0x5a2e28, // Rainbow hangers
  dazhiStay: 0xc22f26,  // Dazhi red stays
  concrete: 0x98958a,   // pier blocks / abutments (deck concrete tone)
};

export const BRIDGE_DEFS = [
  {
    id: 'chongyang', name: '重陽橋', kind: 'hTowers',
    towers: [[25.084882, 121.501532], [25.085213, 121.503569]],
    height: 72,
  },
  {
    id: 'shezi', name: '社子大橋', kind: 'aPylon',
    anchor: [25.110868, 121.495165], height: 105, leanDeg: 12,
  },
  {
    id: 'macarthur', name: '麥帥一橋', kind: 'tiedArch',
    anchor: [25.052, 121.572], span: 170, crownY: 37.3,
  },
  {
    id: 'rainbow', name: '彩虹橋', kind: 'sArch',
    // Deck centre trace, south landing -> north landing, digitized
    // from Esri World Imagery (see header).
    path: [
      [25.051628, 121.576731], [25.051861, 121.576666],
      [25.052104, 121.576645], [25.052372, 121.576677],
      [25.052639, 121.576672], [25.052882, 121.576602],
      [25.053174, 121.576591],
    ],
    deckTop: 6.4, deckW: 4.5, sideSpan: 17, mainSpan: 133, rise: 18,
  },
  {
    id: 'dazhi', name: '大直橋', kind: 'rodPylon',
    anchor: [25.075641, 121.544373], height: 69.4, topOffset: 40,
  },
];

// ---- deck sampling over geodata.elevatedRoads.lines ----
// line: { width, pts: flat [x, z, ...], h: [per-point heights] }
function linePoints(L) {
  const P = [];
  for (let k = 0; k < L.pts.length; k += 2) P.push([L.pts[k], L.pts[k + 1], L.h[k / 2]]);
  return P;
}
// Nearest point on any deck centreline: { p:[x,z], h, az, dist }.
function snapToLines(lines, pt) {
  let best = null;
  for (const L of lines) {
    const P = linePoints(L);
    for (let i = 0; i < P.length - 1; i++) {
      const [ax, az2, ah] = P[i], [bx, bz, bh] = P[i + 1];
      const dx = bx - ax, dz = bz - az2, len2 = dx * dx + dz * dz;
      let t = len2 ? ((pt[0] - ax) * dx + (pt[1] - az2) * dz) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const px = ax + dx * t, pz = az2 + dz * t;
      const d = Math.hypot(pt[0] - px, pt[1] - pz);
      if (!best || d < best.d) best = { p: [px, pz], h: ah + (bh - ah) * t, az: Math.atan2(dx, dz), d };
    }
  }
  return best;
}
// Corridor frame at an anchor: snap, then the cross-section extent
// across every deck line near the snap point (perp offsets relative
// to the centre point, widths included). Returns { c:[x,z], az,
// axis:[x,z], perp:[x,z], mn, mx } with mn/mx relative to c.
function corridorFrame(lines, anchorSim) {
  const s = snapToLines(lines, anchorSim);
  const axis = [Math.sin(s.az), Math.cos(s.az)];
  const perp = [Math.cos(s.az), -Math.sin(s.az)];
  let mn = Infinity, mx = -Infinity;
  for (const L of lines) {
    const P = linePoints(L);
    const w = L.width ?? 7.6;
    for (let i = 0; i < P.length - 1; i++) {
      // Closest point of the SEGMENT to the snap point (vertices
      // are 90-380 m apart on the river crossings — a vertex window
      // would find nothing at all).
      const [ax, az2] = P[i], [bx, bz] = P[i + 1];
      const dx = bx - ax, dz = bz - az2, len2 = dx * dx + dz * dz;
      let t = len2 ? ((s.p[0] - ax) * dx + (s.p[1] - az2) * dz) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const rx = ax + dx * t - s.p[0], rz = az2 + dz * t - s.p[1];
      const along = rx * axis[0] + rz * axis[1];
      const pp = rx * perp[0] + rz * perp[1];
      if (Math.abs(along) <= 10 && Math.abs(pp) <= 70) {
        mn = Math.min(mn, pp - w / 2); mx = Math.max(mx, pp + w / 2);
      }
    }
  }
  const mid = (mn + mx) / 2;
  return { c: [s.p[0] + perp[0] * mid, s.p[1] + perp[1] * mid], az: s.az, axis, perp, mn: mn - mid, mx: mx - mid, snapH: s.h };
}
// Drawn deck-top height near a sim point (the h profile of the
// nearest centreline segment, +0.35 for the deck surface build-up).
// Issue #132: groundAt lifts the sampled deck top by the draped
// ground at the snapped centreline point — stays land on the
// drawn (lifted) decks.
function deckTopNear(lines, pt, groundAt = null) {
  const s = snapToLines(lines, pt);
  const g = groundAt ? groundAt(s ? s.p[0] : pt[0], s ? s.p[1] : pt[1]) : 0;
  return (s ? s.h : 0) + g + 0.35;
}
// Highest deck top within r metres — for the MacArthur springings,
// where the nearest segment can be a ramp diving off the crossing
// while the bridge's own decks pass at full height.
function deckTopHighNear(lines, pt, r = 25, groundAt = null) {
  let best = 0, bestPt = pt;
  for (const L of lines) {
    const P = linePoints(L);
    for (let i = 0; i < P.length - 1; i++) {
      const [ax, az2, ah] = P[i], [bx, bz, bh] = P[i + 1];
      const dx = bx - ax, dz = bz - az2, len2 = dx * dx + dz * dz;
      let t = len2 ? ((pt[0] - ax) * dx + (pt[1] - az2) * dz) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(pt[0] - (ax + dx * t), pt[1] - (az2 + dz * t));
      const h = ah + (bh - ah) * t;
      if (d <= r && h > best) { best = h; bestPt = [ax + dx * t, az2 + dz * t]; }
    }
  }
  return best + (groundAt ? groundAt(bestPt[0], bestPt[1]) : 0) + 0.35;
}

// buildBridgeGeometry(geo) -> { positions, normals, colors,
//   triCount, bridges: [{ id, triCount, maxY, centre, stays }] }
// `stays` lists the deck-anchor point of every stay/hanger (test
// evidence that cables land on drawn decks).
export function buildBridgeGeometry(geo, opts = {}) {
  const pos = [], nor = [], col = [];
  // Issue #132: opts.groundAt lifts each signature bridge rigidly
  // by the draped ground at its centre (measured max 0.06 m on
  // current data — 社子大橋's frames graze the Beitou rect's
  // feather fringe — so this is a no-op to the eye; the threading
  // keeps the bridges glued to their lifted decks if the DEM or
  // the regions ever change). Stay anchors sample the lifted
  // deck tops via deckTopNear/deckTopHighNear above.
  const groundAt = typeof opts.groundAt === 'function' ? opts.groundAt : () => 0;
  const rgb = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
  const quad = (a, b, c, d, hex) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz) || 1;
    nx /= L; ny /= L; nz /= L;
    const [r, g, bl] = rgb(hex);
    for (const p of [a, b, c, a, c, d]) { pos.push(p[0], p[1], p[2]); nor.push(nx, ny, nz); col.push(r, g, bl); }
  };
  // Box between two 3D points: cross-section w (horizontal side)
  // x d, centred on the p0->p1 axis.
  const beam = (p0, p1, w, d, hex) => {
    let ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const L = Math.hypot(ux, uy, uz) || 1; ux /= L; uy /= L; uz /= L;
    let sx = -uz, sz = ux, sy = 0; // horizontal side = up x axis
    if (Math.hypot(sx, sz) < 1e-4) { sx = 1; sz = 0; }
    const sl = Math.hypot(sx, sz); sx /= sl; sz /= sl;
    const tx = uy * sz - uz * sy, ty = uz * sx - ux * sz, tz = ux * sy - uy * sx;
    const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2, mz = (p0[2] + p1[2]) / 2;
    const cn = [];
    for (const [su, tu, lu] of [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1], [-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]]) {
      cn.push([
        mx + sx * su * w / 2 + tx * tu * d / 2 + ux * lu * L / 2,
        my + sy * su * w / 2 + ty * tu * d / 2 + uy * lu * L / 2,
        mz + sz * su * w / 2 + tz * tu * d / 2 + uz * lu * L / 2,
      ]);
    }
    const F = [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [2, 6, 7, 3], [0, 3, 7, 4], [1, 5, 6, 2]];
    for (const [a, b, c, dd] of F) quad(cn[a], cn[b], cn[c], cn[dd], hex);
  };
  // Frame-space box: centre at frame point + axis*along + perp*ac,
  // sizes (along, across), y0..y1. Issue #132: y values ride the
  // per-bridge lift (bridgeLift, set per def below).
  const fbox = (F, along, ac, sizeAlong, sizeAcross, y0, y1, hex) => {
    const cx = F.c[0] + F.axis[0] * along + F.perp[0] * ac;
    const cz = F.c[1] + F.axis[1] * along + F.perp[1] * ac;
    const P = (a, y, b) => [cx + F.axis[0] * a + F.perp[0] * b, y + bridgeLift, cz + F.axis[1] * a + F.perp[1] * b];
    const ha = sizeAlong / 2, hx = sizeAcross / 2;
    const c000 = P(-ha, y0, -hx), c100 = P(-ha, y0, hx), c110 = P(ha, y0, hx), c010 = P(ha, y0, -hx);
    const c001 = P(-ha, y1, -hx), c101 = P(-ha, y1, hx), c111 = P(ha, y1, hx), c011 = P(ha, y1, -hx);
    quad(c000, c100, c110, c010, hex);
    quad(c001, c011, c111, c101, hex);
    quad(c000, c001, c101, c100, hex);
    quad(c010, c110, c111, c011, hex);
    quad(c000, c010, c011, c001, hex);
    quad(c100, c101, c111, c110, hex);
  };
  const fpoint = (F, along, y, ac) => [
    F.c[0] + F.axis[0] * along + F.perp[0] * ac, y + bridgeLift,
    F.c[1] + F.axis[1] * along + F.perp[1] * ac,
  ];
  // Lift-free twin of fpoint for deck-derived heights (the tied
  // arch's rib/hangers): those y values already carry the lifted
  // deck tops, so the bridge lift must not apply a second time.
  const fpointRaw = (F, along, y, ac) => [
    F.c[0] + F.axis[0] * along + F.perp[0] * ac, y,
    F.c[1] + F.axis[1] * along + F.perp[1] * ac,
  ];
  // Issue #132: the current def's rigid lift, set from the draped
  // ground at its centre before its emission (0 for all five
  // bridges on current data).
  let bridgeLift = 0;

  const lines = geo?.elevatedRoads?.lines || [];
  const O = geo?.frame?.originLatLon || [25.033, 121.565];
  const bridges = [];

  for (const def of BRIDGE_DEFS) {
    const tri0 = pos.length / 9;
    const stays = [];
    let maxY = 0, centre = null;
    const note = (p, y) => { if (y > maxY) maxY = y; };

    if (def.kind === 'hTowers') {
      // Corridor frames at both towers; the midspan direction of
      // tower i points at tower 1-i.
      const frames = def.towers.map((t) => corridorFrame(lines, bridgeLatLonToTile(t[0], t[1], O)));
      // Issue #132: the twin towers share one lift at their midpoint.
      centre = [(frames[0].c[0] + frames[1].c[0]) / 2, (frames[0].c[1] + frames[1].c[1]) / 2];
      bridgeLift = groundAt(centre[0], centre[1]);
      frames.forEach((F, i) => {
        const other = frames[1 - i];
        const midSign = Math.sign((other.c[0] - F.c[0]) * F.axis[0] + (other.c[1] - F.c[1]) * F.axis[1]) || 1;
        const towerDist = Math.hypot(other.c[0] - F.c[0], other.c[1] - F.c[1]);
        // Legs stand just OUTSIDE the drawn deck edges (photo: the
        // deck passes between the legs); stays angle slightly
        // inward from the leg faces to the deck edges.
        const legL = F.mn - 1.7, legR = F.mx + 1.7;
        for (const lp of [legL, legR]) {
          fbox(F, 0, lp, 3.4, 3.0, 0, def.height, C.cream); note(null, def.height);
          fbox(F, 0, lp, 6.0, 5.4, 0, 2.5, C.concrete); // pier block in the river
        }
        // One high crossbeam (the 重陽大橋 name beam in photos).
        fbox(F, 0, (legL + legR) / 2, 3.0, legR - legL, 43, 47.5, C.cream);
        // Semi-fan stays, two planes at the deck edges.
        const planes = [F.mn + 0.9, F.mx - 0.9];
        const legAt = (pl) => (pl < 0 ? legL : legR);
        const dirs = [
          { sign: midSign, dists: [14, 25, 36, 47, 58, 69, 80, 91, 102].filter((d) => d < towerDist - 12) },
          { sign: -midSign, dists: [14, 26, 38, 50, 62, 74, 86, 98, 110] },
        ];
        for (const pl of planes) {
          for (const dir of dirs) {
            dir.dists.forEach((d, k) => {
              const ty = 47 + (k / (dir.dists.length - 1)) * 22;
              const top = fpoint(F, 0, ty, legAt(pl));
              const ap = fpoint(F, dir.sign * d, 0, pl);
              const ay = deckTopNear(lines, [ap[0], ap[2]], groundAt);
              beam(top, [ap[0], ay + 0.15, ap[2]], 0.32, 0.32, C.stayPale);
              stays.push([ap[0], ay + 0.15, ap[2]]);
            });
          }
        }
        if (!centre) centre = [(frames[0].c[0] + frames[1].c[0]) / 2, (frames[0].c[1] + frames[1].c[1]) / 2];
      });
    } else if (def.kind === 'aPylon') {
      let F = corridorFrame(lines, bridgeLatLonToTile(def.anchor[0], def.anchor[1], O));
      // +axis must point at the main span: the bridge runs WNW->ESE
      // and the 180 m main span reaches EAST from the pylon.
      if (F.axis[0] < 0) { F = { ...F, axis: [-F.axis[0], -F.axis[1]], perp: [-F.perp[0], -F.perp[1]], mn: -F.mx, mx: -F.mn }; }
      centre = F.c;
      bridgeLift = groundAt(centre[0], centre[1]);
      const half = Math.max(Math.abs(F.mn), Math.abs(F.mx));
      const lean = Math.tan((def.leanDeg * Math.PI) / 180);
      // Leg centreline: converges across, leans along; the cap
      // (y 78..105) keeps converging to a near-single neck.
      const legPt = (side, y) => {
        const t = Math.min(y / 78, 1);
        const ac = side * (11.5 + (1.6 - 11.5) * t) * (y > 78 ? Math.max(0.35, 1 - (y - 78) / 60) : 1);
        return fpoint(F, lean * y, y, ac);
      };
      for (const side of [1, -1]) {
        let prev = legPt(side, 0);
        const steps = [0, 13, 26, 39, 52, 65, 78, 87, 96, 105];
        for (let k = 1; k < steps.length; k++) {
          const p = legPt(side, steps[k]);
          const w = 3.4 - (steps[k] / 105) * 1.3;
          beam(prev, p, w, w * 0.8, C.white);
          prev = p;
        }
        fbox(F, lean * 1.2, side * 11.5, 6.4, 5.6, 0, 2.5, C.concrete);
      }
      note(null, def.height);
      // Tie beam between the legs (visible in photos at ~1/4 height).
      const t0 = legPt(-1, 25.5), t1 = legPt(1, 25.5);
      beam(t0, t1, 2.2, 2.6, C.white);
      // Stays: two planes riding the legs' faces.
      const fan = (dists, yLo, yHi, sign) => {
        dists.forEach((d, k) => {
          const ty = yLo + (k / (dists.length - 1)) * (yHi - yLo);
          for (const side of [1, -1]) {
            const top = legPt(side, ty);
            const ap = fpoint(F, sign * d, 0, side * (half - 0.5));
            const ay = deckTopNear(lines, [ap[0], ap[2]], groundAt);
            beam(top, [ap[0], ay + 0.15, ap[2]], 0.3, 0.3, C.stayPale);
            stays.push([ap[0], ay + 0.15, ap[2]]);
          }
        });
      };
      fan([20, 40, 60, 80, 100, 120, 140, 160, 178], 58, 96, 1); // main span
      fan([14, 26, 38, 50, 62], 88, 98, -1);                      // self-anchored back stays
    } else if (def.kind === 'tiedArch') {
      const F = corridorFrame(lines, bridgeLatLonToTile(def.anchor[0], def.anchor[1], O));
      centre = F.c;
      bridgeLift = groundAt(centre[0], centre[1]);
      const mid = (F.mn + F.mx) / 2;
      const hs = def.span / 2;
      // The rib springs from the DRAWN deck top at each end (the
      // two springings sit at slightly different drawn heights);
      // the rise is set so the crown hits the true crown height.
      const spA = fpoint(F, -hs, 0, mid), spB = fpoint(F, hs, 0, mid);
      const dtA = deckTopHighNear(lines, [spA[0], spA[2]], 25, groundAt);
      const dtB = deckTopHighNear(lines, [spB[0], spB[2]], 25, groundAt);
      const baseY = (s) => (dtA + (dtB - dtA) * ((s + hs) / def.span)) - 0.6;
      // Issue #132: the crown rides the bridge lift with the rest
      // of the arch (bridgeLift is 0 at the river centre on
      // current data, so the pinned crown height is unchanged).
      const rise = def.crownY + bridgeLift - baseY(0);
      const ribY = (s) => baseY(s) + rise * (1 - (s / hs) * (s / hs));
      let prev = fpointRaw(F, -hs, ribY(-hs), mid);
      const N = 16;
      for (let i = 1; i <= N; i++) {
        const s = -hs + (i * def.span) / N;
        const p = fpointRaw(F, s, ribY(s), mid);
        beam(prev, p, 1.7, 2.3, C.macGreen);
        prev = p;
      }
      note(null, def.crownY);
      for (let s = -78; s <= 78; s += 12) {
        const top = fpointRaw(F, s, ribY(s) - 0.9, mid);
        const hp = fpointRaw(F, s, 0, mid);
        const bot = fpointRaw(F, s, deckTopHighNear(lines, [hp[0], hp[2]], 25, groundAt) + 0.1, mid);
        beam(top, bot, 0.3, 0.3, C.macGreen);
        stays.push(bot);
      }
    } else if (def.kind === 'sArch') {
      const path = def.path.map(([la, lo]) => bridgeLatLonToTile(la, lo, O));
      centre = path[Math.floor(path.length / 2)];
      bridgeLift = groundAt(centre[0], centre[1]);
      const chain = [0];
      for (let i = 1; i < path.length; i++) chain.push(chain[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
      const total = chain[chain.length - 1];
      const at = (d) => { // point + azimuth at chainage d
        let i = 1; while (i < chain.length - 1 && chain[i] < d) i++;
        const t = (d - chain[i - 1]) / Math.max(chain[i] - chain[i - 1], 1e-6);
        const p = [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t];
        const az = Math.atan2(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
        return { p, az };
      };
      // Deck ribbon + parapets. Issue #132: the rainbow deck is
      // the bridge's own structure — it rides bridgeLift.
      const deckMidY = def.deckTop - 0.45 + bridgeLift;
      for (let i = 0; i < path.length - 1; i++) {
        beam([path[i][0], deckMidY, path[i][1]], [path[i + 1][0], deckMidY, path[i + 1][1]], def.deckW, 0.9, C.rainbowDeck);
        for (const sd of [1, -1]) {
          const off = (pt, az) => [pt[0] + Math.cos(az) * sd * (def.deckW / 2 - 0.12), pt[1] - Math.sin(az) * sd * (def.deckW / 2 - 0.12)];
          const az0 = Math.atan2(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
          const a = off(path[i], az0), b = off(path[i + 1], az0);
          beam([a[0], def.deckTop + 0.5 + bridgeLift, a[1]], [b[0], def.deckTop + 0.5 + bridgeLift, b[1]], 0.16, 1.0, C.rainbowDark);
        }
      }
      note(null, def.deckTop);
      // Rib: springs at sideSpan from each end, plan bowed WEST
      // (sim -x) of the deck by a half-sine, max 4.2 m at mid-span.
      const s0 = def.sideSpan, s1 = total - def.sideSpan;
      const ribPt = (d) => {
        const { p } = at(d);
        const u = (d - s0) / (s1 - s0);
        const bow = -4.2 * Math.sin(Math.PI * u);
        const y = 3.4 + (def.deckTop + def.rise - 3.4) * (1 - Math.pow(2 * u - 1, 2)) + bridgeLift;
        return [p[0] + bow, y, p[1]];
      };
      let prev = ribPt(s0);
      const M = 18;
      for (let i = 1; i <= M; i++) {
        const p = ribPt(s0 + ((s1 - s0) * i) / M);
        beam(prev, p, 1.15, 1.5, C.rainbowRed);
        prev = p;
      }
      note(null, def.deckTop + def.rise);
      for (let d = s0 + 11; d < s1 - 4; d += 11) {
        const rp = ribPt(d);
        if (rp[1] < def.deckTop + 1.2 + bridgeLift) continue;
        const { p } = at(d);
        beam([rp[0], rp[1] - 0.6, rp[2]], [p[0], def.deckTop + 0.05 + bridgeLift, p[1]], 0.16, 0.16, C.rainbowDark);
        stays.push([p[0], def.deckTop + 0.05 + bridgeLift, p[1]]);
      }
      // Abutment blocks at the springings + side-span piers.
      for (const d of [s0, s1]) {
        const { p, az } = at(d);
        const F = { c: p, axis: [Math.sin(az), Math.cos(az)], perp: [Math.cos(az), -Math.sin(az)], mn: -2, mx: 2 };
        fbox(F, 0, 0, 5.5, 3.2, 0, 3.6, C.concrete);
      }
      for (const d of [s0 / 2, total - s0 / 2]) {
        const { p, az } = at(d);
        const F = { c: p, axis: [Math.sin(az), Math.cos(az)], perp: [Math.cos(az), -Math.sin(az)], mn: -2, mx: 2 };
        fbox(F, 0, 0, 2.2, 2.6, 0, def.deckTop - 0.9, C.concrete);
      }
    } else if (def.kind === 'rodPylon') {
      let F = corridorFrame(lines, bridgeLatLonToTile(def.anchor[0], def.anchor[1], O));
      // +axis toward the main span = north across the river.
      if (F.axis[1] > 0) { F = { ...F, axis: [-F.axis[0], -F.axis[1]], perp: [-F.perp[0], -F.perp[1]], mn: -F.mx, mx: -F.mn }; }
      centre = F.c;
      bridgeLift = groundAt(centre[0], centre[1]);
      const mid = (F.mn + F.mx) / 2;
      const H = def.height;
      const colPt = (y) => fpoint(F, def.topOffset * Math.pow(y / H, 1.8), y, mid);
      let prev = colPt(0);
      const steps = 10;
      for (let k = 1; k <= steps; k++) {
        const y = (H * k) / steps;
        const p = colPt(y);
        const w = 3.6 - (y / H) * 1.5;
        beam(prev, p, w, w * 0.78, C.white);
        prev = p;
      }
      note(null, H);
      fbox(F, 0, mid, 7.0, 5.2, 0, 3.5, C.concrete); // south-bank pier block
      // Red semi-fan, single central plane.
      const fan1 = (dists, yLo, yHi, sign) => {
        dists.forEach((d, k) => {
          const ty = yLo + (k / (dists.length - 1)) * (yHi - yLo);
          const top = colPt(ty);
          const ap = fpoint(F, sign * d, 0, mid);
          const ay = deckTopNear(lines, [ap[0], ap[2]], groundAt);
          beam(top, [ap[0], ay + 0.15, ap[2]], 0.3, 0.3, C.dazhiStay);
          stays.push([ap[0], ay + 0.15, ap[2]]);
        });
      };
      fan1([24, 44, 64, 84, 104, 124, 144, 164], 34, 63.5, 1);
      fan1([20, 40, 60, 78], 60, 67, -1);
    }

    bridges.push({ id: def.id, triCount: pos.length / 9 - tri0, maxY: maxY + bridgeLift, centre, stays });
  }

  return {
    positions: new Float32Array(pos), normals: new Float32Array(nor), colors: new Float32Array(col),
    triCount: pos.length / 9, bridges,
  };
}
