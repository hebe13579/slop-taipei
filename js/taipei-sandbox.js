// js/taipei-sandbox.js
// Sandbox / demo mode: a small slice of the Taipei tile for iterating
// fixes fast, selected by ?sandbox=<lat>,<lng>,<radius_m> or a district
// preset (?sandbox=xinyi). User-approved 2026-11-02.
//
// How it works: the whole city is one generated file
// (js/taipei-geodata.js — DO NOT hand-edit it). This module is the thin
// wrapper the three importers (js/taipei-adapter.js, js/taipei-tile.js,
// js/taipei-traffic.js) read instead of the generated file: when the
// ?sandbox= param is present it filters the generated geo down to a
// square box at load time and returns the filtered copy; with no param
// it returns the generated geo untouched — the identical object, so the
// live site cannot change. Everything downstream (planner, adapter,
// boot, traffic) is unchanged: the planner already drops lots outside
// geodata.frame.boxes (the union), and the filter resets frame.boxes
// to the single sandbox box, so lots stay inside automatically.
//
// Design decisions (pinned here so a later reader does not re-litigate):
//   - The sandbox is a SQUARE of side 2 x radius centred on the lat/lng
//     (a circle would need a second shape through every consumer; the
//     union/clipping machinery is all boxes). "Radius" is the half-side.
//   - frame.originLatLon is NEVER changed (stays [25.033, 121.565]):
//     resolveLandmark converts registry lat/lon through it, so moving
//     the origin would move every landmark pin. The box lives in the
//     same x/z space as the full city.
//   - Roads/roadbeds/MRT decks/elevated roads/runways are CLIPPED to the
//     box edge (Liang-Barsky per segment), not kept-if-intersect, or
//     they would stick out past the sandbox border. A polyline that
//     exits and re-enters comes back as separate pieces, never a chord
//     across the outside.
//   - Rings (water/parks/green/school/airfield/surfaces/loop sites) are
//     clipped with Sutherland-Hodgman; a ring fully containing the box
//     clips to the box itself. Skybridges are keep-if-intersect (their
//     widths are per-segment, so clipping would need a second shape).
//   - geodata.landmarks drops out-of-box pins. That is what gates the
//     Taipei 101 tower: the planner builds plan.tower only when the
//     'Taipei 101' pin is present, so a sandbox without 101 has no
//     tower. The tile guards the missing pins (spawn falls back to the
//     box centre, teleports shrink to the pins that survived).
//   - The LANDMARK_STRUCTURES registry is static code, not geodata, so
//     the geo filter alone cannot keep its towers out of a sandbox:
//     the boot passes the box as planTaipeiBuildings' opts.bounds and
//     the planner filters landmark/site structures by pin.
//   - Radius is clamped to 200–3000 m so a huge radius cannot silently
//     become the full city. A malformed param (bad numbers, unknown
//     preset) falls back to the full city with a console warning.
//   - An empty box (ocean, outside the tile) does not crash: the boot
//     still builds the ground plane and the plan is empty; the boot
//     reports a sandboxNotice and the loading overlay shows it until
//     clicked (see js/main.js). The filter itself never throws on an
//     empty box.
//   - HONEST LIMIT: the sandbox city is NOT pixel-identical to the same
//     streets in the full city. The planner seeds lot draws by block
//     index, and filtering renumbers the blocks, so lots re-roll inside
//     the box. The sandbox is for testing the fix, not for verifying
//     exact full-city placement; the full gate still runs before any
//     merge.

import { TAIPEI_GEO as TAIPEI_GEO_FULL } from './taipei-geodata.js';

export const SANDBOX_RADIUS_MIN_M = 200;
export const SANDBOX_RADIUS_MAX_M = 3000;
export const SANDBOX_DEFAULT_RADIUS_M = 800;

// The projection the tile already uses: origin Taipei 101
// (25.0330, 121.5650); x = (lon - 121.5650) x 100840, z = (25.0330 - lat)
// x 110990. (js/taipei-buildings.js latLonToTile / TAIPEI_GEO.frame.)
export const TAIPEI_ORIGIN_LATLON = Object.freeze([25.033, 121.565]);
const LON_TO_M = 100840;
const LAT_TO_M = 110990;

// District presets: named lat/lng + radius on the same path as the
// arbitrary form. Centres are real, recognizable spots inside the tile.
export const SANDBOX_PRESETS = Object.freeze({
  xinyi: Object.freeze({ lat: 25.0330, lon: 121.5650, radius: 800, label: 'Xinyi — Taipei 101' }),
  beitou: Object.freeze({ lat: 25.1367, lon: 121.5065, radius: 1000, label: 'Beitou — Beitou Park / Thermal Valley' }),
  shilin: Object.freeze({ lat: 25.0911, lon: 121.5247, radius: 1000, label: 'Shilin — Shilin MRT station' }),
  daan: Object.freeze({ lat: 25.0325, lon: 121.5295, radius: 800, label: "Da'an — Yongkang Street" }),
  zhongshan: Object.freeze({ lat: 25.0478, lon: 121.5170, radius: 800, label: 'Zhongshan — Taipei Main Station' }),
  songshan: Object.freeze({ lat: 25.0490, lon: 121.5610, radius: 800, label: 'Songshan — Songshan Cultural Park / Taipei Dome' }),
});

export function latLonToTileXY(lat, lon, originLatLon = TAIPEI_ORIGIN_LATLON) {
  const [olat, olon] = originLatLon;
  return { x: (lon - olon) * LON_TO_M, z: (olat - lat) * LAT_TO_M };
}

export function tileXYToLatLon(x, z, originLatLon = TAIPEI_ORIGIN_LATLON) {
  const [olat, olon] = originLatLon;
  return { lat: olat - z / LAT_TO_M, lon: olon + x / LON_TO_M };
}

export function pointInBox(x, z, box, margin = 0) {
  return x >= box.minX - margin && x <= box.maxX + margin && z >= box.minZ - margin && z <= box.maxZ + margin;
}

export function rectsIntersect(a, b) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
}

export function ringBbox(ring) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i + 1 < ring.length; i += 2) {
    minX = Math.min(minX, ring[i]); maxX = Math.max(maxX, ring[i]);
    minZ = Math.min(minZ, ring[i + 1]); maxZ = Math.max(maxZ, ring[i + 1]);
  }
  return { minX, maxX, minZ, maxZ };
}

// Liang-Barsky clip of one segment against the box. Returns the clipped
// endpoints plus the parametric t values ([x0, z0, x1, z1, t0, t1]), or
// null when the segment misses the box entirely. The t values let a
// caller interpolate a parallel per-vertex array (MRT deck heights,
// runway half-widths) at the new vertices.
function clipSegment(x0, z0, x1, z1, box) {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dz = z1 - z0;
  const p = [-dx, dx, -dz, dz];
  const q = [x0 - box.minX, box.maxX - x0, z0 - box.minZ, box.maxZ - z0];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  if (t0 > t1) return null;
  return [x0 + dx * t0, z0 + dz * t0, x0 + dx * t1, z0 + dz * t1, t0, t1];
}

const JOIN_EPS = 1e-6;
function samePoint(ax, az, bx, bz) {
  return Math.abs(ax - bx) <= JOIN_EPS && Math.abs(az - bz) <= JOIN_EPS;
}

// Clip a flat polyline [x, z, ...] to the box. Returns an ARRAY of clipped
// polylines (0..n pieces): a polyline that exits and re-enters comes back
// as separate pieces so no chord is drawn across the outside. A polyline
// fully inside comes back unchanged (one piece, the same coordinates).
export function clipPolylineToBox(pts, box) {
  const pieces = [];
  let cur = null;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const seg = clipSegment(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], box);
    if (!seg) { cur = null; continue; }
    const [cx0, cz0, cx1, cz1] = seg;
    if (cx0 === cx1 && cz0 === cz1) continue; // degenerate point on the edge
    if (cur && samePoint(cur[cur.length - 2], cur[cur.length - 1], cx0, cz0)) {
      cur.push(cx1, cz1);
    } else {
      cur = [cx0, cz0, cx1, cz1];
      pieces.push(cur);
    }
  }
  return pieces;
}

// Clip a flat polyline carrying a parallel per-vertex value array (MRT
// deck heights, runway/taxiway half-widths). Returns [{ pts, values }]
// pieces; values are linearly interpolated at the clip points. When
// values is not an array (a scalar half-width) it is carried through
// unchanged on every piece.
export function clipPolylineWithValuesToBox(pts, values, box) {
  const pieces = [];
  let cur = null;
  let curValues = null;
  const valueAt = (i, t) => {
    if (!Array.isArray(values)) return values;
    const a = values[i], b = values[i + 1];
    return a + (b - a) * t;
  };
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const seg = clipSegment(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], box);
    if (!seg) { cur = null; curValues = null; continue; }
    const [cx0, cz0, cx1, cz1, t0, t1] = seg;
    if (cx0 === cx1 && cz0 === cz1) continue;
    const v0 = valueAt(i / 2, t0), v1 = valueAt(i / 2, t1);
    if (cur && samePoint(cur[cur.length - 2], cur[cur.length - 1], cx0, cz0)) {
      cur.push(cx1, cz1);
      if (Array.isArray(values)) curValues.push(v1);
    } else {
      cur = [cx0, cz0, cx1, cz1];
      curValues = Array.isArray(values) ? [v0, v1] : values;
      pieces.push({ pts: cur, values: curValues });
    }
  }
  return pieces;
}

// Sutherland-Hodgman clip of a closed flat ring to the box. The input
// rings are closed (last point repeats the first); the output stays
// closed. Returns null when fewer than 3 distinct points survive.
export function clipRingToBox(ring, box) {
  if (!ring || ring.length < 6) return null;
  // Drop the duplicated closing point for the clip, re-close at the end.
  const closed = ring[0] === ring[ring.length - 2] && ring[1] === ring[ring.length - 1];
  const n = closed ? (ring.length - 2) / 2 : ring.length / 2;
  let poly = [];
  for (let i = 0; i < n; i++) poly.push([ring[i * 2], ring[i * 2 + 1]]);
  const edges = [
    { inside: ([x]) => x >= box.minX, intersect: (a, b) => [box.minX, a[1] + ((b[1] - a[1]) * (box.minX - a[0])) / (b[0] - a[0])] },
    { inside: ([x]) => x <= box.maxX, intersect: (a, b) => [box.maxX, a[1] + ((b[1] - a[1]) * (box.maxX - a[0])) / (b[0] - a[0])] },
    { inside: ([, z]) => z >= box.minZ, intersect: (a, b) => [a[0] + ((b[0] - a[0]) * (box.minZ - a[1])) / (b[1] - a[1]), box.minZ] },
    { inside: ([, z]) => z <= box.maxZ, intersect: (a, b) => [a[0] + ((b[0] - a[0]) * (box.maxZ - a[1])) / (b[1] - a[1]), box.maxZ] },
  ];
  for (const { inside, intersect } of edges) {
    if (poly.length === 0) break;
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const cur = poly[i], prev = poly[(i + poly.length - 1) % poly.length];
      const curIn = inside(cur), prevIn = inside(prev);
      if (curIn) {
        if (!prevIn) out.push(intersect(prev, cur));
        out.push(cur);
      } else if (prevIn) {
        out.push(intersect(prev, cur));
      }
    }
    poly = out;
  }
  // Dedupe consecutive duplicates, then require 3 distinct points.
  const dedup = [];
  for (const p of poly) {
    const last = dedup[dedup.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > JOIN_EPS || Math.abs(last[1] - p[1]) > JOIN_EPS) dedup.push(p);
  }
  if (dedup.length > 1) {
    const first = dedup[0], last = dedup[dedup.length - 1];
    if (Math.abs(first[0] - last[0]) <= JOIN_EPS && Math.abs(first[1] - last[1]) <= JOIN_EPS) dedup.pop();
  }
  if (dedup.length < 3) return null;
  const flat = [];
  for (const [x, z] of dedup) flat.push(x, z);
  flat.push(dedup[0][0], dedup[0][1]); // re-close
  return flat;
}

// Does any part of a flat polyline touch the box (a vertex inside, or a
// segment crossing it)? Used for keep-if-intersect sections.
export function polylineIntersectsBox(pts, box) {
  for (let i = 0; i + 1 < pts.length; i += 2) {
    if (pointInBox(pts[i], pts[i + 1], box)) return true;
  }
  for (let i = 0; i + 3 < pts.length; i += 2) {
    if (clipSegment(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], box)) return true;
  }
  return false;
}

// Clip every entry of a ring-carrying array ({ ..., ring }) to the box,
// dropping entries whose ring degenerates.
function clipRingEntries(entries, box) {
  const out = [];
  for (const e of entries || []) {
    const ring = clipRingToBox(e.ring, box);
    if (ring) out.push({ ...e, ring });
  }
  return out;
}

// Parse the ?sandbox= param from a query string (location.search in the
// browser; an explicit string in tests). Returns:
//   { status: 'off' } — no param, or an empty one: full city, untouched.
//   { status: 'active', box, centre, lat, lon, radius, preset, clamped }
//   { status: 'invalid', reason } — fall back to the full city.
export function parseSandboxParam(search = '') {
  let raw = null;
  try {
    raw = new URLSearchParams(typeof search === 'string' ? search : '').get('sandbox');
  } catch {
    return { status: 'off' };
  }
  if (raw === null || raw.trim() === '') return { status: 'off' };
  const value = raw.trim();
  let lat, lon, radius, preset = null;
  const presetDef = SANDBOX_PRESETS[value.toLowerCase()];
  if (presetDef) {
    ({ lat, lon, radius } = presetDef);
    preset = value.toLowerCase();
  } else {
    const parts = value.split(',').map((s) => s.trim());
    if (parts.length < 2 || parts.length > 3) {
      return { status: 'invalid', reason: `?sandbox=${value} is not a preset name or lat,lng[,radius]` };
    }
    lat = Number(parts[0]);
    lon = Number(parts[1]);
    radius = parts.length === 3 ? Number(parts[2]) : SANDBOX_DEFAULT_RADIUS_M;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(radius)) {
      return { status: 'invalid', reason: `?sandbox=${value} has a non-numeric lat, lng or radius` };
    }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return { status: 'invalid', reason: `?sandbox=${value} is outside lat -90..90 / lng -180..180` };
    }
    if (radius <= 0) {
      return { status: 'invalid', reason: `?sandbox=${value} has a non-positive radius` };
    }
  }
  let clamped = false;
  if (radius < SANDBOX_RADIUS_MIN_M) { radius = SANDBOX_RADIUS_MIN_M; clamped = true; }
  if (radius > SANDBOX_RADIUS_MAX_M) { radius = SANDBOX_RADIUS_MAX_M; clamped = true; }
  const centre = latLonToTileXY(lat, lon);
  const box = {
    minX: centre.x - radius, maxX: centre.x + radius,
    minZ: centre.z - radius, maxZ: centre.z + radius,
  };
  return { status: 'active', box, centre, lat, lon, radius, preset, clamped };
}

// Filter the generated geo down to a box. Pure: no location access, no
// mutation of the input (every touched section is a fresh array/object;
// untouched sections keep their original references). The result is a
// valid TAIPEI_GEO-shaped object the planner/adapter/boot/traffic read
// exactly like the full one.
export function filterGeoToBox(geo, box) {
  const out = { ...geo };
  // Roads and roadbeds: CLIPPED to the box edge (a polyline that exits
  // and re-enters comes back as separate entries, never a chord).
  out.roads = (geo.roads || []).flatMap((r) =>
    clipPolylineToBox(r.pts, box).map((pts) => ({ ...r, pts })));
  out.roadbeds = (geo.roadbeds || []).flatMap((r) =>
    clipPolylineToBox(r.pts, box).map((pts) => ({ ...r, pts })));
  // Blocks: keep bbox-intersecting. (The planner re-numbers them, which
  // is why the sandbox re-rolls lots — see the header limit.)
  out.blocks = (geo.blocks || []).filter((b) => rectsIntersect(b.bbox, box));
  // Rings: clipped. A ring fully containing the box clips to the box.
  out.water = clipRingEntries(geo.water, box);
  out.parks = clipRingEntries(geo.parks, box);
  out.green = clipRingEntries(geo.green, box);
  out.loopSites = clipRingEntries(geo.loopSites, box);
  out.schools = clipRingEntries(geo.schools, box);
  // Heights: footprints clipped; doors kept by point. (A clipped school
  // or footprint keeps its original area/stats — a documented residual:
  // a campus straddling the box edge keeps stale stats.)
  const doors = geo.heights?.doors || [];
  const keptDoors = [];
  for (let i = 0; i + 2 < doors.length; i += 3) {
    if (pointInBox(doors[i], doors[i + 1], box)) keptDoors.push(doors[i], doors[i + 1], doors[i + 2]);
  }
  out.heights = {
    ...(geo.heights || {}),
    footprints: clipRingEntries(geo.heights?.footprints, box),
    doors: keptDoors,
  };
  // Landmarks: keep pins inside the box. Dropping 'Taipei 101' is what
  // gates plan.tower (the planner builds it only when the pin exists).
  out.landmarks = Object.fromEntries(
    Object.entries(geo.landmarks || {}).filter(([, lm]) => pointInBox(lm.x, lm.z, box)));
  // MRT: stations kept by pin with a 100 m margin (a station is
  // ~140 m long, so a straddling station stays whole); decks and
  // elevated roads clipped with their parallel height arrays; the
  // depot kept when its centre is within 800 m (its site is
  // 1590 x 483 m) and dropped otherwise (undefined is supported).
  out.mrtStations = (geo.mrtStations || []).filter((s) => pointInBox(s.x, s.z, box, 100));
  const clipDeckLines = (lines) => (lines || []).flatMap((l) =>
    clipPolylineWithValuesToBox(l.pts, l.h, box).map(({ pts, values }) => ({ ...l, pts, h: values })));
  out.mrtDecks = { ...(geo.mrtDecks || {}), lines: clipDeckLines(geo.mrtDecks?.lines) };
  out.elevatedRoads = { ...(geo.elevatedRoads || {}), lines: clipDeckLines(geo.elevatedRoads?.lines) };
  out.mrtDepot = geo.mrtDepot && pointInBox(geo.mrtDepot.x, geo.mrtDepot.z, box, 800) ? geo.mrtDepot : undefined;
  // Skybridges: keep-if-intersect (widths are per-segment, so clipping
  // would need a second shape); park sports: keep by point.
  out.skybridges = (geo.skybridges || []).filter((s) => polylineIntersectsBox(s.pts, box));
  out.parkSports = (geo.parkSports || []).filter((p) => pointInBox(p.x, p.z, box));
  // Riverside: clip the polys, keep the band width.
  out.riverside = { ...(geo.riverside || {}), polys: clipRingEntries(geo.riverside?.polys, box) };
  // Airfield: the whole site drops (null is supported) when its ring
  // misses the box; surfaces clip; paint lines clip with their
  // per-vertex half-widths (a scalar half-width carries through);
  // stands are 2-point segments and clip like polylines; a tunnel
  // stays only when a run survives AND a mouth is inside the box.
  if (geo.airfield) {
    const site = clipRingEntries(geo.airfield.site || [], box);
    if (site.length === 0) {
      out.airfield = null;
    } else {
      const clipPaint = (lines) => (lines || []).flatMap((l) =>
        clipPolylineWithValuesToBox(l.pts, l.half, box).map(({ pts, values }) => ({ ...l, pts, half: values })));
      const roadTunnels = (geo.airfield.roadTunnels || []).map((t) => {
        const runs = (t.runs || []).flatMap((run) => clipPolylineToBox(run, box));
        const mouths = (t.mouths || []).filter((m) => pointInBox(m.x, m.z, box));
        if (runs.length === 0 || mouths.length === 0) return null;
        return { ...t, runs, mouths };
      }).filter(Boolean);
      out.airfield = {
        ...geo.airfield,
        site,
        surfaces: (geo.airfield.surfaces || []).map((ring) => clipRingToBox(ring, box)).filter(Boolean),
        paint: {
          ...(geo.airfield.paint || {}),
          runway: clipPaint(geo.airfield.paint?.runway),
          taxiways: clipPaint(geo.airfield.paint?.taxiways),
          stands: (geo.airfield.paint?.stands || []).flatMap((pts) => clipPolylineToBox(pts, box)),
        },
        roadTunnels,
      };
    }
  } else {
    out.airfield = null;
  }
  // National Palace Museum site: clip the ring; an empty site list is
  // what the planner already handles (geodata.npmSite?.site || []).
  out.npmSite = { site: clipRingEntries(geo.npmSite?.site, box) };
  // Terrain grids: kept as-is when their bounds intersect the box —
  // they are sampled by position, so grid data outside the box is
  // harmless, and dropping an intersecting grid would lose the drape
  // under the sandbox.
  out.terrain = {
    ...(geo.terrain || {}),
    grids: (geo.terrain?.grids || []).filter((g) =>
      rectsIntersect({ minX: g.x0, maxX: g.x1, minZ: g.z0, maxZ: g.z1 }, box)),
  };
  // Road graph: nodes stay (edge indices must stay valid); an edge
  // stays only when BOTH endpoints are inside the box, so traffic
  // can never be routed outside the ground plane.
  const nodes = geo.roadGraph?.nodes || [];
  out.roadGraph = {
    ...(geo.roadGraph || {}),
    edges: (geo.roadGraph?.edges || []).filter((e) =>
      pointInBox(nodes[e.a * 2], nodes[e.a * 2 + 1], box) &&
      pointInBox(nodes[e.b * 2], nodes[e.b * 2 + 1], box)),
  };
  // Frame: the box becomes the tile. originLatLon is deliberately NOT
  // changed (registry pins are resolved through it). boxes becomes the
  // single sandbox box, which is what keeps planner lots inside.
  out.frame = {
    ...(geo.frame || {}),
    bbox: { minX: box.minX, maxX: box.maxX, minZ: box.minZ, maxZ: box.maxZ },
    boxes: [{ name: 'sandbox', minX: box.minX, maxX: box.maxX, minZ: box.minZ, maxZ: box.maxZ }],
  };
  return out;
}

// Is the filtered geo empty — nothing to build? A box over the ocean or
// outside the tile has no blocks, roads or roadbeds. The boot still
// builds the ground plane; it uses this to show the on-screen notice
// instead of a blank city.
export function sandboxEmptiness(geo) {
  const blocks = geo.blocks?.length || 0;
  const roads = geo.roads?.length || 0;
  const roadbeds = geo.roadbeds?.length || 0;
  const empty = blocks === 0 && roads === 0 && roadbeds === 0;
  return {
    empty,
    reason: empty ? 'no blocks, roads or roadbeds inside the box' : '',
  };
}

// ---- Active sandbox for this page load ----
// In Node (tests, tooling) there is no location: the sandbox is off and
// TAIPEI_GEO is the generated geo, the identical object — no behaviour
// change without the param.
const SEARCH = typeof location !== 'undefined' ? (location.search || '') : '';
const PARSED = parseSandboxParam(SEARCH);

export const SANDBOX_INFO = PARSED.status === 'active'
  ? Object.freeze({
    active: true, preset: PARSED.preset, lat: PARSED.lat, lon: PARSED.lon,
    radius: PARSED.radius, clamped: PARSED.clamped, box: PARSED.box, centre: PARSED.centre,
  })
  : Object.freeze({
    active: false, preset: null, lat: null, lon: null,
    radius: null, clamped: false, box: null, centre: null,
  });

if (PARSED.status === 'invalid' && typeof console !== 'undefined') {
  console.warn(`[sandbox] ${PARSED.reason} — falling back to the full city.`);
}
if (SANDBOX_INFO.active && SANDBOX_INFO.clamped && typeof console !== 'undefined') {
  console.warn(`[sandbox] radius clamped to ${SANDBOX_INFO.radius} m (allowed ${SANDBOX_RADIUS_MIN_M}–${SANDBOX_RADIUS_MAX_M} m).`);
}

export const SANDBOX_BOX = SANDBOX_INFO.box;
export const SANDBOX_ACTIVE = SANDBOX_INFO.active;

// The geo the three importers read: the filtered copy when the sandbox
// is active, the generated geo untouched (same object) otherwise.
export const TAIPEI_GEO = SANDBOX_BOX ? filterGeoToBox(TAIPEI_GEO_FULL, SANDBOX_BOX) : TAIPEI_GEO_FULL;
