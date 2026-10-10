import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { USER_REFERENCE_SELECT } from '../security/user-select';

@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}

  async createNotification(data: {
    userId?: string;
    title: string;
    message: string;
    channel: string;
    category: string;
    priority: string;
    status: string;
    referenceType?: string;
    referenceId?: string;
    scheduledAt?: Date;
    metadata?: any;
  }) {
    return this.prisma.notification.create({
      data: {
        title: data.title,
        message: data.message,
        channel: data.channel,
        category: data.category,
        priority: data.priority,
        status: data.status,
        referenceType: data.referenceType,
        referenceId: data.referenceId,
        scheduledAt: data.scheduledAt,
        metadata: data.metadata,
        ...(data.userId && {
          user: {
            connect: {
              id: data.userId,
            },
          },
        }),
      },
    });
  }

  async getNotifications() {
    return this.prisma.notification.findMany({
      include: {
        user: { select: USER_REFERENCE_SELECT },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async markAsRead(id: string) {
    return this.prisma.notification.update({
      where: { id },
      data: {
        isRead: true,
        readAt: new Date(),
        status: 'READ',
      },
    });
  }

  async markDelivered(id: string) {
    return this.prisma.notification.update({
      where: { id },
      data: {
        deliveredAt: new Date(),
        status: 'DELIVERED',
      },
    });
  }

  async markFailed(id: string, errorMessage: string) {
    return this.prisma.notification.update({
      where: { id },
      data: {
        failedAt: new Date(),
        status: 'FAILED',
        errorMessage,
      },
    });
  }
}
