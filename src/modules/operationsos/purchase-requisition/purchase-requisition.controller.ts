import { Body, Controller, Get, Post } from '@nestjs/common';
import { PurchaseRequisitionService } from './purchase-requisition.service';
import { CreatePurchaseRequisitionDto } from './dto/create-purchase-requisition.dto';

@Controller('purchase-requisition')
export class PurchaseRequisitionController {
  constructor(
    private readonly purchaseRequisitionService: PurchaseRequisitionService,
  ) {}

  @Post('create')
  create(@Body() data: CreatePurchaseRequisitionDto) {
    return this.purchaseRequisitionService.create(data);
  }

  @Get()
  findAll() {
    return this.purchaseRequisitionService.findAll();
  }
}
