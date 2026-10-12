import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import PDFDocument from 'pdfkit';

import { PrismaService } from '../../../core/database/prisma.service';
import {
  DocumentLogoDto,
  LOGO_MAX_BYTES,
  UpdateDocumentProfileDto,
} from './dto/update-document-profile.dto';

const TEXT_FIELDS = [
  'registeredOfficeAddress',
  'bankAccountName',
  'bankName',
  'bankAccountNumber',
  'bankIfsc',
  'bankBranch',
  'upiId',
  'quotationTerms',
  'proformaTerms',
  'invoiceTerms',
  'receiptNote',
  'signatoryName',
  'signatoryDesignation',
] as const;

type TextField = (typeof TEXT_FIELDS)[number];

const MAGIC: Record<string, number[]> = {
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg': [0xff, 0xd8, 0xff],
};

// Decodes and checks a logo: really base64, at most 64 KB, the file is the type
// it claims to be (by its first bytes), and pdfkit can draw it.
export function decodeLogo(mimeType: string, base64: string): Buffer {
  const bad = (why: string) =>
    new BadRequestException(`The logo was refused: ${why}.`);
  const data = Buffer.from(base64, 'base64');
  if (data.length === 0 || data.toString('base64') !== base64) {
    throw bad('it is not valid base64');
  }
  if (data.length > LOGO_MAX_BYTES) {
    throw bad(`it is larger than ${LOGO_MAX_BYTES / 1024} KB`);
  }
  const magic = MAGIC[mimeType];
  if (!magic || !magic.every((b, i) => data[i] === b)) {
    throw bad('it is not a PNG or JPEG image of the type given');
  }
  try {
    new PDFDocument({ size: [10, 10], margin: 0 }).image(data, 0, 0, {
      width: 10,
    });
  } catch {
    throw bad('the image cannot be read');
  }
  return data;
}

@Injectable()
export class DocumentProfileService {
  constructor(private readonly prisma: PrismaService) {}

  // The company whose documents these are: the only active company. More than
  // one is not supported yet and is refused rather than guessed.
  private async company() {
    const companies = await this.prisma.company.findMany({
      where: { isActive: true },
      take: 2,
    });
    if (companies.length === 0) {
      throw new NotFoundException('No active company is set up.');
    }
    if (companies.length > 1) {
      throw new ConflictException(
        'More than one active company exists; a document profile per company is not supported yet.',
      );
    }
    return companies[0];
  }

  async get() {
    const company = await this.company();
    const [registrations, profile] = await Promise.all([
      this.prisma.companyGSTRegistration.findMany({
        where: { companyId: company.id },
        orderBy: [{ isDefault: 'desc' }, { stateCode: 'asc' }],
        select: {
          id: true,
          gstin: true,
          legalName: true,
          tradeName: true,
          stateCode: true,
          stateName: true,
          isDefault: true,
          isActive: true,
        },
      }),
      this.prisma.companyDocumentProfile.findUnique({
        where: { companyId: company.id },
      }),
    ]);

    const fields = Object.fromEntries(
      TEXT_FIELDS.map((f) => [f, profile?.[f] ?? null]),
    ) as Record<TextField, string | null>;

    return {
      company: {
        id: company.id,
        companyCode: company.companyCode,
        companyName: company.companyName,
        panNumber: company.panNumber,
        cinNumber: company.cinNumber,
        email: company.email,
        phone: company.phone,
        website: company.website,
      },
      registrations,
      profile: {
        ...fields,
        logo:
          profile?.logoData && profile.logoMimeType
            ? {
                mimeType: profile.logoMimeType,
                base64: Buffer.from(profile.logoData).toString('base64'),
              }
            : null,
        updatedAt: profile?.updatedAt ?? null,
      },
    };
  }

  async update(data: UpdateDocumentProfileDto, actorId: string | undefined) {
    const company = await this.company();

    const changes: Record<string, unknown> = {};
    for (const f of TEXT_FIELDS) {
      const value = data[f];
      if (value === undefined) continue;
      changes[f] = value === null || value === '' ? null : value;
    }
    return this.save(company.id, changes, actorId);
  }

  // Replaces the logo (null removes it).
  async setLogo(data: DocumentLogoDto | null, actorId: string | undefined) {
    const company = await this.company();
    return this.save(
      company.id,
      data
        ? {
            logoData: decodeLogo(data.mimeType, data.base64),
            logoMimeType: data.mimeType,
          }
        : { logoData: null, logoMimeType: null },
      actorId,
    );
  }

  private async save(
    companyId: string,
    changes: Record<string, unknown>,
    actorId: string | undefined,
  ) {
    const actor = actorId
      ? await this.prisma.user.findUnique({
          where: { id: actorId },
          select: { id: true },
        })
      : null;

    await this.prisma.companyDocumentProfile.upsert({
      where: { companyId },
      create: { companyId, ...changes, updatedById: actor?.id },
      update: { ...changes, updatedById: actor?.id ?? null },
    });

    return this.get();
  }
}
