import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
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
}
