import { describe, expect, it } from "vitest";
import { renderReplayReview } from "../../scripts/render-replay-review";
import type { ReplayDatasetV2 } from "@/application/replay/contracts";

function fixture(): ReplayDatasetV2 {
  return {
    schemaVersion: "replay-dataset.v2",
    datasetVersion: "baseline-1",
    generatedAt: "2026-07-24T12:00:00.000Z",
    status: "needs_review",
    sanitization: {
      automated: true,
      humanReviewRequired: true,
      humanReviewApprovedAt: null,
    },
    approval: null,
    clinic: {
      clinicKey: "clinic-a",
      timezone: "America/Sao_Paulo",
      configFingerprint: "config",
      playbookFingerprint: "playbook",
    },
    scenarioCount: 1,
    scenarios: [{
      schemaVersion: "replay-scenario.v1",
      id: "scenario-1",
      datasetVersion: "baseline-1",
      source: {
        kind: "historical",
        sourceRef: "opaque-source",
        sanitized: true,
      },
      clinic: {
        clinicKey: "clinic-a",
        configFingerprint: "config",
        playbookFingerprint: "playbook",
      },
      compatibleModes: ["closed_loop"],
      clock: {
        startedAt: "2026-07-24T12:00:00.000Z",
        timezone: "America/Sao_Paulo",
      },
      tags: ["historical"],
      turns: [{
        id: "turn-1",
        author: "lead",
        offsetMs: 3_723_000,
        content: {
          type: "text",
          text: "Olá <script>\nTudo bem?",
        },
      }],
    }],
  };
}

describe("renderReplayReview", () => {
  it("gera checklist legível sem permitir HTML bruto", () => {
    const review = renderReplayReview(fixture());

    expect(review).toContain("Checklist obrigatório");
    expect(review).toContain("LEAD · +01:02:03 · text");
    expect(review).toContain("&lt;script&gt;");
    expect(review).not.toContain("<script>");
  });

  it("recusa dataset já aprovado", () => {
    const dataset = fixture();
    dataset.status = "approved";

    expect(() => renderReplayReview(dataset)).toThrow("needs_review");
  });
});
