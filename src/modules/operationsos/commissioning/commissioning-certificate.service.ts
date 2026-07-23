import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import PDFDocument from 'pdfkit';
import * as fs from 'fs';
import { DocumentService } from '../../documentos/document.service';
import { EmailService } from '../../../core/email/email.service';



@Injectable()
export class CommissioningCertificateService {
  constructor(
  private prisma: PrismaService,
  private documentService: DocumentService,
  private emailService: EmailService,
) {}  

  async generateCertificate(id: string) {
    const commissioning = await this.prisma.commissioning.findUnique({
      where: { id },
      include: {
        installation: {
          include: {
            asset: true,
          },
        },
        template: true,
        results: true,
      },
    });

    if (!commissioning) {
      throw new Error('Commissioning not found');
    }

    const filePath = `./uploads/commissioning-${id}.pdf`;

    const doc = new PDFDocument();

    doc.pipe(fs.createWriteStream(filePath));

    doc.fontSize(20).text('Commissioning Certificate', {
      align: 'center',
    });

    doc.moveDown();

    doc.fontSize(12).text(
      `Asset Serial Number: ${commissioning.installation.asset.serialNumber}`,
    );

    doc.text(
      `Product Name: ${commissioning.installation.asset.productName}`,
    );

    doc.text(
      `Installation Date: ${commissioning.installation.installationDate}`,
    );

    doc.text(
      `Commissioning Date: ${commissioning.commissioningDate}`,
    );

    doc.text(`Engineer Name: ${commissioning.engineerName}`);

    doc.text(`Final Status: ${commissioning.finalStatus}`);

    doc.text(
      `Customer Accepted: ${
        commissioning.customerAccepted ? 'YES' : 'NO'
      }`,
    );

    doc.moveDown();
    doc.text('Checklist Results:');

    commissioning.results.forEach((result) => {
      doc.text(
        `Field ID: ${result.fieldId} → Value: ${result.fieldValue}`,
      );
    });

    doc.moveDown();
    doc.text(`Remarks: ${commissioning.remarks ?? ''}`);

    doc.end();

    await this.documentService.create({
  documentName: `Commissioning Certificate - ${commissioning.installation.asset.serialNumber}`,
  documentType: 'COMMISSIONING_CERTIFICATE',
  moduleName: 'OperationsOS',
  referenceId: commissioning.id,
  filePath,
  remarks: 'Auto-generated after commissioning finalization',
});

  await this.emailService.sendDynamicMail(
  '1b1ffca6-53ad-41f5-bff2-6e09f6a9b8a2',
  'SERVICE',
  'info@texzium.in',
  'Commissioning Certificate',
  'Please find attached your commissioning certificate.',
  [
    {
      filename: `commissioning-${id}.pdf`,
      path: filePath,
    },
  ],
);


      return {
      message: 'Certificate generated successfully',
      filePath,
    };
  }
}
