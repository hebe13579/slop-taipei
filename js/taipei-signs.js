// js/taipei-signs.js
// Issue #105: real-text Taiwanese 招牌. The Taiwan families' shopfront
// sign bands (js/tsl-materials.js) and the protruding vertical blades
// (js/buildings.js) used to carry procedural glyph bars — abstract
// strokes. This module is the REAL TEXT replacement: an everyday
// Taiwan shop-name pool, the atlas layouts both sign surfaces sample,
// and the canvas painters that render the names into those atlases.
//
// HARD RULES (user, 2026-10-24):
// - NO 檳榔 anywhere — no betel-nut names, no variants. The pool stays
//   everyday-commercial.
// - Names are assigned deterministically in the sign shaders (hashed
//   from the building seed + bay / panel position, the same inputs the
//   glyph treatment used), so a given lot shows the same shop on every
//   load. This module holds data + painters only; it never picks.
// - Fit is by construction: band names are capped at BAND_MAX_UNITS
//   width units and blade names at BLADE_MAX_CHARS characters, so a
//   name can never overflow its sign. (The glyph treatment remains as
//   the fallback wherever no atlas is injected — NYC, the gallery —
//   and on the landmark bands, which are out of this issue's scope.)
//
// This module is pure data + canvas-2D painters over a caller-supplied
// context: no three, no DOM at import time, so the node suite can pin
// the pool hygiene and the atlas math. taipei-boot.js creates the
// canvases/textures and injects them via tsl-materials'
// setTaipeiSignAtlases (the Pages preload list is pinned, so the
// preloaded materials must not import this file).

// Device font stack for the canvas painters. Taiwan devices all carry
// a Traditional-Chinese face (PingFang TC on Apple, Microsoft
// JhengHei on Windows, Noto Sans CJK TC on Android/Linux); the stack
// names each platform's face so the canvas picks a real CJK font
// everywhere instead of falling back to tofu boxes. Issue #372: the
// emoji fonts at the end, so the (rare) emoji in a sign name — the
// clinic ➕, the pharmacy 💊, the noodle 🍜 — falls through to the
// device's emoji face instead of a missing-glyph box. The emoji
// fonts carry no CJK glyphs, so they never steal a Chinese character.
export const SIGN_FONT_STACK =
  '"Noto Sans TC","Noto Sans CJK TC","PingFang TC","Microsoft JhengHei","Heiti TC","Noto Color Emoji","Apple Color Emoji","Segoe UI Emoji",sans-serif';

// Width of a name in "band units": a full-width (CJK) character is 1,
// a Latin letter/digit ~0.55 (bold condensed vs the square CJK cell),
// and an emoji is a fixed 1-unit cell (emoji are full-width glyphs;
// for...of iterates code points, so an astral emoji is one cell).
export function nameWidthUnits(name) {
  let u = 0;
  for (const ch of name) u += ch.codePointAt(0) <= 0xff ? 0.55 : 1;
  return u;
}

// Issue #372: font variety for the TEXT plates (the user asked for
// some bold, some slightly smaller). Deterministic per name — an
// FNV-1a hash of the name picks one of four (weight, size-scale)
// combos, so a plate always renders the same way and the atlas is
// identical on every machine, and the same shop reads the same way
// on its band and blade plates. Sizes only shrink (scale ≤ 1.0), so
// the fit-by-construction guarantees still hold (a regular face is
// narrower than the bold the estimator assumes). Real logo plates
// are images, not text, so they are untouched; the vector lockups
// (7-ELEVEN / FamilyMart fallbacks) stay exact and bold.
export const SIGN_FONT_VARIANTS = [
  { weight: 700, scale: 1.0 },
  { weight: 700, scale: 0.9 },
  { weight: 500, scale: 1.0 },
  { weight: 400, scale: 0.85 },
];
export function signFontVariant(name) {
  let h = 0x811c9dc5;
  for (const ch of name) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return SIGN_FONT_VARIANTS[h % SIGN_FONT_VARIANTS.length];
}

export const BAND_MAX_UNITS = 5.0;
// Stacked glyphs on a blade: at most 8 (a stacked Latin name like
// 7-ELEVEN runs longer than a CJK name); the painter shrinks the
// glyph size to fit and 8 chars still leaves ≥63 px glyphs.
export const BLADE_MAX_CHARS = 8;

// Issue #354 (genre broadening): every shop belongs to a daily-life
// genre, and each genre has its own colour + border pattern on the
// sign — a real Taiwanese street reads food vs clothes vs 3C vs
// market by the sign's look. `stripe` is the genre's top-stripe
// colour, painted on every non-logo plate (band 14 px, blade 18 px);
// `doubleBorder` gives clothes a second inner border stroke — the
// double border IS the clothes pattern, so it reads even where the
// plate's own colour already matches the genre stripe. Brand
// lockups (7-ELEVEN, FamilyMart) stay exact and get no stripe.
export const SIGN_GENRE_STYLE = {
  eat: { stripe: '#e4572e', doubleBorder: false },
  drink: { stripe: '#0f766e', doubleBorder: false },
  clothes: { stripe: '#c2437e', doubleBorder: true },
  '3c': { stripe: '#d52027', doubleBorder: false },
  market: { stripe: '#009944', doubleBorder: false },
  convenience: { stripe: '#f58220', doubleBorder: false },
  service: { stripe: '#5a6b7a', doubleBorder: false },
};
export const SIGN_GENRES = ['eat', 'drink', 'clothes', '3c', 'market', 'convenience', 'service'];

// The band pool: one plate per shop bay. bg/fg sampled from real
// Taiwan street signs (crimson noodle shops, pharmacy green, the
// yellow-and-black of 五十嵐, Hi-Life red on white, post-office green…).
// `bar` draws a contrasting strip along the plate's bottom edge
// (7-ELEVEN's green stripe). `logo` marks a real brand lockup — the
// painter draws the brand's own mark (7-ELEVEN's orange/red/green
// stripes, FamilyMart's green/blue bars) instead of plain text, so
// the two commonest convenience stores read as themselves at street
// distance. Issue #354 adds the second half of the pool (indices
// 48–63): the user's named shops （志明滷肉飯 / 好吃便當 / 健康蔬食）
// plus the names legible in the reference photos — the Beimen street
// photo （東一排骨 / 拉亞漢堡 / 永和豆漿 / 加力敦）, the 八方雲集
// storefront, 阿宗麵線's Ximending sign, and the Ningxia night
// market / Ximending signs （蚵仔煎大王 / 寧夏排骨麵 / 新東陽 /
// 迷你火鍋城 / 湯姆熊 / 機車修理）. Colours are the plates' own
// colours in those photos (yellow-black Bafang blade, red-on-white
// Ah-Chung sign, green-yellow Dongyi blade, red Xinyang sign…).
export const TAIPEI_BAND_SIGNS = [
  { name: '牛肉麵', bg: '#b0202a', fg: '#fff6e0', genre: 'eat' },
  { name: '7-ELEVEN', bg: '#ffffff', fg: '#e4572e', bar: '#009444', logo: 'seven-eleven', genre: 'convenience' },
  { name: '小吃店', bg: '#f6b73c', fg: '#a31f24', genre: 'eat' },
  { name: '魯肉飯', bg: '#7a2a1e', fg: '#ffe9b8', genre: 'eat' },
  { name: '藥局', bg: '#0e7a3d', fg: '#ffffff', genre: 'service' },
  { name: '早餐店', bg: '#f07d1a', fg: '#ffffff', genre: 'eat' },
  { name: '麵包店', bg: '#8a5a2b', fg: '#ffedcb', genre: 'eat' },
  { name: '咖啡店', bg: '#2e2019', fg: '#f3e2c7', genre: 'drink' },
  { name: '手搖飲', bg: '#0f766e', fg: '#ffffff', genre: 'drink' },
  { name: '自助餐', bg: '#c0272d', fg: '#ffd94d', genre: 'eat' },
  { name: '便當店', bg: '#2456a6', fg: '#ffffff', genre: 'eat' },
  { name: '滷味店', bg: '#4a2545', fg: '#ffd94d', genre: 'eat' },
  { name: '鹽酥雞', bg: '#1d1d22', fg: '#ffd94d', genre: 'eat' },
  { name: '豆花店', bg: '#f3ead8', fg: '#a31f24', genre: 'eat' },
  { name: '診所', bg: '#eef2f5', fg: '#2456a6', genre: 'service' },
  { name: '牙醫', bg: '#2f6fb2', fg: '#ffffff', genre: 'service' },
  { name: '中醫', bg: '#1e4d3a', fg: '#f3e2c7', genre: 'service' },
  { name: '書局', bg: '#22355e', fg: '#ffffff', genre: 'service' },
  { name: '眼鏡行', bg: '#23272e', fg: '#ffffff', genre: 'service' },
  { name: '機車行', bg: '#333a40', fg: '#ffd94d', genre: 'service' },
  { name: '美髮店', bg: '#c2437e', fg: '#ffffff', genre: 'service' },
  { name: '水果行', bg: '#2e8b3a', fg: '#ffe94d', genre: 'eat' },
  { name: '雜貨店', bg: '#3f6f6a', fg: '#f6ead2', genre: 'service' },
  { name: '洗衣店', bg: '#7fb3d9', fg: '#173a5e', genre: 'service' },
  { name: '茶行', bg: '#274e13', fg: '#ffd94d', genre: 'drink' },
  { name: '花店', bg: '#e78fb0', fg: '#5b2333', genre: 'service' },
  { name: '全家', bg: '#ffffff', fg: '#009944', logo: 'familymart', genre: 'convenience' },
  { name: '萊爾富', bg: '#ffffff', fg: '#e60012', genre: 'convenience', logo: 'hi-life' },
  { name: '屈臣氏', bg: '#00a5a8', fg: '#ffffff', genre: 'service', logo: 'watsons' },
  { name: '藥妝店', bg: '#e2543e', fg: '#ffffff', genre: 'service' },
  { name: '五金行', bg: '#5a6b7a', fg: '#ffffff', genre: 'service' },
  { name: '文具店', bg: '#e8862e', fg: '#ffffff', genre: 'service' },
  { name: '影印店', bg: '#f0ead8', fg: '#26221c', genre: 'service' },
  { name: '彩券行', bg: '#b0202a', fg: '#ffd94d', genre: 'service' },
  { name: '銀行', bg: '#1d3557', fg: '#ffd94d', genre: 'service' },
  { name: '郵局', bg: '#007a3d', fg: '#ffffff', genre: 'service' },
  { name: '麵店', bg: '#f3ead8', fg: '#8c2b23', genre: 'eat' },
  { name: '餃子館', bg: '#c0272d', fg: '#ffffff', genre: 'eat' },
  { name: '火鍋店', bg: '#6e1420', fg: '#ffd94d', genre: 'eat' },
  { name: '燒臘店', bg: '#a31f24', fg: '#ffd94d', genre: 'eat' },
  { name: '雞排店', bg: '#d95d39', fg: '#ffffff', genre: 'eat' },
  { name: '珍珠奶茶', bg: '#b08968', fg: '#ffffff', genre: 'drink' },
  { name: '五十嵐', bg: '#ffd400', fg: '#141414', logo: 'fifty-lan', genre: 'drink' },
  { name: '清心福全', bg: '#1e7a46', fg: '#ffffff', genre: 'drink', logo: 'ching-shin' },
  { name: '大苑子', bg: '#ffffff', fg: '#2e8b3a', genre: 'drink', logo: 'dayuanzi' },
  { name: 'OK超商', bg: '#e60012', fg: '#ffffff', genre: 'convenience', logo: 'ok-mart' },
  { name: '傳統小吃店', bg: '#8c5a2b', fg: '#ffe9b8', genre: 'eat' },
  { name: '陽春麵', bg: '#efe6d0', fg: '#7a2a1e', genre: 'eat' },
  // Issue #354: the second half of the pool (see the header note).
  { name: '志明滷肉飯', bg: '#6e1f16', fg: '#ffe9b8', genre: 'eat' },
  { name: '好吃便當', bg: '#e8862e', fg: '#ffffff', genre: 'eat' },
  { name: '健康蔬食', bg: '#2e8b3a', fg: '#ffffff', genre: 'eat' },
  { name: '東一排骨', bg: '#0e7a3d', fg: '#ffd94d', genre: 'eat' },
  { name: '八方雲集', bg: '#ffd400', fg: '#141414', genre: 'eat', logo: 'bafang' },
  { name: '鍋貼', bg: '#b0202a', fg: '#fff6e0', genre: 'eat' },
  { name: '阿宗麵線', bg: '#ffffff', fg: '#d52027', genre: 'eat', logo: 'achung' },
  { name: '拉亞漢堡', bg: '#f6b73c', fg: '#1d1d22', genre: 'eat', logo: 'laya' },
  { name: '永和豆漿', bg: '#a31f24', fg: '#ffd94d', genre: 'eat', logo: 'yonghe' },
  { name: '蚵仔煎大王', bg: '#1d3557', fg: '#ffd94d', genre: 'eat' },
  { name: '寧夏排骨麵', bg: '#6e1420', fg: '#ffd94d', genre: 'eat' },
  { name: '新東陽', bg: '#d52027', fg: '#ffffff', genre: 'eat', logo: 'shinyang' },
  { name: '機車修理', bg: '#1d1d22', fg: '#ffffff', genre: 'service' },
  { name: '迷你火鍋城', bg: '#7a2a1e', fg: '#ffd94d', genre: 'eat' },
  { name: '湯姆熊', bg: '#ffd400', fg: '#d52027', genre: 'service', logo: 'toms-world' },
  { name: '加力敦', bg: '#1b2a4a', fg: '#ffffff', genre: 'eat' },
  // Issue #354 (genre broadening): the daily-life genres the pool
  // was missing — clothing shops, 3C electronics, and the PX Mart
  // supermarket. NET / 服飾店 / 流行女裝 / 童裝 are clothes (the
  // genre stripe + double border tell them apart from food at a
  // glance); 燦坤 is Tsannkuen yellow/red and 全國電子 is E-Life
  // blue/white (the brands' own colours); 手機行 is the
  // neighbourhood phone shop; 全聯 is PX Mart white/blue with its
  // green bar (the brand's blue/green).
  { name: 'NET', bg: '#ffffff', fg: '#d52027', genre: 'clothes', logo: 'net' },
  { name: '服飾店', bg: '#c2437e', fg: '#ffffff', genre: 'clothes' },
  { name: '流行女裝', bg: '#6a3fb5', fg: '#ffffff', genre: 'clothes' },
  { name: '童裝', bg: '#ffd400', fg: '#1d1d22', genre: 'clothes' },
  { name: '燦坤', bg: '#ffd400', fg: '#d52027', genre: '3c', logo: 'tsannkuen' },
  { name: '全國電子', bg: '#1b4f9c', fg: '#ffffff', genre: '3c', logo: 'elife' },
  { name: '手機行', bg: '#0f766e', fg: '#ffffff', genre: '3c' },
  { name: '全聯', bg: '#ffffff', fg: '#1b4f9c', bar: '#009944', genre: 'market', logo: 'pxmart' },
  // Issue #372 (expansion, 2026-11-12): the ~40-brand job grows the
  // pool 72 → 96 — 24 new brands appended at the END, so no existing
  // plate index ever shifts (the blade shader's brand pins and the
  // band/blade index match all stay valid). Each entry is a real
  // brand with its real logo (see SIGN_LOGO_FILES); bg/fg are the
  // brand's own colours, used only by the text fallback plate when
  // the image fails to load. Genres follow the brand's trade:
  // supermarkets are market, beauty/drugstores are service, the
  // drink chains are drink, the food chains are eat.
  { name: '寶雅', bg: '#ffffff', fg: '#e60012', genre: 'service', logo: 'poya' },
  { name: '大潤發', bg: '#e60012', fg: '#ffffff', genre: 'market', logo: 'rtmart' },
  { name: '家樂福', bg: '#ffffff', fg: '#1b4f9c', genre: 'market', logo: 'carrefour' },
  { name: '麥當勞', bg: '#da291c', fg: '#ffc72c', genre: 'eat', logo: 'mcdonalds' },
  { name: '肯德基', bg: '#e4002b', fg: '#ffffff', genre: 'eat', logo: 'kfc' },
  { name: '摩斯漢堡', bg: '#e60012', fg: '#ffffff', genre: 'eat', logo: 'mos' },
  { name: '星巴克', bg: '#00704a', fg: '#ffffff', genre: 'drink', logo: 'starbucks' },
  { name: '路易莎', bg: '#e8862e', fg: '#ffffff', genre: 'drink', logo: 'louisa' },
  { name: '85°C', bg: '#d52027', fg: '#ffffff', genre: 'drink', logo: 'eight-five' },
  { name: '可不可', bg: '#e8dcc8', fg: '#5a4632', genre: 'drink', logo: 'kebuke' },
  { name: '迷客夏', bg: '#ffffff', fg: '#5b8c2a', genre: 'drink', logo: 'milksha' },
  { name: '麻古茶坊', bg: '#d52027', fg: '#ffffff', genre: 'drink', logo: 'macu' },
  { name: '鬍鬚張', bg: '#b0202a', fg: '#ffffff', genre: 'eat', logo: 'huxuzhang' },
  { name: '三商巧福', bg: '#f58220', fg: '#ffffff', genre: 'eat', logo: 'sanshang' },
  { name: '吉野家', bg: '#f58220', fg: '#ffffff', genre: 'eat', logo: 'yoshinoya' },
  { name: '爭鮮', bg: '#d52027', fg: '#ffffff', genre: 'eat', logo: 'zhengxian' },
  { name: '藏壽司', bg: '#ffffff', fg: '#1d1d22', genre: 'eat', logo: 'kura' },
  { name: '壽司郎', bg: '#ffffff', fg: '#d52027', genre: 'eat', logo: 'sushiro' },
  { name: '康是美', bg: '#ffffff', fg: '#f58220', genre: 'service', logo: 'cosmed' },
  { name: '鼎泰豐', bg: '#ffffff', fg: '#d52027', genre: 'eat', logo: 'dingtaifung' },
  { name: '春水堂', bg: '#ffffff', fg: '#1d1d22', genre: 'drink', logo: 'chunsuitang' },
  { name: 'CoCo都可', bg: '#ffffff', fg: '#f58220', genre: 'drink', logo: 'coco' },
  { name: '茶湯會', bg: '#6a3fb5', fg: '#ffffff', genre: 'drink', logo: 'chatime' },
  { name: '吳寶春', bg: '#1d1d22', fg: '#ffffff', genre: 'eat', logo: 'wupaochun' },
];

// Blade-only extras: names too wide for one shop bay but natural on a
// vertical blade, where characters stack top-to-bottom (the Taiwan
// way) and 6 characters fit a tall panel.
export const TAIPEI_BLADE_EXTRA = [
  // Issue #372: the full names carry their brand's real logo too
  // (FamilyMart's wide wordmark rotates on the blade, PX Mart's too).
  { name: '全家便利商店', bg: '#ffffff', fg: '#009944', genre: 'convenience', logo: 'familymart' },
  { name: '牛肉麵專賣店', bg: '#b0202a', fg: '#fff6e0', genre: 'eat' },
  { name: '古早味魯肉飯', bg: '#7a2a1e', fg: '#ffe9b8', genre: 'eat' },
  // Issue #354 (genre broadening): PX Mart's full name — 6 chars,
  // too wide for a band plate, like 全家便利商店.
  { name: '全聯福利中心', bg: '#ffffff', fg: '#1b4f9c', genre: 'market', logo: 'pxmart' },
  // Issue #372 (emoji — SPARSE, user: "don't overuse it"): exactly
  // three blade-only names carry an emoji, all stacked top-to-bottom
  // on a vertical blade (the Taiwanese clinic/pharmacy/noodle idiom).
  // They are blade-only because they are too long for a horizontal
  // band plate (BAND_MAX_UNITS 5.0) but fit a blade (≤ 8 chars).
  // The clinic is the user's example (鍾小和診所➕); the ➕ is a
  // text plus sign, so it renders in the plate's own fg colour like
  // a real clinic cross. No emoji on any real-logo plate.
  { name: '鍾小和診所➕', bg: '#eef2f5', fg: '#1b4f9c', genre: 'service' },
  { name: '健保藥局💊', bg: '#0e7a3d', fg: '#ffffff', genre: 'service' },
  { name: '阿婆麵線🍜', bg: '#efe6d0', fg: '#7a2a1e', genre: 'eat' },
];

// The blade pool is the band pool (same order — band plate i and blade
// plate i are the same shop) plus the vertical extras.
export const TAIPEI_BLADE_SIGNS = [...TAIPEI_BAND_SIGNS, ...TAIPEI_BLADE_EXTRA];

// Atlas layouts. Plate index i sits at column (i % cols), row
// floor(i / cols) counted FROM THE BOTTOM of the texture (three.js
// UV space, flipY) — the painters below flip the row when drawing
// into canvas (top-down) coordinates, so shader and painter agree on
// this one convention. The grid literals are mirrored in the sign
// shaders (js/tsl-materials.js bands, js/buildings.js blades) because
// the preloaded modules may not import this file; the node suite
// source-pins both mirrors against these constants.
// Issue #354: the band grid grows 8×6 → 8×8 for the 64-name pool
// (canvas 4096×1280 — 4096 wide, the same width as before, so no new
// texture-size risk). The blade grid grows 9×6 → 12×6 for the 67
// plates (canvas 1728×3456 — the height stays 3456, under the 4096
// texture limit a 9×8 grid would have broken).
// Issue #354 (genre broadening): the band grid grows 8×8 → 8×9 for
// the 72-name pool (canvas 4096×1440) and the blade grid 12×6 →
// 12×7 for the 76 plates (canvas 1728×4032, still under 4096).
// Issue #372 (expansion): the band grid grows 8×9 → 8×12 for the
// 96-name pool (canvas 4096×1920 — an exact fill, 96 cells for 96
// plates, so the suite pins an exact fill) and the blade grid
// 12×7 → 16×7 for the 103 plates (canvas 2304×4032, still under
// 4096; 112 cells hold 103 plates with 9 spare).
export const BAND_ATLAS = { cols: 8, rows: 12, cellW: 512, cellH: 160 };
BAND_ATLAS.w = BAND_ATLAS.cols * BAND_ATLAS.cellW;
BAND_ATLAS.h = BAND_ATLAS.rows * BAND_ATLAS.cellH;
export const BLADE_ATLAS = { cols: 16, rows: 7, cellW: 144, cellH: 576 };
BLADE_ATLAS.w = BLADE_ATLAS.cols * BLADE_ATLAS.cellW;
BLADE_ATLAS.h = BLADE_ATLAS.rows * BLADE_ATLAS.cellH;

// UV rect (three.js space, v from the bottom) of plate `index`, with
// an inset (fraction of the cell) shaved off every side so mip
// bleeding never pulls a neighbour plate's colours into a sign.
export function plateCellUV(index, atlas, inset = 0) {
  const col = index % atlas.cols;
  const rowB = Math.floor(index / atlas.cols);
  return {
    u0: (col + inset) / atlas.cols,
    v0: (rowB + inset) / atlas.rows,
    u1: (col + 1 - inset) / atlas.cols,
    v1: (rowB + 1 - inset) / atlas.rows,
  };
}

export function bandSignFits(sign) {
  return nameWidthUnits(sign.name) <= BAND_MAX_UNITS + 1e-9;
}
export function bladeSignFits(sign) {
  return [...sign.name].length <= BLADE_MAX_CHARS;
}

// Canvas-space origin (top-left) of plate `index`: the painter-side
// mirror of plateCellUV (canvas rows run top-down).
function cellOrigin(index, atlas) {
  const col = index % atlas.cols;
  const rowFromBottom = Math.floor(index / atlas.cols);
  return { x: col * atlas.cellW, y: (atlas.rows - 1 - rowFromBottom) * atlas.cellH };
}

// Issue #372: real brand logos. The logo plates are real image
// files in assets/sign-logos/ — the user's own 7-Eleven image, the
// 50 Lan logo (Wikipedia, from 50 Lan's own ordering portal), the
// FamilyMart 2016 logo (Wikimedia Commons) — drawn onto the atlas
// instead of the vector lockups below. The vector painters stay as
// the fallback when an image is missing or fails to load, and the
// plain-text plate stays the fallback for an image-only logo
// (fifty-lan), so the atlas is never empty and the node suite (which
// never loads images) keeps testing the fallback. Files resolve
// against this module's own URL, so the path works on Pages and in
// the shot rigs regardless of which page boots. Each image gets its
// own timeout so a stalled load can never hang the boot; a failed
// load resolves to an empty map (never rejects).
// Issue #372 (expansion, 2026-11-12): ~40 real brands at the user's
// request ("more logo copied directly from source 八方雲集.. etc.
// try find about 40 brands"). 42 logos in all (the 3 above + 39
// sourced from Wikipedia / Wikimedia Commons / the brands' own
// sites — see logos372-evidence/downloads/MANIFEST-{A,B,C,D}.md for
// the source of each). The one brand with no clean logo graphic
// anywhere (東一排骨) keeps its text plate.
export const SIGN_LOGO_FILES = {
  'seven-eleven': 'assets/sign-logos/7-eleven.png',
  'familymart': 'assets/sign-logos/familymart.png',
  'fifty-lan': 'assets/sign-logos/fifty-lan.png',
  'hi-life': 'assets/sign-logos/hi-life.png',
  'watsons': 'assets/sign-logos/watsons.png',
  'ching-shin': 'assets/sign-logos/ching-shin.png',
  'dayuanzi': 'assets/sign-logos/dayuanzi.png',
  'ok-mart': 'assets/sign-logos/ok-mart.png',
  'bafang': 'assets/sign-logos/bafang.png',
  'achung': 'assets/sign-logos/achung.png',
  'laya': 'assets/sign-logos/laya.png',
  'yonghe': 'assets/sign-logos/yonghe.png',
  'shinyang': 'assets/sign-logos/shinyang.png',
  'toms-world': 'assets/sign-logos/toms-world.png',
  'net': 'assets/sign-logos/net.png',
  'tsannkuen': 'assets/sign-logos/tsannkuen.png',
  'elife': 'assets/sign-logos/elife.png',
  'pxmart': 'assets/sign-logos/pxmart.png',
  'poya': 'assets/sign-logos/poya.png',
  'rtmart': 'assets/sign-logos/rtmart.png',
  'carrefour': 'assets/sign-logos/carrefour.png',
  'mcdonalds': 'assets/sign-logos/mcdonalds.png',
  'kfc': 'assets/sign-logos/kfc.png',
  'mos': 'assets/sign-logos/mos.png',
  'starbucks': 'assets/sign-logos/starbucks.png',
  'louisa': 'assets/sign-logos/louisa.png',
  'eight-five': 'assets/sign-logos/eight-five.png',
  'kebuke': 'assets/sign-logos/kebuke.png',
  'milksha': 'assets/sign-logos/milksha.png',
  'macu': 'assets/sign-logos/macu.png',
  'huxuzhang': 'assets/sign-logos/huxuzhang.png',
  'sanshang': 'assets/sign-logos/sanshang.png',
  'yoshinoya': 'assets/sign-logos/yoshinoya.png',
  'zhengxian': 'assets/sign-logos/zhengxian.png',
  'kura': 'assets/sign-logos/kura.png',
  'sushiro': 'assets/sign-logos/sushiro.png',
  'cosmed': 'assets/sign-logos/cosmed.png',
  'dingtaifung': 'assets/sign-logos/dingtaifung.png',
  'chunsuitang': 'assets/sign-logos/chunsuitang.png',
  'coco': 'assets/sign-logos/coco.png',
  'chatime': 'assets/sign-logos/chatime.png',
  'wupaochun': 'assets/sign-logos/wupaochun.png',
};
// Wide wordmarks rotate 90° on portrait cells so the lockup reads
// top-to-bottom like a real vertical blade sign. Near-square marks
// (7-Eleven, 50 Lan) never rotate — rotating them would turn their
// characters sideways. Rule (measured from the staged files): a logo
// wider than 2:1 rotates; a compact mark does not. FamilyMart was
// the original case; the rest follow the same rule.
export const SIGN_LOGO_ROTATE_PORTRAIT = {
  'familymart': true,
  'watsons': true,
  'chunsuitang': true,
  'coco': true,
  'dayuanzi': true,
  'dingtaifung': true,
  'elife': true,
  'huxuzhang': true,
  'kfc': true,
  'poya': true,
  'pxmart': true,
  'rtmart': true,
  'sanshang': true,
  'shinyang': true,
  'yoshinoya': true,
  'zhengxian': true,
  'achung': true,
};
// Two logos are light art on transparency and vanish on a white
// plate — kebuke's beige "K" and wupaochun's white mark (both
// verified on the contact sheets). Their plates are near-black, so
// the mark reads. Every other logo is dark/colourful enough for the
// white plate (cosmed's opaque white background blends with it).
// The plate colour is looked up per logo key, so the roof/tower
// painters get the same treatment for free.
export const SIGN_LOGO_DARK_PLATE = { 'kebuke': true, 'wupaochun': true };
export function logoPlateBg(key) {
  return SIGN_LOGO_DARK_PLATE[key] ? '#1a1a1a' : '#ffffff';
}

export function loadSignLogoImages() {
  if (typeof Image === 'undefined') return Promise.resolve({});
  let base = '';
  try {
    base = new URL('../', import.meta.url).href;
  } catch (err) {
    return Promise.resolve({});
  }
  const loadOne = ([key, file]) => new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => resolve(null), 8000);
    img.onload = () => { clearTimeout(timer); resolve([key, img]); };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.src = base + file;
  });
  return Promise.all(Object.entries(SIGN_LOGO_FILES).map(loadOne))
    .then((pairs) => {
      const out = {};
      for (const p of pairs) if (p) out[p[0]] = p[1];
      return out;
    })
    .catch(() => ({}));
}

// Draw a real logo image into a plate cell, aspect-preserving
// (contain) on the plate, never stretched. `rotate` turns a wide
// wordmark 90° clockwise so it reads top-to-bottom on a tall cell.
// `plateBg` is the plate colour (white, or near-black for the two
// light-on-transparency logos — see SIGN_LOGO_DARK_PLATE).
function drawLogoImage(ctx, x, y, w, h, img, rotate = false, plateBg = '#ffffff') {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = plateBg;
  ctx.fillRect(x, y, w, h);
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (iw > 0 && ih > 0) {
    if (rotate) {
      ctx.translate(x + w / 2, y + h / 2);
      ctx.rotate(Math.PI / 2);
      const s = Math.min(w / ih, h / iw);
      const dw = iw * s, dh = ih * s;
      ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    } else {
      const s = Math.min(w / iw, h / ih);
      const dw = iw * s, dh = ih * s;
      ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    }
  }
  ctx.restore();
}

// Issue #354: real brand lockups, drawn from the reference photos
// (the user's attached 7-Eleven logo; the FamilyMart storefront
// photo: green + blue two-bar logo on white). Both lockups are
// resolution-free canvas vector drawing — no image assets — so the
// atlas is identical on every machine. `portrait` selects the blade
// arrangement (7 over ELEVEN) vs the band arrangement (7 beside
// ELEVEN); the colours are the brands' own.
function drawSevenElevenLogo(ctx, x, y, w, h, portrait) {
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#f58220'; // orange top stripe
  ctx.fillRect(x, y, w, portrait ? 20 : 14);
  ctx.fillStyle = '#e4022b'; // red bottom block
  ctx.fillRect(x, y + h - (portrait ? 20 : 14), w, portrait ? 20 : 14);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (portrait) {
    ctx.fillStyle = '#e4022b';
    ctx.font = `700 ${Math.round(h * 0.34)}px ${SIGN_FONT_STACK}`;
    ctx.fillText('7', x + w / 2, y + h * 0.36);
    ctx.fillStyle = '#008061'; // green ELEVEN
    ctx.font = `700 ${Math.round(w * 0.21)}px ${SIGN_FONT_STACK}`;
    ctx.fillText('ELEVEN', x + w / 2, y + h * 0.68);
  } else {
    ctx.fillStyle = '#e4022b';
    ctx.font = `700 ${Math.round(h * 0.72)}px ${SIGN_FONT_STACK}`;
    ctx.fillText('7', x + w * 0.30, y + h / 2 + 2);
    ctx.fillStyle = '#008061';
    ctx.font = `700 ${Math.round(h * 0.42)}px ${SIGN_FONT_STACK}`;
    ctx.fillText('ELEVEN', x + w * 0.62, y + h / 2 + 2);
  }
}
function drawFamilyMartLogo(ctx, x, y, w, h, portrait) {
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, w, h);
  // Green bar over blue bar — the two-bar logo from the storefront.
  ctx.fillStyle = '#009944';
  ctx.fillRect(x, y, w, portrait ? 18 : 12);
  ctx.fillStyle = '#0093d6';
  ctx.fillRect(x, y + (portrait ? 18 : 12), w, portrait ? 10 : 8);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (portrait) {
    ctx.fillStyle = '#009944';
    ctx.font = `700 ${Math.round(w * 0.42)}px ${SIGN_FONT_STACK}`;
    ctx.fillText('全家', x + w / 2, y + h * 0.50);
    ctx.fillStyle = '#0093d6';
    ctx.font = `700 ${Math.round(w * 0.13)}px ${SIGN_FONT_STACK}`;
    ctx.fillText('FamilyMart', x + w / 2, y + h * 0.68);
  } else {
    ctx.fillStyle = '#009944';
    ctx.font = `700 ${Math.round(h * 0.52)}px ${SIGN_FONT_STACK}`;
    ctx.fillText('全家', x + w * 0.30, y + h / 2 + 2);
    ctx.fillStyle = '#0093d6';
    ctx.font = `700 ${Math.round(h * 0.22)}px ${SIGN_FONT_STACK}`;
    ctx.fillText('FamilyMart', x + w * 0.68, y + h / 2 + 2);
  }
}

// Paint every band plate into ctx (the canvas is BAND_ATLAS.w ×
// BAND_ATLAS.h). Font size comes from the width-units estimator, not
// measureText, so the atlas is identical on every machine regardless
// of which CJK face the stack resolves to. `images` (issue #372) is
// the loaded real-logo map; a logo plate draws its real image when
// present and its vector lockup when not.
export function drawBandAtlas(ctx, images = null) {
  const { cellW, cellH } = BAND_ATLAS;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  TAIPEI_BAND_SIGNS.forEach((sign, i) => {
    const { x, y } = cellOrigin(i, BAND_ATLAS);
    if (sign.logo) {
      const img = images && images[sign.logo];
      if (img) { drawLogoImage(ctx, x, y, cellW, cellH, img, false, logoPlateBg(sign.logo)); return; }
    }
    if (sign.logo === 'seven-eleven') { drawSevenElevenLogo(ctx, x, y, cellW, cellH, false); return; }
    if (sign.logo === 'familymart') { drawFamilyMartLogo(ctx, x, y, cellW, cellH, false); return; }
    ctx.globalAlpha = 1;
    ctx.fillStyle = sign.bg;
    ctx.fillRect(x, y, cellW, cellH);
    // Issue #354 (genre broadening): the genre's top stripe — the
    // colour that tells the shop's daily-life genre at a glance.
    // Logo lockups stay exact (they return above), so this only
    // touches plain-text plates.
    const genreStyle = SIGN_GENRE_STYLE[sign.genre] || SIGN_GENRE_STYLE.service;
    ctx.fillStyle = genreStyle.stripe;
    ctx.fillRect(x, y, cellW, 14);
    if (sign.bar) {
      ctx.fillStyle = sign.bar;
      ctx.fillRect(x, y + cellH - 16, cellW, 16);
    }
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = sign.fg;
    ctx.lineWidth = 5;
    ctx.strokeRect(x + 8, y + 8, cellW - 16, cellH - 16);
    // Clothes carries a second inner border — the double border is
    // the clothes pattern (drawn in the plate's own fg so it reads
    // on every clothes bg, including 服飾店's magenta).
    if (genreStyle.doubleBorder) {
      ctx.lineWidth = 4;
      ctx.strokeRect(x + 20, y + 20, cellW - 40, cellH - 40);
    }
    ctx.globalAlpha = 1;
    // Issue #372: font variety — the plate's deterministic
    // (weight, size-scale) from its name.
    const v = signFontVariant(sign.name);
    const px = Math.min(94, (cellW * 0.86) / nameWidthUnits(sign.name)) * v.scale;
    ctx.font = `${v.weight} ${Math.round(px)}px ${SIGN_FONT_STACK}`;
    ctx.fillStyle = sign.fg;
    ctx.fillText(sign.name, x + cellW / 2, y + cellH / 2 + 3);
  });
}

// Paint every blade plate: the name stacked top-to-bottom, one
// character per line, centred in the tall cell. `images` (issue
// #372) is the loaded real-logo map; a wide wordmark rotates 90° on
// a blade so the lockup reads top-to-bottom.
export function drawBladeAtlas(ctx, images = null) {
  const { cellW, cellH } = BLADE_ATLAS;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  TAIPEI_BLADE_SIGNS.forEach((sign, i) => {
    const { x, y } = cellOrigin(i, BLADE_ATLAS);
    if (sign.logo) {
      const img = images && images[sign.logo];
      if (img) { drawLogoImage(ctx, x, y, cellW, cellH, img, !!SIGN_LOGO_ROTATE_PORTRAIT[sign.logo], logoPlateBg(sign.logo)); return; }
    }
    if (sign.logo === 'seven-eleven') { drawSevenElevenLogo(ctx, x, y, cellW, cellH, true); return; }
    if (sign.logo === 'familymart') { drawFamilyMartLogo(ctx, x, y, cellW, cellH, true); return; }
    ctx.globalAlpha = 1;
    ctx.fillStyle = sign.bg;
    ctx.fillRect(x, y, cellW, cellH);
    // Issue #354 (genre broadening): the genre's top stripe on the
    // blade too (18 px — the blade is tall, so the stripe reads as
    // a cap). Logo lockups stay exact (they return above).
    const genreStyle = SIGN_GENRE_STYLE[sign.genre] || SIGN_GENRE_STYLE.service;
    ctx.fillStyle = genreStyle.stripe;
    ctx.fillRect(x, y, cellW, 18);
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = sign.fg;
    ctx.lineWidth = 4;
    ctx.strokeRect(x + 6, y + 6, cellW - 12, cellH - 12);
    // Clothes carries a second inner border — the double border is
    // the clothes pattern (drawn in the plate's own fg so it reads
    // on every clothes bg). Its top edge sits below the 18 px genre
    // stripe (y+26), so the border never crosses the stripe.
    if (genreStyle.doubleBorder) {
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 14, y + 26, cellW - 28, cellH - 40);
    }
    ctx.globalAlpha = 1;
    const chars = [...sign.name];
    // Issue #372: font variety — the plate's deterministic
    // (weight, size-scale) from its name.
    const v = signFontVariant(sign.name);
    const px = Math.min(cellW * 0.74, (cellH * 0.88) / chars.length) * v.scale;
    ctx.font = `${v.weight} ${Math.round(px)}px ${SIGN_FONT_STACK}`;
    ctx.fillStyle = sign.fg;
    const stepY = px * 1.04;
    let cy = y + cellH / 2 - ((chars.length - 1) * stepY) / 2;
    for (const ch of chars) {
      ctx.fillText(ch, x + cellW / 2, cy);
      cy += stepY;
    }
  });
}

// ---------------------------------------------------------------------
// Issue #153: rooftop billboard signs. The #105 pool is street-level
// shop names; the roofs belong to the brands that actually own them —
// the electronics/appliance names from the user's station-district
// photo (Hitachi's big air-con board, the SANLUX tower sign) plus big
// everyday retail/telecom/bank names. Betel nut stays OUT, same as
// #105. One pool, two atlases: the ROOF atlas paints each brand
// landscape (a wide board on a roof, name big with the Latin mark
// below) and the TOWER atlas paints the same brand portrait (stacked
// characters, the blade idiom — a tall side sign on a tower). Plate
// index i is the same brand in both atlases, so the renderer picks
// the atlas by the board's kind, never by the brand.
// ---------------------------------------------------------------------

export const ROOF_MAX_UNITS = 5.0;
// A tower plate stacks the name top-to-bottom like a blade.
export const TOWER_MAX_CHARS = 8;

// `latin` is the brand's Latin mark, drawn under (roof) the CJK name;
// Latin-only brands carry no CJK name. `bar` is the bottom-edge
// stripe (7-ELEVEN's green stripe, same as its band plate). Colours
// are the brands' own looks: Hitachi white/red with the green
// HITACHI line from the user's photo, SANLUX white/blue, Tatung blue,
// SAMPO red, SONY black, LG crimson, Samsung blue-on-white,
// Chunghwa blue, Cathay green, Taiwan Mobile orange.
export const TAIPEI_ROOF_SIGNS = [
  { name: '日立', latin: 'HITACHI', bg: '#ffffff', fg: '#d52027', accent: '#009444' },
  { name: '三洋', latin: 'SANLUX', bg: '#ffffff', fg: '#1b4f9c', accent: '#d52027' },
  { name: '大同', latin: 'TATUNG', bg: '#1b4f9c', fg: '#ffffff' },
  { name: '國際牌', latin: 'Panasonic', bg: '#ffffff', fg: '#004488' },
  { name: '聲寶', latin: 'SAMPO', bg: '#d52027', fg: '#ffffff' },
  { name: '東元', latin: 'TECO', bg: '#e8eef4', fg: '#0f2f5e' },
  { name: 'SONY', latin: null, bg: '#000000', fg: '#ffffff' },
  { name: 'LG', latin: null, bg: '#a50034', fg: '#ffffff' },
  { name: '三星', latin: 'SAMSUNG', bg: '#ffffff', fg: '#1428a0' },
  { name: '中華電信', latin: null, bg: '#005bac', fg: '#ffffff' },
  { name: '國泰世華', latin: null, bg: '#007a5e', fg: '#ffffff' },
  { name: '台灣大哥大', latin: null, bg: '#f58220', fg: '#ffffff' },
  { name: '7-ELEVEN', latin: null, bg: '#ffffff', fg: '#e4572e', bar: '#009444', logo: 'seven-eleven' },
];

// Wide cells for wide roof boards (2:1); tall cells for tower signs
// (1:4, the blade shape). Both grids hold the whole pool with spare
// cells — the pool grows into the grid, never past it.
export const ROOF_ATLAS = { cols: 4, rows: 4, cellW: 512, cellH: 256 };
ROOF_ATLAS.w = ROOF_ATLAS.cols * ROOF_ATLAS.cellW;
ROOF_ATLAS.h = ROOF_ATLAS.rows * ROOF_ATLAS.cellH;
export const TOWER_ATLAS = { cols: 4, rows: 4, cellW: 144, cellH: 576 };
TOWER_ATLAS.w = TOWER_ATLAS.cols * TOWER_ATLAS.cellW;
TOWER_ATLAS.h = TOWER_ATLAS.rows * TOWER_ATLAS.cellH;

export function roofSignFits(sign) {
  return nameWidthUnits(sign.name) <= ROOF_MAX_UNITS + 1e-9;
}
export function towerSignFits(sign) {
  return [...sign.name].length <= TOWER_MAX_CHARS;
}

// Paint every roof plate: the brand name big across the wide cell,
// the Latin mark smaller below it (accent colour when the brand has
// one — Hitachi's green HITACHI line from the photo). Font size
// comes from the width-units estimator, so the atlas is identical on
// every machine regardless of which CJK face the stack resolves to.
// `images` (issue #372) is the loaded real-logo map; the 7-ELEVEN
// roof board draws its real logo when present.
export function drawRoofAtlas(ctx, images = null) {
  const { cellW, cellH } = ROOF_ATLAS;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  TAIPEI_ROOF_SIGNS.forEach((sign, i) => {
    const { x, y } = cellOrigin(i, ROOF_ATLAS);
    if (sign.logo) {
      const img = images && images[sign.logo];
      if (img) { drawLogoImage(ctx, x, y, cellW, cellH, img, false, logoPlateBg(sign.logo)); return; }
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = sign.bg;
    ctx.fillRect(x, y, cellW, cellH);
    if (sign.bar) {
      ctx.fillStyle = sign.bar;
      ctx.fillRect(x, y + cellH - 16, cellW, 16);
    }
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = sign.fg;
    ctx.lineWidth = 5;
    ctx.strokeRect(x + 8, y + 8, cellW - 16, cellH - 16);
    ctx.globalAlpha = 1;
    // Issue #372: font variety — the plate's deterministic
    // (weight, size-scale) from its name (same variant for the name
    // and its Latin mark, so a roof board reads as one plate).
    const v = signFontVariant(sign.name);
    const px = Math.min(120, (cellW * 0.86) / nameWidthUnits(sign.name)) * v.scale;
    ctx.font = `${v.weight} ${Math.round(px)}px ${SIGN_FONT_STACK}`;
    ctx.fillStyle = sign.fg;
    const nameY = sign.latin ? y + cellH / 2 - 28 : y + cellH / 2 + 3;
    ctx.fillText(sign.name, x + cellW / 2, nameY);
    if (sign.latin) {
      const lpx = Math.min(46, (cellW * 0.86) / nameWidthUnits(sign.latin)) * v.scale;
      ctx.font = `${v.weight} ${Math.round(lpx)}px ${SIGN_FONT_STACK}`;
      ctx.fillStyle = sign.accent || sign.fg;
      ctx.fillText(sign.latin, x + cellW / 2, y + cellH / 2 + 62);
    }
  });
}

// Paint every tower plate: the brand name stacked top-to-bottom, one
// character per line, centred in the tall cell — the blade idiom, for
// a tall side sign on a tower. Latin-only brands stack their letters.
// `images` (issue #372) is the loaded real-logo map; the 7-ELEVEN
// tower sign draws its real logo when present.
export function drawTowerAtlas(ctx, images = null) {
  const { cellW, cellH } = TOWER_ATLAS;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  TAIPEI_ROOF_SIGNS.forEach((sign, i) => {
    const { x, y } = cellOrigin(i, TOWER_ATLAS);
    if (sign.logo) {
      const img = images && images[sign.logo];
      if (img) { drawLogoImage(ctx, x, y, cellW, cellH, img, false, logoPlateBg(sign.logo)); return; }
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = sign.bg;
    ctx.fillRect(x, y, cellW, cellH);
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = sign.fg;
    ctx.lineWidth = 4;
    ctx.strokeRect(x + 6, y + 6, cellW - 12, cellH - 12);
    ctx.globalAlpha = 1;
    const chars = [...sign.name];
    // Issue #372: font variety — the plate's deterministic
    // (weight, size-scale) from its name.
    const v = signFontVariant(sign.name);
    const px = Math.min(cellW * 0.74, (cellH * 0.88) / chars.length) * v.scale;
    ctx.font = `${v.weight} ${Math.round(px)}px ${SIGN_FONT_STACK}`;
    ctx.fillStyle = sign.fg;
    const stepY = px * 1.04;
    let cy = y + cellH / 2 - ((chars.length - 1) * stepY) / 2;
    for (const ch of chars) {
      ctx.fillText(ch, x + cellW / 2, cy);
      cy += stepY;
    }
  });
}
