// What a parsed IRC line means in credits terms.
//
// One line can be worth more than one credit -- a gift sub is both somebody being
// generous and somebody receiving -- so this returns a list. Nothing here holds state:
// deciding *who ends up in the reel* is roster.js's job, and keeping this side pure is
// what makes every message shape testable from a single string.

// Twitch's login for a gift sub given anonymously. There is nobody to thank, so it is
// never credited as a gifter.
const ANON_GIFTER = 'ananonymousgifter';

const TIERS = { Prime: 'Prime', 1000: 'Tier 1', 2000: 'Tier 2', 3000: 'Tier 3' };

function person(login, displayName) {
  return { login: (login || '').toLowerCase(), name: displayName || login || '' };
}

function tierOf(tags) {
  return TIERS[tags['msg-param-sub-plan']] || '';
}

function count(value, fallback = 1) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Credits from one parsed line. `[]` for anything that earns nobody a mention.
 *
 * Each credit is `{ type, login, name, ... }` where type is one of:
 *   raid | unraid | sub | resub | gift | cheer | first
 */
export function toCredits(line) {
  if (!line) return [];
  return line.kind === 'usernotice' ? fromNotice(line) : fromChat(line);
}

function fromChat({ login, displayName, tags }) {
  const out = [];
  const who = person(login, displayName);

  const bits = count(tags.bits, 0);
  if (bits > 0) out.push({ type: 'cheer', ...who, bits });

  // Twitch flags a first-ever message in the channel for us, so this needs no memory of
  // who has spoken before -- which matters, because this page only ever sees the part
  // of the stream it was loaded for.
  if (tags['first-msg'] === '1') out.push({ type: 'first', ...who });

  return out;
}

function fromNotice({ login, displayName, tags }) {
  const who = person(login, displayName);
  const id = tags['msg-id'];

  switch (id) {
    case 'sub':
      return [{ type: 'sub', ...who, tier: tierOf(tags) }];

    case 'resub':
      return [
        {
          type: 'resub',
          ...who,
          tier: tierOf(tags),
          months: count(tags['msg-param-cumulative-months'], 0),
        },
      ];

    // Somebody continuing a sub that was gifted to them. They chose to keep paying, so
    // they are a subscriber, not a gift recipient.
    case 'giftpaidupgrade':
    case 'anongiftpaidupgrade':
      return [{ type: 'sub', ...who, tier: tierOf(tags) }];

    case 'subgift':
    case 'anonsubgift': {
      const to = person(
        tags['msg-param-recipient-user-name'],
        tags['msg-param-recipient-display-name'],
      );
      const out = to.login ? [{ type: 'sub', ...to, tier: tierOf(tags), gifted: true }] : [];
      // An anonymous gifter is credited to nobody, but the recipient still counts.
      if (id === 'subgift' && who.login && who.login !== ANON_GIFTER) {
        out.unshift({ type: 'gift', ...who, gifts: 1 });
      }
      return out;
    }

    // A community gift bomb: one notice for the whole batch, then one `subgift` per
    // recipient. Only the batch carries the real number, so the gifter is credited
    // here and the per-recipient lines are deduped in roster.js -- see `mystery`.
    case 'submysterygift': {
      if (!who.login || who.login === ANON_GIFTER) return [];
      const gifts = count(tags['msg-param-mass-gift-count'], 1);
      return [{ type: 'gift', ...who, gifts, mystery: true }];
    }

    case 'raid':
      return [
        {
          type: 'raid',
          ...person(tags['msg-param-login'] || login, tags['msg-param-displayName'] || displayName),
          viewers: count(tags['msg-param-viewerCount'], 0),
        },
      ];

    // The raid was called off before it landed. Nobody arrived, so nobody is thanked.
    case 'unraid':
      return [{ type: 'unraid', ...person(tags['msg-param-login'] || login, displayName) }];

    // Announcements, rituals, bits badges, watch streaks: real notices, but not
    // somebody doing something for the channel.
    default:
      return [];
  }
}

export { ANON_GIFTER, TIERS };
