import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { PaymentGatewayConfigService } from './payment-gateway-config.service';
import { CreatePaymentGatewayDto } from './dto/create-payment-gateway.dto';
import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';

// Payment gateway settings decide where customers' payments go: the active gateway and
// the bank account that receives the money. These routes had only the login check, so
// any signed-in person could read the account number or create and activate another
// gateway. Every route now needs payments.gateway.manage (SUPER_ADMIN). The API key and
// secret are already removed from every response (CredentialRedactionInterceptor); the
// account number is shown by its last four digits only.
export const PAYMENT_GATEWAY_PERMISSION = 'payments.gateway.manage';

const SECRET_FIELDS = ['accountNumber'] as const;

export function maskGatewayConfig<T extends object | null>(row: T): T {
  if (!row) return row;
  const out: Record<string, unknown> = { ...(row as Record<string, unknown>) };
  for (const f of SECRET_FIELDS) {
    const v = out[f];
    if (typeof v === 'string' && v !== '')
      out[f] = `••••${v.length > 4 ? v.slice(-4) : ''}`;
  }
  return out as T;
}

@Controller('payment-gateway-config')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions(PAYMENT_GATEWAY_PERMISSION)
export class PaymentGatewayConfigController {
  constructor(
    private readonly paymentGatewayConfigService: PaymentGatewayConfigService,
  ) {}

  @Post()
  async create(@Body() data: CreatePaymentGatewayDto) {
    return maskGatewayConfig(
      await this.paymentGatewayConfigService.create(data),
    );
  }

  @Get()
  async findAll() {
    return (await this.paymentGatewayConfigService.findAll()).map((r) =>
      maskGatewayConfig(r),
    );
  }

  @Get('active')
  async getActiveGateway() {
    return maskGatewayConfig(
      await this.paymentGatewayConfigService.getActiveGateway(),
    );
  }
}
