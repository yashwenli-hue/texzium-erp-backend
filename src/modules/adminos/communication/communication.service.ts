import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';

@Injectable()
export class CommunicationService {
  constructor(private prisma: PrismaService) {}

  async createSMTPConfig(data: any) {
    return this.prisma.companySMTPConfig.create({
      data,
    });
  }

  async createDepartmentEmail(data: any) {
    return this.prisma.departmentEmail.create({
      data,
    });
  }

  async getSMTPConfig(id: string) {
    return this.prisma.companySMTPConfig.findUnique({
      where: { id },
      include: {
        departmentEmails: true,
      },
    });
  }

  async getDepartmentEmail(
    smtpConfigId: string,
    department: string,
  ) {
    return this.prisma.departmentEmail.findFirst({
      where: {
        smtpConfigId,
        department,
      },
    });
  }
}
