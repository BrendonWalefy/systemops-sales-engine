import { describe, expect, it } from "vitest";
import { composePlaybookText } from "@/application/config/editorial-config";

/**
 * Caracterização de `composePlaybookText` — trava o comportamento CORRETO atual
 * antes da regra de "um fato, um dono" (docs/architecture/sources-of-truth.md).
 *
 * Qualquer refactor de config (derivar preço na commercialPolicy, colapsar
 * procedureDescription, unificar triggers) DEVE manter estes contratos. Se um
 * deles quebrar, a IA passa a receber um playbook malformado — este arquivo é a
 * rede que pega isso antes de chegar em produção.
 *
 * Invariantes cobertas aqui que o EditorialNotesFlow.test.ts NÃO cobre:
 *  - bloco de objeções (formato + filtragem de pares incompletos);
 *  - bloco de diferenciais (formato + filtragem de vazios);
 *  - ordem canônica das seções;
 *  - mídia NUNCA aparece no texto do playbook (senão conflita com [MEDIA:id]).
 */
describe("composePlaybookText — contratos de composição", () => {
  it("compõe o bloco de objeções no formato esperado pela IA", () => {
    const text = composePlaybookText({
      procedures: [{ name: "Avaliação", description: null }],
      objections: [
        { objection: "Está caro", response: "O valor sai do tratamento se avançar." },
        { objection: "Vou pensar", response: "Sem pressa, a agenda fica aberta." },
      ],
    });

    expect(text).toContain("COMO LIDAR COM OBJEÇÕES:");
    expect(text).toContain('- "Está caro" → O valor sai do tratamento se avançar.');
    expect(text).toContain('- "Vou pensar" → Sem pressa, a agenda fica aberta.');
  });

  it("descarta objeções com objection ou response ausente", () => {
    const text = composePlaybookText({
      procedures: [{ name: "Limpeza", description: null }],
      objections: [
        { objection: "Válida", response: "Resposta válida." },
        { objection: "", response: "Sem objeção." },
        { objection: "Sem resposta", response: "" },
      ],
    });

    expect(text).toContain('- "Válida" → Resposta válida.');
    expect(text).not.toContain("Sem objeção.");
    expect(text).not.toContain("Sem resposta");
  });

  it("não emite o cabeçalho de objeções quando não há nenhuma válida", () => {
    const text = composePlaybookText({
      procedures: [{ name: "Limpeza", description: null }],
      objections: [{ objection: "", response: "" }],
    });

    expect(text).not.toContain("COMO LIDAR COM OBJEÇÕES:");
  });

  it("compõe o bloco de diferenciais e descarta entradas vazias", () => {
    const text = composePlaybookText({
      procedures: [{ name: "Implante", description: null }],
      differentials: ["Laboratório próprio", "", "Entrega em 48h"],
    });

    expect(text).toContain("DIFERENCIAIS:");
    expect(text).toContain("• Laboratório próprio");
    expect(text).toContain("• Entrega em 48h");
    // Sem bullet vazio
    expect(text).not.toContain("• \n");
    expect(text).not.toMatch(/•\s*$/m);
  });

  it("mantém a ordem canônica: notes → procedimentos → diferenciais → objeções", () => {
    const text = composePlaybookText({
      notes: "COMO CONDUZIR: seja consultivo.",
      procedures: [{ name: "Lentes", description: "Facetas em resina" }],
      differentials: ["Foco em estética"],
      objections: [{ objection: "Caro", response: "Parcelamos em 12x." }],
    });

    const iNotes = text.indexOf("COMO CONDUZIR");
    const iProc = text.indexOf("PROCEDIMENTOS OFERECIDOS:");
    const iDiff = text.indexOf("DIFERENCIAIS:");
    const iObj = text.indexOf("COMO LIDAR COM OBJEÇÕES:");

    expect(iNotes).toBeGreaterThanOrEqual(0);
    expect(iNotes).toBeLessThan(iProc);
    expect(iProc).toBeLessThan(iDiff);
    expect(iDiff).toBeLessThan(iObj);
  });

  it("NUNCA inclui itens da biblioteca de mídia no texto do playbook", () => {
    // Invariante crítica: mídia é entregue via [MEDIA:id] no system prompt.
    // Se URL/título de mídia vazar pro playbookText, cria bloco conflitante e
    // pode duplicar ou embaralhar o envio de vídeo/áudio ao lead.
    const text = composePlaybookText({
      procedures: [{ name: "Lentes", description: "Facetas em resina" }],
      objections: [{ objection: "Tem vídeo?", response: "Posso te enviar." }],
      mediaLibrary: [
        { id: "vid-1", title: "Lentes – Técnica Simplificada", url: "https://blob/v1.mp4", type: "video", treatmentId: null },
        { id: "img-2", title: "Antes e depois", url: "https://blob/img2.png", type: "image", treatmentId: null },
      ],
    });

    expect(text).not.toContain("https://blob/v1.mp4");
    expect(text).not.toContain("https://blob/img2.png");
    expect(text).not.toContain("vid-1");
    expect(text).not.toContain("img-2");
    expect(text).not.toContain("[MEDIA:");
  });

  it("Item 4: o fallback procedureDescription foi aposentado — só a lista de treatments compõe procedimentos", () => {
    const withList = composePlaybookText({
      procedures: [{ name: "Canal", description: null }],
    });
    expect(withList).toContain("• Canal");

    // Sem lista de procedimentos → nenhuma seção de procedimentos (nada de fallback).
    const withoutList = composePlaybookText({
      procedures: [],
      differentials: ["algo"],
    });
    expect(withoutList).not.toContain("PROCEDIMENTOS OFERECIDOS:");
  });

  it("retorna string vazia quando não há nenhum conteúdo — sem cabeçalhos órfãos", () => {
    const text = composePlaybookText({
      notes: null,
      procedures: [],
      differentials: [],
      objections: [],
    });

    expect(text).toBe("");
    expect(text).not.toContain("PROCEDIMENTOS");
    expect(text).not.toContain("undefined");
    expect(text).not.toContain("null");
  });

  it("compõe um playbook realista completo (shape Horizonte) sem lixo", () => {
    const text = composePlaybookText({
      notes: "COMO CONDUZIR A CONVERSA:\n- Nunca pressionar.\n- Só oferecer agendamento com interesse claro.",
      procedures: [
        { name: "Avaliação", description: "Consulta inicial com o Dr. Silva: análise do sorriso e plano personalizado." },
        { name: "Lentes de resina composta", description: "Facetas em resina, técnicas Simplificada e Estratificada." },
      ],
      differentials: ["Foco em lentes em resina", "Laboratório próprio"],
      objections: [
        { objection: "Não quero pagar a avaliação", response: "Os R$100 saem do tratamento se você avançar." },
      ],
    });

    // Todas as seções presentes, na ordem certa, sem placeholders.
    expect(text.startsWith("COMO CONDUZIR A CONVERSA:")).toBe(true);
    expect(text).toContain("PROCEDIMENTOS OFERECIDOS:");
    expect(text).toContain("• Avaliação — Consulta inicial");
    expect(text).toContain("DIFERENCIAIS:");
    expect(text).toContain("COMO LIDAR COM OBJEÇÕES:");
    expect(text).not.toContain("undefined");
    expect(text).not.toContain("null");
    // Seções separadas por linha em branco dupla.
    expect(text).toContain("\n\n");
  });
});
