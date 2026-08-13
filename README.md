# 🎬 Stream end credits

Thank everyone who showed up, as film credits, at the end of your stream.

The overlay watches your chat all stream and quietly collects everyone who subscribed,
gifted a sub, raided you or cheered. When you switch to your ending scene, the credits
roll. Switch away and they stop. Nothing is typed in chat — your hand is already on the
scene switcher.

## For the streamer

Add one **Browser Source** to your ending scene. That's the whole setup.

1. Go to the scene you switch to at the end of your stream
2. **Sources → + → Browser**
3. Paste your link, set **Width 1920**, **Height 1080**
4. **Untick "Shutdown source when not visible"**, then click OK

No download, no login, no account to connect, nothing to install.

```
https://abdullahmorrison.github.io/stream-end-credits/credits.html?channel=YOUR_CHANNEL
```

Or get the link, and pick how it looks, from the setup page:

```
https://abdullahmorrison.github.io/stream-end-credits/?channel=YOUR_CHANNEL
```

### Step 4 is the one that matters

The overlay only collects while it is loaded. Ticking "Shutdown source when not
visible" means it starts the moment you switch to the ending scene — after the stream it
is meant to be thanking. The credits roll empty and nothing tells you why until it is
already on screen.

Leave it unticked and OBS keeps the source running behind your other scenes, costing
nothing: the page does no work at all between the chat messages it reads.

If you reload the source while the ending scene is already up, switch away and back.
OBS reports scene *changes*, not the current scene, so a page that has just loaded has
no way to know what is showing — and guessing wrong would roll your credits mid-stream.

## What gets credited

| Section | Who |
|---|---|
| Raided by | Anyone who raided you, with how many they brought |
| New subscribers | New subs, and everyone who was gifted one |
| Still here | Resubs, with their month count |
| Gifted subs | Gifters, with how many they gave |
| Cheered | Bits, added up per person |
| First time in chat | Optional (`firsts=on`) — people talking for the first time |

Empty sections are left out, so a stream with no raids shows no "Raided by" heading.

**Follows are not in this list.** They are the one thing Twitch does not put in chat.
Reading them needs an OAuth login, per streamer, that expires after a few hours with no
way to renew itself — so the failure mode is signing in again on a Tuesday and finding
out on Friday that the credits were empty. Everything else above arrives free, with no
login at all, which is what keeps this a link you paste into OBS once.

## How it works

The page connects straight to Twitch chat over WebSocket using an anonymous `justinfan`
nickname. That needs no OAuth, no token and no bot account, which is what lets the whole
thing be a static site with no backend — free to host and nothing to keep running.

Subs, resubs, gift subs and raids arrive as `USERNOTICE` lines with everything in their
IRC tags; bits ride along on an ordinary message. Twitch even flags a first-ever message
for us, so the overlay needs no memory of who has spoken before.

The roster is written to `localStorage` every couple of seconds. That is what makes a
browser-source refresh, a cache clear or an OBS restart survivable — without it, one
refresh two hours into a stream silently empties the credits. A stored roster older than
`sessionHours` is discarded rather than rolled, so last week's names never turn up.

The roll is DOM and CSS, not a canvas: it is text in columns, which the browser lays out
for free. The scroll is driven by `requestAnimationFrame` rather than a CSS animation,
because the distance is not known until the reel has been measured and because it has to
stop cleanly the instant the scene changes away. The loop does not run when nothing is
rolling.

### The scene as the trigger

OBS's browser plugin dispatches events on `window`. This listens for
`obsSourceActiveChanged` to start and stop the roll, and `obsStreamingStarted` to begin
a fresh session.

*Active*, not *visible*: in Studio Mode a source is visible while its scene sits in
preview, and rolling the credits there would burn them before they ever went out.
`obsSourceVisibleChanged` is used only as a fallback, on a build that never sends active
at all.

Outside OBS there is no `window.obsstudio` and nothing will ever report a scene, so the
overlay rolls on load. That is what makes the local server and the setup preview work.

## Settings

All settings live in the overlay URL — the setup page writes them for you.

| Param | Default | Meaning |
|---|---|---|
| `channel` | *(required)* | Twitch channel to read |
| `title` | `Thank you for watching` | Heading on the opening card. Empty for none |
| `speed` | `90` | Scroll pace in pixels per second |
| `duration` | *(off)* | Fixed runtime in seconds. Overrides `speed` |
| `columns` | `3` | Columns of names. Drops automatically for a short list |
| `firsts` | `off` | Include first-time chatters |
| `sessionHours` | `12` | How old a stored roster may be before it is discarded |
| `backdrop` | `0` | Dim behind the credits, `0`–`1`. Transparent by default |
| `debug` | `off` | Status panel plus keyboard tests |
| `demo` | `off` | Rolls a made-up roster, so the reel can be watched without a stream |

`speed` keeps every name on screen for the same length of time, so a busy stream simply
takes longer to thank. `duration` fits the whole roll into a fixed runtime instead,
which means a long list scrolls faster.

## Development

```
node serve.js       # http://localhost:4748
npm test            # parsing, roster and config logic
```

No dependencies and no build step — the files in this repo are the deployed site.

`window.obsstudio` is absent in a normal browser, so the overlay rolls on load:

```
http://localhost:4748/credits.html?channel=tenzinniznet&demo=on&debug=on
```

With `debug=on` the panel shows live state, and `bridge.trace()` logs every `obs*` event
the OBS in front of you actually sends, with its plugin version — which is how to check
the event names rather than trusting the docs.

| Key | Does |
|---|---|
| `R` | Roll the credits |
| `C` | Stop |
| `F` | Add one made-up credit |
| `X` | Clear the roster and start a new session |

If OBS runs on Windows while this serves from WSL, `localhost` forwards automatically —
no extra setup.

## Notes

A community gift bomb is announced twice: once as `submysterygift` carrying the real
total, then as one ordinary `subgift` per recipient from the same login. Counting both
shows a gifter as having given double what they did, with nothing anywhere to say so.
The batch is treated as authoritative and the follow-ups only credit their recipients.

Twitch recommends EventSub for new chat integrations, but that needs OAuth *and* a
server. Anonymous IRC works today and has no announced end-of-life; if it were ever
withdrawn, only `src/irc.js` would change, though the replacement would cost the
zero-setup install.
