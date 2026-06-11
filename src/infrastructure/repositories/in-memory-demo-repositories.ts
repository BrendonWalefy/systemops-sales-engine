import type { SalesAgentRecommendation } from "@/domain/entities/agent-recommendation";
import type { Appointment } from "@/domain/entities/calendar-slot";
import type { Conversation, Message } from "@/domain/entities/conversation";
import type { FollowUp } from "@/domain/entities/follow-up";
import type { Lead } from "@/domain/entities/lead";
import type { AiUsageCost, WhatsAppMessageCost } from "@/domain/entities/usage-cost";
import type {
  AgentRecommendationRepository,
  HumanDecision,
} from "@/domain/repositories/agent-recommendation-repository";
import type { AppointmentRepository } from "@/domain/repositories/appointment-repository";
import type { ConversationRepository } from "@/domain/repositories/conversation-repository";
import type { FollowUpRepository } from "@/domain/repositories/follow-up-repository";
import type { LeadRepository } from "@/domain/repositories/lead-repository";
import type { UsageCostRepository } from "@/domain/repositories/usage-cost-repository";

export class InMemoryDemoStore
  implements
    LeadRepository,
    ConversationRepository,
    AgentRecommendationRepository,
    FollowUpRepository,
    AppointmentRepository,
    UsageCostRepository
{
  readonly leads = new Map<string, Lead>();
  readonly conversations = new Map<string, Conversation>();
  readonly messages = new Map<string, Message[]>();
  readonly recommendations = new Map<string, SalesAgentRecommendation>();
  readonly followUps = new Map<string, FollowUp>();
  readonly appointments = new Map<string, Appointment>();
  readonly aiUsageCosts: AiUsageCost[] = [];
  readonly whatsappMessageCosts: WhatsAppMessageCost[] = [];
  readonly humanDecisions = new Map<
    string,
    { decision: HumanDecision; finalReply: string | null }
  >();

  findById(id: string): Promise<Lead | null>;
  findById(id: string): Promise<Appointment | null>;
  async findById(id: string): Promise<Lead | Appointment | null> {
    return this.leads.get(id) ?? this.appointments.get(id) ?? null;
  }

  async findByPhone(clinicId: string, phone: string): Promise<Lead | null> {
    return (
      Array.from(this.leads.values()).find(
        (lead) => lead.clinicId === clinicId && lead.phone === phone,
      ) ?? null
    );
  }

  async findByWhatsAppLid(clinicId: string, whatsappLid: string): Promise<Lead | null> {
    return (
      Array.from(this.leads.values()).find(
        (lead) => lead.clinicId === clinicId && lead.whatsappLid === whatsappLid,
      ) ?? null
    );
  }

  async findInactiveLeads(): Promise<Lead[]> {
    return [];
  }

  async mergeDuplicateLeads(params: {
    canonicalLeadId: string;
    duplicateLeadId: string;
  }): Promise<Lead> {
    const canonical = this.leads.get(params.canonicalLeadId);
    const duplicate = this.leads.get(params.duplicateLeadId);
    if (!canonical || !duplicate) {
      throw new Error("mergeDuplicateLeads: lead não encontrado");
    }
    const merged: Lead = {
      ...canonical,
      phone: canonical.phone ?? duplicate.phone,
      whatsappLid: canonical.whatsappLid ?? duplicate.whatsappLid,
      name: canonical.name ?? duplicate.name,
    };
    this.leads.set(canonical.id, merged);
    this.leads.delete(duplicate.id);
    return merged;
  }

  async save(leadOrRecommendationOrFollowUpOrAppointment: Lead): Promise<void>;
  async save(leadOrRecommendationOrFollowUpOrAppointment: SalesAgentRecommendation): Promise<void>;
  async save(leadOrRecommendationOrFollowUpOrAppointment: FollowUp): Promise<void>;
  async save(leadOrRecommendationOrFollowUpOrAppointment: Appointment): Promise<void>;
  async save(entity: Lead | SalesAgentRecommendation | FollowUp | Appointment): Promise<void> {
    if ("channel" in entity && "status" in entity && "temperature" in entity) {
      this.leads.set(entity.id, entity);
      return;
    }

    if ("suggestedReply" in entity) {
      this.recommendations.set(entity.id, entity);
      return;
    }

    if ("dueAt" in entity && "reason" in entity) {
      this.followUps.set(entity.id, entity);
      return;
    }

    this.appointments.set(entity.id, entity);
  }

  async findByLeadId(leadId: string): Promise<Conversation | null>;
  async findByLeadId(leadId: string): Promise<Appointment | null>;
  async findByLeadId(leadId: string): Promise<Conversation | Appointment | null> {
    return (
      Array.from(this.conversations.values()).find(
        (conversation) => conversation.leadId === leadId,
      ) ??
      Array.from(this.appointments.values()).find(
        (appointment) => appointment.leadId === leadId,
      ) ??
      null
    );
  }

  async findActiveByLeadId(leadId: string): Promise<Appointment | null> {
    return (
      Array.from(this.appointments.values()).find(
        (appointment) =>
          appointment.leadId === leadId &&
          (appointment.status === "scheduled" || appointment.status === "confirmed"),
      ) ?? null
    );
  }

  async findAllActiveByLeadId(leadId: string): Promise<Appointment[]> {
    return Array.from(this.appointments.values()).filter(
      (appointment) =>
        appointment.leadId === leadId &&
        (appointment.status === "scheduled" || appointment.status === "confirmed"),
    );
  }

  async findByPeriod(clinicId: string, from: Date, to: Date): Promise<Appointment[]> {
    return Array.from(this.appointments.values()).filter(
      (a) => a.clinicId === clinicId && a.startsAt < to && a.endsAt > from,
    );
  }

  async findDueReminders(params: {
    clinicId: string;
    windowStart: Date;
    windowEnd: Date;
  }): Promise<Appointment[]> {
    return Array.from(this.appointments.values()).filter(
      (a) =>
        a.clinicId === params.clinicId &&
        (a.status === "scheduled" || a.status === "confirmed") &&
        a.reminderSentAt === null &&
        a.startsAt >= params.windowStart &&
        a.startsAt <= params.windowEnd,
    );
  }

  async findByCalendarEventId(clinicId: string, calendarEventId: string): Promise<Appointment | null> {
    return Array.from(this.appointments.values()).find(
      (a) => a.clinicId === clinicId && a.calendarEventId === calendarEventId,
    ) ?? null;
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    this.conversations.set(conversation.id, conversation);
  }

  async setAiPaused(conversationId: string, paused: boolean): Promise<void> {
    const conv = this.conversations.get(conversationId);
    if (conv) this.conversations.set(conversationId, { ...conv, aiPaused: paused });
  }

  async setTakeover(conversationId: string, expiresAt: Date | null): Promise<void> {
    const conv = this.conversations.get(conversationId);
    if (conv) this.conversations.set(conversationId, { ...conv, aiPaused: expiresAt !== null, takeoverExpiresAt: expiresAt });
  }

  async appendMessage(message: Message): Promise<void> {
    const messages = this.messages.get(message.conversationId) ?? [];
    this.messages.set(message.conversationId, [...messages, message]);
  }

  async listMessages(conversationId: string): Promise<Message[]> {
    return this.messages.get(conversationId) ?? [];
  }

  async recordHumanDecision(input: {
    recommendationId: string;
    decision: HumanDecision;
    finalReply: string | null;
  }): Promise<void> {
    this.humanDecisions.set(input.recommendationId, {
      decision: input.decision,
      finalReply: input.finalReply,
    });
  }

  async listDue(input: { clinicId: string; now: Date }): Promise<FollowUp[]> {
    return Array.from(this.followUps.values()).filter(
      (followUp) =>
        followUp.clinicId === input.clinicId &&
        followUp.status === "pending" &&
        followUp.dueAt <= input.now,
    );
  }

  async findPendingByReason(input: { leadId: string; reason: string }): Promise<FollowUp | null> {
    const found = Array.from(this.followUps.values()).find(
      (f) => f.leadId === input.leadId && f.reason === input.reason && f.status === "pending",
    );
    return found ?? null;
  }

  async listPendingByLead(input: { leadId: string }): Promise<FollowUp[]> {
    return Array.from(this.followUps.values()).filter(
      (followUp) => followUp.leadId === input.leadId && followUp.status === "pending",
    );
  }

  async cancelPendingByReason(input: { leadId: string; reason: string }): Promise<number> {
    let cancelled = 0;
    for (const [id, followUp] of this.followUps) {
      if (followUp.leadId === input.leadId && followUp.reason === input.reason && followUp.status === "pending") {
        this.followUps.set(id, { ...followUp, status: "cancelled", updatedAt: new Date() });
        cancelled++;
      }
    }
    return cancelled;
  }

  async cancelPendingByLead(input: { leadId: string }): Promise<number> {
    let cancelled = 0;
    for (const [id, followUp] of this.followUps) {
      if (followUp.leadId === input.leadId && followUp.status === "pending") {
        this.followUps.set(id, { ...followUp, status: "cancelled", updatedAt: new Date() });
        cancelled++;
      }
    }
    return cancelled;
  }

  async claimForSending(id: string): Promise<boolean> {
    const followUp = this.followUps.get(id);
    if (!followUp || followUp.status !== "pending") return false;
    this.followUps.set(id, { ...followUp, status: "sending", updatedAt: new Date() });
    return true;
  }

  async recoverStaleSending(input: { clinicId: string; olderThan: Date }): Promise<number> {
    let recovered = 0;
    for (const [id, followUp] of this.followUps) {
      if (followUp.clinicId === input.clinicId && followUp.status === "sending" && followUp.updatedAt < input.olderThan) {
        this.followUps.set(id, { ...followUp, status: "pending", updatedAt: new Date() });
        recovered++;
      }
    }
    return recovered;
  }

  async recordAiUsage(cost: AiUsageCost): Promise<void> {
    this.aiUsageCosts.push(cost);
  }

  async recordWhatsAppMessageCost(cost: WhatsAppMessageCost): Promise<void> {
    this.whatsappMessageCosts.push(cost);
  }
}
