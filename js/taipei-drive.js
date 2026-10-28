// js/taipei-drive.js — the driving model for a registry tile
// (issue #207): drivable elevated ROAD decks + solid buildings.
// Pure data — no three.js — so the node suite pins the model
// directly; js/taipei-boot.js wires it into the controllers.
//
// Two halves:
//
// 1. THE DECK SURFACE MODEL. controllers.js hard-sets a ground
//    mode's y from the tile's groundHeight(x, z, mode) callback
//    every frame, so a deck is drivable exactly when that callback
//    answers the deck's height inside the deck corridor. The model
//    is built from geodata.elevatedRoads ONLY — the MRT digests
//    (geodata.mrtDecks) are never sampled, so guideways stay
//    scenery by construction, and landmark structures are never
//    surfaces either (they are colliders, below). Segment heights
//    interpolate linearly between the digest points, which is
//    precisely the slab js/taipei-viaduct.js draws: what you see
//    is what you drive.
//
//    Choosing between the ground (0) and a deck surface at a
//    point covered by both (every elevated road has a street
//    under it) works by two rules:
//      - GROUND-BEARING: where the deck profile is at/below
//        deckDepth (1.8 m), the slab's underside is at/below
//        grade — there is no under-passage, the formation IS the
//        road (ramp feet, portals, at-grade lines). Its surface
//        wins whenever it is within mounting reach of the
//        caller's current height. This is how a car mounts a
//        ramp: the profile rises continuously through the band
//        (max digest slope 7.8%).
//      - HINT: above that band, the candidate closest to the
//        caller's current height (yHint) wins — on a deck you
//        stay on it, under it you stay on the ground, and at
//        stacked crossings the hint keeps you on your level
//        (joins agree to <= 0.11 m per the #211 census, so
//        line-to-line transitions are seamless).
//
// 2. COLLIDERS. controllers.js already resolves horizontal
//    push-out against AABB / oriented-box colliders in a 48 m
//    spatial hash; a tile just has to feed it some. Building
//    colliders proper come from buildCityBlocks (the plan lots,
//    collected like NYC's since this issue). This module builds
//    the rest:
//      - PARAPETS: one oriented box in each parapet strip of
//        every elevated deck segment — the edge guard that keeps
//        a driver on the deck. minY is the segment's slab
//        underside, so the ground street under the deck stays
//        open; at the four fused #211 residual sites the crossing
//        deck's parapet blocks the lower carriageway exactly
//        when a car's ~2 m span would reach the upper slab
//        (a soft block, emergent — no site is special-cased).
//      - REGISTRY / SITE STRUCTURES: one collider per authored
//        part, mirroring createTaipeiLandmarkTowers' placement.
//        A part's y0 becomes minY, so elevated parts (e.g.
//        Beimen's gatehouse walls over their drive-through
//        passage) don't wall off the ground beneath them.
//      - MRT STATIONS + THE BEITOU DEPOT: one oriented box per
//        station from mrtStationFootprint, with per-kind
//        vertical spans read off js/taipei-mrt-stations.js —
//        elevated bodies start at their floor (minY 4.4-5.0 m)
//        so streets pass under them; at-grade stations and
//        entrances are ground-solid. Station columns and deck
//        piers carry no colliders (2 m posts are below this
//        model's fidelity, as in NYC).
//
// Collider vertical contract (js/controllers.js): a collider
// applies when the entity's span reaches it — skipped when
// yHeight > maxY + 1.5 (entity above it) or, for colliders that
// carry minY, when yHeight + 1 < minY (entity below it).
// Colliders without minY are ground-based and behave exactly as
// upstream's always have.

import { PARAPET_H, PARAPET_T, ASPHALT_LIFT, LOW_BED_MAX, LOW_BED_H, parapetTrims } from './taipei-viaduct.js';
import { mrtStationFootprint } from './taipei-mrt-stations.js';

export const DRIVE_CELL = 48;          // spatial-hash cell, m (the nearColliders idiom)
export const MOUNT_REACH_M = 1.0;      // a ground-bearing surface this close to the hint may claim the entity

const cellKey = (ix, iz) => (ix + 4096) * 8192 + (iz + 4096);

// An oriented collider: AABB bounds for the hash + the obb frame
// the resolver pushes out in. Frame convention (controllers.js):
// local +x maps to (cs, -sn), local +z to (sn, cs) in world XZ.
export function obbCollider(cx, cz, hx, hz, cs, sn, maxY, minY) {
  const ex = Math.abs(cs) * hx + Math.abs(sn) * hz;
  const ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
  const c = { minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, maxY, obb: { cx, cz, hx, hz, cs, sn } };
  if (minY != null && minY > 0) c.minY = minY;
  return c;
}

export function aabbCollider(minX, maxX, minZ, maxZ, maxY, minY) {
  const c = { minX, maxX, minZ, maxZ, maxY };
  if (minY != null && minY > 0) c.minY = minY;
  return c;
}

// ------------------------------------------------------------------
// The deck surface model + parapet colliders for one elevatedRoads
// digest. Memoized by digest object: the boot asks twice (surface
// for controllerOptions, colliders for the ground build) and pays
// once.
// ------------------------------------------------------------------
const modelCache = new WeakMap();

export function buildDriveModel(elevated) {
  if (!elevated) return { sample: () => 0, parapetColliders: [], stats: { segments: 0, elevatedSegments: 0, cells: 0 } };
  const hit = modelCache.get(elevated);
  if (hit) return hit;

  const depth = elevated.deckDepth ?? 1.8;
  const cells = new Map();
  const parapetColliders = [];
  let segments = 0, elevatedSegments = 0;
  // Issue #239: the parapet colliders follow the same mouth trims
  // as the visual strips — a trimmed fence has no invisible wall.
  const trims = parapetTrims(elevated);

  for (let li = 0; li < (elevated.lines || []).length; li++) {
    const line = elevated.lines[li];
    const n = (line.pts?.length || 0) / 2;
    if (n < 2) continue;
    const half = (line.width || 6) / 2;
    for (let i = 0; i + 1 < n; i++) {
      const ax = line.pts[2 * i], az = line.pts[2 * i + 1];
      const bx = line.pts[2 * i + 2], bz = line.pts[2 * i + 3];
      const hA = line.h?.[i] ?? 0, hB = line.h?.[i + 1] ?? 0;
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz);
      if (!(len > 0)) continue;
      // The rendered surface: a segment whose profile stays under
      // LOW_BED_MAX is drawn as the flat low bed; anything higher
      // is the slab, interpolated. Drive what is drawn.
      const low = Math.max(hA, hB) < LOW_BED_MAX;
      const seg = {
        ax, az, ux: dx / len, uz: dz / len, len, half, hA, hB,
        sA: low ? LOW_BED_H + ASPHALT_LIFT : hA + ASPHALT_LIFT,
        sB: low ? LOW_BED_H + ASPHALT_LIFT : hB + ASPHALT_LIFT,
      };
      segments++;
      // Register in every cell the corridor (bbox + half width)
      // touches; a sample then only opens its own cell.
      const minX = Math.min(ax, bx) - half, maxX = Math.max(ax, bx) + half;
      const minZ = Math.min(az, bz) - half, maxZ = Math.max(az, bz) + half;
      for (let ix = Math.floor(minX / DRIVE_CELL); ix <= Math.floor(maxX / DRIVE_CELL); ix++) {
        for (let iz = Math.floor(minZ / DRIVE_CELL); iz <= Math.floor(maxZ / DRIVE_CELL); iz++) {
          const k = cellKey(ix, iz);
          let list = cells.get(k);
          if (!list) cells.set(k, (list = []));
          list.push(seg);
        }
      }
      if (!low) {
        elevatedSegments++;
        // Parapet strips: hx along the segment, hz across. The
        // local frame puts +z along the segment (sn = ux,
        // cs = uz gives local +z -> (ux, uz)); the strip centre
        // sits half a parapet thickness inside the slab edge.
        // Issue #239: one collider per KEPT interval of each strip
        // (the mouth trims), not one per whole segment.
        const off = half - PARAPET_T / 2;
        const nx = -seg.uz, nz = seg.ux; // left normal, the renderer's n
        const hAt = (t) => hA + (hB - hA) * t;
        const segTrim = trims.lines[li]?.segments[i];
        for (const [s, list] of [[1, segTrim?.left], [-1, segTrim?.right]]) {
          for (const [t0, t1] of list || [[0, 1]]) {
            if (!(t1 > t0)) continue;
            const tm = (t0 + t1) / 2;
            const mx = ax + (bx - ax) * tm, mz = az + (bz - az) * tm;
            const maxY = Math.max(hAt(t0), hAt(t1)) + PARAPET_H;
            const minY = Math.max(0, Math.min(hAt(t0), hAt(t1)) - depth);
            parapetColliders.push(obbCollider(
              mx + s * nx * off, mz + s * nz * off,
              PARAPET_T / 2, ((t1 - t0) * len) / 2, seg.uz, seg.ux, maxY, minY));
          }
        }
      }
    }
  }

  // The deck surface at (x, z) for an entity currently at yHint,
  // or 0 (the ground) when no deck surface claims it. See the
  // header for the ground-bearing / hint rules.
  const sample = (x, z, yHint) => {
    const hint = Number.isFinite(yHint) ? yHint : 0;
    const list = cells.get(cellKey(Math.floor(x / DRIVE_CELL), Math.floor(z / DRIVE_CELL)));
    if (!list) return 0;
    let best = 0, bestDist = Math.abs(hint); // the ground is always a candidate
    let gb = null, gbDist = Infinity;
    for (const seg of list) {
      const px = x - seg.ax, pz = z - seg.az;
      const t = Math.max(0, Math.min(1, (px * seg.ux + pz * seg.uz) / seg.len));
      const lat = px * -seg.uz + pz * seg.ux;
      if (Math.abs(lat) > seg.half) continue;
      const surf = seg.sA + (seg.sB - seg.sA) * t;
      const dist = Math.abs(surf - hint);
      if (dist < bestDist) { best = surf; bestDist = dist; }
      const profH = seg.hA + (seg.hB - seg.hA) * t;
      if (profH <= depth && dist < gbDist) { gb = surf; gbDist = dist; }
    }
    // A ground-bearing formation within mounting reach claims
    // the entity even over the ground itself (the ramp foot);
    // one farther away than a step is just a wall beside the
    // road, and the closeness rule decides.
    if (gb != null && gbDist <= MOUNT_REACH_M) return gb;
    return best;
  };

  const model = {
    sample,
    parapetColliders,
    stats: { segments, elevatedSegments, cells: cells.size, parapetTrimmedM: trims.stats.blockedM },
  };
  modelCache.set(elevated, model);
  return model;
}

// ------------------------------------------------------------------
// Registry / site structure colliders: one per authored part,
// mirroring createTaipeiLandmarkTowers (js/taipei-buildings.js):
// box parts sit at (s.x + dx, s.z + dz) turned by part.rotY in the
// tile-plane convention (local +x -> (cos, +sin)), so the resolver
// frame takes cs = cos(rotY), sn = -sin(rotY); cylinder / dome /
// frustum / ridge parts cannot rotate and take AABBs of their
// plan extents. part.y0 is the part's base: minY, so an elevated
// part never blocks the ground it bridges.
// ------------------------------------------------------------------
export function structureColliders(structures) {
  const out = [];
  for (const s of structures || []) {
    for (const part of s.parts || []) {
      const y0 = part.y0 || 0;
      const cx = s.x + (part.dx || 0), cz = s.z + (part.dz || 0);
      if (part.type === 'box') {
        const hx = part.w / 2, hz = part.d / 2, maxY = y0 + part.h;
        if (part.rotY) out.push(obbCollider(cx, cz, hx, hz, Math.cos(part.rotY), -Math.sin(part.rotY), maxY, y0));
        else out.push(aabbCollider(cx - hx, cx + hx, cz - hz, cz + hz, maxY, y0));
      } else if (part.type === 'cylinder') {
        const rx = part.r, rz = part.rz || part.r;
        out.push(aabbCollider(cx - rx, cx + rx, cz - rz, cz + rz, y0 + part.h, y0));
      } else if (part.type === 'dome') {
        // flip hangs the hemisphere below its base plane (the
        // TPAC sphere): the solid spans y0 - h .. y0.
        if (part.flip) out.push(aabbCollider(cx - part.rx, cx + part.rx, cz - part.rz, cz + part.rz, y0, Math.max(0, y0 - part.h)));
        else out.push(aabbCollider(cx - part.rx, cx + part.rx, cz - part.rz, cz + part.rz, y0 + part.h, y0));
      } else if (part.type === 'frustum') {
        out.push(aabbCollider(s.x - part.wB / 2, s.x + part.wB / 2, s.z - part.dB / 2, s.z + part.dB / 2, y0 + part.h, y0));
      } else if (part.type === 'ridge') {
        out.push(aabbCollider(s.x - part.w / 2, s.x + part.w / 2, s.z - part.d / 2, s.z + part.d / 2, y0 + part.h + (part.ridgeH || 0), y0));
      }
      // 'shell' and other purely decorative part types carry no
      // collider: the 101 podium shell is a roof over an open
      // court, and the podium box beneath it is already solid.
    }
  }
  return out;
}

// Taipei 101 (plan.tower is its own shape, not a registry entry):
// the podium box + its box parts + one shaft AABB at the base
// half width. The shaft tapers, so the AABB over-covers it at
// altitude — only the helicopter can ever notice.
export function taipei101Colliders(tower) {
  if (!tower) return [];
  const out = [];
  const { x, z } = tower;
  if (tower.podium) {
    out.push(aabbCollider(
      x - tower.podium.w / 2, x + tower.podium.w / 2,
      z - tower.podium.d / 2, z + tower.podium.d / 2, tower.podium.h, 0));
  }
  for (const part of tower.podiumParts || []) {
    if (part.type !== 'box') continue;
    const cx = x + (part.dx || 0), cz = z + (part.dz || 0);
    const y0 = part.y0 || 0;
    out.push(aabbCollider(cx - part.w / 2, cx + part.w / 2, cz - part.d / 2, cz + part.d / 2, y0 + part.h, y0));
  }
  let hw = 0, y0 = Infinity;
  for (const tier of tower.tiers || []) {
    hw = Math.max(hw, tier.hwBottom || 0, tier.hwTop || 0);
    y0 = Math.min(y0, tier.y0 || 0);
  }
  if (hw > 0) {
    out.push(aabbCollider(x - hw, x + hw, z - hw, z + hw, tower.totalHeight || (y0 + hw * 4), y0 === Infinity ? 0 : y0));
  }
  return out;
}

// ------------------------------------------------------------------
// MRT station + depot colliders. The station frame is the
// renderer's: local +z along the track (yaw azimuth), +x across —
// cs = cos(yaw), sn = sin(yaw) in the resolver frame, hx the
// across half extent, hz the along half extent (both from
// mrtStationFootprint, the planner's own numbers). Vertical
// spans are read off the part stacks in
// buildMrtStationGeometry: [minY, maxY] per kind.
// ------------------------------------------------------------------
const STATION_SPANS = {
  standard: [4.6, 16.4],     // columns 0-4.6, body to the hip-roof crown
  beitou: [4.6, 21.1],       // body 4.6-19.4 + roof rise
  xinbeitou: [4.6, 16.4],    // body 4.6-13.0 + hip roof
  wenhu: [4.4, 14.5],        // concourse floor 4.4, vault crown 14.5
  'at-grade': [0, 7.65],     // platforms + bridge hall, ground-solid
  entrance: [0, 2.72],       // the surface pavilion whole
};

export function stationColliders(stations, depot) {
  const out = [];
  const pushStationBox = (st, alongOff, sizeAlong, sizeAcross, minY, maxY) => {
    const cy = Math.cos(st.yaw), sy = Math.sin(st.yaw);
    // local (across 0, along alongOff) -> world, the renderer's W
    const cx = st.x + alongOff * sy, cz = st.z + alongOff * cy;
    out.push(obbCollider(cx, cz, sizeAcross / 2, sizeAlong / 2, cy, sy, maxY, minY));
  };
  for (const st of stations || []) {
    const fp = mrtStationFootprint(st);
    if (st.kind === 'jiantan') {
      // The street-level concourse is ground-solid under the
      // hull; the hull itself starts at its 5.0 m floor.
      pushStationBox(st, -18, 76, 15.3, 0, 4.4);
      pushStationBox(st, 0, (fp.hl + 0.3) * 2, fp.hw * 2, 5.0, 17.0);
      continue;
    }
    const span = STATION_SPANS[st.kind] || STATION_SPANS.standard;
    pushStationBox(st, 0, fp.hl * 2, fp.hw * 2, span[0], span[1]);
  }
  for (const hall of depot?.halls || []) {
    const cy = Math.cos(hall.yaw), sy = Math.sin(hall.yaw);
    out.push(obbCollider(hall.x, hall.z, hall.wid / 2, hall.len / 2, cy, sy, hall.h, 0));
  }
  return out;
}

// Everything taipei-boot adds on top of buildCityBlocks' own lot
// colliders: deck parapets + registry/site structures + Taipei
// 101 + MRT stations + the depot. plan is planTaipeiBuildings'
// output; geo is the tile geodata.
export function taipeiExtraColliders(geo, plan) {
  const drive = buildDriveModel(geo.elevatedRoads);
  return [
    ...drive.parapetColliders,
    ...structureColliders([...(plan.landmarkTowers || []), ...(plan.siteStructures || [])]),
    ...taipei101Colliders(plan.tower),
    ...stationColliders(geo.mrtStations, geo.mrtDepot),
  ];
}
