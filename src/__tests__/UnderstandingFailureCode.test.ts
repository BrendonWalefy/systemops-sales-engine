import { describe, expect, it } from "vitest";
import {
  UNDERSTANDING_FAILURE_CODES,
  classifyUnderstandingFailure,
} from "@/application/conversation-v2/understanding-failure-code";

describe("understanding failure code", () => {
  it("separates the provider rejections that demand different operator action", () => {
    expect(classifyUnderstandingFailure({ status: 401 })).toBe("provider_unauthorized");
    expect(classifyUnderstandingFailure({ status: 403 })).toBe("provider_unauthorized");
    expect(classifyUnderstandingFailure({ status: 429 })).toBe("provider_rate_limited");
    expect(classifyUnderstandingFailure({ status: 400 })).toBe("provider_rejected_request");
    expect(classifyUnderstandingFailure({ status: 500 })).toBe("provider_server_error");
    expect(classifyUnderstandingFailure({ status: 503 })).toBe("provider_server_error");
  });

  it("reports an exhausted quota apart from ordinary rate limiting", () => {
    expect(classifyUnderstandingFailure({ status: 429, code: "insufficient_quota" }))
      .toBe("provider_quota_exhausted");
  });

  it("distinguishes a missing answer from an unusable one", () => {
    expect(classifyUnderstandingFailure(new Error("OpenAI returned no dental understanding output")))
      .toBe("output_missing");
    expect(classifyUnderstandingFailure(new SyntaxError("Unexpected token < in JSON at position 0")))
      .toBe("output_invalid");
  });

  it("marks an aborted turn so a deadline is never read as a provider fault", () => {
    const aborted = Object.assign(new Error("aborted"), { name: "AbortError" });
    expect(classifyUnderstandingFailure(aborted)).toBe("aborted");
  });

  it("falls back to a closed code instead of leaking an unknown shape", () => {
    expect(classifyUnderstandingFailure(new Error("connect ECONNREFUSED 10.0.0.1:443")))
      .toBe("unknown");
    expect(classifyUnderstandingFailure(null)).toBe("unknown");
    expect(classifyUnderstandingFailure("boom")).toBe("unknown");
  });

  it("never emits a code outside the closed vocabulary", () => {
    const samples: unknown[] = [
      { status: 418 }, { status: 429, code: "insufficient_quota" }, new Error("x"),
      new SyntaxError("y"), null, undefined, 42, { message: "senha=123", status: 401 },
    ];
    for (const sample of samples) {
      expect(UNDERSTANDING_FAILURE_CODES).toContain(classifyUnderstandingFailure(sample));
    }
  });

  it("carries no fragment of the original message", () => {
    const secret = "sk-proj-abc123 lead phone 5511999999999";
    const code = classifyUnderstandingFailure(new Error(secret));
    expect(secret).not.toContain(code);
    expect(code).toBe("unknown");
  });
});
