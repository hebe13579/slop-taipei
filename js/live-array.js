// js/live-array.js
// Refill a live array in place, in bounded chunks (issue #407).
//
// main.js and js/taipei-boot.js hand the controller / map system arrays
// that are refilled in place on every rebuild — the consumer holds the
// array by reference, so the refill must keep the same object
// (`target.length = 0`, then append) rather than reassigning it.
//
// The naive refill — `target.push(...a, ...b)` — passes every element
// as a function argument. On the merged tree the collider set is
// ~100k entries, past some browsers' max argument count, and the live
// site died at boot with `RangeError: Maximum call stack size exceeded`
// in `syncAllColliders` (main.js:226, 2026-11-15). The chunks here are
// 8,192 elements at a time, far below every engine's argument limit,
// so a plan-scale refill can never cross it again.
//
// This module is pure (no imports) so the node suite can pin it, the
// same way js/taipei-progress.js is pinned.

export const LIVE_ARRAY_CHUNK = 8192;

// Empty `target` in place, then append every source in order. Nullish
// sources are skipped (the boot passes `cityBlocks?.colliders`, which
// is undefined before the first build). Returns `target`.
export function refillLiveArray(target, ...sources) {
  target.length = 0;
  for (const source of sources) {
    if (source == null) continue;
    for (let i = 0; i < source.length; i += LIVE_ARRAY_CHUNK) {
      target.push(...source.slice(i, i + LIVE_ARRAY_CHUNK));
    }
  }
  return target;
}
