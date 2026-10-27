import * as THREE from 'three/webgpu';

import { planTaipeiBuildings, taipeiCityBlocksOptions, createTaipei101, createTaipeiLandmarkTowers } from './taipei-buildings.js';
import { buildSidewalkBands, planStreetTrees, planParkTrees } from './taipei-streetscape.js';
import { AvatarFigure } from './avatar-figure.js';
import { buildPaintedBands } from './taipei-painted.js';
import { buildAirfieldPaint, buildRoadTunnelPortals, roadTrenchSlots } from './taipei-airfield.js';
import { SURFACE_TONES, surfaceClass, buildMedianStrips, isPlazaPark, isPodiumBlock, podiumCentresOf, memorialPaving, MEMORIAL_GRID_TONE } from './taipei-surfaces.js';
import { buildRoadMarkings, detectJunctions, DASH_LEN, DASH_GAP, STRIPE_W, STRIPE_PITCH } from './taipei-markings.js';
import { planJunctionCaps, planRoundabouts, ringPoints, capSurfacePolys, capClipPolys, CAP_Y, ISLAND_Y } from './taipei-junctions.js';
import { buildDeckGeometry, groundContactPolys, portalTrenchSlots, diveAdjustedPiers, PIER_W, PIER_D } from './taipei-viaduct.js';
import { ribbonsQuads, jointFramesFor } from './taipei-ribbons.js';
import { buildMrtStationGeometry, buildMrtDepotGeometry } from './taipei-mrt-stations.js';
import { buildTerrainSkinGeometry } from './taipei-terrain.js';
import { buildGreenTintLayers, GREEN_TINT_Y } from './taipei-green.js';
import { unionExclusionRects, clipRectToBoxes } from './taipei-union.js';
import { createCurtainWallMaterial, createPreWarBuildingMaterial, createTaipeiMarkingMaterial, setTaipeiSignAtlases } from './tsl-materials.js';
import { drawBandAtlas, drawBladeAtlas, BAND_ATLAS, BLADE_ATLAS, TAIPEI_BAND_SIGNS, TAIPEI_BLADE_SIGNS } from './taipei-signs.js';
import { createBuildProgress, TAIPEI_BUILD_STAGES } from './taipei-progress.js';

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
// 0.02, podium blocks 0.021, airfield site 0.022, airfield hard
// surfaces 0.024, Tamsui riverside band 0.025, airfield car-park
// pads 0.0255, airfield paint 0.026-0.028, water 0.03, parks 0.04, plaza paving 0.041,
// street-section bands 0.045, non-carriageway paths 0.05, carriageways
// 0.06, junction caps 0.061, boulevard median strips 0.062,
// roundabout islands 0.0635, painted-walkway green band 0.065
// and its white edge lines 0.066,
// road markings 0.068), not terrain elevation:
// the tile is the flat basin floor. The one true elevation in the
// tile is the elevated-highway decks (issue #61): real structures
// at their computed heights over the ground stack. Behind the
// northern boxes sits one pure backdrop: the DEM terrain skin
// (issue #129, js/taipei-terrain.js) — a displaced mesh that reads
// as the Datun foothills but is seated by a road-distance mask so
// it never touches the flat ground systems; controllers still see
// groundHeight() === 0 everywhere. Carriageways render in per-class
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

// Junction caps: fan-triangulated from each cap's origin with
// per-vertex colours — since issue #172 every vertex of a
// junction (ring, clipped pieces, strips) carries the ONE
// junction tone from capBlendTones in js/taipei-junctions.js:
// the width-weighted mean of the incident arms' tones, flat
// across the whole surface (issue #91's per-vertex mouth blend
// interpolated differently through each piece's fan and read as
// stepped plates — the #169 SEAM class). Planner tones are
// sRGB; setRGB with SRGBColorSpace converts them into the
// working space exactly as the flat materials' hex colours are
// converted, so a vertex at an arm's mouth is indistinguishable
// from the arm ribbon it touches. Fan triangles must wind so
// their normals point +Y: for the ring's shoelace sum S in XZ,
// (origin, i, i+1) faces up iff S < 0 — swap the pair otherwise.
function capFanGeometry(caps, y) {
  let verts = 0, tris = 0;
  for (const c of caps) { const n = c.ring.length / 2; verts += n + 1; tris += n; }
  const positions = new Float32Array(verts * 3);
  const colors = new Float32Array(verts * 3);
  const indices = new Uint32Array(tris * 3);
  const col = new THREE.Color();
  let vp = 0, ip = 0;
  const pushVert = (x, z, rgb) => {
    positions[vp] = x; positions[vp + 1] = y; positions[vp + 2] = z;
    col.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
    colors[vp] = col.r; colors[vp + 1] = col.g; colors[vp + 2] = col.b;
    vp += 3;
  };
  for (const c of caps) {
    const n = c.ring.length / 2;
    const base = vp / 3;
    pushVert(c.tones.origin[0], c.tones.origin[1], c.tones.centre);
    let S = 0;
    for (let i = 0; i < n; i++) {
      const x1 = c.ring[i * 2], z1 = c.ring[i * 2 + 1];
      const x2 = c.ring[((i + 1) % n) * 2], z2 = c.ring[((i + 1) % n) * 2 + 1];
      S += x1 * z2 - x2 * z1;
    }
    for (let i = 0; i < n; i++) pushVert(c.ring[i * 2], c.ring[i * 2 + 1], c.tones.ring[i]);
    for (let i = 0; i < n; i++) {
      const a = base + 1 + i, b = base + 1 + ((i + 1) % n);
      if (S < 0) { indices[ip++] = base; indices[ip++] = a; indices[ip++] = b; }
      else { indices[ip++] = base; indices[ip++] = b; indices[ip++] = a; }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
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

// Deck geometry from js/taipei-viaduct.js arrives with per-face
// normals already computed (flat shading), so both attributes are
// set directly.
function deckPartGeometry(part) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(part.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(part.normals, 3));
  return geo;
}

// Elevated-deck piers (issue #61): one InstancedMesh of the unit pier
// box (PIER_W x 1 x PIER_D, base at y=0), scaled per instance to the
// underside height the pipeline computed. Placement — 32 m rhythm,
// twin-carriageway merging, carriageway/lot rejection — all happened
// in tools/taipei/build-elevated.mjs; this only draws the boxes.
function buildDeckPierMesh(piers) {
  if (!piers.length) return null;
  const geo = new THREE.BoxGeometry(PIER_W, 1, PIER_D);
  geo.translate(0, 0.5, 0);
  const mesh = new THREE.InstancedMesh(geo, mat(0x8a877c, 0.95), piers.length);
  mesh.name = 'TaipeiDeckPiers';
  const dummy = new THREE.Object3D();
  piers.forEach((p, i) => {
    dummy.position.set(p.x, 0, p.z);
    dummy.rotation.set(0, p.yaw, 0);
    dummy.scale.set(1, Math.max(p.h, 0.1), 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Terrain skin (issue #129): one merged vertex-coloured mesh for
// the baked DEM backdrop grids (geodata.terrain). The geometry
// builder is pure (js/taipei-terrain.js). Visual only: the mesh is
// seated under the ground stack and masked away from every road;
// it casts no shadow and no system reads it back.
function buildTerrainSkinMesh(terrain) {
  if (!terrain?.grids?.length) return null;
  const g = buildTerrainSkinGeometry(terrain);
  if (!g.triCount) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(g.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(g.normals, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(g.colors, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 1.0, metalness: 0.0 }));
  mesh.name = 'TaipeiTerrainSkin';
  mesh.receiveShadow = true;
  mesh.userData.triCount = g.triCount;
  mesh.userData.grids = g.grids;
  return mesh;
}

// MRT elevated stations (issue #118): one merged vertex-coloured
// mesh for all station structures. The geometry builder is pure
// (js/taipei-mrt-stations.js); the defs come from the pipeline
// (geodata.mrtStations — OSM anchor + track yaw + measured length).
function buildMrtStationMesh(stations) {
  if (!stations?.length) return null;
  const g = buildMrtStationGeometry(stations);
  if (!g.triCount) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(g.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(g.normals, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(g.colors, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.0 }));
  mesh.name = 'TaipeiMrtStations';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Beitou depot (issue #139): the maintenance halls + yard fan as
// one merged vertex-coloured mesh, same idiom as the stations.
function buildMrtDepotMesh(depot) {
  if (!depot) return null;
  const g = buildMrtDepotGeometry(depot);
  if (!g.triCount) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(g.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(g.normals, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(g.colors, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.0 }));
  mesh.name = 'TaipeiMrtDepot';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Ribbon geometry comes from js/taipei-ribbons.js (issue #173):
// per-vertex miter frames instead of the per-segment square butt
// ends that left triangular NOTCH wedges on every bend, plus shared
// end frames at cross-road continuation joints. `jointFrames` lets
// the per-class carriageway layers share one joint map computed
// over the full carriageway set (a continuation can cross classes).
function ribbonsGeometry(roads, y, jointFrames = null) {
  return quadsGeometry(ribbonsQuads(roads, jointFrames).quads, y);
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

// Shader-marking geometry (issue #90): the divider strips and
// crosswalk bands from js/taipei-markings.js as one merged geometry
// whose `paint` vertex attribute carries (along, period, duty) per
// vertex — along is the strip's centreline arc for dashes (period
// DASH_LEN + DASH_GAP) and the lateral distance from the band's low
// edge for zebras (period STRIPE_PITCH). The pattern itself is
// evaluated by createTaipeiMarkingMaterial; this only lays out the
// ribbons. Triangle order mirrors quadsGeometry's strip order so
// the faces point up exactly like the solid quads they replace.
function patternGeometry(strips, bands, y) {
  let verts = 0;
  for (const s of strips) verts += (s.length - 1) * 6;
  verts += bands.length * 6;
  const positions = new Float32Array(verts * 3);
  const paint = new Float32Array(verts * 3);
  let o = 0, p = 0;
  const tri = (ax, az, aAlong, bx, bz, bAlong, cx, cz, cAlong, period, duty) => {
    positions.set([ax, y, az, bx, y, bz, cx, y, cz], o); o += 9;
    paint.set([aAlong, period, duty, bAlong, period, duty, cAlong, period, duty], p); p += 9;
  };
  const dashPeriod = DASH_LEN + DASH_GAP, dashDuty = DASH_LEN / dashPeriod;
  for (const s of strips) {
    for (let i = 0; i + 1 < s.length; i++) {
      const a = s[i], b = s[i + 1];
      tri(a.hx, a.hz, a.along, b.hx, b.hz, b.along, b.lx, b.lz, b.along, dashPeriod, dashDuty);
      tri(a.hx, a.hz, a.along, b.lx, b.lz, b.along, a.lx, a.lz, a.along, dashPeriod, dashDuty);
    }
  }
  const zebraDuty = STRIPE_W / STRIPE_PITCH;
  for (const b of bands) {
    const q = b.quad; // corners: (u-, hi) (u+, hi) (u+, lo) (u-, lo); along 0 at the lo edge
    tri(q[0], q[1], b.width, q[2], q[3], b.width, q[4], q[5], 0, STRIPE_PITCH, zebraDuty);
    tri(q[0], q[1], b.width, q[4], q[5], 0, q[6], q[7], 0, STRIPE_PITCH, zebraDuty);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('paint', new THREE.BufferAttribute(paint, 3));
  geo.computeVertexNormals();
  return geo;
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
// Traffic signal units (issues #45 + #64): static units in local
// space, lamps facing +Z (the approaching driver), in TWO kinds the
// planner in taipei-markings.js chooses per approach:
//   'pole' — a plain corner pole with a short bracket head;
//   'mast' — the T-shape mast-arm unit for DIVIDED approaches only:
//     a horizontal arm reaching from the corner pole over the
//     approach carriageway (local −X: the placed frame maps +X to
//     the driver's right, so the carriageway lies toward −X), with
//     3-lamp heads hanging along it.
// Both carry the horizontal 3-lamp head in the Taiwan arrangement
// (red left from the driver's seat), lenses in muted UNLIT colours
// (no phase cycle), plus the pedestrian signal box with a static
// lit red panel on the pole (no figure animation, no countdown —
// standing user directive); the pedestrian panel shares the unit's
// corner placement. Placements stand at roadside corners, clear of
// every carriageway (issue #64). Every unit is vertex-coloured
// geometry, transformed per placement and merged into ONE mesh /
// one draw call.
function signalPartsGeometry(build) {
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
  const head = (hx, hy, hz) => {
    addPart(new THREE.BoxGeometry(1.5, 0.44, 0.3), 0x17191d, hx, hy, hz); // head housing
    addPart(new THREE.CylinderGeometry(0.145, 0.145, 0.06, 10), 0x7a1f16, hx - 0.48, hy, hz + 0.17, Math.PI / 2); // red lens (unlit)
    addPart(new THREE.CylinderGeometry(0.145, 0.145, 0.06, 10), 0x7a5c14, hx, hy, hz + 0.17, Math.PI / 2); // amber lens (unlit)
    addPart(new THREE.CylinderGeometry(0.145, 0.145, 0.06, 10), 0x1d5c2a, hx + 0.48, hy, hz + 0.17, Math.PI / 2); // green lens (unlit)
  };
  const pedBox = () => {
    addPart(new THREE.BoxGeometry(0.52, 0.64, 0.2), 0x17191d, 0, 2.9, 0.14); // pedestrian signal box
    addPart(new THREE.BoxGeometry(0.38, 0.5, 0.03), 0xa8321f, 0, 2.9, 0.25); // static lit red panel
  };
  build(addPart, head, pedBox);
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

function signalPoleGeometry() {
  return signalPartsGeometry((addPart, head, pedBox) => {
    addPart(new THREE.CylinderGeometry(0.09, 0.12, 5.6, 6), 0x2b2e33, 0, 2.8, 0); // pole
    addPart(new THREE.BoxGeometry(0.14, 0.14, 0.9), 0x2b2e33, 0, 5.38, 0.38); // bracket toward the approach
    head(0, 5.05, 0.72);
    pedBox();
  });
}

function signalMastGeometry(armLen) {
  return signalPartsGeometry((addPart, head, pedBox) => {
    addPart(new THREE.CylinderGeometry(0.09, 0.12, 5.6, 6), 0x2b2e33, 0, 2.8, 0); // pole
    addPart(new THREE.BoxGeometry(armLen, 0.16, 0.16), 0x2b2e33, -armLen / 2, 5.55, 0); // mast arm over the carriageway (−X)
    const heads = armLen >= 6.5 ? [-armLen * 0.45, -armLen + 0.8] : [-armLen + 0.8];
    for (const hx of heads) {
      addPart(new THREE.BoxGeometry(0.08, 0.42, 0.08), 0x2b2e33, hx, 5.32, 0); // hanger
      head(hx, 4.95, 0);
    }
    pedBox();
  });
}

function buildSignalMesh(signals) {
  if (!signals.length) return null;
  const poleBase = signalPoleGeometry();
  // Merge the per-unit transformed geometries by concatenating
  // their attribute arrays. Buffers hold FLOATS and are sized from
  // the arrays themselves, so the total is exact by construction —
  // mast units carry per-unit arm lengths and cannot share one
  // vcount (the PR #58 under-allocation came from assuming one:
  // vcount vertices x 3 float components per unit, never vcount x
  // units).
  const chunks = [];
  let total = 0;
  const dummy = new THREE.Object3D();
  signals.forEach((s) => {
    const base = s.kind === 'mast' ? signalMastGeometry(s.armLen || 8) : poleBase;
    dummy.position.set(s.x, 0, s.z);
    dummy.rotation.set(0, Math.atan2(s.faceX, s.faceZ), 0);
    dummy.updateMatrix();
    const g = base.clone().applyMatrix4(dummy.matrix);
    const p = g.getAttribute('position').array;
    chunks.push({ p, n: g.getAttribute('normal').array, c: g.getAttribute('color').array });
    total += p.length;
  });
  const positions = new Float32Array(total);
  const normals = new Float32Array(total);
  const colors = new Float32Array(total);
  let o = 0;
  for (const ch of chunks) { positions.set(ch.p, o); normals.set(ch.n, o); colors.set(ch.c, o); o += ch.p.length; }
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
    // Helicopter horizontal speed ×3 from current (user request
    // 2026-10-24, issue #101): cruise 32 × speedScale 2 ×
    // heliSpeedScale 3 = 192 m/s, boost 52 × 2 × 3 = 312 m/s. The
    // vertical cap stays at 160 m/s (heliVerticalScale's knob).
    heliSpeedScale: 3,
    avatarFigureFactory: env.webglFallback ? (appearance) => new AvatarFigure(appearance) : null,
    spawnByMode: {
      person: { x: s.x - 15.2, z: s.z + 12 },
      car: { x: s.x, z: s.z + 12 },
      cyclist: { x: s.x + 1.6, z: s.z - 8 },
      helicopter: { x: s.x - 56, y: 96, z: s.z - 60 },
    },
  };
}

// Between construction stages the boot yields to the browser so the
// loading screen can paint the progress the stage just reported
// (issue #63). rAF is the paint signal; the timeout is the fallback
// for a backgrounded tab, where rAF never fires and waiting on it
// would stall the build itself.
const yieldForPaint = () => new Promise((resolve) => {
  let settled = false;
  const done = () => { if (!settled) { settled = true; resolve(); } };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(done);
  setTimeout(done, 60);
});

// Async since issue #63: construction runs in the stages listed in
// js/taipei-progress.js, reporting each stage as it completes via
// deps.onProgress and yielding for a paint between stages. The stage
// boundaries below sit exactly where the builders' own console.info
// lines already divided the work — no builder is restructured.
// Issue #196: the portal trenches are open cuts in the flat
// ground — every flat layer that crosses a trench footprint must
// leave the slot open (no ground surface may bridge the cut). The
// helpers below do exact polygon differences against the slot
// quads (convex): a ring that touches no slot passes through
// unchanged, so the rest of the tile renders byte-identically.
const ringPairs = (ring) => { const p = []; for (let i = 0; i + 1 < ring.length; i += 2) p.push([ring[i], ring[i + 1]]); return p; };
const pipXZ = (p, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (((zi > p[1]) !== (zj > p[1])) && (p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi)) inside = !inside;
  }
  return inside;
};
const quadIntersectsPts = (quad, pts) => {
  const qb = [Math.min(...quad.map((p) => p[0])), Math.min(...quad.map((p) => p[1])), Math.max(...quad.map((p) => p[0])), Math.max(...quad.map((p) => p[1]))];
  const pb = [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
  if (qb[0] > pb[2] || qb[2] < pb[0] || qb[1] > pb[3] || qb[3] < pb[1]) return false;
  if (pts.some((p) => pipXZ(p, quad)) || quad.some((p) => pipXZ(p, pts))) return true;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  if (pts.some((p, i) => pipXZ(mid(p, pts[(i + 1) % pts.length]), quad))) return true;
  if (quad.some((p, i) => pipXZ(mid(p, quad[(i + 1) % 4]), pts))) return true;
  const segX = (a, b, c, d) => {
    const den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
    if (Math.abs(den) < 1e-12) return false;
    const t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den;
    const u = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / -den;
    return t > 0 && t < 1 && u > 0 && u < 1;
  };
  return pts.some((p, i) => quad.some((q, j) => segX(p, pts[(i + 1) % pts.length], q, quad[(j + 1) % 4])));
};
// Sutherland–Hodgman half-plane clip: keep the side of the line
// a->b where cross(b-a, p-a) has the requested sign.
const clipHalfPlane = (poly, a, b, sign) => {
  const cross = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const cp = cross(p) * sign, cq = cross(q) * sign;
    if (cp >= -1e-9) out.push(p);
    if ((cp > 1e-9 && cq < -1e-9) || (cp < -1e-9 && cq > 1e-9)) {
      const t = cp / (cp - cq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
};
// ring (point array) minus a convex quad -> simple-polygon pieces.
const subtractQuad = (pts, quad) => {
  let inside = [pts];
  const pieces = [];
  const cen = [quad.reduce((s, p) => s + p[0], 0) / 4, quad.reduce((s, p) => s + p[1], 0) / 4];
  for (let e = 0; e < 4; e++) {
    const a = quad[e], b = quad[(e + 1) % 4];
    const sideCen = Math.sign((b[0] - a[0]) * (cen[1] - a[1]) - (b[1] - a[1]) * (cen[0] - a[0])) || 1;
    const next = [];
    for (const poly of inside) {
      const outPart = clipHalfPlane(poly, a, b, -sideCen);
      if (outPart.length >= 3) pieces.push(outPart);
      const inPart = clipHalfPlane(poly, a, b, sideCen);
      if (inPart.length >= 3) next.push(inPart);
    }
    inside = next;
    if (!inside.length) break;
  }
  return pieces;
};
// Flat rings minus every slot quad -> flat rings (identity when a
// ring touches no slot).
const clipRingsToSlots = (rings, slots) => {
  if (!slots.length) return rings;
  const out = [];
  for (const ring of rings) {
    const pts = ringPairs(ring);
    if (!slots.some((s) => quadIntersectsPts(s, pts))) { out.push(ring); continue; }
    let polys = [pts];
    for (const s of slots) {
      const next = [];
      for (const p of polys) { if (quadIntersectsPts(s, p)) next.push(...subtractQuad(p, s)); else next.push(p); }
      polys = next;
    }
    for (const p of polys) out.push(p.flatMap((pt) => pt));
  }
  return out;
};

export async function buildTaipeiGround(scene, tile, deps = {}) {
  const geo = tile.geodata;
  const bb = geo.frame.bbox;
  const group = new THREE.Group();
  group.name = 'TaipeiGround';

  const progress = createBuildProgress(deps.onProgress);
  let stageNo = 0;
  let stageStart = performance.now();
  const completeStage = async (id, detail = '') => {
    const ms = Math.round(performance.now() - stageStart);
    const fraction = progress.complete(id, detail);
    stageNo++;
    console.info(`[taipei-progress] stage ${stageNo}/${TAIPEI_BUILD_STAGES.length} '${id}' complete in ${ms}ms (fraction ${fraction.toFixed(3)}${detail ? `; ${detail}` : ''})`);
    await yieldForPaint();
    stageStart = performance.now();
  };

  // Land: one plane per tile box (issue #60) — the union's shape, so
  // the dropped bands between/around the boxes show sky/void like any
  // other tile edge instead of fake ground. A geodata without boxes
  // falls back to the single bounding-rect plane.
  // Issue #196: the portal trenches (the MRT dive cuttings + the
  // 復北地下道 approach cuts) are slots in this plane — a box a
  // slot touches is built as a shape with holes instead of a plane,
  // so no ground surface bridges a cut.
  const trenchSlots = [
    ...portalTrenchSlots(geo.mrtDecks || { lines: [] }),
    ...roadTrenchSlots(geo.airfield),
  ];
  const landRects = Array.isArray(geo.frame.boxes) && geo.frame.boxes.length ? geo.frame.boxes : [bb];
  for (const r of landRects) {
    const rectPts = [[r.minX, r.minZ], [r.maxX, r.minZ], [r.maxX, r.maxZ], [r.minX, r.maxZ]];
    const holes = trenchSlots.filter((s) => quadIntersectsPts(s, rectPts));
    if (!holes.length) {
      const land = new THREE.Mesh(
        new THREE.PlaneGeometry(r.maxX - r.minX, r.maxZ - r.minZ).rotateX(-Math.PI / 2),
        mat(0x77796c, 1.0)
      );
      land.position.set((r.minX + r.maxX) / 2, 0, (r.minZ + r.maxZ) / 2);
      land.receiveShadow = true;
      group.add(land);
      continue;
    }
    // Shape (x, -z) -> world (x, 0, z) under rotateX(-PI/2).
    const shape = new THREE.Shape();
    shape.moveTo(r.minX, -r.minZ);
    shape.lineTo(r.maxX, -r.minZ);
    shape.lineTo(r.maxX, -r.maxZ);
    shape.lineTo(r.minX, -r.maxZ);
    shape.closePath();
    for (const s of holes) {
      const hole = new THREE.Path();
      s.forEach(([x, z], i) => { if (i) hole.lineTo(x, -z); else hole.moveTo(x, -z); });
      hole.closePath();
      shape.holes.push(hole);
    }
    const land = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2), mat(0x77796c, 1.0));
    land.receiveShadow = true;
    group.add(land);
  }

  // Terrain skin (issue #129): the DEM backdrop for the northern
  // boxes, built with the land planes so it sits under the whole
  // ground stack. It rises only where the baked road mask leaves
  // the flat benches alone (see js/taipei-terrain.js).
  const terrainMesh = buildTerrainSkinMesh(geo.terrain);
  if (terrainMesh) {
    group.add(terrainMesh);
    console.info(`[taipei-terrain] skin: ${terrainMesh.userData.triCount.toLocaleString('en-US')} tris over ${terrainMesh.userData.grids.map((g) => `${g.box} (max ${g.maxY.toFixed(0)} m)`).join(', ')}`);
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
  // Issue #196: a block rect a trench slot crosses is replaced by
  // the rect-minus-slot polygons at the same height and tone.
  const addBlockLayer = (blocks, y, tone, name) => {
    const plainRects = [], pieces = [];
    for (const b of blocks) {
      const { minX, maxX, minZ, maxZ } = b.bbox;
      const rectPts = [[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]];
      if (!trenchSlots.some((s) => quadIntersectsPts(s, rectPts))) { plainRects.push(b); continue; }
      let polys = [rectPts];
      for (const s of trenchSlots) {
        const next = [];
        for (const p of polys) { if (quadIntersectsPts(s, p)) next.push(...subtractQuad(p, s)); else next.push(p); }
        polys = next;
      }
      for (const p of polys) pieces.push(p.flatMap((pt) => pt));
    }
    if (plainRects.length) addLayer(rectsGeometry(plainRects, y), mat(tone), name);
    if (pieces.length) addLayer(flatPolygonGeometry(pieces, y), mat(tone), name);
  };
  addBlockLayer(ordinaryBlocks, 0.02, SURFACE_TONES.block, 'TaipeiBlocks');
  if (podiumBlocks.length) addBlockLayer(podiumBlocks, 0.021, SURFACE_TONES.podium, 'TaipeiPodiumBlocks');
  // Green-layer ground tint (issue #141, js/taipei-green.js): the
  // #114 green land (farmland, wood, wetland, reserves) finally
  // renders its own colours instead of the block grey — the Guandu
  // plain reads green from the air. One layer per sampled tone at
  // GREEN_TINT_Y (0.0235): above the block/podium greys, below the
  // airfield surfaces, the riverside band (0.025), water (0.03) and
  // parks (0.04), so every measured overlap keeps its existing
  // winner — wetland channels stay water, park interiors stay lawn.
  // Visual-only: the planner never reads this (its byte-identity is
  // pinned in tests/green-tint.test.mjs).
  const greenTint = buildGreenTintLayers(geo.green);
  for (const layer of greenTint) {
    addLayer(flatPolygonGeometry(clipRingsToSlots(layer.rings, trenchSlots), GREEN_TINT_Y), mat(layer.tone, 0.95), 'TaipeiGreenTint');
  }
  if (greenTint.length) {
    const ringCount = greenTint.reduce((s, l) => s + l.rings.length, 0);
    console.info(`[taipei-green] ground tint: ${ringCount} rings in ${greenTint.length} tone layers at y=${GREEN_TINT_Y} (issue #141)`);
  }
  // Songshan airfield (issue #134): the aerodrome site ground in a
  // muted field green-grey at 0.022 and its hard surfaces (runway,
  // taxiways, aprons) in pale concrete at 0.024 — both below water so
  // nothing here can paint over a channel, both above the block grey
  // so the raster blocks under the field stay hidden. The planner
  // keeps the site lot-free; the terminal/parking structures are #135.
  if (geo.airfield?.site?.length) {
    addLayer(flatPolygonGeometry(clipRingsToSlots(geo.airfield.site.map((s) => s.ring), trenchSlots), 0.022), mat(0x7f9673, 0.95), 'TaipeiAirfieldSite');
    if (geo.airfield.surfaces?.length) addLayer(flatPolygonGeometry(clipRingsToSlots(geo.airfield.surfaces, trenchSlots), 0.024), mat(0x9d9d97, 0.6), 'TaipeiAirfieldSurfaces');
    // Airfield detail (issue #135): the terminal car-park pads in
    // asphalt at 0.0255 and the paint layer (js/taipei-airfield.js)
    // — taxiway edge lines 0.026, centrelines + stand lead-ins
    // 0.027, runway white 0.028 — all flat paint on the site in
    // the markings stack's manner, below water so nothing here
    // can paint over the Keelung River channel at the field's
    // east end.
    const paint = buildAirfieldPaint(geo.airfield);
    if (paint.pads.length) addLayer(flatPolygonGeometry(paint.pads, 0.0255), mat(0x8f8f8b, 0.97), 'TaipeiAirfieldParking');
    if (paint.yellowEdge.length) addLayer(quadsGeometry(paint.yellowEdge, 0.026), mat(0xd9a514, 0.9), 'TaipeiAirfieldTaxiwayEdges');
    if (paint.yellowCentre.length) addLayer(quadsGeometry(paint.yellowCentre, 0.027), mat(0xd9a514, 0.9), 'TaipeiAirfieldTaxiwayCentres');
    if (paint.white.length) addLayer(quadsGeometry(paint.white, 0.028), mat(0xe9e9e2, 0.9), 'TaipeiAirfieldRunwayPaint');
    // Issue #183: the 復北地下道 portals — where the suppressed
    // tunnel bed dives under the field, dressed in the #173 MRT
    // portal form (deck concrete tone, near-black bores) by
    // js/taipei-airfield.js. The bed itself emits nothing at grade
    // inside the site (generation-map rework v5). Issue #196: the
    // mouths sit at the bottom of open approach cuts (rework v6
    // clipped the flat approach beds; the trench floors below
    // replace them).
    const roadPortals = buildRoadTunnelPortals(geo.airfield);
    if (roadPortals.concrete.positions.length) {
      const portalMesh = addLayer(deckPartGeometry(roadPortals.concrete), mat(0x98958a, 0.95), 'TaipeiRoadTunnelPortals');
      portalMesh.castShadow = true;
    }
    if (roadPortals.dark.positions.length) addLayer(deckPartGeometry(roadPortals.dark), mat(0x14161a, 1.0), 'TaipeiRoadTunnelOpenings');
    // Issue #196: the approach cuts' asphalt floors, descending
    // from grade to the re-seated faces (arterial tone — the
    // underpass is a secondary road).
    if (roadPortals.floor.positions.length) addLayer(deckPartGeometry(roadPortals.floor), mat(0x33363b, 0.95), 'TaipeiRoadTunnelFloors');
  }
  // Tamsui riverside band (issue #137): bank-offset rings at 0.025 in
  // the park tone — under the water layer (0.03), so the channel stays
  // water and only the land-side strip reads green from the air.
  if (geo.riverside?.polys?.length) {
    addLayer(flatPolygonGeometry(clipRingsToSlots(geo.riverside.polys.map((p) => p.ring), trenchSlots), 0.025), mat(SURFACE_TONES.park, 0.9), 'TaipeiRiverside');
  }
  addLayer(flatPolygonGeometry(clipRingsToSlots(geo.water.map((w) => w.ring), trenchSlots), 0.03), mat(0x2f6d96, 0.35), 'TaipeiWater');
  // Parks stay lawn-green; polygons named 廣場 are paved civic squares
  // in reality （市民廣場, 松壽廣場, 世貿廣場…) and render in the plaza
  // paving tone on their own layer (issue #29).
  const lawnParks = geo.parks.filter((p) => !isPlazaPark(p));
  const plazaParks = geo.parks.filter(isPlazaPark);
  addLayer(flatPolygonGeometry(clipRingsToSlots(lawnParks.map((p) => p.ring), trenchSlots), 0.04), mat(SURFACE_TONES.park, 0.9), 'TaipeiParks');
  if (plazaParks.length) addLayer(flatPolygonGeometry(clipRingsToSlots(plazaParks.map((p) => p.ring), trenchSlots), 0.041), mat(SURFACE_TONES.plaza, 0.95), 'TaipeiPlazas');
  // CKS Memorial grounds (issue #98 follow-up): Liberty Square, its
  // forecourt, the Boulevard of Homage strip and the terrace apron
  // are paved stone inside the lawn-green memorial park — flat plaza
  // paving at 0.042 with the square's subtle tile grid at 0.043
  // (js/taipei-surfaces.js memorialPaving, satellite-authored).
  const memorial = memorialPaving();
  addLayer(flatPolygonGeometry(memorial.rings, 0.042), mat(SURFACE_TONES.plaza, 0.95), 'TaipeiMemorialPaving');
  addLayer(flatPolygonGeometry(memorial.gridQuads, 0.043), mat(MEMORIAL_GRID_TONE, 0.95), 'TaipeiMemorialPavingGrid');
  await completeStage('ground', `${landRects.length} land boxes, ${groundBlocks.length} blocks, ${geo.water.length} water polygons, ${geo.parks.length} parks`);
  // Carriageways render from the generation map's roadbeds when the geodata
  // carries them (issue #6: divided boulevards merged into one roadbed,
  // sub-120 m link ramps dropped). Per-way ribbons remain the fallback for
  // a geodata built without a generation map. Non-carriageway paths above
  // always come from the raw roads array.
  const carriageways = Array.isArray(geo.roadbeds) && geo.roadbeds.length
    ? geo.roadbeds
    : geo.roads.filter((r) => !NON_CARRIAGEWAY.has(r.highway));
  // Issue #173: continuation-joint frames over the whole carriageway
  // set, shared by the band layer and the per-class layers below.
  const carriagewayJoints = jointFramesFor(carriageways);
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
  addLayer(ribbonsGeometry(widened('arcade'), 0.045, carriagewayJoints), mat(0x8e8672), 'TaipeiArcadeBands');
  const sidewalkBands = buildSidewalkBands(carriageways, 0.045);
  addLayer(positionsGeometry(sidewalkBands.positions), mat(0xb5b0a4), 'TaipeiSidewalkBands');
  console.info(`[taipei-sidewalks] ${sidewalkBands.quadCount} band quads, ${(sidewalkBands.totalBandLength / 1000).toFixed(1)} km of sidewalk band (both edges, junction-trimmed)`);
  addLayer(ribbonsGeometry(geo.roads.filter((r) => NON_CARRIAGEWAY.has(r.highway)), 0.05), mat(0xa9a294, 0.95), 'TaipeiPaths');
  // Carriageways in per-class surface tones (issue #29): one merged
  // layer per class — weathered cool decks, the unchanged arterial
  // asphalt, a hair lighter collectors, pale concrete lanes — instead
  // of the single flat dark slab every bed used to share. Deck beds
  // (issue #61: roadbeds flagged deck in the generation map) are NOT
  // drawn here — their pavement is the elevated deck built below;
  // they stay in `carriageways` for every ground planner (junction
  // caps, medians, markings, signals), so the ground picture under a
  // deck is exactly what it was when the deck was a boulevard.
  const byClass = { deck: [], arterial: [], collector: [], lane: [] };
  for (const r of carriageways) if (!r.deck) byClass[surfaceClass(r)].push(r);
  addLayer(ribbonsGeometry(byClass.deck, 0.06, carriagewayJoints), mat(SURFACE_TONES.deck, 0.9), 'TaipeiRoadsDeck');
  addLayer(ribbonsGeometry(byClass.arterial, 0.06, carriagewayJoints), mat(SURFACE_TONES.arterial, 0.9), 'TaipeiRoads');
  addLayer(ribbonsGeometry(byClass.collector, 0.06, carriagewayJoints), mat(SURFACE_TONES.collector, 0.9), 'TaipeiRoadsCollector');
  addLayer(ribbonsGeometry(byClass.lane, 0.06, carriagewayJoints), mat(SURFACE_TONES.lane, 0.9), 'TaipeiRoadsLane');
  await completeStage('roads', `${carriageways.length} roadbeds, ${sidewalkBands.quadCount} sidewalk band quads`);
  // Junction caps (issues #66/#75/#145, js/taipei-junctions.js):
  // one paved polygon per detected junction at 0.061, in per-vertex
  // blended arm tones (issue #91; the roundabout discs below keep
  // their widest-arm tone) — the OVERLAP cap since #145: the
  // junction box of the arms' own crossing geometry plus mouth
  // segments at majors and signalized minors, filling the
  // junction box the butt-ended arm ribbons
  // leave bare or fan-overlapped. Roundabouts are handcrafted
  // instead (issue #75): a plain asphalt disc + a defined island
  // at 0.0635 (planted, or plaza paving at 北門）; junctions a
  // site claims get no cap. The caps + discs double as the
  // painted layers' occluder for medians and painted bands (lane
  // dashes clip against caps only, so the rings keep their lane
  // lines), so no paint crosses a junction core. (Crosswalks and
  // stop lines are junction furniture and stay — the mouth
  // segments keep them on the cap's asphalt or the arm's ribbon;
  // see js/taipei-junctions.js.)
  // Junctions are detected ONCE here and shared with the markings
  // builder (which used to detect its own copy).
  const junctions = detectJunctions(carriageways);
  const roundabouts = planRoundabouts(carriageways, junctions);
  const caps = planJunctionCaps(carriageways, junctions, roundabouts, capClipPolys(geo));
  const capPolys = [
    ...caps.flatMap((c) => capSurfacePolys(c)),
    ...roundabouts.flatMap((s) => [s.disc, ...s.aprons]).map((c) => ringPoints(c.ring)),
  ];
  const capMaterial = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.0 });
  // Issue #171: a cap whose ring was cut by the green clip
  // renders its remaining ring pieces in the same fan layer.
  addLayer(capFanGeometry([...caps, ...caps.flatMap((c) => c.pieces || [])], CAP_Y), capMaterial, 'TaipeiJunctionCaps');
  // Issue #163: the fitted caps' arm extension strips render as
  // their own fan layer half a millimetre UNDER the rings — the
  // strips overlap the box ring and each other by design (seam
  // insurance at the ribbon butt and the box edge), and the
  // 0.5 mm step (the stack's own discipline: caps sit 1 mm over
  // the carriageways) keeps those overlaps from z-fighting.
  const capExtras = caps.flatMap((c) => c.extras || []);
  if (capExtras.length) addLayer(capFanGeometry(capExtras, CAP_Y - 0.0005), capMaterial, 'TaipeiJunctionCapExtensions');
  const discsByClass = { deck: [], arterial: [], collector: [], lane: [] };
  for (const s of roundabouts) {
    discsByClass[s.disc.cls].push(s.disc.ring);
    for (const ap of s.aprons) discsByClass[s.disc.cls].push(ap.ring);
  }
  for (const cls of Object.keys(discsByClass))
    if (discsByClass[cls].length) addLayer(flatPolygonGeometry(discsByClass[cls], CAP_Y), mat(SURFACE_TONES[cls], 0.9), `TaipeiJunctionCaps-${cls}`);
  const islandsByKind = { planted: [], plaza: [] };
  for (const s of roundabouts) islandsByKind[s.island.kind].push(s.island.ring);
  if (islandsByKind.planted.length) addLayer(flatPolygonGeometry(islandsByKind.planted, ISLAND_Y), mat(SURFACE_TONES.park, 0.9), 'TaipeiRoundaboutIslands-planted');
  if (islandsByKind.plaza.length) addLayer(flatPolygonGeometry(islandsByKind.plaza, ISLAND_Y), mat(SURFACE_TONES.plaza, 0.9), 'TaipeiRoundaboutIslands-plaza');
  console.info(`[taipei-junctions] ${caps.length} junction caps over ${junctions.length} detected junctions (${caps.reduce((s, c) => s + c.area, 0).toLocaleString('en-US')} m² of junction box paved + ${capExtras.length} arm extension strips, ${caps.reduce((s, c) => s + (c.extraArea || 0), 0).toLocaleString('en-US')} m², at fitted caps); ${caps.filter((c) => c.kind === 'box').length} box / ${caps.filter((c) => c.kind === 'fitted').length} fitted; roundabouts handcrafted: ${roundabouts.map((s) => `${s.id} disc r=${s.discR}${s.islandR ? ` island r=${s.islandR}` : ' capsule island'} (${s.claimedJunctions.length} junctions claimed${s.aprons.length ? `, ${s.aprons.length} entry aprons` : ''})`).join(', ')}`);
  await completeStage('junctions', `${caps.length} caps + ${roundabouts.length} roundabouts over ${junctions.length} junctions`);
  // Boulevard medians (issue #29): a strip along the centreline of
  // each merged bed wide enough to hold one — planted on the grand
  // ground boulevards, plain concrete elsewhere; underpass/tunnel
  // beds are excluded entirely by user directive. Clipped at
  // junctions like the painted bands, so no divider crosses a
  // junction box. Built by js/taipei-surfaces.js.
  const medians = buildMedianStrips(carriageways, capPolys);
  addLayer(quadsGeometry(medians.plain, 0.062), mat(SURFACE_TONES.medianPlain, 0.95), 'TaipeiMediansPlain');
  addLayer(quadsGeometry(medians.planted, 0.062), mat(SURFACE_TONES.medianPlanted, 0.95), 'TaipeiMediansPlanted');
  console.info(`[taipei-surfaces] medians: ${medians.stats.plantedBeds} planted beds / ${medians.stats.plantedKm.toFixed(1)} km, ${medians.stats.plainBeds} plain beds / ${medians.stats.plainKm.toFixed(1)} km (${medians.stats.excludedUnderpass} underpass/tunnel beds excluded, ${medians.stats.deckBedsSkipped} deck beds suppressed #167); roads by class: deck ${byClass.deck.length}, arterial ${byClass.arterial.length}, collector ${byClass.collector.length}, lane ${byClass.lane.length}`);
  // Painted walkways (§c.3): a single green band per roadbed on its
  // hashed side in the spec colour, white edge lines a hair above it.
  // All carriageways go in (not just the painted ones): the builder
  // clips every band at junctions so no green crosses a carriageway
  // (issue #25).
  const painted = paintedGeometries(carriageways, 0.065, 0.066, capPolys);
  addLayer(painted.band, mat(0x1e9e57, 0.9), 'TaipeiPaintedStripes');
  addLayer(painted.edges, mat(0xf2f2f2, 0.9), 'TaipeiPaintedStripeEdges');
  await completeStage('medians', `${medians.stats.plantedBeds + medians.stats.plainBeds} median beds, painted walkways clipped at ${capPolys.length} junction caps`);
  // Road detail (issue #45, js/taipei-markings.js): dashed white lane
  // dividers between same-direction lanes (never on a median, broken
  // at junctions), zebra crosswalks + stop lines at signalized
  // junctions, and one STATIC signal unit per signalized approach —
  // pole + horizontal 3-lamp head with unlit lenses and a static lit
  // red pedestrian panel. No phase cycle yet, and traffic does not
  // obey them; scooter waiting boxes are out of scope (user cut).
  const markingsStart = performance.now();
  const markings = buildRoadMarkings(carriageways, medians, caps, junctions,
    [...(geo.parks || []), ...(geo.green || [])].map((g) => ringPoints(g.ring))); // reuses the strips built above as dash occluders; greens feed the #173 roundabout wedge occluders
  // Dashes and zebra stripes render as shader patterns over plain
  // ribbons/bands (issue #90 — the plan in taipei-markings.js is
  // unchanged; only the baking moved into the fragment shader).
  // Stop lines are single solid quads, not periodic, and keep the
  // solid path.
  addLayer(
    patternGeometry(markings.dashStrips, markings.bands, 0.068),
    createTaipeiMarkingMaterial(),
    'TaipeiRoadMarkings'
  );
  addLayer(
    quadsGeometry(markings.stopLines, 0.068),
    mat(0xf2f2f2, 0.9),
    'TaipeiRoadStopLines'
  );
  const signalMesh = buildSignalMesh(markings.signals);
  if (signalMesh) group.add(signalMesh);
  console.info(`[taipei-markings] ${markings.stats.dividerKm.toFixed(1)} km of lane dividers on ${markings.stats.dividerBeds} beds; ${markings.stats.signalized} signalized junctions, ${markings.stats.crosswalks} crosswalks, ${markings.stats.stopLines} stop lines, ${markings.stats.signalUnits} static signal units (${markings.stats.signalMast} mast-arm / ${markings.stats.signalPole} corner-pole, ${markings.stats.clearanceUnresolved} unresolved corners) planned in ${Math.round(performance.now() - markingsStart)}ms`);
  await completeStage('markings', `${markings.stats.crosswalks} crosswalks, ${markings.stats.signalUnits} signal units`);

  // Elevated highway decks (issue #61, js/taipei-viaduct.js): the
  // 建國 / 市民大道 / 基隆路高架 corridors and their ramps as real
  // structures — one merged box-section mesh (slab + parapets) with
  // an asphalt top in the deck surface tone, plus one InstancedMesh
  // of piers. Heights, ramp profiles and pier placement were
  // computed by the pipeline (tools/taipei/build-elevated.mjs) into
  // geodata.elevatedRoads. Drawn, not driven: no collision, no
  // traffic — the ground streets under the decks carry everything,
  // as they did when the corridors rendered as ground boulevards.
  if (geo.elevatedRoads?.lines?.length) {
    const decksStart = performance.now();
    const deckGeo = buildDeckGeometry(geo.elevatedRoads);
    const concrete = addLayer(deckPartGeometry(deckGeo.concrete), mat(0x98958a, 0.95), 'TaipeiDecks');
    concrete.castShadow = true;
    const deckTop = addLayer(deckPartGeometry(deckGeo.asphalt), mat(SURFACE_TONES.deck, 0.9), 'TaipeiDeckAsphalt');
    deckTop.castShadow = true;
    const pierMesh = buildDeckPierMesh(geo.elevatedRoads.piers || []);
    if (pierMesh) group.add(pierMesh);
    console.info(`[taipei-decks] ${deckGeo.lineCount} deck lines (${geo.elevatedRoads.stats?.lineKm ?? '?'} km), ${deckGeo.pierCount} piers, ${deckGeo.triCount.toLocaleString('en-US')} triangles in ${Math.round(performance.now() - decksStart)}ms`);
  }
  // MRT Red Line (issue #118): the same deck idiom on the sibling
  // geodata field — guideway decks (elevated 圓山→北投 + branch,
  // portal ramp out of the 民權西路 tunnel, at-grade low bed after
  // Beitou) plus the elevated station structures. The underground
  // stretch emits nothing, as it should. Issue #139: the decks get
  // the brown track treatment (ballast strips + rails instead of
  // the asphalt ribbon), the three at-grade stations join the
  // station mesh, and the Beitou depot stands by Fuxinggang.
  // Issue #146: the Wenhu (Brown) Line rides the same field — its
  // lines carry the concrete-guideway treatment instead (pale
  // strips + steel guide bars, no ballast), its four barrel-vault
  // stations join the station mesh, and the underground Songshan
  // Airport station is present only as two entrance headhouses.
  let mrtDetail = '';
  if (geo.mrtDecks?.lines?.length) {
    const mrtGeo = buildDeckGeometry(geo.mrtDecks, { tracks: true });
    const mrtConcrete = addLayer(deckPartGeometry(mrtGeo.concrete), mat(0x98958a, 0.95), 'TaipeiMrtDecks');
    mrtConcrete.castShadow = true;
    if (mrtGeo.ballast.positions.length) {
      const mrtBallast = addLayer(deckPartGeometry(mrtGeo.ballast), mat(0x6e5136, 1.0), 'TaipeiMrtBallast');
      mrtBallast.castShadow = true;
      mrtBallast.receiveShadow = true;
    }
    if (mrtGeo.rails.positions.length) {
      const mrtRails = addLayer(deckPartGeometry(mrtGeo.rails), mat(0x8f9296, 0.45), 'TaipeiMrtRails');
      mrtRails.castShadow = true;
    }
    if (mrtGeo.guideway.positions.length) {
      const mrtGuideways = addLayer(deckPartGeometry(mrtGeo.guideway), mat(0xb8bcb2, 0.95), 'TaipeiMrtGuideways');
      mrtGuideways.castShadow = true;
      mrtGuideways.receiveShadow = true;
    }
    // Issue #173: the dive-portal mouths (headwall + wing walls in
    // the deck concrete tone, the dark opening near-black) where a
    // track line truly dives — the 民權西路 portal in this tile.
    if (mrtGeo.portal.positions.length) {
      const mrtPortals = addLayer(deckPartGeometry(mrtGeo.portal), mat(0x98958a, 0.95), 'TaipeiMrtPortals');
      mrtPortals.castShadow = true;
    }
    if (mrtGeo.portalDark.positions.length) {
      addLayer(deckPartGeometry(mrtGeo.portalDark), mat(0x14161a, 1.0), 'TaipeiMrtPortalOpenings');
    }
    // Issue #196: piers under the re-profiled dive ramps are
    // clamped to the lowered deck underside (the records in
    // geodata keep their digest heights).
    const mrtPiers = buildDeckPierMesh(diveAdjustedPiers(geo.mrtDecks));
    if (mrtPiers) { mrtPiers.name = 'TaipeiMrtDeckPiers'; group.add(mrtPiers); }
    const stationMesh = buildMrtStationMesh(geo.mrtStations || []);
    if (stationMesh) group.add(stationMesh);
    const depotMesh = buildMrtDepotMesh(geo.mrtDepot);
    if (depotMesh) group.add(depotMesh);
    mrtDetail = `, MRT ${geo.mrtDecks.lines.length} lines + ${(geo.mrtStations || []).length} stations`;
    console.info(`[taipei-mrt] ${mrtGeo.lineCount} deck lines (${geo.mrtDecks.stats?.lineKm ?? '?'} km), ${mrtGeo.pierCount} piers, ${(geo.mrtStations || []).length} stations${geo.mrtDepot ? ', Beitou depot' : ''}`);
  }
  await completeStage('decks', geo.elevatedRoads?.lines?.length ? `${geo.elevatedRoads.lines.length} elevated lines${mrtDetail}` : 'no elevated roads in tile');

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
  // Issue #105: real-text 招牌 — paint the shop-name atlases and
  // inject them into the sign materials BEFORE buildCityBlocks
  // creates them (the shophouse bands sample the band atlas, the
  // vertical blades the blade atlas; js/taipei-signs.js holds the
  // pool and the painters). A failure here must never block the
  // city: the materials keep their glyph treatment without atlases.
  try {
    const mkSignTexture = (draw, atlas) => {
      const c = document.createElement('canvas');
      c.width = atlas.w;
      c.height = atlas.h;
      draw(c.getContext('2d'));
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      return t;
    };
    setTaipeiSignAtlases(
      mkSignTexture(drawBandAtlas, BAND_ATLAS),
      mkSignTexture(drawBladeAtlas, BLADE_ATLAS)
    );
    console.info(`[taipei-signs] real-text sign atlases ready (${TAIPEI_BAND_SIGNS.length} band plates, ${TAIPEI_BLADE_SIGNS.length} blade plates)`);
  } catch (err) {
    console.warn('[taipei-signs] sign atlas build failed; glyph signs remain', err);
  }
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
  // Songshan Airport site structures (issue #135): the terminal
  // complex, rendered with the landmark massing path but kept
  // off the registry (no pins/search) — see
  // AIRPORT_SITE_STRUCTURES in js/taipei-buildings.js.
  if (plan.siteStructures?.length) {
    const siteStructures = createTaipeiLandmarkTowers(THREE, { landmarkTowers: plan.siteStructures }, landmarkFactories);
    if (siteStructures) { siteStructures.name = 'TaipeiAirportSiteStructures'; group.add(siteStructures); }
  }
  console.info(`[taipei-buildings] ${plan.lots.length} buildings via upstream building system + Taipei 101 massing (508 m) + ${plan.landmarkTowers.length} landmark structures planned in ${Math.round(performance.now() - buildingsStart)}ms`);
  await completeStage('buildings', `${plan.lots.length} buildings, ${plan.landmarkTowers.length} landmark structures + Taipei 101`);

  // Street trees (issue #28) + park trees (issue #41): ONE InstancedMesh
  // for the whole tile, planted by taipei-streetscape.js after the
  // building plan exists so trees keep out of the lots and landmark
  // sites. Static — no per-frame update, matching the other tile
  // systems' build-once cost model.
  const treesStart = performance.now();
  // Issue #81: trees never stand on junction asphalt — the planners
  // receive the cap rings + roundabout disc/apron rings computed
  // above as exclusion polygons (their centreline-distance checks
  // cannot see a cap corner 20+ m from every centreline).
  // Issue #178: the cap part of the exclusions is the cap's FULL
  // paved surface (capSurfacePolys: ring + #163 strips + #171
  // clipped pieces) — ring + extras alone left the clipped pieces
  // plantable, and the roadsweep-2 census found exactly one street
  // tree standing on a piece at ji1029. The module's own comment on
  // capSurfacePolys has prescribed this for occlusion consumers
  // all along; the boot's tree list now follows it too.
  const treeExclusions = [
    ...caps.flatMap((c) => capSurfacePolys(c).map((p) => p.flatMap((pt) => pt))),
    ...roundabouts.flatMap((s) => [s.disc.ring, ...s.aprons.map((a) => a.ring)]),
    // Issue #173: the MRT beds where they touch the ground (at-grade
    // stretches + the portal fan-outs) — a tree stood on the ballast
    // at the s09 dive in the #169 sweep; the corridors are not
    // roadbeds, so the bed grid never covered them.
    ...groundContactPolys(geo.mrtDecks || { lines: [] }).map((p) => p.flatMap((pt) => pt)),
    // Issue #196: the trench slots themselves — a tree at grade
    // beside a dive must not land inside the open cut (the road
    // cuts' corridors are roadbeds, already excluded via the beds;
    // the MRT cuttings are not).
    ...trenchSlots.map((s) => s.flatMap((pt) => pt)),
  ];
  const treePlan = planStreetTrees(geo, plan, { exclusions: treeExclusions });
  const parkTreePlan = planParkTrees(geo, plan, { exclusions: treeExclusions });
  const treeMesh = buildStreetTreeMesh([...treePlan.trees, ...parkTreePlan.trees]);
  if (treeMesh) group.add(treeMesh);
  console.info(`[taipei-trees] ${treePlan.trees.length} street trees (${treePlan.stats.sidewalk} sidewalk, ${treePlan.stats.median} median${treePlan.stats.capped ? `, capped at ${treePlan.stats.cap}` : ''}) + ${parkTreePlan.trees.length} park trees${parkTreePlan.stats.capped ? ` (capped at ${parkTreePlan.stats.cap})` : ''} planned in ${Math.round(performance.now() - treesStart)}ms`);
  await completeStage('trees', `${treePlan.trees.length + parkTreePlan.trees.length} trees`);

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
