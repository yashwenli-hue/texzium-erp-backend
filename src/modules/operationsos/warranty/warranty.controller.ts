import { Body, Controller, Get, Post } from '@nestjs/common';
import { WarrantyService } from './warranty.service';
import { CreateWarrantyDto } from './dto/create-warranty.dto';

@Controller('warranty')
export class WarrantyController {
  constructor(private readonly warrantyService: WarrantyService) {}

  @Post()
  create(@Body() body: CreateWarrantyDto) {
    return this.warrantyService.create(body);
  }

  @Get()
  findAll() {
    return this.warrantyService.findAll();
  }
}
