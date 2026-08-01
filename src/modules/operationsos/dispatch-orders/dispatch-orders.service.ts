import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateDispatchOrderDto } from './dto/create-dispatch-order.dto';
import { IssueService } from '../inventory-engine/services/issue.service';

@Injectable()
export class DispatchOrdersService {
 constructor(
  private readonly prisma: PrismaService,
  private readonly issueService: IssueService,
) {}

  async create(data: CreateDispatchOrderDto) {

    // ============================
    // SALES ORDER VALIDATION
    // ============================

    if (data.dispatchSource === 'SALES_ORDER') {

      if (!data.salesOrderId) {
        throw new Error('Sales Order is required.');
      }

      const salesOrder = await this.prisma.salesOrder.findUnique({
        where: {
          id: data.salesOrderId,
        },
      });

      if (!salesOrder) {
        throw new Error('Sales Order not found.');
      }

      if (salesOrder.status !== 'READY_FOR_DISPATCH_ORDER') {
        throw new Error(
          'Sales Order is not ready for dispatch.',
        );
      }
    }

    // ============================
    // DIRECT DISPATCH
    // ============================

    if (data.dispatchSource === 'DIRECT_DISPATCH') {

      if (!data.customerName) {
        throw new Error('Customer Name is required.');
      }

      if (!data.dispatchReason) {
        throw new Error('Dispatch Reason is required.');
      }
    }

    // ============================
    // GENERATE DISPATCH ORDER NO
    // ============================

    const dispatchOrderNo =
      'DO-' + Date.now();

    // ============================
    // CREATE DISPATCH ORDER
    // ============================

    const dispatchOrder =
      await this.prisma.dispatchOrder.create({

        data: {

          dispatchOrderNo,

          dispatchSource: data.dispatchSource,

          referenceId: data.referenceId,

          salesOrderId: data.salesOrderId,

          customerId: data.customerId,
          customerName: data.customerName,

          isCommercial: data.isCommercial ?? true,
          dispatchReason: data.dispatchReason,

          dispatchDate: data.dispatchDate
            ? new Date(data.dispatchDate)
            : null,

          transportName: data.transportName,
          vehicleNumber: data.vehicleNumber,
          driverName: data.driverName,
          driverMobile: data.driverMobile,
          lrNumber: data.lrNumber,
          destination: data.destination,
          routeName: data.routeName,
          dispatchMode: data.dispatchMode,
          dispatchPriority: data.dispatchPriority,

          expectedDelivery: data.expectedDelivery
            ? new Date(data.expectedDelivery)
            : null,

          warehouseId: data.warehouseId,

          preparedBy: data.preparedBy,
          loadedBy: data.loadedBy,
          checkedBy: data.checkedBy,

          approvedByAccounts: data.approvedByAccounts,
          approvedByLogistics: data.approvedByLogistics,

          remarks: data.remarks,

          status: 'LOGISTICS_PREPARING',
        },
      });

    // ============================
    // UPDATE SALES ORDER
    // ============================

    if (data.salesOrderId) {

      await this.prisma.salesOrder.update({

        where: {
          id: data.salesOrderId,
        },

        data: {
          status: 'DISPATCH_ORDER_CREATED',
        },
      });

    }

    return dispatchOrder;
  }

  async findAll() {

    return this.prisma.dispatchOrder.findMany({

      include: {

        items: true,

        salesInvoices: true,

      },

      orderBy: {

        createdAt: 'desc',

      },

    });

  }

  async markDispatched(id: string) {

  const dispatchOrder = await this.prisma.dispatchOrder.findUnique({
    where: { id },
    include: {
      items: true,
    },
  });

  if (!dispatchOrder) {
    throw new NotFoundException(
  'Dispatch Order not found.',
);
  }

  if (dispatchOrder.status !== 'LOGISTICS_PREPARING') {
    throw new BadRequestException(
  'Dispatch Order is not ready for dispatch.',
);
  }

  if (dispatchOrder.items.length === 0) {
    throw new BadRequestException(
  'No Dispatch Order Items found.',
);
  }

  const unpackedItems = dispatchOrder.items.filter(
    item => !item.isPacked,
  );

  if (unpackedItems.length > 0) {
    throw new BadRequestException(
  'All items must be packed before dispatch.',
);
  }

  return this.prisma.$transaction(async (tx) => {

  for (const item of dispatchOrder.items) {

  if (!item.inventoryItemId) {
  throw new BadRequestException(
    'Dispatch Order Item is not linked to an Inventory Item.',
  );
}


  await this.issueService.issueStock(tx, {
  inventoryItemId: item.inventoryItemId,
  quantity: item.packedQty,
  referenceModule: 'DISPATCH_ORDER',
  referenceId: dispatchOrder.id,
  remarks: 'Stock issued through Dispatch Order',
});
}  

  if (dispatchOrder.salesOrderId) {

    await tx.salesOrder.update({
      where: {
        id: dispatchOrder.salesOrderId,
      },
      data: {
        status: 'READY_FOR_INVOICING',
      },
    });

  }

  return tx.dispatchOrder.update({
    where: {
      id,
    },
    data: {
      status: 'DISPATCHED',
      gateOutTime: new Date(),
    },
  });

});
}
}
