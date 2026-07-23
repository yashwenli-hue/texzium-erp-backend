import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateLeaveDto } from './dto/create-leave.dto';

@Injectable()
export class LeaveManagementService {
  constructor(private prisma: PrismaService) {}

  async apply(data: CreateLeaveDto) {
    return this.prisma.leaveRequest.create({
      data: {
        employeeId: data.employeeId,
        leaveType: data.leaveType,
        fromDate: new Date(data.fromDate),
        toDate: new Date(data.toDate),
        reason: data.reason,
      },
    });
  }

  async findAll() {
    return this.prisma.leaveRequest.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async approve(id: string) {
    return this.prisma.leaveRequest.update({
      where: { id },
      data: {
        status: 'APPROVED',
      },
    });
  }

  async findByEmployee(employeeId: string) {
    return this.prisma.leaveRequest.findMany({
      where: { employeeId },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}
