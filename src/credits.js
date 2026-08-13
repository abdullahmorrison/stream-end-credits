// The roll itself.
//
// DOM and CSS rather than a canvas: this is text in columns, which the browser already
// lays out for free and which would be a font-metrics project to redo by hand. There
// are no particles here to justify pixels.
//
// The scroll is driven by rAF rather than a CSS animation because the distance is not
// known until the reel has been measured, and because it has to stop cleanly the
// instant the scene changes away -- mid-roll, at whatever position it reached.

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class CreditsReel {
  constructor({ root, config }) {
    this.root = root;
    this.config = config;
    this.reel = null;
    this.state = 'idle';
    this.frame = 0;
    this.last = 0;
    this.y = 0;
    this.distance = 0;
    this.speed = config.speed;
  }

  get rolling() {
    return this.state === 'rolling';
  }

  /**
   * Build the reel from `sections` and start scrolling.
   *
   * `note` replaces the name list when there is nothing to show, so an empty roster
   * says why instead of rolling a blank screen past the viewer.
   */
  roll(sections, { note = '' } = {}) {
    this.stop();

    this.reel = el('div', 'reel');
    this.reel.appendChild(this.titleCard());
    for (const section of sections) this.reel.appendChild(this.section(section));
    if (note) this.reel.appendChild(this.note(note));
    this.reel.appendChild(this.endCard());
    this.root.appendChild(this.reel);

    // Measured after it is in the document, once, and never again during the roll.
    const height = this.reel.offsetHeight;
    const viewport = this.root.clientHeight;

    // Starts fully below the frame and ends fully above it, so no name is ever on
    // screen at the start or the end of the roll.
    this.y = viewport;
    this.distance = viewport + height;
    // A fixed runtime is a speed once the height is known. Without a `duration` the
    // pace is constant instead, so a busy stream simply takes longer to thank and every
    // name is on screen for the same length of time.
    this.speed = this.config.duration
      ? this.distance / this.config.duration
      : this.config.speed;

    this.state = 'rolling';
    this.last = performance.now();
    this.frame = requestAnimationFrame(this.tick);
    return this;
  }

  tick = (now) => {
    if (!this.rolling) return;
    // Clamped: OBS suspends rAF for a hidden source, so the first frame after the scene
    // comes back can carry an enormous delta that would jump the reel past the end.
    const dt = Math.min(100, Math.max(0, now - this.last));
    this.last = now;

    this.y -= (this.speed * dt) / 1000;
    this.reel.style.transform = `translate3d(0, ${this.y.toFixed(2)}px, 0)`;

    if (this.y <= -(this.distance - this.root.clientHeight)) {
      this.finish();
      return;
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  finish() {
    this.state = 'idle';
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    // Left in place at the end position: the last card has already scrolled off, and
    // tearing the DOM down here would be a layout pass during the fade to whatever
    // comes next.
    this.root.dispatchEvent(new CustomEvent('credits-finished'));
  }

  /** Stop wherever it is and clear the screen. Safe to call when nothing is rolling. */
  stop() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.state = 'idle';
    if (this.reel) {
      this.reel.remove();
      this.reel = null;
    }
  }

  titleCard() {
    const card = el('div', 'card card-title');
    card.appendChild(el('h1', null, this.config.title));
    if (this.config.channel) card.appendChild(el('p', 'channel', this.config.channel));
    return card;
  }

  endCard() {
    const card = el('div', 'card card-end');
    card.appendChild(el('p', null, 'See you next time'));
    return card;
  }

  note(text) {
    const card = el('div', 'card card-note');
    card.appendChild(el('p', null, text));
    return card;
  }

  section({ title, names }) {
    const node = el('section', 'section');
    node.appendChild(el('h2', null, title));

    const list = el('ul', 'names');
    // A short list in three columns reads as a broken grid, so the column count drops
    // to fit rather than leaving two of them empty.
    list.style.setProperty('--columns', Math.min(this.config.columns, names.length));

    for (const { name, detail } of names) {
      const item = el('li');
      item.appendChild(el('span', 'name', name));
      if (detail) item.appendChild(el('span', 'detail', detail));
      list.appendChild(item);
    }

    node.appendChild(list);
    return node;
  }
}
