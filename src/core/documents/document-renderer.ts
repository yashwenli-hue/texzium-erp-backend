import PDFDocument from 'pdfkit';

import { registerDocumentFonts, textRuns } from './document-fonts';
import { formatDocumentTimestamp } from './document-format';
import { graphemes, safeText } from './document-text';

// The one layout every business document uses: company header, title and
// document details, parties, notices, the line table (its header repeated on
// every page), totals, amount in words, further tables and sections (tax
// summary, bank details, terms), the signature area, and on every page a
// footer with "Page x of y" and, where given, a watermark.
//
// The renderer only places the text it is given. It formats nothing and works
// out no amount: every figure arrives as text from the document's owner, which
// takes it from the stored record. The PDF is built in memory; nothing is
// written to disk.

export type DocumentIdentity = {
  legalName: string;
  tradeName?: string | null;
  addressLines: string[];
  details: string[];
  logo?: Buffer | null;
};

export type DocumentParty = { heading: string; name: string; lines: string[] };

export type DocumentColumn = {
  key: string;
  label: string;
  width: number; // relative weight
  align?: 'left' | 'right' | 'center';
  wrap?: boolean; // may take up to four lines
};

export type DocumentTable = {
  columns: DocumentColumn[];
  rows: Array<Record<string, string>>;
  emptyText?: string;
};

export type DocumentSpec = {
  title: string;
  subtitle?: string | null;
  runningTitle: string;
  watermark?: string | null;
  identity: DocumentIdentity;
  meta: Array<[string, string]>;
  parties: DocumentParty[];
  notices?: string[];
  table?: DocumentTable;
  totals?: Array<{ label: string; value: string; strong?: boolean }>;
  amountInWords?: string | null;
  tables?: Array<{ heading: string; table: DocumentTable }>;
  sections?: Array<{ heading: string; lines: string[] }>;
  signature?: {
    forName: string;
    name?: string | null;
    designation?: string | null;
  } | null;
  footerNote?: string | null;
  generatedAt: Date;
};

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 40;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;
const CONTENT_BOTTOM = PAGE.height - 58; // the footer lives below this
const COLOR = {
  text: '#141414',
  muted: '#5c5f5c',
  rule: '#c9cec9',
  faint: '#e3e6e3',
  accent: '#1f6f46',
  headFill: '#eef3ef',
  noticeFill: '#fbf5e6',
  noticeBar: '#b7791f',
};

type Style = {
  size: number;
  bold?: boolean;
  color?: string;
  align?: 'left' | 'right' | 'center';
};

export function renderDocumentPdf(
  spec: DocumentSpec,
  options: { compress?: boolean } = {},
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: MARGIN, bottom: 20, left: MARGIN, right: MARGIN },
    bufferPages: true,
    compress: options.compress ?? true,
    info: {
      Title: safeText(spec.runningTitle, 120),
      Producer: 'Texzium RevenueOS',
      Creator: 'Texzium RevenueOS',
    },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  registerDocumentFonts(doc);
  new Layout(doc, spec).draw();
  doc.end();
  return done;
}

class Layout {
  private y = MARGIN;
  private repeatHeader: (() => void) | null = null;

  constructor(
    private readonly doc: PDFKit.PDFDocument,
    private readonly spec: DocumentSpec,
  ) {}

  draw() {
    this.header();
    this.parties();
    this.notices(this.spec.notices ?? []);
    if (this.spec.table) this.table(this.spec.table);
    this.totals();
    if (this.spec.amountInWords) {
      this.gap(4);
      this.paragraph(`Amount in words: ${this.spec.amountInWords}`, {
        size: 8.5,
        bold: true,
      });
    }
    for (const t of this.spec.tables ?? []) {
      this.gap(10);
      this.heading(t.heading);
      this.table(t.table);
    }
    for (const s of this.spec.sections ?? []) {
      if (s.lines.length === 0) continue;
      this.gap(10);
      this.heading(s.heading);
      for (const line of s.lines) this.paragraph(line, { size: 8.5 });
    }
    this.signature();
    this.footers();
  }

  // ---------------------------------------------------------------- text

  private width(text: string, style: Style): number {
    let w = 0;
    for (const run of textRuns(text, style.bold)) {
      this.doc.font(run.font).fontSize(style.size);
      w += this.doc.widthOfString(run.text);
    }
    return w;
  }

  private lineHeight(style: Style) {
    return style.size * 1.32;
  }

  // Breaks text into lines no wider than `width` (at spaces where it can, inside
  // a word only when the word alone is too wide). With `maxLines`, the last line
  // ends with an ellipsis when text is left over.
  private wrap(text: string, width: number, style: Style, maxLines = 50) {
    const clean = safeText(text, 4000);
    if (!clean) return [''];
    const lines: string[] = [];
    let line = '';
    const push = (l: string) => lines.push(l);
    for (const word of clean.split(' ')) {
      const candidate = line ? `${line} ${word}` : word;
      if (this.width(candidate, style) <= width) {
        line = candidate;
        continue;
      }
      if (line) push(line);
      line = '';
      if (this.width(word, style) <= width) {
        line = word;
        continue;
      }
      let part = '';
      for (const g of graphemes(word)) {
        if (this.width(part + g, style) > width && part) {
          push(part);
          part = g;
        } else part += g;
      }
      line = part;
    }
    if (line) push(line);
    if (lines.length > maxLines) {
      const kept = lines.slice(0, maxLines);
      kept[maxLines - 1] = this.clip(`${kept[maxLines - 1]}…`, width, style);
      return kept;
    }
    return lines;
  }

  private clip(text: string, width: number, style: Style): string {
    if (this.width(text, style) <= width) return text;
    const chars = graphemes(text);
    while (chars.length > 1 && this.width(`${chars.join('')}…`, style) > width)
      chars.pop();
    return `${chars.join('')}…`;
  }

  // Draws one line of text at (x, y) within `width`, font run by font run.
  private line(
    text: string,
    x: number,
    y: number,
    width: number,
    style: Style,
  ) {
    const fitted = this.clip(safeText(text, 4000), width, style);
    const total = this.width(fitted, style);
    let cx =
      style.align === 'right'
        ? x + width - total
        : style.align === 'center'
          ? x + (width - total) / 2
          : x;
    for (const run of textRuns(fitted, style.bold)) {
      this.doc
        .font(run.font)
        .fontSize(style.size)
        .fillColor(style.color ?? COLOR.text)
        .text(run.text, cx, y, { lineBreak: false });
      cx += this.doc.widthOfString(run.text);
    }
  }

  // ---------------------------------------------------------------- flow

  private gap(h: number) {
    this.y += h;
  }

  private ensure(h: number) {
    if (this.y + h <= CONTENT_BOTTOM) return;
    this.doc.addPage();
    this.y = MARGIN;
    this.line(this.spec.runningTitle, MARGIN, this.y, CONTENT_WIDTH, {
      size: 8.5,
      bold: true,
      color: COLOR.muted,
    });
    this.y += 14;
    this.rule(COLOR.rule, 0.6);
    this.y += 8;
    this.repeatHeader?.();
  }

  private rule(color: string, width: number) {
    this.doc
      .moveTo(MARGIN, this.y)
      .lineTo(MARGIN + CONTENT_WIDTH, this.y)
      .lineWidth(width)
      .strokeColor(color)
      .stroke();
  }

  private paragraph(text: string, style: Style) {
    const lh = this.lineHeight(style);
    for (const l of this.wrap(text, CONTENT_WIDTH, style)) {
      this.ensure(lh);
      this.line(l, MARGIN, this.y, CONTENT_WIDTH, style);
      this.y += lh;
    }
  }

  private heading(text: string) {
    this.ensure(18);
    this.line(text, MARGIN, this.y, CONTENT_WIDTH, {
      size: 9.5,
      bold: true,
      color: COLOR.accent,
    });
    this.y += 14;
  }

  // ---------------------------------------------------------------- blocks

  private header() {
    const { identity, title, subtitle, meta } = this.spec;
    const leftW = CONTENT_WIDTH * 0.58;
    const rightX = MARGIN + leftW + 12;
    const rightW = CONTENT_WIDTH - leftW - 12;

    let ly = MARGIN;
    if (identity.logo) {
      try {
        this.doc.image(identity.logo, MARGIN, ly, { fit: [120, 48] });
        ly += 54;
      } catch {
        // an unreadable logo is left out; the document is still produced
      }
    }
    const put = (
      text: string,
      style: Style,
      x: number,
      w: number,
      at: number,
    ) => {
      const lh = this.lineHeight(style);
      let yy = at;
      for (const l of this.wrap(text, w, style, 3)) {
        this.line(l, x, yy, w, style);
        yy += lh;
      }
      return yy;
    };
    ly = put(identity.legalName, { size: 13, bold: true }, MARGIN, leftW, ly);
    if (identity.tradeName)
      ly = put(
        identity.tradeName,
        { size: 9, color: COLOR.muted },
        MARGIN,
        leftW,
        ly,
      );
    for (const l of identity.addressLines)
      ly = put(l, { size: 8.5 }, MARGIN, leftW, ly);
    for (const l of identity.details)
      ly = put(l, { size: 8.5, color: COLOR.muted }, MARGIN, leftW, ly);

    let ry = MARGIN;
    ry = put(
      title,
      { size: 16, bold: true, align: 'right', color: COLOR.accent },
      rightX,
      rightW,
      ry,
    );
    if (subtitle)
      ry = put(
        subtitle,
        { size: 8.5, bold: true, align: 'right', color: COLOR.muted },
        rightX,
        rightW,
        ry,
      );
    ry += 4;
    for (const [label, value] of meta) {
      const lw = rightW * 0.42;
      this.line(label, rightX, ry, lw, { size: 8.5, color: COLOR.muted });
      const vLines = this.wrap(
        value,
        rightW - lw,
        { size: 8.5, bold: true },
        2,
      );
      for (const v of vLines) {
        this.line(v, rightX + lw, ry, rightW - lw, {
          size: 8.5,
          bold: true,
          align: 'right',
        });
        ry += this.lineHeight({ size: 8.5 });
      }
    }

    this.y = Math.max(ly, ry) + 6;
    this.rule(COLOR.accent, 1.2);
    this.y += 10;
  }

  private parties() {
    const parties = this.spec.parties;
    if (parties.length === 0) return;
    const colGap = 16;
    const colW =
      (CONTENT_WIDTH - colGap * (parties.length - 1)) / parties.length;
    const top = this.y;
    let bottom = top;
    parties.forEach((p, i) => {
      const x = MARGIN + i * (colW + colGap);
      let yy = top;
      this.line(p.heading.toUpperCase(), x, yy, colW, {
        size: 7.5,
        bold: true,
        color: COLOR.muted,
      });
      yy += 11;
      for (const l of this.wrap(p.name, colW, { size: 10, bold: true }, 2)) {
        this.line(l, x, yy, colW, { size: 10, bold: true });
        yy += 13;
      }
      for (const text of p.lines) {
        for (const l of this.wrap(text, colW, { size: 8.5 }, 3)) {
          this.line(l, x, yy, colW, { size: 8.5 });
          yy += this.lineHeight({ size: 8.5 });
        }
      }
      bottom = Math.max(bottom, yy);
    });
    this.y = bottom + 8;
    this.rule(COLOR.faint, 0.6);
    this.y += 8;
  }

  private notices(notices: string[]) {
    for (const n of notices) {
      const style: Style = { size: 8.5 };
      const lines = this.wrap(n, CONTENT_WIDTH - 16, style, 6);
      const h = lines.length * this.lineHeight(style) + 8;
      this.ensure(h + 4);
      this.doc
        .rect(MARGIN, this.y, CONTENT_WIDTH, h)
        .fillColor(COLOR.noticeFill)
        .fill();
      this.doc.rect(MARGIN, this.y, 3, h).fillColor(COLOR.noticeBar).fill();
      let yy = this.y + 4;
      for (const l of lines) {
        this.line(l, MARGIN + 10, yy, CONTENT_WIDTH - 16, style);
        yy += this.lineHeight(style);
      }
      this.y += h + 6;
    }
  }

  private table(table: DocumentTable) {
    const total = table.columns.reduce((s, c) => s + c.width, 0);
    const widths = table.columns.map((c) => (c.width / total) * CONTENT_WIDTH);
    const xs = widths.map(
      (_, i) => MARGIN + widths.slice(0, i).reduce((s, w) => s + w, 0),
    );
    const pad = 3;
    const cell: Style = { size: 8.2 };
    const head: Style = { size: 7.8, bold: true };

    const drawHeader = () => {
      const h = 16;
      this.doc
        .rect(MARGIN, this.y, CONTENT_WIDTH, h)
        .fillColor(COLOR.headFill)
        .fill();
      table.columns.forEach((c, i) =>
        this.line(c.label, xs[i] + pad, this.y + 4, widths[i] - pad * 2, {
          ...head,
          align: c.align,
        }),
      );
      this.y += h;
    };

    this.ensure(16 + 18);
    drawHeader();
    this.repeatHeader = drawHeader;

    if (table.rows.length === 0) {
      this.ensure(18);
      this.line(
        table.emptyText ?? '—',
        MARGIN + pad,
        this.y + 4,
        CONTENT_WIDTH - pad * 2,
        {
          size: 8.5,
          color: COLOR.muted,
        },
      );
      this.y += 18;
    }

    for (const row of table.rows) {
      const cells = table.columns.map((c, i) =>
        c.wrap
          ? this.wrap(row[c.key] ?? '', widths[i] - pad * 2, cell, 4)
          : [row[c.key] ?? ''],
      );
      const lines = Math.max(...cells.map((l) => l.length));
      const h = lines * this.lineHeight(cell) + 6;
      this.ensure(h);
      cells.forEach((cl, i) => {
        let yy = this.y + 3;
        for (const l of cl) {
          this.line(l, xs[i] + pad, yy, widths[i] - pad * 2, {
            ...cell,
            align: table.columns[i].align,
          });
          yy += this.lineHeight(cell);
        }
      });
      this.y += h;
      this.doc
        .moveTo(MARGIN, this.y)
        .lineTo(MARGIN + CONTENT_WIDTH, this.y)
        .lineWidth(0.5)
        .strokeColor(COLOR.faint)
        .stroke();
    }
    this.repeatHeader = null;
    this.y += 6;
  }

  private totals() {
    const rows = this.spec.totals ?? [];
    if (rows.length === 0) return;
    const w = CONTENT_WIDTH * 0.46;
    const x = MARGIN + CONTENT_WIDTH - w;
    for (const r of rows) {
      const style: Style = { size: r.strong ? 9.5 : 8.5, bold: !!r.strong };
      const h = this.lineHeight(style) + (r.strong ? 6 : 2);
      this.ensure(h);
      if (r.strong) {
        this.doc
          .moveTo(x, this.y)
          .lineTo(x + w, this.y)
          .lineWidth(0.8)
          .strokeColor(COLOR.text)
          .stroke();
        this.y += 3;
      }
      this.line(r.label, x, this.y, w * 0.55, {
        ...style,
        color: r.strong ? COLOR.text : COLOR.muted,
      });
      this.line(r.value, x + w * 0.55, this.y, w * 0.45, {
        ...style,
        align: 'right',
      });
      this.y += h - (r.strong ? 3 : 0);
    }
  }

  private signature() {
    const s = this.spec.signature;
    if (!s) return;
    const w = 210;
    const h = 72;
    this.gap(14);
    this.ensure(h + 4);
    const x = MARGIN + CONTENT_WIDTH - w;
    this.doc
      .rect(x, this.y, w, h)
      .lineWidth(0.6)
      .strokeColor(COLOR.rule)
      .stroke();
    this.line(`For ${s.forName}`, x + 8, this.y + 6, w - 16, {
      size: 8.5,
      bold: true,
    });
    let yy = this.y + h - 30;
    if (s.name) {
      this.line(s.name, x + 8, yy, w - 16, { size: 8.5 });
      yy += 11;
    } else yy += 11;
    this.line(
      s.designation
        ? `Authorised Signatory · ${s.designation}`
        : 'Authorised Signatory',
      x + 8,
      yy,
      w - 16,
      { size: 8, color: COLOR.muted },
    );
    this.y += h + 4;
  }

  private footers() {
    const range = this.doc.bufferedPageRange();
    const note = [
      this.spec.footerNote,
      `Generated ${formatDocumentTimestamp(this.spec.generatedAt)}`,
    ]
      .filter(Boolean)
      .join(' · ');
    for (let i = 0; i < range.count; i += 1) {
      this.doc.switchToPage(range.start + i);
      if (this.spec.watermark) this.watermark(this.spec.watermark);
      const fy = PAGE.height - 44;
      this.doc
        .moveTo(MARGIN, fy)
        .lineTo(MARGIN + CONTENT_WIDTH, fy)
        .lineWidth(0.5)
        .strokeColor(COLOR.rule)
        .stroke();
      this.line(note, MARGIN, fy + 6, CONTENT_WIDTH - 90, {
        size: 7.5,
        color: COLOR.muted,
      });
      this.line(
        `Page ${i + 1} of ${range.count}`,
        MARGIN + CONTENT_WIDTH - 90,
        fy + 6,
        90,
        {
          size: 7.5,
          color: COLOR.muted,
          align: 'right',
        },
      );
    }
  }

  private watermark(text: string) {
    const cx = PAGE.width / 2;
    const cy = PAGE.height / 2;
    this.doc.save();
    this.doc.rotate(-35, { origin: [cx, cy] });
    this.doc.fillOpacity(0.07);
    this.line(text, cx - 260, cy - 30, 520, {
      size: 64,
      bold: true,
      align: 'center',
      color: '#000000',
    });
    this.doc.restore();
  }
}
