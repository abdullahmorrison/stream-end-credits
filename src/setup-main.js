// The setup page: turns a channel name into a Browser Source URL, and previews the reel
// so nobody has to end a stream to find out what it looks like.
//
// The preview is an iframe pointing at the real overlay in demo mode, not a copy of it.
// The reel is sized in viewport units, and an iframe has its own viewport -- so a 16:9
// box here shows exactly what a 1920×1080 source will, and there is no second rendering
// path to keep in step with the first.

import { DEFAULTS, readConfig, normalizeChannel, clampSpeed } from './config.js';
import { TwitchChat } from './irc.js';

const $ = (id) => document.getElementById(id);

const channelEl = $('channel');
const titleEl = $('title');
const speedEl = $('speed');
const columnsEl = $('columns');
const alignEl = $('align');
const backdropEl = $('backdrop');
const firstsEl = $('firsts');
const linkEl = $('link');
const previewEl = $('preview');
const statusEl = $('channelStatus');

// --- link building --------------------------------------------------------

function settings() {
  return {
    channel: normalizeChannel(channelEl.value),
    title: titleEl.value.trim(),
    speed: clampSpeed(speedEl.value),
    columns: parseInt(columnsEl.value, 10),
    align: alignEl.value,
    backdrop: parseFloat(backdropEl.value),
    // A select rather than a checkbox, so it carries the same weight as every other
    // option here. A lone checkbox under a row of dropdowns reads as a footnote and
    // gets scrolled past.
    firsts: firstsEl.value === 'on',
  };
}

/** Only what differs from a default, so the link stays short enough to read. */
function overlayUrl(extra = {}) {
  const s = settings();
  // Resolve against this page so the link works on GitHub Pages and locally alike.
  const url = new URL('credits.html', window.location.href);

  if (s.channel) url.searchParams.set('channel', s.channel);
  // An empty heading is a real choice, so it is only left out when it matches the
  // default -- not whenever it is blank.
  if (s.title !== DEFAULTS.title) url.searchParams.set('title', s.title);
  if (s.speed !== DEFAULTS.speed) url.searchParams.set('speed', String(s.speed));
  if (s.columns !== DEFAULTS.columns) url.searchParams.set('columns', String(s.columns));
  if (s.align !== DEFAULTS.align) url.searchParams.set('align', s.align);
  if (s.backdrop !== DEFAULTS.backdrop) url.searchParams.set('backdrop', String(s.backdrop));
  // Written either way rather than only when on, so the link still says what was picked
  // if this default ever flips.
  if (s.firsts !== DEFAULTS.firsts) url.searchParams.set('firsts', s.firsts ? 'on' : 'off');

  for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
  return url.toString();
}

function refresh() {
  linkEl.value = overlayUrl();
}

function replay() {
  // Demo mode fills a roster with made-up names and never connects to chat, so the
  // channel can stay in the URL: the preview's title card shows the real name, and no
  // socket is opened for it.
  previewEl.src = overlayUrl({ demo: 'on' });
}

$('copy').addEventListener('click', async () => {
  linkEl.select();
  try {
    await navigator.clipboard.writeText(linkEl.value);
  } catch {
    document.execCommand('copy');
  }
  const btn = $('copy');
  btn.textContent = 'Copied';
  setTimeout(() => { btn.textContent = 'Copy link'; }, 1600);
});

$('replay').addEventListener('click', replay);

// --- live channel check ---------------------------------------------------
// Twitch accepts a JOIN to a channel that does not exist, silently. Without this a typo
// would look exactly like a working overlay right up until the credits rolled empty at
// the end of a stream.

let chat = null;
let checkTimer = null;

function checkChannel() {
  if (chat) {
    chat.close();
    chat = null;
  }
  const channel = normalizeChannel(channelEl.value);
  statusEl.className = 'status';

  if (!channel) {
    statusEl.textContent = 'Enter your channel name.';
    return;
  }

  statusEl.textContent = `Checking #${channel}…`;
  let seen = 0;
  chat = new TwitchChat(channel);

  chat.addEventListener('line', () => {
    seen++;
    if (seen === 1) {
      statusEl.className = 'status ok';
      statusEl.textContent = `Reading #${channel} — chat is coming through.`;
    }
  });

  clearTimeout(checkTimer);
  checkTimer = setTimeout(() => {
    if (seen === 0) {
      statusEl.className = 'status warn';
      statusEl.textContent =
        `Connected, but no messages from #${channel} yet. That is normal if chat is ` +
        'quiet — but double-check the spelling if you expected activity.';
    }
  }, 12000);

  chat.connect();
}

// The preview reloads on a look change, but not on every keystroke in the channel box.
for (const el of [speedEl, columnsEl, alignEl, backdropEl, firstsEl]) {
  el.addEventListener('change', () => {
    refresh();
    replay();
  });
}
for (const el of [channelEl, titleEl]) {
  el.addEventListener('input', refresh);
}
titleEl.addEventListener('change', replay);
// On change rather than input: the preview reloads, and doing that per keystroke would
// restart the roll while somebody is still typing their name.
channelEl.addEventListener('change', () => {
  checkChannel();
  replay();
});

// --- prefill -------------------------------------------------------------
//
// This page reads exactly the params the overlay does, through the same parser, so a
// setup link can arrive with every option already chosen. Hand someone
// `?channel=theirs&firsts=on&columns=2` and they land on a page that is already right --
// no instructions to follow, nothing for them to get wrong, and the copy button gives
// them a working overlay link on the first click.
//
// Reusing readConfig rather than reading params here is the point: if the two ever
// disagreed, a link would preview one thing and install another.

/**
 * Pick `value` in a dropdown, adding an option for it when it is not one of the offered
 * ones. A link carrying `speed=115` should survive the round trip rather than silently
 * snapping to whichever preset happens to be nearest.
 */
function selectValue(el, value) {
  const wanted = String(value);
  if (![...el.options].some((o) => o.value === wanted)) {
    el.add(new Option(`${wanted} (from link)`, wanted));
  }
  el.value = wanted;
}

const incoming = readConfig(window.location.search);

if (incoming.channel) channelEl.value = incoming.channel;
titleEl.value = incoming.title;
selectValue(speedEl, incoming.speed);
selectValue(columnsEl, incoming.columns);
selectValue(alignEl, incoming.align);
selectValue(backdropEl, incoming.backdrop);
selectValue(firstsEl, incoming.firsts ? 'on' : 'off');

refresh();
replay();
checkChannel();
