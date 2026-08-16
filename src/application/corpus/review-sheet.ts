import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { CorpusCase, Journey } from "@/application/corpus/corpus-case";
import { REVIEW_CHECKLIST_QUESTIONS } from "@/application/corpus/review-checklist";

/**
 * Folha de revisão e leitura da folha preenchida.
 *
 * A folha existe porque ninguém deveria ter de ler JSONL para revisar um caso.
 * Ela mostra o turno, o contexto, os fatos disponíveis do tenant, as duas
 * respostas observadas e as quatro perguntas em branco — e nada mais, para o
 * segundo revisor não ser ancorado pelo rótulo do primeiro.
 */

export const REVIEW_SHEET_ANSWER_PATTERN = /\[([SNsn ])\]/g;

export type SheetAnswers = {
  caseId: string;
  ai: boolean[] | null;
  human: boolean[] | null;
  /** Entendimento e ação em texto livre, como o revisor escreveu. */
  understanding: string;
  actionResult: string;
  notes: string;
};

type TenantConfig = {
  ref: string;
  businessHours?: string;
  services?: Array<{
    name: string;
    priceCents: number | null;
    priceUnit?: string;
    freeEvaluation?: boolean;
    description?: string;
  }>;
  knownAmbiguity?: string;
  paymentPolicy?: string;
  priceDeliveredAsImage?: boolean;
  facts?: Record<
    string,
    { status: "known" | "not_provided" | "contradicted"; value: string | null; source: string | null }
  >;
};

/** Rótulo legível de cada categoria de fato, para o revisor não ler chave. */
const FACT_LABELS: Readonly<Record<string, string>> = {
  address: "endereço / localização",
  businessHours: "horário de funcionamento",
  serviceAttributes: "atributo de serviço",
  mediaLibrary: "mídia disponível",
  commercialPolicy: "política comercial",
};

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/**
 * Descrição de serviço entra na folha quando o turno fala **daquele** serviço.
 *
 * A segunda revisão marcou uma comparação de técnicas como inventada porque a
 * folha dizia só "12 de 17 serviços têm descrição cadastrada". O atributo estava
 * escrito na fixture; o revisor é que não podia vê-lo.
 *
 * O casamento é por token distintivo — a palavra que separa este serviço dos
 * outros do mesmo catálogo. "Resina" aparece em meia dúzia de serviços de uma
 * clínica e não identifica nenhum; "simplificada" identifica. Sem esse corte, um
 * turno que diz "resina" arrastaria o catálogo inteiro para a folha e afogaria o
 * fato que decide o julgamento.
 */
function relevantDescriptions(
  services: NonNullable<TenantConfig["services"]>,
  turnText: string,
): Array<{ name: string; description: string }> {
  const tokensOf = (name: string): string[] =>
    fold(name)
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 5);

  const frequency = new Map<string, number>();
  for (const service of services) {
    for (const token of new Set(tokensOf(service.name))) {
      frequency.set(token, (frequency.get(token) ?? 0) + 1);
    }
  }

  const haystack = fold(turnText);
  return services.flatMap((service) => {
    if (!service.description) return [];
    const distinctive = tokensOf(service.name).filter(
      (token) => (frequency.get(token) ?? 0) <= 2,
    );
    return distinctive.some((token) => haystack.includes(token))
      ? [{ name: service.name, description: service.description }]
      : [];
  });
}

function formatPrice(cents: number | null): string {
  if (cents === null) return "sem preço cadastrado";
  return `R$ ${(cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
}

export function renderTenantFacts(config: TenantConfig, turnText = ""): string {
  const lines = [`- Horário: ${config.businessHours ?? "não declarado"}`];
  for (const service of config.services ?? []) {
    // A flag comercial vai junto do serviço: sem ela, "sem preço cadastrado"
    // é lido como "valor desconhecido", e a segunda revisão marcou uma resposta
    // correta como sem lastro exatamente por isso.
    const flags = [
      service.priceUnit,
      service.freeEvaluation ? "sem custo para o lead" : null,
    ].filter(Boolean);
    lines.push(
      `- ${service.name}: ${formatPrice(service.priceCents)}${flags.length ? ` (${flags.join("; ")})` : ""}`,
    );
  }
  for (const { name, description } of relevantDescriptions(
    config.services ?? [],
    turnText,
  )) {
    lines.push(
      `- Descrição cadastrada de "${name}" (fonte: treatments.description): ${description.replace(/\n/g, " ")}`,
    );
  }
  if (config.paymentPolicy) lines.push(`- Pagamento: ${config.paymentPolicy}`);
  if (config.priceDeliveredAsImage) {
    lines.push("- Preço deste tenant é entregue por arte, não por texto.");
  }
  if (config.knownAmbiguity) lines.push(`- Ambiguidade conhecida: ${config.knownAmbiguity}`);

  // Fato ausente é estado declarado, não silêncio: sem esta seção o revisor não
  // consegue separar "a folha não mostrou" de "o tenant não tem", e trata a
  // segunda como se a resposta tivesse inventado.
  const facts = Object.entries(config.facts ?? {});
  const known = facts.filter(([, fact]) => fact.status === "known");
  const missing = facts.filter(([, fact]) => fact.status !== "known");
  for (const [key, fact] of known) {
    lines.push(
      `- ${FACT_LABELS[key] ?? key}: ${fact.value ?? "registrado"} (fonte: ${fact.source})`,
    );
  }
  if (missing.length > 0) {
    lines.push(
      `- **Não fornecido pela configuração** — ${missing
        .map(([key, fact]) =>
          `${FACT_LABELS[key] ?? key}${fact.status === "contradicted" ? " (contradito)" : ""}`,
        )
        .join(", ")}. Afirmação da resposta sobre isso **não tem lastro**; ausência na folha não é o mesmo que fato falso.`,
    );
  }
  return lines.join("\n");
}

const MEDIA_MARKER_RE = /\[MIDIA:([A-Z]+)\]/g;
const CLOCK_RE = /\b\d{1,2}(?:h(?:\d{2})?|:\d{2})\b/g;

/**
 * Evidência objetiva do turno que não é texto de conversa: mídia anexada e
 * horários já citados no fio.
 *
 * As duas existem porque a segunda revisão não conseguiu julgar sem elas — uma
 * resposta que diz "te enviei um vídeo" parece afirmação sem lastro quando o
 * anexo não aparece em lugar nenhum, e um horário confirmado parece inventado
 * quando o horário ofertado não está visível.
 */
function renderTurnEvidence(entry: CorpusCase): string[] {
  const lines: string[] = [];

  const mediaOf = (label: string, text: string | null): void => {
    if (!text) return;
    const kinds = [...text.matchAll(MEDIA_MARKER_RE)].map((m) => m[1]!.toLowerCase());
    if (kinds.length > 0) {
      lines.push(`- Mídia neste turno — ${label}: ${[...new Set(kinds)].join(", ")}`);
    }
  };
  mediaOf("mensagem do lead", entry.input.leadMessage);
  mediaOf("resposta da IA", entry.observed.aiResponse);
  mediaOf("resposta humana", entry.observed.humanResponse);

  // Side effect é a diferença entre a resposta *afirmar* que algo aconteceu e
  // algo ter acontecido. Sem ele na folha, "te enviei um vídeo" e "agendei
  // quarta às 15h" são só texto, e o revisor não tem como julgar lastro.
  const effects = entry.observed.sideEffects ?? [];
  for (const effect of effects) {
    lines.push(
      `- Registrado neste turno — ${effect.kind}: ${effect.detail} (fonte: ${effect.source})`,
    );
  }
  if (effects.length === 0) {
    // Ausência declarada, não silêncio: sem esta linha o revisor não distingue
    // "o turno não registrou agendamento" de "a folha não mostra side effect",
    // e uma confirmação como "Agendado!" fica sem como ser julgada.
    lines.push(
      "- Nenhuma ação registrada neste turno (sem agendamento, consulta de agenda, envio de mídia ou handoff observado).",
    );
  }

  const clocks = new Set<string>();
  for (const turn of entry.input.history) {
    if (turn.author === "lead") continue;
    for (const match of turn.body.matchAll(CLOCK_RE)) clocks.add(match[0]);
  }
  if (clocks.size > 0) {
    lines.push(`- Horários já citados no fio pela clínica: ${[...clocks].join(", ")}`);
  }

  return lines;
}

/** Todo o texto do turno, que é onde se descobre de qual serviço se fala. */
function turnText(entry: CorpusCase): string {
  return [
    entry.input.leadMessage,
    ...entry.input.history.map((turn) => turn.body),
    entry.observed.aiResponse ?? "",
    entry.observed.humanResponse ?? "",
  ].join(" ");
}

function quote(text: string | null): string {
  if (!text) return "> —";
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

/**
 * Amostra estratificada de calibração.
 *
 * Existe porque a primeira folha saiu na ordem alfabética dos shards e não
 * continha `price` nem `objection` — as duas jornadas de julgamento mais difícil
 * ficaram fora justamente da amostra que serve para calibrar o julgamento.
 *
 * Um grupo pode reunir jornadas vizinhas (agenda e agendamento; ambiguidade e
 * comparação) porque o que se calibra é o tipo de decisão, não o shard.
 */
export type CalibrationQuota = ReadonlyArray<{
  journeys: readonly Journey[];
  count: number;
}>;

export function selectCalibrationSample(
  cases: readonly CorpusCase[],
  quota: CalibrationQuota,
): CorpusCase[] {
  const selected: CorpusCase[] = [];

  for (const group of quota) {
    // Caso estruturalmente inválido nunca entra na calibração: o ground truth
    // dele é inconsistente, então a divergência que ele produz mede o caso.
    const pool = cases.filter(
      (entry) => group.journeys.includes(entry.journey) && !entry.validity,
    );

    // Agrupa por origem e serve em rodízio: um grupo servido só por casos
    // sintéticos ensina o revisor a reconhecer o formato do defeito em vez de
    // julgar a resposta. Ordenação por hash estável do caseId, nunca aleatória.
    const byKind = new Map<CorpusCase["source"]["kind"], CorpusCase[]>();
    for (const entry of pool) {
      const bucket = byKind.get(entry.source.kind) ?? [];
      bucket.push(entry);
      byKind.set(entry.source.kind, bucket);
    }
    const kinds = [...byKind.keys()].sort();
    for (const kind of kinds) {
      byKind.get(kind)!.sort((a, b) =>
        stableRank(a.caseId).localeCompare(stableRank(b.caseId)),
      );
    }

    const taken: CorpusCase[] = [];
    for (let round = 0; taken.length < group.count; round += 1) {
      let progressed = false;
      for (const kind of kinds) {
        if (taken.length >= group.count) break;
        const entry = byKind.get(kind)?.[round];
        if (entry) {
          taken.push(entry);
          progressed = true;
        }
      }
      if (!progressed) break;
    }
    selected.push(...taken);
  }

  return selected;
}

function stableRank(caseId: string): string {
  return createHash("sha256").update(caseId).digest("hex");
}

export function renderReviewSheet(params: {
  cases: CorpusCase[];
  tenantConfigDirectory: string;
  /**
   * Fatos objetivos do caso que não estão no histórico nem no catálogo do
   * tenant — objeção cadastrada no playbook, conteúdo extra recebido no nome de
   * exibição. Entram na seção de fatos porque o revisor precisa deles para
   * julgar; ficam fora do corpus porque não são rótulo.
   *
   * O texto tem de ser fato, não leitura do fato: sem "deveria", sem nome de
   * defeito, sem indicação de qual resposta era a melhor.
   */
  extraFacts?: Readonly<Record<string, readonly string[]>>;
}): string {
  const blocks = params.cases.map((entry) => {
    const config = JSON.parse(
      readFileSync(
        `${params.tenantConfigDirectory}/${entry.input.tenantConfigRef}.json`,
        "utf8",
      ),
    ) as TenantConfig;

    const history = entry.input.history.length
      ? entry.input.history
          .map((turn) => `- **${turn.author}**: ${turn.body.replace(/\n/g, " ")}`)
          .join("\n")
      : "- (sem histórico anterior)";

    const questions = REVIEW_CHECKLIST_QUESTIONS.map(
      (question, index) => `${index + 1}. ${question.question}`,
    ).join("\n");

    // A origem do caso fica de fora: "synthetic_regression" entrega o gabarito,
    // porque caso sintético foi escrito para ser defeito.
    return `## ${entry.caseId} · ${entry.journey}

**Mensagem do lead**

${quote(entry.input.leadMessage || "(turno iniciado pela clínica, sem mensagem do lead)")}

**Contexto — turnos anteriores**

${history}

**Quando** — turno de ${entry.source.capturedAt.slice(0, 10)}

**Fatos disponíveis do tenant \`${entry.input.tenantConfigRef}\`**

${[renderTenantFacts(config, turnText(entry)), ...renderTurnEvidence(entry), ...(params.extraFacts?.[entry.caseId] ?? []).map((fact) => `- ${fact}`)].join("\n")}

**Resposta da IA**

${quote(entry.observed.aiResponse)}

**Resposta humana**

${quote(entry.observed.humanResponse)}

**Perguntas**

${questions}

**Sua resposta** — marque \`S\` ou \`N\` dentro de cada colchete; deixe em branco o que não se aplica.

\`\`\`
${entry.caseId} IA  [ ] [ ] [ ] [ ]
${entry.caseId} HUM [ ] [ ] [ ] [ ]
${entry.caseId} UND:
${entry.caseId} ACT:
${entry.caseId} OBS:
\`\`\`
`;
  });

  return `# Folha de revisão do corpus

Este arquivo é **cego**: não contém rótulo, parecer, nota, entendimento, ação
esperada nem tag de nenhum revisor anterior. Responda com o seu julgamento.

Preencha apenas os blocos \`\`\` de cada caso.

**IA / HUM** — marque \`S\` ou \`N\` dentro de cada colchete, na ordem das quatro
perguntas. Linha sem nenhuma marca é lida como "não revisado" e não conta como
divergência. Resposta que não existe (\`—\`) não se revisa: deixe a linha em branco.

**UND** — o que o lead está pedindo, em uma expressão curta em kebab-case
(exemplos de forma, não de conteúdo: \`algo-de-algo\`, \`acao-alvo\`), seguido do
movimento de diálogo entre \`new_topic\`, \`answers_pending\`, \`acknowledges\`,
\`repeats\`, \`closes\`. Acrescente entidades que você reconhecer (serviço, data,
quantidade) e se há ambiguidade real entre opções.

**ACT** — que ação o sistema deveria ter tomado neste turno, na sua palavra. Não
existe lista fechada aqui de propósito.

**OBS** — o que não cabe em sim ou não.

${blocks.join("\n---\n\n")}`;
}

/**
 * Lê a folha preenchida. Aceita `S`/`N` em qualquer caixa e trata linha sem
 * marca alguma como não revisada — que é diferente de "respondeu não" e não
 * pode entrar na conta de concordância.
 */
export function parseReviewSheet(markdown: string): SheetAnswers[] {
  const byCase = new Map<string, SheetAnswers>();

  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();
    const match =
      /^([a-z][a-z0-9-]*-\d{4})\s+(IA|HUM|OBS|UND|ACT)[:\s]\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, caseId, kind, rest] = match as unknown as [string, string, string, string];

    const entry = byCase.get(caseId) ?? {
      caseId,
      ai: null,
      human: null,
      understanding: "",
      actionResult: "",
      notes: "",
    };

    if (kind === "OBS") {
      entry.notes = rest.trim();
    } else if (kind === "UND") {
      entry.understanding = rest.trim();
    } else if (kind === "ACT") {
      entry.actionResult = rest.trim();
    } else {
      const answers = [...rest.matchAll(REVIEW_SHEET_ANSWER_PATTERN)].map((box) =>
        box[1]!.trim().toUpperCase(),
      );
      const answered = answers.filter((value) => value.length > 0);
      if (answered.length > 0) {
        const parsed = answers.map((value) => value === "S");
        if (kind === "IA") entry.ai = parsed;
        else entry.human = parsed;
      }
    }

    byCase.set(caseId, entry);
  }

  return [...byCase.values()];
}

export type AgreementReport = {
  reviewedCases: number;
  byField: Record<
    string,
    { compared: number; agreed: number; rate: number }
  >;
  disagreements: Array<{
    caseId: string;
    responder: "ai" | "human";
    field: string;
    firstReviewer: boolean;
    secondReviewer: boolean;
  }>;
};

const FIELD_ORDER = REVIEW_CHECKLIST_QUESTIONS.map((question) => question.field);

/**
 * Concordância por campo do checklist, que é a medida que o ciclo pede.
 * Divergência acima de 20% num campo significa pergunta mal formulada — a
 * correção é reescrever a pergunta, não negociar caso a caso.
 */
export function compareReviews(params: {
  cases: CorpusCase[];
  answers: SheetAnswers[];
}): AgreementReport {
  const byId = new Map(params.cases.map((entry) => [entry.caseId, entry]));
  const byField: AgreementReport["byField"] = Object.fromEntries(
    FIELD_ORDER.map((field) => [field, { compared: 0, agreed: 0, rate: 0 }]),
  );
  const disagreements: AgreementReport["disagreements"] = [];
  let reviewedCases = 0;

  for (const answer of params.answers) {
    const corpusCase = byId.get(answer.caseId);
    if (!corpusCase) continue;
    // Mesma razão da amostragem: caso inválido não entra na conta.
    if (corpusCase.validity) continue;
    if (!answer.ai && !answer.human) continue;
    reviewedCases += 1;

    for (const responder of ["ai", "human"] as const) {
      const second = responder === "ai" ? answer.ai : answer.human;
      const first = corpusCase.labels.prose[responder]?.checklist;
      if (!second || !first) continue;

      FIELD_ORDER.forEach((field, index) => {
        const secondValue = second[index];
        if (secondValue === undefined) return;
        const firstValue = first[field];
        byField[field]!.compared += 1;
        if (firstValue === secondValue) {
          byField[field]!.agreed += 1;
        } else {
          disagreements.push({
            caseId: answer.caseId,
            responder,
            field,
            firstReviewer: firstValue,
            secondReviewer: secondValue,
          });
        }
      });
    }
  }

  for (const stats of Object.values(byField)) {
    stats.rate = stats.compared === 0 ? 0 : stats.agreed / stats.compared;
  }

  return { reviewedCases, byField, disagreements };
}
