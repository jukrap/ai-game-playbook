import { deflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const body = Buffer.from(data);
  const chunk = Buffer.alloc(12 + body.length);
  chunk.writeUInt32BE(body.length, 0);
  name.copy(chunk, 4);
  body.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([name, body])), 8 + body.length);
  return chunk;
}

export function rgbaPng({
  width = 2,
  height = 1,
  filter = 0,
  interlace = 0,
  compressed,
  beforeIdatChunks = [],
} = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = interlace;
  const rows = [];
  for (let row = 0; row < height; row++) {
    rows.push(Buffer.from([filter, ...new Array(width * 4).fill(0x7f)]));
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    ...beforeIdatChunks.map(({ type, data = Buffer.alloc(0) }) =>
      pngChunk(type, data),
    ),
    pngChunk("IDAT", compressed ?? deflateSync(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function packIndexedSamples(samples, bitDepth) {
  const samplesPerByte = 8 / bitDepth;
  const mask = (1 << bitDepth) - 1;
  const packed = Buffer.alloc(Math.ceil(samples.length / samplesPerByte));
  for (let index = 0; index < samples.length; index++) {
    const byteIndex = Math.floor(index / samplesPerByte);
    const shift = 8 - bitDepth - (index % samplesPerByte) * bitDepth;
    packed[byteIndex] |= (samples[index] & mask) << shift;
  }
  return packed;
}

export function indexedPng({
  width = 2,
  height = 1,
  bitDepth = 8,
  paletteEntries = 2,
  indices = [0, 1],
} = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = 3;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const palette = Buffer.alloc(paletteEntries * 3, 0x7f);
  const rows = [];
  for (let row = 0; row < height; row++) {
    rows.push(
      Buffer.concat([
        Buffer.from([0]),
        packIndexedSamples(indices.slice(row * width, (row + 1) * width), bitDepth),
      ]),
    );
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("PLTE", palette),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
