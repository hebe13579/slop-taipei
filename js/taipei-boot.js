import * as THREE from 'three/webgpu';

// js/taipei-boot.js
// Ground-only boot builder for registry tiles (M1 foundation). It renders
// exactly what the geodata honestly contains — the tile land rectangle,
// block bounding rectangles, water polygons, park polygons and road
// centrelines as flat ribbons — and nothing it does not:
//
//   - NO buildings (block lot rects / frontage frames do not exist yet;
//     buildings.js stays out of the Taipei path — see taipei-adapter.js).
//   - NO traffic / pedestrians (the road graph exists in the geodata, but
//     road-network.js derives lanes from the NYC avenue/street grid; a
//     graph-driven network is the next increment).
//   - NO NYC systems: no boroughs, landmarks, piers, Central Park, bridges.
//   - Colliders / sidewalks / footprints are empty: controllers walk/drive
//     the flat tile at y=0.
//
// Layer heights are a flat-ground visual stack only (land 0, block rects
// 0.02, water 0.03, parks 0.04, non-carriageway paths 0.05, carriageways
// 0.06), not terrain elevation: the tile is the flat basin floor.

const NON_CARRIAGEWAY = new Set(['footway', 'path', 'steps', 'pedestrian', 'cycleway', 'corridor', 'elevator', 'crossing', 'platform', 'traffic_island']);

function flatPolygonGeometry(rings, y) {
  const positions = [];
  const indices = [];
  for (const ring of rings) {
    if (!ring || ring.length < 6) continue;
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

const mat = (color, roughness = 0.95, extra = {}) => new THREE.MeshStandardNodeMaterial({ color, roughness, metalness: 0.0, ...extra });

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
  addLayer(ribbonsGeometry(geo.roads.filter((r) => NON_CARRIAGEWAY.has(r.highway)), 0.05), mat(0xa9a294, 0.95), 'TaipeiPaths');
  addLayer(ribbonsGeometry(geo.roads.filter((r) => !NON_CARRIAGEWAY.has(r.highway)), 0.06), mat(0x33363b, 0.9), 'TaipeiRoads');

  scene.add(group);
  return {
    group,
    sidewalks: [],
    footprints: [],
    colliders: [],
    highwayLanes: [],
    allBlocks: [],
    update: null,
  };
}
