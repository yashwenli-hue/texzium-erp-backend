import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';

@Injectable()
export class CustomerMasterService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateCustomerDto) {
    return this.prisma.customer.create({
      data,
    });
  }

  async findAll() {
    return this.prisma.customer.findMany({
      include: {
        gstRegistrations: true,
      },
    });
  }
}
