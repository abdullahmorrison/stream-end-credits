// A stream's worth of fake events, so the reel can be checked in OBS without waiting
// for a real one. Deliberately awkward data: very long names, single-entry sections,
// four-digit bit totals -- the cases that break a layout are never the tidy ones.

const NAMES = [
  'kaylee', 'mochi_bun', 'devonte', 'tt_arjun', 'nia', 'polarbb', 'sam', 'wrenlee',
  'quietfrog', 'HalfLifeEnjoyer', 'bex', 'oat_milk_latte', 'nikoo', 'ravenshade',
  'tinygoblin', 'MarcusAureliusOnTwitch', 'juno', 'plumtree', 'sedge', 'kofi',
  'blue', 'thewanderingsound', 'ari', 'nocturnalfern', 'pip', 'greymatter',
  'saoirse', 'buttonmash', 'lex', 'onyxwaves', 'tamsin', 'crumbcatcher',
  'vale', 'northofhere', 'iris', 'salted_caramel_apocalypse', 'rook', 'mira',
];

function pick(list, n) {
  return list.slice(0, n);
}

/** Credits covering every category, in the order a real stream would deliver them. */
export function demoCredits() {
  const out = [];

  out.push({ type: 'raid', login: 'kaylee', name: 'kaylee', viewers: 142 });
  out.push({ type: 'raid', login: 'mochi_bun', name: 'mochi_bun', viewers: 38 });

  for (const name of pick(NAMES.slice(2), 11)) {
    out.push({ type: 'sub', login: name.toLowerCase(), name, tier: 'Tier 1' });
  }

  for (const [i, name] of pick(NAMES.slice(13), 7).entries()) {
    out.push({
      type: 'resub',
      login: name.toLowerCase(),
      name,
      months: [3, 8, 14, 26, 41, 6, 19][i],
    });
  }

  // A gift bomb, exactly as Twitch sends it: the batch first, then one line per
  // recipient from the same login. If the dedupe ever breaks, this shows it as 10.
  out.push({ type: 'gift', login: 'plumtree', name: 'plumtree', gifts: 5, mystery: true });
  for (const name of pick(NAMES.slice(20), 5)) {
    out.push({ type: 'gift', login: 'plumtree', name: 'plumtree', gifts: 1 });
    out.push({ type: 'sub', login: name.toLowerCase(), name, gifted: true });
  }
  out.push({ type: 'gift', login: 'greymatter', name: 'greymatter', gifts: 2 });

  for (const [i, name] of pick(NAMES.slice(26), 6).entries()) {
    out.push({ type: 'cheer', login: name.toLowerCase(), name, bits: [1000, 500, 420, 100, 69, 50][i] });
  }

  for (const name of pick(NAMES.slice(32), 6)) {
    out.push({ type: 'first', login: name.toLowerCase(), name });
  }

  return out;
}

/** One made-up event of each kind, for the debug panel's `F` key. */
export function fakeCredit(n) {
  const name = NAMES[n % NAMES.length];
  const login = name.toLowerCase();
  return [
    { type: 'sub', login, name },
    { type: 'resub', login, name, months: 12 },
    { type: 'gift', login, name, gifts: 3 },
    { type: 'cheer', login, name, bits: 250 },
    { type: 'raid', login, name, viewers: 77 },
    { type: 'first', login, name },
  ][n % 6];
}

export { NAMES };
