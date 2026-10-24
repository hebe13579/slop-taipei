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

// buildDeckGeometry(elevated) -> {
//   concrete: { positions, normals },  // slab + parapets, flat-shaded
//   asphalt:  { positions, normals },  // deck-top ribbon inside parapets
//   triCount, lineCount, pierCount,
// }
// Positions are non-indexed triangles (6 vertices per quad face) in
// world metres, y-up; normals are per-face (flat shading).
export function buildDeckGeometry(elevated) {
  const depth = elevated?.deckDepth ?? 1.8;
  const lines = elevated?.lines || [];
  const concrete = { pos: [], nor: [] };
  const asphalt = { pos: [], nor: [] };
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

  for (const line of lines) {
    const pts = ptsOf(line);
    if (pts.length < 2) continue;
    const normals = pointNormals(pts);
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
        const asph = (c, key) => [c[key][0], LOW_BED_H + ASPHALT_LIFT, c[key][2]];
        quad(asphalt, asph(A, 'aL'), asph(B, 'aL'), asph(B, 'aR'), asph(A, 'aR'));
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
      // Asphalt ribbon on the slab top, inside the parapets.
      quad(asphalt, A.aL, B.aL, B.aR, A.aR);
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
  }

  const triCount = (concrete.pos.length + asphalt.pos.length) / 9;
  return {
    concrete: { positions: new Float32Array(concrete.pos), normals: new Float32Array(concrete.nor) },
    asphalt: { positions: new Float32Array(asphalt.pos), normals: new Float32Array(asphalt.nor) },
    triCount,
    lineCount: lines.length,
    pierCount: (elevated?.piers || []).length,
  };
}
