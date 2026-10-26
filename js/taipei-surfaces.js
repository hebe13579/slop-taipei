// js/taipei-surfaces.js — road surface treatment for the Taipei tile
// (issue #29): per-class carriageway tones, boulevard median strips,
// and plaza / podium ground classification. Pure data + geometry (no
// three.js), mirroring taipei-painted.js, so node tests, the median
// list generator and the renderer all run the exact same rules.
//
// Why classes differ: aerial albedo (Esri World Imagery z17 samples,
// surfaces-evidence/palette.md) separates the classes the way Taipei
// street level does — elevated decks are weathered cool grey concrete,
// arterials dark warm asphalt, minor 巷/弄 lanes poured concrete and
// visibly paler. Material tones stay in the value family of the old
// single 0x33363b slab and move hue/lightness the way the aerials do.

import { ribbonPoly, pointInPoly, buildPolyGrid, pointInAnyPoly } from './taipei-painted.js';

export const SURFACE_TONES = {
  deck: 0x2e3238,          // trunk / trunk_link — cooler + darker, weathered deck
  arterial: 0x33363b,      // primary / secondary — unchanged pre-#29 baseline
  collector: 0x383b40,     // tertiary — a hair lighter/cooler than arterial
  lane: 0x4a4741,          // residential/service/… — lighter warm concrete
  medianPlanted: 0x4c5c33, // dark olive shrub green (park lawn is 0x56854a)
  medianPlain: 0x8a867c,   // concrete barrier; below sidewalk 0xb5b0a4
  plaza: 0xa39d8f,         // light warm stone paving for 廣場 squares
  podium: 0x99948a,        // landmark blocks, one step up from block grey
  park: 0x56854a,          // unchanged park green
  block: 0x8f8b80,         // unchanged ordinary block grey
};

const DECK_HW = new Set(['trunk', 'trunk_link']);
const ARTERIAL_HW = new Set(['primary', 'primary_link', 'secondary', 'secondary_link']);
const COLLECTOR_HW = new Set(['tertiary', 'tertiary_link']);

// Every carriageway lands in exactly one surface class. Anything not
// listed (residential, service, unclassified, living_street, busway,
// construction, …) is lane fabric — in Taiwan OSM usage dominated by
// the concrete 巷/弄 lanes and service alleys.
export function surfaceClass(bed) {
  const hw = bed?.highway || '';
  if (DECK_HW.has(hw)) return 'deck';
  if (ARTERIAL_HW.has(hw)) return 'arterial';
  if (COLLECTOR_HW.has(hw)) return 'collector';
  return 'lane';
}

// ---------------------------------------------------------------------
// Boulevard medians.
//
// A merged bed is one whose sourceWayIds.length > 1 — the generation
// map paired two carriageways into it (issues #6/#22). The strip runs
// along the bed centreline at clamp(width × 0.08, 1.2, 3.5) m. Beds
// end at the CENTRE of the crossing road, so at a real junction the
// strip must stop or it would paint a divider across the junction
// box: samples are clipped against foreign beds at least
// MEDIAN_CLIP_MIN_WIDTH wide (the #25 construction). Narrower
// crossings do NOT break the strip — a real median runs continuous
// across 巷/弄 lane mouths, and in the flat model the narrow ramp
// stubs that cross a boulevard are the same kind of mouth, not a
// junction break (measured on post-#30 data: clipping against every
// bed chopped ~1/3 off the planted length, most of it 3–6 m lanes
// and ramps; the ≥ 8 m threshold keeps the junction breaks and drops
// the chop to the crossings that are actually junctions).
//
// USER DIRECTIVE (2026-10-23, issue #29 comment): underpasses and
// tunnels are EXCLUDED entirely — a bed whose name carries 地下道,
// 隧道 or 車行地下道 gets no median and no special handling. This is
// an exclusion, not the research draft's downgrade-to-plain: the
// 辛亥路車行地下道 (34.3 m merged secondary) must NOT grow a planted
// strip, and the trunk tunnels grow none either. The name is the only
// honest signal at this layer — the generated roadbeds carry no layer
// or tunnel tags (same reasoning as taipei-streetscape.js's tree
// exclusion). Elevated corridors need no name rule here: they render
// as simple boulevards, plain concrete divider included.

export const UNDERPASS_NAME = /地下道|隧道|車行地下道/;
export const isUnderpassName = (name) => UNDERPASS_NAME.test(name || '');

export const MEDIAN_MIN_WIDTH = 16;        // below this the pairing is too tight to hold a strip
export const MEDIAN_PLANTED_MIN_WIDTH = 26; // planted only on wide ground boulevards
export const MEDIAN_CLIP_MIN_WIDTH = 8;    // only crossings at least this wide break a strip
// Issue #178 (the T18 form): a minor bed below the clip width
// still breaks a strip when its ribbon crosses the WHOLE strip —
// a through lane, not a mouth. The roadsweep-2 frame at
// 信義路六段76巷 showed the median band rendering unbroken over
// a 6 m residential lane that crosses the avenue outright (no
// junction is detected there, so no cap breaks the strip either).
// The test is containment of the strip centre AND of both probes
// at ±(half + 0.75) along the strip normal inside the one foreign
// ribbon: a mouth bed ends at the centreline, so its far probe
// falls outside and the #25 rule above (narrow mouths do not
// break a median — the 3.2 m synthetic lane included) stands.
// The floor sits between that synthetic (3.2 m) and the measured
// T18 lane (6 m). One guard: the break does not apply under an
// elevated deck's ribbon — there the ground median is the deck's
// pier island (see underDeck in buildMedianStrips).
export const MEDIAN_MINOR_CROSS_MIN_WIDTH = 4.5;

// 'planted' | 'plain' | null for one roadbed.
export function medianKind(bed) {
  if (!bed) return null;
  if (isUnderpassName(bed.name)) return null;
  if (!Array.isArray(bed.sourceWayIds) || bed.sourceWayIds.length < 2) return null;
  const w = bed.width || 0;
  if (w < MEDIAN_MIN_WIDTH) return null;
  // Planted ⇔ the grand ground boulevards (secondary at full width —
  // 仁愛/敦化/信義 pattern, satellite-confirmed in #22). Primary stays
  // plain (忠孝東路's divider is a barrier in reality), decks and
  // bridges plain (concrete barrier), narrower merged beds plain.
  return bed.highway === 'secondary' && w >= MEDIAN_PLANTED_MIN_WIDTH ? 'planted' : 'plain';
}

export const medianStripWidth = (bed) => Math.min(3.5, Math.max(1.2, (bed.width || 0) * 0.08));

const SAMPLE_STEP_M = 2; // strips are sampled at most this far apart
const GRID_M = 100;

// Densify a centreline to points at most SAMPLE_STEP_M apart (vertices
// kept) — same construction as taipei-painted.js.
function densify(pts) {
  const out = [pts[0]];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(len / SAMPLE_STEP_M));
    for (let s = 1; s <= steps; s++) out.push([ax + ((bx - ax) * s) / steps, az + ((bz - az) * s) / steps]);
  }
  return out;
}

const ptsOf = (b) => {
  const p = [];
  for (let i = 0; i < b.pts.length; i += 2) p.push([b.pts[i], b.pts[i + 1]]);
  return p;
};

// buildMedianStrips(roadbeds, capPolys = null) -> { planted, plain, stats }
// roadbeds: ALL carriageway roadbeds (every bed is a potential junction
// occluder, as in buildPaintedBands). planted/plain are arrays of quads
// [x1,z1, x2,z2, x3,z3, x4,z4] in the same strip order the renderer's
// quadsGeometry consumes (a+hi, b+hi, b+lo, a+lo). capPolys (issue
// #66): junction-cap polygons as point arrays — a strip sample inside
// any cap is blocked, so no median strip crosses a junction core the
// bed-ribbon clip alone left open at the corners.
export function buildMedianStrips(roadbeds, capPolys = null) {
  const capGrid = capPolys ? buildPolyGrid(capPolys) : null;
  const capBlocked = (p) => pointInAnyPoly(capGrid, capPolys, p);
  const polys = roadbeds.map(ribbonPoly);
  const grid = new Map();
  polys.forEach((poly, i) => {
    if ((roadbeds[i].width || 3) < MEDIAN_CLIP_MIN_WIDTH) return; // lane mouths don't break a median
    const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
    for (let gx = Math.floor(Math.min(...xs) / GRID_M); gx <= Math.floor(Math.max(...xs) / GRID_M); gx++)
      for (let gz = Math.floor(Math.min(...zs) / GRID_M); gz <= Math.floor(Math.max(...zs) / GRID_M); gz++) {
        const k = `${gx},${gz}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(i);
      }
  });
  const foreignBlocked = (p, selfIdx, selfWays) => {
    const cand = grid.get(`${Math.floor(p[0] / GRID_M)},${Math.floor(p[1] / GRID_M)}`) || [];
    for (const ci of cand) {
      if (ci === selfIdx) continue;
      if ((roadbeds[ci].sourceWayIds || []).some((w) => selfWays.has(w))) continue;
      if (pointInPoly(p, polys[ci])) return true;
    }
    return false;
  };
  // Issue #178: minor through-crossings (see
  // MEDIAN_MINOR_CROSS_MIN_WIDTH). A separate grid holds the
  // sub-clip-width beds; deck-flagged beds are excluded (an
  // elevated crossing does not break the median under its deck).
  const minorGrid = new Map();
  polys.forEach((poly, i) => {
    const w = roadbeds[i].width || 3;
    if (w < MEDIAN_MINOR_CROSS_MIN_WIDTH || w >= MEDIAN_CLIP_MIN_WIDTH || roadbeds[i].deck) return;
    const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
    for (let gx = Math.floor(Math.min(...xs) / GRID_M); gx <= Math.floor(Math.max(...xs) / GRID_M); gx++)
      for (let gz = Math.floor(Math.min(...zs) / GRID_M); gz <= Math.floor(Math.max(...zs) / GRID_M); gz++) {
        const k = `${gx},${gz}`;
        if (!minorGrid.has(k)) minorGrid.set(k, []);
        minorGrid.get(k).push(i);
      }
  });
  // Deck ribbons, for the guard inside minorCrossBlocked: where
  // an elevated deck crosses the strip, the ground median is the
  // deck's pier island (the baked piers stand on the centreline
  // there — six of them tile-wide, e.g. the 承德橋 pier at the
  // 承德路四段6巷 throat), so the through-crossing break does
  // not apply under a deck. T18 itself has no deck overhead and
  // is unaffected.
  const deckIdx = [];
  polys.forEach((poly, i) => { if (roadbeds[i].deck) deckIdx.push(i); });
  const deckGrid = new Map();
  deckIdx.forEach((i) => {
    const poly = polys[i];
    const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
    for (let gx = Math.floor(Math.min(...xs) / GRID_M); gx <= Math.floor(Math.max(...xs) / GRID_M); gx++)
      for (let gz = Math.floor(Math.min(...zs) / GRID_M); gz <= Math.floor(Math.max(...zs) / GRID_M); gz++) {
        const k = `${gx},${gz}`;
        if (!deckGrid.has(k)) deckGrid.set(k, []);
        deckGrid.get(k).push(i);
      }
  });
  const underDeck = (p) => {
    const cand = deckGrid.get(`${Math.floor(p[0] / GRID_M)},${Math.floor(p[1] / GRID_M)}`) || [];
    for (const ci of cand) if (pointInPoly(p, polys[ci])) return true;
    return false;
  };
  const minorCrossBlocked = (p, nx, nz, half, selfIdx, selfWays) => {
    if (underDeck(p)) return false;
    const cand = minorGrid.get(`${Math.floor(p[0] / GRID_M)},${Math.floor(p[1] / GRID_M)}`) || [];
    const reach = half + 0.75;
    for (const ci of cand) {
      if (ci === selfIdx) continue;
      if ((roadbeds[ci].sourceWayIds || []).some((w) => selfWays.has(w))) continue;
      if (pointInPoly(p, polys[ci])
        && pointInPoly([p[0] + nx * reach, p[1] + nz * reach], polys[ci])
        && pointInPoly([p[0] - nx * reach, p[1] - nz * reach], polys[ci])) return true;
    }
    return false;
  };

  const out = { planted: [], plain: [] };
  const stats = {
    plantedBeds: 0, plainBeds: 0, excludedUnderpass: 0,
    plantedQuads: 0, plainQuads: 0, plantedKm: 0, plainKm: 0,
  };
  roadbeds.forEach((r, selfIdx) => {
    if (isUnderpassName(r.name) && Array.isArray(r.sourceWayIds) && r.sourceWayIds.length > 1 && (r.width || 0) >= MEDIAN_MIN_WIDTH) stats.excludedUnderpass++;
    const kind = medianKind(r);
    if (!kind) return;
    stats[kind === 'planted' ? 'plantedBeds' : 'plainBeds']++;
    const half = medianStripWidth(r) / 2;
    const selfWays = new Set(r.sourceWayIds);
    const pts = densify(ptsOf(r));
    const frames = pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], c = pts[Math.min(pts.length - 1, i + 1)];
      let dx = c[0] - a[0], dz = c[1] - a[1];
      const n = Math.hypot(dx, dz) || 1; dx /= n; dz /= n;
      const nx = -dz, nz = dx;
      // Issue #173 (MEDTIP): the cap test joins the foreign test at
      // centre + both edges — it used to probe the centre point
      // only, so a strip whose centre cleared a junction surface
      // still dragged a corner across it (66 quads / 25.6 m² of
      // median over cap tile-wide in the #169 sweep census). The
      // painted bands (js/taipei-painted.js) have always tested
      // their corners this way; the median now terminates with the
      // same discipline.
      const blocked =
        foreignBlocked(p, selfIdx, selfWays) ||
        foreignBlocked([p[0] + nx * half, p[1] + nz * half], selfIdx, selfWays) ||
        foreignBlocked([p[0] - nx * half, p[1] - nz * half], selfIdx, selfWays) ||
        minorCrossBlocked(p, nx, nz, half, selfIdx, selfWays) ||
        capBlocked(p) ||
        capBlocked([p[0] + nx * half, p[1] + nz * half]) ||
        capBlocked([p[0] - nx * half, p[1] - nz * half]);
      return { p, nx, nz, blocked };
    });
    const sink = out[kind];
    for (let i = 0; i + 1 < frames.length; i++) {
      const f0 = frames[i], f1 = frames[i + 1];
      if (f0.blocked || f1.blocked) continue;
      const mid = [(f0.p[0] + f1.p[0]) / 2, (f0.p[1] + f1.p[1]) / 2];
      const mnx = f0.nx + f1.nx, mnz = f0.nz + f1.nz;
      const mnl = Math.hypot(mnx, mnz) || 1;
      if (foreignBlocked(mid, selfIdx, selfWays) || capBlocked(mid)
        || minorCrossBlocked(mid, mnx / mnl, mnz / mnl, half, selfIdx, selfWays)
        || capBlocked([mid[0] + (mnx / mnl) * half, mid[1] + (mnz / mnl) * half])
        || capBlocked([mid[0] - (mnx / mnl) * half, mid[1] - (mnz / mnl) * half])) continue;
      sink.push([
        f0.p[0] + f0.nx * half, f0.p[1] + f0.nz * half,
        f1.p[0] + f1.nx * half, f1.p[1] + f1.nz * half,
        f1.p[0] - f1.nx * half, f1.p[1] - f1.nz * half,
        f0.p[0] - f0.nx * half, f0.p[1] - f0.nz * half,
      ]);
      stats[kind === 'planted' ? 'plantedQuads' : 'plainQuads']++;
      stats[kind === 'planted' ? 'plantedKm' : 'plainKm'] += Math.hypot(f1.p[0] - f0.p[0], f1.p[1] - f0.p[1]) / 1000;
    }
  });
  return { planted: out.planted, plain: out.plain, stats };
}

// ---------------------------------------------------------------------
// Plaza paving + podium blocks (renderer splits, no data changes).

// A park polygon whose name carries 廣場 is a paved civic square in
// reality （市民廣場/松壽廣場/世貿廣場…), not a lawn — it renders in
// the plaza paving tone. Real parks (no 廣場 in the name) stay green.
export const isPlazaPark = (park) => (park?.name || '').includes('廣場');

// Blocks containing a landmark centre wear the podium paving tone.
// The centres are the geodata landmark entries for Taipei 101 and
// Taipei City Government (issue #29 research: those two blocks are
// the tower podium apron and the City Hall grounds whose flat block
// grey read as "bare etched ground" in the user's screenshots). The
// rule is containment, not hard-coded bboxes, so a regeneration that
// shifts the raster blocks still selects by the same test.
export const PODIUM_LANDMARK_KEYS = ['Taipei 101', 'Taipei City Government'];

export function isPodiumBlock(block, centres) {
  const { minX, maxX, minZ, maxZ } = block.bbox;
  return centres.some((c) => c.x >= minX && c.x <= maxX && c.z >= minZ && c.z <= maxZ);
}

export function podiumCentresOf(geodata) {
  const lm = geodata?.landmarks || {};
  return PODIUM_LANDMARK_KEYS.map((k) => lm[k]).filter((c) => c && Number.isFinite(c.x) && Number.isFinite(c.z));
}

// ---------------------------------------------------------------------
// CKS Memorial grounds paving (issue #98 follow-up; user request
// 2026-10-24: "中正紀念堂 is a plaza with some floor tile"). The
// 中正紀念公園 polygon renders as one lawn, but in reality Liberty
// Square is a paved stone field, the Boulevard of Homage a paved
// strip between lawn panels, and the memorial terrace stands on a
// paved apron — all read clearly in the Esri satellite stitch
// (facing-evidence/refs/sat-cks-park-z17-overlay.jpg: the light
// tile field between the two halls, its concentric-rectangle
// pattern, the boulevard strip, the terrace apron; the park's
// green sub-polygons are exactly the lawns/woods around them).
// Hand-authored flat rings in the park's own axis frame — the
// district grid sits ~28° rotated in tile coords — with u along
// the square→hall axis from the hall centre and v across it. The
// square also gets a subtle tile grid: 0.4 m strips a tone darker
// every 15 m (the real pattern is concentric rectangles; a plain
// grid is the minimal read of "floor tile"). Ground treatment
// only: the rings stay inside the park polygon, off every roadbed.

export const MEMORIAL_FRAME = { cx: -4388, cz: -201, ax: 0.88354, az: 0.46813, px: -0.46813, pz: 0.88354 };
export const MEMORIAL_GRID_TONE = 0x8f867a;

function memorialQuad(u0, u1, v0, v1) {
  const f = MEMORIAL_FRAME;
  const pt = (u, v) => [f.cx + u * f.ax + v * f.px, f.cz + u * f.az + v * f.pz];
  const [ax, az] = pt(u0, v0), [bx, bz] = pt(u1, v0), [cx, cz] = pt(u1, v1), [dx, dz] = pt(u0, v1);
  return [ax, az, bx, bz, cx, cz, dx, dz];
}

export function memorialPaving() {
  const rings = [
    memorialQuad(-405, -148, -102, 102), // Liberty Square tile field
    memorialQuad(-462, -405, -42, 42),    // forecourt inside the main gate / arch
    memorialQuad(-148, -52, -15, 15),     // Boulevard of Homage paved strip
    // Terrace apron — a park-frame quad hugging the terrace
    // (issue #116: the terrace now sits on the park axis like
    // everything else in the grounds, so the apron follows
    // the same frame; before #116 the terrace was axis-aligned
    // and the apron was a world-axis rect).
    memorialQuad(-89, 89, -88, 88),
  ];
  const gridQuads = [];
  for (let u = -390; u <= -165; u += 15) gridQuads.push(memorialQuad(u - 0.2, u + 0.2, -102, 102));
  for (let v = -90; v <= 90; v += 15) gridQuads.push(memorialQuad(-405, -148, v - 0.2, v + 0.2));
  return { rings, gridQuads };
}
