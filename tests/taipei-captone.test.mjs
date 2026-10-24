import assert from 'node:assert/strict';
import test from 'node:test';

import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { pointInPoly } from '../js/taipei-painted.js';
import { SURFACE_TONES, surfaceClass } from '../js/taipei-surfaces.js';
import { detectJunctions } from '../js/taipei-markings.js';
import { planJunctionCaps, planRoundabouts, ringPoints, capBlendTones, CAP_BLEND_KERNEL } from '../js/taipei-junctions.js';

// Issue #91 — cap tones. The rendered cap tone is a per-vertex
// blend of the incident arms' surface tones (capBlendTones in
// js/taipei-junctions.js): a vertex at an arm's mouth takes that
// arm's tone, the centre mixes all arms by width, and every
// component stays inside the arms' tone envelope (convex
// combination). Cap GEOMETRY is untouched by the tone rule — the
// geometry pins live in taipei-junctions.test.mjs and pass
// unedited; these tests pin the tone field the renderer draws.

const bed = (name, highway, width, ways = [1], pts = [0, 0, 100, 0]) => ({
  name, highway, width, pedestrianLayout: 'sidewalk', pts, sourceWayIds: ways,
});
const rgb = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
const dist = (a, b) => Math.max(...a.map((v, k) => Math.abs(v - b[k])));

function distToPoly(p, poly) {
  if (pointInPoly(p, poly)) return 0;
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j], [bx, bz] = poly[i];
    const dx = bx - ax, dz = bz - az;
    const L2 = dx * dx + dz * dz;
    let t = L2 > 0 ? ((p[0] - ax) * dx + (p[1] - az) * dz) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(p[0] - (ax + t * dx), p[1] - (az + t * dz)));
  }
  return best;
}

test('synthetic mixed 4-way: mouths take their arm tones, centre is the width mix', () => {
  const beds = [
    bed('EW Blvd', 'secondary', 30, [1, 2], [-100, 0, 0, 0]),
    bed('EW Blvd', 'secondary', 30, [1, 2], [0, 0, 100, 0]),
    bed('NS Ave', 'primary', 24, [3], [0, -100, 0, 0]),
    bed('NS Ave', 'primary', 24, [3], [0, 0, 0, 100]),
    bed('Lane', 'residential', 6, [4], [0, 0, -70, 70]),
  ];
  const junctions = detectJunctions(beds);
  const caps = planJunctionCaps(beds, junctions);
  assert.equal(caps.length, 1);
  const cap = caps[0];
  const pts = ringPoints(cap.ring);
  assert.equal(cap.tones.ring.length, pts.length, 'one tone per ring vertex');
  const art = rgb(SURFACE_TONES.arterial), lane = rgb(SURFACE_TONES.lane);
  // Centre: width-weighted mean of the arm tones (30+30+24+24
  // arterial metres, 6 lane metres).
  const expectCentre = art.map((v, k) => (108 * v + 6 * lane[k]) / 114);
  assert.ok(dist(cap.tones.centre, expectCentre) < 0.01, `centre ${cap.tones.centre} ≈ ${expectCentre}`);
  // The eastmost vertex sits at the wide EW arterial mouth:
  // its tone is the arterial tone, not a mix.
  const east = pts.reduce((m, p) => (p[0] > m[0] ? p : m));
  const eastTone = cap.tones.ring[pts.indexOf(east)];
  assert.ok(dist(eastTone, art) < 0.03, `east mouth tone ${eastTone} ≈ arterial ${art}`);
  // The vertex nearest the lane arm's axis (its mouth, ~13° off
  // axis at the cross-section end) is owned by the lane despite
  // the 5x width disadvantage: strictly closer to the lane tone
  // than to the arterial tone.
  const laneArm = junctions[0].arms.find((a) => a.name === 'Lane');
  const laneAng = Math.atan2(laneArm.dirZ, laneArm.dirX);
  const angDiff = (p) => Math.abs(((Math.atan2(p[1] - cap.z, p[0] - cap.x) - laneAng + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  const mouth = pts.reduce((m, p) => (angDiff(p) < angDiff(m) ? p : m));
  const mouthTone = cap.tones.ring[pts.indexOf(mouth)];
  assert.ok(dist(mouthTone, lane) < dist(mouthTone, art), `lane mouth tone ${mouthTone} leans lane`);
  // The fan origin is the junction centre, inside the ring.
  assert.deepEqual(cap.tones.origin, [cap.x, cap.z]);
  assert.ok(distToPoly(cap.tones.origin, pts) <= 0.75, 'origin inside the cap');
});

test('monochromatic junction: every tone is exactly the one arm tone', () => {
  const beds = [
    bed('EW Blvd', 'secondary', 30, [1, 2], [-100, 0, 0, 0]),
    bed('EW Blvd', 'secondary', 30, [1, 2], [0, 0, 100, 0]),
    bed('NS Blvd', 'secondary', 26, [3], [0, -100, 0, 0]),
    bed('NS Blvd', 'secondary', 26, [3], [0, 0, 0, 100]),
  ];
  const caps = planJunctionCaps(beds, detectJunctions(beds));
  assert.equal(caps.length, 1);
  const art = rgb(SURFACE_TONES.arterial);
  assert.ok(dist(caps[0].tones.centre, art) < 1e-3, 'centre is the arm tone');
  for (const t of caps[0].tones.ring) assert.ok(dist(t, art) < 1e-3, `vertex tone ${t} is the arm tone`);
});

test('blend is deterministic and kernel-shaped', () => {
  const beds = TAIPEI_GEO.roadbeds;
  const junctions = detectJunctions(beds);
  const sites = planRoundabouts(beds, junctions);
  const a = planJunctionCaps(beds, junctions, sites);
  const b = planJunctionCaps(beds, junctions, sites);
  assert.deepEqual(a.map((c) => c.tones), b.map((c) => c.tones), 'same plan, same tones');
  assert.ok(CAP_BLEND_KERNEL >= 4, 'kernel falls off fast enough to keep mouths pure');
  // capBlendTones is a pure function of junction + ring.
  const j = junctions.find((jj) => jj.arms.length >= 4);
  const cap = a.find((c) => c.x === j.x && c.z === j.z);
  assert.deepEqual(capBlendTones(j, ringPoints(cap.ring)), cap.tones);
});

test('real tile: tones align, stay in the tone envelope, origins inside', () => {
  const beds = TAIPEI_GEO.roadbeds;
  const junctions = detectJunctions(beds);
  const sites = planRoundabouts(beds, junctions);
  const caps = planJunctionCaps(beds, junctions, sites);
  const classes = ['deck', 'arterial', 'collector', 'lane'];
  const lo = [0, 1, 2].map((k) => Math.min(...classes.map((c) => rgb(SURFACE_TONES[c])[k])) - 1e-3);
  const hi = [0, 1, 2].map((k) => Math.max(...classes.map((c) => rgb(SURFACE_TONES[c])[k])) + 1e-3);
  let box = 0, fitted = 0;
  for (const cap of caps) {
    if (cap.kind === 'box') box++; else fitted++;
    const pts = ringPoints(cap.ring);
    assert.equal(cap.tones.ring.length, pts.length, `cap at ${cap.x},${cap.z}: tone per vertex`);
    for (const t of [cap.tones.centre, ...cap.tones.ring])
      for (let k = 0; k < 3; k++)
        assert.ok(t[k] >= lo[k] && t[k] <= hi[k], `tone component ${t[k]} inside the envelope`);
    assert.ok(distToPoly(cap.tones.origin, pts) <= 0.75, `cap at ${cap.x},${cap.z}: fan origin inside`);
    // A cap whose arms all share one class is flat in that class.
    const j = junctions.find((jj) => jj.x === cap.x && jj.z === cap.z);
    const armClasses = new Set(j.arms.map((arm) => surfaceClass({ highway: arm.highway })));
    if (armClasses.size === 1) {
      const only = rgb(SURFACE_TONES[[...armClasses][0]]);
      assert.ok(dist(cap.tones.centre, only) < 1e-3, 'single-class cap centre is that tone');
      for (const t of cap.tones.ring) assert.ok(dist(t, only) < 1e-3, 'single-class cap is flat');
    }
  }
  assert.ok(box > 0 && fitted > 0, 'both cap kinds carry tones');
});
