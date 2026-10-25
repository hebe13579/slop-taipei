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
  BAND_ATLAS,
  BLADE_ATLAS,
  BAND_MAX_UNITS,
  BLADE_MAX_CHARS,
  SIGN_FONT_STACK,
  nameWidthUnits,
  bandSignFits,
  bladeSignFits,
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
for (const [atlas, count] of [[BAND_ATLAS, TAIPEI_BAND_SIGNS.length], [BLADE_ATLAS, TAIPEI_BLADE_SIGNS.length]]) {
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

const boot = read('../js/taipei-boot.js');
assert.ok(boot.includes('setTaipeiSignAtlases('), 'taipei-boot injects the atlases');
assert.ok(boot.includes("from './taipei-signs.js'"), 'taipei-boot imports the signs module');

console.log('taipei-signs.test.mjs: all assertions passed');
