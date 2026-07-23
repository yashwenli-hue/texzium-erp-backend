import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreatePayrollDto } from './dto/create-payroll.dto';

@Injectable()
export class PayrollService {
  constructor(private prisma: PrismaService) {}

  async generate(data: CreatePayrollDto) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: data.employeeId },
    });

    if (!employee) {
      throw new Error('Employee not found');
    }

    const attendance = await this.prisma.attendance.findMany({
      where: {
        employeeId: data.employeeId,
      },
    });

    const leaves = await this.prisma.leaveRequest.findMany({
      where: {
        employeeId: data.employeeId,
        status: 'APPROVED',
      },
    });

    const presentDays =
      attendance.filter((x) => x.status === 'PRESENT').length;

    const leaveDays = leaves.length;

    const workingDays = 30;

    const grossSalary = employee.salary;

    const perDaySalary = grossSalary / workingDays;

    const absentDays =
      workingDays - presentDays - leaveDays;

    const deductions = absentDays * perDaySalary;

    const netSalary = grossSalary - deductions;

    return this.prisma.payroll.create({
      data: {
        employeeId: data.employeeId,
        payrollMonth: data.payrollMonth,
        basicSalary: employee.salary,
        workingDays,
        presentDays,
        leaveDays,
        grossSalary,
        deductions,
        netSalary,
      },
    });
  }

  async findAll() {
    return this.prisma.payroll.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}
