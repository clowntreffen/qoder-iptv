// End-to-end smoke test of the real app in headless Chromium, no TV needed.
// Uses the local FFmpeg stream from test/streams/make-test-stream.sh.
//
//   node scripts/smoke-e2e.mjs [--keep]
//
// Checks: app boots, source loads, video actually plays, short OK shows info,
// holding OK opens the channel list, BACK opens the exit dialog.
// Exits non-zero on the first failure and writes screenshots to test/browser/shots/.

import { spawn } from 'node:child_process';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { chromium } from 'playwright';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const SHOTS = ROOT + '/test/browser/shots';
const APP_PORT = 5199;
const STREAM_PORT = 8080;
const APP_URL = `http://127.0.0.1:${APP_PORT}/index.html`;
const SOURCE = {
  id: 'local-test',
  name: 'Local Test',
  m3uUrl: `http://127.0.0.1:${STREAM_PORT}/demo-local.m3u`,
  epgUrl: ''
};

mkdirSync(SHOTS, { recursive: true });

function log(msg) {
  console.log('[smoke] ' + msg);
}

function httpOk(url) {
  return fetch(url, { method: 'GET' }).then((r) => r.ok).catch(() => false);
}

async function waitFor(fn, ms, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('timeout: ' + label);
}

const procs = [];
function track(proc) {
  procs.push(proc);
  return proc;
}

function killAll() {
  for (const p of procs) {
    try { p.kill('SIGTERM'); } catch (e) {}
  }
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
}

let browser = null;
try {
  // 1. stream must exist and be reachable
  let streamUp = true;
  try {
    await waitFor(() => httpOk(`http://127.0.0.1:${STREAM_PORT}/live.m3u8`), 2000, 'stream');
  } catch {
    streamUp = false;
  }
  if (!streamUp) {
    let server = null;
    if (existsSync(ROOT + '/test/streams/output/live.m3u8')) {
      server = track(spawn('python3', [ROOT + '/scripts/stream_server.py', '--port', String(STREAM_PORT), '--bind', '127.0.0.1', '--directory', ROOT + '/test/streams/output'], { stdio: 'ignore' }));
    }
    await waitFor(() => httpOk(`http://127.0.0.1:${STREAM_PORT}/live.m3u8`), 5000, 'stream server');
    check('local stream available on :8080', true, server ? 'started fallback server' : 'already running');
  } else {
    check('local stream available on :8080', true);
  }

  // 2. production build served statically (same behaviour as the packaged app)
  log('building dist/ with vite');
  const build = spawn('npx', ['vite', 'build'], { cwd: ROOT, stdio: 'inherit' });
  await new Promise((resolve, reject) => {
    build.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('vite build failed: ' + code))));
  });
  check('production build succeeds', true);
  const appServer = track(spawn('python3', ['-m', 'http.server', String(APP_PORT), '--bind', '127.0.0.1', '--directory', ROOT + '/dist'], { stdio: 'ignore' }));
  await waitFor(() => httpOk(APP_URL), 15000, 'app server');
  check('app build served on :' + APP_PORT, true);

  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio']
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('console', (msg) => {
    if (msg.type() === 'error') log('console.error: ' + msg.text());
  });

  // pre-seed a source so boot() loads it without typing in the UI
  await page.addInitScript((source) => {
    const NS = 'iptv:';
    localStorage.setItem(NS + 'sources', JSON.stringify([source]));
    localStorage.setItem(NS + 'activeSource', source.id);
    // Headless Chromium has no native HLS; force the same path a TV uses anyway.
    localStorage.setItem(NS + 'settings', JSON.stringify({ decoder: 'hls' }));
  }, SOURCE);

  await page.goto(APP_URL, { waitUntil: 'load' });

  // 3. video plays
  await page.waitForFunction(() => {
    const v = document.getElementById('video');
    return !!v && !v.paused && v.readyState >= 2 && v.currentTime > 0;
  }, undefined, { timeout: 60000 });
  const pos1 = await page.evaluate(() => document.getElementById('video').currentTime);
  await page.waitForTimeout(1500);
  const pos2 = await page.evaluate(() => document.getElementById('video').currentTime);
  check('video is playing and advancing', pos2 > pos1, `${pos1.toFixed(1)}s -> ${pos2.toFixed(1)}s`);
  await page.screenshot({ path: SHOTS + '/playing.png' });

  // 4. short OK = info only, no channel list
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const osdVisible = await page.evaluate(() => !document.getElementById('osd').classList.contains('hidden'));
  const menuAfterShort = await page.evaluate(() => !document.getElementById('channel-menu').classList.contains('hidden'));
  check('short OK shows info', osdVisible && !menuAfterShort, `osd=${osdVisible} menu=${menuAfterShort}`);
  await page.screenshot({ path: SHOTS + '/info.png' });

  // close info by pressing BACK once (live view, not catch-up)
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 461, bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keyup', { keyCode: 461, bubbles: true }));
  });
  await page.waitForTimeout(300);
  const exitVisible = await page.evaluate(() => !document.getElementById('exit-dialog').classList.contains('hidden'));
  check('BACK opens exit dialog', exitVisible);
  await page.screenshot({ path: SHOTS + '/exit.png' });
  await page.evaluate(() => {
    const cancel = document.querySelector('#exit-dialog [data-action="cancel"]');
    if (cancel) cancel.click();
  });
  await page.waitForTimeout(200);

  // 5. holding OK = channel list (repeat keydowns)
  await page.evaluate(() => {
    for (let i = 0; i < 3; i++) {
      document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 13, bubbles: true }));
    }
  });
  await page.waitForTimeout(400);
  const menuVisible = await page.evaluate(() => !document.getElementById('channel-menu').classList.contains('hidden'));
  check('holding OK opens channel list', menuVisible);
  await page.screenshot({ path: SHOTS + '/channel-list.png' });

  // 6. BACK closes channel list (TV BACK, not Esc)
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 461, bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keyup', { keyCode: 461, bubbles: true }));
  });
  await page.waitForTimeout(400);
  const menuClosed = await page.evaluate(() => document.getElementById('channel-menu').classList.contains('hidden'));
  check('BACK closes channel list', menuClosed);
} catch (err) {
  check('run completed', false, err.message);
} finally {
  if (browser) await browser.close().catch(() => {});
  killAll();
}

const failed = results.filter((r) => !r.ok);
log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  process.exitCode = 1;
}
