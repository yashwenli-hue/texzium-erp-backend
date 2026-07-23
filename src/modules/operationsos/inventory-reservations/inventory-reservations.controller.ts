import { Body, Controller, Get, Post } from '@nestjs/common';
import { InventoryReservationsService } from './inventory-reservations.service';
import { CreateInventoryReservationDto } from './dto/create-inventory-reservation.dto';

@Controller('inventory-reservations')
export class InventoryReservationsController {
  constructor(
    private readonly inventoryReservationsService: InventoryReservationsService,
  ) {}

  @Post()
  create(@Body() body: CreateInventoryReservationDto) {
    return this.inventoryReservationsService.create(body);
  }

  @Get()
  findAll() {
    return this.inventoryReservationsService.findAll();
  }
}
