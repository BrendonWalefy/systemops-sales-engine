import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openAiEvidence, sealAiEvidence } from "@/infrastructure/crypto/ai-evidence-vault";
import type { RevealableAiContractRejection } from "@/application/ports/ai-contract-rejection-store";

const routeMocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  findRevealable: vi.fn(),
  recordRevealAudit: vi.fn(),
}));

vi.mock("@/application/tenancy/resolve-clinic", () => ({
  readSession: routeMocks.readSession,
}));
vi.mock("@/infrastructure/repositories/drizzle-ai-contract-rejection-store", () => ({
  DrizzleAiContractRejectionStore: class {
    findRevealable = routeMocks.findRevealable;
    recordRevealAudit = routeMocks.recordRevealAudit;
  },
}));

import { revealAiContractRejection } from "@/application/observability/reveal-ai-contract-rejection";
import { POST } from "@/app/api/owner/clinics/[clinicId]/ai-contract-rejections/[rejectionId]/route";

const KEY = "83".repeat(32);
const NOW = new Date("2026-08-27T03:00:00.000Z");
const ORGANIZATION_ID = "92fe7ecf-f383-4ddc-8c4e-53271af8e3a0";
const OTHER_ORGANIZATION_ID = "0eb85d39-50e8-4c38-b292-d94c6cfe9783";
const REJECTION_ID = "f90eb271-bf64-46cb-b36c-da9c32836654";
const INBOUND_EVENT_ID = "4fdb2b1a-7ced-49ee-975b-87a9e47d4d50";
const RAW_OUTPUT = "private rejected model output sentinel";

function row(overrides: Partial<RevealableAiContractRejection> = {}) {
  const base: RevealableAiContractRejection = {
    evidenceRef: REJECTION_ID,
    organizationId: ORGANIZATION_ID,
    inboundEventId: INBOUND_EVENT_ID,
    turnId: INBOUND_EVENT_ID,
    stage: "understanding_structural",
    modelId: "gpt-4o-mini",
    promptVersion: "dental-understanding.v1",
    contractVersion: "understanding.v1",
    attempt: 1,
    issues: [{ path: [], code: "invalid_json" }],
    outputBytes: Buffer.byteLength(RAW_OUTPUT),
    captureStatus: "stored",
    rawAvailable: true,
    encryptedOutput: sealAiEvidence(RAW_OUTPUT, {
      version: "ai-evidence-aad.v1",
      organizationId: ORGANIZATION_ID,
      rejectionId: REJECTION_ID,
      turnId: INBOUND_EVENT_ID,
      stage: "understanding_structural",
    }, KEY),
    rawExpiresAt: new Date("2026-09-03T03:00:00.000Z"),
    metadataExpiresAt: new Date("2026-09-26T03:00:00.000Z"),
    createdAt: NOW,
  };
  return Object.freeze({ ...base, ...overrides });
}

function dependencies(candidate: RevealableAiContractRejection | null = row()) {
  return {
    store: {
      findRevealable: vi.fn().mockResolvedValue(candidate),
      recordRevealAudit: vi.fn().mockResolvedValue(true),
    },
    open: (envelope: string, aad: Parameters<typeof openAiEvidence>[1]) =>
      openAiEvidence(envelope, aad, KEY),
  };
}

describe("reveal AI contract rejection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AI_EVIDENCE_ENCRYPTION_KEY", KEY);
    routeMocks.readSession.mockResolvedValue({
      email: "owner@example.test",
      role: "owner",
    });
    routeMocks.findRevealable.mockResolvedValue(row());
    routeMocks.recordRevealAudit.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("decrypts exact tenant evidence and returns plaintext only after audit", async () => {
    const deps = dependencies();

    const result = await revealAiContractRejection({
      organizationId: ORGANIZATION_ID,
      rejectionId: REJECTION_ID,
      ownerSubject: "owner@example.test",
      now: NOW,
    }, deps);

    expect(deps.store.findRevealable).toHaveBeenCalledWith(
      ORGANIZATION_ID,
      REJECTION_ID,
    );
    expect(deps.store.recordRevealAudit).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      rejectionId: REJECTION_ID,
      ownerSubject: "owner@example.test",
      accessedAt: NOW,
    });
    expect(result).toEqual({ status: "revealed", rawOutput: RAW_OUTPUT });
    expect(JSON.stringify(deps.store.recordRevealAudit.mock.calls)).not.toContain(RAW_OUTPUT);
  });

  it.each([
    ["cross tenant", null],
    ["expired", row({ rawExpiresAt: NOW })],
    ["oversized", row({ captureStatus: "oversized", encryptedOutput: null })],
    ["no raw", row({ captureStatus: "no_raw_output", encryptedOutput: null })],
  ] as const)("returns uniform not_found for %s evidence", async (_label, candidate) => {
    const deps = dependencies(candidate);

    await expect(revealAiContractRejection({
      organizationId: ORGANIZATION_ID,
      rejectionId: REJECTION_ID,
      ownerSubject: "owner@example.test",
      now: NOW,
    }, deps)).resolves.toEqual({ status: "not_found" });
    expect(deps.store.recordRevealAudit).not.toHaveBeenCalled();
  });

  it("fails closed for wrong key or AAD and when the audit cannot persist", async () => {
    const wrongKey = dependencies();
    wrongKey.open = (envelope, aad) => openAiEvidence(envelope, aad, "91".repeat(32));
    await expect(revealAiContractRejection({
      organizationId: ORGANIZATION_ID,
      rejectionId: REJECTION_ID,
      ownerSubject: "owner@example.test",
      now: NOW,
    }, wrongKey)).resolves.toEqual({ status: "not_found" });
    expect(wrongKey.store.recordRevealAudit).not.toHaveBeenCalled();

    const noKey = dependencies();
    noKey.open = (envelope, aad) => openAiEvidence(envelope, aad, "");
    await expect(revealAiContractRejection({
      organizationId: ORGANIZATION_ID,
      rejectionId: REJECTION_ID,
      ownerSubject: "owner@example.test",
      now: NOW,
    }, noKey)).resolves.toEqual({ status: "not_found" });
    expect(noKey.store.recordRevealAudit).not.toHaveBeenCalled();

    const wrongAad = dependencies(row({ turnId: "different-turn" }));
    await expect(revealAiContractRejection({
      organizationId: ORGANIZATION_ID,
      rejectionId: REJECTION_ID,
      ownerSubject: "owner@example.test",
      now: NOW,
    }, wrongAad)).resolves.toEqual({ status: "not_found" });

    const auditFailure = dependencies();
    auditFailure.store.recordRevealAudit.mockResolvedValue(false);
    await expect(revealAiContractRejection({
      organizationId: ORGANIZATION_ID,
      rejectionId: REJECTION_ID,
      ownerSubject: "owner@example.test",
      now: NOW,
    }, auditFailure)).resolves.toEqual({ status: "not_found" });
  });

  it("requires Owner and returns one no-store response for the exact clinic", async () => {
    const response = await POST(new Request("http://systemops.test", {
      method: "POST",
      headers: { Origin: "http://systemops.test" },
    }), {
      params: Promise.resolve({
        clinicId: ORGANIZATION_ID,
        rejectionId: REJECTION_ID,
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    await expect(response.json()).resolves.toEqual({
      rejectionId: REJECTION_ID,
      rawOutput: RAW_OUTPUT,
    });
    expect(routeMocks.findRevealable).toHaveBeenCalledWith(
      ORGANIZATION_ID,
      REJECTION_ID,
    );
  });

  it.each([
    ["no session", null],
    ["staff", { email: "staff@example.test", role: "clinic_admin" }],
  ])("returns indistinguishable 404 for %s", async (_label, session) => {
    routeMocks.readSession.mockResolvedValue(session);

    const response = await POST(new Request("http://systemops.test", {
      method: "POST",
      headers: { Origin: "http://systemops.test" },
    }), {
      params: Promise.resolve({
        clinicId: ORGANIZATION_ID,
        rejectionId: REJECTION_ID,
      }),
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    expect(routeMocks.findRevealable).not.toHaveBeenCalled();
  });

  it("does not reveal another tenant through the owner route", async () => {
    routeMocks.findRevealable.mockResolvedValue(null);
    const response = await POST(new Request("http://systemops.test", {
      method: "POST",
      headers: { Origin: "http://systemops.test" },
    }), {
      params: Promise.resolve({
        clinicId: OTHER_ORGANIZATION_ID,
        rejectionId: REJECTION_ID,
      }),
    });

    expect(response.status).toBe(404);
    expect(routeMocks.findRevealable).toHaveBeenCalledWith(
      OTHER_ORGANIZATION_ID,
      REJECTION_ID,
    );
  });

  it.each([
    ["missing origin", undefined],
    ["cross origin", "https://attacker.example"],
  ])("rejects an explicit reveal with %s", async (_label, origin) => {
    const headers = origin ? { Origin: origin } : undefined;
    const response = await POST(new Request("http://systemops.test", {
      method: "POST",
      headers,
    }), {
      params: Promise.resolve({
        clinicId: ORGANIZATION_ID,
        rejectionId: REJECTION_ID,
      }),
    });

    expect(response.status).toBe(404);
    expect(routeMocks.findRevealable).not.toHaveBeenCalled();
    expect(routeMocks.recordRevealAudit).not.toHaveBeenCalled();
  });
});
