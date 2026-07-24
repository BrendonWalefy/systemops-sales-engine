import { createHmac } from "node:crypto";
import {
  REPLAY_DATASET_SCHEMA_VERSION,
  REPLAY_SCENARIO_SCHEMA_VERSION,
  type ReplayDatasetV1,
  type ReplayScenarioMode,
  type ReplayScenarioTurnV1,
  type ReplayTurnAuthor,
  type ReplayTurnContentType,
} from "@/application/replay/contracts";
import {
  replayPiiDetectors,
  sanitizeReplayText,
} from "@/application/replay/sanitize-replay-text";

export type ReplaySourceMessage = {
  sourceId: string;
  author: ReplayTurnAuthor;
  body: string;
  mediaType: Exclude<ReplayTurnContentType, "text"> | null;
  sentAt: Date;
};

export type ReplaySourceConversation = {
  sourceId: string;
  leadName: string | null;
  messages: ReplaySourceMessage[];
};

export type BuildSanitizedReplayCorpusInput = {
  datasetVersion: string;
  generatedAt: Date;
  clinicKey: string;
  timezone: string;
  configFingerprint: string;
  playbookFingerprint: string | null;
  sourceHashKey: string;
  conversations: ReplaySourceConversation[];
};

export function buildSanitizedReplayCorpus(
  input: BuildSanitizedReplayCorpusInput,
): ReplayDatasetV1 {
  if (input.sourceHashKey.length < 32) {
    throw new Error("Replay source hash key must have at least 32 characters");
  }

  const scenarios = input.conversations.flatMap((conversation) => {
    const ordered = [...conversation.messages].sort(
      (a, b) => a.sentAt.getTime() - b.sentAt.getTime(),
    );
    if (!ordered.some((message) => message.author === "lead")) return [];
    if (!ordered.some((message) => message.author === "agent" || message.author === "operator")) {
      return [];
    }

    const firstTimestamp = ordered[0]?.sentAt.getTime();
    if (firstTimestamp === undefined) return [];
    const sourceRef = opaqueRef(input.sourceHashKey, [
      input.clinicKey,
      conversation.sourceId,
    ]);
    const turns: ReplayScenarioTurnV1[] = ordered.map((message, index) => {
      const contentType = message.mediaType ?? "text";
      const sanitizedBody = sanitizeReplayText(message.body, conversation.leadName);
      const mediaPlaceholder =
        contentType === "text" ? "" : `[MIDIA:${contentType.toUpperCase()}]`;
      const text = [mediaPlaceholder, sanitizedBody].filter(Boolean).join(" ");

      return {
        id: `turn-${opaqueRef(input.sourceHashKey, [
          input.clinicKey,
          conversation.sourceId,
          message.sourceId,
          String(index),
        ])}`,
        author: message.author,
        offsetMs: Math.max(0, message.sentAt.getTime() - firstTimestamp),
        content: {
          type: contentType,
          text: text || "[SEM_TEXTO]",
        },
      };
    });

    const tags = ["historical"];
    if (ordered.some((message) => message.mediaType)) tags.push("has_media");
    if (ordered.some((message) => message.author === "operator")) tags.push("has_operator");
    const hasBurst = ordered.some((message, index) => {
      const previous = ordered[index - 1];
      return previous
        ? message.sentAt.getTime() - previous.sentAt.getTime() <= 5_000
        : false;
    });
    if (hasBurst) tags.push("burst");

    const compatibleModes: ReplayScenarioMode[] = [
      "historical_turn",
      "closed_loop",
      ...(hasBurst ? (["concurrency"] as const) : []),
    ];

    return [{
      schemaVersion: REPLAY_SCENARIO_SCHEMA_VERSION,
      id: `historical-${sourceRef}`,
      datasetVersion: input.datasetVersion,
      source: {
        kind: "historical" as const,
        sourceRef,
        sanitized: true as const,
      },
      clinic: {
        clinicKey: input.clinicKey,
        configFingerprint: input.configFingerprint,
        playbookFingerprint: input.playbookFingerprint,
      },
      compatibleModes,
      clock: {
        startedAt: ordered[0]!.sentAt.toISOString(),
        timezone: input.timezone,
      },
      tags,
      turns,
    }];
  });

  const dataset: ReplayDatasetV1 = {
    schemaVersion: REPLAY_DATASET_SCHEMA_VERSION,
    datasetVersion: input.datasetVersion,
    generatedAt: input.generatedAt.toISOString(),
    status: "needs_review",
    sanitization: {
      automated: true,
      humanReviewRequired: true,
      humanReviewApprovedAt: null,
    },
    clinic: {
      clinicKey: input.clinicKey,
      timezone: input.timezone,
      configFingerprint: input.configFingerprint,
      playbookFingerprint: input.playbookFingerprint,
    },
    scenarioCount: scenarios.length,
    scenarios,
  };

  assertNoKnownSourceIdentifiers(dataset, input.conversations);
  assertNoDetectedPii(dataset);
  return dataset;
}

function opaqueRef(key: string, parts: string[]): string {
  return createHmac("sha256", key)
    .update(parts.join("\u001f"))
    .digest("hex")
    .slice(0, 24);
}

function assertNoKnownSourceIdentifiers(
  dataset: ReplayDatasetV1,
  sources: ReplaySourceConversation[],
): void {
  const serialized = JSON.stringify(dataset).toLocaleLowerCase("pt-BR");
  const transcript = dataset.scenarios
    .flatMap((scenario) => scenario.turns.map((turn) => turn.content.text))
    .join("\n")
    .toLocaleLowerCase("pt-BR");
  for (const source of sources) {
    const sourceIds = [
      source.sourceId,
      ...source.messages.map((message) => message.sourceId),
    ];
    for (const value of sourceIds) {
      if (value && serialized.includes(value.toLocaleLowerCase("pt-BR"))) {
        throw new Error("Replay sanitizer retained a known source identifier");
      }
    }
    for (const value of nameTokens(source.leadName)) {
      if (transcript.includes(value.toLocaleLowerCase("pt-BR"))) {
        throw new Error("Replay sanitizer retained a known lead name");
      }
    }
  }
}

function assertNoDetectedPii(dataset: ReplayDatasetV1): void {
  const transcript = dataset.scenarios
    .flatMap((scenario) => scenario.turns.map((turn) => turn.content.text))
    .join("\n");
  for (const [kind, detector] of Object.entries(replayPiiDetectors)) {
    detector.lastIndex = 0;
    if (detector.test(transcript)) {
      throw new Error(`Replay sanitizer retained detected PII: ${kind}`);
    }
  }
}

function nameTokens(name: string | null): string[] {
  if (!name) return [];
  return name
    .trim()
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !["das", "dos", "para"].includes(token.toLowerCase()));
}
