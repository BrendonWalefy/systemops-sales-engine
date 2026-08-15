import { describe, expect, it } from "vitest";
import { buildAuthorizedResponsePlan } from "@/core/conversation/response-plan-builder";
import { validateComposedResponse } from "@/core/conversation/response-validator";
import type { AuthorizedResponsePlan, AuthorizedService } from "@/core/conversation/response-plan";
import type { ComposedResponse } from "@/core/intelligence/ResponseComposer";

// O catálogo da clínica é fato do sistema. Até aqui, "use apenas os nomes exatos
// dos procedimentos" era instrução de prompt — pedido, não garantia. As invenções
// abaixo são reais: o próprio prompt da campanha de recuperação lista
// "lentes de contato dental" e "facetas de contato" como o que o modelo inventava.
const SERVICES: AuthorizedService[] = [
  { name: "Lentes de resina", aliases: ["lente de resina"], priceCents: 200_000 },
  { name: "Clareamento", aliases: [], priceCents: 80_000 },
  { name: "Manutenção", aliases: [], priceCents: null },
];

function planFor(
  services: readonly AuthorizedService[],
  strictServiceVocabulary = true,
): AuthorizedResponsePlan {
  return buildAuthorizedResponsePlan({
    strictServiceVocabulary,
    actionResult: { type: "price_inquiry", referencedPriceCents: 200_000 },
    commercialPolicy: "Clareamento por R$ 800,00.",
    installmentTable: null,
    allowedMediaIds: [],
    expectedState: null,
    maxCharacters: 900,
    authorizedServices: services,
  });
}

function check(text: string, plan = planFor(SERVICES)) {
  const response = {
    text,
    parts: [{ type: "text", content: text }],
  } as Pick<ComposedResponse, "text" | "parts">;
  return validateComposedResponse({ plan, response });
}

describe("plano carrega a identidade dos serviços autorizados", () => {
  it("leva nome, aliases e preço de cada serviço", () => {
    const plan = planFor(SERVICES);

    expect(plan.allowedServices).toEqual([
      { name: "Clareamento", aliases: [], priceCents: 80_000 },
      { name: "Lentes de resina", aliases: ["lente de resina"], priceCents: 200_000 },
      { name: "Manutenção", aliases: [], priceCents: null },
    ]);
  });

  it("plano sem serviços autorizados deixa a checagem inerte", () => {
    // Todo caminho que ainda não declara catálogo continua exatamente como era.
    const plan = planFor([]);
    expect(plan.allowedServices).toEqual([]);
    expect(check("Fazemos harmonização facial e botox.", plan).ok).toBe(true);
  });
});

describe("serviço inventado não chega ao lead", () => {
  it("aceita o serviço autorizado escrito pelo nome do catálogo", () => {
    expect(check("As lentes de resina são a nossa indicação para o seu caso.").ok).toBe(true);
  });

  it("aceita alias cadastrado e variação de caixa/acento", () => {
    expect(check("A lente de resina fica pronta rápido.").ok).toBe(true);
    expect(check("LENTES DE RESINA são a indicação.").ok).toBe(true);
    expect(check("A manutencao é simples.").ok).toBe(true);
  });

  it("recusa variante inventada em cima do vocabulário do catálogo", () => {
    const result = check("Trabalhamos com lentes de contato dental de alta qualidade.");

    expect(result.ok).toBe(false);
    expect(result.violations).toContain("unauthorized_service");
  });

  it("recusa facetas quando a clínica só tem lentes cadastradas", () => {
    const result = check("Fazemos facetas de resina também.");

    expect(result.ok).toBe(false);
    expect(result.violations).toContain("unauthorized_service");
  });
});

describe("preço não se transplanta entre serviços", () => {
  it("aceita o preço junto do serviço a que ele pertence", () => {
    expect(check("As lentes de resina saem por R$ 2.000,00.").ok).toBe(true);
    expect(check("O clareamento sai por R$ 800,00.").ok).toBe(true);
  });

  it("recusa o preço de um serviço colado em outro", () => {
    // R$ 2.000 é o preço das lentes, não do clareamento. O número está na
    // allowlist de preços, então a checagem antiga deixava passar calado.
    const result = check("O clareamento sai por R$ 2.000,00.");

    expect(result.ok).toBe(false);
    expect(result.violations).toContain("service_price_mismatch");
  });

  it("recusa preço autorizado colado em serviço que não tem preço", () => {
    const result = check("A manutenção sai por R$ 800,00.");

    expect(result.ok).toBe(false);
    expect(result.violations).toContain("service_price_mismatch");
  });

  it("não acusa quando o texto cita os dois serviços com os preços certos", () => {
    expect(
      check("As lentes de resina saem por R$ 2.000,00 e o clareamento por R$ 800,00.").ok,
    ).toBe(true);
  });
});

describe("vocabulário fechado é opt-in", () => {
  it("desligado por padrão, para conversa aberta não regredir", () => {
    // Na conversa livre o composer discute procedimentos em prosa, e um falso
    // positivo custaria uma resposta boa a um lead real. Ligar lá depende de
    // medir falso positivo contra o corpus — decisão do Ciclo C.
    const plan = buildAuthorizedResponsePlan({
      actionResult: { type: "general_question", clinicContext: "x" },
      commercialPolicy: null,
      installmentTable: null,
      allowedMediaIds: [],
      expectedState: null,
      maxCharacters: 600,
      authorizedServices: SERVICES,
    });

    expect(plan.strictServiceVocabulary).toBe(false);
    expect(check("Trabalhamos com lentes de contato dental.", plan).ok).toBe(true);
  });

  it("a troca de preço entre serviços é acusada mesmo com vocabulário aberto", () => {
    // `service_price_mismatch` não depende do modo estrito: exige preço citado e
    // dono ausente, então vale em todo caminho que declare catálogo.
    const openPlan = planFor(SERVICES, false);

    expect(check("O clareamento sai por R$ 2.000,00.", openPlan).violations).toContain(
      "service_price_mismatch",
    );
  });
});

describe("limite conhecido, registrado como teste", () => {
  it("serviço inventado sem nenhuma palavra do catálogo não é detectado", () => {
    // A checagem é ancorada no vocabulário do catálogo autorizado, de propósito:
    // detectar um substantivo de serviço arbitrário exigiria conhecer o universo
    // de nomes de procedimento, que é dado de domínio que não temos. Registrado
    // aqui para o limite ser visível na suíte, não só na documentação.
    expect(check("Também fazemos harmonização facial.").ok).toBe(true);
  });
});
