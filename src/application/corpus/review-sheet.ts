import { readFileSync } from "node:fs";
import type { CorpusCase } from "@/application/corpus/corpus-case";
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
  services?: Array<{ name: string; priceCents: number | null; priceUnit?: string }>;
  knownAmbiguity?: string;
  paymentPolicy?: string;
};

function formatPrice(cents: number | null): string {
  if (cents === null) return "sem preço cadastrado";
  return `R$ ${(cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
}

export function renderTenantFacts(config: TenantConfig): string {
  const lines = [`- Horário: ${config.businessHours ?? "não declarado"}`];
  for (const service of config.services ?? []) {
    lines.push(
      `- ${service.name}: ${formatPrice(service.priceCents)}${service.priceUnit ? ` (${service.priceUnit})` : ""}`,
    );
  }
  if (config.paymentPolicy) lines.push(`- Pagamento: ${config.paymentPolicy}`);
  if (config.knownAmbiguity) lines.push(`- Ambiguidade conhecida: ${config.knownAmbiguity}`);
  return lines.join("\n");
}

function quote(text: string | null): string {
  if (!text) return "> —";
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

export function renderReviewSheet(params: {
  cases: CorpusCase[];
  tenantConfigDirectory: string;
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

**Fatos disponíveis do tenant \`${entry.input.tenantConfigRef}\`**

${renderTenantFacts(config)}

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
