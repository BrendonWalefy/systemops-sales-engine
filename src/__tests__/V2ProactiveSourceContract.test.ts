import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PRODUCERS = [
  "src/app/api/cron/follow-up-dispatcher/route.ts",
  "src/app/api/cron/appointment-reminder/route.ts",
  "src/app/api/cron/post-appointment-followup/route.ts",
  "src/app/api/cron/recovery-campaign/route.ts",
  "src/app/api/cron/deposit-expiry-sweep/route.ts",
  "src/application/reactivation/dispatch-campaign.ts",
  "src/application/conversations/enqueue-no-show-recovery.ts",
  "src/app/(clinic)/app/inbox/recovery-actions.ts",
] as const;

function source(path: string): string {
  return readFileSync(path, "utf8");
}

describe("V2 proactive production source contract", () => {
  it.each(PRODUCERS)("uses the closed sender-owned envelope in %s", (path) => {
    const text = source(path);
    expect(text).toContain("buildProactiveOutboundPayload");
    expect(text).toContain("proactiveTurnId");
    expect(text).not.toMatch(/\.insert\(messages\)/);
    expect(text).not.toMatch(/conversationRepository\.appendMessage\(/);
  });

  it.each(PRODUCERS)("emits an enqueue trace in %s", (path) => {
    expect(source(path)).toContain("decisionTraceSink");
  });

  it("keeps creation and delivery bounded with no polling or new worker", () => {
    const creation = source("src/infrastructure/repositories/drizzle-outbound-message-store.ts");
    const preflight = source("src/infrastructure/repositories/drizzle-live-outbound-preflight.ts");
    expect(creation).toContain("for share");
    expect(creation).toContain("creation_context as materialized");
    expect(preflight).toContain("where outbound.id = ${id}::uuid");
    expect(`${creation}\n${preflight}`).not.toMatch(/setInterval|heartbeat|polling/i);
  });
});
