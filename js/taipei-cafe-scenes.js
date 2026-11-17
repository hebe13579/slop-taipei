// js/taipei-cafe-scenes.js
// Sidewalk café / plaza scenes (issue #377): a small café terrace in
// the sidewalk strip in front of a shophouse — outdoor tables +
// chairs, a bench, a street tree, a chalkboard A-frame menu board,
// and a line-up of parked scooters (static props).
//
// Placement rule (the genre question): the shop name on a lot's band
// sign is picked in the SHADER (bandPlateColor, js/tsl-materials.js:
// hash2D over the bay id and a boxSeed that is the instance index
// within a material bucket) — replaying it in the planner would mean
// replaying commit order, and the codebase itself accepts the
// band/blade mismatch as an open problem (#378). So scenes are placed
// in front of retail-led shophouses on commercial streets instead:
// facade families 6/7 (tile / arcade shophouse, shops-table 0.85/0.9
// — the food streets), best frontage rank >= 2 (SHOP_FRONTAGE_MIN_RANK,
// the same gate as the signs and shopfronts), a sidewalk band >= 2.0 m,
// and a strip depth D (lot face -> carriageway edge) of 2.0–5.0 m.
// A modest number of scenes, not one per shop (acceptance 0.35, cap
// 120, scenes >= 12 m apart).
//
// The parked scooters are an explicit user-requested exception to the
// "scooters ignored" rule, which was about MOVING scooter traffic.
//
// Pure functions over the geodata shapes (no three.js), the
// taipei-street-amenities.js pattern; js/taipei-boot.js turns the plan
// into one InstancedMesh per kit class. The menu board's chalk menu
// is painted by drawCafeMenuBoard (canvas 2D, like the sign painters
// in js/taipei-signs.js) — a texture, not a dynamic sign.

import {
  hash01, distToSegment, buildSegmentGrid, buildExclusionIndex, pointInRing, sidewalkBandWidth,
} from './taipei-streetscape.js';
import { facadeMatFor, taipeiFrontageLookup, SHOP_FRONTAGE_MIN_RANK } from './taipei-buildings.js';
import { SIGN_FONT_STACK } from './taipei-signs.js';

// Retail-led shophouse families only (issue #17): the tile shophouse
// and the arcade shophouse are the mixed-use food streets. Families
// 8/9/13 are housing-led (shops-table 0.45/0.35/0.35) and stay out.
const CAFE_MATS = new Set([6, 7]);
export const CAFE_SCENE_CAP = 120;
const CAFE_ACCEPT = 0.35;
const CAFE_MIN_FACE_M = 7.5;
const CAFE_MIN_BAND_M = 2.0;
const CAFE_MIN_DEPTH_M = 2.0;
const CAFE_MAX_DEPTH_M = 5.0;
const CAFE_MIN_SEPARATION_M = 12;

// Scene layout, local frame: U along the front face, V outward from
// the face toward the road, origin at the face midpoint. The scene is
// 7.2 m wide (U -3.6..3.6) and D deep (V 0..D).
export const CAFE_SCENE_LAYOUT = {
  halfWidth: 3.6,
  tableU: 1.8, tableV: 0.9, tableR: 0.6,
  chairR: 0.35, chairGap: 0.75,
  benchU: -3.1, benchV: 0.8, benchR: 0.55,
  treeU: 3.1, treeV: 0.8, treeR: 0.5,
  scooterCount: 4, scooterGap: 0.75, scooterFirstU: -2.2, scooterR: 0.45,
  scooterRowR: 1.7,
  boardU: 1.9, boardR: 0.45,
};
const L = CAFE_SCENE_LAYOUT;

// The chalkboard A-frame (shared constants: the planner places the
// menu faces, the boot builds the frame from the same numbers).
// Board 0.66 m wide, 0.95 m tall, slabs lean 12° from vertical, slab
// centres 0.10 m either side of the board centre at y 0.55; the menu
// faces sit on the slab surfaces, 0.12 m out.
export const MENU_BOARD = {
  w: 0.66, h: 0.95, lean: 0.21, slabOffset: 0.10, faceOffset: 0.12,
  centreY: 0.55, faceW: 0.58, faceH: 0.85,
};

// The chalk menu (Taiwanese café, NT$ prices — the user's photo is
// the FORM reference, not its text or currency). No 檳榔, same as #105.
export const CAFE_MENU_ITEMS = [
  { name: '珍珠奶茶', price: 55 },
  { name: '紅茶', price: 40 },
  { name: '美式咖啡', price: 70 },
  { name: '拿鐵', price: 85 },
  { name: '蛋餅', price: 35 },
  { name: '三明治', price: 50 },
  { name: '雞排', price: 75 },
];
export const CAFE_MENU_TITLE = '菜單';

// Paint the chalk menu into ctx (w × h canvas, top-down). Same idiom
// as the sign painters in js/taipei-signs.js: chalk white on dark
// slate, one line per item (name left, NT$ price right), title on top.
export function drawCafeMenuBoard(ctx, w, h) {
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#2e3238';
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 0.92;
  ctx.strokeStyle = '#f5f2e8';
  ctx.lineWidth = 3;
  ctx.strokeRect(10, 10, w - 20, h - 20);
  ctx.fillStyle = '#f5f2e8';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(h * 0.115)}px ${SIGN_FONT_STACK}`;
  ctx.fillText(CAFE_MENU_TITLE, w / 2, h * 0.10);
  ctx.fillRect(w * 0.2, h * 0.17, w * 0.6, 2);
  const top = h * 0.24, step = (h * 0.68) / CAFE_MENU_ITEMS.length;
  ctx.font = `700 ${Math.round(step * 0.52)}px ${SIGN_FONT_STACK}`;
  CAFE_MENU_ITEMS.forEach((item, i) => {
    const y = top + step * (i + 0.5);
    ctx.textAlign = 'left';
    ctx.fillText(item.name, w * 0.12, y);
    ctx.textAlign = 'right';
    ctx.fillText(`NT$${item.price}`, w * 0.88, y);
  });
  ctx.textAlign = 'center';
  ctx.font = `400 ${Math.round(h * 0.045)}px ${SIGN_FONT_STACK}`;
  ctx.fillText('內用 · 外帶', w / 2, h * 0.95);
  ctx.restore();
}

// Scooter colour variants (the mesh builder makes one InstancedMesh
// per variant, the park-trees pattern — a single shared body colour
// would read flat).
export const SCOOTER_VARIANTS = [0xc04030, 0x2e5fa3, 0xd8d8d0];

// The two menu-face placements for one board item: the front face
// (rot) and the back face (rot + PI), each 0.12 m out from the board
// centre along the board's facing direction.
export function menuFaceItems(board) {
  const fx = Math.sin(board.rot), fz = Math.cos(board.rot);
  return [
    { x: board.x + fx * MENU_BOARD.faceOffset, z: board.z + fz * MENU_BOARD.faceOffset, rot: board.rot },
    { x: board.x - fx * MENU_BOARD.faceOffset, z: board.z - fz * MENU_BOARD.faceOffset, rot: board.rot + Math.PI },
  ];
}

// Faces of a plan lot's rect, in the taipeiFrontageLookup convention
// (face midpoints pushed out, outward normal + tangent per face).
function facesOf(lot) {
  const cx = lot.x, cz = lot.z, w = lot.w, d = lot.d;
  const th = lot.rot || 0, c = Math.cos(th), s = Math.sin(th);
  return [
    { x: cx + (w / 2) * c, z: cz - (w / 2) * s, nx: c, nz: -s, tx: s, tz: c, len: d },
    { x: cx - (w / 2) * c, z: cz + (w / 2) * s, nx: -c, nz: s, tx: -s, tz: -c, len: d },
    { x: cx + (d / 2) * s, z: cz + (d / 2) * c, nx: s, nz: c, tx: -c, tz: s, len: w },
    { x: cx - (d / 2) * s, z: cz - (d / 2) * c, nx: -s, nz: -c, tx: c, tz: -s, len: w },
  ];
}

export function planCafeScenes(geodata, plan, opts = {}) {
  const cap = opts.cap ?? CAFE_SCENE_CAP;
  const accept = opts.accept ?? CAFE_ACCEPT; // override hook for tests
  const beds = (geodata.roadbeds || []).filter((b) => b.pedestrianLayout === 'sidewalk');
  const ways = (geodata.roads || []).filter((r) => !['footway', 'path', 'steps', 'pedestrian', 'cycleway', 'corridor', 'elevator', 'crossing', 'platform', 'traffic_island'].includes(r.highway));

  const maxHalf = (items) => (items.length ? Math.max(...items.map((r) => Math.max((r.width || 3) / 2, 0.75))) : 0);
  const bedGrid = buildSegmentGrid(beds, 25);
  const wayGrid = buildSegmentGrid(ways, maxHalf(ways) + 1.5);

  // Lots / tower site / parks / water — the same shapes the street
  // lamp planner uses. The inLot test here is the CORRECT rotated-rect
  // test: world -> lot-local is x_l = dx*c - dz*sn, z_l = dx*sn +
  // dz*c (the inverse of the adapter's rotY map — a face centre
  // maps back onto its own face). The amenities planner's inLot has
  // the signs transposed (dx*c + dz*sn, -dx*sn + dz*c): it tests a
  // rect rotated by -2*rot, which wrongly rejects points just off
  // the face of a rotated lot (measured 2026-11-16: 56 of 124
  // depth-passing café candidates were rejected that way, tables
  // 0.9 m off their own face). That latent bug stays with #362 —
  // fixing it there would move its pinned census; it is recorded
  // as a follow-up, not fixed here.
  const lots = plan?.lots || [];
  const lotGrid = new Map();
  const lotKey = (cx, cz) => `${cx},${cz}`;
  lots.forEach((lot, i) => {
    const r = (lot.rot ? Math.hypot(lot.w, lot.d) / 2 : Math.max(lot.w, lot.d) / 2) + 1;
    for (let cx = Math.floor((lot.x - r) / 32); cx <= Math.floor((lot.x + r) / 32); cx++) {
      for (let cz = Math.floor((lot.z - r) / 32); cz <= Math.floor((lot.z + r) / 32); cz++) {
        const k = lotKey(cx, cz);
        if (!lotGrid.has(k)) lotGrid.set(k, []);
        lotGrid.get(k).push(i);
      }
    }
  });
  const inLot = (x, z, pad = 0.3) => {
    const cell = lotGrid.get(lotKey(Math.floor(x / 32), Math.floor(z / 32))) || [];
    for (const i of cell) {
      const lot = lots[i];
      const dx = x - lot.x, dz = z - lot.z;
      if (lot.rot) {
        const c = Math.cos(lot.rot), sn = Math.sin(lot.rot);
        if (Math.abs(dx * c - dz * sn) <= lot.w / 2 + pad && Math.abs(dx * sn + dz * c) <= lot.d / 2 + pad) return true;
      } else if (Math.abs(dx) <= lot.w / 2 + pad && Math.abs(dz) <= lot.d / 2 + pad) {
        return true;
      }
    }
    return false;
  };
  const tower = plan?.tower || null;
  const inTowerSite = (x, z) => {
    if (!tower) return false;
    const w = (tower.podium?.w || 76) / 2 + 1, d = (tower.podium?.d || 76) / 2 + 1;
    return Math.abs(x - tower.x) <= w && Math.abs(z - tower.z) <= d;
  };
  const polys = [];
  for (const p of geodata.parks || []) polys.push(p.ring);
  for (const w of geodata.water || []) polys.push(w.ring);
  const polyBBoxes = polys.map((ring) => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < ring.length; i += 2) {
      minX = Math.min(minX, ring[i]); maxX = Math.max(maxX, ring[i]);
      minZ = Math.min(minZ, ring[i + 1]); maxZ = Math.max(maxZ, ring[i + 1]);
    }
    return { minX, maxX, minZ, maxZ };
  });
  const inParkOrWater = (x, z) => {
    for (let i = 0; i < polys.length; i++) {
      const bb = polyBBoxes[i];
      if (x < bb.minX || x > bb.maxX || z < bb.minZ || z > bb.maxZ) continue;
      if (pointInRing(x, z, polys[i])) return true;
    }
    return false;
  };
  const inExclusion = buildExclusionIndex(opts.exclusions);

  // Collision set: caller-supplied avoid points (lamps + street
  // trees + street amenity items) plus every item this planner has
  // already placed, in an 8 m grid like the amenities planner.
  const GRID = 8;
  const gridKey = (cx, cz) => `${cx},${cz}`;
  const grid = new Map();
  const gridAdd = (p) => {
    const k = gridKey(Math.floor(p.x / GRID), Math.floor(p.z / GRID));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
  };
  for (const a of (opts.avoid || [])) gridAdd({ x: a.x, z: a.z, r: a.r ?? 0.6 });
  const hitsPlaced = (x, z, r) => {
    const cx = Math.floor(x / GRID), cz = Math.floor(z / GRID);
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gz = cz - 1; gz <= cz + 1; gz++) {
        for (const p of grid.get(gridKey(gx, gz)) || []) {
          if (Math.hypot(p.x - x, p.z - z) < p.r + r) return true;
        }
      }
    }
    return false;
  };

  const rejected = { junction: 0, carriageway: 0, lot: 0, site: 0, placed: 0, depth: 0, face: 0, accept: 0, separation: 0 };
  // One candidate through every exclusion. `ownBedIdx` skips the
  // candidate's own bed — the scene stands on that bed's band by
  // construction, so the kerb row clears the carriageway edge by
  // design, not by the 0.35 m slack other beds get.
  const checkOK = (x, z, r, ownBedIdx) => {
    if (inExclusion(x, z)) return 'junction';
    for (const s of bedGrid.near(x, z)) {
      if (s.idx === ownBedIdx) continue;
      if (distToSegment(x, z, s.ax, s.az, s.bx, s.bz) < s.half + r + 0.35) return 'carriageway';
    }
    for (const s of wayGrid.near(x, z)) {
      if (distToSegment(x, z, s.ax, s.az, s.bx, s.bz) < s.half + 0.35) return 'carriageway';
    }
    if (inLot(x, z, r)) return 'lot';
    if (inTowerSite(x, z) || inParkOrWater(x, z)) return 'site';
    if (hitsPlaced(x, z, r)) return 'placed';
    return null;
  };

  const frontageFor = taipeiFrontageLookup(geodata);
  // Segments near the face midpoint: the grid files each segment
  // under every 20 m cell its bbox, expanded by the 25 m reach,
  // touches — one near() call already covers every bed within 25 m
  // of the face, far past the 5 m depth window.
  const nearSegments = (x, z) => bedGrid.near(x, z);

  const items = { table: [], chair: [], bench: [], tree: [], scooter: [], menuBoard: [], menuFace: [] };
  const scenes = [];
  const stats = { byHighway: {}, rejected, total: 0 };
  const yawTo = (dx, dz) => Math.atan2(dx, dz);

  for (const lot of lots) {
    if (scenes.length >= cap) break;
    const mat = facadeMatFor(lot);
    if (!CAFE_MATS.has(mat)) continue;
    const rect = {
      x0: lot.x - lot.w / 2, x1: lot.x + lot.w / 2,
      z0: lot.z - lot.d / 2, z1: lot.z + lot.d / 2, rotY: lot.rot || 0,
    };
    const front = frontageFor(rect);
    if (!front || front.rank < SHOP_FRONTAGE_MIN_RANK) continue;
    // The face that fronts the road: its outward normal best matches
    // the frontage direction.
    const faces = facesOf(lot);
    let face = null, bestDot = -2;
    for (const f of faces) {
      const dot = f.nx * front.nx + f.nz * front.nz;
      if (dot > bestDot) { bestDot = dot; face = f; }
    }
    if (!face || face.len < CAFE_MIN_FACE_M) { rejected.face++; continue; }
    if (hash01(`cafe|${lot.x},${lot.z}`) >= accept) { rejected.accept++; continue; }
    if (scenes.some((s) => Math.hypot(s.x - face.x, s.z - face.z) < CAFE_MIN_SEPARATION_M)) { rejected.separation++; continue; }
    // The fronting sidewalk bed: the nearest sidewalk-bed segment
    // that runs parallel to the face and lies outward from it (toward
    // the road) — a bed on a cross street or a parallel street behind
    // the lot fails one of the two tests. D is the strip depth from
    // the lot face to the carriageway edge.
    let ownBedIdx = -1, D = Infinity, bedHighway = '';
    for (const s of nearSegments(face.x, face.z)) {
      const bed = beds[s.idx];
      const bandW = sidewalkBandWidth(bed);
      if (bandW < CAFE_MIN_BAND_M) continue;
      const dx = s.bx - s.ax, dz = s.bz - s.az;
      const len = Math.hypot(dx, dz);
      if (len < 0.01) continue;
      // Closest point on the segment to the face midpoint.
      let t = ((face.x - s.ax) * dx + (face.z - s.az) * dz) / (len * len);
      t = Math.max(0, Math.min(1, t));
      const qx = s.ax + t * dx, qz = s.az + t * dz;
      const ox = qx - face.x, oz = qz - face.z;
      if (ox * face.nx + oz * face.nz <= 0) continue; // bed is behind the face, not toward the road
      if (Math.abs((dx / len) * face.tx + (dz / len) * face.tz) < 0.8) continue; // bed must run along the face
      const dd = Math.hypot(ox, oz) - s.half;
      if (dd < D) { D = dd; ownBedIdx = s.idx; bedHighway = bed.highway; }
    }
    if (ownBedIdx < 0 || D < CAFE_MIN_DEPTH_M || D > CAFE_MAX_DEPTH_M) { rejected.depth++; continue; }

    // Lay the scene out in the face frame, then check every item
    // against the grid BEFORE placing any of it — a scene is
    // all-or-nothing (a café terrace missing its tables reads as a
    // bug; a single colliding chair is not worth a partial scene).
    // Intra-scene spacings are fixed by construction, so items are
    // never checked against each other, only against the grid.
    const toWorld = (u, v) => ({ x: face.x + face.tx * u + face.nx * v, z: face.z + face.tz * u + face.nz * v });
    const kerbV = D - 0.45;
    const boardRot = yawTo(face.tx, face.tz); // faces along the sidewalk, so passers-by read it
    const faceRot = yawTo(face.nx, face.nz); // faces the road
    const candidates = [];
    const cand = (kind, u, v, rot, r) => {
      const p = toWorld(u, v);
      candidates.push({ kind, x: p.x, z: p.z, rot, r });
    };
    for (const su of [-L.tableU, L.tableU]) {
      cand('table', su, L.tableV, faceRot, L.tableR);
      for (const cu of [su - L.chairGap, su + L.chairGap]) {
        cand('chair', cu, L.tableV, yawTo(Math.sign(su - cu) * face.tx, Math.sign(su - cu) * face.tz), L.chairR);
      }
    }
    cand('bench', L.benchU, L.benchV, faceRot, L.benchR);
    cand('tree', L.treeU, L.treeV, 0, L.treeR);
    for (let i = 0; i < L.scooterCount; i++) {
      cand('scooter', L.scooterFirstU + i * L.scooterGap, kerbV, boardRot, L.scooterR);
    }
    cand('menuBoard', L.boardU, kerbV, boardRot, L.boardR);
    let why = null;
    for (const c of candidates) {
      why = checkOK(c.x, c.z, c.r, ownBedIdx);
      if (why) break;
    }
    if (why) { rejected[why]++; continue; }

    // Place it.
    const scene = { x: face.x, z: face.z, rot: faceRot, D: Math.round(D * 100) / 100, highway: bedHighway, mat };
    scenes.push(scene);
    stats.byHighway[bedHighway] = (stats.byHighway[bedHighway] || 0) + 1;
    for (const c of candidates) {
      if (c.kind === 'scooter') {
        items.scooter.push({
          x: c.x, z: c.z, rot: c.rot,
          variant: Math.floor(hash01(`cafe|scooter|${c.x.toFixed(1)},${c.z.toFixed(1)}`) * SCOOTER_VARIANTS.length) % SCOOTER_VARIANTS.length,
        });
      } else {
        items[c.kind].push({ x: c.x, z: c.z, rot: c.rot });
      }
    }
    // Menu faces (front + back) for this board.
    const board = items.menuBoard[items.menuBoard.length - 1];
    for (const f of menuFaceItems(board)) items.menuFace.push(f);
    // Reserve the scene's footprint: one row entry for the scooter
    // row (the four scooters are at fixed spacing, so they are never
    // checked against each other), plus each other item.
    const rowCentre = toWorld(L.scooterFirstU + ((L.scooterCount - 1) * L.scooterGap) / 2, kerbV);
    gridAdd({ x: rowCentre.x, z: rowCentre.z, r: L.scooterRowR });
    for (const c of candidates) {
      if (c.kind !== 'scooter') gridAdd({ x: c.x, z: c.z, r: c.r });
    }
  }

  stats.total = scenes.length;
  return { scenes, items, stats };
}
