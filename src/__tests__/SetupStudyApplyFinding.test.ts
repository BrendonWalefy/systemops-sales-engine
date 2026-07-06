/**
 * Testes do builder puro de aplicação de findings (ADR-002 Fase 3).
 * Cobre allowlist por categoria, casts estritos e o fallback para notes.
 */

import { describe, expect, it } from "vitest";
import {
  resolveFindingApplication,
  parseTarget,
  allFindingsAnswered,
  hasAppliableFindings,
} from "@/application/setup-study/apply-finding";
import type { SetupFinding } from "@/domain/entities/setup-study";

const TREATMENT_ID = "11111111-1111-1111-1111-111111111111";

function finding(partial: Partial<SetupFinding>): SetupFinding {
  return {
    id: "f1",
    category: "price",
    claim: "Preço da avaliação diverge",
    evidence: "CLINICA: custa R$150",
    severity: 2,
    proposedChange: null,
    ...partial,
  };
}

describe("parseTarget", () => {
  it("parseia target de tratamento", () => {
    expect(parseTarget(`treatment:${TREATMENT_ID}.priceCents`)).toEqual({
      scope: "treatment",
      treatmentId: TREATMENT_ID,
      field: "priceCents",
    });
  });

  it("parseia target de playbook", () => {
    expect(parseTarget("playbook.toneOfVoice")).toEqual({ scope: "playbook", field: "toneOfVoice" });
  });

  it("retorna null para target inválido", () => {
    expect(parseTarget("org.foo")).toBeNull();
  });
});

describe("resolveFindingApplication", () => {
  it("sem resposta → noop", () => {
    expect(resolveFindingApplication(finding({})).kind).toBe("noop");
  });

  it("confirmado informativo (sem proposta) → noop", () => {
    const plan = resolveFindingApplication(finding({ answer: { status: "confirmed", answeredAt: "x" } }));
    expect(plan.kind).toBe("noop");
  });

  it("confirmado com preço válido → treatment.setPrice em centavos", () => {
    const plan = resolveFindingApplication(
      finding({
        answer: { status: "confirmed", answeredAt: "x" },
        proposedChange: { target: `treatment:${TREATMENT_ID}.priceCents`, newValue: "15000", currentValue: "" },
      }),
    );
    expect(plan).toMatchObject({ kind: "treatment.setPrice", treatmentId: TREATMENT_ID, cents: 15000 });
  });

  it("confirmado com preço não-numérico → cai em notes (nunca inventa parse)", () => {
    const plan = resolveFindingApplication(
      finding({
        answer: { status: "confirmed", answeredAt: "x" },
        proposedChange: { target: `treatment:${TREATMENT_ID}.priceCents`, newValue: "R$ 150", currentValue: "" },
      }),
    );
    expect(plan.kind).toBe("playbook.appendNote");
  });

  it("confirmado com booleano → treatment.setBool", () => {
    const plan = resolveFindingApplication(
      finding({
        answer: { status: "confirmed", answeredAt: "x" },
        proposedChange: { target: `treatment:${TREATMENT_ID}.priceQuotableInChat`, newValue: "true", currentValue: "" },
      }),
    );
    expect(plan).toMatchObject({ kind: "treatment.setBool", column: "priceQuotableInChat", value: true });
  });

  it("confirmado com aliases → append de lista única", () => {
    const plan = resolveFindingApplication(
      finding({
        answer: { status: "confirmed", answeredAt: "x" },
        proposedChange: { target: `treatment:${TREATMENT_ID}.aliases`, newValue: "botox, toxina, toxina", currentValue: "" },
      }),
    );
    expect(plan).toMatchObject({ kind: "treatment.appendAliases", aliases: ["botox", "toxina"] });
  });

  it("confirmado com tom de voz → playbook.setText", () => {
    const plan = resolveFindingApplication(
      finding({
        answer: { status: "confirmed", answeredAt: "x" },
        proposedChange: { target: "playbook.toneOfVoice", newValue: "mais formal", currentValue: "casual" },
      }),
    );
    expect(plan).toMatchObject({ kind: "playbook.setText", column: "toneOfVoice", value: "mais formal" });
  });

  it("confirmado com objeção → playbook.appendObjection", () => {
    const plan = resolveFindingApplication(
      finding({
        claim: "Cliente reclama que é caro",
        answer: { status: "confirmed", answeredAt: "x" },
        proposedChange: { target: "playbook.objections[]", newValue: "Oferecer parcelamento", currentValue: "" },
      }),
    );
    expect(plan).toMatchObject({ kind: "playbook.appendObjection", response: "Oferecer parcelamento" });
  });

  it("corrigido em campo de texto → aplica a correção direto no campo", () => {
    const plan = resolveFindingApplication(
      finding({
        answer: { status: "corrected", correction: "Somos bem informais", answeredAt: "x" },
        proposedChange: { target: "playbook.toneOfVoice", newValue: "formal", currentValue: "casual" },
      }),
    );
    expect(plan).toMatchObject({ kind: "playbook.setText", column: "toneOfVoice", value: "Somos bem informais" });
  });

  it("corrigido em campo estruturado (preço) → cai em notes", () => {
    const plan = resolveFindingApplication(
      finding({
        answer: { status: "corrected", correction: "Na verdade custa 200", answeredAt: "x" },
        proposedChange: { target: `treatment:${TREATMENT_ID}.priceCents`, newValue: "15000", currentValue: "" },
      }),
    );
    expect(plan.kind).toBe("playbook.appendNote");
  });

  it("corrigido sem texto → noop", () => {
    const plan = resolveFindingApplication(
      finding({ answer: { status: "corrected", correction: "  ", answeredAt: "x" } }),
    );
    expect(plan.kind).toBe("noop");
  });
});

describe("allFindingsAnswered", () => {
  it("falso para lista vazia", () => {
    expect(allFindingsAnswered([])).toBe(false);
  });

  it("falso se algum item sem resposta", () => {
    const list = [
      finding({ id: "a", answer: { status: "confirmed", answeredAt: "x" } }),
      finding({ id: "b" }),
    ];
    expect(allFindingsAnswered(list)).toBe(false);
  });

  it("verdadeiro quando todos respondidos", () => {
    const list = [
      finding({ id: "a", answer: { status: "confirmed", answeredAt: "x" } }),
      finding({ id: "b", answer: { status: "corrected", correction: "ok", answeredAt: "x" } }),
    ];
    expect(allFindingsAnswered(list)).toBe(true);
  });
});

describe("hasAppliableFindings", () => {
  const appliable = finding({
    id: "a",
    answer: { status: "confirmed", answeredAt: "x" },
    proposedChange: { target: `treatment:${TREATMENT_ID}.priceCents`, newValue: "15000", currentValue: "" },
  });

  it("verdadeiro quando há finding respondido não aplicado com escrita", () => {
    expect(hasAppliableFindings([appliable])).toBe(true);
  });

  it("falso quando o único aplicável já foi aplicado", () => {
    expect(hasAppliableFindings([{ ...appliable, applied: { at: "x", summary: "s" } }])).toBe(false);
  });

  it("falso quando só restam informativos confirmados (noop)", () => {
    const info = finding({ id: "i", answer: { status: "confirmed", answeredAt: "x" }, proposedChange: null });
    expect(hasAppliableFindings([info])).toBe(false);
  });
});
