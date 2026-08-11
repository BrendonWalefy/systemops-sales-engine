import { describe, expect, it } from "vitest";
import { validateManifest } from "@/application/templates/validate-manifest";
import type { TemplateManifest } from "@/application/templates/contract";

function baseManifest(): TemplateManifest {
  return {
    id: "dental-resin",
    version: "1.0.0",
    segment: "odontologia-estetica",
    variants: [
      { slug: "base", displayNamePlaceholder: "variant.base.name", priceChannel: "text", priceKind: "from" },
    ],
    placeholders: [
      { key: "variant.base.name", kind: "blocking", label: "Nome da variante de entrada" },
    ],
    objections: [],
    qualificationQuestions: [],
    handoffReasons: [],
  };
}

describe("manifest validation", () => {
  it("accepts a coherent manifest", () => {
    expect(validateManifest(baseManifest())).toEqual([]);
  });

  it("rejects a variant whose display name placeholder is not declared", () => {
    const m = baseManifest();
    m.variants[0].displayNamePlaceholder = "nao.declarado";
    expect(validateManifest(m)).toContainEqual(
      expect.stringContaining("nao.declarado"),
    );
  });

  it("rejects a declared placeholder nobody uses", () => {
    const m = baseManifest();
    m.placeholders.push({ key: "orfao", kind: "blocking", label: "Órfão" });
    expect(validateManifest(m)).toContainEqual(expect.stringContaining("orfao"));
  });

  it("requires a media asset placeholder when the channel is media", () => {
    const m = baseManifest();
    m.variants[0].priceChannel = "media";
    expect(validateManifest(m)).toContainEqual(
      expect.stringContaining("media"),
    );
  });

  it("rejects an objection pointing at a variant the manifest does not define", () => {
    const m = baseManifest();
    m.objections.push({ objection: "caro", response: "…", appliesToVariant: "enhanced" });
    expect(validateManifest(m)).toContainEqual(
      expect.stringContaining("enhanced"),
    );
  });

  it("rejects a defaulted placeholder with no default value", () => {
    const m = baseManifest();
    m.placeholders.push({ key: "tom", kind: "defaulted", label: "Tom" });
    m.qualificationQuestions.push("{{tom}}");
    expect(validateManifest(m)).toContainEqual(expect.stringContaining("tom"));
  });
});

// Testes suplementares (além dos seis do brief) para provar a varredura de
// uso nos dois sentidos: um scan estreito demais denuncia órfãos falsos e
// bloqueia manifestos válidos; um scan largo demais nunca denuncia um órfão
// de verdade. Os seis testes acima já cobrem uso via displayNamePlaceholder
// e via {{key}} em qualificationQuestions — estes cobrem os caminhos que
// faltam (resposta de objeção, motivo de handoff, mediaAssetPlaceholder) e
// o caso "largo demais" (chave que é substring de uma chave usada).
describe("manifest validation — usage scan robustness (supplementary)", () => {
  it("does not report a placeholder as orphan when it is used only inside an objection response", () => {
    const m = baseManifest();
    m.placeholders.push({ key: "garantia.texto", kind: "blocking", label: "Texto de garantia" });
    m.objections.push({
      objection: "e se eu não gostar do resultado",
      response: "Você tem {{garantia.texto}} nesse caso.",
      appliesToVariant: "base",
    });
    expect(validateManifest(m)).toEqual([]);
  });

  it("does not report a placeholder as orphan when it is used only inside a handoff reason", () => {
    const m = baseManifest();
    m.placeholders.push({ key: "motivo.especial", kind: "blocking", label: "Motivo especial" });
    m.handoffReasons.push("Cliente pede {{motivo.especial}} e precisa falar com um humano.");
    expect(validateManifest(m)).toEqual([]);
  });

  it("recognizes mediaAssetPlaceholder as usage and accepts a properly declared media variant", () => {
    const m: TemplateManifest = {
      id: "dental-resin",
      version: "1.0.0",
      segment: "odontologia-estetica",
      variants: [
        {
          slug: "base",
          displayNamePlaceholder: "variant.base.name",
          priceChannel: "media",
          priceKind: "from",
          mediaAssetPlaceholder: "variant.base.asset",
        },
      ],
      placeholders: [
        { key: "variant.base.name", kind: "blocking", label: "Nome da variante de entrada" },
        { key: "variant.base.asset", kind: "blocking", label: "Mídia com o preço da variante" },
      ],
      objections: [],
      qualificationQuestions: [],
      handoffReasons: [],
    };
    expect(validateManifest(m)).toEqual([]);
  });

  it("reports a genuine orphan even when its key is a substring of a used key", () => {
    const m = baseManifest();
    // "variant.base" é substring de "variant.base.name" (a chave realmente
    // usada). Um scan construído em cima de .includes() em vez de
    // correspondência exata de chave marcaria "variant.base" como usado por
    // engano — este teste prova que isso não acontece.
    m.placeholders.push({ key: "variant.base", kind: "blocking", label: "Quase o nome certo" });
    const messages = validateManifest(m);
    expect(messages.some((msg) => msg.includes('"variant.base"') && !msg.includes('"variant.base.name"'))).toBe(
      true,
    );
  });

  it("flags a media variant with no asset placeholder even when the manifest arrives via untyped JSON", () => {
    // Caminho realista: um manifesto de template é lido de um arquivo (JSON)
    // e não passa por nenhuma checagem do compilador — o union discriminado
    // de TemplateVariant não protege nada aqui. Só a regra em runtime pega.
    const raw = {
      id: "dental-resin",
      version: "1.0.0",
      segment: "odontologia-estetica",
      variants: [
        { slug: "base", displayNamePlaceholder: "variant.base.name", priceChannel: "media", priceKind: "from" },
      ],
      placeholders: [
        { key: "variant.base.name", kind: "blocking", label: "Nome da variante de entrada" },
      ],
      objections: [],
      qualificationQuestions: [],
      handoffReasons: [],
    };
    const m = JSON.parse(JSON.stringify(raw)) as TemplateManifest;
    expect(validateManifest(m)).toContainEqual(expect.stringContaining("media"));
  });
});
