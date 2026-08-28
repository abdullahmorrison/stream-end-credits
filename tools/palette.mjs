// Rewrites captured frames as palette PNGs sharing one palette, so the animation can
// afford enough frames to look like motion.
//
// The reel is flat dark background, white names, one purple heading colour and grey
// suffixes -- about a thousand distinct colours in a frame, and only ~140 once each
// channel is rounded to five bits. So there is no quantizer here worth the name: round
// the channels, collect what actually turns up, and if it fits in 256 entries the palette
// *is* the image's own colours. That turns three bytes a pixel into one, which is where
// the size goes -- 256 colours versus 64 barely moves it.
//
// This costs the animation nothing a reader can see and buys it roughly three times the
// frames. The stills are left alone: they are the image someone opens to read names off,
// and they are cheap because there is only one of each.

import fs from 'node:fs/promises';
import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Five bits a channel. Enough levels for the antialiasing ramps on text; few enough that
// a whole roll's worth of frames still shares one 256-entry palette.
const DROP = 3;

function chunks(buffer) {
  const out = [];
  let at = SIGNATURE.length;
  while (at < buffer.length) {
    const length = buffer.readUInt32BE(at);
    out.push({ type: buffer.toString('ascii', at + 4, at + 8), data: buffer.subarray(at + 8, at + 8 + length) });
    at += length + 12;
  }
  return out;
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(zlib.crc32(out.subarray(4, out.length - 4)), out.length - 4);
  return out;
}

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** One frame's pixels, three bytes each, filters undone. */
function decode(buffer) {
  const parts = chunks(buffer);
  const ihdr = parts.find((c) => c.type === 'IHDR').data;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  if (ihdr[8] !== 8 || ihdr[9] !== 2 || ihdr[12] !== 0) {
    // Playwright writes 8-bit truecolour, uninterlaced. Anything else means the capture
    // changed, and guessing at it would corrupt the animation rather than fail.
    throw new Error(`expected 8-bit RGB, got depth ${ihdr[8]} colour type ${ihdr[9]} interlace ${ihdr[12]}`);
  }

  const raw = zlib.inflateSync(Buffer.concat(parts.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  const stride = width * 3;
  const rgb = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = rgb.subarray(y * stride, (y + 1) * stride);
    const up = y ? rgb.subarray((y - 1) * stride, y * stride) : null;

    for (let x = 0; x < stride; x++) {
      const a = x >= 3 ? out[x - 3] : 0;
      const b = up ? up[x] : 0;
      const c = up && x >= 3 ? up[x - 3] : 0;
      const value =
        filter === 0 ? line[x]
        : filter === 1 ? line[x] + a
        : filter === 2 ? line[x] + b
        : filter === 3 ? line[x] + ((a + b) >> 1)
        : line[x] + paeth(a, b, c);
      out[x] = value & 0xff;
    }
  }

  return { width, height, rgb, parts };
}

// A colour rounded to five bits a channel, as one number, and back again. The expansion
// puts the top bits back in the low ones so full white stays full white.
const key = (r, g, b) => ((r >> DROP) << 10) | ((g >> DROP) << 5) | (b >> DROP);
const expand = (five) => (five << DROP) | (five >> (8 - 2 * DROP));

/**
 * Rewrite every frame as an indexed PNG sharing one palette.
 *
 * Two passes over the files rather than 300 decoded frames held in memory at once: the
 * first learns the colours, the second maps them.
 */
export async function palettize(files) {
  const counts = new Map();

  for (const file of files) {
    const { rgb } = decode(await fs.readFile(file));
    for (let i = 0; i < rgb.length; i += 3) {
      const k = key(rgb[i], rgb[i + 1], rgb[i + 2]);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }

  // If the reel ever does grow past 256 rounded colours -- a gradient behind the names,
  // say -- the commonest 256 win and the rest go to their nearest neighbour, which is a
  // worse picture but still a picture.
  const keys = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 256).map(([k]) => k);
  const palette = Buffer.alloc(keys.length * 3);
  keys.forEach((k, i) => {
    palette[i * 3] = expand((k >> 10) & 31);
    palette[i * 3 + 1] = expand((k >> 5) & 31);
    palette[i * 3 + 2] = expand(k & 31);
  });

  const lookup = new Int16Array(32768).fill(-1);
  keys.forEach((k, i) => { lookup[k] = i; });
  const nearest = (k) => {
    let best = 0;
    let distance = Infinity;
    const r = (k >> 10) & 31, g = (k >> 5) & 31, b = k & 31;
    keys.forEach((other, i) => {
      const d = ((other >> 10) & 31) - r;
      const e = ((other >> 5) & 31) - g;
      const f = (other & 31) - b;
      const total = d * d + e * e + f * f;
      if (total < distance) { distance = total; best = i; }
    });
    return best;
  };

  for (const file of files) {
    const { width, height, rgb } = decode(await fs.readFile(file));
    // A filter byte per row, then one palette index per pixel. Indexed rows are left
    // unfiltered: the values are palette positions, so the arithmetic filters do is
    // meaningless on them and deflate does better on the runs as they stand.
    const raw = Buffer.alloc((width + 1) * height);
    for (let y = 0; y < height; y++) {
      const row = y * (width + 1) + 1;
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 3;
        const k = key(rgb[i], rgb[i + 1], rgb[i + 2]);
        if (lookup[k] < 0) lookup[k] = nearest(k);
        raw[row + x] = lookup[k];
      }
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 3;
    await fs.writeFile(file, Buffer.concat([
      SIGNATURE,
      chunk('IHDR', ihdr),
      chunk('PLTE', palette),
      chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]));
  }

  return { colors: keys.length, overflow: counts.size > 256 };
}
