import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  assertRegistrablePath,
  contentTypeFor,
  openStoredDocument,
  safeDownloadName,
} from './document-storage';

// Real files in a temporary directory: <tmp>/uploads is the uploads root, and
// <tmp>/outside holds a synthetic "secret" that must never be served.
describe('document storage: what may be served and registered', () => {
  let tmp: string;
  let root: string;
  let secret: string;

  const read = async (relative: string) => {
    const opened = await openStoredDocument(root, relative);
    if (!opened) return null;
    try {
      return (await opened.handle.readFile()).toString();
    } finally {
      await opened.handle.close();
    }
  };

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docstore-'));
    root = path.join(tmp, 'uploads');
    fs.mkdirSync(path.join(root, 'sub'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'outside'));
    secret = path.join(tmp, 'outside', 'secret.txt');
    fs.writeFileSync(secret, 'SYNTHETIC-SECRET');
    fs.writeFileSync(
      path.join(root, 'commissioning-1.pdf'),
      '%PDF-1.4 certificate',
    );
    fs.writeFileSync(path.join(root, 'sub', 'nested.pdf'), '%PDF nested');
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe('serving', () => {
    it('serves a plain file inside the uploads directory, as stored by commissioning', async () => {
      const opened = await openStoredDocument(
        root,
        './uploads/commissioning-1.pdf',
      );
      expect(opened).not.toBeNull();
      expect(opened!.fileName).toBe('commissioning-1.pdf');
      expect(opened!.size).toBe('%PDF-1.4 certificate'.length);
      expect((await opened!.handle.readFile()).toString()).toBe(
        '%PDF-1.4 certificate',
      );
      await opened!.handle.close();
    });

    it('serves a file in a subdirectory', async () => {
      expect(await read('./uploads/sub/nested.pdf')).toBe('%PDF nested');
    });

    it.each([
      ['a relative path that climbs out', '../outside/secret.txt'],
      [
        'a climb hidden inside the uploads prefix',
        './uploads/../outside/secret.txt',
      ],
      ['an absolute path outside', '<secret>'],
      ['the uploads directory itself', './uploads'],
      ['a directory inside', './uploads/sub'],
      ['a missing file', './uploads/nope.pdf'],
      ['an empty path', ''],
    ])('refuses %s', async (_n, stored) => {
      expect(await read(stored === '<secret>' ? secret : stored)).toBeNull();
    });

    it('refuses a symlink inside the uploads directory that points outside', async () => {
      fs.symlinkSync(secret, path.join(root, 'link.pdf'));
      expect(await read('./uploads/link.pdf')).toBeNull();
    });

    it('refuses any symlink as the file itself, even one pointing inside', async () => {
      fs.symlinkSync(
        path.join(root, 'commissioning-1.pdf'),
        path.join(root, 'alias.pdf'),
      );
      expect(await read('./uploads/alias.pdf')).toBeNull();
    });

    it('refuses a file reached through a symlinked directory that leads outside', async () => {
      fs.symlinkSync(path.join(tmp, 'outside'), path.join(root, 'linkdir'));
      expect(await read('./uploads/linkdir/secret.txt')).toBeNull();
    });

    it('refuses a hard link to a file outside (and any file with more than one link)', async () => {
      fs.linkSync(secret, path.join(root, 'hard.txt'));
      expect(await read('./uploads/hard.txt')).toBeNull();
    });

    it('refuses a FIFO without hanging', async () => {
      execFileSync('mkfifo', [path.join(root, 'pipe')]);
      expect(await read('./uploads/pipe')).toBeNull();
    });

    it('checks the opened file itself: swapping the path afterwards cannot redirect the read', async () => {
      const target = path.join(root, 'commissioning-1.pdf');
      const opened = await openStoredDocument(
        root,
        './uploads/commissioning-1.pdf',
      );
      expect(opened).not.toBeNull();
      // The path now points outside; the open descriptor still reads the checked file.
      fs.rmSync(target);
      fs.symlinkSync(secret, target);
      expect((await opened!.handle.readFile()).toString()).toBe(
        '%PDF-1.4 certificate',
      );
      await opened!.handle.close();
      // And a new request for the swapped path is refused.
      expect(await read('./uploads/commissioning-1.pdf')).toBeNull();
    });

    it('still serves when the uploads root itself is reached through a symlink', async () => {
      const linkedRoot = path.join(tmp, 'uploads-link');
      fs.symlinkSync(root, linkedRoot);
      const opened = await openStoredDocument(
        linkedRoot,
        './uploads-link/commissioning-1.pdf',
      );
      expect(opened).not.toBeNull();
      await opened!.handle.close();
      expect(
        await openStoredDocument(
          linkedRoot,
          './uploads-link/../outside/secret.txt',
        ),
      ).toBeNull();
    });

    it('refuses everything when the uploads directory does not exist', async () => {
      expect(
        await openStoredDocument(path.join(tmp, 'missing'), './missing/x.pdf'),
      ).toBeNull();
    });
  });

  describe('registering (internal callers)', () => {
    it('accepts the commissioning path, before and after the file exists', async () => {
      await expect(
        assertRegistrablePath(root, './uploads/commissioning-new.pdf'),
      ).resolves.toBeUndefined();
      await expect(
        assertRegistrablePath(root, './uploads/commissioning-1.pdf'),
      ).resolves.toBeUndefined();
    });

    it.each([
      ['a climb out', '../outside/secret.txt'],
      ['a hidden climb', './uploads/../outside/secret.txt'],
      ['an absolute path outside', '<secret>'],
      ['the uploads directory itself', './uploads'],
    ])('refuses %s', async (_n, stored) => {
      await expect(
        assertRegistrablePath(root, stored === '<secret>' ? secret : stored),
      ).rejects.toThrow(
        'A document file must be inside the uploads directory.',
      );
    });

    it('refuses an existing symlink that resolves outside', async () => {
      fs.symlinkSync(secret, path.join(root, 'link.pdf'));
      await expect(
        assertRegistrablePath(root, './uploads/link.pdf'),
      ).rejects.toThrow();
    });
  });

  describe('response helpers', () => {
    it('makes download names header-safe', () => {
      expect(safeDownloadName('commissioning-1.pdf')).toBe(
        'commissioning-1.pdf',
      );
      expect(safeDownloadName('a"b\r\nc;d.pdf')).toBe('a_b__c_d.pdf');
      expect(safeDownloadName('..')).toBe('document');
    });

    it('labels PDFs and nothing else as a known type', () => {
      expect(contentTypeFor('x.PDF')).toBe('application/pdf');
      expect(contentTypeFor('x.html')).toBe('application/octet-stream');
      expect(contentTypeFor('x.svg')).toBe('application/octet-stream');
    });
  });
});
