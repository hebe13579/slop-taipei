import * as THREE from 'three/webgpu';
import { pass, mrt, output, normalView, positionView, metalness, roughness, vec2, smoothstep } from 'three/tsl';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { createPostProcessing } from './post-processing.js';
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import { getLocationLabel, isTypingInField, ROADS, NYC_LANDMARKS, TELEPORT_LOCATIONS } from './city-config.js';
import { buildCityGrid } from './city-grid.js';
import { buildBoroughs } from './boroughs.js';
import { buildLandmarks } from './landmarks.js';
import { buildCityBlocks } from './buildings.js';
import { buildStreetDetails } from './street-details.js';
import { createTrafficSystem, createHighwayTraffic } from './traffic.js';
import { buildRoadPaint } from './road-paint.js';
import { ThirdPersonControllerManager } from './controllers.js';
import { TouchControls } from './touch-controls.js';
import { GamepadControls } from './gamepad-controls.js';
import { CameraSystem, CAMERA_PRESETS } from './cameras.js';
import { LightingSystem } from './lighting.js';
import { NYCMapSystem } from './nyc-map.js';
import { setupSceneCulling, updateSceneCulling } from './scene-culling.js';
import { CityAudioSystem } from './audio-system.js';
import { resolveSettings, readStoredSettings, persistSettings, graphicsConfig, applyGraphicsSettings, initSettingsPanel, trafficConfig } from './settings.js';
import { setFarFadeEnabled } from './tsl-materials.js';

// js/main.js
// Main entry point for New York City (Midtown Manhattan) in Three.js WebGPURenderer & TSL (three.js dev, see index.html)

async function initApp() {
  const container = document.getElementById('canvas-container');
  const loadingOverlay = document.getElementById('loading-overlay');
  const loadingStatus = document.getElementById('loading-status');
  const loadingTrack = loadingOverlay ? loadingOverlay.querySelector('.loader-track') : null;
  const loadingFill = document.getElementById('loading-progress');
  // The loading bar sweeps while the city is being built (the main thread is busy) and fills as the shaders compile
  const setLoadingProgress = (p) => {
    if (!loadingFill) return;
    if (loadingTrack) loadingTrack.classList.remove('is-indeterminate');
    loadingFill.style.transform = `scaleX(${Math.min(1, Math.max(0, p))})`;
  };
  // Taipei construction reports real staged progress (issue #63, see
  // js/taipei-progress.js) and fills the first share of the bar with
  // it; shader compilation below fills the remainder via progressBase.
  // NYC never sets progressBase, so its bar remains exactly the
  // compile fraction it has always been.
  const TAIPEI_BUILD_PROGRESS_SHARE = 0.5;
  let progressBase = 0;

  // Data-driven tile selection: ?city=<id> (default 'nyc', the legacy built-in
  // city built below). Tile definitions load lazily through
  // js/tile-registry.js, so the NYC boot never evaluates tile modules; adding
  // a tile takes one registry entry + one tile definition, no edits here or
  // in city-config.js.
  const { loadSelectedTile } = await import('./tile-registry.js');
  const tileSelection = await loadSelectedTile(window.location.search);
  const activeTile = tileSelection.tile; // null for the legacy NYC city
  const isTaipei = !!activeTile;
  document.body.dataset.city = tileSelection.id;
  // Startup branding (issue #48): a registry tile swaps the "Slop New York"
  // strings on the startup path — browser tab title, loading screen, brand
  // header — for its own name. This runs before the renderer builds, so the
  // loading screen shows the tile branding for effectively the whole load.
  // NYC runs none of this: the static HTML keeps the original branding
  // byte-for-byte. Gameplay HUD strings are not branding and are left
  // alone in both modes.
  if (isTaipei) {
    const brandName = 'Slop Taipei';
    document.title = brandName;
    const loaderTitle = document.querySelector('.loader-title');
    if (loaderTitle) loaderTitle.textContent = brandName;
    const brandHeading = document.querySelector('.brand h1');
    if (brandHeading) brandHeading.textContent = brandName;
    const brandShort = tileSelection.entry?.short;
    if (brandShort) {
      for (const bullet of document.querySelectorAll('#loading-overlay .mta-bullet, .brand .mta-bullet')) {
        bullet.textContent = brandShort;
      }
    }
    container.setAttribute('aria-label', '3D Interactive Slop Taipei Viewport');
  }
  const labelFor = isTaipei ? activeTile.getLocationLabel : getLocationLabel;
  // Optional tile member (see js/tile-registry.js): the label in
  // structured form, saying which street is the one being driven on.
  // Null for NYC and for tiles that do not provide it — the HUD sign
  // then renders from the string label exactly as before.
  const labelPartsFor = isTaipei && typeof activeTile.getLocationParts === 'function' ? activeTile.getLocationParts : null;
  // The map is a hand-built NYC atlas (boroughs, Central Park, NYC road
  // classes); a tile instead gets its own map drawn from the tile's
  // geodata / generation map (js/tile-map.js, issue #7). Loaded lazily
  // here so the NYC boot never evaluates it. (Declared here, consumed far
  // below — see the typeof guards at the mapSystem creation for why the
  // split exists: tests/teleports.test.cjs evaluates that region with
  // neither TileMapSystem nor activeTile in scope.)
  const TileMapSystem = isTaipei ? (await import('./tile-map.js')).TileMapSystem : null;

  if (loadingStatus) {
    loadingStatus.textContent = `Initializing Three.js r${THREE.REVISION} WebGPURenderer & TSL Shaders...`;
  }

  // Issue #218: runtime settings (settings gear) — URL params beat
  // localStorage beat the defaults, and the defaults are exactly
  // the pre-#218 behaviour (see js/settings.js).
  const settings = resolveSettings({
    search: window.location.search,
    stored: readStoredSettings(window.localStorage),
  });

  // 1. Initialize Three.js WebGPURenderer with 32-bit float reversedDepthBuffer
  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    powerPreference: 'high-performance',
    reversedDepthBuffer: true
  });
  renderer.setPixelRatio(graphicsConfig(settings.graphics, window.devicePixelRatio || 1).pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.lighting = new ClusteredLighting(256, 32, 28, 48);
  container.appendChild(renderer.domElement);

  // Start-up phase timings (logged once as "[init] ...") to keep load-time regressions traceable
  let initTimings = [];
  let initMark = performance.now();
  const markInit = (label) => {
    const now = performance.now();
    initTimings.push(`${label} ${Math.round(now - initMark)}ms`);
    initMark = now;
  };

  await renderer.init();
  markInit('renderer');

  // 2. Build Scene & Physical Atmospheric Sky / PMREM IBL / 4096x4096 Shadow Lighting
  const scene = new THREE.Scene();
  const lightingSystem = new LightingSystem(scene, renderer);
  markInit('lighting');
  // Issue #218: the graphics preset's shadow half (the pixel-ratio
  // half was applied at renderer creation; re-applying is a no-op
  // there). 'medium'/'high' keep castShadow exactly as built.
  applyGraphicsSettings(renderer, lightingSystem.sunLight, settings.graphics, window.devicePixelRatio || 1);
  // Issue #240: the far-detail fade is a shared shader uniform —
  // applying it here covers every Taipei lot material built after
  // this point, and the uniform lives past density rebuilds.
  // (No material outside Taipei references it, so NYC is untouched.)
  setFarFadeEnabled(settings.farDetail !== 'full');

  if (loadingStatus) {
    loadingStatus.textContent = isTaipei
      ? `Constructing ${activeTile.label} (ground, roads, water & parks)...`
      : 'Constructing Manhattan Grid, Landmarks & Streetscape...';
  }

  // 3. Build the selected city. NYC (default) runs the legacy builders
  // unchanged. A registry tile runs its own ground builder and stubs every
  // NYC-only system with an inert equivalent (see js/taipei-boot.js and the
  // M1 PR for the precise stub list): no boroughs, NYC landmarks, piers,
  // Central Park specifics or East River bridges exist in a tile.
  // Buildings are NOT stubbed: the tile's ground builder runs upstream's
  // buildCityBlocks on the tile's planned lots (issue #11). Pedestrians stay
  // stubbed; traffic stays stubbed too unless the ?traffic= experiment flag
  // is set (issue #210, hooked up below after the colliders exist).
  let cityGrid, boroughs, cityBlocks, streetDetails, trafficSystem, highwayTraffic;
  let landmarkColliders = [];
  let tileBoot = null;
  if (isTaipei) {
    const boot = await activeTile.loadBoot();
    tileBoot = boot;
    cityGrid = await boot.buildTaipeiGround(scene, activeTile, {
      buildCityBlocks,
      // Issue #218: the settings the boot builds with (density
      // preset + special-buildings visibility).
      settings: { density: settings.density, specials: settings.specials },
      // Real staged progress (issue #63): the boot fires this as each
      // construction stage actually completes — the loader names the
      // finished stage and fills its share of the bar. No estimates:
      // if a stage stalls, the bar and the stage name freeze on it.
      onProgress: ({ label, fraction }) => {
        if (loadingStatus) loadingStatus.textContent = `Constructing ${activeTile.label} — ${label} (${Math.round(fraction * 100)}%)`;
        setLoadingProgress(fraction * TAIPEI_BUILD_PROGRESS_SHARE);
      },
    });
    progressBase = TAIPEI_BUILD_PROGRESS_SHARE;
    markInit('tileGround');
    boroughs = { colliders: [], update: null };
    // The tile's buildings are built by the same upstream system as
    // NYC's (issue #11), so a tile gets the real streaming object; the
    // inert stub remains the fallback if a boot module builds none.
    cityBlocks = cityGrid.cityBlocks || { colliders: [], allBlocks: [], update() {}, updateLights: null };
    streetDetails = { footprints: [], signalClock: { value: 0 }, update: null };
    trafficSystem = { network: null, update() {} };
    highwayTraffic = { update() {} };
  } else {
    cityGrid = buildCityGrid(scene);
    markInit('cityGrid');
    boroughs = buildBoroughs(scene, { sidewalks: cityGrid.sidewalks });
    markInit('boroughs');
    ({ colliders: landmarkColliders } = buildLandmarks(scene));
    markInit('landmarks');
    cityBlocks = buildCityBlocks(scene);
    markInit('blocks');
    streetDetails = buildStreetDetails(scene);
    markInit('streetDetails');
  }
  const allColliders = [...landmarkColliders, ...cityBlocks.colliders, ...boroughs.colliders, ...(cityGrid.colliders || [])];

  // Issue #210/#252: Taipei traffic, built and destroyed live from the
  // settings gear (on/off, density, spawn range). The module import is
  // hoisted here so the panel's onTraffic callback can apply a change
  // the moment the user taps it; the graph itself is built lazily inside
  // taipeiTrafficEnv on first use, so importing builds nothing. The
  // obstacle lists are the tile's own (both empty): Taipei's roads are
  // building-free by construction, and building colliders are deliberately
  // NOT passed — a rotated lot's AABB overhangs its carriageway and would
  // prune honest lanes. window.__traffic is the #210 measurement handle,
  // set only while a system exists.
  let taipeiTraffic = null;
  if (isTaipei) taipeiTraffic = await import('./taipei-traffic.js');
  const destroyTraffic = () => {
    if (trafficSystem && trafficSystem.group) scene.remove(trafficSystem.group);
    trafficSystem = { network: null, update() {} };
    if (typeof window !== 'undefined') delete window.__traffic;
  };
  const applyTrafficConfig = (cfg) => {
    destroyTraffic();
    if (!cfg.enabled || !taipeiTraffic) return;
    trafficSystem = createTrafficSystem(scene, cityGrid.sidewalks, [
      ...cityGrid.footprints,
      ...streetDetails.footprints
    ], taipeiTraffic.taipeiTrafficEnv(cfg.carCount, { trafficRadius: cfg.trafficRadius }));
    window.__traffic = trafficSystem;
    markInit('traffic');
  };

  // The gear must show the EFFECTIVE initial state: the legacy
  // ?traffic= flag wins over the stored setting, so sync the
  // in-memory field (not storage — the flag must not stick after
  // it leaves the URL) before the panel first reflects it.
  const initialTraffic = isTaipei ? trafficConfig(settings) : { enabled: false, carCount: 0, trafficRadius: 0 };
  if (isTaipei) {
    const search = new URLSearchParams(window.location.search);
    if (search.has('traffic')) {
      const legacyCount = taipeiTraffic.trafficCountFromSearch(window.location.search);
      initialTraffic.enabled = legacyCount > 0;
      if (legacyCount > 0) initialTraffic.carCount = legacyCount;
    }
  }
  if (isTaipei) settings.trafficEnabled = initialTraffic.enabled;

  // Issue #218: wire the settings gear. Graphics apply in every
  // mode; density/specials go through the Taipei boot's runtime
  // API (null in NYC mode — the panel disables those rows there).
  initSettingsPanel({
    settings,
    taipeiSettings: isTaipei ? (cityGrid.taipeiSettings || null) : null,
    onGraphics: (preset) => applyGraphicsSettings(renderer, lightingSystem.sunLight, preset, window.devicePixelRatio || 1),
    onFarDetail: (preset) => setFarFadeEnabled(preset !== 'full'),
    onTraffic: (cfg) => applyTrafficConfig(cfg),
    persist: () => persistSettings(window.localStorage, settings),
  });

  if (!isTaipei) {
    // Buildings turned along non-grid streets have oriented colliders whose world bounds reach past their lots: they stay
    // inside the property line anyway, so the road network (lanes & sidewalks) doesn't need them
    trafficSystem = createTrafficSystem(scene, cityGrid.sidewalks, [
      ...cityGrid.footprints,
      ...streetDetails.footprints,
      ...allColliders.filter((c) => !c.obb)
    ]);
    markInit('traffic');
    highwayTraffic = createHighwayTraffic(scene, cityGrid.highwayLanes);
    buildRoadPaint(scene, trafficSystem.network);
    markInit('roadPaint');
  } else {
    // Initial traffic state: the effective config computed before the
    // gear was wired (resolved settings, legacy ?traffic= flag winning).
    if (initialTraffic.enabled) applyTrafficConfig(initialTraffic);
  }

  // 4. Initialize Third-Person Controllers (Person, Car, Cyclist, Helicopter) & Multi-Camera System
  // A registry tile hands the controllers its own world (tile bounds, flat
  // ground, tile spawns); NYC passes nothing and keeps the legacy defaults.
  const controllerManager = new ThirdPersonControllerManager(
    scene, allColliders, tileBoot
      ? tileBoot.controllerOptions(activeTile, { webglFallback: renderer.backend?.isWebGLBackend === true })
      : undefined
  );
  // Player state is saved per city: a tile must never restore coordinates
  // saved in another city's frame. (NYC keeps its historical key.)
  const playerStateKey = isTaipei ? `player-state:${activeTile.id}` : 'nyc-player-state';
  // Reuse teleport placement so saved players return at rest, close to their last positions.
  let restoredPlayer = false;
  try {
    const saved = JSON.parse(localStorage.getItem(playerStateKey));
    if (saved?.version === 1) {
      restoredPlayer = true;
      for (const mode of Object.keys(controllerManager.entities)) {
        const p = saved.entities?.[mode];
        if (!p || ![p.x, p.y, p.z, p.heading].every(Number.isFinite)) continue;
        controllerManager.setMode(mode);
        controllerManager.teleportActiveTo(p.x, p.z, p.heading, p.y);
      }
      controllerManager.setMode(Object.hasOwn(controllerManager.entities, saved.activeMode) ? saved.activeMode : 'car');
    }
  } catch { /* Missing or unavailable storage does not prevent playing. */ }
  if (isTaipei && !restoredPlayer) {
    // First visit to the tile: every mode starts at the tile spawn (Taipei
    // 101) instead of the controllers' built-in NYC spawn.
    for (const mode of Object.keys(controllerManager.entities)) {
      controllerManager.setMode(mode);
      controllerManager.teleportActiveTo(activeTile.spawn.x, activeTile.spawn.z, activeTile.spawn.heading, 0);
    }
    controllerManager.setMode('car');
  }

  function savePlayerState() {
    try {
      const entities = Object.fromEntries(Object.entries(controllerManager.entities).map(([mode, entity]) => [mode, {
        x: entity.position.x, y: entity.position.y, z: entity.position.z, heading: entity.heading
      }]));
      localStorage.setItem(playerStateKey, JSON.stringify({ version: 1, activeMode: controllerManager.activeMode, entities }));
    } catch { /* Storage may be disabled or full. */ }
  }

  const cameraSystem = new CameraSystem(renderer.domElement, controllerManager);
  const touchControls = new TouchControls(controllerManager);
  const soundButton = document.getElementById('btn-sound');
  // City audio is driven by the NYC traffic/street systems; in a tile it is
  // an inert stub (the sound button simply reports unavailable) until a
  // tile traffic increment exists to feed it.
  const audioSystem = isTaipei ? {
    supported: false, enabled: false, ready: false,
    setEnabled() {}, dispose() {}, honk() {}, update() {}
  } : new CityAudioSystem({ controllerManager, trafficSystem, highwayTraffic, streetDetails }, {
    onStateChange: updateSoundButton
  });
  function updateSoundButton() {
    if (!soundButton) return;
    soundButton.disabled = !audioSystem.supported;
    soundButton.setAttribute('aria-pressed', String(audioSystem.enabled));
    soundButton.setAttribute('aria-label', audioSystem.enabled ? 'Mute sound' : 'Enable sound');
    soundButton.title = audioSystem.supported ? `${audioSystem.enabled ? 'Mute' : 'Enable'} sound [N]` : 'Web Audio is unavailable';
    soundButton.querySelector('use').setAttribute('href', audioSystem.enabled ? '#i-sound' : '#i-sound-off');
  }
  soundButton?.addEventListener('click', () => audioSystem.setEnabled(!audioSystem.enabled));
  updateSoundButton();
  // pagehide also covers navigation away on mobile; preserve the context across back-forward cache restores.
  window.addEventListener('pagehide', (event) => {
    savePlayerState();
    if (!event.persisted) audioSystem.dispose();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) savePlayerState(); });
  markInit('controllers');

  // Island-wide static geometry: chunk & distance-cull the small props, shadow stand-ins for the big casters
  // (scene-culling.js)
  const cullingRoots = (isTaipei
    ? ['TaipeiGround', 'ManhattanCityBlocks']
    : ['ManhattanCityGrid', 'ManhattanCityBlocks', 'ManhattanStreetDetails', 'ManhattanLandmarks', 'Boroughs'])
    .map((name) => scene.getObjectByName(name))
    .filter(Boolean);
  setupSceneCulling(scene, cullingRoots, lightingSystem.sunLight.shadow);
  markInit('culling');

  // Small InstancedMeshes (<= 1000 instances) keep their matrices in uniform buffers that three.js
  // re-uploads on every draw of every pass (~2.5 MB/frame with the shadow cascades, stalling the GPU queue).
  // Storage attributes are only uploaded when instanceMatrix.needsUpdate is set.
  scene.traverse((object) => {
    if (object.isInstancedMesh) {
      object.instanceMatrix = new THREE.StorageInstancedBufferAttribute(object.instanceMatrix.array, 16);
    }
  });

  // 5. TSL RenderPipeline with Half-Res Screen Space Reflections (SSRNode), Bloom & Filmic Toning
  //    Fade out distant and matte surfaces so SSR spends its rays on visible glossy reflections.
  const scenePass = pass(scene, cameraSystem.camera);
  // The multisampled colour attachments (output, normal, metalRough) only need resolving, never storing: discarding
  // them spares the GPU writing 3 x 4 samples per pixel to memory every frame (transient, memoryless attachments where
  // the browser supports them). The multisampled depth stays stored: SSR reads it.
  scenePass.renderTarget.storeMultisampledColorBuffer = false;
  const ssrFade = smoothstep(360.0, 180.0, positionView.z.negate());
  const maxSSRRoughness = 0.75;
  const sceneMRT = mrt({
    output: output,
    normal: normalView,
    metalRough: vec2(roughness.lessThan(maxSSRRoughness).select(metalness.mul(ssrFade), 0), roughness)
  });
  sceneMRT.setBlendMode('normal', new THREE.BlendMode(THREE.MaterialBlending));
  sceneMRT.setBlendMode('metalRough', new THREE.BlendMode(THREE.MaterialBlending));
  scenePass.setMRT(sceneMRT);

  const scenePassColor = scenePass.getTextureNode('output');
  const scenePassDepth = scenePass.getTextureNode('depth');
  const scenePassNormal = scenePass.getTextureNode('normal');
  const scenePassMetalRough = scenePass.getTextureNode('metalRough');

  const ssrPass = ssr(scenePassColor, scenePassDepth, scenePassNormal, {
    metalnessNode: scenePassMetalRough.r,
    roughnessNode: scenePassMetalRough.g,
    camera: cameraSystem.camera
  });
  ssrPass.resolutionScale = 0.5;
  ssrPass.blurQuality = 1;
  ssrPass.maxDistance.value = 42;
  ssrPass.thickness.value = 0.85;
  // Fewer coarse steps, then refine detected hits to keep reflection edges precise.
  ssrPass.quality.value = 0.25;
  ssrPass.binaryRefine = true;
  ssrPass.intensity.value = 0.50;
  ssrPass.screenEdgeFadeBlack = true;

  // Roughness mip blur must not spread reflections back onto matte or nonreflective surfaces.
  const reflectionMask = scenePassMetalRough.r.greaterThan(0).select(smoothstep(maxSSRRoughness, 0.55, scenePassMetalRough.g), 0);
  const reflections = ssrPass.mul(reflectionMask);
  const colorGrade = createPostProcessing(renderer, scenePassColor, reflections);
  const renderPipeline = new THREE.RenderPipeline(renderer, colorGrade.outputNode);

  // 6. Wire UI Controls (Strictly using safe DOM APIs: textContent, classList, addEventListener)
  const modeButtons = document.querySelectorAll('[data-mode]');
  const cameraButtons = document.querySelectorAll('[data-camera]');
  const timeButtons = document.querySelectorAll('[data-time]');
  const teleportButtons = document.querySelectorAll('[data-teleport]');
  // The teleport popover is shared markup: in a tile, its buttons are
  // re-labelled with the tile's own teleports (extra buttons hidden), and
  // the scenic camera buttons (fixed NYC viewpoints) are hidden — follow
  // cameras only until a tile gets scenic presets of its own.
  const activeTeleports = isTaipei ? activeTile.teleports : TELEPORT_LOCATIONS;
  if (isTaipei) {
    const entries = Object.entries(activeTile.teleports);
    teleportButtons.forEach((btn, i) => {
      if (i >= entries.length) {
        btn.style.display = 'none';
        return;
      }
      const [key, loc] = entries[i];
      btn.setAttribute('data-teleport', key);
      const nameEl = btn.querySelector('.pop-name');
      const subEl = btn.querySelector('.pop-sub');
      if (nameEl) nameEl.textContent = loc.name;
      if (subEl) subEl.textContent = loc.sub;
    });
    document.querySelectorAll('[data-camera]').forEach((btn) => {
      const preset = CAMERA_PRESETS.find((p) => p.id === btn.getAttribute('data-camera'));
      if (preset && preset.category !== 'follow') btn.style.display = 'none';
    });
  }
  const hudToggleBtn = document.getElementById('btn-toggle-hud');
  const modeSwitch = document.getElementById('mode-switch');
  touchControls.onAvailabilityChange = placeModeIndicator;

  const elFps = document.getElementById('hud-fps');
  const elMode = document.getElementById('hud-active-mode');
  const elCamera = document.getElementById('hud-active-camera');
  const elSpeed = document.getElementById('hud-speed');
  const elSpeedMeter = document.getElementById('hud-speed-meter');
  const elAltitude = document.getElementById('hud-altitude');
  const elLocation = document.getElementById('hud-location');
  const elControlsHint = document.getElementById('hud-controls-hint');
  const gamepadControls = new GamepadControls(controllerManager, cameraSystem, {
    onCycleMode: (step) => {
      const modes = ['person', 'car', 'cyclist', 'helicopter'];
      selectMode(modes[(modes.indexOf(controllerManager.activeMode) + step + modes.length) % modes.length]);
    },
    onCycleCamera: cycleCamera,
    onToggleMap: () => mapSystem.toggleFullMap(!mapSystem.isFullMapOpen),
    onCloseMap: () => mapSystem.toggleFullMap(false)
  });

  // Keyboard guide for each mode: [keys, action]
  const controlHints = {
    person: [[['W', 'S'], 'Walk'], [['A', 'D'], 'Turn'], [['Shift'], 'Sprint'], [['Space'], 'Jump'], [['Drag'], 'Orbit']],
    car: [[['W', 'S'], 'Drive / Reverse'], [['A', 'D'], 'Steer'], [['Shift'], 'Boost'], [['B'], 'Horn'], [['Drag'], 'Orbit']],
    cyclist: [[['W', 'S'], 'Pedal / Brake'], [['A', 'D'], 'Lean & Turn'], [['Shift'], 'Sprint'], [['Drag'], 'Orbit']],
    helicopter: [[['W', 'S'], 'Pitch'], [['A', 'D'], 'Yaw'], [['Space', 'E'], 'Ascend'], [['Q', 'C'], 'Descend'], [['Shift'], 'Boost']]
  };
  // Boosted top speeds in mph (controllers.js caps them at 8.2, 36, 19 & 52 m/s): full scale of the speed meter.
  // The numeric readout always shows the entity's true speed; this table only sets the bar's full
  // scale, so a tile that scales its caps (Taipei speedScale 2) scales the bar's range with them.
  const meterScale = controllerManager.worldOpts?.speedScale ?? 1;
  const topSpeedMph = { person: 18 * meterScale, car: 81 * meterScale, cyclist: 43 * meterScale, helicopter: 116 * meterScale };

  function renderControlHints(mode) {
    if (!elControlsHint) return;
    const items = (controlHints[mode] || []).map(([keys, action]) => {
      const item = document.createElement('span');
      item.className = 'hint';
      for (const key of keys) {
        const kbd = document.createElement('kbd');
        kbd.textContent = key;
        item.appendChild(kbd);
      }
      const label = document.createElement('span');
      label.className = 'hint-label';
      label.textContent = action;
      item.appendChild(label);
      return item;
    });
    elControlsHint.replaceChildren(...items);
  }

  // The taxi-yellow pill under the selected mode glides from button to button
  function placeModeIndicator() {
    const active = modeSwitch ? modeSwitch.querySelector('.mode-btn.active') : null;
    if (!active) return;
    modeSwitch.style.setProperty('--ind-x', `${active.offsetLeft}px`);
    modeSwitch.style.setProperty('--ind-w', `${active.offsetWidth}px`);
  }

  function selectMode(mode) {
    controllerManager.setMode(mode);
    touchControls.setMode(controllerManager.activeMode);
    gamepadControls.reset();
    modeButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
    });
    document.body.dataset.mode = mode;
    placeModeIndicator();
    const ent = controllerManager.getActiveEntity();
    if (elMode) elMode.textContent = ent.label;
    renderControlHints(mode);

    // If currently on a static scenic camera, switch to 3rd-Person Chase so user sees their selected character/vehicle
    const currentCam = cameraSystem.getActivePreset();
    if (currentCam.category !== 'follow') {
      selectCamera('chase', false);
    }
  }

  function selectCamera(camId, snap = false) {
    if (isTaipei) {
      // Scenic presets are fixed NYC viewpoints; a tile falls back to chase.
      const preset = CAMERA_PRESETS.find((p) => p.id === camId);
      if (preset && preset.category !== 'follow') camId = 'chase';
    }
    cameraSystem.setCameraPreset(camId, snap);
    cameraButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-camera') === camId);
    });
    const preset = cameraSystem.getActivePreset();
    if (elCamera) elCamera.textContent = preset.name;
  }

  // Steps through CAMERA_PRESETS (V / Shift+V, and the arrows either side of the camera name)
  function cycleCamera(step) {
    const n = CAMERA_PRESETS.length;
    const idx = CAMERA_PRESETS.findIndex((p) => p.id === cameraSystem.activePresetId);
    selectCamera(CAMERA_PRESETS[(idx + step + n) % n].id, true);
  }

  function selectTime(timeId) {
    lightingSystem.applyPreset(timeId);
    colorGrade.applyPreset(lightingSystem.activePresetId);
    timeButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-time') === timeId);
    });
  }

  // Popovers (native [popover]: light dismiss & Esc for free) open against the control that toggles them: data-anchor
  // names the element they sit above / below, data-align the one whose right edge they line up with
  const popovers = document.querySelectorAll('.popover[popover]');
  const supportsPopover = typeof HTMLElement.prototype.togglePopover === 'function';
  function closePopovers() {
    if (!supportsPopover) return;
    popovers.forEach((pop) => {
      if (pop.matches(':popover-open')) pop.hidePopover();
    });
  }
  popovers.forEach((pop) => {
    const invoker = document.querySelector(`[popovertarget="${pop.id}"]`);
    pop.addEventListener('beforetoggle', (e) => {
      const open = e.newState === 'open';
      if (invoker) invoker.classList.toggle('is-open', open);
      if (!open) return;
      const anchor = document.getElementById(pop.dataset.anchor) || invoker;
      const align = document.getElementById(pop.dataset.align) || invoker;
      if (!anchor || !align) return;
      const r = anchor.getBoundingClientRect();
      const spaceAbove = Math.max(0, r.top - 20);
      const spaceBelow = Math.max(0, window.innerHeight - r.bottom - 20);
      let above = pop.dataset.side === 'above';
      // The camera control moves to the top on touch screens; open toward the available space.
      if ((above ? spaceAbove : spaceBelow) < 160) above = spaceAbove > spaceBelow;
      pop.style.right = `${Math.max(8, window.innerWidth - align.getBoundingClientRect().right)}px`;
      if (above) {
        pop.style.top = 'auto';
        pop.style.bottom = `${window.innerHeight - r.top + 8}px`;
        pop.style.maxHeight = `${spaceAbove}px`;
      } else {
        pop.style.bottom = 'auto';
        pop.style.top = `${r.bottom + 8}px`;
        pop.style.maxHeight = `${spaceBelow}px`;
      }
    });
  });

  modeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectMode(btn.getAttribute('data-mode'));
    });
  });

  cameraButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectCamera(btn.getAttribute('data-camera'), true);
      closePopovers();
    });
  });

  const camPrevBtn = document.getElementById('cam-prev');
  const camNextBtn = document.getElementById('cam-next');
  if (camPrevBtn) camPrevBtn.addEventListener('click', () => cycleCamera(-1));
  if (camNextBtn) camNextBtn.addEventListener('click', () => cycleCamera(1));

  timeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectTime(btn.getAttribute('data-time'));
    });
  });

  // A mouse click mustn't leave the focus on a HUD button, or Space (jump / ascend) and Enter would press it again
  document.addEventListener('click', (e) => {
    const btn = e.target instanceof Element ? e.target.closest('button') : null;
    if (btn && e.detail > 0) btn.blur();
  });

  // Where you are: the place's name over its street corner, drawn as a pair of NYC street-name signs
  const roadNames = new Set(isTaipei ? activeTile.roadNames : ROADS.map((r) => r.name));
  const placeNames = new Set(isTaipei ? activeTile.landmarks.map((l) => l.name) : NYC_LANDMARKS.map((l) => l.name));
  let locationText = '';
  function renderLocation(label, parts = null) {
    // The memo key includes the driving-on road when the tile reports
    // one, so the 正行駛 tag appears/disappears with the on-road state
    // even at spots where the street names themselves do not change.
    const memoKey = parts && parts.current ? `${label}\u0001${parts.current}` : label;
    if (!elLocation || memoKey === locationText) return;
    locationText = memoKey;
    let place = '';
    let streets = label;
    const split = label.indexOf(' · ');
    if (split >= 0) {
      place = label.slice(0, split);
      streets = label.slice(split + 3);
    } else if (placeNames.has(label) || (!label.includes(' & ') && !roadNames.has(label))) {
      place = label;
      streets = '';
    }
    const nodes = [];
    if (place) {
      const el = document.createElement('div');
      el.className = 'location-place';
      el.textContent = place;
      nodes.push(el);
    }
    if (streets) {
      const row = document.createElement('div');
      row.className = 'location-signs';
      if (streets.startsWith('near ')) {
        streets = streets.slice(5);
        const near = document.createElement('span');
        near.className = 'location-near';
        near.textContent = 'near';
        row.appendChild(near);
      }
      let signIndex = 0;
      for (const name of streets.split(' & ')) {
        const sign = document.createElement('span');
        sign.className = 'street-sign';
        // Driving-on tag: when the tile's label parts name the road the
        // player is ON and it is this first plate, mark the plate so it
        // cannot be confused with the cross street's.
        if (signIndex === 0 && parts && parts.current && name === parts.current) {
          const tag = document.createElement('span');
          tag.className = 'sign-tag';
          tag.textContent = '正行駛';
          sign.appendChild(tag);
          sign.appendChild(document.createTextNode(name));
        } else {
          sign.textContent = name;
        }
        row.appendChild(sign);
        signIndex++;
      }
      nodes.push(row);
    }
    elLocation.replaceChildren(...nodes);
  }

  function teleportTo(x, z, heading = Math.PI) {
    const destination = controllerManager.teleportActiveTo(x, z, heading);
    touchControls.reset();
    gamepadControls.reset();
    cameraSystem.resetForTeleport();
    selectCamera('chase', true);
    mapSystem.waypoint = {
      x: destination.x,
      z: destination.z,
      // tests/teleports.test.cjs evaluates this region standalone with only
      // the NYC names in scope; the typeof guards keep that harness on the
      // NYC bindings while real tile boots use the tile values declared in
      // initApp above. (An undeclared name is 'undefined' to typeof, never
      // a ReferenceError.)
      name: (typeof labelFor !== 'undefined' ? labelFor : getLocationLabel)(destination.x, destination.z)
    };
    return destination;
  }

  const mapDeps = {
    controllerManager,
    cameraSystem,
    trafficSystem,
    allBlocks: cityBlocks.allBlocks,
    onToggle: (open) => {
      controllerManager.resetInput();
      touchControls.setEnabled(!open);
      gamepadControls.setEnabled(!open);
      const mapHint = document.getElementById('fullmap-hover-info');
      if (open && touchControls.available && mapHint) {
        mapHint.textContent = 'Tap to teleport · Drag to pan · Use + / − to zoom';
      }
    },
    onTeleport: teleportTo
  };
  const mapSystem = (typeof TileMapSystem !== 'undefined' && TileMapSystem)
    ? new TileMapSystem({ ...mapDeps, tile: typeof activeTile !== 'undefined' ? activeTile : null })
    : new NYCMapSystem(mapDeps);

  teleportButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-teleport');
      const loc = (typeof activeTeleports !== 'undefined' ? activeTeleports : TELEPORT_LOCATIONS)[key];
      if (loc) {
        teleportTo(loc.x, loc.z, loc.heading);
      }
      closePopovers();
    });
  });

  const openMapBtn = document.getElementById('btn-open-map');
  if (openMapBtn) openMapBtn.addEventListener('click', () => mapSystem.toggleFullMap(true));

  if (hudToggleBtn) {
    hudToggleBtn.addEventListener('click', () => {
      document.body.classList.toggle('hud-minimized');
      const isMin = document.body.classList.contains('hud-minimized');
      hudToggleBtn.setAttribute('aria-pressed', String(isMin));
      hudToggleBtn.setAttribute('aria-label', isMin ? 'Show HUD' : 'Hide HUD');
      hudToggleBtn.title = isMin ? 'Show the HUD [H]' : 'Clean view: hide the HUD [H]';
      if (isMin) closePopovers();
    });
  }

  // Global keyboard shortcuts for modes (1-4), cameras (V / 5-0), and HUD (H)
  window.addEventListener('keydown', (e) => {
    if (isTypingInField(e)) return;
    switch (e.code) {
      case 'Digit1':
        selectMode('person');
        break;
      case 'Digit2':
        selectMode('car');
        break;
      case 'Digit3':
        selectMode('cyclist');
        break;
      case 'Digit4':
        selectMode('helicopter');
        break;
      case 'Digit5':
        selectCamera('chase', true);
        break;
      case 'Digit6':
        selectCamera('action', true);
        break;
      case 'Digit7':
        selectCamera('pov', true);
        break;
      case 'Digit8':
        selectCamera('fifthAve', true);
        break;
      case 'Digit9':
        selectCamera('timesSquare', true);
        break;
      case 'Digit0':
        selectCamera('chryslerGCT', true);
        break;
      case 'KeyV':
        cycleCamera(e.shiftKey ? -1 : 1);
        break;
      case 'KeyH':
        if (hudToggleBtn) hudToggleBtn.click();
        break;
      case 'KeyN':
        if (!e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) audioSystem.setEnabled(!audioSystem.enabled);
        break;
      case 'KeyB':
        if (!e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey && !mapSystem.isFullMapOpen) audioSystem.honk(controllerManager.getActiveEntity());
        break;
    }
  });

  window.addEventListener('resize', () => {
    cameraSystem.onResize(window.innerWidth, window.innerHeight);
    renderer.setSize(window.innerWidth, window.innerHeight);
    placeModeIndicator();
    if (mapSystem.isFullMapOpen) {
      mapSystem.resizeFullCanvas();
      mapSystem.renderFullMap();
    }
  });

  // Initialize the UI and chase camera around the restored player, or the default taxi on a first visit.
  selectMode(controllerManager.activeMode);
  selectCamera('chase', true);
  selectTime('golden');
  // the web fonts change the buttons' widths once they arrive
  if (document.fonts) document.fonts.ready.then(placeModeIndicator);
  markInit('ui');

  // The loading screen stays up while the shaders compile (precompileShaders() & the warm-up frame, see the loop) and
  // until the first frame is on screen
  if (loadingStatus) {
    loadingStatus.textContent = 'Compiling Shaders & Render Pipelines...';
  }

  // 6b. Shader pre-compilation behind the loading screen. compileAsync() builds the node graphs in slices and has the GPU
  //     process compile the pipelines in parallel, but after every 8 ms slice it waits for a rendered frame, which
  //     leaves the main thread idle about half the time while nothing else animates; several calls side by side keep
  //     it busy (warm cache: 2.1 s instead of 4.0 s). (Rendering straight away compiled ~500 pipelines one after
  //     another: ~25 s with a cold shader cache.)
  const COMPILE_POOL = 16;
  const nextTask = () => (globalThis.scheduler?.yield ? globalThis.scheduler.yield() : new Promise((resolve) => setTimeout(resolve, 0)));
  async function precompileShaders() {
    // An empty frame first: it sets up the post-processing chain, which configures the scene pass's render target
    // (MSAA samples, depth format), so the pipelines compiled below are the very ones the scene pass asks for
    scene.visible = false;
    renderPipeline.render();
    scene.visible = true;
    markInit('postFX');

    // Every visible object with frustum culling off (like the warm-up frame, see the loop). Plain meshes that share
    // a material share its shader, so one job compiles them in turn (the first build serves the rest); every
    // instanced mesh gets a build of its own
    const culled = [];
    const jobs = [];
    const jobByMaterial = new Map();
    scene.traverseVisible((o) => {
      if (o.frustumCulled) {
        culled.push(o);
        o.frustumCulled = false;
      }
      if (!o.isMesh && !o.isLine && !o.isPoints && !o.isSprite) return;
      // chunks of one mesh share its pipeline (the first one compiles it) and the shadow stand-ins only ever draw in
      // the shadow maps (the warm-up frame compiles those)
      if (o.userData.sharesPipelineWith || o.userData.shadowProxy) return;
      if (o.isInstancedMesh || Array.isArray(o.material)) {
        jobs.push([o]);
        return;
      }
      let job = jobByMaterial.get(o.material);
      if (!job) {
        job = [];
        jobByMaterial.set(o.material, job);
        jobs.push(job);
      }
      job.push(o);
    });

    renderer.setRenderTarget(scenePass.renderTarget);
    renderer.setMRT(sceneMRT);
    const compile = async (object) => {
      // Each compile starts in a task of its own: compileAsync() keeps one precompilation state on the renderer,
      // which must not be mid-step for two of them in the same microtask checkpoint
      await nextTask();
      try {
        await renderer.compileAsync(object, cameraSystem.camera, scene);
      } catch (e) {
        console.warn('[compile]', e); // the warm-up frame compiles it instead
      }
    };
    let next = 0;
    let done = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        for (const object of job) await compile(object);
        done++;
        if (loadingStatus) {
          loadingStatus.textContent = `Compiling Shaders & Render Pipelines... ${Math.round((done / jobs.length) * 100)}%`;
        }
        setLoadingProgress(progressBase + (done / jobs.length) * (1 - progressBase));
      }
    };
    await Promise.all(Array.from({ length: COMPILE_POOL }, worker));
    renderer.setMRT(null);
    renderer.setRenderTarget(null);
    for (const o of culled) o.frustumCulled = true;
  }

  await precompileShaders();
  markInit('compile');

  // 6. Animation Loop
  let lastTime = performance.now();
  let elapsed = 0;
  let frameCount = 0;
  let fpsTimer = 0;
  let nextPlayerSave = 0;
  let warmedUp = false; // see the first frame below

  if (elFps) elFps.textContent = '60';

  renderer.setAnimationLoop((now) => {
    const rawDt = (now - lastTime) * 0.001;
    lastTime = now;
    const dt = Math.min(Math.max(rawDt, 0.001), 0.05);
    elapsed += dt;

    // Update 3rd-person controllers, camera, signals, traffic & vehicle collisions, building LODs, and dynamic shadow focus
    gamepadControls.update(dt);
    controllerManager.update(dt, elapsed);
    cameraSystem.update(dt, elapsed);
    streetDetails.signalClock.value = elapsed;
    trafficSystem.update(
      dt,
      elapsed,
      cameraSystem.currentPos,
      controllerManager.getActiveEntity(),
      controllerManager.activeMode,
      cameraSystem.camera
    );
    highwayTraffic.update(dt, cameraSystem.camera, controllerManager.getActiveEntity(), controllerManager.activeMode);
    if (!document.hidden && now >= nextPlayerSave) {
      savePlayerState();
      nextPlayerSave = now + 5000;
    }
    if (boroughs.update) boroughs.update(elapsed); // Roosevelt Island Tramway cabins
    cityBlocks.update(cameraSystem.currentPos.x, cameraSystem.currentPos.z);
    if (cityBlocks.updateLights) cityBlocks.updateLights(cameraSystem.camera);
    if (streetDetails.update) streetDetails.update(cameraSystem.camera);
    lightingSystem.update(cameraSystem.currentPos);
    mapSystem.update();
    audioSystem.update(dt, elapsed, cameraSystem.camera, lightingSystem.activePresetId === 'midnight');
    if (warmedUp) updateSceneCulling(cameraSystem.camera.position); // the warm-up frame draws every chunk

    // Render frame via TSL RenderPipeline (SSR + Bloom)
    if (!warmedUp) {
      // First frame = pipeline warm-up behind the loading screen, for what precompileShaders() can't reach (the shadow
      // map passes): with frustum culling off, every visible material's pipelines compile now instead of stalling the
      // first time the camera turns towards it (one chunk / shadow stand-in per shared pipeline is enough)
      const culled = [];
      scene.traverse((o) => {
        if (o.frustumCulled && !o.userData.sharesPipelineWith) {
          culled.push(o);
          o.frustumCulled = false;
        }
      });
      renderPipeline.render();
      for (const o of culled) o.frustumCulled = true;
      markInit('warmup');
    }
    renderPipeline.render();
    if (!warmedUp) {
      warmedUp = true;
      markInit('firstFrame');
      // The loading screen stays up until the GPU has got through the first frame (and the pipelines its warm-up
      // compiled), i.e. until the city is actually on screen
      const device = renderer.backend.device;
      Promise.resolve(device && device.queue.onSubmittedWorkDone()).catch(() => {}).then(() => {
        markInit('gpu');
        console.log(`[init] ${initTimings.join(', ')}`);
        initTimings = null;
        if (loadingOverlay) loadingOverlay.classList.add('hidden');
        audioSystem.ready = true;
        setLoadingProgress(1);
      });
    }

    // Telemetry uses wall time, not the clamped simulation step, so slow frames and high-refresh displays report
    // their actual frame rate (updates DOM every 250ms).
    frameCount++;
    fpsTimer += Math.max(0, rawDt);
    if (fpsTimer >= 0.25) {
      const currentFps = Math.round(frameCount / fpsTimer);
      frameCount = 0;
      fpsTimer = 0;

      const activeEnt = controllerManager.getActiveEntity();
      const mode = controllerManager.activeMode;
      const mph = Math.round(Math.abs(activeEnt.speed) * 2.237);
      const altFt = Math.max(0, Math.round(activeEnt.position.y * 3.281));

      if (elFps) {
        elFps.textContent = String(currentFps);
        elFps.className = currentFps >= 50 ? 'fps-ok' : currentFps >= 30 ? 'fps-warn' : 'fps-bad';
      }
      if (elSpeed) elSpeed.textContent = String(mph);
      if (elSpeedMeter) elSpeedMeter.style.transform = `scaleX(${Math.min(1, mph / (topSpeedMph[mode] || 80))})`;
      document.body.classList.toggle('is-boosting', controllerManager.keys.boost && mph > 0);
      if (elAltitude) elAltitude.textContent = altFt.toLocaleString('en-US');
      // The street corner of the player on the follow cameras, of the camera itself on the scenic ones
      const where = cameraSystem.getActivePreset().category === 'follow' ? activeEnt.position : cameraSystem.currentPos;
      renderLocation(labelFor(where.x, where.z), labelPartsFor ? labelPartsFor(where.x, where.z) : null);
    }
  });
}

initApp();
