import { describe, expect, it } from "vitest";
import {
  DEFAULT_PIPELINE_QA_MAX_TURNS,
  MAX_PIPELINE_QA_MAX_TURNS,
  MIN_PIPELINE_QA_MAX_TURNS,
  resolvePipelineQaMaxTurns,
} from "@/core/pipeline/PipelineLimits";

describe("PipelineLimits", () => {
  it("preserves the current default when the clinic has no override", () => {
    expect(resolvePipelineQaMaxTurns(null)).toBe(
      DEFAULT_PIPELINE_QA_MAX_TURNS,
    );
  });

  it("bounds tenant overrides before they reach the state machine", () => {
    expect(resolvePipelineQaMaxTurns(0)).toBe(MIN_PIPELINE_QA_MAX_TURNS);
    expect(resolvePipelineQaMaxTurns(500)).toBe(MAX_PIPELINE_QA_MAX_TURNS);
    expect(resolvePipelineQaMaxTurns(7.8)).toBe(7);
    expect(resolvePipelineQaMaxTurns(Number.POSITIVE_INFINITY)).toBe(
      DEFAULT_PIPELINE_QA_MAX_TURNS,
    );
  });
});
