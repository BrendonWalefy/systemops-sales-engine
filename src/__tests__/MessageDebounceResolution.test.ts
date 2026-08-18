// Resolução do debounce por turno.
//
// O valor de plataforma (15s) é decisão medida e continua valendo em produção —
// ver MessageDebounceDefault.test.ts. Este arquivo cobre *quando* ele é
// substituído, e principalmente quando NÃO pode ser: um sandbox rápido não vale
// o risco de produção responder sem agrupar rajada.

import { describe, expect, it } from "vitest";
import { DEFAULT_MESSAGE_DEBOUNCE_MS } from "@/core/pipeline/ConversationOrchestrator";
import { resolveMessageDebounceMs } from "@/core/pipeline/message-debounce";

const producao = { VERCEL_ENV: "production" };
const sandbox = { E2E_REPLAY_MODE: "true" };

describe("resolveMessageDebounceMs", () => {
  it("usa o default de plataforma quando a clínica não configura nada", () => {
    expect(resolveMessageDebounceMs({
      isReplayOfMessage: false,
      clinicDebounceMs: null,
      env: producao,
    })).toBe(DEFAULT_MESSAGE_DEBOUNCE_MS);
  });

  it("respeita o valor por clínica quando existe", () => {
    expect(resolveMessageDebounceMs({
      isReplayOfMessage: false,
      clinicDebounceMs: 7_000,
      env: producao,
    })).toBe(7_000);
  });

  it("aceita zero explícito da clínica, sem cair no default", () => {
    // É o caso da clínica de teste manual do owner: responder na hora.
    expect(resolveMessageDebounceMs({
      isReplayOfMessage: false,
      clinicDebounceMs: 0,
      env: producao,
    })).toBe(0);
  });

  it("zera no sandbox de replay, para o harness não gastar 15s por turno", () => {
    expect(resolveMessageDebounceMs({
      isReplayOfMessage: false,
      clinicDebounceMs: null,
      env: sandbox,
    })).toBe(0);
  });

  it("NÃO zera em produção nem se a flag de replay vazar para o runtime", () => {
    // Guarda a configuração que vai para produção: se as duas condições
    // colidirem, produção vence e a rajada continua sendo agrupada.
    expect(resolveMessageDebounceMs({
      isReplayOfMessage: false,
      clinicDebounceMs: null,
      env: { ...sandbox, VERCEL_ENV: "production" },
    })).toBe(DEFAULT_MESSAGE_DEBOUNCE_MS);
  });

  it("zera ao reprocessar uma mensagem específica, como antes", () => {
    expect(resolveMessageDebounceMs({
      isReplayOfMessage: true,
      clinicDebounceMs: 15_000,
      env: producao,
    })).toBe(0);
  });
});
