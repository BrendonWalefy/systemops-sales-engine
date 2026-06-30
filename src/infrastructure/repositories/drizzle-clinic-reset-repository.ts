import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import {
  organizations,
  leads,
  conversations,
  messages,
  conversationStates,
  agentRecommendations,
  slotReservations,
  followUps,
  appointments,
  calendarBlocks,
  aiUsageCosts,
  whatsappMessageCosts,
} from "@/infrastructure/db/schema";
import type { ClinicResetPort, DbResetCounts } from "@/application/use-cases/clinics/reset-clinic-data";

export class DrizzleClinicResetRepository implements ClinicResetPort {
  async findClinicName(clinicId: string): Promise<string | null> {
    const [clinic] = await db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, clinicId))
      .limit(1);
    return clinic?.name ?? null;
  }

  async listAppointmentCalendarIds(clinicId: string): Promise<string[]> {
    const rows = await db
      .select({ calendarEventId: appointments.calendarEventId })
      .from(appointments)
      .where(and(eq(appointments.clinicId, clinicId), isNotNull(appointments.calendarEventId)));
    return rows.map((r) => r.calendarEventId!);
  }

  async deleteAllData(clinicId: string): Promise<DbResetCounts> {
    // Busca IDs de conversas e leads para deletar dependências em cascata
    const convRows = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.clinicId, clinicId));
    const convIds = convRows.map((r) => r.id);

    const leadRows = await db
      .select({ id: leads.id })
      .from(leads)
      .where(eq(leads.clinicId, clinicId));
    const leadIds = leadRows.map((r) => r.id);

    const counts: DbResetCounts = {
      conversationStates: 0,
      messages: 0,
      agentRecommendations: 0,
      slotReservations: 0,
      followUps: 0,
      appointments: 0,
      calendarBlocks: 0,
      conversations: 0,
      aiUsageCosts: 0,
      whatsappMessageCosts: 0,
      leads: 0,
    };

    if (convIds.length > 0) {
      const csDeleted = await db
        .delete(conversationStates)
        .where(inArray(conversationStates.conversationId, convIds))
        .returning({ id: conversationStates.id });
      counts.conversationStates = csDeleted.length;

      const msgDeleted = await db
        .delete(messages)
        .where(inArray(messages.conversationId, convIds))
        .returning({ id: messages.id });
      counts.messages = msgDeleted.length;

      const arDeleted = await db
        .delete(agentRecommendations)
        .where(eq(agentRecommendations.clinicId, clinicId))
        .returning({ id: agentRecommendations.id });
      counts.agentRecommendations = arDeleted.length;
    }

    if (leadIds.length > 0) {
      const srDeleted = await db
        .delete(slotReservations)
        .where(eq(slotReservations.clinicId, clinicId))
        .returning({ id: slotReservations.id });
      counts.slotReservations = srDeleted.length;

      const fuDeleted = await db
        .delete(followUps)
        .where(eq(followUps.clinicId, clinicId))
        .returning({ id: followUps.id });
      counts.followUps = fuDeleted.length;

      const apDeleted = await db
        .delete(appointments)
        .where(eq(appointments.clinicId, clinicId))
        .returning({ id: appointments.id });
      counts.appointments = apDeleted.length;
    }

    const blocksDeleted = await db
      .delete(calendarBlocks)
      .where(eq(calendarBlocks.clinicId, clinicId))
      .returning({ id: calendarBlocks.id });
    counts.calendarBlocks = blocksDeleted.length;

    if (convIds.length > 0) {
      const convDeleted = await db
        .delete(conversations)
        .where(eq(conversations.clinicId, clinicId))
        .returning({ id: conversations.id });
      counts.conversations = convDeleted.length;
    }

    const aiDeleted = await db
      .delete(aiUsageCosts)
      .where(eq(aiUsageCosts.clinicId, clinicId))
      .returning({ id: aiUsageCosts.id });
    counts.aiUsageCosts = aiDeleted.length;

    const waDeleted = await db
      .delete(whatsappMessageCosts)
      .where(eq(whatsappMessageCosts.clinicId, clinicId))
      .returning({ id: whatsappMessageCosts.id });
    counts.whatsappMessageCosts = waDeleted.length;

    if (leadIds.length > 0) {
      const leadsDeleted = await db
        .delete(leads)
        .where(eq(leads.clinicId, clinicId))
        .returning({ id: leads.id });
      counts.leads = leadsDeleted.length;
    }

    return counts;
  }
}
