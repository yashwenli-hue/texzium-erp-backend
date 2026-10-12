// Text that goes onto a business document is only ever drawn as text: nothing
// in a name, address, remark or term is interpreted. These helpers make it safe
// to draw: control characters become spaces, bidirectional overrides (which
// could make text read differently from how it is stored) are removed, runs of
// whitespace collapse, and long text is shortened at a whole character.

const BIDI_CONTROLS = /[؜‎‏‪-‮⁦-⁩]/g;

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

// The user-perceived characters of a string (a Devanagari conjunct with its
// vowel sign is one).
export function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), (s) => s.segment);
}

function cleanLine(value: string): string {
  return Array.from(value.replace(BIDI_CONTROLS, ''), (ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return code < 0x20 || (code >= 0x7f && code <= 0x9f) ? ' ' : ch;
  })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

// One line of text, at most `max` characters (an ellipsis marks a cut).
export function safeText(value: unknown, max = 500): string {
  const raw =
    typeof value === 'string'
      ? value
      : value === null || value === undefined
        ? ''
        : typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : '';
  const clean = cleanLine(raw);
  const chars = graphemes(clean);
  return chars.length > max
    ? `${chars.slice(0, Math.max(0, max - 1)).join('')}…`
    : clean;
}

// Text whose line breaks matter (an address, terms): each line made safe,
// blank lines dropped, at most `maxLines` lines.
export function safeLines(value: unknown, maxLines = 30, max = 500): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(/\r\n|\r|\n/)
    .map((line) => safeText(line, max))
    .filter((line) => line.length > 0)
    .slice(0, maxLines);
}

// A file name made of letters, digits, ".", "_" and "-" only.
export function safeFileName(parts: string[], extension: string): string {
  const base = parts
    .filter((p) => p.length > 0)
    .join('-')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 120);
  return `${base || 'document'}.${extension}`;
}
