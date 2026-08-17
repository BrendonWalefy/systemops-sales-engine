import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const gateEnv = "CONVERSATION_V2_GATE_REPORT_AUTHORITY_PUBLIC_KEY";
const approvalEnv = "CONVERSATION_V2_ACTIVATION_APPROVAL_AUTHORITY_PUBLIC_KEY";
const reviewEnv = "CONVERSATION_V2_REVIEW_AUTHORITY_PUBLIC_KEY";
const originalGate = process.env[gateEnv];
const originalApproval = process.env[approvalEnv];
const originalReview = process.env[reviewEnv];

function pem(key: ReturnType<typeof generateKeyPairSync>["publicKey"]): string {
  return key.export({ type: "spki", format: "pem" }).toString();
}

afterEach(() => {
  if (originalGate === undefined) delete process.env[gateEnv];
  else process.env[gateEnv] = originalGate;
  if (originalApproval === undefined) delete process.env[approvalEnv];
  else process.env[approvalEnv] = originalApproval;
  if (originalReview === undefined) delete process.env[reviewEnv];
  else process.env[reviewEnv] = originalReview;
  vi.resetModules();
});

describe("Cycle I productive run authority", () => {
  it("registers only a content-bound manifest signed by the configured authority", async () => {
    vi.resetModules();
    const gate = generateKeyPairSync("ed25519");
    const approval = generateKeyPairSync("ed25519");
    const review = generateKeyPairSync("ed25519");
    process.env[gateEnv] = pem(gate.publicKey);
    process.env[approvalEnv] = pem(approval.publicKey);
    process.env[reviewEnv] = pem(review.publicKey);
    const authority = await import("@/application/conversation-v2/run-manifest-authority");
    const unsigned = {
      version: "conversation-v2-cycle-i-run-manifest.v3",
      implementationCommit: "359fcf4b",
      implementationTreeDigest: `hmac:${"1".repeat(64)}`,
      implementationSourceDigest: `hmac:${"f".repeat(64)}`,
      corpusRoot: "evals/corpus",
      manifestPath: "evals/understanding/cycle-f-dental.json",
      d0Path: "evals/corpus/measurement-stability-d0.json",
      comparabilityPath: "evals/cycle-i/understanding-comparability.json",
      comparabilityDigest: `hmac:${"8".repeat(64)}`,
      tenantConfigDigest: `hmac:${"9".repeat(64)}`,
      corpusDigest: `hmac:${"2".repeat(64)}`,
      populationDigest: `hmac:${"3".repeat(64)}`,
      d0Digest: `hmac:${"4".repeat(64)}`,
      runs: 6,
      v1: { modelId: "gpt-4o-mini", adapterId: "intent-classifier.v1", promptDigest: `hmac:${"5".repeat(64)}` },
      v2: { modelId: "gpt-4o-mini", adapterId: "dental-understanding-provider.v1", promptDigest: `hmac:${"6".repeat(64)}` },
      decisionManifest: null,
      proseManifest: null,
      fullTurnEvidence: null,
      configDigest: `hmac:${"7".repeat(64)}`,
      judge: "experimental_non_gating",
      evidence: { h_entailment: null, shadow_no_effects: null, cycle_f_axes: null, rollback: null, observability: null, verification: null, adversarial_review: null },
    } as const;
    const configDigest = authority.digestCycleIRunConfig(unsigned);
    const manifestDigest = authority.digestCycleIRunManifest({ ...unsigned, configDigest });
    const toSign = { ...unsigned, configDigest, manifestDigest };
    const signature = sign(
      null,
      Buffer.from(`${authority.CYCLE_I_RUN_MANIFEST_AUTHORITY_DOMAIN}\0${authority.serializeCycleIRunManifestAuthorityPayload(toSign)}`),
      gate.privateKey,
    ).toString("hex");
    const manifest = authority.parseAuthorizedCycleIRunManifest({
      ...toSign,
      authoritySignature: `ed25519:${signature}`,
    });

    expect(authority.isRegisteredAuthorizedCycleIRunManifest(manifest)).toBe(true);
    expect(() => authority.parseAuthorizedCycleIRunManifest({
      ...toSign,
      v2: { ...toSign.v2, modelId: "out-of-manifest" },
      authoritySignature: `ed25519:${signature}`,
    })).toThrow(/digest|signature|config/i);

    const buildModule = await import(
      "@/infrastructure/conversation-v2/git-cycle-i-build-attestation"
    );
    const buildAttestation = buildModule.createGitCycleIBuildAttestation();
    const sourceMismatchUnsigned = {
      ...unsigned,
      implementationCommit: buildAttestation.commit,
      implementationTreeDigest: buildAttestation.treeDigest,
      implementationSourceDigest: `hmac:${"0".repeat(64)}`,
    } as const;
    const sourceMismatchConfig = authority.digestCycleIRunConfig(sourceMismatchUnsigned);
    const sourceMismatchDigest = authority.digestCycleIRunManifest({
      ...sourceMismatchUnsigned,
      configDigest: sourceMismatchConfig,
    });
    const sourceMismatchToSign = {
      ...sourceMismatchUnsigned,
      configDigest: sourceMismatchConfig,
      manifestDigest: sourceMismatchDigest,
    };
    const sourceMismatchSignature = sign(
      null,
      Buffer.from(
        `${authority.CYCLE_I_RUN_MANIFEST_AUTHORITY_DOMAIN}\0${authority.serializeCycleIRunManifestAuthorityPayload(sourceMismatchToSign)}`,
      ),
      gate.privateKey,
    ).toString("hex");
    const sourceMismatchAuthority = authority.parseAuthorizedCycleIRunManifest({
      ...sourceMismatchToSign,
      authoritySignature: `ed25519:${sourceMismatchSignature}`,
    });
    const calls: string[] = [];
    const injectedArm = Object.freeze({
      async runCase() {
        calls.push("provider");
        throw new Error("must not be reached");
      },
    });
    const runner = await import("@/application/conversation-v2/corpus-comparison-runner");
    await expect(runner.runCycleICorpusComparison({
      corpusRoot: sourceMismatchAuthority.corpusRoot,
      manifestPath: sourceMismatchAuthority.manifestPath,
      d0Path: sourceMismatchAuthority.d0Path,
      decisionFixtureManifestPath: null,
      v1Understanding: injectedArm,
      v2Understanding: injectedArm,
      runs: 6,
      fixedClockByCase: Object.freeze({}),
      comparabilityPath: sourceMismatchAuthority.comparabilityPath,
      authority: sourceMismatchAuthority,
      buildAttestation,
    })).rejects.toThrow(/source bytes|implementation source/i);
    expect(calls).toEqual([]);

    const decision = await import("@/application/conversation-v2/decision-fixture-manifest");
    const caseIds = [
      "injection-0001", "media-0005", "objection-0001", "price-0001", "price-0002",
      "price-0005", "price-0006", "price-0007", "price-0008", "price-0009", "price-0010",
      "audio-0002", "first-contact-0005", "availability-0001", "scheduling-0001",
      "scheduling-0003", "burst-0002",
    ];
    const partial = {
      version: "conversation-v2-decision-fixtures.v2",
      populationDigest: unsigned.populationDigest,
      population: caseIds.map((caseId) => ({
        caseId,
        applicability: caseId === "availability-0001" ? "applicable" : "not_applicable",
        reason: caseId === "availability-0001" ? null : "not_selected_for_decision_measurement",
      })),
      fixtures: [],
    };
    const path = join(mkdtempSync(join(tmpdir(), "cycle-i-authority-")), "decision.json");
    writeFileSync(path, `${JSON.stringify(partial)}\n`, "utf8");
    const unsignedWithDecision = {
      ...unsigned,
      decisionManifest: {
        path,
        digest: decision.digestCycleIDecisionManifestContent(`${JSON.stringify(partial)}\n`),
        populationDigest: unsigned.populationDigest,
      },
    };
    const decisionConfigDigest = authority.digestCycleIRunConfig(unsignedWithDecision);
    const decisionManifestDigest = authority.digestCycleIRunManifest({ ...unsignedWithDecision, configDigest: decisionConfigDigest });
    const decisionToSign = { ...unsignedWithDecision, configDigest: decisionConfigDigest, manifestDigest: decisionManifestDigest };
    const decisionSignature = sign(null, Buffer.from(`${authority.CYCLE_I_RUN_MANIFEST_AUTHORITY_DOMAIN}\0${authority.serializeCycleIRunManifestAuthorityPayload(decisionToSign)}`), gate.privateKey).toString("hex");
    const authorizedDecision = authority.parseAuthorizedCycleIRunManifest({ ...decisionToSign, authoritySignature: `ed25519:${decisionSignature}` });
    expect(() => decision.loadAuthorizedCycleIDecisionFixtureManifest({
      path, authority: authorizedDecision, expectedCaseIds: caseIds,
    })).toThrow(/exactly cover|applicable/i);
  });
});
