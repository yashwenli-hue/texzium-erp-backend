import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRolePermissionsDto } from './dto/update-role-permissions.dto';
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

  @Get(':id')
  @Permissions('roles.view')
  findOne(@Param('id') id: string) {
    return this.rolesService.findOne(id);
  }

  // Grants need roles.permissions.assign and revokes roles.permissions.revoke (checked in
  // the service against what the request contains).
  @Patch(':id/permissions')
  @Permissions('roles.view')
  updatePermissions(
    @Param('id') id: string,
    @Body() body: UpdateRolePermissionsDto,
    @Req() req: AdminRequest,
  ) {
    return this.rolesService.updatePermissions(id, body, req.user);
  }
}
