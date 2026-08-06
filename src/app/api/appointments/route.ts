import { NextRequest, NextResponse } from "next/server";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { cookies } from "next/headers";
import { and, between, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { appointments, organizations, conversations, leads, professionals, treatments } from "@/infrastructure/db/schema";
import { verifyToken, COOKIE_NAME } from "@/lib/session";
import { DrizzleAppointmentRepository } from "@/infrastructure/repositories/drizzle-appointment-repository";
import { resolveSegmentVocab } from "@/application/onboarding/segment-vocab";
import { DrizzleLeadRepository } from "@/infrastructure/repositories/drizzle-lead-repository";
import { DrizzleFollowUpRepository } from "@/infrastructure/repositories/drizzle-follow-up-repository";
import { resolveCalendarGateway } from "@/infrastructure/adapters/calendar/resolve-calendar-gateway";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import { BookingService } from "@/core/scheduling/BookingService";
import { getActivePriceCampaignsByTreatment, effectiveBookableValueCents, combineAppointmentValueCents } from "@/application/config/price-campaigns";
import type { Lead } from "@/domain/entities/lead";
import { DrizzleConversationRepository } from "@/infrastructure/repositories/drizzle-conversation-repository";
import {
  normalizeManualWhatsAppPhone,
  normalizeWhatsAppPhone,
  resolveWhatsAppChannelAddress,
} from "@/core/whatsapp/WhatsAppContactIdentity";

export const dynamic = "force-dynamic";

async function requireAuth() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  return token ? verifyToken(token) : null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clinicId = await getSessionClinicId();
  if (!clinicId) return NextResponse.json({ error: "Sem clínica resolvida para a sessão" }, { status: 500 });

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (!from || !to) {
    return NextResponse.json({ error: "from e to são obrigatórios (ISO 8601)" }, { status: 400 });
  }

  try {
    const fromDate = new Date(from);
    const toDate = new Date(to);

    const rows = await db
      .select({
        id: appointments.id,
        leadId: appointments.leadId,
        leadName: leads.name,
        leadPhone: leads.phone,
        leadTreatmentInterest: leads.treatmentInterest,
        professionalId: appointments.professionalId,
        professionalName: professionals.name,
        professionalColor: professionals.color,
        calendarEventId: appointments.calendarEventId,
        calendarEventUrl: appointments.calendarEventUrl,
        startsAt: appointments.startsAt,
        endsAt: appointments.endsAt,
        status: appointments.status,
        source: appointments.source,
        description: appointments.description,
        createdAt: appointments.createdAt,
      })
      .from(appointments)
      .innerJoin(leads, eq(appointments.leadId, leads.id))
      .leftJoin(professionals, eq(appointments.professionalId, professionals.id))
      .where(
        and(
          eq(appointments.clinicId, clinicId),
          between(appointments.startsAt, fromDate, toDate),
        ),
      )
      .orderBy(appointments.startsAt);

    // Resolve conversationId por leadId evitando duplicatas (um lead pode ter N conversas)
    const leadIds = [...new Set(rows.map((r) => r.leadId))];
    const convMap = new Map<string, string>();
    if (leadIds.length > 0) {
      const convRows = await db
        .select({ leadId: conversations.leadId, id: conversations.id })
        .from(conversations)
        .where(inArray(conversations.leadId, leadIds))
        .orderBy(desc(conversations.createdAt));
      for (const c of convRows) {
        if (!convMap.has(c.leadId)) convMap.set(c.leadId, c.id);
      }
    }

    const result = rows.map((r) => ({ ...r, conversationId: convMap.get(r.leadId) ?? null }));
    return NextResponse.json({ appointments: result });
  } catch (err) {
    console.error("[appointments GET]", err);
    return NextResponse.json({ error: "Falha ao buscar agendamentos" }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    leadId?: string;
    // Nome livre digitado pelo operador (paciente walk-in / sem lead).
    patientName?: string;
    phone?: string;
    date: string;
    time: string;
    durationMinutes?: number;
    professionalId?: string;
    // Nome livre (legado). Preferir treatmentIds — múltiplos procedimentos combinados.
    treatmentName?: string;
    treatmentIds?: string[];
    // Anotação livre do operador sobre o agendamento.
    description?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  if (!body.date || !body.time || (!body.leadId && !body.patientName?.trim())) {
    return NextResponse.json({ error: "Informe o paciente, a data e o horário" }, { status: 400 });
  }

  try {
    const clinicId = await getSessionClinicId();
    if (!clinicId) throw new Error("Sem clínica resolvida para a sessão");

    const [clinicRow] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, clinicId))
      .limit(1);

    if (!clinicRow) return NextResponse.json({ error: "Clínica não encontrada" }, { status: 404 });

    // Resolve o paciente: lead existente (fluxo com busca) OU nome livre digitado
    // pelo operador. Para nome livre, reaproveita um lead pelo telefone quando houver,
    // senão cria um lead novo (canal "manual") — o agendamento sempre precisa de um lead.
    const leadRepo = new DrizzleLeadRepository();
    let lead: Lead | null = null;

    if (body.leadId) {
      lead = await leadRepo.findById(body.leadId);
      if (!lead) return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });
    } else {
      const patientName = body.patientName?.trim();
      if (!patientName) {
        return NextResponse.json({ error: "Informe o nome do paciente" }, { status: 400 });
      }
      const rawPhone = body.phone?.trim() ?? "";
      const phone = rawPhone
        ? normalizeManualWhatsAppPhone(rawPhone)
        : null;
      if (!phone) {
        return NextResponse.json(
          { error: "Informe um WhatsApp válido para enviar confirmação e lembrete" },
          { status: 400 },
        );
      }
      if (phone) {
        lead = await leadRepo.findByPhone(clinicId, phone);
        // Compatibilidade com pacientes antigos cadastrados só com DDD+número.
        // Evita criar um segundo lead ao passar a salvar novos contatos com DDI.
        const legacyPhone = normalizeWhatsAppPhone(rawPhone);
        if (!lead && legacyPhone && legacyPhone !== phone) {
          lead = await leadRepo.findByPhone(clinicId, legacyPhone);
        }
      }
      if (!lead) {
        const nowLead = new Date();
        lead = {
          id: crypto.randomUUID(),
          clinicId,
          name: patientName,
          phone,
          whatsappLid: null,
          email: null,
          channel: "manual",
          campaignId: null,
          treatmentInterest: body.treatmentName?.trim() || null,
          profilePicUrl: null,
          status: "appointment_scheduled",
          temperature: null,
          assignedToUserId: null,
          nextActionAt: null,
          lostReason: null,
          createdAt: nowLead,
          updatedAt: nowLead,
        };
        await leadRepo.save(lead);
      }
    }

    const reminderAddress = resolveWhatsAppChannelAddress({
      phone: lead.phone ? normalizeManualWhatsAppPhone(lead.phone) : null,
      whatsappLid: lead.whatsappLid,
    });
    if (!reminderAddress) {
      return NextResponse.json(
        { error: "Este paciente não possui um WhatsApp válido para confirmação e lembrete" },
        { status: 400 },
      );
    }

    // O lembrete D-1 usa a outbox, que é ordenada por conversa. Agendamentos
    // criados manualmente antes não criavam conversa e o cron os pulava mesmo
    // quando o telefone estava preenchido (caso Horizonte/Carla). A origem do
    // lead continua "manual"; a conversa é WhatsApp porque será o canal usado.
    // Criamos a conversa antes do booking para que uma falha de persistência não
    // retorne erro depois de uma consulta já ter sido criada no calendário.
    const conversationRepo = new DrizzleConversationRepository();
    const existingConversation = await conversationRepo.findByLeadId(lead.id);
    if (!existingConversation) {
      const nowConversation = new Date();
      await conversationRepo.saveConversation({
        id: crypto.randomUUID(),
        clinicId,
        leadId: lead.id,
        channel: "whatsapp",
        category: "sales",
        externalThreadId: reminderAddress,
        summary: "Conversa criada pelo agendamento manual para confirmação e lembrete.",
        aiPaused: false,
        takeoverExpiresAt: null,
        needsAttention: false,
        attentionReason: null,
        consecutiveUnclearCount: 0,
        lastMessageAt: null,
        createdAt: nowConversation,
        updatedAt: nowConversation,
      });
    }

    // Procedimentos combinados: resolve nome (junção), valor (soma do preço efetivo,
    // campanha ativa incluída) e id primário a partir dos treatmentIds selecionados.
    // O valor é AUTORITATIVO no backend (não confia em preço vindo do cliente) e vira
    // o snapshot valueCents do appointment — é o que o dashboard soma como receita.
    let bookingTreatmentName: string | undefined = body.treatmentName?.trim() || undefined;
    let primaryTreatmentId: string | null = null;
    let summedValueCents: number | null = null;

    const treatmentIds = (body.treatmentIds ?? []).filter((id) => typeof id === "string" && id.length > 0);
    if (treatmentIds.length > 0) {
      const [selected, activeCampaigns] = await Promise.all([
        db
          .select({
            id: treatments.id,
            name: treatments.name,
            priceCents: treatments.priceCents,
            minPriceCents: treatments.minPriceCents,
            maxPriceCents: treatments.maxPriceCents,
            priceKind: treatments.priceKind,
            priceDeductible: treatments.priceDeductible,
          })
          .from(treatments)
          .where(and(eq(treatments.clinicId, clinicId), inArray(treatments.id, treatmentIds))),
        getActivePriceCampaignsByTreatment(clinicId),
      ]);
      // Preserva a ordem em que o operador selecionou.
      const ordered = treatmentIds
        .map((id) => selected.find((t) => t.id === id))
        .filter((t): t is (typeof selected)[number] => Boolean(t));
      if (ordered.length > 0) {
        bookingTreatmentName = ordered.map((t) => t.name).join(" + ");
        primaryTreatmentId = ordered[0].id;
        // Sinal (dedutível) é abatido no total, não somado por cima — ver combineAppointmentValueCents.
        summedValueCents = combineAppointmentValueCents(
          ordered.map((t) => ({
            valueCents: effectiveBookableValueCents(t, activeCampaigns.get(t.id) ?? null),
            deductible: t.priceDeductible,
          })),
        );
      }
    }

    const timezone = new ClinicTimezone(clinicRow.timezone);
    const durationMinutes = body.durationMinutes ?? clinicRow.defaultAppointmentDurationMinutes ?? 60;

    const [year, month, day] = body.date.split("-").map(Number);
    const [hour, minute] = body.time.split(":").map(Number);
    const startsAt = timezone.fromLocalParts(year, month - 1, day, hour, minute);
    const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);

    const apptRepo = new DrizzleAppointmentRepository();
    const followUpRepo = new DrizzleFollowUpRepository();
    const gateway = resolveCalendarGateway({
      clinicId: clinicRow.id,
      calendarMode: clinicRow.calendarMode,
      googleCalendarId: clinicRow.googleCalendarId,
      timezone,
      businessHours: clinicRow.businessHours,
      postAppointmentBufferMinutes: clinicRow.postAppointmentBufferMinutes,
    });

    const bookingService = new BookingService(gateway, apptRepo, leadRepo, undefined, followUpRepo);
    const result = await bookingService.book({
      clinic: {
        id: clinicRow.id,
        name: clinicRow.name,
        specialty: clinicRow.specialty,
        city: clinicRow.city,
        address: clinicRow.address,
        addressComplement: clinicRow.addressComplement ?? null,
        mapsUrl: clinicRow.mapsUrl ?? null,
        locationMessage: clinicRow.locationMessage ?? null,
        timezone: clinicRow.timezone,
        greetingMessage: clinicRow.greetingMessage,
        menuItems: clinicRow.menuItems,
        businessHours: clinicRow.businessHours,
        googleCalendarId: clinicRow.googleCalendarId,
        calendarMode: clinicRow.calendarMode,
        receptionistPhone: clinicRow.receptionistPhone ?? null,
        takeoverTtlHours: clinicRow.takeoverTtlHours,
        postAppointmentBufferMinutes: clinicRow.postAppointmentBufferMinutes,
        defaultAppointmentDurationMinutes: clinicRow.defaultAppointmentDurationMinutes,
        rateLimitPerHour: clinicRow.rateLimitPerHour,
        unclearThreshold: clinicRow.unclearThreshold,
        staleConversationHours: clinicRow.staleConversationHours,
        slotOfferTtlMinutes: clinicRow.slotOfferTtlMinutes,
        maxSlotsToOffer: clinicRow.maxSlotsToOffer,
        slotLookaheadDays: clinicRow.slotLookaheadDays,
        mediaTakeoverTtlHours: clinicRow.mediaTakeoverTtlHours ?? null,
        rapidThrottleMs: clinicRow.rapidThrottleMs,
        messageDebounceMs: clinicRow.messageDebounceMs ?? null,
        segment: clinicRow.segment,
        serviceNoun: clinicRow.serviceNoun,
        bookingNoun: clinicRow.bookingNoun,
        contactNoun: clinicRow.contactNoun,
        agentRole: clinicRow.agentRole,
        businessDescriptor: clinicRow.businessDescriptor ?? null,
        businessNoun: resolveSegmentVocab(clinicRow.segment).businessNoun,
        createdAt: clinicRow.createdAt,
        updatedAt: clinicRow.updatedAt,
      },
      lead,
      startsAt,
      endsAt,
      treatmentName: bookingTreatmentName,
      treatmentId: primaryTreatmentId,
      valueCents: summedValueCents,
      origin: "operator_agenda",
    });

    if (!result.success) {
      const statusCode = result.reason === "slot_taken" ? 409 : 500;
      const message =
        result.reason === "slot_taken"
          ? "Horário não disponível"
          : "Erro ao criar agendamento";
      return NextResponse.json({ error: message, reason: result.reason }, { status: statusCode });
    }

    // Persiste ajustes que o book() não cobre: profissional escolhido e descrição livre.
    const professionalId = body.professionalId?.trim() || null;
    const description = body.description?.trim() || null;
    if (professionalId || description) {
      await apptRepo.save({
        ...result.appointment,
        professionalId: professionalId ?? result.appointment.professionalId,
        description: description ?? result.appointment.description,
        updatedAt: new Date(),
      });
    }

    return NextResponse.json({ appointment: result.appointment }, { status: 201 });
  } catch (err) {
    console.error("[appointments POST]", err);
    return NextResponse.json({ error: "Falha ao criar agendamento" }, { status: 500 });
  }
}
