// The scene is the trigger.
//
// OBS's browser plugin dispatches events on `window` when a source goes on air and when
// streaming starts. Switching to the ending scene rolls the credits; switching away
// stops them. Nothing is typed in chat, which is the point -- the streamer's hand is
// already on the scene switcher at that moment.

const ACTIVE = 'obsSourceActiveChanged';
const VISIBLE = 'obsSourceVisibleChanged';
const STREAM_START = 'obsStreamingStarted';

/** Whether this page is running inside an OBS browser source at all. */
export function inOBS() {
  return typeof window !== 'undefined' && !!window.obsstudio;
}

/**
 * What should happen, given what the overlay is doing and what OBS just reported.
 * Returns 'roll' | 'stop' | 'reset' | null.
 *
 * Split out from the listeners because this is the part that can be wrong in a way
 * nobody notices until the credits misbehave on stream: a roll restarting from the top
 * halfway through, or a scene change quietly leaving the reel frozen on screen.
 */
export function nextAction(state, event) {
  if (!event) return null;
  if (event.type === 'stream-start') return 'reset';
  if (event.type !== 'scene') return null;

  // Re-entering the scene after a finished roll plays it again. Coming back to the
  // ending scene is a deliberate act, so a replay is what was meant.
  if (event.active) return state === 'rolling' ? null : 'roll';
  return state === 'rolling' ? 'stop' : null;
}

/**
 * Listens to OBS and calls `onEvent` with `{ type: 'scene', active }` or
 * `{ type: 'stream-start' }`.
 *
 * `active` and `visible` are not the same thing: in Studio Mode a source is *visible*
 * while its scene sits in preview, and rolling the credits there would burn them before
 * they ever went out. So active wins, and visible is only honoured on a build that never
 * sends active at all.
 */
export class ObsBridge extends EventTarget {
  constructor(target = typeof window !== 'undefined' ? window : null) {
    super();
    this.target = target;
    this.sawActive = false;
    this.lastEventName = '';
    this.listeners = [];
  }

  start(onEvent) {
    if (!this.target) return this;

    this.on(ACTIVE, (e) => {
      this.sawActive = true;
      onEvent({ type: 'scene', active: !!e.detail?.active });
    });

    this.on(VISIBLE, (e) => {
      if (this.sawActive) return;
      onEvent({ type: 'scene', active: !!e.detail?.visible });
    });

    this.on(STREAM_START, () => onEvent({ type: 'stream-start' }));

    return this;
  }

  on(name, handler) {
    const wrapped = (e) => {
      this.lastEventName = name;
      handler(e);
    };
    this.target.addEventListener(name, wrapped);
    this.listeners.push([name, wrapped]);
  }

  /**
   * Log every `obs*` event this build actually sends, with the plugin version. The
   * event names above are the documented ones, but they have moved between OBS
   * versions -- this is how you check against the OBS in front of you instead of
   * trusting the docs. Debug builds only.
   */
  trace(log = console.log) {
    if (!this.target) return this;
    log('obsstudio:', this.target.obsstudio?.pluginVersion ?? 'not in OBS');
    for (const name of [
      ACTIVE,
      VISIBLE,
      STREAM_START,
      'obsSceneChanged',
      'obsStreamingStopped',
      'obsRecordingStarted',
      'obsRecordingStopped',
    ]) {
      this.target.addEventListener(name, (e) => log(name, e.detail ?? ''));
    }
    return this;
  }

  stop() {
    for (const [name, handler] of this.listeners) {
      this.target.removeEventListener(name, handler);
    }
    this.listeners.length = 0;
  }
}

export { ACTIVE, VISIBLE, STREAM_START };
