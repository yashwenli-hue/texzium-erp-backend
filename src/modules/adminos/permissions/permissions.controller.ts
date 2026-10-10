import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';
import type { AdminRequest } from '../identity-admin';

@Controller('permissions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Post()
  @Permissions('permissions.manage')
  create(@Body() body: CreatePermissionDto, @Req() req: AdminRequest) {
    return this.permissionsService.create(body, req.user?.id);
  }

  // The permission catalogue is part of reading roles.
  @Get()
  @Permissions('roles.view')
  findAll() {
    return this.permissionsService.findAll();
  }
}
