#!/usr/bin/env tsx
/**
 * Vitalli — aplica o conteúdo da reunião com o Dr. Victor (17/07/2026).
 * Fonte: docs/product/client-validation/vitalli-07-2026/conteudo-victor-17-07/
 * Backlog: docs/product/client-validation/vitalli-07-2026/05-backlog-reuniao-victor-17-07.md
 *
 * ⚠️ GATED: dry-run por padrão. Só grava com `--apply`.
 *
 * O que faz (decisões confirmadas com o dono em 17/07):
 *  1. TREATMENTS — fim da promoção (tabela NORMAL, igual às fotos novas):
 *     - "Técnica Simplificada"  → renomeia "Lente em Resina Premium",
 *       quantityPrices 10=R$1.700 / 20=R$2.000, descrição do Victor.
 *     - "Técnica Estratificada" → renomeia "Lente em Resina Estratificada",
 *       quantityPrices 10=R$2.000 / 20=R$2.500, descrição do Victor.
 *     - Clareamento (3): SÓ descrição dos protocolos (preços mantidos por decisão
 *       do dono — a msg do Victor citava 400/800/1.000, pendente confirmação).
 *     - "Plástica Gengival": treatment novo (não cotável, avaliação primeiro).
 *     - "Endodontia" → split estilo Siso: renomeia p/ "Tratamento de Canal
 *       (dentes anteriores)" R$600 + cria pré-molares R$700, molares R$850 e
 *       retratamentos R$650/750/950 — todos fixos, cotáveis, "por dente".
 *  2. MÍDIA (cap 10/clinic) — substituição:
 *     - Deleta 7 rows antigas (blobs preservados: mensagens já enviadas
 *       continuam renderizando): fotos de resultado avulsas, card promo,
 *       cuidados R$350 (incorreto), exemplo de foto antigo.
 *     - Sobe 8 novas: 2 cards de valores (arte com preços NORMAIS), cores BL,
 *       exemplo frontal/perfil, cuidados R$400, 3 plástica gengival.
 *     - Retitula as 2 mantidas para os nomes novos (Premium/Estratificada).
 *  3. PIPELINES:
 *     - "Lentes em Resina Composta": apresentação passa a usar os 2 cards de
 *       valores (pedido explícito do Victor) + step de pedido de foto com a
 *       imagem de exemplo do ângulo antes do photo step.
 *     - "Remoção de lentes" e "Substituição de lente (un)": ganham o step de
 *       exemplo antes do pedido de foto (a msg dizia "como no exemplo acima"
 *       sem nunca ter enviado exemplo).
 *  4. PLAYBOOK v4 — clona ativa e ativa nova versão: política sem "promocionais",
 *     nomes novos das técnicas, formas de pagamento do Victor (Pix 5% desc.,
 *     até 21x, sem boleto), menção a plástica gengival/clareamento/canal, notes
 *     com guia de cores BL + objetividade. Autoriza as 10 mídias finais.
 *
 *   Dry-run:  npx dotenv -e .env.local -- npx tsx scripts/apply-vitalli-config-v4.ts
 *   Aplicar:  npx dotenv -e .env.local -- npx tsx scripts/apply-vitalli-config-v4.ts --apply
 */
import "dotenv/config";
import { readFileSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { put } from "@vercel/blob";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "../src/infrastructure/db/client";
import {
  mediaAssets,
  organizations,
  playbookVersions,
  treatments,
} from "../src/infrastructure/db/schema";
import {
  publishablePlaybookSchema,
  blockingPlaybookNotesIssues,
  blockingCommercialPolicyIssues,
  blockingTreatmentDescriptionIssues,
} from "../src/application/config/editorial-config";
import type { PipelineStep } from "../src/domain/entities/treatment";

const VITALLI_ID = "d24a584a-faac-4a46-9750-a718d0f8e686";
const APPLY = process.argv.includes("--apply");
const CONTENT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../docs/product/client-validation/vitalli-07-2026/conteudo-victor-17-07",
);

// ── Mídias mantidas (retituladas) e deletadas ──
const KEEP_VIDEO_ESTRATIFICADA = "0c771e1b-a1e2-45cb-8a3d-ecbd0b2f0c7c"; // vídeo resultado
const KEEP_FOTO_PREMIUM = "5ffd33e9-0f06-47b9-b07f-21405a283391"; // foto resultado simplificada
const DELETE_MEDIA_IDS = [
  "98f43093-2214-49f3-b932-be03db0c1412", // Faceta estratificada masc
  "636dd855-b5b9-4775-b765-be52f4e75986", // Faceta estratificada fem 2
  "14b3ce5b-f4da-4d69-9793-0c47d77458a8", // Exemplo Foto Avaliação (antigo)
  "2dacff6a-8a9a-4511-a045-01b000be1bf2", // Cuidados Pós Facetas (R$350 errado)
  "9bcaf488-1656-42e9-8a52-6416335924aa", // Promoção Estratificadas (arte promo)
  "e4b0c641-fc33-48e9-b53f-43ad5665da64", // Faceta simplificada masc 3
  "3618aee7-b85f-46ff-9e55-dac535065ae2", // Faceta simplificada fem
];

// ── Uploads: arquivo local → título/vínculo. treatmentKey resolvido em runtime. ──
type Upload = {
  file: string;
  title: string;
  treatmentKey: "umbrella" | "gengival" | null; // null = GERAL (enviável em qualquer conversa)
};
const UPLOADS: Upload[] = [
  { file: "item-05-foto-valores-premium.jpeg", title: "Valores Lente em Resina Premium", treatmentKey: "umbrella" },
  { file: "item-05-foto-valores-estratificada.jpeg", title: "Valores Lente em Resina Estratificada", treatmentKey: "umbrella" },
  { file: "item-12-cores-bl1-bl2-bl3.jpeg", title: "Cores BL1, BL2 e BL3", treatmentKey: null },
  { file: "item-novo-foto-fronta-perfil-mordendo-sorrindo.jpeg", title: "Exemplo Foto Avaliação (frontal e perfil)", treatmentKey: null },
  { file: "item-13-cuidados-pos-1.jpeg", title: "Cuidados Pós Lentes", treatmentKey: null },
  { file: "item-15-foto-antes-plastica-gengival-1.jpeg", title: "Plástica Gengival — antes", treatmentKey: "gengival" },
  { file: "item-15-foto-depois-plastica-gengival-1.jpeg", title: "Plástica Gengival — depois", treatmentKey: "gengival" },
  { file: "item-15-foto-plastica-gengival-2.jpeg", title: "Plástica Gengival — antes e depois", treatmentKey: "gengival" },
];
// NÃO sobem agora (pós-procedimento, backlog item 13 — feature ainda não existe):
// item-13-cuidados-pos-2-texto.jpeg (guia completo) e item-13-video-cuidados.mp4.

// ── Textos do Victor (verbatim, sem R$ — preço é fato estruturado) ──
const DESC_PREMIUM =
  "É confeccionada com uma única resina de alta qualidade, proporcionando um sorriso bonito, natural e com excelente acabamento.";
const DESC_ESTRATIFICADA =
  "É confeccionada com a combinação de duas resinas de alta qualidade, incluindo uma camada translúcida nas bordas, reproduzindo com mais fidelidade as características de um dente natural. Essa técnica oferece um resultado com maior riqueza de detalhes, profundidade e estética, sendo a opção mais sofisticada para quem busca máxima naturalidade.";
const DESC_CLAREAMENTO_CASEIRO =
  "Protocolo caseiro: é feito um molde copiando todos os seus dentes (superior e inferior) e a aplicação é feita em casa, todos os dias, por 2 horas, durante 3 semanas — com acompanhamento presencial 1 vez por semana para acompanhar a evolução do clareamento.";
const DESC_CLAREAMENTO_CONSULTORIO =
  "Protocolo no consultório: 1 aplicação por semana (superior e inferior) durante 3 semanas, com 15 minutos por sessão. Antes e depois de cada aplicação usamos um dessensibilizante para não causar sensibilidade, com registro fotográfico para acompanhar a evolução.";
const DESC_CLAREAMENTO_COMBINADO =
  "Combina os dois protocolos (consultório + caseiro juntos), com acompanhamento completo — é a opção com o melhor resultado.";
const DESC_PLASTICA_GENGIVAL =
  "Serve para dar simetria ao sorriso: é feita uma correção na gengiva para que todos os dentes fiquem do mesmo tamanho. O procedimento é totalmente indolor.";

// ── Playbook v4 ──
const V4_NAME = "Clínica Vitalli — v4 Preços Normais + conteúdo Victor (17/07)";
const V4_COMMERCIAL_POLICY = `Éramos Dental Luxe, hoje somos Clínica Vitalli. Antes ficávamos no bairro Sabará, próximo a Interlagos; hoje estamos na Avenida Adolfo Pinheiro, em Santo Amaro.

Trabalhamos com duas técnicas de lentes em resina. A Lente em Resina Premium usa uma única resina de alta qualidade, para um sorriso bonito e natural com excelente acabamento — é o investimento mais acessível. A Lente em Resina Estratificada combina duas resinas de alta qualidade com bordas translúcidas, para máxima naturalidade e o resultado mais sofisticado. Nossos pacotes fechados são de 10 ou 20 lentes, e o tratamento é totalmente personalizado: o paciente escolhe a cor e o formato dos dentes junto com o Doutor.

Formas de pagamento: à vista (Pix, débito ou crédito), com 5% de desconto no pagamento via Pix, ou parcelado em até 21x no cartão (taxas e condições consultadas na clínica). Não trabalhamos com boleto.

Caso você já possua lentes antigas e precise fazer a troca, também realizamos remoção, prótese adesiva e limpeza. Nossa manutenção preventiva periódica já inclui profilaxia, polimento e nova aplicação da película protetora, que mantém o brilho e a limpeza dos dentes.

Também realizamos plástica gengival, que dá simetria ao sorriso corrigindo a gengiva para que todos os dentes fiquem do mesmo tamanho (procedimento totalmente indolor), clareamento dental com protocolo caseiro, de consultório ou os dois combinados, e tratamento de canal.

Para reservar a agenda e garantir o seu horário com o Doutor — que é muito concorrido — cobramos um sinal para confirmar a avaliação. Esse sinal é integralmente abatido no dia do procedimento e não é reembolsável caso o paciente não compareça. O pagamento é feito via Pix no CNPJ 54.659.849/0001-09 em nome de Dr. Victor Cavalcante.`;

const V4_NOTES = `ESPECIALIDADE DA CLÍNICA:
A Clínica Vitalli é especialista em lentes de resina composta (Lente em Resina Premium e Lente em Resina Estratificada). Toda conversa sobre lentes tem prioridade máxima e deve ser conduzida com muita atenção.

OBJETIVIDADE:
Seja direto e objetivo. Responda o que foi perguntado em blocos curtos e conduza ativamente a conversa para o agendamento da avaliação — não espere o lead pedir para ver horários.

CORES DAS LENTES:
Se o lead perguntar sobre cor ou tom das lentes, envie a imagem "Cores BL1, BL2 e BL3" e explique que a cor e o formato dos dentes são escolhidos junto com o Doutor — o tratamento é totalmente personalizado.

CONDUTA ESPECÍFICA DA CLÍNICA:
Nunca prometa resultados fechados ou definitivos por mensagem. Sempre informe que a indicação correta depende de avaliação presencial.
Para confirmar e agendar a avaliação presencial, informe que a agenda do Doutor é muito concorrida e que a clínica exige o pagamento do sinal da avaliação via Pix (valor informado no cadastro do procedimento), abatido integralmente no dia do procedimento. Se o lead perguntar a localização, você pode informar que a clínica fica na Avenida Adolfo Pinheiro em Santo Amaro, mas só informe o endereço completo (incluindo que a sala é a 124) após confirmar o agendamento via Pix. Sempre aja de forma acolhedora e calorosa. Use sempre quebras de linha ao explicar valores ou mudar de assunto, para que os textos longos fiquem legíveis (ex: pule linha entre a Lente Premium e a Estratificada). Quando um agendamento for confirmado, SEMPRE envie EXATAMENTE este aviso ao final da mensagem, usando o emoji de alerta: "⚠️ Importante: Chegue com 10 minutos de antecedência, temos tolerância de atraso, e caso precise reagendar, avise-nos com no mínimo 24h de antecedência."`;

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function compileToClinicFields(data: {
  specialty: string | null;
  toneOfVoice: string | null;
  differentials: string[] | null;
  commercialPolicy: string | null;
  objections: { objection: string; response: string }[] | null;
}) {
  const parts: string[] = [];
  if (data.specialty) parts.push(`ESPECIALIDADE: ${data.specialty}`);
  if (data.differentials?.length) parts.push(`\nDIFERENCIAIS DO NEGÓCIO:\n${data.differentials.map((d) => `- ${d}`).join("\n")}`);
  if (data.objections?.length) {
    const objText = data.objections.map((o) => `Objeção: ${o.objection}\nResposta: ${o.response}`).join("\n\n");
    parts.push(`\nOBJEÇÕES E RESPOSTAS:\n${objText}`);
  }
  const toneMap: Record<string, string> = {
    acolhedor: "Acolhedor e empático", tecnico: "Técnico e informativo",
    persuasivo: "Persuasivo e orientado a resultados", luxo: "Premium e exclusivo",
  };
  return {
    playbook: parts.join("\n") || null,
    commercialPolicy: data.commercialPolicy || null,
    toneOfVoice: toneMap[data.toneOfVoice ?? "acolhedor"] ?? data.toneOfVoice ?? null,
  };
}

async function findTreatment(name: string) {
  const [t] = await db
    .select()
    .from(treatments)
    .where(and(eq(treatments.clinicId, VITALLI_ID), eq(treatments.name, name)))
    .limit(1);
  return t ?? null;
}

function mergeAliases(current: string[], extra: string[]): string[] {
  return [...new Set([...current, ...extra])];
}

async function uploadOne(u: Upload, treatmentId: string | null): Promise<string> {
  const filePath = join(CONTENT_DIR, u.file);
  const ext = extname(u.file).toLowerCase();
  const contentType = CONTENT_TYPES[ext];
  if (!contentType) throw new Error(`Extensão não suportada: ${u.file}`);
  const sizeBytes = statSync(filePath).size;
  const key = `media/clinic/${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
  const blob = await put(key, readFileSync(filePath), {
    access: "public",
    contentType,
    multipart: sizeBytes > 5 * 1024 * 1024,
  });
  const assetId = randomUUID();
  await db.insert(mediaAssets).values({
    id: assetId,
    clinicId: VITALLI_ID,
    treatmentId,
    title: u.title,
    url: blob.url,
    type: "image",
    mimeType: contentType,
    sizeBytes,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  console.log(`  ✅ "${u.title}" (${(sizeBytes / 1024).toFixed(0)} KB) → ${assetId}`);
  return assetId;
}

function buildLentesPipeline(ids: {
  cardPremium: string;
  cardEstratificada: string;
  exemploFoto: string;
}): PipelineStep[] {
  return [
    {
      type: "content",
      label: "Apresentação das técnicas",
      blocks: [
        {
          kind: "text",
          content:
            "Nós somos especialistas em lentes de resina composta e trabalhamos com duas técnicas. Deixa eu te mostrar cada uma, já com os valores dos pacotes 👇",
        },
        {
          kind: "media",
          mediaId: ids.cardPremium,
          caption:
            "✨ Lente em Resina Premium — feita com uma única resina de alta qualidade, proporcionando um sorriso bonito, natural e com excelente acabamento.",
        },
        {
          kind: "media",
          mediaId: ids.cardEstratificada,
          caption:
            "✨ Lente em Resina Estratificada — combina duas resinas de alta qualidade, com camada translúcida nas bordas, reproduzindo com mais fidelidade um dente natural. É a opção mais sofisticada, com máxima naturalidade.",
        },
        {
          kind: "text",
          content:
            "O tratamento é totalmente personalizado: você escolhe a cor e o formato dos dentes. 😊\n\nFicou com alguma dúvida? Posso te explicar qualquer detalhe.",
        },
      ],
    },
    {
      type: "qa",
      label: "Sessão de dúvidas",
      maxTurns: 3,
      instruction:
        'Responda as dúvidas de forma objetiva e acolhedora. Os valores dos pacotes já foram apresentados nos cards — confirme-os se perguntarem. Se o lead perguntar sobre cor ou tom, envie a imagem "Cores BL1, BL2 e BL3" e explique que a cor é escolhida junto com o Doutor. Pergunte qual das duas técnicas chamou mais a atenção e conduza ativamente para o agendamento da avaliação.',
    },
    {
      type: "content",
      label: "Pedido de foto do sorriso",
      blocks: [
        {
          kind: "text",
          content:
            "Você poderia me encaminhar uma foto ou um vídeo curto do seu sorriso? Assim o Doutor já consegue fazer uma pré-avaliação do seu caso por aqui 😊",
        },
        {
          kind: "media",
          mediaId: ids.exemploFoto,
          caption:
            "É só tirar nesses dois ângulos, mordendo e sorrindo: uma foto frontal e uma de perfil, como no exemplo.",
        },
      ],
    },
    {
      type: "photo",
      label: "Aguardar foto",
      message:
        "Pode enviar a foto por aqui quando conseguir 😊 E se preferir, seguimos direto para a avaliação presencial — sem problema nenhum!",
      required: false,
    },
    { type: "ask_availability", label: "Perguntar disponibilidade" },
    { type: "offer_slots", label: "Mostrar horários" },
    { type: "book", label: "Confirmar agendamento" },
  ];
}

// Insere o step de exemplo de foto antes do photo step dos pipelines de
// remoção/substituição (a mensagem dizia "como no exemplo acima" sem exemplo).
function withExemploStep(steps: PipelineStep[], exemploFotoId: string): PipelineStep[] {
  const photoIdx = steps.findIndex((s) => s.type === "photo");
  if (photoIdx === -1) return steps;
  const contentStep: PipelineStep = {
    type: "content",
    label: "Exemplo de foto",
    blocks: [
      {
        kind: "media",
        mediaId: exemploFotoId,
        caption:
          "Se você se sentir à vontade, me manda uma foto ou um vídeo curto do seu sorriso atual nesses dois ângulos (frontal e perfil, mordendo e sorrindo). Ajuda o Doutor na pré-avaliação 😊",
      },
    ],
  };
  return [...steps.slice(0, photoIdx), contentStep, ...steps.slice(photoIdx)];
}

async function main() {
  console.log(`\n=== Vitalli config v4 — ${APPLY ? "APLICANDO" : "DRY-RUN (use --apply)"} ===\n`);

  // ── Carrega estado atual ──
  const simplificada = (await findTreatment("Técnica Simplificada")) ?? (await findTreatment("Lente em Resina Premium"));
  const estratificada = (await findTreatment("Técnica Estratificada")) ?? (await findTreatment("Lente em Resina Estratificada"));
  const umbrella = await findTreatment("Lentes em Resina Composta");
  const endodontia = (await findTreatment("Endodontia")) ?? (await findTreatment("Tratamento de Canal (dentes anteriores)"));
  const remocao = await findTreatment("Remoção de lentes");
  const substituicao = await findTreatment("Substituição de lente (un)");
  const clareamentoCaseiro = await findTreatment("Clareamento caseiro");
  const clareamentoConsultorio = await findTreatment("Clareamento consultório");
  const clareamentoCombo = await findTreatment("Clareamento consultório e caseiro");

  for (const [label, t] of Object.entries({ simplificada, estratificada, umbrella, endodontia, remocao, substituicao, clareamentoCaseiro, clareamentoConsultorio, clareamentoCombo })) {
    if (!t) throw new Error(`Treatment não encontrado: ${label}`);
  }

  const [activePlaybook] = await db
    .select()
    .from(playbookVersions)
    .where(and(eq(playbookVersions.clinicId, VITALLI_ID), eq(playbookVersions.status, "active")))
    .limit(1);
  if (!activePlaybook) throw new Error("Nenhum playbook ativo.");

  const existingMedia = await db
    .select({ id: mediaAssets.id, title: mediaAssets.title })
    .from(mediaAssets)
    .where(eq(mediaAssets.clinicId, VITALLI_ID));
  console.log(`Mídias hoje: ${existingMedia.length} | deletar: ${DELETE_MEDIA_IDS.length} | subir: ${UPLOADS.length} → final: ${existingMedia.length - DELETE_MEDIA_IDS.length + UPLOADS.length} (cap 10)`);
  if (existingMedia.length - DELETE_MEDIA_IDS.length + UPLOADS.length > 10) {
    throw new Error("Plano estoura o cap de 10 mídias por clínica.");
  }

  // ── Gates de validação (mesmos da ativação pelo painel) ──
  const validation = publishablePlaybookSchema.safeParse({
    specialty: activePlaybook.specialty ?? "",
    toneOfVoice: activePlaybook.toneOfVoice ?? "acolhedor",
    receptionistName: activePlaybook.receptionistName,
    differentials: activePlaybook.differentials ?? [],
    commercialPolicy: V4_COMMERCIAL_POLICY,
  });
  if (!validation.success) {
    throw new Error("Playbook inválido: " + validation.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  const policyIssues = blockingCommercialPolicyIssues(V4_COMMERCIAL_POLICY);
  if (policyIssues.length) throw new Error("commercialPolicy bloqueada: " + policyIssues.join("; "));
  const notesIssues = blockingPlaybookNotesIssues(V4_NOTES);
  if (notesIssues.length) throw new Error("notes bloqueadas: " + notesIssues.join("; "));
  const descIssues = blockingTreatmentDescriptionIssues([
    { name: "Lente em Resina Premium", description: DESC_PREMIUM },
    { name: "Lente em Resina Estratificada", description: DESC_ESTRATIFICADA },
    { name: "Clareamento caseiro", description: DESC_CLAREAMENTO_CASEIRO },
    { name: "Clareamento consultório", description: DESC_CLAREAMENTO_CONSULTORIO },
    { name: "Clareamento consultório e caseiro", description: DESC_CLAREAMENTO_COMBINADO },
    { name: "Plástica Gengival", description: DESC_PLASTICA_GENGIVAL },
  ]);
  if (descIssues.length) throw new Error("descrições bloqueadas: " + descIssues.join("; "));
  console.log("✓ Gates de validação OK (política/notes/descrições sem R$).\n");

  // ── Resumo do plano ──
  console.log("— Lentes (tabela NORMAL, fim da promo):");
  console.log('  "Técnica Simplificada" → "Lente em Resina Premium" | 10=R$1.700, 20=R$2.000');
  console.log('  "Técnica Estratificada" → "Lente em Resina Estratificada" | 10=R$2.000, 20=R$2.500');
  console.log("— Clareamento: só descrições (preços mantidos: 600/1.200/1.500 — divergência com msg do Victor PENDENTE de confirmação).");
  console.log('— Novo: "Plástica Gengival" (não cotável, avaliação primeiro, 3 fotos).');
  console.log('— Endodontia → 6 treatments cotáveis "por dente": canal 600/700/850, retratamento 650/750/950.');
  console.log(`— Pipeline lentes: cards de valores na apresentação + exemplo de foto antes do photo step (idem remoção/substituição).`);
  console.log(`— Playbook v4: "${V4_NAME}" (política sem promo, pagamento Victor, cores BL, objetividade).`);
  console.log(`— Mídias deletadas: ${DELETE_MEDIA_IDS.length} (blobs preservados) | novas: ${UPLOADS.map((u) => `"${u.title}"`).join(", ")}`);

  if (!APPLY) {
    console.log("\nℹ️  Dry-run — nada gravado. Rode com --apply.\n");
    process.exit(0);
  }

  const now = new Date();

  // ── 1. Plástica Gengival (antes das mídias: fotos apontam pra ela) ──
  let gengival = await findTreatment("Plástica Gengival");
  if (!gengival) {
    const [created] = await db
      .insert(treatments)
      .values({
        clinicId: VITALLI_ID,
        name: "Plástica Gengival",
        durationMinutes: 60,
        description: DESC_PLASTICA_GENGIVAL,
        requiresEvaluationFirst: true,
        keywordMatchEnabled: true,
        aliases: ["plastica gengival", "gengivoplastia", "sorriso gengival", "gengiva aparecendo", "corrigir gengiva"],
        isAesthetic: true,
        priceQuotableInChat: false,
        priceKind: "from",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    gengival = created;
    console.log(`\n✅ Treatment "Plástica Gengival" criado (${gengival.id})`);
  } else {
    console.log(`\nℹ️  "Plástica Gengival" já existe (${gengival.id})`);
  }

  // ── 2. Mídias: deleta antigas, sobe novas, retitula mantidas ──
  console.log("\n— Mídias:");
  const deleted = await db
    .delete(mediaAssets)
    .where(and(eq(mediaAssets.clinicId, VITALLI_ID), inArray(mediaAssets.id, DELETE_MEDIA_IDS)))
    .returning({ id: mediaAssets.id, title: mediaAssets.title });
  for (const d of deleted) console.log(`  🗑️  "${d.title}" removida da biblioteca (blob preservado)`);

  await db.update(mediaAssets).set({ title: "Resultado Lente em Resina Estratificada", updatedAt: now }).where(eq(mediaAssets.id, KEEP_VIDEO_ESTRATIFICADA));
  await db.update(mediaAssets).set({ title: "Resultado Lente em Resina Premium", updatedAt: now }).where(eq(mediaAssets.id, KEEP_FOTO_PREMIUM));
  console.log("  ✏️  Mantidas retituladas (Resultado Premium / Resultado Estratificada)");

  const newIds: Record<string, string> = {};
  for (const u of UPLOADS) {
    const treatmentId = u.treatmentKey === "umbrella" ? umbrella!.id : u.treatmentKey === "gengival" ? gengival.id : null;
    newIds[u.title] = await uploadOne(u, treatmentId);
  }

  // ── 3. Treatments: lentes (rename + tabela normal + descrições) ──
  await db
    .update(treatments)
    .set({
      name: "Lente em Resina Premium",
      description: DESC_PREMIUM,
      aliases: mergeAliases(simplificada!.aliases, ["premium", "lente premium", "resina premium", "lente em resina premium"]),
      quantityPrices: [
        { quantity: 10, priceCents: 170000 },
        { quantity: 20, priceCents: 200000 },
      ],
      priceCents: 170000,
      updatedAt: now,
    })
    .where(eq(treatments.id, simplificada!.id));
  await db
    .update(treatments)
    .set({
      name: "Lente em Resina Estratificada",
      description: DESC_ESTRATIFICADA,
      aliases: mergeAliases(estratificada!.aliases, ["lente estratificada", "lente em resina estratificada"]),
      quantityPrices: [
        { quantity: 10, priceCents: 200000 },
        { quantity: 20, priceCents: 250000 },
      ],
      priceCents: 200000,
      updatedAt: now,
    })
    .where(eq(treatments.id, estratificada!.id));
  console.log("\n✅ Lentes renomeadas + tabela normal aplicada (Premium 1.700/2.000 · Estratificada 2.000/2.500)");

  // ── 4. Clareamento: só descrições ──
  await db.update(treatments).set({ description: DESC_CLAREAMENTO_CASEIRO, updatedAt: now }).where(eq(treatments.id, clareamentoCaseiro!.id));
  await db.update(treatments).set({ description: DESC_CLAREAMENTO_CONSULTORIO, updatedAt: now }).where(eq(treatments.id, clareamentoConsultorio!.id));
  await db.update(treatments).set({ description: DESC_CLAREAMENTO_COMBINADO, updatedAt: now }).where(eq(treatments.id, clareamentoCombo!.id));
  console.log("✅ Clareamento: descrições dos protocolos (preços intactos)");

  // ── 5. Endodontia: split estilo Siso ──
  const canalShared = ["canal", "endodontia", "tratamento de canal"];
  await db
    .update(treatments)
    .set({
      name: "Tratamento de Canal (dentes anteriores)",
      aliases: mergeAliases(endodontia!.aliases, canalShared),
      priceCents: 60000,
      priceKind: "fixed",
      priceUnit: "por dente",
      priceQuotableInChat: true,
      updatedAt: now,
    })
    .where(eq(treatments.id, endodontia!.id));
  const canalVariants: Array<{ name: string; priceCents: number; aliases: string[] }> = [
    { name: "Tratamento de Canal (pré-molares)", priceCents: 70000, aliases: canalShared },
    { name: "Tratamento de Canal (molares)", priceCents: 85000, aliases: canalShared },
    { name: "Retratamento de Canal (dentes anteriores)", priceCents: 65000, aliases: ["retratamento", "retratamento de canal", "refazer canal"] },
    { name: "Retratamento de Canal (pré-molares)", priceCents: 75000, aliases: ["retratamento", "retratamento de canal", "refazer canal"] },
    { name: "Retratamento de Canal (molares)", priceCents: 95000, aliases: ["retratamento", "retratamento de canal", "refazer canal"] },
  ];
  for (const v of canalVariants) {
    const exists = await findTreatment(v.name);
    if (exists) {
      console.log(`  ℹ️  "${v.name}" já existe`);
      continue;
    }
    await db.insert(treatments).values({
      clinicId: VITALLI_ID,
      name: v.name,
      durationMinutes: endodontia!.durationMinutes,
      description: endodontia!.description,
      requiresEvaluationFirst: true,
      keywordMatchEnabled: true,
      aliases: v.aliases,
      isAesthetic: false,
      priceCents: v.priceCents,
      priceKind: "fixed",
      priceUnit: "por dente",
      priceQuotableInChat: true,
      createdAt: now,
      updatedAt: now,
    });
    console.log(`  ✅ "${v.name}" — R$ ${(v.priceCents / 100).toFixed(0)} por dente`);
  }
  console.log("✅ Canal: 6 variantes cotáveis (o guard de ambiguidade apresenta as opções quando o lead fala só \"canal\")");

  // ── 6. Pipelines ──
  await db
    .update(treatments)
    .set({
      pipelineSteps: buildLentesPipeline({
        cardPremium: newIds["Valores Lente em Resina Premium"],
        cardEstratificada: newIds["Valores Lente em Resina Estratificada"],
        exemploFoto: newIds["Exemplo Foto Avaliação (frontal e perfil)"],
      }),
      updatedAt: now,
    })
    .where(eq(treatments.id, umbrella!.id));
  console.log("✅ Pipeline de lentes: cards de valores na apresentação + exemplo antes do pedido de foto");

  for (const t of [remocao!, substituicao!]) {
    if (!t.pipelineSteps) continue;
    if (t.pipelineSteps.some((s) => s.type === "content" && s.label === "Exemplo de foto")) {
      console.log(`  ℹ️  Pipeline de "${t.name}" já tem o exemplo`);
      continue;
    }
    await db
      .update(treatments)
      .set({ pipelineSteps: withExemploStep(t.pipelineSteps, newIds["Exemplo Foto Avaliação (frontal e perfil)"]), updatedAt: now })
      .where(eq(treatments.id, t.id));
    console.log(`  ✅ Pipeline de "${t.name}": exemplo de foto inserido antes do photo step`);
  }

  // ── 7. Playbook v4 (clona ativa, autoriza as 10 mídias, ativa) ──
  const finalMediaIds = [KEEP_VIDEO_ESTRATIFICADA, KEEP_FOTO_PREMIUM, ...Object.values(newIds)];
  const [createdVersion] = await db
    .insert(playbookVersions)
    .values({
      clinicId: VITALLI_ID,
      name: V4_NAME,
      status: "draft",
      specialty: activePlaybook.specialty,
      toneOfVoice: activePlaybook.toneOfVoice,
      receptionistName: activePlaybook.receptionistName,
      differentials: activePlaybook.differentials,
      commercialPolicy: V4_COMMERCIAL_POLICY,
      objections: activePlaybook.objections,
      notes: V4_NOTES,
      mediaAssetIds: finalMediaIds,
      mediaLibrary: [],
    })
    .returning({ id: playbookVersions.id });

  await db
    .update(playbookVersions)
    .set({ status: "historical", updatedAt: now })
    .where(and(eq(playbookVersions.clinicId, VITALLI_ID), ne(playbookVersions.id, createdVersion.id), ne(playbookVersions.status, "draft")));
  await db
    .update(playbookVersions)
    .set({ status: "active", updatedAt: now })
    .where(eq(playbookVersions.id, createdVersion.id));

  const clinicFields = compileToClinicFields({
    specialty: activePlaybook.specialty,
    toneOfVoice: activePlaybook.toneOfVoice,
    differentials: activePlaybook.differentials as string[] | null,
    commercialPolicy: V4_COMMERCIAL_POLICY,
    objections: activePlaybook.objections as { objection: string; response: string }[] | null,
  });
  await db.update(organizations).set({ ...clinicFields, updatedAt: now }).where(eq(organizations.id, VITALLI_ID));

  console.log(`\n✅ Playbook v4 criado e ATIVADO (${createdVersion.id}) com ${finalMediaIds.length} mídias autorizadas.`);
  console.log("\n🏁 Aplicação completa. Clínica segue em shadow mode — nada chega a lead real.\n");
  process.exit(0);
}

main().catch((e) => {
  console.error("❌", e instanceof Error ? e.message : e);
  process.exit(1);
});
