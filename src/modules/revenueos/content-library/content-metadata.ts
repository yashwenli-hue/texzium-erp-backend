import { promises as fs } from 'fs';

// Removing location data from uploaded files before they are stored.
//
// Images: the GPS directory of the EXIF block is emptied (every GPS value and entry is
// overwritten with zeros) while the rest of EXIF, in particular the orientation, is
// kept, so photos still display the right way up. XMP and IPTC blocks, which can repeat
// the location, are removed. An EXIF block that cannot be read safely is removed whole.
// MP4: the user-data and metadata boxes (udta, meta, XMP uuid), where cameras and phones
// record the location, are turned into "free" boxes and zeroed, in place: no offset in
// the file moves, so the video plays exactly as before.
//
// Each function reports what it removed ("gps", "exif", "xmp", "iptc", "mp4-metadata"),
// which is recorded on the stored file.

export class ContentFormatError extends Error {}

export type StrippedImage = {
  data: Buffer;
  removed: string[];
  width: number | null;
  height: number | null;
};

// ---- EXIF (TIFF) --------------------------------------------------------------------

const TIFF_TYPE_SIZE: Record<number, number> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  6: 1,
  7: 1,
  8: 2,
  9: 4,
  10: 8,
  11: 4,
  12: 8,
  13: 4,
};
const GPS_IFD_TAG = 0x8825;

// Empties the GPS IFD of the TIFF structure in `tiff`, in place. Returns true when a
// GPS IFD was found and emptied, false when there is none; throws when the structure
// cannot be read safely (the caller then removes the whole block).
export function zeroExifGps(tiff: Buffer): boolean {
  if (tiff.length < 8) throw new ContentFormatError('short TIFF header');
  const order = tiff.toString('latin1', 0, 2);
  const le = order === 'II';
  if (!le && order !== 'MM')
    throw new ContentFormatError('bad TIFF byte order');
  const u16 = (o: number) => {
    if (o < 0 || o + 2 > tiff.length)
      throw new ContentFormatError('TIFF out of range');
    return le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o);
  };
  const u32 = (o: number) => {
    if (o < 0 || o + 4 > tiff.length)
      throw new ContentFormatError('TIFF out of range');
    return le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o);
  };
  if (u16(2) !== 42) throw new ContentFormatError('bad TIFF magic');

  const ifd0 = u32(4);
  const n0 = u16(ifd0);
  let gpsOffset: number | null = null;
  for (let i = 0; i < n0; i++) {
    const entry = ifd0 + 2 + i * 12;
    if (u16(entry) === GPS_IFD_TAG) gpsOffset = u32(entry + 8);
  }
  if (gpsOffset === null) return false;

  const n = u16(gpsOffset);
  const entriesEnd = gpsOffset + 2 + n * 12;
  if (entriesEnd > tiff.length)
    throw new ContentFormatError('GPS IFD out of range');
  for (let i = 0; i < n; i++) {
    const entry = gpsOffset + 2 + i * 12;
    const size = (TIFF_TYPE_SIZE[u16(entry + 2)] ?? 1) * u32(entry + 4);
    if (size > 4) {
      const at = u32(entry + 8);
      if (at + size > tiff.length)
        throw new ContentFormatError('GPS value out of range');
      tiff.fill(0, at, at + size);
    }
  }
  // no entries left; the next-IFD pointer that follows the (now empty) list reads 0
  tiff.fill(0, gpsOffset, entriesEnd);
  if (entriesEnd + 4 <= tiff.length) tiff.fill(0, entriesEnd, entriesEnd + 4);
  return true;
}

// ---- JPEG --------------------------------------------------------------------------

const EXIF_HEADER = Buffer.from('Exif\0\0', 'latin1');
const XMP_HEADERS = [
  Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1'),
  Buffer.from('http://ns.adobe.com/xmp/extension/\0', 'latin1'),
];

export function stripJpeg(input: Buffer): StrippedImage {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) {
    throw new ContentFormatError('not a JPEG');
  }
  const out: Buffer[] = [input.subarray(0, 2)];
  const removed = new Set<string>();
  let width: number | null = null;
  let height: number | null = null;
  let p = 2;

  while (p < input.length) {
    if (input[p] !== 0xff) throw new ContentFormatError('JPEG marker expected');
    const marker = input[p + 1];
    if (marker === 0xff) {
      // fill byte
      p += 1;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) {
      // EOI, or start of scan: everything from here on is image data, kept as it is
      out.push(input.subarray(p));
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(input.subarray(p, p + 2));
      p += 2;
      continue;
    }
    if (p + 4 > input.length) throw new ContentFormatError('truncated JPEG');
    const length = input.readUInt16BE(p + 2);
    const end = p + 2 + length;
    if (length < 2 || end > input.length)
      throw new ContentFormatError('bad JPEG segment');
    const segment = input.subarray(p, end);
    const payload = input.subarray(p + 4, end);

    if (marker === 0xe1 && payload.subarray(0, 6).equals(EXIF_HEADER)) {
      const copy = Buffer.from(segment);
      try {
        if (zeroExifGps(copy.subarray(4 + 6))) removed.add('gps');
        out.push(copy);
      } catch {
        removed.add('exif');
      }
    } else if (
      marker === 0xe1 &&
      XMP_HEADERS.some((h) => payload.subarray(0, h.length).equals(h))
    ) {
      removed.add('xmp');
    } else if (marker === 0xed) {
      removed.add('iptc');
    } else {
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc &&
        length >= 7
      ) {
        height = input.readUInt16BE(p + 5);
        width = input.readUInt16BE(p + 7);
      }
      out.push(segment);
    }
    p = end;
  }

  return { data: Buffer.concat(out), removed: [...removed], width, height };
}

// ---- PNG ---------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
export function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function stripPng(input: Buffer): StrippedImage {
  if (!input.subarray(0, 8).equals(PNG_SIGNATURE))
    throw new ContentFormatError('not a PNG');
  const out: Buffer[] = [PNG_SIGNATURE];
  const removed = new Set<string>();
  let width: number | null = null;
  let height: number | null = null;
  let p = 8;
  let ended = false;

  while (!ended) {
    if (p + 12 > input.length) throw new ContentFormatError('truncated PNG');
    const length = input.readUInt32BE(p);
    const type = input.toString('latin1', p + 4, p + 8);
    const end = p + 12 + length;
    if (end > input.length) throw new ContentFormatError('bad PNG chunk');
    const data = input.subarray(p + 8, p + 8 + length);

    if (type === 'IHDR' && length >= 8) {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    }
    if (type === 'eXIf') {
      const copy = Buffer.from(data);
      try {
        if (zeroExifGps(copy)) removed.add('gps');
        const chunk = Buffer.alloc(12 + length);
        chunk.writeUInt32BE(length, 0);
        chunk.write('eXIf', 4, 'latin1');
        copy.copy(chunk, 8);
        chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + length)), 8 + length);
        out.push(chunk);
      } catch {
        removed.add('exif');
      }
    } else if (
      (type === 'iTXt' || type === 'tEXt' || type === 'zTXt') &&
      data.toString('latin1', 0, 18) === 'XML:com.adobe.xmp\0'
    ) {
      removed.add('xmp');
    } else {
      out.push(input.subarray(p, end));
    }
    if (type === 'IEND') ended = true;
    p = end;
  }

  return { data: Buffer.concat(out), removed: [...removed], width, height };
}

// ---- WebP --------------------------------------------------------------------------

export function stripWebp(input: Buffer): StrippedImage {
  if (
    input.length < 12 ||
    input.toString('latin1', 0, 4) !== 'RIFF' ||
    input.toString('latin1', 8, 12) !== 'WEBP'
  ) {
    throw new ContentFormatError('not a WebP');
  }
  const riffEnd = Math.min(input.length, 8 + input.readUInt32LE(4));
  const chunks: Buffer[] = [];
  const removed = new Set<string>();
  let width: number | null = null;
  let height: number | null = null;
  let vp8xIndex = -1;
  let p = 12;

  while (p + 8 <= riffEnd) {
    const type = input.toString('latin1', p, p + 4);
    const size = input.readUInt32LE(p + 4);
    const end = p + 8 + size + (size % 2);
    if (p + 8 + size > riffEnd) throw new ContentFormatError('bad WebP chunk');
    const data = input.subarray(p + 8, p + 8 + size);
    const whole = Buffer.from(input.subarray(p, Math.min(end, riffEnd)));

    if (type === 'VP8X' && size >= 10) {
      vp8xIndex = chunks.length;
      width = 1 + data.readUIntLE(4, 3);
      height = 1 + data.readUIntLE(7, 3);
      chunks.push(whole);
    } else if (type === 'VP8 ' && size >= 10 && width === null) {
      width = data.readUInt16LE(6) & 0x3fff;
      height = data.readUInt16LE(8) & 0x3fff;
      chunks.push(whole);
    } else if (type === 'VP8L' && size >= 5 && width === null) {
      const bits = data.readUInt32LE(1);
      width = (bits & 0x3fff) + 1;
      height = ((bits >> 14) & 0x3fff) + 1;
      chunks.push(whole);
    } else if (type === 'EXIF') {
      const offset = whole.subarray(8, 14).equals(EXIF_HEADER) ? 14 : 8;
      try {
        if (zeroExifGps(whole.subarray(offset, 8 + size))) removed.add('gps');
        chunks.push(whole);
      } catch {
        removed.add('exif');
      }
    } else if (type === 'XMP ') {
      removed.add('xmp');
    } else {
      chunks.push(whole);
    }
    p = end;
  }

  if (vp8xIndex >= 0) {
    // the VP8X flags say which optional chunks exist: clear the ones that are gone
    const flags = chunks[vp8xIndex];
    if (removed.has('xmp')) flags[8] &= ~0x04;
    if (removed.has('exif')) flags[8] &= ~0x08;
  }
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(4 + body.length, 4);
  header.write('WEBP', 8, 'latin1');
  return {
    data: Buffer.concat([header, body]),
    removed: [...removed],
    width,
    height,
  };
}

// ---- MP4 ---------------------------------------------------------------------------

const XMP_UUID = Buffer.from('be7acfcb97a942e89c71999491e3afac', 'hex');
const MAX_MOOV_BYTES = 64 * 1024 * 1024;

type Box = { type: string; start: number; header: number; size: number };

// The boxes laid out in buf[from, to). Throws when a box does not fit.
function boxesIn(buf: Buffer, from: number, to: number): Box[] {
  const boxes: Box[] = [];
  let p = from;
  while (p + 8 <= to) {
    let size = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    let header = 8;
    if (size === 1) {
      if (p + 16 > to) throw new ContentFormatError('truncated MP4 box');
      size = Number(buf.readBigUInt64BE(p + 8));
      header = 16;
    } else if (size === 0) {
      size = to - p;
    }
    if (size < header || p + size > to)
      throw new ContentFormatError('bad MP4 box');
    boxes.push({ type, start: p, header, size });
    p += size;
  }
  if (p !== to) throw new ContentFormatError('trailing bytes in MP4 box');
  return boxes;
}

// Turns a box into a zero-filled "free" box of the same size.
function neutralise(buf: Buffer, box: Box) {
  buf.write('free', box.start + 4, 'latin1');
  buf.fill(0, box.start + box.header, box.start + box.size);
}

// Neutralises the metadata boxes of a movie box body (and of its tracks). Returns
// whether anything changed.
function stripMovie(moov: Buffer): boolean {
  let changed = false;
  const walk = (from: number, to: number) => {
    for (const box of boxesIn(moov, from, to)) {
      if (box.type === 'udta' || box.type === 'meta') {
        neutralise(moov, box);
        changed = true;
      } else if (box.type === 'trak') {
        walk(box.start + box.header, box.start + box.size);
      }
    }
  };
  walk(0, moov.length);
  return changed;
}

async function readAt(handle: fs.FileHandle, position: number, length: number) {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buf, 0, length, position);
  if (bytesRead !== length) throw new ContentFormatError('truncated MP4');
  return buf;
}

// Strips the MP4 file at `path` in place. Returns what was removed.
export async function stripMp4File(path: string): Promise<string[]> {
  const handle = await fs.open(path, 'r+');
  const removed = new Set<string>();
  try {
    const total = (await handle.stat()).size;
    let p = 0;
    let first = true;
    let sawMoov = false;
    while (p < total) {
      if (p + 8 > total) throw new ContentFormatError('truncated MP4 box');
      const head = await readAt(handle, p, Math.min(16, total - p));
      let size = head.readUInt32BE(0);
      const type = head.toString('latin1', 4, 8);
      let header = 8;
      if (size === 1) {
        if (head.length < 16) throw new ContentFormatError('truncated MP4 box');
        size = Number(head.readBigUInt64BE(8));
        header = 16;
      } else if (size === 0) {
        size = total - p;
      }
      if (size < header || p + size > total)
        throw new ContentFormatError('bad MP4 box');
      if (first && type !== 'ftyp')
        throw new ContentFormatError('MP4 must start with ftyp');
      first = false;

      if (type === 'moov') {
        if (size - header > MAX_MOOV_BYTES)
          throw new ContentFormatError('MP4 index too large');
        const moov = await readAt(handle, p + header, size - header);
        if (stripMovie(moov)) {
          await handle.write(moov, 0, moov.length, p + header);
          removed.add('mp4-metadata');
        }
        sawMoov = true;
      } else if (type === 'meta' || type === 'udta') {
        await neutraliseOnDisk(handle, p, header, size);
        removed.add('mp4-metadata');
      } else if (type === 'uuid' && size >= header + 16) {
        const id = await readAt(handle, p + header, 16);
        if (id.equals(XMP_UUID)) {
          await neutraliseOnDisk(handle, p, header, size);
          removed.add('mp4-metadata');
        }
      }
      p += size;
    }
    if (!sawMoov) throw new ContentFormatError('MP4 has no movie box');
  } finally {
    await handle.close();
  }
  return [...removed];
}

async function neutraliseOnDisk(
  handle: fs.FileHandle,
  start: number,
  header: number,
  size: number,
) {
  await handle.write(Buffer.from('free', 'latin1'), 0, 4, start + 4);
  const zeros = Buffer.alloc(Math.min(1024 * 1024, size - header));
  for (let at = start + header; at < start + size; at += zeros.length) {
    await handle.write(zeros, 0, Math.min(zeros.length, start + size - at), at);
  }
}
