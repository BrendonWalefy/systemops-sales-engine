import { describe, expect, it } from "vitest";
import {
  resolveVoiceOutputFlags,
  shouldForceTextOnlyForActionResult,
} from "@/core/pipeline/ConversationOrchestrator";
import type { FormattedSlot } from "@/core/conversation/ConversationStateMachine";

const slot: FormattedSlot = {
  index: 1,
  startsAt: "2026-07-06T13:00:00.000Z",
  endsAt: "2026-07-06T14:00:00.000Z",
  label: "Segunda, 06/07 às 10:00",
};

describe("voice output controls", () => {
  it("respects voiceOutputEnabled=false for active B-WAVE modules", () => {
    const result = resolveVoiceOutputFlags({
      hasElevenLabsModule: true,
      elevenLabsConfig: {
        voiceId: "voice-id",
        stability: 0.35,
        similarityBoost: 0.85,
        speed: 1,
        mode: "impact",
        voiceOutputEnabled: false,
      },
      hasVoiceTtsModule: true,
      voiceTtsConfig: {
        provider: "nova",
        speed: 1,
        mode: "impact",
      },
    });

    expect(result).toEqual({
      bwaveEnabled: false,
      voiceBasicEnabled: false,
      voiceEnabled: false,
    });
  });

  it("defaults voice output to enabled when the module is active and not explicitly disabled", () => {
    const result = resolveVoiceOutputFlags({
      hasElevenLabsModule: true,
      elevenLabsConfig: {
        voiceId: "voice-id",
        stability: 0.35,
        similarityBoost: 0.85,
        speed: 1,
        mode: "impact",
      },
      hasVoiceTtsModule: false,
      voiceTtsConfig: null,
    });

    expect(result.voiceEnabled).toBe(true);
    expect(result.bwaveEnabled).toBe(true);
  });

  it("forces slot-option responses to text even when voice mode is active", () => {
    expect(
      shouldForceTextOnlyForActionResult({
        type: "slots_found",
        slots: [slot],
        askedForPreference: false,
      }),
    ).toBe(true);
    expect(
      shouldForceTextOnlyForActionResult({
        type: "evaluation_redirect",
        treatmentName: "Lentes de resina",
        evaluationSlots: [slot],
      }),
    ).toBe(true);
    expect(
      shouldForceTextOnlyForActionResult({
        type: "no_slots_available",
        alternativeSlots: [slot],
      }),
    ).toBe(true);
  });

  it("does not force text for appointment confirmations without slot options", () => {
    expect(
      shouldForceTextOnlyForActionResult({
        type: "appointment_confirmed",
        slot,
        clinicName: "Ximendes Odontologia",
      }),
    ).toBe(false);
  });
});
