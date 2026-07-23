import {
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { CommunicationService } from './communication.service';

@Controller('communication')
export class CommunicationController {
  constructor(
    private readonly communicationService: CommunicationService,
  ) {}

  @Post('smtp')
  createSMTP(@Body() body: any) {
    return this.communicationService.createSMTPConfig(body);
  }

  @Post('department')
  createDepartment(@Body() body: any) {
    return this.communicationService.createDepartmentEmail(body);
  }

  @Get(':id')
  getSMTP(@Param('id') id: string) {
    return this.communicationService.getSMTPConfig(id);
  }
}
