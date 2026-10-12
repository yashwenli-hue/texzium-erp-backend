import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  PayloadTooLargeException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';

import {
  ContentAccessUnavailable,
  CONTENT_ACCESS_TTL_SECONDS,
  parseByteRange,
  signContentAccess,
  verifyContentAccess,
} from './content-access';
import {
  ContentFormatError,
  crc32,
  stripJpeg,
  stripMp4File,
  stripPng,
  stripWebp,
  zeroExifGps,
} from './content-metadata';
import { ContentStorage } from './content-storage';
import { displayName, nameExtension, sniffContentType } from './content-types';
import {
  GPS_MARK,
  HTML,
  MP4_LOCATION,
  PDF,
  SVG,
  jpeg,
  mp4,
  png,
  tiff,
  webp,
} from './content-fixtures.helper-spec';

const has = (haystack: Buffer, needle: Buffer) => haystack.indexOf(needle) >= 0;
const ORIENTATION_LE = Buffer.from([
  0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00,
]);

describe('content types: decided from the bytes', () => {
  it.each([
    ['PDF', PDF, 'application/pdf'],
    ['JPEG', jpeg(), 'image/jpeg'],
    ['PNG', png(), 'image/png'],
    ['WebP', webp(), 'image/webp'],
    ['MP4 (isom)', mp4(), 'video/mp4'],
    ['MP4 (mp42)', mp4({ brand: 'mp42' }), 'video/mp4'],
  ])('%s is recognised', (_n, bytes, mime) => {
    expect(sniffContentType(bytes.subarray(0, 16))?.mimeType).toBe(mime);
  });

  it.each([
    ['SVG', SVG],
    ['HTML', HTML],
    ['QuickTime MOV (qt brand)', mp4({ brand: 'qt  ' })],
    ['GIF', Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1')],
    ['ZIP', Buffer.from('PK\x03\x04', 'latin1')],
    ['text that mentions %PDF- later', Buffer.from(' %PDF-1.4', 'latin1')],
    ['an empty file', Buffer.alloc(0)],
  ])('%s is refused', (_n, bytes) => {
    expect(sniffContentType(bytes.subarray(0, 16))).toBeNull();
  });

  it('file names: extension and a display name without directories or control characters', () => {
    expect(nameExtension('Brochure.FINAL.PDF')).toBe('pdf');
    expect(nameExtension('noext')).toBe('');
    expect(nameExtension('.pdf')).toBe('');
    expect(displayName('../../etc/passwd')).toBe('passwd');
    expect(displayName('C:\\Users\\me\\a\u0000b.pdf')).toBe('ab.pdf');
    expect(displayName('x'.repeat(300))).toHaveLength(200);
  });
});

describe('location metadata is removed, the picture is kept', () => {
  it('EXIF: the GPS directory is emptied, orientation stays (little and big endian)', () => {
    for (const big of [false, true]) {
      const t = tiff(big);
      expect(has(t, GPS_MARK)).toBe(true);
      expect(zeroExifGps(t)).toBe(true);
      expect(has(t, GPS_MARK)).toBe(false);
      expect(t.includes(Buffer.from('N\0', 'latin1'))).toBe(false);
      const orientation = big ? t.readUInt16BE(18) : t.readUInt16LE(18);
      expect(orientation).toBe(6);
    }
    const bad = tiff();
    bad.write('XX', 0, 'latin1');
    expect(() => zeroExifGps(bad)).toThrow(ContentFormatError);
  });

  it('JPEG: GPS zeroed, XMP and IPTC dropped, orientation, dimensions and image data kept', () => {
    const input = jpeg();
    const out = stripJpeg(input);
    expect(has(out.data, GPS_MARK)).toBe(false);
    expect(has(out.data, Buffer.from('GPSLatitude', 'latin1'))).toBe(false);
    expect(has(out.data, Buffer.from('city=Pune', 'latin1'))).toBe(false);
    expect(has(out.data, ORIENTATION_LE)).toBe(true);
    expect(out.removed.sort()).toEqual(['gps', 'iptc', 'xmp']);
    expect([out.width, out.height]).toEqual([640, 480]);
    expect(out.data.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(out.data.subarray(-9)).toEqual(input.subarray(-9)); // scan data and EOI
  });

  it('JPEG: an EXIF block that cannot be read safely is removed whole', () => {
    const broken = tiff();
    broken.writeUInt32LE(0xfffff, 4); // IFD0 pointer outside the block
    const out = stripJpeg(jpeg({ exif: broken, xmp: false, iptc: false }));
    expect(out.removed).toEqual(['exif']);
    expect(has(out.data, Buffer.from('Exif\0\0', 'latin1'))).toBe(false);
    expect(has(out.data, GPS_MARK)).toBe(false);
  });

  it('JPEG: a damaged file is refused', () => {
    expect(() =>
      stripJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 1])),
    ).toThrow(ContentFormatError);
    expect(() => stripJpeg(PDF)).toThrow(ContentFormatError);
  });

  it('PNG: eXIf GPS zeroed with a valid checksum, XMP text dropped, dimensions read', () => {
    const out = stripPng(png());
    expect(has(out.data, GPS_MARK)).toBe(false);
    expect(has(out.data, Buffer.from('xmpmeta', 'latin1'))).toBe(false);
    expect(out.removed.sort()).toEqual(['gps', 'xmp']);
    expect([out.width, out.height]).toEqual([320, 200]);
    // every chunk's CRC is right
    let p = 8;
    while (p < out.data.length) {
      const len = out.data.readUInt32BE(p);
      expect(out.data.readUInt32BE(p + 8 + len)).toBe(
        crc32(out.data.subarray(p + 4, p + 8 + len)),
      );
      p += 12 + len;
    }
    expect(p).toBe(out.data.length);
  });

  it('PNG: a damaged chunk table is refused', () => {
    const bad = png();
    bad.writeUInt32BE(0x7fffffff, 8);
    expect(() => stripPng(bad)).toThrow(ContentFormatError);
  });

  it('WebP: EXIF GPS zeroed, XMP dropped (flag cleared, sizes consistent), dimensions read', () => {
    const out = stripWebp(webp());
    expect(has(out.data, GPS_MARK)).toBe(false);
    expect(has(out.data, Buffer.from('xmpmeta', 'latin1'))).toBe(false);
    expect(out.removed.sort()).toEqual(['gps', 'xmp']);
    expect([out.width, out.height]).toEqual([1024, 768]);
    expect(out.data.readUInt32LE(4)).toBe(out.data.length - 8);
    expect(out.data[20] & 0x04).toBe(0); // XMP flag
    expect(out.data[20] & 0x08).toBe(0x08); // EXIF still there
  });

  describe('MP4, in place', () => {
    let dir: string;
    beforeAll(async () => {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), 'content-mp4-'));
    });
    afterAll(async () => {
      await fs.rm(dir, { recursive: true, force: true });
    });

    it('user data and metadata boxes become zeroed free boxes; size and media data unchanged', async () => {
      const input = mp4({ mdat: Buffer.alloc(100_000, 0x42) });
      const file = path.join(dir, 'a.mp4');
      await fs.writeFile(file, input);
      expect(await stripMp4File(file)).toEqual(['mp4-metadata']);
      const out = await fs.readFile(file);
      expect(out.length).toBe(input.length);
      expect(has(out, MP4_LOCATION)).toBe(false);
      expect(has(out, Buffer.from('ISO6709', 'latin1'))).toBe(false);
      expect(has(out, Buffer.from('Cam 1', 'latin1'))).toBe(false);
      expect(has(out, Buffer.from('udta', 'latin1'))).toBe(false);
      expect(has(out, Buffer.from('free', 'latin1'))).toBe(true);
      const hash = (b: Buffer) =>
        createHash('sha256')
          .update(b.subarray(b.indexOf('mdat')))
          .digest('hex');
      expect(hash(out)).toBe(hash(input));
      // the boxes the player needs are untouched
      expect(has(out, Buffer.from('mvhd', 'latin1'))).toBe(true);
      expect(has(out, Buffer.from('tkhd', 'latin1'))).toBe(true);
    });

    it('a box that runs past its parent, or a file not starting with ftyp, is refused', async () => {
      const bad = mp4();
      const moovAt = bad.indexOf('moov') - 4;
      bad.writeUInt32BE(bad.readUInt32BE(moovAt + 8) + 10_000, moovAt + 8); // mvhd too big
      await fs.writeFile(path.join(dir, 'b.mp4'), bad);
      await expect(stripMp4File(path.join(dir, 'b.mp4'))).rejects.toThrow(
        ContentFormatError,
      );
      await fs.writeFile(
        path.join(dir, 'c.mp4'),
        Buffer.concat([Buffer.from([0, 0, 0, 8]), Buffer.from('free'), mp4()]),
      );
      await expect(stripMp4File(path.join(dir, 'c.mp4'))).rejects.toThrow(
        ContentFormatError,
      );
    });
  });
});

describe('signed content access', () => {
  const FILE = '00000000-0000-4000-8000-000000000001';
  const OTHER = '00000000-0000-4000-8000-000000000002';
  const now = 1_800_000_000;
  const qs = (url: string) =>
    Object.fromEntries(new URL(url, 'http://x').searchParams);
  let saved: string | undefined;
  beforeAll(() => {
    saved = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'unit-test-secret';
  });
  afterAll(() => {
    process.env.JWT_SECRET = saved;
  });

  it('a URL opens its own file, in its own disposition, until it expires', () => {
    const { url, expiresAt } = signContentAccess(FILE, 'inline', now);
    expect(url.startsWith(`/content-files/${FILE}?`)).toBe(true);
    expect(new Date(expiresAt).getTime() / 1000).toBe(
      now + CONTENT_ACCESS_TTL_SECONDS,
    );
    const q = qs(url);
    expect(verifyContentAccess(FILE, q, now)).toBe('inline');
    expect(verifyContentAccess(FILE, q, now + CONTENT_ACCESS_TTL_SECONDS)).toBe(
      'inline',
    );
    expect(
      verifyContentAccess(FILE, q, now + CONTENT_ACCESS_TTL_SECONDS + 1),
    ).toBeNull();
    expect(verifyContentAccess(OTHER, q, now)).toBeNull();
    expect(
      verifyContentAccess(FILE, { ...q, disp: 'attachment' }, now),
    ).toBeNull();
    expect(
      verifyContentAccess(FILE, { ...q, exp: String(Number(q.exp) + 1) }, now),
    ).toBeNull();
    const flipped = (q.sig[0] === 'A' ? 'B' : 'A') + q.sig.slice(1);
    expect(verifyContentAccess(FILE, { ...q, sig: flipped }, now)).toBeNull();
    // every character counts, not only a prefix
    const lastFlipped = q.sig.slice(0, -1) + (q.sig.endsWith('A') ? 'B' : 'A');
    expect(
      verifyContentAccess(FILE, { ...q, sig: lastFlipped }, now),
    ).toBeNull();
    expect(verifyContentAccess(FILE, {}, now)).toBeNull();
    expect(verifyContentAccess(FILE, { ...q, sig: [q.sig] }, now)).toBeNull();
  });

  it('a URL further ahead than any the server issues, or signed with another key, is refused', () => {
    const later = signContentAccess(FILE, 'inline', now + 3600);
    expect(verifyContentAccess(FILE, qs(later.url), now)).toBeNull();
    const q = qs(signContentAccess(FILE, 'inline', now).url);
    process.env.JWT_SECRET = 'another-secret';
    expect(verifyContentAccess(FILE, q, now)).toBeNull();
    process.env.JWT_SECRET = 'unit-test-secret';
  });

  it('without a signing key nothing is signed and nothing is opened', () => {
    const q = qs(signContentAccess(FILE, 'inline', now).url);
    delete process.env.JWT_SECRET;
    expect(() => signContentAccess(FILE, 'inline', now)).toThrow(
      ContentAccessUnavailable,
    );
    expect(verifyContentAccess(FILE, q, now)).toBeNull();
    process.env.JWT_SECRET = 'unit-test-secret';
  });

  it.each([
    [undefined, { kind: 'full' }],
    ['bytes=0-99', { kind: 'partial', start: 0, end: 99 }],
    ['bytes=100-', { kind: 'partial', start: 100, end: 999 }],
    ['bytes=-100', { kind: 'partial', start: 900, end: 999 }],
    ['bytes=-5000', { kind: 'partial', start: 0, end: 999 }],
    ['bytes=990-5000', { kind: 'partial', start: 990, end: 999 }],
    ['bytes=1000-', { kind: 'unsatisfiable' }],
    ['bytes=500-100', { kind: 'unsatisfiable' }],
    ['bytes=-0', { kind: 'unsatisfiable' }],
    ['bytes=0-1,5-6', { kind: 'full' }],
    ['items=0-1', { kind: 'full' }],
    ['bytes=-', { kind: 'full' }],
  ])('Range %s of a 1000-byte file', (header, expected) => {
    expect(parseByteRange(header, 1000)).toEqual(expected);
  });
});

describe('content storage', () => {
  let root: string;
  let storage: ContentStorage;
  let saved: string | undefined;
  const upload = async (name: string, bytes: Buffer) => {
    await fs.mkdir(path.join(root, 'tmp'), { recursive: true });
    const p = path.join(root, 'tmp', `${Math.random()}.upload`);
    await fs.writeFile(p, bytes);
    return p;
  };
  const tmpFiles = async () =>
    (await fs.readdir(path.join(root, 'tmp')).catch(() => [])).length;

  beforeEach(async () => {
    saved = process.env.CONTENT_STORAGE_DIR;
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'content-store-'));
    process.env.CONTENT_STORAGE_DIR = root;
    storage = new ContentStorage();
  });
  afterEach(async () => {
    process.env.CONTENT_STORAGE_DIR = saved;
    await fs.rm(root, { recursive: true, force: true });
  });

  it('stores an accepted file under a server-generated key, 0600 in a 0700 directory, without its location', async () => {
    const stored = await storage.ingest(
      await upload('x', jpeg()),
      'Machine photo.JPG',
      'PHOTO',
    );
    expect(stored.storageKey).toMatch(/^[0-9a-f]{2}\/[0-9a-f-]{36}\.jpg$/);
    expect(stored.mimeType).toBe('image/jpeg');
    expect(stored.metadataRemoved.sort()).toEqual(['gps', 'iptc', 'xmp']);
    expect([stored.width, stored.height]).toEqual([640, 480]);
    const file = storage.pathOf(stored.storageKey);
    const bytes = await fs.readFile(file);
    expect(has(bytes, GPS_MARK)).toBe(false);
    expect(stored.sha256).toBe(
      createHash('sha256').update(bytes).digest('hex'),
    );
    expect(stored.sizeBytes).toBe(bytes.length);
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(path.dirname(file))).mode & 0o777).toBe(0o700);
    expect(await tmpFiles()).toBe(0);
  });

  it('PDF and MP4 are stored; the MP4 without its location', async () => {
    const pdf = await storage.ingest(
      await upload('x', PDF),
      'catalogue.pdf',
      'CATALOGUE',
    );
    expect(pdf.metadataRemoved).toEqual([]);
    const video = await storage.ingest(
      await upload('x', mp4()),
      'demo.mp4',
      'VIDEO',
    );
    expect(video.metadataRemoved).toEqual(['mp4-metadata']);
    expect(
      has(await fs.readFile(storage.pathOf(video.storageKey)), MP4_LOCATION),
    ).toBe(false);
    expect(await tmpFiles()).toBe(0);
  });

  it.each([
    [
      'an SVG named .jpg',
      SVG,
      'evil.jpg',
      'PHOTO',
      UnsupportedMediaTypeException,
    ],
    [
      'HTML named .pdf',
      HTML,
      'page.pdf',
      'CATALOGUE',
      UnsupportedMediaTypeException,
    ],
    [
      'a PDF uploaded as a photo',
      PDF,
      'a.pdf',
      'PHOTO',
      UnsupportedMediaTypeException,
    ],
    [
      'a JPEG uploaded as a video',
      jpeg(),
      'a.jpg',
      'VIDEO',
      UnsupportedMediaTypeException,
    ],
    [
      'a JPEG named .png',
      jpeg(),
      'a.png',
      'PHOTO',
      UnsupportedMediaTypeException,
    ],
    [
      'a PDF without extension',
      PDF,
      'catalogue',
      'CATALOGUE',
      UnsupportedMediaTypeException,
    ],
    [
      'a QuickTime MOV',
      mp4({ brand: 'qt  ' }),
      'a.mp4',
      'VIDEO',
      UnsupportedMediaTypeException,
    ],
    [
      'a damaged PNG',
      Buffer.concat([png().subarray(0, 20)]),
      'a.png',
      'PHOTO',
      UnprocessableEntityException,
    ],
  ])(
    '%s is refused and nothing is kept',
    async (_n, bytes, name, kind, error) => {
      await expect(
        storage.ingest(await upload('x', bytes), name, kind as never),
      ).rejects.toThrow(error);
      expect(await tmpFiles()).toBe(0);
      expect(
        await fs.readdir(path.join(root, 'files')).catch(() => []),
      ).toEqual([]);
    },
  );

  it('a file over its type limit is refused (PDF 25 MB, image 10 MB)', async () => {
    const big = async (head: Buffer, bytes: number) => {
      const p = await upload('x', head);
      await fs.truncate(p, bytes);
      return p;
    };
    await expect(
      storage.ingest(
        await big(PDF, 25 * 1024 * 1024 + 1),
        'a.pdf',
        'CATALOGUE',
      ),
    ).rejects.toThrow(PayloadTooLargeException);
    await expect(
      storage.ingest(await big(jpeg(), 10 * 1024 * 1024 + 1), 'a.jpg', 'PHOTO'),
    ).rejects.toThrow(PayloadTooLargeException);
    expect(await tmpFiles()).toBe(0);
  });

  it('only keys of the server form resolve, always inside <root>/files', () => {
    expect(storage.pathOf('ab/abcdef01-2345-6789-abcd-ef0123456789.pdf')).toBe(
      path.join(
        root,
        'files',
        'ab',
        'abcdef01-2345-6789-abcd-ef0123456789.pdf',
      ),
    );
    for (const key of [
      '../x.pdf',
      '/etc/passwd',
      'ab/../../abcdef01-2345-6789-abcd-ef0123456789.pdf',
      'ab/x.svg',
      '',
    ]) {
      expect(() => storage.pathOf(key)).toThrow();
    }
  });

  it('abandoned uploads older than a day are cleared at start-up, newer ones are kept', async () => {
    const old = await upload('x', PDF);
    const fresh = await upload('x', PDF);
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600 * 1000);
    await fs.utimes(old, twoDaysAgo, twoDaysAgo);
    await storage.onModuleInit();
    await expect(fs.stat(old)).rejects.toThrow();
    await expect(fs.stat(fresh)).resolves.toBeTruthy();
  });
});
