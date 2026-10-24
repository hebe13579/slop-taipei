import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Issue #22 pipeline rules, pinned against synthetic OSM extracts run
// through the real generation-map builder (TAIPEI_DATA + argv out path):
//   1. staggered carriageway segmentation still merges (Xinyi Sec 5 seam)
//   2. elevated carriageways (layer >= 1 / bridge) get layout 'shared'
//      and their ramps are exempt from the <120 m link exclusion
//   3. ground links under 120 m stay excluded (v1 policy unchanged)

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUILDER = path.join(HERE, '..', 'tools', 'taipei', 'build-generation-map.mjs');

// Same tangent-plane frame as the builders (origin Taipei 101).
const LAT0 = 25.0330, LON0 = 121.5650;
const A = 6378137.0, E2 = 6.69437999014e-3;
const PHI0 = (LAT0 * Math.PI) / 180, SIN0 = Math.sin(PHI0);
const KX = (Math.PI / 180) * (A / Math.sqrt(1 - E2 * SIN0 * SIN0)) * Math.cos(PHI0);
const KY = (Math.PI / 180) * (A * (1 - E2)) / Math.pow(1 - E2 * SIN0 * SIN0, 1.5);
const pt = (x, z) => ({ lat: LAT0 - z / KY, lon: LON0 + x / KX });
const way = (id, tags, pts) => ({ type: 'way', id, tags, geometry: pts });

function buildGenerationMap(elements) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'genmap-test-'));
  fs.writeFileSync(path.join(dir, 'osm_roads.json'), JSON.stringify({ elements }));
  const out = path.join(dir, 'generation-map.json');
  execFileSync(process.execPath, [BUILDER, out], {
    env: { ...process.env, TAIPEI_DATA: dir },
    stdio: 'pipe',
  });
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}

// The production OVERRIDES table has an anti-rot guard: an entry matching
// zero ways fails the build. Synthetic extracts therefore carry one token
// 建國快速道路 deck way (placed clear of each case's geometry) so the
// override matches exactly as it does on the real extract.
const tokenDeckWay = () => way(900, { name: '建國快速道路', highway: 'trunk', oneway: 'yes', lanes: '2', layer: '1', bridge: 'yes' }, [pt(-500, 500), pt(-500, 700)]);

const distToBed = (rb, x, z) => {
  const c = rb.centreline;
  let best = Infinity;
  for (let i = 0; i + 3 < c.length; i += 2) {
    const [x1, z1, x2, z2] = [c[i], c[i + 1], c[i + 2], c[i + 3]];
    const dx = x2 - x1, dz = z2 - z1;
    const L2 = dx * dx + dz * dz;
    const t = L2 ? Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / L2)) : 0;
    best = Math.min(best, Math.hypot(x - (x1 + t * dx), z - (z1 + t * dz)));
  }
  return best;
};
const coveredBy = (gm, x, z) => gm.roadbeds.some((rb) => distToBed(rb, x, z) <= rb.width / 2 + 0.5);

test('staggered carriageway segmentation merges with no median seam (issue #22)', () => {
  // Eastbound is ONE 400 m way; westbound is TWO ways split at x=180.
  // v1 required 70% of EACH segment to pair, so the long way paired with
  // neither half and the median strip showed through as a pale seam.
  const gm = buildGenerationMap([
    way(101, { name: '測試大道', highway: 'secondary', oneway: 'yes', lanes: '3' }, [pt(0, 8), pt(400, 8)]),
    way(102, { name: '測試大道', highway: 'secondary', oneway: 'yes', lanes: '3' }, [pt(180, -8), pt(0, -8)]),
    way(103, { name: '測試大道', highway: 'secondary', oneway: 'yes', lanes: '3' }, [pt(400, -8), pt(180, -8)]),
    tokenDeckWay(),
  ]);
  const merged = gm.roadbeds.filter((rb) => rb.merged);
  assert.ok(merged.length >= 1, 'the pair merges');
  const mergedWays = new Set(merged.flatMap((rb) => rb.sourceWayIds));
  assert.deepEqual([...mergedWays].sort(), [101, 102, 103], 'all three carriageway ways are in merged beds');
  // The median line (z=0) is paved along the whole corridor — no seam.
  for (let x = 5; x <= 395; x += 10) {
    assert.ok(coveredBy(gm, x, 0), `median covered at x=${x}`);
    assert.ok(coveredBy(gm, x, 8), `eastbound lane covered at x=${x}`);
    assert.ok(coveredBy(gm, x, -8), `westbound lane covered at x=${x}`);
  }
  // No unmerged single of the long way survives alongside.
  assert.ok(!gm.roadbeds.some((rb) => !rb.merged && rb.sourceWayIds.includes(101) && distToBed(rb, 200, 8) < 1),
    'long way is not also emitted as a single');
});

test('elevated carriageways: merged deck is one wide bed with layout shared (issue #22)', () => {
  // Widths are chosen to discriminate under both classifier generations:
  // pre-#16 painted meant 巷/<8 m, post-#16 it means 8–12 m — an unguarded
  // deck way lands on painted or a sidewalk band either way, never shared.
  const gm = buildGenerationMap([
    way(201, { name: '高架快速道路', highway: 'trunk', oneway: 'yes', lanes: '3', layer: '1', bridge: 'yes' }, [pt(-10, 300), pt(-10, 0)]),
    way(202, { name: '高架快速道路', highway: 'trunk', oneway: 'yes', lanes: '3', layer: '1', bridge: 'yes' }, [pt(10, 0), pt(10, 300)]),
    // Lone elevated ways at two widths: without the deck guard, 6.4 m and
    // 9.6 m classify as street treatments (painted / sidewalk band).
    way(203, { name: '高架連絡道', highway: 'secondary', oneway: 'yes', lanes: '2', layer: '1', bridge: 'yes' }, [pt(200, 100), pt(200, 250)]),
    way(205, { name: '高架連絡道', highway: 'secondary', oneway: 'yes', lanes: '3', layer: '2' }, [pt(250, 100), pt(250, 250)]),
    // Ground control (9.6 m, 巷 name): 'painted' under both classifier
    // generations — the deck guard must not leak to grade level.
    way(204, { name: '測試巷', highway: 'secondary', oneway: 'yes', lanes: '3' }, [pt(300, 100), pt(300, 250)]),
    tokenDeckWay(),
  ]);
  const deck = gm.roadbeds.find((rb) => rb.merged && rb.sourceWayIds.includes(201));
  assert.ok(deck, 'opposing deck carriageways merge');
  assert.ok(deck.sourceWayIds.includes(202));
  assert.ok(deck.width >= 29, `deck bed spans both carriageways + median (got ${deck.width})`);
  assert.equal(deck.pedestrianLayout, 'shared', 'no stripes / sidewalk band on a deck');
  for (const id of [203, 205]) {
    const lone = gm.roadbeds.find((rb) => rb.sourceWayIds.includes(id));
    assert.ok(lone, `lone elevated way ${id} still renders`);
    assert.equal(lone.pedestrianLayout, 'shared', `elevated way ${id} never gets a street layout`);
  }
  const ground = gm.roadbeds.find((rb) => rb.sourceWayIds.includes(204));
  assert.ok(ground, 'ground control renders');
  assert.equal(ground.pedestrianLayout, 'painted', 'ground classifier unchanged by the deck guard');
});

test('link policy: elevated ramps are kept, short ground links stay excluded (issue #22)', () => {
  const gm = buildGenerationMap([
    way(301, { name: '高架匝道', highway: 'trunk_link', oneway: 'yes', layer: '1', bridge: 'yes' }, [pt(300, 0), pt(360, 60)]),
    way(302, { name: '平面匝道', highway: 'trunk_link', oneway: 'yes' }, [pt(-300, 0), pt(-240, 60)]),
    tokenDeckWay(),
  ]);
  assert.ok(gm.roadbeds.some((rb) => rb.sourceWayIds.includes(301)), 'elevated ramp under 120 m is rendered');
  assert.ok(!gm.roadbeds.some((rb) => rb.sourceWayIds.includes(302)), 'ground link under 120 m stays excluded');
  const s = gm.stats;
  const delta = Math.abs(s.roadbedLength + s.excludedLinkLength + s.mergedConstituentOverlapLength - s.mergedLength + s.droppedScrapLength - s.carriagewayLength);
  assert.ok(delta < 5, `length identity still closes on synthetic data (delta ${delta})`);
});
