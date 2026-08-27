// Turns a capture into the markdown that goes on the pull request.
//
// Separate from the capture so the comment can be looked at without running a browser
// (`DEMO_BASE_URL=... node tools/demo-comment.mjs`) and so the workflow yaml stays a list
// of steps rather than a program written inside a string.

import fs from 'node:fs/promises';
import path from 'node:path';

// How the images are found again in the comment. They are pushed to a branch, and the
// commit sha is in the path on purpose: GitHub proxies and caches images by URL, so
// reusing one would leave the last push's reel sitting under this push's comment.
const BASE = process.env.DEMO_BASE_URL || '.';
const OUT = path.resolve(process.env.DEMO_OUT || 'demo-out');

// Lets the workflow find its own comment again on the next push instead of adding a
// second one. Invisible in the rendered comment.
const MARKER = '<!-- credits-demo -->';

const src = (file) => `${BASE.replace(/\/$/, '')}/${file}`;

function summary(variant) {
  return [
    `${variant.names} names`,
    `${variant.reelHeight}px tall`,
    `${variant.seconds}s at speed=${variant.speed}`,
  ].join(' · ');
}

const report = JSON.parse(await fs.readFile(path.join(OUT, 'demo.json'), 'utf8'));
const [first, ...rest] = report.variants;
const lines = [MARKER, '## 🎬 Credits demo', ''];

if (report.roll) {
  lines.push(
    `<img src="${src(report.roll.file)}" width="640" alt="The credits rolling">`,
    '',
    `<sub>The whole ${report.roll.seconds}s roll, ${report.roll.frames} frames at ${report.roll.fps}fps.` +
      ' Real overlay, headless Chromium, the built-in demo roster.</sub>',
    '',
  );
}

lines.push(
  '| Variant | Sections | Names | Reel height | Roll time |',
  '|---|--:|--:|--:|--:|',
  ...report.variants.map(
    (v) => `| ${v.label} | ${v.sections.length} | ${v.names} | ${v.reelHeight}px | ${v.seconds}s |`,
  ),
  '',
  // The stills are 1920 wide and taller than the page. Inline they show the shape of the
  // reel -- which sections, how the columns fell, where it got long -- and a click gets
  // the full size for anything closer than that.
  `### ${first.label}`,
  '',
  `<sub>${summary(first)} · <code>${first.url}</code></sub>`,
  '',
  `<img src="${src(first.file)}" width="420" alt="${first.label}">`,
  '',
);

for (const variant of rest) {
  lines.push(
    '<details>',
    `<summary><b>${variant.label}</b> — ${summary(variant)}</summary>`,
    '',
    `<sub><code>${variant.url}</code></sub>`,
    '',
    `<img src="${src(variant.file)}" width="420" alt="${variant.label}">`,
    '',
    '</details>',
    '',
  );
}

if (report.errors.length) {
  lines.push(
    '> [!WARNING]',
    '> The overlay logged errors while it rolled:',
    '>',
    ...report.errors.map((e) => `> - \`${e.replace(/`/g, "'").split('\n')[0]}\``),
    '',
  );
}

const body = `${lines.join('\n')}\n`;
await fs.writeFile(path.join(OUT, 'comment.md'), body);
process.stdout.write(body);
