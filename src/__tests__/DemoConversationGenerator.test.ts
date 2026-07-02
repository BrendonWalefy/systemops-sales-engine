import { beforeAll, describe, expect, it } from "vitest";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import {
  generateDemoThread,
  type DemoClinicContext,
} from "@/application/demo/generate-demo-conversation";
import { DEMO_CONVERSATIONS } from "@/application/demo/demo-conversation-scripts";

// Força o modo mock (sem OpenAI) — testa a ESTRUTURA/fluxo da geração, não o texto do LLM.
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
  it("classifica cada mensagem do lead e responde no fluxo (preço → horários → confirma)", async () => {
    const msgs = await generateDemoThread(ctx, [
      { lead: "Oi! Quanto ficam as lentes?" },
      { lead: "Achei um pouco caro…" },
      { lead: "Quero marcar a avaliação, quais horários vocês têm?" },
      { lead: "Quero o primeiro horário" },
    ]);

    expect(msgs).toHaveLength(8);
    expect(msgs.filter((m) => m.author === "lead")).toHaveLength(4);
    expect(msgs.filter((m) => m.author === "agent")).toHaveLength(4);
    expect(msgs.filter((m) => m.author === "agent").every((m) => m.body.trim().length > 0)).toBe(true);
    // A oferta de horários apareceu após "quais horários"
    expect(msgs[5].body.toLowerCase()).toMatch(/hor[áa]rio/);
    // A última é a confirmação do agendamento
    expect(msgs.at(-1)?.body.toLowerCase()).toContain("confirmad");
    expect(msgs.at(-1)?.intent).toBe("confirmation");
  });

  it("turno proativo (reengajamento) não cria mensagem de lead vazia", async () => {
    const msgs = await generateDemoThread(ctx, [
      { lead: "Oi, quero saber do clareamento" },
      { lead: "" }, // proativo: reengajamento da IA
    ]);
    expect(msgs.some((m) => m.author === "lead" && m.body.trim() === "")).toBe(false);
    expect(msgs.filter((m) => m.author === "agent")).toHaveLength(2);
    expect(msgs.at(-1)?.intent).toBe("follow_up");
  });

  it("propaga flags de voz e mídia para a resposta do agente", async () => {
    const msgs = await generateDemoThread(ctx, [
      { lead: "Oi! Como funcionam as lentes?", voice: true },
      { lead: "Dá pra ver o resultado?", media: "video" },
    ]);
    const agents = msgs.filter((m) => m.author === "agent");
    expect(agents[0].voice).toBe(true);
    expect(agents[1].media).toBe("video");
  });
});

describe("DEMO_CONVERSATIONS", () => {
  it("tem ~30+ conversas ricas, coerentes e ordenadas ricas-primeiro", () => {
    expect(DEMO_CONVERSATIONS.length).toBeGreaterThanOrEqual(30);
    const keys = new Set(DEMO_CONVERSATIONS.map((c) => c.key));
    expect(keys.size).toBe(DEMO_CONVERSATIONS.length);
    expect(DEMO_CONVERSATIONS.every((c) => c.turns.length >= 2 && c.leadName.trim().length > 0)).toBe(true);
    // As primeiras conversas do inbox (daysAgo pequeno) devem ser as mais completas.
    const firstFive = DEMO_CONVERSATIONS.slice(0, 5);
    expect(firstFive.every((c) => c.turns.length >= 4)).toBe(true);
    expect(DEMO_CONVERSATIONS.filter((c) => c.booked).length).toBeGreaterThan(8);
  });

  it("gera threads coerentes para todos os roteiros (mock)", async () => {
    for (const conv of DEMO_CONVERSATIONS) {
      const msgs = await generateDemoThread(ctx, conv.turns);
      const agents = msgs.filter((m) => m.author === "agent");
      expect(agents.length).toBeGreaterThanOrEqual(1);
      expect(agents.every((m) => m.body.trim().length > 0)).toBe(true);
    }
  });
});
