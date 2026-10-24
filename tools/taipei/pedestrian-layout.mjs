// tools/taipei/pedestrian-layout.mjs — the per-road pedestrian layout
// classifier for Taiwan streets (TAIWAN_STREETSCAPE.md §b/§c), shared by
// build-taipei-geodata.mjs and build-generation-map.mjs so the two
// builders can never disagree about a way's layout. NOT the upstream
// uniform 4.6 m sidewalk assumption: big roads get formal sidewalks, 弄
// alleys and other narrow ways are fully shared, and a colonnade-covered
// way is a 騎樓 arcade. An explicit OSM sidewalk tag beats the
// class/width inference; sidewalk=no falls through.
// Painted walkways (標線型人行道, §c.3) are the standard fix on 8–12 m
// streets and wider lanes lacking a raised sidewalk or arcade — NOT on
// narrow ways: sub-8 m 巷/弄 and ordinary streets are fully shared
// space with no pedestrian geometry (§c.4). (Issue #16: the previous
// rule painted any 巷 and anything < 8 m, which put green bands on
// 98% sub-8 m roadbeds, where they read as bike lanes.)
// Painted is also never a MAIN-road treatment (issue #25): a trunk /
// primary / secondary way is a main road whatever its mapped width —
// the 8–12 m population on those classes is unmerged fragments and
// junction fans of wide arterials (信義路, 仁愛路, 敦化南路…), and a
// green band on them reads as a bike lane on the main carriageway.
// Those take the formal-sidewalk fallback instead.
const MAIN_ROAD_CLASSES = new Set([
  'motorway', 'motorway_link', 'trunk', 'trunk_link',
  'primary', 'primary_link', 'secondary', 'secondary_link',
]);
export function pedestrianLayout(tags, width) {
  // A deck (layer >= 1, or any bridge tag) is not a street: it carries
  // no pedestrian layout at all — no painted stripes, no sidewalk band.
  // 'shared' is the enum's no-geometry value (issue #22).
  if (parseInt(tags.layer || '0', 10) >= 1 || (!!tags.bridge && tags.bridge !== 'no')) return 'shared';
  if (tags.arcade || tags.covered === 'colonnade') return 'arcade';
  const sw = [tags.sidewalk, tags['sidewalk:both'], tags['sidewalk:left'], tags['sidewalk:right']];
  if (sw.some((v) => v && !['no', 'none'].includes(v))) return 'sidewalk';
  const name = tags.name || '';
  if (tags.service === 'alley' || name.includes('弄') || width < 8) return 'shared';
  if (width <= 12 && !MAIN_ROAD_CLASSES.has(tags.highway || '')) return 'painted';
  return 'sidewalk';
}
