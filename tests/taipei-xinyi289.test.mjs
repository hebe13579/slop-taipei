// Issue #289 enforcement: Xinyi batch 3 — Nan Shan A21 Green Ring Tower,
// Cathay Financial Center, Walsin Lihwa Building, Vie Show Cinemas Xinyi
// — plus the two public spaces (Taipei Civic Plaza, Songshou Plaza Park).
//
// The registry facts are pinned from the reference pack
// (xinyi289-evidence/): OSM way outlines, the Esri z19 stitch, the
// archasia A21 render, the Cathay entrance photo, the Walsin photo, and
// the char.tw VieShow article. Heights flagged `estimated` stay
// estimated — the pins below assert the flag, not false precision.
// The Civic Plaza was already registered (City Hall's `plaza`
// exclusion); the Songshou park was already a geodata park polygon but
// rendered as paved plaza under the #29 name rule — #289 exempts it
// (it is a lawn park with big trees, not a paved square).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { planTaipeiBuildings } from '../js/taipei-buildings.js';
import { planParkTrees } from '../js/taipei-streetscape.js';
import { isPlazaPark } from '../js/taipei-surfaces.js';

const plan = planTaipeiBuildings(TAIPEI_GEO);
const byId = new Map(plan.landmarkTowers.map((s) => [s.id, s]));

const partTop = (p) => (p.y0 || 0) + p.h;

test('the four #289 structures are registered with the reference-pack facts', () => {
  const a21 = byId.get('nan-shan-xinyi-a21');
  assert.ok(a21, 'Nan Shan A21 registered');
  assert.equal(a21.realHeight, 232.7, 'published 232.7 m (EN Wikipedia 232.6 m)');
  assert.equal(a21.estimated, false, 'published height, not estimated');
  assert.equal(a21.facade.kind, 'curtain', 'cylindrical glass tower');
  assert.equal(Math.max(...a21.parts.map(partTop)), 232.7, 'green disc roof top = published height');
  assert.ok(a21.parts.some((p) => p.type === 'cylinder' && p.r === 28 && p.y0 === 140 && p.dz === 5),
    'ring-shaped platform band at ~62% height (shifted 5 m south of the pin so it clears the Songshou Rd roadbed)');
  assert.ok(a21.parts.some((p) => p.type === 'cylinder' && p.r === 11 && p.dx === -10 && p.dz === 47),
    'circular annex at the south foot');
  assert.ok(a21.farParts && a21.farParts.length === 5, 'far version keeps shaft + band + disc + annex');

  const cathay = byId.get('cathay-financial-center');
  assert.ok(cathay, 'Cathay Financial Center registered');
  assert.equal(cathay.realHeight, 105, '26 storeys, completed 2002');
  assert.equal(cathay.estimated, false, 'published height, not estimated');
  assert.equal(cathay.facade.kind, 'curtain', 'dark bronze-green glass');
  assert.equal(Math.max(...cathay.parts.map(partTop)), 105, 'dome top = published height');
  assert.ok(cathay.parts.some((p) => p.type === 'dome' && p.rx === 12 && p.rz === 12),
    'octagonal dome at the north end of the roof');
  assert.ok(cathay.parts.some((p) => p.type === 'box' && p.w === 4 && p.dx === -34),
    'curved entrance canopy proud of the west (Songren Rd) face');
  assert.ok(cathay.farParts && cathay.farParts.length === 4, 'far version keeps tower + dome + podium steps');

  const walsin = byId.get('walsin-lihwa-building');
  assert.ok(walsin, 'Walsin Lihwa Building registered');
  assert.equal(walsin.realHeight, 134.6, '27 floors, completed 2009 (EIA 125.66 m superseded)');
  assert.equal(walsin.estimated, false, 'published height, not estimated');
  assert.equal(walsin.facade.kind, 'curtain', 'dark glass curtain tower');
  assert.equal(Math.max(...walsin.parts.map(partTop)), 134.6, 'dark cap top = published height');
  assert.equal(walsin.parts.filter((p) => p.type === 'box' && p.h === 0.4).length, 3,
    'three pale band courses = the strong horizontal banding');
  assert.ok(walsin.parts.some((p) => p.type === 'box' && p.w === 49 && p.d === 57 && p.h === 10),
    'pale stone-clad podium base');
  assert.ok(walsin.farParts && walsin.farParts.length === 4, 'far version keeps podium + shaft + crown step + cap');

  const vieshow = byId.get('vieshow-cinemas-xinyi');
  assert.ok(vieshow, 'Vie Show Cinemas registered');
  assert.equal(vieshow.realHeight, 20, 'west block, 3 floors');
  assert.equal(vieshow.estimated, true, 'heights estimated (5+6+9 / 5+9), flagged');
  assert.ok(vieshow.sign && vieshow.sign.text === 'VIESHOW', 'the big movie-advertisement board');
  assert.equal(vieshow.sign.w, 24, 'marquee board is 24 m wide');
  assert.equal(vieshow.sign.h, 7, 'marquee board is 7 m tall');
  assert.ok(vieshow.parts.some((p) => p.type === 'box' && p.w === 36 && p.d === 92 && p.h === 20),
    'west (A16) block, 3 floors');
  assert.ok(vieshow.parts.some((p) => p.type === 'box' && p.w === 46 && p.d === 83 && p.h === 14),
    'east (A17) block, 2 floors');
  assert.ok(vieshow.parts.some((p) => p.type === 'box' && p.w === 20 && p.d === 5 && p.y0 === 7),
    '2F skybridge across the courtyard');
  assert.ok(vieshow.parts.every((p) => p.type !== 'box' || p.flat === undefined || [0xa82318, 0x8c1d14, 0x1e1a14, 0xf5e6c8].includes(p.flat.color ?? p.flat)),
    'red masses + dark shopfront + poster board, no other colours');
  assert.ok(vieshow.farParts && vieshow.farParts.length === 3, 'far version keeps both blocks + skybridge');

  // 43 (post-#265) + 4 new structures = 47. The two plazas add no
  // structures: the Civic Plaza was already City Hall's `plaza`
  // exclusion, and Songshou was already a geodata park polygon.
  // Issue #258: 47 -> 49 — the south expansion adds 2 net entries (NTU main campus, NTNU Heping campus).
  // Issue #273: 49 -> 50 — the Expo Dome adds 1 net entry (爭艷館).
  // Issue #278: 50 -> 53 — the planetarium, NTSEC and VGH add 3 net entries.
  assert.equal(plan.landmarkTowers.length, 53, '43 + 4 new structures');
});

test('plan census: four new sites displace only their own lots', () => {
  // 68,538 (post-#265) -> 68,482: the four new sites remove 56 lots
  // net. Per-site, counted by body-overlap with the resolved site
  // rects (the planner drops a lot when its axis footprint overlaps
  // the rect, not only when its centre is inside — see the
  // attribution in xinyi289-evidence/attribute-lots.mjs): A21 9
  // (4 centre-in + 5 body-only, the tall row just south of the site),
  // Cathay 20 (18 + 2), Walsin 14 (12 + 2), VieShow 13 (13 + 0).
  // The two plazas exclude none (both were already lot-free).
  // Second-order: 9 further lots keep their x/z but change height —
  // the #128 field blend re-mixes their 100 m neighbourhood median
  // once the displaced real lots leave it (e.g. the two lots east of
  // Cathay drop 38 -> 17 and 36 -> 13 when the 92 m / 105 m real lots
  // beside them are removed). That is the documented tier-4 blend,
  // not a re-pin: the full-field diff (lots-old.json vs lots-new.json)
  // shows zero lots added at a new x/z and zero removals outside the
  // four rects + those 9 re-seats.
  // Issue #110: plan 68,482 -> 68,472 — 23 bridge links re-admitted + 71 bed-end fusions re-seat 1,282 lots near the changed roadbeds (net -10).
  // Issue #258: plan 68,472 -> 76,367 (+7,895) — the south expansion (see the schools test for the full lot-diff decomposition).
  // Issue #278: plan 76,367 -> 76,209 (-158 net) — the 3 new registry sites exclude 160 lots (153 by body-overlap in the rects, 5 edge drops just outside them, 2 re-seats net 0) and add 2 re-seats; 84 lots change height via the #128 field blend, all within 100 m of a rect (lot-by-lot diff on this tree).
  assert.equal(plan.lots.length, 76209, 'lot count re-pinned for the four new sites');
});

test('Civic Plaza: already registered, already lot-free, still paved', () => {
  const hall = byId.get('taipei-city-hall');
  assert.ok(hall, 'Taipei City Hall registered');
  assert.ok(hall.openGround, 'Civic Plaza is City Hall\u2019s plaza exclusion (resolved as openGround)');
  assert.equal(hall.openGround.minX, -298, 'plaza exclusion west edge');
  assert.equal(hall.openGround.maxX, -202, 'plaza exclusion east edge');
  assert.equal(hall.openGround.minZ, -538, 'plaza exclusion north edge');
  assert.equal(hall.openGround.maxZ, -504, 'plaza exclusion south edge');
  const plaza = TAIPEI_GEO.parks.find((p) => p.name === '台北市民廣場');
  assert.ok(plaza, 'Civic Plaza is a geodata park polygon');
  assert.ok(isPlazaPark(plaza), 'the real Civic Plaza is paved ceremonial stone, not lawn');
  // The OSM park polygon is a 343 m strip along 市府路's west side;
  // the ceremonial ground is only its middle (the registry rect).
  // The strip's northern tail carries 10 lots (x −296/−277, z −549
  // to −648) — park polygons are a ground tint, not a lot exclusion,
  // so only the registry rect is lot-free.
  assert.equal(plan.lots.filter((l) => l.x >= -298 && l.x <= -202 && l.z >= -538 && l.z <= -504).length, 0,
    'no lots inside the Civic Plaza (registry rect)');
});

test('Songshou Plaza Park: a lawn park, not a paved square', () => {
  const park = TAIPEI_GEO.parks.find((p) => p.name === '松壽廣場');
  assert.ok(park, 'Songshou Plaza Park is a geodata park polygon');
  // Issue #289: the #29 name rule treated every 廣場-named polygon as
  // paved — but this one is a lawn park with big trees (satellite:
  // dense canopy across the whole polygon), so it is exempted and
  // renders as lawn with park trees like any other park.
  assert.equal(isPlazaPark(park), false, '松壽廣場 is exempted from the plaza classification');
  const trees = planParkTrees(TAIPEI_GEO, plan).trees;
  const inside = trees.filter((t) => t.x >= 79 && t.x <= 151 && t.z >= -539 && t.z <= -452);
  assert.ok(inside.length > 0, `Songshou park takes park trees (got ${inside.length})`);
});
