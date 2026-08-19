import { describe, expect, it, vi } from "vitest";
import { resolveInternalLabLiveTurnConfiguration } from "@/application/conversation-v2/internal-lab-live-turn-configuration";

const now = new Date("2026-08-17T15:00:00.000Z");

function context(overrides: Record<string, unknown> = {}) {
  return {
    clinicId: "clinic-lab",
    conversationId: "conversation-1",
    clinic: { id: "clinic-lab" },
    lead: { id: "lead-1", contactConsentRevokedAt: null },
    conversation: { id: "conversation-1", aiPaused: false, takeoverExpiresAt: null },
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

const resolveDeliveryBinding = vi.fn().mockResolvedValue({
  tenantDigest: `sha256:${"1".repeat(64)}`,
  channelDigest: `sha256:${"2".repeat(64)}`,
  configDigest: `sha256:${"3".repeat(64)}`,
});

describe("Internal Lab live turn configuration", () => {
  it("derives reply, persistent consent, editorial style and voice from real turn sources", async () => {
    const resolveVoice = vi.fn().mockResolvedValue({
      voiceEnabled: true,
      ttsConfig: { provider: "elevenlabs", speed: 1, elevenLabsVoiceId: "voice-1" },
    });
    const configuration = await resolveInternalLabLiveTurnConfiguration({
      context: context({
        lead: { id: "lead-1", contactConsentRevokedAt: now },
      }),
      turnInput: turnInput({ replyEnabled: false }),
      now,
    }, {
      resolveVoice,
      resumeExpiredTakeover: vi.fn(),
      resolveDeliveryBinding,
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
    const expired = await resolveInternalLabLiveTurnConfiguration({
      context: context({
        conversation: {
          id: "conversation-1",
          aiPaused: true,
          takeoverExpiresAt: new Date("2026-08-17T14:59:59.999Z"),
        },
      }),
      turnInput: turnInput(),
      now,
    }, { resolveVoice, resumeExpiredTakeover, resolveDeliveryBinding });
    const manual = await resolveInternalLabLiveTurnConfiguration({
      context: context({
        conversation: {
          id: "conversation-2",
          aiPaused: true,
          takeoverExpiresAt: null,
        },
      }),
      turnInput: turnInput(),
      now,
    }, { resolveVoice, resumeExpiredTakeover, resolveDeliveryBinding });

    expect(resumeExpiredTakeover).toHaveBeenCalledOnce();
    expect(resumeExpiredTakeover).toHaveBeenCalledWith("conversation-1");
    expect(expired.gateInput.humanControlled).toBe(false);
    expect(manual.gateInput.humanControlled).toBe(true);
  });

  it("leva a voz da empresa para dentro da resposta, com cada dado do seu dono", async () => {
    const configuration = await resolveInternalLabLiveTurnConfiguration({
      context: context({
        clinic: { id: "clinic-lab", name: "SystemOps Dental Lab" },
        editorial: {
          toneOfVoice: "acolhedor e objetivo",
          receptionistName: "Marina",
          specialty: "odontologia estética",
          commercialPolicy: "Avaliação sempre gratuita.",
          differentials: ["Atendimento no mesmo dia"],
          objections: [{ objection: "está caro", response: "temos parcelamento" }],
          playbookText: "Responder primeiro, perguntar depois.",
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
      resolveDeliveryBinding,
    });

    expect(configuration.speaker).toEqual({
      agentName: "Marina",
      organizationName: "SystemOps Dental Lab",
      specialty: "odontologia estética",
      toneOfVoice: "acolhedor e objetivo",
      guidelines: [
        "Responder primeiro, perguntar depois.",
        "Avaliação sempre gratuita.",
        "Atendimento no mesmo dia",
        "Se o lead disser \"está caro\": temos parcelamento",
      ],
    });
  });

  it("não inventa voz quando a organização ainda não publicou playbook", async () => {
    const configuration = await resolveInternalLabLiveTurnConfiguration({
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
      resolveDeliveryBinding,
    });

    expect(configuration.speaker).toEqual({
      agentName: null,
      organizationName: "SystemOps Dental Lab",
      specialty: null,
      toneOfVoice: null,
      guidelines: [],
    });
  });
});
