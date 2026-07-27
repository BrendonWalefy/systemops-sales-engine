export const DEFAULT_PIPELINE_QA_MAX_TURNS = 10;
export const MIN_PIPELINE_QA_MAX_TURNS = 1;
export const MAX_PIPELINE_QA_MAX_TURNS = 50;

export function resolvePipelineQaMaxTurns(value?: number | null): number {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return DEFAULT_PIPELINE_QA_MAX_TURNS;
  }

  return Math.min(
    MAX_PIPELINE_QA_MAX_TURNS,
    Math.max(MIN_PIPELINE_QA_MAX_TURNS, Math.trunc(value)),
  );
}
