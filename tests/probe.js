// Run on a prepared test page by tests/smoke.mjs: reports what a capture of it would show. Each field is null or
// harmless on a page that lacks its element, so one probe serves every test page.
() => {
  const opacity = sel => {
    const el = document.querySelector(sel);
    if (!el || getComputedStyle(el).visibility === 'hidden') return 0;
    let o = 1;
    for (let a = el; a; a = a.parentElement) o *= parseFloat(getComputedStyle(a).opacity);
    return o;
  };
  const shown = sel => { const el = document.querySelector(sel); return el ? getComputedStyle(el).display !== 'none' : null; };
  const header = document.querySelector('header.site');
  const ua = navigator.userAgentData;
  return {
    noticeHidden: opacity('.update-notice') === 0,
    menuHidden: opacity('.menu a') === 0,
    heroCtaShown: opacity('.hero-head .btn') === 1,
    lastSectionShown: opacity('#s24 h2') === 1 && opacity('#s24 img') === 1,
    scrubShown: opacity('.scrub') >= 0.95,
    watermarkKept: Math.abs(opacity('.watermark') - 0.3) < 0.01,
    headerAtTop: header ? !header.classList.contains('scrolled') : null,
    consentShown: shown('.cc-window'),
    bubbleShown: shown('.chat-bubble'),
    promoShown: shown('.promo'),
    smoothScroll: getComputedStyle(document.documentElement).scrollBehavior === 'smooth',
    uaDataMobile: ua ? ua.mobile : null,
    uaDataPlatform: ua ? ua.platform : null,
  };
}
