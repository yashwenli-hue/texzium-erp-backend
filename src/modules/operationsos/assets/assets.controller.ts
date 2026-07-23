import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { AssetsService } from './assets.service';
import { CreateAssetDto } from './dto/create-asset.dto';

@Controller('assets')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Post()
  create(@Body() body: CreateAssetDto) {
    return this.assetsService.create(body);
  }

  @Patch(':id/health')
  updateHealth(
    @Param('id') id: string,
    @Body() body: { scoreChange: number },
  ) {
    return this.assetsService.updateHealth(id, body.scoreChange);
  }

  @Get()
  findAll() {
    return this.assetsService.findAll();
  }
}
