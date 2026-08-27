// One IRC line in, credits out. This is the layer where a wrong tag name costs somebody
// their thank-you and nothing anywhere reports an error, so every message shape the
// overlay reads is pinned to a real line.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLine, parseTags } from '../src/irc.js';
import { toCredits } from '../src/events.js';

const credits = (line, options) => toCredits(parseLine(line), options);

/**
 * A donation bot's announcement, as an ordinary chat message -- which is all a donation
 * ever is on Twitch. `bot` is the login it was posted from, modded the way these bots
 * are in most channels; `mod: false` posts the same words as an ordinary viewer.
 */
const announcement = (bot, text, { mod = true } = {}) =>
  `@badge-info=;badges=${mod ? 'moderator/1' : ''};color=;display-name=${bot};emotes=;` +
  `first-msg=0;id=1;mod=${mod ? 1 : 0};room-id=1;subscriber=0;tmi-sent-ts=1;turbo=0;` +
  `user-id=2;user-type=${mod ? 'mod' : ''} ` +
  `:${bot}!${bot}@${bot}.tmi.twitch.tv PRIVMSG #dallas :${text}`;

const SUB =
  '@badge-info=;badges=subscriber/0;color=;display-name=Nia;emotes=;id=1;login=nia;mod=0;' +
  'msg-id=sub;msg-param-cumulative-months=1;msg-param-sub-plan=1000;room-id=1;subscriber=1;' +
  'system-msg=Nia\\ssubscribed\\sat\\sTier\\s1.;tmi-sent-ts=1;user-id=2;user-type= ' +
  ':tmi.twitch.tv USERNOTICE #dallas';

const RESUB =
  '@badge-info=;badges=;color=;display-name=Ronni;emotes=;id=1;login=ronni;mod=0;msg-id=resub;' +
  'msg-param-cumulative-months=6;msg-param-streak-months=2;msg-param-sub-plan=Prime;room-id=1;' +
  'subscriber=1;system-msg=Ronni\\ssubscribed\\sfor\\s6\\smonths!;tmi-sent-ts=1;user-id=2;' +
  'user-type= :tmi.twitch.tv USERNOTICE #dallas :Great stream -- keep it up!';

const SUBGIFT =
  '@badges=premium/1;color=;display-name=TWW2;emotes=;id=1;login=tww2;mod=0;msg-id=subgift;' +
  'msg-param-months=1;msg-param-recipient-display-name=Mr_Woodchuck;msg-param-recipient-id=8;' +
  'msg-param-recipient-user-name=mr_woodchuck;msg-param-sub-plan=1000;room-id=1;subscriber=0;' +
  'system-msg=TWW2\\sgifted\\sa\\sTier\\s1\\ssub\\sto\\sMr_Woodchuck!;tmi-sent-ts=1;user-id=2;' +
  'user-type= :tmi.twitch.tv USERNOTICE #dallas';

const MYSTERY =
  '@badges=;color=;display-name=Plumtree;emotes=;id=1;login=plumtree;mod=0;' +
  'msg-id=submysterygift;msg-param-mass-gift-count=5;msg-param-sender-count=30;' +
  'msg-param-sub-plan=1000;room-id=1;subscriber=0;tmi-sent-ts=1;user-id=2;user-type= ' +
  ':tmi.twitch.tv USERNOTICE #dallas';

const RAID =
  '@badges=turbo/1;color=;display-name=TestChannel;emotes=;id=1;login=testchannel;mod=0;' +
  'msg-id=raid;msg-param-displayName=TestChannel;msg-param-login=testchannel;' +
  'msg-param-viewerCount=15;room-id=1;subscriber=0;tmi-sent-ts=1;user-id=2;user-type= ' +
  ':tmi.twitch.tv USERNOTICE #dallas';

const CHEER =
  '@badge-info=;badges=;bits=100;color=;display-name=Kaylee;emotes=;first-msg=0;id=1;mod=0;' +
  'room-id=1;subscriber=0;tmi-sent-ts=1;turbo=0;user-id=2;user-type= ' +
  ':kaylee!kaylee@kaylee.tmi.twitch.tv PRIVMSG #dallas :cheer100 nice one';

const CHAT =
  '@badge-info=;badges=;color=;display-name=Sam;emotes=;first-msg=0;id=1;mod=0;room-id=1;' +
  'subscriber=0;tmi-sent-ts=1;turbo=0;user-id=2;user-type= ' +
  ':sam!sam@sam.tmi.twitch.tv PRIVMSG #dallas :hello';

// Mods and VIPs come off the badges of an ordinary message. There is no event for
// either, so these lines are the only thing standing between a mod and no thank-you.
const MOD =
  '@badge-info=;badges=moderator/1,subscriber/12;color=;display-name=Wrenlee;emotes=;' +
  'first-msg=0;id=1;mod=1;room-id=1;subscriber=1;tmi-sent-ts=1;turbo=0;user-id=2;user-type=mod ' +
  ':wrenlee!wrenlee@wrenlee.tmi.twitch.tv PRIVMSG #dallas :on it';

const VIP =
  '@badge-info=;badges=vip/1,subscriber/3;color=;display-name=Juno;emotes=;first-msg=0;id=1;' +
  'mod=0;room-id=1;subscriber=1;tmi-sent-ts=1;turbo=0;user-id=2;user-type=;vip=1 ' +
  ':juno!juno@juno.tmi.twitch.tv PRIVMSG #dallas :hey';

const BROADCASTER =
  '@badge-info=;badges=broadcaster/1,moderator/1;color=;display-name=Dallas;emotes=;' +
  'first-msg=0;id=1;mod=1;room-id=1;subscriber=0;tmi-sent-ts=1;turbo=0;user-id=2;user-type= ' +
  ':dallas!dallas@dallas.tmi.twitch.tv PRIVMSG #dallas :thanks all';

const MILESTONE =
  '@badge-info=;badges=;color=;display-name=Pip;emotes=;flags=;id=1;login=pip;mod=0;' +
  'msg-id=viewermilestone;msg-param-category=watch-streak;msg-param-id=abc;msg-param-value=12;' +
  'room-id=1;subscriber=0;system-msg=Pip\\swatched\\s12\\sconsecutive\\sstreams;tmi-sent-ts=1;' +
  'user-id=2;user-type= :tmi.twitch.tv USERNOTICE #dallas :hi';

test('tags', async (t) => {
  await t.test('unescapes the values Twitch escapes', () => {
    // A semicolon inside a value is sent as `\:`, so it survives the split on `;` that
    // separates one tag from the next.
    const tags = parseTags('system-msg=Nia\\ssubscribed\\stoo\\:\\sfinally;id=1');
    assert.equal(tags['system-msg'], 'Nia subscribed too; finally');
    assert.equal(tags.id, '1');
  });

  await t.test('a tag with no value is an empty string, not missing', () => {
    assert.equal(parseTags('badges=;user-type=').badges, '');
  });
});

test('parseLine', async (t) => {
  await t.test('reads a USERNOTICE with no message body', () => {
    const line = parseLine(RAID);
    assert.equal(line.kind, 'usernotice');
    assert.equal(line.text, '');
  });

  await t.test('takes the login tag on a USERNOTICE, not the tmi.twitch.tv prefix', () => {
    // The prefix on every USERNOTICE is the server. Falling back to it would credit
    // "tmi" for every sub on the channel.
    assert.equal(parseLine(SUB).login, 'nia');
  });

  await t.test('takes the login from the prefix on a PRIVMSG', () => {
    assert.equal(parseLine(CHAT).login, 'sam');
  });

  await t.test('ignores anything that is not chat or a notice', () => {
    assert.equal(parseLine(':tmi.twitch.tv 001 justinfan1 :Welcome, GLHF!'), null);
    assert.equal(parseLine(':justinfan1.tmi.twitch.tv JOIN #dallas'), null);
    assert.equal(parseLine('PING :tmi.twitch.tv'), null);
    assert.equal(parseLine(''), null);
  });
});

test('credits from a line', async (t) => {
  await t.test('a new sub', () => {
    assert.deepEqual(credits(SUB), [
      { type: 'sub', login: 'nia', name: 'Nia', tier: 'Tier 1' },
    ]);
  });

  await t.test('a resub carries its month count', () => {
    assert.deepEqual(credits(RESUB), [
      { type: 'resub', login: 'ronni', name: 'Ronni', tier: 'Prime', months: 6 },
    ]);
  });

  await t.test('a gift sub credits the gifter and the recipient', () => {
    assert.deepEqual(credits(SUBGIFT), [
      { type: 'gift', login: 'tww2', name: 'TWW2', gifts: 1 },
      {
        type: 'sub',
        login: 'mr_woodchuck',
        name: 'Mr_Woodchuck',
        tier: 'Tier 1',
        gifted: true,
      },
    ]);
  });

  await t.test('an anonymous gift credits only the recipient', () => {
    const anon = SUBGIFT.replace('login=tww2', 'login=ananonymousgifter');
    assert.deepEqual(
      credits(anon).map((c) => c.type),
      ['sub'],
    );
  });

  await t.test('a gift bomb credits the whole batch at once', () => {
    assert.deepEqual(credits(MYSTERY), [
      { type: 'gift', login: 'plumtree', name: 'Plumtree', gifts: 5, mystery: true },
    ]);
  });

  await t.test('a raid carries its viewer count', () => {
    assert.deepEqual(credits(RAID), [
      { type: 'raid', login: 'testchannel', name: 'TestChannel', viewers: 15 },
    ]);
  });

  await t.test('bits on an ordinary message', () => {
    assert.deepEqual(credits(CHEER), [
      { type: 'cheer', login: 'kaylee', name: 'Kaylee', bits: 100 },
    ]);
  });

  await t.test('a first message', () => {
    const first = CHAT.replace('first-msg=0', 'first-msg=1');
    assert.deepEqual(credits(first), [{ type: 'first', login: 'sam', name: 'Sam' }]);
  });

  await t.test('a first message that is also a cheer counts as both', () => {
    const both = CHEER.replace('first-msg=0', 'first-msg=1');
    assert.deepEqual(
      credits(both).map((c) => c.type),
      ['cheer', 'first'],
    );
  });

  await t.test('ordinary chat earns nobody a mention', () => {
    assert.deepEqual(credits(CHAT), []);
  });

  await t.test('notices that are not somebody doing something are ignored', () => {
    for (const id of ['announcement', 'ritual', 'bitsbadgetier', 'sharedchatnotice']) {
      assert.deepEqual(credits(SUB.replace('msg-id=sub;', `msg-id=${id};`)), [], id);
    }
  });
});

test('badges', async (t) => {
  await t.test('a moderator badge credits a mod', () => {
    assert.deepEqual(credits(MOD), [{ type: 'mod', login: 'wrenlee', name: 'Wrenlee' }]);
  });

  await t.test('a vip badge credits a vip', () => {
    assert.deepEqual(credits(VIP), [{ type: 'vip', login: 'juno', name: 'Juno' }]);
  });

  // The badge is what shows in chat and the tag is what Twitch documents. Either alone
  // has to be enough, or a mod goes uncredited on whichever line shape disagrees.
  await t.test('the mod tag alone is enough, with no badge', () => {
    const tagOnly = CHAT.replace('badges=;', 'badges=;').replace('mod=0', 'mod=1');
    assert.deepEqual(credits(tagOnly), [{ type: 'mod', login: 'sam', name: 'Sam' }]);
  });

  // The broadcaster holds an implicit moderator badge, so without this every channel
  // credits its own owner under "Moderated by" -- at the top, above the actual mods.
  await t.test('the broadcaster is not one of their own mods', () => {
    assert.deepEqual(credits(BROADCASTER), []);
  });

  await t.test('a modded bot is not thanked for moderating', () => {
    const bot = MOD.replace(/display-name=Wrenlee/, 'display-name=Nightbot').replace(
      /:wrenlee!wrenlee@wrenlee/,
      ':nightbot!nightbot@nightbot',
    );
    assert.deepEqual(credits(bot), []);
  });

  await t.test('an ordinary chatter is neither', () => {
    assert.deepEqual(credits(CHAT), []);
  });

  await t.test('a mod who cheers is credited for both', () => {
    const cheering = MOD.replace('badge-info=;', 'badge-info=;bits=200;');
    assert.deepEqual(
      credits(cheering).map((c) => c.type),
      ['cheer', 'mod'],
    );
  });
});

test('watch streaks', async (t) => {
  await t.test('a watch streak credits the viewer with its length', () => {
    assert.deepEqual(credits(MILESTONE), [
      { type: 'streak', login: 'pip', name: 'Pip', streak: 12 },
    ]);
  });

  // watch-streak is the only category Twitch defines today. A new one would mean
  // something else entirely, and filing it under streaks would put a wrong number on
  // screen rather than raise anything.
  await t.test('a milestone that is not a watch streak is ignored', () => {
    assert.deepEqual(credits(MILESTONE.replace('watch-streak', 'something-else')), []);
  });

  await t.test('a streak with no length is ignored', () => {
    assert.deepEqual(credits(MILESTONE.replace('msg-param-value=12', 'msg-param-value=0')), []);
  });
});

// Donations are the one credit read out of a message body rather than a tag, because
// Twitch has no event for money that did not go through Twitch. Every line here is a
// shape a real bot posts: a template that stops matching is a stream's worth of
// donations quietly missing from the reel, with nothing anywhere to say so.
test('donations', async (t) => {
  await t.test('a tip credits the donor, not the bot that announced it', () => {
    assert.deepEqual(credits(announcement('streamlabs', 'Kaylee just donated $5.00!')), [
      { type: 'tip', login: 'kaylee', name: 'Kaylee', amount: 5, currency: '$' },
    ]);
  });

  await t.test('the shapes the usual bots post', () => {
    const lines = [
      ['streamelements', 'nia just tipped $12.34 PogChamp', '$'],
      ['streamelements', 'nia tipped 12.34 USD', 'USD'],
      ['kofistreambot', 'New Ko-fi from nia: $12.34', '$'],
      ['kofistreambot', 'nia just supported with $12.34', '$'],
      ['streamlabs', 'Thanks nia for the $12.34 donation!', '$'],
      ['muxy', 'nia donated $12.34: have a good one', '$'],
    ];

    for (const [bot, text, currency] of lines) {
      assert.deepEqual(
        credits(announcement(bot, text)),
        [{ type: 'tip', login: 'nia', name: 'nia', amount: 12.34, currency }],
        text,
      );
    }
  });

  // Anybody can type "I just donated $50". There is no permission model here to check
  // it against, so the only thing standing between that and a place in the credits is
  // that the message did not come from a donation bot.
  await t.test('a viewer claiming to have donated earns nothing', () => {
    assert.deepEqual(credits(announcement('sam', 'i just donated $500 lol', { mod: false })), []);
  });

  await t.test('a bot that is not a donation bot is not read for donations', () => {
    assert.deepEqual(credits(announcement('nightbot', 'mira just donated $9')), []);
    assert.deepEqual(credits(announcement('moobot', 'mira just donated $9')), []);
  });

  await t.test('donationBots adds one, for a service or a relay this does not know', () => {
    assert.deepEqual(
      credits(announcement('mytipbot', 'mira just donated $9'), { donationBots: ['mytipbot'] }),
      [{ type: 'tip', login: 'mira', name: 'mira', amount: 9, currency: '$' }],
    );
  });

  // Donation bots are modded in most channels. Crediting one under "Moderated by" for
  // announcing somebody else's money is the mis-credit this guard exists for.
  await t.test('a donation bot is not thanked for moderating', () => {
    const both = credits(announcement('mytipbot', 'mira just donated $9'), {
      donationBots: ['mytipbot'],
    });
    assert.deepEqual(both.map((c) => c.type), ['tip']);
  });

  await t.test('nothing is read out of an ordinary bot message', () => {
    for (const text of ['Type !tip to support the stream', 'Follow on twitter', 'thanks for watching!']) {
      assert.deepEqual(credits(announcement('streamlabs', text)), [], text);
    }
  });

  await t.test('an anonymous donor is credited to nobody, like an anonymous gifter', () => {
    for (const who of ['Anonymous', 'anon', 'Anonymous Donor']) {
      assert.deepEqual(credits(announcement('streamlabs', `${who} just donated $5.00`)), [], who);
    }
  });

  await t.test('both ways of writing a decimal, and thousands either way round', () => {
    const amounts = [
      ['$5', 5],
      ['$1,250.00', 1250],
      ['€1.250,00', 1250],
      ['€7,50', 7.5],
      ['500 JPY', 500],
    ];
    for (const [written, expected] of amounts) {
      const [credit] = credits(announcement('streamlabs', `nia just donated ${written}`));
      assert.equal(credit?.amount, expected, written);
    }
  });

  await t.test('something that is not an amount is not a donation', () => {
    for (const text of ['nia just donated $0', 'nia just donated 1.2.3', 'nia just donated a lot']) {
      assert.deepEqual(credits(announcement('streamlabs', text)), [], text);
    }
  });
});

test('charity donations', async (t) => {
  await t.test('a named cause makes it charity, through an ordinary tip bot', () => {
    assert.deepEqual(credits(announcement('streamlabs', 'Pip donated $25.00 to Extra Life!')), [
      {
        type: 'charity',
        login: 'pip',
        name: 'Pip',
        amount: 25,
        currency: '$',
        cause: 'Extra Life',
      },
    ]);
  });

  // Tiltify and Extra Life exist to run fundraisers. Nothing announced through them is a
  // tip, whether or not the line names what it was for.
  await t.test('a fundraiser bot is charity even with no cause in the line', () => {
    assert.deepEqual(credits(announcement('tiltify', 'Pip donated $20.00'))[0].type, 'charity');
  });

  // "to the stream" is a tip somebody phrased warmly. Reading it as a cause would split
  // one section into two, both of them wrong.
  await t.test('donating "to the stream" is still a tip', () => {
    assert.deepEqual(credits(announcement('streamlabs', 'lex donated $5 to the stream'))[0].type, 'tip');
  });

  // The cause is only ever the words right after the amount. A donor writing about a
  // charity in their attached message must not move their tip into the other section.
  await t.test('a charity named in the donor\'s own message is not a cause', () => {
    const line = 'iris just donated $8.00: I gave to Extra Life as well';
    assert.deepEqual(credits(announcement('streamlabs', line))[0].type, 'tip');
  });
});

export { SUB, RESUB, SUBGIFT, MYSTERY, RAID, CHEER, CHAT, MOD, VIP, BROADCASTER, MILESTONE };
