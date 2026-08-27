// Donations, read out of what the donation bot said in chat.
//
// Twitch has no donation event. Money that does not go through Twitch -- a tip, a
// charity fundraiser -- never touches the IRC tags the rest of this overlay is built on,
// the same way follows do not. What *does* arrive is the line StreamLabs, StreamElements,
// Ko-fi or Tiltify post in chat when one lands, so that announcement is what is read
// here. It is the only credit in the reel that comes from a message body rather than a
// tag, and it is the only one that can be wrong because somebody edited a template.
//
// Two rules keep it from crediting the wrong person:
//
//   Only known donation bots are read. Otherwise anybody could type themselves into the
//   credits with "I just donated $50", and there is no permission model here to stop
//   them -- see the no-chat-commands note in CLAUDE.md.
//
//   The donor is the name the bot leads with. Every pattern below is anchored at the
//   start of the message, so a name inside the donor's own attached message can never
//   be picked up instead.
//
// The failure mode to know about: these templates are configurable on every one of these
// services. A streamer who has rewritten theirs gets no credit and no error -- the line
// simply does not match. `donationBots=` adds a bot login (a Nightbot alias, a self-
// hosted relay), and a template that no pattern here matches is a pattern to add.

// Bot login -> what a donation through it means. Tips go to the streamer; Tiltify and
// Extra Life exist only to run fundraisers, so anything they announce is for a cause
// whether or not the message names one.
const DONATION_BOTS = new Map([
  ['streamlabs', 'tip'],
  ['streamelements', 'tip'],
  ['kofistreambot', 'tip'],
  ['muxy', 'tip'],
  ['donationalerts', 'tip'],
  ['fourthwall', 'tip'],
  ['tiltify', 'charity'],
  ['tiltifybot', 'charity'],
  ['extralife', 'charity'],
  ['streamlabscharity', 'charity'],
]);

// A donation with nobody to thank, the same way an anonymous gift sub is nobody's
// credit. Rolling a card that says "Anonymous" thanks no one and reads as a bug.
const ANONYMOUS = new Set(['anonymous', 'anon', 'anonymousdonor', 'someone', 'unknown']);

// What follows "to" when it is the stream itself rather than a cause: "donated $5 to
// the stream" is a tip somebody phrased warmly, not a charity donation.
const NOT_A_CAUSE = new Set(['you', 'me', 'us', 'stream', 'channel', 'streamer']);

// Lead-ins bots put before the donor's name. A fixed word list rather than "anything up
// to the first separator", because that would read a donor called `Alice:` as a prefix
// and credit whatever came after it.
const LEAD = /^(?:(?:thank you|thanks|new|another|latest|ko-?fi|tip|donation|alert)[\s:,!·—-]+)+/i;

// One token, so a name is never a whole clause. Twitch logins have no spaces, and a
// donor who typed a display name with one keeps only its first word -- a thank-you under
// a slightly short name beats no thank-you at all.
const NAME = String.raw`@?([^\s:,!?@]{1,40})`;

// "Alice just donated ...", "Alice tipped ...", "Alice supported the stream with ..."
const LED_BY_NAME = new RegExp(
  `^${NAME}\\s+(?:just\\s+|has\\s+|have\\s+)?` +
    '(?:donated|tipped|contributed|supported|sponsored)' +
    '(?:\\s+(?:us|you|me|the\\s+(?:stream|channel)))?(?:\\s+with)?\\s+(.+)$',
  'i',
);

// "New tip from Alice: $5.00" -- the same donation, announced the other way round.
const FROM_NAME = new RegExp(`\\bfrom\\s+${NAME}\\b[^\\d$£€¥₹₽₩]{0,24}(.+)$`, 'i');

// What is left of "Thanks Alice for the $5 donation!" once the lead-in is stripped.
const THANKS_FOR = new RegExp(`^${NAME}\\s+for\\s+(.+)$`, 'i');

// Says a message is about money at all. Required by the two looser patterns above, which
// would otherwise read any "from X" or "X for Y" line the bot happens to post.
const MENTIONS_DONATION = /donat|tipp?ed|\btip\b|support|contribut|sponsor|ko-?fi/i;

// The amount, at the front of whatever followed the verb. Symbol before the number
// ("$5.00"), or a code either side of it ("USD 5", "500 RUB"). The digits are taken
// loosely here and made sense of in `toNumber`, because which of `.` and `,` is the
// decimal point depends on where the donor was.
const AMOUNT =
  /^\s*(?:(?:the|a|an|his|her|their)\s+)*(?:([$£€¥₹₽₩])\s*|([A-Za-z]{3})\s+)?(\d[\d.,]*\d|\d)(?:\s*([A-Za-z]{3})\b)?/;

// The cause, immediately after the amount and nowhere else: "donated $25 to Extra Life".
// Anchored there so a charity named in the donor's attached message cannot become one.
const CAUSE = /^[\s!.,:;–—-]*(?:to|towards|for)\s+(?:the\s+)?([^!.,:;\n"'()]{1,60})/i;

/** Everything up to a thousand times a normal donation. Past that it is a parse, not a gift. */
const MAX_AMOUNT = 1000000;

/**
 * The number a bot wrote, in either convention: `1,250.00` and `1.250,00` are both 1250,
 * and `7,50` is seven and a half rather than seven hundred and fifty. The decimal
 * separator is whichever one has two digits behind it at the end.
 *
 * NaN for anything that is not one of those shapes -- a version number, an ID, a date --
 * so a stray line cannot put a nonsense total on screen.
 */
function toNumber(raw) {
  const s = raw.replace(/\s/g, '');
  if (/^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(s)) return parseFloat(s.replace(/\./g, '').replace(',', '.'));
  if (/^\d+,\d{1,2}$/.test(s)) return parseFloat(s.replace(',', '.'));
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(s)) return parseFloat(s.replace(/,/g, ''));
  if (/^\d+(?:\.\d{1,2})?$/.test(s)) return parseFloat(s);
  return NaN;
}

/**
 * The amount at the start of `text`, plus what follows it.
 * Returns `{ amount, currency, rest }`, or null if it does not start with one.
 */
function readAmount(text) {
  const m = AMOUNT.exec(text);
  if (!m) return null;
  const [matched, symbol, before, digits, after] = m;
  const amount = toNumber(digits);
  if (!(amount > 0) || amount > MAX_AMOUNT) return null;
  // A symbol prints in front of the number, a code after it. Kept as written rather than
  // mapped to one canonical currency: converting rates is not this overlay's job, and a
  // wrong conversion on screen is worse than the code the bot already used.
  const currency = symbol || (before || after || '').toUpperCase();
  return { amount, currency, rest: text.slice(matched.length) };
}

/** The cause named right after the amount, or '' when the money went to the streamer. */
function readCause(rest) {
  const m = CAUSE.exec(rest || '');
  if (!m) return '';
  const cause = m[1].trim().replace(/\s+/g, ' ');
  return NOT_A_CAUSE.has(cause.toLowerCase()) ? '' : cause;
}

/** The donor and the part of the line that should start with an amount. */
function readDonor(text) {
  const body = text.replace(LEAD, '');
  const led = LED_BY_NAME.exec(body);
  if (led) return { name: led[1], tail: led[2] };
  if (!MENTIONS_DONATION.test(text)) return null;
  const from = FROM_NAME.exec(body);
  if (from) return { name: from[1], tail: from[2] };
  const thanks = THANKS_FOR.exec(body);
  return thanks ? { name: thanks[1], tail: thanks[2] } : null;
}

/**
 * A credit from one bot announcement, or null for any other message.
 *
 * `type` is 'tip' or 'charity'. The donor's login is their name lowercased, which is what
 * merges a donation with the rest of what that person did this stream: on Twitch a
 * display name is the login with capitals, so the same viewer subbing and tipping is one
 * line in the reel rather than two. Somebody who tipped under an unrelated name simply
 * gets their own entry, which is the honest answer -- there is nothing in the message
 * that says who they are on Twitch.
 *
 * @param botLogin who posted the message
 * @param text     the message
 * @param extra    additional bot logins from `donationBots`, treated as tip bots
 */
export function toDonation(botLogin, text, extra = []) {
  const login = (botLogin || '').toLowerCase();
  const kind = DONATION_BOTS.get(login) || (extra.includes(login) ? 'tip' : '');
  if (!kind || !text) return null;

  const donor = readDonor(text);
  if (!donor) return null;

  const money = readAmount(donor.tail);
  if (!money) return null;

  // Trailing punctuation is the bot's sentence, not part of the name -- and a donor
  // stored as `alice.` would be a second entry for somebody already in the reel.
  const name = donor.name.trim().replace(/[.'"’]+$/, '');
  if (!name || ANONYMOUS.has(name.toLowerCase().replace(/[\s_-]/g, ''))) return null;

  const cause = readCause(money.rest);
  return {
    // A named cause makes it a charity donation whichever bot announced it: StreamLabs
    // Charity announces through the same bot as an ordinary tip, and the cause is the
    // only thing in the line that tells them apart.
    type: cause || kind === 'charity' ? 'charity' : 'tip',
    login: name.toLowerCase(),
    name,
    amount: money.amount,
    currency: money.currency,
    // Carried for the debug panel and for whatever reads this next. Nothing puts it on
    // screen: the heading already says charity, and a fundraiser's name does not fit the
    // detail column beside an amount.
    ...(cause ? { cause } : {}),
  };
}

export { DONATION_BOTS, ANONYMOUS, NOT_A_CAUSE, MAX_AMOUNT };
