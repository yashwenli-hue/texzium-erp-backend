import { Prisma } from '@prisma/client';

import { DocumentIdentity } from '../../../core/documents/document-renderer';
import { safeLines, safeText } from '../../../core/documents/document-text';

type Db = Pick<
  Prisma.TransactionClient,
  'company' | 'companyGSTRegistration' | 'companyDocumentProfile'
>;

// Who issues a document and what it prints about itself: the seller GST
// registration's legal name and address (the registration the document was
// issued under, else the company's default one), the company's PAN, CIN and
// contacts, and the company document profile (registered office, logo, bank
// details, terms, signatory). Everything is read as stored; nothing is made up
// when a value is missing, it is just not printed.
export type DocumentIssuer = {
  identity: DocumentIdentity;
  legalName: string;
  registration: {
    gstin: string;
    stateCode: string;
    stateName: string;
  } | null;
  bankLines: string[];
  terms: {
    quotation: string[];
    proforma: string[];
    invoice: string[];
    receipt: string[];
  };
  signatory: { name: string | null; designation: string | null };
};

export async function loadDocumentIssuer(
  db: Db,
  sellerGstId: string | null,
): Promise<DocumentIssuer> {
  const registration = sellerGstId
    ? await db.companyGSTRegistration.findUnique({ where: { id: sellerGstId } })
    : await db.companyGSTRegistration.findFirst({
        where: { isActive: true },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      });
  const company = registration
    ? await db.company.findUnique({ where: { id: registration.companyId } })
    : await db.company.findFirst({
        where: { isActive: true },
        orderBy: { createdAt: 'asc' },
      });
  const profile = company
    ? await db.companyDocumentProfile.findUnique({
        where: { companyId: company.id },
      })
    : null;

  const legalName = safeText(
    registration?.legalName ?? company?.companyName ?? 'Company',
    200,
  );
  const addressLines = registration
    ? [
        registration.addressLine1,
        registration.addressLine2 ?? '',
        [registration.city, registration.pincode].filter(Boolean).join(' '),
      ]
        .map((l) => safeText(l, 200))
        .filter(Boolean)
    : [];
  const office = safeLines(profile?.registeredOfficeAddress, 3, 200).join(', ');
  const details = [
    registration
      ? `GSTIN ${registration.gstin} · ${registration.stateName} (${registration.stateCode})`
      : '',
    [
      company?.panNumber ? `PAN ${company.panNumber}` : '',
      company?.cinNumber ? `CIN ${company.cinNumber}` : '',
    ]
      .filter(Boolean)
      .join(' · '),
    office ? `Registered office: ${office}` : '',
    [company?.email, company?.phone, company?.website]
      .filter(Boolean)
      .join(' · '),
  ]
    .map((l) => safeText(l, 300))
    .filter(Boolean);

  const bankLines = [
    [profile?.bankAccountName, profile?.bankName, profile?.bankBranch]
      .filter(Boolean)
      .join(' · '),
    [
      profile?.bankAccountNumber ? `A/c ${profile.bankAccountNumber}` : '',
      profile?.bankIfsc ? `IFSC ${profile.bankIfsc}` : '',
      profile?.upiId ? `UPI ${profile.upiId}` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  ]
    .map((l) => safeText(l, 300))
    .filter(Boolean);

  return {
    identity: {
      legalName,
      tradeName:
        registration?.tradeName &&
        registration.tradeName !== registration.legalName
          ? safeText(registration.tradeName, 200)
          : null,
      addressLines,
      details,
      logo: profile?.logoData ? Buffer.from(profile.logoData) : null,
    },
    legalName,
    registration: registration
      ? {
          gstin: registration.gstin,
          stateCode: registration.stateCode,
          stateName: registration.stateName,
        }
      : null,
    bankLines,
    terms: {
      quotation: safeLines(profile?.quotationTerms),
      proforma: safeLines(profile?.proformaTerms),
      invoice: safeLines(profile?.invoiceTerms),
      receipt: safeLines(profile?.receiptNote),
    },
    signatory: {
      name: profile?.signatoryName
        ? safeText(profile.signatoryName, 200)
        : null,
      designation: profile?.signatoryDesignation
        ? safeText(profile.signatoryDesignation, 200)
        : null,
    },
  };
}
