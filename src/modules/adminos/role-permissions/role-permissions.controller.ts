import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { RolePermissionsService } from './role-permissions.service';
import { AssignPermissionDto } from './dto/assign-permission.dto';
import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';
import type { AdminRequest } from '../identity-admin';

@Controller('role-permissions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RolePermissionsController {
  constructor(
    private readonly rolePermissionsService: RolePermissionsService,
  ) {}

  // The caller must also hold the permission being assigned (hold what you grant).
  @Post()
  @Permissions('roles.permissions.assign')
  assign(@Body() body: AssignPermissionDto, @Req() req: AdminRequest) {
    return this.rolePermissionsService.assign(body, req.user);
  }

  @Get()
  @Permissions('roles.view')
  findAll() {
    return this.rolePermissionsService.findAll();
  }
}
