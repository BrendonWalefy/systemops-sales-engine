import { and, eq } from "drizzle-orm";
import type {
  OutboundSafetyContext,
  OutboundSafetyContextReader,
} from "@/application/ports/outbound-safety-context-reader";
import { db } from "@/infrastructure/db/client";
import { conversations, leads, messages, organizations } from "@/infrastructure/db/schema";

export class DrizzleOutboundSafetyContextReader implements OutboundSafetyContextReader {
  async getContext(input: {
    clinicId: string;
    leadId: string;
    conversationId: string;
    agentMessageId: string;
  }): Promise<OutboundSafetyContext | null> {
    const [clinic] = await db
      .select({
        id: organizations.id,
        timezone: organizations.timezone,
        businessHours: organizations.businessHours,
        outboundHourlyCap: organizations.outboundHourlyCap,
        outboundDailyCap: organizations.outboundDailyCap,
      })
      .from(organizations)
      .where(eq(organizations.id, input.clinicId))
      .limit(1);

    if (!clinic) return null;

    const [lead] = await db
      .select({
        id: leads.id,
        phone: leads.phone,
        whatsappLid: leads.whatsappLid,
        contactConsentRevokedAt: leads.contactConsentRevokedAt,
      })
      .from(leads)
      .where(and(eq(leads.id, input.leadId), eq(leads.clinicId, input.clinicId)))
      .limit(1);

    const [conversation] = await db
      .select({
        id: conversations.id,
        leadId: conversations.leadId,
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, input.conversationId),
          eq(conversations.clinicId, input.clinicId),
          eq(conversations.leadId, input.leadId),
        ),
      )
      .limit(1);

    const [agentMessage] = await db
      .select({
        id: messages.id,
        conversationId: messages.conversationId,
      })
      .from(messages)
      .where(
        and(
          eq(messages.id, input.agentMessageId),
          eq(messages.conversationId, input.conversationId),
          eq(messages.author, "agent"),
        ),
      )
      .limit(1);

    return {
      clinic,
      lead: lead ?? null,
      conversation: conversation ?? null,
      agentMessage: agentMessage ?? null,
    };
  }
}
