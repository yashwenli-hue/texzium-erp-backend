// What the content library accepts, decided from a file's own bytes: never from the
// name, the browser's declared type or the client. SVG, HTML and every other type are
// refused because nothing below recognises them.

export const CONTENT_KIND = {
  CATALOGUE: 'CATALOGUE',
  PHOTO: 'PHOTO',
  VIDEO: 'VIDEO',
} as const;
export type ContentKind = (typeof CONTENT_KIND)[keyof typeof CONTENT_KIND];
export const CONTENT_KINDS = Object.values(CONTENT_KIND);

export type ContentMimeType =
  | 'application/pdf'
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'video/mp4';

const MB = 1024 * 1024;

export type ContentTypeInfo = {
  mimeType: ContentMimeType;
  // the extension a stored file gets, and the extensions a file name may carry
  extension: string;
  nameExtensions: readonly string[];
  kind: ContentKind;
  maxBytes: number;
  label: string;
};

export const CONTENT_TYPES: Record<ContentMimeType, ContentTypeInfo> = {
  'application/pdf': {
    mimeType: 'application/pdf',
    extension: 'pdf',
    nameExtensions: ['pdf'],
    kind: CONTENT_KIND.CATALOGUE,
    maxBytes: 25 * MB,
    label: 'PDF',
  },
  'image/jpeg': {
    mimeType: 'image/jpeg',
    extension: 'jpg',
    nameExtensions: ['jpg', 'jpeg'],
    kind: CONTENT_KIND.PHOTO,
    maxBytes: 10 * MB,
    label: 'JPEG image',
  },
  'image/png': {
    mimeType: 'image/png',
    extension: 'png',
    nameExtensions: ['png'],
    kind: CONTENT_KIND.PHOTO,
    maxBytes: 10 * MB,
    label: 'PNG image',
  },
  'image/webp': {
    mimeType: 'image/webp',
    extension: 'webp',
    nameExtensions: ['webp'],
    kind: CONTENT_KIND.PHOTO,
    maxBytes: 10 * MB,
    label: 'WebP image',
  },
  'video/mp4': {
    mimeType: 'video/mp4',
    extension: 'mp4',
    nameExtensions: ['mp4', 'm4v'],
    kind: CONTENT_KIND.VIDEO,
    maxBytes: 200 * MB,
    label: 'MP4 video',
  },
};

// The largest upload of any kind: what the upload itself is cut off at.
export const CONTENT_MAX_UPLOAD_BYTES = Math.max(
  ...Object.values(CONTENT_TYPES).map((t) => t.maxBytes),
);

// How many leading bytes sniffContentType needs.
export const CONTENT_SNIFF_BYTES = 16;

// ISO base media major brands of MP4 files (QuickTime "qt  " and 3GP are not MP4).
const MP4_BRANDS = new Set([
  'isom',
  'iso2',
  'iso4',
  'iso5',
  'iso6',
  'mp41',
  'mp42',
  'avc1',
  'M4V ',
  'dash',
  'MSNV',
]);

export function sniffContentType(head: Buffer): ContentTypeInfo | null {
  const ascii = (from: number, to: number) =>
    head.subarray(from, to).toString('latin1');

  if (head.length >= 5 && ascii(0, 5) === '%PDF-') {
    return CONTENT_TYPES['application/pdf'];
  }
  if (
    head.length >= 3 &&
    head[0] === 0xff &&
    head[1] === 0xd8 &&
    head[2] === 0xff
  ) {
    return CONTENT_TYPES['image/jpeg'];
  }
  if (
    head.length >= 8 &&
    head
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return CONTENT_TYPES['image/png'];
  }
  if (head.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    return CONTENT_TYPES['image/webp'];
  }
  if (
    head.length >= 12 &&
    ascii(4, 8) === 'ftyp' &&
    MP4_BRANDS.has(ascii(8, 12))
  ) {
    return CONTENT_TYPES['video/mp4'];
  }
  return null;
}

// The extension of a client file name, lower-case, or '' when it has none.
export function nameExtension(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

// A client file name made safe to keep for display only: no directories, no control
// characters, at most 200 characters. It is never used to build a path.
export function displayName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  return (base || 'file').slice(0, 200);
}

export const KIND_LABEL: Record<ContentKind, string> = {
  CATALOGUE: 'catalogue',
  PHOTO: 'photo',
  VIDEO: 'video',
};

export const KIND_ACCEPTS: Record<ContentKind, string> = {
  CATALOGUE: 'a PDF',
  PHOTO: 'a JPEG, PNG or WebP image',
  VIDEO: 'an MP4 video',
};
