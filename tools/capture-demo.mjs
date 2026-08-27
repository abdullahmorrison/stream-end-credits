// Photographs the demo reel in a real headless Chromium, so a change to the credits can
// be looked at instead of imagined.
//
// This is not a test and it asserts nothing -- CLAUDE.md is explicit that stubbing the
// browser here catches nothing worth catching. It runs the actual deployed files in an
// actual browser and writes out what they render, which is the one thing a reviewer
// cannot get from a diff of `credits.html`.
//
//   node tools/capture-demo.mjs            -> demo-out/
//
// Time is faked (Playwright's clock) *and paused*, so the roll advances by exact amounts
// rather than by however long the runner took to get around to it: every frame is the
// same moment of the roll on a laptop and on a cold CI box. Text lands on a fraction of a
// pixel, so the bytes are not identical run to run -- these are pictures to look at, not
// golden images to diff.
//
// The pause is the part that is easy to miss. `clock.install` on its own still lets the
// clock tick along with real time, so the seconds each screenshot spends being encoded
// go into the roll as well as the seconds asked for -- which on a slow runner walks the
// reel off the top of the frame and quietly returns an animation of an empty screen.

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { readConfig } from '../src/config.js';
import { writeApng } from './apng.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.DEMO_OUT || 'demo-out');
const PORT = Number(process.env.DEMO_PORT) || 4749;
const BASE = `http://127.0.0.1:${PORT}`;

// A made-up channel: the title card prints it, and a real name in a committed image is a
// name that turns up in search results for someone who never asked to be in this repo.
const CHANNEL = 'yourchannel';

// What gets photographed. The point is coverage of the layout decisions -- column count,
// alignment, which sections are on -- because those are what a change to the reel breaks.
const VARIANTS = [
  {
    id: 'default',
    label: 'Default settings',
    params: {},
  },
  {
    id: 'everything',
    label: 'Two columns, left aligned, every section on',
    params: { columns: '2', align: 'left', vips: 'on', firsts: 'on' },
  },
];

// The overlay is 1920x1080 in OBS, and every size in the reel is in `vh`, so the numbers
// below only mean anything at the size the streamer actually runs.
const STILL = { width: 1920, height: 1080 };
// The roll is captured small: the layout is identical at any viewport (it is all `vh`
// and `vw`), and a 1920-wide animation is megabytes nobody loads.
const MOTION = { width: 640, height: 360 };
// The reel sweeps a fixed distance past the frame, so the frame count is really a choice
// about how far it jumps between frames -- 909px over 72 frames is a 13px lurch, which
// reads as a slideshow of a scroll rather than a scroll. Halving the step and doubling the
// rate keeps the animation the same six seconds and makes it move.
//
// Upwards from here is bounded by bytes, not by taste: the frames are full-frame RGB (a
// vertical scroll changes nearly every pixel, so nothing about APNG's per-frame deltas
// helps) and cost ~30KB each whatever they contain. 144 lands around 4MB, and GitHub's
// image proxy stops fetching a few megabytes above that -- an animation it refuses to
// serve is worse than a slightly steppy one.
const FRAMES = 144;
const FPS = 24;
// The reel starts fully below the frame and ends fully above it, and the stage fades its
// top and bottom out, so a roll opens and closes on an empty screen with a dim band
// either side of the part worth watching. The animation is trimmed to run from the title
// card to the end card, placed where the mask is not eating them -- as a fraction of the
// viewport, because the animation is captured at a smaller size than the overlay runs at.
// The first frame matters twice over: it is the still a reader gets if the animation does
// not play at all.
const OPENS_AT = 0.62;
const CLOSES_AT = 0.4;
// Stand-in for the ending scene OBS puts behind the overlay. The overlay itself is
// transparent, and white credits on a white page are no demo at all.
const SCENE = '#141118';

function url({ params = {} }, extra = {}) {
  const q = new URLSearchParams({ channel: CHANNEL, demo: 'on', ...params, ...extra });
  return { href: `${BASE}/credits.html?${q}`, search: `?${q}` };
}

/** The dev server, started the same way a person would start it. */
async function serve() {
  const child = spawn(process.execPath, [path.join(ROOT, 'serve.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    // Its two startup lines are not wanted here; a crash still comes through stderr.
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`${BASE}/credits.html`);
      if (res.ok) return child;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  child.kill();
  throw new Error(`dev server never came up on ${BASE}`);
}

// Any fixed moment. Pinned so a `Date` the page reads is the same one every run.
const EPOCH = new Date('2024-01-01T00:00:00Z');

/**
 * Open the overlay with the clock frozen, and let it get as far as starting the roll.
 *
 * Outside OBS the overlay rolls on load after a 300ms timer, so 400ms of fake time is
 * "the credits are now rolling" and nothing else has happened yet.
 */
async function openRolling(context, target) {
  const page = await context.newPage();
  const failures = [];
  page.on('pageerror', (err) => failures.push(String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') failures.push(msg.text());
  });

  await page.clock.install({ time: EPOCH });
  await page.clock.pauseAt(EPOCH);
  await page.goto(target.href, { waitUntil: 'load' });
  await page.clock.runFor(400);
  await page.waitForSelector('.reel');

  return { page, failures };
}

/** Height, sections and the runtime that height implies -- the numbers a diff hides. */
async function measure(page, target) {
  const dom = await page.evaluate(() => {
    const reel = document.querySelector('.reel');
    const stage = document.getElementById('stage');
    return {
      reelHeight: reel.offsetHeight,
      viewport: stage.clientHeight,
      columns: [...reel.querySelectorAll('.names')].map((l) =>
        Number(getComputedStyle(l).columnCount) || 0,
      ),
      sections: [...reel.querySelectorAll('.section')].map((s) => ({
        title: s.querySelector('h2').textContent,
        names: s.querySelectorAll('li').length,
      })),
    };
  });

  // Same arithmetic the reel does: it starts fully below the frame and ends fully above
  // it, and a `duration` is a speed once the height is known. Reading it through
  // `readConfig` rather than hardcoding 90 means a changed default shows up here as a
  // changed runtime.
  const config = readConfig(target.search);
  const distance = dom.viewport + dom.reelHeight;
  const speed = config.duration ? distance / config.duration : config.speed;

  return {
    ...dom,
    speed,
    distance,
    seconds: Number((distance / speed).toFixed(1)),
    names: dom.sections.reduce((n, s) => n + s.names, 0),
  };
}

/**
 * The whole reel in one image.
 *
 * The stage clips to the viewport and fades its edges out with a mask, which is right on
 * stream and useless in a still -- so both are undone here, in the page, for the
 * photograph only. Nothing in `src/` knows this happens.
 */
async function still(page, file) {
  await page.evaluate(() => {
    const stage = document.getElementById('stage');
    const reel = document.querySelector('.reel');

    stage.style.position = 'static';
    stage.style.overflow = 'visible';
    stage.style.maskImage = 'none';
    stage.style.webkitMaskImage = 'none';
    reel.style.position = 'static';
    reel.style.transform = 'none';
    // The overlay is transparent because OBS puts a scene behind it. A transparent PNG is
    // white text on whatever the reader's page is, so the still gets the ending-scene
    // colour the backdrop param uses.
    document.body.style.background = '#0b0a0f';
    document.documentElement.style.overflow = 'visible';
    for (const el of document.querySelectorAll('.status')) el.remove();
  });

  await page.locator('.reel').screenshot({ path: file });
}

/**
 * Frames from the title card to the end card, evenly spaced in the reel's own time.
 *
 * The clock is stepped by the distance the reel has to travel rather than by a share of
 * the runtime, so the sweep lands on the same two cards whatever the roster does to the
 * length in between.
 */
async function frames(page, speed, dir) {
  await fs.mkdir(dir, { recursive: true });
  await page.evaluate((scene) => {
    document.body.style.background = scene;
    for (const el of document.querySelectorAll('.status')) el.remove();
  }, SCENE);

  const geometry = await page.evaluate(() => {
    const reel = document.querySelector('.reel');
    const stage = document.getElementById('stage');
    const top = reel.getBoundingClientRect().top;
    // Where a card's middle sits inside the reel, so it can be parked at a given height
    // on screen. Falls back to the whole card, since `title` can be set to nothing.
    const middle = (selector, fallback) => {
      const box = (reel.querySelector(selector) || fallback).getBoundingClientRect();
      return box.top - top + box.height / 2;
    };
    const cards = reel.querySelectorAll('.card');
    return {
      y: top,
      viewport: stage.clientHeight,
      opens: middle('.card-title h1', cards[0]),
      closes: middle('.card-end p', cards[cards.length - 1]),
    };
  });

  const from = OPENS_AT * geometry.viewport - geometry.opens;
  const to = CLOSES_AT * geometry.viewport - geometry.closes;
  const ms = (distance) => Math.round((distance / speed) * 1000);

  await page.clock.runFor(ms(geometry.y - from));

  const step = ms(from - to) / FRAMES;
  const files = [];

  for (let i = 0; i < FRAMES; i++) {
    const file = path.join(dir, `${String(i).padStart(4, '0')}.png`);
    await page.screenshot({ path: file });
    files.push(file);
    await page.clock.runFor(Math.round(step));
  }

  return files;
}

async function main() {
  await fs.rm(OUT, { recursive: true, force: true });
  await fs.mkdir(OUT, { recursive: true });

  const server = await serve();
  const browser = await chromium.launch();
  const report = { variants: [], roll: null, errors: [] };

  try {
    const stills = await browser.newContext({ viewport: STILL, deviceScaleFactor: 1 });
    for (const variant of VARIANTS) {
      const target = url(variant);
      const { page, failures } = await openRolling(stills, target);
      const metrics = await measure(page, target);
      const file = `reel-${variant.id}.png`;
      await still(page, path.join(OUT, file));
      await page.close();

      report.errors.push(...failures);
      report.variants.push({ ...variant, ...metrics, file, url: target.search });
      console.log(`${variant.id}: ${metrics.names} names, ${metrics.reelHeight}px, ${metrics.seconds}s -> ${file}`);
    }
    await stills.close();

    const motion = await browser.newContext({ viewport: MOTION, deviceScaleFactor: 1 });
    const target = url(VARIANTS[0]);
    const { page, failures } = await openRolling(motion, target);
    const rolling = await measure(page, target);
    const dir = path.join(OUT, 'frames');
    const files = await frames(page, rolling.speed, dir);
    await page.close();
    await motion.close();
    report.errors.push(...failures);

    const file = 'roll.png';
    const apng = await writeApng(files, path.join(OUT, file), { delay: { num: 1, den: FPS } });
    // The frames are an intermediate, not an output -- but they are the only way to see
    // which frame a bad-looking animation went wrong on, so they can be kept.
    if (!process.env.DEMO_KEEP_FRAMES) await fs.rm(dir, { recursive: true, force: true });
    report.roll = { file, fps: FPS, ...apng, seconds: report.variants[0].seconds };
    console.log(`roll: ${apng.frames} frames of a ${report.roll.seconds}s roll -> ${file}`);
  } finally {
    await browser.close();
    server.kill();
  }

  await fs.writeFile(path.join(OUT, 'demo.json'), `${JSON.stringify(report, null, 2)}\n`);

  if (report.errors.length) {
    // The overlay throwing while it rolls is the failure this whole thing exists to
    // catch, so it is an exit code and not a line in the log.
    console.error('\npage errors during capture:');
    for (const e of report.errors) console.error(`  ${e}`);
    process.exitCode = 1;
  }
}

await main();
