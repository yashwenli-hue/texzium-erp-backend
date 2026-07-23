import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import PDFDocument from 'pdfkit';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class StatementPdfService {
  constructor(private prisma: PrismaService) {}

  async generate(customerName: string) {
    const ledger = await this.prisma.customerLedger.findMany({
      where: {
        customerName,
      },
      orderBy: {
        entryDate: 'asc',
      },
    });

    if (!ledger.length) {
      throw new Error('No ledger entries found');
    }

    const openingBalance = ledger[0].balanceAmount;
    const closingBalance =
      ledger[ledger.length - 1].balanceAmount;

    const folderPath = path.join(
      process.cwd(),
      'uploads',
      'statements',
    );

    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    const filePath = path.join(
      folderPath,
      `${customerName.replace(/\s/g, '_')}_statement.pdf`,
    );

    const doc = new PDFDocument();
    const stream = fs.createWriteStream(filePath);

    doc.pipe(stream);

    doc.fontSize(20).text('Customer Statement', {
      align: 'center',
    });

    doc.moveDown();

    doc.fontSize(14).text(`Customer: ${customerName}`);
    doc.text(`Opening Balance: ₹${openingBalance}`);
    doc.text(`Closing Balance: ₹${closingBalance}`);

    doc.moveDown();
    doc.text('Ledger Entries:');

    ledger.forEach((entry) => {
      doc.moveDown(0.5);
      doc.text(
        `${entry.entryDate.toISOString().split('T')[0]} | Debit: ₹${entry.debitAmount} | Credit: ₹${entry.creditAmount} | Balance: ₹${entry.balanceAmount}`,
      );
    });

    doc.end();

    return new Promise((resolve) => {
      stream.on('finish', () => {
        resolve({
          message: 'Statement PDF generated successfully',
          filePath,
        });
      });
    });
  }
}
