# Slop Taipei gate guide

How a PR gets merged to `main`, and the traps the gate has already caught.
This is the durable home for gate mechanics; the merge policy itself is the
maintainer's call (currently: verify on a merged tree, two independent check
passes — tests/boot and frames/live — and the maintainer keeps the final
merge call; workers open PRs unmerged).

## The gate recipe

1. Verify the PR on GitHub (open, head SHA, mergeable).
2. Fresh clone of current main; merge the PR head (two-parent commit
   `[PR head, main head]` when the PR's base is stale).
3. Run the relevant `tests/*.test.*` — the FULL battery for any change that
   moves the plan or geodata (see the composition-sensitive list below).
4. `node tools/taipei/validate.mjs` must print ALL CHECKS PASSED.
5. Standard boot-smoke is mandatory: `node tools/taipei/boot-smoke.mjs`
   exit 0 (1 = fail, 2 = inconclusive — retry once, never pass on 2).
6. Push the gated tree via the GitHub Data API (blobs → tree with
   `base_tree` → **assert the remote tree SHA == the locally gated tree
   SHA** → commit → update ref), then API-merge.
7. Verify main's tree == the gated tree, close the issue with an evidence
   comment, confirm Pages shows "built", append one plain line per merge to
   `docs/release-notes/YYYY-MM-DD.md`.
8. `tests/landmark-road-overlap.test.mjs` must pass UNEDITED.

## Traps, each learned the hard way

- **Exit-code capture (the #186 masked-exit failure):** never put a
  command substitution before `$?` in the same string
  (`echo "$(basename $f) exit=$?"` always prints 0 — the substitution runs
  first and resets `$?`). Capture `ec=$?` on its own line immediately
  after the command, then echo `$ec`. Verify suite results from the
  `ℹ pass/fail` lines inside the per-file logs, not from echoed exit
  codes alone.
- **Long-probe completion deliveries can lie (#281/#291 gates):**
  background completion notices for long Chrome probes have twice
  reported success that no disk file supports (the #281 frame-cost
  numbers — 5.1 ms / +8.4 ms / 3.84M tris / 797/800 placed — were
  retracted by the continuation builder; the #291 coordinator first
  reported a boot-smoke pass from an unverified notice, then corrected
  it after checking the primary log). Verify every probe result from
  the output file and log tail on disk before reporting or publishing
  it.
- **Parse-check after unions:** after any scripted conflict/union
  resolution, run `node --check` on every touched file before running
  tests. A non-parsing test file fails at load inside a loop and is easy
  to miss (taipei.test.mjs shipped to main unparseable this way).
- **Composition-sensitive test files:** on any merged tree that changes
  the plan or geodata, re-run ALL of these even when the PR didn't touch
  them: `heights`, `landmark-facades`, `taipei-mrt`, `taipei.test`,
  `taipei-airfield`, `taipei-surfaces`, `streetscape2`, `green-overlap`,
  `green-land`, `green-tint`. They pin tile-wide census numbers that move
  with any composition change.
- **Generated-file unions:** check array ORDER, not just counts — the
  planner seeds lot draws by block index, so a reordered `blocks` array
  silently re-rolls the whole city.
- **Merge-commit footgun (#236 gate):** `git add -A` clears a file's
  unmerged state even when conflict-marker text remains inside it, so a
  merge CAN commit with `<<<<<<<` markers in a file. Always
  `grep -rn '<<<<<<<'` across js/tests/tools before committing any merge,
  and `node --check` every resolved file.
- **push_gate.py shape (#236 gate):** `gate-tools/push_gate.py` diffs
  `HEAD^1` → `HEAD` and applies that onto main's tree, so the gated tree
  must be ONE commit sitting directly on the remote main SHA. If the gate
  clone's history doesn't contain main, `git fetch <repo> main` first and
  squash (`git reset --soft FETCH_HEAD` + one commit) before calling
  it — extra commits on top make the tree assertion fail with
  TREE MISMATCH. The helper's branch argument must be the PR's actual head
  ref and must already exist on the remote (#232).
- **Same-file composition (#248 gate):** when two PRs edit the same file,
  the gated blob is a UNION of both hunks — never build the remote tree
  from one PR head's blobs alone (that silently drops the other PR's
  hunk, as the #243 farFade opt-in was nearly dropped from
  taipei-buildings.js). Always upload the locally merged blob and assert
  the remote tree SHA == the locally gated tree SHA before creating the
  gate commit. If anonymous `git fetch` stalls, a local clone of the
  worker's clone plus a tree-SHA check against the API head is a valid
  substitute for fetching the PR head. Note: the Data API rejects
  abbreviated parent SHAs with 422 — always pass full 40-char SHAs — and
  a commit whose tree exists only locally is rejected the same way:
  create the blobs and the tree on the remote first.
- **ghapi.py calling convention:** `ghapi.py` takes the method and path
  as POSITIONAL args (`ghapi.py GET /repos/...`); `-d` is the JSON
  request *body*, not a method flag — the `-d '{"method":...}'` form
  403s. For large payloads use a Python urllib script with
  `add_surrogate_to_request(req, 'custom.github',
  allowed_hosts=['api.github.com'])` from
  `/opt/muse/skills/custom-connector-setup/bin/dynamic_credentials.py`.
- **Stage-page detail focus (#247 gate):** the boot-smoke stage page fills
  the detail-stream pools ONCE around its default focus (0, 62) and never
  calls `update()` — so a shot-gate frame at a distant cell shows
  massing/facades/ground only, with EMPTY detail pools (no HVAC, huts, or
  other instanced detail), and a before/after pair there reads identical
  even when the change is real. For any detail-pool visual evidence,
  shoot with the focus-forcing driver `gate-tools/shot-focus.mjs`
  (serves the worker probe-stage page, which calls
  `cityBlocks.update(x, z, true)` and counts the target pool) — and
  prefer the numeric pool count over the PNG when captures starve.
- **Stale-base identity proofs don't survive the merge (#264 gate):** a PR
  that proves "plan byte-identical" on its stale base can still move lots
  on the merged tree when a newer main feature probes the changed data
  through an unguarded path — #264 guarded the frontage-pull probe but
  not the #270 facing-pass probes, so 502 lots re-seated on the merged
  tree while 0 moved on the branch tree. Gate must re-prove byte-identity
  (full-field diff, not key-only) on the MERGED tree, never trust a
  branch-tree proof, and the fix is to extend the guard to the new probe
  path, not to re-pin the tests to the moved city.
- **Two check workers can produce different trees (#269 gate):** when two
  checkers merge the same PR, their conflict resolutions can differ
  (there, exactly one file: the conflicted test's expectation). Always
  diff the candidate gated trees; gate the one the full battery proves.
  Runtime-file identity is what lets the other worker's live evidence
  carry over.
- **Registry-part plan diffs (#306 gate):** for a PR that changes landmark
  registry parts, the plan-diff criterion is "lots identical and the diff
  limited to the intended landmarks", NOT an empty diff — `resolveLandmark()`
  serializes parts into the plan output, so any registry part change
  necessarily appears in it. An empty diff is the right criterion only
  for adapter-only PRs that touch no registry or geodata.

## Geodata composition doctrine

NEVER ship a full regeneration — it re-rolls the city (planner seeds lot
draws by block index; blocks are land-minus-water raster components,
area-sorted). Instead: regenerate (or compute the one derived section)
on merged inputs, transplant ONLY the intended section(s) into main's
geodata text (sections are single-line `"key":[...]` spans; splice by
bracket-matching or anchor insertion), then section-audit parsed JSON vs
main — everything except the intended section(s) must be IDENTICAL.
Disclose in the close comment that shipped blocks stay cut against older
inputs and a future full regen re-cuts them (known drift class).

## Environment notes

- 2-CPU VM; SwiftShader is slow; load saturates tests/screenshot rigs
  into false timeouts — run decisive tests solo, and expect screenshot
  captures to fail under worker contention and retry.
- **Boot-smoke runs solo (#307 gate):** run boot-smoke with nothing else
  on the machine — the first attempt stalled under contention (battery +
  2 planner runs concurrently); the clean standalone re-run passes. A
  freeze with no page errors under load is starvation until proven
  otherwise; retry in a quiet window before concluding a product defect.
- VM restarts recur and wipe `/tmp` — keep all scripts and evidence
  under the workspace, never `/tmp`; workers commit/push early.
- Local git push has NO credentials — push via the Git Data API only.
- **Never `cp -a` a worktree clone (#253 build):** a clone whose `.git`
  is a worktree-link file shares its admin dir with the parent clone, so
  a `git checkout` in the copy moves the shared HEAD in the work clone
  too. Delete the copy's `.git` immediately (serve it as a plain root),
  or seed from a clone with a real `.git` directory. Verify a clone's
  tree SHA equals the API head's tree SHA before working — seed clones
  go stale.
- Never `pkill -f` a pattern that matches your own shell command line
  (it kills your own exec); kill orphaned processes by PID. Killing a
  probe's shell wrapper orphans the node process, which keeps writing
  into the shared log/json — kill the NODE pid, not the shell (found by
  the #293 live-probe worker, 2026-11-01).
- Screenshot rig: `gate-tools/shot-gate.mjs <root> <outPng> <x> <z> <r>
  [waitSec]` (4 attempts × 180 s + 8 s sleeps).
- **Canvas-first screenshots:** `Page.captureScreenshot` is broken on
  this machine's Chrome (0/~20 successes, even a 240 s probe on a
  healthy booted stage) while `canvas.toDataURL` with a 300 s timeout
  works — the rig's 60 s canvas timeout was far too short at ~30 s/frame.
  Shoot canvas-first; the working rigs are
  `shot-292b-v2-b3-canvas.mjs` and `shot-292b-v2-az-b3-canvas.mjs` in the
  #292 frames evidence (`xinyi289-gate-evidence/frames-B/`).
- **Real-page frame pumping:** on the real page headless Chrome produces
  NO frames: rAF never fires on its own, `HeadlessExperimental.beginFrame`
  does not exist in this Chrome, `Page.captureScreenshot` never returns on
  the real page (works on about:blank), `canvas.toDataURL` never returns
  (300–600 s timeouts), virtual-time grants and metrics-override advance
  nothing on the real page (they pump rAF on about:blank only). To drive
  rAF-gated applies without frames, use a disclosed rAF shim (global rAF
  → setTimeout(0), installed after boot, restored at the end — the app's
  own loop was registered at boot with the original rAF and is untouched)
  plus direct `update()` calls for placement (pure data work). Frame rate
  on a real device is still unmeasured by any headless probe — say so,
  never invent a number (probe method proven by the #293 live-probe
  worker, 2026-11-01, `sliders281-gate-evidence/logs-live/`).

