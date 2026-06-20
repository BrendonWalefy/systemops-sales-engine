import { describe, expect, it } from "vitest";
import {
  applyPlanActivations,
  mergeRedeBWaveConfig,
  REDE_RECOMMENDED_BWAVE_CONFIG,
  REDE_RECOMMENDED_TONE,
  shouldApplyRedeToneRecommendation,
} from "@/application/modules/plan-presets";

describe("plan presets", () => {
  it("activates plan modules without turning off manual overrides", () => {
    const nextState = applyPlanActivations(
      {
        voice_elevenlabs: true,
        video_library: true,
      },
      "essencial",
    );

    expect(nextState.menu_mode).toBe(true);
    expect(nextState.voice_elevenlabs).toBe(true);
    expect(nextState.video_library).toBe(true);
  });

  it("fills missing B-WAVE defaults while preserving saved values", () => {
    const config = mergeRedeBWaveConfig({
      voiceId: "abc123",
      speed: 1.05,
    });

    expect(config.voiceId).toBe("abc123");
    expect(config.speed).toBe(1.05);
    expect(config.stability).toBe(REDE_RECOMMENDED_BWAVE_CONFIG.stability);
    expect(config.similarityBoost).toBe(
      REDE_RECOMMENDED_BWAVE_CONFIG.similarityBoost,
    );
    expect(config.mode).toBe(REDE_RECOMMENDED_BWAVE_CONFIG.mode);
  });

  it("applies the Rede tone recommendation only to empty or generic tones", () => {
    expect(shouldApplyRedeToneRecommendation("acolhedor")).toBe(true);
    expect(shouldApplyRedeToneRecommendation("")).toBe(true);
    expect(shouldApplyRedeToneRecommendation(REDE_RECOMMENDED_TONE)).toBe(false);
    expect(
      shouldApplyRedeToneRecommendation(
        "Tom autoral, técnico e centrado em autoridade médica.",
      ),
    ).toBe(false);
  });
});
