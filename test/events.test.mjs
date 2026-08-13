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
    for (const id of ['announcement', 'ritual', 'bitsbadgetier', 'viewermilestone']) {
      assert.deepEqual(credits(SUB.replace('msg-id=sub;', `msg-id=${id};`)), [], id);
    }
  });
});

export { SUB, RESUB, SUBGIFT, MYSTERY, RAID, CHEER, CHAT };
