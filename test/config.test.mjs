// Settings arrive from the overlay URL and from the setup page, and both have to read a
// value the same way. A disagreement here points a link at a channel nobody is talking
// in, or splits one stream's roster across two storage keys, with no error anywhere.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readConfig,
  normalizeChannel,
  clampSpeed,
  clampDuration,
  clampSessionHours,
  DEFAULTS,
  MIN_SPEED,
  MAX_SPEED,
  MIN_DURATION,
  MAX_DURATION,
} from '../src/config.js';

test('the channel name', async (t) => {
  await t.test('comes out the same however it was typed', () => {
    for (const input of ['Dallas', '#dallas', '  #DALLAS  ', 'dallas']) {
      assert.equal(normalizeChannel(input), 'dallas', input);
    }
  });

  await t.test('missing is empty, not undefined', () => {
    assert.equal(normalizeChannel(null), '');
    assert.equal(normalizeChannel(undefined), '');
  });

  await t.test('is normalized the same way out of a URL', () => {
    assert.equal(readConfig('?channel=%23Dallas').channel, 'dallas');
  });
});

test('the scroll pace', async (t) => {
  await t.test('is held to a readable range', () => {
    assert.equal(clampSpeed('1'), MIN_SPEED);
    assert.equal(clampSpeed('99999'), MAX_SPEED);
    assert.equal(clampSpeed('120'), 120);
  });

  await t.test('falls back when it is not a number', () => {
    assert.equal(clampSpeed('fast'), DEFAULTS.speed);
    assert.equal(clampSpeed(null), DEFAULTS.speed);
  });

  await t.test('a fixed runtime overrides it, and 0 means no override', () => {
    assert.equal(clampDuration('90'), 90);
    assert.equal(clampDuration('0'), 0);
    assert.equal(clampDuration(''), DEFAULTS.duration);
    assert.equal(clampDuration(null), DEFAULTS.duration);
    assert.equal(clampDuration('1'), MIN_DURATION);
    assert.equal(clampDuration('99999'), MAX_DURATION);
  });

  await t.test('reads the same from the URL as from the clamp', () => {
    assert.equal(readConfig('?speed=1').speed, clampSpeed('1'));
    assert.equal(readConfig('?duration=99999').duration, clampDuration('99999'));
  });
});

test('the session window', async (t) => {
  await t.test('is bounded so yesterday cannot roll today', () => {
    assert.equal(clampSessionHours('0'), 1);
    assert.equal(clampSessionHours('999'), 48);
    assert.equal(clampSessionHours('6'), 6);
    assert.equal(clampSessionHours('whenever'), DEFAULTS.sessionHours);
  });
});

test('readConfig', async (t) => {
  await t.test('with nothing set, everything is a default', () => {
    assert.deepEqual(readConfig(''), { ...DEFAULTS, channel: '' });
  });

  await t.test('flags take on, 1 and true', () => {
    for (const value of ['on', '1', 'true']) {
      assert.equal(readConfig(`?debug=${value}`).debug, true, value);
    }
    for (const value of ['off', '0', 'no', '']) {
      assert.equal(readConfig(`?debug=${value}`).debug, false, value);
    }
  });

  await t.test('columns stay within what fits on a 16:9 source', () => {
    assert.equal(readConfig('?columns=99').columns, 6);
    assert.equal(readConfig('?columns=0').columns, 1);
    assert.equal(readConfig('?columns=2').columns, 2);
  });

  await t.test('the backdrop is an opacity, not a colour', () => {
    assert.equal(readConfig('?backdrop=0.6').backdrop, 0.6);
    assert.equal(readConfig('?backdrop=5').backdrop, 1);
    assert.equal(readConfig('?backdrop=-1').backdrop, 0);
    assert.equal(readConfig('?backdrop=dark').backdrop, DEFAULTS.backdrop);
  });

  await t.test('an empty title is honoured, not replaced by the default', () => {
    // Somebody who does not want a heading over their credits should get no heading.
    assert.equal(readConfig('?title=').title, '');
    assert.equal(readConfig('?title=Thanks%20all').title, 'Thanks all');
  });
});
