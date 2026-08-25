import { describe, expect, it, vi } from "vitest";
import { activateWhatsAppStreamAuthority } from "../../scripts/activate-whatsapp-stream-authority";
import type { ConversationAuthorityStore } from "@/application/ports/conversation-authority-store";
import { readFileSync } from "node:fs";
import { parseAuthorityBatchOptions } from "../../scripts/backfill-whatsapp-stream-authority";
import type {
  AuthorityValidationIssue,
  AuthorityValidationReport,
} from "../../scripts/validate-whatsapp-stream-authority";

const CLINIC_ID = "10000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-24T23:00:00.000Z");

const ZERO_METRICS: readonly AuthorityValidationIssue[] = [
  { metric: "unresolved_events", count: 0 },
  { metric: "partial_claims", count: 0 },
  { metric: "identity_conflicts", count: 0 },
  { metric: "duplicate_generations", count: 0 },
  { metric: "duplicate_active_aliases", count: 0 },
  { metric: "active_alias_conflicts", count: 0 },
  { metric: "active_orphan_streams", count: 0 },
  { metric: "multiple_active_streams_per_conversation", count: 0 },
  { metric: "process_job_orphans", count: 0 },
  { metric: "invalid_outbound_authorization", count: 0 },
  { metric: "terminal_legacy_events", count: 0 },
];

function validationReport(
  metric: AuthorityValidationIssue["metric"] | null = null,
  count = 0,
  presentationIssues: readonly string[] | null = null,
): AuthorityValidationReport {
  const metrics = ZERO_METRICS.map((candidate) => (
    candidate.metric === metric ? { ...candidate, count } : candidate
  ));
  return {
    clinicId: CLINIC_ID,
    clean: metrics.every((candidate) => candidate.count === 0),
    issues: presentationIssues ?? metrics
      .filter((candidate) => candidate.count > 0)
      .map((candidate) => `${candidate.metric}=${candidate.count}`),
    metrics,
  };
}

function storeAt(version: 0 | 1 | 2 | 3): ConversationAuthorityStore {
  return {
    getVersion: vi.fn().mockResolvedValue(version),
    compareAndSetVersion: vi.fn().mockResolvedValue(true),
  };
}

describe("WhatsApp authority activation fence", () => {
  it("allows 0 -> 1 when unresolved events are the only migration debt and reports the count", async () => {
    const store = storeAt(0);
    await expect(activateWhatsAppStreamAuthority({
      clinicId: CLINIC_ID,
      expectedVersion: 0,
      nextVersion: 1,
      actor: "principal-review",
      now: NOW,
      store,
      validate: vi.fn().mockResolvedValue(validationReport(
        "unresolved_events",
        235,
        ["identity_conflicts=999"],
      )),
    })).resolves.toEqual({ activated: true, version: 1, unresolvedEvents: 235 });
    expect(store.compareAndSetVersion).toHaveBeenCalledOnce();
  });

  it.each(ZERO_METRICS.filter(({ metric }) => (
    metric !== "unresolved_events" && metric !== "terminal_legacy_events"
  )))(
    "blocks 0 -> 1 when $metric is non-zero",
    async ({ metric }) => {
      const store = storeAt(0);
      await expect(activateWhatsAppStreamAuthority({
        clinicId: CLINIC_ID,
        expectedVersion: 0,
        nextVersion: 1,
        actor: "principal-review",
        now: NOW,
        store,
        validate: vi.fn().mockResolvedValue({
          ...validationReport(metric, 1),
          clean: true,
          issues: [],
        }),
      })).rejects.toThrow(`${metric}=1`);
      expect(store.compareAndSetVersion).not.toHaveBeenCalled();
    },
  );

  it("blocks 1 -> 2 while unresolved migration debt remains", async () => {
    const store = storeAt(1);
    await expect(activateWhatsAppStreamAuthority({
      clinicId: CLINIC_ID,
      expectedVersion: 1,
      nextVersion: 2,
      actor: "principal-review",
      now: NOW,
      store,
      validate: vi.fn().mockResolvedValue({
        ...validationReport("unresolved_events", 1),
        clean: true,
        issues: [],
      }),
    })).rejects.toThrow("unresolved_events=1");
    expect(store.compareAndSetVersion).not.toHaveBeenCalled();
  });

  it("advances 1 -> 2 only when every structured metric is zero", async () => {
    const store = storeAt(1);
    await expect(activateWhatsAppStreamAuthority({
      clinicId: CLINIC_ID,
      expectedVersion: 1,
      nextVersion: 2,
      actor: "principal-review",
      now: NOW,
      store,
      validate: vi.fn().mockResolvedValue(validationReport()),
    })).resolves.toEqual({ activated: true, version: 2, unresolvedEvents: 0 });
    expect(store.compareAndSetVersion).toHaveBeenCalledOnce();
  });

  it("treats terminal legacy history as audited information during 1 -> 2", async () => {
    const store = storeAt(1);
    await expect(activateWhatsAppStreamAuthority({
      clinicId: CLINIC_ID,
      expectedVersion: 1,
      nextVersion: 2,
      actor: "principal-review",
      now: NOW,
      store,
      validate: vi.fn().mockResolvedValue(validationReport("terminal_legacy_events", 50)),
    })).resolves.toEqual({ activated: true, version: 2, unresolvedEvents: 0 });
    expect(store.compareAndSetVersion).toHaveBeenCalledOnce();
  });

  it("uses the same structured blocking policy for dry-run and apply", async () => {
    const report = validationReport("unresolved_events", 42);
    const dryRunStore = storeAt(0);
    const applyStore = storeAt(0);

    await expect(activateWhatsAppStreamAuthority({
      clinicId: CLINIC_ID,
      expectedVersion: 0,
      nextVersion: 1,
      actor: "principal-review",
      now: NOW,
      store: dryRunStore,
      validate: vi.fn().mockResolvedValue(report),
      apply: false,
    }))
      .resolves.toEqual({ activated: false, version: 0, unresolvedEvents: 42 });
    expect(dryRunStore.compareAndSetVersion).not.toHaveBeenCalled();

    await expect(activateWhatsAppStreamAuthority({
      clinicId: CLINIC_ID,
      expectedVersion: 0,
      nextVersion: 1,
      actor: "principal-review",
      now: NOW,
      store: applyStore,
      validate: vi.fn().mockResolvedValue(report),
      apply: true,
    }))
      .resolves.toEqual({ activated: true, version: 1, unresolvedEvents: 42 });
    expect(applyStore.compareAndSetVersion).toHaveBeenCalledOnce();

    const blockingReport = validationReport("identity_conflicts", 1);
    await expect(activateWhatsAppStreamAuthority({
      clinicId: CLINIC_ID,
      expectedVersion: 0,
      nextVersion: 1,
      actor: "principal-review",
      now: NOW,
      store: storeAt(0),
      validate: vi.fn().mockResolvedValue(blockingReport),
      apply: false,
    })).rejects.toThrow("identity_conflicts=1");
    await expect(activateWhatsAppStreamAuthority({
      clinicId: CLINIC_ID,
      expectedVersion: 0,
      nextVersion: 1,
      actor: "principal-review",
      now: NOW,
      store: storeAt(0),
      validate: vi.fn().mockResolvedValue(blockingReport),
      apply: true,
    })).rejects.toThrow("identity_conflicts=1");
  });

  it("preserves exact-current, monotonicity, and skipped-version protections", async () => {
    const validate = vi.fn();
    await expect(activateWhatsAppStreamAuthority({
      clinicId: CLINIC_ID,
      expectedVersion: 2,
      nextVersion: 1,
      actor: "principal-review",
      now: new Date(),
      store: storeAt(2),
      validate,
    })).rejects.toThrow("cannot keep or lower");
    expect(validate).not.toHaveBeenCalled();

    await expect(activateWhatsAppStreamAuthority({
      clinicId: CLINIC_ID,
      expectedVersion: 0,
      nextVersion: 2,
      actor: "principal-review",
      now: NOW,
      store: storeAt(0),
      validate,
    })).rejects.toThrow("must advance one version");

    const mismatchedStore = storeAt(1);
    await expect(activateWhatsAppStreamAuthority({
      clinicId: CLINIC_ID,
      expectedVersion: 0,
      nextVersion: 1,
      actor: "principal-review",
      now: NOW,
      store: mismatchedStore,
      validate,
    })).resolves.toEqual({ activated: false, version: 1, unresolvedEvents: 0 });
    expect(mismatchedStore.compareAndSetVersion).not.toHaveBeenCalled();
  });

  it("keeps maintenance batches bounded, keyset-based, and dry-run by default", () => {
    const clinicId = "10000000-0000-4000-8000-000000000001";
    expect(parseAuthorityBatchOptions(["--clinic-id", clinicId])).toEqual({
      clinicId,
      apply: false,
      batchSize: 500,
      afterId: null,
    });
    expect(() => parseAuthorityBatchOptions([
      "--clinic-id", clinicId, "--batch-size", "501",
    ])).toThrow("between 1 and 500");
  });

  it("purges durable authority dependants in child-first tenant order", () => {
    const source = readFileSync(
      "src/app/api/owner/clinics/[clinicId]/purge/route.ts",
      "utf8",
    );
    const ordered = [
      "db.delete(outboundMessages)",
      "db.delete(messages)",
      "db.delete(jobs)",
      "db.delete(inboundEvents)",
      "db.delete(whatsappStreamAliases)",
      "db.delete(whatsappStreams)",
      "db.delete(conversations)",
      "db.delete(organizations)",
    ].map((needle) => source.indexOf(needle));
    expect(ordered.every((index) => index >= 0)).toBe(true);
    expect(ordered).toEqual([...ordered].sort((left, right) => left - right));
  });
});
