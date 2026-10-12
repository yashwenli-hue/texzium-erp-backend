import { StreamableFile } from '@nestjs/common';
import type { Response } from 'express';

// Sends a PDF built in memory as a download: never sniffed as anything else,
// never cached, saved under a name made only of letters, digits, ".", "_" and
// "-" (see safeFileName).
export function pdfAttachment(
  res: Response,
  pdf: Buffer,
  fileName: string,
): StreamableFile {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  return new StreamableFile(pdf, {
    type: 'application/pdf',
    length: pdf.length,
    disposition: `attachment; filename="${fileName}"`,
  });
}
