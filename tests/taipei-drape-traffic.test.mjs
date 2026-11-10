// Issue #285: AI traffic cars sit on the draped road surface
// instead of driving at y=0 under it.
//
// Proves, against the real geodata: (a) the census — drape
// profiles ride the live and deck graphs and the ground graph is
// unchanged; (b) the issue's example climb (崇仰七路25巷) is a
// service road no AI car ever drives, so the acceptance case is
// 劍潭路 (the 圓山大飯店 approach) and 小坪頂路 (worst burial);
// (c) the profiles match the draped terrain at their endpoints
// and the player's drive model returns the draped ground at
// drape-road points; (d) with the drape switched off the graph
// is the pristine deck graph (plus one digest peak the 2 m
// profile step resolves).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TAIPEI_GEO } from '../js/taipei-geodata.js';
import { drapeHeight, setDrapeEnabled } from '../js/taipei-drape.js';
import { buildTaipeiRoadGraph } from '../js/taipei-traffic.js';
import { buildDriveModel } from '../js/taipei-drive.js';

const live = buildTaipeiRoadGraph(TAIPEI_GEO, { includeDecks: true, includeUnderpass: true });
const deck = buildTaipeiRoadGraph(TAIPEI_GEO, { includeDecks: true });
const ground = buildTaipeiRoadGraph(TAIPEI_GEO);
const names = live.roadGraph.names;
const nodes = live.roadGraph.nodes;

test('drape census: profiles ride the live and deck graphs, ground unchanged (issue #285)', () => {
  // Live: links 13,433 and heightSplits 1, unchanged from
  // pristine — the 復北地下道 approaches are whole again (the
  // underpass profiles now carry the draped terrain at the mouths,
  // so no split fires at the grade crossing). DeckLinks 372 ->
  // 398 and deckKm 163.7 -> 168.8 (see the deck test: flat
  // bridges in the drape region now carry profiles, plus one
  // digest peak the 2 m profile step resolves), drapeLinks 3169 /
  // drapeKm 328.8 (the new ground profiles), underpassLinks 6 /
  // underpassKm 1.3 (unchanged). KeptKm is unchanged: no road
  // length is lost or added, only link boundaries move.
  assert.equal(live.stats.drivableEdges, 29135);
  assert.equal(live.stats.links, 13433);
  assert.equal(live.stats.keptKm, 1419.6);
  assert.equal(live.stats.deckLinks, 398);
  assert.equal(live.stats.deckKm, 168.8);
  assert.equal(live.stats.heightSplits, 1);
  assert.equal(live.stats.drapeLinks, 3169);
  assert.equal(live.stats.drapeKm, 328.8);
  assert.equal(live.stats.underpassLinks, 6);
  assert.equal(live.stats.underpassKm, 1.3);
  assert.equal(live.stats.droppedLevelEdges, 32);
  // Deck-only: links and heightSplits unchanged (every
  // deck<->drape joint is continuous — the deck foot sits at
  // the terrain height), drapeLinks 3171 / drapeKm 329.7.
  assert.equal(deck.stats.links, 13433);
  assert.equal(deck.stats.heightSplits, 1);
  assert.equal(deck.stats.deckLinks, 398);
  assert.equal(deck.stats.deckKm, 168.8);
  assert.equal(deck.stats.drapeLinks, 3171);
  assert.equal(deck.stats.drapeKm, 329.7);
  // Ground: byte-identical to the #252 pins — no drape profiles
  // without a deck/underpass mode (the mode flags gate them).
  assert.equal(ground.stats.drivableEdges, 27742);
  assert.equal(ground.stats.links, 13237);
  assert.equal(ground.stats.keptKm, 1311.7);
  assert.equal(ground.stats.droppedLevelEdges, 1425);
  assert.equal(ground.stats.keptLevelEdges, 664);
  assert.equal(ground.stats.deckLinks, 0);
  assert.equal(ground.stats.drapeLinks, 0);
});

test('the issue example climb is a service road no car drives (issue #285)', () => {
  // The issue cites the 崇仰七路25巷 climb — the terrain is real
  // (one edge climbs 0.8 -> 25.8 m over 48 m) but every one of
  // its 8 edges is highway=service, and service is not a
  // DRIVABLE class, so no AI car ever drives it. If a future
  // class change makes it drivable this test notices: the live
  // graph must carry no link by that name. The acceptance case
  // is therefore 劍潭路 and 小坪頂路 (below), not the 25巷.
  const links = live.roadGraph.links.filter((L) => names[L[2]] === '崇仰七路25巷');
  assert.equal(links.length, 0, '崇仰七路25巷 carries no traffic links');
});

test('profiles: 劍潭路 climbs to the Grand Hotel on the draped surface (issue #285)', () => {
  // 劍潭路, the 圓山大飯店 approach: 14 links, every one
  // profiled, climbing to 13.6 m. Each profile's endpoints sit
  // exactly on the rendered road surface (drapeHeight + 0.06 at
  // the run's end nodes — the +0.06 is the carriageway lift, the
  // same convention the deck profiles use).
  const links = live.roadGraph.links.filter((L) => names[L[2]] === '劍潭路');
  assert.equal(links.length, 14, '劍潭路 keeps its 14 links');
  let max = 0;
  for (const L of links) {
    assert.ok(L[7], 'every 劍潭路 link is profiled');
    const h = L[7].h;
    max = Math.max(max, ...h);
    const ax = nodes[L[0] * 2], az = nodes[L[0] * 2 + 1];
    const bx = nodes[L[1] * 2], bz = nodes[L[1] * 2 + 1];
    assert.ok(Math.abs(h[0] - (drapeHeight(ax, az) + 0.06)) <= 0.01, `profile starts on the surface at ${L[0]}`);
    assert.ok(Math.abs(h[h.length - 1] - (drapeHeight(bx, bz) + 0.06)) <= 0.01, `profile ends on the surface at ${L[1]}`);
  }
  assert.ok(max >= 13 && max <= 14, `劍潭路 climbs to ~13.6 m, got ${max.toFixed(1)}`);
});

test('profiles: the worst burial now rides the terrain (issue #285)', () => {
  // 小坪頂路 carries the worst pre-fix burial in the tile (a car
  // at y=0 under 246.6 m of terrain). Its single link is
  // profiled and its peak rides the terrain, not the flat datum.
  const links = live.roadGraph.links.filter((L) => names[L[2]] === '小坪頂路');
  assert.equal(links.length, 1, '小坪頂路 is one link');
  assert.ok(links[0][7], '小坪頂路 is profiled');
  const max = Math.max(...links[0][7].h);
  assert.ok(max >= 240 && max < 250, `小坪頂路 profile peaks at ~246.7 m, got ${max.toFixed(1)}`);
});

test('profiles: the player drive model returns the draped ground at drape-road points (issue #285)', () => {
  // Independent cross-check: the boot's drive model (with the
  // draped ground) returns the terrain height — not y=0 — at
  // every profiled link's start node, sampled with the terrain
  // itself as the hint so the ground wins. Tolerance 1.0 m,
  // measured worst 0.694 m at a 大直入口匝道 ramp foot: the
  // model's low-bed rule returns the ramp-foot bed surface
  // (LOW_BED_H + ASPHALT_LIFT = 0.68 m above the ground) there,
  // which is still the rendered surface, not a burial.
  const drive = buildDriveModel(TAIPEI_GEO.elevatedRoads, { groundAt: drapeHeight });
  let checked = 0, worst = 0, worstAt = '';
  for (const L of live.roadGraph.links) {
    if (!L[7]) continue;
    const x = nodes[L[0] * 2], z = nodes[L[0] * 2 + 1];
    const g = drapeHeight(x, z);
    const got = drive.sample(x, z, g);
    const diff = Math.abs(got - g);
    if (diff > worst) { worst = diff; worstAt = `${L[0]}->${L[1]} (${names[L[2]]})`; }
    checked++;
  }
  assert.ok(checked > 3000, `checked ${checked} profiled-link nodes`);
  assert.ok(worst <= 1.0, `worst drive-model disagreement ${worst.toFixed(2)} m at ${worstAt}`);
});

test('drape off: the graph is the pristine deck graph (issue #285)', () => {
  // With the drape switched off, drapeHeight is 0 everywhere, so
  // no drape profile survives and every deck profile is digest
  // only: the live graph returns to the pristine census except
  // one link — deckLinks 372 -> 373, deckKm 163.7 -> 164.5: the
  // 2 m profile step resolves one more digest peak over 0.5 (an
  // unnamed 0.8 km link, 15013->15027, maxH 0.54). This test runs
  // LAST in the file and restores the flag, so no other test can
  // see the drape off; each test file runs in its own process, so
  // no other file is affected either.
  setDrapeEnabled(false);
  try {
    const off = buildTaipeiRoadGraph(TAIPEI_GEO, { includeDecks: true, includeUnderpass: true });
    assert.equal(off.stats.drapeLinks, 0);
    assert.equal(off.stats.drapeKm, 0);
    assert.equal(off.stats.links, 13433);
    assert.equal(off.stats.heightSplits, 1);
    assert.equal(off.stats.deckLinks, 373);
    assert.equal(off.stats.deckKm, 164.5);
    assert.equal(off.stats.underpassLinks, 6);
    assert.equal(off.stats.underpassKm, 1.3);
    assert.equal(off.stats.drivableEdges, 29135);
    assert.equal(off.stats.keptKm, 1419.6);
  } finally {
    setDrapeEnabled(true);
  }
  assert.ok(drapeHeight(-4334, -5611) > 13, 'drape restored after the test');
});
