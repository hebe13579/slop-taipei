// tools/taipei/build-generation-map.mjs — generation map builder (issue #6).
//
// The generation map is the CURATED street-rework layer between the raw OSM
// extract and the geodata builder:
//
//   tools/taipei/data/osm_*.json   (raw extract — RETAINED byte-identical,
//                                   never edited by hand or by this script)
//     -> tools/taipei/build-generation-map.mjs   (this file: rework RULES)
//     -> tools/taipei/data/generation-map.json   (roadbeds: the render and
//                                   street-section source)
//     -> tools/taipei/build-taipei-geodata.mjs   (emits TAIPEI_GEO.roadbeds)
//     -> js/taipei-boot.js                       (renders carriageways from
//                                   roadbeds; routing still uses roadGraph)
//
// All curation is expressed as CODE (pairing rules, a link-length policy and
// a small width-override table) so re-running this script on a future PBF
// extract re-applies the rework automatically. Every roadbed records the
// raw OSM way ids it derives from (sourceWayIds); validate.mjs checks that
// provenance and flags any rule/override that matched nothing, so curation
// cannot silently rot when the upstream data changes.
//
// Rework v1:
//   1. BOULEVARD MERGE — opposing one-way carriageways of the same named
//      trunk/primary/secondary road (roughly parallel, centrelines within
//      45 m, opposing travel direction) merge into ONE roadbed whose width
//      is w1 + w2 + the median gap between the centrelines. Additional
//      parallel same-name carriageways alongside a merged pair (e.g. the
//      slow lanes of 仁愛路) join the group and widen the span.
//   2. RAMP/LINK POLICY — *_link ways whose total in-tile length is under
//      120 m are excluded from roadbeds (they render as twisted spaghetti
//      at junctions; the crossing roadbeds cover the junction visually).
//      They remain in the roads array and the routing graph, untouched.
//   3. WIDTH OVERRIDES — explicit per-name widths, see OVERRIDES below.
//
// Rework v2 (issue #22, road-geometry quality pilot — Jianguo corridor +
// Xinyi Rd Sec 5):
//   4. STAGGERED-COUNTERPART MERGE — pairing coverage is judged on the
//      SHORTER segment of a pair (plus an in-range opposing-tangent
//      density test on both sides), and a segment may pair with several
//      counterparts over disjoint arc-length ranges — later ranges are
//      trimmed against earlier claims at junction fans, and each merged
//      bed's geometry is dilated slightly past its claimed range so
//      diverging midlines cannot leave a bare wedge at group boundaries.
//      OSM splits the two
//      carriageways of a boulevard at different stations, so v1's
//      "70% of EACH segment must pair" test failed wherever the
//      segmentation was staggered — leaving unmerged ribbons with the
//      median gap showing as a pale seam (Xinyi Rd Sec 5) and skinny
//      unmerged tails on the Jianguo elevated deck.
//   5. ELEVATED CARRIAGEWAYS — a way with layer >= 1 or a bridge tag is a
//      deck, not a street: its pedestrianLayout is 'shared' (no green
//      painted stripes, no phantom sidewalk band on an expressway), and
//      elevated *_link ramps are never dropped by the 120 m link policy
//      (nothing else covers a ramp's diagonal between deck and ground —
//      dropping it leaves a hole at the interchange).
//
// Rework v3 (issues #25 + #30 — main-road bands + shape pass):
//   6. TERTIARY PAIRING — divided tertiary carriageways （松仁路， 市府路）
//      merge like boulevards; under v1/v2 their ribbons never merged, so
//      the median gap — and any band on the pair-facing side — read as a
//      stripe down the middle of the road. Pairing/extension also gained
//      an adjacency rule: a pair whose bare median gap exceeds
//      MAX_PAIR_GAP_M with an elevated through-carriageway running
//      between them is not one roadbed （建國北路 ground pair flanking
//      the 建國快速道路 deck stays two ribbons + the deck bed).
//   7. CENTRELINE SIMPLIFICATION — every emitted centreline is
//      Douglas–Peucker simplified at SIMPLIFY_EPS_M (1.5 m): the render
//      does not need 1:1 vertex fidelity with OSM, and a straight road
//      should render as a straight ribbon (user direction 2026-10-23).
//   8. ORPHAN SUPPRESSION — a non-merged bed already (almost) entirely
//      covered by merged/wider beds is dropped (see ORPHAN_* constants):
//      unclaimed middle ranges of merged constituents otherwise render
//      as stray fragments inside the merged bed (the 15 m dash on
//      信義路五段). Elevated corridors get the same treatment as any
//      boulevard — one wide ground ribbon, ramps as simple connectors;
//      underpass ways are ordinary surface roads (no sunken modelling).
//   9. FRONTAGE DEMOTION — a painted bed mostly running inside a wider
//      bed's footprint keeps its bed but loses its band (FRONTAGE_INSIDE).
//      Together with the classifier's main-road rule (issue #25,
//      pedestrian-layout.mjs) and junction-clipped band rendering
//      (js/taipei-painted.js), no green band is born on, or crosses, a
//      main carriageway.
//
// Rework v4 (issue #61):
//  10. DECK FLAGS — a roadbed deriving from an elevated carriageway of
//      a deck class (DECK_CLASSES below) is flagged `deck: true`.
//      The flag changes nothing in this layer's accounting (the beds
//      stay in every ground planner: junction caps, markings, medians
//      and the lot exclusion all keep working on the full bed set);
//      it only tells the boot not to draw the bed as a ground ribbon —
//      tools/taipei/build-elevated.mjs builds its real deck instead.
//
// Rework v5 (issue #183):
//  11. AIRFIELD TUNNEL SUPPRESSION — a roadbed whose source ways are
//      ALL tunnel=yes and whose centreline crosses the Songshan
//      airfield site is not a surface road: it dives under the field
//      （復興北路車行地下道， OSM ways 95015334 + 137317902,
//      tunnel=yes / layer=-1). The inside run leaves `roadbeds` and
//      is recorded in the top-level `roadTunnels` list (never emitted
//      as a surface bed — the same emit:false treatment the MRT
//      digest gives tunnel records in tools/taipei/build-mrt.mjs);
//      the outside runs stay as surface beds (the portal aprons) and
//      the geodata builder hangs the records on the airfield so the
//      boot can dress the two mouths. Scoped to the airfield site on
//      purpose: tile-wide underpass ways stay ordinary surface roads
//      (rule 8 above; the #29 directive), this is the one place a
//      "surface" tunnel bed paints a road across a runway.
//
// Rework v6 (issue #196):
//  12. PORTAL APPROACH CUTS — a v5 mouth is a headwall standing ON
//      grade; a real portal is the bottom of an open cut. The
//      suppression extends OUTWARD from each mouth along the road
//      axis to a junction-limited run (clearance before the first
//      crossing node, cap on length): flat beds inside the cut
//      corridor are clipped away, the mouth records the cut, and
//      the renderer draws the descending trench floor + retaining
//      walls in their place. A bed crossing the corridor mid-bed
//      stays whole — it bridges the cut. See the v6 block below.
//
// usage: node tools/taipei/build-generation-map.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pedestrianLayout } from './pedestrian-layout.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.TAIPEI_DATA || path.join(HERE, 'data');
const OUT = process.argv[2] || path.join(DATA, 'generation-map.json');
const load = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

// ---- rework configuration ----
// Pairing classes (issue #30): tertiary joins trunk/primary/secondary.
// A named one-way pair of tertiary carriageways is a divided road by
// construction (松仁路, 市府路 — their two ribbons never merged under the
// old class gate, leaving the median gap — and any walkway band on the
// pair-facing side — reading as a stripe down the middle of the road).
// The pairing gates (same name, opposing travel, centrelines within
// 45 m, density tests) still decide; class only sets eligibility.
const PAIR_CLASSES = new Set(['trunk', 'primary', 'secondary', 'tertiary']);
// Deck classes (issue #61): the carriageway classes whose elevated
// ways become real decks in tools/taipei/build-elevated.mjs (which
// carries the same set). A roadbed deriving from such a way is
// flagged `deck: true` and the boot draws it as a deck, not a ground
// ribbon; validate.mjs cross-checks the flag against the elevated set.
const DECK_CLASSES = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link']);
const isDeckSegment = (seg) => isElevatedTags(seg) && DECK_CLASSES.has(seg.highway);
const MAX_PAIR_DIST_M = 45;        // max centreline distance for a merge
const MIN_PAIR_OVERLAP = 0.7;      // fraction of each segment that must pair
const MIN_INRANGE_OVERLAP = 0.8;   // pairing density inside the overlap range
const MIN_PAIR_SEGMENT_M = 12;     // shorter runs are junction stubs, not carriageways
const MAX_GROUP_MEMBERS = 5;
const LINK_MIN_LENGTH_M = 120;     // *_link ways shorter than this are not rendered
const TAIL_MIN_LENGTH_M = 4;       // non-overlap tails shorter than this are dropped
const MIN_CLAIM_RANGE_M = 25;      // a pairing range trimmed below this is not worth a merged bed
const GROUP_DILATE_M = 14;         // merged-bed geometry reaches this far past the claimed range at both ends (junction wedge stitch)
const MAX_PAIR_GAP_M = 15;         // max bare median gap between paired ribbons' edges (issue #30 median-gap rule, see pairEval)
// Shape pass (issue #30 — the render does not need 1:1 vertex fidelity
// with OSM; simplicity beats wander): every emitted centreline is
// Douglas–Peucker simplified at this tolerance, so a straight boulevard
// renders as a clean straight ribbon and per-vertex survey jitter drops
// out. 1.5 m is well under a lane width (3.2 m), so genuine curves and
// junction fans keep their shape.
const SIMPLIFY_EPS_M = 1.5;
// Orphan suppression (issue #30): a non-merged roadbed whose ribbon is
// already (almost) entirely drawn by other roadbeds adds only fragments
// and z-fighting — the classic case is an unclaimed middle range of a
// merged constituent emitted as a short single INSIDE the merged bed
// (the stray 15 m painted dash on 信義路五段). Suppress when >= 90% of
// the centreline length lies inside other beds' ribbons (short beds),
// or >= 98% at any length (a frontage trace wholly inside a boulevard).
const ORPHAN_COVER = 0.9;
const ORPHAN_COVER_LONG = 0.98;
const ORPHAN_SHORT_M = 150;
// Frontage demotion (issue #30): a surviving painted bed whose length
// mostly runs INSIDE a wider bed's footprint is a frontage/service
// trace on top of that carriageway — it keeps its bed (it may extend
// beyond the wide bed) but loses its walkway band.
const FRONTAGE_INSIDE = 0.5;
// Underpass corridors (issue #51): a …車行地下道 way set is not a road
// of its own — its carriageways are the through lanes of the parent
// road, diving under cross streets while the parent's surface lanes
// run alongside (基隆路一段 + 基隆路車行地下道 is ONE boulevard in
// Esri World Imagery, ~29-40 m of continuous pavement). The standing
// flat-world rule is that underpasses are ignored and the surface road
// is drawn whole, so:
//   (a) FAMILY PAIRING — an underpass name's pairing candidates join
//       the parent road's pairing group (parent resolved by name
//       prefix + bbox containment, recorded in stats), so merged beds
//       span the full boulevard instead of stacking a second, narrower
//       ribbon set on top of the surface one; a mixed group's bed
//       takes the surface road's name.
//   (b) DEDUP — any underpass-named bed (merged or single) whose
//       centreline is >= 85% covered by differently-named beds adds no
//       pavement of its own and is suppressed (booked into
//       suppressedLength like orphan suppression, so the length
//       identity still closes). Portal/ramp beds that extend the paved
//       footprint stay. Twin-bore tunnels (…隧道) have no surface twin
//       and are NOT touched: the rule is scoped to the 車行地下道
//       suffix only.
const UNDERPASS_SUFFIX = '車行地下道';
const UNDERPASS_DEDUP_COVER = 0.85;
// Park service drives (issue #74 one named park; generalized in
// issue #83): OSM draws park-interior circulation as unnamed
// highway=service ways — a park's own site drives, several of them
// schematics rather than surveyed streets (at 中正紀念公園 ways
// 1053359233/1053359237/1053359248 cross the National Theater and
// Concert Hall wall plans diagonally, which is what forced the #74
// fix: no landmark footprint may sit on a roadbed, and no palace
// scale works while a drive crosses the building core). Rendered
// as roadbeds, these drives cut fake carriageways through park
// green everywhere, so the rule is now general:
//
//   An UNNAMED highway=service roadbed whose centreline lies
//   >= PARK_SERVICE_INSIDE inside the union of leisure=park
//   polygons (ways + relations from osm_parks.json — plazas like
//   市民廣場 are tagged leisure=park in this extract) is excluded
//   from roadbeds and its length booked into
//   parkServiceExcludedLength, so the length identity still
//   closes.
//
// "Mostly" is a majority test, not ~all: the drives run
// gate-to-gate across the grounds and their tails cross the park
// ring on the way to the perimeter streets (measured inside
// shares for dropped beds: 0.50-1.00, dominated by >= 0.70).
//
// Measured on the 2026-10-24 extract (probe in the issue #83
// evidence): 94 service beds / 6.62 km sit >= 50% inside some
// green polygon; 92 of them / 6.52 km are inside leisure=park
// polygons. The polygon scope is leisure=park ONLY: adding the
// landuse grass/forest/meadow polygons would add 1,481 polygons
// of false-positive surface (grass verges, hillside forest) for
// exactly 2 extra beds / 0.10 km, one of them itself ambiguous
// (74% inside a 791 m² grass patch).
//
// Named beds are EXEMPT: a name is the dataset's own signal that
// a way is an addressed street, not site circulation. The 6
// named beds >= 50% inside a park are all street-pattern —
// 堤外道路 x2 (the through road on the river side of the levee,
// inside 延平河濱公園's strip polygon), 建國南路一段65巷,
// 武昌街二段91巷, 延壽街356巷, 莊敬路197巷 — and are listed in
// stats.parkServiceNamedExemptions so the exemption is auditable,
// not silent. (All 86 dropped beds are unnamed; every park web
// in the tile — CKS, 中山公園, 市民廣場, … — is unnamed in OSM.)
//
// Routing is untouched (roadGraph is built separately in
// build-taipei-geodata.mjs). Anti-rot: with osm_parks.json
// present, zero leisure=park polygons, a rule that drops zero
// beds, or a PARK_SERVICE_CRITICAL park that matches no ring or
// contributes zero dropped beds all fail the build (OVERRIDES
// pattern) — the #74 landmark guarantee for 中正紀念公園 cannot
// rot silently now that its name is no longer the rule itself.
// osm_parks.json absent (synthetic test extracts) leaves the
// rule inert.
const PARK_SERVICE_INSIDE = 0.5;
const PARK_SERVICE_CRITICAL = ['中正紀念公園'];
//
// WIDTH OVERRIDES — by exact road name, applied instead of the inferred
// width (explicit OSM width tag > lanes x 3.2 m > name/class default).
// Add an entry ONLY where the inference demonstrably under-measures the
// real roadbed, and justify it in the comment: a wrong number here is
// worse than a narrow one, because the merge formula trusts these widths.
// Anti-rot: an override that matches zero ways fails this script (and
// validate.mjs), so a renamed road cannot leave a dead rule behind.
//
// One entry (issue #22 pilot): the Jianguo deck's lanes tags demonstrably
// under-measure it — see the entry. Candidates observed in the 2026-10-23
// extract but NOT overridden, because the true width cannot be
// demonstrated from the extract alone (only that sibling segments
// disagree):
//   - 信義路五段 has one 2-lane (6.4 m) run among 9.6-16 m siblings.
//   - 仁愛路四段 has 3.2/6.4 m runs (its tree-separated slow lanes — the
//     boulevard merge already folds these into the roadbed span).
const OVERRIDES = {
  // 建國快速道路 (Jianguo Elevated deck): OSM lanes tags (2 per carriageway
  // on the central stretch) infer 6.4 m per carriageway, but Esri World
  // Imagery (z17, reference in the issue #22 evidence) shows ≈22 m of
  // asphalt across the deck (≈29 m counting parapets/shoulders) — ≈11 m
  // per carriageway including shoulders and the central barrier share.
  // Without this, merged deck beds render 16.1 m wide on the Da'an
  // stretch, under the measured width under any reading of the imagery.
  '建國快速道路': 11,
};

// ---- frame (copied tangent-plane math from build-taipei-geodata.mjs) ----
// The tile is the UNION of the boxes in tile-boxes.json (issue #60);
// clips run against the union of the world-frame box rects, exactly as
// in build-taipei-geodata.mjs, so the two builders can never disagree
// about what is in the tile. BBOX is the union's bounding rect.
const LAT0 = 25.0330, LON0 = 121.5650;
const TILE_CFG = JSON.parse(fs.readFileSync(path.join(HERE, 'tile-boxes.json'), 'utf8'));
const A = 6378137.0, E2 = 6.69437999014e-3;
const PHI0 = (LAT0 * Math.PI) / 180, SIN0 = Math.sin(PHI0);
const NRAD = A / Math.sqrt(1 - E2 * SIN0 * SIN0);
const MRAD = (A * (1 - E2)) / Math.pow(1 - E2 * SIN0 * SIN0, 1.5);
const KX = (Math.PI / 180) * NRAD * Math.cos(PHI0); // metres per degree lon
const KY = (Math.PI / 180) * MRAD;                  // metres per degree lat
const toWorld = (lon, lat) => [(lon - LON0) * KX, -(lat - LAT0) * KY]; // [x, z], bearing 0
const q = (v) => Math.round(v * 10) / 10;
const BOXES_WORLD = TILE_CFG.boxes.map((b) => {
  const [x0, z1] = toWorld(b.w, b.s);
  const [x1, z0] = toWorld(b.e, b.n);
  return { name: b.name, minX: q(x0), maxX: q(x1), minZ: q(z0), maxZ: q(z1) };
});
const BBOX = {
  minX: Math.min(...BOXES_WORLD.map((b) => b.minX)), maxX: Math.max(...BOXES_WORLD.map((b) => b.maxX)),
  minZ: Math.min(...BOXES_WORLD.map((b) => b.minZ)), maxZ: Math.max(...BOXES_WORLD.map((b) => b.maxZ)),
};

// ---- width / layout inference (width table copied from
//      build-taipei-geodata.mjs; the layout classifier is imported from
//      ./pedestrian-layout.mjs so the two builders can never disagree) ----
const WIDTH_BY_CLASS = { motorway: 22, motorway_link: 10, trunk: 22, trunk_link: 10, primary: 18, primary_link: 9, secondary: 14, secondary_link: 8, tertiary: 11, tertiary_link: 7, unclassified: 8, residential: 8, living_street: 6, service: 5, pedestrian: 3, footway: 3, path: 3, cycleway: 3, steps: 2, track: 4, road: 8, construction: 6, busway: 7, corridor: 2, elevator: 2, platform: 3, crossing: 3, traffic_island: 2 };
function roadWidth(tags) {
  const w = parseFloat(tags.width || '');
  if (Number.isFinite(w) && w > 0) return w;
  const lanes = parseInt(tags.lanes || '', 10);
  if (Number.isFinite(lanes) && lanes > 0) return Math.round(lanes * 3.2 * 10) / 10;
  const name = tags.name || '';
  if (tags.service === 'alley' || name.includes('弄')) return 3;
  if (name.includes('巷')) return 6;
  return WIDTH_BY_CLASS[tags.highway] ?? 6;
}
// A deck (layer >= 1, or any bridge tag) is not a street: its
// pedestrianLayout is 'shared' via the guard in ./pedestrian-layout.mjs
// (issue #22). isElevatedTags is used directly below for the
// elevated-link rendering policy.
const isElevatedTags = (tags) => parseInt(tags.layer || '0', 10) >= 1 || (!!tags.bridge && tags.bridge !== 'no');
const NON_CARRIAGEWAY = new Set(['footway', 'path', 'steps', 'pedestrian', 'cycleway', 'corridor', 'elevator', 'crossing', 'platform', 'traffic_island']);

// ---- polyline helpers ----
// Clip a polyline to the UNION of the tile's box rects, returning runs
// (same per-segment interval-merge clip as build-taipei-geodata.mjs,
// minus the node-id records the road graph needs — provenance here is
// the WAY id, kept per segment). Abutting boxes share an edge value,
// so a way crossing a seam stays one continuous run.
function clipRuns(pts, boxes) {
  const runs = [];
  let run = [];
  const push = (p) => {
    const l = run[run.length - 1];
    if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) > 0.01) run.push(p);
  };
  const flush = () => { if (run.length >= 2) runs.push(run); run = []; };
  const segIntervals = (ax, az, dx, dz) => {
    const out = [];
    for (const bb of boxes) {
      let t0 = 0, t1 = 1, ok = true;
      for (const [p, qv] of [[-dx, ax - bb.minX], [dx, bb.maxX - ax], [-dz, az - bb.minZ], [dz, bb.maxZ - az]]) {
        if (Math.abs(p) < 1e-12) { if (qv < 0) { ok = false; break; } continue; }
        const r = qv / p;
        if (p < 0) t0 = Math.max(t0, r); else t1 = Math.min(t1, r);
        if (t0 > t1) { ok = false; break; }
      }
      if (ok) out.push([t0, t1]);
    }
    out.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const iv of out) {
      const last = merged[merged.length - 1];
      if (last && iv[0] <= last[1] + 1e-9) last[1] = Math.max(last[1], iv[1]);
      else merged.push([iv[0], iv[1]]);
    }
    return merged;
  };
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az;
    const ivs = segIntervals(ax, az, dx, dz);
    if (!ivs.length) { flush(); continue; }
    for (const [t0, t1] of ivs) {
      const pA = t0 === 0 ? [ax, az] : [ax + t0 * dx, az + t0 * dz];
      const pB = t1 === 1 ? [bx, bz] : [ax + t1 * dx, az + t1 * dz];
      if (t0 > 0 && run.length) flush();
      push(pA); push(pB);
      if (t1 < 1) flush();
    }
  }
  flush();
  return runs;
}
const cumLen = (pts) => {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return cum;
};
const lineLength = (pts) => { const c = cumLen(pts); return c[c.length - 1]; };
// Point + geometry tangent at arc length s.
function pointAt(pts, cum, s) {
  const L = cum[cum.length - 1];
  const t = Math.min(Math.max(s, 0), L);
  let lo = 0, hi = cum.length - 1;
  while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (cum[mid] <= t) lo = mid; else hi = mid; }
  const a = pts[lo], b = pts[lo + 1];
  const segLen = cum[lo + 1] - cum[lo] || 1e-9;
  const f = (t - cum[lo]) / segLen;
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const n = Math.hypot(dx, dz) || 1;
  return { x: a[0] + f * dx, z: a[1] + f * dz, tx: dx / n, tz: dz / n };
}
// Closest point on a polyline: { d, x, z, s, tx, tz } (geometry tangent).
function closestOn(pts, cum, x, z) {
  let best = null;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az;
    const L2 = dx * dx + dz * dz;
    let t = L2 > 0 ? ((x - ax) * dx + (z - az) * dz) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + t * dx, pz = az + t * dz;
    const d = Math.hypot(x - px, z - pz);
    if (!best || d < best.d) {
      const n = Math.hypot(dx, dz) || 1;
      best = { d, x: px, z: pz, s: cum[i] + t * Math.sqrt(L2), tx: dx / n, tz: dz / n };
    }
  }
  return best;
}
// Split a polyline at arc lengths s0 < s1: returns [head, mid, tail] point
// arrays (any may be null when degenerate).
function splitAt(pts, cum, s0, s1) {
  const cuts = [0, s0, s1, cum[cum.length - 1]];
  const parts = [];
  for (let k = 0; k + 1 < cuts.length; k++) {
    const a = cuts[k], b = cuts[k + 1];
    if (b - a < 0.01) { parts.push(null); continue; }
    const out = [];
    const pa = pointAt(pts, cum, a);
    out.push([pa.x, pa.z]);
    for (let i = 0; i < pts.length; i++) if (cum[i] > a + 0.01 && cum[i] < b - 0.01) out.push(pts[i]);
    const pb = pointAt(pts, cum, b);
    const last = out[out.length - 1];
    if (Math.hypot(pb.x - last[0], pb.z - last[1]) > 0.01) out.push([pb.x, pb.z]);
    parts.push(out.length >= 2 ? out : null);
  }
  return parts;
}
function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const A = pts[a], B = pts[b];
    const dx = B[0] - A[0], dz = B[1] - A[1], L = Math.hypot(dx, dz) || 1e-9;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - A[0]) * dz - (pts[i][1] - A[1]) * dx) / L;
      if (d > best) { best = d; bi = i; }
    }
    if (best > eps) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const median = (arr) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const flatQ = (pts) => pts.flatMap(([x, z]) => [q(x), q(z)]);

// ---- segments: one per clipped run of a carriageway way ----------------
const overrideMatched = new Map(Object.keys(OVERRIDES).map((n) => [n, 0]));
const segments = [];
let carriagewayLength = 0;
for (const el of load('osm_roads.json').elements) {
  if (el.type !== 'way' || !el.tags?.highway || !el.geometry || el.geometry.length < 2) continue;
  if (NON_CARRIAGEWAY.has(el.tags.highway)) continue;
  let width = roadWidth(el.tags);
  if (Object.hasOwn(OVERRIDES, el.tags.name)) {
    width = OVERRIDES[el.tags.name];
    overrideMatched.set(el.tags.name, overrideMatched.get(el.tags.name) + 1);
  }
  const layout = pedestrianLayout(el.tags, roadWidth(el.tags));
  const onewayRaw = el.tags.oneway || '';
  const runs = clipRuns(el.geometry.map((g) => toWorld(g.lon, g.lat)), BOXES_WORLD);
  for (const pts of runs) {
    const cum = cumLen(pts);
    const length = cum[cum.length - 1];
    if (length < 0.05) continue;
    carriagewayLength += length;
    segments.push({
      wayId: el.id, name: el.tags.name || '', highway: el.tags.highway, width,
      pedestrianLayout: layout,
      oneway: ['yes', 'true', '1', '-1'].includes(onewayRaw), reverse: onewayRaw === '-1',
      layer: el.tags.layer || '', bridge: el.tags.bridge || '', pts, cum, length,
    });
  }
}
for (const [name, n] of overrideMatched) {
  if (n === 0) {
    console.error(`[generation-map] FATAL: width override for "${name}" matched zero ways — the rule has rotted (road renamed or retagged?). Fix or remove it.`);
    process.exit(1);
  }
}

// ---- ramp/link policy ----------------------------------------------------
// Ground-level short links are dropped (junction spaghetti, covered by the
// crossing roadbeds). ELEVATED links (ramps: layer >= 1 or a bridge tag)
// are exempt — a ramp's diagonal between deck and ground is covered by
// nothing else, so dropping it leaves a hole at the interchange (issue #22).
const linkWayLength = new Map();
const elevatedWays = new Set();
for (const s of segments) {
  if (s.highway.endsWith('_link')) linkWayLength.set(s.wayId, (linkWayLength.get(s.wayId) || 0) + s.length);
  if (isElevatedTags(s)) elevatedWays.add(s.wayId);
}
const excludedLinkWays = new Set();
let excludedLinkLength = 0;
for (const [wayId, len] of linkWayLength) if (len < LINK_MIN_LENGTH_M && !elevatedWays.has(wayId)) { excludedLinkWays.add(wayId); excludedLinkLength += len; }
const isExcludedLink = (s) => s.highway.endsWith('_link') && excludedLinkWays.has(s.wayId);

// ---- boulevard merge ------------------------------------------------------
// Travel-oriented tangent of a segment at a sample (oneway=-1 geometry runs
// against the legal travel direction).
const travelTan = (seg, t) => (seg.reverse ? { tx: -t.tx, tz: -t.tz } : t);
// "Something between them" test (issue #30): sampled points of elevated
// NON-LINK carriageways (decks, viaducts). Link ramps are excluded —
// they braid between carriageways at every interchange and say nothing
// about adjacency. Used only as one half of the combined rejection in
// pairEval; it never excludes individual samples.
const elevatedGrid = new Map();
for (const s of segments) {
  if (!isElevatedTags(s) || s.highway.endsWith('_link')) continue;
  const n = Math.max(2, Math.round(s.length / 4));
  for (let i = 0; i <= n; i++) {
    const p = pointAt(s.pts, s.cum, (s.length * i) / n);
    const k = `${Math.floor(p.x / 25)},${Math.floor(p.z / 25)}`;
    if (!elevatedGrid.has(k)) elevatedGrid.set(k, []);
    elevatedGrid.get(k).push([p.x, p.z, s]);
  }
}
// exA/exB: the two segments being tested — a connector ENDS on its own
// centrelines by construction, so their own points never count.
const nearElevated = (x, z, exA, exB) => {
  for (let gx = Math.floor((x - 4) / 25); gx <= Math.floor((x + 4) / 25); gx++)
    for (let gz = Math.floor((z - 4) / 25); gz <= Math.floor((z + 4) / 25); gz++) {
      const cell = elevatedGrid.get(`${gx},${gz}`) || [];
      for (const [ex, ez, seg] of cell) {
        if (seg === exA || seg === exB) continue;
        if (Math.hypot(ex - x, ez - z) <= 4) return true;
      }
    }
  return false;
};
const crossesElevated = (a, b, exA, exB) => {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.max(1, Math.ceil(len / 4));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (nearElevated(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, exA, exB)) return true;
  }
  return false;
};
// Score a candidate pair. Returns null when the pairing tests fail, else
// { meanDist, rangeA, rangeB } with the arc-length overlap ranges.
const OPPOSING_DOT = Math.cos((140 * Math.PI) / 180); // travel tangents must oppose within 40 deg
function pairEval(A, B) {
  if (A.wayId === B.wayId) return null;
  // Cheap pre-filter: travel chords must roughly oppose.
  const chord = (s) => {
    const a = s.pts[0], b = s.pts[s.pts.length - 1];
    let dx = b[0] - a[0], dz = b[1] - a[1];
    if (s.reverse) { dx = -dx; dz = -dz; }
    const n = Math.hypot(dx, dz);
    return n > 1 ? [dx / n, dz / n] : null;
  };
  const ca = chord(A), cb = chord(B);
  if (!ca || !cb) return null;
  if (ca[0] * cb[0] + ca[1] * cb[1] > -0.5) return null;
  // Bounding boxes must come within MAX_PAIR_DIST_M of each other.
  const bb = (s) => s.pts.reduce((m, p) => ({ x0: Math.min(m.x0, p[0]), x1: Math.max(m.x1, p[0]), z0: Math.min(m.z0, p[1]), z1: Math.max(m.z1, p[1]) }), { x0: 1e18, x1: -1e18, z0: 1e18, z1: -1e18 });
  const ba = bb(A), bk = bb(B);
  if (ba.x0 - MAX_PAIR_DIST_M > bk.x1 || bk.x0 - MAX_PAIR_DIST_M > ba.x1 || ba.z0 - MAX_PAIR_DIST_M > bk.z1 || bk.z0 - MAX_PAIR_DIST_M > ba.z1) return null;
  // Sampled test, both directions: a sample is "good" when its closest point
  // on the other centreline is within range AND the travel tangents there
  // oppose (this rejects junction crossovers, whose tangents do not).
  // Returns the good arc-length range plus two quality measures: coverage
  // (the range's share of S) and density (the good share inside the range).
  const sampleTest = (S, T) => {
    const step = 3;
    const n = Math.max(2, Math.round(S.length / step));
    let good = 0, distSum = 0, sMin = Infinity, sMax = -Infinity, blocked = 0;
    const flags = [];
    for (let i = 0; i <= n; i++) {
      const s = (S.length * i) / n;
      const p = pointAt(S.pts, S.cum, s);
      const tp = travelTan(S, p);
      const cp = closestOn(T.pts, T.cum, p.x, p.z);
      const tt = travelTan(T, cp);
      const ok = cp.d <= MAX_PAIR_DIST_M && tp.tx * tt.tx + tp.tz * tt.tz < OPPOSING_DOT;
      if (ok && crossesElevated(p, cp, S, T)) blocked++;
      flags.push({ s, ok });
      if (ok) { good++; distSum += cp.d; if (s < sMin) sMin = s; if (s > sMax) sMax = s; }
    }
    if (!good) return null;
    const inRange = flags.filter((f) => f.s >= sMin && f.s <= sMax);
    if (!inRange.length) return null;
    return {
      range: [sMin, sMax],
      coverage: (sMax - sMin) / S.length,
      density: inRange.filter((f) => f.ok).length / inRange.length,
      distSum, good,
      blockedFrac: good ? blocked / good : 0,
    };
  };
  const ta = sampleTest(A, B), tb = sampleTest(B, A);
  if (!ta || !tb) return null;
  // Acceptance (issue #22): coverage is judged on the SHORTER segment —
  // OSM splits the two carriageways of a boulevard at different stations,
  // so the longer segment legitimately pairs over only part of its length
  // here and pairs with the NEXT counterpart segment over the rest (the
  // greedy assignment below allows disjoint multi-range claims). Both
  // sides must still pair densely inside their overlap range.
  const shortCoverage = A.length <= B.length ? ta.coverage : tb.coverage;
  if (shortCoverage < MIN_PAIR_OVERLAP) return null;
  if (ta.density < MIN_INRANGE_OVERLAP || tb.density < MIN_INRANGE_OVERLAP) return null;
  const meanDist = (ta.distSum + tb.distSum) / (ta.good + tb.good);
  // "Not adjacent" rejection (issue #30): a pair is rejected only when
  // BOTH (a) the bare gap between the ribbon edges exceeds
  // MAX_PAIR_GAP_M, and (b) an elevated through-carriageway runs
  // between them for most of the overlap. The 建國北路 ground pair is
  // the case: ~33 m of gap with the 建國快速道路 deck inside it — it
  // must stay two ground ribbons flanking the deck bed, not one 56 m
  // bed paved across it. A wide gap alone is NOT grounds for rejection:
  // twin-bore tunnels （象山/文山） and split expressway carriageways
  // legitimately run 20-35 m apart with nothing between them, and the
  // flat-world shape for them is still one clean wide ribbon.
  if (meanDist - (A.width + B.width) / 2 > MAX_PAIR_GAP_M && (ta.blockedFrac >= 0.5 || tb.blockedFrac >= 0.5)) return null;
  return { meanDist, rangeA: ta.range, rangeB: tb.range };
}

const candidates = segments.filter((s) => !isExcludedLink(s) && s.name && s.oneway && PAIR_CLASSES.has(s.highway) && s.length >= MIN_PAIR_SEGMENT_M);
// Underpass family resolution (issue #51, see UNDERPASS_SUFFIX above):
// parent candidates are road names the underpass name extends (minus
// the suffix, sections included), excluding elevated （高架） and other
// underground names; the winner is the one whose segment bbox contains
// the underpass segments' bbox centre (nearest centre breaks ties).
const segBBoxByName = new Map();
for (const s of segments) {
  if (!s.name) continue;
  let bb = segBBoxByName.get(s.name);
  if (!bb) { bb = [Infinity, -Infinity, Infinity, -Infinity]; segBBoxByName.set(s.name, bb); }
  for (const p of s.pts) { bb[0] = Math.min(bb[0], p[0]); bb[1] = Math.max(bb[1], p[0]); bb[2] = Math.min(bb[2], p[1]); bb[3] = Math.max(bb[3], p[1]); }
}
const familyParent = new Map(); // underpass name -> parent road name
for (const name of new Set(candidates.map((s) => s.name))) {
  if (!name.endsWith(UNDERPASS_SUFFIX)) continue;
  const base = name.slice(0, -UNDERPASS_SUFFIX.length);
  const ub = segBBoxByName.get(name);
  const ucx = (ub[0] + ub[1]) / 2, ucz = (ub[2] + ub[3]) / 2;
  let best = null;
  for (const [other, bb] of segBBoxByName) {
    if (other === name || other.endsWith('地下道') || other.includes('高架')) continue;
    if (!(name.startsWith(other) || other.startsWith(base))) continue;
    const inside = ucx >= bb[0] && ucx <= bb[1] && ucz >= bb[2] && ucz <= bb[3];
    const score = (inside ? 0 : 1e12) + Math.hypot((bb[0] + bb[1]) / 2 - ucx, (bb[2] + bb[3]) / 2 - ucz);
    if (!best || score < best.score) best = { parent: other, score };
  }
  if (best) familyParent.set(name, best.parent);
}
const familyKey = (name) => familyParent.get(name) || name;
const byName = new Map();
for (const s of candidates) { const k = familyKey(s.name); if (!byName.has(k)) byName.set(k, []); byName.get(k).push(s); }
const pairEvals = [];
for (const group of byName.values()) {
  for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
    const ev = pairEval(group[i], group[j]);
    if (ev) pairEvals.push({ A: group[i], B: group[j], ...ev });
  }
}
pairEvals.sort((a, b) => a.meanDist - b.meanDist || a.A.wayId - b.A.wayId || a.B.wayId - b.B.wayId);
// Pairing claims: a segment may pair with SEVERAL counterparts over
// disjoint arc-length ranges (issue #22 — staggered carriageway
// segmentation). At a junction fan both neighbouring counterparts are
// within pairing distance of the same stretch, so a later pair's range
// is TRIMMED against the ranges already claimed: the largest free
// sub-range survives, and claims stay disjoint by construction.
const claims = new Map(); // segment -> [{ group, range }]
const claimedRanges = (seg) => claims.get(seg) || [];
const trimRange = (seg, range) => {
  let parts = [[range[0], range[1]]];
  for (const c of claimedRanges(seg)) {
    const next = [];
    for (const [a, b] of parts) {
      if (c.range[1] <= a || c.range[0] >= b) { next.push([a, b]); continue; }
      if (c.range[0] > a) next.push([a, c.range[0]]);
      if (c.range[1] < b) next.push([c.range[1], b]);
    }
    parts = next;
  }
  parts = parts.filter(([a, b]) => b - a >= MIN_CLAIM_RANGE_M);
  if (!parts.length) return null;
  return parts.reduce((best, p) => (p[1] - p[0] > best[1] - best[0] ? p : best));
};
const addClaim = (seg, group, range) => {
  if (!claims.has(seg)) claims.set(seg, []);
  claims.get(seg).push({ group, range });
};
// A group's GEOMETRY range is its claimed (accounting) range dilated by
// GROUP_DILATE_M at both ends: adjacent groups' midlines diverge at a
// fork, so beds built strictly on abutting claimed ranges leave a wedge
// of bare ground at the boundary. The dilation overlaps the neighbour
// bed slightly (same asphalt colour/material — invisible) and closes
// the wedge. Accounting (tails, length identity) uses the undilated
// claimed ranges only.
const dilate = (seg, range) => [Math.max(0, range[0] - GROUP_DILATE_M), Math.min(seg.length, range[1] + GROUP_DILATE_M)];
const groups = [];
for (const ev of pairEvals) {
  const rangeA = trimRange(ev.A, ev.rangeA);
  const rangeB = trimRange(ev.B, ev.rangeB);
  if (!rangeA || !rangeB) continue;
  const g = {
    members: [
      { seg: ev.A, range: rangeA, geoRange: dilate(ev.A, rangeA) },
      { seg: ev.B, range: rangeB, geoRange: dilate(ev.B, rangeB) },
    ],
    primary: ev.A,
  };
  groups.push(g);
  addClaim(ev.A, g, rangeA); addClaim(ev.B, g, rangeB);
}
// Build a group's merged centreline + width from its current members.
// Parameterised on the primary member's overlap range; at each sample the
// centreline is the centroid of the members' closest points, and the width
// is the lateral span across all members (median over samples).
function groupGeometry(g) {
  const P = g.primary;
  const range = g.members.find((m) => m.seg === P).geoRange;
  const step = 2;
  const n = Math.max(2, Math.round((range[1] - range[0]) / step));
  const mids = [], spans = [], pairDists = [];
  for (let i = 0; i <= n; i++) {
    const s = range[0] + ((range[1] - range[0]) * i) / n;
    const p = pointAt(P.pts, P.cum, s);
    const ptsHere = [];
    for (const m of g.members) {
      if (m.seg === P) { ptsHere.push({ x: p.x, z: p.z, w: P.width }); continue; }
      const cp = closestOn(m.seg.pts, m.seg.cum, p.x, p.z);
      // A member shapes the centreline only where it actually runs:
      // without the arc-length gate, a short member's ENDPOINT is the
      // closest point for samples far past its end and drags the group
      // centroid sideways (issue #51 — a portal stub pulled the
      // 基隆路 family bed off the underpass pair's alignment, opening
      // a bare seam beside it).
      if (cp.d <= MAX_PAIR_DIST_M && cp.s >= m.geoRange[0] - 2 && cp.s <= m.geoRange[1] + 2) ptsHere.push({ x: cp.x, z: cp.z, w: m.seg.width });
    }
    if (ptsHere.length < 2) continue;
    const mx = ptsHere.reduce((a, c) => a + c.x, 0) / ptsHere.length;
    const mz = ptsHere.reduce((a, c) => a + c.z, 0) / ptsHere.length;
    mids.push([mx, mz]);
    const nx = -p.tz, nz = p.tx;
    const offs = ptsHere.map((c) => (c.x - mx) * nx + (c.z - mz) * nz);
    spans.push(Math.max(...ptsHere.map((c, i) => offs[i] + c.w / 2)) - Math.min(...ptsHere.map((c, i) => offs[i] - c.w / 2)));
    if (ptsHere.length === 2) pairDists.push(Math.hypot(ptsHere[0].x - ptsHere[1].x, ptsHere[0].z - ptsHere[1].z));
  }
  if (mids.length < 2) return null;
  let width = median(spans);
  if (g.members.length === 2 && pairDists.length) {
    const [m0, m1] = g.members;
    // The spec formula for a pair: w1 + w2 + median gap between centrelines.
    width = Math.max(width, m0.seg.width + m1.seg.width + Math.max(0, median(pairDists) - (m0.seg.width + m1.seg.width) / 2));
  }
  width = Math.max(width, ...g.members.map((m) => m.seg.width));
  const centreline = rdp(mids.filter((p, i) => i === 0 || Math.hypot(p[0] - mids[i - 1][0], p[1] - mids[i - 1][1]) > 0.05), SIMPLIFY_EPS_M);
  return { centreline, width: Math.round(width * 10) / 10, length: lineLength(centreline) };
}
// Group extension: an unpaired candidate running alongside a merged group
// (same name — e.g. a tree-separated slow lane) joins it when most of its
// length lies within pairing distance of the group's centreline, travelling
// parallel OR opposing (a slow lane travels WITH its carriageway).
{
  const PARALLEL_DOT = Math.cos((35 * Math.PI) / 180);
  let joined = true;
  while (joined) {
    joined = false;
    for (const C of candidates) {
      if (claims.has(C)) continue; // extension is for wholly unpaired candidates only
      let best = null;
      for (const g of groups) {
        if (familyKey(g.members[0].seg.name) !== familyKey(C.name) || g.members.length >= MAX_GROUP_MEMBERS) continue;
        const geo = groupGeometry(g);
        if (!geo || geo.centreline.length < 2) continue;
        const cum = cumLen(geo.centreline);
        const n = Math.max(2, Math.round(C.length / 3));
        let good = 0, distSum = 0, sMin = Infinity, sMax = -Infinity;
        for (let i = 0; i <= n; i++) {
          const s = (C.length * i) / n;
          const p = pointAt(C.pts, C.cum, s);
          const tp = travelTan(C, p);
          const cp = closestOn(geo.centreline, cum, p.x, p.z);
          const dot = tp.tx * cp.tx + tp.tz * cp.tz;
          if (cp.d <= MAX_PAIR_DIST_M && Math.abs(dot) > PARALLEL_DOT) { good++; distSum += cp.d; if (s < sMin) sMin = s; if (s > sMax) sMax = s; }
        }
        // Median-gap rule, extension form: the candidate must sit at
        // the group's edge (gap to the group ribbon within the bound),
        // not across a deck or another road.
        if (good / (n + 1) >= MIN_PAIR_OVERLAP && distSum / good - (C.width + geo.width) / 2 <= MAX_PAIR_GAP_M && (!best || distSum / good < best.meanDist)) best = { g, range: [sMin, sMax], meanDist: distSum / good };
      }
      if (best) { best.g.members.push({ seg: C, range: best.range, geoRange: best.range }); addClaim(C, best.g, best.range); joined = true; }
    }
  }
}

// ---- emission --------------------------------------------------------------
const CLASS_RANK = { motorway: 0, trunk: 1, primary: 2, secondary: 3, tertiary: 4, unclassified: 5, residential: 6, living_street: 7, road: 8, busway: 9, service: 10 };
const roadbeds = [];
let mergedConstituentOverlapLength = 0, mergedLength = 0, droppedScrapLength = 0, roadbedLength = 0;
const mergedReport = [];
const flatLength = (flat) => { let L = 0; for (let i = 2; i < flat.length; i += 2) L += Math.hypot(flat[i] - flat[i - 2], flat[i + 1] - flat[i - 1]); return L; };
const pushRoadbed = (entry) => { roadbeds.push(entry); roadbedLength += flatLength(entry.centreline); };
let simplificationShorteningM = 0; // single beds only (merged shortening cancels out of the length identity)
const singleEntry = (seg, pts) => {
  const simplified = rdp(pts, SIMPLIFY_EPS_M);
  simplificationShorteningM += lineLength(pts) - lineLength(simplified);
  return {
    name: seg.name, highway: seg.highway, centreline: flatQ(simplified), width: seg.width,
    pedestrianLayout: seg.pedestrianLayout, sourceWayIds: [seg.wayId],
    ...(isDeckSegment(seg) ? { deck: true } : {}),
    // Issue #249: carry the OSM one-way tag so the markings layer can
    // tell a one-way street (no opposing traffic, no centre line)
    // from a two-way one — roadbeds previously carried no oneway
    // flag, and the lane rule's "unmerged bed = two-way" reading
    // was a stated limit. Merged beds never carry it: a merged bed
    // is a divided pair by construction.
    ...(seg.oneway ? { oneway: true } : {}),
  };
};
// Wholly unpaired segments render as single roadbeds.
for (const seg of segments) {
  if (isExcludedLink(seg)) continue;
  if (!claims.has(seg)) pushRoadbed(singleEntry(seg, seg.pts));
}
// One merged roadbed per group.
for (const g of groups) {
  const geo = groupGeometry(g);
  if (!geo) { // pairing collapsed under resampling: fall back to range singles
    for (const m of g.members) {
      const mid = splitAt(m.seg.pts, m.seg.cum, m.range[0], m.range[1])[1];
      if (mid) pushRoadbed(singleEntry(m.seg, mid));
    }
    continue;
  }
  const widest = g.members.reduce((a, m) => (m.seg.width > a.seg.width ? m : a), g.members[0]);
  const highway = g.members.map((m) => m.seg.highway).sort((a, b) => (CLASS_RANK[a] ?? 99) - (CLASS_RANK[b] ?? 99))[0];
  // A merged bed inherits the widest constituent carriageway's layout —
  // except painted: §c.3's band is a per-carriageway-scale treatment for
  // 8–12 m streets, and the merged span (boulevards, elevated expressways,
  // bridges) is not a carriageway. A >12 m span whose widest constituent
  // happens to be 8–12 m takes the boulevard layout instead (issue #16).
  const mergedLayout = widest.seg.pedestrianLayout === 'painted' && geo.width > 12
    ? 'sidewalk'
    : widest.seg.pedestrianLayout;
  // A mixed underpass/surface group is the surface road's bed (issue
  // #51 family pairing): it takes the widest surface member's name.
  // An underpass-only group keeps the underpass name.
  const surfWidest = g.members.filter((m) => !m.seg.name.endsWith(UNDERPASS_SUFFIX))
    .reduce((a, m) => (a === null || m.seg.width > a.seg.width ? m : a), null);
  const bedName = g.primary.name.endsWith(UNDERPASS_SUFFIX) && surfWidest ? surfWidest.seg.name : g.primary.name;
  pushRoadbed({
    name: bedName, highway, centreline: flatQ(geo.centreline), width: geo.width,
    pedestrianLayout: mergedLayout,
    sourceWayIds: g.members.map((m) => m.seg.wayId),
    merged: true, constituentWidths: g.members.map((m) => m.seg.width),
    // A merged bed is a deck bed when its elevated members carry a
    // real share of the group's claimed length. The original rule
    // (ANY member) covered the genuine structures with incomplete
    // OSM layer tagging on one carriageway （麥帥一橋， 環河快速道
    // 路： the tagged twin spans the full group, ~50% of claimed
    // length) — but issue #102's north exposed the dual case: a
    // ground boulevard whose chain includes one short bridge
    // segment （大度路一段 over the Guandu drainage, ~40 m of a
    // 574 m group, ~4% share) inherited the flag with no deck
    // geometry under most of its length, failing the coverage
    // invariant. Threshold 35%: below every full-length twin
    // structure, above every local bridge hop; the short bridge
    // segment then simply renders as part of the ground bed, like
    // every other at-grade stream crossing.
    ...((() => {
      let deckLen = 0, totLen = 0;
      for (const m of g.members) {
        const L = m.range[1] - m.range[0];
        totLen += L;
        if (isDeckSegment(m.seg)) deckLen += L;
      }
      return totLen > 0 && deckLen / totLen >= 0.35 ? { deck: true } : {};
    })()),
  });
  mergedLength += geo.length;
  mergedReport.push({
    name: bedName, highway, width: geo.width,
    members: g.members.map((m) => m.seg.wayId), memberWidths: g.members.map((m) => m.seg.width),
    layers: g.members.map((m) => m.seg.layer || '0'), length: Math.round(geo.length),
  });
  for (const m of g.members) mergedConstituentOverlapLength += m.range[1] - m.range[0];
}
// Members' unclaimed ranges (the complement of their pairing claims —
// with multi-range claims a segment can have a middle or several tails)
// survive as single roadbeds.
for (const seg of segments) {
  if (isExcludedLink(seg) || !claims.has(seg)) continue;
  const ranges = claimedRanges(seg).map((c) => c.range).sort((a, b) => a[0] - b[0]);
  const gaps = [];
  let cursor = 0;
  for (const r of ranges) { if (r[0] > cursor + 0.01) gaps.push([cursor, r[0]]); cursor = Math.max(cursor, r[1]); }
  if (cursor < seg.length - 0.01) gaps.push([cursor, seg.length]);
  for (const [s0, s1] of gaps) {
    const part = splitAt(seg.pts, seg.cum, s0, s1)[1];
    if (!part) continue;
    const tl = lineLength(part);
    if (tl >= TAIL_MIN_LENGTH_M) pushRoadbed(singleEntry(seg, part));
    else droppedScrapLength += tl;
  }
}

// ---- shape pass: orphan suppression + frontage demotion (issue #30) -----
// Coverage is measured against ribbon POLYGONS (square-ended, as rendered),
// sampled every ~2 m along the candidate's centreline. Coverers are beds
// that are merged or strictly wider — a bed is never suppressed by equals
// or narrows, so duplicate-width neighbours cannot erase each other.
const pairsOf = (flat) => { const p = []; for (let i = 0; i < flat.length; i += 2) p.push([flat[i], flat[i + 1]]); return p; };
function bedRibbon(pts, width) {
  const half = Math.max((width || 3) / 2, 0.75);
  const L = [], R = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], c = pts[Math.min(pts.length - 1, i + 1)];
    let dx = c[0] - a[0], dz = c[1] - a[1];
    const n = Math.hypot(dx, dz) || 1; dx /= n; dz /= n;
    L.push([pts[i][0] - dz * half, pts[i][1] + dx * half]);
    R.push([pts[i][0] + dz * half, pts[i][1] - dx * half]);
  }
  return [...L, ...R.reverse()];
}
function pip(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > p[1]) !== (zj > p[1]) && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
// Park service-drive exclusion (issues #74 + #83, constants above):
// drop UNNAMED highway=service roadbeds lying >= PARK_SERVICE_INSIDE
// inside the union of leisure=park polygons; named beds over the
// same threshold are kept and reported as exemptions. Runs before
// the underpass dedup so excluded drives cannot act as coverers
// there or in the orphan pass. Park rings come from osm_parks.json
// (same el.rings / closed-way assembly as build-taipei-geodata.mjs);
// the file is an optional input — absent means the rule is inert.
const parkServiceReport = [];
const parkServiceExemptions = [];
let parkServiceExcludedLength = 0;
{
  const parksPath = path.join(DATA, 'osm_parks.json');
  if (fs.existsSync(parksPath)) {
    const parkPolys = [];
    for (const el of load('osm_parks.json').elements) {
      if (el.tags?.leisure !== 'park') continue;
      const name = el.tags?.name || '';
      const rings = el.rings
        ? el.rings.map((r) => r.map((g) => toWorld(g.lon, g.lat)))
        : (el.geometry && el.geometry.length >= 4 ? [[...el.geometry.map((g) => toWorld(g.lon, g.lat))]] : []);
      for (const ring of rings) {
        if (ring.length < 4) continue;
        const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]);
        parkPolys.push({ name, ring, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) });
      }
    }
    if (!parkPolys.length) {
      console.error('[generation-map] FATAL: osm_parks.json present but no leisure=park polygon assembled — the park service rule has rotted (parks retagged?). Fix or remove it.');
      process.exit(1);
    }
    for (const name of PARK_SERVICE_CRITICAL) {
      if (!parkPolys.some((p) => p.name === name)) {
        console.error(`[generation-map] FATAL: critical park "${name}" matched no park ring — the rule has rotted (park renamed or retagged?). Fix or remove it.`);
        process.exit(1);
      }
    }
    const keep = new Array(roadbeds.length).fill(true);
    roadbeds.forEach((b, bi) => {
      if (b.highway !== 'service') return;
      const pts = pairsOf(b.centreline);
      const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
      const cand = parkPolys.filter((pp) => pp.minX <= Math.max(...xs) && pp.maxX >= Math.min(...xs) && pp.minZ <= Math.max(...zs) && pp.maxZ >= Math.min(...zs));
      if (!cand.length) return;
      const cum = cumLen(pts);
      const total = cum[cum.length - 1];
      if (!(total > 0)) return;
      const n = Math.max(2, Math.round(total / 2));
      let inside = 0;
      const perPark = new Map();
      for (let i = 0; i <= n; i++) {
        const p = pointAt(pts, cum, (total * i) / n);
        let hit = false;
        for (const pp of cand) {
          if (p.x < pp.minX || p.x > pp.maxX || p.z < pp.minZ || p.z > pp.maxZ) continue;
          if (pip([p.x, p.z], pp.ring)) { hit = true; perPark.set(pp, (perPark.get(pp) || 0) + 1); }
        }
        if (hit) inside++;
      }
      if (inside / (n + 1) < PARK_SERVICE_INSIDE) return;
      const len = flatLength(b.centreline);
      const dom = [...perPark.entries()].sort((a, c) => c[1] - a[1])[0];
      const parkName = dom ? dom[0].name : '';
      const insidePct = Math.round((inside / (n + 1)) * 100);
      if (b.name) {
        // Named = addressed street, not site circulation: keep the
        // bed, but record the exemption so it stays auditable.
        parkServiceExemptions.push({ name: b.name, park: parkName, highway: b.highway, sourceWayIds: b.sourceWayIds, lengthM: Math.round(len), insidePct, reason: 'named-street-inside-park' });
        return;
      }
      keep[bi] = false;
      parkServiceExcludedLength += len;
      parkServiceReport.push({ name: b.name, park: parkName, highway: b.highway, sourceWayIds: b.sourceWayIds, lengthM: Math.round(len), insidePct, reason: 'park-service' });
    });
    if (!parkServiceReport.length) {
      console.error('[generation-map] FATAL: park service exclusion matched zero roadbeds — the rule has rotted (drives retagged or already removed?). Fix or remove it.');
      process.exit(1);
    }
    for (const name of PARK_SERVICE_CRITICAL) {
      if (!parkServiceReport.some((r) => r.park === name)) {
        console.error(`[generation-map] FATAL: critical park "${name}" contributed zero dropped roadbeds — the #74 landmark guarantee has rotted (drives retagged or already removed?). Fix or remove it.`);
        process.exit(1);
      }
    }
    const kept = roadbeds.filter((_, i) => keep[i]);
    roadbeds.length = 0;
    roadbeds.push(...kept);
    roadbedLength -= parkServiceExcludedLength;
    const parkCount = new Set(parkServiceReport.map((r) => r.park)).size;
    console.log(`[generation-map] park service exclusion (issue #83): ${parkServiceReport.length} unnamed roadbeds across ${parkCount} parks/plazas dropped, ${(parkServiceExcludedLength / 1000).toFixed(2)} km; ${parkServiceExemptions.length} named beds inside parks kept as exemptions`);
  }
}

// Underpass dedup (issue #51): an underpass-named bed whose centreline
// is >= UNDERPASS_DEDUP_COVER covered by differently-named beds is a
// duplicate underlay of the surface road — suppress it (its length is
// booked into suppressedLength below, keeping the length identity
// closed). Runs before the orphan pass so duplicate underpass beds
// cannot act as coverers there. Self-contained geometry: the shared
// bedGeoms grid below is built from the post-dedup array.
const dedupedReport = [];
let dedupedLength = 0;
{
  const geoms = roadbeds.map((b) => {
    const pts = pairsOf(b.centreline);
    return { pts, cum: cumLen(pts), poly: bedRibbon(pts, b.width) };
  });
  const grid = new Map();
  geoms.forEach((g, i) => {
    if (roadbeds[i].name.endsWith(UNDERPASS_SUFFIX)) return; // coverers are surface beds only
    const xs = g.poly.map((p) => p[0]), zs = g.poly.map((p) => p[1]);
    for (let gx = Math.floor(Math.min(...xs) / 100); gx <= Math.floor(Math.max(...xs) / 100); gx++)
      for (let gz = Math.floor(Math.min(...zs) / 100); gz <= Math.floor(Math.max(...zs) / 100); gz++) {
        const k = `${gx},${gz}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(i);
      }
  });
  const keep = new Array(roadbeds.length).fill(true);
  roadbeds.forEach((b, bi) => {
    if (!b.name.endsWith(UNDERPASS_SUFFIX)) return;
    const { pts, cum } = geoms[bi];
    const total = cum[cum.length - 1];
    const n = Math.max(2, Math.round(total / 2));
    let cov = 0;
    for (let i = 0; i <= n; i++) {
      const p = pointAt(pts, cum, (total * i) / n);
      const cand = grid.get(`${Math.floor(p.x / 100)},${Math.floor(p.z / 100)}`) || [];
      for (const oj of cand) { if (pip([p.x, p.z], geoms[oj].poly)) { cov++; break; } }
    }
    if (cov / (n + 1) >= UNDERPASS_DEDUP_COVER) {
      keep[bi] = false;
      const len = flatLength(b.centreline);
      dedupedLength += len;
      dedupedReport.push({ name: b.name, highway: b.highway, sourceWayIds: b.sourceWayIds, lengthM: Math.round(len), coveredPct: Math.round((cov / (n + 1)) * 100), reason: 'underpass-duplicate' });
    }
  });
  if (dedupedReport.length) {
    const kept = roadbeds.filter((_, i) => keep[i]);
    roadbeds.length = 0;
    roadbeds.push(...kept);
    roadbedLength -= dedupedLength;
  }
}

const bedGeoms = roadbeds.map((b) => {
  const pts = pairsOf(b.centreline);
  return { pts, cum: cumLen(pts), poly: bedRibbon(pts, b.width) };
});
const bedGrid = new Map();
bedGeoms.forEach((g, i) => {
  const xs = g.poly.map((p) => p[0]), zs = g.poly.map((p) => p[1]);
  for (let gx = Math.floor(Math.min(...xs) / 100); gx <= Math.floor(Math.max(...xs) / 100); gx++)
    for (let gz = Math.floor(Math.min(...zs) / 100); gz <= Math.floor(Math.max(...zs) / 100); gz++) {
      const k = `${gx},${gz}`;
      if (!bedGrid.has(k)) bedGrid.set(k, []);
      bedGrid.get(k).push(i);
    }
});
const sampleCover = (bi, covererOk) => {
  const { pts, cum } = bedGeoms[bi];
  const total = cum[cum.length - 1];
  const n = Math.max(2, Math.round(total / 2));
  let cov = 0;
  for (let i = 0; i <= n; i++) {
    const p = pointAt(pts, cum, (total * i) / n);
    const cand = bedGrid.get(`${Math.floor(p.x / 100)},${Math.floor(p.z / 100)}`) || [];
    for (const oj of cand) {
      if (oj === bi || !covererOk(oj)) continue;
      if (pip([p.x, p.z], bedGeoms[oj].poly)) { cov++; break; }
    }
  }
  return cov / (n + 1);
};
const suppressedReport = [...dedupedReport];
const demotedReport = [];
let suppressedLength = dedupedLength;
{
  const keep = new Array(roadbeds.length).fill(true);
  roadbeds.forEach((b, bi) => {
    if (b.merged) return;
    if (b.highway.endsWith('_link')) return; // links are connectors (ramps), never fragments — they stay (issues #22/#30)
    const len = flatLength(b.centreline);
    if (len > 1000) return; // longer than 1 km is a road, not a fragment (documented cap)
    const covMW = sampleCover(bi, (oj) => roadbeds[oj].merged || roadbeds[oj].width > b.width + 0.05);
    if ((covMW >= ORPHAN_COVER && len <= ORPHAN_SHORT_M) || covMW >= ORPHAN_COVER_LONG) {
      keep[bi] = false;
      suppressedLength += len;
      suppressedReport.push({ name: b.name, highway: b.highway, sourceWayIds: b.sourceWayIds, lengthM: Math.round(len), coveredPct: Math.round(covMW * 100) });
      return;
    }
    if (b.pedestrianLayout === 'painted') {
      const fracWider = sampleCover(bi, (oj) => roadbeds[oj].width > b.width + 0.05);
      if (fracWider >= FRONTAGE_INSIDE) {
        b.pedestrianLayout = 'shared';
        demotedReport.push({ name: b.name, highway: b.highway, sourceWayIds: b.sourceWayIds, insidePct: Math.round(fracWider * 100) });
      }
    }
  });
  if (suppressedReport.length) {
    const kept = roadbeds.filter((_, i) => keep[i]);
    roadbeds.length = 0;
    roadbeds.push(...kept);
    roadbedLength -= suppressedLength;
  }
}

// ---- airfield tunnel suppression (issue #183, rework v5) -------------------
// Runs last, over the final bed set. A bed qualifies when EVERY source
// way is tunnel=yes in the raw extract AND its centreline crosses the
// Songshan aerodrome site (osm_aeroway.json relation rings — the same
// assembly build-taipei-geodata.mjs uses for the #134 site). The census
// behind the rule (2026-10): exactly one bed qualifies — the merged
// 復北地下道 bed (ways 95015334 + 137317902, 473.3 of its 494.6 m inside
// the site). Every other bed inside the site is a real at-grade road
// (敦化北路 terminal frontage, airside service roads, the taxi queue)
// and stays. The suppressed length books into airfieldTunnelLength so
// the length identity below stays closed; sub-apron scraps shorter
// than TUNNEL_APRON_MIN_M fold into the tunnel length instead of
// shipping as sliver beds.
const TUNNEL_APRON_MIN_M = 3;
const roadTunnels = [];
let airfieldTunnelLength = 0;
let approachCutLength = 0; // issue #196 (rework v6, below)
const approachCuts = [];
{
  const aeroPath = path.join(DATA, 'osm_aeroway.json');
  if (fs.existsSync(aeroPath)) {
    const siteRings = [];
    for (const el of load('osm_aeroway.json').elements) {
      if (el.type !== 'relation') continue;
      const rings = el.rings ? el.rings.map((r) => r.map((g) => toWorld(g.lon, g.lat))) : [];
      for (const ring of rings) if (ring.length >= 4) siteRings.push(ring);
    }
    if (!siteRings.length) {
      console.error('[generation-map] FATAL: osm_aeroway.json present but no aerodrome site ring assembled — the airfield tunnel rule has rotted. Fix or remove it.');
      process.exit(1);
    }
    const wayTags = new Map();
    for (const el of load('osm_roads.json').elements) if (el.type === 'way') wayTags.set(el.id, el.tags || {});
    const inSite = (p) => siteRings.some((ring) => pip(p, ring));
    // Arc-length intervals of a centreline inside the site rings:
    // collect every segment/ring-edge crossing, then test the
    // midpoint of each elementary span.
    const insideIntervals = (pts, cum) => {
      const cuts = new Set([0, cum[cum.length - 1]]);
      for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
        const dx = bx - ax, dz = bz - az;
        for (const ring of siteRings) {
          for (let j = 0, k = ring.length - 1; j < ring.length; k = j++) {
            const [x1, z1] = ring[k], [x2, z2] = ring[j];
            const ex = x2 - x1, ez = z2 - z1, den = dx * ez - dz * ex;
            if (Math.abs(den) < 1e-12) continue;
            const t = ((x1 - ax) * ez - (z1 - az) * ex) / den, u = ((x1 - ax) * dz - (z1 - az) * dx) / den;
            if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.add(cum[i] + t * (cum[i + 1] - cum[i]));
          }
        }
      }
      const sorted = [...cuts].sort((a, b) => a - b);
      const intervals = [];
      for (let i = 0; i + 1 < sorted.length; i++) {
        if (sorted[i + 1] - sorted[i] < 0.01) continue;
        const mid = pointAt(pts, cum, (sorted[i] + sorted[i + 1]) / 2);
        if (inSite([mid.x, mid.z])) {
          const last = intervals[intervals.length - 1];
          if (last && sorted[i] - last[1] < 0.01) last[1] = sorted[i + 1];
          else intervals.push([sorted[i], sorted[i + 1]]);
        }
      }
      return intervals;
    };
    // The sub-polyline between arc lengths a..b (splitAt's inner
    // construction, generalised to any range).
    const subline = (pts, cum, a, b) => {
      if (b - a < 0.01) return null;
      const out = [];
      const pa = pointAt(pts, cum, a);
      out.push([pa.x, pa.z]);
      for (let i = 0; i < pts.length; i++) if (cum[i] > a + 0.01 && cum[i] < b - 0.01) out.push(pts[i]);
      const pb = pointAt(pts, cum, b);
      const last = out[out.length - 1];
      if (Math.hypot(pb.x - last[0], pb.z - last[1]) > 0.01) out.push([pb.x, pb.z]);
      return out.length >= 2 ? out : null;
    };
    const kept = [];
    for (const b of roadbeds) {
      const allTunnel = b.sourceWayIds.length > 0 && b.sourceWayIds.every((w) => (wayTags.get(w) || {}).tunnel === 'yes');
      if (!allTunnel) { kept.push(b); continue; }
      const pts = pairsOf(b.centreline);
      const cum = cumLen(pts);
      const intervals = insideIntervals(pts, cum);
      if (!intervals.length) { kept.push(b); continue; }
      const total = cum[cum.length - 1];
      const bedLen = flatLength(b.centreline);
      let keptLen = 0, tunnelGeoLen = 0;
      const runs = [], mouths = [];
      for (const [s0, s1] of intervals) {
        const mid = subline(pts, cum, s0, s1);
        if (mid) { const f = flatQ(mid); runs.push(f); tunnelGeoLen += flatLength(f); }
        const pa = pointAt(pts, cum, s0), pb = pointAt(pts, cum, s1);
        // (tx, tz) always points INTO the tunnel from the mouth.
        mouths.push({ x: q(pa.x), z: q(pa.z), tx: q(pa.tx), tz: q(pa.tz) });
        mouths.push({ x: q(pb.x), z: q(pb.z), tx: q(-pb.tx), tz: q(-pb.tz) });
      }
      const outside = [];
      let cursor = 0;
      for (const [s0, s1] of intervals) { if (s0 > cursor + 0.01) outside.push([cursor, s0]); cursor = Math.max(cursor, s1); }
      if (cursor < total - 0.01) outside.push([cursor, total]);
      const stubs = [];
      for (const [s0, s1] of outside) {
        if (s1 - s0 < TUNNEL_APRON_MIN_M) continue; // scrap: folds into the tunnel length below
        const part = subline(pts, cum, s0, s1);
        if (!part) continue;
        const stub = { ...b, centreline: flatQ(part) };
        stubs.push(stub);
        keptLen += flatLength(stub.centreline);
      }
      roadbedLength -= bedLen - keptLen;
      airfieldTunnelLength += bedLen - keptLen;
      roadTunnels.push({
        name: b.name, highway: b.highway, width: b.width, sourceWayIds: b.sourceWayIds,
        runs, mouths, lengthM: Math.round((bedLen - keptLen) * 10) / 10,
        ...(tunnelGeoLen > 0 ? { pavedM: Math.round(tunnelGeoLen * 10) / 10 } : {}),
      });
      kept.push(...stubs);
    }
    if (!roadTunnels.length) {
      console.error('[generation-map] FATAL: airfield tunnel suppression matched zero roadbeds — the rule has rotted (the 復北地下道 ways retagged or the site ring moved?). Fix or remove it.');
      process.exit(1);
    }
    roadbeds.length = 0;
    roadbeds.push(...kept);
    for (const t of roadTunnels) {
      console.log(`[generation-map] airfield tunnel (issue #183): "${t.name}" (${t.highway}, ${t.width} m, ways [${t.sourceWayIds.join(', ')}]) — ${t.lengthM} m suppressed inside the Songshan site, ${t.mouths.length} portal mouths, surface aprons kept`);
    }

    // ---- portal approach cuts (issue #196, rework v6) -----------------
    // v5 leaves each portal mouth as a headwall standing ON grade at
    // the site ring; a real portal is the bottom of an open cut — the
    // road ramps down into the ground over the run between the cross
    // street and the face (the user's reference photo of this very
    // portal: retaining walls sloping with the ramp, the face seated
    // in the hillside). v6 extends the suppression OUTWARD from each
    // mouth along the road axis: the flat beds inside the cut corridor
    // are clipped away (the airfield renderer's trench floor replaces
    // them), and the mouth records the cut (mouth.cut) so the renderer
    // can seat the face at the trench bottom.
    // The cut runs from the mouth toward the first junction and stops
    // ROAD_CUT_CLEARANCE_M short of the nearest bed endpoint on the
    // axis whose node carries a crossing arm (or no continuing arm) —
    // a junction keeps its apron — and never runs longer than
    // ROAD_CUT_MAX_M. Measured on the shipped tile: the south mouth is
    // junction-limited to ~33 m (the 民族東路 junction's merged-bed end
    // sits 46 m out; the junction cap's own surface reaches to ~33 m),
    // a steep but honest urban ramp; the north mouth runs ~96 m to
    // the 濱江街 clearance. A bed that merely CROSSES the corridor
    // mid-bed (the 迴轉道 loop's crossbar north of the field) is a
    // bridge over the cut, not part of the approach: it stays whole.
    // Removed length books into approachCutLength so the length
    // identity below stays closed.
    const ROAD_CUT_MAX_M = 110, ROAD_CUT_CLEARANCE_M = 13, ROAD_CUT_MIN_M = 20, ROAD_CUT_CLIP_MARGIN_M = 0.3;
    // Arc-length intervals of a centreline inside any of `rings`
    // (insideIntervals generalised from the site rings to one
    // corridor polygon).
    const polygonIntervals = (pts, cum, rings) => {
      const cuts = new Set([0, cum[cum.length - 1]]);
      for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
        const dx = bx - ax, dz = bz - az;
        for (const ring of rings) {
          for (let j = 0, k = ring.length - 1; j < ring.length; k = j++) {
            const [x1, z1] = ring[k], [x2, z2] = ring[j];
            const ex = x2 - x1, ez = z2 - z1, den = dx * ez - dz * ex;
            if (Math.abs(den) < 1e-12) continue;
            const t = ((x1 - ax) * ez - (z1 - az) * ex) / den, u = ((x1 - ax) * dz - (z1 - az) * dx) / den;
            if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.add(cum[i] + t * (cum[i + 1] - cum[i]));
          }
        }
      }
      const sorted = [...cuts].sort((a, b) => a - b);
      const intervals = [];
      for (let i = 0; i + 1 < sorted.length; i++) {
        if (sorted[i + 1] - sorted[i] < 0.01) continue;
        const mid = pointAt(pts, cum, (sorted[i] + sorted[i + 1]) / 2);
        if (rings.some((ring) => pip([mid.x, mid.z], ring))) {
          const last = intervals[intervals.length - 1];
          if (last && sorted[i] - last[1] < 0.01) last[1] = sorted[i + 1];
          else intervals.push([sorted[i], sorted[i + 1]]);
        }
      }
      return intervals;
    };
    // Bed endpoints of the final bed set; each incident direction
    // points AWAY from the endpoint along its bed. Beds meeting at
    // one junction rarely share exact endpoints (separate ways meet
    // approximately), so per mouth the endpoints near the axis are
    // single-linkage clustered (12 m) and judged as one node.
    const endpoints = [];
    for (const b of roadbeds) {
      const pts = pairsOf(b.centreline);
      if (pts.length < 2) continue;
      const d0 = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]], l0 = Math.hypot(d0[0], d0[1]) || 1;
      endpoints.push({ x: pts[0][0], z: pts[0][1], dx: d0[0] / l0, dz: d0[1] / l0 });
      const pn = pts[pts.length - 1], pp = pts[pts.length - 2];
      const d1 = [pp[0] - pn[0], pp[1] - pn[1]], l1 = Math.hypot(d1[0], d1[1]) || 1;
      endpoints.push({ x: pn[0], z: pn[1], dx: d1[0] / l1, dz: d1[1] / l1 });
    }
    for (const t of roadTunnels) {
      const halfClip = t.width / 2 + ROAD_CUT_CLIP_MARGIN_M;
      for (const m of t.mouths) {
        const ox = -m.tx, oz = -m.tz; // out of the tunnel, along the road
        const nx = -oz, nz = ox;
        const near = endpoints.filter((e) => {
          const rx = e.x - m.x, rz = e.z - m.z;
          const d = rx * ox + rz * oz, lat = Math.abs(rx * nx + rz * nz);
          return d > -14 && d < ROAD_CUT_MAX_M + ROAD_CUT_CLEARANCE_M + 14 && lat < halfClip + 2;
        });
        const parent = near.map((_, i) => i);
        const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
        for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) {
          if (Math.hypot(near[i].x - near[j].x, near[i].z - near[j].z) < 12) { const a = find(i), b = find(j); if (a !== b) parent[a] = b; }
        }
        const clusters = new Map();
        near.forEach((e, i) => { const r = find(i); if (!clusters.has(r)) clusters.set(r, []); clusters.get(r).push(e); });
        let dLim = Infinity;
        for (const members of clusters.values()) {
          const dMin = Math.min(...members.map((e) => (e.x - m.x) * ox + (e.z - m.z) * oz));
          if (dMin < 2) continue; // the mouth's own cluster never limits its cut
          const crossing = members.some((e) => Math.abs(e.dx * ox + e.dz * oz) < 0.7);
          const continues = members.some((e) => e.dx * ox + e.dz * oz > 0.7);
          if (crossing || !continues) dLim = Math.min(dLim, dMin);
        }
        if (!Number.isFinite(dLim)) {
          console.error(`[generation-map] FATAL: no limiting junction found for the "${t.name}" portal mouth at (${m.x}, ${m.z}) — the approach-cut rule (issue #196) cannot place the cut.`);
          process.exit(1);
        }
        const lenM = Math.min(ROAD_CUT_MAX_M, dLim - ROAD_CUT_CLEARANCE_M);
        if (lenM < ROAD_CUT_MIN_M) {
          console.error(`[generation-map] FATAL: approach cut for the "${t.name}" portal mouth at (${m.x}, ${m.z}) would run only ${lenM.toFixed(1)} m (< ${ROAD_CUT_MIN_M} m) — the junction is too close for a trench; the portal needs a hand decision (issue #196).`);
          process.exit(1);
        }
        const ex = m.x + ox * lenM, ez = m.z + oz * lenM;
        const corridor = [
          [m.x + nx * halfClip, m.z + nz * halfClip], [ex + nx * halfClip, ez + nz * halfClip],
          [ex - nx * halfClip, ez - nz * halfClip], [m.x - nx * halfClip, m.z - nz * halfClip],
        ];
        let removedHere = 0, clippedBeds = 0;
        const after = [];
        for (const b of roadbeds) {
          const pts = pairsOf(b.centreline);
          const cum = cumLen(pts);
          const intervals = polygonIntervals(pts, cum, [corridor]);
          if (!intervals.length) { after.push(b); continue; }
          const total = cum[cum.length - 1];
          const touchesEnd = intervals.some(([s0, s1]) => s0 < 0.01 || s1 > total - 0.01);
          if (!touchesEnd && intervals.length === 1) {
            // Bridge exemption: the bed crosses the corridor mid-bed
            // and leaves both sides — it spans the cut at grade.
            const [s0, s1] = intervals[0];
            const pa = pointAt(pts, cum, s0), pb = pointAt(pts, cum, s1);
            const cl = Math.hypot(pb.x - pa.x, pb.z - pa.z) || 1;
            if (Math.abs(((pb.x - pa.x) / cl) * ox + ((pb.z - pa.z) / cl) * oz) < 0.5) { after.push(b); continue; }
          }
          const bedLen = flatLength(b.centreline);
          let keptLen = 0;
          const outside = [];
          let cursor = 0;
          for (const [s0, s1] of intervals) { if (s0 > cursor + 0.01) outside.push([cursor, s0]); cursor = Math.max(cursor, s1); }
          if (cursor < total - 0.01) outside.push([cursor, total]);
          for (const [s0, s1] of outside) {
            if (s1 - s0 < TUNNEL_APRON_MIN_M) continue; // sliver: folds into the cut length
            const part = subline(pts, cum, s0, s1);
            if (!part) continue;
            after.push({ ...b, centreline: flatQ(part) });
            keptLen += flatLength(flatQ(part));
          }
          removedHere += bedLen - keptLen;
          clippedBeds++;
        }
        roadbeds.length = 0;
        roadbeds.push(...after);
        roadbedLength -= removedHere;
        approachCutLength += removedHere;
        m.cut = { lenM: q(lenM), pts: [q(m.x), q(m.z), q(ex), q(ez)] };
        approachCuts.push({ tunnel: t.name, mouth: [q(m.x), q(m.z)], lenM: q(lenM), limitedByM: q(dLim), bedsClipped: clippedBeds, removedM: q(removedHere) });
        console.log(`[generation-map] portal approach cut (issue #196): "${t.name}" mouth (${m.x}, ${m.z}) — cut ${lenM.toFixed(1)} m (junction at ${dLim.toFixed(1)} m), ${clippedBeds} beds clipped, ${removedHere.toFixed(1)} m of flat bed replaced by the trench`);
      }
    }
  }
}

// ---- stats + output ----------------------------------------------------------
const stats = {
  carriagewayRuns: segments.length,
  carriagewayLength: Math.round(carriagewayLength * 10) / 10,
  linkWaysTotal: linkWayLength.size,
  linkWaysKept: linkWayLength.size - excludedLinkWays.size,
  linkWaysExcluded: excludedLinkWays.size,
  excludedLinkWayIds: [...excludedLinkWays].sort((a, b) => a - b),
  excludedLinkLength: Math.round(excludedLinkLength * 10) / 10,
  mergeGroups: mergedReport.length,
  mergedConstituentOverlapLength: Math.round(mergedConstituentOverlapLength * 10) / 10,
  mergedLength: Math.round(mergedLength * 10) / 10,
  droppedScrapLength: Math.round(droppedScrapLength * 10) / 10,
  suppressedLength: Math.round(suppressedLength * 10) / 10,
  suppressedBeds: suppressedReport,
  parkServiceExcludedLength: Math.round(parkServiceExcludedLength * 10) / 10,
  parkServiceExcludedBeds: parkServiceReport,
  airfieldTunnelLength: Math.round(airfieldTunnelLength * 10) / 10,
  approachCutLength: Math.round(approachCutLength * 10) / 10,
  approachCuts,
  airfieldTunnels: roadTunnels.map((t) => ({ name: t.name, highway: t.highway, width: t.width, sourceWayIds: t.sourceWayIds, lengthM: t.lengthM, mouths: t.mouths.length })),
  parkServiceNamedExemptions: parkServiceExemptions,
  underpassFamilies: [...familyParent.entries()].map(([underpass, parent]) => ({ underpass, parent })),
  underpassDedupBeds: dedupedReport,
  simplificationShorteningM: Math.round(simplificationShorteningM * 10) / 10,
  demotedFrontageBeds: demotedReport,
  roadbedCount: roadbeds.length,
  deckBeds: roadbeds.filter((b) => b.deck).length,
  roadbedLength: Math.round(roadbedLength * 10) / 10,
  overrides: [...overrideMatched.entries()].map(([name, matchedWays]) => ({ name, width: OVERRIDES[name], matchedWays })),
  mergedRoads: mergedReport,
};
const identity = stats.roadbedLength + stats.excludedLinkLength + stats.mergedConstituentOverlapLength - stats.mergedLength + stats.droppedScrapLength + stats.suppressedLength + stats.parkServiceExcludedLength + stats.airfieldTunnelLength + stats.approachCutLength + stats.simplificationShorteningM;
console.log(`[generation-map] length identity: roadbeds ${stats.roadbedLength} + excludedLinks ${stats.excludedLinkLength} + mergedOverlap ${stats.mergedConstituentOverlapLength} - merged ${stats.mergedLength} + scrap ${stats.droppedScrapLength} + suppressed ${stats.suppressedLength} + parkService ${stats.parkServiceExcludedLength} + airfieldTunnel ${stats.airfieldTunnelLength} + approachCut ${stats.approachCutLength} + simplifyShortening ${stats.simplificationShorteningM} = ${identity.toFixed(1)} vs carriageway ${stats.carriagewayLength} (delta ${(identity - stats.carriagewayLength).toFixed(1)} m)`);
const out = {
  version: 1,
  generatedBy: 'tools/taipei/build-generation-map.mjs',
  issue: 'https://github.com/hebe13579/slop-taipei/issues/6',
  frame: { origin: 'Taipei 101 (25.0330, 121.5650)', originLatLon: [LAT0, LON0], bearingDeg: 0, units: 'm', bbox: BBOX, boxes: BOXES_WORLD },
  roadbeds,
  roadTunnels,
  stats,
};
fs.writeFileSync(OUT, JSON.stringify(out) + '\n');
console.log(`[generation-map] carriageway runs: ${segments.length}, ${(carriagewayLength / 1000).toFixed(1)} km`);
console.log(`[generation-map] links: ${linkWayLength.size} ways, ${excludedLinkWays.size} excluded (< ${LINK_MIN_LENGTH_M} m, ${(excludedLinkLength / 1000).toFixed(2)} km), ${linkWayLength.size - excludedLinkWays.size} kept`);
console.log(`[generation-map] merges: ${mergedReport.length} groups`);
for (const m of mergedReport.sort((a, b) => b.width - a.width)) {
  console.log(`  MERGED ${m.name} (${m.highway}) width ${m.width} m, ${m.length} m — ways [${m.members.join(', ')}] widths [${m.memberWidths.join(', ')}] layers [${m.layers.join(', ')}]`);
}
console.log(`[generation-map] roadbeds: ${roadbeds.length}, ${(roadbedLength / 1000).toFixed(1)} km rendered`);
console.log(`[generation-map] wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
