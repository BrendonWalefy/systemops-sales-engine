import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { conversations, leads, mediaAssets, messages, organizations, treatments } from "@/infrastructure/db/schema";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { resolveWhatsAppChannelAddress } from "@/core/whatsapp/WhatsAppContactIdentity";
import { ConversationStateMachine } from "@/core/conversation/ConversationStateMachine";
import { SlotReservationService } from "@/core/scheduling/SlotReservationService";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import { buildDepositRequestMessage } from "@/core/conversation/DepositTemplates";
import { ConversationOrchestrator, nextActivePipelineStep } from "@/core/pipeline/ConversationOrchestrator";
import {
  buildGuidedPipelineContentDraft,
  buildGuidedPipelinePackage,
  buildGuidedPipelineStepDraft,
  GUIDED_PIPELINE_ACTION_START_RAILS,
  listGuidedPipelineSections,
  summarizeGuidedPipelinePackage,
  type GuidedPipelineAction,
} from "@/application/conversations/guided-pipeline-actions";
import type { PipelineStep } from "@/domain/entities/treatment";
import { DEFAULT_TTS_CONFIG } from "@/domain/entities/tts-config";
import type { OutboundDeliveryPart } from "@/application/jobs/conversation-outbound-payload";
import { enqueueOutboundMessage } from "@/application/jobs/enqueue-outbound-message";
import { DrizzleOutboundMessageStore } from "@/infrastructure/repositories/drizzle-outbound-message-store";
import { DrizzleJobQueue } from "@/infrastructure/repositories/drizzle-job-queue";
import { bumpInboxVersion } from "@/application/read-versions/clinic-read-version";

export const dynamic = "force-dynamic";
// Replay inclui classificação + composição LLM inline (a entrega em si sai pelo
// outbox/sender-worker). 60s cobre a latência da composição.
export const maxDuration = 60;

type PipelineActionRequest = {
  treatmentId?: string;
  action?: GuidedPipelineAction;
  stepIndex?: number;
  // Etapa de fechamento ("book"): horário escolhido pelo operador, no fuso da
  // clínica (date "YYYY-MM-DD", time "HH:MM") — mesma convenção do agendamento manual.
  date?: string;
  time?: string;
  durationMinutes?: number;
};

type ResolvedPipelineMedia = {
  id: string;
  title: string;
  url: string;
  type: "image" | "video";
};

function normalizeAction(action: unknown): GuidedPipelineAction | null {
  return action === GUIDED_PIPELINE_ACTION_START_RAILS ? GUIDED_PIPELINE_ACTION_START_RAILS : null;
}

async function resolvePipelineDraftParts(params: {
  clinicId: string;
  treatmentId: string;
  draft: NonNullable<ReturnType<typeof buildGuidedPipelineContentDraft>>;
}): Promise<{ parts: OutboundDeliveryPart[]; skippedMedia: { mediaId: string; reason: string }[] }> {
  const skippedMedia: { mediaId: string; reason: string }[] = [];
  const mediaRows = params.draft.mediaIds.length
    ? await db
        .select({
          id: mediaAssets.id,
          title: mediaAssets.title,
          url: mediaAssets.url,
          type: mediaAssets.type,
        })
        .from(mediaAssets)
        .where(
          and(
            eq(mediaAssets.clinicId, params.clinicId),
            inArray(mediaAssets.id, params.draft.mediaIds),
            or(eq(mediaAssets.treatmentId, params.treatmentId), isNull(mediaAssets.treatmentId)),
          ),
        )
    : [];

  const mediaById = new Map<string, ResolvedPipelineMedia>();
  for (const media of mediaRows) {
    if (media.type !== "image" && media.type !== "video") {
      skippedMedia.push({ mediaId: media.id, reason: "tipo_de_midia_nao_entregavel" });
      continue;
    }
    mediaById.set(media.id, media as ResolvedPipelineMedia);
  }

  const parts: OutboundDeliveryPart[] = [];
  for (const part of params.draft.parts) {
    if (part.type === "text") {
      parts.push({ type: "text", content: part.content });
      continue;
    }

    const media = mediaById.get(part.mediaId);
    if (!media) {
      skippedMedia.push({ mediaId: part.mediaId, reason: "midia_nao_encontrada_ou_de_outro_tratamento" });
      continue;
    }
    parts.push({
      type: "media",
      mediaId: media.id,
      url: media.url,
      mediaType: media.type,
      title: media.title,
      caption: part.caption,
    });
  }

  return { parts, skippedMedia };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
): Promise<NextResponse> {
  const sessionClinicId = await getSessionClinicId();
  if (!sessionClinicId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { conversationId } = await params;
  const [conv] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.clinicId, sessionClinicId)))
    .limit(1);
  if (!conv) return NextResponse.json({ error: "Conversa nao encontrada" }, { status: 404 });

  const treatmentRows = await db
    .select({
      id: treatments.id,
      name: treatments.name,
      pipelineSteps: treatments.pipelineSteps,
    })
    .from(treatments)
    .where(eq(treatments.clinicId, sessionClinicId));

  // Capacidade lida da config da própria clínica — decide se a etapa de
  // fechamento do pipeline é acionável pelo operador.
  const [capabilityRow] = await db
    .select({ depositEnabled: organizations.depositEnabled })
    .from(organizations)
    .where(eq(organizations.id, sessionClinicId))
    .limit(1);

  const options = treatmentRows
    .map((treatment) => {
      const pkg = buildGuidedPipelinePackage(
        treatment.pipelineSteps as PipelineStep[] | null,
        GUIDED_PIPELINE_ACTION_START_RAILS,
      );
      if (pkg.parts.length === 0) return null;
      return {
        treatmentId: treatment.id,
        treatmentName: treatment.name,
        summary: summarizeGuidedPipelinePackage(pkg),
        sections: listGuidedPipelineSections(treatment.pipelineSteps as PipelineStep[] | null, {
          depositEnabled: capabilityRow?.depositEnabled ?? false,
        }),
      };
    })
    .filter((option): option is NonNullable<typeof option> => option !== null);

  return NextResponse.json({ options });
}

// Coloca a conversa no trilho do pipeline do tratamento escolhido e reprocessa a
// última mensagem de texto do lead pelo Orchestrator, como se tivesse acabado de
// chegar. A IA responde answer-first (dúvida atual + próximo conteúdo) e os passos
// seguintes avançam conforme as respostas do lead — idêntico ao fluxo orgânico.
// Nada é despejado de uma vez: pacing, dedupe de conteúdo e ordem são os do motor.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
): Promise<NextResponse> {
  const sessionClinicId = await getSessionClinicId();
  if (!sessionClinicId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { conversationId } = await params;
  let body: PipelineActionRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Payload invalido" }, { status: 400 });
  }

  const action = normalizeAction(body.action);
  if (!action) return NextResponse.json({ error: "Acao de pipeline invalida" }, { status: 400 });
  if (!body.treatmentId) return NextResponse.json({ error: "Tratamento obrigatorio" }, { status: 400 });

  const [conv] = await db
    .select({
      id: conversations.id,
      leadId: conversations.leadId,
      clinicId: conversations.clinicId,
      externalThreadId: conversations.externalThreadId,
    })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.clinicId, sessionClinicId)))
    .limit(1);
  if (!conv) return NextResponse.json({ error: "Conversa nao encontrada" }, { status: 404 });

  const [clinic] = await db
    .select({ staleConversationHours: organizations.staleConversationHours })
    .from(organizations)
    .where(eq(organizations.id, conv.clinicId))
    .limit(1);
  if (!clinic) return NextResponse.json({ error: "Clinica nao encontrada" }, { status: 404 });

  const [lead] = await db
    .select({ phone: leads.phone, whatsappLid: leads.whatsappLid })
    .from(leads)
    .where(eq(leads.id, conv.leadId))
    .limit(1);

  const channelAddress =
    resolveWhatsAppChannelAddress({ phone: lead?.phone ?? null, whatsappLid: lead?.whatsappLid ?? null }) ??
    conv.externalThreadId;
  if (!channelAddress) {
    return NextResponse.json({ error: "Identidade WhatsApp do lead nao encontrada" }, { status: 422 });
  }

  const [treatment] = await db
    .select({
      id: treatments.id,
      name: treatments.name,
      pipelineSteps: treatments.pipelineSteps,
    })
    .from(treatments)
    .where(and(eq(treatments.id, body.treatmentId), eq(treatments.clinicId, conv.clinicId)))
    .limit(1);
  if (!treatment) return NextResponse.json({ error: "Tratamento nao encontrado" }, { status: 404 });

  const pipelineSteps = (treatment.pipelineSteps as PipelineStep[] | null) ?? [];
  if (pipelineSteps.length === 0) {
    return NextResponse.json({ error: "Tratamento sem pipeline configurado" }, { status: 409 });
  }

  const selectedStepIndex = body.stepIndex;
  if (
    selectedStepIndex !== undefined &&
    (!Number.isInteger(selectedStepIndex) || selectedStepIndex < 0 || selectedStepIndex >= pipelineSteps.length)
  ) {
    return NextResponse.json({ error: "Etapa de pipeline invalida" }, { status: 400 });
  }

  // ── Etapa de fechamento ("book") ──
  // Config-driven: só é acionável quando a clínica cobra sinal. Reserva o horário
  // PROVISORIAMENTE (nunca agendamento efetivo) e engata a máquina de estado do
  // depósito — a partir daí o comprovante do lead dispara os botões de validação
  // do responsável, o banner no inbox, a confirmação e a liberação automática no
  // fim do TTL, exatamente como no fluxo conduzido pela IA.
  if (selectedStepIndex !== undefined && pipelineSteps[selectedStepIndex]?.type === "book") {
    const [depositClinic] = await db
      .select({
        depositEnabled: organizations.depositEnabled,
        depositAmountCents: organizations.depositAmountCents,
        depositPixKey: organizations.depositPixKey,
        depositPixKeyType: organizations.depositPixKeyType,
        depositRecipientName: organizations.depositRecipientName,
        depositTtlHours: organizations.depositTtlHours,
        depositNotes: organizations.depositNotes,
        timezone: organizations.timezone,
        defaultAppointmentDurationMinutes: organizations.defaultAppointmentDurationMinutes,
      })
      .from(organizations)
      .where(eq(organizations.id, conv.clinicId))
      .limit(1);

    if (!depositClinic?.depositEnabled || !depositClinic.depositAmountCents) {
      return NextResponse.json(
        { error: "Esta clínica não tem sinal configurado — use Registrar agendamento" },
        { status: 409 },
      );
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date ?? "") || !/^\d{2}:\d{2}$/.test(body.time ?? "")) {
      return NextResponse.json({ error: "Informe a data e o horário da reserva" }, { status: 400 });
    }
    const timezone = new ClinicTimezone(depositClinic.timezone);
    const [year, month, day] = body.date!.split("-").map(Number);
    const [hour, minute] = body.time!.split(":").map(Number);
    const startsAt = timezone.fromLocalParts(year, month - 1, day, hour, minute);
    const durationMinutes = body.durationMinutes && body.durationMinutes > 0
      ? body.durationMinutes
      : depositClinic.defaultAppointmentDurationMinutes;
    const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
    if (Number.isNaN(startsAt.getTime())) {
      return NextResponse.json({ error: "Horário inválido para a reserva" }, { status: 400 });
    }

    const ttlHours = depositClinic.depositTtlHours ?? 24;
    const reservationService = new SlotReservationService();
    const reservation = await reservationService.reserve(
      conv.clinicId,
      conv.leadId,
      startsAt,
      endsAt,
      ttlHours * 60,
    );
    if (!reservation) {
      return NextResponse.json({ error: "Esse horário já está reservado ou ocupado" }, { status: 409 });
    }

    const slotLabel = timezone.formatForHuman(startsAt);

    try {
      const stateMachine = new ConversationStateMachine();
      await stateMachine.startDepositWait(
        conversationId,
        {
          slotStartsAt: startsAt.toISOString(),
          slotEndsAt: endsAt.toISOString(),
          slotLabel,
          reservationId: reservation.id,
          treatmentId: treatment.id,
          treatmentName: treatment.name,
          valueCents: null,
          depositAmountCents: depositClinic.depositAmountCents,
          holdExpiresAt: new Date(Date.now() + ttlHours * 3600_000).toISOString(),
        },
        ttlHours * 60,
      );

      const depositText = buildDepositRequestMessage(
        {
          depositAmountCents: depositClinic.depositAmountCents,
          depositPixKey: depositClinic.depositPixKey,
          depositPixKeyType: depositClinic.depositPixKeyType,
          depositRecipientName: depositClinic.depositRecipientName,
          depositTtlHours: ttlHours,
          depositNotes: depositClinic.depositNotes,
        },
        slotLabel,
      );

      const now = new Date();
      const agentMessageId = randomUUID();
      await db.insert(messages).values({
        id: agentMessageId,
        conversationId,
        author: "agent",
        body: depositText,
        sentAt: now,
        externalId: null,
        intent: "confirm_slot",
        deliveryFormat: "text",
      });

      // O lead vai responder com o comprovante: a IA precisa estar ativa para o
      // intercept de mídia reconhecer o estado de sinal e acionar a validação.
      await db
        .update(conversations)
        .set({
          aiPaused: false,
          takeoverExpiresAt: null,
          needsAttention: false,
          attentionReason: null,
          aiResumedAt: now,
          updatedAt: now,
        })
        .where(eq(conversations.id, conversationId));
      bumpInboxVersion(conv.clinicId);

      await enqueueOutboundMessage(
        {
          clinicId: conv.clinicId,
          conversationId,
          channel: "whatsapp",
          deliveryKind: "text",
          category: "reply",
          payload: {
            version: 1,
            kind: "conversation_reply",
            to: channelAddress,
            agentMessageId,
            replyText: depositText,
            intent: "confirm_slot",
            useVoice: false,
            ttsConfig: DEFAULT_TTS_CONFIG,
            interleavedParts: [],
            mediaParts: [],
            leadId: conv.leadId,
            pipelineAdvance: null,
          },
        },
        {
          outboundMessageStore: new DrizzleOutboundMessageStore(),
          jobQueue: new DrizzleJobQueue(),
        },
      );

      return NextResponse.json({ ok: true, mode: "deposit_requested", slotLabel });
    } catch (err) {
      // Falhou depois de segurar o slot: libera para não travar a agenda.
      await reservationService.release(reservation.id).catch(() => {});
      console.error("[PipelineActions] Falha ao pedir sinal:", err);
      return NextResponse.json({ error: "Falha ao registrar a reserva e pedir o sinal" }, { status: 500 });
    }
  }

  const history = await db
    .select({
      id: messages.id,
      author: messages.author,
      body: messages.body,
      mediaType: messages.mediaType,
      sentAt: messages.sentAt,
      externalId: messages.externalId,
    })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.sentAt));

  // Sem seleção explícita, preserva a ação original: primeiro passo ainda não
  // enviado. Com stepIndex, o operador escolhe exatamente onde entrar — mesmo
  // que aquela etapa já tenha aparecido antes na conversa.
  const firstActive = selectedStepIndex === undefined
    ? nextActivePipelineStep(pipelineSteps, 0, {
        conversationHistory: history.map((m) => ({ author: m.author, body: m.body })),
      })
    : { step: pipelineSteps[selectedStepIndex], index: selectedStepIndex };
  if (!firstActive) {
    return NextResponse.json({ error: "Pipeline sem passos ativos restantes para esta conversa" }, { status: 409 });
  }
  if (
    selectedStepIndex !== undefined &&
    firstActive.step.type !== "content" &&
    firstActive.step.type !== "photo" &&
    firstActive.step.type !== "qa"
  ) {
    return NextResponse.json(
      { error: "Esta etapa e automatica e nao pode ser acionada diretamente" },
      { status: 409 },
    );
  }

  // Resolve toda a entrega antes de mexer no estado. Assim um asset ausente
  // falha sem despausar a IA nem posicionar a conversa numa etapa que o lead
  // nunca recebeu.
  let preparedDelivery: {
    draft: NonNullable<ReturnType<typeof buildGuidedPipelineStepDraft>>;
    parts: OutboundDeliveryPart[];
    skippedMedia: { mediaId: string; reason: string }[];
  } | null = null;
  if (firstActive.step.type === "content" || (selectedStepIndex !== undefined && firstActive.step.type === "photo")) {
    const draft = selectedStepIndex === undefined
      ? buildGuidedPipelineContentDraft(firstActive.step)
      : buildGuidedPipelineStepDraft(firstActive.step);
    if (!draft || draft.parts.length === 0) {
      return NextResponse.json({ error: "Passo de conteúdo sem mensagens para enviar" }, { status: 409 });
    }

    const resolved = await resolvePipelineDraftParts({
      clinicId: conv.clinicId,
      treatmentId: treatment.id,
      draft,
    });
    if (resolved.parts.length === 0) {
      return NextResponse.json(
        { error: "Nenhuma parte entregável encontrada no conteúdo do pipeline", skippedMedia: resolved.skippedMedia },
        { status: 409 },
      );
    }
    preparedDelivery = { draft, ...resolved };
  }

  const stateMachine = new ConversationStateMachine();
  await stateMachine.startTreatmentPipeline(
    conversationId,
    treatment.id,
    treatment.name,
    (clinic.staleConversationHours ?? 4) * 60,
    firstActive.index,
  );

  const now = new Date();
  await db
    .update(conversations)
    .set({
      aiPaused: false,
      takeoverExpiresAt: null,
      needsAttention: false,
      attentionReason: null,
      consecutiveUnclearCount: 0,
      aiResumedAt: now,
      updatedAt: now,
    })
    .where(eq(conversations.id, conversationId));
  bumpInboxVersion(conv.clinicId);

  if (firstActive.step.type === "content" || (selectedStepIndex !== undefined && firstActive.step.type === "photo")) {
    if (!preparedDelivery) {
      return NextResponse.json({ error: "Conteúdo do pipeline não preparado" }, { status: 500 });
    }
    const { draft, parts, skippedMedia } = preparedDelivery;

    // O pedido de foto precisa permanecer no próprio step "photo" para que o
    // intercept de mídia reconheça o próximo inbound. Conteúdo comum avança
    // normalmente para o próximo passo ativo.
    const next = firstActive.step.type === "photo"
      ? null
      : nextActivePipelineStep(pipelineSteps, firstActive.index + 1, {
          conversationHistory: history.map((m) => ({ author: m.author, body: m.body })),
        });
    const agentMessageId = randomUUID();
    await db.insert(messages).values({
      id: agentMessageId,
      conversationId,
      author: "agent",
      body: draft.text || parts.find((part) => part.type === "media")?.title || "Conteúdo do pipeline",
      mediaUrl: null,
      mediaType: null,
      sentAt: now,
      externalId: null,
      intent: "general_question",
      deliveryFormat: null,
    });
    bumpInboxVersion(conv.clinicId);

    await enqueueOutboundMessage(
      {
        clinicId: conv.clinicId,
        conversationId,
        channel: "whatsapp",
        deliveryKind: "text",
        category: "reply",
        payload: {
          version: 1,
          kind: "conversation_reply",
          to: channelAddress,
          agentMessageId,
          replyText: draft.text,
          intent: "general_question",
          useVoice: false,
          ttsConfig: DEFAULT_TTS_CONFIG,
          interleavedParts: parts,
          mediaParts: [],
          leadId: conv.leadId,
          pipelineAdvance: firstActive.step.type === "photo"
            ? null
            : next
              ? { action: "advance", nextStepIndex: next.index }
              : { action: "exit" },
        },
      },
      {
        outboundMessageStore: new DrizzleOutboundMessageStore(),
        jobQueue: new DrizzleJobQueue(),
      },
    );

    return NextResponse.json({
      ok: true,
      mode: selectedStepIndex === undefined ? "sent_first_content" : "sent_selected_step",
      replied: true,
      stepIndex: firstActive.index,
      skippedMedia,
    });
  }

  if (selectedStepIndex !== undefined && firstActive.step.type === "qa") {
    return NextResponse.json({
      ok: true,
      mode: "armed_selected_step",
      replied: false,
      stepIndex: firstActive.index,
    });
  }

  // Gatilho do trilho: a última mensagem de TEXTO do lead é reprocessada pelo
  // motor. Mídia não serve de gatilho ("[imagem recebida]" não carrega intenção)
  // — sem texto do lead, o trilho fica armado e dispara na próxima mensagem.
  const lastLeadText = [...history]
    .reverse()
    .find((m) => m.author === "lead" && !m.mediaType && m.body.trim().length > 0);

  if (!lastLeadText) {
    return NextResponse.json({ ok: true, mode: "armed_only", replied: false, stepIndex: firstActive.index });
  }

  try {
    const orchestrator = new ConversationOrchestrator();
    const result = await orchestrator.handle({
      clinicId: conv.clinicId,
      phone: lead?.phone ?? channelAddress,
      whatsappLid: lead?.whatsappLid ?? null,
      messageText: lastLeadText.body,
      messageId: lastLeadText.externalId ?? lastLeadText.id,
      timestamp: lastLeadText.sentAt,
      replyEnabled: true,
      replayOfMessageDbId: lastLeadText.id,
    });
    return NextResponse.json({
      ok: true,
      mode: "rails_replay",
      replied: result.replied,
      stepIndex: firstActive.index,
    });
  } catch (err) {
    console.error("[PipelineActions] Replay falhou — trilho segue armado:", err);
    return NextResponse.json({ ok: true, mode: "armed_only", replied: false, stepIndex: firstActive.index });
  }
}
