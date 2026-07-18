import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, or, isNull } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { conversations, leads, mediaAssets, messages, organizations, treatments } from "@/infrastructure/db/schema";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { resolveChannelConfig } from "@/infrastructure/adapters/channels/whatsapp/channel-config";
import { sendMediaMessage, sendTextMessage } from "@/infrastructure/adapters/channels/whatsapp/whatsapp-sender";
import { resolveWhatsAppChannelAddress } from "@/core/whatsapp/WhatsAppContactIdentity";
import { ConversationStateMachine } from "@/core/conversation/ConversationStateMachine";
import {
  buildGuidedPipelinePackage,
  GUIDED_PIPELINE_ACTION_SEND_INTRO_UNTIL_PHOTO,
  summarizeGuidedPipelinePackage,
  type GuidedPipelineAction,
  type GuidedPipelinePart,
} from "@/application/conversations/guided-pipeline-actions";
import type { PipelineStep } from "@/domain/entities/treatment";

export const dynamic = "force-dynamic";

type PipelineActionRequest = {
  treatmentId?: string;
  action?: GuidedPipelineAction;
};

type ResolvedMedia = {
  id: string;
  treatmentId: string | null;
  title: string;
  url: string;
  type: "image" | "video" | "document";
};

function normalizeAction(action: unknown): GuidedPipelineAction | null {
  return action === GUIDED_PIPELINE_ACTION_SEND_INTRO_UNTIL_PHOTO
    ? GUIDED_PIPELINE_ACTION_SEND_INTRO_UNTIL_PHOTO
    : null;
}

function extractMediaIds(parts: GuidedPipelinePart[]): string[] {
  return Array.from(new Set(parts.filter((part) => part.type === "media").map((part) => part.mediaId)));
}

async function insertOutboundMessage(params: {
  conversationId: string;
  body: string;
  mediaUrl?: string | null;
  mediaType?: "image" | "video" | null;
}): Promise<string> {
  const id = randomUUID();
  await db.insert(messages).values({
    id,
    conversationId: params.conversationId,
    author: "clinic_user",
    body: params.body,
    mediaUrl: params.mediaUrl ?? null,
    mediaType: params.mediaType ?? null,
    sentAt: new Date(),
    externalId: null,
  });
  return id;
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
        GUIDED_PIPELINE_ACTION_SEND_INTRO_UNTIL_PHOTO,
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

  const [clinic] = await db.select().from(organizations).where(eq(organizations.id, conv.clinicId)).limit(1);
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

  const pkg = buildGuidedPipelinePackage(treatment.pipelineSteps as PipelineStep[] | null, action);
  if (pkg.parts.length === 0) {
    return NextResponse.json({ error: "Tratamento sem conteudo de pipeline para enviar" }, { status: 409 });
  }

  const mediaIds = extractMediaIds(pkg.parts);
  const mediaRows = mediaIds.length
    ? await db
        .select({
          id: mediaAssets.id,
          treatmentId: mediaAssets.treatmentId,
          title: mediaAssets.title,
          url: mediaAssets.url,
          type: mediaAssets.type,
        })
        .from(mediaAssets)
        .where(
          and(
            eq(mediaAssets.clinicId, conv.clinicId),
            inArray(mediaAssets.id, mediaIds),
            or(eq(mediaAssets.treatmentId, treatment.id), isNull(mediaAssets.treatmentId)),
          ),
        )
    : [];
  const mediaById = new Map(mediaRows.map((media) => [media.id, media as ResolvedMedia]));

  const channelConfig = resolveChannelConfig(clinic);
  const skippedMedia: { mediaId: string; reason: string }[] = [];
  let sentParts = 0;

  try {
    for (const part of pkg.parts) {
      if (part.type === "text") {
        const messageId = await insertOutboundMessage({ conversationId, body: part.content });
        const externalId = await sendTextMessage(channelAddress, part.content, channelConfig);
        if (externalId) await db.update(messages).set({ externalId }).where(eq(messages.id, messageId));
        sentParts += 1;
        continue;
      }

      const media = mediaById.get(part.mediaId);
      if (!media) {
        skippedMedia.push({ mediaId: part.mediaId, reason: "midia_nao_encontrada_ou_de_outro_tratamento" });
        continue;
      }
      if (media.type === "document") {
        skippedMedia.push({ mediaId: part.mediaId, reason: "documento_nao_suportado_no_envio_guiado" });
        continue;
      }

      const bodyText = part.caption?.trim() || media.title;
      const messageId = await insertOutboundMessage({
        conversationId,
        body: bodyText,
        mediaUrl: media.url,
        mediaType: media.type,
      });
      const externalId = await sendMediaMessage(channelAddress, media.url, media.type, channelConfig, part.caption);
      if (externalId) await db.update(messages).set({ externalId }).where(eq(messages.id, messageId));
      sentParts += 1;
    }
  } catch (err) {
    console.error("[PipelineActions] WhatsApp send failed:", err);
    return NextResponse.json(
      { error: "Falha ao enviar pipeline pelo WhatsApp", sentParts, skippedMedia },
      { status: 502 },
    );
  }

  const now = new Date();
  const stateMachine = new ConversationStateMachine();
  if (pkg.resumeStepIndex !== null) {
    await stateMachine.startTreatmentPipeline(
      conversationId,
      treatment.id,
      treatment.name,
      240,
      pkg.resumeStepIndex,
    );
  }

  await db
    .update(conversations)
    .set({
      aiPaused: false,
      takeoverExpiresAt: null,
      needsAttention: false,
      attentionReason: null,
      consecutiveUnclearCount: 0,
      aiResumedAt: now,
      lastMessageAt: now,
      updatedAt: now,
    })
    .where(eq(conversations.id, conversationId));

  return NextResponse.json({ ok: true, sentParts, skippedMedia });
}
