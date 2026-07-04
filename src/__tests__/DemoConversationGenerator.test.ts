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

describe("DEMO_CONVERSATIONS (v2 — cenário perfeito)", () => {
  it("tem 10 conversas completas com chaves únicas e desfechos variados", () => {
    expect(DEMO_CONVERSATIONS).toHaveLength(10);
    const keys = new Set(DEMO_CONVERSATIONS.map((c) => c.key));
    expect(keys.size).toBe(DEMO_CONVERSATIONS.length);
    expect(DEMO_CONVERSATIONS.every((c) => c.turns.length >= 3 && c.turns.length <= 10 && c.leadName.trim().length > 0)).toBe(true);

    // Desfechos variados: ganhos com valor fechado, resgate por follow-up,
    // handoff para humano e atendimento fora do horário.
    expect(DEMO_CONVERSATIONS.filter((c) => c.status === "won")).toHaveLength(2);
    expect(DEMO_CONVERSATIONS.filter((c) => c.needsAttention && c.aiPaused)).toHaveLength(1);
    expect(DEMO_CONVERSATIONS.filter((c) => c.afterHours)).toHaveLength(1);
    expect(DEMO_CONVERSATIONS.filter((c) => c.followUp?.status === "done")).toHaveLength(1);
    expect(DEMO_CONVERSATIONS.every((c) => c.booked || c.needsAttention)).toBe(true);

    // Ganhos têm appointment concluído com valor fechado.
    for (const won of DEMO_CONVERSATIONS.filter((c) => c.status === "won")) {
      expect(won.appointment?.status).toBe("completed");
      expect(won.appointment?.valueCents).toBeGreaterThan(0);
    }
  });

  it("demonstra os recursos do produto: áudio B-WAVE, mídia e reengajamento proativo", () => {
    const allTurns = DEMO_CONVERSATIONS.flatMap((c) => c.turns);
    expect(allTurns.filter((t) => t.voice).length).toBeGreaterThanOrEqual(3);
    expect(allTurns.filter((t) => t.media === "video").length).toBeGreaterThanOrEqual(2);
    // Turno proativo (follow-up automático) presente no roteiro de resgate.
    const resgate = DEMO_CONVERSATIONS.find((c) => c.followUp?.status === "done");
    expect(resgate?.turns.some((t) => !t.lead.trim() && (t.agent ?? "").length > 0)).toBe(true);
    // Handoff tem mensagem humana (clinic_user).
    const handoff = DEMO_CONVERSATIONS.find((c) => c.needsAttention);
    expect(handoff?.turns.some((t) => (t.human ?? "").length > 0)).toBe(true);
  });

  it("gera threads coerentes para todos os roteiros (mock)", async () => {
    for (const conv of DEMO_CONVERSATIONS) {
      const msgs = await generateDemoThread(ctx, conv.turns);
      expect(msgs.length).toBeLessThanOrEqual(22);
      const agents = msgs.filter((m) => m.author === "agent");
      expect(agents.length).toBeGreaterThanOrEqual(1);
      expect(agents.every((m) => m.body.trim().length > 0)).toBe(true);
      // Conversas agendadas fecham o ciclo: alguma mensagem confirma o horário.
      if (conv.booked) {
        expect(agents.some((m) => /agendad|confirmad|remarcad/i.test(m.body))).toBe(true);
      }
    }
  });

  it("propaga a mensagem humana do handoff como clinic_user", async () => {
    const handoff = DEMO_CONVERSATIONS.find((c) => c.needsAttention)!;
    const msgs = await generateDemoThread(ctx, handoff.turns);
    const human = msgs.filter((m) => m.author === "clinic_user");
    expect(human.length).toBeGreaterThanOrEqual(1);
    expect(human[0].body.length).toBeGreaterThan(0);
  });
});
