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
export const MRT_TREE_MARGIN_M = 1;    // tree-exclusion margin around ground-contact MRT beds, m

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

// buildDeckGeometry(elevated, opts) -> {
//   concrete: { positions, normals },  // slab + parapets, flat-shaded
//   asphalt:  { positions, normals },  // deck-top ribbon inside parapets
//   ballast:  { positions, normals },  // MRT track strips (opts.tracks)
//   rails:    { positions, normals },  // MRT rail ribbons (opts.tracks)
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

  for (const line of lines) {
    const pts = ptsOf(line);
    if (pts.length < 2) continue;
    const normals = pointNormals(pts);
    const trackOffs = tracks ? (line.tracks?.length ? line.tracks : [0]) : [];
    const half = (line.width || 6) / 2;
    const inner = half - PARAPET_T;
    // Cross-section corners per point: slab TL/TR (top) and BL/BR
    // (bottom, clamped to grade), parapet outer/inner base+top on
    // both edges, and the asphalt ribbon corners.
    const cs = pts.map((p, i) => {
      const h = line.h[i] ?? 0;
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
      if (Math.max(A.h, B.h) < LOW_BED_MAX) {
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
          for (const o of trackOffs) trackStrip(pts[i], normals[i], LOW_BED_H, pts[i + 1], normals[i + 1], LOW_BED_H, o);
        }
        continue;
      }
      // Slab box section.
      quad(concrete, A.TL, B.TL, B.TR, A.TR);      // top
      quad(concrete, A.BL, A.BR, B.BR, B.BL);      // bottom
      quad(concrete, A.TL, A.BL, B.BL, B.TL);      // left side
      quad(concrete, A.TR, B.TR, B.BR, A.BR);      // right side
      // Parapets: outer, inner and top strips on both edges.
      quad(concrete, A.oLt, A.oL, B.oL, B.oLt);    // left outer
      quad(concrete, A.iLt, B.iLt, B.iL, A.iL);    // left inner
      quad(concrete, A.oLt, B.oLt, B.iLt, A.iLt);  // left top
      quad(concrete, A.oRt, B.oRt, B.oR, A.oR);    // right outer
      quad(concrete, A.iRt, A.iR, B.iR, B.iRt);    // right inner
      quad(concrete, A.iRt, B.iRt, B.oRt, A.oRt);  // right top
      // Top ribbon inside the parapets: the asphalt ribbon, or in
      // track mode the ballast strips + rails on the slab top.
      if (!tracks) quad(asphalt, A.aL, B.aL, B.aR, A.aR);
      else for (const o of trackOffs) trackStrip(pts[i], normals[i], A.h, pts[i + 1], normals[i + 1], B.h, o);
    }
    // End caps where the line ends in the air (portal ends sit at
    // h ~ 0 and need none; tile-edge ends close the box).
    const cap = (c, flip) => {
      if (c.h < LOW_BED_MAX) return;
      if (flip) quad(concrete, c.TL, c.BL, c.BR, c.TR);
      else quad(concrete, c.TL, c.TR, c.BR, c.BL);
    };
    cap(cs[0], false);
    cap(cs[cs.length - 1], true);
    // Issue #173: a shaped end at a TRUE dive portal (track mode):
    // the end sits at grade, its neighbour is elevated, and no other
    // line ends at the same spot to continue it at grade. The
    // headwall stands across the formation at the end point, the
    // ballast runs into the dark opening, and wing walls flank the
    // ramp foot, sloping from headwall height down to the formation.
    if (tracks) {
      const maxTrack = Math.max(...trackOffs.map((o) => Math.abs(o)));
      const oHalf = Math.min(half - 0.5, maxTrack + BALLAST_HALF);
      for (const endIdx of [0, pts.length - 1]) {
        const hEnd = line.h?.[endIdx] ?? 0;
        const nIdx = endIdx === 0 ? 1 : pts.length - 2;
        const hNbr = line.h?.[nIdx] ?? 0;
        if (!(hEnd < LOW_BED_MAX && hNbr >= LOW_BED_MAX)) continue;
        const E = pts[endIdx], P = pts[nIdx];
        const joined = lines.some((l2) => {
          if (l2 === line) return false;
          const p2 = ptsOf(l2);
          if (p2.length < 2) return false;
          return [p2[0], p2[p2.length - 1]].some((q) => Math.hypot(q[0] - E[0], q[1] - E[1]) <= PORTAL_JOIN_TOL_M);
        });
        if (joined) continue;
        let tx = E[0] - P[0], tz = E[1] - P[1];
        const tl = Math.hypot(tx, tz) || 1;
        tx /= tl; tz /= tl;
        const nx = -tz, nz = tx;
        const at = (off, y, back = 0) => [E[0] + nx * off - tx * back, y, E[1] + nz * off - tz * back];
        // Headwall: two piers + a lintel around the opening, in the
        // end plane, facing back along the line.
        quad(portal, at(-half, 0), at(-oHalf, 0), at(-oHalf, PORTAL_HEADWALL_H), at(-half, PORTAL_HEADWALL_H));
        quad(portal, at(oHalf, 0), at(half, 0), at(half, PORTAL_HEADWALL_H), at(oHalf, PORTAL_HEADWALL_H));
        quad(portal, at(-oHalf, PORTAL_OPENING_H), at(oHalf, PORTAL_OPENING_H), at(oHalf, PORTAL_HEADWALL_H), at(-oHalf, PORTAL_HEADWALL_H));
        // The dark opening, recessed just behind the face.
        const dk = (off, y) => at(off, y, -0.06);
        quad(portalDark, dk(-oHalf, 0), dk(oHalf, 0), dk(oHalf, PORTAL_OPENING_H), dk(-oHalf, PORTAL_OPENING_H));
        // Wing walls on both flanks (corner order chosen per side
        // so the flat normal points outward).
        const segLen = Math.hypot(P[0] - E[0], P[1] - E[1]);
        const back = Math.min(PORTAL_WING_M, segLen * 0.9);
        const hBack = hEnd + (hNbr - hEnd) * (segLen ? back / segLen : 0);
        const yBack = Math.max(hBack, LOW_BED_H) + 0.5;
        for (const s of [-1, 1]) {
          const fb = at(s * half, 0), bb = at(s * (half + 0.7), 0, back);
          const bt = at(s * (half + 0.7), yBack, back), ft = at(s * half, PORTAL_HEADWALL_H);
          if (s < 0) quad(portal, fb, bb, bt, ft);
          else quad(portal, fb, ft, bt, bb);
        }
      }
    }
  }

  const triCount = (concrete.pos.length + asphalt.pos.length + ballast.pos.length + rails.pos.length + portal.pos.length + portalDark.pos.length) / 9;
  return {
    concrete: { positions: new Float32Array(concrete.pos), normals: new Float32Array(concrete.nor) },
    asphalt: { positions: new Float32Array(asphalt.pos), normals: new Float32Array(asphalt.nor) },
    ballast: { positions: new Float32Array(ballast.pos), normals: new Float32Array(ballast.nor) },
    rails: { positions: new Float32Array(rails.pos), normals: new Float32Array(rails.nor) },
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
  for (const line of elevated?.lines || []) {
    const pts = ptsOf(line);
    if (pts.length < 2) continue;
    const normals = pointNormals(pts);
    const half = (line.width || 6) / 2 + marginM;
    for (let i = 0; i + 1 < pts.length; i++) {
      const hA = line.h?.[i] ?? 0, hB = line.h?.[i + 1] ?? 0;
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
