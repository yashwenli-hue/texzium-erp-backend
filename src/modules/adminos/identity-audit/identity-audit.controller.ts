import {
  Controller,
  Get,
  Injectable,
  Module,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';

import { PrismaService } from '../../../core/database/prisma.service';
import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';
import { USER_REFERENCE_SELECT } from '../../../core/security/user-select';

// GET /identity-audit — who changed access, when, and what: users created, roles created,
// permissions granted or revoked, user roles and statuses changed. Newest first, paged by
// time (before=<createdAt of the last row>). The entries carry codes, names and ids only;
// never a password or any other credential.

const IDENTITY_ACTIONS = [
  'USER_CREATED',
  'ROLE_CREATED',
  'PERMISSION_CREATED',
  'ROLE_PERMISSION_ASSIGNED',
  'ROLE_PERMISSION_REVOKED',
  'USER_ROLE_CHANGED',
  'USER_STATUS_CHANGED',
];

class IdentityAuditQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value,
  )
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsISO8601()
  before?: string;
}

@Injectable()
export class IdentityAuditService {
  constructor(private readonly prisma: PrismaService) {}

  list(query: IdentityAuditQueryDto) {
    return this.prisma.auditLog.findMany({
      where: {
        module: 'AdminOS',
        action: { in: IDENTITY_ACTIONS },
        ...(query.before ? { createdAt: { lt: new Date(query.before) } } : {}),
      },
      select: {
        id: true,
        action: true,
        recordId: true,
        newData: true,
        createdAt: true,
        user: { select: USER_REFERENCE_SELECT },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit ?? 50,
    });
  }
}

@Controller('identity-audit')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class IdentityAuditController {
  constructor(private readonly audit: IdentityAuditService) {}

  @Get()
  @Permissions('roles.view')
  list(@Query() query: IdentityAuditQueryDto) {
    return this.audit.list(query);
  }
}

@Module({
  controllers: [IdentityAuditController],
  providers: [IdentityAuditService],
})
export class IdentityAuditModule {}
