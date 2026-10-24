import * as THREE from 'three/webgpu';

import { planTaipeiBuildings, taipeiCityBlocksOptions, createTaipei101, createTaipeiLandmarkTowers } from './taipei-buildings.js';
import { buildSidewalkBands, planStreetTrees, planParkTrees } from './taipei-streetscape.js';
import { AvatarFigure } from './avatar-figure.js';
import { buildPaintedBands } from './taipei-painted.js';
import { SURFACE_TONES, surfaceClass, buildMedianStrips, isPlazaPark, isPodiumBlock, podiumCentresOf } from './taipei-surfaces.js';
import { buildRoadMarkings, detectJunctions } from './taipei-markings.js';
import { planJunctionCaps, ringPoints, CAP_Y } from './taipei-junctions.js';
import { unionExclusionRects, clipRectToBoxes } from './taipei-union.js';
import { createCurtainWallMaterial, createPreWarBuildingMaterial } from './tsl-materials.js';

// js/taipei-boot.js
// Boot builder for registry tiles. It renders what the geodata honestly
// contains — the tile land rectangle, block bounding rectangles, water
// polygons, park polygons and road centrelines as flat ribbons — plus,
// per roadbed, the Taiwan street-section band its pedestrianLayout
// calls for (see TAIWAN_STREETSCAPE.md), and the buildings planned by
// js/taipei-buildings.js (lots subdivided from the raster blocks),
// rendered by upstream's own building system (js/buildings.js); the
// Taipei 101 landmark gets a massing placeholder, as do the notable
// structures around it (issue #26: Nan Shan Plaza, The Sky Taipei,
// Fubon A25, Cathay Landmark, Uni-President, Tao Zhu Yin Yuan, the
// TWTC trade tower and City Hall — true heights, plain massing).
// Still absent:
//
//   - NO traffic / pedestrians (the road graph exists in the geodata, but
//     road-network.js derives lanes from the NYC avenue/street grid; a
//     graph-driven network is a later increment).
//   - NO NYC systems: no boroughs, landmarks, piers, Central Park, bridges.
//   - NO building colliders / footprints: controllers walk/drive the
//     flat tile at y=0 and pass through buildings for now.
//
// Layer heights are a flat-ground visual stack only (land 0, block rects
// 0.02, podium blocks 0.021, water 0.03, parks 0.04, plaza paving 0.041,
// street-section bands 0.045, non-carriageway paths 0.05, carriageways
// 0.06, junction caps 0.061, boulevard median strips 0.062,
// painted-walkway green band 0.065 and its white edge lines 0.066,
// road markings 0.068), not terrain elevation:
// the tile is the flat basin floor. Carriageways render in per-class
// surface tones and merged boulevards get a median strip (issue #29,
// js/taipei-surfaces.js); paved civic squares (廣場) render as paving,
// not lawn, and the 101 / City Hall blocks wear a podium tone.

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

// Wraps a flat xyz position array (6 vertices per quad, as produced by
// taipei-streetscape.js) into a geometry with computed normals.
function positionsGeometry(positions) {
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

// 標線型人行道 (painted walkways, TAIWAN_STREETSCAPE.md §c.3): a solid
// green band on ONE side of the carriageway, bounded by white lines on
// both of its edges — the real marking is a single-side band, not the
// twin edge stripes this replaced (issue #16). The band geometry —
// side hash, offsets, and the junction clipping that keeps bands off
// crossing carriageways (issue #25) — lives in js/taipei-painted.js as
// pure geometry so tests and audits run the exact code drawn here.
// This converts its quads ([x,z] x4, strip order) to triangle positions.
function quadsGeometry(quads, y) {
  const positions = new Float32Array(quads.length * 18);
  let o = 0;
  for (const q of quads) {
    positions.set([
      q[0], y, q[1], q[2], y, q[3], q[4], y, q[5],
      q[0], y, q[1], q[4], y, q[5], q[6], y, q[7],
    ], o);
    o += 18;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

function paintedGeometries(carriageways, yBand, yEdge, capPolys = null) {
  const { band, edges } = buildPaintedBands(carriageways, capPolys);
  return { band: quadsGeometry(band, yBand), edges: quadsGeometry(edges, yEdge) };
}

// Street-section band widths beyond the carriageway, by pedestrianLayout
// (TAIWAN_STREETSCAPE.md §c): an arcade (騎樓) band is the 3.6 m
// colonnade floor the buildings front onto, drawn here as a widened
// ribbon. Sidewalk bands used to be drawn the same way (a fixed 2 m
// widening); they are now real per-edge geometry with class widths and
// junction trimming — see buildSidewalkBands in taipei-streetscape.js
// (issue #27). Painted walkways get a green band on the carriageway
// instead (paintedGeometries); shared streets get no band at all.
const BAND_EXTRA = { arcade: 3.6 };

const mat = (color, roughness = 0.95, extra = {}) => new THREE.MeshStandardNodeMaterial({ color, roughness, metalness: 0.0, ...extra });

// ---------------------------------------------------------------------
// Trees (issues #28, #41): one low-poly tree — a 5-sided trunk and two
// icosahedron canopies (60 triangles) — merged into a single
// vertex-coloured geometry and drawn as ONE InstancedMesh, so every
// street and park tree on the tile is a single draw call. Placement is
// planStreetTrees' / planParkTrees' (taipei-streetscape.js); this
// section only turns positions into instances.
function streetTreeGeometry() {
  const parts = [];
  const addPart = (geo, color, x, y, z) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.translate(x, y, z);
    const pos = g.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color(color);
    for (let i = 0; i < pos.count; i++) { colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; }
    parts.push({ pos: pos.array, nor: g.getAttribute('normal').array, colors });
  };
  addPart(new THREE.CylinderGeometry(0.14, 0.2, 2.6, 5), 0x6b4a2f, 0, 1.3, 0);
  addPart(new THREE.IcosahedronGeometry(1.6, 0), 0x477a37, 0, 3.9, 0);
  addPart(new THREE.IcosahedronGeometry(1.05, 0), 0x548741, 0.55, 4.9, 0.2);
  const total = parts.reduce((s, p) => s + p.pos.length, 0);
  const positions = new Float32Array(total);
  const normals = new Float32Array(total);
  const colors = new Float32Array(total);
  let o = 0;
  for (const p of parts) { positions.set(p.pos, o); normals.set(p.nor, o); colors.set(p.colors, o); o += p.pos.length; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

function buildStreetTreeMesh(trees) {
  if (!trees.length) return null;
  const mesh = new THREE.InstancedMesh(
    streetTreeGeometry(),
    new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.0 }),
    trees.length,
  );
  mesh.name = 'TaipeiStreetTrees';
  const dummy = new THREE.Object3D();
  trees.forEach((t, i) => {
    dummy.position.set(t.x, 0, t.z);
    dummy.rotation.set(0, t.rot, 0);
    dummy.scale.setScalar(t.scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

// ---------------------------------------------------------------------
// Traffic signal units (issue #45): one static unit in local space,
// lamps facing +Z (the approaching driver) — a pole, a short mast arm
// and a horizontal 3-lamp head in the Taiwan arrangement (red left
// from the driver's seat), lenses in muted UNLIT colours (no phase
// cycle in this increment), plus the pedestrian signal box with a
// static lit red panel (no figure animation, no countdown — standing
// user directive). Placements come from taipei-markings.js; every
// unit is the same vertex-coloured geometry, transformed per
// placement and merged into ONE mesh / one draw call.
function signalUnitGeometry() {
  const parts = [];
  const addPart = (geo, color, x, y, z, rx = 0) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (rx) g.rotateX(rx);
    g.translate(x, y, z);
    const pos = g.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color(color);
    for (let i = 0; i < pos.count; i++) { colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; }
    parts.push({ pos: pos.array, nor: g.getAttribute('normal').array, colors });
  };
  addPart(new THREE.CylinderGeometry(0.09, 0.12, 5.6, 6), 0x2b2e33, 0, 2.8, 0); // pole
  addPart(new THREE.BoxGeometry(0.14, 0.14, 2.4), 0x2b2e33, 0, 5.52, 1.05); // mast arm
  addPart(new THREE.BoxGeometry(1.5, 0.44, 0.3), 0x17191d, 0, 5.02, 2.1); // head housing
  addPart(new THREE.CylinderGeometry(0.145, 0.145, 0.06, 10), 0x7a1f16, -0.48, 5.02, 2.27, Math.PI / 2); // red lens (unlit)
  addPart(new THREE.CylinderGeometry(0.145, 0.145, 0.06, 10), 0x7a5c14, 0, 5.02, 2.27, Math.PI / 2); // amber lens (unlit)
  addPart(new THREE.CylinderGeometry(0.145, 0.145, 0.06, 10), 0x1d5c2a, 0.48, 5.02, 2.27, Math.PI / 2); // green lens (unlit)
  addPart(new THREE.BoxGeometry(0.52, 0.64, 0.2), 0x17191d, 0, 2.9, 0.14); // pedestrian signal box
  addPart(new THREE.BoxGeometry(0.38, 0.5, 0.03), 0xa8321f, 0, 2.9, 0.25); // static lit red panel
  const total = parts.reduce((s, p) => s + p.pos.length, 0);
  const positions = new Float32Array(total);
  const normals = new Float32Array(total);
  const colors = new Float32Array(total);
  let o = 0;
  for (const p of parts) { positions.set(p.pos, o); normals.set(p.nor, o); colors.set(p.colors, o); o += p.pos.length; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

function buildSignalMesh(signals) {
  if (!signals.length) return null;
  const base = signalUnitGeometry();
  const vcount = base.getAttribute('position').count;
  // Buffers hold FLOATS: vcount vertices x 3 components per signal unit.
  // (Allocating vcount * signals.length here under-allocated 3x and
  // Float32Array.set threw RangeError mid-boot — the P1 hang at the
  // "Constructing Taipei" stage.)
  const positions = new Float32Array(vcount * 3 * signals.length);
  const normals = new Float32Array(vcount * 3 * signals.length);
  const colors = new Float32Array(vcount * 3 * signals.length);
  const dummy = new THREE.Object3D();
  signals.forEach((s, i) => {
    dummy.position.set(s.x, 0, s.z);
    dummy.rotation.set(0, Math.atan2(s.faceX, s.faceZ), 0);
    dummy.updateMatrix();
    const g = base.clone().applyMatrix4(dummy.matrix);
    positions.set(g.getAttribute('position').array, i * vcount * 3);
    normals.set(g.getAttribute('normal').array, i * vcount * 3);
    colors.set(g.getAttribute('color').array, i * vcount * 3);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.0 }));
  mesh.name = 'TaipeiTrafficSignals';
  return mesh;
}

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
// speedScale 2: the user asked for double top speed in Taipei
// (2026-10-23) — every mode's caps ×2, acceleration/handling unchanged.
export function controllerOptions(tile, env = {}) {
  const bb = tile.geodata.frame.bbox;
  const s = tile.spawn;
  return {
    bounds: { minX: bb.minX, maxX: bb.maxX, minZ: bb.minZ, maxZ: bb.maxZ },
    // Union-of-boxes tile (issue #60): the parts of the bounding rect
    // no box covers — the dropped bands — have no ground; the
    // controllers push ground modes out of them (see taipei-union.js).
    excludeRects: unionExclusionRects(tile.geodata.frame.boxes, bb),
    clampToShore: false,
    groundHeight: () => 0,
    speedScale: 2,
    // Helicopter (user request 2026-10-24): ceiling above 600 m — 750
    // clears Taipei 101 (508 m) with margin — and ascend/descend 5×
    // faster than the current in-Taipei rate: the vertical cap becomes
    // 16 m/s × speedScale 2 × heliVerticalScale 5 = 160 m/s.
    heliCeiling: 750,
    heliVerticalScale: 5,
    avatarFigureFactory: env.webglFallback ? (appearance) => new AvatarFigure(appearance) : null,
    spawnByMode: {
      person: { x: s.x - 15.2, z: s.z + 12 },
      car: { x: s.x, z: s.z + 12 },
      cyclist: { x: s.x + 1.6, z: s.z - 8 },
      helicopter: { x: s.x - 56, y: 96, z: s.z - 60 },
    },
  };
}

export function buildTaipeiGround(scene, tile, deps = {}) {
  const geo = tile.geodata;
  const bb = geo.frame.bbox;
  const group = new THREE.Group();
  group.name = 'TaipeiGround';

  // Land: one plane per tile box (issue #60) — the union's shape, so
  // the dropped bands between/around the boxes show sky/void like any
  // other tile edge instead of fake ground. A geodata without boxes
  // falls back to the single bounding-rect plane.
  const landRects = Array.isArray(geo.frame.boxes) && geo.frame.boxes.length ? geo.frame.boxes : [bb];
  for (const r of landRects) {
    const land = new THREE.Mesh(
      new THREE.PlaneGeometry(r.maxX - r.minX, r.maxZ - r.minZ).rotateX(-Math.PI / 2),
      mat(0x77796c, 1.0)
    );
    land.position.set((r.minX + r.maxX) / 2, 0, (r.minZ + r.maxZ) / 2);
    land.receiveShadow = true;
    group.add(land);
  }

  const addLayer = (geometry, material, name) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  // Blocks: ordinary raster blocks in the usual grey; the blocks
  // containing the Taipei 101 / City Government landmark centres are
  // the tower podium apron and the City Hall grounds, and wear the
  // podium paving tone a step above (issue #29 — as undifferentiated
  // block grey they read as bare etched ground).
  const centres = podiumCentresOf(geo);
  const ordinaryBlocks = [], podiumBlocks = [];
  // Block bboxes are raster bounding boxes: one wrapping a union
  // corner could poke into a dropped band, so the ground rects are
  // clipped to the union first (issue #60). The podium test then runs
  // per clipped piece — the piece holding a landmark centre wears the
  // podium tone, its in-union siblings stay ordinary.
  const groundBlocks = [];
  for (const b of geo.blocks) {
    for (const rect of clipRectToBoxes(b.bbox, geo.frame.boxes)) groundBlocks.push({ bbox: rect });
  }
  for (const b of groundBlocks) (isPodiumBlock(b, centres) ? podiumBlocks : ordinaryBlocks).push(b);
  addLayer(rectsGeometry(ordinaryBlocks, 0.02), mat(SURFACE_TONES.block), 'TaipeiBlocks');
  if (podiumBlocks.length) addLayer(rectsGeometry(podiumBlocks, 0.021), mat(SURFACE_TONES.podium), 'TaipeiPodiumBlocks');
  addLayer(flatPolygonGeometry(geo.water.map((w) => w.ring), 0.03), mat(0x2f6d96, 0.35), 'TaipeiWater');
  // Parks stay lawn-green; polygons named 廣場 are paved civic squares
  // in reality （市民廣場, 松壽廣場, 世貿廣場…) and render in the plaza
  // paving tone on their own layer (issue #29).
  const lawnParks = geo.parks.filter((p) => !isPlazaPark(p));
  const plazaParks = geo.parks.filter(isPlazaPark);
  addLayer(flatPolygonGeometry(lawnParks.map((p) => p.ring), 0.04), mat(SURFACE_TONES.park, 0.9), 'TaipeiParks');
  if (plazaParks.length) addLayer(flatPolygonGeometry(plazaParks.map((p) => p.ring), 0.041), mat(SURFACE_TONES.plaza, 0.95), 'TaipeiPlazas');
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
  // The arcade band is the colonnade's floor plate, not yet a covered
  // arcade, in a darker covered-walkway tone than the open sidewalks
  // (no arcade-layout beds exist in the current data, so this is the
  // tone a future colonnaded street will wear). Sidewalk bands are the
  // clipped per-edge geometry from taipei-streetscape.js (issue #27).
  const widened = (layout) => carriageways
    .filter((r) => r.pedestrianLayout === layout)
    .map((r) => ({ pts: r.pts, width: (r.width || 3) + BAND_EXTRA[layout] * 2 }));
  addLayer(ribbonsGeometry(widened('arcade'), 0.045), mat(0x8e8672), 'TaipeiArcadeBands');
  const sidewalkBands = buildSidewalkBands(carriageways, 0.045);
  addLayer(positionsGeometry(sidewalkBands.positions), mat(0xb5b0a4), 'TaipeiSidewalkBands');
  console.info(`[taipei-sidewalks] ${sidewalkBands.quadCount} band quads, ${(sidewalkBands.totalBandLength / 1000).toFixed(1)} km of sidewalk band (both edges, junction-trimmed)`);
  addLayer(ribbonsGeometry(geo.roads.filter((r) => NON_CARRIAGEWAY.has(r.highway)), 0.05), mat(0xa9a294, 0.95), 'TaipeiPaths');
  // Carriageways in per-class surface tones (issue #29): one merged
  // layer per class — weathered cool decks, the unchanged arterial
  // asphalt, a hair lighter collectors, pale concrete lanes — instead
  // of the single flat dark slab every bed used to share.
  const byClass = { deck: [], arterial: [], collector: [], lane: [] };
  for (const r of carriageways) byClass[surfaceClass(r)].push(r);
  addLayer(ribbonsGeometry(byClass.deck, 0.06), mat(SURFACE_TONES.deck, 0.9), 'TaipeiRoadsDeck');
  addLayer(ribbonsGeometry(byClass.arterial, 0.06), mat(SURFACE_TONES.arterial, 0.9), 'TaipeiRoads');
  addLayer(ribbonsGeometry(byClass.collector, 0.06), mat(SURFACE_TONES.collector, 0.9), 'TaipeiRoadsCollector');
  addLayer(ribbonsGeometry(byClass.lane, 0.06), mat(SURFACE_TONES.lane, 0.9), 'TaipeiRoadsLane');
  // Junction caps (issue #66, js/taipei-junctions.js): one paved
  // polygon per detected junction — the hull of its arms' cross-
  // sections — filling the junction box the butt-ended arm ribbons
  // leave bare or fan-overlapped, in the widest arm's surface tone
  // at 0.061. The caps double as the painted layers' occluder:
  // medians, painted bands and lane dashes clip against them
  // below, so no paint crosses a junction core. (Crosswalks and
  // stop lines are junction furniture and stay — at short-arm
  // junctions they now land on cap asphalt instead of bare ground;
  // see js/taipei-junctions.js.)
  // Junctions are detected ONCE here and shared with the markings
  // builder (which used to detect its own copy).
  const junctions = detectJunctions(carriageways);
  const caps = planJunctionCaps(carriageways, junctions);
  const capPolys = caps.map((c) => ringPoints(c.ring));
  const capsByClass = { deck: [], arterial: [], collector: [], lane: [] };
  for (const c of caps) capsByClass[c.cls].push(c.ring);
  for (const cls of Object.keys(capsByClass))
    if (capsByClass[cls].length) addLayer(flatPolygonGeometry(capsByClass[cls], CAP_Y), mat(SURFACE_TONES[cls], 0.9), `TaipeiJunctionCaps-${cls}`);
  console.info(`[taipei-junctions] ${caps.length} junction caps over ${junctions.length} detected junctions (${caps.reduce((s, c) => s + c.area, 0).toLocaleString('en-US')} m² of junction box paved)`);
  // Boulevard medians (issue #29): a strip along the centreline of
  // each merged bed wide enough to hold one — planted on the grand
  // ground boulevards, plain concrete elsewhere; underpass/tunnel
  // beds are excluded entirely by user directive. Clipped at
  // junctions like the painted bands, so no divider crosses a
  // junction box. Built by js/taipei-surfaces.js.
  const medians = buildMedianStrips(carriageways, capPolys);
  addLayer(quadsGeometry(medians.plain, 0.062), mat(SURFACE_TONES.medianPlain, 0.95), 'TaipeiMediansPlain');
  addLayer(quadsGeometry(medians.planted, 0.062), mat(SURFACE_TONES.medianPlanted, 0.95), 'TaipeiMediansPlanted');
  console.info(`[taipei-surfaces] medians: ${medians.stats.plantedBeds} planted beds / ${medians.stats.plantedKm.toFixed(1)} km, ${medians.stats.plainBeds} plain beds / ${medians.stats.plainKm.toFixed(1)} km (${medians.stats.excludedUnderpass} underpass/tunnel beds excluded); roads by class: deck ${byClass.deck.length}, arterial ${byClass.arterial.length}, collector ${byClass.collector.length}, lane ${byClass.lane.length}`);
  // Painted walkways (§c.3): a single green band per roadbed on its
  // hashed side in the spec colour, white edge lines a hair above it.
  // All carriageways go in (not just the painted ones): the builder
  // clips every band at junctions so no green crosses a carriageway
  // (issue #25).
  const painted = paintedGeometries(carriageways, 0.065, 0.066, capPolys);
  addLayer(painted.band, mat(0x1e9e57, 0.9), 'TaipeiPaintedStripes');
  addLayer(painted.edges, mat(0xf2f2f2, 0.9), 'TaipeiPaintedStripeEdges');
  // Road detail (issue #45, js/taipei-markings.js): dashed white lane
  // dividers between same-direction lanes (never on a median, broken
  // at junctions), zebra crosswalks + stop lines at signalized
  // junctions, and one STATIC signal unit per signalized approach —
  // pole + horizontal 3-lamp head with unlit lenses and a static lit
  // red pedestrian panel. No phase cycle yet, and traffic does not
  // obey them; scooter waiting boxes are out of scope (user cut).
  const markingsStart = performance.now();
  const markings = buildRoadMarkings(carriageways, medians, caps, junctions); // reuses the strips built above as dash occluders
  addLayer(
    quadsGeometry([...markings.dashes, ...markings.stripes, ...markings.stopLines], 0.068),
    mat(0xf2f2f2, 0.9),
    'TaipeiRoadMarkings'
  );
  const signalMesh = buildSignalMesh(markings.signals);
  if (signalMesh) group.add(signalMesh);
  console.info(`[taipei-markings] ${markings.stats.dividerKm.toFixed(1)} km of lane dividers on ${markings.stats.dividerBeds} beds; ${markings.stats.signalized} signalized junctions, ${markings.stats.crosswalks} crosswalks, ${markings.stats.stopLines} stop lines, ${markings.stats.signalUnits} static signal units planned in ${Math.round(performance.now() - markingsStart)}ms`);

  // Buildings on the raster blocks + the Taipei 101 massing. The lot
  // plan is js/taipei-buildings.js's; the rendering is upstream's
  // buildCityBlocks (js/buildings.js) fed the planned lots — the exact
  // machinery Manhattan renders with. (The first buildings increment
  // rendered the plan with a custom InstancedMesh whose buildings never
  // appeared on mobile WebGPU — issue #11.) main.js injects
  // buildCityBlocks (it already imports it for NYC) so this module's
  // import graph, and with it the Pages preload list, stay unchanged.
  // The [taipei-buildings] console line is the boot-log evidence for
  // this step's cost and yield.
  const buildingsStart = performance.now();
  const plan = planTaipeiBuildings(geo);
  const cityBlocks = deps.buildCityBlocks
    ? deps.buildCityBlocks(scene, taipeiCityBlocksOptions(geo, plan))
    : null;
  // Issue #57: the landmark builders take the TSL facade factories
  // injected (taipei-buildings.js stays import-free for the node
  // suite); ./tsl-materials.js is already on the Pages preload list.
  const landmarkFactories = { createCurtainWallMaterial, createPreWarBuildingMaterial };
  const tower = createTaipei101(THREE, plan, landmarkFactories);
  if (tower) group.add(tower);
  const landmarkTowers = createTaipeiLandmarkTowers(THREE, plan, landmarkFactories);
  if (landmarkTowers) group.add(landmarkTowers);
  console.info(`[taipei-buildings] ${plan.lots.length} buildings via upstream building system + Taipei 101 massing (508 m) + ${plan.landmarkTowers.length} landmark structures planned in ${Math.round(performance.now() - buildingsStart)}ms`);

  // Street trees (issue #28) + park trees (issue #41): ONE InstancedMesh
  // for the whole tile, planted by taipei-streetscape.js after the
  // building plan exists so trees keep out of the lots and landmark
  // sites. Static — no per-frame update, matching the other tile
  // systems' build-once cost model.
  const treesStart = performance.now();
  const treePlan = planStreetTrees(geo, plan);
  const parkTreePlan = planParkTrees(geo, plan);
  const treeMesh = buildStreetTreeMesh([...treePlan.trees, ...parkTreePlan.trees]);
  if (treeMesh) group.add(treeMesh);
  console.info(`[taipei-trees] ${treePlan.trees.length} street trees (${treePlan.stats.sidewalk} sidewalk, ${treePlan.stats.median} median${treePlan.stats.capped ? `, capped at ${treePlan.stats.cap}` : ''}) + ${parkTreePlan.trees.length} park trees${parkTreePlan.stats.capped ? ` (capped at ${parkTreePlan.stats.cap})` : ''} planned in ${Math.round(performance.now() - treesStart)}ms`);

  scene.add(group);
  return {
    group,
    buildings: plan,
    cityBlocks,
    sidewalks: [],
    footprints: [],
    colliders: [],
    highwayLanes: [],
    allBlocks: [],
    update: null,
  };
}
