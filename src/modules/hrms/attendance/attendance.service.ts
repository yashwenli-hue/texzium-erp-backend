import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateAttendanceDto } from './dto/create-attendance.dto';

@Injectable()
export class AttendanceService {
  constructor(private prisma: PrismaService) {}

  async mark(data: CreateAttendanceDto) {
    const employee =
      await this.prisma.employee.findUnique({
        where: {
          id: data.employeeId,
        },
      });

    if (!employee) {
      throw new Error('Employee not found');
    }

    return this.prisma.attendance.create({
      data: {
        employeeId: data.employeeId,
        attendanceDate: new Date(data.attendanceDate),
        status: data.status,
        checkInTime: data.checkInTime
          ? new Date(data.checkInTime)
          : null,
        checkOutTime: data.checkOutTime
          ? new Date(data.checkOutTime)
          : null,
      },
    });
  }

  async findAll() {
    return this.prisma.attendance.findMany({
      orderBy: {
        attendanceDate: 'desc',
      },
    });
  }

  async findByEmployee(employeeId: string) {
    return this.prisma.attendance.findMany({
      where: {
        employeeId,
      },
      orderBy: {
        attendanceDate: 'desc',
      },
    });
  }
}
