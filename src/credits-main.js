import { readConfig } from './config.js';
import { TwitchChat } from './irc.js';
import { toCredits } from './events.js';
import { Roster } from './roster.js';
import { CreditsReel } from './credits.js';
import { ObsBridge, nextAction, inOBS } from './obs.js';
import { demoCredits, fakeCredit } from './demo.js';

const config = readConfig(window.location.search);

const stage = document.getElementById('stage');
stage.style.setProperty('--backdrop', config.backdrop);

const roster = new Roster({
  channel: config.channel,
  // Demo mode never touches storage. The made-up names would otherwise be written into
  // the real roster for this channel and roll for real at the end of the next stream.
  storage: config.demo ? null : window.localStorage,
  sessionHours: config.sessionHours,
});
const restored = roster.load();

const reel = new CreditsReel({ root: stage, config });

// Storage is written on a slow tick rather than per credit: a raid or a gift bomb
// arrives as a burst, and serializing the whole roster for each line of it is work done
// in the middle of a live stream for nothing.
setInterval(() => {
  if (roster.dirty) roster.flush();
}, 2000);

// --- status toast ---------------------------------------------------------
// Visible only for the first few seconds so setup can be confirmed, then gone for good.
// It must never appear on stream once things are running.

const statusEl = document.getElementById('status');
let statusLocked = false;
let credited = 0;

function setStatus(text, sticky = false) {
  if (statusLocked && !sticky) return;
  statusEl.hidden = false;
  statusEl.textContent = text;
}

if (config.demo) {
  // A demo has made-up names and reads no chat, so there is nothing to confirm and
  // nothing that can be misconfigured. Warning about a channel here would be warning
  // about something the demo does not use -- which is what it did, right on top of the
  // setup page's preview.
  statusLocked = true;
} else if (!config.channel) {
  setStatus('No channel set. Add ?channel=yourname to the URL.', true);
  statusLocked = true;
} else {
  setStatus(`Connecting to #${config.channel}…`);
  setTimeout(() => {
    if (statusLocked) return;
    statusLocked = true;
    statusEl.style.opacity = '0';
    setTimeout(() => { statusEl.hidden = true; }, 600);
  }, 10000);
}

// --- collecting -----------------------------------------------------------

// Demo mode never connects, whatever channel it was given. That is what lets the preview
// keep the channel in its URL -- so the title card shows the real name -- without every
// keystroke in the channel box opening a socket.
if (config.channel && !config.demo) {
  const chat = new TwitchChat(config.channel);

  chat.addEventListener('status', (e) => {
    if (e.detail === 'connected') {
      setStatus(
        restored
          ? `Reading #${config.channel}. ${roster.size} people collected so far.`
          : `Reading #${config.channel}. Collecting from now until the credits roll.`,
      );
    } else if (e.detail === 'reconnecting') {
      setStatus('Reconnecting…');
    }
  });

  chat.addEventListener('line', (e) => {
    // The bot list rides along: a donation is the one credit that has to be recognised
    // from a message body, and which logins to trust with that is a setting.
    for (const credit of toCredits(e.detail, { donationBots: config.donationBots })) {
      roster.add(credit);
      credited++;
    }
  });

  chat.connect();
}

if (config.demo) for (const credit of demoCredits()) roster.add(credit);

// --- rolling --------------------------------------------------------------

// A roster with nothing in it after only a moment of collecting means the page just
// started, which almost always means the source is set to shut down when its scene is
// hidden -- so it was not running for any of the stream it is meant to be thanking.
const JUST_STARTED = 60000;

function start() {
  // The config *is* the set of switches: every section's `flag` in roster.js is named
  // after its config key, so there is no mapping here to fall out of step.
  const sections = roster.sections(config);
  const note = sections.length
    ? ''
    : roster.age() < JUST_STARTED
      ? 'Nothing collected yet — this source has only just started. It has to stay ' +
        'loaded all stream: open its properties and uncheck “Shutdown source when not ' +
        'visible”.'
      : 'A quiet one today. Thanks for hanging out.';
  reel.roll(sections, { note });
}

function apply(event) {
  switch (nextAction(reel.state, event)) {
    case 'roll':
      start();
      break;
    case 'stop':
      reel.stop();
      break;
    case 'reset':
      reel.stop();
      roster.reset();
      break;
  }
}

const bridge = new ObsBridge();

if (inOBS()) {
  bridge.start(apply);
  // No roll on load, even though the scene may well be showing right now. OBS only
  // reports the *change*, so there is no way to tell "the ending scene is up" from
  // "some other scene is up" at this point -- and guessing wrong rolls the credits in
  // the middle of the stream. Refreshed the source while on the ending scene? Switch
  // away and back.
} else {
  // A normal browser: nothing will ever tell us about a scene, so roll straight away.
  // This is what makes `node serve.js` and the setup preview work.
  setTimeout(start, 300);
}

// --- debug ----------------------------------------------------------------
// Exercises the whole path with no stream, no scene switch and no chat.

if (config.debug) {
  bridge.trace();

  const panel = document.createElement('div');
  panel.className = 'status';
  panel.style.top = 'auto';
  panel.style.bottom = '20px';
  panel.style.left = '20px';
  panel.style.maxWidth = '60vw';
  document.body.appendChild(panel);

  let fakes = 0;

  const refresh = () => {
    const mins = Math.round(roster.age() / 60000);
    const sections = roster
      .sections(config)
      .map((s) => `${s.id}:${s.names.length}`)
      .join(' ');
    panel.textContent =
      `${reel.state} · people: ${roster.size} · credits: ${credited}` +
      ` · session: ${mins}m${restored ? ' (restored)' : ''}` +
      ` · obs: ${inOBS() ? bridge.lastEventName || 'waiting' : 'not in OBS'}` +
      ` · ${sections || 'empty'}` +
      ' · [R] roll  [C] stop  [F] fake credit  [X] reset';
  };
  refresh();
  setInterval(refresh, 250);

  window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (key === 'r') start();
    if (key === 'c') reel.stop();
    if (key === 'f') roster.add(fakeCredit(fakes++));
    if (key === 'x') {
      reel.stop();
      roster.reset();
    }
  });
}
