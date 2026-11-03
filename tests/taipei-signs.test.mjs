// tests/taipei-signs.test.mjs
// Issue #105: real-text 招牌. Pins the shop-name pool (hygiene, fit,
// no 檳榔 anywhere — the user's hard exclusion), the atlas layout
// math, and the grid literals mirrored into the two preloaded sign
// shaders (tsl-materials bands / buildings blades), which cannot
// import the signs module (Pages preload list is pinned at 29).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TAIPEI_BAND_SIGNS,
  TAIPEI_BLADE_SIGNS,
  TAIPEI_BLADE_EXTRA,
  TAIPEI_ROOF_SIGNS,
  BAND_ATLAS,
  BLADE_ATLAS,
  ROOF_ATLAS,
  TOWER_ATLAS,
  BAND_MAX_UNITS,
  BLADE_MAX_CHARS,
  ROOF_MAX_UNITS,
  TOWER_MAX_CHARS,
  SIGN_FONT_STACK,
  nameWidthUnits,
  bandSignFits,
  bladeSignFits,
  roofSignFits,
  towerSignFits,
  plateCellUV,
} from '../js/taipei-signs.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

// --- Pool hygiene ---------------------------------------------------
assert.ok(TAIPEI_BAND_SIGNS.length >= 30, 'band pool carries a real street of shops');
assert.equal(
  TAIPEI_BAND_SIGNS.length,
  BAND_ATLAS.cols * BAND_ATLAS.rows,
  'band pool exactly fills the band atlas grid'
);
assert.ok(
  TAIPEI_BLADE_SIGNS.length <= BLADE_ATLAS.cols * BLADE_ATLAS.rows,
  'blade pool fits the blade atlas grid'
);
assert.equal(
  TAIPEI_BLADE_SIGNS.length,
  TAIPEI_BAND_SIGNS.length + TAIPEI_BLADE_EXTRA.length,
  'blade pool is the band pool plus the vertical extras'
);
const names = new Set();
for (const sign of [...TAIPEI_BAND_SIGNS, ...TAIPEI_BLADE_EXTRA]) {
  assert.ok(sign.name && sign.name.length > 0, 'every sign has a name');
  assert.ok(!names.has(sign.name), `duplicate shop name: ${sign.name}`);
  names.add(sign.name);
  assert.match(sign.bg, /^#[0-9a-f]{6}$/i, `${sign.name} bg is a hex colour`);
  assert.match(sign.fg, /^#[0-9a-f]{6}$/i, `${sign.name} fg is a hex colour`);
  assert.notEqual(sign.bg.toLowerCase(), sign.fg.toLowerCase(), `${sign.name} bg/fg contrast`);
}
// The user's hard exclusion: no betel-nut signage anywhere in the
// module (names or comments).
const signsSource = read('../js/taipei-signs.js');
assert.ok(!signsSource.includes('檳榔') || signsSource.includes('NO 檳榔'),
  'betel-nut appears only in the exclusion note, never as a shop');
assert.ok(!TAIPEI_BAND_SIGNS.some((s) => s.name.includes('檳')), 'no band plate is a betel-nut shop');
assert.ok(!TAIPEI_BLADE_SIGNS.some((s) => s.name.includes('檳')), 'no blade plate is a betel-nut shop');
// The user-named shops are all present.
for (const named of ['牛肉麵', '7-ELEVEN', '魯肉飯', '藥局']) {
  assert.ok(names.has(named), `user-named shop present: ${named}`);
}
assert.ok([...names].some((n) => n.includes('小吃')), 'user-named 小吃 present');

// --- Fit: a name never overflows its sign ---------------------------
assert.equal(BAND_MAX_UNITS, 5.0);
for (const sign of TAIPEI_BAND_SIGNS) {
  assert.ok(bandSignFits(sign), `band name fits: ${sign.name} (${nameWidthUnits(sign.name)} units)`);
}
assert.equal(BLADE_MAX_CHARS, 8);
for (const sign of TAIPEI_BLADE_SIGNS) {
  assert.ok(bladeSignFits(sign), `blade name fits: ${sign.name}`);
}
assert.equal(nameWidthUnits('牛肉麵'), 3);
assert.ok(nameWidthUnits('7-ELEVEN') > 4 && nameWidthUnits('7-ELEVEN') <= 5);

// --- Atlas layout math ----------------------------------------------
for (const [atlas, count] of [[BAND_ATLAS, TAIPEI_BAND_SIGNS.length], [BLADE_ATLAS, TAIPEI_BLADE_SIGNS.length], [ROOF_ATLAS, TAIPEI_ROOF_SIGNS.length], [TOWER_ATLAS, TAIPEI_ROOF_SIGNS.length]]) {
  assert.equal(atlas.w, atlas.cols * atlas.cellW);
  assert.equal(atlas.h, atlas.rows * atlas.cellH);
  for (let i = 0; i < count; i++) {
    const { u0, v0, u1, v1 } = plateCellUV(i, atlas, 0.03);
    assert.ok(u0 >= 0 && u1 <= 1 && v0 >= 0 && v1 <= 1, `plate ${i} UV inside the atlas`);
    assert.ok(u1 > u0 && v1 > v0, `plate ${i} UV is a real rect`);
  }
  // Adjacent plates never share a cell.
  const cells = new Set();
  for (let i = 0; i < count; i++) {
    const key = `${i % atlas.cols}:${Math.floor(i / atlas.cols)}`;
    assert.ok(!cells.has(key), `plate ${i} has its own cell`);
    cells.add(key);
  }
}

// --- Issue #153: rooftop billboard pool ------------------------------
// The roof brands (the photo's Hitachi board, the SANLUX tower sign,
// plus the appliance/telecom/bank names that actually own Taipei's
// roofs) — one pool, two atlases (landscape roof boards, portrait
// tower signs, same plate index = same brand in both).
assert.ok(TAIPEI_ROOF_SIGNS.length >= 10, 'roof pool carries the avenue brands');
assert.ok(TAIPEI_ROOF_SIGNS.length <= ROOF_ATLAS.cols * ROOF_ATLAS.rows, 'roof pool fits the roof atlas grid');
assert.ok(TAIPEI_ROOF_SIGNS.length <= TOWER_ATLAS.cols * TOWER_ATLAS.rows, 'roof pool fits the tower atlas grid');
const roofNames = new Set();
for (const sign of TAIPEI_ROOF_SIGNS) {
  assert.ok(sign.name && sign.name.length > 0, 'every roof sign has a name');
  assert.ok(!roofNames.has(sign.name), `duplicate roof brand: ${sign.name}`);
  roofNames.add(sign.name);
  assert.match(sign.bg, /^#[0-9a-f]{6}$/i, `${sign.name} bg is a hex colour`);
  assert.match(sign.fg, /^#[0-9a-f]{6}$/i, `${sign.name} fg is a hex colour`);
  assert.notEqual(sign.bg.toLowerCase(), sign.fg.toLowerCase(), `${sign.name} bg/fg contrast`);
  assert.ok(!sign.name.includes('檳'), `no roof plate is a betel-nut brand: ${sign.name}`);
  assert.ok(roofSignFits(sign), `roof name fits: ${sign.name}`);
  assert.ok(towerSignFits(sign), `tower name fits: ${sign.name}`);
}
for (const named of ['日立', '三洋', '大同', '國際牌']) {
  assert.ok(roofNames.has(named), `user/photo-named roof brand present: ${named}`);
}
assert.equal(ROOF_MAX_UNITS, 5.0);
assert.equal(TOWER_MAX_CHARS, 8);

// --- Font stack: every Taiwan device resolves a real CJK face -------
for (const face of ['Noto Sans TC', 'PingFang TC', 'JhengHei']) {
  assert.ok(SIGN_FONT_STACK.includes(face), `font stack covers ${face}`);
}

// --- Source contracts: the preloaded shaders mirror the grid --------
const tsl = read('../js/tsl-materials.js');
assert.ok(tsl.includes('setTaipeiSignAtlases'), 'tsl-materials exports the atlas setter');
assert.ok(tsl.includes(`const SIGN_BAND_COLS = ${BAND_ATLAS.cols}.0;`), 'band cols literal matches taipei-signs');
assert.ok(tsl.includes(`const SIGN_BAND_ROWS = ${BAND_ATLAS.rows}.0;`), 'band rows literal matches taipei-signs');
assert.ok(tsl.includes(`const SIGN_BAND_PLATES = ${TAIPEI_BAND_SIGNS.length}.0;`), 'band plate count matches the pool');

const buildings = read('../js/buildings.js');
assert.ok(buildings.includes('getTaipeiSignAtlases'), 'buildings reads the injected atlases');
assert.ok(buildings.includes(`const SIGN_BLADE_COLS = ${BLADE_ATLAS.cols}.0;`), 'blade cols literal matches taipei-signs');
assert.ok(buildings.includes(`const SIGN_BLADE_ROWS = ${BLADE_ATLAS.rows}.0;`), 'blade rows literal matches taipei-signs');
assert.ok(buildings.includes(`const SIGN_BLADE_PLATES = ${TAIPEI_BLADE_SIGNS.length}.0;`), 'blade plate count matches the pool');
// Issue #153 mirrors: the roof/tower atlas grids and the brand bg
// colours (the no-atlas fallback plate) in the preloaded renderer,
// which cannot import the signs module.
assert.ok(buildings.includes(`const SIGN_ROOF_COLS = ${ROOF_ATLAS.cols}.0;`), 'roof cols literal matches taipei-signs');
assert.ok(buildings.includes(`const SIGN_ROOF_ROWS = ${ROOF_ATLAS.rows}.0;`), 'roof rows literal matches taipei-signs');
assert.ok(buildings.includes(`const SIGN_ROOF_PLATES = ${TAIPEI_ROOF_SIGNS.length}.0;`), 'roof plate count matches the pool');
assert.ok(buildings.includes(`const SIGN_TOWER_COLS = ${TOWER_ATLAS.cols}.0;`), 'tower cols literal matches taipei-signs');
assert.ok(buildings.includes(`const SIGN_TOWER_ROWS = ${TOWER_ATLAS.rows}.0;`), 'tower rows literal matches taipei-signs');
const roofBgLiteral = `const ROOF_PLATE_BG = [${TAIPEI_ROOF_SIGNS.map((s) => s.bg.replace('#', '0x')).join(', ')}];`;
assert.ok(buildings.includes(roofBgLiteral), 'roof plate bg colours match the pool in order');

const planner = read('../js/taipei-buildings.js');
assert.ok(planner.includes(`export const ROOF_BOARD_PLATES = ${TAIPEI_ROOF_SIGNS.length};`), 'planner plate count matches the pool');

const boot = read('../js/taipei-boot.js');
assert.ok(boot.includes('setTaipeiSignAtlases('), 'taipei-boot injects the atlases');
assert.ok(boot.includes("from './taipei-signs.js'"), 'taipei-boot imports the signs module');
assert.ok(boot.includes('drawRoofAtlas'), 'taipei-boot paints the roof atlas');
assert.ok(boot.includes('drawTowerAtlas'), 'taipei-boot paints the tower atlas');

console.log('taipei-signs.test.mjs: all assertions passed');
