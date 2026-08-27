// What a parsed IRC line means in credits terms.
//
// One line can be worth more than one credit -- a gift sub is both somebody being
// generous and somebody receiving -- so this returns a list. Nothing here holds state:
// deciding *who ends up in the reel* is roster.js's job, and keeping this side pure is
// what makes every message shape testable from a single string.

import { toDonation, DONATION_BOTS } from './donations.js';

// Twitch's login for a gift sub given anonymously. There is nobody to thank, so it is
// never credited as a gifter.
const ANON_GIFTER = 'ananonymousgifter';

// Chat bots that are almost always modded. Crediting Nightbot under "Moderated by",
// above the humans who actually did the work, is the kind of thing that looks broken
// on stream and errors nowhere. Only applied to the badge-derived sections: a bot does
// not sub, raid or cheer, so nothing else needs the guard.
const BOTS = new Set([
  'nightbot',
  'streamelements',
  'streamlabs',
  'moobot',
  'fossabot',
  'wizebot',
  'sery_bot',
  'botrixoficial',
  'own3d',
  'commanderroot',
  'streamstickers',
  'creatisbot',
  'phantombot',
  'deepbot',
  'ankhbot',
]);

/**
 * A chat bot rather than a person, for the badge-derived sections. Donation bots count:
 * a streamer's own announcement relay is usually modded, and `donationBots` is where its
 * login was already given.
 */
function isBot(login, donationBots = []) {
  return BOTS.has(login) || DONATION_BOTS.has(login) || donationBots.includes(login);
}

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
 * The badge names on a line, without their versions: `moderator/1,subscriber/12` is
 * `{moderator, subscriber}`. The version is the badge's tier or month count and none of
 * the sections here care which one somebody is wearing.
 */
function parseBadges(value) {
  const out = new Set();
  for (const part of (value || '').split(',')) {
    const name = part.split('/')[0].trim();
    if (name) out.add(name);
  }
  return out;
}

/**
 * Credits from one parsed line. `[]` for anything that earns nobody a mention.
 *
 * Each credit is `{ type, login, name, ... }` where type is one of:
 *   raid | unraid | sub | resub | gift | cheer | tip | charity | streak | first | vip | mod
 *
 * `donationBots` are extra bot logins whose announcements are read as donations, on top
 * of the services donations.js already knows.
 */
export function toCredits(line, { donationBots = [] } = {}) {
  if (!line) return [];
  return line.kind === 'usernotice' ? fromNotice(line) : fromChat(line, donationBots);
}

function fromChat({ login, displayName, tags, text }, donationBots = []) {
  const out = [];
  const who = person(login, displayName);

  // Donations are the one credit that comes out of a message body rather than a tag,
  // because Twitch has no event for money that did not go through Twitch. The credit
  // goes to the donor named in the announcement, never to the bot that posted it.
  const donation = toDonation(who.login, text, donationBots);
  if (donation) out.push(donation);

  const bits = count(tags.bits, 0);
  if (bits > 0) out.push({ type: 'cheer', ...who, bits });

  // Mods and VIPs are read off the badges on an ordinary message rather than from an
  // event, because Twitch never announces either one -- there is no "became a mod" line
  // to listen for. The cost is that this only ever sees somebody who *spoke*: a mod who
  // lurked all stream is invisible here, and the setup page says so.
  //
  // Only PRIVMSG. A USERNOTICE carries badges too, but whose they are depends on the
  // msg-id -- the gifter on a subgift, the raider on a raid -- and stapling a crew
  // credit onto that is where a quiet mis-credit would come from.
  const badges = parseBadges(tags.badges);
  // Nobody is a guest at their own stream, and the broadcaster's badge always outranks
  // the moderator one they implicitly hold.
  if (!badges.has('broadcaster') && who.login && !isBot(who.login, donationBots)) {
    // Both the badge and the standalone tag are read: the badge is what shows in chat,
    // the tag is what Twitch documents, and they have not always agreed.
    if (badges.has('moderator') || tags.mod === '1') out.push({ type: 'mod', ...who });
    if (badges.has('vip') || tags.vip === '1') out.push({ type: 'vip', ...who });
  }

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

    // Watch streaks: somebody who has turned up for N streams in a row. The streak is
    // earned by watching, but this notice only exists when the viewer *shares* it in
    // chat -- a tap they take, once per stream, and only if the channel has the feature
    // on. So this section is the people who chose to say so, not everyone with a
    // streak, and there is no way to see the rest without a login.
    case 'viewermilestone': {
      // `watch-streak` is the only category Twitch defines today. A new one would mean
      // something else entirely, so it is ignored rather than filed under streaks.
      if (tags['msg-param-category'] !== 'watch-streak') return [];
      const streak = count(tags['msg-param-value'], 0);
      return streak > 0 ? [{ type: 'streak', ...who, streak }] : [];
    }

    // Announcements, rituals, bits badges, shared-chat notices: real notices, but not
    // somebody doing something for the channel.
    default:
      return [];
  }
}

export { ANON_GIFTER, TIERS, BOTS, parseBadges, isBot };
