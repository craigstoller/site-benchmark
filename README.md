# site-benchmark

A Claude Code skill for settling design, content, layout, search and policy questions by what other websites actually do. Use it to benchmark against competitor or best-in-class sites, find who else does similar work, review a site someone points at as a model, tear down how a competitor ranks or converts, or capture full-page desktop and phone screenshots of live sites.

Most mistakes in this kind of work are sampling mistakes, not tool mistakes. Conclusions get drawn from the first viewport, from one measured gap or from desktop alone. The client's own site ends up in the reference set, sponsored results count as ranking winners, and a linked page gets taken for the whole site. The skill carries the rules that prevent those mistakes. A bundled capture script handles many of the mechanics that make screenshots silently wrong; the known limits below list what it does not.

## What's here

| Path | What it is |
|---|---|
| `site-benchmark/SKILL.md` | The skill: choosing the comparison set, capture, whole-page measurement, and the write-up |
| `site-benchmark/references/variants.md` | Extra steps for each of five shapes of the work (discovery scan, single-attribute measurement, single-site review, competitor teardown, multi-round audit), plus keeping a standing exemplar catalog |
| `site-benchmark/capture.mjs` | The capture script |
| `site-benchmark/profile.js` | A whole-page measurement profile the capture script can run on each prepared page |
| `tests/` | A smoke test against local pages built to break naive captures |
| `package.json` | Declares Node 22 or later and runs the smoke test as `npm test` |
| `LICENSE` | The MIT licence |

## Install

Link the skill folder into your personal skills directory, or into a project's `.claude/skills` directory to use it in that project only. Create the directory first if it does not exist.

Windows (a directory junction, which needs no elevated shell):

```powershell
cmd /c mklink /J "$HOME\.claude\skills\site-benchmark" "<this repo>\site-benchmark"
```

macOS or Linux:

```bash
ln -s "<this repo>/site-benchmark" ~/.claude/skills/site-benchmark
```

## Requirements

- Node 22 or later. The script uses Node's built-in WebSocket and has no npm dependencies, so there is nothing to install.
- An installed Chrome, Edge or Chromium. The script looks in the usual install locations. Set `CHROME_PATH` or pass `--browser` to choose one.

## The capture script

```bash
node site-benchmark/capture.mjs --url https://example.com --out captures --eval site-benchmark/profile.js
node site-benchmark/capture.mjs --urls sites.txt --viewports desktop,phone --out captures
node site-benchmark/capture.mjs --help
```

It drives the browser headless over the DevTools protocol. Each run gets a fresh temporary profile, so another session's browser can't lock it. Each page and viewport gets its own browser context and a navigation timeout, and each URL a watchdog that stops it when it runs over (`--site-timeout`, 180 seconds by default, for all of that URL's viewports together; each route counts as its own URL). Each page is shot first as it arrives, banners and all. The script then prepares it so the capture shows what a visitor scrolling the page would see:

- **Smooth scrolling off, then a scroll through the whole page.** Lazy images load and scroll reveals fire. Pages measured mid-scroll-animation drop content without any error.
- **The page's IntersectionObservers stopped once back at the top.** Some reveal libraries hide content again once it leaves the view, which would otherwise blank the bottom of the capture a moment after it was checked. Headers that change once scrolled keep their top-of-page state.
- **Reveal content restored, and only reveal content.** While scrolling, the script notes how visible each piece of content was when in view. Content the page later hid by opacity or visibility, or left half-faded, is restored, as is fully hidden content that animates in the page flow. Content taken out of the layout (`display: none`) is not, and neither is a reveal that only moves content without fading it. Menus, carousel slides, hidden notices and deliberately translucent design stay as they are. The report counts both.
- **Overlays hidden by style, never clicked.** This covers common consent, cookie and chat widgets, plus `--hide` selectors. The report names each selector that hid something when preparation began, and any `--hide` selector the browser rejected; a listed widget that loads later is hidden with no record. `--keep-overlays` skips the built-in list. Other fixed overlays are hidden too, with modals and pop-ups that appear on a timer caught by a second pass. The rules go in through a constructed stylesheet, which a page's style-src policy does not block.
- **A fixed header made part of the page at its top, and sticky elements made static**, so they don't repeat or cover content.
- **Waits for load plus fonts, not network idle.** A page with a perpetual animation never goes idle.
- **Every capture kept under Chrome's capture-height cap.** Past about sixteen thousand device pixels, a capture wraps back to the top and drops the rest without an error. Full-page parts are split, slices and wide element captures are cut or scaled to fit, and a viewport past the cap is refused.
- **Phone layouts wider than the screen are reported.** These are captured zoomed out, as a phone would show them.

Each page and viewport writes:

- a first-view shot of the screen on arrival, before any preparation;
- slices sized to stay legible when read as images;
- a contact sheet of the whole page;
- optional full-page parts (`--full`);
- optional element captures (`--element`);
- a JSON report with the access time, HTTP status, final URL, the browser's language, time zone, user agent and client hints, every change the preparation made, and warnings.

`captures.json` in the output folder logs every run into it when the run ends, with its viewports, slice height, byte limit, preparation options and a line per page, so a rerun of one page with a different flag adds a run to the log rather than replacing it, though the rerun replaces that page's own report and images. It does not record the `--eval` profile, the timeouts or extras such as `--full` and `--element`, and a run stopped before it ends adds nothing.

Slices and element captures step down in quality, then in scale, until they fit under a byte limit (default 400 thousand bytes). Contact sheets step down in quality only, and one still over the limit is flagged. Full-page parts are kept whole. A bot challenge (Cloudflare's, and common challenge pages even when served with status 200), an error status, a blank stretch of the page, a page that scrolls inside an inner container, a redirect or a selector matching many elements is flagged in the report. A site stopped by its watchdog gets a report per viewport saying so, unless it is still running 15 seconds later (see the known limits).

## What the script does to the sites it visits

- It loads each page in a headless browser and scrolls it from top to bottom. It fills in no forms, logs in nowhere and clicks nothing on the page.
- It hides consent, cookie and chat prompts by style. It never accepts, rejects or dismisses them, so the script makes no consent choice, though a site that treats scrolling or browsing on as consent may still record one.
- For the phone pass it presents an Android phone: its user agent, client hints, touch and mobile layout.
- It reports a bot challenge rather than trying to pass it.
- It captures two pages at a time by default (`--concurrency`, at most 8). Each URL and each route is its own entry, so the two can be pages of the same site.
- It reads no `robots.txt` and knows nothing of a site's terms of use. Following each site's terms, and the law where you run it, is your job.

## Known limits

These change what a capture shows. Each page's JSON report is the place to check most of them.

- The phone pass is Chrome emulating an Android phone at pixel ratio 1. It is not iPhone Safari, and a site that serves sharper images to high-density screens serves the phone pass its standard ones.
- The desktop pass presents headless Chrome's own user agent, which names itself as headless, so some sites challenge the desktop pass and not the phone pass. The `tablet` preset presents the phone's user agent.
- Content inside shadow-DOM components and iframes is out of the preparation's reach: overlay hiding, reveal restoration and the blank-stretch check don't see it, so a section built from web components can be flagged as blank.
- `profile.js` can report no section gaps on grid or bento layouts. Measure those pages by hand from the slices. A slice can be shrunk to fit the byte limit, so divide a distance measured on it by that slice's `scale` in the report, and by the pixel ratio when it is above 1.
- A rerun into the same `--out` folder leaves the earlier run's extra files in place, such as slices past the new run's last one. Each report lists the files that belong to it; read that list, or use a new folder.
- The site watchdog relies on the browser answering. At the default timeouts, a page that never finishes loading is captured after the 30-second navigation timeout, with a warning; the watchdog stops a URL only when its whole capture runs past `--site-timeout`. A browser that stops responding can hold each remaining site until its own watchdog runs out, and those sites are then reported as watchdog stops. A site still running 15 seconds after its watchdog fires gets no per-viewport report, only its line in `captures.json`, so an earlier run's reports in the same folder stay as they were.

## Test

```bash
node tests/smoke.mjs
```

It serves local pages and captures no outside site. The main page contains:

- a sticky header that changes once scrolled;
- a hero built inside a section-level header;
- scroll reveals that hide again;
- a scroll-scrubbed line, plus a hidden notice, a fading dropdown and a translucent line that must all stay as they are;
- slow lazy images and smooth scrolling;
- a consent banner, a chat bubble, a dimmed modal, a fixed background and a scroll lock;
- an overflowing image and a height past the capture cap.

It also serves a Cloudflare-style challenge, a challenge served with status 200, a missing page, a page that never finishes loading, an overlay page with and without a style-src policy, a page that scrolls an inner container, two pages whose body does the scrolling (one of them fixed in place) and a tall plain page. It captures the pages and checks that every preparation step did its job, including with an invalid `--hide` selector. It checks that the challenges and the missing page were flagged and that the watchdog stopped the hanging page. It checks the phone pass's client hints, that captures stay under the cap at high pixel ratios, and that a folder name leading outside the output folder is refused. Then it reads the prepared page's state to confirm what a capture would show; it does not inspect the images' pixels.

The test has passed on Windows 11 with Chrome 157 and Node 26. It has not yet been run on macOS or Linux.

## Licence and contributions

MIT; see `LICENSE`. The public copy of this repository is published read-only and takes no issues or pull requests.
