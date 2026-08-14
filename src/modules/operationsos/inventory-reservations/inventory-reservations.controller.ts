import { Controller, Get } from '@nestjs/common';
import { InventoryReservationsService } from './inventory-reservations.service';

@Controller('inventory-reservations')
export class InventoryReservationsController {
  constructor(
    private readonly inventoryReservationsService: InventoryReservationsService,
  ) {}

  @Get()
  findAll() {
    return this.inventoryReservationsService.findAll();
  }
}
