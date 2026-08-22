// One IRC line in, credits out. This is the layer where a wrong tag name costs somebody
// their thank-you and nothing anywhere reports an error, so every message shape the
// overlay reads is pinned to a real line.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLine, parseTags } from '../src/irc.js';
import { toCredits } from '../src/events.js';

const credits = (line) => toCredits(parseLine(line));

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

export { SUB, RESUB, SUBGIFT, MYSTERY, RAID, CHEER, CHAT, MOD, VIP, BROADCASTER, MILESTONE };
