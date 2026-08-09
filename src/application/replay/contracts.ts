import type {
  DecisionTraceEventV1,
  DecisionTraceStage,
} from "@/core/observability/DecisionTrace";

export const REPLAY_SCENARIO_SCHEMA_VERSION = "replay-scenario.v1" as const;
export const REPLAY_DATASET_SCHEMA_VERSION = "replay-dataset.v2" as const;
export const REPLAY_RESULT_SCHEMA_VERSION = "replay-result.v1" as const;
export const REPLAY_EVALUATION_SCHEMA_VERSION = "replay-evaluation.v1" as const;
export const REPLAY_CALENDAR_SNAPSHOT_SCHEMA_VERSION = "replay-calendar-snapshot.v1" as const;
export const REPLAY_GOLDEN_EXPECTATIONS_SCHEMA_VERSION = "replay-golden-expectations.v1" as const;
export const REPLAY_GOLDEN_OUTBOUND_KINDS = [
  "text",
  "voice",
  "media",
  "suppressed",
] as const;

export type ReplayScenarioMode =
  | "historical_turn"
  | "closed_loop"
  | "counterfactual"
  | "concurrency";

export type ReplayTurnAuthor = "lead" | "agent" | "operator" | "system";
export type ReplayTurnContentType = "text" | "audio" | "image" | "video" | "document";

export type ReplayScenarioTurnV1 = {
  id: string;
  author: ReplayTurnAuthor;
  offsetMs: number;
  content: {
    type: ReplayTurnContentType;
    /** Conteúdo já anonimizado. Mídia usa descrição/placeholder, nunca URL real. */
    text: string;
  };
};

export type ReplayGoldenExpectationsV1 = {
  schemaVersion: typeof REPLAY_GOLDEN_EXPECTATIONS_SCHEMA_VERSION;
  requiredTraceStages: DecisionTraceStage[];
  forbiddenTraceStages: DecisionTraceStage[];
  finalConversation: {
    aiPaused: boolean | null;
    needsAttention: boolean | null;
  };
  finalState: string | null;
  outbound: {
    minEffects: number;
    maxEffects: number;
    requiredKinds: Array<(typeof REPLAY_GOLDEN_OUTBOUND_KINDS)[number]>;
  };
  calendar: { maxWriteEffects: number };
};

/**
 * Cenário portátil entregue ao runner. IDs de banco, telefone, nome e URLs de
 * produção são proibidos; sourceRef é um hash opaco criado pelo exportador.
 */
export type ReplayScenarioV1 = {
  schemaVersion: typeof REPLAY_SCENARIO_SCHEMA_VERSION;
  id: string;
  datasetVersion: string;
  source: {
    kind: "historical" | "curated" | "synthetic";
    sourceRef: string;
    sanitized: true;
  };
  clinic: {
    clinicKey: string;
    configFingerprint: string;
    playbookFingerprint: string | null;
  };
  compatibleModes: ReplayScenarioMode[];
  clock: {
    startedAt: string;
    timezone: string;
  };
  tags: string[];
  turns: ReplayScenarioTurnV1[];
  expectations?: ReplayGoldenExpectationsV1;
};

export type ReplayDatasetApprovalV1 = {
  algorithm: "ed25519";
  checklistVersion: "replay-privacy-review.v1";
  approvedAt: string;
  approvedBy: string;
  keyId: string;
  sourceDigest: string;
  signature: string;
};

export type ReplayDatasetV2 = {
  schemaVersion: typeof REPLAY_DATASET_SCHEMA_VERSION;
  datasetVersion: string;
  generatedAt: string;
  status: "needs_review" | "approved";
  sanitization: {
    automated: true;
    humanReviewRequired: true;
    humanReviewApprovedAt: string | null;
  };
  approval: ReplayDatasetApprovalV1 | null;
  clinic: ReplayScenarioV1["clinic"] & {
    timezone: string;
  };
  scenarioCount: number;
  scenarios: ReplayScenarioV1[];
};

export type ReplayBugV1 = {
  code: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  evidenceStages: string[];
  probableOwner:
    | "clinic_config"
    | "playbook"
    | "deterministic_code"
    | "prompt_or_model"
    | "concurrency"
    | "delivery"
    | "dataset";
};

export type ReplayResultV1 = {
  schemaVersion: typeof REPLAY_RESULT_SCHEMA_VERSION;
  runId: string;
  scenarioId: string;
  mode: ReplayScenarioMode;
  systemCommit: string;
  startedAt: string;
  completedAt: string;
  transcript: ReplayScenarioTurnV1[];
  trace: DecisionTraceEventV1[];
  deterministicChecks: Array<{
    code: string;
    passed: boolean;
    detail?: string;
  }>;
  bugs: ReplayBugV1[];
};

export type ReplayEvaluationV1 = {
  schemaVersion: typeof REPLAY_EVALUATION_SCHEMA_VERSION;
  runId: string;
  evaluator: {
    kind: "deterministic" | "llm_judge" | "specialist" | "human";
    name: string;
    version: string;
  };
  scores: Record<string, number>;
  confidence: number;
  findings: ReplayBugV1[];
};

export type ReplayCalendarSnapshotV1 = {
  schemaVersion: typeof REPLAY_CALENDAR_SNAPSHOT_SCHEMA_VERSION;
  clinicKey: string;
  configFingerprint: string;
  capturedAt: string;
  range: { from: string; to: string; timezone: string };
  availability: Array<{
    slotDurationMinutes: number;
    professionalId: string | null;
    slots: Array<{
      startsAt: string;
      endsAt: string;
      professionalId: string | null;
      source: "google_calendar" | "manual";
    }>;
  }>;
  blocks: Array<{
    calendarEventId: string;
    startsAt: string;
    endsAt: string;
    reason: string;
  }>;
  approval: {
    algorithm: "ed25519";
    keyId: string;
    signature: string;
  };
};
