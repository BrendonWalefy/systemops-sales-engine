import { describe, expect, it, vi } from "vitest";
import { activateWhatsAppStreamAuthority } from "../../scripts/activate-whatsapp-stream-authority";
import type { ConversationAuthorityStore } from "@/application/ports/conversation-authority-store";
import { readFileSync } from "node:fs";
import { parseAuthorityBatchOptions } from "../../scripts/backfill-whatsapp-stream-authority";

function storeAt(version: 0 | 1 | 2 | 3): ConversationAuthorityStore {
  return {
    getVersion: vi.fn().mockResolvedValue(version),
    compareAndSetVersion: vi.fn().mockResolvedValue(true),
  };
}

describe("WhatsApp authority activation fence", () => {
  it("validates clean state and advances one version through durable CAS", async () => {
    const store = storeAt(1);
    await expect(activateWhatsAppStreamAuthority({
      clinicId: "10000000-0000-4000-8000-000000000001",
      expectedVersion: 1,
      nextVersion: 2,
      actor: "principal-review",
      now: new Date("2026-08-24T23:00:00.000Z"),
      store,
      validate: vi.fn().mockResolvedValue({ clean: true, issues: [] }),
    })).resolves.toEqual({ activated: true, version: 2 });
    expect(store.compareAndSetVersion).toHaveBeenCalledOnce();
  });

  it("fails closed when validation reports an ambiguous backfill", async () => {
    const store = storeAt(1);
    await expect(activateWhatsAppStreamAuthority({
      clinicId: "10000000-0000-4000-8000-000000000001",
      expectedVersion: 1,
      nextVersion: 2,
      actor: "principal-review",
      now: new Date("2026-08-24T23:00:00.000Z"),
      store,
      validate: vi.fn().mockResolvedValue({
        clean: false,
        issues: ["identity_conflicts=1"],
      }),
    })).rejects.toThrow("identity_conflicts=1");
    expect(store.compareAndSetVersion).not.toHaveBeenCalled();
  });

  it("rejects downgrade and skipped-version activation before validation", async () => {
    const validate = vi.fn();
    await expect(activateWhatsAppStreamAuthority({
      clinicId: "10000000-0000-4000-8000-000000000001",
      expectedVersion: 2,
      nextVersion: 1,
      actor: "principal-review",
      now: new Date(),
      store: storeAt(2),
      validate,
    })).rejects.toThrow("cannot keep or lower");
    expect(validate).not.toHaveBeenCalled();
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
