import { describe, expect, it, vi } from "vitest";
import {
  resolveV2LiveTurnConfiguration,
  V2TurnTenantScopeError,
} from "@/application/conversation-v2/resolve-v2-live-turn-configuration";

const now = new Date("2026-08-17T15:00:00.000Z");

function context(overrides: Record<string, unknown> = {}) {
  return {
    clinicId: "clinic-lab",
    conversationId: "conversation-1",
    clinic: { id: "clinic-lab" },
    lead: { id: "lead-1", clinicId: "clinic-lab", contactConsentRevokedAt: null },
    conversation: {
      id: "conversation-1",
      clinicId: "clinic-lab",
      aiPaused: false,
      takeoverExpiresAt: null,
    },
    editorial: { toneOfVoice: "acolhedor e humano" },
    ...overrides,
  } as never;
}

function turnInput(overrides: Record<string, unknown> = {}) {
  return {
    clinicId: "clinic-lab",
    phone: "5511999999999",
    messageText: "Olá",
    messageId: "message-1",
    timestamp: now,
    automationMode: "live",
    replyEnabled: true,
    ...overrides,
  } as never;
}

describe("V2 live turn configuration", () => {
  it("derives reply, persistent consent, editorial style and voice from real turn sources", async () => {
    const resolveVoice = vi.fn().mockResolvedValue({
      voiceEnabled: true,
      ttsConfig: { provider: "elevenlabs", speed: 1, elevenLabsVoiceId: "voice-1" },
    });
    const configuration = await resolveV2LiveTurnConfiguration({
      context: context({
        lead: { id: "lead-1", clinicId: "clinic-lab", contactConsentRevokedAt: now },
      }),
      turnInput: turnInput({ replyEnabled: false }),
      now,
    }, {
      resolveVoice,
      resumeExpiredTakeover: vi.fn(),
    });

    expect(resolveVoice).toHaveBeenCalledWith("clinic-lab");
    expect(configuration).toMatchObject({
      gateInput: {
        automationEnabled: false,
        humanControlled: false,
        optedOut: false,
      },
      style: { tone: "warm" },
      useVoice: true,
      ttsConfig: { provider: "elevenlabs", elevenLabsVoiceId: "voice-1" },
    });
    // Established V1 semantics: durable consent gates proactive automation,
    // not a later user-initiated inbound conversation.
  });

  it("resumes an expired takeover but preserves an active/manual takeover", async () => {
    const resumeExpiredTakeover = vi.fn().mockResolvedValue(undefined);
    const resolveVoice = vi.fn().mockResolvedValue({
      voiceEnabled: false,
      ttsConfig: { provider: "nova", speed: 0.92 },
    });
    const expired = await resolveV2LiveTurnConfiguration({
      context: context({
        conversation: {
          id: "conversation-1",
          clinicId: "clinic-lab",
          aiPaused: true,
          takeoverExpiresAt: new Date("2026-08-17T14:59:59.999Z"),
        },
      }),
      turnInput: turnInput(),
      now,
    }, { resolveVoice, resumeExpiredTakeover });
    const manual = await resolveV2LiveTurnConfiguration({
      context: context({
        conversation: {
          id: "conversation-2",
          clinicId: "clinic-lab",
          aiPaused: true,
          takeoverExpiresAt: null,
        },
      }),
      turnInput: turnInput(),
      now,
    }, { resolveVoice, resumeExpiredTakeover });

    expect(resumeExpiredTakeover).toHaveBeenCalledOnce();
    expect(resumeExpiredTakeover).toHaveBeenCalledWith("conversation-1");
    expect(expired.gateInput.humanControlled).toBe(false);
    expect(manual.gateInput.humanControlled).toBe(true);
  });

  it("leva a voz da empresa para dentro da resposta, sem levar fato que ninguém autorizou", async () => {
    const configuration = await resolveV2LiveTurnConfiguration({
      context: context({
        clinic: { id: "clinic-lab", name: "SystemOps Dental Lab" },
        editorial: {
          toneOfVoice: "acolhedor e objetivo",
          receptionistName: "Marina",
          specialty: "odontologia estética",
          commercialPolicy: "Lentes de resina: R$ 4.000. Avaliação sempre gratuita.",
          differentials: ["Atendimento no mesmo dia"],
          objections: [{ objection: "está caro", response: "temos parcelamento em 10x" }],
          playbookText: [
            "Responder primeiro, perguntar depois.",
            "PROCEDIMENTOS OFERECIDOS:\n• Lentes de resina",
            "DIFERENCIAIS:\n• Atendimento no mesmo dia",
            "GARANTIA:\n- troca em 12 meses",
            "COMO LIDAR COM OBJEÇÕES:\n- \"está caro\" → temos parcelamento em 10x",
          ].join("\n\n"),
        },
      }),
      turnInput: turnInput(),
      now,
    }, {
      resolveVoice: vi.fn().mockResolvedValue({
        voiceEnabled: false,
        ttsConfig: { provider: "nova", speed: 0.92 },
      }),
      resumeExpiredTakeover: vi.fn(),
    });

    expect(configuration.speaker).toEqual({
      agentName: "Marina",
      organizationName: "SystemOps Dental Lab",
      specialty: "odontologia estética",
      toneOfVoice: "acolhedor e objetivo",
      guidelines: ["Responder primeiro, perguntar depois."],
    });
  });

  it("não inventa voz quando a organização ainda não publicou playbook", async () => {
    const configuration = await resolveV2LiveTurnConfiguration({
      context: context({
        clinic: { id: "clinic-lab", name: "SystemOps Dental Lab" },
        editorial: null,
      }),
      turnInput: turnInput(),
      now,
    }, {
      resolveVoice: vi.fn().mockResolvedValue({
        voiceEnabled: false,
        ttsConfig: { provider: "nova", speed: 0.92 },
      }),
      resumeExpiredTakeover: vi.fn(),
    });

    expect(configuration.speaker).toEqual({
      agentName: null,
      organizationName: "SystemOps Dental Lab",
      specialty: null,
      toneOfVoice: null,
      guidelines: [],
    });
  });

  it.each([
    ["claimed turn", { turnInput: turnInput({ clinicId: "clinic-other" }) }],
    ["loaded organization", { context: context({ clinic: { id: "clinic-other" } }) }],
  ])("rejects a cross-tenant %s before resolving voice or takeover", async (_case, override) => {
    const resolveVoice = vi.fn();
    const resumeExpiredTakeover = vi.fn();

    await expect(resolveV2LiveTurnConfiguration({
      context: "context" in override ? override.context : context(),
      turnInput: "turnInput" in override ? override.turnInput : turnInput(),
      now,
    }, { resolveVoice, resumeExpiredTakeover })).rejects.toBeInstanceOf(
      V2TurnTenantScopeError,
    );

    expect(resolveVoice).not.toHaveBeenCalled();
    expect(resumeExpiredTakeover).not.toHaveBeenCalled();
  });
});
