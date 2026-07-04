import { describe, expect, it } from "vitest";
import { buildActionContext } from "@/core/intelligence/ResponseComposer";

describe("ResponseComposer — conversation experience", () => {
  it("price inquiry context no longer forces menu CTA in concierge mode", () => {
    const ctx = buildActionContext({ type: "price_inquiry" }, "concierge");

    expect(ctx).not.toContain("digitar *menu*");
    expect(ctx).not.toContain("digite menu");
    expect(ctx).toContain("conduza ativamente para o próximo passo");
  });

  it("general question context does not reoffer menu for clear questions", () => {
    const ctx = buildActionContext(
      { type: "general_question", clinicContext: "Lead perguntou sobre endereço." },
      "menu_first",
    );

    expect(ctx).not.toContain("digitar *menu*");
    expect(ctx).toContain("Não reapresente menu");
  });

  it("price objection handoff still instructs the composer to sell before escalating", () => {
    const ctx = buildActionContext({
      type: "handoff_requested",
      handoffReason: "Lead achou caro e comparou valor com outra clínica",
    });

    expect(ctx).toContain("Pedido comercial sensível");
    expect(ctx).toContain("NÃO pode ser só");
    expect(ctx).toContain("responda vendendo");
    expect(ctx).toContain("reancore o valor");
    expect(ctx).toContain("degrau de menor compromisso");
  });

  it("generic handoff keeps the short human escalation instruction", () => {
    const ctx = buildActionContext({
      type: "handoff_requested",
      handoffReason: "Lead pediu fotos do procedimento realizado",
    });

    expect(ctx).toContain("Este pedido requer atendimento humano");
    expect(ctx).toContain("a IA não pode cumprir");
    expect(ctx).not.toContain("responda vendendo");
  });
});
