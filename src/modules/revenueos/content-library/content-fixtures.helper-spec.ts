// Builders of small, valid files for the content library tests, with known GPS data
// planted in them. A GPS value is the marker 0x47505331 ("GPS1") repeated, so a test
// can prove it is gone by searching for it.
import { crc32 } from './content-metadata';

export const GPS_MARK = Buffer.from('GPS1GPS1GPS1GPS1GPS1GPS1', 'latin1');

// A TIFF/EXIF block: IFD0 with Orientation = 6 and a GPS IFD pointer; the GPS IFD has
// a latitude reference ("N") and a latitude made of three rationals (the marker).
export function tiff(bigEndian = false): Buffer {
  const b = Buffer.alloc(8 + 2 + 2 * 12 + 4 + 2 + 2 * 12 + 4 + 24);
  const w16 = (o: number, v: number) =>
    bigEndian ? b.writeUInt16BE(v, o) : b.writeUInt16LE(v, o);
  const w32 = (o: number, v: number) =>
    bigEndian ? b.writeUInt32BE(v, o) : b.writeUInt32LE(v, o);
  b.write(bigEndian ? 'MM' : 'II', 0, 'latin1');
  w16(2, 42);
  w32(4, 8);
  // IFD0 at 8
  w16(8, 2);
  w16(10, 0x0112);
  w16(12, 3);
  w32(14, 1);
  w16(18, 6); // Orientation = 6
  const gpsIfd = 8 + 2 + 24 + 4;
  w16(22, 0x8825);
  w16(24, 4);
  w32(26, 1);
  w32(30, gpsIfd);
  w32(34, 0);
  // GPS IFD
  const values = gpsIfd + 2 + 24 + 4;
  w16(gpsIfd, 2);
  w16(gpsIfd + 2, 0x0001);
  w16(gpsIfd + 4, 2);
  w32(gpsIfd + 6, 2);
  b.write('N\0', gpsIfd + 10, 'latin1');
  w16(gpsIfd + 14, 0x0002);
  w16(gpsIfd + 16, 5);
  w32(gpsIfd + 18, 3);
  w32(gpsIfd + 22, values);
  w32(gpsIfd + 26, 0);
  GPS_MARK.copy(b, values);
  return b;
}

const segment = (marker: number, payload: Buffer) => {
  const head = Buffer.from([0xff, marker, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
};

export function jpeg(
  opts: { exif?: Buffer | null; xmp?: boolean; iptc?: boolean } = {},
): Buffer {
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  parts.push(
    segment(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
  );
  if (opts.exif !== null) {
    parts.push(
      segment(
        0xe1,
        Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), opts.exif ?? tiff()]),
      ),
    );
  }
  if (opts.xmp ?? true) {
    parts.push(
      segment(
        0xe1,
        Buffer.from(
          'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta><exif:GPSLatitude>28,36.1N</exif:GPSLatitude></x:xmpmeta>',
          'latin1',
        ),
      ),
    );
  }
  if (opts.iptc ?? true)
    parts.push(
      segment(0xed, Buffer.from('Photoshop 3.0\0 8BIM city=Pune', 'latin1')),
    );
  // SOF0: precision 8, height 480, width 640, 3 components
  parts.push(
    segment(
      0xc0,
      Buffer.from([
        8, 0x01, 0xe0, 0x02, 0x80, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1,
      ]),
    ),
  );
  parts.push(segment(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])));
  parts.push(Buffer.from([0x12, 0x34, 0x56, 0x78, 0xff, 0x00, 0x9a]));
  parts.push(Buffer.from([0xff, 0xd9]));
  return Buffer.concat(parts);
}

const pngChunk = (type: string, data: Buffer) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};

export function png(opts: { exif?: boolean; xmp?: boolean } = {}): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(320, 0);
  ihdr.writeUInt32BE(200, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    ...((opts.exif ?? true) ? [pngChunk('eXIf', tiff(true))] : []),
    ...((opts.xmp ?? true)
      ? [
          pngChunk(
            'iTXt',
            Buffer.from(
              'XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta>GPS</x:xmpmeta>',
              'latin1',
            ),
          ),
        ]
      : []),
    pngChunk('IDAT', Buffer.from([0x78, 0x9c, 0x63, 0, 0, 0, 1, 0, 1])),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const riffChunk = (type: string, data: Buffer) => {
  const head = Buffer.alloc(8);
  head.write(type, 0, 'latin1');
  head.writeUInt32LE(data.length, 4);
  return Buffer.concat([
    head,
    data,
    data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0),
  ]);
};

export function webp(): Buffer {
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x08 | 0x04; // EXIF and XMP present
  vp8x.writeUIntLE(1024 - 1, 4, 3);
  vp8x.writeUIntLE(768 - 1, 7, 3);
  const vp8 = Buffer.from([0, 0, 0, 0x9d, 0x01, 0x2a, 0, 4, 0, 3, 0, 0]);
  const body = Buffer.concat([
    riffChunk('VP8X', vp8x),
    riffChunk('VP8 ', vp8),
    riffChunk(
      'EXIF',
      Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff()]),
    ),
    riffChunk('XMP ', Buffer.from('<x:xmpmeta>GPS 28.6</x:xmpmeta>', 'latin1')),
  ]);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(4 + body.length, 4);
  head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body]);
}

const box = (type: string, ...children: Buffer[]) => {
  const payload = Buffer.concat(children);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + payload.length, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, payload]);
};

export const MP4_LOCATION = Buffer.from('+28.6139+077.2090/', 'latin1');

// ftyp, moov (mvhd, a track with its own udta, a movie udta with ©xyz, a meta box),
// then mdat of `mdatBytes` (a repeating pattern, or the given data).
export function mp4Parts(opts: { brand?: string; mdat?: Buffer } = {}) {
  const ftyp = box(
    'ftyp',
    Buffer.from(`${opts.brand ?? 'isom'}\0\0\x02\0isomiso2mp41`, 'latin1'),
  );
  const xyz = box(
    '\xa9xyz',
    Buffer.from([0, MP4_LOCATION.length, 0x15, 0xc7]),
    MP4_LOCATION,
  );
  const moov = box(
    'moov',
    box('mvhd', Buffer.alloc(100, 1)),
    box(
      'trak',
      box('tkhd', Buffer.alloc(84, 2)),
      box('udta', box('name', Buffer.from('Cam 1', 'latin1'))),
    ),
    box('udta', xyz),
    box(
      'meta',
      Buffer.alloc(4),
      box(
        'keys',
        Buffer.from('com.apple.quicktime.location.ISO6709', 'latin1'),
      ),
    ),
  );
  const mdat = box('mdat', opts.mdat ?? Buffer.alloc(4096, 0x5a));
  return { ftyp, moov, mdat };
}

export function mp4(opts: { brand?: string; mdat?: Buffer } = {}): Buffer {
  const { ftyp, moov, mdat } = mp4Parts(opts);
  return Buffer.concat([ftyp, moov, mdat]);
}

export const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n',
  'latin1',
);
export const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  'latin1',
);
export const HTML = Buffer.from(
  '<!doctype html><html><script>alert(1)</script></html>',
  'latin1',
);
