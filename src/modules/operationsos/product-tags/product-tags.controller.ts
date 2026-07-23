import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ProductTagsService } from './product-tags.service';
import { CreateProductTagDto } from './dto/create-product-tag.dto';

@Controller('product-tags')
export class ProductTagsController {
  constructor(
    private readonly productTagsService: ProductTagsService,
  ) {}

  @Post()
  create(@Body() body: CreateProductTagDto) {
    return this.productTagsService.create(body);
  }

  @Get()
  findAll() {
    return this.productTagsService.findAll();
  }

  @Get('scan/:serialNumber')
  scan(@Param('serialNumber') serialNumber: string) {
    return this.productTagsService.scan(serialNumber);
  }
}
