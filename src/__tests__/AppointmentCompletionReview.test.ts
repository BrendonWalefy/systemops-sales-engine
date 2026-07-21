// Confirmação de atendimento realizado pelo WhatsApp do doutor.
//
// Bloqueio medido em produção (Vitalli, 21/07): 43 consultas `scheduled`, ZERO
// `completed`. A regra de feedback de 24h exige esse status e por isso nunca
// disparou. O lembrete de fim de dia já é entregue há dias — só que ele lista os
// pendentes e manda abrir o painel, e confirmar exige sair do WhatsApp.
//
// Ver docs/product/plano-correcao-conversacional.md item #20, bloqueio 2.

import { describe, expect, it } from "vitest";
import {
  buildAppointmentCompletionButtons,
  buildAppointmentCompletionInvalidReplyMessage,
  buildNoShowFollowUpButtons,
  buildNoShowFollowUpMessage,
  buildPendingConfirmationMessage,
  buildTomorrowAgendaMessage,
  isMalformedAppointmentCompletionReply,
  parseAppointmentCompletionReply,
  parseNoShowFollowUpReply,
  toTimeCode,
} from "@/application/conversations/appointment-completion-review";

const PENDENTES = [
  { id: "a1", time: "08:30", leadName: "Angelucia" },
  { id: "a2", time: "11:30", leadName: "Laís" },
];
const AMANHA = [
  { time: "09:00", leadName: "Mercia Araújo" },
  { time: "16:00", leadName: "Amanda Mazzini" },
];

describe("parseAppointmentCompletionReply", () => {
  it("aceita o toque no botão de todos realizados", () => {
    expect(parseAppointmentCompletionReply("appointment-done:all")).toEqual({ kind: "all" });
  });

  it("aceita o código do horário, com e sem espaço ou dois-pontos", () => {
    for (const texto of ["C0830", "c0830", "c 0830", "C08:30", "c 08:30"]) {
      expect(parseAppointmentCompletionReply(texto)).toEqual({
        kind: "single",
        timeCode: "0830",
        action: "completed",
      });
    }
  });

  it("opção 2 marca falta", () => {
    expect(parseAppointmentCompletionReply("C0830 2")).toEqual({
      kind: "single",
      timeCode: "0830",
      action: "no_show",
    });
  });

  it("opção 1 é explícita mas equivale a realizado", () => {
    expect(parseAppointmentCompletionReply("C1130 1")).toEqual({
      kind: "single",
      timeCode: "1130",
      action: "completed",
    });
  });

  it("normaliza o horário para quatro dígitos", () => {
    expect(parseAppointmentCompletionReply("C900")).toEqual({
      kind: "single",
      timeCode: "0900",
      action: "completed",
    });
  });

  it("rejeita horário impossível", () => {
    expect(parseAppointmentCompletionReply("C2599")).toBeNull();
    expect(parseAppointmentCompletionReply("C0870")).toBeNull();
  });

  it("não captura texto que não é comando", () => {
    for (const texto of ["confirmado", "0830", "chegou", "casa 0830", "C0830 3"]) {
      expect(parseAppointmentCompletionReply(texto)).toBeNull();
    }
  });

  it("reconhece comando pela metade para responder com ajuda", () => {
    expect(isMalformedAppointmentCompletionReply("C")).toBe(true);
    expect(isMalformedAppointmentCompletionReply("C08")).toBe(true);
    expect(isMalformedAppointmentCompletionReply("chegou")).toBe(false);
    expect(buildAppointmentCompletionInvalidReplyMessage()).toContain("*C0830*");
  });
});

describe("o código vem do horário, não da posição", () => {
  it("confirmar a primeira consulta não muda o código da segunda", () => {
    // Com índice sequencial, confirmar C1 faria a Laís virar C1 — e a próxima
    // confirmação marcaria a paciente errada.
    const antes = buildAppointmentCompletionButtons(PENDENTES);
    const depois = buildAppointmentCompletionButtons(PENDENTES.slice(1));
    expect(antes.map((b) => b.id)).toContain("appointment-miss:1130");
    expect(depois.map((b) => b.id)).toContain("appointment-miss:1130");
  });

  it("toTimeCode remove a pontuação que o doutor não digita", () => {
    expect(toTimeCode("08:30")).toBe("0830");
  });
});

describe("botões da confirmação", () => {
  it("o nome marca a EXCEÇÃO, não a regra — e o rótulo diz o que acontece", () => {
    const botoes = buildAppointmentCompletionButtons(PENDENTES);
    expect(botoes[0]).toEqual({ id: "appointment-done:all", label: "✅ Todos compareceram" });
    expect(botoes[1]).toEqual({ id: "appointment-miss:0830", label: "❌ 08:30 Angelucia" });
    // "08:30 Angelucia" sozinho não dizia se confirmava, abria ou cancelava.
    expect(botoes[1].label.startsWith("❌")).toBe(true);
  });

  it("todo id de botão volta parseável", () => {
    for (const botao of buildAppointmentCompletionButtons(PENDENTES)) {
      expect(parseAppointmentCompletionReply(botao.id)).not.toBeNull();
    }
  });

  it("acima de 4 pacientes, corta os nomes mas mantém o toque único", () => {
    const muitos = ["08:30", "09:30", "10:30", "11:30", "14:00", "16:00"].map((time, i) => ({
      id: String(i), time, leadName: `P${i}`,
    }));
    const botoes = buildAppointmentCompletionButtons(muitos);
    expect(botoes).toHaveLength(5); // "todos" + 4 nomes
    expect(botoes[0].label).toContain("Todos compareceram");
  });
});

describe("buildTomorrowAgendaMessage", () => {
  it("é informação pura, sem cobrar ação", () => {
    const msg = buildTomorrowAgendaMessage({ clinicName: "Clínica Vitalli", tomorrow: AMANHA });
    expect(msg).toContain("📅 *Amanhã · Clínica Vitalli* — 2 atendimentos");
    expect(msg).toContain("• 09:00 Mercia Araújo");
    expect(msg).not.toContain("Faltou");
    expect(msg).not.toContain("Confirmar");
  });

  it("sem agenda, não vira mensagem", () => {
    expect(buildTomorrowAgendaMessage({ clinicName: "X", tomorrow: [] })).toBeNull();
  });

  it("singular quando é só um", () => {
    expect(buildTomorrowAgendaMessage({ clinicName: "X", tomorrow: [AMANHA[0]] })).toContain("1 atendimento");
  });
});

describe("buildPendingConfirmationMessage", () => {
  it("lista os pendentes e instrui pelo botão", () => {
    const msg = buildPendingConfirmationMessage({ pending: PENDENTES });
    expect(msg).toContain("⏳ *Confirmar atendimentos de hoje* — 2 pendentes");
    expect(msg).toContain("• 08:30 Angelucia");
    expect(msg).toContain("Alguém faltou? Toque no nome.");
    // Cabendo em botão, não polui com código.
    expect(msg).not.toContain("*C0830*");
  });

  it("quem não cabe em botão ganha código no texto", () => {
    const muitos = ["08:30", "09:30", "10:30", "11:30", "14:00"].map((time, i) => ({
      id: String(i), time, leadName: `P${i}`,
    }));
    const msg = buildPendingConfirmationMessage({ pending: muitos });
    expect(msg).toContain("• 14:00 P4 — *C1400*"); // 5º, fora dos botões
    expect(msg).not.toContain("• 08:30 P0 — *C0830*"); // 1º, tem botão
    expect(msg).toContain("responda o código, ex: *C1400*");
  });

  it("sem pendências, não vira mensagem", () => {
    expect(buildPendingConfirmationMessage({ pending: [] })).toBeNull();
  });
});

describe("falta vira recuperação, não fim de linha", () => {
  it("oferece chamar o paciente para remarcar", () => {
    expect(buildNoShowFollowUpMessage("Angelucia")).toContain("Quer que eu chame para remarcar?");
  });

  it("os dois botões voltam parseáveis", () => {
    const [sim, nao] = buildNoShowFollowUpButtons("0830");
    expect(parseNoShowFollowUpReply(sim.id)).toEqual({ timeCode: "0830", recover: true });
    expect(parseNoShowFollowUpReply(nao.id)).toEqual({ timeCode: "0830", recover: false });
  });

  it("texto solto não é confundido com a resposta de recuperação", () => {
    expect(parseNoShowFollowUpReply("sim")).toBeNull();
  });
});
