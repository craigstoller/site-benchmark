---
name: site-benchmark
description: Use when a design, content, layout, search or policy question should be settled by what other websites actually do - benchmarking against competitor or best-in-class exemplar sites, finding who else does similar work, reviewing a site someone points at as a model, tearing down how a competitor ranks or converts - or when full-page desktop and phone screenshots of live sites are needed.
---

# Site benchmark

A comparison is only as good as its sample. The expensive mistakes in this work are sampling mistakes, not tool mistakes: a conclusion drawn from the first viewport, one measured gap standing in for a whole page, the wrong element measured, one section per site, desktop only, a sponsored result counted as a ranking winner, the client's own site inside the reference set, a linked page taken for the whole site. Each has cost a redone audit or a corrected claim in a client draft.

**Report only:** no outreach, sign-ups, form submissions, bookings or logins. Consent prompts are hidden by style, never clicked or accepted. A prompt with the page behind it is simply hidden; a consent, login or pay wall that withholds the content (the prepared slices show little or none of the page) makes that page missing data, and whatever lies behind a form or a login is unknown. Captures of other sites are internal evidence: keep the load light (the script's default concurrency) and quote them sparingly in anything that leaves the project.

## 1. Fix the question and the set before opening a site

- Restate the claim or question under test in the user's words and name the attribute that will settle it. If it reads two ways, confirm before researching.
- Read what the project already holds: positioning or brand docs (the lens for "similar" and "good"), a standing exemplar set or rubric, earlier notes and scores. Build on them. With no rubric on file, write one before opening a site: a handful of axes scored 1 to 5, each with what a 1, a 3 and a 5 look like.
- Give every site a role, chosen from written criteria, and report each role separately. Never average across roles.

| Role | Answers | Rule |
|---|---|---|
| Design exemplars | what the best do | chosen for craft, not proximity, from a named source (the project's exemplar set, award lists, category roundups) |
| Ranking winners | who wins the search | organic results for the queries a buyer in the client's market would type, from one fixed method (tool, location, depth, date); sponsored and ad slots filtered out |
| Baseline | where the client stands | the client's or user's current site, whatever role it is given; measured the same way, in its own row, never part of the reference pattern; "none" when there is no live site |
| Contrast | what to avoid | weaker performers and anti-models, never in the positive set |

- Sites the user names keep the role the user gives them, except the client's or user's own site, which is always the baseline; call them "named by the user" when no role above fits.
- Draw exemplars from the leaders, not whoever is nearby: the best-regarded work in the category, from the most competitive markets rather than the client's own town.
- Two sites on the same theme or vendor template are one data point for anything the template sets (layout, type, spacing). Check the theme or asset paths and the footer credit before counting them twice; a generator tag alone names only the platform, which many unrelated sites share.
- Visit the live sites. Never work from a description, a transcript, a paraphrase or memory. A linked page is an entry point to its site: capture the site's main navigation pages, plus what the question needs from its sitemap, as a per-site URL list (`--urls`). `--routes` adds the same paths to every site, beside each URL.
- A site behind a bot challenge is missing data. Substitute another where you chose the set, and report it as missing where the user named it; either way the write-up names it among the excluded sites (section 4). The desktop app's browser pane is for looking at a page by hand, never for captures. Probe an unfamiliar domain (`curl -sIL`) before anyone opens it there: a challenge page has crashed the app. The probe only screens for the pane. Curl draws challenges a browser may pass, and a clean probe does not rule out one served by script, so the capture report, not the probe, decides whether a page is missing data.

## 2. Capture with the bundled script

For any full-page or multi-width capture, run `capture.mjs` from this skill's base directory. Don't use the in-app browser pane (blank or timed-out shots on long or animated pages) or the DevTools MCP (its shared profile gets locked by other sessions), and don't write a new scratch script.

```bash
node <skill dir>/capture.mjs --url https://example.com --out <folder beside the note> --eval <skill dir>/profile.js
```

It needs Node 22+ and an installed Chrome, Edge or Chromium. By default it shoots desktop 1440x900 and phone 390x844, the phone as Chrome emulating an Android phone (user agent and client hints, touch and mobile layout); iPhone Safari is not captured. Each page is shot first as it arrives (`<viewport>-first.jpg`, banners and all). It is then prepared (smooth scrolling off, scrolled through, lazy images loaded, scroll-reveal content restored, consent, chat and other fixed overlays hidden by style, a fixed header made part of the page at its top, sticky elements made static) and written as readable slices and a contact sheet. Slices and sheets are JPEGs kept under 400 thousand bytes where they can be (the report warns when one can't); full-page parts are not, and are split under Chrome's capture-height cap. A JSON report per page and width records the access time, the final URL, the browser's language, time zone and user agent, and what preparation changed. Run `--help` for the options, which include a URL list, routes, full-page parts, element captures and reduced motion.

- Read each page's JSON report before its images, and act on every warning. A blocked or near-empty page is missing data, not evidence, and so is one with an error status, one the site watchdog stopped, one whose report says it scrolls inside an inner container (everything past its first viewport), or one with no report. A blank stretch the report flags must be looked at. Check that each final URL is the page you meant. An element selector that matched many elements may have caught the wrong one.
- Compare the first slice with the first view. Preparation is meant to change the top of the page (the header's top-of-page state, hidden prompts, revealed content). If it showed something that should stay hidden, or hid real content, rerun that page into a new `--out` folder, so the first run stays to compare against, with the flag the warning names (`--no-reveal`, `--reveal-all`, `--keep-fixed`, `--keep-overlays` or `--hide`).
- Name what fills each flagged blank stretch. One that `--reveal-all` does not fill is either a plain or gradient band, which is real space, or, more often, a pinned, scroll-driven section, which no full-page capture can show. Report a pinned section as such, never as whitespace, and never quote it as a gap.
- Consent banners, chat prompts and pop-ups are measured from the first view, which shows only what is on screen on arrival: about half a second after the page loads and its fonts are ready, or at the navigation timeout for a page that never finishes loading. A pop-up that arrives later, on a timer or on scroll, is not in it. Preparation's second pass hides a late one fixed to the screen and lists it with its text among the report's hidden fixed overlays, so read those too; a known consent or chat widget that loads late is hidden by the built-in list and recorded nowhere. A "no pop-up" reading is low confidence even when that list is empty: a pop-up on a longer timer, on exit or on another page appears in neither. The slices have these hidden, except a pop-up not fixed to the screen, which stays in the page where it sits. A call-to-action bar fixed to the screen is hidden too, and listed with its text among the report's hidden fixed overlays; a sticky one stays in the page where it sits.
- Captures carry this machine's location and the browser's language (the report records the language and time zone). Record them, and treat anything that varies by market (consent, prices, results) as measured from here; if the client's market is elsewhere, say so in anything client-facing. A capture is also one visit: experiments and personalization can show another visitor something else.
- Read slices and contact sheets, not one tall image (it shrinks past legibility). Look at the middle and bottom of each page, not just the top.
- Text: a local extractor first (such as `defuddle`), a metered scraper only when that comes back thin. A bot-challenged page has no site text: it is missing data. For a page that is only script-rendered, read the text through `--eval` on the prepared page.
- If a capture has to happen another way (an interactive state the script can't reach, such as an open menu, or a machine without Node 22+ and Chrome), copy the script's preparation: fixed viewports at pixel ratio 1 (with phone emulation for the phone pass), instant scrolling, scroll through, stop the page's scroll observers once back at the top, restore reveal content, hide overlays by style, make a fixed header `position: absolute` so it sits once at the top of the page, make sticky elements static, and wait for load plus fonts rather than network idle. Keep each capture under about sixteen thousand device pixels tall, or Chrome silently wraps it and drops the bottom of the page. Record by hand what the report would have: access time, final URL, widths, location and language.

## 3. Measure the whole page, at both widths

- When the attribute recurs down the page (spacing, imagery, type), measure it across every section, and on several pages or sections per site. Not one gap, one band or the first viewport. Report each site's median and range, and each role's median of the site medians, so each site counts once.
- Measure the element that carries the attribute. For imagery, walk up from the image to the tile or container that sets its shape, crop and background.
- For anything the page shows, desktop and phone are two measurements. When time is short, cut sites rather than the phone measurements: the sites furthest from the question first, each named in the note.
- Measure on the prepared page (`--eval`). `profile.js` reports section bands and the content-to-content gaps below the first viewport, text sizes, calls to action with their depth, and what fills the first viewport (check that against the first view, since the page was prepared). It is a heuristic, and its call-to-action words are English: check what it picked against the slices before quoting a number, and take out any gap that spans a blank stretch.
- Record `unknown` rather than a guess, with provenance (which report, slice or page text) and confidence (high, medium or low). Score at entry and never retrofit scores after seeing the pattern.

## 4. Write it up

When the user wants a quick answer in chat rather than a note, skip the file but keep its substance: the sites with their roles and URLs, both widths, the access date, n beside the number of sites attempted and each site excluded with its reason (a substitute named with the site it replaced), what is unknown, and that a pattern is not a cause.

Otherwise, a dated note in the project, in this order:

1. The question or claim under test, in the user's words.
2. The set: each site with its role and URL; sites left out, cut, excluded or substituted, each with its reason.
3. Method: tools, widths, access dates, this machine's location and language, what was measured and how.
4. Findings table: one row per site, desktop and phone in separate columns, the baseline in its own row, with the measurements, scores, provenance and confidence.
5. The pattern, with n and the uncertainty stated. n is the distinct sites actually captured; for an attribute a template sets, sites sharing that template count once (section 1). Beside n, give the number of sites attempted and each one excluded with its reason (bot challenge, error status, watchdog, substituted), so a reader sees what the sample lost. With fewer than about five distinct sites in a role, say what those sites do, not what the field does. A pattern is not a cause: leaders also win on things no capture sees (brand, reviews, links), and a trait the contrast sites share explains nothing.
6. What could not be determined, and what would settle it.
7. Recommendation: what to borrow, adapt or avoid, fitted to the project's own register rather than copied.

## Shapes of this work

`references/variants.md` covers five shapes: a discovery scan (who else does this), a single-attribute measurement against a standing set, a review of one site someone points at, a competitor teardown, and a multi-round audit too big for one session, plus how to keep a standing exemplar catalog. Read the matching section before starting one.

## Red flags

| Thought | Instead |
|---|---|
| "The client's current site belongs in the set" | Baseline only: same measurement, its own row |
| "The top search results are the leading sites" | Organic only, and ranking winners are a separate role from exemplars |
| "One clean gap shows the page's spacing" | Whole page, several sections |
| "Desktop now, phone if there's time" | Phone is its own measurement; cut sites instead |
| "Review just the page they linked" | It's an entry point; capture the site's main pages |
| "Outside the brief, so not borrowing" | Cost it as a candidate, with the condition that would make it worth doing |
| "A pane screenshot or a quick scratch script will do" | Run `capture.mjs` |
| "These two sites agree" | Same template? Then they are one data point for what it sets |
