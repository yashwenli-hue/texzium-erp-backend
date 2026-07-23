import { Module } from '@nestjs/common';
import { InventoryReservationsController } from './inventory-reservations.controller';
import { InventoryReservationsService } from './inventory-reservations.service';

@Module({
  controllers: [InventoryReservationsController],
  providers: [InventoryReservationsService],
})
export class InventoryReservationsModule {}
