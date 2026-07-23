import { Body, Controller, Get, Post } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { CreatePermissionDto } from './dto/create-permission.dto';

@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Post()
  create(@Body() body: CreatePermissionDto) {
    return this.permissionsService.create(body);
  }

  @Get()
  findAll() {
    return this.permissionsService.findAll();
  }
}
