// Janela de reinício da conversa.
//
// O lead que volta depois de um gap longo recebe a saudação de abertura em vez de
// continuidade. O limite vinha de `staleConversationHours`, que também é o TTL do
// pipeline de tratamento — acoplamento que fazia a janela herdar 4h (Vitalli) /
// 6h (Ximendes).
//
// Medição em produção (n=3.183 gaps entre mensagens consecutivas do mesmo lead):
// mediana 0h, p75 1,1h, p90 17h. Com 4h, 17,2% das respostas de lead disparavam
// "conversa nova"; com 24h, 5,9%.
// Ver docs/architecture/current.md.

import { describe, expect, it } from "vitest";
import {
  shouldRestartConversation,
  DEFAULT_CONVERSATION_RESTART_HOURS,
} from "@/core/pipeline/ConversationOrchestrator";

const now = new Date("2026-07-21T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);

describe("shouldRestartConversation", () => {
  it("não reinicia sem mensagem anterior do lead", () => {
    expect(shouldRestartConversation({ leadMessages: [], now })).toBe(false);
    expect(shouldRestartConversation({ leadMessages: [{ sentAt: hoursAgo(100) }], now })).toBe(false);
  });

  it("lead que volta em 5h NÃO reinicia (regressão do limite antigo de 4h)", () => {
    // Este é o caso que quebrava: com staleConversationHours=4 o lead recebia a
    // saudação de abertura no meio do atendimento.
    const leadMessages = [{ sentAt: hoursAgo(5) }, { sentAt: now }];
    expect(shouldRestartConversation({ leadMessages, now })).toBe(false);
  });

  it("lead que volta em 17h (p90 real) NÃO reinicia", () => {
    const leadMessages = [{ sentAt: hoursAgo(17) }, { sentAt: now }];
    expect(shouldRestartConversation({ leadMessages, now })).toBe(false);
  });

  it("lead que volta em 25h reinicia", () => {
    const leadMessages = [{ sentAt: hoursAgo(25) }, { sentAt: now }];
    expect(shouldRestartConversation({ leadMessages, now })).toBe(true);
  });

  it("é inclusivo no limite exato", () => {
    const leadMessages = [{ sentAt: hoursAgo(24) }, { sentAt: now }];
    expect(shouldRestartConversation({ leadMessages, now })).toBe(true);
  });

  it("respeita o limite configurado pela clínica", () => {
    const leadMessages = [{ sentAt: hoursAgo(10) }, { sentAt: now }];
    expect(shouldRestartConversation({ leadMessages, now, restartHours: 8 })).toBe(true);
    expect(shouldRestartConversation({ leadMessages, now, restartHours: 48 })).toBe(false);
  });

  it("cai no default de 24h quando a clínica não define", () => {
    expect(DEFAULT_CONVERSATION_RESTART_HOURS).toBe(24);
    const leadMessages = [{ sentAt: hoursAgo(23) }, { sentAt: now }];
    expect(shouldRestartConversation({ leadMessages, now, restartHours: null })).toBe(false);
    expect(shouldRestartConversation({ leadMessages, now, restartHours: undefined })).toBe(false);
  });

  it("mede o gap contra a PENÚLTIMA mensagem, não a mais antiga", () => {
    // Conversa longa e ativa: a primeira mensagem é de dias atrás, mas o lead
    // respondeu há 1h. Não pode reiniciar.
    const leadMessages = [{ sentAt: hoursAgo(72) }, { sentAt: hoursAgo(1) }, { sentAt: now }];
    expect(shouldRestartConversation({ leadMessages, now })).toBe(false);
  });
});
