// js/taipei-progress.js
// Staged construction progress for the Taipei boot (issue #63).
//
// buildTaipeiGround (js/taipei-boot.js) used to run as one synchronous
// block behind a static "Constructing Taipei" loader: the bar never
// moved, and when boot died mid-construction (the 2026-10-24 P1 hang,
// PR #58) the frozen stage string said nothing about where it died.
// The build now reports REAL progress: one completion per stage, in
// the order the builders actually run, weighted by measured stage
// cost (weights calibrated on the boot smoke's stage timings — see
// the PR for #63) so the bar spends its travel where the build spends
// its time. No smoothing and no time-based estimates: the fraction
// advances only when a stage has actually finished, and a stall
// freezes the bar on the stage that is stuck — which is the point.
//
// This module is pure data + bookkeeping (no imports) so the node
// suite can pin the stage list, the weights and the monotonicity
// contract; the browser-side wiring lives in js/taipei-boot.js
// (stage boundaries + yields) and js/main.js (loader UI).

// Weights: each stage's share of the total measured build time in
// the issue-#63 boot smoke (gate VM, SwiftShader; stage ms 249 /
// 2,924 / 1,046 / 2,887 / 14,957 / 143 / 6,693 / 5,102 of 34,001 ms
// total — markings & signals is the single heaviest stage, then
// buildings, then trees). Device proportions will differ in detail;
// the ranking is the builders' own cost profile.
export const TAIPEI_BUILD_STAGES = Object.freeze([
  Object.freeze({ id: 'ground', label: 'Ground, blocks, water & parks', weight: 0.007 }),
  Object.freeze({ id: 'roads', label: 'Roads & sidewalks', weight: 0.086 }),
  Object.freeze({ id: 'junctions', label: 'Junctions & roundabouts', weight: 0.031 }),
  Object.freeze({ id: 'medians', label: 'Medians & painted walkways', weight: 0.085 }),
  Object.freeze({ id: 'markings', label: 'Markings & signals', weight: 0.440 }),
  Object.freeze({ id: 'decks', label: 'Elevated decks', weight: 0.004 }),
  Object.freeze({ id: 'buildings', label: 'Buildings & landmarks', weight: 0.197 }),
  Object.freeze({ id: 'trees', label: 'Street & park trees', weight: 0.150 }),
]);

const STAGE_BY_ID = new Map(TAIPEI_BUILD_STAGES.map((s) => [s.id, s]));
const TOTAL_WEIGHT = TAIPEI_BUILD_STAGES.reduce((sum, s) => sum + s.weight, 0);

// Tracks stage completions for one build. `complete(id)` is called
// by the boot exactly once per stage, after that stage's work is
// done; it fires onProgress({ stage, label, detail, index, total,
// fraction }) and returns the new fraction. The fraction is the
// completed stages' weight share of the total weight, so it is
// monotonic by construction and reaches exactly 1 when the last
// stage completes. Completing a stage twice does not double-count
// (defensive: a stray second call returns the current fraction);
// an unknown stage id is a programming error and throws.
export function createBuildProgress(onProgress) {
  const completed = new Set();
  let completedWeight = 0;
  let fraction = 0;
  return {
    complete(id, detail = '') {
      const stage = STAGE_BY_ID.get(id);
      if (!stage) throw new Error(`unknown Taipei build stage: ${id}`);
      if (completed.has(id)) return fraction;
      completed.add(id);
      completedWeight += stage.weight;
      fraction = completedWeight / TOTAL_WEIGHT;
      if (typeof onProgress === 'function') {
        onProgress({
          stage: id,
          label: stage.label,
          detail,
          index: completed.size - 1,
          total: TAIPEI_BUILD_STAGES.length,
          fraction,
        });
      }
      return fraction;
    },
    get fraction() { return fraction; },
    get done() { return completed.size === TAIPEI_BUILD_STAGES.length; },
  };
}
