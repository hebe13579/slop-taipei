# Sandbox / demo mode (`?sandbox=`)

A small slice of the Taipei tile for iterating fixes fast, without the
full-city load/restart wait. URL param only (v1 — no settings-gear UI).

## Usage

- Arbitrary lat/lng + radius: `?sandbox=<lat>,<lng>,<radius_m>`
  (e.g. `?sandbox=25.0330,121.5650,800`). Radius defaults to 800 m when
  omitted.
- District presets: `?sandbox=xinyi` (same path — each preset is a named
  lat/lng + radius).

| preset | centre | radius |
|---|---|---|
| `xinyi` | 25.0330, 121.5650 — Taipei 101 | 800 m |
| `beitou` | 25.1367, 121.5065 — Beitou Park / Thermal Valley | 1000 m |
| `shilin` | 25.0911, 121.5247 — Shilin MRT station | 1000 m |
| `daan` | 25.0325, 121.5295 — Yongkang Street | 800 m |
| `zhongshan` | 25.0478, 121.5170 — Taipei Main Station | 800 m |
| `songshan` | 25.0490, 121.5610 — Songshan Cultural Park / Taipei Dome | 800 m |

## Rules

- The sandbox is a **square** of side 2 × radius centred on the lat/lng
  ("radius" is the half-side — the union/clipping machinery is all
  boxes, so a circle would need a second shape through every consumer).
- Radius is **clamped to 200–3000 m** (with a console warning) so a huge
  radius cannot silently become the full city.
- A **malformed param** (bad numbers, unknown preset name, non-positive
  radius) falls back to the **full city** with a console warning.
- An **empty box** (ocean, outside the tile) still boots — the ground
  plane renders, the plan is empty, and the loading overlay shows
  "Sandbox is empty — nothing inside …" until clicked. Never a blank
  crash.
- With **no `?sandbox=`** the loaded geo is the generated geo untouched
  (the identical object) — the live site cannot change. Proven in
  `tests/taipei-sandbox.test.mjs` (reference identity) and by the full
  battery staying green.

## How it works

`js/taipei-sandbox.js` is the thin wrapper the three geodata importers
(`js/taipei-adapter.js`, `js/taipei-tile.js`, `js/taipei-traffic.js`)
read instead of the generated file. When the param is present it filters
the generated geo down to the box at load time; everything downstream
(planner, adapter, boot, traffic) is unchanged.

- Roads/roadbeds/MRT decks/elevated roads/runways are **clipped** to the
  box edge (Liang–Barsky per segment); a polyline that exits and
  re-enters comes back as separate pieces, never a chord across the
  outside. MRT deck heights and runway half-widths interpolate at the
  clip points.
- Rings (water/parks/green/schools/airfield surfaces/loop sites) are
  clipped (Sutherland–Hodgman); a ring fully containing the box clips
  to the box itself. Skybridges are keep-if-intersect (their widths are
  per-segment).
- `frame.boxes` becomes the single sandbox box, which is what keeps
  planner lots inside (the planner already drops lots outside the
  union). `frame.originLatLon` is **never** changed — the landmark
  registry resolves its pins through it.
- `geodata.landmarks` drops out-of-box pins. Dropping `Taipei 101` is
  what gates `plan.tower` (the planner builds it only when the pin
  exists), so a sandbox without 101 has no tower. The tile guards the
  missing pins: spawn falls back to the box centre, teleports shrink to
  the pins that survived.
- The `LANDMARK_STRUCTURES` registry is static code, not geodata, so
  the boot passes the box as `planTaipeiBuildings`' `opts.bounds` and
  the planner filters landmark/site structures by pin.
- Road-graph edges stay only when **both** endpoints are inside the box,
  so traffic can never be routed outside the ground plane. Nodes stay
  (edge indices must stay valid).
- Terrain grids are kept when their bounds intersect the box (sampled by
  position, harmless outside it).

## Honest limit

The sandbox city is **NOT pixel-identical** to the same streets in the
full city. The planner seeds lot draws by block index, and filtering
renumbers the blocks, so lots re-roll inside the box. The sandbox is for
testing the fix, not for verifying exact full-city placement; the full
gate still runs before any merge.

## Measuring it

- Planner in Node (gate VM): full city 35.1 s cold / 27.5 s warm;
  Xinyi sandbox 0.5 s; Beitou sandbox 0.5 s.
- Boot-smoke takes a `--query` flag now, e.g.
  `node tools/taipei/boot-smoke.mjs --query 'city=taipei&sandbox=xinyi'`
  (the stage page forwards its own query string to `loadSelectedTile`).

## Residuals (disclosed)

- A school campus or height footprint straddling the box edge keeps its
  original `area`/`stats` after its ring is clipped — the geometry is
  right, the stats are stale. Cosmetic, border-only.
- A clipped campus's pitch placement follows the clipped ring; a pitch
  that sat on the clipped-away part is not re-planned.
- The sandbox re-rolls lots (see the honest limit above) — by design,
  not a bug.
