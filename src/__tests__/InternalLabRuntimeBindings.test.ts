import { describe, expect, it } from "vitest";
import {
  computeInternalLabRuntimeBindings,
  assertInternalLabRuntimeArtifactBindings,
  INTERNAL_LAB_RUNTIME_ARTIFACT_SCHEMA,
  protectInternalLabRuntimeArtifactForFile,
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
      metaAppSecret: `meta-${secret}`,
      calendarSyncToken: `calendar-${secret}`,
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

  it("writes a credential-free artifact without changing any Task 6 binding", () => {
    const resolved = artifact("credential-bytes-must-not-leave-memory");
    const protectedArtifact = protectInternalLabRuntimeArtifactForFile(resolved);

    expect(computeInternalLabRuntimeBindings(protectedArtifact)).toEqual(
      computeInternalLabRuntimeBindings(resolved),
    );
    expect(JSON.stringify(protectedArtifact)).not.toContain(
      "credential-bytes-must-not-leave-memory",
    );
    expect(JSON.stringify(protectedArtifact)).not.toContain(
      "meta-credential-bytes-must-not-leave-memory",
    );
    expect(JSON.stringify(protectedArtifact)).not.toContain(
      "calendar-credential-bytes-must-not-leave-memory",
    );
    expect(protectedArtifact.clinic.zapiToken).toBe(true);
    expect(protectedArtifact.channelCredentialDigests?.zapiToken).toMatch(
      /^sha256:[a-f0-9]{64}$/,
    );
  });

  it("preserves binding absence for null and empty secret fields", () => {
    const base = artifact("zapi-secret");
    const resolved = {
      ...base,
      clinic: {
        ...base.clinic,
        metaAccessToken: null,
        metaAppSecret: null,
        calendarSyncToken: "",
      },
    } as const;

    expect(computeInternalLabRuntimeBindings(
      protectInternalLabRuntimeArtifactForFile(resolved),
    )).toEqual(computeInternalLabRuntimeBindings(resolved));
  });
});
