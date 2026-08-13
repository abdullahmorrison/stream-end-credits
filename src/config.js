// Every setting lives in the overlay URL, so the streamer never edits a file and you
// can retune by changing the Browser Source URL.

// How long the reel scrolls, in pixels per second. Held to a range that stays readable:
// too slow and the credits outlast the ending scene, too fast and nobody reads a name.
const MIN_SPEED = 20;
const MAX_SPEED = 400;

// Fixed-runtime override, when `duration` is given instead of `speed`.
const MIN_DURATION = 5;
const MAX_DURATION = 900;

// How long a collected roster stays valid. This is the backstop for a stream where the
// OBS streaming-started event never arrived -- without it, last week's names would roll.
const MIN_SESSION_HOURS = 1;
const MAX_SESSION_HOURS = 48;

const DEFAULTS = {
  channel: '',
  title: 'Thank you for watching',
  // Scroll pace. `duration` overrides this when set, computed from measured height.
  speed: 90,
  duration: 0,
  columns: 3,
  // Everyone who said something for the first time. Off by default: on a big channel
  // this category is longer than all the others put together.
  firsts: false,
  sessionHours: 12,
  // Dim behind the credits, 0 = fully transparent. The overlay sits on an ending scene
  // that usually has something behind it already.
  backdrop: 0,
  debug: false,
  demo: false,
};

function int(value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function float(value, fallback, min, max) {
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function flag(value) {
  return value === 'on' || value === '1' || value === 'true';
}

/**
 * A channel name as Twitch wants it: no leading #, lowercase, no stray spaces. Typed
 * into the setup page, pasted into a URL or read back out of one, it must come out the
 * same either way or a link will quietly point at a channel that does not exist --
 * Twitch accepts a JOIN to a channel that does not exist, so nothing ever errors.
 *
 * It is also the localStorage key for the collected roster, which is the other reason
 * it can only be normalized in one place: two spellings would be two rosters, and the
 * credits would roll with half the stream missing.
 */
export function normalizeChannel(value) {
  return (value || '').trim().replace(/^#/, '').toLowerCase();
}

/** Scroll pace from any source, clamped to the one range they all share. */
export function clampSpeed(value, fallback = DEFAULTS.speed) {
  return int(value, fallback, MIN_SPEED, MAX_SPEED);
}

/** A fixed runtime in seconds. 0 means "no override, use the speed". */
export function clampDuration(value, fallback = DEFAULTS.duration) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_DURATION, Math.max(MIN_DURATION, n));
}

export function clampSessionHours(value, fallback = DEFAULTS.sessionHours) {
  return int(value, fallback, MIN_SESSION_HOURS, MAX_SESSION_HOURS);
}

export function readConfig(search = '') {
  const q = new URLSearchParams(search);

  return {
    ...DEFAULTS,
    channel: normalizeChannel(q.get('channel')),
    title: (q.get('title') ?? DEFAULTS.title).trim(),
    speed: clampSpeed(q.get('speed')),
    duration: clampDuration(q.get('duration')),
    columns: int(q.get('columns'), DEFAULTS.columns, 1, 6),
    firsts: flag(q.get('firsts')),
    sessionHours: clampSessionHours(q.get('sessionHours')),
    backdrop: float(q.get('backdrop'), DEFAULTS.backdrop, 0, 1),
    debug: flag(q.get('debug')),
    // Rolls a fake roster, so the reel can be watched in OBS without a stream's worth
    // of real events behind it.
    demo: flag(q.get('demo')),
  };
}

export {
  DEFAULTS,
  MIN_SPEED,
  MAX_SPEED,
  MIN_DURATION,
  MAX_DURATION,
  MIN_SESSION_HOURS,
  MAX_SESSION_HOURS,
};
