# Slop Taipei — Flat-Basin Prototype Scope

Forked from [mrdoob/slop-newyork](https://github.com/mrdoob/slop-newyork) (MIT) on 2026-10-23.
Upstream at fork time: commit `12593c9963f141665fe91881b1b4a2290db51d15`, default branch `main`.

Goal of this document: define the smallest Taipei version that proves the whole
upstream pipeline (geodata → blocks → buildings → traffic/pedestrians) works on
Taipei geography, *before* expanding to the full basin.

## Core decision: flat basin first

The upstream detailed city is completely flat (Manhattan road deck is y = 0;
traffic, pedestrians and controllers all assume it). The only elevation upstream
is hand-tuned scenery (the Palisades ridge in `js/boroughs.js`).

Taipei works with the same trick because the city centre sits on a flat basin floor:

- **Playable (detailed, flat):** the basin floor.
- **Scenery (non-drivable):** the mountain rim — Yangmingshan (north),
  the Four Beasts / Nangang hills (east), the Linkou terrace and
  Guanyinshan across the Tamsui (west), the Xindian foothills (south) —
  generated from DEM data the way `boroughs.js` builds its ridge.
- **Explicitly out of scope for the prototype:** drivable elevation
  (Yangmingshan / Maokong / Wuzhishan mountain roads), MRT (elevated or
  underground), New Taipei districts, real per-building heights/textures.

## Prototype tile (Milestone 0–2 target)

Start with one tile, not the whole city — upstream's detailed Manhattan is
only ~2–3 km × ~13 km, and performance is tuned around that scale.

**Tile: Xinyi / Da'an / Songshan, approx. 4 km × 4 km**
- Bounds (approx.): lon 121.535–121.580, lat 25.020–25.060
- Why this tile:
  - Xinyi Special District is a planned, near-true-north grid — the closest
    Taipei analogue to the Manhattan grid the code was written for
    (world-frame bearing can be ~0° instead of Manhattan's 29.02°).
  - Contains a hero landmark: **Taipei 101**.
  - Contains a park test case: **Da'an Forest Park** (the Central Park slot:
    lawns, water, paths).
  - Northern edge is the **Keelung River**, so the tile exercises rivers and
    bridges from day one.
  - Elephant Mountain sits just east of the tile — a close-in scenery test
    for the DEM mountain ring.
- Frame origin (proposed): Taipei 101 / Xinyi Rd & Songren Rd area
  (25.033, 121.565), 1 unit = 1 m, x = east, z = south, bearing 0°.

Expansion after the tile works (Milestone 3+): west to Taipei Main Station /
Ximending / the Tamsui River, then north across the Keelung River.

## Data sources (all open)

| Need | Source | Notes |
|---|---|---|
| Roads, bridges, parks, rivers, landmark footprints | OpenStreetMap via Overpass API (same mechanism as upstream `tools/overpass.sh` + `tools/data/q_*.overpassql`) | © OSM contributors, ODbL — attribution required |
| Mountain scenery | Taiwan 20 m DEM (data.gov.tw / NLSC, OGDL-Taiwan-1.0) or SRTM as fallback | Used only for the non-drivable rim |
| Building heights (if wanted later) | OSM `height` / `building:levels` where present | Prototype uses upstream-style procedural heights by district, like NYC |

### The CSCL → OSM translation problem (main pipeline work)

Upstream streets come from NYC's CSCL centerline file with fields OSM doesn't have
one-for-one. The Taipei builder must synthesise them:

| CSCL field (upstream) | OSM equivalent |
|---|---|
| `full_street_name` (uppercase English) | `name` (Chinese) + `name:en` where present |
| `streetwidth` (ft, curb-to-curb) | `width` (sparse) → infer from `highway` class + `lanes` with a width table |
| `trafdir` (FT/TF/TW) | `oneway=yes/-1` (sparse outside arterials) |
| `rw_type` (street/highway/bridge/…) | `highway` class + `bridge=yes` / `tunnel=yes` / `layer` |

## Work packages

1. **`tools/taipei/` fetch + build (replaces the NYC inputs of `tools/build-geodata.mjs`)**
   - Overpass queries for the tile bbox: roads, water/riverbanks, parks, landmarks.
   - `geo-base` frame: new `LAT0/LON0`, bearing ~0°, new origin.
   - Land/water inversion: upstream land = one island polygon in a water plane;
     Taipei land = tile polygon *minus* river polygons (Keelung River at the
     tile's north edge in the prototype; Tamsui/Xindian when expanded).
   - Blocks: reuse the raster cutter in `tools/geo-blocks.mjs`
     (stamp roadways over land raster → label curb islands → lot rects).
     Lot frames must use each block's principal axis instead of the
     Manhattan grid frame for irregular blocks.

2. **De-grid `js/city-config.js`**
   - Delete/neutralise the numbered-street API (`streetZ(n)`, avenue table,
     ordinal names, 79.5 m street spacing assumptions).
   - Location labels, teleports and traffic routing must run on the generic
     road graph (upstream already has one: `tools/geo-roadgraph.mjs`, used for
     non-grid Lower Manhattan — that is the template).
   - `districtAt()` → Taipei district polygons (Xinyi / Da'an / Songshan in-tile).

3. **Landmarks (prototype set)**
   - Taipei 101 — one custom model, the Empire State Building slot
     (stacked-segment massing is a good fit for the existing landmark builder).
   - Sun Yat-sen Memorial Hall + park, Taipei City Hall, Da'an Forest Park.
   - Later: Chiang Kai-shek Memorial Hall, Grand Hotel (scenery, on its hill),
     Presidential Office Building, Longshan Temple, Taipei Main Station,
     Songshan Airport.

4. **Bridges**
   - Reuse the parametric builders in `js/boroughs.js`
     (suspension / cantilever / simple deck profiles, colliders,
     building-exclusion corridors under approaches).
   - Prototype: the Keelung River crossings at the tile's north edge
     (e.g. Minquan Bridge; Dazhi Bridge as the cable-stayed stretch goal —
     that type needs one new builder).
   - Simple beam bridges can be plain road-graph decks over the water cut.

5. **Mountain scenery ring**
   - DEM → low-detail mesh ring around the tile/basin, textured like the
     boroughs scenery; `ridgeHeightAt()`-style height function so scenery
     buildings/bridges can sit against it. Non-drivable, no roads.

6. **Taipei flavour (after it boots)**
   - Scooter: reskin/re-tune the bicycle actor + controller; mixed
     scooter/car traffic is *the* Taipei street signature.
   - Chinese street signage in the canvas sign system (check CJK font coverage),
     MRT station entrances as street details, night-market street props.

7. **Tests + hosting**
   - Upstream tests hardcode NYC (`tests/geodata.test.mjs`, `teleports.test.cjs`,
     `nyc-map.test.cjs`, `overpass.test.mjs`) — port or replace per milestone.
   - This fork is public, so GitHub Pages can serve it
     (`hebe13579.github.io/slop-taipei`) once a build boots — same as upstream.

## Milestones

- **M0 — Geodata spike:** Taipei tile geodata file generated; upstream game boots
  on it with roads, water and blocks rendering (landmarks/traffic may be stubbed).
- **M1 — It drives:** road-graph traffic + pedestrians + all camera modes work
  in the tile; no NYC street/avenue API left in the runtime path.
- **M2 — It reads as Taipei:** Taipei 101, Da'an Park, Keelung River bridges,
  mountain ring, Chinese signage.
- **M3 — Expand:** west to Taipei Main Station / Tamsui River; second river +
  Taipei Bridge; CKS Memorial Hall.
- **M4 — Flavour:** scooters in traffic, MRT entrances, night market.

## Known risks

- **Scale/performance:** the full basin (~12 km × ~10 km) is several times
  upstream's detailed area — hence tile-first.
- **OSM completeness:** road widths and one-way tags are patchy; the width
  inference table will need hand-tuning per road class.
- **WebGPU only:** upstream needs a WebGPU browser (Chrome/Edge); same for us.
- **Upstream is 3 days old and moving fast** (created 2026-10-20, 45+ commits):
  expect merge drift if we track upstream; pin work to the fork commit above
  and rebase deliberately.

## Future tile: Beitou (noted 2026-10-23 — NOT queued)

The user used to live in Beitou and wants it included eventually, as a **second,
separate rectangle tile** (its own scene, selected like `?city=beitou`) — not by
enlarging the Xinyi tile. Beitou is ~11 km NW; a single rectangle covering both
(~9 × 13 km, incl. Shilin, Shezi Island and the Yangmingshan foothills) is too
large and reintroduces mid-map terrain.

- Proposed bounds: lon 121.485–121.530, lat 25.115–25.155 (~4.5 × 4.4 km, same
  scale as the M0 tile). Origin: Xinbeitou / Beitou Park (~25.136, 121.508).
- Covers: Beitou + Xinbeitou MRT stations, Beitou Park, Beitou Hot Spring Museum,
  Beitou Library, Thermal Valley (地熱谷), the Guangming Rd hot-spring strip,
  Beitou Creek, Guandu plain / Tamsui River bank at the west edge.
- Terrain approach: playable area is the flat Beitou Creek valley floor;
  Datunshan / Yangmingshan to the north and east are scenery ring, same as the
  main tile's mountain treatment. Thermal Valley gets the park + water treatment.
- Landmark care list (personal to the user): Beitou Library, Hot Spring Museum,
  Thermal Valley, Beitou Park, Xinbeitou station.
- Status: **scope note only, per the user's instruction on 2026-10-23. Do not
  start, queue, or create issues for this tile until the user says so.**
  Prerequisite: the M1 tile registry design (tile id → geodata/origin/teleports)
  so Beitou plugs in without a refactor.

## License / attribution checklist

- Keep upstream `LICENSE` (MIT, © Mr.doob) and add our own copyright line for changes.
- Credit © OpenStreetMap contributors (ODbL) and, if used, Taiwan open data
  (OGDL-Taiwan-1.0) in the README, mirroring upstream's "License and data" section.
