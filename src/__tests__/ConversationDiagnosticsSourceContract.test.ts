import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const COMPONENT =
  "src/app/(clinic)/app/inbox/[conversationId]/ConversationDiagnostics.tsx";
const PAGE = "src/app/(clinic)/app/inbox/[conversationId]/page.tsx";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

describe("ConversationDiagnostics source contract", () => {
  it("loads the tenant-scoped summary only after an explicit operator action", () => {
    const text = source(COMPONENT);

    expect(text).toContain('"use client"');
    expect(text).toContain("onClick={loadDiagnostics}");
    expect(text).toContain(
      "`/api/conversations/${encodeURIComponent(conversationId)}/decision-trace`",
    );
    expect(text).toContain('cache: "no-store"');
    expect(text).not.toContain("useEffect");
  });

  it("renders only the closed summary and never raw events or rejection output", () => {
    const text = source(COMPONENT);

    expect(text).toContain("body.summary");
    expect(text).toContain("turn.validationViolations");
    expect(text).toContain("turn.rejectionCodes");
    expect(text).not.toMatch(/body\.events|aiContractRejections/);
    expect(text).not.toMatch(/event\.metadata|rawOutput|encryptedOutput/);
  });

  it("places the diagnostics control inside the existing desktop side panel", () => {
    const text = source(PAGE);
    const panel = text.indexOf('className="conv-lead-panel"');
    const diagnostics = text.indexOf(
      "<ConversationDiagnostics conversationId={conversationId}",
    );

    expect(text).toContain('import { ConversationDiagnostics } from "./ConversationDiagnostics"');
    expect(panel).toBeGreaterThan(-1);
    expect(diagnostics).toBeGreaterThan(panel);
  });
});
