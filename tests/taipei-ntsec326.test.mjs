// Issue #326: 科教館 and 天文館 are swapped — identity pins.
//
// PR #322 (#278) built the RING as the planetarium and the DRUM+SLAB
// as the NTSEC, with the anchors swapped and a gold dome. The user's
// 2026-11-06 report + Google 3D screenshots prove it is the other
// way round: the RING is the 科教館 (NTSEC, west, No. 189 Shishang
// Rd) and the planetarium (天文館, east, No. 363 Jihe Rd) is the
// rectangular exhibition block + WHITE dome. The dome is WHITE in
// both screenshots (the gold in #278 came from a stale Esri image).
//
// These pins must FAIL on pristine main (which still has the swapped
// anchors, the C-shaped ring, and the gold dome) and PASS here:
//  - each registry id sits at its true lat/lon (re-measured from
//    Esri z18 satellite via latLonToTile; the measurement log is in
//    ntsec326-evidence/measure326.mjs + anchors326.json). The issue
//    text's "~25.0959, 121.5207" for the planetarium is the #278
//    NTSEC anchor (a beige complex east of the planetarium), NOT the
//    planetarium — the re-measurement governs.
//  - the planetarium is east of the NTSEC (lon 121.51884 > 121.51701).
//  - the big dome is WHITE (0xf4f1ea), not gold (0xc9962e), and no
//    part of either structure uses gold.
//  - the NTSEC ring is a COMPLETE circle: 24 white segments at 15
//    degree intervals (max angular gap one segment, 0.2618 rad) plus
//    a 24-segment glass band at the top rim — no C-shape omission.
//  - the planetarium block is the fitted 85x40 m (the measured
//    diagonal ~93 m matches 85x40 (94 m), not the 95x65 first
//    estimate (115 m — that double-counted the forecourt)).
//  - the NTSEC carries the bar, the atrium NORTH of the ring centre,
//    and the cylindrical tower — the three forms the user's
//    screenshots show.
import assert from 'node:assert/strict';
import test from 'node:test';

import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { planTaipeiBuildings } from '../js/taipei-buildings.js';

function structure(plan, id) {
  const s = plan.landmarkTowers.find((t) => t.id === id);
  assert.ok(s, `${id} missing from the plan`);
  return s;
}

function flatColor(part) {
  return typeof part.flat === 'number' ? part.flat : part.flat?.color;
}

test('issue #326: the planetarium and NTSEC sit at their true lat/lon, planetarium east', () => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  const planetarium = structure(plan, 'taipei-astronomical-museum');
  const ntsec = structure(plan, 'ntsec');
  // Re-measured anchors (Esri z18 via latLonToTile, roundtrip-verified).
  assert.equal(planetarium.lat, 25.09517);
  assert.equal(planetarium.lon, 121.51884);
  assert.equal(ntsec.lat, 25.09506);
  assert.equal(ntsec.lon, 121.51701);
  // The planetarium is EAST of the NTSEC (the swap put them the
  // other way round: the old planetarium anchor lon 121.5169 sat on
  // the NTSEC's grounds and the old NTSEC anchor lon 121.5207 sat on
  // the planetarium's grounds).
  assert.ok(planetarium.lon > ntsec.lon, 'planetarium must be east of the NTSEC');
  assert.ok(planetarium.x > ntsec.x, 'planetarium tile x must be east of the NTSEC');
  // VGH is untouched by the swap fix.
  const vgh = structure(plan, 'taipei-veterans-general-hospital');
  assert.equal(vgh.lat, 25.12009);
  assert.equal(vgh.lon, 121.52020);
});

test('issue #326: the planetarium dome is white, not gold, and no part uses gold', () => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  const planetarium = structure(plan, 'taipei-astronomical-museum');
  const ntsec = structure(plan, 'ntsec');
  // The big dome: 35 m sphere on a 4.5 m drum, WHITE in the user's
  // Google 3D screenshots (both views). The gold (0xc9962e) in #278
  // came from a stale Esri image where the dome still shows yellow.
  const drum = planetarium.parts.find((p) => p.type === 'cylinder' && p.r === 17);
  const dome = planetarium.parts.find((p) => p.type === 'dome' && p.rx === 17.5);
  assert.ok(drum, 'big dome drum missing');
  assert.ok(dome, 'big dome missing');
  assert.equal(flatColor(drum), 0xf4f1ea, 'dome drum must be white');
  assert.equal(flatColor(dome), 0xf4f1ea, 'dome must be white, not gold');
  assert.equal(dome.y0 + dome.h, 22, 'dome tops out at 22 m (4.5 m drum + 17.5 m sphere)');
  // The small white dome beside it.
  const smallDome = planetarium.parts.find((p) => p.type === 'dome' && p.rx === 5);
  assert.ok(smallDome, 'small dome missing');
  assert.equal(flatColor(smallDome), 0xf4f1ea, 'small dome must be white');
  // No gold anywhere in either structure (and none left in the file).
  for (const s of [planetarium, ntsec]) {
    for (const part of s.parts) {
      assert.notEqual(flatColor(part), 0xc9962e, `${s.id} part still uses the #278 gold`);
    }
  }
});

test('issue #326: the NTSEC ring is a complete circle (24 segments, no omission)', () => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  const ntsec = structure(plan, 'ntsec');
  // 24 white ring segments (w=14, h=14, y0=0) + 24 glass band
  // segments (w=14, h=2, y0=14) at the same 15-degree stations.
  // #278 built only 17 of 24 (a C-shape); the real ring is complete.
  const ring = ntsec.parts.filter((p) => p.type === 'box' && p.w === 14 && (p.y0 || 0) === 0);
  const band = ntsec.parts.filter((p) => p.type === 'box' && p.w === 14 && (p.y0 || 0) === 14);
  assert.equal(ring.length, 24, 'the ring must have all 24 white segments');
  assert.equal(band.length, 24, 'the glass band must have all 24 segments');
  assert.equal(ntsec.parts.length, 51, 'NTSEC total: 24 ring + 24 band + bar + atrium + tower');
  for (const segs of [ring, band]) {
    const rots = segs.map((p) => p.rotY).sort((a, b) => a - b);
    assert.equal(new Set(rots).size, 24, 'ring stations must be 24 distinct angles');
    // Max gap between adjacent stations (wrapping around) is one
    // segment (15 deg = 0.2618 rad). A missing segment would leave a
    // gap of two segments (0.5236 rad) — the C-shape defect.
    let maxGap = 0;
    for (let i = 1; i < rots.length; i++) maxGap = Math.max(maxGap, rots[i] - rots[i - 1]);
    maxGap = Math.max(maxGap, rots[0] + 2 * Math.PI - rots[rots.length - 1]);
    assert.ok(maxGap <= 0.2618 + 0.01, `ring has a gap of ${maxGap} rad — not a complete circle`);
  }
});

test('issue #326: the planetarium block is the fitted 85x40 m and the NTSEC carries bar, atrium, tower', () => {
  const plan = planTaipeiBuildings(TAIPEI_GEO);
  const planetarium = structure(plan, 'taipei-astronomical-museum');
  const ntsec = structure(plan, 'ntsec');
  // The block: 85x40 m, long axis NW-SE (rotY +0.62), shifted ~10 m
  // SE (dx+8, dz+6) to clear the Jihe Rd / Meilun St junction.
  assert.equal(planetarium.parts.length, 5, 'planetarium: block + big drum + big dome + small drum + small dome');
  const block = planetarium.parts.find((p) => p.type === 'box');
  assert.ok(block, 'exhibition block missing');
  assert.equal(block.w, 85);
  assert.equal(block.d, 40);
  assert.equal(block.h, 20);
  assert.equal(block.dx, 8);
  assert.equal(block.dz, 6);
  assert.ok(Math.abs(block.rotY - 0.62) < 0.01, 'block long axis must be NW-SE (rotY +0.62)');
  // The NTSEC's three companion forms (all visible in the user's screenshots).
  const bar = ntsec.parts.find((p) => p.type === 'box' && p.w === 149);
  assert.ok(bar, 'bar/slab across the ring missing');
  assert.equal(bar.d, 15);
  assert.equal(bar.h, 14);
  assert.ok(Math.abs(bar.rotY - 0.09) < 0.01, 'bar tilts ~6 deg (rotY +0.09)');
  const atrium = ntsec.parts.find((p) => p.type === 'box' && p.w === 49);
  assert.ok(atrium, 'glass atrium missing');
  assert.ok(atrium.dz < 0, 'atrium must sit NORTH of the ring centre (not SE as #278 placed it)');
  const tower = ntsec.parts.find((p) => p.type === 'cylinder' && p.r === 11);
  assert.ok(tower, 'cylindrical tower missing');
  assert.equal(tower.h, 20);
  assert.ok(tower.dx > 0, 'tower must sit east of the ring centre');
});
