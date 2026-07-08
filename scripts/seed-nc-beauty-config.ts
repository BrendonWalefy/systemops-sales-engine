/**
 * NC Beauty & Clinic — Config inicial v1 (Natália Costa — estética e bem-estar)
 *
 * Fontes:
 *   • Reunião de pré-venda 07/07/2026 (notas "NC Beauty & clinic.md")
 *   • "Guia de Serviços NC" (PDF de preços público da clínica)
 *   • 7 conversas reais capturadas em shadow mode em 07/07/2026 (tom da Natália:
 *     caloroso, apelidos carinhosos, "me conta uma coisinha", uma pergunta por vez,
 *     emojis 🥰💕✨, funil de qualificação de pele antes de indicar tratamento)
 *
 * Arquitetura de responsabilidades (config ownership):
 *   treatments.priceCents  → TODOS os preços (fato estruturado; prosa derivada
 *                            por composePriceSection — zero R$ em texto livre)
 *   commercialPolicy       → políticas em prosa SEM valores em R$ (sinal 30%,
 *                            pré-reserva, janelas de manutenção, pagamento)
 *   notes                  → funis comportamentais (pele, cílios, sobrancelha),
 *                            regra "não passar preço no primeiro interesse"
 *   objections[]           → objeções reais (henna que não pega, sinal, só com a Naty)
 *   professionals          → Natália, Juliana, Daniela com grade ter–sáb
 *
 * Pendências conhecidas (ver docs/product/todos-nc-beauty.md):
 *   • durações são ESTIMATIVAS — confirmar com a Natália antes do go-live
 *   • chave Pix do sinal não coletada (ficha bloco D4)
 *   • parser de business_hours não sabe "ter–sáb" (segunda entra errada no SlotEngine)
 *
 * Run: npx dotenv -e .env.local -- npx tsx scripts/seed-nc-beauty-config.ts
 */

import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { randomUUID } from "crypto";
import {
  playbookVersions,
  treatments,
  organizations,
  professionals,
} from "../src/infrastructure/db/schema";
import type { ProfessionalWorkSchedule } from "../src/domain/entities/professional";
import { and, eq, ne } from "drizzle-orm";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) { console.error("❌ DATABASE_URL not set"); process.exit(1); }

const sql = postgres(connectionString, { max: 1 });
const db = drizzle(sql);

const CLINIC_ID = "2b0028b1-6bf3-42d7-852e-62a8b5ca1035";

// ─────────────────────────────────────────────────────────────────────────────
// ORGANIZAÇÃO — identidade, horário e vocabulário do segmento
// ─────────────────────────────────────────────────────────────────────────────
const GREETING =
  "Oi, tudo bem? 💕 Sou a Bia, assistente da NC Beauty & Clinic. Me conta: você quer cuidar dos cílios, das sobrancelhas ou da pele? Vou te ajudar a encontrar o melhor pra você ✨";

// Estúdio atende terça a sexta 13h–19h e sábado 10h–17h (reunião 07/07).
// ATENÇÃO: o parser (ClinicTimezone.parseBusinessHours) só modela seg–sex+sáb;
// segunda-feira entra indevidamente no cálculo de slots — gap documentado no
// todos-nc-beauty.md. O texto abaixo é o que a IA verbaliza (correto).
const BUSINESS_HOURS = "Terça a sexta das 13h às 19h. Sábado das 10h às 17h.";

// ─────────────────────────────────────────────────────────────────────────────
// TONE OF VOICE — modelado nas mensagens reais da Natália (shadow 07/07)
// ─────────────────────────────────────────────────────────────────────────────
const TONE_OF_VOICE =
  "Calorosa, próxima e cuidadosa, como a própria Natália atende: trata a cliente pelo nome (vale o apelido carinhoso se a cliente usar), usa expressões como \"me conta uma coisinha\" e responde agradecimento com \"imagina\". Emojis com carinho e moderação (🥰 💕 ✨ 🩷), no máximo um ou dois por mensagem. Sempre uma pergunta por vez, nunca duas na mesma mensagem. Acolhe primeiro, entende a necessidade e só então indica o procedimento. Português brasileiro natural de WhatsApp, frases curtas, sem formalidade.";

// ─────────────────────────────────────────────────────────────────────────────
// NOTES — SOMENTE funis comportamentais e conduta. Sem R$, sem pagamento,
// sem texto de objeção (lint de publish: blockingPlaybookNotesIssues).
// ─────────────────────────────────────────────────────────────────────────────
const NOTES = `QUALIFICAR ANTES DE INFORMAR VALORES:
Nunca informe valores na primeira mensagem de interesse. Primeiro entenda a necessidade da cliente, uma pergunta por vez; depois de entender, indique o procedimento certo e aí sim informe o valor com naturalidade.

FUNIL DE PELE — execute quando a lead demonstrar interesse em tratamentos faciais (limpeza de pele, manchas, espinhas, acne, cravos, oleosidade, peeling, microagulhamento, hydra gloss):
Passo 1 — pergunte se ela já fez algum tratamento facial ou se seria a primeira experiência.
Passo 2 — pergunte o que mais incomoda hoje: manchas, cravos, oleosidade, acne, textura, ou se ela quer apenas manter a pele saudável e iluminada.
Passo 3 — se citar espinhas, pergunte se ainda aparecem com frequência ou se o que mais incomoda são as manchas que elas deixaram.
Passo 4 — com a necessidade mapeada, indique o tratamento mais adequado e explique o porquê em linguagem simples.

FUNIL DE CÍLIOS — execute quando a lead pedir extensão de cílios sem especificar a técnica:
Passo 1 — pergunte que estilo ela prefere: um efeito mais natural e delicado ou um olhar mais marcado e volumoso. Pergunte também se ela já usou extensão antes.
Passo 2 — indique a técnica mais próxima do perfil dela: técnicas comuns para efeito clássico e natural; técnicas gringas como Fox Eyes, Wispy e CostaLash para olhar mais marcado.
Passo 3 — se ela já tem extensão feita aqui, pergunte há quantos dias foi a aplicação, para direcionar entre manutenção e nova aplicação conforme a política comercial. Lembre que os volumes Sirena, Express e Capping não possuem manutenção.

SOBRANCELHAS:
O designer é personalizado conforme a estrutura da sobrancelha e do rosto da cliente. Se a cliente gosta de efeito bem marcado, sugira o designer com henna. Nunca combine henna com Brow Lamination — nesse caso usamos tintura. A durabilidade da henna varia com a pele de cada cliente.

CLIENTE NOVA E CLIENTE DA CASA:
Antes de confirmar horário de cliente nova, siga a regra de sinal da política comercial. Quando a cliente enviar comprovante, agradeça com carinho e avise que a equipe confirma em seguida — a validação do comprovante é sempre da equipe, nunca sua.

ESCALADA IMEDIATA PARA A EQUIPE:
Comprovantes de pagamento, reclamações, remarcação de procedimento já pago e qualquer avaliação de pele ou de fios que exija olhar profissional.

ENDEREÇO:
Informe o endereço completo apenas ao confirmar agendamento ou se a cliente perguntar.`;

// ─────────────────────────────────────────────────────────────────────────────
// COMMERCIAL POLICY — políticas em prosa, SEM valores em R$ (preço mora nos
// treatments e a prosa é derivada por composePriceSection).
// ─────────────────────────────────────────────────────────────────────────────
const COMMERCIAL_POLICY = `Formas de pagamento: Pix, dinheiro e cartão. Os pacotes de tratamento podem ser parcelados em até seis vezes no cartão, com juros da operadora.

Sinal para clientes novas: o horário só é confirmado com um sinal de 30% do valor do procedimento, pago por Pix, e esse valor é abatido do total no dia do atendimento. Cancelamento com menos de 24 horas de antecedência: o sinal não é devolvido. Com mais de 24 horas: é possível reagendar, mas o sinal não é devolvido em dinheiro. A pré-reserva segura o horário até 3 dias antes do atendimento; se o sinal não for pago até lá, o horário é liberado para outras clientes. Clientes da casa, a partir do quarto atendimento, não precisam de sinal.

Manutenção de extensão de cílios: até 15 dias e de 16 a 21 dias após a aplicação têm valores próprios, e técnicas gringas têm valor próprio de manutenção (os valores estão no cadastro de cada procedimento). Acima de 21 dias é cobrada uma nova aplicação. A manutenção exige pelo menos 40% dos fios preservados. Os volumes Sirena, Express e Capping não possuem manutenção. Após 120 dias da aplicação é sempre um procedimento novo.

Retornos recomendados: extensão de cílios costuma pedir retorno em cerca de 20 dias; limpeza de pele, a cada 2 ou 3 meses.`;

// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIALS — sem preços explícitos
// ─────────────────────────────────────────────────────────────────────────────
const DIFFERENTIALS = [
  "Natália tem mais de 10 anos de experiência na área da beleza e estética",
  "Técnica e designer indicados de forma personalizada, conforme a estrutura do rosto e o perfil de cada cliente",
  "CostaLash™ — técnica exclusiva da casa",
  "Equipe especializada: Natália (todos os procedimentos), Juliana (sobrancelhas) e Daniela (extensão de cílios)",
  "Produtos de qualidade e aplicação correta — resultado que dura",
  "Atendimento próximo e cuidadoso, com acompanhamento de retorno",
];

// ─────────────────────────────────────────────────────────────────────────────
// OBJECTIONS — baseadas nas conversas reais e na reunião. Prosa TTS-friendly.
// ─────────────────────────────────────────────────────────────────────────────
const OBJECTIONS = [
  {
    objection: "Está caro / não cabe no meu bolso agora",
    response:
      "Entendo você! 💕 A gente trabalha com produtos de qualidade e um resultado que dura de verdade — e os pacotes podem ser parcelados no cartão em até seis vezes. Me conta o que você está procurando que eu te ajudo a encontrar a opção que cabe melhor no seu momento.",
  },
  {
    objection: "Henna não pega em mim / não durou nada da última vez",
    response:
      "A durabilidade da henna depende muito da pele, mas usar um produto de qualidade e fazer a mistura correta conta muito! Aqui a gente usa produtos bons e aplicação certinha — e se você gosta de efeito marcado, a Naty avalia o que vai segurar melhor na sua pele. 🥰",
  },
  {
    objection: "Extensão estraga os cílios naturais?",
    response:
      "Pode ficar tranquila! Aplicada corretamente, fio a fio e com o peso certo para a sua estrutura, a extensão não danifica os fios naturais. Por isso a avaliação do olhar é tão importante — a técnica é escolhida para o seu caso.",
  },
  {
    objection: "Dói? Tenho medo de fazer",
    response:
      "Não dói, viu? A aplicação é super tranquila — você fica deitadinha de olhos fechados e muita cliente até cochila. 💕 Qualquer desconforto você avisa na hora e a profissional ajusta.",
  },
  {
    objection: "Quanto tempo dura a extensão de cílios?",
    response:
      "Com os cuidados certinhos, a extensão dura em média três semanas. Por isso a manutenção é indicada em até 21 dias — assim o olhar fica sempre preenchido. ✨",
  },
  {
    objection: "Por que preciso pagar sinal?",
    response:
      "O sinal é só para garantir o seu horário certinho — ele é abatido do valor total no dia do atendimento, então não é um custo a mais. E a partir do quarto atendimento você já é cliente da casa e não precisa mais! 🥰",
  },
  {
    objection: "Vou pensar...",
    response:
      "Claro, sem pressa nenhuma! 💕 Qualquer dúvida é só me chamar aqui. Só te aviso que a agenda costuma encher rápido, principalmente aos sábados — quando decidir, me chama que eu encontro o melhor horário pra você. ✨",
  },
  {
    objection: "Só quero ser atendida pela Natália",
    response:
      "A Naty é incrível mesmo! 🥰 Ela treinou pessoalmente a equipe — a Juliana cuida das sobrancelhas e a Daniela das extensões, com o mesmo padrão de cuidado. Se preferir esperar um horário com a Naty, eu te aviso quando abrir; e se quiser ser atendida antes, te coloco com a especialista da equipe.",
  },
  {
    objection: "Posso cancelar ou remarcar meu horário?",
    response:
      "Pode sim! Se avisar com mais de 24 horas de antecedência a gente reagenda seu horário sem problema. Com menos de 24 horas o sinal não é devolvido, tá? Por isso qualquer imprevisto me avisa o quanto antes que eu resolvo pra você. 🤍",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// TREATMENTS — preços do "Guia de Serviços NC" como FATO estruturado.
// Durações são ESTIMATIVAS (confirmar com a Natália — ficha bloco B2).
// Descrições factuais sem R$ (gate blockingTreatmentDescriptionIssues).
// ─────────────────────────────────────────────────────────────────────────────
type TreatmentSeed = {
  name: string;
  durationMinutes: number;
  description: string;
  aliases: string[];
  priceCents: number;
  priceUnit?: string;
};

const TREATMENTS: TreatmentSeed[] = [
  // — Cílios —
  {
    name: "Extensão de cílios — Técnicas Comuns",
    durationMinutes: 120,
    description:
      "Extensão de cílios nas técnicas Clássico, Brasileiro, Egípcio 3D, Árabe 4D e Inglês 5D. Efeito do natural ao volumoso, escolhido conforme a estrutura do olhar da cliente.",
    aliases: ["cílios", "extensão de cílios", "alongamento de cílios", "clássico", "volume brasileiro", "egípcio", "árabe", "inglês"],
    priceCents: 15000,
  },
  {
    name: "Extensão de cílios — Técnicas Gringas",
    durationMinutes: 120,
    description:
      "Extensão de cílios nas técnicas Fox Eyes, Wispy, Efeito Rímel, Anime e CostaLash, técnica exclusiva da casa. Olhar mais marcado, moderno e sofisticado.",
    aliases: ["cílios", "extensão de cílios", "alongamento de cílios", "fox eyes", "wispy", "costalash", "anime", "efeito rímel", "técnica gringa"],
    priceCents: 18000,
  },
  {
    name: "Lash Lifting",
    durationMinutes: 60,
    description:
      "Curvatura e alinhamento dos fios naturais, sem extensão. Efeito de cílios levantados e alongados com o que a cliente já tem.",
    aliases: ["lash lifting", "lifting de cílios"],
    priceCents: 15000,
  },
  {
    name: "Capping 40 dias",
    durationMinutes: 120,
    description:
      "Volume com duração estendida de até 40 dias. Não possui manutenção — ao final do período é feita uma nova aplicação.",
    aliases: ["capping"],
    priceCents: 20000,
  },
  {
    name: "Volume Sirena",
    durationMinutes: 120,
    description: "Volume Sirena. Não possui manutenção — ao final é feita uma nova aplicação.",
    aliases: ["sirena"],
    priceCents: 12000,
  },
  {
    name: "Volume Express",
    durationMinutes: 90,
    description: "Volume Express, aplicação mais rápida. Não possui manutenção — ao final é feita uma nova aplicação.",
    aliases: ["express"],
    priceCents: 10000,
  },
  {
    name: "Manutenção de cílios (até 15 dias)",
    durationMinutes: 90,
    description:
      "Manutenção da extensão feita até 15 dias após a aplicação. Exige pelo menos 40% dos fios preservados.",
    aliases: ["manutenção", "manutenção de cílios"],
    priceCents: 8000,
  },
  {
    name: "Manutenção de cílios (16 a 21 dias)",
    durationMinutes: 90,
    description:
      "Manutenção da extensão feita de 16 a 21 dias após a aplicação. Exige pelo menos 40% dos fios preservados. Acima de 21 dias é cobrada uma nova aplicação.",
    aliases: ["manutenção", "manutenção de cílios"],
    priceCents: 9000,
  },
  {
    name: "Manutenção de cílios — técnicas gringas",
    durationMinutes: 90,
    description:
      "Manutenção das técnicas gringas (Fox Eyes, Wispy, CostaLash, Anime, Efeito Rímel). Exige pelo menos 40% dos fios preservados.",
    aliases: ["manutenção", "manutenção gringa"],
    priceCents: 10000,
  },
  // — Sobrancelhas —
  {
    name: "Designer de Sobrancelha",
    durationMinutes: 30,
    description:
      "Designer personalizado conforme a estrutura da sobrancelha e do rosto da cliente.",
    aliases: ["sobrancelha", "design de sobrancelha", "designer de sobrancelha"],
    priceCents: 4000,
  },
  {
    name: "Designer com Henna ou Tintura",
    durationMinutes: 45,
    description:
      "Designer personalizado com aplicação de henna ou tintura, para efeito mais marcado. A durabilidade da henna varia conforme a pele.",
    aliases: ["henna", "tintura", "sobrancelha com henna"],
    priceCents: 6500,
  },
  {
    name: "Brow Lamination",
    durationMinutes: 60,
    description:
      "Alinhamento e fixação dos fios da sobrancelha para efeito preenchido e penteado. Não é combinada com henna — quando necessário, usamos tintura.",
    aliases: ["brow lamination", "lamination", "sobrancelha laminada"],
    priceCents: 15000,
  },
  {
    name: "Reconstrução de Sobrancelhas",
    durationMinutes: 45,
    description:
      "Tratamento para recuperar falhas e estimular o crescimento dos fios. Sessão avulsa; também disponível em pacote de cinco sessões.",
    aliases: ["reconstrução de sobrancelha", "reconstrução"],
    priceCents: 8000,
    priceUnit: "por sessão",
  },
  {
    name: "Pacote Reconstrução de Sobrancelhas (5 sessões)",
    durationMinutes: 45,
    description:
      "Pacote completo de reconstrução de sobrancelhas com cinco sessões.",
    aliases: ["pacote reconstrução"],
    priceCents: 38000,
  },
  // — Estética facial —
  {
    name: "Limpeza de Pele",
    durationMinutes: 90,
    description:
      "Limpeza de pele completa. Indicada a cada 2 ou 3 meses para manter a pele saudável.",
    aliases: ["limpeza de pele", "limpeza"],
    priceCents: 15000,
  },
  {
    name: "SPA Facial Premium",
    durationMinutes: 60,
    description: "Protocolo de relaxamento e hidratação profunda da pele do rosto.",
    aliases: ["spa facial", "spa facial premium"],
    priceCents: 10000,
  },
  {
    name: "Peeling + Nano",
    durationMinutes: 60,
    description:
      "Peeling com nanotecnologia para renovação da pele, textura e viço.",
    aliases: ["peeling", "pelling", "peeling nano"],
    priceCents: 15000,
  },
  {
    name: "Microagulhamento Facial",
    durationMinutes: 60,
    description:
      "Estímulo de colágeno com microagulhas para textura, cicatrizes de acne e rejuvenescimento.",
    aliases: ["microagulhamento"],
    priceCents: 10000,
  },
  {
    name: "Hydra Gloss",
    durationMinutes: 45,
    description:
      "Hidratação profunda com efeito glow imediato. Sessão avulsa; também disponível em pacote de três sessões.",
    aliases: ["hydra gloss", "hydragloss", "hidra gloss"],
    priceCents: 8000,
    priceUnit: "por sessão",
  },
  {
    name: "Pacote Hydra Gloss (3 sessões)",
    durationMinutes: 45,
    description: "Pacote de Hydra Gloss com três sessões.",
    aliases: ["pacote hydra gloss"],
    priceCents: 22000,
  },
  {
    name: "Tratamento de Manchas e Espinhas (pacote)",
    durationMinutes: 60,
    description:
      "Programa completo para manchas e espinhas: cinco peelings e cinco microagulhamentos, com um SPA Facial Premium de brinde. Indicado para acne ativa e manchas deixadas por espinhas.",
    aliases: ["manchas", "espinhas", "acne", "tratamento de manchas", "melasma"],
    priceCents: 70000,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// PROFESSIONALS — grade ter–sex 13h–19h e sáb 10h–17h (reunião 07/07).
// Grades individuais reais (revezamento de cadeira) ainda não coletadas.
// ─────────────────────────────────────────────────────────────────────────────
const STUDIO_SCHEDULE: ProfessionalWorkSchedule = {
  2: { startHour: 13, startMinute: 0, endHour: 19, endMinute: 0 },
  3: { startHour: 13, startMinute: 0, endHour: 19, endMinute: 0 },
  4: { startHour: 13, startMinute: 0, endHour: 19, endMinute: 0 },
  5: { startHour: 13, startMinute: 0, endHour: 19, endMinute: 0 },
  6: { startHour: 10, startMinute: 0, endHour: 17, endMinute: 0 },
};

const PROFESSIONALS: { name: string; specialty: string; color: string }[] = [
  { name: "Natália Costa", specialty: "Todos os procedimentos", color: "#C2703D" },
  { name: "Juliana", specialty: "Sobrancelhas", color: "#8B5CF6" },
  { name: "Daniela", specialty: "Extensão de cílios", color: "#10B981" },
];

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log("🚀 NC Beauty & Clinic — seed config inicial v1\n");

  // 1. Organização: identidade, horário e vocabulário
  await db
    .update(organizations)
    .set({
      specialty: "Estética e bem-estar — cílios, sobrancelhas e estética facial",
      businessHours: BUSINESS_HOURS,
      greetingMessage: GREETING,
      contactNoun: "cliente",
      bookingNoun: "horário",
      serviceNoun: "procedimento",
      agentRole: "assistente virtual",
      businessDescriptor:
        "clínica de estética e bem-estar especializada em extensão de cílios, sobrancelhas e tratamentos faciais",
      postAppointmentBufferMinutes: 15,
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, CLINIC_ID));
  console.log("✅ Organização: identidade, horários ter–sáb e vocabulário (cliente/horário/procedimento)");

  // 2. Arquiva versões de playbook não-históricas
  const archived = await db
    .update(playbookVersions)
    .set({ status: "historical", updatedAt: new Date() })
    .where(
      and(
        eq(playbookVersions.clinicId, CLINIC_ID),
        ne(playbookVersions.status, "historical"),
      ),
    )
    .returning({ name: playbookVersions.name });
  if (archived.length > 0) {
    console.log(`✅ Arquivada(s): ${archived.map((v) => v.name).join(", ")}`);
  }

  // 3. Nova versão ativa
  const newVersion = await db
    .insert(playbookVersions)
    .values({
      id: randomUUID(),
      clinicId: CLINIC_ID,
      name: "NC Beauty — Config inicial v1 (reunião 07/07 + shadow 07/07)",
      status: "active",
      specialty: "Estética e bem-estar — cílios, sobrancelhas e estética facial",
      receptionistName: "Bia",
      toneOfVoice: TONE_OF_VOICE,
      notes: NOTES,
      commercialPolicy: COMMERCIAL_POLICY,
      differentials: DIFFERENTIALS,
      objections: OBJECTIONS,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning({ id: playbookVersions.id, name: playbookVersions.name });
  console.log(`✅ Playbook ativo: "${newVersion[0].name}"`);

  // 4. Substitui treatments pelos 21 do Guia de Serviços
  const deleted = await db
    .delete(treatments)
    .where(eq(treatments.clinicId, CLINIC_ID))
    .returning({ id: treatments.id });
  if (deleted.length > 0) console.log(`✅ ${deleted.length} treatment(s) anterior(es) removido(s)`);

  const now = new Date();
  await db.insert(treatments).values(
    TREATMENTS.map((t) => ({
      id: randomUUID(),
      clinicId: CLINIC_ID,
      name: t.name,
      durationMinutes: t.durationMinutes,
      description: t.description,
      requiresEvaluationFirst: false,
      aliases: t.aliases,
      isAesthetic: true,
      priceCents: t.priceCents,
      priceKind: "fixed" as const,
      priceUnit: t.priceUnit ?? null,
      priceQuotableInChat: true,
      priceDeductible: false,
      createdAt: now,
      updatedAt: now,
    })),
  );
  console.log(`✅ ${TREATMENTS.length} treatments inseridos (preço estruturado, cotável no chat)`);

  // 5. Profissionais (upsert por nome)
  for (const p of PROFESSIONALS) {
    const existing = await db
      .select({ id: professionals.id })
      .from(professionals)
      .where(and(eq(professionals.clinicId, CLINIC_ID), eq(professionals.name, p.name)))
      .then((r) => r[0] ?? null);
    if (existing) {
      await db
        .update(professionals)
        .set({ specialty: p.specialty, color: p.color, workSchedule: STUDIO_SCHEDULE, isActive: true, updatedAt: now })
        .where(eq(professionals.id, existing.id));
      console.log(`✅ Profissional atualizada: ${p.name} (${p.specialty})`);
    } else {
      await db.insert(professionals).values({
        id: randomUUID(),
        clinicId: CLINIC_ID,
        name: p.name,
        specialty: p.specialty,
        color: p.color,
        workSchedule: STUDIO_SCHEDULE,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      console.log(`✅ Profissional criada: ${p.name} (${p.specialty})`);
    }
  }

  console.log("\n─────────────────────────────────────────────────────");
  console.log("Config v1 aplicada. Pendências antes do go-live:");
  console.log("  • Confirmar durações reais de cada procedimento com a Natália");
  console.log("  • Coletar chave Pix do sinal + nome no comprovante");
  console.log("  • Desligar o autoresponder do WhatsApp Business dela (colide com a IA)");
  console.log("  • Segunda-feira entra errada no SlotEngine (parser seg–sex) — ver todos-nc-beauty.md");
  console.log("\n📋 TESTE no simulador (Produção → NC Beauty & Clinic):");
  console.log("  A: 'quero colocar cílios'        → funil (estilo natural × marcado), sem preço na 1ª resposta");
  console.log("  B: 'quanto custa limpeza de pele' → funil de pele antes do valor");
  console.log("  C: 'a henna não pega em mim'      → objeção da durabilidade (resposta real da Natália)");
  console.log("  D: 'quero manutenção'             → pergunta há quantos dias foi a aplicação");
  console.log("  E: 'só quero com a Natália'       → objeção equipe treinada + oferta de espera");
  console.log("  F: 'posso cancelar?'              → política de sinal 30% / 24h / reagendamento");

  await sql.end();
}

main().catch((err) => {
  console.error("❌ Erro:", err);
  process.exit(1);
});
