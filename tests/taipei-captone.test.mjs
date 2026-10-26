import assert from 'node:assert/strict';
import test from 'node:test';

import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { pointInPoly, ribbonPoly } from '../js/taipei-painted.js';
import { SURFACE_TONES, surfaceClass } from '../js/taipei-surfaces.js';
import { detectJunctions } from '../js/taipei-markings.js';
import { planJunctionCaps, planRoundabouts, ringPoints, capBlendTones, capClipPolys, throughRoadTone } from '../js/taipei-junctions.js';

// Cap tones — issue #172 (supersedes #91). The rendered cap
// tone is ONE tone per junction: the width-weighted mean of the
// incident arms' surface tones (capBlendTones in
// js/taipei-junctions.js), carried flat by every vertex of the
// ring, the #171 clipped pieces and the #163 strips. #91's
// angular-kernel blend (mouths taking their arm's tone) fanned
// differently through each piece's triangulation and rendered
// mixed junctions as 3-5 stepped plates (the #169 sweep's SEAM
// class; seam172-evidence probes: 14-90 distinct tones and up to
// the full arterial<->lane luminance spread inside one surface
// before, exactly 1 tone and zero spread after). The mouth
// assertions below were therefore RE-PINNED by #172: mouths no
// longer take their arm's tone — every vertex takes the junction
// tone. Cap GEOMETRY is untouched by the tone rule — the
// geometry pins live in taipei-junctions.test.mjs and pass
// unedited; these tests pin the tone the renderer draws.

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

test('synthetic mixed 4-way: one junction tone everywhere, the width mix', () => {
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
  // RE-PINNED by #172 (was #91: 'mouths take their arm tones').
  // Every ring vertex — the east arterial mouth and the lane
  // mouth alike — carries the single junction tone exactly, so
  // no fan triangulation can step plate-to-plate.
  for (const t of cap.tones.ring)
    assert.ok(dist(t, cap.tones.centre) < 1e-9, `vertex tone ${t} is the junction tone ${cap.tones.centre}`);
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

test('tone rule is deterministic and flat across every piece of every junction', () => {
  const beds = TAIPEI_GEO.roadbeds;
  const junctions = detectJunctions(beds);
  const sites = planRoundabouts(beds, junctions);
  // Production path (with the #171 green clip) so the clipped
  // pieces are exercised, not just rings and strips.
  const clip = capClipPolys(TAIPEI_GEO);
  const a = planJunctionCaps(beds, junctions, sites, clip);
  const b = planJunctionCaps(beds, junctions, sites, clip);
  assert.deepEqual(a.map((c) => c.tones), b.map((c) => c.tones), 'same plan, same tones');
  assert.ok(a.some((c) => (c.pieces || []).length > 0), 'the clip produced pieces to pin');
  // Issue #172: ring, clipped pieces and strips of a junction
  // all share the junction's single tone (the #169 SEAM class
  // was pieces disagreeing). This replaces #91's kernel pin
  // (CAP_BLEND_KERNEL >= 4, 'mouths pure') — the kernel field is
  // gone; flatness is the property the renderer now relies on.
  for (const c of a) {
    for (const t of c.tones.ring) assert.deepEqual(t, c.tones.centre, `cap at ${c.x},${c.z}: ring vertex is the junction tone`);
    for (const piece of [...(c.pieces || []), ...(c.extras || [])]) {
      assert.deepEqual(piece.tones.centre, c.tones.centre, `cap at ${c.x},${c.z}: piece shares the junction tone`);
      for (const t of piece.tones.ring) assert.deepEqual(t, c.tones.centre, `cap at ${c.x},${c.z}: piece vertex is the junction tone`);
    }
  }
  // capBlendTones is a pure function of junction + ring (+ the
  // #178 through-road adoption, itself a pure function of the
  // junction, the ring and the nearby ground ribbons).
  const j = junctions.find((jj) => jj.arms.length >= 4);
  const cap = a.find((c) => c.x === j.x && c.z === j.z);
  const nearBed = (bed, x, z, r) => {
    let x0 = 1e18, z0 = 1e18, x1 = -1e18, z1 = -1e18;
    for (let i = 0; i + 1 < bed.pts.length; i += 2) {
      x0 = Math.min(x0, bed.pts[i]); x1 = Math.max(x1, bed.pts[i]);
      z0 = Math.min(z0, bed.pts[i + 1]); z1 = Math.max(z1, bed.pts[i + 1]);
    }
    return x1 >= x - r && x0 <= x + r && z1 >= z - r && z0 <= z + r;
  };
  const cands = beds.map((bed, bedIdx) => ({ bedIdx, bed, ribbon: bed.deck ? null : ribbonPoly(bed) }))
    .filter((c) => c.ribbon && nearBed(c.bed, j.x, j.z, 80));
  const adopt = cap.kind === 'fitted' ? throughRoadTone(j, ringPoints(cap.ring), cands) : null;
  assert.deepEqual(capBlendTones(j, ringPoints(cap.ring), adopt), cap.tones);
});

test('real tile: tones align, stay in the tone envelope, origins inside', () => {
  const beds = TAIPEI_GEO.roadbeds;
  const junctions = detectJunctions(beds);
  const sites = planRoundabouts(beds, junctions);
  const caps = planJunctionCaps(beds, junctions, sites);
  const classes = ['deck', 'arterial', 'collector', 'lane'];
  const lo = [0, 1, 2].map((k) => Math.min(...classes.map((c) => rgb(SURFACE_TONES[c])[k])) - 1e-3);
  const hi = [0, 1, 2].map((k) => Math.max(...classes.map((c) => rgb(SURFACE_TONES[c])[k])) + 1e-3);
  let box = 0, fitted = 0, adoptedChecked = 0;
  for (const cap of caps) {
    if (cap.kind === 'box') box++; else fitted++;
    const pts = ringPoints(cap.ring);
    assert.equal(cap.tones.ring.length, pts.length, `cap at ${cap.x},${cap.z}: tone per vertex`);
    for (const t of [cap.tones.centre, ...cap.tones.ring])
      for (let k = 0; k < 3; k++)
        assert.ok(t[k] >= lo[k] && t[k] <= hi[k], `tone component ${t[k]} inside the envelope`);
    assert.ok(distToPoly(cap.tones.origin, pts) <= 0.75, `cap at ${cap.x},${cap.z}: fan origin inside`);
    // A cap whose arms all share one class is flat in that
    // class — with one legal exception since issue #178: a
    // fitted cap lying wholly on a through road adopts that
    // road's tone (ji1595's lane cluster on a tertiary). Verify
    // any deviating centre independently against
    // throughRoadTone instead of letting it pass silently.
    const j = junctions.find((jj) => jj.x === cap.x && jj.z === cap.z);
    const armClasses = new Set(j.arms.map((arm) => surfaceClass({ highway: arm.highway })));
    if (armClasses.size === 1) {
      const only = rgb(SURFACE_TONES[[...armClasses][0]]);
      if (dist(cap.tones.centre, only) < 1e-3) {
        for (const t of cap.tones.ring) assert.ok(dist(t, only) < 1e-3, 'single-class cap is flat');
      } else {
        adoptedChecked++;
        const nearBed = (bed, x, z, r) => {
          let x0 = 1e18, z0 = 1e18, x1 = -1e18, z1 = -1e18;
          for (let i = 0; i + 1 < bed.pts.length; i += 2) {
            x0 = Math.min(x0, bed.pts[i]); x1 = Math.max(x1, bed.pts[i]);
            z0 = Math.min(z0, bed.pts[i + 1]); z1 = Math.max(z1, bed.pts[i + 1]);
          }
          return x1 >= x - r && x0 <= x + r && z1 >= z - r && z0 <= z + r;
        };
        const cands = beds.map((bed, bedIdx) => ({ bedIdx, bed, ribbon: bed.deck ? null : ribbonPoly(bed) }))
          .filter((c) => c.ribbon && nearBed(c.bed, cap.x, cap.z, cap.radius + 40));
        const adopt = throughRoadTone(j, pts, cands);
        assert.ok(adopt && dist(adopt, cap.tones.centre) < 1e-3,
          `cap at ${cap.x},${cap.z}: centre is the arm tone or a verified through-road adoption`);
        for (const t of cap.tones.ring) assert.ok(dist(t, cap.tones.centre) < 1e-3, 'adopted cap is flat in the adopted tone');
      }
    }
  }
  assert.ok(box > 0 && fitted > 0, 'both cap kinds carry tones');
  assert.ok(adoptedChecked > 0, 'the tile has through-road adoptions to verify (ji1595 among them)');
});

test('issue #178: a minor cluster on a through road adopts the through tone (the ji1595 form)', () => {
  // Four service lanes (5 m N/S, 9 m E/W — the wide pair pushes
  // the hull's corners past a narrow through road's kerbs in
  // the control below) end around a point ON a 19 m
  // tertiary that runs straight through (its own ends are far
  // away, so it contributes no arm). Before the rule the cap
  // wore the lanes' pale blend — a foreign patch on the
  // collector's asphalt, the roadsweep-2 ji1595 frame.
  const lanes = [
    bed('Lane S', 'service', 5, [3], [0, -60, 0, -4]),
    bed('Lane N', 'service', 5, [4], [1, 4, 1, 60]),
    bed('Lane W', 'service', 9, [5], [-60, 1, -4, 1]),
    bed('Lane E', 'service', 9, [6], [4, -1, 60, -1]),
  ];
  const withThrough = [bed('Through Rd', 'tertiary', 19, [1, 2], [-100, 0, 100, 0]), ...lanes];
  const j1 = detectJunctions(withThrough);
  const caps1 = planJunctionCaps(withThrough, j1);
  assert.equal(caps1.length, 1, 'one cap for the lane cluster');
  const coll = rgb(SURFACE_TONES.collector);
  assert.ok(dist(caps1[0].tones.centre, coll) < 1e-3,
    `cluster on the tertiary adopts the collector tone, got ${caps1[0].tones.centre}`);
  for (const ex of caps1[0].extras || [])
    assert.ok(dist(ex.tones.centre, coll) < 1e-3, 'strips share the adopted tone');
  // Control: without the through road the same cluster keeps
  // its own lanes' tone.
  const j2 = detectJunctions(lanes);
  const caps2 = planJunctionCaps(lanes, j2);
  assert.equal(caps2.length, 1);
  const lane = rgb(SURFACE_TONES.lane);
  assert.ok(dist(caps2[0].tones.centre, lane) < 1e-3, 'no through road, no adoption');
  // Control: a through road too narrow to contain the whole
  // ring does not adopt (a vertex stands off its carriageway).
  const narrow = [bed('Through Rd', 'tertiary', 7, [1, 2], [-100, 0, 100, 0]), ...lanes];
  const caps3 = planJunctionCaps(narrow, detectJunctions(narrow));
  assert.equal(caps3.length, 1);
  assert.ok(dist(caps3[0].tones.centre, lane) < 1e-3, 'ring not wholly on the through road: no adoption');
});

test('issue #178: ji1595 on the real tile wears the collector tone', () => {
  const beds = TAIPEI_GEO.roadbeds;
  const junctions = detectJunctions(beds);
  const sites = planRoundabouts(beds, junctions);
  const caps = planJunctionCaps(beds, junctions, sites, capClipPolys(TAIPEI_GEO));
  const j = junctions.reduce((best, jj) => {
    const d = Math.hypot(jj.x + 5289.8, jj.z + 425.7);
    return d < best.d ? { jj, d } : best;
  }, { jj: null, d: Infinity }).jj;
  const cap = caps.find((c) => c.x === j.x && c.z === j.z);
  assert.ok(cap, 'ji1595 keeps its cap (it stands on the avenue)');
  const coll = rgb(SURFACE_TONES.collector);
  assert.ok(dist(cap.tones.centre, coll) < 1e-3,
    `ji1595 centre tone is the collector tone of 重慶南路一段, got ${cap.tones.centre}`);
});
