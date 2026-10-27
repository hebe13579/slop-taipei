// Airfield paint for Songshan Airport (issue #135): runway
// markings, taxiway centrelines/edge lines, stand lead-ins and
// the terminal car-park pads, as flat paint geometry in the
// road-markings idiom (see js/taipei-markings.js /
// js/taipei-painted.js) — pure geometry, no three.js, so the
// node suite can audit it. Boot draws the lists with
// quadsGeometry just above the #134 airfield surfaces.
//
// The paint source geometry is geodata.airfield.paint, emitted
// by tools/taipei/build-taipei-geodata.mjs from the SAME
// clipped centrelines and per-vertex half widths the pavement
// surfaces are buffered from, so the paint registers on the
// drawn pavement by construction. Nothing here adds roadbeds,
// junctions, signals or lots: it is a surface layer on the
// #134 site, and the planner never sees it.
//
// Simplifications, stated plainly (airfield scale, read from a
// normal flight altitude):
// - Runway designators are block glyphs on a 3×5 cell grid
//   (13 m tall), not the ICAO outline font.
// - Touchdown-zone bar pairs are omitted; threshold piano
//   keys, designators, centreline dashes, edge lines and the
//   aiming-point bars are painted.
// - Taxiway edge double-lines run the full length of the
//   wider taxiways instead of breaking at every junction.
// - The drawn runway surface (#134) ends in a narrow nose
//   where its buffer's end half width collapses, so the
//   threshold markings are inset 14 m from the centreline
//   ends, onto full-width pavement.

import { PORTAL_HEADWALL_H, PORTAL_OPENING_H, PORTAL_WING_M } from './taipei-viaduct.js';

// Terminal car parks, measured on the satellite stitch in
// twin-evidence/ (Esri World Imagery, 2026-10): the open-air
// lots between the terminal frontage and the service roads
// south of it — a main lot and a smaller east lot in front of
// T1, one west lot in front of T2. Tile-frame rects, fitted
// around the drawn service-road ribbons (the taxi queue road
// at z ≈ -3368..-3362 and the 敦化北路 link at x ≈ -1439..
// -1429). Modelled as asphalt pads + bay paint; the airport's
// parking is open-air (no multi-storey structure is visible).
export const AIRPORT_PARKING_PADS = [
  { x0: -1330, z0: -3358, x1: -1175, z1: -3290 }, // main lot
  { x0: -1160, z0: -3358, x1: -1100, z1: -3290 }, // east lot
  { x0: -1425, z0: -3358, x1: -1340, z1: -3298 }, // west lot
];

const pairs = (flat) => {
  const pts = [];
  for (let i = 0; i + 1 < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
  return pts;
};

// Corner order matters: quadsGeometry builds triangles
// (0,1,2)(0,2,3) and the boot materials are single-sided, so
// the corners must wind to face UP — with v = rot90(u) as
// everywhere in the markings code, that means the +v edge is
// emitted first and the -v edge returns (the stop-line order
// in js/taipei-markings.js). tests/taipei-airfield.test.mjs
// pins the up-facing invariant for every emitted quad.
const quad = (out, cx, cz, ux, uz, vx, vz, hu, hv) => {
  out.push([
    cx - ux * hu + vx * hv, cz - uz * hu + vz * hv,
    cx + ux * hu + vx * hv, cz + uz * hu + vz * hv,
    cx + ux * hu - vx * hv, cz + uz * hu - vz * hv,
    cx - ux * hu - vx * hv, cz - uz * hu - vz * hv,
  ]);
};

// Per-segment strip quads along a polyline, laterally offset
// by `offset` (centre of the strip) with half width `half`.
// Butt joints: at airfield line widths (0.15-0.9 m) the wedge
// gaps at polyline vertices are centimetres.
function strip(out, pts, offset, half) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    if (len < 0.01) continue;
    const ux = dx / len, uz = dz / len, vx = -uz, vz = ux;
    const mx = (ax + bx) / 2 + vx * offset, mz = (az + bz) / 2 + vz * offset;
    quad(out, mx, mz, ux, uz, vx, vz, len / 2, half);
  }
}

// The sub-polyline between arc lengths s0..s1 along pts.
function subline(pts, cum, s0, s1) {
  const out = [];
  const at = (s) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      if (s <= cum[i + 1] || i === pts.length - 2) {
        const segLen = cum[i + 1] - cum[i] || 1;
        const f = Math.min(1, Math.max(0, (s - cum[i]) / segLen));
        return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f];
      }
    }
    return pts[pts.length - 1];
  };
  out.push(at(s0));
  for (let i = 1; i < pts.length - 1; i++) if (cum[i] > s0 && cum[i] < s1) out.push(pts[i]);
  out.push(at(s1));
  return out;
}

const cumLengths = (pts) => {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return cum;
};

// 3×5 block glyphs, rows top to bottom. The only designators
// Songshan needs: runway 10/28.
const GLYPHS = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '8': ['111', '101', '111', '101', '111'],
};

// One threshold's marking set in its own frame: O = threshold
// point (on the centreline), u = unit vector INTO the runway,
// v = pilot's left-to-right axis when approaching along u.
// Distances along u are measured from O.
function thresholdMarkings(out, O, u, text) {
  const v = [-u[1], u[0]];
  const at = (s, t) => [O[0] + u[0] * s + v[0] * t, O[1] + u[1] * s + v[1] * t];
  // Piano keys: 12 stripes 1.8 m wide × 30 m long (the ICAO
  // count for a 60 m runway), starting 6 m inside.
  for (let i = 0; i < 12; i++) {
    const t = -25.65 + 0.9 + i * 4.5;
    const [cx, cz] = at(21, t);
    quad(out, cx, cz, u[0], u[1], v[0], v[1], 15, 0.9);
  }
  // Designator glyphs: cell 2.6 m, digit 7.8 × 13 m, the
  // pair centred on the centreline, tops pointing into the
  // runway (away from the approaching pilot, so they read
  // upright on approach). Top row at s = 64.5.
  const cell = 2.6;
  const centres = [-5.2, 5.2];
  for (let d = 0; d < 2; d++) {
    const glyph = GLYPHS[text[d]];
    if (!glyph) continue;
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
      if (glyph[r][c] !== '1') continue;
      const s = 64.5 - r * cell - cell / 2;
      const t = centres[d] + (c - 1) * cell;
      const [cx, cz] = at(s, t);
      quad(out, cx, cz, u[0], u[1], v[0], v[1], cell / 2, cell / 2);
    }
  }
  // Aiming-point bars: two 45 × 4.5 m bars centred 400 m in
  // (the ICAO distance for a runway of this length).
  for (const t of [-10.75, 10.75]) {
    const [cx, cz] = at(400, t);
    quad(out, cx, cz, u[0], u[1], v[0], v[1], 22.5, 2.25);
  }
}

function runwayPaint(paint, white) {
  const rw = paint.runway && paint.runway[0];
  if (!rw) return { length: 0 };
  const pts = pairs(rw.pts);
  const cum = cumLengths(pts);
  const L = cum[cum.length - 1];
  const inset = 14;
  // Threshold frames: pts run east -> west, so the east end
  // (threshold 28) sits at s = inset facing along the
  // polyline, the west end (threshold 10) at s = L - inset
  // facing back.
  const frameAt = (s) => {
    let i = 0;
    while (i < pts.length - 2 && cum[i + 1] < s) i++;
    const p = subline(pts, cum, s, s + 0.01)[0];
    let ux = pts[i + 1][0] - pts[i][0], uz = pts[i + 1][1] - pts[i][1];
    const m = Math.hypot(ux, uz) || 1;
    return { p, u: [ux / m, uz / m] };
  };
  const east = frameAt(inset);
  thresholdMarkings(white, east.p, east.u, '28');
  const west = frameAt(L - inset);
  thresholdMarkings(white, west.p, [-west.u[0], -west.u[1]], '10');
  // Edge lines: continuous strips at ±29.1 m between the
  // insets (the pavement is 60 m wide: half 30, line half
  // 0.45 centred 0.9 in from the edge).
  const body = subline(pts, cum, inset, L - inset);
  strip(white, body, 29.1, 0.45);
  strip(white, body, -29.1, 0.45);
  // Centreline: 36 m dashes / 24 m gaps, clear of both
  // threshold + designator zones.
  for (let s = inset + 88; s + 36 <= L - inset - 88; s += 60) {
    strip(white, subline(pts, cum, s, s + 36), 0, 0.45);
  }
  return { length: L };
}

function taxiwayPaint(paint, yellowCentre, yellowEdge) {
  let centreM = 0, edgeSegs = 0;
  for (const tw of paint.taxiways || []) {
    const pts = pairs(tw.pts);
    strip(yellowCentre, pts, 0, 0.15);
    centreM += cumLengths(pts).pop() || 0;
    // Edge double lines on the wider taxiways: two 0.15 m
    // lines in the outer 0.45 m of each side, following the
    // same per-vertex half widths the surface was buffered
    // with (min of the segment's endpoint halfs).
    for (let i = 0; i + 1 < pts.length; i++) {
      const segLen = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      const half = Math.min(tw.half[i] || 0, tw.half[i + 1] || 0);
      if (half < 8 || segLen < 25) continue;
      const seg = [pts[i], pts[i + 1]];
      strip(yellowEdge, seg, half - 0.375, 0.075);
      strip(yellowEdge, seg, half - 0.075, 0.075);
      strip(yellowEdge, seg, -(half - 0.375), 0.075);
      strip(yellowEdge, seg, -(half - 0.075), 0.075);
      edgeSegs++;
    }
  }
  return { centreM, edgeSegs };
}

function standPaint(paint, yellowCentre) {
  let leadM = 0;
  for (const st of paint.stands || []) {
    const pts = pairs(st);
    if (pts.length < 2) continue;
    strip(yellowCentre, pts, 0, 0.15);
    leadM += cumLengths(pts).pop() || 0;
    // Stop bar across the end of the lead-in line.
    const [ax, az] = pts[pts.length - 2], [bx, bz] = pts[pts.length - 1];
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1;
    const ux = dx / len, uz = dz / len;
    quad(yellowCentre, bx, bz, ux, uz, -uz, ux, 0.15, 1.5);
  }
  return { count: (paint.stands || []).length, leadM };
}

// Parking-bay paint on the pads: stall lines 5 m deep along
// both long edges at a 2.6 m pitch, plus a back-to-back
// double row mid-pad on the deeper pads.
function padPaint(pads, white) {
  for (const p of pads) {
    const stalls = (zLine, inward) => {
      // Up-facing winding (u = +x): the larger-z edge first.
      const zA = Math.max(zLine, zLine + inward * 5), zB = Math.min(zLine, zLine + inward * 5);
      for (let x = p.x0 + 1.3; x + 1.3 <= p.x1; x += 2.6) {
        white.push([x - 0.06, zA, x + 0.06, zA, x + 0.06, zB, x - 0.06, zB]);
      }
    };
    stalls(p.z0, 1);
    stalls(p.z1, -1);
    if (p.z1 - p.z0 > 55) {
      const mid = (p.z0 + p.z1) / 2;
      stalls(mid, 1);
      stalls(mid, -1);
      // The double row's spine line.
      white.push([p.x0 + 0.5, mid + 0.075, p.x1 - 0.5, mid + 0.075, p.x1 - 0.5, mid - 0.075, p.x0 + 0.5, mid - 0.075]);
    }
  }
}

// ---------------------------------------------------------------------
// Road tunnel portals (issue #183): the mouths where a suppressed
// airfield tunnel bed （復北地下道） dives under the field. The
// generation map (rework v5) emits airfield.roadTunnels with one
// mouth record per site-boundary crossing: { x, z, tx, tz } with
// (tx, tz) the unit direction INTO the tunnel, plus the bed width.
// The form is the MRT dive-portal form from js/taipei-viaduct.js
// (#173) — same headwall/opening/wing dimensions, one mechanism —
// widened to the road's twin-bore section: two dark openings split
// by a centre pier (the real underpass is two bores), concrete
// jambs + lintel across the full bed width, and wing walls flanking
// the surface apron back along the approach. Pure geometry in the
// buildDeckGeometry sink format ({ positions, normals } triangle
// soup), so the node suite audits it and the boot wraps it with
// deckPartGeometry exactly like the MRT portals.
export const ROAD_PORTAL_JAMB_M = 0.6;   // concrete at each side of the twin bores
export const ROAD_PORTAL_PIER_M = 0.55;  // half width of the centre pier between bores

export function buildRoadTunnelPortals(airfield) {
  const concrete = { pos: [], nor: [] };
  const dark = { pos: [], nor: [] };
  // One quad (corners in boundary order) as two flat-shaded
  // triangles — the buildDeckGeometry construction verbatim.
  const quad3 = (sink, a, b, c, d) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz) || 1;
    nx /= L; ny /= L; nz /= L;
    for (const p of [a, b, c, a, c, d]) { sink.pos.push(p[0], p[1], p[2]); sink.nor.push(nx, ny, nz); }
  };
  let mouths = 0;
  for (const t of (airfield && airfield.roadTunnels) || []) {
    const half = Math.max((t.width || 0) / 2, 1);
    const oHalf = half - ROAD_PORTAL_JAMB_M;
    for (const m of t.mouths || []) {
      mouths++;
      // Frame: u points OUT of the tunnel (against the mouth's
      // into-tunnel direction), n is its left normal. The
      // taipei-viaduct portal frame points INTO its dive, so the
      // headwall and bore quads below wind b<->d against that
      // code's orders — their faces point OUT of the tunnel,
      // toward the approaching driver (the wing walls keep the
      // viaduct orders; their outward faces are the ±n sides).
      const ux = -m.tx, uz = -m.tz;
      const nx = -uz, nz = ux;
      const at = (off, y, out = 0) => [m.x + nx * off + ux * out, y, m.z + nz * off + uz * out];
      // Headwall: side jambs, centre pier, lintel.
      quad3(concrete, at(-half, 0), at(-half, PORTAL_HEADWALL_H), at(-oHalf, PORTAL_HEADWALL_H), at(-oHalf, 0));
      quad3(concrete, at(oHalf, 0), at(oHalf, PORTAL_HEADWALL_H), at(half, PORTAL_HEADWALL_H), at(half, 0));
      quad3(concrete, at(-ROAD_PORTAL_PIER_M, 0), at(-ROAD_PORTAL_PIER_M, PORTAL_OPENING_H), at(ROAD_PORTAL_PIER_M, PORTAL_OPENING_H), at(ROAD_PORTAL_PIER_M, 0));
      quad3(concrete, at(-oHalf, PORTAL_OPENING_H), at(-oHalf, PORTAL_HEADWALL_H), at(oHalf, PORTAL_HEADWALL_H), at(oHalf, PORTAL_OPENING_H));
      // The two dark bores, recessed just behind the face.
      const dk = (off, y) => at(off, y, -0.06);
      quad3(dark, dk(-oHalf, 0), dk(-oHalf, PORTAL_OPENING_H), dk(-ROAD_PORTAL_PIER_M, PORTAL_OPENING_H), dk(-ROAD_PORTAL_PIER_M, 0));
      quad3(dark, dk(ROAD_PORTAL_PIER_M, 0), dk(ROAD_PORTAL_PIER_M, PORTAL_OPENING_H), dk(oHalf, PORTAL_OPENING_H), dk(oHalf, 0));
      // Wing walls flanking the approach apron, sloping from
      // headwall height down to 0.6 m at PORTAL_WING_M out.
      for (const s of [-1, 1]) {
        const fb = at(s * (half + 0.35), 0, 0), bb = at(s * (half + 0.35), 0, PORTAL_WING_M);
        const bt = at(s * (half + 0.35), 0.6, PORTAL_WING_M), ft = at(s * (half + 0.35), PORTAL_HEADWALL_H, 0);
        if (s < 0) quad3(concrete, fb, ft, bt, bb);
        else quad3(concrete, fb, bb, bt, ft);
      }
    }
  }
  const quads = mouths * 8;
  return {
    concrete: { positions: new Float32Array(concrete.pos), normals: new Float32Array(concrete.nor) },
    dark: { positions: new Float32Array(dark.pos), normals: new Float32Array(dark.nor) },
    stats: { tunnels: ((airfield && airfield.roadTunnels) || []).length, mouths, quads, triangles: quads * 2 },
  };
}

export function buildAirfieldPaint(airfield) {
  const white = [], yellowCentre = [], yellowEdge = [];
  const paint = (airfield && airfield.paint) || {};
  const rw = runwayPaint(paint, white);
  const tw = taxiwayPaint(paint, yellowCentre, yellowEdge);
  const st = standPaint(paint, yellowCentre);
  const pads = AIRPORT_PARKING_PADS.map((p) => [p.x0, p.z0, p.x1, p.z0, p.x1, p.z1, p.x0, p.z1]);
  padPaint(AIRPORT_PARKING_PADS, white);
  const quads = white.length + yellowCentre.length + yellowEdge.length;
  return {
    white, yellowCentre, yellowEdge, pads,
    stats: {
      quads, triangles: quads * 2,
      whiteQuads: white.length, yellowCentreQuads: yellowCentre.length, yellowEdgeQuads: yellowEdge.length,
      runwayLengthM: Math.round(rw.length || 0),
      taxiwayCentreM: Math.round(tw.centreM), taxiwayEdgeSegments: tw.edgeSegs,
      stands: st.count, standLeadM: Math.round(st.leadM),
    },
  };
}
