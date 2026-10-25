// js/taipei-mrt-stations.js — MRT Red Line elevated stations
// (issue #118): pure geometry, the taipei-viaduct.js pattern — no
// three.js here, taipei-boot.js wraps the arrays into one mesh, so
// node tests pin the geometry directly.
//
// The stations are NOT landmark-registry structures: a straddling
// station stands over the street/track corridor on its columns, so
// the landmark footprint-vs-roadbed invariant (issue #42, audited in
// plan view) cannot describe it — the same physical idiom as the
// deck piers, which the deck system handles with median exemptions.
// They live in geodata as mrtStations defs computed by the pipeline
// (tools/taipei/build-mrt.mjs) from the OSM station geometry + the
// hand-authored kind list, and render as one flat-shaded,
// vertex-coloured triangle soup.
//
// Design (facts in the #118 evidence, STATION-FACTS.md):
//   standard — the Yuanshan pattern from the user's photo: a long
//     brick-red box straddling the viaduct (the deck passes through
//     it), a dark window band, and segmented orange-tan tiled HIP
//     roof slabs with grey eave trim; concourse mass at grade.
//   jiantan — the dragon-boat suspension station: two concrete
//     A-pylons, a catenary cable with orange hanger blocks, a pale
//     hull and a roof that sags with the cable; NO centre columns
//     (it straddles 中山北路 on the two pylons alone).
//   beitou — the junction station: four tracks wide, a monumental
//     concrete body + fascia band, a glazed lattice band and a thin
//     sloped glass roof, two massive end columns.
//   xinbeitou — the branch terminus: standard-pattern body closed by
//     an end wall carrying the red MRT band; the line stops at it.
//
// Local frame per station: +z along the track (the station's yaw is
// the track azimuth, the deck-pier convention), +x across, y up,
// origin at the station centre at grade. Parts are authored in
// (along, across) and converted below.

const C = {
  concrete: 0x98958a, concreteLight: 0xa9a49a, pylon: 0xa3a099,
  brick: 0x87452f, brickDark: 0x6e3826, glass: 0x2e3a40,
  roofTile: 0xc47a3d, eaveTrim: 0x5f6468,
  hull: 0xb4b8ae, hullDark: 0x8f948c, roofPale: 0xa9bda6,
  cable: 0x3c4145, mrtRed: 0xa62b25,
  beitouGlass: 0x39505a, beitouRoof: 0x4a6a72, concourse: 0x9a5a44,
};
const rgb = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];

// buildMrtStationGeometry(stations) -> {
//   positions, normals, colors (Float32Arrays), triCount, stationCount }
// stations: [{ x, z, yaw, kind, length }]
// Plan-view half extents of the RENDERED structure per kind (the
// widest/longest part, roofs and eaves included) — the lot planner
// excludes generic lots from these footprints, and tests pin the
// stations against the guideway with them.
export function mrtStationFootprint(st) {
  const L = st.length || 112;
  const Wd = st.width || MRT_STATION_DEFAULT_WIDTH[st.kind] || 21.5;
  switch (st.kind) {
    // hl covers the backstay anchor blocks at |u| = 120.
    case 'jiantan': return { hw: (Wd + 2) / 2, hl: 122 };
    case 'beitou': return { hw: (Wd + 2.6) / 2, hl: (L + 4) / 2 };
    case 'xinbeitou': return { hw: (Wd + 1.2) / 2, hl: (L + 2.4) / 2 };
    default: return { hw: (Wd + 1.9) / 2, hl: L / 2 };
  }
}

// Body width when the pipeline measured none (mirrors the digest's
// clamps in tools/taipei/build-mrt.mjs).
export const MRT_STATION_DEFAULT_WIDTH = {
  standard: 21.5, jiantan: 24, beitou: 33, xinbeitou: 21.5,
};

export function buildMrtStationGeometry(stations) {
  const pos = [], nor = [], col = [];
  const quad = (a, b, c, d, hex) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz) || 1;
    nx /= L; ny /= L; nz /= L;
    const [r, g, bl] = rgb(hex);
    for (const p of [a, b, c, a, c, d]) { pos.push(p[0], p[1], p[2]); nor.push(nx, ny, nz); col.push(r, g, bl); }
  };

  for (const st of stations || []) {
    const cy = Math.cos(st.yaw), sy = Math.sin(st.yaw);
    // local (x across, y up, z along) -> world
    const W = (lx, ly, lz) => [st.x + lx * cy + lz * sy, ly, st.z - lx * sy + lz * cy];
    // Axis-aligned (in the local frame) box: centre along/across,
    // size along/across, y0..y1.
    const box = (along, across, sizeAlong, sizeAcross, y0, y1, hex) => {
      const ha = sizeAlong / 2, hx = sizeAcross / 2;
      const c000 = W(across - hx, y0, along - ha), c100 = W(across + hx, y0, along - ha);
      const c110 = W(across + hx, y0, along + ha), c010 = W(across - hx, y0, along + ha);
      const c001 = W(across - hx, y1, along - ha), c101 = W(across + hx, y1, along - ha);
      const c111 = W(across + hx, y1, along + ha), c011 = W(across - hx, y1, along + ha);
      quad(c000, c100, c110, c010, hex); // bottom
      quad(c001, c011, c111, c101, hex); // top
      quad(c000, c001, c101, c100, hex); // -along side
      quad(c010, c110, c111, c011, hex); // +along side
      quad(c000, c010, c011, c001, hex); // -across side
      quad(c100, c101, c111, c110, hex); // +across side
    };
    // A box of size (sx, sy, sz) centred at local (lx, ly, lz),
    // tilted by rx about the across axis (tips the along extent up
    // or down: a point at +z moves by -sin(rx) in y) and then by rz
    // about the along axis. Only rx is used today (roof slabs
    // following the Jiantan sag, cable segments).
    const tiltBox = (lx, ly, lz, bsx, bsy, bsz, rz, rx, hex) => {
      const crz = Math.cos(rz), srz = Math.sin(rz), crx = Math.cos(rx), srx = Math.sin(rx);
      const corners = [];
      for (const [px, py, pz] of [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1], [-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]]) {
        let X = (px * bsx) / 2, Y = (py * bsy) / 2, Z = (pz * bsz) / 2;
        [Y, Z] = [Y * crx - Z * srx, Y * srx + Z * crx];
        [X, Y] = [X * crz - Y * srz, X * srz + Y * crz];
        corners.push(W(lx + X, ly + Y, lz + Z));
      }
      const F = [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [2, 6, 7, 3], [0, 3, 7, 4], [1, 5, 6, 2]];
      for (const [a, b, c, d] of F) quad(corners[a], corners[b], corners[c], corners[d], hex);
    };
    // Hip roof: eave rect (len x wid) at yBase, ridge rect inset by
    // (inAlong, inAcross) at yBase+rise; 4 sloped faces + top.
    const hip = (along, yBase, len, wid, rise, inAlong, inAcross, hex) => {
      const hl = len / 2, hw = wid / 2;
      const e = [[-hw, -hl], [hw, -hl], [hw, hl], [-hw, hl]].map(([x, z]) => W(x, yBase, along + z));
      const t = [[-hw + inAcross, -hl + inAlong], [hw - inAcross, -hl + inAlong], [hw - inAcross, hl - inAlong], [-hw + inAcross, hl - inAlong]]
        .map(([x, z]) => W(x, yBase + rise, along + z));
      for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quad(e[i], t[i], t[j], e[j], hex); }
      quad(t[0], t[3], t[2], t[1], hex);
    };

    const L = st.length || 112;
    const Wd = st.width || MRT_STATION_DEFAULT_WIDTH[st.kind] || 21.5;
    if (st.kind === 'jiantan') {
      // Hull + street-level concourse, no centre columns.
      box(-18, 0, 76, 15, 0, 4.4, C.concourse);
      box(-18, 0, 76, 15.3, 3.3, 4.4, C.mrtRed); // red MRT band (photo)
      box(0, 0, 150, Wd, 5.0, 12.6, C.hull);
      box(0, 0, 152, Wd + 0.6, 5.0, 6.4, C.hullDark);
      // Roof: slabs following the cable's sag (low mid-span).
      const R = 66, sagY = (u) => 16.6 - 3.4 * (1 - (u / R) * (u / R));
      for (let i = 0; i < 9; i++) {
        const u = -R + (i + 0.5) * ((2 * R) / 9);
        const slope = Math.atan2(sagY(u + 4) - sagY(u - 4), 8);
        tiltBox(0, sagY(u), u, Wd + 2, 0.55, (2 * R) / 9 + 0.4, 0, -slope, C.roofPale);
      }
      // A-pylons at +-58: two legs leaning together in the along/up
      // plane, cap on top — each leg three stacked segments stepping
      // inward with height (a stepped A reads at city scale).
      for (const s of [1, -1]) {
        for (const legSign of [1, -1]) {
          for (let seg = 0; seg < 3; seg++) {
            const y0 = seg * 12.4, inset = legSign * (7.2 - seg * 2.6);
            box(s * 58 + inset, 0, 2.4, 3.0, y0, y0 + 12.6, C.pylon);
          }
        }
        box(s * 58, 0, 3.4, 3.6, 36.8, 39.2, C.pylon);
        // Backstay fan: from the pylon top down-outward past the
        // hull end to anchor blocks beside the guideway — the
        // photo's splayed stays are half the station's drama.
        for (const v of [-10, 10]) {
          const u0 = s * 58, y0 = 36.5, u1 = s * 120, y1 = 10.5;
          const len = Math.hypot(u1 - u0, y1 - y0);
          const ang = Math.atan2(y1 - y0, u1 - u0);
          tiltBox(v, (y0 + y1) / 2, (u0 + u1) / 2, 0.5, 0.5, len, 0, -ang, C.cable);
          box(u1, v, 3, 3, 8.6, 11.2, C.concrete);
        }
      }
      // Catenary cable + orange hangers down to the roof.
      const topY = 38.6, midY = 26.8, P = 58;
      const cableY = (u) => midY + (topY - midY) * (u / P) * (u / P);
      const N = 18;
      let prev = null;
      for (let i = 0; i <= N; i++) {
        const u = -P + (i * 2 * P) / N;
        const p = [0, cableY(u), u];
        if (prev) {
          const mu = (u + prev[2]) / 2, my = (cableY(u) + prev[1]) / 2;
          const lenSeg = Math.hypot(u - prev[2], cableY(u) - prev[1]);
          const ang = Math.atan2(cableY(u) - prev[1], u - prev[2]);
          tiltBox(0, my, mu, 0.75, 0.75, lenSeg + 0.3, 0, -ang, C.cable);
        }
        prev = p;
        if (i % 2 === 0 && Math.abs(u) < P - 2) {
          box(u, 0, 2.2, 2.4, cableY(u) - 0.8, cableY(u) + 0.8, C.roofTile); // orange hanger block
          const ry = sagY(u * (66 / 58)) + 0.4;
          if (cableY(u) - 0.8 > ry) box(u, 0, 0.3, 0.3, ry, cableY(u) - 0.8, C.cable); // hanger rod
        }
      }
    } else if (st.kind === 'beitou') {
      for (const u of [-52, 0, 52]) box(u, 0, 4.4, 4.4, 0, 4.6, C.concrete);
      box(0, 0, L, Wd, 4.6, 12.6, C.concreteLight);          // four-track body
      box(0, 0, L + 2, Wd + 1.6, 12.6, 14.8, 0x9b958a);      // deep fascia band
      box(0, 0, L - 2, Wd - 0.6, 14.8, 19.4, C.beitouGlass); // glazed lattice band
      hip(0, 19.4, L + 4, Wd + 2.6, 1.7, 5, 6, C.beitouRoof); // thin sloped glass roof
    } else if (st.kind === 'xinbeitou') {
      for (const u of [-L / 3, L / 3]) box(u, 0, 2.2, 2.2, 0, 4.6, C.concrete);
      box(0, 0, L, Wd, 4.6, 13.0, C.brick);
      box(0, 0, L, Wd + 0.3, 10.4, 12.2, C.glass);
      // Terminus end wall (+u end) with the red MRT band.
      box(L / 2 + 1.2, 0, 2.4, Wd + 0.6, 4.6, 13.8, C.brick);
      box(L / 2 + 1.2, 0, 2.7, Wd + 0.8, 9.6, 11.6, C.mrtRed);
      const seg = L / 2;
      for (const u of [-L / 4, L / 4]) {
        box(u, 0, seg - 1.2, Wd + 1.2, 12.85, 13.2, C.eaveTrim);
        hip(u, 13.0, seg - 1.2, Wd + 0.8, 3.4, 2.6, 3.4, C.roofTile);
      }
    } else {
      // standard — Yuanshan pattern
      for (const u of [-L / 3, 0, L / 3]) box(u, 0, 2.2, 2.2, 0, 4.6, C.concrete);
      box(0, 0, L, Wd, 4.6, 5.8, C.brickDark);
      box(0, 0, L, Wd - 0.5, 4.6, 13.0, C.brick);
      box(0, 0, L, Wd - 0.2, 10.4, 12.2, C.glass);
      const seg = L / 3;
      for (const u of [-L / 3, 0, L / 3]) {
        box(u, 0, seg - 1.2, Wd + 1.9, 12.85, 13.2, C.eaveTrim);
        hip(u, 13.0, seg - 1.2, Wd + 1.3, 3.4, 2.6, 3.4, C.roofTile);
      }
    }
  }
  return {
    positions: new Float32Array(pos), normals: new Float32Array(nor), colors: new Float32Array(col),
    triCount: pos.length / 9, stationCount: (stations || []).length,
  };
}
