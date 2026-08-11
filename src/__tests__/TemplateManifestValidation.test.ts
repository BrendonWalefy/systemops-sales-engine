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

  // Revisão apontou: o branch "mediaAssetPlaceholder declarado" (espelho de
  // displayNamePlaceholder para o canal media) foi adicionado sem teste
  // próprio. Este cobre exatamente esse caso.
  it("rejects a variant whose media asset placeholder is not declared", () => {
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
          mediaAssetPlaceholder: "not.declared",
        },
      ],
      placeholders: [
        { key: "variant.base.name", kind: "blocking", label: "Nome da variante de entrada" },
      ],
      objections: [],
      qualificationQuestions: [],
      handoffReasons: [],
    };
    expect(validateManifest(m)).toContainEqual(expect.stringContaining("not.declared"));
  });

  // Revisão apontou dois casos do scan sem teste: referência com espaço
  // interno ("{{ key }}") e a mesma chave referenciada mais de uma vez.
  it("counts a placeholder as used when referenced with interior whitespace like \"{{ key }}\"", () => {
    const m = baseManifest();
    m.placeholders.push({ key: "com.espaco", kind: "blocking", label: "Com espaço" });
    m.qualificationQuestions.push("Você já fez {{ com.espaco }} antes?");
    expect(validateManifest(m)).toEqual([]);
  });

  it("counts a placeholder as used when the same key is referenced repeatedly, in one string and across surfaces", () => {
    const m = baseManifest();
    m.placeholders.push({ key: "repetido", kind: "blocking", label: "Repetido" });
    m.qualificationQuestions.push("Pergunta sobre {{repetido}} e de novo {{repetido}}.");
    m.handoffReasons.push("Handoff por causa de {{repetido}}.");
    expect(validateManifest(m)).toEqual([]);
  });
});

// Regra espelhada da 5 (órfão): lá, um placeholder DECLARADO sem uso é o
// problema. Aqui, uma referência {{key}} USADA em texto livre sem
// placeholder declarado correspondente é o problema — um typo em
// "{{variant.bas.name}}" hoje não falha nada, e vai literalmente para o
// WhatsApp de um lead real como "{{variant.bas.name}}". Mesma varredura,
// comparada no sentido oposto.
describe("manifest validation — dangling reference rule (mirror of orphan detection)", () => {
  it("reports a dangling {{key}} reference in an objection response, naming the key and the location", () => {
    const m = baseManifest();
    m.objections.push({
      objection: "quanto custa",
      response: "O valor está em {{variant.bas.name}}.",
      appliesToVariant: "base",
    });
    const messages = validateManifest(m);
    expect(messages).toContainEqual(expect.stringContaining("{{variant.bas.name}}"));
    expect(messages).toContainEqual(expect.stringContaining("objeção 1"));
  });

  it("reports a dangling {{key}} reference in a qualification question, naming the location", () => {
    const m = baseManifest();
    m.qualificationQuestions.push("Você já ouviu falar de {{variant.bas.name}}?");
    const messages = validateManifest(m);
    expect(messages).toContainEqual(expect.stringContaining("{{variant.bas.name}}"));
    expect(messages).toContainEqual(expect.stringContaining("pergunta de qualificação 1"));
  });

  it("reports a dangling {{key}} reference in a handoff reason, naming the location", () => {
    const m = baseManifest();
    m.handoffReasons.push("Cliente perguntou sobre {{variant.bas.name}} e quer humano.");
    const messages = validateManifest(m);
    expect(messages).toContainEqual(expect.stringContaining("{{variant.bas.name}}"));
    expect(messages).toContainEqual(expect.stringContaining("motivo de handoff 1"));
  });

  it("does not report a correctly-spelled reference as dangling", () => {
    const m = baseManifest();
    m.objections.push({
      objection: "quanto custa",
      response: "O valor está em {{variant.base.name}}.",
      appliesToVariant: "base",
    });
    expect(validateManifest(m)).toEqual([]);
  });

  it("reports the same typo twice when it appears in two different locations, without deduping", () => {
    const m = baseManifest();
    m.objections.push({ objection: "quanto custa", response: "Veja {{variant.bas.name}}.", appliesToVariant: "base" });
    m.objections.push({ objection: "é confiável", response: "Sim, {{variant.bas.name}} garante isso.", appliesToVariant: "base" });
    const messages = validateManifest(m);
    const danglingMentions = messages.filter((msg) => msg.includes("{{variant.bas.name}}"));
    expect(danglingMentions).toHaveLength(2);
    expect(messages).toContainEqual(expect.stringContaining("objeção 1"));
    expect(messages).toContainEqual(expect.stringContaining("objeção 2"));
  });

  it("reports only the invalid reference when a valid and an invalid reference sit in the same string", () => {
    const m = baseManifest();
    m.objections.push({
      objection: "quanto custa",
      response: "Veja {{variant.base.name}} e compare com {{variant.bas.name}}.",
      appliesToVariant: "base",
    });
    const messages = validateManifest(m);
    expect(messages.some((msg) => msg.includes("{{variant.bas.name}}"))).toBe(true);
    expect(messages.some((msg) => msg.includes("{{variant.base.name}}"))).toBe(false);
  });
});
