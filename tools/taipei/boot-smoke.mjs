#!/usr/bin/env node
// tools/taipei/boot-smoke.mjs — standing browser boot smoke test (issue #59).
//
// WHY THIS EXISTS
// The node suite never executes js/taipei-boot.js's mesh builders, so
// on 2026-10-24 the live site hung at "Constructing Taipei" (PR #50's
// buildSignalMesh under-allocated its merged buffers 3x and threw a
// RangeError mid-boot; fixed in PR #58) while every node test passed.
// The ad-hoc harness that reproduced the throw (local three.js mirror
// + headless Chrome + a staging page calling the real
// buildTaipeiGround/buildCityBlocks) is productized here into ONE
// repeatable command the merge gate can run for any PR touching
// js/taipei-boot.js or the builders it calls.
//
// WHAT IT DOES
//   node tools/taipei/boot-smoke.mjs [--root <checkout>] [options]
// Serves the checkout over a local static server, loads
// tools/taipei/boot-smoke/stage.html in headless Chrome (WebGPU
// disabled, so WebGPURenderer takes the WebGL2 fallback — the same
// backend as phones without WebGPU), and watches the page run the
// real Taipei boot: tile registry -> buildTaipeiGround (all 8 staged
// builders, issue #63) -> buildCityBlocks -> first rendered frames.
//
// PASS requires ALL of:
//   - zero uncaught exceptions (CDP Runtime.exceptionThrown),
//   - zero window error / unhandledrejection events in the page,
//   - the stage page reports no caught error (window.__error unset),
//   - the build completes (window.__done) with all 8 [taipei-progress]
//     stage lines observed in order,
//   - scene invariants hold (TaipeiGround group with its ground /
//     water / parks / roads / signal layers present, > 100 meshes,
//     signal mesh has triangles),
//   - at least one frame actually renders after the build.
// Console/log errors (e.g. a 404'd favicon) are recorded in the
// report as warnings, not failures: a failed module import already
// fails the run through the stage page's own error path.
//
// THREE.JS SOURCE
// The shipped site loads three.js from jsDelivr and that does NOT
// change. This sandbox's Chrome cannot reach jsDelivr (issue #38), so
// the static server rewrites the importmap URLs in served HTML to a
// local mirror when one is found, in this order:
//   --mirror <dir>  |  $TAIPEI_THREE_MIRROR  |
//   ~/workspace/slop-taipei/streak-gate-boot/three-mirror (this VM)
// With no mirror, the CDN is probed once; if reachable the pages are
// served untouched (normal-network mode), if not, the run is
// INCONCLUSIVE rather than a false failure.
//
// CHROME
// Found via --chrome <path> | $CHROME_BIN | the Puppeteer download
// cache (~/.cache/puppeteer/chrome/*) | PATH (google-chrome,
// chromium, ...). No Chrome => INCONCLUSIVE.
//
// EXIT CODES
//   0 PASS          build completed, no exceptions, invariants held,
//                   at least one frame rendered.
//   1 FAIL          an exception or page error fired; the stage page
//                   caught a builder error; a stage stalled (no build
//                   progress for --stall seconds — the report carries
//                   a Debugger stack dump of the frozen page); a scene
//                   invariant failed; or the overall --timeout hit
//                   while the build was NOT progressing.
//   2 INCONCLUSIVE  the environment could not run the smoke: no
//                   Chrome, no three.js mirror and no CDN route, the
//                   checkout lacks the boot/stage files — or the
//                   overall timeout hit while stages were STILL
//                   completing (a slow machine, not a broken build;
//                   re-run standalone before concluding anything).
//
// A timeout is therefore never silently a pass and rarely a false
// fail: stalled = FAIL with a stack, progressing = INCONCLUSIVE.
// On this 2-CPU VM a full run takes ~1–3 minutes (the build is ~35 s
// unloaded; SwiftShader renders roughly one full-city frame a
// minute, and only the first is awaited).
//
// This tool is dev-only: it adds no runtime code and changes nothing
// the live site loads. See tools/taipei/boot-smoke/README.md.

import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { readFile, readdir, stat, mkdtemp } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, tmpdir } from 'node:os';

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(TOOL_DIR, '..', '..');
const STAGE_URL_PATH = '/__boot_smoke_stage.html';
const CDN_BUILD = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@dev/build/';
const CDN_ADDONS = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@dev/examples/jsm/';

// Canonical stage list: js/taipei-progress.js TAIPEI_BUILD_STAGES,
// pinned by tests/taipei-progress.test.mjs. If the boot's stages ever
// change, that module + its test and this list change together.
const EXPECTED_STAGES = ['ground', 'roads', 'junctions', 'medians', 'markings', 'decks', 'buildings', 'trees'];

function parseArgs(argv) {
  const args = { root: DEFAULT_ROOT, timeout: 420, stall: 120, frameWait: 180, port: 0 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--root') args.root = resolve(next());
    else if (a === '--mirror') args.mirror = resolve(next());
    else if (a === '--chrome') args.chrome = resolve(next());
    else if (a === '--timeout') args.timeout = Number(next());
    else if (a === '--stall') args.stall = Number(next());
    else if (a === '--frame-wait') args.frameWait = Number(next());
    else if (a === '--port') args.port = Number(next());
    else if (a === '--report') args.report = resolve(next());
    else if (a === '--help' || a === '-h') args.help = true;
    else { console.error(`unknown argument: ${a}`); process.exit(2); }
  }
  return args;
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage: node tools/taipei/boot-smoke.mjs [--root <checkout>] [--mirror <dir>] [--chrome <path>]');
  console.log('       [--timeout <sec>=420] [--stall <sec>=120] [--frame-wait <sec>=180] [--port <n>] [--report <file>]');
  console.log('Exit codes: 0 pass, 1 fail, 2 inconclusive. Full story: tools/taipei/boot-smoke/README.md');
  process.exit(0);
}

const args = parseArgs(process.argv);
const t0 = Date.now();
const elapsed = () => Math.round((Date.now() - t0) / 100) / 10;
const say = (msg) => console.log(`[boot-smoke ${elapsed()}s] ${msg}`);

const report = {
  tool: 'tools/taipei/boot-smoke.mjs',
  root: args.root,
  verdict: null,
  failure: null,
  stages: [],
  exceptions: [],
  pageErrors: [],
  logErrorWarnings: [],
  consoleTail: [],
};

function finish(verdict, code, failure) {
  report.verdict = verdict;
  report.failure = failure || null;
  report.elapsedSec = elapsed();
  say(`VERDICT: ${verdict.toUpperCase()}${failure ? ` — ${failure}` : ''}`);
  console.log(JSON.stringify(report, null, 1));
  if (args.report) { try { writeFileSync(args.report, JSON.stringify(report, null, 1)); } catch {} }
  process.exit(code);
}
const inconclusive = (why) => finish('inconclusive', 2, why);
const fail = (why) => finish('fail', 1, why);

// ---------- preflight ----------
async function isFile(p) { try { return (await stat(p)).isFile(); } catch { return false; } }
async function isDir(p) { try { return (await stat(p)).isDirectory(); } catch { return false; } }

if (!(await isFile(join(args.root, 'js', 'taipei-boot.js')))) {
  inconclusive(`checkout at ${args.root} has no js/taipei-boot.js — nothing to smoke`);
}
const stageFile = join(TOOL_DIR, 'boot-smoke', 'stage.html');
if (!(await isFile(stageFile))) inconclusive(`stage page missing: ${stageFile}`);

async function findMirror() {
  const candidates = [];
  if (args.mirror) candidates.push(args.mirror);
  if (process.env.TAIPEI_THREE_MIRROR) candidates.push(process.env.TAIPEI_THREE_MIRROR);
  candidates.push(join(homedir(), 'workspace', 'slop-taipei', 'streak-gate-boot', 'three-mirror'));
  for (const dir of candidates) {
    if (dir && (await isFile(join(dir, 'build', 'three.webgpu.js'))) && (await isDir(join(dir, 'examples', 'jsm')))) return dir;
  }
  return null;
}

async function cdnReachable() {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(CDN_BUILD + 'three.webgpu.js', { method: 'HEAD', signal: ctl.signal });
    clearTimeout(timer);
    return r.ok;
  } catch { return false; }
}

let mirror = await findMirror();
let mode = 'mirror';
if (!mirror) {
  if (await cdnReachable()) { mode = 'cdn'; say('no local three.js mirror found; CDN reachable — serving pages untouched'); }
  else inconclusive('no three.js mirror found and jsDelivr is unreachable from here (see issue #38). Set --mirror <dir> or $TAIPEI_THREE_MIRROR to a three.js checkout with build/ + examples/jsm/.');
}
report.mode = mode;
report.mirror = mirror;

async function findChrome() {
  const candidates = [];
  if (args.chrome) candidates.push(args.chrome);
  if (process.env.CHROME_BIN) candidates.push(process.env.CHROME_BIN);
  const cacheRoot = join(homedir(), '.cache', 'puppeteer', 'chrome');
  if (await isDir(cacheRoot)) {
    const entries = (await readdir(cacheRoot)).sort().reverse();
    for (const e of entries) {
      candidates.push(join(cacheRoot, e, 'chrome-linux64', 'chrome'));
      candidates.push(join(cacheRoot, e, 'chrome-linux', 'chrome'));
    }
  }
  for (const name of ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser']) {
    try { candidates.push(execFileSync('which', [name], { encoding: 'utf8' }).trim()); } catch {}
  }
  for (const c of candidates) if (c && (await isFile(c))) return c;
  return null;
}
const chromeBin = await findChrome();
if (!chromeBin) inconclusive('no Chrome/Chromium binary found (set --chrome <path> or $CHROME_BIN)');
report.chrome = chromeBin;
say(`root=${args.root} mode=${mode}${mirror ? ` mirror=${mirror}` : ''} chrome=${chromeBin}`);

// ---------- static server ----------
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.md': 'text/plain',
};
const stageHtmlRaw = await readFile(stageFile, 'utf8');
// The stage page carries the game's jsDelivr importmap; in mirror
// mode it gets the same rewrite as any served HTML (below).
const stageHtml = mirror
  ? stageHtmlRaw.replaceAll(CDN_BUILD, '/three/build/').replaceAll(CDN_ADDONS, '/three/examples/jsm/')
  : stageHtmlRaw;
const server = createServer(async (req, res) => {
  try {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let data, type;
    if (url === STAGE_URL_PATH) {
      data = Buffer.from(stageHtml); type = 'text/html';
    } else if (mirror && url.startsWith('/three/')) {
      const file = normalize(join(mirror, url.slice('/three/'.length)));
      if (!file.startsWith(mirror)) throw new Error('bad path');
      data = await readFile(file); type = MIME[extname(file)] || 'application/octet-stream';
    } else {
      const rel = url === '/' ? '/index.html' : url;
      const file = normalize(join(args.root, rel));
      if (!file.startsWith(args.root)) throw new Error('bad path');
      data = await readFile(file); type = MIME[extname(file)] || 'application/octet-stream';
      if (mirror && extname(file) === '.html') {
        data = Buffer.from(data.toString('utf8')
          .replaceAll(CDN_BUILD, '/three/build/')
          .replaceAll(CDN_ADDONS, '/three/examples/jsm/'));
      }
    }
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('nf: ' + req.url);
  }
});
await new Promise((res) => server.listen(args.port, '127.0.0.1', res));
const port = server.address().port;
const pageUrl = `http://127.0.0.1:${port}${STAGE_URL_PATH}`;
report.url = pageUrl;
say(`serving on 127.0.0.1:${port}`);

// ---------- headless chrome probe ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cdpPort = 19400 + Math.floor(Math.random() * 400);
const profile = await mkdtemp(join(tmpdir(), 'bootsmoke-profile-'));
const chrome = spawn(chromeBin, [
  '--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`,
  '--no-sandbox', '--no-proxy-server',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox',
  '--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,WebGPU',
  '--allow-insecure-localhost', '--window-size=1280,800', 'about:blank',
], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill('SIGKILL'); } catch {} server.close(); };
process.on('SIGINT', () => { cleanup(); process.exit(2); });

let page = null;
for (let i = 0; i < 60 && !page; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
    page = (await r.json()).find((t) => t.type === 'page');
  } catch {}
  if (!page) await sleep(500);
}
if (!page) { cleanup(); inconclusive('Chrome started but exposed no page target within 30 s'); }

let lastProgressAt = Date.now();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let cdpId = 0;
const pending = new Map();
let pausedResolve = null;
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    const text = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 800);
    report.consoleTail.push(text);
    if (report.consoleTail.length > 60) report.consoleTail.shift();
    const sm = text.match(/\[taipei-progress\] stage (\d+)\/(\d+) '([a-z]+)' complete/);
    if (sm) {
      report.stages.push({ n: Number(sm[1]), id: sm[3] });
      say(`stage ${sm[1]}/${sm[2]} '${sm[3]}' complete`);
      lastProgressAt = Date.now();
    }
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    report.exceptions.push({
      text: (d.exception?.description || d.text || '').slice(0, 2000),
      url: d.url, line: d.lineNumber,
    });
  }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    report.logErrorWarnings.push(String(m.params.entry.text).slice(0, 500));
  }
  if (m.method === 'Debugger.paused' && pausedResolve) {
    pausedResolve(m.params.callFrames.map((f) => `${f.functionName || '(anon)'} @ ${(f.url || '').split('/').pop()}:${f.location.lineNumber + 1}`));
    pausedResolve = null;
  }
};
const send = (method, params = {}) => new Promise((res) => { const i = ++cdpId; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const sendRaced = (method, params, ms) => Promise.race([send(method, params), sleep(ms).then(() => null)]);

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Debugger.enable');
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__probeErrors = [];
    window.addEventListener('error', (e) => window.__probeErrors.push('error: ' + (e.error && e.error.stack || e.message)));
    window.addEventListener('unhandledrejection', (e) => window.__probeErrors.push('unhandledrejection: ' + (e.reason && e.reason.stack || e.reason)));`,
});
say(`navigating to ${pageUrl}`);
await send('Page.navigate', { url: pageUrl });

const POLL_EXPR = `JSON.stringify({
  status: document.getElementById('loading-status')?.textContent || null,
  done: !!window.__done, stageErr: window.__error || null,
  errs: window.__probeErrors || [], frames: window.__renderedFrames || 0,
  buildMs: window.__buildMs || null, signalTris: window.__signalTris || 0 })`;
const INVARIANTS_EXPR = `(() => {
  const scene = window.__scene;
  if (!scene) return null;
  const names = new Set(); let meshes = 0;
  scene.traverse((o) => { names.add(o.name); if (o.isMesh) meshes++; });
  const ground = scene.children.find((c) => c.name === 'TaipeiGround');
  return {
    hasGround: !!ground,
    groundChildren: ground ? ground.children.length : 0,
    meshes,
    hasBlocks: names.has('TaipeiBlocks'), hasWater: names.has('TaipeiWater'),
    hasParks: names.has('TaipeiParks'), hasRoads: names.has('TaipeiRoads'),
    hasSignals: names.has('TaipeiTrafficSignals'), hasTrees: names.has('TaipeiStreetTrees'),
    signalTris: window.__signalTris || 0,
  };
})()`;

let lastStatus = null;
let frozenPolls = 0;
let doneAt = null;
let doneNoScenePolls = 0;
const deadline = Date.now() + args.timeout * 1000;

async function stackDump() {
  const p = new Promise((res) => { pausedResolve = res; setTimeout(() => res(null), 6000); });
  await send('Debugger.pause').catch(() => {});
  const stack = await p;
  await send('Debugger.resume').catch(() => {});
  return stack;
}

function checkStageOrder() {
  const ids = report.stages.map((s) => s.id);
  if (ids.length !== EXPECTED_STAGES.length) return `expected ${EXPECTED_STAGES.length} progress stages, saw ${ids.length} (${ids.join(', ') || 'none'})`;
  for (let i = 0; i < EXPECTED_STAGES.length; i++) {
    if (ids[i] !== EXPECTED_STAGES[i] || report.stages[i].n !== i + 1) {
      return `progress stage order broken at position ${i + 1}: saw '${ids[i]}', expected '${EXPECTED_STAGES[i]}' (full: ${ids.join(', ')})`;
    }
  }
  return null;
}

let verdict = null;
while (!verdict) {
  if (Date.now() > deadline) {
    const progressing = Date.now() - lastProgressAt <= args.stall * 1000;
    if (progressing) {
      verdict = { kind: 'inconclusive', why: `overall timeout ${args.timeout}s hit while the build was still progressing (last stage: ${report.stages.at(-1)?.id || 'none'}) — slow machine, re-run standalone` };
    } else {
      report.stallStack = await stackDump();
      verdict = { kind: 'fail', why: `overall timeout ${args.timeout}s hit with no build progress for over ${args.stall}s; stalled after stage '${report.stages.at(-1)?.id || 'none'}' (status: ${lastStatus})` };
    }
    break;
  }
  await sleep(1500);
  const r = await sendRaced('Runtime.evaluate', { expression: POLL_EXPR, returnByValue: true }, 2500);
  const v = r?.result?.result?.value ? JSON.parse(r.result.result.value) : null;
  if (!v) {
    frozenPolls++;
    if (frozenPolls >= 3 && Date.now() - lastProgressAt > args.stall * 1000) {
      report.stallStack = await stackDump();
      verdict = { kind: 'fail', why: `page main thread frozen and no build progress for over ${args.stall}s; stalled after stage '${report.stages.at(-1)?.id || 'none'}' (status: ${lastStatus}) — live stack in report.stallStack` };
    }
    continue;
  }
  frozenPolls = 0;
  if (v.status !== lastStatus) { lastStatus = v.status; }
  if (v.errs.length) { report.pageErrors.push(...v.errs.map((e) => String(e).slice(0, 2000))); verdict = { kind: 'fail', why: 'page error / unhandled rejection events fired during boot' }; break; }
  if (report.exceptions.length) { verdict = { kind: 'fail', why: `uncaught exception during boot: ${report.exceptions[0].text.split('\n')[0]}` }; break; }
  if (v.stageErr) { report.pageErrors.push(String(v.stageErr).slice(0, 2000)); verdict = { kind: 'fail', why: `stage page caught a boot error: ${String(v.stageErr).split('\n').slice(0, 2).join(' ')}` }; break; }
  if (v.done) {
    if (!doneAt) { doneAt = Date.now(); report.buildMs = v.buildMs; report.signalTris = v.signalTris; say(`build complete in ${v.buildMs}ms; waiting for first rendered frame`); }
    const orderProblem = checkStageOrder();
    if (orderProblem) { verdict = { kind: 'fail', why: orderProblem }; break; }
    const ir = await sendRaced('Runtime.evaluate', { expression: INVARIANTS_EXPR, returnByValue: true }, 5000);
    const inv = ir?.result?.result?.value ?? null;
    if (!inv && ++doneNoScenePolls >= 3) { verdict = { kind: 'fail', why: 'stage page reported done but window.__scene is missing — scene invariants cannot hold' }; break; }
    if (inv) {
      report.invariants = inv;
      const bad = [];
      if (!inv.hasGround) bad.push('TaipeiGround group missing from scene');
      if (inv.groundChildren < 10) bad.push(`TaipeiGround has only ${inv.groundChildren} children`);
      if (inv.meshes <= 100) bad.push(`only ${inv.meshes} meshes in scene`);
      if (!inv.hasBlocks) bad.push('TaipeiBlocks layer missing');
      if (!inv.hasWater) bad.push('TaipeiWater layer missing');
      if (!inv.hasParks) bad.push('TaipeiParks layer missing');
      if (!inv.hasRoads) bad.push('TaipeiRoads layer missing');
      if (!inv.hasSignals) bad.push('TaipeiTrafficSignals mesh missing');
      if (!inv.hasTrees) bad.push('TaipeiStreetTrees mesh missing');
      if (!(inv.signalTris > 0)) bad.push('signal mesh has zero triangles');
      if (bad.length) { verdict = { kind: 'fail', why: `scene invariants failed: ${bad.join('; ')}` }; break; }
    }
    if (v.frames >= 1) {
      report.frames = v.frames;
      verdict = { kind: 'pass', why: null };
      break;
    }
    if (Date.now() - doneAt > args.frameWait * 1000) {
      verdict = { kind: 'fail', why: `build completed but no frame rendered within ${args.frameWait}s (renderer stall)` };
      break;
    }
  }
}

cleanup();
if (verdict.kind === 'pass') finish('pass', 0, null);
else if (verdict.kind === 'inconclusive') inconclusive(verdict.why);
else fail(verdict.why);
