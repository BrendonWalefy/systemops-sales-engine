import { describe, expect, it } from "vitest";
import {
  computeInternalLabRuntimeBindings,
  assertInternalLabRuntimeArtifactBindings,
  INTERNAL_LAB_RUNTIME_ARTIFACT_SCHEMA,
} from "@/application/conversation-v2/internal-lab-runtime-bindings";

function artifact(secret: string, treatmentPrice = 90_000) {
  return {
    schemaVersion: INTERNAL_LAB_RUNTIME_ARTIFACT_SCHEMA,
    clinic: {
      id: "clinic-lab",
      name: "SystemOps Dental Lab",
      channelProvider: "z_api",
      zapiInstanceId: "instance-1",
      zapiToken: secret,
      zapiClientToken: secret,
      updatedAt: "2026-08-17T12:00:00.000Z",
    },
    editorial: { versionId: "playbook-1", toneOfVoice: "acolhedor" },
    modules: [{ key: "voice_tts", config: { provider: "nova" } }],
    treatments: [{ id: "treatment-1", priceCents: treatmentPrice }],
  } as const;
}

describe("Internal Lab runtime artifact bindings", () => {
  it("binds credential rotation without ever returning credential bytes", () => {
    const left = computeInternalLabRuntimeBindings(artifact("secret-one"));
    const right = computeInternalLabRuntimeBindings({
      ...artifact("secret-two"),
      clinic: {
        ...artifact("secret-two").clinic,
        updatedAt: "2026-08-18T12:00:00.000Z",
      },
    });

    expect(right.tenantDigest).toBe(left.tenantDigest);
    expect(right.channelDigest).not.toBe(left.channelDigest);
    expect(JSON.stringify(right)).not.toContain("secret");
  });

  it("changes the signed config binding when an actual treatment fact drifts", () => {
    const approved = computeInternalLabRuntimeBindings(artifact("secret", 90_000));
    const drifted = computeInternalLabRuntimeBindings(artifact("secret", 95_000));

    expect(drifted.tenantDigest).toBe(approved.tenantDigest);
    expect(drifted.channelDigest).toBe(approved.channelDigest);
    expect(drifted.configDigest).not.toBe(approved.configDigest);
    expect(() => assertInternalLabRuntimeArtifactBindings(
      approved,
      artifact("secret", 95_000),
    )).toThrow(/configDigest mismatch/);
  });
});
