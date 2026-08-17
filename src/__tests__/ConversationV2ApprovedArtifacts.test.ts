import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  digestCycleIGateArtifactContent,
  digestCycleIProseManifestContent,
  loadAuthorizedCycleIGateArtifacts,
  loadAuthorizedCycleIProseRecords,
} from "@/application/conversation-v2/approved-cycle-i-artifacts";
import {
  CYCLE_I_RUN_MANIFEST_AUTHORITY_DOMAIN,
  digestCycleIRunConfig,
  digestCycleIRunManifest,
  parseAuthorizedCycleIRunManifest,
  serializeCycleIRunManifestAuthorityPayload,
} from "@/application/conversation-v2/run-manifest-authority";

const ref = (char: string): `hmac:${string}` => `hmac:${char.repeat(64)}`;
const gate = generateKeyPairSync("ed25519");
const approval = generateKeyPairSync("ed25519");
process.env.CONVERSATION_V2_GATE_REPORT_AUTHORITY_PUBLIC_KEY = gate.publicKey.export({ type: "spki", format: "pem" }).toString();
process.env.CONVERSATION_V2_ACTIVATION_APPROVAL_AUTHORITY_PUBLIC_KEY = approval.publicKey.export({ type: "spki", format: "pem" }).toString();

function authorize(extra: Record<string, unknown>) {
  const unsigned = { version: "conversation-v2-cycle-i-run-manifest.v3", implementationCommit: "a".repeat(40), implementationTreeDigest: ref("1"), implementationSourceDigest: ref("9"), corpusRoot: "evals/corpus", manifestPath: "evals/understanding/cycle-f-dental.json", d0Path: "evals/corpus/measurement-stability-d0.json", comparabilityPath: "evals/cycle-i/understanding-comparability.json", comparabilityDigest: ref("2"), tenantConfigDigest: ref("3"), corpusDigest: ref("4"), populationDigest: ref("5"), d0Digest: ref("6"), runs: 6, v1: { modelId: "gpt-4o-mini", adapterId: "intent-classifier.v1", promptDigest: ref("7") }, v2: { modelId: "gpt-4o-mini", adapterId: "dental-understanding-provider.v1", promptDigest: ref("8") }, decisionManifest: null, proseManifest: null, fullTurnEvidence: null, judge: "experimental_non_gating", evidence: { h_entailment: null, shadow_no_effects: null, cycle_f_axes: null, rollback: null, observability: null, verification: null, adversarial_review: null }, ...extra } as const;
  const configDigest = digestCycleIRunConfig(unsigned); const manifestDigest = digestCycleIRunManifest({ ...unsigned, configDigest }); const candidate = { ...unsigned, configDigest, manifestDigest };
  const signature = sign(null, Buffer.from(`${CYCLE_I_RUN_MANIFEST_AUTHORITY_DOMAIN}\0${serializeCycleIRunManifestAuthorityPayload(candidate)}`), gate.privateKey).toString("hex");
  return parseAuthorizedCycleIRunManifest({ ...candidate, authoritySignature: `ed25519:${signature}` });
}

describe("Cycle I approved artifacts", () => {
  it("preserves a signed manifest artifact's actual FAIL result instead of fabricating PASS", () => {
    const directory = mkdtempSync(join(tmpdir(), "cycle-i-gate-artifact-"));
    const path = join(directory, "h.json");
    const preAuthority = authorize({});
    const artifact = { version: "conversation-v2-gate-evidence.v1", kind: "h_entailment", runConfigDigest: preAuthority.configDigest, populationDigest: preAuthority.populationDigest, datasetDigest: preAuthority.corpusDigest, configDigest: preAuthority.configDigest, result: { passed: false } };
    const raw = `${JSON.stringify(artifact)}\n`; writeFileSync(path, raw, "utf8");
    const authority = authorize({ evidence: { h_entailment: { path, digest: digestCycleIGateArtifactContent(raw) }, shadow_no_effects: null, cycle_f_axes: null, rollback: null, observability: null, verification: null, adversarial_review: null } });
    const parsed = loadAuthorizedCycleIGateArtifacts(authority);
    expect(parsed.h_entailment?.result).toEqual({ passed: false });
    expect(() => loadAuthorizedCycleIGateArtifacts({ ...authority } as never)).toThrow(/registered/i);
  });

  it("rejects approved prose whose snapshot digest differs from the corresponding run input", () => {
    const ids = ["injection-0001", "media-0005", "objection-0001", "price-0001", "price-0002", "price-0005", "price-0006", "price-0007", "price-0008", "price-0009", "price-0010", "audio-0002", "first-contact-0005", "availability-0001", "scheduling-0001"];
    const records = ids.flatMap((caseId) => [1, 2, 3, 4, 5, 6].flatMap((run) => ["v1", "v2"].map((arm) => ({ version: "conversation-v2-approved-eval.v1", run, caseId, arm, snapshotDigest: ref("a"), outputText: `${arm}-${caseId}-${run}`, source: { kind: "committed_corpus", corpusDigest: ref("4") } }))));
    const raw = `${JSON.stringify({ version: "conversation-v2-approved-prose-pairs.v1", corpusDigest: ref("4"), records })}\n`;
    const path = join(mkdtempSync(join(tmpdir(), "cycle-i-prose-")), "prose.json"); writeFileSync(path, raw, "utf8");
    const authority = authorize({ proseManifest: { path, digest: digestCycleIProseManifestContent(raw) } });
    const expected = Object.fromEntries(ids.map((caseId) => [caseId, caseId === "price-0001" ? ref("b") : ref("a")])) as Record<string, `hmac:${string}`>;
    expect(() => loadAuthorizedCycleIProseRecords({ authority, expectedInputDigests: expected })).toThrow(/snapshot|input/i);
  });
});
