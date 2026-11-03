// tests/taipei-roof-boards.test.mjs
// Issue #153: rooftop billboard signs on arterial commercial
// buildings. Pins the planner policy (eligibility, determinism,
// descriptor shape) and the adapter census (counts by kind and by
// district, brand variety) — ranges, not exact pins, so a later plan
// re-cut moves the numbers without breaking the policy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import {
  planTaipeiBuildings,
  taipeiCityBlocksOptions,
  taipeiRoofBoards,
  ROOF_BOARD_MIN_H,
  ROOF_BOARD_TOWER_H,
  ROOF_BOARD_PLATES,
  ROOF_BOARD_STATION_DISTRICT,
} from '../js/taipei-buildings.js';
import { TAIPEI_ROOF_SIGNS } from '../js/taipei-signs.js';

const TAIWAN_COMMERCIAL = [6, 7, 8, 9, 13];
// A primary-avenue frontage (rank 4, road running east-west).
const FRONT_RANK4 = { rank: 4, angle: 0, nx: 0, nz: 1 };
const FRONT_RANK3 = { rank: 3, angle: 0, nx: 0, nz: 1 };

test('roof boards: hard exclusions are never boarded', (t) => {
  const base = { x0: 0, x1: 20, z0: 0, z1: 16, h: 22, mat: 6 };
  assert.deepEqual(taipeiRoofBoards({ ...base, mat: 4 }, FRONT_RANK4), [], 'glass lots never board');
  assert.deepEqual(taipeiRoofBoards({ ...base, mat: 0 }, FRONT_RANK4), [], 'masonry lots never board');
  assert.deepEqual(taipeiRoofBoards({ ...base, mat: 12 }, FRONT_RANK4), [], 'F12 lobby towers never board');
  assert.deepEqual(taipeiRoofBoards({ ...base, h: 14 }, FRONT_RANK4), [], 'lots under 15 m never board');
  assert.deepEqual(taipeiRoofBoards(base, null), [], 'no frontage, no board');
  assert.deepEqual(taipeiRoofBoards(base, { rank: 2, angle: 0, nx: 0, nz: 1 }), [], 'tertiary frontage never boards');
  assert.deepEqual(taipeiRoofBoards(base, { rank: 1, angle: 0, nx: 0, nz: 1 }), [], 'residential lanes never board');
  assert.deepEqual(taipeiRoofBoards(null, FRONT_RANK4), [], 'no lot, no board');
  t.diagnostic('exclusions hold on every non-arterial / non-commercial / short lot');
});

test('roof boards: policy is deterministic per lot + frontage', (t) => {
  const opts = taipeiCityBlocksOptions(TAIPEI_GEO, planTaipeiBuildings(TAIPEI_GEO));
  const boarded = opts.lots.filter((l) => l.roofBoards && l.roofBoards.length);
  assert.ok(boarded.length > 500, `a real city boards hundreds of lots (${boarded.length})`);
  const sample = boarded[0];
  // Re-running the policy on the same rect + a rank-4 east-west
  // frontage is deterministic — but the adapter's own frontage may
  // differ in rank/angle, so determinism is checked with the same
  // fabricated frontage the lot was (re-)evaluated against: the
  // descriptor is a pure function of (rect, front).
  const once = taipeiRoofBoards(sample, FRONT_RANK4);
  const twice = taipeiRoofBoards(sample, FRONT_RANK4);
  assert.deepEqual(once, twice, 'same rect + frontage boards the same way twice');
  assert.ok(sample.roofBoards.length === 1, 'at most one board per lot');
  t.diagnostic(`boarded lots ${boarded.length}/${opts.lots.length}`);
});

test('roof boards: adapter census by kind, plate and district', (t) => {
  const opts = taipeiCityBlocksOptions(TAIPEI_GEO, planTaipeiBuildings(TAIPEI_GEO));
  let roof = 0, tower = 0, station = 0;
  const plates = new Set();
  const inStation = (b) => b.x >= ROOF_BOARD_STATION_DISTRICT.minX && b.x <= ROOF_BOARD_STATION_DISTRICT.maxX
    && b.z >= ROOF_BOARD_STATION_DISTRICT.minZ && b.z <= ROOF_BOARD_STATION_DISTRICT.maxZ;
  for (const r of opts.lots) {
    if (!r.roofBoards) continue;
    assert.ok(TAIWAN_COMMERCIAL.includes(r.mat), `board only on Taiwan commercial lots (mat ${r.mat})`);
    assert.ok(r.h >= ROOF_BOARD_MIN_H, `board only on lots >= ${ROOF_BOARD_MIN_H} m (h ${r.h})`);
    assert.equal(r.roofBoards.length, 1, 'one board per lot');
    for (const b of r.roofBoards) {
      assert.ok(b.kind === 'roof' || b.kind === 'tower', `board kind is roof or tower (${b.kind})`);
      assert.ok(Number.isInteger(b.plate) && b.plate >= 0 && b.plate < ROOF_BOARD_PLATES, `plate in range (${b.plate})`);
      assert.ok(Number.isFinite(b.x) && Number.isFinite(b.z) && Number.isFinite(b.y0) && Number.isFinite(b.ry), 'board placement is finite');
      assert.ok(b.thick > 0 && b.thick <= 0.5, 'board is a thin plate');
      plates.add(b.plate);
      if (b.kind === 'roof') {
        roof++;
        assert.ok(b.w >= 4 && b.w <= 18, `roof board width in the photo range (${b.w})`);
        assert.ok(b.h >= 3.5 && b.h <= 5.5, `roof board height in the photo range (${b.h})`);
        assert.ok(Math.abs(b.y0 - ((r.y || 0) + r.h + 0.4)) < 0.11, 'roof board stands on the roofline');
        assert.ok(b.w <= Math.min((r.x1 - r.x0) * 0.7, 18) + 0.11, 'roof board fits the lot width');
      } else {
        tower++;
        assert.ok(r.h >= ROOF_BOARD_TOWER_H, `tower signs only on lots >= ${ROOF_BOARD_TOWER_H} m (h ${r.h})`);
        assert.ok(b.w >= 3 && b.w <= 4.5, `tower sign width in range (${b.w})`);
        assert.ok(b.h >= 10 && b.h <= 16, `tower sign height in range (${b.h})`);
        assert.ok(Math.abs(b.y0 + b.h - ((r.y || 0) + r.h - 1.5)) < 0.11, 'tower sign top sits just below the roofline');
      }
      if (inStation(b)) station++;
    }
  }
  // Measured on this tree: 610 roof + 34 tower = 644, station 38.
  // Ranges so a later plan re-cut moves the numbers without breaking
  // the policy; the shape (hundreds of roof boards, dozens of tower
  // signs, a dense station district) is what is pinned.
  assert.ok(roof >= 500 && roof <= 750, `roof boards number in the hundreds (${roof})`);
  assert.ok(tower >= 15 && tower <= 60, `tower signs are occasional (${tower})`);
  assert.ok(station >= 25 && station <= 55, `station district is the densest (${station})`);
  assert.equal(plates.size, TAIPEI_ROOF_SIGNS.length, 'every brand plate is used somewhere');
  t.diagnostic(`roof ${roof}, tower ${tower}, station ${station}, plates ${plates.size}/${TAIPEI_ROOF_SIGNS.length}`);
});
