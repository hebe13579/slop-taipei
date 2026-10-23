# GEO contract — what a replacement for `js/nyc-geodata.js` must provide

Mapped 2026-10-23 by grepping `js/*.js` in the fork (main @ f972ee50) for `GEO.*`
and by inspecting the generated upstream object (1,105 KB JSON, `version: 1`).
Direct importers of `./nyc-geodata.js`: `city-config.js` (25 uses),
`city-grid.js` (5), `nyc-map.js` (3), `buildings.js` (2), `road-network.js` (2),
`boroughs.js` (3 — two of those are false positives: `BOX_GEO.index/.attributes`
are a three.js BufferGeometry, not the geodata object).

All polygons/polylines are flat `[x0, z0, x1, z1, …]` arrays in the world frame
(1 unit = 1 m) unless noted.

## Top-level fields consumed by the runtime

| Field | Shape (upstream) | Consumed by | Spike (TAIPEI_GEO) |
|---|---|---|---|
| `version` | number (1) | — | ✅ `1` |
| `frame` | `{bearingDeg, origin, units, cutZ, strip, sidewalk}` — `frame.cutZ` and `frame.bearingDeg` read at runtime | city-config, others | ⚠️ partial: `{origin, bearingDeg, units, bbox}` — no `cutZ/strip/sidewalk` (those are Manhattan shoreline concepts; a Taipei equivalent must be decided in M1) |
| `manhattan` | flat ring — detailed island coastline | city-config (coastline, island bounds) | ❌ no equivalent: Taipei land is a mainland tile. Spike models land implicitly as the tile rect minus `water` rings |
| `upperManhattan` | flat ring — low-detail north part | city-config | ❌ (scenery-ring equivalent is M2) |
| `innerShore` | flat ring — shoreline inset by the waterfront strip | build-geodata output | ❌ |
| `islands` | `{roosevelt, randalls, governors, liberty, millRock, ellis}` flat rings | city-config | ❌ none in tile (river islets could map here later) |
| `boroughs` | `{brooklyn, queens, bronx, statenIsland, newJersey}` — arrays of flat rings (surrounding low-detail land) | city-config, boroughs | ❌ M2 mountain/scenery ring replaces this concept |
| `streets` | `[{n, z, segs:[[x0,x1,dir,width],…]}]` — numbered E/W streets | city-config `STREET_BY_NUMBER`, `streetZ()` | ❌ **grid-specific, no Taipei equivalent** — must be removed in the M1 de-grid work, not emulated |
| `avenues` | `[{id, label, x, segs:[{z0,z1,dir,w,lanes,names}]}]` — named N/S avenues | city-config `ALL_AVENUES`, `avenueX()` | ❌ **grid-specific** — same M1 removal |
| `broadway` | flat polyline (the diagonal) | city-config | ❌ |
| `plazas` | `[{name, a:[x,z], b:[x,z], w}]` | city-config, city-grid, buildings (Times Sq) | ❌ (Taipei equivalent: e.g. Ximending / Station front plazas — later) |
| `roads` | `[[name, width, dir, lanes, isHighway, flatPts], …]` (3,246 entries) | city-config → exported `ROADS` | ✅ as `roads[]` objects `{name, nameEn, highway, width, oneway, pts}` — richer/named fields, different shape; an adapter is needed for M1 |
| `roadGraph` | `{nodes: flat[], links, names}` — routable centreline graph for traffic | road-network (`GEO.roadGraph`) | ❌ not built in spike — roads are polylines, not a noded graph. Required for traffic in M1 |
| `blocks` | `[[flatPoly, lotRects, parkShare, parkName, isRect, frontageFrames], …]` (2,691 entries) — tuple format documented in `tools/build-geodata.mjs` | city-config → `BLOCKS`, buildings | ⚠️ partial: spike `blocks[]` are `{cx, cz, area, bbox}` (+ polygon omitted) from a raster component labelling — **no lot rects, no frontage frames**, and a different (object) shape |
| `parks` | `[{name, cat, acres, rings:[flat,…]}]` (116) | city-config, city-grid, nyc-map | ⚠️ partial: spike `parks[]` are `{name, ring}` — one ring, no `cat/acres`, shape differs |
| `centralPark` | `{bounds, outline, water[], lawns[], drives[], paths[], sites[]}` — bespoke sub-map | city-config, city-grid | ❌ (Da'an Forest Park would be the analogue; spike returns it as a normal park) |
| `piers` | `[{name, cx, cz, len, wid, ang, ring}]` (69) | city-config | ❌ n/a for the inland tile |
| `bridges` | `{queensboro, williamsburg, manhattan, brooklyn}: {a:[x,z], mid:[x,z], dir:[dx,dz]}` | city-config `makeBridge()` | ❌ spike roads crossing the Keelung River carry `bridge` info only via OSM tags on ways (not extracted into a bridges table) — M2 work |
| `landmarks` | `{ "English Name": {x, z, w, d, h, area, ring} }` (36 named) | city-config `LANDMARK_SITES` / `NYC_LANDMARKS` | ⚠️ partial: spike `landmarks{}` keyed by English name with `{x, z, w, d, name}` — **no `h`, `area`, or `ring`** |
| `points` | `{gwbManhattanTower, statueOfLiberty, pier17, …}: [x, z]` (10 named points) | city-config, city-grid | ❌ (could be filled from landmark centroids later) |

## What a *bootable* Taipei replacement additionally needs (M1 list)

1. An adapter or new `taipei-config.js` so runtime code never touches
   `streets`/`avenues`/`streetZ()`/`avenueX()` — those APIs are queried all over
   `city-config.js`, `traffic.js`, `controllers.js` (via the config exports).
2. `roadGraph` (noded nodes/links) built from the spike `roads[]` polylines —
   traffic routing depends on it.
3. `blocks` in (or adapted to) the tuple format with lot rects + frontage
   frames — `buildings.js` places every building from those.
4. `frame.cutZ/strip/sidewalk` equivalents, or removal of the shoreline logic
   that reads them.
5. A land/coastline representation to replace `manhattan` + `innerShore` for
   ground, water and culling code.
6. `bridges` entries for the Keelung River crossings so `makeBridge()` /
   the boroughs bridge builders can be reused.

**Bottom line:** the spike format covers the *geographic core* (frame, roads,
water, parks, landmark sites, block areas) in a Taipei-native shape. It is
deliberately **not** a drop-in `GEO` replacement — roughly half the upstream
fields are grid- or NYC-specific and must be designed away in M1 rather than
faked.
