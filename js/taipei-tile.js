import { TAIPEI_GEO } from './taipei-geodata.js';
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

export const TAIPEI_TILE = {
  id: 'taipei',
  label: "Taipei — Xinyi / Da'an / Songshan tile",
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
  // Spawn / default camera target: Taipei 101's landmark site.
  spawn: { x: lm('Taipei 101').x, z: lm('Taipei 101').z, heading: 0 },
  teleports: {
    taipei101: { x: lm('Taipei 101').x, z: lm('Taipei 101').z, heading: 0, name: 'Taipei 101', sub: 'Xinyi · 台北101' },
    cityhall: { x: lm('Taipei City Government').x, z: lm('Taipei City Government').z, heading: Math.PI, name: 'Taipei City Hall', sub: 'Xinyi · 臺北市政府' },
    sysmemorial: { x: lm('Sun Yat-sen Memorial Hall').x, z: lm('Sun Yat-sen Memorial Hall').z, heading: 0, name: 'Sun Yat-sen Memorial Hall', sub: 'Xinyi · 國父紀念館' },
    daanpark: { x: daanPark.x, z: daanPark.z, heading: 0, name: "Da'an Forest Park", sub: 'Da\'an · 大安森林公園' },
    songshan: { x: wuchangPark.x, z: wuchangPark.z, heading: 0, name: 'Songshan — Wuchang Park', sub: 'Songshan · 五常公園' },
  },
  // The map's landmark layer (issue #33): Taipei 101 itself plus every
  // structure in the LANDMARK_STRUCTURES registry (js/taipei-buildings.js),
  // resolved through the registry's own export — never a second
  // hand-maintained list. The geodata's other named points (the 101
  // MALL, MRT Exit 5) are POIs, not landmark structures, and stay off
  // this layer; the teleports above are unchanged.
  landmarks: [
    {
      id: 'taipei-101', name: 'Taipei 101', nameZh: '台北101', short: 'Taipei 101',
      x: lm('Taipei 101').x, z: lm('Taipei 101').z, height: 508,
      district: taipeiDistrictAt(lm('Taipei 101').x, lm('Taipei 101').z),
    },
    ...taipeiLandmarkStructures(TAIPEI_GEO).map((s) => ({
      id: s.id, name: s.name, nameZh: s.nameZh, short: s.name,
      x: s.x, z: s.z, height: s.height, district: taipeiDistrictAt(s.x, s.z),
    })),
  ],
  roadNames: [...new Set(TAIPEI_GEO.roads.map((r) => r.name || r.nameEn).filter(Boolean))],
  getLocationLabel: getTaipeiLocationLabel,
  getLocationParts: getTaipeiLocationParts,
  districtAt: taipeiDistrictAt,
  nearestRoads: nearestTaipeiRoads,
  nearestGraphNode,
  loadBoot: () => import('./taipei-boot.js'),
};
