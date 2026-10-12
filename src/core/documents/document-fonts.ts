import * as fs from 'fs';
import { createRequire } from 'module';
import * as path from 'path';

// The fonts business documents are drawn with: Noto Sans (Latin, ₹ and
// typographic punctuation) and Noto Sans Devanagari (Hindi, Marathi, ...), both
// SIL Open Font License 1.1 (see assets/fonts/README.md). They are read from
// disk once, from <backend>/assets/fonts (resolved from this file, so it works
// from src/ and from dist/), and embedded as subsets: a PDF carries only the
// glyphs it uses.

export const DOCUMENT_FONT_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'assets',
  'fonts',
);

const FILES = {
  regular: 'NotoSans-Regular.ttf',
  bold: 'NotoSans-Bold.ttf',
  devaRegular: 'NotoSansDevanagari-Regular.ttf',
  devaBold: 'NotoSansDevanagari-Bold.ttf',
} as const;

type FontKey = keyof typeof FILES;

export const DOCUMENT_FONT: Record<FontKey, string> = {
  regular: 'DocSans',
  bold: 'DocSans-Bold',
  devaRegular: 'DocDeva',
  devaBold: 'DocDeva-Bold',
};

type GlyphCoverage = { hasGlyphForCodePoint(codePoint: number): boolean };

let loaded: {
  buffers: Record<FontKey, Buffer>;
  coverage: Record<FontKey, GlyphCoverage>;
} | null = null;

function loadFonts() {
  if (loaded) return loaded;
  // fontkit is pdfkit's own font engine; load the copy pdfkit itself uses.
  const fontkit = createRequire(require.resolve('pdfkit'))('fontkit') as {
    create(buffer: Buffer): GlyphCoverage;
  };
  const buffers = {} as Record<FontKey, Buffer>;
  const coverage = {} as Record<FontKey, GlyphCoverage>;
  for (const key of Object.keys(FILES) as FontKey[]) {
    const buffer = fs.readFileSync(path.join(DOCUMENT_FONT_DIR, FILES[key]));
    buffers[key] = buffer;
    coverage[key] = fontkit.create(buffer);
  }
  loaded = { buffers, coverage };
  return loaded;
}

export function registerDocumentFonts(doc: PDFKit.PDFDocument): void {
  const { buffers } = loadFonts();
  for (const key of Object.keys(FILES) as FontKey[]) {
    doc.registerFont(DOCUMENT_FONT[key], buffers[key]);
  }
}

const isDevanagari = (cp: number) =>
  (cp >= 0x0900 && cp <= 0x097f) ||
  (cp >= 0xa8e0 && cp <= 0xa8ff) ||
  (cp >= 0x1cd0 && cp <= 0x1cff);

// Zero-width (non-)joiners shape Devanagari conjuncts: they stay in their run.
const JOINERS = new Set([0x200c, 0x200d]);

export type TextRun = { text: string; font: string };

// Splits text into runs that are each drawn with one font: Devanagari with Noto
// Sans Devanagari, everything else with Noto Sans. A space stays in the run it
// is in. A character neither font can draw is printed as "?".
export function textRuns(text: string, bold = false): TextRun[] {
  const { coverage } = loadFonts();
  const latin: FontKey = bold ? 'bold' : 'regular';
  const deva: FontKey = bold ? 'devaBold' : 'devaRegular';
  const runs: TextRun[] = [];
  let current: FontKey | null = null;

  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0x3f;
    let key: FontKey;
    let out = ch;
    if (current && (JOINERS.has(cp) || cp === 0x20)) key = current;
    else if (isDevanagari(cp)) key = deva;
    else key = latin;

    if (!coverage[key].hasGlyphForCodePoint(cp)) {
      const other: FontKey = key === latin ? deva : latin;
      if (coverage[other].hasGlyphForCodePoint(cp)) key = other;
      else {
        key = latin;
        out = '?';
      }
    }

    if (key === current) runs[runs.length - 1].text += out;
    else {
      runs.push({ text: out, font: DOCUMENT_FONT[key] });
      current = key;
    }
  }
  return runs;
}
