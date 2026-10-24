// js/tile-map.js
// Tile-driven in-game map: the GTA-style live radar minimap + full-screen
// interactive atlas for registry tiles (?city=<id>), counterpart of
// js/nyc-map.js for the legacy NYC city. Where the NYC map is a hand-built
// atlas of Manhattan geography imported from city-config.js, this map is
// drawn entirely from the ACTIVE TILE's own data (the tile definition from
// js/tile-registry.js): the generation map's roadbeds, the water & park
// polygons in the tile geodata, and the tile's teleports & landmarks. A new
// tile gets a working map by existing in the registry — no map code changes.
//
// Frames: a tile's world is true-north-up (x = east, z = south, 1 unit =
// 1 m, frame.bearingDeg 0), so world -> map is the identity rotation, drawn
// exactly like the 3D world is laid out.
//
// Performance: the static geography (land, water, parks, roadbeds) is
// rasterized ONCE per tile into an offscreen canvas at a fixed resolution
// (buildStaticCanvas). The radar and the full map then only blit the part
// of that canvas they need (plus their own cached label renders) and draw
// the dynamic markers — player, waypoint, GPS route — per frame.
//
// This module imports nothing and touches no DOM at module scope, so the
// pure parts (buildTileMapModel, TileMapView) are unit-testable in node.

const FONT = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const MAX_ZOOM = 3.0; // full map, pixels per metre: single lots
const MIN_ZOOM = 0.02; // full map floor; "view all" computes the real fit
const RADAR_SCALE = 0.32; // radar pixels per metre on the ground (zooms out with altitude)
const STATIC_MAX_PX = 2048; // longest side of the pre-rendered tile canvas

// Palette shared with js/nyc-map.js so both cities' maps read the same.
const MAP = {
  water: '#0a1118',
  land: '#151a20',
  landEdge: '#252c35',
  park: '#19301f',
  parkEdge: '#24432f',
  pond: '#0f2535',
  pondEdge: '#1d3d54',
  roadCasing: '#20262e',
  roadMinor: '#2e3641',
  road: '#363f4b',
  roadMajor: '#454f5e',
  route: '#ffc21a',
  search: '#5fd0ff',
  landmark: '#ffb02e',
  halo: 'rgba(8, 11, 15, 0.9)'
};

const MAJOR_CLASSES = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'secondary']);

// ---------------------------------------------------------------------------
// Pure geometry helpers over flat [x0, z0, x1, z1, ...] point lists
// ---------------------------------------------------------------------------

function flatBounds(pts) {
  const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let i = 0; i + 1 < pts.length; i += 2) {
    if (pts[i] < b.minX) b.minX = pts[i];
    if (pts[i] > b.maxX) b.maxX = pts[i];
    if (pts[i + 1] < b.minZ) b.minZ = pts[i + 1];
    if (pts[i + 1] > b.maxZ) b.maxZ = pts[i + 1];
  }
  return b;
}

/**
 * Street-name label anchors along a flat polyline: every ~260 m along each
 * straight run (consecutive segments within ~5°), with the run's direction,
 * normalized so text is never upside down. Same algorithm as nyc-map.js,
 * adapted to the tile geodata's flat point lists.
 */
function labelAnchorsFor(pts) {
  const anchors = [];
  const n = pts.length >> 1;
  const X = (i) => pts[2 * i];
  const Z = (i) => pts[2 * i + 1];
  for (let i = 0; i + 1 < n;) {
    const ax = X(i);
    const az = Z(i);
    const dir = Math.atan2(Z(i + 1) - az, X(i + 1) - ax);
    let j = i + 1;
    while (j + 1 < n) {
      const d = Math.atan2(Z(j + 1) - Z(j), X(j + 1) - X(j));
      let turn = Math.abs(d - dir);
      if (turn > Math.PI) turn = 2 * Math.PI - turn;
      if (turn > 0.09) break;
      j++;
    }
    const cx = X(j);
    const cz = Z(j);
    i = j;
    const len = Math.hypot(cx - ax, cz - az);
    if (len < 20) continue;
    let ang = Math.atan2(cz - az, cx - ax);
    if (ang >= Math.PI * 0.5 - 0.01) ang -= Math.PI;
    else if (ang < -Math.PI * 0.5 - 0.01) ang += Math.PI;
    const k = Math.max(1, Math.round(len / 260));
    for (let m = 0; m < k; m++) {
      const t = (m + 0.5) / k;
      anchors.push({ x: ax + (cx - ax) * t, z: az + (cz - az) * t, ang, len: len / k });
    }
  }
  return anchors;
}

/**
 * The map model for a tile definition: everything the renderers draw,
 * normalized out of the tile's geodata. Pure (no DOM, no canvas) so tests
 * can assert it against the source geodata.
 *
 * tile: { id, label, short, frame?, geodata, teleports?, landmarks?,
 *         getLocationLabel?, districtAt?, spawn? }
 * geodata: { frame: { bbox, bearingDeg }, roadbeds? | roads, water, parks }
 */
export function buildTileMapModel(tile) {
  const geo = (tile && tile.geodata) || {};
  const frame = geo.frame || (tile && tile.frame) || {};
  const bb = frame.bbox || { minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 };
  const bounds = { minX: bb.minX, maxX: bb.maxX, minZ: bb.minZ, maxZ: bb.maxZ };
  // Land shape: a union-of-boxes tile (frame.boxes, issue #60) fills
  // one rect per box, so the dropped bands inside the bounding rect
  // stay un-land like the area outside the tile. A tile without boxes
  // fills its whole bounding rect, as before.
  const landRects = Array.isArray(frame.boxes) && frame.boxes.length
    ? frame.boxes.map((b) => ({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ }))
    : [bounds];

  // Roads: the generation map's merged roadbeds are what the 3D world
  // renders and what the player drives on; fall back to the raw roads for a
  // tile that has not grown a generation map yet.
  const beds = Array.isArray(geo.roadbeds) && geo.roadbeds.length ? geo.roadbeds : (geo.roads || []);
  const roads = [];
  for (const b of beds) {
    if (!b || !b.pts || b.pts.length < 4) continue;
    roads.push({
      name: b.name || b.nameEn || '',
      width: b.width || 0,
      highway: b.highway || '',
      pts: b.pts,
      ...flatBounds(b.pts)
    });
  }

  // Road-name labels grouped by street name (one entry per street, anchors
  // merged across its roadbeds, exactly how nyc-map keys labels per road).
  const byName = new Map();
  for (const r of roads) {
    if (!r.name || /^Unnamed/.test(r.name)) continue;
    const anchors = labelAnchorsFor(r.pts);
    if (!anchors.length) continue;
    let e = byName.get(r.name);
    if (!e) {
      e = {
        text: r.name, lower: r.name.toLowerCase(), major: false, roads: [], anchors: [],
        minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity
      };
      byName.set(r.name, e);
    }
    e.major = e.major || r.width >= 15 || MAJOR_CLASSES.has(r.highway);
    e.roads.push(r);
    e.anchors.push(...anchors);
    e.minX = Math.min(e.minX, r.minX);
    e.maxX = Math.max(e.maxX, r.maxX);
    e.minZ = Math.min(e.minZ, r.minZ);
    e.maxZ = Math.max(e.maxZ, r.maxZ);
  }
  const roadLabels = [...byName.values()];

  const ringsOf = (list) => (list || [])
    .filter((p) => p && p.ring && p.ring.length >= 6)
    .map((p) => ({ name: p.name || '', ring: p.ring, ...flatBounds(p.ring) }));
  const water = ringsOf(geo.water);
  const parks = ringsOf(geo.parks);

  const teleports = Object.entries((tile && tile.teleports) || {})
    .map(([key, t]) => ({ key, x: t.x, z: t.z, name: t.name || key, sub: t.sub || '' }))
    .filter((t) => Number.isFinite(t.x) && Number.isFinite(t.z));
  const landmarks = ((tile && tile.landmarks) || [])
    .map((l) => ({
      id: l.id, name: l.name, nameZh: l.nameZh || '', short: l.short || l.name,
      x: l.x, z: l.z, height: l.height || 0
    }))
    .filter((l) => Number.isFinite(l.x) && Number.isFinite(l.z));

  return {
    tileId: tile && tile.id,
    label: (tile && tile.label) || '',
    short: (tile && tile.short) || '',
    bearingDeg: frame.bearingDeg || 0,
    bounds,
    landRects,
    centre: { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 },
    widthM: bounds.maxX - bounds.minX,
    heightM: bounds.maxZ - bounds.minZ,
    roads,
    roadLabels,
    water,
    parks,
    teleports,
    landmarks,
    counts: {
      roads: roads.length,
      roadNames: byName.size,
      water: water.length,
      parks: parks.length,
      teleports: teleports.length,
      landmarks: landmarks.length
    }
  };
}

/** A map viewport: centre (cx, cz) in world metres, s pixels per metre, w x h CSS pixels at pixel ratio dpr. */
export class TileMapView {
  constructor(cx, cz, s, w, h, dpr = 1) {
    this.cx = cx;
    this.cz = cz;
    this.s = s;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.minX = cx - w / (2 * s);
    this.maxX = cx + w / (2 * s);
    this.minZ = cz - h / (2 * s);
    this.maxZ = cz + h / (2 * s);
  }

  /** Canvas transform for world metres */
  world(ctx) {
    const { s, dpr } = this;
    ctx.setTransform(s * dpr, 0, 0, s * dpr, dpr * (this.w * 0.5 - this.cx * s), dpr * (this.h * 0.5 - this.cz * s));
  }

  /** Canvas transform for CSS pixels from the canvas centre (what toX / toY return) */
  screen(ctx) {
    ctx.setTransform(this.dpr, 0, 0, this.dpr, this.dpr * this.w * 0.5, this.dpr * this.h * 0.5);
  }

  toX(x) {
    return (x - this.cx) * this.s;
  }

  toY(z) {
    return (z - this.cz) * this.s;
  }

  sees(b) {
    return b && b.maxX >= this.minX && b.minX <= this.maxX && b.maxZ >= this.minZ && b.minZ <= this.maxZ;
  }
}

// Player heading arrow at the (already rotated) origin: white, on a dark halo
function drawPlayerArrow(ctx, tipY, halfWidth, tailY) {
  ctx.beginPath();
  ctx.moveTo(0, tipY);
  ctx.lineTo(halfWidth, tailY);
  ctx.lineTo(0, tailY * 0.45);
  ctx.lineTo(-halfWidth, tailY);
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = MAP.halo;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
}

// GPS route from the player to the waypoint: a straight taxi-yellow line on
// a dark casing (NYC draws an L along its grid; a tile has no grid to follow)
function drawRoute(ctx, x0, y0, x1, y1, width) {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.strokeStyle = MAP.halo;
  ctx.lineWidth = width + 3;
  ctx.stroke();
  ctx.strokeStyle = MAP.route;
  ctx.lineWidth = width;
  ctx.stroke();
}

// Waypoint: a taxi-yellow target
function drawWaypoint(ctx, x, y, r) {
  ctx.fillStyle = MAP.halo;
  ctx.beginPath();
  ctx.arc(x, y, r + 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = MAP.route;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = MAP.halo;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.38, 0, Math.PI * 2);
  ctx.fill();
}

const overlaps = (boxes, b) => boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);

// Keyboard shortcuts are ignored while typing into a form field (the map's
// search box) — same rule as city-config's isTypingInField, kept local so
// this module stays import-free.
function isTypingInField(e) {
  return e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT');
}

export class TileMapSystem {
  constructor({ controllerManager, cameraSystem, trafficSystem = null, tile, onTeleport, onToggle }) {
    this.controllerManager = controllerManager;
    this.cameraSystem = cameraSystem;
    this.trafficSystem = trafficSystem;
    this.tile = tile;
    this.onTeleport = onTeleport;
    this.onToggle = onToggle;
    this.model = buildTileMapModel(tile);
    const model = this.model;

    this.miniCanvas = document.getElementById('minimap-canvas');
    this.miniCtx = this.miniCanvas ? this.miniCanvas.getContext('2d') : null;
    this.elMiniStreet = document.getElementById('minimap-street-label');
    this.miniStreetText = '';
    this.miniScale = RADAR_SCALE;
    this.miniCache = null; // { canvas, ctx, cx, cz, s }: the radar's ground layers, twice the radar's size
    this.staticCanvas = null; // the whole tile's static geography, rendered once (ensureStatic)
    this.staticScale = 0;
    const elCounts = document.getElementById('fullmap-counts');
    if (elCounts) {
      elCounts.textContent = `${model.counts.roadNames} streets · ${model.counts.parks} parks · ${model.counts.teleports} teleports`;
    }

    // The tile frame is true-north-up; the compass needle rotates by the
    // frame bearing exactly like the NYC map does for its grid bearing.
    const needle = document.getElementById('map-compass-needle');
    if (needle) needle.setAttribute('transform', `rotate(${-model.bearingDeg} 22 22)`);

    // The modal's static NYC titles follow the active tile.
    const bullet = document.querySelector('.fullmap-title .mta-bullet');
    if (bullet && model.short) bullet.textContent = model.short;
    const title = document.querySelector('.fullmap-title h2');
    if (title && model.label) title.textContent = model.label;
    const miniCard = document.getElementById('minimap-card');
    if (miniCard && model.label) {
      miniCard.setAttribute('aria-label', `Live ${model.label} Radar Minimap`);
      miniCard.title = 'Open the full map [M]';
    }

    this.modal = document.getElementById('fullmap-modal');
    this.fullCanvas = document.getElementById('fullmap-canvas');
    this.fullCanvasWrap = document.getElementById('fullmap-canvas-wrap');
    this.fullCtx = this.fullCanvas ? this.fullCanvas.getContext('2d') : null;
    this.fullDpr = 1;
    this.fullStatic = null; // the full map's ground layers & labels for the current view
    this.fullStaticKey = '';
    this.elHoverInfo = document.getElementById('fullmap-hover-info');
    this.elPlayerInfo = document.getElementById('fullmap-player-info');
    this.elSearchInput = document.getElementById('fullmap-search');
    if (this.elSearchInput) this.elSearchInput.placeholder = `Search ${model.counts.roadNames} streets & landmarks…`;

    this.isFullMapOpen = false;
    // Full map viewport state (world metres; zoom in CSS pixels per metre)
    this.viewCenterX = model.centre.x;
    this.viewCenterZ = model.centre.z;
    this.viewZoom = 0.22;
    this.isPanning = false;
    this.panPointerId = null;
    this.panStart = { x: 0, y: 0, cx: 0, cz: 0 };
    this.dragMoved = false;

    this.hoverWorld = null;
    this.searchHighlight = '';
    this.searchRoads = null;
    this.textWidths = new Map();
    // Default GPS waypoint: the tile's spawn (Taipei: Taipei 101), else its
    // first teleport, else the tile centre.
    const spawn = (tile && tile.spawn) || model.teleports[0] || model.centre;
    this.waypoint = {
      x: spawn.x,
      z: spawn.z,
      name: spawn.name || this.locationLabel(spawn.x, spawn.z)
    };

    // Street names measured before the web font arrived would be spaced for
    // the fallback font: measure & draw again once fonts land.
    if (document.fonts) {
      document.fonts.ready.then(() => {
        this.textWidths.clear();
        this.miniCache = null;
        this.fullStaticKey = '';
      });
    }

    this.initEvents();
  }

  /** The tile's own location label for a world point ('' when the tile has none). */
  locationLabel(x, z) {
    if (this.tile && typeof this.tile.getLocationLabel === 'function') return this.tile.getLocationLabel(x, z);
    if (this.tile && typeof this.tile.districtAt === 'function') return this.tile.districtAt(x, z);
    return '';
  }

  initEvents() {
    const closeBtn = document.getElementById('close-fullmap-btn');
    const miniCard = document.getElementById('minimap-card');
    const zoomInBtn = document.getElementById('map-zoom-in');
    const zoomOutBtn = document.getElementById('map-zoom-out');
    const centerPlayerBtn = document.getElementById('map-center-player');
    const viewAllBtn = document.getElementById('map-view-all');

    if (miniCard) {
      miniCard.addEventListener('click', () => this.toggleFullMap(true));
    }
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.toggleFullMap(false));
    }
    if (zoomInBtn) {
      zoomInBtn.addEventListener('click', () => {
        this.viewZoom = Math.min(MAX_ZOOM, this.viewZoom * 1.45);
        this.renderFullMap();
      });
    }
    if (zoomOutBtn) {
      zoomOutBtn.addEventListener('click', () => {
        this.viewZoom = Math.max(MIN_ZOOM, this.viewZoom / 1.45);
        this.renderFullMap();
      });
    }
    if (centerPlayerBtn) {
      centerPlayerBtn.addEventListener('click', () => {
        const ent = this.controllerManager.getActiveEntity();
        this.viewCenterX = ent.position.x;
        this.viewCenterZ = ent.position.z;
        this.viewZoom = 0.9; // Street-by-street detail zoom
        this.renderFullMap();
      });
    }
    if (viewAllBtn) {
      viewAllBtn.addEventListener('click', () => {
        this.fitTile();
        this.renderFullMap();
      });
    }
    if (this.elSearchInput) {
      this.elSearchInput.addEventListener('input', () => this.search(this.elSearchInput.value));
    }

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.isFullMapOpen) {
        this.toggleFullMap(false);
      } else if (e.code === 'KeyM' && !isTypingInField(e)) {
        this.toggleFullMap(!this.isFullMapOpen);
      }
    });

    if (this.fullCanvas) {
      this.fullCanvas.style.touchAction = 'none';
      this.fullCanvas.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || !this.isFullMapOpen || this.panPointerId !== null) return;
        e.preventDefault();
        this.panPointerId = e.pointerId;
        this.fullCanvas.setPointerCapture(e.pointerId);
        this.isPanning = true;
        this.dragMoved = false;
        this.panStart.x = e.clientX;
        this.panStart.y = e.clientY;
        this.panStart.cx = this.viewCenterX;
        this.panStart.cz = this.viewCenterZ;
        if (this.fullCanvasWrap) this.fullCanvasWrap.classList.add('is-panning');
      });

      this.fullCanvas.addEventListener('pointermove', (e) => {
        if (!this.isFullMapOpen || !this.fullCanvas) return;
        if (this.isPanning ? e.pointerId !== this.panPointerId : e.pointerType !== 'mouse') return;
        const rect = this.fullCanvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        if (this.isPanning) {
          e.preventDefault();
          const dx = e.clientX - this.panStart.x;
          const dy = e.clientY - this.panStart.y;
          if (Math.hypot(dx, dy) > 5) this.dragMoved = true;
          this.viewCenterX = this.panStart.cx - dx / this.viewZoom;
          this.viewCenterZ = this.panStart.cz - dy / this.viewZoom;
          this.renderFullMap();
          return;
        }

        if (mx >= 0 && mx <= rect.width && my >= 0 && my <= rect.height) {
          const wPos = this.screenToWorld(mx, my, rect.width, rect.height);
          this.hoverWorld = wPos;
          if (this.elHoverInfo) {
            this.elHoverInfo.textContent = `${this.locationLabel(wPos.x, wPos.z)} · Click to teleport here`;
          }
        }
      });

      this.fullCanvas.addEventListener('pointerup', (e) => {
        if (e.pointerId !== this.panPointerId) return;
        const clicked = !this.dragMoved && Math.hypot(e.clientX - this.panStart.x, e.clientY - this.panStart.y) <= 5;
        this.cancelPan();
        if (clicked && this.isFullMapOpen && this.fullCanvas) {
          const rect = this.fullCanvas.getBoundingClientRect();
          const mx = e.clientX - rect.left;
          const my = e.clientY - rect.top;
          if (mx >= 0 && mx <= rect.width && my >= 0 && my <= rect.height) {
            const wPos = this.clampToTile(this.screenToWorld(mx, my, rect.width, rect.height));
            this.waypoint = {
              x: wPos.x,
              z: wPos.z,
              name: this.locationLabel(wPos.x, wPos.z)
            };
            if (this.onTeleport) {
              this.onTeleport(wPos.x, wPos.z);
            }
            this.renderFullMap();
          }
        }
      });
      for (const type of ['pointercancel', 'lostpointercapture']) {
        this.fullCanvas.addEventListener(type, (e) => {
          if (e.pointerId === this.panPointerId) this.cancelPan();
        });
      }
      window.addEventListener('blur', () => this.cancelPan());
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.cancelPan();
      });

      // Wheel zoom about the cursor (the place under it stays put)
      this.fullCanvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect = this.fullCanvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const before = this.screenToWorld(mx, my, rect.width, rect.height);
        const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
        this.viewZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.viewZoom * factor));
        this.viewCenterX = before.x - (mx - rect.width * 0.5) / this.viewZoom;
        this.viewCenterZ = before.z - (my - rect.height * 0.5) / this.viewZoom;
        this.renderFullMap();
      }, { passive: false });
    }
  }

  /**
   * Street / landmark / teleport search: highlights every roadbed of the
   * matching streets and frames them (or flies to the matching place).
   */
  search(text) {
    const q = String(text || '').trim().toLowerCase();
    this.searchHighlight = q;
    this.searchRoads = null;
    if (q.length > 0) {
      const place = this.model.landmarks.find((l) => l.name.toLowerCase().includes(q) || (l.short || '').toLowerCase().includes(q) || (l.nameZh || '').includes(q))
        || this.model.teleports.find((t) => t.name.toLowerCase().includes(q) || t.sub.toLowerCase().includes(q));
      const labels = this.model.roadLabels.filter((l) => l.lower.includes(q));
      if (labels.length) {
        this.searchRoads = [];
        const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
        for (const l of labels) {
          this.searchRoads.push(...l.roads);
          b.minX = Math.min(b.minX, l.minX);
          b.maxX = Math.max(b.maxX, l.maxX);
          b.minZ = Math.min(b.minZ, l.minZ);
          b.maxZ = Math.max(b.maxZ, l.maxZ);
        }
        this.searchBounds = b;
      }
      if (place) {
        this.viewCenterX = place.x;
        this.viewCenterZ = place.z;
        this.viewZoom = Math.max(this.viewZoom, 0.9);
      } else if (labels.length) {
        const b = this.searchBounds;
        const { w, h } = this.fullSize();
        this.viewCenterX = (b.minX + b.maxX) * 0.5;
        this.viewCenterZ = (b.minZ + b.maxZ) * 0.5;
        const fit = Math.min(w / ((b.maxX - b.minX) * 1.3 + 1), h / ((b.maxZ - b.minZ) * 1.3 + 1));
        this.viewZoom = Math.max(0.05, Math.min(1.2, fit));
      }
    }
    this.renderFullMap();
  }

  cancelPan() {
    const id = this.panPointerId;
    this.panPointerId = null;
    this.isPanning = false;
    if (this.fullCanvasWrap) this.fullCanvasWrap.classList.remove('is-panning');
    if (id !== null && this.fullCanvas && this.fullCanvas.hasPointerCapture(id)) this.fullCanvas.releasePointerCapture(id);
  }

  toggleFullMap(open) {
    this.isFullMapOpen = Boolean(open);
    if (!this.isFullMapOpen) this.cancelPan();
    if (this.onToggle) this.onToggle(this.isFullMapOpen);
    if (!this.modal) return;
    this.modal.classList.toggle('hidden', !this.isFullMapOpen);
    if (this.isFullMapOpen) {
      // the HUD's popovers live in the top layer, above the map
      for (const pop of document.querySelectorAll('.popover[popover]')) {
        if (typeof pop.hidePopover === 'function' && pop.matches(':popover-open')) pop.hidePopover();
      }
      const ent = this.controllerManager.getActiveEntity();
      this.viewCenterX = ent.position.x;
      this.viewCenterZ = ent.position.z;
      this.resizeFullCanvas();
      this.renderFullMap();
    }
  }

  resizeFullCanvas() {
    if (!this.fullCanvas) return;
    // Layout size (the opening animation's transforms don't change it), at most ~6 megapixels however large the screen
    const w = this.fullCanvas.clientWidth || window.innerWidth;
    const h = this.fullCanvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(6e6 / Math.max(1, w * h)));
    this.fullDpr = dpr;
    this.fullCanvas.width = Math.max(1, Math.floor(w * dpr));
    this.fullCanvas.height = Math.max(1, Math.floor(h * dpr));
  }

  // Full map size in CSS pixels
  fullSize() {
    const dpr = this.fullDpr || 1;
    if (!this.fullCanvas) return { w: 1200, h: 800 };
    return { w: this.fullCanvas.width / dpr, h: this.fullCanvas.height / dpr };
  }

  screenToWorld(sx, sy, width, height) {
    return {
      x: this.viewCenterX + (sx - width * 0.5) / this.viewZoom,
      z: this.viewCenterZ + (sy - height * 0.5) / this.viewZoom
    };
  }

  // Teleports land inside the tile (NYC clamps to Manhattan's shore instead)
  clampToTile(p) {
    const bb = this.model.bounds;
    return {
      x: Math.max(bb.minX + 25, Math.min(bb.maxX - 25, p.x)),
      z: Math.max(bb.minZ + 25, Math.min(bb.maxZ - 25, p.z))
    };
  }

  // Frame the whole tile in the full map
  fitTile() {
    const bb = this.model.bounds;
    const { w, h } = this.fullSize();
    this.viewCenterX = (bb.minX + bb.maxX) * 0.5;
    this.viewCenterZ = (bb.minZ + bb.maxZ) * 0.5;
    this.viewZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM,
      Math.min(w / (this.model.widthM * 1.06), h / (this.model.heightM * 1.06))));
  }

  textWidth(ctx, text) {
    const key = `${ctx.font}|${ctx.letterSpacing || ''}|${text}`;
    let w = this.textWidths.get(key);
    if (w === undefined) {
      w = ctx.measureText(text).width;
      this.textWidths.set(key, w);
    }
    return w;
  }

  // =========================================================================
  // Static geography: rendered ONCE per tile into an offscreen canvas; every
  // view then just blits the region it needs from it.
  // =========================================================================
  ensureStatic() {
    if (this.staticCanvas) return this.staticCanvas;
    const model = this.model;
    const bb = model.bounds;
    const ss = STATIC_MAX_PX / Math.max(model.widthM, model.heightM); // canvas px per metre
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(model.widthM * ss));
    canvas.height = Math.max(1, Math.round(model.heightM * ss));
    const ctx = canvas.getContext('2d');
    // Draw in world metres
    ctx.setTransform(ss, 0, 0, ss, -bb.minX * ss, -bb.minZ * ss);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const px = (n) => n / ss; // screen pixels -> metres

    // 1. Land: the tile's land rects (the whole bounding rect for a
    //    plain tile; one rect per box for a union tile, issue #60)
    ctx.fillStyle = MAP.land;
    for (const r of model.landRects || [bb]) ctx.fillRect(r.minX, r.minZ, r.maxX - r.minX, r.maxZ - r.minZ);

    // 2. Parks
    ctx.fillStyle = MAP.park;
    for (const p of model.parks) {
      ctx.beginPath();
      ctx.moveTo(p.ring[0], p.ring[1]);
      for (let i = 2; i + 1 < p.ring.length; i += 2) ctx.lineTo(p.ring[i], p.ring[i + 1]);
      ctx.closePath();
      ctx.fill();
    }

    // 3. Water (rivers, ponds): drawn after parks — in the geodata the
    // Keelung River band borders parkland and water wins, as in the 3D world
    ctx.fillStyle = MAP.pond;
    for (const w of model.water) {
      ctx.beginPath();
      ctx.moveTo(w.ring[0], w.ring[1]);
      for (let i = 2; i + 1 < w.ring.length; i += 2) ctx.lineTo(w.ring[i], w.ring[i + 1]);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = MAP.pondEdge;
    ctx.lineWidth = px(1);
    for (const w of model.water) {
      ctx.beginPath();
      ctx.moveTo(w.ring[0], w.ring[1]);
      for (let i = 2; i + 1 < w.ring.length; i += 2) ctx.lineTo(w.ring[i], w.ring[i + 1]);
      ctx.closePath();
      ctx.stroke();
    }

    // 4. Roadbeds: dark casing under every road, then the surface by class —
    // drawn at their true widths (a 28 m boulevard is a band, a 3 m alley a
    // thread), with a floor so the narrowest lanes stay visible.
    const isMajor = (r) => r.width >= 15 || MAJOR_CLASSES.has(r.highway);
    const passes = [
      { color: MAP.roadCasing, grow: 1.6, min: 3 },
      { color: MAP.roadMinor, grow: 0, min: 1.6, only: (r) => !(r.width >= 8 || MAJOR_CLASSES.has(r.highway)) },
      { color: MAP.road, grow: 0, min: 1.6, only: (r) => (r.width >= 8 || MAJOR_CLASSES.has(r.highway)) && !isMajor(r) },
      { color: MAP.roadMajor, grow: 0, min: 1.6, only: isMajor }
    ];
    for (const pass of passes) {
      ctx.strokeStyle = pass.color;
      for (const r of model.roads) {
        if (pass.only && !pass.only(r)) continue;
        ctx.lineWidth = Math.max(r.width + pass.grow, pass.min);
        ctx.beginPath();
        ctx.moveTo(r.pts[0], r.pts[1]);
        for (let i = 2; i + 1 < r.pts.length; i += 2) ctx.lineTo(r.pts[i], r.pts[i + 1]);
        ctx.stroke();
      }
    }

    // 5. Tile boundary
    ctx.strokeStyle = MAP.landEdge;
    ctx.lineWidth = px(1.6);
    ctx.strokeRect(bb.minX, bb.minZ, model.widthM, model.heightM);

    this.staticCanvas = canvas;
    this.staticScale = ss;
    return canvas;
  }

  /** Blit the static tile canvas into ctx under view v (caller fills the outside-tile water first). */
  blitStatic(ctx, v) {
    const canvas = this.ensureStatic();
    const bb = this.model.bounds;
    const dpr = v.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    const dx = (bb.minX - v.cx) * v.s * dpr + v.w * dpr * 0.5;
    const dy = (bb.minZ - v.cz) * v.s * dpr + v.h * dpr * 0.5;
    ctx.drawImage(canvas, dx, dy, this.model.widthM * v.s * dpr, this.model.heightM * v.s * dpr);
  }

  /**
   * Street names along the streets (screen transform of view v): the best
   * anchor of each street that fits its name, one label per street per
   * `sameNameGap` pixels, none overlapping another (or the boxes in `placed`).
   */
  drawRoadLabels(ctx, v, { fontPx = 10, maxLabels = 400, sameNameGap = 260, placed = [], majorOnly = false } = {}) {
    const s = v.s;
    const q = this.searchHighlight;
    ctx.font = `600 ${fontPx}px ${FONT}`;
    const inset = (fontPx * 2.5) / s;
    const minX = v.minX + inset;
    const maxX = v.maxX - inset;
    const minZ = v.minZ + inset;
    const maxZ = v.maxZ - inset;
    const cands = [];
    for (const l of this.model.roadLabels) {
      if (l.maxX < minX || l.minX > maxX || l.maxZ < minZ || l.minZ > maxZ) continue;
      const hit = q.length > 0 && l.lower.includes(q);
      if (majorOnly && !l.major && !hit) continue;
      const width = this.textWidth(ctx, l.text);
      const need = (width + 14) / s;
      for (const a of l.anchors) {
        if (a.len < need || a.x < minX || a.x > maxX || a.z < minZ || a.z > maxZ) continue;
        const d = Math.hypot(a.x - v.cx, a.z - v.cz) * s;
        cands.push({ l, a, width, hit, score: (hit ? 1e6 : 0) + (l.major ? 2000 : 0) + Math.min(a.len * s, 400) - d * 0.5 });
      }
    }
    cands.sort((a, b) => b.score - a.score);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = MAP.halo;
    const byName = new Map();
    let n = 0;
    for (const c of cands) {
      if (n >= maxLabels) break;
      const X = v.toX(c.a.x);
      const Y = v.toY(c.a.z);
      const same = byName.get(c.l.text);
      if (same && same.some(([x, y]) => Math.hypot(x - X, y - Y) < sameNameGap)) continue;
      const hw = c.width * 0.5 + 3;
      const hh = fontPx * 0.5 + 2;
      const ca = Math.abs(Math.cos(c.a.ang));
      const sa = Math.abs(Math.sin(c.a.ang));
      const bx = hw * ca + hh * sa;
      const by = hw * sa + hh * ca;
      const box = [X - bx, Y - by, X + bx, Y + by];
      if (overlaps(placed, box)) continue;
      placed.push(box);
      if (same) same.push([X, Y]);
      else byName.set(c.l.text, [[X, Y]]);
      ctx.save();
      ctx.translate(X, Y);
      ctx.rotate(c.a.ang);
      ctx.fillStyle = c.hit ? MAP.search : c.l.major ? '#e8ebf0' : '#9ba5b3';
      ctx.strokeText(c.l.text, 0, 0);
      ctx.fillText(c.l.text, 0, 0);
      ctx.restore();
      n++;
    }
    ctx.textBaseline = 'alphabetic';
  }

  update() {
    // The full map covers the whole screen, radar included
    if (this.isFullMapOpen) {
      this.renderFullMap();
    } else {
      this.renderMinimap();
    }
  }

  // =========================================================================
  // 1. LIVE RADAR MINIMAP (BOTTOM-LEFT HUD)
  // =========================================================================
  renderMinimap() {
    if (!this.miniCtx || !this.miniCanvas) return;
    // Nothing to draw while the radar is hidden (narrow screens, clean view)
    if (!this.miniCanvas.offsetParent || document.body.classList.contains('hud-minimized')) return;
    const ctx = this.miniCtx;
    // Radar size in CSS pixels, backed at the device pixel ratio
    const w = this.miniCanvas.clientWidth;
    const h = this.miniCanvas.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (this.miniCanvas.width !== bw || this.miniCanvas.height !== bh) {
      this.miniCanvas.width = bw;
      this.miniCanvas.height = bh;
      this.miniCache = null;
    }

    const ent = this.controllerManager.getActiveEntity();
    const px = ent.position.x;
    const pz = ent.position.z;
    // Ground-level radar shows ~800 m of the city; it zooms out as the camera climbs (helicopter)
    const target = Math.max(0.05, RADAR_SCALE / (1 + Math.max(0, ent.position.y - 25) / 180));
    this.miniScale += (target - this.miniScale) * 0.08;
    const scale = this.miniScale;

    if (this.elMiniStreet) {
      const label = this.locationLabel(px, pz);
      if (label !== this.miniStreetText) {
        this.miniStreetText = label;
        this.elMiniStreet.textContent = label;
      }
    }

    // Ground layers & street names come from a cached render twice the
    // radar's size (a blit of the once-rendered tile canvas, plus labels),
    // redrawn only when the player nears its edge or the zoom drifts.
    let c = this.miniCache;
    if (!c || Math.abs(scale / c.s - 1) > 0.12 ||
      Math.abs(px - c.cx) > w / c.s - w / (2 * scale) - 8 / scale ||
      Math.abs(pz - c.cz) > h / c.s - h / (2 * scale) - 8 / scale) {
      if (!c) {
        c = this.miniCache = { canvas: document.createElement('canvas') };
        c.canvas.width = bw * 2;
        c.canvas.height = bh * 2;
        c.ctx = c.canvas.getContext('2d');
      }
      c.cx = px;
      c.cz = pz;
      c.s = scale;
      c.ctx.setTransform(1, 0, 0, 1, 0, 0);
      c.ctx.fillStyle = MAP.water;
      c.ctx.fillRect(0, 0, bw * 2, bh * 2);
      const cv = new TileMapView(px, pz, scale, w * 2, h * 2, dpr);
      this.blitStatic(c.ctx, cv);
      cv.screen(c.ctx);
      this.drawRoadLabels(c.ctx, cv, { fontPx: 9.5, maxLabels: 28, sameNameGap: 180 });
    }

    const v = new TileMapView(px, pz, scale, w, h, dpr);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = MAP.water;
    ctx.fillRect(0, 0, bw, bh);
    const k = scale / c.s;
    ctx.drawImage(c.canvas, dpr * ((c.cx - w / c.s - px) * scale + w * 0.5), dpr * ((c.cz - h / c.s - pz) * scale + h * 0.5),
      dpr * w * 2 * k, dpr * h * 2 * k);

    v.screen(ctx);
    const toX = (wx) => v.toX(wx);
    const toY = (wz) => v.toY(wz);

    // Live moving traffic blips on radar (a tile without traffic skips this)
    if (this.trafficSystem && this.trafficSystem.cars) {
      ctx.fillStyle = 'rgba(226, 232, 240, 0.34)';
      for (let i = 0; i < this.trafficSystem.cars.length; i += 2) {
        const car = this.trafficSystem.cars[i];
        const cx = toX(car.x);
        const cy = toY(car.z);
        if (Math.abs(cx) < w * 0.5 && Math.abs(cy) < h * 0.5) {
          ctx.fillRect(cx - 1, cy - 1, 2, 2);
        }
      }
    }

    // GPS route to the active waypoint
    if (this.waypoint) {
      const wx = toX(this.waypoint.x);
      const wy = toY(this.waypoint.z);
      drawRoute(ctx, 0, 0, wx, wy, 3);
      drawWaypoint(ctx, wx, wy, 4.5);
    }

    // Teleport blips: white circles.
    for (const p of this.model.teleports) {
      const lx = toX(p.x);
      const ly = toY(p.z);
      if (Math.abs(lx) < w * 0.48 && Math.abs(ly) < h * 0.48) {
        ctx.fillStyle = MAP.halo;
        ctx.beginPath();
        ctx.arc(lx, ly, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(lx, ly, 2.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Landmark blips: amber diamonds — shape AND colour differ from
    // the teleport circles, so the two layers stay legible apart even
    // at radar scale (issue #33).
    for (const p of this.model.landmarks) {
      const lx = toX(p.x);
      const ly = toY(p.z);
      if (Math.abs(lx) < w * 0.48 && Math.abs(ly) < h * 0.48) {
        ctx.fillStyle = MAP.halo;
        ctx.beginPath();
        ctx.moveTo(lx, ly - 5.5);
        ctx.lineTo(lx + 5.5, ly);
        ctx.lineTo(lx, ly + 5.5);
        ctx.lineTo(lx - 5.5, ly);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = MAP.landmark;
        ctx.beginPath();
        ctx.moveTo(lx, ly - 3.8);
        ctx.lineTo(lx + 3.8, ly);
        ctx.lineTo(lx, ly + 3.8);
        ctx.lineTo(lx - 3.8, ly);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Camera FOV Cone & Player Arrow at center (0, 0)
    const camDir = this.cameraSystem.currentLookAt.clone().sub(this.cameraSystem.currentPos);
    const camAngle = Math.atan2(camDir.x, camDir.z);

    ctx.save();
    ctx.rotate(-camAngle + Math.PI);
    const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, 58);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 58, -Math.PI * 0.72, -Math.PI * 0.28);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Player heading arrow
    ctx.save();
    ctx.rotate(-ent.heading + Math.PI);
    drawPlayerArrow(ctx, -9, 6.5, 7);
    ctx.restore();

    ctx.restore();
  }

  // =========================================================================
  // 2. FULL INTERACTIVE TILE MAP MODAL ([M])
  // =========================================================================
  renderFullMap() {
    if (!this.fullCtx || !this.fullCanvas || !this.isFullMapOpen) return;
    const ctx = this.fullCtx;
    const dpr = this.fullDpr || 1;
    const { w, h } = this.fullSize();
    const v = new TileMapView(this.viewCenterX, this.viewCenterZ, this.viewZoom, w, h, dpr);

    const ent = this.controllerManager.getActiveEntity();
    if (this.elPlayerInfo) {
      const text = `You are at ${this.locationLabel(ent.position.x, ent.position.z)}`;
      if (text !== this.playerInfoText) {
        this.playerInfoText = text;
        this.elPlayerInfo.textContent = text;
      }
    }

    // Ground layers & names: re-rendered only when the view or search changes
    const key = `${v.cx}|${v.cz}|${v.s}|${this.fullCanvas.width}|${this.fullCanvas.height}|${this.searchHighlight}`;
    if (!this.fullStatic) this.fullStatic = document.createElement('canvas');
    if (key !== this.fullStaticKey) {
      this.fullStaticKey = key;
      const sc = this.fullStatic;
      if (sc.width !== this.fullCanvas.width || sc.height !== this.fullCanvas.height) {
        sc.width = this.fullCanvas.width;
        sc.height = this.fullCanvas.height;
      }
      this.renderFullMapStatic(sc.getContext('2d'), v);
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.fullStatic, 0, 0);
    v.screen(ctx);
    const toX = (wx) => v.toX(wx);
    const toY = (wz) => v.toY(wz);

    // GPS route on the full map
    if (this.waypoint) {
      const wx = toX(this.waypoint.x);
      const wy = toY(this.waypoint.z);
      drawRoute(ctx, toX(ent.position.x), toY(ent.position.z), wx, wy, 4);
      drawWaypoint(ctx, wx, wy, 7);
    }

    // Live Player Blip & Heading Arrow, with a slow pulse to find it at a glance
    const px = toX(ent.position.x);
    const py = toY(ent.position.z);

    ctx.save();
    ctx.translate(px, py);
    const pulse = (performance.now() % 1800) / 1800;
    ctx.fillStyle = `rgba(255, 255, 255, ${0.24 * (1 - pulse)})`;
    ctx.beginPath();
    ctx.arc(0, 0, 10 + pulse * 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.beginPath();
    ctx.arc(0, 0, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(-ent.heading + Math.PI);
    drawPlayerArrow(ctx, -11, 7.5, 8);
    ctx.restore();

    ctx.restore();
  }

  renderFullMapStatic(ctx, v) {
    const { w, h, s } = v;
    ctx.save();
    // 1. Outside-tile water base
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = MAP.water;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // 2. The tile's static geography, blitted from the once-rendered canvas
    this.blitStatic(ctx, v);

    // 3. Search highlight: every roadbed of the matching streets
    if (this.searchRoads && this.searchRoads.length) {
      v.world(ctx);
      ctx.strokeStyle = MAP.search;
      ctx.lineWidth = Math.max(3 / s, 9);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      for (const r of this.searchRoads) {
        if (!v.sees(r)) continue;
        ctx.beginPath();
        ctx.moveTo(r.pts[0], r.pts[1]);
        for (let i = 2; i + 1 < r.pts.length; i += 2) ctx.lineTo(r.pts[i], r.pts[i + 1]);
        ctx.stroke();
      }
    }

    v.screen(ctx);
    const toX = (wx) => v.toX(wx);
    const toY = (wz) => v.toY(wz);

    // 4. Park names (the tile's green landmarks), where they fit
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (s >= 0.04) {
      ctx.font = `700 10.5px ${FONT}`;
      ctx.fillStyle = 'rgba(146, 190, 152, 0.55)';
      for (const p of this.model.parks) {
        if (!p.name || !v.sees(p)) continue;
        const area = (p.maxX - p.minX) * (p.maxZ - p.minZ);
        if (area < 9000) continue; // only parks big enough to read as places
        const dx = toX((p.minX + p.maxX) / 2);
        const dy = toY((p.minZ + p.maxZ) / 2);
        if (Math.abs(dx) > w * 0.47 || Math.abs(dy) > h * 0.47) continue;
        ctx.fillText(p.name, dx, dy);
      }
    }

    // 5. Teleport & landmark pins & labels (placed first among labels: their
    // boxes keep the street names clear, as on the NYC map)
    ctx.font = `700 11px ${FONT}`;
    const placed = [];
    const pins = [];
    const places = [
      ...this.model.landmarks.map((l) => ({
        x: l.x, z: l.z, kind: 'landmark',
        label: (l.nameZh || l.short) + (l.height ? ` · ${l.height} m` : '')
      })),
      ...this.model.teleports.map((t) => ({ x: t.x, z: t.z, kind: 'teleport', label: t.name }))
    ];
    for (const p of places) {
      const lx = toX(p.x);
      const ly = toY(p.z);
      if (Math.abs(lx) > w * 0.48 || Math.abs(ly) > h * 0.48) continue;
      const labelW = this.textWidth(ctx, p.label) + 6;
      const box = [lx + 6, ly - 8, lx + 8 + labelW, ly + 7];
      const showLabel = !overlaps(placed, box);
      placed.push([lx - 6, ly - 6, lx + 6, ly + 6]);
      if (showLabel) placed.push(box);
      pins.push({ ...p, lx, ly, showLabel });
    }

    // 6. Street names along their real course (collision-free at all zoom levels)
    const fontPx = Math.max(9, Math.min(12, Math.round(9.5 * Math.sqrt(Math.max(s, 0.4)))));
    this.drawRoadLabels(ctx, v, { fontPx, maxLabels: 420, sameNameGap: 300, placed, majorOnly: s < 0.3 });

    ctx.font = `700 11px ${FONT}`;
    ctx.textAlign = 'left';
    for (const { label, lx, ly, showLabel, kind } of pins) {
      if (kind === 'landmark') {
        // Amber diamond pin (matches the radar blip), haloed.
        ctx.fillStyle = MAP.halo;
        ctx.beginPath();
        ctx.moveTo(lx, ly - 8.5);
        ctx.lineTo(lx + 8.5, ly);
        ctx.lineTo(lx, ly + 8.5);
        ctx.lineTo(lx - 8.5, ly);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = MAP.landmark;
        ctx.beginPath();
        ctx.moveTo(lx, ly - 6);
        ctx.lineTo(lx + 6, ly);
        ctx.lineTo(lx, ly + 6);
        ctx.lineTo(lx - 6, ly);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillStyle = MAP.halo;
        ctx.beginPath();
        ctx.arc(lx, ly, 6.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(lx, ly, 4.2, 0, Math.PI * 2);
        ctx.fill();
      }
      if (showLabel) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = MAP.halo;
        ctx.strokeText(label, lx + 9, ly + 4);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(label, lx + 9, ly + 4);
      }
    }

    // 7. Scale bar (true metres)
    this.drawScaleBar(ctx, v);
    ctx.restore();
  }

  drawScaleBar(ctx, v) {
    const target = 120 / v.s; // metres in ~120 px
    const pow = Math.pow(10, Math.floor(Math.log10(target)));
    const step = [1, 2, 5, 10].map((m) => m * pow).filter((m) => m <= target).pop() || pow;
    const len = step * v.s;
    const x0 = -v.w * 0.5 + 24;
    const y0 = v.h * 0.5 - 26;
    const label = step >= 1000 ? `${step / 1000} km` : `${step} m`;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x0, y0 - 6);
    ctx.lineTo(x0, y0);
    ctx.lineTo(x0 + len, y0);
    ctx.lineTo(x0 + len, y0 - 6);
    ctx.strokeStyle = MAP.halo;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(236, 239, 244, 0.92)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.font = `650 11px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.lineWidth = 3;
    ctx.strokeStyle = MAP.halo;
    ctx.strokeText(label, x0 + len + 8, y0 + 3);
    ctx.fillStyle = 'rgba(236, 239, 244, 0.95)';
    ctx.fillText(label, x0 + len + 8, y0 + 3);
  }
}
