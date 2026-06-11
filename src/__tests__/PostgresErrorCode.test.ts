import { describe, expect, it } from "vitest";
import { isPostgresErrorCode } from "@/infrastructure/db/is-postgres-error-code";

describe("isPostgresErrorCode", () => {
  it("detecta code no erro raiz", () => {
    expect(isPostgresErrorCode({ code: "23503" }, "23503")).toBe(true);
  });

  it("detecta code no cause embrulhado pelo driver", () => {
    const error = new Error("Failed query");
    (error as Error & { cause?: unknown }).cause = { code: "23503" };

    expect(isPostgresErrorCode(error, "23503")).toBe(true);
  });

  it("retorna false quando o code nao existe na cadeia", () => {
    const error = new Error("Failed query");
    (error as Error & { cause?: unknown }).cause = { code: "99999" };

    expect(isPostgresErrorCode(error, "23503")).toBe(false);
  });
});
