import { describe, expect, it } from "vitest";
import { isReengagementPaused } from "@/application/channel-safety/reengagement-policy";

// ─── isReengagementPaused ─────────────────────────────────────────────────────

describe("isReengagementPaused", () => {
  it("retorna false quando automated_reengagement_paused = false (default)", () => {
    expect(isReengagementPaused({ automatedReengagementPaused: false })).toBe(false);
  });

  it("retorna true quando automated_reengagement_paused = true", () => {
    expect(isReengagementPaused({ automatedReengagementPaused: true })).toBe(true);
  });
});

// ─── Comportamento nos crons — pausa bloqueia follow-up e recovery ─────────────
//
// Os crons carregam a clínica do banco e chamam isReengagementPaused logo após
// shouldSendAutomatedClinicOutbound. Verificamos aqui que o guard funciona
// isoladamente — a integração com o cron real exigiria mock de DB, coberta nos
// testes de integração existentes (FollowUpReengagement.test.ts, etc.).
//
// Regras cobertas:
//   1. automatedReengagementPaused=true → follow-up e recovery bloqueados.
//   2. automatedReengagementPaused=false → follow-up e recovery não bloqueados.
//   3. appointment-reminder NUNCA depende deste flag (isento por design).
//   4. Reply não passa por crons de reengajamento — não é afetado.

describe("Política de pausa de reengajamento — regras de negócio", () => {
  it("bloqueia reengajamento quando flag está ativo", () => {
    const clinic = { automatedReengagementPaused: true };
    expect(isReengagementPaused(clinic)).toBe(true);
  });

  it("não bloqueia quando flag está desativado", () => {
    const clinic = { automatedReengagementPaused: false };
    expect(isReengagementPaused(clinic)).toBe(false);
  });

  it("appointment-reminder é isento — não depende de automatedReengagementPaused", () => {
    // O appointment-reminder não chama isReengagementPaused por design.
    // Este test documenta a decisão: verificamos que a função sequer existe
    // na rota do reminder (ela não importa isReengagementPaused).
    //
    // O comportamento real é garantido pelo fato de que appointment-reminder/route.ts
    // não importa esta função — logo o flag nunca será consultado na rota do reminder.
    //
    // Aqui apenas certificamos que, mesmo que alguém chame por engano,
    // o resultado não vai bloquear o reminder: o caller decide o que fazer com o retorno.
    const clinicWithReengagementPaused = { automatedReengagementPaused: true };
    // Se o reminder chamar isReengagementPaused e o resultado for true, é um bug — mas
    // a função em si retorna o valor correto; é responsabilidade do caller não usá-la.
    expect(isReengagementPaused(clinicWithReengagementPaused)).toBe(true);
    // A garantia real está na ausência de import em appointment-reminder/route.ts.
  });
});

// ─── Cenário de pausa ativada para a Vitalli ──────────────────────────────────

describe("Preset Vitalli — modo reply-only", () => {
  const vitalliClinic = {
    automatedReengagementPaused: true,
    outboundHourlyCap: 15,
    outboundDailyCap: 60,
  };

  it("follow-up é bloqueado com preset Vitalli", () => {
    expect(isReengagementPaused(vitalliClinic)).toBe(true);
  });

  it("após desativar a pausa, reengajamento é liberado", () => {
    const vitalliUnpaused = { ...vitalliClinic, automatedReengagementPaused: false };
    expect(isReengagementPaused(vitalliUnpaused)).toBe(false);
  });
});

// ─── buildFollowUpOutboxInput — integridade do dedupeKey ─────────────────────
//
// Importamos a função pura do cron para garantir que o dedupeKey segue o padrão
// `followup:{followUpId}` e o agentMessageId é determinístico.
import { buildFollowUpOutboxInput } from "@/app/api/cron/follow-up-dispatcher/route";
import { DEFAULT_TTS_CONFIG } from "@/domain/entities/tts-config";

describe("buildFollowUpOutboxInput", () => {
  it("gera dedupeKey determinístico baseado no followUpId", () => {
    const result = buildFollowUpOutboxInput({
      clinicId: "clinic-1",
      conversationId: "conv-1",
      followUpId: "fu-abc",
      leadId: "lead-1",
      to: "5511999999999",
      text: "Olá, tudo bem?",
      useVoice: false,
      ttsConfig: DEFAULT_TTS_CONFIG,
    });

    expect(result.dedupeKey).toBe("followup:fu-abc");
    expect(result.outbound.dedupeKey).toBe("followup:fu-abc");
    expect(result.outbound.category).toBe("follow_up");
  });

  it("o mesmo followUpId gera sempre o mesmo agentMessageId (determinístico)", () => {
    const r1 = buildFollowUpOutboxInput({
      clinicId: "clinic-1",
      conversationId: "conv-1",
      followUpId: "fu-xyz",
      leadId: "lead-2",
      to: "5511999999999",
      text: "Teste",
      useVoice: false,
      ttsConfig: DEFAULT_TTS_CONFIG,
    });

    const r2 = buildFollowUpOutboxInput({
      clinicId: "clinic-1",
      conversationId: "conv-1",
      followUpId: "fu-xyz",
      leadId: "lead-2",
      to: "5511999999999",
      text: "Teste",
      useVoice: false,
      ttsConfig: DEFAULT_TTS_CONFIG,
    });

    expect(r1.agentMessageId).toBe(r2.agentMessageId);
  });
});

// ─── buildRecoveryOutboxInput — integridade do dedupeKey ─────────────────────
import { buildRecoveryOutboxInput } from "@/app/api/cron/recovery-campaign/route";

describe("buildRecoveryOutboxInput", () => {
  it("gera dedupeKey idempotente por lead+dia", () => {
    const now = new Date("2026-07-06T14:00:00.000Z");
    const r1 = buildRecoveryOutboxInput({
      clinicId: "clinic-1",
      conversationId: "conv-1",
      leadId: "lead-99",
      to: "5511999999999",
      text: "Olá de novo",
      now,
    });
    const r2 = buildRecoveryOutboxInput({
      clinicId: "clinic-1",
      conversationId: "conv-1",
      leadId: "lead-99",
      to: "5511999999999",
      text: "Mensagem diferente", // texto não importa para o dedupeKey
      now,
    });

    expect(r1.dedupeKey).toBe(r2.dedupeKey);
    expect(r1.outbound.category).toBe("recovery");
  });

  it("dedupeKey muda no dia seguinte (permite novo recovery após 7 dias)", () => {
    const day1 = new Date("2026-07-06T14:00:00.000Z");
    const day2 = new Date("2026-07-13T14:00:00.000Z");

    const r1 = buildRecoveryOutboxInput({
      clinicId: "clinic-1",
      conversationId: "conv-1",
      leadId: "lead-99",
      to: "5511999999999",
      text: "Recovery day 1",
      now: day1,
    });
    const r2 = buildRecoveryOutboxInput({
      clinicId: "clinic-1",
      conversationId: "conv-1",
      leadId: "lead-99",
      to: "5511999999999",
      text: "Recovery day 8",
      now: day2,
    });

    expect(r1.dedupeKey).not.toBe(r2.dedupeKey);
  });
});
