import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApprovalService } from './approval.service';
import { CreateApprovalDto } from './dto/create-approval.dto';
import { ApproveDto } from './dto/approve.dto';

@Controller('approval')
export class ApprovalController {
  constructor(private readonly approvalService: ApprovalService) {}

  @Post('create')
  create(@Body() data: CreateApprovalDto) {
    return this.approvalService.create(data);
  }

  @Patch(':id/approve')
  approve(
    @Param('id') id: string,
    @Body() data: ApproveDto,
  ) {
    return this.approvalService.approve(id, data);
  }

  @Get()
  findAll() {
    return this.approvalService.findAll();
  }
}
