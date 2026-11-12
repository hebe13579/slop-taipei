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
// everywhere instead of falling back to tofu boxes.
export const SIGN_FONT_STACK =
  '"Noto Sans TC","Noto Sans CJK TC","PingFang TC","Microsoft JhengHei","Heiti TC",sans-serif';

// Width of a name in "band units": a full-width (CJK) character is 1,
// a Latin letter/digit ~0.55 (bold condensed vs the square CJK cell).
export function nameWidthUnits(name) {
  let u = 0;
  for (const ch of name) u += ch.codePointAt(0) <= 0xff ? 0.55 : 1;
  return u;
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
  { name: '萊爾富', bg: '#ffffff', fg: '#e60012', genre: 'convenience' },
  { name: '屈臣氏', bg: '#00a5a8', fg: '#ffffff', genre: 'service' },
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
  { name: '五十嵐', bg: '#ffd400', fg: '#141414', genre: 'drink' },
  { name: '清心福全', bg: '#1e7a46', fg: '#ffffff', genre: 'drink' },
  { name: '大苑子', bg: '#ffffff', fg: '#2e8b3a', genre: 'drink' },
  { name: 'OK超商', bg: '#e60012', fg: '#ffffff', genre: 'convenience' },
  { name: '傳統小吃店', bg: '#8c5a2b', fg: '#ffe9b8', genre: 'eat' },
  { name: '陽春麵', bg: '#efe6d0', fg: '#7a2a1e', genre: 'eat' },
  // Issue #354: the second half of the pool (see the header note).
  { name: '志明滷肉飯', bg: '#6e1f16', fg: '#ffe9b8', genre: 'eat' },
  { name: '好吃便當', bg: '#e8862e', fg: '#ffffff', genre: 'eat' },
  { name: '健康蔬食', bg: '#2e8b3a', fg: '#ffffff', genre: 'eat' },
  { name: '東一排骨', bg: '#0e7a3d', fg: '#ffd94d', genre: 'eat' },
  { name: '八方雲集', bg: '#ffd400', fg: '#141414', genre: 'eat' },
  { name: '鍋貼', bg: '#b0202a', fg: '#fff6e0', genre: 'eat' },
  { name: '阿宗麵線', bg: '#ffffff', fg: '#d52027', genre: 'eat' },
  { name: '拉亞漢堡', bg: '#f6b73c', fg: '#1d1d22', genre: 'eat' },
  { name: '永和豆漿', bg: '#a31f24', fg: '#ffd94d', genre: 'eat' },
  { name: '蚵仔煎大王', bg: '#1d3557', fg: '#ffd94d', genre: 'eat' },
  { name: '寧夏排骨麵', bg: '#6e1420', fg: '#ffd94d', genre: 'eat' },
  { name: '新東陽', bg: '#d52027', fg: '#ffffff', genre: 'eat' },
  { name: '機車修理', bg: '#1d1d22', fg: '#ffffff', genre: 'service' },
  { name: '迷你火鍋城', bg: '#7a2a1e', fg: '#ffd94d', genre: 'eat' },
  { name: '湯姆熊', bg: '#ffd400', fg: '#d52027', genre: 'service' },
  { name: '加力敦', bg: '#1b2a4a', fg: '#ffffff', genre: 'eat' },
  // Issue #354 (genre broadening): the daily-life genres the pool
  // was missing — clothing shops, 3C electronics, and the PX Mart
  // supermarket. NET / 服飾店 / 流行女裝 / 童裝 are clothes (the
  // genre stripe + double border tell them apart from food at a
  // glance); 燦坤 is Tsannkuen yellow/red and 全國電子 is E-Life
  // blue/white (the brands' own colours); 手機行 is the
  // neighbourhood phone shop; 全聯 is PX Mart white/blue with its
  // green bar (the brand's blue/green).
  { name: 'NET', bg: '#ffffff', fg: '#d52027', genre: 'clothes' },
  { name: '服飾店', bg: '#c2437e', fg: '#ffffff', genre: 'clothes' },
  { name: '流行女裝', bg: '#6a3fb5', fg: '#ffffff', genre: 'clothes' },
  { name: '童裝', bg: '#ffd400', fg: '#1d1d22', genre: 'clothes' },
  { name: '燦坤', bg: '#ffd400', fg: '#d52027', genre: '3c' },
  { name: '全國電子', bg: '#1b4f9c', fg: '#ffffff', genre: '3c' },
  { name: '手機行', bg: '#0f766e', fg: '#ffffff', genre: '3c' },
  { name: '全聯', bg: '#ffffff', fg: '#1b4f9c', bar: '#009944', genre: 'market' },
];

// Blade-only extras: names too wide for one shop bay but natural on a
// vertical blade, where characters stack top-to-bottom (the Taiwan
// way) and 6 characters fit a tall panel.
export const TAIPEI_BLADE_EXTRA = [
  { name: '全家便利商店', bg: '#ffffff', fg: '#009944', genre: 'convenience' },
  { name: '牛肉麵專賣店', bg: '#b0202a', fg: '#fff6e0', genre: 'eat' },
  { name: '古早味魯肉飯', bg: '#7a2a1e', fg: '#ffe9b8', genre: 'eat' },
  // Issue #354 (genre broadening): PX Mart's full name — 6 chars,
  // too wide for a band plate, like 全家便利商店.
  { name: '全聯福利中心', bg: '#ffffff', fg: '#1b4f9c', genre: 'market' },
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
export const BAND_ATLAS = { cols: 8, rows: 9, cellW: 512, cellH: 160 };
BAND_ATLAS.w = BAND_ATLAS.cols * BAND_ATLAS.cellW;
BAND_ATLAS.h = BAND_ATLAS.rows * BAND_ATLAS.cellH;
export const BLADE_ATLAS = { cols: 12, rows: 7, cellW: 144, cellH: 576 };
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
// of which CJK face the stack resolves to.
export function drawBandAtlas(ctx) {
  const { cellW, cellH } = BAND_ATLAS;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  TAIPEI_BAND_SIGNS.forEach((sign, i) => {
    const { x, y } = cellOrigin(i, BAND_ATLAS);
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
    const px = Math.min(94, (cellW * 0.86) / nameWidthUnits(sign.name));
    ctx.font = `700 ${px}px ${SIGN_FONT_STACK}`;
    ctx.fillStyle = sign.fg;
    ctx.fillText(sign.name, x + cellW / 2, y + cellH / 2 + 3);
  });
}

// Paint every blade plate: the name stacked top-to-bottom, one
// character per line, centred in the tall cell.
export function drawBladeAtlas(ctx) {
  const { cellW, cellH } = BLADE_ATLAS;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  TAIPEI_BLADE_SIGNS.forEach((sign, i) => {
    const { x, y } = cellOrigin(i, BLADE_ATLAS);
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
    const px = Math.min(cellW * 0.74, (cellH * 0.88) / chars.length);
    ctx.font = `700 ${px}px ${SIGN_FONT_STACK}`;
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
  { name: '7-ELEVEN', latin: null, bg: '#ffffff', fg: '#e4572e', bar: '#009444' },
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
export function drawRoofAtlas(ctx) {
  const { cellW, cellH } = ROOF_ATLAS;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  TAIPEI_ROOF_SIGNS.forEach((sign, i) => {
    const { x, y } = cellOrigin(i, ROOF_ATLAS);
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
    const px = Math.min(120, (cellW * 0.86) / nameWidthUnits(sign.name));
    ctx.font = `700 ${px}px ${SIGN_FONT_STACK}`;
    ctx.fillStyle = sign.fg;
    const nameY = sign.latin ? y + cellH / 2 - 28 : y + cellH / 2 + 3;
    ctx.fillText(sign.name, x + cellW / 2, nameY);
    if (sign.latin) {
      const lpx = Math.min(46, (cellW * 0.86) / nameWidthUnits(sign.latin));
      ctx.font = `700 ${lpx}px ${SIGN_FONT_STACK}`;
      ctx.fillStyle = sign.accent || sign.fg;
      ctx.fillText(sign.latin, x + cellW / 2, y + cellH / 2 + 62);
    }
  });
}

// Paint every tower plate: the brand name stacked top-to-bottom, one
// character per line, centred in the tall cell — the blade idiom, for
// a tall side sign on a tower. Latin-only brands stack their letters.
export function drawTowerAtlas(ctx) {
  const { cellW, cellH } = TOWER_ATLAS;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  TAIPEI_ROOF_SIGNS.forEach((sign, i) => {
    const { x, y } = cellOrigin(i, TOWER_ATLAS);
    ctx.globalAlpha = 1;
    ctx.fillStyle = sign.bg;
    ctx.fillRect(x, y, cellW, cellH);
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = sign.fg;
    ctx.lineWidth = 4;
    ctx.strokeRect(x + 6, y + 6, cellW - 12, cellH - 12);
    ctx.globalAlpha = 1;
    const chars = [...sign.name];
    const px = Math.min(cellW * 0.74, (cellH * 0.88) / chars.length);
    ctx.font = `700 ${px}px ${SIGN_FONT_STACK}`;
    ctx.fillStyle = sign.fg;
    const stepY = px * 1.04;
    let cy = y + cellH / 2 - ((chars.length - 1) * stepY) / 2;
    for (const ch of chars) {
      ctx.fillText(ch, x + cellW / 2, cy);
      cy += stepY;
    }
  });
}
