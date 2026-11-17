// Smoke test: captures the local trap page and checks that every preparation step did its job.
// Needs Node 22+ and an installed Chrome, Edge or Chromium. Run: node tests/smoke.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTrapPage } from './trap-page.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const skill = path.join(here, '..', 'site-benchmark');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-smoke-'));
const server = await startTrapPage();
const base = `http://127.0.0.1:${server.address().port}`;

let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failures++; };

// Async, not spawnSync: the trap page is served from this process, so its event loop must keep running.
const capture = args => new Promise(resolve => {
  const child = spawn(process.execPath, [path.join(skill, 'capture.mjs'), ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', d => { stderr += d; });
  const timer = setTimeout(() => child.kill(), 240_000);
  child.on('exit', status => { clearTimeout(timer); resolve({ status, stderr }); });
});
const exitedCleanly = (run, what) => check(run.status === 0, `${what} exits 0 (got ${run.status}${run.stderr ? `: ${run.stderr.trim().split('\n').pop()}` : ''})`);
// A JPEG's pixel size, read from its frame header.
const jpegSize = file => {
  const b = fs.readFileSync(file);
  for (let i = 2; i + 9 < b.length;) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
};

try {
  exitedCleanly(await capture(['--url', `${base}/`, '--url', `${base}/blocked`, '--out', out, '--full', '--eval', path.join(skill, 'profile.js')]), 'capture');

  const read = f => JSON.parse(fs.readFileSync(path.join(out, f), 'utf8'));
  for (const vp of ['desktop', 'phone']) {
    const r = read(`127-0-0-1/${vp}.json`);
    const p = r.preparation ?? {};
    check(r.status === 200, `${vp}: page answered 200`);
    check(r.files.some(f => f.kind === 'first'), `${vp}: first view captured before preparation`);
    check(p.revealed > 0, `${vp}: scroll-reveal content forced visible (${p.revealed} forced)`);
    // Exactly three: the notice's paragraph, the dropdown's link and the translucent line.
    check(p.stillInvisible === 3 && ['update-notice', 'watermark'].every(n => (p.stillInvisibleExamples ?? []).some(d => d.includes(n))),
      `${vp}: the hidden notice, the dropdown and the translucent line left as they were (${p.stillInvisible}: ${(p.stillInvisibleExamples ?? []).join(', ')})`);
    check(p.observersStopped >= 2, `${vp}: the page's IntersectionObservers were stopped`);
    check(p.hiddenOverlays >= 1, `${vp}: consent banner hidden by the built-in list`);
    check(p.hiddenFixed.some(d => d.includes('chat-bubble')), `${vp}: fixed chat bubble hidden`);
    check(p.hiddenFixed.some(d => d.includes('backdrop')), `${vp}: dimmed modal hidden`);
    check(p.fixedLayersKept >= 1 && !p.hiddenFixed.some(d => d.includes('fixed-bg')), `${vp}: full-screen fixed background kept`);
    check(p.stickyToStatic >= 1, `${vp}: sticky header made static`);
    check(p.scrollUnlocked, `${vp}: scroll lock removed`);
    check(p.imagesPending === 0, `${vp}: every lazy image loaded`);
    const blanks = r.blankStretches ?? [];
    check(blanks.length === 1 && blanks[0][1] - blanks[0][0] >= 1000 && r.warnings.some(w => w.includes('no visible content')),
      `${vp}: the hidden panel's blank stretch flagged, and nothing else (${JSON.stringify(blanks)})`);
    const slices = r.files.filter(f => f.kind === 'slice');
    check(slices.length === Math.ceil(r.height / (r.viewport.height * 2)), `${vp}: ${slices.length} slices cover the ${r.height}px page`);
    check(slices.every(f => f.bytes <= 400_000), `${vp}: every slice under 400 thousand bytes`);
    check(r.files.filter(f => f.kind === 'full').length >= 2, `${vp}: full capture split under the height cap`);
    check(r.files.some(f => f.kind === 'sheet'), `${vp}: contact sheet written`);
    for (const f of r.files) check(fs.existsSync(path.join(out, f.file)), `${vp}: ${f.file} exists`);
    const cta = r.eval?.ctas?.first;
    check(cta?.text === 'Book a consultation' && cta.screens < 1, `${vp}: profile found the hero's call to action inside a section-level header (${cta?.top}px)`);
    check(r.eval?.sections?.gapsMeasured > 10, `${vp}: profile measured section gaps across the page`);
    check(r.eval?.sections?.gapsMeasured > 0 && Math.abs(r.eval.pageHeight - r.height) <= 2, `${vp}: profile and captures describe the same page height`);
  }
  check(read('127-0-0-1/phone.json').warnings.some(w => w.includes('lays out')), 'phone: overflowing image reported');
  check(read('127-0-0-1-blocked/desktop.json').blocked === true, 'bot challenge flagged as blocked');

  const home = read('127-0-0-1/desktop.json');
  check(Array.isArray(home.locale?.languages) && typeof home.locale?.timeZone === 'string', 'locale recorded (browser languages and time zone)');
  check((home.preparation?.hiddenOverlaySelectors ?? []).some(s => s.startsWith('#onetrust-banner-sdk')), 'the built-in overlay it hid is named in the report');
  check(/Android/.test(read('127-0-0-1/phone.json').userAgent ?? '') && !/Android/.test(home.userAgent ?? 'Android'), 'the user agent each pass presented is recorded (Android on the phone pass only)');

  // Routes add pages beside the URL, never replace it; a challenge served with status 200 is still caught, and a route
  // the site does not have is captured with a warning that it is missing data.
  const routesOut = path.join(out, 'routes');
  exitedCleanly(await capture(['--url', `${base}/`, '--routes', 'challenge200,missing', '--viewports', 'desktop', '--no-sheet', '--out', routesOut]), 'routes capture');
  check(fs.existsSync(path.join(routesOut, '127-0-0-1', 'desktop.json')), 'routes: the URL itself was captured');
  const c200 = path.join(routesOut, '127-0-0-1-challenge200', 'desktop.json');
  check(fs.existsSync(c200) && JSON.parse(fs.readFileSync(c200, 'utf8')).blocked === true, 'routes: the route was captured, and its status-200 challenge flagged as blocked');
  const r404 = path.join(routesOut, '127-0-0-1-missing', 'desktop.json');
  const missing = fs.existsSync(r404) ? JSON.parse(fs.readFileSync(r404, 'utf8')) : {};
  check(missing.status === 404 && (missing.warnings ?? []).some(w => w.includes('missing data')), 'routes: a route the site lacks is flagged as missing data');

  // A page that never finishes loading: the watchdog stops the site instead of leaving it running, and says so per viewport.
  const hangOut = path.join(out, 'hang');
  const started = Date.now();
  const hangRun = await capture(['--url', `${base}/hang`, '--no-sheet', '--site-timeout', '30', '--timeout', '120', '--out', hangOut]);
  const took = (Date.now() - started) / 1000;
  check(hangRun.status === 1 && took < 75, `a site past its watchdog is stopped, not left running (exit ${hangRun.status} after ${took.toFixed(0)} s)`);
  check(['desktop', 'phone'].every(vp => {
    const f = path.join(hangOut, '127-0-0-1-hang', `${vp}.json`);
    return fs.existsSync(f) && /watchdog/.test(JSON.parse(fs.readFileSync(f, 'utf8')).error ?? '');
  }), 'the stopped site has a report per viewport naming the watchdog');

  // A probe of the prepared page: what a capture of it would show. It reruns a page into the routes folder,
  // so the folder's run log must now hold both runs.
  const probeOut = routesOut;
  exitedCleanly(await capture(['--url', `${base}/`, '--viewports', 'desktop', '--no-sheet', '--out', probeOut, '--eval', path.join(here, 'probe.js')]), 'probe capture');
  const runs = JSON.parse(fs.readFileSync(path.join(probeOut, 'captures.json'), 'utf8')).runs ?? [];
  check(runs.length === 2 && runs[0].pages.length === 3 && runs[1].pages.length === 1, `a rerun into the same folder adds to captures.json (${runs.length} run(s))`);
  const probe = JSON.parse(fs.readFileSync(path.join(probeOut, '127-0-0-1', 'desktop.json'), 'utf8')).eval ?? {};
  check(probe.noticeHidden === true, 'probe: a hidden notice was not forced into view');
  check(probe.menuHidden === true, 'probe: a fading dropdown was not forced into view');
  check(probe.heroCtaShown === true, 'probe: the hero call to action is visible');
  check(probe.lastSectionShown === true, 'probe: the last section, hidden again by its reveal library, is visible');
  check(probe.scrubShown === true, 'probe: a line left half-faded by a scroll-scrubbed animation is fully visible');
  check(probe.watermarkKept === true, 'probe: a deliberately translucent line keeps its opacity');
  check(probe.headerAtTop === true, 'probe: the header shows its top-of-page state, not its scrolled state');

  // Preparation that neither a style-src policy nor one invalid --hide selector can switch off, the phone pass's client
  // hints, and a page that scrolls an inner container instead of the document.
  const prepOut = path.join(out, 'prep');
  exitedCleanly(await capture(['--url', `${base}/overlays`, '--url', `${base}/csp`, '--url', `${base}/inner`,
    '--url', `${base}/bodyscroll`, '--url', `${base}/bodyfixed`, '--hide', 'div:bogus-pseudo, div:is(.promo, .none)',
    '--no-sheet', '--out', prepOut, '--eval', path.join(here, 'probe.js')]), 'preparation capture');
  for (const vp of ['desktop', 'phone']) {
    for (const page of ['overlays', 'csp']) {
      const r = read(`prep/127-0-0-1-${page}/${vp}.json`);
      const e = r.eval ?? {};
      check(e.consentShown === false && e.bubbleShown === false && e.smoothScroll === false,
        `${vp}: ${page}: consent box and chat bubble hidden, smooth scrolling off (consent ${e.consentShown}, bubble ${e.bubbleShown}, smooth ${e.smoothScroll})`);
      const bad = (r.warnings ?? []).find(w => w.includes('rejected')) ?? '';
      check(bad.includes('div:bogus-pseudo') && !bad.includes(':is('), `${vp}: ${page}: the invalid --hide selector, and only it, is named in a warning`);
      check(e.promoShown === false, `${vp}: ${page}: a --hide selector with a comma inside it applied whole`);
      check(!(r.warnings ?? []).some(w => w.includes('scrolls inside')), `${vp}: ${page}: a page the document scrolls is not flagged as an inner scroller`);
    }
    const inner = read(`prep/127-0-0-1-inner/${vp}.json`);
    check((inner.warnings ?? []).some(w => w.includes('scrolls inside')), `${vp}: a page that scrolls an inner container is flagged`);
    const bodyScroll = read(`prep/127-0-0-1-bodyscroll/${vp}.json`);
    check((bodyScroll.warnings ?? []).some(w => w.includes('scrolls inside body')), `${vp}: a page whose body scrolls instead of the document is flagged`);
    const bodyFixed = read(`prep/127-0-0-1-bodyfixed/${vp}.json`);
    check(!(bodyFixed.warnings ?? []).some(w => w.includes('scrolls inside')), `${vp}: a page whose fixed body scrolls, which a capture shows whole, is not flagged`);
  }
  const phoneHints = read('prep/127-0-0-1-overlays/phone.json').eval ?? {};
  check(phoneHints.uaDataMobile === true && phoneHints.uaDataPlatform === 'Android',
    `phone: the client hints say mobile Android (mobile ${phoneHints.uaDataMobile}, platform ${JSON.stringify(phoneHints.uaDataPlatform)})`);
  check(read('prep/127-0-0-1-overlays/desktop.json').eval?.uaDataMobile === false, 'desktop: the client hints say not mobile');

  // Every capture stays under Chrome's capture-height cap, whatever --slice, the pixel ratio and --element-scale ask for.
  const capOut = path.join(out, 'cap');
  exitedCleanly(await capture(['--url', `${base}/tall`, '--viewports', '800x600@2', '--slice', '9000', '--max-bytes', '0', '--no-sheet', '--out', capOut]), 'tall capture');
  const tallReport = read('cap/127-0-0-1-tall/800x600-2.json');
  const tallSlices = (tallReport.files ?? []).filter(f => f.kind === 'slice');
  check(tallSlices.length > 0 && tallSlices.every(f => (f.bottom - f.top) * 2 <= 16_000) && (tallReport.warnings ?? []).some(w => w.includes('capture cap')),
    `2x slices kept under the cap, with a warning (${tallSlices.map(f => f.bottom - f.top).join(', ')} px)`);
  exitedCleanly(await capture(['--url', `${base}/overlays`, '--viewports', '1440x900@3', '--element', 'main', '--element-scale', '4', '--max-bytes', '0', '--no-sheet', '--out', capOut]), 'element capture');
  const elFile = (read('cap/127-0-0-1-overlays/1440x900-3.json').files ?? []).find(f => f.kind === 'element');
  const elSize = elFile && fs.existsSync(path.join(capOut, elFile.file)) ? jpegSize(path.join(capOut, elFile.file)) : null;
  check(Boolean(elSize) && elSize.width <= 16_000 && elSize.height <= 16_000, `an element captured at scale 4 and 3x kept under the cap (${elSize ? `${elSize.width}x${elSize.height}` : 'no file'})`);
  for (const spec of ['1440x900@9', '1440x9999@2']) {
    const run = await capture(['--url', `${base}/missing`, '--viewports', spec, '--no-sheet', '--out', capOut]);
    check(run.status === 2, `viewport ${spec}, past the pixel-ratio range or the cap, is refused (exit ${run.status})`);
  }

  // A folder name from --name or a --urls line is one plain name, so a capture can only land inside --out.
  const namesOut = path.join(out, 'names', 'inside');
  fs.mkdirSync(namesOut, { recursive: true });
  const nameList = path.join(out, 'names', 'list.txt');
  fs.writeFileSync(nameList, `${base}/missing ../escape-list\n`);
  for (const [how, args, target] of [['--name', ['--url', `${base}/missing`, '--name', '../escape-name'], 'escape-name'], ['a --urls line', ['--urls', nameList], 'escape-list']]) {
    const run = await capture([...args, '--viewports', 'desktop', '--no-sheet', '--out', namesOut]);
    check(run.status === 2 && !fs.existsSync(path.join(out, 'names', target)), `a folder name from ${how} that leaves --out is refused, and nothing is written outside it (exit ${run.status})`);
  }
  fs.writeFileSync(nameList, `${base}/missing plain_name-2.v\n`);
  await capture(['--urls', nameList, '--viewports', 'desktop', '--no-sheet', '--out', namesOut]);
  check(fs.existsSync(path.join(namesOut, 'plain_name-2.v', 'desktop.json')), 'a plain folder name from a --urls line is used as given');
} finally {
  server.closeAllConnections?.();
  server.close();
  fs.rmSync(out, { recursive: true, force: true });
}
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
