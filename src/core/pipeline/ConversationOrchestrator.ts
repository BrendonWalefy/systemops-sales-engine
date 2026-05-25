// Coração do sistema: coordena todo o fluxo de uma mensagem inbound.
// Substitui a lógica de orquestração espalhada no zapi/route.ts.
//
// Fluxo: mensagem → deduplicação → lead/conversa → intent → ação → resposta

import { randomUUID } from "crypto";
import { db } from "@/infrastructure/db/client";
import { clinics, messages as messagesTable } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";

import { RegisterIncomingMessage } from "@/application/use-cases/leads/register-incoming-message";
import { DefaultUsageCostTracker } from "@/application/services/default-usage-cost-tracker";
import { DrizzleLeadRepository } from "@/infrastructure/repositories/drizzle-lead-repository";
import { DrizzleConversationRepository } from "@/infrastructure/repositories/drizzle-conversation-repository";
import { DrizzleUsageCostRepository } from "@/infrastructure/repositories/drizzle-usage-cost-repository";
import { DrizzleAppointmentRepository } from "@/infrastructure/repositories/drizzle-appointment-repository";
import { GoogleCalendarGateway } from "@/infrastructure/adapters/calendar/google/google-calendar-gateway";
import { sendTextMessage } from "@/infrastructure/adapters/channels/whatsapp/whatsapp-sender";

import { ClinicTimezone, parseBusinessHours } from "@/core/scheduling/ClinicTimezone";
import { ConversationStateMachine } from "@/core/conversation/ConversationStateMachine";
import { IntentClassifier } from "@/core/intelligence/IntentClassifier";
import { ResponseComposer } from "@/core/intelligence/ResponseComposer";
import { BookingService } from "@/core/scheduling/BookingService";
import { selectBestSlots } from "@/core/scheduling/SlotEngine";

import type { Clinic } from "@/domain/entities/clinic";

const SLOTS_LOOKAHEAD_DAYS = 14;
const MAX_SLOTS_TO_OFFER = 3;

type ClinicRow = typeof clinics.$inferSelect;

function buildClinic(row: ClinicRow): Clinic {
  return {
    id: row.id,
    name: row.name,
    specialty: row.specialty,
    city: row.city,
    timezone: row.timezone,
    toneOfVoice: row.toneOfVoice,
    commercialPolicy: row.commercialPolicy,
    playbook: row.playbook,
    businessHours: row.businessHours,
    googleCalendarId: row.googleCalendarId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class ConversationOrchestrator {
  private stateMachine = new ConversationStateMachine();
  private intentClassifier = new IntentClassifier();
  private responseComposer = new ResponseComposer();

  private leadRepo = new DrizzleLeadRepository();
  private conversationRepo = new DrizzleConversationRepository();
  private appointmentRepo = new DrizzleAppointmentRepository();
  private usageCostRepo = new DrizzleUsageCostRepository();

  async handle(params: {
    clinicId: string;
    phone: string;
    messageText: string;
    messageId: string;
    senderName?: string;
    timestamp: Date;
  }): Promise<{ replied: boolean }> {
    const { clinicId, phone, messageText, messageId, senderName, timestamp } = params;

    // ── 1. Deduplicação: retorna imediatamente se já processamos esta mensagem ──
    const alreadyProcessed = await db
      .select({ id: messagesTable.id })
      .from(messagesTable)
      .where(eq(messagesTable.externalId, messageId))
      .limit(1);

    if (alreadyProcessed.length > 0) {
      return { replied: false };
    }

    // ── 2. Busca clínica ──
    const clinicRows = await db
      .select()
      .from(clinics)
      .where(eq(clinics.id, clinicId))
      .limit(1);

    if (clinicRows.length === 0) {
      console.error(`[Orchestrator] Clinic not found: ${clinicId}`);
      return { replied: false };
    }

    const clinic = buildClinic(clinicRows[0]);
    const timezone = new ClinicTimezone(clinic.timezone);
    const businessHours = parseBusinessHours(clinic.businessHours);

    // ── 3. Registra lead, conversa e mensagem ──
    const usageCostTracker = new DefaultUsageCostTracker({
      usageCostRepository: this.usageCostRepo,
      idGenerator: randomUUID,
      now: () => new Date(),
    });

    const registerUseCase = new RegisterIncomingMessage({
      leadRepository: this.leadRepo,
      conversationRepository: this.conversationRepo,
      usageCostTracker,
      idGenerator: randomUUID,
      now: () => new Date(),
    });

    const { lead, conversation } = await registerUseCase.execute({
      clinicId,
      message: {
        externalMessageId: messageId,
        externalContactId: phone,
        phone,
        name: senderName ?? null,
        email: null,
        campaignId: null,
        channel: "whatsapp",
        externalThreadId: phone,
        body: messageText,
        receivedAt: timestamp,
      },
    });

    // ── 4. Carrega histórico de mensagens ──
    const allMessages = await this.conversationRepo.listMessages(conversation.id);

    // ── 5. Verifica oferta de slots pendente ──
    const pendingSlots = await this.stateMachine.getPendingSlotOffer(conversation.id);
    const hasPendingOffer = pendingSlots !== null;

    // ── 6. Classifica intenção com LLM estágio 1 ──
    const classification = await this.intentClassifier.classify(
      messageText,
      allMessages,
      hasPendingOffer,
    );

    const { intent, slotPreference } = classification;

    // ── 7. Executa ação e compõe resposta ──
    let replyText: string;
    let composerInputTokens = 0;
    let composerOutputTokens = 0;

    const calendarGateway = new GoogleCalendarGateway(
      clinic.googleCalendarId,
      timezone,
      clinic.businessHours,
    );

    const bookingService = new BookingService(
      calendarGateway,
      this.appointmentRepo,
      this.leadRepo,
    );

    const isFirstMessage = allMessages.filter((m) => m.author !== "lead").length === 0;

    // Helper para compor resposta
    const compose = async (
      actionResult: Parameters<ResponseComposer["compose"]>[0]["actionResult"],
    ) => {
      const composed = await this.responseComposer.compose({
        actionResult,
        conversationHistory: allMessages,
        clinic: {
          name: clinic.name,
          specialty: clinic.specialty,
          toneOfVoice: clinic.toneOfVoice,
          playbook: clinic.playbook,
          commercialPolicy: clinic.commercialPolicy,
        },
        leadName: lead.name,
        timezone,
        isFirstMessage,
      });
      composerInputTokens = composed.inputTokens;
      composerOutputTokens = composed.outputTokens;
      return composed.text;
    };

    switch (intent) {
      // ── Confirmação de slot ──
      case "confirm_slot": {
        const choiceIndex = slotPreference.slotChoice ?? 1;
        const chosenSlot = pendingSlots
          ? pendingSlots.find((s) => s.index === choiceIndex) ?? pendingSlots[0]
          : null;

        if (!chosenSlot) {
          replyText = await compose({ type: "clarification_needed", question: "Qual horário você prefere? Posso mostrar as opções disponíveis." });
          break;
        }

        // Opção B: cancela appointment ativo existente antes de criar novo.
        // Garante que o lead nunca acumule múltiplos agendamentos ativos —
        // qualquer nova confirmação é tratada como remarcação implícita.
        const existingAppointment = await this.appointmentRepo.findActiveByLeadId(lead.id);
        if (existingAppointment) {
          await bookingService.cancel({ lead, appointment: existingAppointment });
        }

        const result = await bookingService.book({
          clinic,
          lead,
          startsAt: new Date(chosenSlot.startsAt),
          endsAt: new Date(chosenSlot.endsAt),
        });

        if (result.success) {
          await this.stateMachine.transition(conversation.id, "idle");
          replyText = await compose({
            type: "appointment_confirmed",
            slot: chosenSlot,
            clinicName: clinic.name,
          });
        } else if (result.reason === "slot_taken") {
          // Slot foi tomado por outro lead — oferece novos horários
          const newSlots = await this.fetchAndOfferSlots(
            conversation.id,
            clinic,
            calendarGateway,
            timezone,
            businessHours,
          );
          if (newSlots.length > 0) {
            replyText = await compose({ type: "slots_found", slots: newSlots, askedForPreference: false });
          } else {
            replyText = await compose({ type: "no_slots_available" });
          }
        } else {
          replyText = await compose({
            type: "clarification_needed",
            question: "Tivemos um problema ao confirmar o agendamento. Pode tentar novamente?",
          });
        }
        break;
      }

      // ── Rejeição dos slots oferecidos ──
      case "reject_slots": {
        await this.stateMachine.invalidate(conversation.id);
        replyText = await compose({
          type: "clarification_needed",
          question: "Sem problemas! Qual período te atende melhor — manhã ou tarde? Ou tem algum dia específico em mente?",
        });
        break;
      }

      // ── Verificar disponibilidade ou agendar ──
      case "book_appointment":
      case "check_availability": {
        // Invalida oferta anterior se houver nova mensagem com preferência
        if (hasPendingOffer && (slotPreference.preferredDate || slotPreference.preferredPeriod)) {
          await this.stateMachine.invalidate(conversation.id);
        }

        const formattedSlots = await this.fetchAndOfferSlots(
          conversation.id,
          clinic,
          calendarGateway,
          timezone,
          businessHours,
          slotPreference.preferredDate ?? undefined,
          slotPreference.preferredPeriod ?? undefined,
        );

        if (formattedSlots.length > 0) {
          replyText = await compose({
            type: "slots_found",
            slots: formattedSlots,
            askedForPreference: false,
          });
        } else if (!slotPreference.preferredDate && !slotPreference.preferredPeriod) {
          // Sem preferência — pergunta antes de buscar
          replyText = await compose({
            type: "clarification_needed",
            question: "Qual período te atende melhor — manhã ou tarde? E tem algum dia específico em mente?",
          });
        } else {
          replyText = await compose({ type: "no_slots_available" });
        }
        break;
      }

      // ── Cancelamento ──
      case "cancel_appointment": {
        const allActive = await this.appointmentRepo.findAllActiveByLeadId(lead.id);

        if (allActive.length === 0) {
          replyText = await compose({ type: "no_appointments" });
          break;
        }

        // Cancela todos os appointments ativos em paralelo
        const results = await Promise.all(
          allActive.map((a) => bookingService.cancel({ lead, appointment: a })),
        );
        const anyFailed = results.some((r) => !r.success);

        if (!anyFailed) {
          replyText = await compose({ type: "appointment_cancelled", count: allActive.length });
        } else {
          replyText = await compose({
            type: "clarification_needed",
            question: "Tivemos um problema ao cancelar. Pode tentar novamente ou entrar em contato conosco?",
          });
        }
        break;
      }

      // ── Remarcação ──
      case "reschedule_appointment": {
        const activeAppointment = await this.appointmentRepo.findActiveByLeadId(lead.id);

        if (activeAppointment) {
          await bookingService.cancel({ lead, appointment: activeAppointment });
        }

        const newSlots = await this.fetchAndOfferSlots(
          conversation.id,
          clinic,
          calendarGateway,
          timezone,
          businessHours,
          slotPreference.preferredDate ?? undefined,
          slotPreference.preferredPeriod ?? undefined,
        );

        if (newSlots.length > 0) {
          replyText = await compose({ type: "appointment_rescheduled", newSlots });
        } else {
          replyText = await compose({ type: "no_slots_available" });
        }
        break;
      }

      // ── Listar agendamentos ──
      case "list_appointments": {
        const activeAppointments = await this.appointmentRepo.findAllActiveByLeadId(lead.id);

        if (activeAppointments.length === 0) {
          replyText = await compose({ type: "no_appointments" });
        } else {
          replyText = await compose({
            type: "appointments_listed",
            appointments: activeAppointments.map((a) => ({
              label: timezone.formatForConfirmation(a.startsAt),
              status: a.status,
            })),
          });
        }
        break;
      }

      // ── Urgência clínica ──
      case "clinical_urgency": {
        replyText = await compose({ type: "clinical_urgency" });
        await this.notifyHandoff(clinic, phone);
        break;
      }

      // ── Preço ──
      case "price_inquiry": {
        replyText = await compose({ type: "price_inquiry" });
        break;
      }

      // ── Saudação ──
      case "greeting": {
        replyText = await compose({ type: "greeting" });
        break;
      }

      // ── Unclear / General ──
      case "unclear":
      default: {
        if (classification.shouldAskClarification && classification.clarificationQuestion) {
          replyText = await compose({
            type: "clarification_needed",
            question: classification.clarificationQuestion,
          });
        } else {
          replyText = await compose({
            type: "general_question",
            clinicContext: `${clinic.name} — ${clinic.specialty}. ${clinic.commercialPolicy ?? ""}`,
          });
        }
        break;
      }
    }

    // ── 8. Envia resposta ──
    await sendTextMessage(phone, replyText);

    // ── 9. Salva mensagem do agente no histórico ──
    const agentMessageId = randomUUID();
    await this.conversationRepo.appendMessage({
      id: agentMessageId,
      conversationId: conversation.id,
      author: "agent",
      body: replyText,
      sentAt: new Date(),
      externalId: null,
    });

    // ── 10. Registra custo do LLM (classifier + composer) ──
    if (composerInputTokens > 0) {
      await usageCostTracker.trackAiUsage({
        clinicId,
        provider: "openai",
        model: "gpt-4o-mini",
        operation: "sales_conversation_analysis",
        inputTokens: composerInputTokens,
        outputTokens: composerOutputTokens,
      });
    }

    return { replied: true };
  }

  // Snapa para a próxima hora cheia com antecedência mínima de 2h.
  // Evita que o cursor do SlotEngine gere slots em :51 ou :37.
  private slotWindowStart(): Date {
    const minAdvanceMs = 2 * 60 * 60_000;
    const earliest = new Date(Date.now() + minAdvanceMs);
    const hourMs = 60 * 60_000;
    return new Date(Math.ceil(earliest.getTime() / hourMs) * hourMs);
  }

  // ── Helper: busca slots e salva oferta na state machine ──
  private async fetchAndOfferSlots(
    conversationId: string,
    clinic: Clinic,
    calendarGateway: GoogleCalendarGateway,
    timezone: ClinicTimezone,
    businessHours: ReturnType<typeof parseBusinessHours>,
    preferredDate?: string,
    preferredPeriod?: string,
  ) {
    const from = this.slotWindowStart();
    const to = new Date(from.getTime() + SLOTS_LOOKAHEAD_DAYS * 24 * 60 * 60_000);

    let allSlots = await calendarGateway.listAvailableSlots({
      clinicId: clinic.id,
      from,
      to,
    });

    // Filtra por período se informado
    if (preferredPeriod) {
      allSlots = allSlots.filter((slot) => {
        const parts = timezone.toLocalParts(slot.startsAt);
        if (preferredPeriod === "morning") return parts.hour >= 8 && parts.hour < 12;
        if (preferredPeriod === "afternoon") return parts.hour >= 12 && parts.hour < 18;
        if (preferredPeriod === "evening") return parts.hour >= 17;
        return true;
      });
    }

    const best = selectBestSlots(allSlots, MAX_SLOTS_TO_OFFER);

    if (best.length === 0) return [];

    return this.stateMachine.offerSlots(conversationId, best, timezone);
  }

  private async notifyHandoff(clinic: Clinic, leadPhone: string): Promise<void> {
    const receptPhone = process.env.RECEPTIONIST_PHONE_NUMBER;
    if (!receptPhone) return;

    try {
      await sendTextMessage(
        receptPhone,
        `🚨 *Urgência clínica detectada*\n\nClínica: ${clinic.name}\nLead: ${leadPhone}\n\nO lead relatou sintoma de urgência. Por favor, entre em contato imediatamente.`,
      );
    } catch (err) {
      console.error("[Orchestrator] Failed to send handoff notification:", err);
    }
  }
}
