// tests/taipei-blade-edges.test.mjs
// Issue #382: a blade's thin edge faces showed the plate text,
// squished onto a 0.18–0.55 m strip (the 花店 the user saw). The old
// edge test — a nonzero fwidth(faceCoord) — never fires on
// axis-aligned blades (the face coordinate is constant on every
// face) and fires on every face of turned blades, so it fixed
// nothing and blanked the turned ones. The fix is a box-local edge
// test: the edge faces are the unit box's faces perpendicular to
// the blade's BROAD (out) axis — the thin strips at +/-out/2, not
// the faces perpendicular to the thin axis (those are the broad
// faces). aBladeThin, stamped per blade from its side, selects
// which axis is broad; kept alongside the fwidth term (which still
// blanks turned blades whole, whose face-coordinate plate hash
// would stripe across a diagonal broad face). This pins the
// thin-flag mapping, the wiring, the edge rule's source, and the
// blade population the fix applies to.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  planTaipeiBuildings,
  taipeiCityBlocksOptions,
} from '../js/taipei-buildings.js';
import {
  TAIPEI_GEO,
} from '../js/taipei-geodata.js';

const buildings = readFileSync(new URL('../js/buildings.js', import.meta.url), 'utf8');

// --- The thin-axis flag (extracted from source, run in a vm) --------
function extractModuleFunction(src, name) {
  const match = src.match(new RegExp(`^function ${name}\\([^]*?\\n\\}`, 'm'));
  assert.ok(match, `${name} is present in js/buildings.js`);
  return match[0];
}
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(extractModuleFunction(buildings, 'bladeThinFlag'), sandbox);
const { bladeThinFlag } = sandbox;
assert.equal(typeof bladeThinFlag, 'function', 'extracted bladeThinFlag runs in the vm');
assert.equal(bladeThinFlag('n'), 0, 'a north blade is thin on local x');
assert.equal(bladeThinFlag('s'), 0, 'a south blade is thin on local x');
assert.equal(bladeThinFlag('e'), 1, 'an east blade is thin on local z');
assert.equal(bladeThinFlag('w'), 1, 'a west blade is thin on local z');

// --- The wiring, pinned by source ------------------------------------
assert.ok(
  buildings.includes(`vSignGeo.setAttribute('aBladeThin', new THREE.InstancedBufferAttribute(new Float32Array(MAX_VSIGNS), 1));`),
  'the aBladeThin attribute is declared on the blade geometry',
);
assert.ok(
  buildings.includes('vSignGeo.attributes.aBladeThin.setX(vSignCount, bladeThinFlag(s.side));'),
  'the fill loop stamps aBladeThin from the blade side',
);
assert.ok(
  buildings.includes('flagRange(vSignGeo.attributes.aBladeThin, vSignCount);'),
  'the thin-axis attribute is flagged for upload',
);
assert.ok(
  buildings.includes(`const vSignThin = attribute('aBladeThin', 'float');`),
  'the shader reads aBladeThin',
);
// The edge rule: the box-local faces perpendicular to the blade's
// BROAD (out) axis — +/-z for a north/south blade (thin axis local
// x, vSignThin 0), +/-x for an east/west blade (thin axis local z,
// vSignThin 1) — plus the kept fwidth term (turned blades) and the
// top/bottom term.
assert.ok(
  buildings.includes('const localEdge = mix(step(0.5, abs(nG.z)), step(0.5, abs(nG.x)), vSignThin);'),
  'the edge test uses the box-local normal and the broad axis',
);
assert.ok(
  buildings.includes('return localEdge.add(step(0.001, fwidth(faceCoord))).add(step(0.5, abs(nW.y))).clamp(0.0, 1.0);'),
  'the edge rule keeps the fwidth and top/bottom terms',
);
// Both the colour and the opacity node use the shared edge rule, so
// the rim stays solid exactly where the colour goes solid.
assert.equal(
  (buildings.match(/const edge = vSignEdge\(\);/g) || []).length, 2,
  'colour and opacity share vSignEdge',
);
// The #378 attribute-wins line is untouched.
assert.ok(
  buildings.includes('plate = mix(plate, vSignPlateAttr, step(0.0, vSignPlateAttr));'),
  'the #378 aBladePlate line is untouched',
);

// --- The population, on the real plan ---------------------------------
// COUNT PINS (measured by census382.mjs on the branch tree, 2026-11-18:
// 9,566 planned blades; n/s (thin = local x) 4,820, e/w (thin =
// local z) 4,746 — near 50/50, so the thin-axis attribute is required;
// framed (lot.rotY != 0) 6,015, all at arbitrary angles, none a
// multiple of 90° — the fwidth term still blanks those whole.)
const plan = planTaipeiBuildings(TAIPEI_GEO);
const opts = taipeiCityBlocksOptions(TAIPEI_GEO, plan);
let total = 0;
const sides = {};
let framed = 0;
let thickMin = 1e9;
let thickMax = -1e9;
for (const lot of opts.lots) {
  if (!lot.signs) continue;
  if (lot.rotY) framed += lot.signs.length;
  for (const s of lot.signs) {
    total++;
    sides[s.side] = (sides[s.side] || 0) + 1;
    if (s.thick < thickMin) thickMin = s.thick;
    if (s.thick > thickMax) thickMax = s.thick;
  }
}
assert.equal(total, 9566, 'planned blades');
assert.deepEqual(sides, { e: 2391, w: 2355, n: 2427, s: 2393 }, 'blades by side');
assert.equal(framed, 6015, 'blades on turned (framed) blocks');
assert.equal(total - framed, 3551, 'blades on unturned blocks');
assert.ok(thickMin >= 0.18 && thickMax <= 0.55, `blade thickness in 0.18–0.55 m (got ${thickMin}–${thickMax})`);

console.log('taipei-blade-edges.test.mjs: all assertions passed');
