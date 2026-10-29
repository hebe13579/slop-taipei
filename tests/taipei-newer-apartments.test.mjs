// Issue #256: two newer apartment archetypes as procedural facade
// families + massing — the modern white slab (10) and the neoclassical
// stone-clad luxury tower (11). The spawn rule is measured from the
// plan (see apartments256-evidence/measure256*.mjs): tall lots are
// scarce and narrow in the fine-grain plan, so the rule keys on height
// + a minimum narrow side, and the new families take their share from
// the Taiwan tall pool only — the glass accent roll runs first with
// its pre-#256 formula, so glass counts are untouched.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import {
  planTaipeiBuildings,
  taipeiCityBlocksOptions,
  officeCoreFor,
  facadeMatFor,
  newerApartmentKind,
  taipeiNewerApartmentParts,
  taipeiEntranceCanopy,
  taipeiNewerEntrance,
  NEWER_APARTMENT_MIN_DIM,
  NEWER_TOWER_INSET,
  NEWER_CROWN_INSET,
  NEWER_TWIN_GAP,
  NEWER_SLAB_MIN,
  NEWER_CANOPY_Y0,
  NEWER_CANOPY_Y1,
  NEWER_CANOPY_PROUD,
} from '../js/taipei-buildings.js';

function planAndOpts() {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  return { plan, opts: taipeiCityBlocksOptions(TAIPEI_GEO, plan) };
}

test('newer apartments: census pins — both families planted, glass untouched', (t) => {
  const { plan, opts } = planAndOpts();
  assert.equal(plan.lots.length, 68570, 'the rule moves families only — the lot count is the composed plan');
  const fam = {};
  for (const l of opts.lots) fam[l.mat] = (fam[l.mat] || 0) + 1;
  // Pinned at the #256 gate on the composed tree: 485 tall-Taiwan lots
  // convert (267 slab + 218 stone), all from families 6/8/9; family 7
  // (arcade) and the glass families keep their pre-#256 counts exactly.
  assert.equal(fam[10], 267, 'modern slab family planted in the hundreds');
  assert.equal(fam[11], 218, 'neoclassical stone family planted in the hundreds');
  assert.equal(fam[6], 7567, 'tile shophouse gives up its seeded share');
  assert.equal(fam[8], 7504, 'walk-up slab gives up its seeded share');
  assert.equal(fam[9], 5782, 'pebble-dash gives up its seeded share');
  assert.equal(fam[7], 6687, 'arcade family untouched — the rule never consults it');
  assert.equal(fam[3], 5135, 'glass family 3 untouched — the accent roll runs first');
  assert.equal(fam[4], 1068, 'glass family 4 untouched');
  assert.equal(fam[5], 1010, 'glass family 5 untouched');
  t.diagnostic(`families: ${JSON.stringify(fam)}`);
});

test('newer apartments: spawn rule invariants', () => {
  const { plan, opts } = planAndOpts();
  for (let i = 0; i < opts.lots.length; i++) {
    const l = opts.lots[i], p = plan.lots[i];
    if (l.mat !== 10 && l.mat !== 11) continue;
    assert.ok(l.h >= 40, `family ${l.mat} only on 40 m+ lots (lot ${i} at ${l.h} m)`);
    assert.ok(!officeCoreFor(p), `family ${l.mat} never inside an office core (lot ${i})`);
    assert.ok(Math.min(p.w, p.d) >= NEWER_APARTMENT_MIN_DIM, `family ${l.mat} only on lots ${NEWER_APARTMENT_MIN_DIM} m+ across (lot ${i}: ${p.w}x${p.d})`);
    assert.ok(l.newer, `family ${l.mat} lot carries its tower/crown parts (lot ${i})`);
    assert.ok(l.newer.towers.length >= 1 && l.newer.crowns.length === l.newer.towers.length, 'one crown per tower');
  }
  const f11 = opts.lots.filter((l) => l.mat === 11);
  assert.ok(f11.every((l) => l.entrance), 'every stone tower carries its entrance canopy + piers');
  assert.ok(opts.lots.filter((l) => l.mat === 10).every((l) => !l.entrance), 'slabs carry no canopy');
  // Twin slabs are the wide-lot minority: 18 of the 267 slab lots.
  const twins = opts.lots.filter((l) => l.mat === 10 && l.newer.twin);
  assert.equal(twins.length, 18, 'twin-slab complexes planted on the widest lots');
});

test('newer apartments: rule is deterministic and height-banded', () => {
  // The frontage-pull guard probes facadeMatFor at seven heights; the
  // new-type choice must be stable per lot and must not leak below
  // the 40 m band at any probe height the guard uses.
  const probe = (h) => ({ x: -1234.5, z: 6789.1, w: 20, d: 18, h });
  for (const h of [6, 13, 18, 26, 33, 38]) {
    assert.ok(facadeMatFor(probe(h)) !== 10 && facadeMatFor(probe(h)) !== 11, `no new type at ${h} m`);
  }
  assert.equal(facadeMatFor(probe(40)), facadeMatFor(probe(50)), 'same family across the tall band');
  assert.equal(facadeMatFor(probe(50)), facadeMatFor(probe(50)), 'deterministic per lot');
  const narrow = (h) => ({ x: 10, z: 20, w: 12, d: 20, h });
  assert.ok(facadeMatFor(narrow(50)) !== 10 && facadeMatFor(narrow(50)) !== 11, 'narrow lot never converts, even tall');
  // Guard mode (issue #256): the frontage-pull guard judges landings
  // by the pre-#256 family, so #256 moves no lot — guard mode never
  // returns a new type, at any probe height, on a lot that converts.
  for (const h of [6, 13, 18, 26, 33, 38, 50]) {
    const g = facadeMatFor(probe(h), { guard: true });
    assert.ok(g !== 10 && g !== 11, `guard mode never returns a new type at ${h} m`);
    assert.ok(g >= 0 && g <= 9, 'guard mode stays in the pre-#256 families');
  }
});

test('newer apartment parts: single tower geometry', () => {
  const lot = { x0: 0, x1: 20, z0: 0, z1: 18 };
  const parts = taipeiNewerApartmentParts(lot);
  assert.ok(parts && !parts.twin, 'narrow lot gets a single tower');
  assert.equal(parts.towers.length, 1);
  assert.deepEqual(parts.towers[0], {
    x0: NEWER_TOWER_INSET, x1: 20 - NEWER_TOWER_INSET,
    z0: NEWER_TOWER_INSET, z1: 18 - NEWER_TOWER_INSET,
  });
  assert.deepEqual(parts.crowns[0], {
    x0: NEWER_TOWER_INSET + NEWER_CROWN_INSET, x1: 20 - NEWER_TOWER_INSET - NEWER_CROWN_INSET,
    z0: NEWER_TOWER_INSET + NEWER_CROWN_INSET, z1: 18 - NEWER_TOWER_INSET - NEWER_CROWN_INSET,
  });
  for (const r of [...parts.towers, ...parts.crowns]) {
    assert.ok(r.x0 >= lot.x0 && r.x1 <= lot.x1 && r.z0 >= lot.z0 && r.z1 <= lot.z1, 'parts stay inside the lot rect');
    assert.ok(r.x1 - r.x0 >= 0.5 && r.z1 - r.z0 >= 0.5, 'parts survive the mass() minimum-size skip');
  }
});

test('newer apartment parts: twin slabs split along the long axis', () => {
  const lotX = { x0: 0, x1: 34, z0: 0, z1: 20 };
  const px = taipeiNewerApartmentParts(lotX);
  assert.ok(px.twin && px.towers.length === 2, 'wide lot splits along x');
  const gapX = px.towers[1].x0 - px.towers[0].x1;
  assert.ok(Math.abs(gapX - NEWER_TWIN_GAP) < 1e-9, `twin gap is ${NEWER_TWIN_GAP} m`);
  const slabW = px.towers[0].x1 - px.towers[0].x0;
  assert.ok(slabW >= NEWER_SLAB_MIN, `each slab is an honest tower (${slabW.toFixed(1)} m)`);
  assert.ok(Math.abs(slabW - (px.towers[1].x1 - px.towers[1].x0)) < 1e-9, 'slabs are equal');
  assert.ok(px.towers[0].x0 >= lotX.x0 && px.towers[1].x1 <= lotX.x1, 'slabs stay inside the lot');
  assert.equal(px.crowns.length, 2, 'one crown per slab');

  const lotZ = { x0: 0, x1: 20, z0: 0, z1: 34 };
  const pz = taipeiNewerApartmentParts(lotZ);
  assert.ok(pz.twin && pz.towers.length === 2, 'long lot splits along z');
  assert.ok(Math.abs((pz.towers[1].z0 - pz.towers[0].z1) - NEWER_TWIN_GAP) < 1e-9, 'twin gap along z');

  // A lot whose long side is long but narrow side is under the rule
  // minimum gets no parts (defensive: facadeMatFor gates it anyway).
  assert.equal(taipeiNewerApartmentParts({ x0: 0, x1: 40, z0: 0, z1: 10 }), null, 'too-narrow lot gets no parts');
});

test('newer apartment entrance: canopy + piers per face, face picked by length', () => {
  const lot = { x0: 0, x1: 24, z0: 0, z1: 16 };
  const s = taipeiEntranceCanopy(lot, 's');
  assert.ok(s, 'south canopy exists');
  assert.equal(s.canopy.y0, NEWER_CANOPY_Y0, 'canopy caps the ground floor');
  assert.equal(s.canopy.y1, NEWER_CANOPY_Y1);
  assert.ok(Math.abs(s.canopy.z1 - (lot.z1 + NEWER_CANOPY_PROUD)) < 1e-9, 'fascia stands 0.05 m proud of the face');
  assert.equal(s.piers.length, 2, 'two flanking piers');
  for (const p of s.piers) {
    assert.equal(p.y0, 0, 'piers run from the ground');
    assert.equal(p.y1, NEWER_CANOPY_Y0, 'piers meet the canopy underside');
    assert.ok(p.x0 >= lot.x0 - NEWER_CANOPY_PROUD - 1e-9 && p.x1 <= lot.x1 + NEWER_CANOPY_PROUD + 1e-9, 'piers stay within the face + fascia plane');
  }
  const e = taipeiEntranceCanopy(lot, 'e');
  assert.ok(Math.abs(e.canopy.x1 - (lot.x1 + NEWER_CANOPY_PROUD)) < 1e-9, 'east fascia proud of the east face');
  const n = taipeiEntranceCanopy(lot, 'n');
  assert.ok(Math.abs(n.canopy.z0 - (lot.z0 - NEWER_CANOPY_PROUD)) < 1e-9, 'north fascia proud of the north face');
  const w = taipeiEntranceCanopy(lot, 'w');
  assert.ok(Math.abs(w.canopy.x0 - (lot.x0 - NEWER_CANOPY_PROUD)) < 1e-9, 'west fascia proud of the west face');

  // Face pick: longest face wins, ties prefer south.
  assert.equal(taipeiNewerEntrance(lot).canopy.z1, s.canopy.z1, 'wider lot takes the south face');
  const tall = { x0: 0, x1: 16, z0: 0, z1: 24 };
  assert.equal(taipeiNewerEntrance(tall).canopy.x1, taipeiEntranceCanopy(tall, 'e').canopy.x1, 'taller lot takes the east face');
  const square = { x0: 0, x1: 20, z0: 0, z1: 20 };
  assert.equal(taipeiNewerEntrance(square).canopy.z1, taipeiEntranceCanopy(square, 's').canopy.z1, 'square lot prefers south');
  // A face shorter than ~3.3 m is too short for a canopy (cw < 2 m).
  assert.equal(taipeiEntranceCanopy({ x0: 0, x1: 3, z0: 0, z1: 20 }, 's'), null, 'no canopy on a sliver face');
});

test('newer apartments: every part stays within the cleared lot (no roadbed reach)', () => {
  const { opts } = planAndOpts();
  for (const l of opts.lots) {
    if (!l.newer) continue;
    const rects = [...l.newer.towers, ...l.newer.crowns];
    for (const r of rects) {
      assert.ok(r.x0 >= l.x0 - 1e-9 && r.x1 <= l.x1 + 1e-9 && r.z0 >= l.z0 - 1e-9 && r.z1 <= l.z1 + 1e-9,
        'tower/crown parts never leave the lot rect the exclusion gauntlet cleared');
    }
    if (l.entrance) {
      const c = l.entrance.canopy;
      assert.ok(c.x0 >= l.x0 - NEWER_CANOPY_PROUD - 1e-9 && c.x1 <= l.x1 + NEWER_CANOPY_PROUD + 1e-9 &&
        c.z0 >= l.z0 - NEWER_CANOPY_PROUD - 1e-9 && c.z1 <= l.z1 + NEWER_CANOPY_PROUD + 1e-9,
        'canopy overhang is the 0.05 m fascia only');
    }
  }
});
