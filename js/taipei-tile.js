import { TAIPEI_GEO, SANDBOX_BOX, pointInBox } from './taipei-sandbox.js'; // sandbox wrapper: the generated geo, filtered when ?sandbox= is set, untouched otherwise
import { taipeiLandmarkStructures } from './taipei-buildings.js';
import {
  TAIPEI_GEO_ADAPTED,
  getTaipeiLocationLabel,
  getTaipeiLocationParts,
  taipeiDistrictAt,
  nearestTaipeiRoads,
  nearestGraphNode,
} from './taipei-adapter.js';

// js/taipei-tile.js
// Tile definition for the M0/M1 Taipei tile (Xinyi / Da'an / Songshan).
// This is the unit the tile registry (js/tile-registry.js) selects by
// ?city=<id>: geodata + adapted GEO + origin + teleports + label/district
// helpers + a lazy boot-module loader. A future tile (e.g. Beitou, noted in
// TAIPEI_PROTOTYPE.md as NOT queued) plugs in as one more file like this one
// plus one registry entry — no main.js / city-config.js changes.
//
// The boot builder is loaded lazily so importing this definition (tests,
// tooling) never pulls in three.js.

const parkPoint = (name) => {
  const park = TAIPEI_GEO.parks.find((p) => p.name === name);
  if (!park) return null;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i + 1 < park.ring.length; i += 2) {
    minX = Math.min(minX, park.ring[i]); maxX = Math.max(maxX, park.ring[i]);
    minZ = Math.min(minZ, park.ring[i + 1]); maxZ = Math.max(maxZ, park.ring[i + 1]);
  }
  return { x: Math.round(((minX + maxX) / 2) * 10) / 10, z: Math.round(((minZ + maxZ) / 2) * 10) / 10 };
};
const lm = (key) => TAIPEI_GEO.landmarks[key];
const daanPark = parkPoint('大安森林公園');
const wuchangPark = parkPoint('五常公園'); // Songshan district

// Sandbox (?sandbox=): the geo filter drops out-of-box landmark pins and
// parks, so the spawn and teleports must never dereference a missing pin.
// Spawn falls back to the sandbox centre; the teleports shrink to the
// pins that survived; a sandbox with no surviving pin gets a single
// centre teleport so the teleport bar is never empty.
const sandboxCentre = SANDBOX_BOX
  ? { x: (SANDBOX_BOX.minX + SANDBOX_BOX.maxX) / 2, z: (SANDBOX_BOX.minZ + SANDBOX_BOX.maxZ) / 2 }
  : null;
const spawnPoint = lm('Taipei 101') || sandboxCentre || { x: 0, z: 0 };
const teleportEntries = [
  ['taipei101', lm('Taipei 101'), 0, 'Taipei 101', 'Xinyi · 台北101'],
  ['cityhall', lm('Taipei City Government'), Math.PI, 'Taipei City Hall', 'Xinyi · 臺北市政府'],
  ['sysmemorial', lm('Sun Yat-sen Memorial Hall'), 0, 'Sun Yat-sen Memorial Hall', 'Xinyi · 國父紀念館'],
  ['daanpark', daanPark, 0, "Da'an Forest Park", "Da'an · 大安森林公園"],
  ['songshan', wuchangPark, 0, 'Songshan — Wuchang Park', 'Songshan · 五常公園'],
];
const tileTeleports = {};
for (const [key, pt, heading, name, sub] of teleportEntries) {
  if (pt) tileTeleports[key] = { x: pt.x, z: pt.z, heading, name, sub };
}
if (Object.keys(tileTeleports).length === 0 && sandboxCentre) {
  tileTeleports.sandbox = { x: sandboxCentre.x, z: sandboxCentre.z, heading: 0, name: 'Sandbox centre', sub: 'Sandbox · 沙盒中心' };
}
// The map's landmark layer: the 101 entry only when its pin survived,
// and the registry structures filtered to pins inside the sandbox box
// (the registry itself is static code, so the geo filter cannot do it).
const tileLandmarks = [
  ...(lm('Taipei 101') ? [{
    id: 'taipei-101', name: 'Taipei 101', nameZh: '台北101', short: 'Taipei 101',
    x: lm('Taipei 101').x, z: lm('Taipei 101').z, height: 508,
    district: taipeiDistrictAt(lm('Taipei 101').x, lm('Taipei 101').z),
  }] : []),
  ...taipeiLandmarkStructures(TAIPEI_GEO)
    .filter((s) => !SANDBOX_BOX || pointInBox(s.x, s.z, SANDBOX_BOX))
    .map((s) => ({
      id: s.id, name: s.name, nameZh: s.nameZh, short: s.name,
      x: s.x, z: s.z, height: s.height, district: taipeiDistrictAt(s.x, s.z),
    })),
];

export const TAIPEI_TILE = {
  id: 'taipei',
  label: "Taipei — Xinyi / Da'an / Songshan / Zhongzheng tile",
  short: 'TP',
  // Street-details profile slot: the Taiwan streetscape spec
  // (TAIWAN_STREETSCAPE.md, being written on its own branch) will attach
  // per-tile street furniture/signage rules here; the geodata already
  // carries per-road `pedestrianLayout` for it. Null until that spec lands.
  streetProfile: null,
  origin: {
    label: TAIPEI_GEO.frame.origin,
    latLon: TAIPEI_GEO.frame.originLatLon,
    x: 0,
    z: 0,
  },
  frame: TAIPEI_GEO.frame,
  geodata: TAIPEI_GEO,
  adaptedGeo: TAIPEI_GEO_ADAPTED,
  // Spawn / default camera target: Taipei 101's landmark site (the
  // sandbox centre when the 101 pin is outside the box).
  spawn: { x: spawnPoint.x, z: spawnPoint.z, heading: 0 },
  teleports: tileTeleports,
  // The map's landmark layer (issue #33): Taipei 101 itself plus every
  // structure in the LANDMARK_STRUCTURES registry (js/taipei-buildings.js),
  // resolved through the registry's own export — never a second
  // hand-maintained list. The geodata's other named points (the 101
  // MALL, MRT Exit 5) are POIs, not landmark structures, and stay off
  // this layer; the teleports above are unchanged. In a sandbox the
  // list is the in-box subset (tileLandmarks, built above).
  landmarks: tileLandmarks,
  roadNames: [...new Set(TAIPEI_GEO.roads.map((r) => r.name || r.nameEn).filter(Boolean))],
  getLocationLabel: getTaipeiLocationLabel,
  getLocationParts: getTaipeiLocationParts,
  districtAt: taipeiDistrictAt,
  nearestRoads: nearestTaipeiRoads,
  nearestGraphNode,
  loadBoot: () => import('./taipei-boot.js'),
};
