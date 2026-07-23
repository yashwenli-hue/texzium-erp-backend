import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Param,
} from '@nestjs/common';
import { PurchaseRequisitionsService } from './purchase-requisitions.service';
import { CreatePurchaseRequisitionDto } from './dto/create-purchase-requisition.dto';

@Controller('purchase-requisitions')
export class PurchaseRequisitionsController {
  constructor(
    private readonly purchaseRequisitionsService: PurchaseRequisitionsService,
  ) {}

  @Post()
  create(@Body() body: CreatePurchaseRequisitionDto) {
    return this.purchaseRequisitionsService.create(body);
  }

  @Get()
  findAll() {
    return this.purchaseRequisitionsService.findAll();
  }

  @Patch(':id/approve')
approve(@Param('id') id: string) {
  return this.purchaseRequisitionsService.approve(
    id,
  );
}

@Patch(':id/reject')
reject(
  @Param('id') id: string,
  @Body() body: { remarks: string },
) {
  return this.purchaseRequisitionsService.reject(
    id,
    body.remarks,
  );
}

@Post(':id/convert')
convertToPurchaseOrder(
  @Param('id') id: string,
) {
  return this.purchaseRequisitionsService.convertToPurchaseOrder(
    id,
  );
}






}
