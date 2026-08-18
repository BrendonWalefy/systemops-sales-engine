import { describe, expect, it } from "vitest";
import { buildCandidates } from "../../scripts/export-corpus-candidates";

const base = {
  conversationHash: "0a91bb7c31",
  tenantHash: "7d1f0c2ab9",
  leadName: null,
};

function row(
  overrides: Partial<Parameters<typeof buildCandidates>[0]["rows"][number]> & {
    author: "lead" | "agent" | "clinic_user" | "system";
    sentAt: Date;
  },
) {
  return {
    id: `m-${overrides.sentAt.getTime()}`,
    body: "…",
    mediaType: null,
    intent: null,
    ...overrides,
  };
}

const t0 = new Date("2026-07-18T14:00:00.000Z");
const minutes = (n: number) => new Date(t0.getTime() + n * 60_000);

describe("montagem de candidatos a partir da conversa", () => {
  it("separa o que a IA respondeu do que o humano respondeu no mesmo turno", () => {
    const [candidate] = buildCandidates({
      ...base,
      rows: [
        row({ author: "lead", body: "qual o valor?", sentAt: t0 }),
        row({ author: "agent", body: "Fica R$ 2.000.", sentAt: minutes(1) }),
        row({ author: "clinic_user", body: "Consigo 1.800 hoje.", sentAt: minutes(3) }),
      ],
    });

    expect(candidate?.aiResponse).toBe("Fica R$ 2.000.");
    expect(candidate?.humanResponse).toBe("Consigo 1.800 hoje.");
  });

  // O intent que a V1 resolveu em produção fica gravado na mensagem da IA, não
  // na do lead — 2.488 das 2.600 mensagens de agente têm o campo preenchido e
  // nenhuma das 7.802 do lead tem. Ler do lugar errado joga fora o único
  // registro barato do que a V1 entendeu no turno.
  it("lê o intent observado da resposta da IA, não da mensagem do lead", () => {
    const [candidate] = buildCandidates({
      ...base,
      rows: [
        row({ author: "lead", body: "qual o valor?", sentAt: t0, intent: null }),
        row({
          author: "agent",
          body: "Fica R$ 2.000.",
          sentAt: minutes(1),
          intent: "price_inquiry",
        }),
      ],
    });

    expect(candidate?.observedIntent).toBe("price_inquiry");
  });

  // Sem janela, um lead que nunca mais respondeu arrasta para dentro do turno
  // toda mensagem de retomada enviada dias depois, e o "turno" vira um bloco
  // que ninguém consegue julgar.
  it("fecha o turno numa janela de resposta em vez de esperar o lead voltar", () => {
    const [candidate] = buildCandidates({
      ...base,
      rows: [
        row({ author: "lead", body: "qual o valor?", sentAt: t0 }),
        row({ author: "agent", body: "Fica R$ 2.000.", sentAt: minutes(2) }),
        row({
          author: "clinic_user",
          body: "Oi! Ainda tem interesse?",
          sentAt: minutes(60 * 48),
        }),
      ],
    });

    expect(candidate?.aiResponse).toBe("Fica R$ 2.000.");
    expect(candidate?.humanResponse).toBeNull();
  });

  it("mantém as respostas encadeadas que vieram juntas", () => {
    const [candidate] = buildCandidates({
      ...base,
      rows: [
        row({ author: "lead", body: "qual o valor?", sentAt: t0 }),
        row({ author: "agent", body: "Fica R$ 2.000.", sentAt: minutes(1) }),
        row({ author: "agent", body: "Quer ver um horário?", sentAt: minutes(2) }),
      ],
    });

    expect(candidate?.aiResponse).toBe("Fica R$ 2.000.\nQuer ver um horário?");
  });

  it("guarda o histórico anterior ao turno, na ordem em que aconteceu", () => {
    const candidates = buildCandidates({
      ...base,
      rows: [
        row({ author: "lead", body: "oi", sentAt: t0 }),
        row({ author: "agent", body: "Olá! Como posso ajudar?", sentAt: minutes(1) }),
        row({ author: "lead", body: "qual o valor?", sentAt: minutes(5) }),
      ],
    });

    expect(candidates).toHaveLength(2);
    expect(candidates[1]?.history).toEqual([
      { author: "lead", body: "oi" },
      { author: "agent", body: "Olá! Como posso ajudar?" },
    ]);
  });
});
