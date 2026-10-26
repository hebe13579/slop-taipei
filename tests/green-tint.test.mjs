// Issue #141: the #114 green layer gets a GROUND TINT by OSM class.
//
// The layer was planner-only (issue #114): it kept urban lots off
// farmland/wood/wetland, but the ground under it rendered as the
// pale block grey — the Guandu plain read grey from the air where
// the satellite reads green (the user's words: "For guandu area ->
// make the tile green?"). js/taipei-green.js assigns every green
// polygon a satellite-sampled tone (farmland a per-field palette —
// the plain's patchwork is the acceptance read), and
// js/taipei-boot.js draws the layers at GREEN_TINT_Y in the ground
// stack.
//
// These pins: (1) every class in the shipped geodata has an
// explicit sampled tone; (2) the farmland patchwork is real — the
// 245 ha Guandu polygon comes out as many rings in several tones;
// (3) tint coverage equals green coverage (nothing lost, nothing
// double-painted); (4) the Y discipline that keeps water and parks
// winning their measured overlaps; (5) VISUAL-ONLY — the planner's
// lot plan is byte-identical with the tint built, and the tint
// build does not mutate geodata.green.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { planTaipeiBuildings } from '../js/taipei-buildings.js';
import {
  buildGreenTintLayers, GREEN_CLASS_TONES, FARMLAND_TONES,
  GREEN_TINT_Y, FARMLAND_SPLIT_AREA,
} from '../js/taipei-green.js';

const ringArea = (ring) => {
  const n = ring.length / 2;
  let a = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1];
  }
  return Math.abs(a / 2);
};
const green = TAIPEI_GEO.green || [];
const layers = buildGreenTintLayers(green);

test('every green class in the geodata has an explicit tone', () => {
  const classes = [...new Set(green.map((p) => p.cls))].sort();
  assert.ok(classes.length >= 8, `green classes: ${classes.join(', ')}`);
  for (const cls of classes) {
    if (cls === 'landuse:farmland') continue; // farmland wears the palette below
    assert.ok(
      Object.prototype.hasOwnProperty.call(GREEN_CLASS_TONES, cls),
      `${cls} has an explicit entry in GREEN_CLASS_TONES`,
    );
  }
  assert.ok(FARMLAND_TONES.length >= 4, 'farmland palette carries the patchwork spread');
  const all = [...Object.values(GREEN_CLASS_TONES), ...FARMLAND_TONES];
  for (const tone of all) assert.ok(Number.isInteger(tone) && tone >= 0 && tone <= 0xffffff, `tone ${tone} is a hex colour`);
  // The class ordering the satellite samples gave: wood deepest,
  // farmland's mid tone lighter than the park lawn anchor's depth —
  // wood must stay darker (lower luminance) than every farmland tone.
  const lum = (hex) => 0.299 * ((hex >> 16) & 255) + 0.587 * ((hex >> 8) & 255) + 0.114 * (hex & 255);
  for (const tone of FARMLAND_TONES) assert.ok(lum(GREEN_CLASS_TONES['natural:wood']) < lum(tone), 'wood reads deeper than the fields');
});

test('tint coverage equals green coverage — nothing lost, nothing doubled', (t) => {
  const greenArea = green.reduce((s, p) => s + ringArea(p.ring), 0);
  const tintArea = layers.reduce((s, l) => s + l.rings.reduce((a, r) => a + ringArea(r), 0), 0);
  t.diagnostic(`green ${green.length} polys ${(greenArea / 1e6).toFixed(2)} km2 -> tint ${layers.length} tone layers, ${tintArea.toFixed(0)} m2`);
  assert.ok(Math.abs(tintArea - greenArea) / greenArea < 0.02, `tint area ${tintArea.toFixed(0)} vs green ${greenArea.toFixed(0)}`);
  for (const l of layers) for (const ring of l.rings) {
    assert.ok(ring.length >= 6, 'every tint ring is a real polygon');
    for (const v of ring) assert.ok(Number.isFinite(v), 'finite tint geometry');
  }
  // Non-farmland polygons pass through 1:1 (one ring out per ring in).
  const inPlain = green.filter((p) => p.cls !== 'landuse:farmland').length;
  const farmTones = new Set(FARMLAND_TONES);
  const outPlain = layers.filter((l) => !farmTones.has(l.tone)).reduce((s, l) => s + l.rings.length, 0);
  assert.equal(outPlain, inPlain, 'non-farmland rings pass through unchanged in count');
});

test('farmland patchwork: the big Guandu polygon splits into many rings, several tones', () => {
  const big = green.filter((p) => p.cls === 'landuse:farmland' && ringArea(p.ring) > FARMLAND_SPLIT_AREA);
  assert.ok(big.length >= 1, 'the plain has a >8 ha farmland polygon');
  const farmLayers = layers.filter((l) => FARMLAND_TONES.includes(l.tone));
  assert.ok(farmLayers.length >= 3, `farmland renders in ${farmLayers.length} distinct field tones`);
  const farmRings = farmLayers.reduce((s, l) => s + l.rings.length, 0);
  const farmPolys = green.filter((p) => p.cls === 'landuse:farmland').length;
  assert.ok(farmRings > farmPolys * 2, `grid split multiplies farmland rings (${farmRings} rings from ${farmPolys} polys)`);
});

test('Y discipline: above the greys it covers, below water and parks', () => {
  // Ground stack in js/taipei-boot.js: blocks 0.02, podium 0.021,
  // airfield site 0.022, airfield surfaces 0.024, riverside 0.025,
  // water 0.03, parks 0.04. Measured overlaps on this geodata:
  // green x water 1.09 km2 (channels/ponds must stay water),
  // green x parks 1.23 km2 (park tones must stay on top).
  assert.ok(GREEN_TINT_Y > 0.021, 'tint covers the block/podium grey');
  assert.ok(GREEN_TINT_Y < 0.03, 'water still wins the wetland channels');
  assert.ok(GREEN_TINT_Y < 0.04, 'parks still win their interiors');
  assert.ok(GREEN_TINT_Y < 0.025, 'the riverside band keeps its park tone at the banks');
});

test('deterministic: two builds are identical', () => {
  assert.deepEqual(buildGreenTintLayers(green), layers);
});

test('visual-only: planner output byte-identical, geodata.green unmutated', () => {
  const lotsBefore = JSON.stringify(planTaipeiBuildings(TAIPEI_GEO).lots);
  const greenBefore = JSON.stringify(TAIPEI_GEO.green);
  buildGreenTintLayers(TAIPEI_GEO.green);
  assert.equal(JSON.stringify(TAIPEI_GEO.green), greenBefore, 'tint build does not mutate the green layer');
  assert.equal(JSON.stringify(planTaipeiBuildings(TAIPEI_GEO).lots), lotsBefore, 'plan lots byte-identical with the tint built');
});
