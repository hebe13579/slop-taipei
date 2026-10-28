// tools/taipei/build-loops.mjs — interchange-loop interiors (issue #213).
//
// The planner's lot gauntlet excludes the carriageways themselves
// (roadbed ribbons, decks, medians) but not the ground they ENCLOSE:
// inside a cloverleaf loop or between an interchange's carriageways
// the land is not road, not park, not green — so the packer planted
// buildings on grass infields (40 phantom lots inside the type site
// at 重慶北路 × 汐止高架橋 alone, 125 tile-wide). OSM tags SOME
// infields as green land (the 濱江 interchange's south loops are
// already clean); the untagged ones are this pass's subject.
//
// Method: a 2 m raster over the tile frame (the blocks raster's
// resolution), in the census form verified against Esri satellite
// overlays in cloverleaf213-evidence/:
//   * every roadbed ribbon is stamped as a barrier, class-tagged —
//     INT for interchange carriageways (deck beds, motorway / trunk
//     beds, and every *_link bed), ORD for the rest;
//   * water polygons and the outside of the tile union are non-land;
//   * the remaining land is labelled into components, and a
//     component is a LOOP SITE when it reads as land the interchange
//     system encloses and nobody occupies:
//       - 400..60000 m2 (a loop infield, not a district, not a sliver);
//       - at most 1 door-plate point (an occupied block carries its
//         addresses; one stray plate at a component's edge is the
//         dataset's geocoding spill, not occupation — the 濱江 north
//         loop carries exactly one and is grass on satellite);
//       - under half covered by park/green polygons (that land is
//         already excluded by the #114 layer; this class is for the
//         untagged remainder);
//       - no boundary on the tile exterior (an enclosure cut by the
//         tile edge is not a closed enclosure);
//       - bbox fill >= 0.15 (a component, not a median hairline);
//       - >= 2/3 of its boundary against INT barriers. The measured
//         tile-wide ladder of lot-bearing components has an empty
//         band between 0.596 and 0.694: every satellite-verified
//         infield sits at 0.694 or above, and the one component in
//         the gap (#3453 by census order, the 重陽橋 levee pocket,
//         7 lots) is enclosed jointly by ramps and the ordinary
//         levee road — reported as residue, not admitted by fitting
//         the threshold down to it.
//   * accepted components are vectorised by boundary-edge chaining
//     on the label grid (collinear points dropped), and each ring
//     set is proven by rasterising it back: every component cell
//     centre inside, mismatch drops the site with a warning.
//
// Output: [{ name, ring }] in the airfield site's shape — the
// planner drops lots on them (js/taipei-buildings.js) and the boot
// tints them as grass (js/taipei-green.js). The name is the most
// common interchange-carriageway name near the site, for evidence
// and debugging; unnamed where the ramps carry no name.
//
// Deterministic: fixed scan order everywhere; the same geodata in
// gives the same sites out (the geodata builder's byte-safety rule).

const RES = 2; // m per cell — the blocks raster's resolution
const MIN_AREA_M2 = 400, MAX_AREA_M2 = 60000;
const MAX_DOORS = 1;
const MAX_GREEN_FRAC = 0.5;
const MIN_FILL = 0.15;
const MIN_INT_SHARE = 2 / 3;

const LAND = 0, ORD = 1, INT = 2, WATER = 3, EXT = 4;

export function deriveLoopSites(geo) {
  const stats = { components: 0, accepted: 0, acceptedAreaM2: 0, rings: 0, droppedMismatch: 0, holes: 0 };
  const BBOX = geo.frame.bbox;
  const W = Math.ceil((BBOX.maxX - BBOX.minX) / RES), H = Math.ceil((BBOX.maxZ - BBOX.minZ) / RES);
  const cellX = (i) => BBOX.minX + (i + 0.5) * RES;
  const cellZ = (j) => BBOX.minZ + (j + 0.5) * RES;
  const cls = new Uint8Array(W * H).fill(LAND);
  // union exterior
  const boxes = geo.frame.boxes || [];
  for (let j = 0; j < H; j++) {
    const cz = cellZ(j);
    for (let i = 0; i < W; i++) {
      const cx = cellX(i);
      if (!boxes.some((b) => cx >= b.minX && cx <= b.maxX && cz >= b.minZ && cz <= b.maxZ)) cls[j * W + i] = EXT;
    }
  }
  // scanline ring fill (the census probe's form): with a value over
  // LAND cells only, or into a side grid when side is given.
  const fillRing = (ringFlat, val, side) => {
    const pts = [];
    for (let i = 0; i < ringFlat.length; i += 2) pts.push([ringFlat[i], ringFlat[i + 1]]);
    if (pts.length < 3) return;
    let zMin = Infinity, zMax = -Infinity;
    for (const [, z] of pts) { zMin = Math.min(zMin, z); zMax = Math.max(zMax, z); }
    const j0 = Math.max(0, Math.floor((zMin - BBOX.minZ) / RES)), j1 = Math.min(H - 1, Math.ceil((zMax - BBOX.minZ) / RES));
    for (let j = j0; j <= j1; j++) {
      const z = cellZ(j);
      const xs = [];
      for (let i = 0, k = pts.length - 1; i < pts.length; k = i++) {
        const [xa, za] = pts[k], [xb, zb] = pts[i];
        if ((za > z) !== (zb > z)) xs.push(xa + ((z - za) * (xb - xa)) / (zb - za));
      }
      xs.sort((a, b) => a - b);
      for (let n = 0; n + 1 < xs.length; n += 2) {
        const i0 = Math.max(0, Math.ceil((xs[n] - BBOX.minX) / RES - 0.5));
        const i1 = Math.min(W - 1, Math.floor((xs[n + 1] - BBOX.minX) / RES - 0.5));
        for (let i = i0; i <= i1; i++) {
          if (side) side[j * W + i] = 1;
          else if (cls[j * W + i] === LAND) cls[j * W + i] = val;
        }
      }
    }
  };
  for (const w of geo.water || []) fillRing(w.ring, WATER, null);
  const excl = new Uint8Array(W * H);
  for (const p of geo.parks || []) fillRing(p.ring, 0, excl);
  for (const g of geo.green || []) fillRing(g.ring, 0, excl);
  // roadbed ribbons as barriers
  const isInt = (b) => b.deck || b.highway === 'motorway' || b.highway === 'trunk' || (b.highway || '').endsWith('_link');
  for (const b of geo.roadbeds || []) {
    const half = Math.max(b.width / 2, 1.5);
    const v = isInt(b) ? INT : ORD;
    const pts = b.pts;
    for (let s = 0; s + 3 < pts.length; s += 2) {
      const ax = pts[s], az = pts[s + 1], bx = pts[s + 2], bz = pts[s + 3];
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - half - BBOX.minX) / RES)), i1 = Math.min(W - 1, Math.ceil((Math.max(ax, bx) + half - BBOX.minX) / RES));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - half - BBOX.minZ) / RES)), j1 = Math.min(H - 1, Math.ceil((Math.max(az, bz) + half - BBOX.minZ) / RES));
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9, r2 = half * half;
      for (let j = j0; j <= j1; j++) {
        const pz = cellZ(j);
        for (let i = i0; i <= i1; i++) {
          const k = j * W + i;
          if (cls[k] === EXT || cls[k] === INT) continue;
          const px = cellX(i);
          let t = ((px - ax) * dx + (pz - az) * dz) / L2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = ax + t * dx - px, ez = az + t * dz - pz;
          if (ex * ex + ez * ez <= r2) cls[k] = v;
        }
      }
    }
  }
  // door plates per cell (flat [x, z, floors] triples, issue #128)
  const doorCell = new Map();
  const doors = geo.heights?.doors || [];
  for (let i = 0; i + 2 < doors.length; i += 3) {
    const ci = Math.floor((doors[i] - BBOX.minX) / RES), cj = Math.floor((doors[i + 1] - BBOX.minZ) / RES);
    if (ci < 0 || cj < 0 || ci >= W || cj >= H) continue;
    const k = cj * W + ci;
    doorCell.set(k, (doorCell.get(k) || 0) + 1);
  }
  // label land components (stats only; cells are re-read from the
  // label grid when a component is accepted)
  const label = new Int32Array(W * H);
  const stack = new Int32Array(W * H);
  const comps = [];
  for (let start = 0; start < W * H; start++) {
    if (cls[start] !== LAND || label[start]) continue;
    let sp = 0, count = 0, doorsN = 0, exclN = 0;
    const per = [0, 0, 0, 0, 0];
    let ix0 = W, ix1 = 0, jz0 = H, jz1 = 0;
    const id = comps.length + 1;
    stack[sp++] = start; label[start] = id;
    while (sp) {
      const cur = stack[--sp];
      const ci = cur % W, cj = (cur / W) | 0;
      count++;
      ix0 = Math.min(ix0, ci); ix1 = Math.max(ix1, ci); jz0 = Math.min(jz0, cj); jz1 = Math.max(jz1, cj);
      doorsN += doorCell.get(cur) || 0;
      exclN += excl[cur];
      const nb = [[ci > 0, cur - 1], [ci < W - 1, cur + 1], [cj > 0, cur - W], [cj < H - 1, cur + W]];
      for (const [ok, n] of nb) {
        if (!ok) { per[EXT]++; continue; }
        if (cls[n] === LAND) { if (!label[n]) { label[n] = id; stack[sp++] = n; } }
        else per[cls[n]]++;
      }
    }
    comps.push({ id, area: count * RES * RES, count, doors: doorsN, exclFrac: exclN / count, per, ix0, ix1, jz0, jz1 });
  }
  stats.components = comps.length;

  const q = (v) => Math.round(v * 10) / 10;
  // Vectorise one accepted component: boundary edges on the label
  // grid, chained with a right-turn-first wall follower (interior
  // stays on the walker's right in x-east / z-south screen space),
  // collinear vertices dropped. Returns flat world rings, one per
  // closed loop (a component pinched diagonally yields its lobes
  // as separate rings — the planner tests each ring on its own).
  const vectorize = (c) => {
    const key = (vx, vz) => vx * 100000 + vz;
    const edges = new Map(); // start vertex key -> [{to, used}]
    const addEdge = (ax, az, bx, bz) => {
      const k = key(ax, az);
      if (!edges.has(k)) edges.set(k, []);
      edges.get(k).push({ to: key(bx, bz), bx, bz, used: false });
    };
    for (let j = c.jz0; j <= c.jz1; j++) {
      for (let i = c.ix0; i <= c.ix1; i++) {
        if (label[j * W + i] !== c.id) continue;
        if (i === 0 || label[j * W + i - 1] !== c.id) addEdge(i, j + 1, i, j);         // west side, heading north
        if (i === W - 1 || label[j * W + i + 1] !== c.id) addEdge(i + 1, j, i + 1, j + 1); // east side, heading south
        if (j === 0 || label[(j - 1) * W + i] !== c.id) addEdge(i, j, i + 1, j);         // north side, heading east
        if (j === H - 1 || label[(j + 1) * W + i] !== c.id) addEdge(i + 1, j + 1, i, j + 1); // south side, heading west
      }
    }
    // heading of an edge in grid steps: 0=E 1=S 2=W 3=N (z south)
    const heading = (ax, az, bx, bz) => (bx > ax ? 0 : bx < ax ? 2 : bz > az ? 1 : 3);
    const rightOf = [1, 2, 3, 0], leftOf = [3, 0, 1, 2];
    const rings = [];
    for (const [startKey, outs] of edges) {
      for (const e0 of outs) {
        if (e0.used) continue;
        const verts = [];
        let curKey = startKey, cur = e0, prevH = null;
        let guard = 0;
        while (cur && !cur.used && guard++ < 1e7) {
          cur.used = true;
          const ax = Math.floor(curKey / 100000), az = curKey % 100000;
          verts.push([ax, az]);
          const h = heading(ax, az, cur.bx, cur.bz);
          prevH = h;
          curKey = cur.to;
          if (curKey === startKey) { cur = null; break; }
          const next = (edges.get(curKey) || []).filter((e) => !e.used);
          if (!next.length) { cur = null; break; }
          const cx = Math.floor(curKey / 100000), cz = curKey % 100000;
          const byH = new Map(next.map((e) => [heading(cx, cz, e.bx, e.bz), e]));
          cur = byH.get(rightOf[h]) || byH.get(h) || byH.get(leftOf[h]) || byH.get((h + 2) % 4) || null;
        }
        if (verts.length < 4 || curKey !== startKey) continue; // open walk — not a closed ring
        // drop collinear vertices (exact integer arithmetic)
        const kept = [];
        for (let n = 0; n < verts.length; n++) {
          const [px, pz] = verts[(n + verts.length - 1) % verts.length];
          const [vx, vz] = verts[n];
          const [nx, nz] = verts[(n + 1) % verts.length];
          const cross = (vx - px) * (nz - vz) - (vz - pz) * (nx - vx);
          const dot = (vx - px) * (nx - vx) + (vz - pz) * (nz - vz);
          if (cross === 0 && dot > 0) continue;
          kept.push([vx, vz]);
        }
        if (kept.length < 4) continue;
        const ring = [];
        for (const [vx, vz] of kept) ring.push(q(BBOX.minX + vx * RES), q(BBOX.minZ + vz * RES));
        rings.push(ring);
      }
    }
    return rings;
  };
  // Rasterise-back proof: every component cell centre inside some
  // ring of the set, and no ring cell centre of ANOTHER component
  // inside (a hole holding real land would fail the second half).
  const pointInRing = (x, z, ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
      const xi = ring[i], zi = ring[i + 1], xj = ring[j], zj = ring[j + 1];
      if (((zi > z) !== (zj > z)) && (x < ((xj - xi) * (z - zi)) / (zj - zi) + xi)) inside = !inside;
    }
    return inside;
  };

  const sites = [];
  for (const c of comps) {
    const perTot = c.per[INT] + c.per[ORD] + c.per[WATER] + c.per[EXT];
    const intShare = perTot ? c.per[INT] / perTot : 0;
    const bw = (c.ix1 - c.ix0 + 1) * RES, bd = (c.jz1 - c.jz0 + 1) * RES;
    const fill = c.area / (bw * bd);
    if (!(c.area >= MIN_AREA_M2 && c.area <= MAX_AREA_M2)) continue;
    if (c.doors > MAX_DOORS) continue;
    if (c.exclFrac >= MAX_GREEN_FRAC) continue;
    if (c.per[EXT] > 0) continue;
    if (fill < MIN_FILL) continue;
    if (intShare < MIN_INT_SHARE) continue;
    const rings = vectorize(c);
    if (!rings.length) continue;
    // proof: every one of this component's cell centres inside the
    // ring set, and no OTHER component's land cell centre inside it
    // (a hole holding real land would make the ring a lie).
    let mismatch = 0;
    for (let j = c.jz0; j <= c.jz1 && !mismatch; j++) {
      for (let i = c.ix0; i <= c.ix1; i++) {
        const lab = label[j * W + i];
        if (!lab) continue;
        const x = cellX(i), z = cellZ(j);
        const inside = rings.some((r) => pointInRing(x, z, r));
        if (lab === c.id ? !inside : inside) { mismatch++; break; }
      }
    }
    if (mismatch) { stats.droppedMismatch++; continue; }
    if (rings.length > 1) stats.holes += rings.length - 1;
    // name: the most common interchange-carriageway name whose
    // centreline passes within 60 m of the component's bbox.
    const nameCount = new Map();
    const ex = { minX: BBOX.minX + c.ix0 * RES - 60, maxX: BBOX.minX + (c.ix1 + 1) * RES + 60, minZ: BBOX.minZ + c.jz0 * RES - 60, maxZ: BBOX.minZ + (c.jz1 + 1) * RES + 60 };
    for (const b of geo.roadbeds || []) {
      if (!isInt(b) || !b.name) continue;
      const pts = b.pts;
      let near = false;
      for (let i = 0; i + 1 < pts.length && !near; i += 2) if (pts[i] >= ex.minX && pts[i] <= ex.maxX && pts[i + 1] >= ex.minZ && pts[i + 1] <= ex.maxZ) near = true;
      if (near) nameCount.set(b.name, (nameCount.get(b.name) || 0) + 1);
    }
    const name = [...nameCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    for (const ring of rings) sites.push({ name, ring });
    stats.accepted++;
    stats.acceptedAreaM2 += c.area;
    stats.rings += rings.length;
  }
  return { sites, stats };
}
