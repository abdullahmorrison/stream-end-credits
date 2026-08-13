// Read-only Twitch chat over WebSocket.
//
// Anonymous access: a "justinfan" nickname needs no password, no OAuth and no bot
// account, which is what lets this whole overlay be a static page with no backend.
//
// Everything the credits need arrives here as IRC tags. Subs, resubs, gift subs and
// raids come as USERNOTICE; bits ride along on an ordinary PRIVMSG. Follows do not
// appear at all -- they exist only in EventSub, behind an OAuth token.

const ENDPOINT = 'wss://irc-ws.chat.twitch.tv:443';
const MAX_BACKOFF = 30000;
// Twitch PINGs roughly every five minutes, so on even the quietest channel something
// should arrive well inside this. Longer than that means the socket is gone.
const SILENCE_LIMIT = 360000;

const TAG_UNESCAPE = { '\\s': ' ', '\\:': ';', '\\\\': '\\', '\\r': '\r', '\\n': '\n' };

export function parseTags(raw) {
  const tags = {};
  for (const pair of raw.split(';')) {
    const eq = pair.indexOf('=');
    const key = eq === -1 ? pair : pair.slice(0, eq);
    const value = eq === -1 ? '' : pair.slice(eq + 1);
    tags[key] = value.replace(/\\[s:\\rn]/g, (m) => TAG_UNESCAPE[m] ?? m);
  }
  return tags;
}

/**
 * Parse one IRC line into `{ kind, login, tags, text }`, or null for anything this
 * overlay does not read.
 *
 * Shape: `@tags :nick!user@host COMMAND #channel :text`
 *
 * Only the envelope is decoded here. What a USERNOTICE actually means lives in
 * events.js, so the socket layer never has to know what a gift sub is.
 */
export function parseLine(line) {
  let rest = line;
  let tags = {};

  if (rest.startsWith('@')) {
    const sp = rest.indexOf(' ');
    if (sp === -1) return null;
    tags = parseTags(rest.slice(1, sp));
    rest = rest.slice(sp + 1);
  }

  let prefix = '';
  if (rest.startsWith(':')) {
    const sp = rest.indexOf(' ');
    if (sp === -1) return null;
    prefix = rest.slice(1, sp);
    rest = rest.slice(sp + 1);
  }

  const kind = rest.startsWith('PRIVMSG ')
    ? 'privmsg'
    : rest.startsWith('USERNOTICE ')
      ? 'usernotice'
      : null;
  if (!kind) return null;

  // A USERNOTICE often has no trailing text at all -- a gift sub carries everything in
  // its tags. Only PRIVMSG is required to have a message body.
  const textAt = rest.indexOf(' :');
  const text = textAt === -1 ? '' : rest.slice(textAt + 2);
  if (kind === 'privmsg' && textAt === -1) return null;

  // On a USERNOTICE the prefix is tmi.twitch.tv, not the person -- their login is in
  // the `login` tag instead. Falling back to the prefix would credit "tmi" for every
  // sub on the channel.
  const login = (tags.login || prefix.split('!')[0] || '').toLowerCase();

  return {
    kind,
    login,
    displayName: tags['display-name'] || login,
    text,
    tags,
  };
}

export class TwitchChat extends EventTarget {
  constructor(channel) {
    super();
    this.channel = channel;
    this.socket = null;
    this.attempts = 0;
    this.closed = false;
    this.retryTimer = null;
    this.silenceTimer = null;
  }

  connect() {
    this.closed = false;
    this.open();
  }

  open() {
    this.setStatus('connecting');
    let socket;
    try {
      socket = new WebSocket(ENDPOINT);
    } catch {
      this.retry();
      return;
    }
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.attempts = 0;
      // No PASS is needed for an anonymous read-only connection. `commands` is what
      // delivers USERNOTICE, so without it no sub or raid would ever be seen.
      // membership is deliberately not requested: it only adds JOIN/PART noise for
      // every viewer.
      socket.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      socket.send(`NICK justinfan${10000 + Math.floor(Math.random() * 89999)}`);
      socket.send(`JOIN #${this.channel}`);
      this.setStatus('connected');
      this.expectTraffic(socket);
    });

    socket.addEventListener('message', (event) => {
      this.expectTraffic(socket);
      for (const line of event.data.split('\r\n')) {
        if (!line) continue;
        if (line.startsWith('PING')) {
          socket.send('PONG :tmi.twitch.tv');
          continue;
        }
        const message = parseLine(line);
        if (message) {
          this.dispatchEvent(new CustomEvent('line', { detail: message }));
        }
      }
    });

    socket.addEventListener('close', () => {
      clearTimeout(this.silenceTimer);
      if (!this.closed) this.retry();
    });
    socket.addEventListener('error', () => socket.close());
  }

  /**
   * Watchdog for a socket that has stopped delivering without closing.
   *
   * A half-open connection -- the far side gone, no FIN ever seen -- fires neither
   * `close` nor `error`, so nothing here would reconnect it. The overlay would keep
   * reporting "connected" while silently collecting nothing for the rest of the
   * stream, and the credits at the end would be empty with no error anywhere. Closing
   * it ourselves hands it to the existing retry path.
   */
  expectTraffic(socket) {
    clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => {
      if (this.socket === socket && !this.closed) socket.close();
    }, SILENCE_LIMIT);
  }

  // Twitch resets connections periodically over a long stream. This source stays
  // loaded for the whole thing, so it will hit that reset most streams.
  retry() {
    this.setStatus('reconnecting');
    this.attempts++;
    const backoff = Math.min(MAX_BACKOFF, 1000 * 2 ** (this.attempts - 1));
    const delay = backoff * (0.6 + Math.random() * 0.6);
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.open(), delay);
  }

  setStatus(status) {
    this.status = status;
    this.dispatchEvent(new CustomEvent('status', { detail: status }));
  }

  close() {
    this.closed = true;
    clearTimeout(this.retryTimer);
    clearTimeout(this.silenceTimer);
    if (this.socket) this.socket.close();
  }
}

export { SILENCE_LIMIT };
