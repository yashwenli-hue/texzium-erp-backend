import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { CreateAttendanceDto } from './dto/create-attendance.dto';

@Controller('attendance')
export class AttendanceController {
  constructor(
    private readonly attendanceService: AttendanceService,
  ) {}

  @Post('mark')
  mark(@Body() data: CreateAttendanceDto) {
    return this.attendanceService.mark(data);
  }

  @Get()
  findAll() {
    return this.attendanceService.findAll();
  }

  @Get('employee/:id')
  findByEmployee(@Param('id') id: string) {
    return this.attendanceService.findByEmployee(id);
  }
}
