import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../core/database/prisma.service';
import { USER_REFERENCE_SELECT } from '../../../core/security/user-select';
import {
  CONTENT_ASSET_NOT_FOUND,
  ContentLibraryService,
} from './content-library.service';
import { ContentKind, KIND_LABEL } from './content-types';
import { ShareContentDto } from './dto/share-content.dto';
import {
  ALL_RECORDS,
  RecordScope,
  customerWhere,
  leadWhere,
  opportunityWhere,
} from '../record-scope/record-scope';

export const CONTENT_SHARED_ACTION = 'CONTENT_SHARED';
export const ARCHIVED_NOT_SHAREABLE =
  'Archived content can’t be shared. Restore it first.';
export const INACTIVE_LEAD_MESSAGE =
  'This lead is inactive. Reactivate it before sharing content with it.';
export const INACTIVE_CUSTOMER_MESSAGE =
  'This customer is inactive. Reactivate it before sharing content with it.';

const CHANNEL_TEXT = {
  WHATSAPP: 'on WhatsApp',
  DOWNLOAD: 'by download, to send separately',
} as const;

type Locked = { id: string; isActive: boolean };

// Recording that a content version was shared with a lead, an opportunity or a
// customer. One transaction: the asset row is locked (archiving waits for it, and an
// archived asset is refused), the lead and/or customer row is locked the way the
// deletion policies lock it (so a share and a deletion can never interleave: a
// shared lead or customer is never deleted), then the share, the lead timeline entry
// and/or the customer event are written together or not at all.
@Injectable()
export class ContentSharesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly library: ContentLibraryService,
  ) {}

  async share(assetId: string, body: ShareContentDto, actorId?: string) {
    const share = await this.prisma.$transaction(async (tx) => {
      const asset = await this.library.lockAsset(tx, assetId);
      if (asset.status !== 'ACTIVE')
        throw new ConflictException(ARCHIVED_NOT_SHAREABLE);
      const file = await tx.contentFile.findFirst({
        where: { assetId },
        orderBy: { version: 'desc' },
        select: { id: true, version: true },
      });
      if (!file) throw new NotFoundException(CONTENT_ASSET_NOT_FOUND);

      const what = `the ${KIND_LABEL[asset.kind as ContentKind]} “${asset.title}” (version ${file.version}) ${CHANNEL_TEXT[body.channel]}`;
      let leadId: string | null = null;
      let opportunityId: string | null = null;
      let customerId: string | null = null;
      let leadRemarks = '';
      let customerRemarks = '';

      if (body.targetType === 'LEAD') {
        await this.lockLead(tx, body.targetId);
        leadId = body.targetId;
        leadRemarks = `Shared ${what}.`;
      } else if (body.targetType === 'CUSTOMER') {
        await this.lockCustomer(tx, body.targetId);
        customerId = body.targetId;
        customerRemarks = `Shared ${what}.`;
      } else {
        const opportunity = await tx.opportunity.findUnique({
          where: { id: body.targetId },
          select: { id: true, title: true, leadId: true, customerId: true },
        });
        if (!opportunity) throw new NotFoundException('Opportunity not found.');
        await this.lockLead(tx, opportunity.leadId);
        if (opportunity.customerId)
          await this.lockCustomer(tx, opportunity.customerId);
        opportunityId = opportunity.id;
        leadId = opportunity.leadId;
        customerId = opportunity.customerId;
        leadRemarks = `Shared ${what} for the opportunity “${opportunity.title}”.`;
        customerRemarks = leadRemarks;
      }

      const created = await tx.contentShare.create({
        data: {
          assetId,
          fileId: file.id,
          version: file.version,
          targetType: body.targetType,
          leadId,
          opportunityId,
          customerId,
          channel: body.channel,
          recipientName: body.recipientName || null,
          recipientPhone: body.recipientPhone || null,
          message: body.message || null,
          actorId: actorId ?? null,
        },
      });
      if (leadId) {
        await tx.leadTimeline.create({
          data: {
            leadId,
            action: CONTENT_SHARED_ACTION,
            remarks: leadRemarks,
            actorId: actorId ?? null,
          },
        });
      }
      if (customerId) {
        await tx.customerEvent.create({
          data: {
            customerId,
            action: CONTENT_SHARED_ACTION,
            remarks: customerRemarks,
            opportunityId,
            actorId: actorId ?? null,
          },
        });
      }
      return created;
    });

    const [view] = await this.views([share]);
    // the exact shared version, ready to download and attach
    const download = await this.library.accessUrl(
      assetId,
      'attachment',
      share.version,
    );
    return { ...view, download };
  }

  // A scoped caller sees only the shares made to leads, opportunities and customers they
  // may see (record-scope.ts): the history must not reveal who else received the item.
  async listForAsset(assetId: string, scope: RecordScope = ALL_RECORDS) {
    const asset = await this.prisma.contentAsset.findUnique({
      where: { id: assetId },
      select: { id: true },
    });
    if (!asset) throw new NotFoundException(CONTENT_ASSET_NOT_FOUND);
    const shares = await this.prisma.contentShare.findMany({
      where: scope.all
        ? { assetId }
        : {
            assetId,
            OR: [
              { leadId: { in: await this.visibleIds('lead', scope) } },
              {
                opportunityId: {
                  in: await this.visibleIds('opportunity', scope),
                },
              },
              { customerId: { in: await this.visibleIds('customer', scope) } },
            ],
          },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 200,
    });
    return this.views(shares);
  }

  private async visibleIds(
    kind: 'lead' | 'opportunity' | 'customer',
    scope: RecordScope,
  ) {
    const select = { id: true } as const;
    const rows =
      kind === 'lead'
        ? await this.prisma.lead.findMany({ where: leadWhere(scope), select })
        : kind === 'opportunity'
          ? await this.prisma.opportunity.findMany({
              where: opportunityWhere(scope),
              select,
            })
          : await this.prisma.customer.findMany({
              where: customerWhere(scope),
              select,
            });
    return rows.map((r) => r.id);
  }

  private async lockLead(tx: Prisma.TransactionClient, id: string) {
    const rows = await tx.$queryRaw<Locked[]>`
      SELECT "id", "isActive" FROM "Lead" WHERE "id" = ${id} FOR UPDATE
    `;
    if (rows.length === 0) throw new NotFoundException('Lead not found.');
    if (!rows[0].isActive) throw new ConflictException(INACTIVE_LEAD_MESSAGE);
  }

  private async lockCustomer(tx: Prisma.TransactionClient, id: string) {
    const rows = await tx.$queryRaw<Locked[]>`
      SELECT "id", "isActive" FROM "Customer" WHERE "id" = ${id} FOR UPDATE
    `;
    if (rows.length === 0) throw new NotFoundException('Customer not found.');
    if (!rows[0].isActive)
      throw new ConflictException(INACTIVE_CUSTOMER_MESSAGE);
  }

  private async views(shares: Prisma.ContentShareGetPayload<object>[]) {
    const ids = (pick: (s: (typeof shares)[number]) => string | null) => [
      ...new Set(shares.map(pick).filter((x): x is string => !!x)),
    ];
    const [users, leads, opportunities, customers] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: ids((s) => s.actorId) } },
        select: USER_REFERENCE_SELECT,
      }),
      this.prisma.lead.findMany({
        where: { id: { in: ids((s) => s.leadId) } },
        select: { id: true, customerName: true, leadCode: true },
      }),
      this.prisma.opportunity.findMany({
        where: { id: { in: ids((s) => s.opportunityId) } },
        select: { id: true, title: true },
      }),
      this.prisma.customer.findMany({
        where: { id: { in: ids((s) => s.customerId) } },
        select: { id: true, customerName: true, customerCode: true },
      }),
    ]);
    const by = <T extends { id: string }>(rows: T[]) =>
      new Map(rows.map((r) => [r.id, r]));
    const u = by(users);
    const l = by(leads);
    const o = by(opportunities);
    const c = by(customers);
    return shares.map((s) => ({
      id: s.id,
      assetId: s.assetId,
      fileId: s.fileId,
      version: s.version,
      targetType: s.targetType,
      lead: (s.leadId && l.get(s.leadId)) || null,
      opportunity: (s.opportunityId && o.get(s.opportunityId)) || null,
      customer: (s.customerId && c.get(s.customerId)) || null,
      channel: s.channel,
      recipientName: s.recipientName,
      recipientPhone: s.recipientPhone,
      message: s.message,
      actor: (s.actorId && u.get(s.actorId)) || null,
      createdAt: s.createdAt,
    }));
  }
}
