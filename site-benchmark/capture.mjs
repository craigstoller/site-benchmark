#!/usr/bin/env node
// capture.mjs: reliable full-page captures of live sites, for audits and benchmarks.
//
// Drives the installed Chrome (or Edge or Chromium) headless over the DevTools protocol, with no npm
// dependencies: Node 22 or later supplies the WebSocket. Every run gets a fresh temporary profile, so
// another session's browser can never lock it. Each page and viewport gets its own browser context and
// a navigation timeout, and each site a watchdog. Each page is first shot as it arrives (the first view), then prepared so the
// capture shows what a visitor scrolling the page would see: smooth scrolling off, the page scrolled
// through so lazy images and scroll reveals fire, scroll-reveal content the page hid again forced
// visible, consent and chat overlays hidden by style (never clicked), sticky headers made static.
// Output is a set of readable slices, a contact sheet per page, optional full-page parts kept under
// Chrome's capture-height cap, and a JSON report per page and viewport recording when and how it was
// fetched and what preparation changed.
//
// Run `node capture.mjs --help` for the options.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

const HELP = `Usage: node capture.mjs --url <url> [--url <url> ...] [options]

Sites
  --url <url>            a page to capture (repeatable)
  --urls <file>          a text file of URLs, one per line; "url name" sets the folder name; # comments
  --routes <list>        comma list of paths to capture on every site as well as the URL itself, e.g.
                         "about,services" (write them without a leading slash in Git Bash, which
                         rewrites "/about" into a Windows path); sites with different structures need
                         their own lines in a --urls file instead
  --name <name>          folder name for a single URL (default: derived from host and path); a folder
                         name, here or in a --urls file, is letters, digits, ".", "_" and "-"
  --out <dir>            output folder (default: ./captures); its captures.json logs every run into it

Viewports
  --viewports <list>     comma list of presets or WxH[@dpr][:mobile] (default: desktop,phone)
                         presets: desktop 1440x900, laptop 1280x800, tablet 768x1024:mobile,
                         phone 390x844:mobile; a pixel ratio is 0.5 to 4, and a viewport wider or taller
                         than sixteen thousand device pixels is refused
  --dpr <n>              device pixel ratio where a viewport sets none (default: 1)

Outputs (per page and viewport: <viewport>-first.jpg, the screen on arrival before preparation;
<viewport>-sNN.jpg slices and <viewport>-sheet-N.jpg contact sheets of the prepared page; <viewport>.json)
  --slice <px>           slice height in CSS px (default: twice the viewport height); cut to fit under
                         Chrome's capture-height cap at high pixel ratios
  --full                 also write the full page as one image, split into parts under the cap
  --no-sheet             skip the contact sheet
  --element <selector>   also capture the first match of a CSS selector (repeatable)
  --element-scale <n>    render scale for element captures (default: 2)
  --eval <file>          run a page function after preparation; its JSON result goes in the report
  --quality <n>          JPEG quality to start from (default: 80)
  --max-bytes <n>        byte limit for slices, sheets and element captures; k means a thousand
                         bytes, so 400k is 400 thousand (default: 400k); quality steps down, then scale

Preparation
  --hide <selectors>     extra CSS selectors to hide (comma list), on top of the built-in list of
                         common consent, cookie and chat widgets; one the browser rejects is skipped and
                         named in the report
  --keep-overlays        skip the built-in list (the report names what it matched); --hide still applies
  --keep-fixed           leave fixed and sticky elements as they are
  --no-reveal            do not force hidden content visible
  --reveal-all           force every hidden content element visible, not only ones that look like
                         scroll reveals (may expose menus, carousel slides and hidden notices)
  --reduced-motion       emulate prefers-reduced-motion: reduce
  --wait <ms>            extra settle time after preparation (default: 500)

Run control
  --concurrency <n>      sites at once (default: 2)
  --timeout <s>          navigation timeout (default: 30)
  --site-timeout <s>     watchdog per site, all viewports (default: 180)
  --browser <path>       browser executable (default: CHROME_PATH, else the first installed Chrome,
                         Edge or Chromium found)

The browser runs on a fresh profile in the system temp folder (TEMP, TMP or TMPDIR), removed when the
run ends; nothing else is written outside --out.
`;

const PRESETS = {
  desktop: { width: 1440, height: 900, mobile: false },
  laptop: { width: 1280, height: 800, mobile: false },
  tablet: { width: 768, height: 1024, mobile: true },
  phone: { width: 390, height: 844, mobile: true },
};

// Chrome stops painting a capture correctly past roughly sixteen thousand device pixels in either direction: the
// image wraps back to the top and drops the bottom of the page without an error. Every capture this
// script takes stays under this many device pixels tall.
const CAPTURE_CAP = 16_000;

const HIDE_BUILTIN = [
  '#onetrust-consent-sdk', '#onetrust-banner-sdk', '#CybotCookiebotDialog', '#CybotCookiebotDialogBodyUnderlay',
  '#usercentrics-root', '#usercentrics-cmp-ui', '.osano-cm-window', '#truste-consent-track', '.truste_box_overlay',
  '#qc-cmp2-container', '.fc-consent-root', '#didomi-host', '.cc-window', '.cc-banner', '#cookie-law-info-bar',
  '#cmplz-cookiebanner-container', '.cmplz-cookiebanner', '#moove_gdpr_cookie_info_bar', '#termly-code-snippet-support',
  '.termly-styles-root', '#iubenda-cs-banner', '#cookiescript_injected', '#cookie-notice', '.cky-consent-container',
  '.cky-overlay', '#hs-eu-cookie-confirmation', '#intercom-container', '#intercom-frame', '.intercom-lightweight-app',
  '#drift-widget-container', '#drift-frame-controller', '#hubspot-messages-iframe-container', '#launcher',
  '#tidio-chat', '#crisp-chatbox', '.crisp-client', '#fc_frame', '.zopim', 'iframe[title*="chat" i]',
  'iframe[title*="consent" i]', '#credential_picker_container', '.grecaptcha-badge',
];

// Installed before any page script runs: keeps a list of the page's IntersectionObservers so preparation
// can stop them once the scroll-through has fired them.
const TRACK_OBSERVERS = `(() => {
  const IO = window.IntersectionObserver;
  if (!IO || window.__captureObservers) return;
  const all = new Set();
  Object.defineProperty(window, '__captureObservers', { value: all });
  window.IntersectionObserver = class extends IO { constructor(cb, o) { super(cb, o); all.add(this); } };
})();`;

const MOBILE_UA_TEMPLATE = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/%V Mobile Safari/537.36';

function fail(msg) { console.error(`capture: ${msg}`); process.exit(2); }

function parseCli() {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: false,
      options: {
        url: { type: 'string', multiple: true }, urls: { type: 'string' }, routes: { type: 'string' },
        name: { type: 'string' }, out: { type: 'string', default: 'captures' },
        viewports: { type: 'string', default: 'desktop,phone' }, dpr: { type: 'string', default: '1' },
        slice: { type: 'string', default: '0' }, full: { type: 'boolean', default: false },
        'no-sheet': { type: 'boolean', default: false }, element: { type: 'string', multiple: true },
        'element-scale': { type: 'string', default: '2' }, eval: { type: 'string' },
        quality: { type: 'string', default: '80' }, 'max-bytes': { type: 'string', default: '400k' },
        hide: { type: 'string', default: '' }, 'keep-fixed': { type: 'boolean', default: false },
        'keep-overlays': { type: 'boolean', default: false },
        'no-reveal': { type: 'boolean', default: false }, 'reveal-all': { type: 'boolean', default: false },
        'reduced-motion': { type: 'boolean', default: false },
        wait: { type: 'string', default: '500' }, concurrency: { type: 'string', default: '2' },
        timeout: { type: 'string', default: '30' }, 'site-timeout': { type: 'string', default: '180' },
        browser: { type: 'string' }, help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (err) { fail(`${err.message}\n\n${HELP}`); }
  const v = parsed.values;
  if (v.help) { process.stdout.write(HELP); process.exit(0); }
  const num = (key, min, max) => {
    const n = Number(v[key]);
    if (!Number.isFinite(n) || n < min || n > max) fail(`--${key} must be a number from ${min} to ${max}, got ${v[key]}`);
    return n;
  };
  // Decimal on purpose: a "400 kB" limit is 400 thousand bytes, not 409,600.
  const bytes = s => {
    const m = /^(\d+)(k?)$/i.exec(String(s).trim());
    if (!m) fail(`--max-bytes must be a whole number of bytes, optionally with k for thousands, got ${s}`);
    return Number(m[1]) * (m[2] ? 1000 : 1);
  };
  const opts = {
    out: path.resolve(v.out), dpr: num('dpr', 0.5, 4), slice: num('slice', 0, 10_000), full: v.full,
    sheet: !v['no-sheet'], elements: v.element ?? [], elementScale: num('element-scale', 1, 4),
    quality: num('quality', 10, 100), maxBytes: bytes(v['max-bytes']), keepFixed: v['keep-fixed'],
    reveal: !v['no-reveal'], revealAll: v['reveal-all'], reducedMotion: v['reduced-motion'], wait: num('wait', 0, 60_000),
    concurrency: num('concurrency', 1, 8), navTimeout: num('timeout', 5, 300) * 1000,
    siteTimeout: num('site-timeout', 30, 3600) * 1000,
    keepOverlays: v['keep-overlays'], hideExtra: splitSelectors(v.hide),
    hide: [...(v['keep-overlays'] ? [] : HIDE_BUILTIN), ...splitSelectors(v.hide)],
  };
  if (v.eval) {
    const file = path.resolve(v.eval);
    if (!fs.existsSync(file)) fail(`--eval file not found: ${file}`);
    opts.evalSource = fs.readFileSync(file, 'utf8');
    opts.evalFile = file;
  }
  opts.viewports = v.viewports.split(',').map(s => s.trim()).filter(Boolean).map(spec => parseViewport(spec, opts.dpr));

  const entries = [];
  for (const u of v.url ?? []) entries.push({ url: u, name: null });
  if (v.urls) {
    if (!fs.existsSync(v.urls)) fail(`--urls file not found: ${v.urls}`);
    for (const line of fs.readFileSync(v.urls, 'utf8').split(/\r?\n/)) {
      // A comment starts at a # that begins the line or follows a space, so a #fragment in a URL survives.
      const t = line.replace(/(^|\s)#.*$/, '').trim();
      if (!t) continue;
      const [u, n] = t.split(/\s+/);
      entries.push({ url: u, name: n ?? null });
    }
  }
  if (!entries.length) fail(`give at least one --url or --urls file\n\n${HELP}`);
  if (v.name && entries.length !== 1) fail('--name works with a single URL; use "url name" lines in a --urls file');
  if (v.name) entries[0].name = v.name;
  // A folder name is one plain name, so a capture can only land inside --out.
  for (const e of entries) {
    if (e.name !== null && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(e.name)) fail(`folder name "${e.name}" for ${e.url}: use letters, digits, ".", "_" and "-", starting with a letter or digit, so the capture lands inside --out`);
  }

  const routes = v.routes ? v.routes.split(',').map(s => s.trim()).filter(Boolean) : [];
  for (const r of routes) {
    if (/^[A-Za-z]:[\\/]/.test(r) || r.includes('\\')) fail(`route "${r}" looks like a Windows path: the shell rewrote it. Write routes without the leading slash, or set MSYS_NO_PATHCONV=1`);
  }
  const sites = [];
  for (const e of entries) {
    let base;
    try { base = new URL(/^[a-z]+:\/\//i.test(e.url) ? e.url : `https://${e.url}`); } catch { fail(`not a URL: ${e.url}`); }
    // The URL itself is always captured; routes add pages beside it, never replace it.
    sites.push({ url: base.href, name: e.name ?? slugFor(base) });
    for (const r of routes) {
      const u = new URL(r.replace(/^\/?/, '/'), base);
      if (u.href === base.href) continue;
      sites.push({ url: u.href, name: e.name ? `${e.name}-${slugPath(u.pathname)}` : slugFor(u) });
    }
  }
  const seen = new Map();
  for (const s of sites) {
    const n = seen.get(s.name) ?? 0;
    seen.set(s.name, n + 1);
    if (n) s.name = `${s.name}-${n + 1}`;
  }
  opts.sites = sites;
  opts.browser = v.browser ?? process.env.CHROME_PATH ?? findBrowser();
  if (!opts.browser || !fs.existsSync(opts.browser)) fail('no Chrome, Edge or Chromium found; pass --browser <path> or set CHROME_PATH');
  return opts;
}

// Splits a comma list of selectors at its top-level commas only, so a selector such as :is(.a, .b) stays whole.
function splitSelectors(list) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of list) {
    if (ch === '(' || ch === '[') depth++;
    else if ((ch === ')' || ch === ']') && depth > 0) depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim()).filter(Boolean);
}

function parseViewport(spec, defaultDpr) {
  let vp;
  if (PRESETS[spec]) vp = { label: spec, ...PRESETS[spec], dpr: defaultDpr };
  else {
    const m = /^(\d{3,4})x(\d{3,4})(?:@(\d+(?:\.\d+)?))?(:mobile)?$/.exec(spec);
    if (!m) fail(`viewport "${spec}" is not a preset (${Object.keys(PRESETS).join(', ')}) or WxH[@dpr][:mobile]`);
    vp = { label: spec.replace(/[@:.]/g, '-'), width: +m[1], height: +m[2], dpr: m[3] ? +m[3] : defaultDpr, mobile: Boolean(m[4]) };
  }
  if (!(vp.dpr >= 0.5 && vp.dpr <= 4)) fail(`viewport "${spec}": the pixel ratio must be from 0.5 to 4, got ${vp.dpr}`);
  if (Math.max(vp.width, vp.height) * vp.dpr > CAPTURE_CAP) fail(`viewport "${spec}" is ${vp.width * vp.dpr}x${vp.height * vp.dpr} device pixels, past Chrome's capture cap of ${CAPTURE_CAP}, which would wrap its captures`);
  return vp;
}

function slugPath(p) { return p.replace(/^\/+|\/+$/g, '').replace(/[^A-Za-z0-9]+/g, '-').toLowerCase() || 'home'; }
function slugFor(u) {
  const host = u.hostname.replace(/^www\./, '').replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
  const p = slugPath(u.pathname);
  return p === 'home' ? host : `${host}-${p}`;
}

function findBrowser() {
  const env = process.env;
  const candidates = [];
  if (process.platform === 'win32') {
    for (const root of [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean)) {
      candidates.push(path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    }
    for (const root of [env['PROGRAMFILES(X86)'], env.PROGRAMFILES].filter(Boolean)) {
      candidates.push(path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    }
    if (env.LOCALAPPDATA) candidates.push(path.join(env.LOCALAPPDATA, 'Chromium', 'Application', 'chrome.exe'));
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  } else {
    for (const bin of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']) {
      const r = spawnSync('which', [bin], { encoding: 'utf8' });
      if (r.status === 0 && r.stdout.trim()) candidates.push(r.stdout.trim());
    }
  }
  return candidates.find(c => fs.existsSync(c));
}

// ---------- DevTools protocol over a WebSocket ----------

class Cdp {
  constructor(ws) {
    this.ws = ws; this.nextId = 1; this.pending = new Map(); this.listeners = new Set();
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'));
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, method } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${method}: ${msg.error.message}`)); else resolve(msg.result);
      } else if (msg.method) {
        // A page closed under a command (its context disposed by the site watchdog) never answers it: fail it now.
        if (msg.method === 'Target.detachedFromTarget') {
          for (const [id, p] of this.pending) if (p.sessionId === msg.params.sessionId) { this.pending.delete(id); p.reject(new Error(`${p.method}: page closed`)); }
        }
        for (const l of this.listeners) l(msg);
      }
    });
    ws.addEventListener('close', () => {
      for (const { reject, method } of this.pending.values()) reject(new Error(`${method}: browser connection closed`));
      this.pending.clear();
    });
  }
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method, sessionId });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  waitFor(sessionId, method, timeoutMs, predicate = () => true) {
    return new Promise(resolve => {
      const off = this.on(msg => {
        if (msg.sessionId === sessionId && msg.method === method && predicate(msg.params)) { off(); clearTimeout(t); resolve(msg.params); }
        else if (msg.method === 'Target.detachedFromTarget' && msg.params.sessionId === sessionId) { off(); clearTimeout(t); resolve(null); }
      });
      const t = setTimeout(() => { off(); resolve(null); }, timeoutMs);
    });
  }
}

async function launchBrowser(executable) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-profile-'));
  const args = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--hide-scrollbars', '--mute-audio', '--disable-extensions',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    'about:blank'];
  // The browser's own temporary files go inside the profile folder, so they are removed with it.
  const tmp = path.join(profile, 'tmp');
  fs.mkdirSync(tmp);
  const proc = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, TEMP: tmp, TMP: tmp, TMPDIR: tmp } });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    const t = setTimeout(() => reject(new Error('the browser did not open its DevTools port within 30 s')), 30_000);
    proc.stderr.on('data', d => {
      buf += d.toString();
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
      if (m) { clearTimeout(t); resolve(m[1]); }
    });
    proc.on('exit', code => { clearTimeout(t); reject(new Error(`the browser exited (code ${code}) before opening its DevTools port`)); });
  });
  proc.stderr.resume();
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', () => reject(new Error('could not connect to the browser')), { once: true }); });
  const cdp = new Cdp(ws);
  const version = await cdp.send('Browser.getVersion');
  const close = async () => {
    try { await Promise.race([cdp.send('Browser.close'), sleep(3000)]); } catch { /* already gone */ }
    try { ws.close(); } catch { /* ignore */ }
    if (proc.exitCode === null) proc.kill();
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp folder; leave it */ }
  };
  return { cdp, version, close };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- page-side functions (serialized into the page) ----------

// Prepares the page and reports what it changed. Runs in the page.
async function preparePage(cfg) {
  const report = { hiddenOverlays: 0, hiddenFixed: [], fixedToAbsolute: 0, fixedLayersKept: 0, stickyToStatic: 0, revealed: 0,
    stillInvisible: 0, imagesPending: 0, scrollUnlocked: false, steps: 0 };
  const pause = ms => new Promise(r => setTimeout(r, ms));
  // Changes go through data attributes and these rules, not inline styles, which a framework re-render
  // can reset. A hidden overlay gets display:none: a child that sets its own visibility would show
  // through visibility:hidden on its parent. The rules live in a constructed stylesheet, which a page's
  // style-src policy does not block as it blocks a <style> element, and each hide selector is its own
  // rule, so one the browser rejects is skipped and named instead of voiding the others.
  const sheet = new CSSStyleSheet();
  for (const rule of ['*,*::before,*::after,html,body{scroll-behavior:auto!important}', '[data-capture="hide"]{display:none!important}',
    '[data-capture="static"]{position:static!important}', '[data-capture="absolute"]{position:absolute!important}',
    '[data-capture-reveal]{opacity:1!important;visibility:visible!important;transition:none!important}',
    '[data-capture-reveal="t"]{transform:none!important}']) sheet.insertRule(rule, sheet.cssRules.length);
  const applied = [];
  report.hideInvalid = [];
  for (const sel of cfg.hide) {
    try { sheet.insertRule(`${sel}{display:none!important}`, sheet.cssRules.length); applied.push(sel); } catch { report.hideInvalid.push(sel); }
  }
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  // An overlay counts as hidden only once it computes to display:none.
  const matched = applied.map(sel => {
    try { return [sel, [...document.querySelectorAll(sel)].filter(el => getComputedStyle(el).display === 'none').length]; } catch { return [sel, 0]; }
  }).filter(([, n]) => n > 0);
  report.hiddenOverlays = matched.reduce((n, [, c]) => n + c, 0);
  report.hiddenOverlaySelectors = matched.map(([sel, n]) => `${sel} x${n}`);

  for (const el of [document.documentElement, document.body]) {
    if (el && getComputedStyle(el).overflowY === 'hidden') { el.style.setProperty('overflow-y', 'visible', 'important'); report.scrollUnlocked = true; }
  }
  for (const img of document.querySelectorAll('img[loading="lazy"],iframe[loading="lazy"]')) img.loading = 'eager';

  const docHeight = () => Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
  // Content leaves: text and media outside navigation, dialogs, menus and hidden overlays.
  const contentSel = 'h1,h2,h3,h4,h5,h6,p,li,img,picture,video,figure,blockquote,a,button,svg,canvas,td,dd,dt,label,span';
  const skip = 'nav,dialog,[role="dialog"],[role="menu"],[role="listbox"],[role="tooltip"],[aria-hidden="true"],[aria-modal="true"],[data-capture="hide"]';
  const leaves = () => [...document.querySelectorAll(contentSel)].filter(el => {
    if (el.closest(skip)) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.right <= 0 || r.left >= innerWidth) return false;
    return /^(img|svg|canvas|video|picture)$/i.test(el.tagName) || el.textContent.trim().length > 0;
  });
  // How visible an element is: 0 when hidden, else the product of its own and its ancestors' opacity.
  const effOpacity = el => {
    if (getComputedStyle(el).visibility === 'hidden') return 0;
    let o = 1;
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) o *= parseFloat(getComputedStyle(a).opacity);
    return o;
  };

  // Scroll through, noting how visible each piece of content was while in view: that is what a visitor
  // scrolling the page sees, and the force pass below restores it if the page faded or hid it again
  // (reveal libraries that reset, and scroll-scrubbed animations that leave content half-faded).
  const seenMax = new WeakMap();
  const markSeen = () => {
    for (const el of leaves()) {
      const r = el.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= innerHeight) continue;
      const o = effOpacity(el);
      if (o > (seenMax.get(el) ?? 0)) seenMax.set(el, o);
    }
  };
  const step = Math.max(200, Math.floor(innerHeight * 0.8));
  let maxScrollY = 0;
  for (let y = 0; y < docHeight() && report.steps < cfg.maxSteps; y += step) {
    window.scrollTo({ top: y, left: 0, behavior: 'instant' });
    maxScrollY = Math.max(maxScrollY, scrollY);
    report.steps++;
    await pause(cfg.dwell);
    markSeen();
  }
  window.scrollTo({ top: docHeight(), left: 0, behavior: 'instant' });
  maxScrollY = Math.max(maxScrollY, scrollY);
  await pause(cfg.dwell * 2);
  markSeen();
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  await pause(cfg.dwell * 2);
  // Back at the top, the page's IntersectionObservers are stopped: a header that changes once scrolled
  // keeps its top-of-page state, and a reveal library that hides content again when it leaves the view
  // cannot undo the force pass below.
  for (const o of window.__captureObservers ?? []) o.disconnect();
  report.observersStopped = window.__captureObservers?.size ?? 0;

  const imgs = [...document.images].filter(i => i.currentSrc || i.src);
  await Promise.race([Promise.allSettled(imgs.map(i => i.complete ? null : i.decode())), pause(8000)]);
  report.imagesPending = imgs.filter(i => !i.complete).length;
  try { await Promise.race([document.fonts.ready, pause(5000)]); } catch { /* no font API */ }

  const describe = el => {
    const id = el.id ? `#${el.id}` : '';
    const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
    return `${el.tagName.toLowerCase()}${id}${cls}`.slice(0, 80);
  };

  // A page that scrolls an inner container instead of the document can be neither scrolled through nor
  // captured past its first viewport: name the container so the report can say so. Look when the document is no
  // taller than the screen, and when the window never moved during the scroll-through although the page reads as
  // taller, which happens when the body itself is the scroller. A fixed body is left out: a capture shows it whole.
  if ((docHeight() <= innerHeight * 1.2 || maxScrollY < innerHeight * 0.2) && document.body) {
    let inner = null;
    for (const el of [document.body, ...document.body.querySelectorAll('*')]) {
      if (el.clientHeight < innerHeight * 0.5 || el.scrollHeight < el.clientHeight + innerHeight * 0.5) continue;
      const cs = getComputedStyle(el);
      if (el === document.body && cs.position === 'fixed') continue;
      if (/^(auto|scroll|overlay)$/.test(cs.overflowY) && (!inner || el.scrollHeight > inner.scrollHeight)) inner = el;
    }
    if (inner) report.innerScroller = { element: describe(inner), height: inner.scrollHeight };
  }

  // Fixed and sticky elements: headers pinned to the top become part of the page, other overlays are
  // hidden. Runs twice, because chat prompts and pop-ups often appear on a timer.
  const tidied = new Set();
  const tidyFixed = () => {
    if (cfg.keepFixed || !document.body) return;
    for (const el of document.body.querySelectorAll('*')) {
      if (tidied.has(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.position === 'sticky') { el.setAttribute('data-capture', 'static'); tidied.add(el); report.stickyToStatic++; continue; }
      if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const z = parseInt(cs.zIndex, 10);
      const coversViewport = r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9;
      if (coversViewport) {
        // A full-screen fixed layer is a modal only if it says so: a dialog role, a see-through backdrop,
        // or a very high z-index. Otherwise it is a background (often a hero photo) and stays.
        const alpha = /rgba?\([^)]*,\s*([\d.]+)\)$/.exec(cs.backgroundColor);
        const modal = el.matches('[role="dialog"],[aria-modal="true"],dialog') || el.querySelector('[role="dialog"],[aria-modal="true"],dialog')
          || (alpha && +alpha[1] > 0 && +alpha[1] < 1) || (!Number.isNaN(z) && z >= 1000);
        if (!modal) { tidied.add(el); report.fixedLayersKept++; continue; }
      }
      const headerLike = r.top <= 8 && r.width >= innerWidth * 0.6 && r.height <= innerHeight * 0.35;
      tidied.add(el);
      if (headerLike) { el.setAttribute('data-capture', 'absolute'); report.fixedToAbsolute++; }
      else {
        el.setAttribute('data-capture', 'hide');
        // The overlay's text goes in the report, so a hidden sticky call-to-action bar is still visible there.
        const text = (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 50);
        report.hiddenFixed.push(text ? `${describe(el)} "${text}"` : describe(el));
      }
    }
  };
  tidyFixed();

  // Content now hidden or faded is restored only when it looks like a scroll reveal: it was clearly more
  // visible while in view during the scroll-through, or it is fully hidden by an element in the page flow
  // that animates or is named like a reveal. Anything positioned out of the flow (a menu, a carousel
  // slide, a pop-over), anything hidden with no sign of a reveal (a notice, a picker), and translucent
  // design that was never brighter stay as they are; --reveal-all restores those too.
  const revealLike = (a, cs) => {
    const animates = (cs.transitionDuration.split(',').some(d => parseFloat(d) > 0) && /opacity|transform|visibility|all/.test(cs.transitionProperty))
      || cs.animationName !== 'none' || (cs.transform && cs.transform !== 'none');
    const named = /reveal|fade|animat|aos|wow|in-?view|appear|motion|scroll|slide/i.test(typeof a.className === 'string' ? a.className : '')
      || [...a.attributes].some(at => /^data-(aos|scroll|animate|reveal|sal|motion)/i.test(at.name));
    return animates || named;
  };
  const forced = new Set();
  const force = list => {
    for (const el of list) {
      const now = effOpacity(el);
      const brighterInView = (seenMax.get(el) ?? 0) > now + 0.2;
      const hiders = [];
      let ok = true;
      for (let a = el; a && a !== document.body; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (parseFloat(cs.opacity) >= 1 && cs.visibility !== 'hidden') continue;
        if (!cfg.revealAll && (cs.position === 'absolute' || cs.position === 'fixed' || !(brighterInView || (now === 0 && revealLike(a, cs))))) { ok = false; break; }
        hiders.push([a, cs]);
      }
      if (!ok) continue;
      for (const [a, cs] of hiders) {
        if (forced.has(a)) continue;
        forced.add(a);
        a.setAttribute('data-capture-reveal', cs.transform && cs.transform !== 'none' ? 't' : '');
      }
    }
  };
  // Hidden or faded below half visible; the force pass also takes lighter fades it can attribute.
  const dimmed = () => leaves().filter(el => effOpacity(el) < 0.95);
  const invisible = () => leaves().filter(el => effOpacity(el) < 0.5);
  // Two passes: a scroll handler or animation can still hide something after the first one.
  if (cfg.reveal) force(dimmed());
  await pause(cfg.wait);
  tidyFixed();
  if (cfg.reveal) { force(dimmed()); await pause(150); }
  const hidden = invisible();
  report.revealed = forced.size;
  report.stillInvisible = hidden.length;
  report.stillInvisibleExamples = hidden.slice(0, 5).map(el => `${describe(el)} @${Math.round(el.getBoundingClientRect().top + scrollY)}px`);
  report.overflowX = Math.max(0, document.documentElement.scrollWidth - innerWidth);
  report.layoutWidth = innerWidth;
  report.height = docHeight();
  report.title = document.title;
  const text = (document.body ? document.body.innerText : '').trim();
  report.textLength = text.length;
  report.textSample = text.slice(0, 300);
  return report;
}

// Finds stretches of the page with no visible content (no text, media or background image), so a capture
// that is partly blank is flagged even when the rest of its slice is fine. Runs in the page.
function blankStretches({ height, minGap }) {
  const visible = el => el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  const spans = [];
  const add = el => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) spans.push([r.top + scrollY, r.bottom + scrollY]);
  };
  // Every visible run of text, wherever it sits (text placed straight inside a footer or a div counts too),
  // and every visible piece of media.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim() || !n.parentElement || !visible(n.parentElement)) continue;
    range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) spans.push([r.top + scrollY, r.bottom + scrollY]);
  }
  for (const el of document.querySelectorAll('img,picture,video,svg,canvas,iframe,input,button')) {
    if (visible(el)) add(el);
  }
  // A background picture counts as content; a gradient does not, and neither does anything taller than
  // two screens, which is a page-wide wrapper that would hide every gap inside it.
  for (const el of document.body.querySelectorAll('*')) {
    if (!/url\(/.test(getComputedStyle(el).backgroundImage) || !visible(el)) continue;
    if (el.getBoundingClientRect().height <= innerHeight * 2) add(el);
  }
  spans.sort((a, b) => a[0] - b[0]);
  const gaps = [];
  let end = 0;
  for (const [top, bottom] of spans) {
    if (top - end >= minGap) gaps.push([Math.round(end), Math.round(top)]);
    end = Math.max(end, bottom);
  }
  if (height - end >= minGap) gaps.push([Math.round(end), Math.round(height)]);
  return gaps;
}

function elementBox(selector) {
  let nodes;
  try { nodes = document.querySelectorAll(selector); } catch (e) { return { error: `bad selector: ${e.message}` }; }
  if (!nodes.length) return { matches: 0 };
  const el = nodes[0];
  const r = el.getBoundingClientRect();
  const id = el.id ? `#${el.id}` : '';
  const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
  return { matches: nodes.length, x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height,
    matched: `${el.tagName.toLowerCase()}${id}${cls}`, text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60) };
}

// Lays segment images side by side on a canvas and returns a JPEG data URL. Runs in a blank page.
async function composeSheet({ images, colWidth, gap, quality }) {
  const loaded = await Promise.all(images.map(src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; })));
  const height = Math.max(...loaded.map(i => i.height));
  const c = document.createElement('canvas');
  c.width = loaded.length * colWidth + (loaded.length - 1) * gap;
  c.height = height;
  const g = c.getContext('2d');
  g.fillStyle = '#808080';
  g.fillRect(0, 0, c.width, c.height);
  loaded.forEach((img, k) => g.drawImage(img, k * (colWidth + gap), 0));
  return c.toDataURL('image/jpeg', quality / 100);
}

// ---------- capture ----------

async function evaluate(cdp, sessionId, fn, arg) {
  const expression = `(${fn.toString()})(${JSON.stringify(arg)})`;
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (r.exceptionDetails) throw new Error(`page script failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
}

// Takes a clip, stepping JPEG quality down and then scale until it fits under maxBytes.
async function shoot(cdp, sessionId, clip, opts, { limit = true, scale = 1 } = {}) {
  const qualities = [opts.quality, 70, 60, 50, 40].filter((q, i, a) => q <= opts.quality && a.indexOf(q) === i);
  const scales = [scale, scale * 0.85, scale * 0.7, scale * 0.55, scale * 0.4];
  for (const s of scales) {
    for (const q of qualities) {
      const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: q, captureBeyondViewport: true,
        clip: { ...clip, scale: s } }, sessionId);
      const buf = Buffer.from(r.data, 'base64');
      if (!limit || !opts.maxBytes || buf.length <= opts.maxBytes) return { buf, quality: q, scale: s };
    }
  }
  const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 40, captureBeyondViewport: true, clip: { ...clip, scale: scale * 0.4 } }, sessionId);
  return { buf: Buffer.from(r.data, 'base64'), quality: 40, scale: scale * 0.4, overLimit: true };
}

async function captureViewport(browser, site, vp, opts, dir, cancel) {
  const { cdp } = browser;
  const t0 = Date.now();
  const rel = f => path.relative(opts.out, path.join(dir, f)).split(path.sep).join('/');
  const report = { url: site.url, viewport: vp, accessed: localIso(new Date()), browser: browser.version.product,
    preparation: null, warnings: [], files: [] };
  const { browserContextId } = await cdp.send('Target.createBrowserContext', { disposeOnDetach: true });
  cancel.contextId = browserContextId;
  let sessionId;
  try {
    if (cancel.aborted) throw new Error('site watchdog fired');
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
    const s = (m, p) => cdp.send(m, p, sessionId);
    await s('Page.enable'); await s('Runtime.enable'); await s('Network.enable');
    await s('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr, mobile: vp.mobile });
    await s('Emulation.setTouchEmulationEnabled', { enabled: vp.mobile, maxTouchPoints: vp.mobile ? 5 : 1 });
    if (vp.mobile) {
      const version = (/\/(\d+\.\d+\.\d+\.\d+)/.exec(browser.version.product) ?? [, '130.0.0.0'])[1];
      // The client hints (navigator.userAgentData and the Sec-CH-UA headers) say the same as the user agent,
      // or a site that reads them serves its desktop page to the phone pass. With no brands given, the
      // browser keeps its own.
      await s('Emulation.setUserAgentOverride', { userAgent: MOBILE_UA_TEMPLATE.replace('%V', version), platform: 'Android',
        userAgentMetadata: { platform: 'Android', platformVersion: '14.0.0', architecture: '', model: 'Pixel 8', mobile: true, bitness: '', wow64: false } });
    }
    await s('Emulation.setScrollbarsHidden', { hidden: true }).catch(() => {});
    if (opts.reducedMotion) await s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await s('Page.addScriptToEvaluateOnNewDocument', { source: TRACK_OBSERVERS });

    let docResponse = null;
    const offResp = cdp.on(msg => {
      if (msg.sessionId === sessionId && msg.method === 'Network.responseReceived' && msg.params.type === 'Document' && !docResponse) docResponse = msg.params.response;
    });
    const loaded = cdp.waitFor(sessionId, 'Page.loadEventFired', opts.navTimeout);
    const nav = await s('Page.navigate', { url: site.url });
    if (nav.errorText) throw new Error(`navigation failed: ${nav.errorText}`);
    if (!(await loaded)) report.warnings.push(`no load event within ${opts.navTimeout / 1000} s; captured what had rendered`);
    offResp();
    if (docResponse) {
      report.status = docResponse.status;
      const h = Object.fromEntries(Object.entries(docResponse.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
      if (docResponse.status >= 400) report.warnings.push(`HTTP ${docResponse.status}: an error response; unless the slices show the page you meant, this page is missing data`);
      if (h['cf-mitigated'] === 'challenge' || ((docResponse.status === 403 || docResponse.status === 503) && /cloudflare/i.test(h.server ?? ''))) {
        report.blocked = true;
        report.warnings.push('bot challenge: the capture shows the challenge, not the site, so this page is missing data. Do not open it in the desktop app\'s browser pane');
      }
    }
    report.finalUrl = (await evaluate(cdp, sessionId, () => location.href));
    if (report.finalUrl !== site.url) report.warnings.push(`redirected to ${report.finalUrl}`);

    // The first view: the screen a visitor gets on arrival, banners and all, before any preparation.
    const first = await evaluate(cdp, sessionId, async () => {
      try { await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 3000))]); } catch { /* no font API */ }
      await new Promise(r => setTimeout(r, 500));
      const hints = navigator.userAgentData;
      return { w: innerWidth, h: innerHeight, languages: [...(navigator.languages || [])], timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        userAgent: navigator.userAgent, clientHints: hints ? { mobile: hints.mobile, platform: hints.platform } : null };
    });
    // What a market-dependent page saw: the browser's languages and time zone (location follows this machine's network).
    report.locale = { languages: first.languages, timeZone: first.timeZone };
    // The phone pass is Chrome emulating an Android phone; the page saw this user agent and these client hints.
    report.userAgent = first.userAgent;
    report.clientHints = first.clientHints;
    {
      const f = `${vp.label}-first.jpg`;
      const shot = await shoot(cdp, sessionId, { x: 0, y: 0, width: first.w, height: first.h }, opts, { scale: vp.width / Math.max(vp.width, first.w) });
      fs.writeFileSync(path.join(dir, f), shot.buf);
      report.files.push({ file: rel(f), kind: 'first', bytes: shot.buf.length, quality: shot.quality });
    }

    const prep = await evaluate(cdp, sessionId, preparePage, { hide: opts.hide, keepFixed: opts.keepFixed, reveal: opts.reveal,
      revealAll: opts.revealAll, dwell: 250, maxSteps: 150, wait: opts.wait });
    report.preparation = prep;
    report.title = prep.title;
    if (prep.revealed) report.warnings.push(`forced ${prep.revealed} element(s) visible that the page had hidden (scroll-reveal content); compare the first slice with the first view, and if it shows something meant to stay hidden, rerun with --no-reveal`);
    if (prep.stillInvisible) report.warnings.push(`left ${prep.stillInvisible} content element(s) hidden or faded that did not look like scroll reveals (menus, slides, notices), e.g. ${prep.stillInvisibleExamples.join(', ')}; if the slices are missing real content, rerun with --reveal-all`);
    if (prep.imagesPending) report.warnings.push(`${prep.imagesPending} image(s) had not loaded when captured`);
    if (prep.hiddenFixed.length) report.warnings.push(`hid ${prep.hiddenFixed.length} fixed overlay(s): ${prep.hiddenFixed.slice(0, 5).join(', ')}; if one was page content, rerun with --keep-fixed and --hide`);
    if (prep.fixedLayersKept) report.warnings.push(`kept ${prep.fixedLayersKept} full-screen fixed layer(s) as background; if one is a pop-up, rerun with --hide <selector>`);
    // Challenges other than Cloudflare's often answer 200, so the page's own words are checked too.
    if (!report.blocked && prep.textLength < 3000
      && /just a moment|attention required|access denied|verify (that )?you are (a )?human|are you a robot|pardon our interruption|checking your browser|captcha/i.test(`${prep.title} ${prep.textSample}`)) {
      report.blocked = true;
      report.warnings.push(`looks like a bot challenge or access block ("${prep.title || prep.textSample.slice(0, 60)}"): the capture shows the block, not the site`);
    }
    if (prep.hiddenOverlaySelectors?.length) report.warnings.push(`hid overlays matching ${prep.hiddenOverlaySelectors.slice(0, 5).join(', ')}; if one was page content, rerun with --keep-overlays`);
    if (prep.hideInvalid?.length) report.warnings.push(`--hide selector(s) the browser rejected, so not applied: ${prep.hideInvalid.join(', ')}; the other selectors were applied`);
    if (prep.innerScroller) report.warnings.push(`the page scrolls inside ${prep.innerScroller.element} (${prep.innerScroller.height} px of content), not the document, so only its first viewport was captured: the rest of this page is missing data`);
    if (prep.textLength < 200) report.warnings.push(`only ${prep.textLength} characters of visible text: the page may be blocked, empty, or rendered in a canvas`);
    if (prep.overflowX > 1) report.warnings.push(`page is ${prep.overflowX} px wider than the viewport: content to the right is cut off in the captures (a horizontal-overflow bug on this layout, or a page without a mobile viewport)`);
    if (prep.steps >= 150) report.warnings.push('page kept growing during the scroll-through (infinite scroll?); captured the first part');

    // Measure before capturing, then take the page height after measuring, so the numbers and the slices
    // describe the same page even if it is still loading.
    if (opts.evalSource) {
      const r = await cdp.send('Runtime.evaluate', { expression: `(${opts.evalSource.trim().replace(/;\s*$/, '')})()`, awaitPromise: true, returnByValue: true }, sessionId);
      if (r.exceptionDetails) report.warnings.push(`--eval failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      else report.eval = r.result.value;
    }
    const heightNow = await evaluate(cdp, sessionId, () => Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0));
    const height = Math.max(vp.height, Math.ceil(heightNow));
    report.height = height;
    // A phone page with something wider than the screen lays out wider and is zoomed out to fit, as on a
    // real phone. Captures cover the whole layout width, scaled to the screen width.
    const layoutW = Math.max(vp.width, Math.round(prep.layoutWidth || vp.width));
    const fit = vp.width / layoutW;
    if (layoutW > vp.width + 1) report.warnings.push(`the page lays out ${layoutW} px wide on a ${vp.width} px screen, so the browser zooms it out to fit: something on it is wider than the screen`);
    const capH = Math.floor(CAPTURE_CAP / vp.dpr);
    const sliceH = Math.min(opts.slice || vp.height * 2, capH);
    if ((opts.slice || vp.height * 2) > capH) report.warnings.push(`slices cut to ${capH} px tall to stay under Chrome's capture cap at pixel ratio ${vp.dpr}`);
    const bands = [];
    for (let y = 0; y < height; y += sliceH) bands.push([y, Math.min(height, y + sliceH)]);
    // A blank stretch taller than 0.65 of a screen is flagged with the slices it falls in: a false flag costs a
    // look at a slice, a missed one can put a hidden panel into a whitespace measurement.
    const blanks = await evaluate(cdp, sessionId, blankStretches, { height, minGap: Math.round(vp.height * 0.65) });
    report.blankStretches = blanks;
    if (blanks.length) {
      const where = blanks.map(([a, b]) => {
        const first = Math.floor(a / sliceH) + 1, last = Math.floor(Math.max(a, b - 1) / sliceH) + 1;
        return `${a}-${b}px (slice ${first === last ? first : `${first}-${last}`})`;
      });
      report.warnings.push(`stretch(es) with no visible content at ${where.join(', ')}: look at those slices before drawing conclusions`);
    }

    for (let k = 0; k < bands.length; k++) {
      const [top, bottom] = bands[k];
      const f = `${vp.label}-s${String(k + 1).padStart(2, '0')}.jpg`;
      const shot = await shoot(cdp, sessionId, { x: 0, y: top, width: layoutW, height: bottom - top }, opts, { scale: fit });
      if (shot.overLimit) report.warnings.push(`${f} is over the byte limit even at the lowest quality and scale`);
      fs.writeFileSync(path.join(dir, f), shot.buf);
      report.files.push({ file: rel(f), kind: 'slice', top, bottom, bytes: shot.buf.length, quality: shot.quality, scale: +shot.scale.toFixed(2) });
    }

    if (opts.full) {
      const partH = Math.floor(CAPTURE_CAP / vp.dpr);
      const parts = Math.ceil(height / partH);
      for (let k = 0; k < parts; k++) {
        const top = k * partH, bottom = Math.min(height, top + partH);
        const f = parts === 1 ? `${vp.label}-full.jpg` : `${vp.label}-full-${k + 1}.jpg`;
        const shot = await shoot(cdp, sessionId, { x: 0, y: top, width: layoutW, height: bottom - top }, opts, { limit: false, scale: fit });
        fs.writeFileSync(path.join(dir, f), shot.buf);
        report.files.push({ file: rel(f), kind: 'full', top, bottom, bytes: shot.buf.length, quality: shot.quality });
      }
      if (parts > 1) report.warnings.push(`page is ${height} px tall: the full capture is split into ${parts} parts to stay under Chrome's capture-height cap`);
    }

    for (const [k, selector] of opts.elements.entries()) {
      const box = await evaluate(cdp, sessionId, elementBox, selector);
      if (box.error || !box.matches) { report.warnings.push(`--element "${selector}": ${box.error ?? 'no match'}`); continue; }
      const f = `${vp.label}-el-${k + 1}.jpg`;
      // A wide element is captured at a lower scale, so its whole width stays under the cap.
      const width = Math.max(1, box.width);
      const scale = Math.min(opts.elementScale, Math.floor((1000 * CAPTURE_CAP) / (vp.dpr * width)) / 1000);
      if (scale < opts.elementScale) report.warnings.push(`--element "${selector}" is ${Math.round(width)} px wide: captured at scale ${scale}, not ${opts.elementScale}, to stay under Chrome's capture cap`);
      const clip = { x: Math.max(0, box.x), y: Math.max(0, box.y), width, height: Math.max(1, Math.min(box.height, CAPTURE_CAP / (vp.dpr * scale))) };
      const shot = await shoot(cdp, sessionId, clip, opts, { scale });
      fs.writeFileSync(path.join(dir, f), shot.buf);
      report.files.push({ file: rel(f), kind: 'element', selector, matches: box.matches, matched: box.matched, text: box.text, bytes: shot.buf.length, scale: +shot.scale.toFixed(2) });
      if (box.matches > 1) report.warnings.push(`--element "${selector}" matched ${box.matches} elements; captured the first (${box.matched}): check it is the one you meant`);
    }

    if (opts.sheet) {
      const colWidth = vp.width >= 1000 ? 600 : vp.width;
      const scale = colWidth / layoutW;
      const segH = Math.max(vp.height, Math.floor(2200 / scale));
      const cols = vp.width >= 1000 ? 3 : 4;
      const segments = [];
      for (let y = 0; y < height; y += segH) segments.push([y, Math.min(height, y + segH)]);
      for (let sh = 0; sh * cols < segments.length; sh++) {
        const images = [];
        for (const [top, bottom] of segments.slice(sh * cols, sh * cols + cols)) {
          const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 75, captureBeyondViewport: true,
            clip: { x: 0, y: top, width: layoutW, height: bottom - top, scale: scale / vp.dpr } }, sessionId);
          images.push(`data:image/jpeg;base64,${r.data}`);
        }
        const f = `${vp.label}-sheet-${sh + 1}.jpg`;
        // Sheets keep to the same byte limit as slices: quality steps down until the sheet fits.
        let buf;
        for (const quality of [75, 65, 55, 45, 35]) {
          const dataUrl = await composeOnBlank(browser, { images, colWidth, gap: 12, quality });
          buf = Buffer.from(dataUrl.split(',')[1], 'base64');
          if (!opts.maxBytes || buf.length <= opts.maxBytes) break;
        }
        if (opts.maxBytes && buf.length > opts.maxBytes) report.warnings.push(`${f} is over the byte limit even at the lowest quality`);
        fs.writeFileSync(path.join(dir, f), buf);
        report.files.push({ file: rel(f), kind: 'sheet', bytes: buf.length });
      }
    }
  } finally {
    if (cancel.contextId === browserContextId) cancel.contextId = null;
    await cdp.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
  }
  report.seconds = +((Date.now() - t0) / 1000).toFixed(1);
  return report;
}

let blankSession = null;
async function composeOnBlank(browser, arg) {
  const { cdp } = browser;
  if (!blankSession) {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    ({ sessionId: blankSession } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  }
  return evaluate(cdp, blankSession, composeSheet, arg);
}

function localIso(d) {
  const off = -d.getTimezoneOffset();
  const pad = n => String(Math.floor(Math.abs(n))).padStart(2, '0');
  const local = new Date(d.getTime() + off * 60_000).toISOString().slice(0, 19);
  return `${local}${off >= 0 ? '+' : '-'}${pad(off / 60)}:${pad(off % 60)}`;
}

// cancel.aborted is set by the site watchdog; the viewport in progress fails as its page closes, and the rest are skipped,
// each with a report saying so, so no report left from an earlier run into the same folder survives as if current.
async function captureSite(browser, site, opts, cancel) {
  const dir = path.join(opts.out, site.name);
  fs.mkdirSync(dir, { recursive: true });
  const results = [];
  const watchdogError = `site watchdog fired after ${opts.siteTimeout / 1000} s; this page is missing data`;
  for (const vp of opts.viewports) {
    try {
      if (cancel.aborted) throw new Error(watchdogError);
      const report = await captureViewport(browser, site, vp, opts, dir, cancel);
      fs.writeFileSync(path.join(dir, `${vp.label}.json`), JSON.stringify(report, null, 2));
      results.push({ ok: true, report });
    } catch (err) {
      const report = { url: site.url, viewport: vp, accessed: localIso(new Date()), error: cancel.aborted ? watchdogError : err.message };
      fs.writeFileSync(path.join(dir, `${vp.label}.json`), JSON.stringify(report, null, 2));
      results.push({ ok: false, report });
    }
  }
  return results;
}

async function main() {
  const opts = parseCli();
  fs.mkdirSync(opts.out, { recursive: true });
  const browser = await launchBrowser(opts.browser);
  console.log(`capture: ${opts.sites.length} page(s) x ${opts.viewports.length} viewport(s) with ${browser.version.product} -> ${opts.out}`);
  const summary = [];
  let next = 0;
  const worker = async () => {
    while (next < opts.sites.length) {
      const site = opts.sites[next++];
      const cancel = { aborted: false, contextId: null };
      const run = captureSite(browser, site, opts, cancel);
      let timer;
      const watchdog = new Promise(resolve => { timer = setTimeout(() => resolve('timeout'), opts.siteTimeout); });
      let outcome = await Promise.race([run, watchdog]);
      clearTimeout(timer);
      if (outcome === 'timeout') {
        // Stop the site rather than leave it capturing beside the next one: closing its page fails whatever it awaits.
        cancel.aborted = true;
        if (cancel.contextId) await browser.cdp.send('Target.disposeBrowserContext', { browserContextId: cancel.contextId }).catch(() => {});
        outcome = await Promise.race([run, new Promise(resolve => setTimeout(() => resolve(null), 15_000))]);
        if (!outcome) {
          summary.push({ name: site.name, url: site.url, error: `site watchdog fired after ${opts.siteTimeout / 1000} s` });
          console.log(`FAIL  ${site.name}  watchdog after ${opts.siteTimeout / 1000} s`);
          continue;
        }
      }
      for (const { ok, report } of outcome) {
        const line = { name: site.name, url: site.url, viewport: report.viewport.label, ok, status: report.status ?? null,
          height: report.height ?? null, files: (report.files ?? []).length, warnings: report.warnings ?? [], error: report.error ?? null };
        summary.push(line);
        const flag = !ok ? 'FAIL' : (report.blocked ? 'BLOCK' : (line.warnings.length ? 'WARN' : 'OK'));
        console.log(`${flag.padEnd(5)} ${site.name}/${line.viewport}  ${ok ? `${line.height}px, ${line.files} file(s), ${line.warnings.length} warning(s)` : report.error}`);
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(opts.concurrency, opts.sites.length) }, worker));
  } finally {
    await browser.close();
  }
  // captures.json logs every run into this folder, so a rerun of one page with a different flag adds to the
  // record instead of replacing it. Each page's own JSON report holds the latest capture of that page.
  const logFile = path.join(opts.out, 'captures.json');
  let runs = [];
  try { runs = JSON.parse(fs.readFileSync(logFile, 'utf8')).runs ?? []; } catch { runs = []; }
  runs.push({ when: localIso(new Date()), browser: browser.version.product,
    options: { viewports: opts.viewports, slice: opts.slice || 'twice the viewport height', maxBytes: opts.maxBytes, reveal: opts.reveal,
      revealAll: opts.revealAll, keepFixed: opts.keepFixed, reducedMotion: opts.reducedMotion, keepOverlays: opts.keepOverlays, hideExtra: opts.hideExtra }, pages: summary });
  fs.writeFileSync(logFile, JSON.stringify({ runs }, null, 2));
  const failed = summary.filter(s => s.error || !s.ok).length;
  const warned = summary.filter(s => s.warnings?.length).length;
  console.log(`capture: done. ${summary.length - failed} ok, ${failed} failed, ${warned} with warnings. Read each page's JSON report before using its images.`);
  process.exit(failed ? 1 : 0);
}

main().catch(err => { console.error(`capture: ${err.message}`); process.exit(1); });
