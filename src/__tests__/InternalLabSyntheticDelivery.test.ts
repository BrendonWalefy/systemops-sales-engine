import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
}));
const realChannelMock = vi.hoisted(() => ({
  sendVoiceOrText: vi.fn(async () => ({
    msgId: "provider-owner-1",
    deliveryFormat: "text" as const,
    blobUrl: null,
  })),
}));

vi.mock("@/infrastructure/db/client", () => ({ db: dbMock }));
vi.mock("@/lib/tts-send", () => ({
  sendVoiceOrText: realChannelMock.sendVoiceOrText,
}));

import {
  createInternalLabSyntheticAddress,
  isInternalLabSyntheticAddress,
  registerInternalLabSyntheticRun,
  type InternalLabSyntheticRunAuthorization,
} from "@/application/labs/internal-lab-synthetic-delivery";
import { ReplayOutboundCapture } from "@/application/replay/replay-outbound-capture";
import { SendMessageJobHandler } from "@/application/jobs/send-message-job";
import type { OutboundMessage } from "@/application/ports/outbound-message-store";
import { DrizzleOutboundMessageStore } from "@/infrastructure/repositories/drizzle-outbound-message-store";
import { createInternalLabDeliveryGuard } from "@/application/conversation-v2/internal-lab-delivery-guard";
import {
  createRegisteredInternalLabDeploymentSmokeApproval,
  INTERNAL_LAB_TEST_BINDINGS,
} from "@/__tests__/helpers/internal-lab-approval-fixture";

const runId = "dry-run-20260817";
const personaId = "price-scheduling";
const syntheticAddress = `systemops-lab-${runId}-${personaId}@lid`;

const outbound: OutboundMessage = {
  id: "outbound-synthetic-1",
  clinicId: INTERNAL_LAB_TEST_BINDINGS.expectedClinicId,
  conversationId: "conversation-1",
  channel: "whatsapp",
  payload: {
    version: 1,
    kind: "conversation_reply",
    turnId: "turn-1",
    to: syntheticAddress,
    agentMessageId: "agent-message-1",
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
  createdAt: new Date("2026-08-17T15:04:00.000Z"),
  sentAt: null,
};

function makeStore(message: OutboundMessage = outbound) {
  return {
    findOutboundMessage: vi.fn().mockResolvedValue(message),
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
    findMessageById: vi.fn().mockResolvedValue({
      id: "agent-message-1",
      conversationId: "conversation-1",
      author: "agent",
      body: "Resposta capturada",
      mediaUrl: null,
      mediaType: null,
      sentAt: new Date("2026-08-17T15:03:00.000Z"),
      externalId: null,
      intent: null,
      deliveryFormat: null,
    }),
  };
}

function v2Outbound(message: OutboundMessage = outbound): OutboundMessage {
  return {
    ...message,
    payload: {
      ...(message.payload as Record<string, unknown>),
      agentMessagePersistence: "sender",
      internalLabBinding: {
        schemaVersion: "conversation-v2.internal-lab-delivery-binding.v1",
        tenantDigest: INTERNAL_LAB_TEST_BINDINGS.tenantDigest,
        channelDigest: INTERNAL_LAB_TEST_BINDINGS.channelDigest,
        configDigest: INTERNAL_LAB_TEST_BINDINGS.configDigest,
      },
    },
  };
}

function currentInternalLabDeliveryGuard(bindings = {
  tenantDigest: INTERNAL_LAB_TEST_BINDINGS.tenantDigest,
  channelDigest: INTERNAL_LAB_TEST_BINDINGS.channelDigest,
  configDigest: INTERNAL_LAB_TEST_BINDINGS.configDigest,
}) {
  const registered = createRegisteredInternalLabDeploymentSmokeApproval();
  return createInternalLabDeliveryGuard({
    authorization: {
      approval: registered.approval,
      runtimeIdentity: registered.runtimeIdentity,
      expectedClinicId: INTERNAL_LAB_TEST_BINDINGS.expectedClinicId,
      expectedTenantDigest: INTERNAL_LAB_TEST_BINDINGS.tenantDigest,
      expectedChannelDigest: INTERNAL_LAB_TEST_BINDINGS.channelDigest,
      expectedConfigDigest: INTERNAL_LAB_TEST_BINDINGS.configDigest,
      now: () => new Date("2026-08-17T15:05:00.000Z"),
    },
    runtimeBindingsReader: {
      resolve: vi.fn().mockResolvedValue(bindings),
      resolveDeliverySnapshot: vi.fn().mockResolvedValue({
        bindings,
        channelConfig: Object.freeze({ provider: "z_api", zapi: null, meta: null }),
      }),
    },
  });
}

function registeredRun(addresses: readonly string[] = [syntheticAddress]) {
  return registerInternalLabSyntheticRun({
    approval: createRegisteredInternalLabDeploymentSmokeApproval().approval,
    clinicId: INTERNAL_LAB_TEST_BINDINGS.expectedClinicId,
    runId,
    addresses,
  });
}

function selectClinicChain() {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([{ shadowModeEnabled: false }]),
  };
}

function updateChain() {
  return {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
  };
}

describe("Internal Lab synthetic delivery", () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T15:05:00.000Z"));
  });

  afterAll(() => vi.useRealTimers());

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
    ]) {
      expect(isInternalLabSyntheticAddress(malformed)).toBe(false);
    }
    expect(() => createInternalLabSyntheticAddress({ runId: "../escape", personaId }))
      .toThrow(/runId/i);
    expect(() => createInternalLabSyntheticAddress({ runId, personaId: "price scheduling" }))
      .toThrow(/personaId/i);
  });

  it("binds a nominal run authorization to the registered approval and exact addresses", () => {
    const authorization = registeredRun();

    expect(authorization).toEqual({
      runId,
      clinicId: INTERNAL_LAB_TEST_BINDINGS.expectedClinicId,
      tenantDigest: INTERNAL_LAB_TEST_BINDINGS.tenantDigest,
      channelDigest: INTERNAL_LAB_TEST_BINDINGS.channelDigest,
    });
    expect(Object.isFrozen(authorization)).toBe(true);
    expect(JSON.stringify(authorization)).not.toMatch(/signature|configDigest|@lid/);
    expect(() => registeredRun([
      createInternalLabSyntheticAddress({ runId: "other-run-20260817", personaId }),
    ])).toThrow(/run/i);
    expect(() => registerInternalLabSyntheticRun({
      approval: {
        claims: createRegisteredInternalLabDeploymentSmokeApproval().approval.claims,
        signature: createRegisteredInternalLabDeploymentSmokeApproval().approval.signature,
      },
      clinicId: INTERNAL_LAB_TEST_BINDINGS.expectedClinicId,
      runId,
      addresses: [syntheticAddress],
    })).toThrow(/registered approval/i);
    expect(() => registerInternalLabSyntheticRun({
      approval: createRegisteredInternalLabDeploymentSmokeApproval().approval,
      clinicId: "external-clinic",
      runId,
      addresses: [syntheticAddress],
    })).toThrow(/clinic/i);
  });

  it.each([
    ["has no registered run", undefined, syntheticAddress],
    ["uses a forged token", Object.freeze({
      runId,
      clinicId: INTERNAL_LAB_TEST_BINDINGS.expectedClinicId,
      tenantDigest: INTERNAL_LAB_TEST_BINDINGS.tenantDigest,
      channelDigest: INTERNAL_LAB_TEST_BINDINGS.channelDigest,
    }) as InternalLabSyntheticRunAuthorization, syntheticAddress],
    ["replays a token across runs", null,
      createInternalLabSyntheticAddress({ runId: "other-run-20260817", personaId })],
    ["uses a malformed reserved LID", null,
      `systemops-lab-${runId}-${personaId}@lid.invalid`],
  ])("defers before every irreversible or processing effect when it %s", async (
    _case,
    suppliedAuthorization,
    address,
  ) => {
    const store = makeStore({
      ...outbound,
      payload: { ...(outbound.payload as Record<string, unknown>), to: address },
    });
    const realDelivery = vi.fn();
    const sendVoiceOrText = vi.fn();
    const sendMediaMessage = vi.fn();
    const createDeliveryService = vi.fn();
    const internalLabDeliveryGuard = { authorize: vi.fn() };
    const authorization = suppliedAuthorization === null ? registeredRun() : suppliedAuthorization;
    const handler = new SendMessageJobHandler({
      outboundMessageStore: store as never,
      conversationRepository: conversationRepository(),
      delivery: realDelivery,
      internalLabDeliveryGuard: internalLabDeliveryGuard as never,
      internalLabSyntheticRunAuthorization: authorization,
      outboundBoundary: {
        sandboxCaptureEnabled: true,
        sendVoiceOrText: sendVoiceOrText as never,
        sendMediaMessage: sendMediaMessage as never,
        createDeliveryService: createDeliveryService as never,
      },
    });

    await expect(handler.processJob({ payload: { outboundMessageId: outbound.id } }))
      .resolves.toBe("deferred");

    expect(store.markOutboundPending).toHaveBeenCalledWith(
      outbound.id,
      "internal_lab_capture_required",
    );
    expect(store.markOutboundProcessing).not.toHaveBeenCalled();
    expect(store.hasEarlierActiveMessage).not.toHaveBeenCalled();
    expect(realDelivery).not.toHaveBeenCalled();
    expect(internalLabDeliveryGuard.authorize).not.toHaveBeenCalled();
    expect(sendVoiceOrText).not.toHaveBeenCalled();
    expect(sendMediaMessage).not.toHaveBeenCalled();
    expect(createDeliveryService).not.toHaveBeenCalled();
    expect(dbMock.select).not.toHaveBeenCalled();
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it("captures an authorized synthetic send through SendMessageJobHandler with zero real provider calls", async () => {
    const capture = new ReplayOutboundCapture();
    const store = makeStore(v2Outbound());
    const realDelivery = vi.fn();
    const handler = new SendMessageJobHandler({
      outboundMessageStore: store as never,
      conversationRepository: conversationRepository(),
      conversationStateReader: { getCurrentState: vi.fn().mockResolvedValue(null) },
      delivery: realDelivery,
      internalLabDeliveryGuard: currentInternalLabDeliveryGuard(),
      internalLabSyntheticRunAuthorization: registeredRun(),
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
    expect(store.markOutboundDelivered).toHaveBeenCalledWith({
      id: outbound.id,
      providerMessageId: "replay-capture-1",
    });
  });

  it("defers config drift before claiming the synthetic outbound", async () => {
    const store = makeStore(v2Outbound());
    const capture = new ReplayOutboundCapture();
    const authorize = vi.fn().mockResolvedValue(null);
    const handler = new SendMessageJobHandler({
      outboundMessageStore: store as never,
      conversationRepository: conversationRepository(),
      internalLabDeliveryGuard: { authorize },
      internalLabSyntheticRunAuthorization: registeredRun(),
      outboundBoundary: capture.createBoundary(),
    });

    await expect(handler.processJob({ payload: { outboundMessageId: outbound.id } }))
      .resolves.toBe("deferred");

    expect(authorize).toHaveBeenCalledOnce();
    expect(store.markOutboundPending).toHaveBeenCalledWith(
      outbound.id,
      "internal_lab_capture_required",
    );
    expect(store.markOutboundProcessing).not.toHaveBeenCalled();
    expect(capture.effects).toHaveLength(0);
  });

  it.each([
    ["an expired approval", INTERNAL_LAB_TEST_BINDINGS.expectedClinicId,
      new Date("2026-08-17T15:11:00.000Z")],
    ["a cross-tenant replay", "external-clinic",
      new Date("2026-08-17T15:05:00.000Z")],
  ])("defers %s before current binding resolution or outbox claim", async (
    _case,
    clinicId,
    deliveryNow,
  ) => {
    const store = makeStore(v2Outbound({ ...outbound, clinicId }));
    const capture = new ReplayOutboundCapture();
    const authorize = vi.fn();
    const handler = new SendMessageJobHandler({
      outboundMessageStore: store as never,
      conversationRepository: conversationRepository(),
      now: () => deliveryNow,
      internalLabDeliveryGuard: { authorize },
      internalLabSyntheticRunAuthorization: registeredRun(),
      outboundBoundary: capture.createBoundary(),
    });

    await expect(handler.processJob({ payload: { outboundMessageId: outbound.id } }))
      .resolves.toBe("deferred");

    expect(authorize).not.toHaveBeenCalled();
    expect(store.markOutboundProcessing).not.toHaveBeenCalled();
    expect(capture.effects).toHaveLength(0);
  });

  it("keeps the owner real address on the existing real delivery path", async () => {
    const ownerAddress = "5511999999999";
    const capture = new ReplayOutboundCapture();
    const store = makeStore({
      ...outbound,
      payload: { ...(outbound.payload as Record<string, unknown>), to: ownerAddress },
    });
    const handler = new SendMessageJobHandler({
      outboundMessageStore: store as never,
      conversationRepository: conversationRepository(),
      conversationStateReader: { getCurrentState: vi.fn().mockResolvedValue(null) },
      internalLabSyntheticRunAuthorization: registeredRun(),
      outboundBoundary: capture.createBoundary(),
    });

    await expect(handler.processJob({ payload: { outboundMessageId: outbound.id } }))
      .resolves.toBe("sent");

    expect(realChannelMock.sendVoiceOrText).toHaveBeenCalledOnce();
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
      clinicId: INTERNAL_LAB_TEST_BINDINGS.expectedClinicId,
      turnId: "turn-1",
    });

    expect(found).toMatchObject({ id: outbound.id, clinicId: outbound.clinicId });
    const predicate = select.where.mock.calls[0]?.[0];
    const query = new PgDialect().sqlToQuery(sql`select 1 where ${predicate}`);
    expect(query.sql).toContain("organization_id");
    expect(query.sql).toContain("turnId");
    expect(query.params).toEqual(expect.arrayContaining([
      INTERNAL_LAB_TEST_BINDINGS.expectedClinicId,
      "turn-1",
    ]));
  });
});
