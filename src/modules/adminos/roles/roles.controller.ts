import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';
import type { AdminRequest } from '../identity-admin';

@Controller('roles')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Post()
  @Permissions('roles.create')
  create(@Body() body: CreateRoleDto, @Req() req: AdminRequest) {
    return this.rolesService.create(body, req.user?.id);
  }

  @Get()
  @Permissions('roles.view')
  findAll() {
    return this.rolesService.findAll();
  }
}
