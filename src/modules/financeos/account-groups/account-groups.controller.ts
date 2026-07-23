import { Body, Controller, Get, Post } from '@nestjs/common';
import { AccountGroupsService } from './account-groups.service';
import { CreateAccountGroupDto } from './dto/create-account-group.dto';

@Controller('account-groups')
export class AccountGroupsController {
  constructor(
    private readonly accountGroupsService: AccountGroupsService,
  ) {}

  @Post()
  create(@Body() body: CreateAccountGroupDto) {
    return this.accountGroupsService.create(body);
  }

  @Get()
  findAll() {
    return this.accountGroupsService.findAll();
  }
}
