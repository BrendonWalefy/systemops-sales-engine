import { describe, expect, it } from "vitest";
import {
  captureAiContractRejectionBestEffort,
  type CaptureAiContractRejectionInput,
} from "@/application/ports/ai-contract-rejection-recorder";
import {
  type AiContractRejectionPersistenceInput,
  type AiContractRejectionWriter,
} from "@/application/ports/ai-contract-rejection-store";
import { RuntimeAiContractRejectionRecorder } from "@/infrastructure/observability/runtime-ai-contract-rejection-recorder";
import { openAiEvidence, sealAiEvidence } from "@/infrastructure/crypto/ai-evidence-vault";

const KEY = "6b".repeat(32);
const REJECTION_ID = "22222222-2222-4222-8222-222222222222";
const occurredAt = new Date("2026-08-27T03:00:00.000Z");

const baseInput = (rawOutput: string | null): CaptureAiContractRejectionInput => ({
  organizationId: "11111111-1111-4111-8111-111111111111",
  conversationId: "33333333-3333-4333-8333-333333333333",
  inboundEventId: "44444444-4444-4444-8444-444444444444",
  turnId: "44444444-4444-4444-8444-444444444444",
  stage: "understanding_semantic",
  modelId: "gpt-4o-mini",
  promptVersion: "dental-understanding.v1",
  contractVersion: "understanding.v1",
  attempt: 1,
  rawOutput,
  issues: [{
    path: ["entities", "service"],
    code: "service_required_for_request",
  }],
  occurredAt,
});

class RecordingStore implements AiContractRejectionWriter {
  readonly inputs: AiContractRejectionPersistenceInput[] = [];
  created = true;

  async insert(input: AiContractRejectionPersistenceInput) {
    this.inputs.push(input);
    return { created: this.created, evidenceRef: input.rejectionId };
  }
}

function recorder(store: RecordingStore, seal = sealAiEvidence) {
  return new RuntimeAiContractRejectionRecorder({
    store,
    generateId: () => REJECTION_ID,
    seal: (rawOutput, aad) => seal(rawOutput, aad, KEY),
  });
}

describe("runtime AI contract rejection recorder", () => {
  it("persists exactly 64 KiB encrypted with independent retention clocks", async () => {
    const store = new RecordingStore();
    const rawOutput = "x".repeat(65_536);

    await expect(recorder(store).capture(baseInput(rawOutput))).resolves.toEqual({
      status: "stored",
      evidenceRef: REJECTION_ID,
    });

    expect(store.inputs).toHaveLength(1);
    const persisted = store.inputs[0]!;
    expect(persisted.captureStatus).toBe("stored");
    expect(persisted.outputBytes).toBe(65_536);
    expect(persisted.outputSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(persisted.rawExpiresAt.toISOString()).toBe("2026-09-03T03:00:00.000Z");
    expect(persisted.metadataExpiresAt.toISOString()).toBe("2026-09-26T03:00:00.000Z");
    expect(persisted.encryptedOutput).not.toContain(rawOutput);
    expect(openAiEvidence(persisted.encryptedOutput!, persisted.aad, KEY)).toBe(rawOutput);
  });

  it("keeps only metadata when the UTF-8 output exceeds 64 KiB", async () => {
    const store = new RecordingStore();

    await expect(recorder(store).capture(baseInput("x".repeat(65_537))))
      .resolves.toEqual({ status: "oversized", evidenceRef: REJECTION_ID });

    expect(store.inputs[0]).toMatchObject({
      captureStatus: "oversized",
      outputBytes: 65_537,
      encryptedOutput: null,
    });
  });

  it("measures the byte limit in UTF-8 rather than JavaScript characters", async () => {
    const store = new RecordingStore();

    await recorder(store).capture(baseInput("á".repeat(32_769)));

    expect(store.inputs[0]).toMatchObject({
      captureStatus: "oversized",
      outputBytes: 65_538,
      encryptedOutput: null,
    });
  });

  it("persists missing output as metadata with the zero-byte digest", async () => {
    const store = new RecordingStore();

    await expect(recorder(store).capture(baseInput(null))).resolves.toEqual({
      status: "no_raw_output",
      evidenceRef: REJECTION_ID,
    });

    expect(store.inputs[0]).toMatchObject({
      captureStatus: "no_raw_output",
      outputBytes: 0,
      outputSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      encryptedOutput: null,
    });
  });

  it("persists sanitized metadata when encryption is unavailable", async () => {
    const store = new RecordingStore();
    const unavailableSeal = () => {
      throw new Error("key unavailable with private details");
    };

    await expect(recorder(store, unavailableSeal).capture(baseInput("private raw")))
      .resolves.toEqual({
        status: "encryption_unavailable",
        evidenceRef: REJECTION_ID,
      });

    expect(store.inputs[0]).toMatchObject({
      captureStatus: "encryption_unavailable",
      encryptedOutput: null,
    });
    expect(JSON.stringify(store.inputs[0])).not.toContain("private raw");
  });

  it("removes untrusted issue path segments before persistence", async () => {
    const store = new RecordingStore();
    const privatePath = "patient-phone-5511999999999";

    await recorder(store).capture({
      ...baseInput("private raw"),
      issues: [{
        path: ["entities", privatePath, "service"],
        code: "schema_unknown_key",
      }],
    });

    expect(store.inputs[0]?.issues).toEqual([{
      path: ["entities"],
      code: "schema_unknown_key",
    }]);
    expect(JSON.stringify(store.inputs[0]?.issues)).not.toContain(privatePath);
  });

  it("reports a retry of the same durable tuple as deduplicated", async () => {
    const store = new RecordingStore();
    store.created = false;

    await expect(recorder(store).capture(baseInput("same output"))).resolves.toEqual({
      status: "deduplicated",
      evidenceRef: REJECTION_ID,
    });

    expect(store.inputs).toHaveLength(1);
  });

  it("uses the raw digest to distinguish different rejected outputs", async () => {
    const store = new RecordingStore();

    await recorder(store).capture(baseInput("first"));
    await recorder(store).capture(baseInput("second"));

    expect(store.inputs[0]!.outputSha256).not.toBe(store.inputs[1]!.outputSha256);
  });

  it("converts recorder and persistence failures to a business-neutral status", async () => {
    const input = baseInput("raw that must not escape");

    await expect(captureAiContractRejectionBestEffort({
      async capture() {
        throw new Error("database unavailable: raw that must not escape");
      },
    }, input)).resolves.toEqual({ status: "persistence_failed" });
  });

  it("aborts a stalled persistence request within the capture deadline", async () => {
    let observedSignal: AbortSignal | undefined;
    const stalledStore: AiContractRejectionWriter = {
      async insert(_input, options) {
        observedSignal = options?.signal;
        return await new Promise((resolve, reject) => {
          options?.signal?.addEventListener("abort", () => {
            reject(new Error("capture aborted"));
          }, { once: true });
          void resolve;
        });
      },
    };
    const boundedRecorder = new RuntimeAiContractRejectionRecorder({
      store: stalledStore,
      generateId: () => REJECTION_ID,
      seal: (rawOutput, aad) => sealAiEvidence(rawOutput, aad, KEY),
      captureTimeoutMs: 5,
    });

    await expect(boundedRecorder.capture(baseInput("stalled raw"))).resolves.toEqual({
      status: "persistence_failed",
    });
    expect(observedSignal?.aborted).toBe(true);
  });
});
