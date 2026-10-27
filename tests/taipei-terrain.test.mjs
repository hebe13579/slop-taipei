// Issue #129: visual-only DEM terrain skin (Beitou box + corridor
// north). Pins the baked grids in geodata.terrain (SRTM GL1 via
// tools/taipei/build-terrain.mjs) and the pure geometry builder
// (js/taipei-terrain.js): the two grids share their seam postings,
// the Guandu plain stays flat, roads keep their benches (mask 0),
// the height rule and edge fades behave, the palette carries the
// issue's dark-forest-green correction, and the planner's output
// is identical with and without the skin (visual only, by data).
// Issue #187 (round 2): the same system extended to the tile's
// other two rims — a north-rim grid behind the #186 airport-north
// strip (box 6-airport) sharing the corridor grid's east edge, and
// an east-rim grid on box A (Sishou/Nangang slopes + the scenery
// band past the 121.580 tile edge). Round 2's pins: the new seam,
// the museum grounds staying uncovered, the east grid never
// reaching the airport box.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { planTaipeiBuildings } from '../js/taipei-buildings.js';
import { buildTerrainSkinGeometry, terrainSkinHeight, terrainEdgeFade, TERRAIN_SINK } from '../js/taipei-terrain.js';

const T = TAIPEI_GEO.terrain;
const bei = T?.grids.find((g) => g.box === '4-beitou');
const cor = T?.grids.find((g) => g.box === '3-corridor');
// Frame constants (build-taipei-geodata.mjs): metres per degree.
const KX = 101_290, KY = 110_936; // approx — used only for window tests
const toXZ = (lon, lat) => [(lon - 121.5650) * KX, -(lat - 25.0330) * KY];
const posting = (g, lon, lat) => {
  const c = Math.round((lon - g.w) / T.stepDeg), r = Math.round((g.n - lat) / T.stepDeg);
  return { c, r, i: r * g.cols + c };
};

test('terrain grids exist for exactly the terrain-enabled boxes', () => {
  assert.ok(T, 'geodata carries terrain');
  const cfg = JSON.parse(fs.readFileSync(new URL('../tools/taipei/tile-boxes.json', import.meta.url), 'utf8'));
  const enabled = cfg.boxes.filter((b) => b.terrain?.grid).map((b) => b.name).sort();
  assert.deepEqual(T.grids.map((g) => g.box).sort(), enabled);
  assert.match(T.source, /SRTM GL1/);
  for (const g of T.grids) {
    assert.equal(g.h.length, g.cols * g.rows, `${g.box} h postings`);
    assert.equal(g.mask.length, g.cols * g.rows, `${g.box} mask postings`);
    assert.equal(Math.round((g.e - g.w) / T.stepDeg) + 1, g.cols, `${g.box} cols on the lattice`);
    assert.equal(Math.round((g.n - g.s) / T.stepDeg) + 1, g.rows, `${g.box} rows on the lattice`);
    // Posting pitch matches the study's ~56 m lattice in world units.
    const pitch = (g.x1 - g.x0) / (g.cols - 1);
    assert.ok(pitch > 50 && pitch < 62, `${g.box} pitch ${pitch.toFixed(1)} m`);
  }
});

test('the two grids share the seam postings (no gap, no overlap)', () => {
  assert.ok(Math.abs(bei.x1 - cor.x0) < 0.01 && Math.abs(bei.z0 - cor.z0) < 0.01 && Math.abs(bei.z1 - cor.z1) < 0.01);
  assert.equal(bei.rows, cor.rows);
  for (let r = 0; r < bei.rows; r++) {
    const a = r * bei.cols + (bei.cols - 1), b = r * cor.cols;
    assert.equal(bei.h[a], cor.h[b], `seam h row ${r}`);
    assert.equal(bei.mask[a], cor.mask[b], `seam mask row ${r}`);
  }
  // Shared edge never fades on either side; north never fades.
  assert.equal(bei.fade.e, false); assert.equal(cor.fade.w, false);
  assert.equal(bei.fade.n, false); assert.equal(cor.fade.n, false);
  assert.equal(bei.fade.w, true);
  // #187 re-pin: corridor's east edge faded in round 1 (cor.fade.e
  // was true) because nothing stood east of it; round 2's north-rim
  // grid (6-airport) shares that edge, so by the system's own rule
  // (shared edges never fade) it is false now. The postings along
  // the edge are unchanged (h/mask diff vs the round-1 bake is 0).
  assert.equal(cor.fade.e, false);
  assert.equal(bei.fade.s, true); assert.equal(cor.fade.s, true);
});

test('round 2 north rim: the airport grid shares the corridor east-edge seam (#187)', () => {
  const ap = T?.grids.find((g) => g.box === '6-airport');
  assert.ok(ap, 'north-rim grid present');
  // Same north edge and lattice: the airport grid's rows are the
  // corridor grid's first rows, so the shared column at lon 121.540
  // must carry identical postings on both sides.
  assert.ok(Math.abs(ap.x0 - cor.x1) < 0.01 && Math.abs(ap.z0 - cor.z0) < 0.01);
  assert.equal(ap.fade.w, false); assert.equal(cor.fade.n, false);
  assert.equal(ap.fade.s, true); assert.equal(ap.fade.e, true);
  for (let r = 0; r < ap.rows; r++) {
    const a = r * cor.cols + (cor.cols - 1), b = r * ap.cols;
    assert.equal(cor.h[a], ap.h[b], `rim seam h row ${r}`);
    assert.equal(cor.mask[a], ap.mask[b], `rim seam mask row ${r}`);
  }
  // The rim is real mountain: Qixing's south slope inside the grid.
  const qx = posting(ap, 121.5570, 25.1600);
  assert.ok(ap.h[qx.i] > 600, `Qixing slope posting h=${ap.h[qx.i]}`);
});

test('round 2 discipline: museum grounds uncovered, east grid clear of the airport (#187)', () => {
  // The #186 strip's museum grounds stay on the flat convention:
  // no skin grid may cover the National Palace Museum point.
  for (const g of T.grids) {
    assert.ok(!(121.5483 >= g.w && 121.5483 <= g.e && 25.1023 >= g.s && 25.1023 <= g.n),
      `grid ${g.box} must not cover the NPM point`);
  }
  const east = T?.grids.find((g) => g.box === 'A');
  assert.ok(east, 'east-rim grid present');
  assert.deepEqual(east.fade, { w: true, e: true, s: true, n: false });
  // The east grid's north edge is box A's own top edge (25.055):
  // zero overlap with the airport box, so the skin can never
  // reach the airfield.
  const cfg = JSON.parse(fs.readFileSync(new URL('../tools/taipei/tile-boxes.json', import.meta.url), 'utf8'));
  const airport = cfg.boxes.find((b) => b.name === '6-airport');
  assert.ok(east.n <= airport.s, `east grid n ${east.n} <= airport box s ${airport.s}`);
  // Xiangshan stands inside the east grid.
  const xs = posting(east, 121.5764, 25.0267);
  assert.ok(east.h[xs.i] > 150, `Xiangshan posting h=${east.h[xs.i]}`);
});

test('height rule: floor stays down, full DEM at 45 m, mask gates', () => {
  assert.equal(terrainSkinHeight(10, 1), -TERRAIN_SINK);
  assert.equal(terrainSkinHeight(15, 1), -TERRAIN_SINK);
  assert.equal(terrainSkinHeight(45, 1), 45 - TERRAIN_SINK);
  assert.equal(terrainSkinHeight(120, 1), 120 - TERRAIN_SINK);
  assert.equal(terrainSkinHeight(30, 0.5), 30 * 0.5 * 0.5 - TERRAIN_SINK); // gain sstep(15,45,30)=0.5
  assert.equal(terrainSkinHeight(300, 0), -TERRAIN_SINK); // on a road bench even a peak stays down
});

test('Guandu plain stays flat; Beitou roads keep their benches', () => {
  // The plain's farmland interior (the study's box inset from the
  // confluence bluff at its NW rim, where the study itself measured
  // the box max of 61 m): every posting is lowland.
  let n = 0;
  for (let r = 0; r < bei.rows; r++) for (let c = 0; c < bei.cols; c++) {
    const lon = bei.w + c * T.stepDeg, lat = bei.n - r * T.stepDeg;
    if (lon >= 121.470 && lon <= 121.490 && lat >= 25.114 && lat <= 25.126) { n++; assert.ok(bei.h[r * bei.cols + c] <= 20, 'plain DEM'); }
  }
  assert.ok(n > 500);
  // Beitou station sits on a road bench: mask 0 there.
  const st = posting(bei, 121.4986, 25.1321);
  assert.equal(bei.mask[st.i], 0);
  // A Datun slope posting away from switchbacks is unmasked.
  const slope = posting(bei, 121.5020, 25.1480);
  assert.ok(bei.h[slope.i] > 60 && bei.mask[slope.i] > 0.5, `slope posting h=${bei.h[slope.i]} mask=${bei.mask[slope.i]}`);
});

test('geometry: counts, upward faces, fades, Guandu flat in the mesh', () => {
  const g = buildTerrainSkinGeometry(T);
  const expectTris = T.grids.reduce((s, gr) => s + 2 * (gr.cols - 1) * (gr.rows - 1), 0);
  assert.equal(g.triCount, expectTris);
  assert.equal(g.positions.length, expectTris * 9);
  for (let i = 0; i < g.positions.length; i++) assert.ok(Number.isFinite(g.positions[i]), 'finite positions');
  for (let i = 1; i < g.normals.length; i += 3) assert.ok(g.normals[i] > 0, 'every face normal points up');
  for (let i = 0; i < g.colors.length; i++) assert.ok(g.colors[i] >= 0 && g.colors[i] <= 1, 'colours in range');
  // South edges fade to the sink level; the north massif does not fade.
  const southY = [], northY = [];
  for (let i = 0; i < g.positions.length; i += 3) {
    const z = g.positions[i + 2];
    if (Math.abs(z - bei.z1) < 1) southY.push(g.positions[i + 1]);
    if (Math.abs(z - bei.z0) < 1) northY.push(g.positions[i + 1]);
  }
  assert.ok(southY.length > 0 && southY.every((y) => Math.abs(y + TERRAIN_SINK) < 0.01), 'south edge tucked under');
  assert.ok(Math.max(...northY) > 200, `north massif stands (max ${Math.max(...northY).toFixed(0)} m)`);
  // Guandu interior window in the mesh: everything at the sink
  // level (DEM <= 13 m there -> the gain never engages).
  const [gx0, gz1] = toXZ(121.470, 25.114), [gx1, gz0] = toXZ(121.490, 25.126);
  let cnt = 0, max = -Infinity;
  for (let i = 0; i < g.positions.length; i += 3) {
    const x = g.positions[i], y = g.positions[i + 1], z = g.positions[i + 2];
    if (x >= gx0 && x <= gx1 && z >= gz0 && z <= gz1) { cnt++; if (y > max) max = y; }
  }
  assert.ok(cnt > 1000 && max <= 0.2, `Guandu mesh max ${max.toFixed(2)} m over ${cnt} verts`);
});

test('palette: hill colours are deep forest green, not the prototype mint', () => {
  const g = buildTerrainSkinGeometry(T);
  // A mid-slope posting on the Datun face: find its soup vertex.
  const p = posting(bei, 121.5020, 25.1480);
  const dx = (bei.x1 - bei.x0) / (bei.cols - 1), dz = (bei.z1 - bei.z0) / (bei.rows - 1);
  const tx = bei.x0 + p.c * dx, tz = bei.z0 + p.r * dz;
  let found = null;
  for (let i = 0; i < g.positions.length; i += 3) {
    if (Math.abs(g.positions[i] - tx) < 0.6 && Math.abs(g.positions[i + 2] - tz) < 0.6) { found = [g.colors[i], g.colors[i + 1], g.colors[i + 2]]; break; }
  }
  assert.ok(found, 'slope vertex found');
  const [r, gg, b] = found;
  assert.ok(gg > r && gg > b, `green-dominant (${found.map((v) => v.toFixed(2))})`);
  assert.ok(gg < 0.35, `deeper than the prototype's 0.39 mint mid-band (g=${gg.toFixed(2)})`);
});

test('edge fade helper ramps over 4 postings and leaves the north edge alone', () => {
  assert.equal(terrainEdgeFade(bei, 0, 0), 0); // NW corner: west fade bites
  assert.equal(terrainEdgeFade(bei, 60, 60), 1); // interior
  assert.equal(terrainEdgeFade(bei, 0, 60), 1); // north edge: no fade even at the top row
  assert.equal(terrainEdgeFade(cor, 60, 0), 1); // corridor west = shared seam: no fade
});

test('visual only: the building plan is identical without the terrain field', () => {
  const withT = planTaipeiBuildings(TAIPEI_GEO).lots.length;
  const bare = { ...TAIPEI_GEO }; delete bare.terrain;
  const withoutT = planTaipeiBuildings(bare).lots.length;
  assert.equal(withT, withoutT);
  assert.equal(buildTerrainSkinGeometry(null).triCount, 0);
  assert.equal(buildTerrainSkinGeometry({}).triCount, 0);
});
