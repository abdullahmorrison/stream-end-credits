// What the overlay does when OBS reports a scene change. Getting this wrong is not a
// crash -- it is credits restarting from the top halfway through, or a frozen reel left
// on screen after the scene has moved on.

import test from 'node:test';
import assert from 'node:assert/strict';
import { nextAction } from '../src/obs.js';

const scene = (active) => ({ type: 'scene', active });
const STREAM_START = { type: 'stream-start' };

test('scene changes', async (t) => {
  await t.test('switching to the ending scene rolls', () => {
    assert.equal(nextAction('idle', scene(true)), 'roll');
  });

  await t.test('switching away mid-roll stops', () => {
    assert.equal(nextAction('rolling', scene(false)), 'stop');
  });

  await t.test('a repeat active event does not restart a roll in progress', () => {
    // OBS can report the same source active more than once for one switch. Restarting
    // would throw the viewer back to the title card halfway down the names.
    assert.equal(nextAction('rolling', scene(true)), null);
  });

  await t.test('going inactive while nothing is rolling does nothing', () => {
    assert.equal(nextAction('idle', scene(false)), null);
  });

  await t.test('coming back after a finished roll plays it again', () => {
    // Returning to the ending scene is deliberate, so a replay is what was meant.
    assert.equal(nextAction('idle', scene(true)), 'roll');
  });
});

test('stream start', async (t) => {
  await t.test('clears the roster, whatever the overlay is doing', () => {
    assert.equal(nextAction('idle', STREAM_START), 'reset');
    assert.equal(nextAction('rolling', STREAM_START), 'reset');
  });
});

test('anything else', async (t) => {
  await t.test('is not an instruction', () => {
    assert.equal(nextAction('idle', null), null);
    assert.equal(nextAction('idle', { type: 'recording-started' }), null);
  });
});
