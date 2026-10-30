// Issue #246 enforcement: the park sports section (playgrounds,
// basketball/tennis courts, picnic tables, 涼亭 pavilions) is
// derived from the OSM park-sports extract — never a hand list —
// and its rects are exactly the pads the amenity planner clears.
//
// The census (issue #246, posted before the build): 1,604 candidate
// features in the tile, 524 inside a park ring (107 playgrounds,
// 182 pitches of which 107 are basketball/tennis, 212 shelters,
// 18 picnic). The derive step (tools/taipei/build-park-sports.mjs)
// maps them to fixed kit pads, skips other sports, bus-stop
// shelters and oversize roofs, and dedupes double-mapped
// features. This audit pins (a) the shipped section re-derives
// exactly from the shipped extract; (b) the mapping rules on
// synthetic data; (c) every shipped entry sits inside its named
// park; (d) the rotation convention matches the renderer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { deriveParkSports } from '../tools/taipei/build-park-sports.mjs';
import { pointInRing } from '../js/taipei-streetscape.js';

// The builder's tangent-plane conversion, mirrored (the bridges
// test pins the same pair of converters equal).
const [LAT0, LON0] = TAIPEI_GEO.frame.originLatLon;
const A = 6378137.0, E2 = 6.69437999014e-3;
const PHI0 = (LAT0 * Math.PI) / 180, SIN0 = Math.sin(PHI0);
const NRAD = A / Math.sqrt(1 - E2 * SIN0 * SIN0);
const MRAD = (A * (1 - E2)) / Math.pow(1 - E2 * SIN0 * SIN0, 1.5);
const KX = (Math.PI / 180) * NRAD * Math.cos(PHI0);
const KY = (Math.PI / 180) * MRAD;
const toWorld = (lon, lat) => [(lon - LON0) * KX, -(lat - LAT0) * KY];

const sports = TAIPEI_GEO.parkSports || [];

function deriveShipped() {
  const elements = JSON.parse(fs.readFileSync(new URL('../tools/taipei/data/osm_park_sports.json', import.meta.url), 'utf8')).elements;
  return deriveParkSports(elements, TAIPEI_GEO.parks, toWorld);
}

test('the shipped section re-derives exactly from the park-sports extract', () => {
  const derived = deriveShipped();
  assert.deepEqual(sports, derived.entries, 'geodata.parkSports == deriveParkSports(osm_park_sports.json)');
  assert.equal(derived.stats.seen, 1788, 'OSM candidate features emitted by the extract (the 0.004 deg margin band around the tile is included; the inside-a-park test below drops them — the pre-build census counted 1,604 strictly in-tile)');
});

test('mapping rules on synthetic data', () => {
  const toLonLat = (x, z) => [LON0 + x / KX, LAT0 - z / KY];
  const g = (pts) => pts.map(([x, z]) => { const [lon, lat] = toLonLat(x, z); return { lat, lon }; });
  const nodeAt = (x, z, tags) => {
    const [lon, lat] = toLonLat(x, z);
    return { type: 'node', id: 1000 + Math.round(x) * 10 + Math.round(z), tags, lat, lon };
  };
  const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]];
  const parks = [
    { name: 'Test Park', ring: [0, 0, 100, 0, 100, 100, 0, 100, 0, 0] },
    { name: 'Test廣場', ring: [200, 0, 300, 0, 300, 100, 200, 100, 200, 0] },
  ];
  const elements = [
    { type: 'way', id: 1, tags: { leisure: 'pitch', sport: 'basketball' }, geometry: g(rect(20, 20, 50, 36)) },
    { type: 'way', id: 2, tags: { leisure: 'pitch', sport: 'tennis' }, geometry: g(rect(60, 20, 88, 34)) },
    { type: 'way', id: 3, tags: { leisure: 'pitch', sport: 'baseball' }, geometry: g(rect(20, 60, 70, 90)) },
    { type: 'way', id: 4, tags: { sport: 'basketball' }, geometry: g(rect(20, 60, 35, 72)) },
    nodeAt(30, 70, { leisure: 'playground' }),
    { type: 'way', id: 5, tags: { leisure: 'playground' }, geometry: g(rect(26, 66, 36, 76)) },
    nodeAt(80, 80, { amenity: 'shelter', shelter_type: 'public_transport' }),
    { type: 'way', id: 7, tags: { amenity: 'shelter', building: 'roof' }, geometry: g(rect(70, 60, 76, 66)) },
    { type: 'way', id: 8, tags: { amenity: 'shelter', building: 'roof' }, geometry: g(rect(10, 10, 30, 30)) },
    { type: 'way', id: 9, tags: { leisure: 'playground' }, geometry: g(rect(220, 20, 240, 40)) },
    { type: 'way', id: 10, tags: { leisure: 'pitch', sport: 'basketball' }, geometry: g(rect(150, 150, 180, 166)) },
    { type: 'way', id: 11, tags: { leisure: 'pitch', sport: 'basketball' }, geometry: g(rect(10, 10, 75, 30)) },
    nodeAt(50, 50, { leisure: 'picnic_table' }),
  ];
  const { entries, stats } = deriveParkSports(elements, parks, toWorld);
  const bySrc = Object.fromEntries(entries.map((e) => [e.src, e]));
  // Courts: basketball + tennis kept at standard pad dims; a bare
  // sport tag is a court too; baseball is skipped.
  assert.equal(bySrc['way:1'].kind, 'court');
  assert.equal(bySrc['way:1'].sport, 'basketball');
  assert.deepEqual([bySrc['way:1'].w, bySrc['way:1'].d], [30, 17]);
  assert.equal(bySrc['way:2'].sport, 'tennis');
  assert.deepEqual([bySrc['way:2'].w, bySrc['way:2'].d], [28, 14]);
  assert.equal(bySrc['way:4'].kind, 'court', 'bare sport=basketball is a court');
  assert.ok(!bySrc['way:3'], 'baseball pitch skipped');
  // Playground: node + way double-map dedupes to the way, fixed pad.
  assert.equal(bySrc['way:5'].kind, 'playground');
  assert.deepEqual([bySrc['way:5'].w, bySrc['way:5'].d], [14, 11]);
  assert.ok(!entries.some((e) => e.src.startsWith('node:') && e.kind === 'playground'), 'node playground deduped');
  // Shelters: bus-stop roofs and oversize roofs skipped, a real
  // 6x6 shelter maps to the fixed pavilion pad.
  assert.ok(!entries.some((e) => e.kind === 'pavilion' && e.x === 80), 'public_transport shelter excluded');
  assert.ok(!bySrc['way:8'], '400 m2 roof skipped as oversize');
  assert.deepEqual([bySrc['way:7'].w, bySrc['way:7'].d], [8, 8]);
  // Plaza + outside skipped; the multi-court slab splits in two.
  assert.ok(!bySrc['way:9'], 'playground in a 廣場 skipped');
  assert.ok(!bySrc['way:10'], 'court outside every park skipped');
  const split = entries.filter((e) => e.src === 'way:11');
  assert.equal(split.length, 2, 'multi-court slab splits into two pads');
  assert.ok(Math.abs(split[0].x - split[1].x) > 5 || Math.abs(split[0].z - split[1].z) > 5, 'split pads offset along the axis');
  // Picnic node maps to one table.
  assert.ok(entries.some((e) => e.kind === 'picnic'), 'picnic table mapped');
  assert.equal(stats.skipped.unclassified, 1, 'only the baseball pitch is unclassified');
  assert.equal(stats.skipped.shelterExcluded, 1);
  assert.equal(stats.skipped.oversize, 1);
  assert.equal(stats.skipped.plaza, 1);
  assert.equal(stats.skipped.outside, 1);
  assert.equal(stats.skipped.dedupe, 1);
  assert.equal(stats.splitSlabs, 1);
  // Rotation convention: the axis-aligned basketball way reads
  // rot 0 with its long axis on local +X.
  assert.equal(bySrc['way:1'].rot, 0, 'axis-aligned rect has rot 0');
});

test('every shipped entry sits inside its named park, dims are kit sizes', () => {
  const ringsByName = new Map();
  for (const p of TAIPEI_GEO.parks) {
    if (!ringsByName.has(p.name)) ringsByName.set(p.name, []);
    ringsByName.get(p.name).push(p.ring);
  }
  assert.ok(sports.length > 100, `section is populated (${sports.length})`);
  for (const e of sports) {
    const rings = ringsByName.get(e.park);
    assert.ok(rings, `entry park ${e.park} exists in geodata (${e.src})`);
    assert.ok(rings.some((r) => pointInRing(e.x, e.z, r)), `entry centroid inside ${e.park} (${e.src})`);
    assert.ok(!e.park.includes('廣場'), `no plaza entries (${e.src})`);
    if (e.kind === 'playground') assert.deepEqual([e.w, e.d], [14, 11], 'fixed playground pad');
    if (e.kind === 'pavilion') assert.deepEqual([e.w, e.d], [8, 8], 'fixed pavilion pad');
    if (e.kind === 'court') {
      assert.ok(e.sport === 'basketball' || e.sport === 'tennis', `court sport is basketball/tennis (${e.src})`);
      assert.deepEqual([e.w, e.d], e.sport === 'basketball' ? [30, 17] : [28, 14], 'standard court pad');
    }
    if (e.kind === 'picnic') assert.deepEqual([e.w, e.d], [2.4, 1.8], 'fixed picnic probe');
    assert.ok(Number.isFinite(e.rot), 'rotation is finite');
  }
  // No two entries of the same kind share a centroid (dedupe held).
  const seen = new Set();
  for (const e of sports) {
    const k = `${e.kind}|${e.x},${e.z}`;
    assert.ok(!seen.has(k), `no duplicate ${k}`);
    seen.add(k);
  }
});
