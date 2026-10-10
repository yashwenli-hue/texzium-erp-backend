import { WhatsAppConfig } from '@prisma/client';

// What the API may show about a WhatsApp configuration. The access token and the
// webhook verify token stay on the server: a client only learns whether one is set.
export interface WhatsAppConfigView {
  id: string;
  companyName: string;
  whatsappNumber: string;
  defaultSenderName: string | null;
  phoneNumberId: string;
  businessAccount: string;
  isActive: boolean;
  accessTokenSet: boolean;
  webhookTokenSet: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function toWhatsAppConfigView(row: WhatsAppConfig): WhatsAppConfigView {
  return {
    id: row.id,
    companyName: row.companyName,
    whatsappNumber: row.whatsappNumber,
    defaultSenderName: row.defaultSenderName,
    phoneNumberId: row.phoneNumberId,
    businessAccount: row.businessAccount,
    isActive: row.isActive,
    accessTokenSet: row.accessToken.length > 0,
    webhookTokenSet: !!row.webhookToken,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
