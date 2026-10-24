import * as THREE from 'three/webgpu';

import { createTaipeiBuildings } from './taipei-buildings.js';
import { AvatarFigure } from './avatar-figure.js';

// js/taipei-boot.js
// Boot builder for registry tiles. It renders what the geodata honestly
// contains — the tile land rectangle, block bounding rectangles, water
// polygons, park polygons and road centrelines as flat ribbons — plus,
// per roadbed, the Taiwan street-section band its pedestrianLayout
// calls for (see TAIWAN_STREETSCAPE.md), and the procedural buildings
// of js/taipei-buildings.js (lots subdivided from the raster blocks;
// the Taipei 101 landmark gets a massing placeholder). Still absent:
//
//   - NO traffic / pedestrians (the road graph exists in the geodata, but
//     road-network.js derives lanes from the NYC avenue/street grid; a
//     graph-driven network is a later increment).
//   - NO NYC systems: no boroughs, landmarks, piers, Central Park, bridges.
//   - NO building colliders / footprints: controllers walk/drive the
//     flat tile at y=0 and pass through buildings for now.
//
// Layer heights are a flat-ground visual stack only (land 0, block rects
// 0.02, water 0.03, parks 0.04, street-section bands 0.045,
// non-carriageway paths 0.05, carriageways 0.06, painted-walkway green
// stripes 0.065), not terrain elevation: the tile is the flat basin floor.

const NON_CARRIAGEWAY = new Set(['footway', 'path', 'steps', 'pedestrian', 'cycleway', 'corridor', 'elevator', 'crossing', 'platform', 'traffic_island']);

function flatPolygonGeometry(rings, y) {
  const positions = [];
  const indices = [];
  for (const ring of rings) {
    if (!ring || ring.length < 6) continue;
    // Defence in depth: a ring with a non-finite coordinate would smear
    // triangles across the whole tile. The generated rings are verified
    // finite/simple/non-degenerate by tests/taipei.test.mjs, so this never
    // triggers on current data — it exists so a bad future regeneration
    // degrades to a missing pond, not a broken tile.
    let finite = true;
    for (let i = 0; i < ring.length; i++) if (!Number.isFinite(ring[i])) { finite = false; break; }
    if (!finite) continue;
    const contour = [];
    for (let i = 0; i + 1 < ring.length; i += 2) contour.push(new THREE.Vector2(ring[i], -ring[i + 1]));
    // Drop a duplicated closing point: ShapeUtils expects an open contour.
    if (contour.length > 1 && contour[0].distanceTo(contour[contour.length - 1]) < 0.01) contour.pop();
    if (contour.length < 3) continue;
    let faces;
    try {
      faces = THREE.ShapeUtils.triangulateShape(contour, []);
    } catch {
      continue; // a degenerate source ring must not kill the whole boot
    }
    const base = positions.length / 3;
    for (const p of contour) positions.push(p.x, y, -p.y);
    for (const f of faces) indices.push(base + f[0], base + f[1], base + f[2]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function rectsGeometry(blocks, y) {
  const positions = new Float32Array(blocks.length * 18);
  let o = 0;
  for (const b of blocks) {
    const { minX, maxX, minZ, maxZ } = b.bbox;
    // Two triangles wound so computeVertexNormals yields +y (up) normals.
    positions.set([minX, y, minZ, maxX, y, maxZ, maxX, y, minZ, minX, y, minZ, minX, y, maxZ, maxX, y, maxZ], o);
    o += 18;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

function ribbonsGeometry(roads, y) {
  let segments = 0;
  for (const r of roads) segments += Math.max(0, r.pts.length / 2 - 1);
  const positions = new Float32Array(segments * 18);
  let o = 0;
  for (const r of roads) {
    const half = Math.max((r.width || 3) / 2, 0.75);
    for (let i = 0; i + 3 < r.pts.length; i += 2) {
      const ax = r.pts[i], az = r.pts[i + 1], bx = r.pts[i + 2], bz = r.pts[i + 3];
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz);
      if (len < 0.01) continue;
      const nx = (-dz / len) * half, nz = (dx / len) * half;
      const axn = ax + nx, azn = az + nz, axp = ax - nx, azp = az - nz;
      const bxn = bx + nx, bzn = bz + nz, bxp = bx - nx, bzp = bz - nz;
      positions.set([axn, y, azn, bxn, y, bzn, bxp, y, bzp, axn, y, azn, bxp, y, bzp, axp, y, azp], o);
      o += 18;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions.subarray(0, o), 3));
  geo.computeVertexNormals();
  return geo;
}

// Green edge stripes for 標線型人行道 (painted walkways): two thin bands
// just inside the roadbed edges, following the centreline. Winding
// mirrors ribbonsGeometry (first offset strictly greater than second,
// so the computed normals point up).
function stripesGeometry(roadbeds, y) {
  let segments = 0;
  for (const r of roadbeds) segments += Math.max(0, r.pts.length / 2 - 1);
  const positions = new Float32Array(segments * 2 * 18);
  let o = 0;
  for (const r of roadbeds) {
    const half = Math.max((r.width || 3) / 2, 0.75);
    if (half < 1.4) continue; // too narrow to carry two stripes
    for (let i = 0; i + 3 < r.pts.length; i += 2) {
      const ax = r.pts[i], az = r.pts[i + 1], bx = r.pts[i + 2], bz = r.pts[i + 3];
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz);
      if (len < 0.01) continue;
      const nx = -dz / len, nz = dx / len;
      for (const s of [1, -1]) {
        const o1 = s * (half - 0.05), o2 = s * (half - 1.25);
        const p = Math.max(o1, o2), q = Math.min(o1, o2);
        positions.set([
          ax + nx * p, y, az + nz * p, bx + nx * p, y, bz + nz * p, bx + nx * q, y, bz + nz * q,
          ax + nx * p, y, az + nz * p, bx + nx * q, y, bz + nz * q, ax + nx * q, y, az + nz * q,
        ], o);
        o += 18;
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions.subarray(0, o), 3));
  geo.computeVertexNormals();
  return geo;
}

// Street-section band widths beyond the carriageway, by pedestrianLayout
// (TAIWAN_STREETSCAPE.md §c): a formal sidewalk adds ~2 m a side; an
// arcade (騎樓) band is the 3.6 m colonnade floor the buildings front
// onto. Painted walkways get green stripes on the carriageway instead
// (stripesGeometry); shared streets get no band at all.
const BAND_EXTRA = { sidewalk: 2.0, arcade: 3.6 };

const mat = (color, roughness = 0.95, extra = {}) => new THREE.MeshStandardNodeMaterial({ color, roughness, metalness: 0.0, ...extra });

// Controller world options for a registry tile (see the opts contract in
// js/controllers.js): the playable world is the tile's own frame — NOT
// Manhattan's island bounds or shoreline, which would clamp away the
// tile's western kilometre (Da'an Forest Park sits at x ≈ −2900, west of
// NYC's west shore) and invent Central Park / sidewalk heights on the
// flat basin floor. Ground is y = 0 everywhere; spawns cluster at the
// tile spawn with the same relative offsets the NYC spawns use.
// `env.webglFallback` (main.js passes the live renderer backend): on the
// WebGL2 fallback the crowd material's storage-buffer skinning
// miscompiles and the avatar crowds streak across the tile (issue #12),
// so the controllers get a factory for CPU-posed avatar figures instead.
// On a real WebGPU renderer the factory stays null and the skinned
// crowds render exactly as upstream intends.
export function controllerOptions(tile, env = {}) {
  const bb = tile.geodata.frame.bbox;
  const s = tile.spawn;
  return {
    bounds: { minX: bb.minX, maxX: bb.maxX, minZ: bb.minZ, maxZ: bb.maxZ },
    clampToShore: false,
    groundHeight: () => 0,
    avatarFigureFactory: env.webglFallback ? (appearance) => new AvatarFigure(appearance) : null,
    spawnByMode: {
      person: { x: s.x - 15.2, z: s.z + 12 },
      car: { x: s.x, z: s.z + 12 },
      cyclist: { x: s.x + 1.6, z: s.z - 8 },
      helicopter: { x: s.x - 56, y: 96, z: s.z - 60 },
    },
  };
}

export function buildTaipeiGround(scene, tile) {
  const geo = tile.geodata;
  const bb = geo.frame.bbox;
  const group = new THREE.Group();
  group.name = 'TaipeiGround';

  const land = new THREE.Mesh(
    new THREE.PlaneGeometry(bb.maxX - bb.minX, bb.maxZ - bb.minZ).rotateX(-Math.PI / 2),
    mat(0x77796c, 1.0)
  );
  land.position.set((bb.minX + bb.maxX) / 2, 0, (bb.minZ + bb.maxZ) / 2);
  land.receiveShadow = true;
  group.add(land);

  const addLayer = (geometry, material, name) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  addLayer(rectsGeometry(geo.blocks, 0.02), mat(0x8f8b80), 'TaipeiBlocks');
  addLayer(flatPolygonGeometry(geo.water.map((w) => w.ring), 0.03), mat(0x2f6d96, 0.35), 'TaipeiWater');
  addLayer(flatPolygonGeometry(geo.parks.map((p) => p.ring), 0.04), mat(0x56854a, 0.9), 'TaipeiParks');
  // Carriageways render from the generation map's roadbeds when the geodata
  // carries them (issue #6: divided boulevards merged into one roadbed,
  // sub-120 m link ramps dropped). Per-way ribbons remain the fallback for
  // a geodata built without a generation map. Non-carriageway paths above
  // always come from the raw roads array.
  const carriageways = Array.isArray(geo.roadbeds) && geo.roadbeds.length
    ? geo.roadbeds
    : geo.roads.filter((r) => !NON_CARRIAGEWAY.has(r.highway));
  // Street-section bands at 0.045: below the paths layer (0.05) so park
  // and campus paths still read over a band, above parks (0.04) so a
  // riverside boulevard's sidewalk isn't swallowed by the park fill.
  // Bands are flat colour in this increment — the arcade band is the
  // colonnade's floor plate, not yet a covered arcade.
  const widened = (layout) => carriageways
    .filter((r) => r.pedestrianLayout === layout)
    .map((r) => ({ pts: r.pts, width: (r.width || 3) + BAND_EXTRA[layout] * 2 }));
  addLayer(ribbonsGeometry(widened('sidewalk'), 0.045), mat(0xb5b0a4), 'TaipeiSidewalkBands');
  addLayer(ribbonsGeometry(widened('arcade'), 0.045), mat(0xc2b59d), 'TaipeiArcadeBands');
  addLayer(ribbonsGeometry(geo.roads.filter((r) => NON_CARRIAGEWAY.has(r.highway)), 0.05), mat(0xa9a294, 0.95), 'TaipeiPaths');
  addLayer(ribbonsGeometry(carriageways, 0.06), mat(0x33363b, 0.9), 'TaipeiRoads');
  addLayer(stripesGeometry(carriageways.filter((r) => r.pedestrianLayout === 'painted'), 0.065), mat(0x35794a, 0.9), 'TaipeiPaintedStripes');

  // Procedural buildings on the raster blocks + the Taipei 101 massing
  // (js/taipei-buildings.js). The [taipei-buildings] console line is the
  // boot-log evidence for this step's cost and yield.
  const buildingsStart = performance.now();
  const buildings = createTaipeiBuildings(THREE, geo);
  group.add(buildings.group);
  console.info(`[taipei-buildings] ${buildings.plan.lots.length} buildings + Taipei 101 massing (508 m) planned in ${Math.round(performance.now() - buildingsStart)}ms`);

  scene.add(group);
  return {
    group,
    buildings: buildings.plan,
    sidewalks: [],
    footprints: [],
    colliders: [],
    highwayLanes: [],
    allBlocks: [],
    update: null,
  };
}
