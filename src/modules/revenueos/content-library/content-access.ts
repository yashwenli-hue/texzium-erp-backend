import { createHmac, timingSafeEqual } from 'crypto';

// Signed, expiring access to one stored content file.
//
// A browser cannot attach the login token to <img>, <video> or a download link, so a
// signed-in user with content.view asks for a URL (POST /content-assets/:id/access-url)
// and gets /content-files/<fileId>?exp=<unix seconds>&disp=<inline|attachment>&sig=<..>.
// The signature is an HMAC-SHA256 over the file id, expiry and disposition, with a key
// derived from the backend's JWT secret (no new secret to manage; rotating JWT_SECRET
// invalidates every URL). It is compared in constant time. A URL opens exactly one file
// version, in one disposition, until it expires; it never names a storage path.

export const CONTENT_ACCESS_TTL_SECONDS = 15 * 60;
export const CONTENT_DISPOSITIONS = ['inline', 'attachment'] as const;
export type ContentDisposition = (typeof CONTENT_DISPOSITIONS)[number];

export class ContentAccessUnavailable extends Error {}

function key(): Buffer {
  const secret = process.env.JWT_SECRET;
  if (!secret)
    throw new ContentAccessUnavailable('JWT_SECRET is not configured.');
  return createHmac('sha256', secret)
    .update('texzium-content-file-access/v1')
    .digest();
}

function signature(fileId: string, exp: number, disp: ContentDisposition) {
  return createHmac('sha256', key())
    .update(`${fileId}\n${exp}\n${disp}`)
    .digest('base64url');
}

export function signContentAccess(
  fileId: string,
  disp: ContentDisposition,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  const exp = nowSeconds + CONTENT_ACCESS_TTL_SECONDS;
  const sig = signature(fileId, exp, disp);
  const query = new URLSearchParams({ exp: String(exp), disp, sig });
  return {
    url: `/content-files/${fileId}?${query.toString()}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

export function verifyContentAccess(
  fileId: string,
  query: { exp?: unknown; disp?: unknown; sig?: unknown },
  nowSeconds = Math.floor(Date.now() / 1000),
): ContentDisposition | null {
  const { exp, disp, sig } = query;
  if (typeof exp !== 'string' || !/^\d{1,12}$/.test(exp)) return null;
  if (
    typeof disp !== 'string' ||
    !CONTENT_DISPOSITIONS.includes(disp as ContentDisposition)
  ) {
    return null;
  }
  if (typeof sig !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(sig)) return null;
  const expires = Number(exp);
  // expired, or further ahead than any URL this server issues
  if (
    expires < nowSeconds ||
    expires > nowSeconds + CONTENT_ACCESS_TTL_SECONDS + 60
  ) {
    return null;
  }
  let expected: Buffer;
  try {
    expected = Buffer.from(
      signature(fileId, expires, disp as ContentDisposition),
    );
  } catch {
    return null; // no signing key configured: nothing is opened
  }
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return null;
  return disp as ContentDisposition;
}

// A Range request header, for a file of `size` bytes (RFC 9110 single byte range).
// Several ranges, or a header that is not a byte range, are answered with the whole
// file, as the RFC allows.
export type ByteRange =
  | { kind: 'full' }
  | { kind: 'partial'; start: number; end: number }
  | { kind: 'unsatisfiable' };

export function parseByteRange(
  header: string | undefined,
  size: number,
): ByteRange {
  if (!header) return { kind: 'full' };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return { kind: 'full' };
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (suffix === 0 || size === 0) return { kind: 'unsatisfiable' };
    return {
      kind: 'partial',
      start: Math.max(0, size - suffix),
      end: size - 1,
    };
  }
  const start = Number(match[1]);
  const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (start >= size || start > end) return { kind: 'unsatisfiable' };
  return { kind: 'partial', start, end };
}
