import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import * as fs from 'fs';
import * as path from 'path';
import PDFDocument from 'pdfkit';

@Injectable()
export class PayslipPdfService {
  constructor(private prisma: PrismaService) {}

  async generate(payrollId: string) {
    const payroll =
      await this.prisma.payroll.findUnique({
        where: { id: payrollId },
        include: {
          employee: true,
        },
      });

    if (!payroll) {
      throw new Error('Payroll not found');
    }

    const dir = path.join(
      process.cwd(),
      'uploads',
      'payslips',
    );

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const fileName =
      `PAYSLIP-${payroll.employee.employeeCode}-${payroll.payrollMonth}.pdf`;

    const filePath = path.join(dir, fileName);

    const doc = new PDFDocument();
    doc.pipe(fs.createWriteStream(filePath));

    doc.fontSize(20).text('TEXZIUM ERP PAYSLIP');
    doc.moveDown();

    doc.text(`Employee: ${payroll.employee.fullName}`);
    doc.text(`Month: ${payroll.payrollMonth}`);
    doc.text(`Basic Salary: ₹${payroll.basicSalary}`);
    doc.text(`Present Days: ${payroll.presentDays}`);
    doc.text(`Leave Days: ${payroll.leaveDays}`);
    doc.text(`Deductions: ₹${payroll.deductions}`);
    doc.text(`Net Salary: ₹${payroll.netSalary}`);

    doc.end();

    return {
      message: 'Payslip generated successfully',
      filePath,
    };
  }
}
