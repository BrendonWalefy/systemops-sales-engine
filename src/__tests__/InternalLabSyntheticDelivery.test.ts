import { beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

const dbMock = vi.hoisted(() => ({ select: vi.fn(), update: vi.fn() }));
const realChannelMock = vi.hoisted(() => ({
  sendVoiceOrText: vi.fn(async () => ({
    msgId: "provider-owner-1",
    deliveryFormat: "text" as const,
    blobUrl: null,
  })),
}));

vi.mock("@/infrastructure/db/client", () => ({ db: dbMock }));
vi.mock("@/lib/tts-send", () => ({ sendVoiceOrText: realChannelMock.sendVoiceOrText }));

import {
  createInternalLabSyntheticAddress,
  isInternalLabSyntheticAddress,
  isInternalLabSyntheticAddressCandidate,
  isInternalLabSyntheticDeliveryAuthorized,
  registerInternalLabSyntheticRun,
  type InternalLabSyntheticRunAuthorization,
} from "@/application/labs/internal-lab-synthetic-delivery";
import { ReplayOutboundCapture } from "@/application/replay/replay-outbound-capture";
import { SendMessageJobHandler } from "@/application/jobs/send-message-job";
import type { OutboundMessage } from "@/application/ports/outbound-message-store";
import { DrizzleOutboundMessageStore } from "@/infrastructure/repositories/drizzle-outbound-message-store";

const clinicId = "11111111-1111-4111-8111-111111111111";
const runId = "dry-run-20260817";
const personaId = "price-scheduling";
const syntheticAddress = `systemops-lab-${runId}-${personaId}@lid`;

const outbound: OutboundMessage = {
  id: "outbound-synthetic-1",
  clinicId,
  conversationId: "conversation-1",
  channel: "whatsapp",
  payload: {
    version: 1,
    kind: "conversation_reply",
    turnId: "turn-1",
    to: syntheticAddress,
    agentMessageId: "agent-message-1",
    agentMessagePersistence: "sender",
    replyText: "Resposta capturada",
    intent: null,
    useVoice: false,
    ttsConfig: { provider: "nova", speed: 0.92 },
    interleavedParts: [],
    mediaParts: [],
    leadId: "lead-1",
    pipelineAdvance: null,
  },
  deliveryKind: "text",
  category: "reply",
  sequence: 1,
  status: "pending",
  providerMessageId: null,
  dedupeKey: "agent-message:agent-message-1",
  attempts: 0,
  lastError: null,
  authorization: {
    kind: "legacy", streamId: null, streamGeneration: null,
    sourceInboundEventId: null, claimJobId: null, claimTokenDigest: null,
    authorityVersion: 0,
  },
  createdAt: new Date("2026-08-17T15:04:00.000Z"),
  sentAt: null,
};

function makeStore(message: OutboundMessage = outbound) {
  return {
    findOutboundMessage: vi.fn().mockResolvedValue(message),
    authorizeOutboundMessageForSend: vi.fn().mockResolvedValue({ authorized: true }),
    hasEarlierActiveMessage: vi.fn().mockResolvedValue(false),
    markOutboundProcessing: vi.fn().mockResolvedValue(true),
    markOutboundPending: vi.fn().mockResolvedValue(undefined),
    markOutboundDelivered: vi.fn().mockResolvedValue(undefined),
    markOutboundCancelled: vi.fn().mockResolvedValue(undefined),
    countSentSince: vi.fn().mockResolvedValue(0),
  };
}

function conversationRepository() {
  return {
    appendMessage: vi.fn().mockResolvedValue(true),
    findMessageById: vi.fn().mockResolvedValue(null),
  };
}

function registeredRun(addresses: readonly string[] = [syntheticAddress]) {
  return registerInternalLabSyntheticRun({ clinicId, runId, addresses });
}

function replayCaptureAuthorization(
  authorization: InternalLabSyntheticRunAuthorization | undefined,
) {
  return {
    isCandidate: isInternalLabSyntheticAddressCandidate,
    isAuthorized: ({ clinicId: targetClinicId, address }: {
      clinicId: string;
      address: string;
    }) => isInternalLabSyntheticAddress(address)
      && isInternalLabSyntheticDeliveryAuthorized({
        authorization,
        clinicId: targetClinicId,
        address,
      }),
  };
}

function selectClinicChain() {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([{ shadowModeEnabled: false }]),
  };
}

function updateChain() {
  return { set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) };
}

describe("Internal Lab replay-only synthetic delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.select.mockReturnValue(selectClinicChain());
    dbMock.update.mockReturnValue(updateChain());
  });

  it("creates only the closed synthetic LID format", () => {
    expect(createInternalLabSyntheticAddress({ runId, personaId })).toBe(syntheticAddress);
    expect(isInternalLabSyntheticAddress(syntheticAddress)).toBe(true);
    for (const malformed of [
      ` systemops-lab-${runId}-${personaId}@lid`,
      `systemops-lab-${runId}-${personaId}@lid.invalid`,
      `SYSTEMOPS-LAB-${runId}-${personaId}@lid`,
      "5511999999999",
      "real-owner-id@lid",
    ]) expect(isInternalLabSyntheticAddress(malformed)).toBe(false);
  });

  it("registers an exact process-local run without build approval or configuration digests", () => {
    const authorization = registeredRun();

    expect(authorization).toEqual({ runId, clinicId });
    expect(Object.isFrozen(authorization)).toBe(true);
    expect(JSON.stringify(authorization)).not.toMatch(/approval|signature|digest|@lid/i);
    expect(() => registeredRun([
      createInternalLabSyntheticAddress({ runId: "other-run-20260817", personaId }),
    ])).toThrow(/run/i);
  });

  it.each([
    ["has no registered run", undefined, clinicId, syntheticAddress],
    ["uses a forged token", Object.freeze({ runId, clinicId }), clinicId, syntheticAddress],
    ["crosses tenant", null, "22222222-2222-4222-8222-222222222222", syntheticAddress],
    ["replays across runs", null, clinicId,
      createInternalLabSyntheticAddress({ runId: "other-run-20260817", personaId })],
    ["uses a malformed reserved LID", null, clinicId,
      `systemops-lab-${runId}-${personaId}@lid.invalid`],
  ])("defers before claim or delivery when it %s", async (
    _case,
    suppliedAuthorization,
    targetClinicId,
    address,
  ) => {
    const authorization = suppliedAuthorization === null ? registeredRun() : suppliedAuthorization;
    const store = makeStore({
      ...outbound,
      clinicId: targetClinicId,
      payload: { ...(outbound.payload as Record<string, unknown>), to: address },
    });
    const realDelivery = vi.fn();
    const capture = new ReplayOutboundCapture();
    const handler = new SendMessageJobHandler({
      outboundMessageStore: store as never,
      conversationRepository: conversationRepository(),
      delivery: realDelivery,
      replayCaptureAuthorization: replayCaptureAuthorization(
        authorization as InternalLabSyntheticRunAuthorization | undefined,
      ),
      outboundBoundary: capture.createBoundary(),
    });

    await expect(handler.processJob({ payload: { outboundMessageId: outbound.id } }))
      .resolves.toBe("deferred");
    expect(store.markOutboundPending).toHaveBeenCalledWith(
      outbound.id,
      "replay_capture_required",
    );
    expect(store.markOutboundProcessing).not.toHaveBeenCalled();
    expect(realDelivery).not.toHaveBeenCalled();
    expect(capture.effects).toHaveLength(0);
  });

  it("captures an authorized synthetic send with zero provider calls", async () => {
    const capture = new ReplayOutboundCapture();
    const store = makeStore();
    const realDelivery = vi.fn();
    const handler = new SendMessageJobHandler({
      outboundMessageStore: store as never,
      conversationRepository: conversationRepository(),
      conversationStateReader: { getCurrentState: vi.fn().mockResolvedValue(null) },
      delivery: realDelivery,
      replayCaptureAuthorization: replayCaptureAuthorization(registeredRun()),
      outboundBoundary: capture.createBoundary(),
    });

    await expect(handler.processJob({
      payload: { outboundMessageId: outbound.id, turnId: "turn-1" },
    })).resolves.toBe("sent");
    expect(capture.effects).toEqual([
      expect.objectContaining({
        kind: "text",
        to: syntheticAddress,
        content: "Resposta capturada",
        providerMessageId: "replay-capture-1",
      }),
    ]);
    expect(realDelivery).not.toHaveBeenCalled();
  });

  it("keeps every real address fail-closed while replay capture is installed", async () => {
    const ownerAddress = "5511999999999";
    const capture = new ReplayOutboundCapture();
    const store = makeStore({
      ...outbound,
      payload: { ...(outbound.payload as Record<string, unknown>), to: ownerAddress },
    });
    const realDelivery = vi.fn().mockResolvedValue("provider-owner-1");
    const handler = new SendMessageJobHandler({
      outboundMessageStore: store as never,
      conversationRepository: conversationRepository(),
      conversationStateReader: { getCurrentState: vi.fn().mockResolvedValue(null) },
      delivery: realDelivery,
      replayCaptureAuthorization: replayCaptureAuthorization(registeredRun()),
      outboundBoundary: capture.createBoundary(),
    });

    await expect(handler.processJob({ payload: { outboundMessageId: outbound.id } }))
      .resolves.toBe("deferred");
    expect(store.markOutboundPending).toHaveBeenCalledWith(
      outbound.id,
      "replay_capture_required",
    );
    expect(store.markOutboundProcessing).not.toHaveBeenCalled();
    expect(realDelivery).not.toHaveBeenCalled();
    expect(realChannelMock.sendVoiceOrText).not.toHaveBeenCalled();
    expect(capture.effects).toHaveLength(0);
  });

  it("looks up a conversation reply by the exact clinic and payload turn", async () => {
    const select = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ ...outbound, organizationId: outbound.clinicId }]),
    };
    dbMock.select.mockReturnValue(select);

    const found = await new DrizzleOutboundMessageStore().findConversationReplyByTurnId({
      clinicId,
      turnId: "turn-1",
    });

    expect(found).toMatchObject({ id: outbound.id, clinicId: outbound.clinicId });
    const predicate = select.where.mock.calls[0]?.[0];
    const query = new PgDialect().sqlToQuery(sql`select 1 where ${predicate}`);
    expect(query.sql).toContain("organization_id");
    expect(query.params).toEqual(expect.arrayContaining([clinicId, "turn-1"]));
  });
});
