import { constants, promises as fs } from 'fs';
import type { FileHandle } from 'fs/promises';
import * as path from 'path';

// Where document files live. Every stored filePath must resolve inside this directory;
// nothing outside it is ever registered or served. Stored paths are relative to the
// directory that contains it (the backend's working directory), e.g.
// "./uploads/commissioning-<id>.pdf". Injected so tests can use a temporary directory.
export const DOCUMENT_UPLOADS_ROOT = Symbol('DOCUMENT_UPLOADS_ROOT');

export const defaultUploadsRoot = () => path.resolve(process.cwd(), 'uploads');

const isInside = (candidate: string, root: string) =>
  candidate.startsWith(root + path.sep);

// For registering a file (internal callers only): the path must lie inside the uploads
// directory once normalised ("..", absolute paths and the like are refused), and if it
// already exists, its real location (symlinks followed) must be inside too.
export async function assertRegistrablePath(
  root: string,
  filePath: string,
): Promise<void> {
  const refuse = () => {
    throw new Error('A document file must be inside the uploads directory.');
  };
  const candidate = path.resolve(path.dirname(root), filePath);
  if (!isInside(candidate, root)) refuse();

  const real = await fs.realpath(candidate).catch(() => null);
  if (real !== null) {
    const rootReal = await fs.realpath(root).catch(() => null);
    if (rootReal === null || !isInside(real, rootReal)) refuse();
  }
}

export interface OpenedDocument {
  handle: FileHandle;
  size: number;
  fileName: string;
}

// For serving a file. The file is opened FIRST and everything is checked on the open
// descriptor, which is then what gets streamed, so nothing can be swapped in between
// the check and the read (no time-of-check / time-of-use gap):
//   - O_NOFOLLOW: a symlink as the last path component is refused (ELOOP)
//   - O_NONBLOCK: a FIFO or device cannot make the open hang (and is refused below)
//   - fstat: only a regular file with a single link (a hard link to a file elsewhere
//     would otherwise look like a file inside the directory)
//   - /proc/self/fd: where the open file really is, after any symlinked directory on
//     the way; it must be inside the real uploads directory
// Anything else, including a missing file, gives null and the caller answers 404
// without revealing the path. Linux-only by design: without /proc it fails closed.
export async function openStoredDocument(
  root: string,
  filePath: string,
): Promise<OpenedDocument | null> {
  const rootReal = await fs.realpath(root).catch(() => null);
  if (rootReal === null) return null;

  const candidate = path.resolve(path.dirname(root), filePath);
  if (!isInside(candidate, root) && !isInside(candidate, rootReal)) return null;

  let handle: FileHandle;
  try {
    handle = await fs.open(
      candidate,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch {
    return null;
  }

  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1) throw new Error('not a plain file');

    const opened = await fs.readlink(`/proc/self/fd/${handle.fd}`);
    if (!isInside(opened, rootReal))
      throw new Error('outside the uploads directory');

    return { handle, size: stat.size, fileName: path.basename(opened) };
  } catch {
    await handle.close().catch(() => undefined);
    return null;
  }
}

// A download name that is safe in a Content-Disposition header.
export function safeDownloadName(fileName: string): string {
  const cleaned = fileName.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  return cleaned || 'document';
}

export function contentTypeFor(fileName: string): string {
  return path.extname(fileName).toLowerCase() === '.pdf'
    ? 'application/pdf'
    : 'application/octet-stream';
}
