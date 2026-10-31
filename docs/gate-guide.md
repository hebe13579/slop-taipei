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
- VM restarts recur and wipe `/tmp` — keep all scripts and evidence
  under the workspace, never `/tmp`; workers commit/push early.
- Local git push has NO credentials — push via the Git Data API only.
- Never `pkill -f` a pattern that matches your own shell command line
  (it kills your own exec); kill orphaned processes by PID.
- Screenshot rig: `gate-tools/shot-gate.mjs <root> <outPng> <x> <z> <r>
  [waitSec]` (4 attempts × 180 s + 8 s sleeps).
