// Everyone who did something for the channel this stream, and how the reel is grouped.
//
// This holds no timers and touches no DOM: it takes credits in, gives sections out, and
// reads and writes one localStorage key when asked. That is deliberate -- the whole of
// the "who ends up in the credits" logic is the part that fails silently, so it has to
// be testable from Node with nothing stubbed.

const VERSION = 1;
const KEY_PREFIX = 'stream-end-credits';

// Sections in the order they roll. Order is data, not a chain of if-statements, so
// adding a category later is one entry here plus the credit that fills it.
//
// `flag` names the setting that switches a section on, and matches its config key
// exactly so the whole config object can be handed to `sections()`. `on` is what that
// setting defaults to -- kept beside the section rather than only in config.js, so a
// roster used on its own behaves the way the overlay does.
//
// The order is a film's: the audience first, then the people who worked the room.
const SECTIONS = [
  { id: 'raid', title: 'Raided by', pick: (e) => e.viewers > 0, by: 'viewers' },
  { id: 'sub', title: 'New subscribers', pick: (e) => e.sub && !e.months, by: 'name' },
  { id: 'resub', title: 'Resubs', pick: (e) => e.months > 0, by: 'months' },
  { id: 'gift', title: 'Gifted subs', pick: (e) => e.gifts > 0, by: 'gifts' },
  { id: 'cheer', title: 'Cheered', pick: (e) => e.bits > 0, by: 'bits' },
  { id: 'streak', title: 'Watch streaks', pick: (e) => e.streak > 0, by: 'streak', flag: 'streaks', on: true },
  { id: 'first', title: 'First time in chat', pick: (e) => e.first, by: 'name', flag: 'firsts', on: false },
  { id: 'vip', title: 'VIPs', pick: (e) => e.vip, by: 'name', flag: 'vips', on: false },
  { id: 'mod', title: 'Moderated by', pick: (e) => e.mod, by: 'name', flag: 'mods', on: true },
];

const DETAIL = {
  viewers: (e) => `${e.viewers}`,
  gifts: (e) => `×${e.gifts}`,
  bits: (e) => `${e.bits}`,
  months: (e) => `${e.months} mo`,
  streak: (e) => `${e.streak} stream${e.streak === 1 ? '' : 's'}`,
  name: () => '',
};

function blank(login, name) {
  return {
    login,
    name: name || login,
    viewers: 0,
    sub: false,
    months: 0,
    gifts: 0,
    bits: 0,
    streak: 0,
    first: false,
    vip: false,
    mod: false,
  };
}

export class Roster {
  /**
   * @param channel      normalized channel name; also the storage key
   * @param storage      a localStorage-like object, or null for memory only
   * @param sessionHours how old a stored roster may be before it is discarded
   * @param now          clock, injectable so session expiry is testable
   */
  constructor({ channel = '', storage = null, sessionHours = 12, now = () => Date.now() } = {}) {
    this.channel = channel;
    this.storage = storage;
    this.sessionHours = sessionHours;
    this.now = now;
    this.key = `${KEY_PREFIX}:${channel}`;
    this.entries = new Map();
    // Gift-bomb recipients still to arrive, per gifter login. See `add`.
    this.pendingGifts = new Map();
    this.startedAt = this.now();
    this.dirty = false;
  }

  get size() {
    return this.entries.size;
  }

  /** How long this session has been collecting, in ms. */
  age() {
    return this.now() - this.startedAt;
  }

  entry(login, name) {
    let e = this.entries.get(login);
    if (!e) {
      e = blank(login, name);
      this.entries.set(login, e);
    }
    // Display names can change mid-stream, and the later one is the current one.
    if (name) e.name = name;
    return e;
  }

  /** Fold one credit in. Unknown types are ignored rather than throwing. */
  add(credit) {
    if (!credit || !credit.login) return;
    const { type, login, name } = credit;

    if (type === 'unraid') {
      const e = this.entries.get(login);
      if (e) e.viewers = 0;
      this.dirty = true;
      return;
    }

    // A community gift bomb announces itself once with the real total, then Twitch
    // sends one ordinary `subgift` per recipient from the same login. Counting both
    // would show a gifter as having given twice what they did, with nothing to
    // indicate it went wrong. The batch is authoritative; the follow-ups only exist
    // here to credit their recipients.
    if (type === 'gift' && !credit.mystery && this.pendingGifts.get(login) > 0) {
      this.pendingGifts.set(login, this.pendingGifts.get(login) - 1);
      return;
    }

    const e = this.entry(login, name);
    switch (type) {
      case 'raid':
        // Raided twice in one stream: keep the bigger number rather than the later one.
        e.viewers = Math.max(e.viewers, credit.viewers || 0);
        break;
      case 'sub':
        e.sub = true;
        break;
      case 'resub':
        e.sub = true;
        e.months = Math.max(e.months, credit.months || 0);
        break;
      case 'gift':
        e.gifts += credit.gifts || 1;
        if (credit.mystery) {
          this.pendingGifts.set(login, (this.pendingGifts.get(login) || 0) + (credit.gifts || 1));
        }
        break;
      case 'cheer':
        e.bits += credit.bits || 0;
        break;
      case 'streak':
        // Twitch sends the milestone once, but a reconnect can replay it. Keeping the
        // larger number means a re-delivered older milestone cannot walk it backwards.
        e.streak = Math.max(e.streak, credit.streak || 0);
        break;
      case 'first':
        e.first = true;
        break;
      case 'vip':
        e.vip = true;
        break;
      case 'mod':
        e.mod = true;
        break;
      default:
        return;
    }
    this.dirty = true;
  }

  /**
   * The reel, grouped and sorted. Empty sections are dropped entirely: a stream with no
   * raids should show no "Raided by" heading rather than a heading over nothing.
   */
  sections(show = {}) {
    const all = [...this.entries.values()];
    const out = [];

    for (const section of SECTIONS) {
      // `?? section.on` rather than a plain lookup: a caller who passes nothing, or who
      // passes only some of the switches, gets each section's own default instead of
      // silently turning off the ones that ship on.
      if (section.flag && !(show[section.flag] ?? section.on)) continue;
      const picked = all.filter(section.pick);
      if (!picked.length) continue;

      const detail = DETAIL[section.by];
      picked.sort(
        section.by === 'name'
          ? (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
          : // Biggest first, then alphabetical so ties are stable between rolls rather
            // than reordering on every replay.
            (a, b) =>
              b[section.by] - a[section.by] ||
              a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      );

      out.push({
        id: section.id,
        title: section.title,
        names: picked.map((e) => ({ name: e.name, detail: detail(e) })),
      });
    }

    return out;
  }

  reset() {
    this.entries.clear();
    this.pendingGifts.clear();
    this.startedAt = this.now();
    this.dirty = true;
    this.flush();
  }

  toJSON() {
    return { v: VERSION, startedAt: this.startedAt, entries: [...this.entries.values()] };
  }

  /**
   * Write to storage. Called on a slow interval rather than per credit -- a gift bomb
   * or a raid arrives as a burst, and serializing the whole roster for each line of it
   * is work done in the middle of a live stream for no reason.
   */
  flush() {
    this.dirty = false;
    if (!this.storage || !this.channel) return;
    try {
      this.storage.setItem(this.key, JSON.stringify(this.toJSON()));
    } catch {
      // Storage full or blocked. Collecting in memory still works for this session, and
      // a failed write must never take the overlay down mid-stream.
    }
  }

  /**
   * Restore a session in progress. This is what makes a browser-source refresh, a cache
   * clear or an OBS restart survivable -- without it, one refresh two hours in silently
   * empties the credits and nothing says so until they roll.
   *
   * Returns true if a session was restored.
   */
  load() {
    if (!this.storage || !this.channel) return false;
    let saved;
    try {
      saved = JSON.parse(this.storage.getItem(this.key) || 'null');
    } catch {
      return false;
    }
    if (!saved || saved.v !== VERSION || !Array.isArray(saved.entries)) return false;

    // Yesterday's roster must not roll today. The OBS streaming-started event resets
    // this properly; the age check is the backstop for when it never arrives.
    const age = this.now() - (saved.startedAt || 0);
    if (!(age >= 0) || age > this.sessionHours * 3600000) return false;

    this.startedAt = saved.startedAt;
    this.entries = new Map(saved.entries.map((e) => [e.login, { ...blank(e.login), ...e }]));
    // Deliberately not restored: a half-delivered gift bomb across a page reload is not
    // worth carrying, and a stale pending count would silently swallow real gifts.
    this.pendingGifts.clear();
    return true;
  }
}

export { SECTIONS, KEY_PREFIX, VERSION };
