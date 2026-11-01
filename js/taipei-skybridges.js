// js/taipei-skybridges.js — the Xinyi pedestrian skybridge
// network (issue #212): pure geometry, the taipei-bridges.js
// pattern — no three.js here, taipei-boot.js wraps the arrays
// into one mesh, so node tests pin the geometry directly.
//
// The network is the district's 空橋 system (Wikipedia: 信義
// 商圈空橋系統， ~2.293 km linking WTC / 101 / 微風南山 / ATT 4
// FUN / 信義威秀 / 新光三越 A4-A11 / 寶麗廣場 / 微風松高 /
// 微風信義 / 遠百A13): second-floor covered walkways with glass
// parapets and a light canopy, read on Esri satellite as pale
// strips crossing Songzhi / Songshou / Songgao roads. The
// centrelines are OSM's bridge=yes / layer=1 footways, chained
// by tools/taipei/build-skybridges.mjs into geodata.skybridges.
//
// Drawn idiom (the #151 Rainbow Bridge deck pattern): a pale
// deck ribbon at the real second-floor level (deck top 7.0 m),
// slim glass-tone parapets, a thin canopy slab on slim posts
// (the system's suspended roof), and support columns flanking
// every road crossing. Supports obey the landmark rule: a
// footing is placed only where it clears every drawn roadbed
// (centreline distance >= road half-width + 1.0 m) — columns
// stand on sidewalks and plazas, never in a carriageway; long
// clear stretches pick up a sparse mid support. Scenery only:
// the decks are not drivable and feed no other system.

export const SKYBRIDGE_STYLE = {
  deckTop: 7.0,      // real 2F walking surface
  deckDepth: 0.7,
  parapetH: 1.1,
  canopyTop: 9.75,   // suspended canopy roof (system signature)
  canopyT: 0.18,
  postEveryM: 11,
  supportClearM: 1.0, // footing clearance beyond roadbed edge
  supportGapM: 48,    // max clear stretch without a support
};

const C = {
  deck: 0xd9d6cd,     // pale concrete (satellite strip tone)
  parapet: 0xaebfb8,  // pale glass
  canopy: 0xe9e7e0,   // light roof sheet
  post: 0x8f979b,     // light steel
  support: 0xa9a294,  // concrete columns
};

// Signed clearance from a point to the nearest roadbed edge:
// distance to the bed's centreline minus its half width
// (negative = inside the carriageway). Beds are the geodata's
// centreline ribbons, the same records the renderer buffers.
export function roadbedClearance(roadbeds, x, z) {
  let best = Infinity;
  for (const b of roadbeds || []) {
    const pts = b.pts || [];
    const half = (b.width || 6) / 2;
    for (let k = 0; k + 3 <= pts.length; k += 2) {
      const ax = pts[k], az = pts[k + 1], bx = pts[k + 2], bz = pts[k + 3];
      const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
      let t = len2 ? ((x - ax) * dx + (z - az) * dz) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t)) - half;
      if (d < best) best = d;
    }
  }
  return best;
}

export function buildSkybridgeGeometry(geo) {
  const pos = [], nor = [], col = [];
  const rgb = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
  const quad = (a, b, c, d, hex) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz) || 1;
    nx /= L; ny /= L; nz /= L;
    const [r, g, bl] = rgb(hex);
    for (const p of [a, b, c, a, c, d]) { pos.push(p[0], p[1], p[2]); nor.push(nx, ny, nz); col.push(r, g, bl); }
  };
  // Box between two 3D points: cross-section w (horizontal side)
  // x d, centred on the p0->p1 axis (the bridges module's beam).
  const beam = (p0, p1, w, d, hex) => {
    let ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const L = Math.hypot(ux, uy, uz) || 1; ux /= L; uy /= L; uz /= L;
    let sx = -uz, sz = ux, sy = 0;
    if (Math.hypot(sx, sz) < 1e-4) { sx = 1; sz = 0; }
    const sl = Math.hypot(sx, sz); sx /= sl; sz /= sl;
    const tx = uy * sz - uz * sy, ty = uz * sx - ux * sz, tz = ux * sy - uy * sx;
    const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2, mz = (p0[2] + p1[2]) / 2;
    const cn = [];
    for (const [su, tu, lu] of [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1], [-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]]) {
      cn.push([
        mx + sx * su * w / 2 + tx * tu * d / 2 + ux * lu * L / 2,
        my + sy * su * w / 2 + ty * tu * d / 2 + uy * lu * L / 2,
        mz + sz * su * w / 2 + tz * tu * d / 2 + uz * lu * L / 2,
      ]);
    }
    const F = [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [2, 6, 7, 3], [0, 3, 7, 4], [1, 5, 6, 2]];
    for (const [a, b, c, dd] of F) quad(cn[a], cn[b], cn[c], cn[dd], hex);
  };
  // Axis-aligned-in-plan box from a frame (centre, azimuth):
  // sizes (along, across), y0..y1.
  const planBox = (cx, cz, az, sizeAlong, sizeAcross, y0, y1, hex) => {
    const axis = [Math.sin(az), Math.cos(az)], perp = [Math.cos(az), -Math.sin(az)];
    const P = (a, y, b) => [cx + axis[0] * a + perp[0] * b, y, cz + axis[1] * a + perp[1] * b];
    const ha = sizeAlong / 2, hx = sizeAcross / 2;
    const c000 = P(-ha, y0, -hx), c100 = P(-ha, y0, hx), c110 = P(ha, y0, hx), c010 = P(ha, y0, -hx);
    const c001 = P(-ha, y1, -hx), c101 = P(-ha, y1, hx), c111 = P(ha, y1, hx), c011 = P(ha, y1, -hx);
    quad(c000, c100, c110, c010, hex);
    quad(c001, c011, c111, c101, hex);
    quad(c000, c001, c101, c100, hex);
    quad(c010, c110, c111, c011, hex);
    quad(c000, c010, c011, c001, hex);
    quad(c100, c101, c111, c110, hex);
  };

  const S = SKYBRIDGE_STYLE;
  const beds = geo?.roadbeds || [];
  const chains = [];
  const supports = [];
  let maxY = 0;

  for (const seg of geo?.skybridges || []) {
    const tri0 = pos.length / 9;
    const P = [];
    for (let k = 0; k + 1 < seg.pts.length; k += 2) P.push([seg.pts[k], seg.pts[k + 1]]);
    // Chainage + per-point segment azimuth/width.
    const chain = [0];
    for (let i = 1; i < P.length; i++) chain.push(chain[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const total = chain[chain.length - 1];
    const at = (d) => {
      let i = 1; while (i < chain.length - 1 && chain[i] < d) i++;
      const t = (d - chain[i - 1]) / Math.max(chain[i] - chain[i - 1], 1e-6);
      return {
        p: [P[i - 1][0] + (P[i][0] - P[i - 1][0]) * t, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * t],
        az: Math.atan2(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]),
        w: seg.sw[Math.min(i - 1, seg.sw.length - 1)],
      };
    };

    // Deck + parapets + canopy, segment by segment (the Rainbow
    // deck idiom: per-segment beams, joints read as expansion
    // joints).
    const deckMidY = S.deckTop - S.deckDepth / 2;
    const canMidY = S.canopyTop - S.canopyT / 2;
    for (let i = 0; i < P.length - 1; i++) {
      const w = seg.sw[i] ?? 5;
      const [ax, az2] = P[i], [bx, bz] = P[i + 1];
      beam([ax, deckMidY, az2], [bx, deckMidY, bz], w, S.deckDepth, C.deck);
      beam([ax, canMidY, az2], [bx, canMidY, bz], w - 0.4, S.canopyT, C.canopy);
      const azm = Math.atan2(bx - ax, bz - az2);
      for (const sd of [1, -1]) {
        const off = (pt) => [pt[0] + Math.cos(azm) * sd * (w / 2 - 0.09), pt[1] - Math.sin(azm) * sd * (w / 2 - 0.09)];
        const a = off(P[i]), b = off(P[i + 1]);
        beam([a[0], S.deckTop + S.parapetH / 2, a[1]], [b[0], S.deckTop + S.parapetH / 2, b[1]], 0.18, S.parapetH, C.parapet);
      }
      if (S.canopyTop > maxY) maxY = S.canopyTop;
    }
    // Canopy posts at vertices + subdivisions (chainage list,
    // so shared vertices never double-draw).
    const postAt = new Set();
    for (let i = 0; i < P.length; i++) postAt.add(chain[i]);
    for (let d = S.postEveryM; d < total; d += S.postEveryM) {
      let nearest = Infinity;
      for (const v of postAt) nearest = Math.min(nearest, Math.abs(v - d));
      if (nearest > 3) postAt.add(d);
    }
    for (const d of [...postAt].sort((a, b) => a - b)) {
      const { p, az, w } = at(d);
      const perp = [Math.cos(az), -Math.sin(az)];
      for (const sd of [1, -1]) {
        const px = p[0] + perp[0] * sd * (w / 2 - 0.35), pz = p[1] + perp[1] * sd * (w / 2 - 0.35);
        beam([px, S.deckTop, pz], [px, S.canopyTop - S.canopyT, pz], 0.16, 0.16, C.post);
      }
    }

    // Supports: resample at 2 m; a sample is OVER a carriageway
    // when its centreline clearance < 0.5 m. Each maximal over
    // run gets a footing on the nearest clear ground within
    // 8 m on each side; clear stretches longer than
    // supportGapM pick up one mid footing. A footing stands
    // only where clearance >= supportClearM — guaranteed by
    // construction and re-asserted in the tests.
    const step = 2;
    const n = Math.max(2, Math.ceil(total / step) + 1);
    const samples = [];
    for (let i = 0; i < n; i++) {
      const d = Math.min(total, i * step);
      const { p, az } = at(d);
      samples.push({ d, x: p[0], z: p[1], az, clear: roadbedClearance(beds, p[0], p[1]) });
    }
    const mine = [];
    const addSupport = (s) => {
      if (!s || s.clear < S.supportClearM) return;
      if (mine.some((m) => Math.abs(m.d - s.d) < 6)) return;
      mine.push(s);
    };
    let runStart = -1;
    for (let i = 0; i <= samples.length; i++) {
      const over = i < samples.length && samples[i].clear < 0.5;
      if (over && runStart < 0) runStart = i;
      if (!over && runStart >= 0) {
        // Crossing [runStart, i-1]: flank it.
        for (let j = runStart - 1; j >= Math.max(0, runStart - 5); j--) if (samples[j].clear >= S.supportClearM) { addSupport(samples[j]); break; }
        for (let j = i; j <= Math.min(samples.length - 1, i + 4); j++) if (samples[j].clear >= S.supportClearM) { addSupport(samples[j]); break; }
        runStart = -1;
      }
    }
    // Sparse mid supports on long clear stretches.
    const anchors = [0, ...mine.map((m) => m.d), total];
    anchors.sort((a, b) => a - b);
    for (let i = 0; i < anchors.length - 1; i++) {
      if (anchors[i + 1] - anchors[i] > S.supportGapM) {
        const mid = samples.reduce((best, s) => (Math.abs(s.d - (anchors[i] + anchors[i + 1]) / 2) < Math.abs(best.d - (anchors[i] + anchors[i + 1]) / 2) ? s : best), samples[0]);
        addSupport(mid);
      }
    }
    mine.sort((a, b) => a.d - b.d);
    for (const s of mine) {
      planBox(s.x, s.z, s.az, 1.1, 1.1, 0, S.deckTop - S.deckDepth, C.support);
      planBox(s.x, s.z, s.az, 1.7, 1.7, 0, 0.5, C.support);
      supports.push([s.x, s.z]);
    }

    chains.push({ triCount: pos.length / 9 - tri0, lenM: Math.round(total), supports: mine.map((m) => [m.x, m.z]) });
  }

  return {
    positions: new Float32Array(pos), normals: new Float32Array(nor), colors: new Float32Array(col),
    triCount: pos.length / 9, chains, supports, maxY,
  };
}

// Issue #255: per-chain slices of the merged geometry, for the
// far despawn — one mesh per chain, toggled by distance to the
// chain's own centreline centroid. The builder above emits the
// chains' triangles in chain order (each chain's triCount is
// recorded), and the arrays are non-indexed (9 floats per
// triangle), so a chain's slice is a contiguous range — no
// geometry is rebuilt, and the tri total is exactly the merged
// total. Boot wraps each slice in a mesh and stashes despawn
// entries (see updateDespawnGroup in js/taipei-buildings.js);
// the pure builder and its census are untouched.
export function skybridgeChainSlices(geo) {
  const g = buildSkybridgeGeometry(geo);
  const segs = geo?.skybridges || [];
  const slices = [];
  let triStart = 0;
  for (let i = 0; i < g.chains.length; i++) {
    const triCount = g.chains[i].triCount;
    const v0 = triStart * 9, v1 = (triStart + triCount) * 9;
    const seg = segs[i];
    let cx = 0, cz = 0, n = 0;
    if (seg) {
      for (let k = 0; k + 1 < seg.pts.length; k += 2) { cx += seg.pts[k]; cz += seg.pts[k + 1]; n++; }
    }
    slices.push({
      positions: g.positions.slice(v0, v1),
      normals: g.normals.slice(v0, v1),
      colors: g.colors.slice(v0, v1),
      triCount,
      lenM: g.chains[i].lenM,
      cx: n ? cx / n : 0,
      cz: n ? cz / n : 0,
    });
    triStart += triCount;
  }
  return { slices, triCount: g.triCount, chains: g.chains, supports: g.supports, maxY: g.maxY };
}
