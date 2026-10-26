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

const quad = (out, cx, cz, ux, uz, vx, vz, hu, hv) => {
  out.push([
    cx - ux * hu - vx * hv, cz - uz * hu - vz * hv,
    cx + ux * hu - vx * hv, cz + uz * hu - vz * hv,
    cx + ux * hu + vx * hv, cz + uz * hu + vz * hv,
    cx - ux * hu + vx * hv, cz - uz * hu + vz * hv,
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
      for (let x = p.x0 + 1.3; x + 1.3 <= p.x1; x += 2.6) {
        const cz = zLine + inward * 2.5;
        white.push([x - 0.06, cz - inward * 2.5, x + 0.06, cz - inward * 2.5, x + 0.06, cz + inward * 2.5, x - 0.06, cz + inward * 2.5]);
      }
    };
    stalls(p.z0, 1);
    stalls(p.z1, -1);
    if (p.z1 - p.z0 > 55) {
      const mid = (p.z0 + p.z1) / 2;
      stalls(mid, 1);
      stalls(mid, -1);
      // The double row's spine line.
      white.push([p.x0 + 0.5, mid - 0.075, p.x1 - 0.5, mid - 0.075, p.x1 - 0.5, mid + 0.075, p.x0 + 0.5, mid + 0.075]);
    }
  }
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
