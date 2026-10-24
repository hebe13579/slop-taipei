// js/tile-registry.js
// Data-driven city/tile selection for ?city=<id> (default: nyc).
//
// Each non-legacy entry is one tile definition module (see
// js/taipei-tile.js for the shape): { id, label, short, origin, frame,
// geodata, adaptedGeo, spawn, teleports, landmarks, roadNames,
// getLocationLabel, districtAt, nearestRoads, nearestGraphNode,
// streetProfile, loadBoot() }.
//
// Optional member: getLocationParts(x, z) → { place, current, cross },
// the location label in structured form. `current` is the road the
// player is ON (null at off-road points); main.js uses it to tag the
// current road's HUD sign （正行駛）. Tiles without it get the plain
// string-label sign, exactly as before.
//
// Adding a tile is: (1) generate its geodata + adapter, (2) write one
// <tile>-tile.js definition, (3) add ONE entry below. main.js and
// city-config.js do not change. (Beitou is the planned second Taipei tile —
// see TAIPEI_PROTOTYPE.md, "Future tile: Beitou", noted but NOT queued.)
//
// Tile definitions are loaded lazily via dynamic import so the default NYC
// boot neither pays for nor evaluates tile modules it does not use.

export const TILE_REGISTRY = {
  nyc: {
    id: 'nyc',
    label: 'New York City',
    short: 'NY',
    kind: 'legacy', // the built-in static city; main.js runs its legacy path
    load: null,
  },
  taipei: {
    id: 'taipei',
    label: "Taipei — Xinyi / Da'an / Songshan / Zhongzheng tile",
    short: 'TP',
    kind: 'tile',
    load: () => import('./taipei-tile.js').then((m) => m.TAIPEI_TILE),
  },
  // Beitou is NOT a separate tile: the approved shape (2026-10-24,
  // issue #60) grows it as Box 4 of the taipei tile's box union
  // (tools/taipei/tile-boxes.json futureBoxes) in a later phase.
};

/** The ?city= id from a query string, normalised; unknown ids fall back to the default (nyc). */
export function tileIdFromSearch(search = '') {
  try {
    const id = new URLSearchParams(search).get('city');
    return id && Object.hasOwn(TILE_REGISTRY, id) ? id : 'nyc';
  } catch {
    return 'nyc';
  }
}

/**
 * Resolve the selected tile: { id, entry, tile } where `tile` is the loaded
 * tile definition, or null for the legacy NYC city.
 */
export async function loadSelectedTile(search = '') {
  const id = tileIdFromSearch(search);
  const entry = TILE_REGISTRY[id];
  const tile = entry.load ? await entry.load() : null;
  return { id, entry, tile };
}
