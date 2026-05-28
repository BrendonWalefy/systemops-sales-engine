// Coração do sistema: coordena todo o fluxo de uma mensagem inbound.
// Substitui a lógica de orquestração espalhada no zapi/route.ts.
//
// Fluxo: mensagem → deduplicação → lead/conversa → intent → ação → resposta

import { randomUUID } from "crypto";
import { db } from "@/infrastructure/db/client";
import { clinics, conversations as conversationsTable, messages as messagesTable } from "@/infrastructure/db/schema";
import { eq, and, count, gte } from "drizzle-orm";

import { RegisterIncomingMessage } from "@/application/use-cases/leads/register-incoming-message";
import { DefaultUsageCostTracker } from "@/application/services/default-usage-cost-tracker";
import { DrizzleLeadRepository } from "@/infrastructure/repositories/drizzle-lead-repository";
import { DrizzleConversationRepository } from "@/infrastructure/repositories/drizzle-conversation-repository";
import { DrizzleUsageCostRepository } from "@/infrastructure/repositories/drizzle-usage-cost-repository";
import { DrizzleAppointmentRepository } from "@/infrastructure/repositories/drizzle-appointment-repository";
import { DrizzleTreatmentRepository } from "@/infrastructure/repositories/drizzle-treatment-repository";
import { GoogleCalendarGateway } from "@/infrastructure/adapters/calendar/google/google-calendar-gateway";
import { sendTextMessage } from "@/infrastructure/adapters/channels/whatsapp/whatsapp-sender";

import { ClinicTimezone, parseBusinessHours } from "@/core/scheduling/ClinicTimezone";
import { ConversationStateMachine } from "@/core/conversation/ConversationStateMachine";
import { IntentClassifier } from "@/core/intelligence/IntentClassifier";
import { ResponseComposer } from "@/core/intelligence/ResponseComposer";
import { BookingService } from "@/core/scheduling/BookingService";
import { selectBestSlots } from "@/core/scheduling/SlotEngine";
import { resolveTreatmentDuration } from "@/core/scheduling/resolveTreatmentDuration";
import type { FormattedSlot } from "@/core/conversation/ConversationStateMachine";
import { NotifyClinicOperators } from "@/application/use-cases/notifications/notify-clinic-operators";
import { DrizzlePushSubscriptionRepository } from "@/infrastructure/repositories/drizzle-push-subscription-repository";
import { WebPushGateway } from "@/infrastructure/adapters/push/web-push-gateway";

import type { Clinic } from "@/domain/entities/clinic";

const SLOTS_LOOKAHEAD_DAYS = 14;
const MAX_SLOTS_TO_OFFER = 5;
const RATE_LIMIT_MESSAGES_PER_HOUR = 20;
const SLOTS_WITH_DATE_AND_TIME = 2;
// Quantas classificações unclear consecutivas disparam notificação ao operador
const UNCLEAR_THRESHOLD = 3;
const SLOTS_WITH_DATE_ONLY = 3;

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
    takeoverTtlHours: row.takeoverTtlHours,
    postAppointmentBufferMinutes: row.postAppointmentBufferMinutes,
    defaultAppointmentDurationMinutes: row.defaultAppointmentDurationMinutes,
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
  private treatmentRepo = new DrizzleTreatmentRepository();
  private notifier = new NotifyClinicOperators(
    new DrizzlePushSubscriptionRepository(),
    new WebPushGateway(),
  );

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

    // ── 4. Verifica se a IA está pausada para esta conversa ──
    // Se há TTL expirado → retoma automaticamente e sinaliza ao Composer para contextualizar.
    // Se pausada sem TTL (pause manual) ou TTL ainda vigente → silêncio.
    let resumedFromHumanTakeover = false;
    if (conversation.aiPaused) {
      const now = new Date();
      if (conversation.takeoverExpiresAt && conversation.takeoverExpiresAt < now) {
        await db
          .update(conversationsTable)
          .set({ aiPaused: false, takeoverExpiresAt: null, updatedAt: now })
          .where(eq(conversationsTable.id, conversation.id));
        resumedFromHumanTakeover = true;
        console.log(`[Orchestrator] Takeover TTL expirado para ${conversation.id} — IA retomada`);
      } else {
        console.log(`[Orchestrator] AI pausada para ${conversation.id}, ignorando resposta`);
        // Notifica operador que lead respondeu enquanto atendimento estava em pausa manual
        const leadLabel = lead.name ? `${lead.name} (${phone})` : phone;
        await this.notifier
          .execute(clinicId, {
            title: "Resposta do lead",
            body: `${leadLabel}: ${messageText.slice(0, 80)}`,
            url: `/app/inbox/${conversation.id}`,
          })
          .catch((err) => console.error("[Orchestrator] Push falhou:", err));
        return { replied: false };
      }
    }

    // ── 5. Rate limit — máx 20 msgs/hora do lead por conversa ──
    // Protege custo OpenAI contra spam e loops. A mensagem já foi salva no passo 3.
    const oneHourAgo = new Date(Date.now() - 60 * 60_000);
    const rateRows = await db
      .select({ total: count() })
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.conversationId, conversation.id),
          eq(messagesTable.author, "lead"),
          gte(messagesTable.sentAt, oneHourAgo),
        ),
      );
    const msgCount = Number(rateRows[0]?.total ?? 0);
    if (msgCount >= RATE_LIMIT_MESSAGES_PER_HOUR) {
      console.warn(`[Orchestrator] Rate limit: ${phone} atingiu ${msgCount} msgs/h na conversa ${conversation.id}`);
      return { replied: false };
    }

    // ── 7. Carrega histórico de mensagens ──
    const allMessages = await this.conversationRepo.listMessages(conversation.id);

    // ── 8. Verifica oferta de slots pendente ──
    const pendingSlots = await this.stateMachine.getPendingSlotOffer(conversation.id);
    const hasPendingOffer = pendingSlots !== null;

    // ── 9. Classifica intenção com LLM estágio 1 ──
    const clinicTreatments = await this.treatmentRepo.listByClinic(clinicId);
    const classification = await this.intentClassifier.classify(
      messageText,
      allMessages,
      hasPendingOffer,
      clinicTreatments.map((t) => t.name),
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
      clinic.postAppointmentBufferMinutes,
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
        resumedFromHumanTakeover,
      });
      composerInputTokens = composed.inputTokens;
      composerOutputTokens = composed.outputTokens;
      return composed.text;
    };

    switch (intent) {
      // ── Confirmação de slot ──
      case "confirm_slot": {
        // Guarda de segurança: se o lead não escolheu pelo número mas mencionou uma data
        // que não bate com nenhum slot pendente, trata como nova solicitação para essa data.
        if (!slotPreference.slotChoice && slotPreference.preferredDate && pendingSlots) {
          const targetDay = timezone.resolvePreferredDate(slotPreference.preferredDate, new Date(), businessHours);
          if (targetDay) {
            const dateMatchesPending = pendingSlots.some((s) => {
              const p = timezone.toLocalParts(new Date(s.startsAt));
              const t = timezone.toLocalParts(targetDay);
              return p.year === t.year && p.month === t.month && p.day === t.day;
            });
            if (!dateMatchesPending) {
              await this.stateMachine.invalidate(conversation.id);
              const { slots: redirectSlots, preferredDayEmpty: rdEmpty, outsideBookingWindow: rdOutside, outsideBusinessHours: rdNotOpen, preferredPeriodUnavailable: rdPeriod } = await this.fetchAndOfferSlots(
                conversation.id, clinic, calendarGateway, timezone, businessHours,
                slotPreference.preferredDate, slotPreference.preferredPeriod ?? undefined,
              );
              if (rdOutside) {
                replyText = await compose({ type: "clarification_needed", question: "Só consigo ver horários com até 14 dias de antecedência. Tem algum dia mais próximo que funcione para você?" });
              } else if (rdNotOpen) {
                replyText = await compose({ type: "clarification_needed", question: "O atendimento de hoje já encerrou. Posso verificar os horários de amanhã ou outro dia para você?" });
              } else if (rdPeriod) {
                replyText = await compose({
                  type: "clarification_needed",
                  question: `Não temos atendimento no período da noite — nosso horário vai até as ${businessHours.endHour}h. Posso verificar outro período?`,
                });
              } else if (redirectSlots.length > 0 && !rdEmpty) {
                replyText = await compose({ type: "slots_found", slots: redirectSlots, askedForPreference: false });
              } else if (rdEmpty) {
                replyText = await compose({ type: "no_slots_available", alternativeSlots: redirectSlots.length > 0 ? redirectSlots : undefined });
              } else {
                replyText = await compose({ type: "no_slots_available" });
              }
              break;
            }
          }
        }

        const choiceIndex = slotPreference.slotChoice ?? 1;
        const chosenSlot = pendingSlots
          ? pendingSlots.find((s) => s.index === choiceIndex) ?? pendingSlots[0]
          : null;

        if (!chosenSlot) {
          // Lead tentou escolher um número mas a oferta expirou (15 min TTL)
          if (slotPreference.slotChoice !== null) {
            const { slots: freshSlots } = await this.fetchAndOfferSlots(
              conversation.id,
              clinic,
              calendarGateway,
              timezone,
              businessHours,
            );
            replyText = freshSlots.length > 0
              ? await compose({ type: "slots_expired", freshSlots })
              : await compose({ type: "no_slots_available" });
          } else {
            replyText = await compose({ type: "clarification_needed", question: "Qual horário você prefere? Posso mostrar as opções disponíveis." });
          }
          break;
        }

        // Opção B: cancela appointment ativo existente antes de criar novo.
        // Garante que o lead nunca acumule múltiplos agendamentos ativos —
        // qualquer nova confirmação é tratada como remarcação implícita.
        const existingAppointment = await this.appointmentRepo.findActiveByLeadId(lead.id);
        if (existingAppointment) {
          await bookingService.cancel({ lead, appointment: existingAppointment });
        }

        const offeredTreatment = await this.stateMachine.getOfferedTreatment(conversation.id);
        const result = await bookingService.book({
          clinic,
          lead,
          startsAt: new Date(chosenSlot.startsAt),
          endsAt: new Date(chosenSlot.endsAt),
          treatmentName: offeredTreatment?.treatmentName,
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
          const { slots: newSlots } = await this.fetchAndOfferSlots(
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
        const previousTreatment = await this.stateMachine.getOfferedTreatment(conversation.id);
        await this.stateMachine.invalidate(conversation.id);

        // Se o lead rejeitou E expressou preferência (ex: "não quero quinta, só tenho sexta"),
        // busca imediatamente para aquele dia em vez de perguntar novamente.
        if (slotPreference.preferredDate || slotPreference.preferredPeriod) {
          const { slots: preferredSlots, preferredDayEmpty: rejectDayEmpty, outsideBookingWindow: rejectOutside, outsideBusinessHours: rejectNotOpen, preferredPeriodUnavailable: rejectPeriodUnavail } = await this.fetchAndOfferSlots(
            conversation.id,
            clinic,
            calendarGateway,
            timezone,
            businessHours,
            slotPreference.preferredDate ?? undefined,
            slotPreference.preferredPeriod ?? undefined,
            undefined,
            previousTreatment?.treatmentName,
            previousTreatment?.durationMinutes,
          );
          if (rejectOutside) {
            replyText = await compose({
              type: "clarification_needed",
              question: "Só consigo ver horários com até 14 dias de antecedência. Tem algum dia mais próximo que funcione para você?",
            });
          } else if (rejectNotOpen) {
            replyText = await compose({
              type: "clarification_needed",
              question: "O atendimento de hoje já encerrou. Posso verificar os horários de amanhã ou outro dia para você?",
            });
          } else if (rejectPeriodUnavail) {
            replyText = await compose({
              type: "clarification_needed",
              question: `Não temos atendimento no período da noite — nosso horário vai até as ${businessHours.endHour}h. Posso verificar outro período?`,
            });
          } else if (preferredSlots.length > 0 && !rejectDayEmpty) {
            replyText = await compose({ type: "slots_found", slots: preferredSlots, askedForPreference: false });
          } else if (rejectDayEmpty) {
            replyText = await compose({
              type: "no_slots_available",
              alternativeSlots: preferredSlots.length > 0 ? preferredSlots : undefined,
            });
          } else {
            replyText = await compose({ type: "no_slots_available" });
          }
        } else {
          replyText = await compose({
            type: "clarification_needed",
            question: "Sem problemas! Qual período te atende melhor — manhã ou tarde? Ou tem algum dia específico em mente?",
          });
        }
        break;
      }

      // ── Verificar disponibilidade ou agendar ──
      case "book_appointment":
      case "check_availability": {
        // Invalida oferta anterior se houver nova mensagem com preferência
        if (hasPendingOffer && (slotPreference.preferredDate || slotPreference.preferredPeriod)) {
          await this.stateMachine.invalidate(conversation.id);
        }

        // Resolve tratamento e duração do slot
        const resolution = resolveTreatmentDuration(
          slotPreference.identifiedTreatment ?? null,
          clinicTreatments,
          clinic.defaultAppointmentDurationMinutes,
          classification.shouldAskClarification,
        );

        if (resolution.kind === "ask_clarification") {
          replyText = await compose({
            type: "clarification_needed",
            question: classification.clarificationQuestion ?? "Qual procedimento você gostaria de realizar?",
          });
          break;
        }

        const resolvedTreatmentName = resolution.kind === "matched" ? resolution.treatmentName : undefined;
        const resolvedDurationMinutes = resolution.durationMinutes;

        const { slots: formattedSlots, preferredDayEmpty, outsideBookingWindow, outsideBusinessHours, preferredPeriodUnavailable } = await this.fetchAndOfferSlots(
          conversation.id,
          clinic,
          calendarGateway,
          timezone,
          businessHours,
          slotPreference.preferredDate ?? undefined,
          slotPreference.preferredPeriod ?? undefined,
          slotPreference.preferredTime ?? undefined,
          resolvedTreatmentName,
          resolvedDurationMinutes,
        );

        if (outsideBookingWindow) {
          replyText = await compose({
            type: "clarification_needed",
            question: "Só consigo ver horários com até 14 dias de antecedência. Tem algum dia mais próximo que funcione para você?",
          });
        } else if (outsideBusinessHours) {
          replyText = await compose({
            type: "clarification_needed",
            question: "O atendimento de hoje já encerrou. Posso verificar os horários de amanhã ou outro dia para você?",
          });
        } else if (preferredPeriodUnavailable) {
          replyText = await compose({
            type: "clarification_needed",
            question: `Não temos atendimento no período da noite — nosso horário vai até as ${businessHours.endHour}h. Posso verificar outro período?`,
          });
        } else if (formattedSlots.length > 0 && !preferredDayEmpty) {
          replyText = await compose({
            type: "slots_found",
            slots: formattedSlots,
            askedForPreference: false,
          });
        } else if (preferredDayEmpty) {
          replyText = await compose({
            type: "no_slots_available",
            alternativeSlots: formattedSlots.length > 0 ? formattedSlots : undefined,
          });
        } else if (!slotPreference.preferredDate && !slotPreference.preferredPeriod) {
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
        // Preserva o treatment do agendamento anterior (se havia oferta ativa) para manter duração correta
        const rescheduleOfferedTreatment = await this.stateMachine.getOfferedTreatment(conversation.id);
        const activeAppointment = await this.appointmentRepo.findActiveByLeadId(lead.id);

        if (activeAppointment) {
          await bookingService.cancel({ lead, appointment: activeAppointment });
        }

        const { slots: newSlots, preferredDayEmpty: rescheduleEmpty, outsideBookingWindow: rescheduleOutside, outsideBusinessHours: rescheduleNotOpen, preferredPeriodUnavailable: reschedulePeriodUnavail } = await this.fetchAndOfferSlots(
          conversation.id,
          clinic,
          calendarGateway,
          timezone,
          businessHours,
          slotPreference.preferredDate ?? undefined,
          slotPreference.preferredPeriod ?? undefined,
          slotPreference.preferredTime ?? undefined,
          rescheduleOfferedTreatment?.treatmentName,
          rescheduleOfferedTreatment?.durationMinutes,
        );

        if (rescheduleOutside) {
          replyText = await compose({
            type: "clarification_needed",
            question: "Só consigo ver horários com até 14 dias de antecedência. Tem algum dia mais próximo que funcione para você?",
          });
        } else if (rescheduleNotOpen) {
          replyText = await compose({
            type: "clarification_needed",
            question: "O atendimento de hoje já encerrou. Posso verificar os horários de amanhã ou outro dia para você?",
          });
        } else if (reschedulePeriodUnavail) {
          replyText = await compose({
            type: "clarification_needed",
            question: `Não temos atendimento no período da noite — nosso horário vai até as ${businessHours.endHour}h. Posso verificar outro período?`,
          });
        } else if (newSlots.length > 0 && !rescheduleEmpty) {
          replyText = await compose({ type: "appointment_rescheduled", newSlots });
        } else if (rescheduleEmpty) {
          replyText = await compose({
            type: "no_slots_available",
            alternativeSlots: newSlots.length > 0 ? newSlots : undefined,
          });
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
        await db
          .update(conversationsTable)
          .set({ needsAttention: true, attentionReason: "Urgência clínica relatada pelo lead", updatedAt: new Date() })
          .where(eq(conversationsTable.id, conversation.id));
        await this.notifyAttentionNeeded(clinic, phone, lead.name ?? null, "Urgência clínica relatada");
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

      // ── Reconhecimento mid-conversa ──
      case "acknowledgment": {
        replyText = await compose({ type: "acknowledgment" });
        break;
      }

      // ── Encerramento de conversa ──
      case "farewell": {
        replyText = await compose({ type: "farewell" });
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

    // ── 8. Atualiza contador de unclear e flag needsAttention ──
    const isUnclear = intent === "unclear";
    const resetsClarity = !isUnclear && intent !== "greeting" && intent !== "acknowledgment";

    if (isUnclear) {
      const newCount = (conversation.consecutiveUnclearCount ?? 0) + 1;
      const hitThreshold = newCount === UNCLEAR_THRESHOLD;
      await db
        .update(conversationsTable)
        .set({
          consecutiveUnclearCount: newCount,
          ...(hitThreshold && {
            needsAttention: true,
            attentionReason: "Lead enviou 3 mensagens sem que a IA conseguisse entender",
          }),
          updatedAt: new Date(),
        })
        .where(eq(conversationsTable.id, conversation.id));

      if (hitThreshold) {
        await this.notifyAttentionNeeded(clinic, phone, lead.name ?? null, "Não conseguiu entender o lead após 3 tentativas");
      }
    } else if (resetsClarity && (conversation.consecutiveUnclearCount ?? 0) > 0) {
      await db
        .update(conversationsTable)
        .set({ consecutiveUnclearCount: 0, updatedAt: new Date() })
        .where(eq(conversationsTable.id, conversation.id));
    }

    // ── 9. Envia resposta e captura messageId para deduplicar o echo fromMe do Z-API ──
    const zapiMessageId = await sendTextMessage(phone, replyText);

    // ── 9.1 Push notification — avisa operadores que um lead enviou mensagem ──
    const leadLabel = lead.name ? `${lead.name} (${phone})` : phone;
    await this.notifier
      .execute(clinicId, {
        title: `💬 ${leadLabel}`,
        body: messageText.slice(0, 100),
        url: `/app/inbox/${conversation.id}`,
      })
      .catch((err) => console.error("[Orchestrator] Push falhou:", err));

    // ── 10. Salva mensagem do agente no histórico ──
    const agentMessageId = randomUUID();
    await this.conversationRepo.appendMessage({
      id: agentMessageId,
      conversationId: conversation.id,
      author: "agent",
      body: replyText,
      sentAt: new Date(),
      externalId: zapiMessageId ?? null,
    });

    // ── 11. Registra custo do LLM (classifier + composer) ──
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
  // Retorna { slots, preferredDayEmpty, outsideBookingWindow, outsideBusinessHours, preferredPeriodUnavailable } onde:
  //   - outsideBookingWindow=true      → data pedida está além da janela de 14 dias
  //   - outsideBusinessHours=true      → dia pedido é hoje mas o expediente já encerrou
  //   - preferredPeriodUnavailable=true→ lead pediu noite mas a clínica fecha às 18h ou antes
  //   - preferredDayEmpty=true         → dia está na janela mas sem horários; slots são alternativas
  //                                      NÃO salvos na state machine (lead não escolheu nada ainda)
  //   - preferredDayEmpty=false        → slots confirmáveis, salvos na state machine
  private async fetchAndOfferSlots(
    conversationId: string,
    clinic: Clinic,
    calendarGateway: GoogleCalendarGateway,
    timezone: ClinicTimezone,
    businessHours: ReturnType<typeof parseBusinessHours>,
    preferredDate?: string,
    preferredPeriod?: string,
    preferredTime?: string,
    treatmentName?: string,
    slotDurationMinutes?: number,
  ): Promise<{ slots: FormattedSlot[]; preferredDayEmpty: boolean; outsideBookingWindow: boolean; outsideBusinessHours: boolean; preferredPeriodUnavailable: boolean }> {
    const from = this.slotWindowStart();
    const to = new Date(from.getTime() + SLOTS_LOOKAHEAD_DAYS * 24 * 60 * 60_000);
    const duration = slotDurationMinutes ?? clinic.defaultAppointmentDurationMinutes;

    let allSlots = await calendarGateway.listAvailableSlots({
      clinicId: clinic.id,
      from,
      to,
      slotDurationMinutes: duration,
    });

    let filteredToDay = false;
    let preferredDayEmpty = false;

    if (preferredDate) {
      const now = new Date();
      const targetDay = timezone.resolvePreferredDate(preferredDate, now, businessHours);
      if (targetDay !== null) {
        if (targetDay > to) {
          return { slots: [], preferredDayEmpty: false, outsideBookingWindow: true, outsideBusinessHours: false, preferredPeriodUnavailable: false };
        }
        const targetParts = timezone.toLocalParts(targetDay);
        const slotsOnDay = allSlots.filter((slot) => {
          const p = timezone.toLocalParts(slot.startsAt);
          return p.year === targetParts.year && p.month === targetParts.month && p.day === targetParts.day;
        });
        const nowParts = timezone.toLocalParts(now);
        const isToday = targetParts.year === nowParts.year && targetParts.month === nowParts.month && targetParts.day === nowParts.day;
        if (slotsOnDay.length > 0) {
          allSlots = slotsOnDay;
          filteredToDay = true;
        } else if (isToday && nowParts.hour >= businessHours.endHour - 1) {
          return { slots: [], preferredDayEmpty: false, outsideBookingWindow: false, outsideBusinessHours: true, preferredPeriodUnavailable: false };
        } else {
          // Dia preferido sem disponibilidade — sinaliza e mantém pool completo como alternativas.
          // Alternativas NÃO serão salvas na state machine: lead ainda não escolheu nenhum dia.
          preferredDayEmpty = true;
        }
      }
    }

    // Filtra por período apenas quando o dia preferido foi encontrado
    if (!preferredDayEmpty && preferredPeriod) {
      const byPeriod = allSlots.filter((slot) => {
        const parts = timezone.toLocalParts(slot.startsAt);
        if (preferredPeriod === "morning") return parts.hour >= 8 && parts.hour < 12;
        if (preferredPeriod === "afternoon") return parts.hour >= 12 && parts.hour < 18;
        if (preferredPeriod === "evening") return parts.hour >= 17;
        return true;
      });
      if (byPeriod.length > 0) {
        allSlots = byPeriod;
      } else if (preferredPeriod === "evening" && businessHours.endHour <= 18) {
        return { slots: [], preferredDayEmpty: false, outsideBookingWindow: false, outsideBusinessHours: false, preferredPeriodUnavailable: true };
      }
    }

    // Ordena por proximidade à hora solicitada quando o lead especificou horário.
    // Normaliza hora ambígua para horário comercial: "3" com clínica 8-18 → 15h, não 3am.
    if (preferredTime) {
      const hourMatch = preferredTime.match(/(\d{1,2})/);
      let preferredHour = hourMatch ? parseInt(hourMatch[1], 10) : null;
      if (preferredHour !== null) {
        const pmCandidate = preferredHour + 12;
        if (
          preferredHour < businessHours.startHour &&
          pmCandidate >= businessHours.startHour &&
          pmCandidate < businessHours.endHour
        ) {
          preferredHour = pmCandidate;
        }
        allSlots.sort((a, b) => {
          const aHour = timezone.toLocalParts(a.startsAt).hour;
          const bHour = timezone.toLocalParts(b.startsAt).hour;
          return Math.abs(aHour - preferredHour!) - Math.abs(bHour - preferredHour!);
        });
      }
    }

    const count = (filteredToDay && preferredTime)
      ? SLOTS_WITH_DATE_AND_TIME
      : filteredToDay
      ? SLOTS_WITH_DATE_ONLY
      : MAX_SLOTS_TO_OFFER;

    const best = selectBestSlots(allSlots, count, timezone);

    if (best.length === 0) return { slots: [], preferredDayEmpty, outsideBookingWindow: false, outsideBusinessHours: false, preferredPeriodUnavailable: false };

    if (preferredDayEmpty) {
      // Formata para exibição sem salvar na state machine
      const formatted: FormattedSlot[] = best.map((s, i) => ({
        index: i + 1,
        startsAt: s.startsAt.toISOString(),
        endsAt: s.endsAt.toISOString(),
        label: timezone.formatForHuman(s.startsAt),
      }));
      return { slots: formatted, preferredDayEmpty: true, outsideBookingWindow: false, outsideBusinessHours: false, preferredPeriodUnavailable: false };
    }

    const slots = await this.stateMachine.offerSlots(conversationId, best, timezone, treatmentName, duration);
    return { slots, preferredDayEmpty: false, outsideBookingWindow: false, outsideBusinessHours: false, preferredPeriodUnavailable: false };
  }

  private async notifyAttentionNeeded(
    clinic: Clinic,
    leadPhone: string,
    leadName: string | null,
    reason: string,
  ): Promise<void> {
    const leadLabel = leadName ? `${leadName} (${leadPhone})` : leadPhone;

    // WhatsApp para o número da recepção (se configurado)
    const receptPhone = process.env.RECEPTIONIST_PHONE_NUMBER;
    if (receptPhone) {
      try {
        await sendTextMessage(
          receptPhone,
          `⚠️ *Atenção necessária — ${clinic.name}*\n\nLead: ${leadLabel}\nMotivo: ${reason}\n\nAcesse o Inbox para retomar o atendimento manualmente.`,
        );
      } catch (err) {
        console.error("[Orchestrator] Failed to send attention WhatsApp notification:", err);
      }
    }

    // Push notification para todos os operadores com app instalado
    await this.notifier
      .execute(clinic.id, {
        title: `⚠️ Atenção — ${clinic.name}`,
        body: `${leadLabel}: ${reason}`,
        url: "/app/inbox",
      })
      .catch((err) => console.error("[Orchestrator] Push falhou:", err));
  }

}
