// Issue #253: deck-top road markings — white dashed lane dividers
// + solid white edge lines on the deck asphalt, following the deck
// profile (slab, low bed, drape lift). Pins the paint pattern (the
// ground divider constants, shared so the two paints never drift),
// the grade-following heights, the merge-mouth suppression, the
// real-digest census, and that the existing deck sinks are
// byte-identical to before markings (triCount 46004).
import assert from 'node:assert/strict';
import test from 'node:test';
import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { buildDeckGeometry, DECK_MARK_LIFT, ASPHALT_LIFT, LOW_BED_H } from '../js/taipei-viaduct.js';
import { DASH_LEN, DASH_GAP, DIVIDER_W } from '../js/taipei-markings.js';

const elev = TAIPEI_GEO.elevatedRoads;

// Quads of one sink as [cx, cy, cz, minY, maxY, minX, maxX, minZ, maxZ]
// per quad (6 vertices each).
function quadsOf(positions) {
  const out = [];
  for (let q = 0; q + 17 < positions.length; q += 18) {
    let cx = 0, cy = 0, cz = 0, minY = Infinity, maxY = -Infinity;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let v = 0; v < 6; v++) {
      const x = positions[q + v * 3], y = positions[q + v * 3 + 1], z = positions[q + v * 3 + 2];
      cx += x; cy += y; cz += z;
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    out.push({ cx: cx / 6, cy: cy / 6, cz: cz / 6, minY, maxY, minX, maxX, minZ, maxZ });
  }
  return out;
}

test('deck markings: straight 2-lane deck gets dashes + edge lines at deck height', () => {
  // 30 m east-running deck, w 7.6 (2 lanes), flat h 9.
  const geo = buildDeckGeometry({
    deckDepth: 1.8, piers: [],
    lines: [{ width: 7.6, pts: [0, 0, 30, 0], h: [9, 9] }],
  });
  // The markings are a separate sink: the existing triCount does
  // not move (slab 22 + 2 end caps x 2 = 26).
  assert.equal(geo.triCount, 26);
  const s = geo.deckMarkingStats;
  assert.deepEqual(s, { lines: 1, linesWithDashes: 1, dashQuads: 4, dashKm: 0.012, edgeQuads: 2, edgeKm: 0.06, suppressedDashes: 0 });
  const qs = quadsOf(geo.deckMarkings.positions);
  assert.equal(qs.length, 6);
  // Every marking vertex sits on the paint surface: slab top +
  // asphalt lift + marking lift, flat (9.042), facing up.
  for (const q of qs) {
    assert.ok(Math.abs(q.minY - 9.042) < 1e-6 && Math.abs(q.maxY - 9.042) < 1e-6, `marking y ${q.minY}`);
    assert.ok(Math.abs(q.cy - 9.042) < 1e-6);
  }
  for (let i = 1; i < geo.deckMarkings.normals.length; i += 3) {
    assert.ok(Math.abs(geo.deckMarkings.normals[i] - 1) < 1e-6, 'marking normals face +y');
  }
  // The divider (one boundary, off 0) paints the ground phase:
  // 3 m dashes on a 7.5 m cycle from the line start.
  const divider = qs.filter((q) => Math.abs(q.cz) < 0.1);
  assert.equal(divider.length, 4, 'one quad per dash');
  const spans = divider.map((q) => [q.minX, q.maxX]).sort((a, b) => a[0] - b[0]);
  assert.deepEqual(spans, [[0, 3], [7.5, 10.5], [15, 18], [22.5, 25.5]]);
  for (const q of divider) {
    assert.ok(Math.abs(q.minZ + DIVIDER_W / 2) < 1e-6 && Math.abs(q.maxZ - DIVIDER_W / 2) < 1e-6, 'divider 0.15 m wide');
  }
  // Edge lines: solid, 0.15 m wide, centred 0.15 m inside the
  // asphalt edge (inner 3.55 -> centres at +/-3.4), full length.
  const edges = qs.filter((q) => Math.abs(q.cz) > 3);
  assert.equal(edges.length, 2);
  for (const q of edges) {
    assert.ok(Math.abs(q.minX) < 1e-6 && Math.abs(q.maxX - 30) < 1e-6, 'edge line runs the full segment');
    assert.ok(Math.abs(Math.abs(q.cz) - 3.4) < 1e-6, 'edge centre 0.15 m inside the asphalt edge');
    assert.ok(Math.abs((q.maxZ - q.minZ) - 0.15) < 1e-6, 'edge line 0.15 m wide');
  }
  // The dash phase is the shared ground pattern, not a local copy.
  assert.equal(DASH_LEN, 3);
  assert.equal(DASH_GAP, 4.5);
});

test('deck markings: paint follows the ramp grade and the low bed', () => {
  // Ramp 0 -> 9 m over 100 m: every marking vertex lies on the
  // grade line (0.09 per m) plus the asphalt + marking lifts.
  const ramp = buildDeckGeometry({
    deckDepth: 1.8, piers: [],
    lines: [{ width: 7.6, pts: [0, 0, 100, 0], h: [0, 9] }],
  });
  assert.equal(ramp.deckMarkingStats.dashQuads, 14);
  assert.equal(ramp.deckMarkingStats.edgeQuads, 2);
  const rp = ramp.deckMarkings.positions;
  for (let i = 0; i < rp.length; i += 3) {
    const x = rp[i], y = rp[i + 1];
    assert.ok(Math.abs(y - (0.09 * x + ASPHALT_LIFT + DECK_MARK_LIFT)) < 1e-5, `ramp marking y ${y} at x ${x}`);
  }
  // Low bed: the ramp foot's pavement, markings at 0.25 + 0.03 + 0.012.
  const low = buildDeckGeometry({
    deckDepth: 1.8, piers: [],
    lines: [{ width: 7.6, pts: [0, 0, 20, 0], h: [0, 0] }],
  });
  assert.equal(low.deckMarkingStats.dashQuads, 3);
  assert.equal(low.deckMarkingStats.edgeQuads, 2);
  const lp = low.deckMarkings.positions;
  for (let i = 1; i < lp.length; i += 3) {
    assert.ok(Math.abs(lp[i] - (LOW_BED_H + ASPHALT_LIFT + DECK_MARK_LIFT)) < 1e-6, `low-bed marking y ${lp[i]}`);
  }
});

test('deck markings: dashes stop at a merge mouth, paint never crosses the other deck', () => {
  // Main 10.8 m east at h 9 (3 lanes, 2 dividers); branch 7.6 m
  // south from x=54, same level. The branch's first dash and the
  // main's dash astride the mouth are suppressed.
  const geo = buildDeckGeometry({
    deckDepth: 1.8, piers: [],
    lines: [
      { width: 10.8, pts: [0, 0, 100, 0], h: [9, 9] },
      { width: 7.6, pts: [54, 0, 54, 60], h: [9, 9] },
    ],
  });
  const s = geo.deckMarkingStats;
  assert.equal(s.lines, 2);
  assert.equal(s.linesWithDashes, 2);
  assert.equal(s.dashQuads, 33, '28 main + 8 branch - 3 suppressed');
  assert.equal(s.suppressedDashes, 3, '1 branch + 2 main dashes at the mouth');
  // No marking quad's centroid lies inside BOTH corridors at the
  // same level — paint never crosses the other deck's surface.
  const qs = quadsOf(geo.deckMarkings.positions);
  const inMain = (c) => Math.abs(c.cz) <= 5.4 + 0.1 && c.cx >= 0 && c.cx <= 100;
  const inBranch = (c) => Math.abs(c.cx - 54) <= 3.8 + 0.1 && c.cz >= 0 && c.cz <= 60;
  assert.equal(qs.filter((c) => inMain(c) && inBranch(c)).length, 0);
  // The branch's edge lines start past the mouth (its parapets are
  // trimmed there too): no branch edge quad reaches z < 5.4.
  const branchEdge = qs.filter((q) => Math.abs(Math.abs(q.cx - 54) - 3.4) < 0.2);
  assert.ok(branchEdge.length >= 2, 'branch edge lines exist');
  for (const q of branchEdge) assert.ok(q.minZ >= 5.4, `branch edge quad starts at z ${q.minZ}`);
});

test('deck markings: real-digest census, existing sinks unchanged, MRT emits none', () => {
  const geo = buildDeckGeometry(elev);
  assert.equal(geo.lineCount, 405);
  // The seven existing sinks are byte-identical to before markings.
  assert.equal(geo.triCount, 46004);
  assert.equal(geo.concrete.positions.length / 9, 41756);
  assert.equal(geo.asphalt.positions.length / 9, 4248);
  // Paint census (measured 2026-11-03; deterministic on the digest).
  const s = geo.deckMarkingStats;
  assert.equal(s.lines, 403, '405 lines - 2 single-lane ramps fully inside another deck\'s corridor (wayId 48769267 堤頂交流道， 51911167 環河北路出口匝道）');
  assert.equal(s.linesWithDashes, 307);
  assert.equal(s.dashQuads, 28265);
  assert.ok(Math.abs(s.dashKm - 81.71) < 0.5, `${s.dashKm} km of dash paint`);
  assert.equal(s.edgeQuads, 4129);
  assert.ok(Math.abs(s.edgeKm - 247.37) < 0.5, `${s.edgeKm} km of edge lines`);
  assert.equal(s.suppressedDashes, 1118);
  assert.equal(geo.deckMarkings.positions.length / 9, 64788, 'marking tris');
  assert.equal(geo.deckMarkings.positions.length / 18, s.dashQuads + s.edgeQuads);
  // Every marking normal faces up and every vertex is finite.
  for (let i = 0; i < geo.deckMarkings.positions.length; i++) {
    assert.ok(Number.isFinite(geo.deckMarkings.positions[i]));
  }
  for (let i = 1; i < geo.deckMarkings.normals.length; i += 3) {
    assert.ok(geo.deckMarkings.normals[i] > 0.9, 'marking normals face up');
  }
  // MRT (tracks mode) carries ballast, not road paint.
  const mrt = buildDeckGeometry(TAIPEI_GEO.mrtDecks, { tracks: true });
  assert.equal(mrt.deckMarkings.positions.length, 0);
  assert.deepEqual(mrt.deckMarkingStats, { lines: 0, linesWithDashes: 0, dashQuads: 0, dashKm: 0, edgeQuads: 0, edgeKm: 0, suppressedDashes: 0 });
});
