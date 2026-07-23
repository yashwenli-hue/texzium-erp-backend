import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { LeaveManagementService } from './leave-management.service';
import { CreateLeaveDto } from './dto/create-leave.dto';

@Controller('leave')
export class LeaveManagementController {
  constructor(
    private readonly leaveManagementService: LeaveManagementService,
  ) {}

  @Post('apply')
  apply(@Body() data: CreateLeaveDto) {
    return this.leaveManagementService.apply(data);
  }

  @Get()
  findAll() {
    return this.leaveManagementService.findAll();
  }

  @Patch('approve/:id')
  approve(@Param('id') id: string) {
    return this.leaveManagementService.approve(id);
  }

  @Get('employee/:id')
  findByEmployee(@Param('id') id: string) {
    return this.leaveManagementService.findByEmployee(id);
  }
}
