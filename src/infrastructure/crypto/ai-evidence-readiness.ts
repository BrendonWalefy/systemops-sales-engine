export type AiEvidenceRuntimeEnvironment = Readonly<
  Record<string, string | undefined>
>;

export type AiEvidenceReadiness =
  | Readonly<{ ready: true; status: "ready" | "disabled" }>
  | Readonly<{
      ready: false;
      status: "blocked";
      reason:
        | "ai_evidence_capture_flag_invalid"
        | "ai_evidence_encryption_key_invalid";
    }>;

type CaptureSetting = "enabled" | "disabled" | "invalid";

function resolveCaptureSetting(env: AiEvidenceRuntimeEnvironment): CaptureSetting {
  const configured = env.AI_EVIDENCE_CAPTURE_ENABLED;
  if (configured === undefined) return "enabled";
  const normalized = configured.trim().toLowerCase();
  if (normalized === "true") return "enabled";
  if (normalized === "false") return "disabled";
  return "invalid";
}

export function isAiEvidenceCaptureEnabled(
  env: AiEvidenceRuntimeEnvironment,
): boolean {
  return resolveCaptureSetting(env) === "enabled";
}

export function evaluateAiEvidenceReadiness(
  env: AiEvidenceRuntimeEnvironment,
): AiEvidenceReadiness {
  const captureSetting = resolveCaptureSetting(env);
  if (captureSetting === "invalid") {
    return {
      ready: false,
      status: "blocked",
      reason: "ai_evidence_capture_flag_invalid",
    };
  }
  if (captureSetting === "disabled") {
    return { ready: true, status: "disabled" };
  }
  if (!/^[a-f0-9]{64}$/i.test(env.AI_EVIDENCE_ENCRYPTION_KEY ?? "")) {
    return {
      ready: false,
      status: "blocked",
      reason: "ai_evidence_encryption_key_invalid",
    };
  }
  return { ready: true, status: "ready" };
}
