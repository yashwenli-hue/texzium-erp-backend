import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../../core/database/prisma.service';
import { IssueStockInput } from '../interfaces/issue-stock.interface';
import { Prisma } from '@prisma/client';

@Injectable()
export class IssueService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}
  
  async issueStock(
  tx: Prisma.TransactionClient,
  data: IssueStockInput,
)
  
 {

  const inventory = await tx.inventoryItem.findUnique({
    where: {
      id: data.inventoryItemId,
    },
  });

  if (!inventory) {
    throw new NotFoundException(
      'Inventory Item not found.',
    );
  }

  if (inventory.stockQty < data.quantity) {
    throw new BadRequestException(
      `Insufficient stock for ${inventory.productName}`,
    );
  }

  if (inventory.reservedQty < data.quantity) {
  throw new BadRequestException(
    `Reserved quantity is less than issue quantity for ${inventory.productName}`,
  );
}

  const updatedInventory = await tx.inventoryItem.update({
  where: {
    id: inventory.id,
  },
  data: {
    stockQty: inventory.stockQty - data.quantity,
    reservedQty: inventory.reservedQty - data.quantity,
    availableQty:
      (inventory.stockQty - data.quantity) -
      (inventory.reservedQty - data.quantity),
  },
});

await tx.inventoryTransaction.create({
  data: {
    inventoryItemId: updatedInventory.id,
    transactionType: 'ISSUE',
    referenceModule: data.referenceModule,
    referenceId: data.referenceId,
    quantity: data.quantity,
    balanceAfter: updatedInventory.stockQty,
    remarks: data.remarks,
  },
});

return updatedInventory;
}  

}
