// Who ends up in the reel. Every failure here is silent -- the credits still roll, they
// are just wrong, and nobody finds out until it is on stream.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Roster } from '../src/roster.js';

function memStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  };
}

const roster = (opts = {}) => new Roster({ channel: 'dallas', ...opts });

const names = (sections, id) => sections.find((s) => s.id === id)?.names.map((n) => n.name);
const ids = (sections) => sections.map((s) => s.id);

test('collecting', async (t) => {
  await t.test('one entry per login, whatever they did', () => {
    const r = roster();
    r.add({ type: 'raid', login: 'kaylee', name: 'kaylee', viewers: 42 });
    r.add({ type: 'cheer', login: 'kaylee', name: 'kaylee', bits: 100 });
    r.add({ type: 'sub', login: 'kaylee', name: 'kaylee' });
    assert.equal(r.size, 1);
    // ...and they appear in every section they earned.
    assert.deepEqual(ids(r.sections()), ['raid', 'sub', 'cheer']);
  });

  await t.test('the same person subbing twice is not two people', () => {
    const r = roster();
    r.add({ type: 'sub', login: 'nia', name: 'Nia' });
    r.add({ type: 'sub', login: 'nia', name: 'Nia' });
    assert.deepEqual(names(r.sections(), 'sub'), ['Nia']);
  });

  await t.test('a display name changing mid-stream takes the later one', () => {
    const r = roster();
    r.add({ type: 'sub', login: 'nia', name: 'Nia' });
    r.add({ type: 'cheer', login: 'nia', name: 'NiaTheGreat', bits: 5 });
    assert.deepEqual(names(r.sections(), 'sub'), ['NiaTheGreat']);
  });

  await t.test('bits add up across the stream', () => {
    const r = roster();
    r.add({ type: 'cheer', login: 'sam', name: 'Sam', bits: 100 });
    r.add({ type: 'cheer', login: 'sam', name: 'Sam', bits: 250 });
    assert.deepEqual(r.sections().find((s) => s.id === 'cheer').names, [
      { name: 'Sam', detail: '350' },
    ]);
  });

  await t.test('a second raid keeps the bigger number, not the later one', () => {
    const r = roster();
    r.add({ type: 'raid', login: 'kaylee', name: 'kaylee', viewers: 140 });
    r.add({ type: 'raid', login: 'kaylee', name: 'kaylee', viewers: 12 });
    assert.deepEqual(r.sections().find((s) => s.id === 'raid').names, [
      { name: 'kaylee', detail: '140' },
    ]);
  });

  await t.test('a cancelled raid takes the raider back out', () => {
    const r = roster();
    r.add({ type: 'raid', login: 'kaylee', name: 'kaylee', viewers: 140 });
    r.add({ type: 'unraid', login: 'kaylee', name: 'kaylee' });
    assert.equal(names(r.sections(), 'raid'), undefined);
  });

  await t.test('a resubber is in "resubs", not "new subscribers"', () => {
    const r = roster();
    r.add({ type: 'sub', login: 'nia', name: 'Nia' });
    r.add({ type: 'resub', login: 'ronni', name: 'Ronni', months: 6 });
    assert.deepEqual(names(r.sections(), 'sub'), ['Nia']);
    assert.deepEqual(r.sections().find((s) => s.id === 'resub').names, [
      { name: 'Ronni', detail: '6 mo' },
    ]);
  });

  await t.test('nonsense is ignored rather than thrown', () => {
    const r = roster();
    r.add(null);
    r.add({ type: 'sub' });
    r.add({ type: 'nothing-like-this', login: 'x', name: 'x' });
    assert.equal(r.size, 1);
    assert.deepEqual(r.sections(), []);
  });
});

test('gift bombs', async (t) => {
  // Twitch announces a community gift once with the real total, then sends one ordinary
  // subgift per recipient from the same login. Counting both shows the gifter as having
  // given twice what they did.
  await t.test('the batch counts once, the follow-ups only credit recipients', () => {
    const r = roster();
    r.add({ type: 'gift', login: 'plumtree', name: 'Plumtree', gifts: 3, mystery: true });
    for (const name of ['a', 'b', 'c']) {
      r.add({ type: 'gift', login: 'plumtree', name: 'Plumtree', gifts: 1 });
      r.add({ type: 'sub', login: name, name, gifted: true });
    }

    assert.deepEqual(r.sections().find((s) => s.id === 'gift').names, [
      { name: 'Plumtree', detail: '×3' },
    ]);
    assert.deepEqual(names(r.sections(), 'sub'), ['a', 'b', 'c']);
  });

  await t.test('a single gift after the batch is exhausted still counts', () => {
    const r = roster();
    r.add({ type: 'gift', login: 'plumtree', name: 'Plumtree', gifts: 1, mystery: true });
    r.add({ type: 'gift', login: 'plumtree', name: 'Plumtree', gifts: 1 });
    r.add({ type: 'gift', login: 'plumtree', name: 'Plumtree', gifts: 1 });
    assert.deepEqual(r.sections().find((s) => s.id === 'gift').names, [
      { name: 'Plumtree', detail: '×2' },
    ]);
  });

  await t.test('one gifter’s batch does not swallow another gifter’s sub', () => {
    const r = roster();
    r.add({ type: 'gift', login: 'plumtree', name: 'Plumtree', gifts: 2, mystery: true });
    r.add({ type: 'gift', login: 'sedge', name: 'Sedge', gifts: 1 });
    assert.deepEqual(r.sections().find((s) => s.id === 'gift').names, [
      { name: 'Plumtree', detail: '×2' },
      { name: 'Sedge', detail: '×1' },
    ]);
  });
});

test('sections', async (t) => {
  await t.test('empty ones are dropped, not shown as an empty heading', () => {
    const r = roster();
    r.add({ type: 'sub', login: 'nia', name: 'Nia' });
    assert.deepEqual(ids(r.sections()), ['sub']);
  });

  await t.test('nothing at all is no sections', () => {
    assert.deepEqual(roster().sections(), []);
  });

  await t.test('first-time chatters only appear when asked for', () => {
    const r = roster();
    r.add({ type: 'first', login: 'sam', name: 'Sam' });
    assert.deepEqual(r.sections(), []);
    assert.deepEqual(ids(r.sections({ firsts: true })), ['first']);
  });

  await t.test('counted sections go biggest first, ties alphabetical', () => {
    const r = roster();
    r.add({ type: 'cheer', login: 'b', name: 'bee', bits: 100 });
    r.add({ type: 'cheer', login: 'a', name: 'ay', bits: 100 });
    r.add({ type: 'cheer', login: 'c', name: 'cee', bits: 900 });
    assert.deepEqual(names(r.sections(), 'cheer'), ['cee', 'ay', 'bee']);
  });

  await t.test('name lists are alphabetical regardless of case', () => {
    const r = roster();
    for (const name of ['zeta', 'Alpha', 'beta']) {
      r.add({ type: 'sub', login: name.toLowerCase(), name });
    }
    assert.deepEqual(names(r.sections(), 'sub'), ['Alpha', 'beta', 'zeta']);
  });

  await t.test('sections always roll in the same order', () => {
    const r = roster();
    r.add({ type: 'first', login: 'a', name: 'a' });
    r.add({ type: 'cheer', login: 'b', name: 'b', bits: 1 });
    r.add({ type: 'gift', login: 'c', name: 'c', gifts: 1 });
    r.add({ type: 'resub', login: 'd', name: 'd', months: 2 });
    r.add({ type: 'sub', login: 'e', name: 'e' });
    r.add({ type: 'raid', login: 'f', name: 'f', viewers: 3 });
    assert.deepEqual(ids(r.sections({ firsts: true })), [
      'raid',
      'sub',
      'resub',
      'gift',
      'cheer',
      'first',
    ]);
  });
});

test('the session', async (t) => {
  await t.test('survives a reload', () => {
    const storage = memStorage();
    const first = roster({ storage });
    first.add({ type: 'sub', login: 'nia', name: 'Nia' });
    first.add({ type: 'cheer', login: 'sam', name: 'Sam', bits: 300 });
    first.flush();

    const second = roster({ storage });
    assert.equal(second.load(), true);
    assert.equal(second.size, 2);
    assert.deepEqual(names(second.sections(), 'sub'), ['Nia']);
    // ...and it keeps collecting into the same session.
    second.add({ type: 'sub', login: 'ari', name: 'Ari' });
    assert.deepEqual(names(second.sections(), 'sub'), ['Ari', 'Nia']);
  });

  await t.test('a stale one is discarded rather than rolled', () => {
    const storage = memStorage();
    let clock = 1_000_000_000;
    const first = roster({ storage, now: () => clock });
    first.add({ type: 'sub', login: 'nia', name: 'Nia' });
    first.flush();

    clock += 13 * 3600000;
    const later = roster({ storage, sessionHours: 12, now: () => clock });
    assert.equal(later.load(), false);
    assert.equal(later.size, 0);
  });

  await t.test('inside the window it is still the same stream', () => {
    const storage = memStorage();
    let clock = 1_000_000_000;
    const first = roster({ storage, now: () => clock });
    first.add({ type: 'sub', login: 'nia', name: 'Nia' });
    first.flush();

    clock += 11 * 3600000;
    const later = roster({ storage, sessionHours: 12, now: () => clock });
    assert.equal(later.load(), true);
    assert.equal(later.size, 1);
  });

  await t.test('reset clears the names and starts the clock again', () => {
    const storage = memStorage();
    const r = roster({ storage });
    r.add({ type: 'sub', login: 'nia', name: 'Nia' });
    r.reset();
    assert.equal(r.size, 0);

    const after = roster({ storage });
    after.load();
    assert.equal(after.size, 0);
  });

  await t.test('a half-delivered gift bomb does not carry across a reload', () => {
    const storage = memStorage();
    const first = roster({ storage });
    first.add({ type: 'gift', login: 'plumtree', name: 'Plumtree', gifts: 5, mystery: true });
    first.flush();

    // A stale pending count would silently swallow the next five real gift subs.
    const second = roster({ storage });
    second.load();
    second.add({ type: 'gift', login: 'plumtree', name: 'Plumtree', gifts: 1 });
    assert.deepEqual(second.sections().find((s) => s.id === 'gift').names, [
      { name: 'Plumtree', detail: '×6' },
    ]);
  });

  await t.test('junk in storage is ignored, not thrown', () => {
    const storage = memStorage();
    storage.setItem('stream-end-credits:dallas', 'not json');
    assert.equal(roster({ storage }).load(), false);

    storage.setItem('stream-end-credits:dallas', '{"v":99,"startedAt":0,"entries":[]}');
    assert.equal(roster({ storage }).load(), false);
  });

  await t.test('no storage at all still collects for this session', () => {
    const r = new Roster({ channel: 'dallas', storage: null });
    r.add({ type: 'sub', login: 'nia', name: 'Nia' });
    r.flush();
    assert.equal(r.load(), false);
    assert.equal(r.size, 1);
  });
});

// Which sections roll is now four separate switches, two of which ship on. A section
// silently defaulting the wrong way either drops people who should be thanked or puts a
// list on stream the streamer never asked for -- and both look identical to a working
// overlay right up until the credits roll.
test('section switches', async (t) => {
  const filled = () => {
    const r = roster();
    r.add({ type: 'mod', login: 'wrenlee', name: 'Wrenlee' });
    r.add({ type: 'vip', login: 'juno', name: 'Juno' });
    r.add({ type: 'streak', login: 'pip', name: 'Pip', streak: 12 });
    r.add({ type: 'first', login: 'sam', name: 'Sam' });
    return r;
  };

  await t.test('mods and streaks roll without being asked for', () => {
    assert.deepEqual(ids(filled().sections()), ['streak', 'mod']);
  });

  await t.test('vips and firsts stay out until they are asked for', () => {
    assert.deepEqual(
      ids(filled().sections({ vips: true, firsts: true })),
      ['streak', 'first', 'vip', 'mod'],
    );
  });

  await t.test('the two that ship on can be switched off', () => {
    assert.deepEqual(ids(filled().sections({ mods: false, streaks: false })), []);
  });

  // Passing some switches must not turn the unmentioned ones off: the debug panel and
  // the reel both hand over a partial object.
  await t.test('a partial set of switches leaves the rest at their own default', () => {
    assert.deepEqual(ids(filled().sections({ vips: true })), ['streak', 'vip', 'mod']);
  });

  await t.test('every section in one roll keeps its order', () => {
    const r = filled();
    r.add({ type: 'raid', login: 'a', name: 'a', viewers: 3 });
    r.add({ type: 'sub', login: 'b', name: 'b' });
    r.add({ type: 'resub', login: 'c', name: 'c', months: 2 });
    r.add({ type: 'gift', login: 'd', name: 'd', gifts: 1 });
    r.add({ type: 'cheer', login: 'e', name: 'e', bits: 1 });
    assert.deepEqual(ids(r.sections({ vips: true, firsts: true })), [
      'raid',
      'sub',
      'resub',
      'gift',
      'cheer',
      'streak',
      'first',
      'vip',
      'mod',
    ]);
  });
});

test('watch streaks', async (t) => {
  await t.test('longest streak first, with the count beside the name', () => {
    const r = roster();
    r.add({ type: 'streak', login: 'pip', name: 'Pip', streak: 3 });
    r.add({ type: 'streak', login: 'ari', name: 'Ari', streak: 31 });
    assert.deepEqual(r.sections().find((s) => s.id === 'streak').names, [
      { name: 'Ari', detail: '31 streams' },
      { name: 'Pip', detail: '3 streams' },
    ]);
  });

  await t.test('one stream is not one streams', () => {
    const r = roster();
    r.add({ type: 'streak', login: 'pip', name: 'Pip', streak: 1 });
    assert.equal(r.sections().find((s) => s.id === 'streak').names[0].detail, '1 stream');
  });

  // A reconnect replays notices. Taking the later one would walk a streak backwards.
  await t.test('a replayed older milestone does not shorten the streak', () => {
    const r = roster();
    r.add({ type: 'streak', login: 'pip', name: 'Pip', streak: 12 });
    r.add({ type: 'streak', login: 'pip', name: 'Pip', streak: 4 });
    assert.equal(r.sections().find((s) => s.id === 'streak').names[0].detail, '12 streams');
  });
});

test('mods and vips survive a reload', () => {
  const storage = memStorage();
  const first = roster({ storage });
  first.add({ type: 'mod', login: 'wrenlee', name: 'Wrenlee' });
  first.add({ type: 'vip', login: 'juno', name: 'Juno' });
  first.add({ type: 'streak', login: 'pip', name: 'Pip', streak: 9 });
  first.flush();

  const second = roster({ storage });
  assert.equal(second.load(), true);
  assert.deepEqual(names(second.sections({ vips: true }), 'mod'), ['Wrenlee']);
  assert.deepEqual(names(second.sections({ vips: true }), 'vip'), ['Juno']);
  assert.deepEqual(names(second.sections(), 'streak'), ['Pip']);
});
