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
  SIGN_FONT_VARIANTS,
  SIGN_GENRE_STYLE,
  SIGN_GENRES,
  SIGN_LOGO_FILES,
  SIGN_LOGO_ROTATE_PORTRAIT,
  SIGN_LOGO_DARK_PLATE,
  logoPlateBg,
  nameWidthUnits,
  signFontVariant,
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
// Issue #354: the expanded pool — the user's named shops and the
// names legible in the reference photos (Beimen street photo, Bafang
// storefront, Ah-Chung's Ximending sign, the Ningxia night market
// signs) are all present.
for (const named of ['志明滷肉飯', '好吃便當', '健康蔬食', '東一排骨', '八方雲集', '鍋貼', '阿宗麵線', '拉亞漢堡', '永和豆漿', '蚵仔煎大王', '寧夏排骨麵', '新東陽', '迷你火鍋城', '湯姆熊', '加力敦']) {
  assert.ok(names.has(named), `issue #354 shop present: ${named}`);
}
// Issue #354 (genre broadening): every shop belongs to a daily-life
// genre, and each genre has its own colour + border pattern — the
// genre is what makes a street read as food vs clothes vs 3C vs
// market. Every plate (band pool and blade extras) carries a genre
// from the allowed set, and each of the user's named genres has at
// least one shop; the genre style table covers every genre with a
// hex stripe colour.
const genreCounts = {};
for (const sign of [...TAIPEI_BAND_SIGNS, ...TAIPEI_BLADE_EXTRA]) {
  assert.ok(SIGN_GENRES.includes(sign.genre), `${sign.name} genre is in the allowed set: ${sign.genre}`);
  genreCounts[sign.genre] = (genreCounts[sign.genre] || 0) + 1;
}
for (const genre of ['eat', 'clothes', 'drink', '3c', 'market']) {
  assert.ok(genreCounts[genre] >= 1, `genre present in the pool: ${genre}`);
}
for (const genre of SIGN_GENRES) {
  assert.match(SIGN_GENRE_STYLE[genre].stripe, /^#[0-9a-f]{6}$/i, `${genre} stripe is a hex colour`);
  assert.equal(typeof SIGN_GENRE_STYLE[genre].doubleBorder, 'boolean', `${genre} doubleBorder is a boolean`);
}
assert.equal(SIGN_GENRE_STYLE.clothes.doubleBorder, true, 'clothes is the double-border genre');
for (const genre of SIGN_GENRES) {
  if (genre !== 'clothes') assert.equal(SIGN_GENRE_STYLE[genre].doubleBorder, false, `only clothes is double-border: ${genre}`);
}
// The genre-broadening shops are all present: the clothes shops,
// the 3C brands (Tsannkuen, E-Life, the phone shop) and PX Mart,
// plus its full blade name.
for (const named of ['NET', '服飾店', '流行女裝', '童裝', '燦坤', '全國電子', '手機行', '全聯']) {
  assert.ok(names.has(named), `issue #354 genre shop present: ${named}`);
}
assert.ok(names.has('全聯福利中心'), 'issue #354 blade extra present: 全聯福利中心');

// Issue #372 (expansion): every real-brand logo plate is the pool
// entry itself — 42 brands carry a `logo` marker so the painters
// draw the real image instead of plain text. The band and blade
// plate indices match (the blade pool is the band pool in the same
// order). The two full-name blade extras carry their brand's logo
// too. Every logo file is used by a plate, and every plate marker
// resolves to a file — no orphans either way. 東一排骨 is the one
// real brand with no clean logo anywhere, so it keeps its text plate
// (pinned as text-only, so a future logo addition is a deliberate
// change, not silent drift).
const LOGO_PLATES = [
  ['7-ELEVEN', 'seven-eleven'],
  ['全家', 'familymart'],
  ['五十嵐', 'fifty-lan'],
  ['萊爾富', 'hi-life'],
  ['屈臣氏', 'watsons'],
  ['清心福全', 'ching-shin'],
  ['大苑子', 'dayuanzi'],
  ['OK超商', 'ok-mart'],
  ['八方雲集', 'bafang'],
  ['阿宗麵線', 'achung'],
  ['拉亞漢堡', 'laya'],
  ['永和豆漿', 'yonghe'],
  ['新東陽', 'shinyang'],
  ['湯姆熊', 'toms-world'],
  ['NET', 'net'],
  ['燦坤', 'tsannkuen'],
  ['全國電子', 'elife'],
  ['全聯', 'pxmart'],
  ['寶雅', 'poya'],
  ['大潤發', 'rtmart'],
  ['家樂福', 'carrefour'],
  ['麥當勞', 'mcdonalds'],
  ['肯德基', 'kfc'],
  ['摩斯漢堡', 'mos'],
  ['星巴克', 'starbucks'],
  ['路易莎', 'louisa'],
  ['85°C', 'eight-five'],
  ['可不可', 'kebuke'],
  ['迷客夏', 'milksha'],
  ['麻古茶坊', 'macu'],
  ['鬍鬚張', 'huxuzhang'],
  ['三商巧福', 'sanshang'],
  ['吉野家', 'yoshinoya'],
  ['爭鮮', 'zhengxian'],
  ['藏壽司', 'kura'],
  ['壽司郎', 'sushiro'],
  ['康是美', 'cosmed'],
  ['鼎泰豐', 'dingtaifung'],
  ['春水堂', 'chunsuitang'],
  ['CoCo都可', 'coco'],
  ['茶湯會', 'chatime'],
  ['吳寶春', 'wupaochun'],
];
assert.equal(LOGO_PLATES.length, 42, '42 real-brand logo plates in the band pool');
for (const [name, logo] of LOGO_PLATES) {
  const sign = TAIPEI_BAND_SIGNS.find((s) => s.name === name);
  assert.equal(sign && sign.logo, logo, `${name} plate carries its logo lockup`);
  assert.equal(
    TAIPEI_BLADE_SIGNS.findIndex((s) => s.name === name),
    TAIPEI_BAND_SIGNS.findIndex((s) => s.name === name),
    `${name} plate index matches across the band/blade pools`
  );
}
for (const [name, logo] of [['全家便利商店', 'familymart'], ['全聯福利中心', 'pxmart']]) {
  const sign = TAIPEI_BLADE_SIGNS.find((s) => s.name === name);
  assert.equal(sign && sign.logo, logo, `${name} blade extra carries its logo lockup`);
  assert.ok(!TAIPEI_BAND_SIGNS.some((s) => s.name === name), `${name} is blade-only`);
}
const usedLogos = new Set([...LOGO_PLATES, ['全家便利商店', 'familymart'], ['全聯福利中心', 'pxmart']].map(([, logo]) => logo));
assert.deepEqual([...Object.keys(SIGN_LOGO_FILES)].sort(), [...usedLogos].sort(), 'every logo file is used by a plate (no orphan files)');
for (const sign of [...TAIPEI_BAND_SIGNS, ...TAIPEI_BLADE_EXTRA]) {
  if (sign.logo) assert.ok(SIGN_LOGO_FILES[sign.logo], `${sign.name} logo marker resolves to a file: ${sign.logo}`);
}
assert.equal(
  TAIPEI_BAND_SIGNS.find((s) => s.name === '東一排骨').logo,
  undefined,
  '東一排骨 is text-only (no clean logo graphic found anywhere)'
);
// The rotate set is exactly the wide wordmarks (> 2:1 at source):
// a wide lockup reads top-to-bottom on a blade, a compact mark does
// not rotate. The dark-plate set is exactly the two light-on-
// transparency logos (kebuke's beige K, wupaochun's white mark).
assert.deepEqual(
  Object.keys(SIGN_LOGO_ROTATE_PORTRAIT).sort(),
  ['achung', 'chunsuitang', 'coco', 'dayuanzi', 'dingtaifung', 'elife', 'familymart', 'huxuzhang', 'kfc', 'poya', 'pxmart', 'rtmart', 'sanshang', 'shinyang', 'watsons', 'yoshinoya', 'zhengxian'].sort(),
  'the rotate set is the wide wordmarks'
);
for (const key of ['seven-eleven', 'fifty-lan']) {
  assert.ok(!SIGN_LOGO_ROTATE_PORTRAIT[key], `compact mark never rotates: ${key}`);
}
assert.deepEqual(Object.keys(SIGN_LOGO_DARK_PLATE).sort(), ['kebuke', 'wupaochun'], 'exactly two dark-plate logos');
assert.equal(logoPlateBg('kebuke'), '#1a1a1a', 'kebuke plate is near-black');
assert.equal(logoPlateBg('wupaochun'), '#1a1a1a', 'wupaochun plate is near-black');
assert.equal(logoPlateBg('seven-eleven'), '#ffffff', 'ordinary logos keep the white plate');

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

// --- Issue #372: the logo plates are real image files -----------
 // Every logo key has a real PNG in the repo (the user's 7-Eleven
 // image, the 50 Lan logo, the FamilyMart 2016 logo) — the painters
 // draw these instead of the vector lockups. The roof 7-ELEVEN
 // board is a logo plate too, so the real logo appears on roofs.
for (const [key, file] of Object.entries(SIGN_LOGO_FILES)) {
  const buf = readFileSync(new URL(`../${file}`, import.meta.url));
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${key} logo file is a PNG: ${file}`);
  assert.ok(buf.length > 1000, `${key} logo file is a real image, not a stub: ${file}`);
}
assert.equal(TAIPEI_ROOF_SIGNS.find((s) => s.name === '7-ELEVEN').logo, 'seven-eleven', 'roof 7-ELEVEN board carries its logo lockup');

// --- Font stack: every Taiwan device resolves a real CJK face -------
for (const face of ['Noto Sans TC', 'PingFang TC', 'JhengHei']) {
  assert.ok(SIGN_FONT_STACK.includes(face), `font stack covers ${face}`);
}

// --- Issue #372: font variety for the text plates --------------------
// The variant is deterministic per name (same name → same weight and
// size-scale on every machine, so the atlas is identical on every
// load), sizes only shrink (scale ≤ 1.0, so the fit-by-construction
// guarantees still hold), and every variant is actually used by the
// pool (the variety is visible, not a dead branch).
for (const v of SIGN_FONT_VARIANTS) {
  assert.ok([400, 500, 700].includes(v.weight), `font variant weight is a text weight: ${v.weight}`);
  assert.ok(v.scale > 0 && v.scale <= 1.0, `font variant scale only shrinks: ${v.scale}`);
}
assert.equal(SIGN_FONT_VARIANTS.length, 4, 'four font variants (weight × size)');
for (const name of ['牛肉麵', '7-ELEVEN', '八方雲集', '燦坤']) {
  assert.deepEqual(signFontVariant(name), signFontVariant(name), `font variant is deterministic: ${name}`);
}
const variantCounts = {};
for (const sign of TAIPEI_BAND_SIGNS) {
  const key = `${signFontVariant(sign.name).weight}/${signFontVariant(sign.name).scale}`;
  variantCounts[key] = (variantCounts[key] || 0) + 1;
}
for (const [key, count] of Object.entries(variantCounts)) {
  assert.ok(count >= 5, `font variant ${key} is used by at least 5 band plates (got ${count})`);
}
assert.equal(Object.keys(variantCounts).length, 4, 'all four font variants appear in the band pool');

// --- Issue #372: emoji on a SPARSE handful of signs -----------------
// Exactly three names carry an emoji (user: "don't overuse it") —
// the clinic the user named (鍾小和診所➕), a pharmacy and a noodle
// shop. They are blade-only (too long for a horizontal band plate,
// which caps at 5 units) and fit a blade (≤ 8 chars, emoji included).
// No emoji on any real-logo plate.
const EMOJI_RE = /[\u2795\u{1F48A}\u{1F35C}]/u;
const emojiNames = [...TAIPEI_BLADE_SIGNS].filter((s) => EMOJI_RE.test(s.name)).map((s) => s.name);
assert.deepEqual(emojiNames.sort(), ['健保藥局💊', '阿婆麵線🍜', '鍾小和診所➕'].sort(), 'exactly three emoji-bearing names, and no others');
for (const name of emojiNames) {
  assert.ok(!TAIPEI_BAND_SIGNS.some((s) => s.name === name), `${name} is blade-only, not a band plate`);
  assert.ok(bladeSignFits(TAIPEI_BLADE_SIGNS.find((s) => s.name === name)), `${name} fits its blade`);
  assert.ok(!TAIPEI_BLADE_SIGNS.find((s) => s.name === name).logo, `${name} is a text plate, not a logo plate`);
}
// An emoji is a fixed 1-unit cell in the width estimator, so an
// emoji name sizes (and fits) like a plain name of the same length.
assert.equal(nameWidthUnits('➕'), 1, 'the heavy plus sign is one width unit');
assert.equal(nameWidthUnits('💊'), 1, 'the pill emoji is one width unit');
assert.equal(nameWidthUnits('🍜'), 1, 'the noodle emoji is one width unit');
assert.equal(nameWidthUnits('鍾小和診所➕'), 6, 'the clinic name is six width units');
// The font stack falls through to a device emoji face, so the emoji
// renders instead of a missing-glyph box.
assert.ok(SIGN_FONT_STACK.includes('Color Emoji') || SIGN_FONT_STACK.includes('Segoe UI Emoji'), 'font stack covers emoji');

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
// Issue #354: the blade shader weights the commonest brands (not a
// uniform pick) — its brand plate indices must match the pool order.
for (const [name, literal] of [['7-ELEVEN', 'SIGN_BLADE_BRAND_711'], ['全家', 'SIGN_BLADE_BRAND_FAMILY'], ['八方雲集', 'SIGN_BLADE_BRAND_BAFANG'], ['鍋貼', 'SIGN_BLADE_BRAND_GUOTIE'], ['東一排骨', 'SIGN_BLADE_BRAND_DONGYI'], ['燦坤', 'SIGN_BLADE_BRAND_TSANNKUEN'], ['全聯', 'SIGN_BLADE_BRAND_PX'], ['NET', 'SIGN_BLADE_BRAND_NET']]) {
  const idx = TAIPEI_BLADE_SIGNS.findIndex((s) => s.name === name);
  assert.ok(idx >= 0, `brand plate in the pool: ${name}`);
  assert.ok(buildings.includes(`const ${literal} = ${idx}.0;`), `blade brand index matches the pool: ${name} = ${idx}`);
}
// Issue #354 (mirrored signs): the band plate is sampled through the
// wall-corrected coordinate — facadeCell's `flip` (1 on the -z and
// +x walls, where the box-local `along` runs right-to-left)
// un-mirrors it. Both band call sites (colour + emissive) use it.
assert.ok(tsl.includes('cell.flip'), 'band plate samples the wall-corrected coordinate (mirrored-sign fix)');
assert.equal(tsl.split('bandPlateColor(bandUV,').length - 1, 2, 'both band plate call sites use the corrected coordinate');

const boot = read('../js/taipei-boot.js');
assert.ok(boot.includes('setTaipeiSignAtlases('), 'taipei-boot injects the atlases');
assert.ok(boot.includes("from './taipei-signs.js'"), 'taipei-boot imports the signs module');
assert.ok(boot.includes('loadSignLogoImages'), 'taipei-boot loads the real logo images (issue #372)');
assert.ok(boot.includes('drawRoofAtlas'), 'taipei-boot paints the roof atlas');
assert.ok(boot.includes('drawTowerAtlas'), 'taipei-boot paints the tower atlas');

console.log('taipei-signs.test.mjs: all assertions passed');
