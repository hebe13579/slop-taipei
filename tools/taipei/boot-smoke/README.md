# Boot smoke test (issue #59)

A standing, automated **browser boot smoke test** for the Taipei
build — the pre-merge check that the city actually constructs in a
real browser engine.

## Why it exists

The node suite never executes `js/taipei-boot.js`'s mesh builders.
On 2026-10-24 the live site hung forever at "Constructing Taipei":
PR #50's `buildSignalMesh` under-allocated its merged buffers and
threw a `RangeError` mid-boot, while every node test passed (fixed
in PR #58). The harness that reproduced the throw — local three.js
mirror + headless Chrome + a staging page running the real builders —
is now one repeatable command instead of a hand-rebuilt rig:

```sh
node tools/taipei/boot-smoke.mjs
```

Run it from the checkout you want to test (it smokes its own tree),
or point it elsewhere: `--root <checkout>`.

## What it does

1. Serves the checkout on a local static server.
2. Opens `stage.html` (this directory) in headless Chrome with WebGPU
   disabled, so `WebGPURenderer` takes its WebGL2 fallback — the
   backend phones without WebGPU use.
3. The stage page runs the **real** boot path:
   `loadSelectedTile('?city=taipei')` → `tile.loadBoot()` →
   `buildTaipeiGround(scene, tile, { buildCityBlocks })`, then starts
   the render loop.
4. The runner watches console, exceptions and page state until the
   build finishes, something throws, or a timeout rule fires.

**PASS requires all of:**

- zero uncaught exceptions (CDP `Runtime.exceptionThrown`),
- zero `window` error / `unhandledrejection` events,
- the stage page caught no error (`window.__error` unset),
- all 8 `[taipei-progress]` stages completed **in order**
  (ground → roads → junctions → medians → markings → decks →
  buildings → trees — the list pinned by
  `tests/taipei-progress.test.mjs` from `js/taipei-progress.js`),
- scene invariants: the `TaipeiGround` group exists with ≥ 10
  children and its `TaipeiBlocks` / `TaipeiWater` / `TaipeiParks` /
  `TaipeiRoads` / `TaipeiTrafficSignals` / `TaipeiStreetTrees`
  layers present, > 100 meshes overall, signal mesh non-empty,
- **at least one frame renders** after the build.

Console/log errors (a 404'd favicon is the usual one) are recorded in
the report as warnings, not failures — a failed module import still
fails the run, through the stage page's own error path.

The runner prints progress lines as stages complete, then a JSON
report (also written to `--report <file>` when given): verdict,
failure reason, per-stage list, exceptions, page errors, scene
invariants, build time, signal triangles, frames rendered, and — on a
stall — a live `Debugger` stack dump of the frozen page.

## Exit codes

| code | verdict | meaning |
|---|---|---|
| 0 | `pass` | build completed, no exceptions, invariants held, ≥ 1 frame |
| 1 | `fail` | exception/page error; stage page caught a builder error; a stage **stalled** (no progress for `--stall`s — report carries the stack dump); invariant failed; renderer produced no frame; or the overall timeout hit while **not** progressing |
| 2 | `inconclusive` | the environment couldn't run the smoke (no Chrome, no mirror + no CDN route, checkout lacks the boot files) — or the timeout hit while stages were **still completing** (slow machine, not a broken build) |

Timeout semantics, honestly: a stall is a FAIL with evidence; a
slow-but-progressing build at the deadline is INCONCLUSIVE. Re-run
standalone before treating an inconclusive as anything at all — on
this shared 2-CPU VM, parallel test batches are the usual cause.

Defaults: `--timeout 420` (overall), `--stall 120`, `--frame-wait
180`. A healthy run on the gate VM takes ~40 s unloaded, a few
minutes under load (the build itself is ~16–35 s; SwiftShader
renders about one full-city frame a minute, and only the first frame
is awaited — frame *counts* are never asserted).

## Prerequisites

- **Chrome/Chromium.** Discovered via `--chrome <path>`,
  `$CHROME_BIN`, the Puppeteer cache (`~/.cache/puppeteer/chrome/`),
  or `PATH`. None found → inconclusive, never a fake pass.
- **three.js.** The shipped site loads three.js from jsDelivr and
  that is unchanged — this tool never touches what the site loads.
  This sandbox's Chrome cannot reach the CDN (issue #38), so when a
  local mirror exists the server rewrites the importmap in served
  HTML to it. Mirror lookup: `--mirror <dir>`,
  `$TAIPEI_THREE_MIRROR`,
  `~/workspace/slop-taipei/streak-gate-boot/three-mirror` (this VM's
  copy). A mirror is a three.js checkout with `build/` +
  `examples/jsm/`. With no mirror, the CDN is probed once: reachable
  → pages served untouched; unreachable → inconclusive.

Nothing is vendored into the repo and no runtime file changes: the
tool is `tools/taipei/boot-smoke.mjs` + this directory's `stage.html`
(dev-only, never linked from the game).

## The gate

For any PR touching `js/taipei-boot.js` or a builder it calls, the
merge gate is:

```sh
node --test tests/*.test.mjs tests/*.test.cjs
                                   # baseline: only the known
                                   # tests/boot.test.cjs failure
node tools/taipei/validate.mjs     # ALL CHECKS PASSED
node tools/taipei/boot-smoke.mjs   # exit 0
```

## Scope — what this does not cover

- **index.html's full app boot** (renderer PMREM/environment setup,
  avatar, traffic, UI): full-app boot in this VM stalls for an
  unrelated pre-existing reason (issue #38). The smoke covers the
  construction path that actually broke — the ground/city builders
  plus renderer init plus real frames — with real data.
- The NYC tile: Manhattan's boot is upstream's and is not staged
  here; the stage page selects `?city=taipei` explicitly.
- Visual correctness: the smoke asserts structure and liveness, not
  pixels. The user's phone playtest remains the visual verdict.
