# stream-end-credits

Film-style end credits for a Twitch stream: the overlay reads chat all stream, collects
everyone who subbed, gifted, raided or cheered, and rolls them when OBS switches to the
ending scene. Static site, no backend, no build step, no dependencies — the files in this
repo *are* the deployed site, served by GitHub Pages from `main`. A push goes live; a
loaded browser source keeps its old copy until it is refreshed, and each `src/*.js`
module is cached separately, so HTML and JS can drift out of step after an update.

Sibling to `../tomatod`, which shares the IRC layer's design and most of its lessons.

## Commands

```
node serve.js   # http://localhost:4748  (4747 is tomatod)
npm test        # node --test, no dependencies, no config
```

## The two things that make this different from a normal overlay

**It has to be running before it is needed.** The credits are only as good as what was
collected, and collection only happens while the page is loaded. That is why
"Shutdown source when not visible" being unticked is the single loudest instruction in
the README and the setup page, and why the roster is persisted to `localStorage` — a
refresh or an OBS restart two hours in must not empty it. When a roll finds nothing and
the session is under a minute old, it says so on screen instead of scrolling a blank
reel past the viewer.

**Nothing is typed in chat.** The trigger is `obsSourceActiveChanged`. There are no
commands, no permission checks and no allow-list — deliberately, so do not add one
without asking. `nextAction` in `src/obs.js` is the whole decision, kept as a pure
function away from the listeners because "credits restarted from the top halfway
through" is not a crash and not visible in any log.

## Tests: keep them narrow

Four files, all deliberately cheap:

- `test/events.test.mjs` — real IRC lines in, credits out
- `test/roster.test.mjs` — dedupe, gift bombs, sections, session persistence
- `test/trigger.test.mjs` — `nextAction`
- `test/config.test.mjs` — URL settings, clamps, normalization

**Do not add tests that stub the browser.** tomatod had a suite covering its renderer,
state machine and reconnect logic and deleted it: it needed stub canvases, a fake clock
and polling helpers, it never caught a bug, and every failure that project hit in
production was invisible to it. The same applies here, more so — the scroll is a
`transform` and a measured height, and nothing worth knowing about it survives a stub.

Real failures here are OBS and CEF problems: an event name that changed between
versions, a source suspended so rAF stops delivering, `localStorage` blocked, the mask
compositing badly during the roll. Use `debug=on` and the real app.

The rule: add a test when the failure would be silent and user-facing. The gift-bomb
double-count is the archetype — the credits still roll, they are just wrong, and nobody
finds out until it is on stream.

## CI rolls the credits and shows you

`tools/capture-demo.mjs` opens `credits.html?demo=on` in headless Chromium, photographs
the whole reel and the roll itself, and `.github/workflows/demo.yml` pastes both into the
pull request. It covers the half of this project the tests deliberately do not: whether
the thing is *readable*, whether a section fell into one lonely column, whether the roll
now takes four minutes.

This is not the browser suite CLAUDE.md tells you not to write, and it must not become
one. It stubs nothing -- it runs the deployed files -- and it asserts nothing except that
the page did not throw. Its output is pictures for a person to look at. Adding expected
heights or golden images would rebuild exactly the suite tomatod deleted, one assertion
at a time.

Two things about it are load-bearing:

- The clock is faked **and paused** (`clock.install` then `clock.pauseAt`). Installed but
  unpaused, the clock keeps ticking with real time, so the seconds each screenshot spends
  being encoded go into the roll as well -- and on a slow runner the reel walks off the
  top of the frame and CI cheerfully publishes an animation of an empty screen.
- The animation is an APNG, assembled in `tools/apng.mjs` from the frames Playwright
  already produced. The ffmpeg Playwright ships has no gif encoder, so a gif means
  installing one on every run.
- Frame count is a readability decision with a byte budget attached, not a knob. A
  vertical scroll changes nearly every pixel, so nothing saves bytes per frame except
  fewer colours -- which is why `tools/palette.mjs` indexes the frames to the ~200 the
  reel actually uses, and why the animation can be 360 frames instead of 72. Too few and
  the reel lurches; past ~4MB GitHub's image proxy stops serving it at all.

## Settings live in the URL

Every setting is a query param on the browser-source URL, parsed in `src/config.js`, so
the streamer never edits a file. `normalizeChannel` is shared on purpose: the channel is
both the JOIN target and the `localStorage` key, so two spellings would be two rosters
and the credits would roll with half the stream missing. Twitch accepts a JOIN to a
channel that does not exist, so nothing errors either way.

The setup page mirrors the same params into its *own* address bar with `replaceState`, so
the page link is as good as the overlay link — reload it, bookmark it or send it and every
option comes back picked. It already prefilled through `readConfig`, which is what makes
that safe: the page reads exactly what it writes. `tomatod` and `stream-breaking-news` do
the same.

## Layers

```
irc.js      sockets and IRC envelopes; knows nothing about subs
events.js   one line -> credits; pure, no state
roster.js   who ends up in the reel; no timers, no DOM
obs.js      the scene trigger; nextAction is pure
credits.js  the reel; the only file that touches layout
```

Keep that order. The event layer is pluggable so a follow source (EventSub, OAuth) could
be added one day without touching the roster or the roll — that was the reason for
shipping chat-only rather than the shape falling out by accident.
