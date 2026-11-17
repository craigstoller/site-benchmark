// A local page built to break naive captures: a sticky header that changes once scrolled, a full-height
// hero built inside a section-level <header>, a hidden notice and a fading dropdown that must stay
// hidden, a translucent line that must stay translucent, a scroll-scrubbed line left half-faded at the
// top of the page, scroll-reveal content that hides again when it leaves the view, slow lazy images, smooth
// scrolling, a consent banner, a chat bubble, a dimmed modal, a fixed full-screen background that must
// stay, a hidden panel that still takes up space inside a page-wide gradient wrapper (a blank stretch to be
// flagged, which the gradient must not mask), a scroll lock, an image
// wider than a phone screen, and a height past Chrome's capture cap.
// /blocked answers like a Cloudflare challenge, /challenge200 like a challenge served with status 200, and /hang never
// finishes loading. /overlays holds a consent box placed in the page (so only the built-in list can hide it) and a fixed
// chat bubble; /csp is the same page under a style-src policy that blocks <style> elements; /inner scrolls an inner
// container rather than the document; /bodyscroll scrolls the body itself, which a capture cuts off after the first
// screen; /bodyfixed scrolls a fixed body, which a capture shows whole; /tall is a plain page taller than a 2x slice can
// be under the capture cap.
import http from 'node:http';
import { pathToFileURL } from 'node:url';

// A small solid-colour bitmap, shown at 400x250; the colour changes with n.
const bmp = n => {
  const w = 40, h = 25, row = Math.ceil((w * 3) / 4) * 4, buf = Buffer.alloc(54 + row * h);
  buf.write('BM'); buf.writeUInt32LE(buf.length, 2); buf.writeUInt32LE(54, 10); buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(w, 18); buf.writeInt32LE(h, 22); buf.writeUInt16LE(1, 26); buf.writeUInt16LE(24, 28); buf.writeUInt32LE(row * h, 34);
  const [r, g, b] = [(n * 97) % 200 + 30, (n * 53) % 200 + 30, (n * 29) % 200 + 30];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) buf.set([b, g, r], 54 + y * row + x * 3);
  return buf;
};

const sections = Array.from({ length: 24 }, (_, k) => `
<section class="band${k % 2 ? ' alt' : ''}" id="s${k + 1}">
  <h2 class="reveal">Section ${k + 1} heading</h2>
  <p class="reveal">Body copy for section ${k + 1}. It shows when it scrolls into view and hides again when it leaves.</p>
  <img class="reveal" loading="lazy" src="/img/${k + 1}.bmp" width="400" height="250" alt="figure ${k + 1}">
  ${k === 3 ? '<a class="btn" href="#book">Book a consultation</a>' : ''}
  ${k === 1 ? '<p class="watermark">A deliberately translucent line.</p>' : ''}
  ${k === 7 ? '<p class="scrub">A line faded by a scroll-scrubbed animation.</p>' : ''}
  ${k === 11 ? '<div class="ghost">A hidden panel that still takes up space.</div>' : ''}
</section>`).join('\n');

const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Trap page</title>
<style>
html{scroll-behavior:smooth}
body{margin:0;font-family:Georgia,serif;color:#222}
header.site{position:sticky;top:0;height:72px;background:#123;color:#fff;display:flex;align-items:center;padding:0 24px;z-index:10}
header.site.scrolled{background:#c00}
.update-notice{visibility:hidden;margin:0;padding:8px 24px;background:#fe8}
.hero{height:100vh;background:#c96;display:flex;align-items:center;justify-content:center}
.hero-head{position:relative;text-align:center}
.hero-head h1{font-size:48px;font-weight:normal;margin:0}
.menu{position:absolute;top:100%;left:0;opacity:0;transition:opacity .2s;background:#fff;padding:12px}
.band{padding:120px 10%;min-height:600px}
.band.alt{background:#eef}
.reveal{opacity:0;transform:translateY(40px);transition:opacity .6s,transform .6s}
.reveal.in{opacity:1;transform:none}
#onetrust-banner-sdk{position:fixed;bottom:0;left:0;right:0;height:140px;background:#000;color:#fff;z-index:9999}
.chat-bubble{position:fixed;right:20px;bottom:20px;width:64px;height:64px;border-radius:32px;background:#e33;z-index:9000}
.backdrop{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:500}
.fixed-bg{position:fixed;inset:0;background:linear-gradient(#fdf6ec,#f3e2c7);z-index:1}
.hero,.band,footer{position:relative;z-index:2}
.lock{overflow:hidden}
.watermark{opacity:.3}
.ghost{visibility:hidden;height:1000px}
.wrap{display:block;background-image:linear-gradient(#ffffff,#f7f7ff)}
.btn{display:inline-block;margin-top:24px;padding:14px 24px;background:#123;color:#fff}
footer{padding:80px 10%;background:#111;color:#eee}
</style></head>
<body>
<div class="top-sentinel" style="height:1px"></div>
<header class="site">Trap page</header>
<p class="update-notice">Please update your browser.</p>
<section class="hero">
  <header class="hero-head">
    <h1>Full-height hero</h1>
    <a class="btn" href="#book">Book a consultation</a>
    <div class="menu"><a href="#more">Menu item one</a></div>
  </header>
</section>
<main class="wrap">
${sections}
</main>
<footer>Footer text at the very bottom of the page.</footer>
<div id="onetrust-banner-sdk">We use cookies.</div>
<div class="chat-bubble"></div>
<div class="fixed-bg"></div>
<div class="backdrop"><div role="dialog" aria-label="Newsletter">Join our newsletter</div></div>
<script>
document.documentElement.classList.add('lock');
const io = new IntersectionObserver(es => es.forEach(e => e.target.classList.toggle('in', e.isIntersecting)), { threshold: 0.1 });
document.querySelectorAll('.reveal').forEach(el => io.observe(el));
const site = document.querySelector('header.site');
new IntersectionObserver(([e]) => site.classList.toggle('scrolled', !e.isIntersecting)).observe(document.querySelector('.top-sentinel'));
// Scroll-scrubbed: opacity and offset follow the scroll position, from a faded state below the fold.
const scrub = () => document.querySelectorAll('.scrub').forEach(el => {
  const p = Math.min(1, Math.max(0, (innerHeight - el.getBoundingClientRect().top) / (innerHeight * 0.5)));
  el.style.opacity = String(0.2 + 0.8 * p);
  el.style.transform = 'translateY(' + Math.round(30 * (1 - p)) + 'px)';
});
addEventListener('scroll', scrub, { passive: true });
scrub();
</script>
</body></html>`;

// Styles for these pages come from a file, so the /csp policy blocks nothing of the page's own.
const overlays = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Overlays</title><link rel="stylesheet" href="/pages.css"></head>
<body><main><h1>Overlay page</h1><p>${'A paragraph of body copy on the overlay page. '.repeat(30)}</p></main>
<div class="cc-window">We use cookies.</div><div class="chat-bubble"></div><div class="promo">A promotion only --hide names.</div></body></html>`;
const inner = `<!doctype html><html class="shell"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Inner scroller</title><link rel="stylesheet" href="/pages.css"></head>
<body><main class="app">${Array.from({ length: 8 }, (_, k) => `<section><h2>Panel ${k + 1}</h2><p>Copy for panel ${k + 1}, inside a container that scrolls on its own.</p></section>`).join('')}</main></body></html>`;
const bodyRows = Array.from({ length: 20 }, (_, k) => `<section><h2>Row ${k + 1}</h2><p>Copy for row ${k + 1}.</p></section>`).join('');
const bodyPage = (cls, title) => `<!doctype html><html class="${cls}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><link rel="stylesheet" href="/pages.css"></head><body>${bodyRows}</body></html>`;
const tall = `<!doctype html><html><head><meta charset="utf-8"><title>Tall</title><link rel="stylesheet" href="/pages.css"></head>
<body><div class="tall"><h1>A tall plain page</h1></div><p>The end of the tall page.</p></body></html>`;
const pagesCss = `html{scroll-behavior:smooth}body{margin:0;font-family:Georgia,serif;color:#222}main{padding:40px 10%}
.cc-window{position:absolute;top:120px;left:10%;right:10%;padding:24px;background:#000;color:#fff}
.chat-bubble{position:fixed;right:20px;bottom:20px;width:64px;height:64px;border-radius:32px;background:#e33}
html.shell,html.shell body{height:100%;overflow:hidden}.app{height:100%;overflow-y:auto;padding:0}.app section{min-height:600px;padding:60px 10%}
html.bodyscroll{height:100%;overflow:hidden}html.bodyscroll body{height:100%;overflow-y:auto}html.bodyfixed body{position:fixed;inset:0;overflow-y:auto}
html.bodyscroll section,html.bodyfixed section{min-height:240px;padding:0 10%}
.tall{height:12000px;background:linear-gradient(#ffffff,#ccccff)}`;

export function startTrapPage(port = 0) {
  const server = http.createServer((req, res) => {
    const pages = { '/overlays': overlays, '/csp': overlays, '/inner': inner, '/tall': tall,
      '/bodyscroll': bodyPage('bodyscroll', 'Body scroller'), '/bodyfixed': bodyPage('bodyfixed', 'Fixed body scroller') };
    if (req.url === '/pages.css') { res.writeHead(200, { 'content-type': 'text/css' }); res.end(pagesCss); return; }
    if (pages[req.url]) {
      res.writeHead(200, { 'content-type': 'text/html', ...(req.url === '/csp' ? { 'content-security-policy': "style-src 'self'" } : {}) });
      res.end(pages[req.url]);
      return;
    }
    const m = /^\/img\/(\d+)\.bmp$/.exec(req.url);
    if (m) {
      setTimeout(() => { res.writeHead(200, { 'content-type': 'image/bmp' }); res.end(bmp(Number(m[1]))); }, 300);
      return;
    }
    if (req.url === '/blocked') {
      res.writeHead(403, { 'content-type': 'text/html', server: 'cloudflare', 'cf-mitigated': 'challenge' });
      res.end('<html><body>Just a moment...</body></html>');
      return;
    }
    if (req.url === '/challenge200') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><head><title>Just a moment...</title></head><body><h1>Checking your browser before you continue.</h1></body></html>');
      return;
    }
    if (req.url === '/hang') {
      // Starts a page and never finishes it, so the load event never fires: the site watchdog has to stop it.
      res.writeHead(200, { 'content-type': 'text/html' });
      res.write('<html><head><title>Hang</title></head><body><p>Still loading.</p>');
      return;
    }
    if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(page); return; }
    res.writeHead(404); res.end('not found');
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await startTrapPage(Number(process.argv[2] || 8765));
  console.log(`trap page on http://127.0.0.1:${server.address().port}/`);
}
