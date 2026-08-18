import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { resolveStopContactDecision } from "@/application/channel-safety/stop-contact-policy";

const execute = vi.hoisted(() => vi.fn());
vi.mock("@/infrastructure/db/client", () => ({ db: { execute } }));

import { persistStopContactDecision } from "@/infrastructure/repositories/drizzle-stop-contact-persistence";

const decision = resolveStopContactDecision({
  classifiedIntent: "stop_contact",
  messageText: "não quero mais receber mensagens",
  now: new Date("2026-08-17T15:00:00.000Z"),
})!;

describe("shared stop-contact persistence", () => {
  it("uses one Neon-compatible statement with lead/conversation/tenant binding", async () => {
    execute.mockResolvedValueOnce({ rows: [{ id: "conversation-1" }] });

    await persistStopContactDecision({
      leadId: "lead-1",
      conversationId: "conversation-1",
      clinicId: "clinic-1",
      decision,
    });

    expect(execute).toHaveBeenCalledOnce();
    const source = readFileSync(
      "src/infrastructure/repositories/drizzle-stop-contact-persistence.ts",
      "utf8",
    );
    expect(source).toContain("db.execute(sql`");
    expect(source).toMatch(/with scoped/i);
    expect(source).toMatch(/conversation\.lead_id = lead\.id/i);
    expect(source).toMatch(/conversation\.organization_id = lead\.organization_id/i);
    expect(source).toContain("conversation.organization_id = ${input.clinicId}");
    expect(source).not.toContain("db.transaction");
  });

  it("fails closed when lead and conversation are not the same tenant-bound relationship", async () => {
    execute.mockResolvedValueOnce({ rows: [] });

    await expect(persistStopContactDecision({
      leadId: "lead-other",
      conversationId: "conversation-1",
      clinicId: "clinic-other",
      decision,
    })).rejects.toThrow(/binding|relationship|tenant/i);
  });
});
