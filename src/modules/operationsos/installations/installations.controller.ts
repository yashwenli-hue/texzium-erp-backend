import { Body, Controller, Get, Post } from '@nestjs/common';
import { InstallationsService } from './installations.service';
import { CreateInstallationDto } from './dto/create-installation.dto';

@Controller('installations')
export class InstallationsController {
  constructor(
    private readonly installationsService: InstallationsService,
  ) {}

  @Post()
  create(@Body() body: CreateInstallationDto) {
    return this.installationsService.create(body);
  }

  @Get()
  findAll() {
    return this.installationsService.findAll();
  }
}
