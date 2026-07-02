import { beforeAll, describe, expect, it } from "vitest";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import {
  generateDemoThread,
  type DemoClinicContext,
} from "@/application/demo/generate-demo-conversation";
import { DEMO_CONVERSATIONS } from "@/application/demo/demo-conversation-scripts";

// Força o modo mock (sem OpenAI) — testa a ESTRUTURA da geração, não o texto do LLM.
beforeAll(() => {
  process.env.DISABLE_REAL_OPENAI = "true";
});

const ctx: DemoClinicContext = {
  clinicName: "Odonto Marques",
  specialty: "Odontologia estética",
  toneOfVoice: "Consultivo e acolhedor",
  playbook: "Valores sempre 'a partir de', após avaliação.",
  commercialPolicy: "Parcelamos no cartão. Avaliação R$150.",
  receptionistName: "Marina",
  timezone: new ClinicTimezone("America/Sao_Paulo"),
};

describe("generateDemoThread (mock)", () => {
  it("alterna lead → agente e responde a cada mensagem do lead", async () => {
    const msgs = await generateDemoThread(ctx, [
      { lead: "Oi! Quanto ficam as lentes?", action: { kind: "price", treatment: "Lentes de porcelana" } },
      { lead: "Achei caro…", action: { kind: "general" } },
      { lead: "Como marco?", action: { kind: "slots" } },
      { lead: "Quero o primeiro", action: { kind: "confirm", slotIndex: 1 } },
    ]);

    // 4 turnos com mensagem de lead → 8 mensagens (lead + agente por turno)
    expect(msgs).toHaveLength(8);
    expect(msgs.filter((m) => m.author === "lead")).toHaveLength(4);
    expect(msgs.filter((m) => m.author === "agent")).toHaveLength(4);
    // Nenhuma resposta de agente vazia
    expect(msgs.filter((m) => m.author === "agent").every((m) => m.body.trim().length > 0)).toBe(true);
    // A confirmação soa como confirmação
    expect(msgs.at(-1)?.body.toLowerCase()).toContain("confirmad");
    expect(msgs.at(-1)?.intent).toBe("confirmation");
  });

  it("turno iniciado pela IA (reengajamento) não cria mensagem de lead vazia", async () => {
    const msgs = await generateDemoThread(ctx, [
      { lead: "Oi, quero saber do clareamento", action: { kind: "price" } },
      { lead: "", action: { kind: "reengagement", lastAppointmentLabel: "sua avaliação" } },
    ]);
    expect(msgs.some((m) => m.author === "lead" && m.body.trim() === "")).toBe(false);
    expect(msgs.filter((m) => m.author === "agent")).toHaveLength(2);
  });
});

describe("DEMO_CONVERSATIONS", () => {
  it("tem ~35 conversas ricas e coerentes", () => {
    expect(DEMO_CONVERSATIONS.length).toBeGreaterThanOrEqual(30);
    // chaves únicas
    const keys = new Set(DEMO_CONVERSATIONS.map((c) => c.key));
    expect(keys.size).toBe(DEMO_CONVERSATIONS.length);
    // toda conversa tem ao menos um turno e nome de lead
    expect(DEMO_CONVERSATIONS.every((c) => c.turns.length >= 1 && c.leadName.trim().length > 0)).toBe(true);
    // agendados que 'booked' têm desfecho coerente
    const booked = DEMO_CONVERSATIONS.filter((c) => c.booked);
    expect(booked.length).toBeGreaterThan(5);
  });

  it("gera threads coerentes para todos os roteiros (mock)", async () => {
    for (const conv of DEMO_CONVERSATIONS) {
      const msgs = await generateDemoThread(ctx, conv.turns);
      // pelo menos uma resposta de agente, nenhuma vazia
      const agents = msgs.filter((m) => m.author === "agent");
      expect(agents.length).toBeGreaterThanOrEqual(1);
      expect(agents.every((m) => m.body.trim().length > 0)).toBe(true);
    }
  });
});
