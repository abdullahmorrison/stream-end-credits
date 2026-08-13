// The setup page: turns a channel name into a Browser Source URL, and previews the reel
// so nobody has to end a stream to find out what it looks like.
//
// The preview is an iframe pointing at the real overlay in demo mode, not a copy of it.
// The reel is sized in viewport units, and an iframe has its own viewport -- so a 16:9
// box here shows exactly what a 1920×1080 source will, and there is no second rendering
// path to keep in step with the first.

import { DEFAULTS, normalizeChannel, clampSpeed } from './config.js';
import { TwitchChat } from './irc.js';

const $ = (id) => document.getElementById(id);

const channelEl = $('channel');
const titleEl = $('title');
const speedEl = $('speed');
const columnsEl = $('columns');
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
    backdrop: parseFloat(backdropEl.value),
    firsts: firstsEl.checked,
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
  if (s.backdrop !== DEFAULTS.backdrop) url.searchParams.set('backdrop', String(s.backdrop));
  if (s.firsts) url.searchParams.set('firsts', 'on');

  for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
  return url.toString();
}

function refresh() {
  linkEl.value = overlayUrl();
}

function replay() {
  // Demo mode fills a roster with made-up names, and no channel is set, so the preview
  // never opens a chat connection of its own.
  const url = new URL(overlayUrl({ demo: 'on' }));
  url.searchParams.delete('channel');
  previewEl.src = url.toString();
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
for (const el of [speedEl, columnsEl, backdropEl, firstsEl]) {
  el.addEventListener('change', () => {
    refresh();
    replay();
  });
}
for (const el of [channelEl, titleEl]) {
  el.addEventListener('input', refresh);
}
titleEl.addEventListener('change', replay);
channelEl.addEventListener('change', checkChannel);

// This page takes the same `channel` param as the overlay, so it can be handed to a
// streamer with their name already in the box -- setting it up for someone else is
// otherwise a spelling test they have to pass before anything works.
const named = normalizeChannel(new URLSearchParams(window.location.search).get('channel'));
if (named) channelEl.value = named;

titleEl.value = DEFAULTS.title;
refresh();
replay();
checkChannel();
