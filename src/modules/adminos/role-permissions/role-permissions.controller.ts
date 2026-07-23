import { Body, Controller, Get, Post } from '@nestjs/common';
import { RolePermissionsService } from './role-permissions.service';
import { AssignPermissionDto } from './dto/assign-permission.dto';

@Controller('role-permissions')
export class RolePermissionsController {
  constructor(private readonly rolePermissionsService: RolePermissionsService) {}

  @Post()
  assign(@Body() body: AssignPermissionDto) {
    return this.rolePermissionsService.assign(body);
  }

  @Get()
  findAll() {
    return this.rolePermissionsService.findAll();
  }
}
