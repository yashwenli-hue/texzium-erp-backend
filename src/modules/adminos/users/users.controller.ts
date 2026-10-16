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
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { ChangeUserRoleDto } from './dto/change-user-role.dto';
import { ChangeUserStatusDto } from './dto/change-user-status.dto';
import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';
import type { AdminRequest } from '../identity-admin';

@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // The new user's role may carry only permissions the caller holds (hold what you grant).
  @Post()
  @Permissions('users.create')
  create(@Body() body: CreateUserDto, @Req() req: AdminRequest) {
    return this.usersService.create(body, req.user);
  }

  @Get()
  @Permissions('users.view')
  findAll() {
    return this.usersService.findAll();
  }

  @Patch(':id/role')
  @Permissions('users.view', 'users.role.assign')
  changeRole(
    @Param('id') id: string,
    @Body() body: ChangeUserRoleDto,
    @Req() req: AdminRequest,
  ) {
    return this.usersService.changeRole(id, body, req.user);
  }

  @Patch(':id/status')
  @Permissions('users.view', 'users.status.manage')
  changeStatus(
    @Param('id') id: string,
    @Body() body: ChangeUserStatusDto,
    @Req() req: AdminRequest,
  ) {
    return this.usersService.changeStatus(id, body, req.user);
  }
}
