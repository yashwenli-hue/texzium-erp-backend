import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';

@Injectable()
export class HrmsDashboardService {
  constructor(private prisma: PrismaService) {}

  async attendanceSummary() {
    const attendance =
      await this.prisma.attendance.findMany();

    const present =
      attendance.filter((x) => x.status === 'PRESENT').length;

    const absent =
      attendance.filter((x) => x.status === 'ABSENT').length;

    return {
      totalRecords: attendance.length,
      present,
      absent,
    };
  }

  async leaveSummary() {
    const leaves =
      await this.prisma.leaveRequest.findMany();

    const approved =
      leaves.filter((x) => x.status === 'APPROVED').length;

    const pending =
      leaves.filter((x) => x.status === 'PENDING').length;

    return {
      totalLeaves: leaves.length,
      approved,
      pending,
    };
  }

  async employeeCostSummary() {
    const employees =
      await this.prisma.employee.findMany();

    const totalMonthlyCost =
      employees.reduce(
        (sum, emp) => sum + emp.salary,
        0,
      );

    return {
      totalEmployees: employees.length,
      totalMonthlyCost,
    };
  }

  async payrollSummary() {
    const payroll =
      await this.prisma.payroll.findMany();

    const totalPaid =
      payroll.reduce(
        (sum, item) => sum + item.netSalary,
        0,
      );

    return {
      totalPayrolls: payroll.length,
      totalPaid,
    };
  }
}
