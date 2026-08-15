import { describe, expect, it } from "vitest";
import { ConversationResponsePlanner } from "@/core/conversation/ConversationResponsePlanner";
import type { ComposedResponse, ComposerInput } from "@/core/intelligence/ResponseComposer";
import { buildReminderComposerInput, buildReminderPlanInput } from "@/app/api/cron/appointment-reminder/reminder-response";

// Composer que troca o horário do lembrete — exatamente a falha que, até aqui,
// nada interceptava no caminho do cron. O lead confirmaria um horário que não
// existe, e a clínica descobriria pela cadeira vazia.
function composerThatLiesAboutTime(text: string) {
  return {
    async compose(_input: ComposerInput): Promise<ComposedResponse> {
      return { text, parts: [{ type: "text", content: text }] } as ComposedResponse;
    },
  };
}

const clinic = {
  name: "Clínica X",
  plan: "start",
  specialty: "dental",
  toneOfVoice: null,
  playbook: null,
  commercialPolicy: null,
  receptionistName: "Ana",
} as ComposerInput["clinic"];

describe("lembrete de consulta", () => {
  it("cai no fallback determinístico quando o composer troca o horário", async () => {
    const planner = new ConversationResponsePlanner(
      composerThatLiesAboutTime("Passando para lembrar da sua consulta amanhã às 15:00!"),
    );

    const result = await planner.execute({
      composerInput: buildReminderComposerInput({
        appointmentLabel: "quinta-feira, 10/07 às 09:00",
        clinic,
        leadName: "João",
        timezone: "America/Sao_Paulo",
      }),
      planInput: buildReminderPlanInput({ maxCharacters: 400 }),
    });

    expect(result.source).toBe("deterministic_fallback");
    expect(result.violations).toContain("unauthorized_schedule_fact");
    expect(result.response.text).not.toContain("15:00");
    // O fallback continua sendo um lembrete útil, com o horário verdadeiro.
    expect(result.response.text).toContain("09:00");
  });

  it("entrega o texto do composer quando ele respeita o horário autorizado", async () => {
    const planner = new ConversationResponsePlanner(
      composerThatLiesAboutTime(
        "Oi, João! Passando para lembrar da sua consulta quinta-feira, 10/07 às 09:00.",
      ),
    );

    const result = await planner.execute({
      composerInput: buildReminderComposerInput({
        appointmentLabel: "quinta-feira, 10/07 às 09:00",
        clinic,
        leadName: "João",
        timezone: "America/Sao_Paulo",
      }),
      planInput: buildReminderPlanInput({ maxCharacters: 400 }),
    });

    expect(result.source).toBe("composer");
    expect(result.violations).toEqual([]);
    expect(result.response.text).toContain("09:00");
  });

  it("o plano do lembrete autoriza o horário real e nenhum preço", () => {
    // Trava o contrato que o cron passa ao planner: sem essa restrição, um
    // composer inventando valor no lembrete passaria batido.
    const planInput = buildReminderPlanInput({ maxCharacters: 400 });

    expect(planInput.allowedMediaIds).toEqual([]);
    expect(planInput.commercialPolicy).toBeNull();
    expect(planInput.installmentTable).toBeNull();
  });
});
