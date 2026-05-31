import { db } from "@/infrastructure/db/client";
import { messages, conversations, appointments } from "@/infrastructure/db/schema";
import { eq, gte, lte, and, inArray } from "drizzle-orm";

export type ClinicMetrics = {
  clinicId: string;
  period: { from: Date; to: Date };
  totalConversations: number;
  unclearRate: number;
  topUnclearMessages: string[];
  needsHumanRate: number;
  needsHumanReasons: string[];
  dropOffAfterSlotsRate: number;
  priceInquiryToBookingRate: number;
  topIntents: Array<{ intent: string; count: number }>;
  conversionRate: number;
};

export class MetricsAggregator {
  async aggregate(clinicId: string, days = 30): Promise<ClinicMetrics> {
    const periodTo = new Date();
    const periodFrom = new Date(periodTo);
    periodFrom.setDate(periodFrom.getDate() - days);

    const clinicConversations = await db
      .select({ id: conversations.id, leadId: conversations.leadId })
      .from(conversations)
      .where(
        and(
          eq(conversations.clinicId, clinicId),
          gte(conversations.createdAt, periodFrom),
          lte(conversations.createdAt, periodTo),
        ),
      );

    const totalConversations = clinicConversations.length;

    if (totalConversations === 0) {
      return {
        clinicId,
        period: { from: periodFrom, to: periodTo },
        totalConversations: 0,
        unclearRate: 0,
        topUnclearMessages: [],
        needsHumanRate: 0,
        needsHumanReasons: [],
        dropOffAfterSlotsRate: 0,
        priceInquiryToBookingRate: 0,
        topIntents: [],
        conversionRate: 0,
      };
    }

    const conversationIds = clinicConversations.map((c) => c.id);
    const leadIds = [...new Set(clinicConversations.map((c) => c.leadId))];

    const allMessages = await db
      .select({ conversationId: messages.conversationId, author: messages.author, body: messages.body, intent: messages.intent })
      .from(messages)
      .where(inArray(messages.conversationId, conversationIds));

    // Intent counts (agent messages only)
    const agentMessages = allMessages.filter((m) => m.author === "agent" && m.intent);
    const intentCounts = new Map<string, number>();
    for (const m of agentMessages) {
      if (m.intent) {
        intentCounts.set(m.intent, (intentCounts.get(m.intent) ?? 0) + 1);
      }
    }

    const totalAgentMessages = agentMessages.length;

    const unclearCount = intentCounts.get("unclear") ?? 0;
    const unclearRate = totalAgentMessages > 0 ? unclearCount / totalAgentMessages : 0;

    const topUnclearMessages = allMessages
      .filter((m) => m.author === "lead" && m.intent === "unclear")
      .map((m) => m.body)
      .slice(0, 10);

    const needsHumanCount = intentCounts.get("needs_human") ?? 0;
    const needsHumanRate = totalConversations > 0 ? needsHumanCount / totalConversations : 0;

    // Drop-off after slots: conversations where last agent intent was slots_found
    const conversationLastIntent = new Map<string, string>();
    for (const m of agentMessages) {
      if (m.intent) {
        conversationLastIntent.set(m.conversationId, m.intent);
      }
    }
    const droppedAfterSlots = [...conversationLastIntent.values()].filter((i) => i === "slots_found").length;
    const dropOffAfterSlotsRate = totalConversations > 0 ? droppedAfterSlots / totalConversations : 0;

    // Price inquiry to booking conversion
    const conversationsWithPriceInquiry = new Set(
      agentMessages.filter((m) => m.intent === "price_inquiry").map((m) => m.conversationId),
    );
    const conversationsWithConfirm = new Set(
      agentMessages.filter((m) => m.intent === "confirm_slot").map((m) => m.conversationId),
    );
    const priceToBooking = [...conversationsWithPriceInquiry].filter((id) => conversationsWithConfirm.has(id)).length;
    const priceInquiryToBookingRate = conversationsWithPriceInquiry.size > 0 ? priceToBooking / conversationsWithPriceInquiry.size : 0;

    // Overall conversion (lead that booked at least once)
    const appointmentLeads = await db
      .select({ leadId: appointments.leadId })
      .from(appointments)
      .where(
        and(
          eq(appointments.clinicId, clinicId),
          gte(appointments.createdAt, periodFrom),
        ),
      );
    const bookedLeadIds = new Set(appointmentLeads.map((a) => a.leadId));
    const conversionRate = leadIds.length > 0 ? [...bookedLeadIds].filter((id) => leadIds.includes(id)).length / leadIds.length : 0;

    const topIntents = [...intentCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([intent, count]) => ({ intent, count }));

    return {
      clinicId,
      period: { from: periodFrom, to: periodTo },
      totalConversations,
      unclearRate,
      topUnclearMessages,
      needsHumanRate,
      needsHumanReasons: [],
      dropOffAfterSlotsRate,
      priceInquiryToBookingRate,
      topIntents,
      conversionRate,
    };
  }
}
