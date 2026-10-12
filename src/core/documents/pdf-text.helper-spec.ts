import { inflateSync } from 'zlib';

// Test helper (not built into dist: the build excludes **/*spec.ts): reads the
// text a pdfkit document draws back out of the PDF, page by page, by following
// each font's ToUnicode map. Segments drawn on the same line are joined with a
// space, so compare with whitespace collapsed.

type PdfObject = { dict: string; stream: Buffer | null };

function objects(pdf: Buffer): Map<number, PdfObject> {
  const text = pdf.toString('latin1');
  const out = new Map<number, PdfObject>();
  const re = /(\d+) 0 obj\s*([\s\S]*?)endobj/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const body = m[2];
    const s = body.indexOf('stream');
    if (s < 0) {
      out.set(Number(m[1]), { dict: body, stream: null });
      continue;
    }
    const dict = body.slice(0, s);
    let start = m.index + m[0].indexOf(body) + s + 'stream'.length;
    if (text[start] === '\r') start += 1;
    if (text[start] === '\n') start += 1;
    const end = text.indexOf('endstream', start);
    let raw = pdf.subarray(start, end);
    if (/\/FlateDecode/.test(dict)) {
      try {
        raw = inflateSync(raw);
      } catch {
        raw = inflateSync(pdf.subarray(start, end - 1));
      }
    }
    out.set(Number(m[1]), { dict, stream: raw });
  }
  return out;
}

const utf16 = (hex: string) =>
  Buffer.from(hex, 'hex').swap16().toString('utf16le');

function toUnicodeMap(cmap: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const block of cmap.match(/beginbfrange([\s\S]*?)endbfrange/g) ?? []) {
    const re =
      /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(\[[^\]]*\]|<[0-9a-fA-F]+>)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(block))) {
      const lo = parseInt(m[1], 16);
      const hi = parseInt(m[2], 16);
      if (m[3].startsWith('[')) {
        const items = m[3].match(/<([0-9a-fA-F]+)>/g) ?? [];
        items.forEach((h, i) => map.set(lo + i, utf16(h.slice(1, -1))));
      } else {
        const base = parseInt(m[3].slice(1, -1), 16);
        for (let c = lo; c <= hi; c += 1)
          map.set(c, String.fromCodePoint(base + (c - lo)));
      }
    }
  }
  for (const block of cmap.match(/beginbfchar([\s\S]*?)endbfchar/g) ?? []) {
    const re = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(block))) map.set(parseInt(m[1], 16), utf16(m[2]));
  }
  return map;
}

// The text of every page, one string per page, lines separated by "\n".
export function pdfPageTexts(pdf: Buffer): string[] {
  const objs = objects(pdf);
  const fontMaps = new Map<number, Map<number, string>>();
  const fontMap = (ref: number) => {
    if (!fontMaps.has(ref)) {
      const font = objs.get(ref);
      const tu = /\/ToUnicode (\d+) 0 R/.exec(font?.dict ?? '');
      const cmap = tu
        ? objs.get(Number(tu[1]))?.stream?.toString('latin1')
        : '';
      fontMaps.set(ref, toUnicodeMap(cmap ?? ''));
    }
    return fontMaps.get(ref)!;
  };

  const pages: string[] = [];
  for (const [, obj] of [...objs.entries()].sort((a, b) => a[0] - b[0])) {
    if (!/\/Type \/Page\b/.test(obj.dict)) continue;
    const contents = /\/Contents (\d+) 0 R/.exec(obj.dict);
    const resRef = /\/Resources (\d+) 0 R/.exec(obj.dict);
    const resDict = resRef
      ? (objs.get(Number(resRef[1]))?.dict ?? '')
      : obj.dict;
    const fonts = new Map<string, number>();
    const fontBlock = /\/Font\s*<<([\s\S]*?)>>/.exec(resDict);
    for (const f of fontBlock?.[1].matchAll(/\/(\w+) (\d+) 0 R/g) ?? [])
      fonts.set(f[1], Number(f[2]));
    const stream = contents ? objs.get(Number(contents[1]))?.stream : null;
    const ops = stream?.toString('latin1') ?? '';

    const lines: string[] = [];
    let current = '';
    let lastY: number | null = null;
    let map = new Map<number, string>();
    const tokens =
      /\/(\w+) [\d.]+ Tf|([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) Tm|(\[[^\]]*\]) TJ|<([0-9a-fA-F]*)> Tj/g;
    let t: RegExpExecArray | null;
    while ((t = tokens.exec(ops))) {
      if (t[1])
        map = fonts.has(t[1])
          ? fontMap(fonts.get(t[1])!)
          : new Map<number, string>();
      else if (t[7] !== undefined) {
        const y = Number(t[7]);
        if (lastY !== null && Math.abs(y - lastY) > 1) {
          lines.push(current.trim());
          current = '';
        } else if (current) current += ' ';
        lastY = y;
      } else {
        const hexes: string[] = t[8]
          ? Array.from(t[8].matchAll(/<([0-9a-fA-F]*)>/g), (h) => h[1])
          : [t[9] ?? ''];
        for (const hex of hexes)
          for (let i = 0; i + 4 <= hex.length; i += 4)
            current += map.get(parseInt(hex.slice(i, i + 4), 16)) ?? '�';
      }
    }
    if (current.trim()) lines.push(current.trim());
    pages.push(lines.join('\n'));
  }
  return pages;
}

export const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();
