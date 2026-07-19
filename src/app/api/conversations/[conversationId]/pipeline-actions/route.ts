import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { conversations, leads, mediaAssets, messages, organizations, treatments } from "@/infrastructure/db/schema";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { resolveWhatsAppChannelAddress } from "@/core/whatsapp/WhatsAppContactIdentity";
import { ConversationStateMachine } from "@/core/conversation/ConversationStateMachine";
import { ConversationOrchestrator, nextActivePipelineStep } from "@/core/pipeline/ConversationOrchestrator";
import {
  buildGuidedPipelineContentDraft,
  buildGuidedPipelinePackage,
  GUIDED_PIPELINE_ACTION_START_RAILS,
  summarizeGuidedPipelinePackage,
  type GuidedPipelineAction,
} from "@/application/conversations/guided-pipeline-actions";
import type { PipelineStep } from "@/domain/entities/treatment";
import { DEFAULT_TTS_CONFIG } from "@/domain/entities/tts-config";
import type { OutboundDeliveryPart } from "@/application/jobs/conversation-outbound-payload";
import { enqueueOutboundMessage } from "@/application/jobs/enqueue-outbound-message";
import { DrizzleOutboundMessageStore } from "@/infrastructure/repositories/drizzle-outbound-message-store";
import { DrizzleJobQueue } from "@/infrastructure/repositories/drizzle-job-queue";

export const dynamic = "force-dynamic";
// Replay inclui classificação + composição LLM inline (a entrega em si sai pelo
// outbox/sender-worker). 60s cobre a latência da composição.
export const maxDuration = 60;

type PipelineActionRequest = {
  treatmentId?: string;
  action?: GuidedPipelineAction;
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

  // Posiciona no primeiro passo ativo respeitando o histórico: conteúdo que a
  // operação já enviou manualmente não será repetido pelo trilho.
  const firstActive = nextActivePipelineStep(pipelineSteps, 0, {
    conversationHistory: history.map((m) => ({ author: m.author, body: m.body })),
  });
  if (!firstActive) {
    return NextResponse.json({ error: "Pipeline sem passos ativos restantes para esta conversa" }, { status: 409 });
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

  if (firstActive.step.type === "content") {
    const draft = buildGuidedPipelineContentDraft(firstActive.step);
    if (!draft || draft.parts.length === 0) {
      return NextResponse.json({ error: "Passo de conteúdo sem mensagens para enviar" }, { status: 409 });
    }

    const { parts, skippedMedia } = await resolvePipelineDraftParts({
      clinicId: conv.clinicId,
      treatmentId: treatment.id,
      draft,
    });
    if (parts.length === 0) {
      return NextResponse.json(
        { error: "Nenhuma parte entregável encontrada no conteúdo do pipeline", skippedMedia },
        { status: 409 },
      );
    }

    const next = nextActivePipelineStep(pipelineSteps, firstActive.index + 1, {
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
          pipelineAdvance: next
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
      mode: "sent_first_content",
      replied: true,
      stepIndex: firstActive.index,
      skippedMedia,
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
