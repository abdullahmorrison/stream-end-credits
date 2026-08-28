// Stitches a run of same-sized PNGs into one animated PNG.
//
// This exists so the demo needs nothing installed. The obvious way to make an animation
// out of frames is ffmpeg, but the ffmpeg Playwright ships is built for its own video
// recording and has no gif encoder at all, so using it means `apt-get install ffmpeg` on
// every CI run: a download, a network dependency, and a second thing to keep working.
//
// APNG costs about a hundred lines instead, because nothing is decoded here: an APNG is a
// PNG whose frames are the same IDAT bytes the encoder already produced, re-tagged.
// GitHub renders it inline, and a browser that will not animate it shows frame one, which
// is a still of the reel.
//
// The frames arrive already palettized (`palette.mjs`). That is a gif-shaped compromise
// made deliberately and on this project's own terms -- 256 colours the reel actually
// uses, chosen from the whole roll at once -- because bytes per frame are what decide how
// many frames there can be, and too few frames is an animation that hurts to watch.

import fs from 'node:fs/promises';
import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type, body) {
  const out = Buffer.alloc(body.length + 12);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'ascii');
  body.copy(out, 8);
  out.writeUInt32BE(zlib.crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

/** Every chunk in a PNG, in order, as {type, body}. */
function chunks(buf) {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  const out = [];
  let at = 8;
  while (at < buf.length) {
    const length = buf.readUInt32BE(at);
    out.push({ type: buf.toString('ascii', at + 4, at + 8), body: buf.subarray(at + 8, at + 8 + length) });
    at += length + 12;
  }
  return out;
}

/**
 * @param files  frame paths, in order
 * @param out    where the animation goes
 * @param delay  frame time as a fraction, e.g. {num: 1, den: 12} for 12fps
 */
export async function writeApng(files, out, { delay = { num: 1, den: 12 }, plays = 0 } = {}) {
  if (!files.length) throw new Error('no frames');

  let header = null;
  // Undefined until the first frame has been looked at; null once it has and it had none.
  let palette;
  const frames = [];

  for (const file of files) {
    const parsed = chunks(await fs.readFile(file));
    const ihdr = parsed.find((c) => c.type === 'IHDR');
    const idat = parsed.filter((c) => c.type === 'IDAT').map((c) => c.body);

    // Frames are re-tagged, not re-encoded, so a frame that disagrees about size, bit
    // depth or colour type cannot be dropped in beside the others. Chromium encodes every
    // screenshot the same way, so this is a guard against a future surprise rather than a
    // case to handle -- and a wrong-looking animation is worse than a stopped run.
    if (!header) header = ihdr.body;
    else if (!header.equals(ihdr.body)) throw new Error(`${file} does not match the first frame`);

    // Palette frames are stitched too, and the palette is the animation's, not the
    // frame's: an APNG has one PLTE for the whole file. `palettize` gives every frame the
    // same one, so agreeing here is the check that it did.
    const plte = parsed.find((c) => c.type === 'PLTE')?.body ?? null;
    if (palette === undefined) palette = plte;
    else if (Boolean(plte) !== Boolean(palette) || (plte && !palette.equals(plte))) {
      throw new Error(`${file} has a different palette to the first frame`);
    }

    frames.push(Buffer.concat(idat));
  }

  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);

  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(frames.length, 0);
  actl.writeUInt32BE(plays, 4);

  // Every frame is a full picture of the whole canvas, so each one replaces what came
  // before rather than being composited onto it: dispose NONE (0), blend SOURCE (0).
  const fctl = (sequence) => {
    const body = Buffer.alloc(26);
    body.writeUInt32BE(sequence, 0);
    body.writeUInt32BE(width, 4);
    body.writeUInt32BE(height, 8);
    body.writeUInt32BE(0, 12);
    body.writeUInt32BE(0, 16);
    body.writeUInt16BE(delay.num, 20);
    body.writeUInt16BE(delay.den, 22);
    body.writeUInt8(0, 24);
    body.writeUInt8(0, 25);
    return chunk('fcTL', body);
  };

  const parts = [SIGNATURE, chunk('IHDR', header)];
  if (palette) parts.push(chunk('PLTE', palette));
  parts.push(chunk('acTL', actl));

  // The first frame is a plain IDAT: it is the still any reader that ignores the
  // animation chunks will show.
  let sequence = 0;
  parts.push(fctl(sequence++));
  parts.push(chunk('IDAT', frames[0]));

  for (const data of frames.slice(1)) {
    parts.push(fctl(sequence++));
    const body = Buffer.alloc(4 + data.length);
    body.writeUInt32BE(sequence++, 0);
    data.copy(body, 4);
    parts.push(chunk('fdAT', body));
  }

  parts.push(chunk('IEND', Buffer.alloc(0)));
  await fs.writeFile(out, Buffer.concat(parts));

  return { width, height, frames: frames.length };
}
