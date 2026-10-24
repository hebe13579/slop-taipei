import assert from 'node:assert/strict';
import test from 'node:test';

import { pedestrianLayout } from '../tools/taipei/pedestrian-layout.mjs';

// Issue #16: the painted-walkway classifier. TAIWAN_STREETSCAPE.md §c.3
// puts 標線型人行道 on 8–12 m streets and wider lanes lacking a raised
// sidewalk or arcade; §c.4 makes narrow 巷/弄 fully shared space with no
// pedestrian geometry. The old rule painted any 巷 and anything < 8 m —
// the inverse population, which read as bike lanes in-game.

test('untagged street in the 8–12 m band is painted', () => {
  assert.equal(pedestrianLayout({ highway: 'residential' }, 8), 'painted');
  assert.equal(pedestrianLayout({ highway: 'residential' }, 10), 'painted');
  assert.equal(pedestrianLayout({ highway: 'tertiary' }, 12), 'painted');
});

test('a 巷 at 8 m or wider is painted; below 8 m it is shared', () => {
  assert.equal(pedestrianLayout({ name: '和平東路三段357巷', highway: 'residential' }, 9), 'painted');
  assert.equal(pedestrianLayout({ name: '瑞安街208巷', highway: 'residential' }, 6), 'shared');
});

test('sub-8 m ordinary streets are shared, not painted', () => {
  assert.equal(pedestrianLayout({ highway: 'residential' }, 6), 'shared');
  assert.equal(pedestrianLayout({ highway: 'living_street' }, 7.9), 'shared');
  assert.equal(pedestrianLayout({ highway: 'service' }, 5), 'shared');
});

test('弄 alleys and service alleys are shared at any width', () => {
  assert.equal(pedestrianLayout({ name: '瑞安街208巷24弄', highway: 'residential' }, 5), 'shared');
  assert.equal(pedestrianLayout({ name: '瑞安街208巷24弄', highway: 'residential' }, 10), 'shared');
  assert.equal(pedestrianLayout({ service: 'alley', highway: 'service' }, 10), 'shared');
});

test('an OSM sidewalk tag stays sidewalk at any width', () => {
  assert.equal(pedestrianLayout({ sidewalk: 'yes', highway: 'residential' }, 6), 'sidewalk');
  assert.equal(pedestrianLayout({ sidewalk: 'yes', highway: 'residential' }, 10), 'sidewalk');
  assert.equal(pedestrianLayout({ 'sidewalk:both': 'separate', highway: 'primary' }, 20), 'sidewalk');
  assert.equal(pedestrianLayout({ 'sidewalk:left': 'yes', highway: 'residential' }, 9), 'sidewalk');
});

test('sidewalk=no falls through to the width rules', () => {
  assert.equal(pedestrianLayout({ sidewalk: 'no', highway: 'residential' }, 10), 'painted');
  assert.equal(pedestrianLayout({ sidewalk: 'none', highway: 'residential' }, 6), 'shared');
});

test('arcade tags beat everything', () => {
  assert.equal(pedestrianLayout({ covered: 'colonnade', highway: 'tertiary' }, 11), 'arcade');
  assert.equal(pedestrianLayout({ arcade: 'yes', highway: 'residential' }, 6), 'arcade');
});

test('wider than 12 m without tags falls back to sidewalk', () => {
  assert.equal(pedestrianLayout({ highway: 'secondary' }, 14), 'sidewalk');
  assert.equal(pedestrianLayout({ highway: 'primary' }, 30), 'sidewalk');
});

// Issue #25: painted is never a main-road treatment. An 8–12 m way on a
// trunk/primary/secondary class is a fragment of a wide arterial, not
// an 8–12 m street — it takes the sidewalk fallback, not a green band.
test('main-road classes are never painted, even at 8–12 m', () => {
  for (const highway of ['motorway', 'trunk', 'primary', 'secondary', 'trunk_link', 'primary_link', 'secondary_link']) {
    assert.equal(pedestrianLayout({ highway }, 9.6), 'sidewalk', `${highway} at 9.6 m`);
    assert.equal(pedestrianLayout({ highway }, 12), 'sidewalk', `${highway} at 12 m`);
  }
  // …while the same widths on local classes stay painted.
  assert.equal(pedestrianLayout({ highway: 'tertiary' }, 9.6), 'painted');
  assert.equal(pedestrianLayout({ highway: 'unclassified' }, 10), 'painted');
  assert.equal(pedestrianLayout({ highway: 'residential' }, 12), 'painted');
});

// Data-level pins on the regenerated geodata: the painted population is
// exactly the 8–12 m band. Merged boulevard spans wider than 12 m take
// the boulevard layout even when their widest constituent carriageway
// is 8–12 m (build-generation-map.mjs emission guard), so the band
// check holds for roadbeds as well as per-way roads.
import { TAIPEI_GEO } from '../js/taipei-geodata.js';

test('painted roads and roadbeds in the generated geodata are all 8–12 m', () => {
  const bad = TAIPEI_GEO.roads.filter((r) => r.pedestrianLayout === 'painted' && r.width < 8);
  assert.equal(bad.length, 0, `painted roads under 8 m: ${bad.slice(0, 3).map((r) => `${r.name} ${r.width}`)}`);
  const paintedBeds = TAIPEI_GEO.roadbeds.filter((b) => b.pedestrianLayout === 'painted');
  assert.ok(paintedBeds.length > 0, 'some roadbeds are painted');
  assert.ok(
    paintedBeds.every((b) => b.width >= 8 && b.width <= 12),
    `painted roadbeds outside 8–12 m: ${paintedBeds.filter((b) => b.width < 8 || b.width > 12).slice(0, 3).map((b) => `${b.name} ${b.width}`)}`,
  );
});

// Issue #25 data pin: no painted road or roadbed sits on a main-road
// class — the green band can never be born on a main carriageway.
test('no painted road or roadbed in the geodata is a main-road class', () => {
  const MAIN = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link']);
  const badRoads = TAIPEI_GEO.roads.filter((r) => r.pedestrianLayout === 'painted' && MAIN.has(r.highway));
  assert.equal(badRoads.length, 0, `painted main-class roads: ${badRoads.slice(0, 3).map((r) => `${r.name} ${r.highway}`)}`);
  const badBeds = TAIPEI_GEO.roadbeds.filter((b) => b.pedestrianLayout === 'painted' && MAIN.has(b.highway));
  assert.equal(badBeds.length, 0, `painted main-class roadbeds: ${badBeds.slice(0, 3).map((b) => `${b.name} ${b.highway}`)}`);
});
