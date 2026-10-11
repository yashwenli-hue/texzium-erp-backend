import { PrismaService } from '../../../core/database/prisma.service';

export type LegacyMatch = {
  id: string;
  title: string;
  status: string;
  leadName: string;
  leadCompany: string | null;
  quotationCount: number;
  matchedBy: 'LEAD_NAME' | 'LEAD_COMPANY';
};

// Opportunities that are NOT linked to any customer but whose lead looks like this
// customer by name or company (case and spacing ignored). They are only ever shown as
// "possible legacy matches" for a person to link; nothing is counted or included
// because of them. Shared by the customer overview and the customer statement.
export function findLegacyMatches(
  prisma: Pick<PrismaService, '$queryRaw'>,
  customerName: string,
) {
  return prisma.$queryRaw<LegacyMatch[]>`
      /* customer:legacy-matches */
      SELECT
        o."id",
        o."title",
        o."status",
        l."customerName" AS "leadName",
        l."companyName"  AS "leadCompany",
        (SELECT count(*)::int FROM "Quotation" q WHERE q."opportunityId" = o."id") AS "quotationCount",
        CASE
          WHEN lower(regexp_replace(btrim(l."customerName"), '[[:space:]]+', ' ', 'g'))
             = lower(regexp_replace(btrim(${customerName}::text), '[[:space:]]+', ' ', 'g'))
          THEN 'LEAD_NAME'
          ELSE 'LEAD_COMPANY'
        END AS "matchedBy"
      FROM "Opportunity" o
      JOIN "Lead" l ON l."id" = o."leadId"
      WHERE o."customerId" IS NULL
        AND (
          lower(regexp_replace(btrim(l."customerName"), '[[:space:]]+', ' ', 'g'))
            = lower(regexp_replace(btrim(${customerName}::text), '[[:space:]]+', ' ', 'g'))
          OR (
            l."companyName" IS NOT NULL
            AND lower(regexp_replace(btrim(l."companyName"), '[[:space:]]+', ' ', 'g'))
              = lower(regexp_replace(btrim(${customerName}::text), '[[:space:]]+', ' ', 'g'))
          )
        )
      ORDER BY o."createdAt" DESC
    `;
}
