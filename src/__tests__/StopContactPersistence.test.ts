import { readFileSync } from "node:fs";
import { PgDialect } from "drizzle-orm/pg-core";
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

  it("persists the V2 consent source against the exact inbound event", async () => {
    execute.mockResolvedValueOnce({ rows: [{ id: "conversation-1" }] });
    const sourceInboundEventId = "91eca071-354d-48a2-848d-dee2a7029e16";

    await persistStopContactDecision({
      leadId: "lead-1",
      conversationId: "conversation-1",
      clinicId: "clinic-1",
      sourceInboundEventId,
      decision,
    });

    const statement = new PgDialect().sqlToQuery(execute.mock.calls.at(-1)![0]);
    expect(statement.params).toContain(`lead_message:${sourceInboundEventId}`);
    expect(statement.params).not.toContain("lead_message");
  });

  it("preserves the plain historical V1 consent source when no authority event is supplied", async () => {
    execute.mockResolvedValueOnce({ rows: [{ id: "conversation-1" }] });

    await persistStopContactDecision({
      leadId: "lead-1",
      conversationId: "conversation-1",
      clinicId: "clinic-1",
      decision,
    });

    const statement = new PgDialect().sqlToQuery(execute.mock.calls.at(-1)![0]);
    expect(statement.params).toContain("lead_message");
  });

  it("fails closed before persistence when the V2 inbound authority is malformed", async () => {
    const callsBefore = execute.mock.calls.length;

    await expect(persistStopContactDecision({
      leadId: "lead-1",
      conversationId: "conversation-1",
      clinicId: "clinic-1",
      sourceInboundEventId: "not-a-uuid",
      decision,
    })).rejects.toThrow(/inbound authority.*UUID/i);

    expect(execute).toHaveBeenCalledTimes(callsBefore);
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
