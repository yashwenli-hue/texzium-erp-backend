import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import PDFDocument from 'pdfkit';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class ReceiptPdfService {
  constructor(private prisma: PrismaService) {}

  async generate(receiptVoucherId: string) {
    const receipt =
      await this.prisma.receiptVoucher.findUnique({
        where: {
          id: receiptVoucherId,
        },
      });

    if (!receipt) {
      throw new Error('Receipt Voucher not found');
    }

    const folderPath = path.join(
      process.cwd(),
      'uploads',
      'receipts',
    );

    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    const filePath = path.join(
      folderPath,
      `${receipt.receiptNumber}.pdf`,
    );

    const doc = new PDFDocument();
    const stream = fs.createWriteStream(filePath);

    doc.pipe(stream);

    doc.fontSize(20).text('Payment Receipt', {
      align: 'center',
    });

    doc.moveDown();

    doc.fontSize(14).text(`Receipt Number: ${receipt.receiptNumber}`);
    doc.text(`Receipt Date: ${receipt.receiptDate.toISOString().split('T')[0]}`);
    doc.text(`Amount Received: ₹${receipt.amountReceived}`);
    doc.text(`Payment Mode: ${receipt.paymentMode}`);
    doc.text(`Reference No: ${receipt.referenceNo}`);

    doc.moveDown();
    doc.text(`Remarks: ${receipt.remarks}`);

    doc.end();

    return new Promise((resolve) => {
      stream.on('finish', () => {
        resolve({
          message: 'Receipt PDF generated successfully',
          filePath,
        });
      });
    });
  }
}
