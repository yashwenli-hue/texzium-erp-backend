import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateDispatchOrderDto } from './dto/create-dispatch-order.dto';
import { IssueService } from '../inventory-engine/services/issue.service';
import { InventoryLockService } from '../inventory-engine/services/inventory-lock.service';

@Injectable()
export class DispatchOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly issueService: IssueService,
    private readonly inventoryLockService: InventoryLockService,
  ) {}

  // Creates a Dispatch Order. When it is for a Sales Order, the order's status
  // is claimed first and the Dispatch Order is inserted second, both in one
  // transaction. The claim is an atomic compare-and-set
  // (READY_FOR_DISPATCH_ORDER -> DISPATCH_ORDER_CREATED), so a RevenueOS
  // retraction or cancellation that got there first leaves it matching nothing:
  // the request is refused and no Dispatch Order is written. If the claim wins,
  // the retraction or cancellation waits for this transaction and then finds a
  // Dispatch Order and a changed status, and refuses in turn.
  //
  // A request that names a Sales Order under another source (for example
  // DIRECT_DISPATCH) still marks it DISPATCH_ORDER_CREATED as it always did,
  // but never over a CANCELLED order, and never leaves a Dispatch Order behind
  // for one.
  async create(data: CreateDispatchOrderDto) {
    // ============================
    // VALIDATION
    // ============================

    if (data.dispatchSource === 'SALES_ORDER' && !data.salesOrderId) {
      throw new Error('Sales Order is required.');
    }

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

    const dispatchOrderNo = 'DO-' + Date.now();

    return this.prisma.$transaction(async (tx) => {
      // ============================
      // CLAIM THE SALES ORDER
      // ============================

      if (data.salesOrderId) {
        await this.claimSalesOrder(tx, data);
      }

      // ============================
      // CREATE DISPATCH ORDER
      // ============================

      return tx.dispatchOrder.create({
        data: {
          dispatchOrderNo,
          dispatchSource: data.dispatchSource,
          referenceId: data.referenceId,
          salesOrderId: data.salesOrderId,
          customerId: data.customerId,
          customerName: data.customerName,

          isCommercial: data.isCommercial ?? true,
          dispatchReason: data.dispatchReason,

          dispatchDate: data.dispatchDate ? new Date(data.dispatchDate) : null,

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
    });
  }

  // The Sales Order half of create(), run inside its transaction. Throws the
  // same messages create() always threw.
  private async claimSalesOrder(
    tx: Pick<Prisma.TransactionClient, 'salesOrder'>,
    data: CreateDispatchOrderDto,
  ): Promise<void> {
    const salesOrderId = data.salesOrderId as string;

    if (data.dispatchSource === 'SALES_ORDER') {
      const claimed = await tx.salesOrder.updateMany({
        where: { id: salesOrderId, status: 'READY_FOR_DISPATCH_ORDER' },
        data: { status: 'DISPATCH_ORDER_CREATED' },
      });

      if (claimed.count === 1) {
        return;
      }

      const current = await tx.salesOrder.findUnique({
        where: { id: salesOrderId },
        select: { id: true },
      });

      throw new Error(
        current
          ? 'Sales Order is not ready for dispatch.'
          : 'Sales Order not found.',
      );
    }

    const marked = await tx.salesOrder.updateMany({
      where: { id: salesOrderId, status: { not: 'CANCELLED' } },
      data: { status: 'DISPATCH_ORDER_CREATED' },
    });

    if (marked.count === 0) {
      const current = await tx.salesOrder.findUnique({
        where: { id: salesOrderId },
        select: { id: true },
      });

      // A cancelled order is never dispatched. An unknown id is left to the
      // Dispatch Order insert, which fails on its foreign key as it always did.
      if (current) {
        throw new Error('Sales Order is not ready for dispatch.');
      }
    }
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
    return this.prisma.$transaction(async (tx) => {
      // Lock the parent Dispatch Order first.
      await this.inventoryLockService.lockDispatchOrder(
        tx,
        id,
      );

      // Re-read the Dispatch Order AFTER acquiring the lock.
      const dispatchOrder =
        await tx.dispatchOrder.findUnique({
          where: {
            id,
          },
          include: {
            items: true,
          },
        });

      if (!dispatchOrder) {
        throw new NotFoundException(
          'Dispatch Order not found.',
        );
      }

      if (
        dispatchOrder.status !==
        'LOGISTICS_PREPARING'
      ) {
        throw new BadRequestException(
          'Dispatch Order is not ready for dispatch.',
        );
      }

      if (dispatchOrder.items.length === 0) {
        throw new BadRequestException(
          'No Dispatch Order Items found.',
        );
      }

      const unpackedItems =
        dispatchOrder.items.filter(
          (item) => !item.isPacked,
        );

      if (unpackedItems.length > 0) {
        throw new BadRequestException(
          'All items must be packed before dispatch.',
        );
      }

      // Issue every packed item.
      for (const item of dispatchOrder.items) {
        if (!item.inventoryItemId) {
          throw new BadRequestException(
            'Dispatch Order Item is not linked to an Inventory Item.',
          );
        }

        await this.issueService.issueStock(tx, {
          inventoryItemId:
            item.inventoryItemId,

          quantity:
            item.packedQty,

          warehouseId:
            item.warehouseId ??
            dispatchOrder.warehouseId ??
            undefined,

          dispatchOrderItemId:
            item.id,

          referenceModule:
            'DISPATCH_ORDER',

          referenceId:
            dispatchOrder.id,

          remarks:
            'Stock issued through Dispatch Order',

          createdBy:
            dispatchOrder.checkedBy ??
            dispatchOrder.loadedBy ??
            dispatchOrder.preparedBy ??
            undefined,
        });
      }

      // ============================
      // UPDATE SALES ORDER
      // ============================

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

      // ============================
      // MARK DISPATCHED
      // ============================

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
