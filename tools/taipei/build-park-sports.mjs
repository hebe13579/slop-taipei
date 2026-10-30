// tools/taipei/build-park-sports.mjs — park sports features (issue #246),
// derived from the OSM park-sports extract exactly as the census on the
// issue measured it.
//
// The extract (tools/taipei/extract-from-pbf.py -> osm_park_sports.json)
// is a dumb tag filter: playground / pitch / track / picnic_table /
// shelter / pavilion / shelter_type / picnic_site / sport ways and
// nodes in the tile. This step applies the mapping rules and the
// inside-a-park test, and emits world-frame rects the planner
// (planParkAmenities) places verbatim — mapped locations win over
// seeded ones where both exist.
//
// Mapping rules (the census verdicts, so a data refresh cannot
// silently grow or shrink the section):
//   - playground: leisure=playground. Centroid + long-axis
//     rotation from the way; the pad is ALWAYS the 14x11 m kit
//     size (the renderer instances one fixed geometry, and the
//     planner clears exactly the rect the renderer draws — a
//     way-sized pad would need per-item scaling). Nodes get the
//     same pad.
//   - court: sport=basketball or sport=tennis (leisure=pitch/track
//     or a bare sport tag — a sport-tagged way with no leisure tag
//     is a pitch in OSM practice). Standard pad dims per sport;
//     a way covering >1.8x one pad splits into two pads along its
//     long axis. Every other sport (baseball, soccer, badminton,
//     tracks...) is skipped: those fields stay green, as scoped.
//   - picnic: leisure=picnic_table nodes (one table each) and
//     tourism=picnic_site ways. Fixed 2.4x1.8 m probe rect; the
//     renderer draws one standard table per entry.
//   - pavilion: amenity=shelter / leisure=shelter /
//     building=pavilion / any shelter_type — EXCEPT
//     shelter_type=public_transport/weather_shelter (bus-stop
//     roofs, not 涼亭）, and ways over 200 m2 (covered grounds,
//     not pavilions). Fixed 8x8 m kit pad; centroid + long-axis
//     rotation from the way.
//   - 廣場-named polygons are skipped (paved civic squares, the
//     planner skips them whole); the centroid must fall inside
//     exactly one park ring, whose name the entry carries.
//   - A node and a way for the same feature (double-mapping) dedupe
//     to the way when their centres land within 3 m of each other.
//
// Rotation convention: rot is the THREE Y-rotation that maps the
// geometry's local +X onto the rect's long axis — rot =
// atan2(-az, ax) for a unit axis (ax, az). The planner's rect
// clearance uses the same convention, so a shipped entry's pad
// is exactly the pad the planner tests.

const COURT_SPORTS = { basketball: { w: 30, d: 17 }, tennis: { w: 28, d: 14 } };
const SHELTER_EXCLUDED = new Set(['public_transport', 'weather_shelter']);
const PAVILION_MAX_AREA = 200;
const DEDUPE_M = 3;

const q = (v) => Math.round(v * 10) / 10 + 0; // +0: -0 must not survive (JSON writes it as 0, so the shipped section would never re-derive exactly)
const qr = (v) => Math.round(v * 100) / 100 + 0;
const isPlazaName = (name) => (name || '').includes('廣場');

function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; i += 2) {
    const xi = ring[i], zi = ring[i + 1], xj = ring[j], zj = ring[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    j = i;
  }
  return inside;
}

// Rect fit of a way's point cloud: the longest edge gives the
// long-axis direction (exact for rectangles and squares at any
// rotation — a covariance fit inflates near-square clouds by
// up to sqrt(2), reading the diagonals as the sides); extents
// are the min/max projections onto that axis and its normal.
function axisRect(pts) {
  const n = pts.length;
  let mx = 0, mz = 0;
  for (const [x, z] of pts) { mx += x; mz += z; }
  mx /= n; mz /= n;
  let ax = 1, az = 0, best = -1;
  for (let i = 0; i + 1 < n; i++) {
    const dx = pts[i + 1][0] - pts[i][0], dz = pts[i + 1][1] - pts[i][1];
    const l2 = dx * dx + dz * dz;
    if (l2 > best) { best = l2; ax = dx; az = dz; }
  }
  const al = Math.hypot(ax, az) || 1;
  ax /= al; az /= al;
  let loA = Infinity, hiA = -Infinity, loB = Infinity, hiB = -Infinity;
  for (const [x, z] of pts) {
    const a = (x - mx) * ax + (z - mz) * az;
    const b = -(x - mx) * az + (z - mz) * ax;
    loA = Math.min(loA, a); hiA = Math.max(hiA, a);
    loB = Math.min(loB, b); hiB = Math.max(hiB, b);
  }
  return { cx: mx, cz: mz, ax, az, w: hiA - loA, d: hiB - loB };
}

const rotOf = (ax, az) => qr(Math.atan2(-az, ax));
const hash01 = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
};

function classify(t) {
  const le = t.leisure, sp = t.sport;
  if (le === 'playground') return 'playground';
  if (sp === 'basketball' || sp === 'tennis') return 'court';
  if (le === 'picnic_table' || t.tourism === 'picnic_site') return 'picnic';
  if (t.amenity === 'shelter' || le === 'shelter' || t.building === 'pavilion' || t.shelter_type) {
    if (SHELTER_EXCLUDED.has(t.shelter_type)) return 'shelter-excluded';
    return 'pavilion';
  }
  return null;
}

export function deriveParkSports(elements, parks, toWorld) {
  const stats = {
    seen: 0, kept: 0,
    byKind: { playground: 0, court: 0, picnic: 0, pavilion: 0 },
    skipped: {
      unclassified: 0, shelterExcluded: 0, oversize: 0, plaza: 0,
      outside: 0, degenerate: 0, dedupe: 0,
    },
    splitSlabs: 0,
    parks: 0,
  };
  // Park bbox grid so each feature only tests the rings near it.
  const parkMeta = parks.map((p) => {
    const ring = p.ring;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < ring.length; i += 2) {
      minX = Math.min(minX, ring[i]); maxX = Math.max(maxX, ring[i]);
      minZ = Math.min(minZ, ring[i + 1]); maxZ = Math.max(maxZ, ring[i + 1]);
    }
    return { name: p.name || '', ring, minX, maxX, minZ, maxZ };
  });
  const parkAt = (x, z) => {
    for (const pm of parkMeta) {
      if (x < pm.minX || x > pm.maxX || z < pm.minZ || z > pm.maxZ) continue;
      if (pointInRing(x, z, pm.ring)) return pm;
    }
    return null;
  };

  const raw = [];
  for (const el of elements) {
    stats.seen++;
    const kind = classify(el.tags || {});
    if (kind === 'shelter-excluded') { stats.skipped.shelterExcluded++; continue; }
    if (!kind) { stats.skipped.unclassified++; continue; }
    const sport = kind === 'court' ? el.tags.sport : null;
    let pts = null;
    if (el.type === 'node') {
      if (typeof el.lat !== 'number' || typeof el.lon !== 'number') { stats.skipped.degenerate++; continue; }
      pts = [toWorld(el.lon, el.lat)];
    } else if (el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 1) {
      pts = el.geometry.map((g) => toWorld(g.lon, g.lat));
    } else { stats.skipped.degenerate++; continue; }
    // Distinct-point check (a way of one repeated vertex is a point).
    const distinct = new Set(pts.map(([x, z]) => `${q(x)},${q(z)}`));
    if (distinct.size < 2 && el.type === 'way') { stats.skipped.degenerate++; continue; }

    let rects;
    if (el.type === 'node') {
      const [x, z] = pts[0];
      const rot = qr(hash01(`sports|${el.id}`) * Math.PI);
      if (kind === 'playground') rects = [{ x, z, rot, w: 14, d: 11 }];
      else if (kind === 'picnic') rects = [{ x, z, rot, w: 2.4, d: 1.8 }];
      else if (kind === 'pavilion') rects = [{ x, z, rot, w: 8, d: 8 }];
      else rects = [{ x, z, rot, w: COURT_SPORTS[sport].w, d: COURT_SPORTS[sport].d }];
    } else {
      const r = axisRect(pts);
      const rot = rotOf(r.ax, r.az);
      const bboxArea = r.w * r.d;
      if (kind === 'playground') {
        rects = [{ x: r.cx, z: r.cz, rot, w: 14, d: 11 }];
      } else if (kind === 'picnic') {
        rects = [{ x: r.cx, z: r.cz, rot, w: 2.4, d: 1.8 }];
      } else if (kind === 'pavilion') {
        if (bboxArea > PAVILION_MAX_AREA) { stats.skipped.oversize++; continue; }
        rects = [{ x: r.cx, z: r.cz, rot, w: 8, d: 8 }];
      } else {
        const pad = COURT_SPORTS[sport];
        const w = pad.w, d = pad.d;
        if (bboxArea > 1.8 * pad.w * pad.d) {
          // A multi-court slab: two pads along the long axis,
          // abutting (centres a full pad length apart) so the
          // planner's rect-overlap admission keeps both.
          const off = w / 2;
          const dx = r.ax * off, dz = r.az * off;
          rects = [
            { x: r.cx - dx, z: r.cz - dz, rot, w, d },
            { x: r.cx + dx, z: r.cz + dz, rot, w, d },
          ];
          stats.splitSlabs++;
        } else {
          rects = [{ x: r.cx, z: r.cz, rot, w, d }];
        }
      }
    }
    for (const r of rects) {
      const park = parkAt(q(r.x), q(r.z));
      if (!park) { stats.skipped.outside++; continue; }
      if (isPlazaName(park.name)) { stats.skipped.plaza++; continue; }
      raw.push({
        kind, x: q(r.x), z: q(r.z), rot: r.rot, w: q(r.w), d: q(r.d),
        sport, park: park.name, src: `${el.type}:${el.id}`,
        _way: el.type === 'way',
      });
    }
  }

  // Dedupe: ways first (more precise), then nodes within 3 m of a
  // kept same-kind entry are the same double-mapped feature.
  raw.sort((a, b) => (b._way - a._way) || (a.park < b.park ? -1 : a.park > b.park ? 1 : 0) || (a.x - b.x) || (a.z - b.z));
  const entries = [];
  for (const e of raw) {
    if (entries.some((k) => k.park === e.park && k.kind === e.kind && Math.hypot(k.x - e.x, k.z - e.z) < DEDUPE_M)) {
      stats.skipped.dedupe++;
      continue;
    }
    const { _way, ...entry } = e;
    entries.push(entry);
    stats.byKind[e.kind]++;
  }
  entries.sort((a, b) => (a.park < b.park ? -1 : a.park > b.park ? 1 : 0) || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || (a.x - b.x) || (a.z - b.z));
  stats.kept = entries.length;
  stats.parks = new Set(entries.map((e) => e.park)).size;
  return { entries, stats };
}
