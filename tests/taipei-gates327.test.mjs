// Issue #327: 南門, 小南門, 東門 — the three remaining Taipei city gates,
// reusing the 北門 gate model. Each gate is pinned at its MEASURED
// position (published Wikipedia coordinate, cross-checked against the
// Esri satellite stitch — see gates327-evidence/issue327-refs.md), with
// its own wall-line orientation (NOT 北門's rotY), a passage, a white
// crenellated parapet, a colonnade pavilion and a green glazed-tile roof.
// These tests FAIL on pristine main (no such registry entries) and pass
// here. The plan lots are unchanged (76,209): the three site rects sit
// in road junctions / roundabouts where no procedural lots fall —
// lot-by-lot diff on this tree is 0 of 76,209 (see plan-diff.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { planTaipeiBuildings } from '../js/taipei-buildings.js';
import { TAIPEI_TILE } from '../js/taipei-tile.js';

const plan = planTaipeiBuildings(TAIPEI_GEO);
const byId = new Map(plan.landmarkTowers.map((s) => [s.id, s]));

// Published coordinates (zh-Wikipedia, one per gate), converted by the
// repo's latLonToTile; satellite roof picks agree within 8–17 m.
const expected = {
  // rotY: 南門 0.131 (愛國西路 7.5° S of E); 東門 -1.702 (east wall 7.5° E
  // of S — NOT parallel to modern 中山南路, 15° W of S); 小南門 0.419
  // (愛國西路 24° S of E at the city's bent west end).
  nanmen: { h: 17.4, x: -5053, z: -234.7, rotY: 0.131, nameZh: '南門', parts: 28, greenRoofParts: 4 },
  dongmen: { h: 16.8, x: -4777.5, z: -666.5, rotY: -1.702, nameZh: '東門', parts: 27, greenRoofParts: 3 },
  xiaonanmen: { h: 15.6, x: -5745.1, z: -433.1, rotY: 0.419, nameZh: '小南門', parts: 27, greenRoofParts: 3 },
};

test('issue #327: the three city gates are registered (registry 53 -> 56)', () => {
  assert.equal(plan.landmarkTowers.length, 56, '53 + 3 new gates');
  assert.equal(plan.lots.length, 76209, 'the three junction-island site rects move no lots');
  for (const id of Object.keys(expected)) assert.ok(byId.has(id), `${id} registered`);
});

for (const [id, e] of Object.entries(expected)) {
  test(`issue #327: ${id} sits at its measured position with a passage`, () => {
    const gate = byId.get(id);
    assert.ok(gate, `${id} registered`);
    assert.equal(gate.realHeight, e.h, `${id} carries its estimated height`);
    assert.equal(gate.estimated, true, `${id} height is an estimate (no published figure exists)`);
    assert.ok(Math.abs(gate.x - e.x) <= 1 && Math.abs(gate.z - e.z) <= 1, `${id} at its measured tile position`);
    assert.equal(gate.parts.length, e.parts, `${id} part count`);
    const partTop = (p) => (p.y0 || 0) + p.h;
    assert.ok(Math.abs(Math.max(...gate.parts.map(partTop)) - e.h) < 0.01, `${id} massing tops out at its height`);
    // Every part is a stacked rotated box at the gate's own rotY (the
    // 北門 precedent — ridge/frustum parts cannot rotate).
    for (const p of gate.parts) {
      assert.equal(p.type, 'box', `${id} is stacked rotated boxes only`);
      assert.ok(Math.abs(p.rotY - e.rotY) < 0.001, `${id} every part turns with its wall line`);
    }
    // Two andesite platform blocks flank a 4.5 m arched passage, read
    // as a near-black shadow plug (the 北門 precedent).
    const platform = gate.parts.filter((p) => !p.y0 && p.h === 5.2);
    assert.equal(platform.length, 2, `${id} platform massed as two blocks around the passage`);
    assert.ok(gate.parts.some((p) => p.flat === 0x35302b && p.h === 4.6), `${id} passage carries its shadow plug`);
    const centreDist = Math.hypot(platform[0].dx - platform[1].dx, platform[0].dz - platform[1].dz);
    const passage = centreDist - platform[0].w;
    assert.ok(Math.abs(passage - 4.5) < 0.2, `${id} passage gap is 4.5 m (got ${passage.toFixed(2)})`);
    // The 1966 rebuild's signatures: white crenellated parapet (band +
    // merlons), red-column pavilion over a dark recessed infill, green
    // glazed-tile roof under a gold ridge.
    assert.ok(gate.parts.some((p) => p.flat === 0xe8e4d8 && p.h === 0.9), `${id} has its white parapet band`);
    assert.equal(gate.parts.filter((p) => p.flat === 0xe8e4d8 && p.h === 0.6).length, 10, `${id} parapet carries 10 merlons`);
    assert.ok(gate.parts.some((p) => p.flat === 0x2e2620), `${id} pavilion has its dark recessed infill`);
    assert.equal(gate.parts.filter((p) => p.flat === 0x9e2b25).length, 6, `${id} pavilion has 6 red columns`);
    assert.equal(gate.parts.filter((p) => p.flat === 0x357a58).length, e.greenRoofParts, `${id} green roof tiers (${e.greenRoofParts === 4 ? 'double-eaved' : 'single-eaved'})`);
    assert.ok(gate.parts.some((p) => p.flat === 0xc9962e), `${id} has its gold ridge`);
    // No sign: the real gate's red-and-gold name plaque sits on the
    // 0.9 m parapet band, and the sign system's 10 x 2.5 m floor cannot
    // fit a plaque there — so the plaque is unmodelled (disclosed in
    // the registry comment), and the gate must not gain an unpinned sign.
    assert.equal(gate.sign, null, `${id} carries no sign (plaque unmodelled — see registry comment)`);
    // Open ground around the gate, and a map pin with its Chinese name.
    assert.ok(gate.openGround, `${id} registers its plaza as open ground`);
    const pin = TAIPEI_TILE.landmarks.find((l) => l.id === id);
    assert.ok(pin && pin.nameZh === e.nameZh && pin.height === e.h, `${id} has a map pin with its Chinese name`);
    // No procedural lot intrudes on the gate's site or plaza.
    for (const rect of gate.sites) {
      for (const lot of plan.lots) {
        const hit = lot.x + lot.w / 2 > rect.minX && lot.x - lot.w / 2 < rect.maxX && lot.z + lot.d / 2 > rect.minZ && lot.z - lot.d / 2 < rect.maxZ;
        assert.ok(!hit, `building at ${lot.x},${lot.z} intrudes on the ${id} site`);
      }
    }
  });
}
