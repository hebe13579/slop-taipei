// tests/taipei-blade-shapes.test.mjs
// Issue #375: the renderer (js/buildings.js, preloaded — it cannot
// import js/taipei-signs.js) reproduces the blade plate hash and the
// plate-shape decision in its own fill loop. This pins the two
// implementations against each other: the buildings.js functions are
// regex-extracted from source (the traffic.test.cjs pattern) and run
// in a vm with only the mirrored constants in scope, then compared
// with taipei-signs.js's predictBladePlate + bladePlateShape over a
// faceCoord sweep and over the decision's boundary cases. A drift in
// either hash would size boxes for plates the shader never paints
// (square boxes showing portrait art, or round boxes showing a
// square lockup) — the sweep is the tripwire.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { predictBladePlate, bladePlateShape, BLADE_PLATE_SHAPES } from '../js/taipei-signs.js';

const buildings = readFileSync(new URL('../js/buildings.js', import.meta.url), 'utf8');
function extractFunction(name) {
  const match = buildings.match(new RegExp(`  function ${name}\\([^]*?\\n  \\}`));
  assert.ok(match, `${name} is present in js/buildings.js`);
  return match[0];
}
// The mirrored shape string is a literal in the source — extract it
// (not the import) so the test verifies what the renderer actually
// carries.
const shapeLiteral = buildings.match(/const SIGN_BLADE_SHAPES = '([psrw]+)';/);
assert.ok(shapeLiteral, 'SIGN_BLADE_SHAPES literal is present in js/buildings.js');
assert.equal(shapeLiteral[1], BLADE_PLATE_SHAPES, 'renderer shape string matches the pool-derived string');

const sandbox = {
  SIGN_BLADE_SHAPES: shapeLiteral[1],
  SIGN_BLADE_SHAPE_PORTRAIT: 0,
  SIGN_BLADE_SHAPE_SQUARE: 1,
  SIGN_BLADE_SHAPE_ROUND: 2,
};
// predictBladePlate also reads the weighted-bands array — extract
// the literal (not the import) so the test verifies what the
// renderer actually carries, and pin it against the expected bands
// (the signs module's bands are private; the sweep below is what
// proves the two band tables agree).
const bandsLiteral = buildings.match(/const SIGN_BLADE_PLATE_BANDS = (\[[\s\S]*?\]);/);
assert.ok(bandsLiteral, 'SIGN_BLADE_PLATE_BANDS literal is present in js/buildings.js');
sandbox.SIGN_BLADE_PLATE_BANDS = vm.runInNewContext(`(${bandsLiteral[1]})`, {});
// The extracted array lives in the vm's realm (a different Array
// prototype), so compare by JSON, not deepEqual.
assert.equal(JSON.stringify(sandbox.SIGN_BLADE_PLATE_BANDS), JSON.stringify([
  [0.0, 0.08, 1], [0.08, 0.12, 26], [0.12, 0.17, 52], [0.17, 0.21, 53],
  [0.21, 0.24, 51], [0.24, 0.27, 68], [0.27, 0.30, 71], [0.30, 0.32, 64],
]), 'renderer weighted bands match the expected eight bands');
vm.createContext(sandbox);
vm.runInContext(
  `${extractFunction('predictBladePlate')}\n${extractFunction('bladePlateShapeForBlade')}`,
  sandbox,
);
const predictB = sandbox.predictBladePlate;
const shapeForBlade = sandbox.bladePlateShapeForBlade;
assert.equal(typeof predictB, 'function', 'extracted predictBladePlate runs in the vm');
assert.equal(typeof shapeForBlade, 'function', 'extracted bladePlateShapeForBlade runs in the vm');

// The renderer hash agrees with the signs hash over a wide sweep
// (faceCoords across the whole city, fractional parts included).
for (let i = 0; i < 43000; i++) {
  const fc = -8000 + i * 0.37;
  assert.equal(predictB(fc), predictBladePlate(fc).plate, `plate hash agrees at faceCoord ${fc}`);
}
// Spot values, including the quantum-boundary neighbourhood.
for (const fc of [0, 1.3, -4529.1, 100.7, 1234.5, 2.0, 2.01, -0.005, 7999.99]) {
  assert.equal(predictB(fc), predictBladePlate(fc).plate, `plate hash agrees at faceCoord ${fc}`);
}

// The shape decision agrees with an independent recomputation from
// the signs side: same plate shape on both faces (and neither face
// near a 0.5 m quantum boundary) → that shape; split faces or a
// boundary face → portrait; a turned block → portrait.
function expectedShape(faceA, faceB, turned) {
  if (turned) return 0;
  const nearBoundary = (fc) => {
    const v = Math.fround(fc) * 0.5;
    return Math.abs(v - Math.round(v)) < 0.01;
  };
  if (nearBoundary(faceA) || nearBoundary(faceB)) return 0;
  const sA = bladePlateShape(predictBladePlate(faceA).plate);
  const sB = bladePlateShape(predictBladePlate(faceB).plate);
  if (sA !== sB) return 0;
  return sA === 'square' ? 1 : sA === 'round' ? 2 : 0;
}
for (let i = 0; i < 20000; i++) {
  const fc = -8000 + i * 0.79;
  for (const thick of [0.18, 0.35, 0.55]) {
    const faceA = fc - thick / 2;
    const faceB = fc + thick / 2;
    assert.equal(
      shapeForBlade(faceA, faceB, false),
      expectedShape(faceA, faceB, false),
      `shape decision agrees at centre ${fc}, thick ${thick}`,
    );
  }
}
// A turned block is always portrait, whatever its faces hash to.
assert.equal(shapeForBlade(0, 0, true), 0, 'turned block → portrait');
assert.equal(shapeForBlade(-4529.1, -4528.9, true), 0, 'turned BFC blade → portrait');
// A face exactly on a quantum boundary is portrait (float32
// rounding could flip the floor and paint a different plate): both
// faces here sit within 0.01 of the boundary at faceCoord 2.0.
assert.equal(shapeForBlade(1.995, 2.005, false), 0, 'face on a quantum boundary → portrait');
// A split face is portrait: find one deterministically (two faces
// 0.4 m apart hashing to different shapes) and pin the decision.
let splitFound = null;
for (let fc = -8000; fc < 8000 && !splitFound; fc += 0.37) {
  const sA = bladePlateShape(predictBladePlate(fc - 0.2).plate);
  const sB = bladePlateShape(predictBladePlate(fc + 0.2).plate);
  if (sA !== sB) splitFound = fc;
}
assert.ok(splitFound !== null, 'a split face exists in the sweep (the case the fallback covers)');
assert.equal(shapeForBlade(splitFound - 0.2, splitFound + 0.2, false), 0, `split face at ${splitFound} → portrait`);
// And a non-split, non-boundary shaped blade keeps its shape: find
// a square-square pair and a round-round pair deterministically
// (both faces of a 0.35 m blade hashing to the same shaped plate).
for (const [want, code] of [['square', 1], ['round', 2]]) {
  let found = null;
  for (let fc = -8000; fc < 8000 && found === null; fc += 0.37) {
    const sA = bladePlateShape(predictBladePlate(fc - 0.175).plate);
    const sB = bladePlateShape(predictBladePlate(fc + 0.175).plate);
    if (sA === want && sB === want) found = fc;
  }
  assert.ok(found !== null, `a ${want}-${want} blade exists in the sweep`);
  assert.equal(shapeForBlade(found - 0.175, found + 0.175, false), code, `${want}-${want} blade at ${found} → ${want}`);
}

console.log('taipei-blade-shapes.test.mjs: all assertions passed');
