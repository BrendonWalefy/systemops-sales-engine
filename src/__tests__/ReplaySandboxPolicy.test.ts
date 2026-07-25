import { describe, expect, it } from "vitest";
import { assertReplaySandboxEnvironment } from "@/application/replay/replay-sandbox-policy";

const safe = {
  E2E_MODE: "true",
  E2E_REPLAY_MODE: "true",
  NODE_ENV: "test",
  DATABASE_URL: "postgres://user:secret@sandbox-db.example/replay",
  REPLAY_SANDBOX_DATABASE_HOST: "sandbox-db.example",
  REPLAY_PRODUCTION_DATABASE_HOST: "production-db.example",
} as NodeJS.ProcessEnv;

describe("replay sandbox policy", () => {
  it("aceita somente o host isolado declarado", () => {
    expect(assertReplaySandboxEnvironment(safe)).toEqual({
      databaseHost: "sandbox-db.example",
    });
  });

  it("recusa runtime de produção e host divergente", () => {
    expect(() =>
      assertReplaySandboxEnvironment({ ...safe, VERCEL_ENV: "production" }),
    ).toThrow("forbidden");
    expect(() =>
      assertReplaySandboxEnvironment({
        ...safe,
        DATABASE_URL: "postgres://user:secret@other.example/replay",
      }),
    ).toThrow("does not match");
  });

  it("recusa quando sandbox aponta para o mesmo host de produção", () => {
    expect(() =>
      assertReplaySandboxEnvironment({
        ...safe,
        REPLAY_PRODUCTION_DATABASE_HOST: "sandbox-db.example",
      }),
    ).toThrow("must differ");
  });
});
