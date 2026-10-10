import {
  BadGatewayException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import axios from 'axios';
import { timingSafeEqual } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import {
  recordAdminAudit,
  requireActor,
} from '../../modules/adminos/identity-admin';
import {
  CreateWhatsAppConfigDto,
  UpdateWhatsAppConfigDto,
} from './dto/whatsapp-config.dto';
import {
  CreateWhatsAppBotConfigDto,
  CreateWhatsAppDepartmentRouteDto,
  SendWhatsAppMessageDto,
} from './dto/whatsapp-bot.dto';
import {
  toWhatsAppConfigView,
  WhatsAppConfigView,
} from './whatsapp-config.view';

// The Graph API base URL. Overridable (WHATSAPP_GRAPH_BASE_URL) so that tests can point
// sends at a local stand-in; in production it is Meta's.
export const DEFAULT_GRAPH_BASE_URL = 'https://graph.facebook.com/v20.0';

const SEND_TIMEOUT_MS = 15000;

function graphBaseUrl(): string {
  return (
    process.env.WHATSAPP_GRAPH_BASE_URL || DEFAULT_GRAPH_BASE_URL
  ).replace(/\/+$/, '');
}

function sameSecret(given: string, stored: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(stored);

  return a.length === b.length && timingSafeEqual(a, b);
}

// Meta's own error text, without anything that could be one of our credentials.
function upstreamMessage(data: unknown, secrets: string[]): string | undefined {
  const raw = (data as { error?: { message?: unknown } } | undefined)?.error
    ?.message;
  if (typeof raw !== 'string' || raw.length === 0) return undefined;

  let text = raw.slice(0, 300);
  for (const secret of secrets) {
    if (secret) text = text.split(secret).join('[redacted]');
  }

  return text.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
}

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createConfig(
    data: CreateWhatsAppConfigDto,
    actorId: string | undefined,
  ): Promise<WhatsAppConfigView> {
    return this.prisma.$transaction(async (tx) => {
      const actor = await requireActor(tx, actorId);

      const config = await tx.whatsAppConfig.create({
        data: {
          companyName: data.companyName,
          whatsappNumber: data.whatsappNumber,
          defaultSenderName: data.defaultSenderName,
          phoneNumberId: data.phoneNumberId,
          accessToken: data.accessToken,
          businessAccount: data.businessAccount,
          webhookToken: data.webhookToken || null,
          isActive: data.isActive,
        },
      });

      const view = toWhatsAppConfigView(config);

      await recordAdminAudit(tx, {
        actorId: actor.id,
        action: 'WHATSAPP_CONFIG_CREATED',
        module: 'WhatsApp',
        recordId: config.id,
        newData: {
          companyName: view.companyName,
          whatsappNumber: view.whatsappNumber,
          phoneNumberId: view.phoneNumberId,
          isActive: view.isActive,
          accessTokenSet: view.accessTokenSet,
          webhookTokenSet: view.webhookTokenSet,
        },
      });

      return view;
    });
  }

  // A secret left out, or sent empty, keeps its stored value.
  async updateConfig(
    id: string,
    data: UpdateWhatsAppConfigDto,
    actorId: string | undefined,
  ): Promise<WhatsAppConfigView> {
    return this.prisma.$transaction(async (tx) => {
      const actor = await requireActor(tx, actorId);

      const existing = await tx.whatsAppConfig.findUnique({ where: { id } });
      if (!existing) {
        throw new NotFoundException('WhatsApp configuration not found.');
      }

      const update: Prisma.WhatsAppConfigUpdateInput = {};
      const changedFields: string[] = [];

      for (const field of [
        'companyName',
        'whatsappNumber',
        'defaultSenderName',
        'phoneNumberId',
        'businessAccount',
        'isActive',
      ] as const) {
        if (data[field] !== undefined && data[field] !== existing[field]) {
          (update as Record<string, unknown>)[field] = data[field];
          changedFields.push(field);
        }
      }

      const accessTokenChanged =
        !!data.accessToken && data.accessToken !== existing.accessToken;
      if (accessTokenChanged) update.accessToken = data.accessToken;

      const webhookTokenChanged =
        !!data.webhookToken && data.webhookToken !== existing.webhookToken;
      if (webhookTokenChanged) update.webhookToken = data.webhookToken;

      const config = await tx.whatsAppConfig.update({
        where: { id },
        data: update,
      });

      await recordAdminAudit(tx, {
        actorId: actor.id,
        action: 'WHATSAPP_CONFIG_UPDATED',
        module: 'WhatsApp',
        recordId: id,
        newData: { changedFields, accessTokenChanged, webhookTokenChanged },
      });

      return toWhatsAppConfigView(config);
    });
  }

  async createBotConfig(data: CreateWhatsAppBotConfigDto) {
    return this.prisma.whatsAppBotConfig.create({
      data: {
        whatsappConfigId: data.whatsappConfigId,
        welcomeMessage: data.welcomeMessage,
        unknownUserMessage: data.unknownUserMessage,
        enableCustomerLookup: data.enableCustomerLookup,
        enableLeadCapture: data.enableLeadCapture,
        enableHumanHandoff: data.enableHumanHandoff,
        isActive: data.isActive,
      },
    });
  }

  async createDepartmentRoute(data: CreateWhatsAppDepartmentRouteDto) {
    return this.prisma.whatsAppDepartmentRoute.create({
      data: {
        botConfigId: data.botConfigId,
        optionNumber: data.optionNumber,
        departmentName: data.departmentName,
        routeType: data.routeType,
        roleId: data.roleId,
        isActive: data.isActive,
      },
    });
  }

  async getConfigs(): Promise<WhatsAppConfigView[]> {
    const rows = await this.prisma.whatsAppConfig.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });

    return rows.map(toWhatsAppConfigView);
  }

  // Sends a text message through the Graph API. The access token is used here and
  // nowhere else: the result is a plain summary, and any failure becomes a clean 502
  // carrying only Meta's own error text, so neither a response nor a log line can ever
  // contain the token (the raw axios response and error both do).
  async sendMessage(data: SendWhatsAppMessageDto) {
    const config = await this.prisma.whatsAppConfig.findFirst({
      where: {
        id: data.configId,
        isActive: true,
      },
    });

    if (!config) {
      throw new NotFoundException('WhatsApp configuration not found.');
    }

    const url = `${graphBaseUrl()}/${encodeURIComponent(config.phoneNumberId)}/messages`;

    let responseData: unknown;
    try {
      const response = await axios.post<unknown>(
        url,
        {
          messaging_product: 'whatsapp',
          to: data.to,
          type: 'text',
          text: {
            body: data.message,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${config.accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: SEND_TIMEOUT_MS,
        },
      );
      responseData = response.data;
    } catch (error) {
      const upstreamStatus = axios.isAxiosError(error)
        ? error.response?.status
        : undefined;
      const detail = axios.isAxiosError(error)
        ? upstreamMessage(error.response?.data, [
            config.accessToken,
            config.webhookToken ?? '',
          ])
        : undefined;

      this.logger.warn(
        JSON.stringify({
          event: 'whatsapp.send.failed',
          configId: config.id,
          upstreamStatus: upstreamStatus ?? null,
          errorCode: axios.isAxiosError(error) ? (error.code ?? null) : null,
        }),
      );

      throw new BadGatewayException(
        upstreamStatus === undefined
          ? 'WhatsApp could not be reached.'
          : `WhatsApp did not accept the message${detail ? `: ${detail}` : '.'}`,
      );
    }

    const messageId = (
      responseData as { messages?: Array<{ id?: unknown }> } | undefined
    )?.messages?.[0]?.id;

    return {
      status: 'SENT' as const,
      messageId: typeof messageId === 'string' ? messageId : null,
    };
  }

  // Meta's subscription handshake: answers the challenge only for the verify token
  // stored on an active configuration (compared in constant time).
  async verifyWebhook(mode: string, token: string, challenge: string) {
    if (mode === 'subscribe' && typeof token === 'string' && token) {
      const configs = await this.prisma.whatsAppConfig.findMany({
        where: { isActive: true, webhookToken: { not: null } },
        select: { webhookToken: true },
      });

      if (
        configs.some((c) => c.webhookToken && sameSecret(token, c.webhookToken))
      ) {
        return challenge;
      }
    }

    throw new ForbiddenException('Webhook verification failed.');
  }

  async handleIncomingMessage(body: any) {
    const incomingMessage =
      body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!incomingMessage) {
      return { message: 'No incoming message' };
    }

    const customerNumber = incomingMessage.from;
    const customerText = incomingMessage.text?.body?.trim();

    const botConfig =
      await this.prisma.whatsAppBotConfig.findFirst({
        where: {
          isActive: true,
        },
      });

    const routes =
      await this.prisma.whatsAppDepartmentRoute.findMany({
        where: {
          botConfigId: botConfig?.id,
          isActive: true,
        },
        orderBy: {
          optionNumber: 'asc',
        },
      });

    const menu = routes
      .map(
        (route) =>
          `${route.optionNumber}. ${route.departmentName}`,
      )
      .join('\n');

    let conversation =
      await this.prisma.whatsAppConversation.findFirst({
        where: {
          customerNumber,
          isActive: true,
        },
      });

    if (!conversation) {
      conversation =
        await this.prisma.whatsAppConversation.create({
          data: {
            whatsappConfigId:
              botConfig?.whatsappConfigId!,
            customerNumber,
          },
        });

      return {
        message:
          botConfig?.unknownUserMessage ??
          'Welcome 👋 Please tell us your name.',
      };
    }

    if (!conversation.customerName) {
      await this.prisma.whatsAppConversation.update({
        where: {
          id: conversation.id,
        },
        data: {
          customerName: customerText,
          currentStep: 'NAME_CAPTURED',
        },
      });

      const leadSource =
        await this.prisma.leadSource.findFirst({
          where: {
            name: 'WHATSAPP',
          },
        });

      if (leadSource) {
        const newLead = await this.prisma.lead.create({
          data: {
            customerName: customerText,
            phone: incomingMessage.from,
            sourceId: leadSource.id,
            status: 'NEW',
          },
        });

        await this.prisma.leadTimeline.create({
          data: {
            leadId: newLead.id,
            action: 'LEAD_CREATED',
            remarks: 'Auto-created from WhatsApp Bot',
          },
        });
      }

      return {
        message: `
Thank you ${customerText} 👋

${botConfig?.welcomeMessage}

${menu}
`,
      };
    }

    if (conversation.currentStep === 'WAITING_REFERENCE') {
      await this.prisma.whatsAppConversation.update({
        where: {
          id: conversation.id,
        },
        data: {
          referenceValue: customerText,
          currentStep: 'WAITING_COMPLAINT',
        },
      });

      return {
        message: `
Reference received ✅

Please describe your complaint/problem in detail.
`,
      };
    }

        
if (conversation.currentStep === 'WAITING_COMPLAINT') {
  const updatedConversation =
    await this.prisma.whatsAppConversation.update({
      where: {
        id: conversation.id,
      },
      data: {
        complaintText: customerText,
        currentStep: 'SERVICE_TICKET_PENDING',
      },
    });

  const warranty =
    await this.prisma.warranty.findFirst({
      where: {
        serialNumber:
          updatedConversation.referenceValue ?? '',
        status: 'ACTIVE',
      },
    });

  if (!warranty) {
    return {
      message: `
Warranty not found ❌

Please verify your Serial Number / Warranty Number and try again.
`,
    };
  }

const route =
  await this.prisma.whatsAppDepartmentRoute.findFirst({
    where: {
      departmentName: conversation.selectedDept ?? '',
      isActive: true,
    },
  });

const assignedUser =
  await this.prisma.user.findFirst({
    where: {
      roleId: route?.roleId ?? undefined,
      status: 'ACTIVE',
    },
  });

  const serviceTicket =
  await this.prisma.serviceTicket.create({
    data: {
      warrantyId: warranty.id,
      complaintTitle: 'WhatsApp Service Complaint',
      complaintDetail: customerText,
      priority: 'NORMAL',
      assignedTo: assignedUser?.fullName,
      status: 'OPEN',
    },
  });

  await this.prisma.whatsAppConversation.update({
    where: {
      id: conversation.id,
    },
    data: {
      currentStep: 'SERVICE_TICKET_CREATED',
    },
  });

  return {
    message: `
Service Ticket Created ✅

Ticket ID: ${serviceTicket.id}

Our service team will contact you shortly.
`,
  };
}





    const selectedRoute = routes.find(
      (route) =>
        route.optionNumber.toString() === customerText,
    );

    if (selectedRoute) {
      const assignedUser =
        await this.prisma.user.findFirst({
          where: {
            roleId: selectedRoute.roleId ?? undefined,
            status: 'ACTIVE',
          },
        });

      const inquiry =
        await this.prisma.whatsAppInquiry.create({
          data: {
            conversationId: conversation.id,
            departmentName:
              selectedRoute.departmentName,
            routeType: selectedRoute.routeType,
            inquiryStatus: 'OPEN',
            assignedToId: assignedUser?.id,
          },
        });

      await this.prisma.whatsAppConversation.update({
        where: {
          id: conversation.id,
        },
        data: {
          selectedDept:
            selectedRoute.departmentName,
          currentStep: 'DEPARTMENT_SELECTED',
        },
      });

      await this.prisma.notification.create({
        data: {
          userId: assignedUser?.id,
          title: `${selectedRoute.departmentName} Inquiry`,
          message: `New WhatsApp inquiry received for ${selectedRoute.departmentName}`,
          channel: 'IN_APP',
          category: 'WHATSAPP',
          priority: 'HIGH',
          status: 'PENDING',
          referenceType: 'WHATSAPP_INQUIRY',
          referenceId: inquiry.id,
        },
      });

      if (selectedRoute.routeType === 'SERVICE') {
        await this.prisma.whatsAppConversation.update({
          where: {
            id: conversation.id,
          },
          data: {
            selectedDept:
              selectedRoute.departmentName,
            currentStep: 'WAITING_REFERENCE',
          },
        });

        return {
          message: `
You selected: ${selectedRoute.departmentName} ✅

Please share your:
Invoice Number / Serial Number / Warranty Number
so we can identify your product.
`,
        };
      }

      return {
        message: `
You selected: ${selectedRoute.departmentName} ✅

Your request has been forwarded successfully.

Reference ID: ${inquiry.id}
Status: OPEN

Our ${selectedRoute.departmentName} team will contact you shortly.
`,
      };
    }

    return {
      message: `
Hello Sir/Madam 👋

${botConfig?.welcomeMessage}

${menu}
`,
    };
  }
}
