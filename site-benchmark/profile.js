// profile.js: a whole-page measurement profile, run on the prepared page by
//   node capture.mjs --url <url> --eval profile.js
// The result lands in each page's JSON report under "eval". Positions are CSS px from the top of the page.
// Everything here is a heuristic starting point: check the bands and the call to action it picked against
// the slices before quoting a number, and measure by hand where the page's structure defeats it.
async () => {
  const vw = innerWidth, vh = innerHeight;
  const pageHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
  const seen = el => el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  const top = r => Math.round(r.top + scrollY);
  const bottom = r => Math.round(r.bottom + scrollY);
  const label = el => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/)[0]}` : ''}`.slice(0, 60);

  // Visible content boxes: text runs, media, and elements painting a background image.
  const content = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim() || !n.parentElement || !seen(n.parentElement)) continue;
    range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) content.push({ top: top(r), bottom: bottom(r), el: n.parentElement, text: n.textContent.trim().length });
  }
  for (const el of document.body.querySelectorAll('img,svg,video,canvas,iframe,picture,input,select,textarea,button,[style*="background"],section,div,figure')) {
    if (!seen(el)) continue;
    const isMedia = /^(IMG|SVG|VIDEO|CANVAS|IFRAME|INPUT|SELECT|TEXTAREA|BUTTON)$/.test(el.tagName.toUpperCase());
    if (!isMedia && getComputedStyle(el).backgroundImage === 'none') continue;
    const r = el.getBoundingClientRect();
    if (r.width >= 8 && r.height >= 8) content.push({ top: top(r), bottom: bottom(r), el, media: true });
  }

  // Bands: descend from <main> (or <body>) while one child holds nearly all the height; the children of
  // the container found are the page's stacked sections.
  let root = document.querySelector('main') ?? document.body;
  for (let guard = 0; guard < 8; guard++) {
    const kids = [...root.children].filter(k => seen(k) && k.getBoundingClientRect().height > 0);
    const rh = root.getBoundingClientRect().height || 1;
    const big = kids.find(k => k.getBoundingClientRect().height >= rh * 0.9);
    if (kids.length === 1 || (big && kids.length <= 3)) root = big ?? kids[0]; else break;
  }
  const bandEls = [...root.children].filter(k => {
    const r = k.getBoundingClientRect();
    return seen(k) && r.height >= 40 && r.width >= vw * 0.6;
  });
  const bands = bandEls.map(el => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const inside = content.filter(c => el.contains(c.el));
    const cTop = inside.length ? Math.min(...inside.map(c => c.top)) : null;
    const cBottom = inside.length ? Math.max(...inside.map(c => c.bottom)) : null;
    return { el: label(el), top: top(r), height: Math.round(r.height),
      background: cs.backgroundImage !== 'none' ? 'image' : cs.backgroundColor,
      paddingTop: parseFloat(cs.paddingTop), paddingBottom: parseFloat(cs.paddingBottom),
      contentTop: cTop, contentBottom: cBottom };
  });
  for (let k = 0; k < bands.length - 1; k++) {
    const a = bands[k], b = bands[k + 1];
    a.gapToNext = a.contentBottom !== null && b.contentTop !== null ? b.contentTop - a.contentBottom : null;
  }
  // Section spacing is read below the first viewport, so a hero's own height does not count as a gap.
  const gaps = bands.filter(b => b.top >= vh * 0.8).map(b => b.gapToNext).filter(g => typeof g === 'number').sort((x, y) => x - y);
  const median = xs => xs.length ? (xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2) : null;

  // Text sizes, weighted by characters.
  const sizes = new Map();
  for (const c of content) {
    if (!c.text) continue;
    const px = Math.round(parseFloat(getComputedStyle(c.el).fontSize) * 10) / 10;
    sizes.set(px, (sizes.get(px) ?? 0) + c.text);
  }
  const totalChars = [...sizes.values()].reduce((a, b) => a + b, 0) || 1;
  const under = px => Math.round(100 * [...sizes].filter(([s]) => s < px).reduce((a, [, n]) => a + n, 0) / totalChars);
  const byChars = [...sizes].sort((a, b) => b[1] - a[1]);

  // Calls to action: visible links and buttons whose words ask for an action.
  // Word stems, so "consult" also catches "consultation" and "schedul" catches "schedule" and "scheduling".
  // "start" and "try" only as whole words, so "Startups" and "Trying times" are not calls to action.
  const ctaWords = /\b(book|schedul|consult|contact|call|get started|start\b|request|appointment|talk|enquir|inquir|quote|demo|sign ?up|join|apply|buy|shop|donat|register|subscrib|reserv|get in touch|work with|work together|partner with|chat|hire|assessment|estimate|try\b|free)/i;
  // Site chrome is the page's own header and navigation. A <header> inside a section is part of the
  // content (heroes are often built that way), so only a header outside main, article, section and
  // aside counts.
  const inChrome = el => {
    if (el.closest('nav,[role="navigation"],[role="banner"]')) return true;
    const h = el.closest('header');
    return Boolean(h && !h.parentElement?.closest('main,article,section,aside'));
  };
  const ctas = [...document.querySelectorAll('a,button,[role="button"],input[type="submit"]')]
    .filter(el => {
      const t = (el.textContent || el.value || '').trim();
      const r = el.getBoundingClientRect();
      // Off to the side or above the page means a closed drawer, a carousel slide or a hidden header
      // state, not something a visitor sees. A bare address as link text is not a call to action.
      return seen(el) && t.length <= 40 && ctaWords.test(t) && !/:\/\/|www\./i.test(t)
        && r.height > 0 && r.right > 0 && r.left < vw && top(r) >= 0;
    })
    .map(el => { const r = el.getBoundingClientRect(); return { text: (el.textContent || el.value).trim().replace(/\s+/g, ' ').slice(0, 50), top: top(r),
      screens: Math.round((top(r) / vh) * 100) / 100, percentOfPage: Math.round((100 * top(r)) / pageHeight), inHeaderOrNav: inChrome(el),
      // A button is often styled on an inner element or a pseudo-element, so the link, its first few
      // descendants, and their ::before and ::after boxes are all checked for a fill or a border.
      looksLikeButton: [el, ...el.querySelectorAll('*')].slice(0, 6).some(x => [null, '::before', '::after'].some(p => {
        const cs = getComputedStyle(x, p);
        return !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor) || parseFloat(cs.borderTopWidth) > 0 || cs.backgroundImage !== 'none';
      })) }; })
    .sort((a, b) => a.top - b.top);

  // First viewport: the largest visible media or background-image box, and the h1. The kind says what the
  // box is, not what it shows: whether an image is a photograph is for the eye to decide on the slice.
  // A visually hidden h1 (screen-reader only) is not the headline a visitor sees.
  const h1 = [...document.querySelectorAll('h1')].find(el => { const r = el.getBoundingClientRect(); return seen(el) && r.width > 20 && r.height > 10; });
  const h1Box = h1 ? h1.getBoundingClientRect() : null;
  const kindOf = el => {
    const t = el.tagName.toLowerCase();
    if (t === 'img' || t === 'picture') return 'image';
    if (t === 'video' || t === 'canvas' || t === 'svg' || t === 'iframe') return t;
    const bg = getComputedStyle(el).backgroundImage;
    return /url\(/.test(bg) ? 'background-image' : 'gradient';
  };
  const firstMedia = content.filter(c => c.media && c.top < vh).map(c => {
    const r = c.el.getBoundingClientRect();
    const w = Math.min(r.right, vw) - Math.max(r.left, 0), h = Math.min(r.bottom, vh) - Math.max(r.top, 0);
    const underHeadline = Boolean(h1Box && h1Box.left < r.right && h1Box.right > r.left && h1Box.top < r.bottom && h1Box.bottom > r.top);
    return { el: label(c.el), kind: kindOf(c.el), widthShare: Math.round((100 * Math.max(0, w)) / vw),
      screenShare: Math.round((100 * Math.max(0, w) * Math.max(0, h)) / (vw * vh)), underHeadline };
  }).sort((a, b) => b.screenShare - a.screenShare)[0] ?? null;

  return {
    viewport: `${vw}x${vh}`, pageHeight, screens: Math.round((pageHeight / vh) * 10) / 10,
    sections: { container: label(root), count: bands.length, gapsMeasured: gaps.length, gapMedian: median(gaps), gapMin: gaps[0] ?? null, gapMax: gaps.at(-1) ?? null, bands },
    text: { mostUsedPx: byChars.slice(0, 5).map(([px, n]) => ({ px, share: Math.round((100 * n) / totalChars) })), percentUnder12px: under(12), percentUnder14px: under(14) },
    ctas: { first: ctas.find(c => !c.inHeaderOrNav) ?? null, firstIncludingHeader: ctas[0] ?? null, count: ctas.length, list: ctas.slice(0, 8) },
    firstViewport: { largestMedia: firstMedia, h1: h1 ? { text: h1.innerText.trim().replace(/\s+/g, ' ').slice(0, 80), px: parseFloat(getComputedStyle(h1).fontSize), top: top(h1.getBoundingClientRect()) } : null },
  };
}
