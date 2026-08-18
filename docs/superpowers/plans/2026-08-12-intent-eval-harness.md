# Intent Eval Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Medir offline a acurácia do `IntentClassifier` contra um dataset rotulado versionado, com baseline commitada e falha ponderada por severidade de confusão.

**Architecture:** Um diretório `evals/intent/` com dataset JSONL, matriz de severidade e módulos puros de carga, agregação e comparação de baseline; e um runner CLI em `scripts/eval-intent.ts` que instancia o `IntentClassifier` real. Os módulos puros são cobertos pela suíte vitest normal; só o runner toca a API da OpenAI. Nenhum caminho de produção é alterado.

**Tech Stack:** TypeScript, vitest, `tsx` como runner de script, `dotenv -e .env.local` para variáveis, SDK `openai` já presente.

## Global Constraints

- Spec de referência: `docs/superpowers/specs/2026-08-12-intent-eval-harness-design.md`. Nenhuma decisão deste plano pode contradizê-la.
- Nenhuma alteração em código de produção. Nada dentro de `src/core/`, `src/application/`, `src/app/` ou `src/infrastructure/` é editado. O harness apenas importa e lê.
- `npm run verify` continua sem chave de LLM e sem chamar API. Nenhum teste novo faz chamada de rede.
- Os dois estratos (`incident` e `prompt_rule`) são sempre reportados separados. Nunca somar num único número.
- `isClinicSegment` é obrigatório em todo caso. Sem default silencioso.
- Não existe campo `isFirstContact`: é derivado de `history` pelo classificador.
- Modelo default `gpt-4o-mini`, lido de `process.env.OPENAI_CLASSIFIER_MODEL` em `src/core/intelligence/IntentClassifier.ts:11`. Esse `const` é avaliado **na importação do módulo**, então trocar de modelo exige definir a env antes de um `await import()` dinâmico.
- Severidade de confusão vive só em `evals/intent/severity.ts`. Nenhum peso hardcoded no runner.

## File Structure

| Arquivo | Responsabilidade |
| --- | --- |
| `evals/intent/types.ts` | Tipos do caso, do resultado e do relatório. Sem lógica. |
| `evals/intent/severity.ts` | Matriz de custo por par `(esperado, obtido)` e a função que classifica um par em nível. |
| `evals/intent/cases.jsonl` | Dataset versionado, um caso por linha, os dois estratos no mesmo arquivo. |
| `evals/intent/load-cases.ts` | Lê e valida o JSONL. Rejeita caso inválido em vez de ignorar. |
| `evals/intent/report.ts` | Agrega resultados em estatística por estrato: acertos, níveis de severidade, confusões, dispersão. |
| `evals/intent/baseline.ts` | Compara relatório atual com a baseline commitada e decide reprovação. |
| `evals/intent/baseline.json` | Resultado commitado do modelo corrente. Criado na Task 6. |
| `scripts/eval-intent.ts` | CLI. Único ponto que instancia o classificador e chama a API. |
| `src/__tests__/EvalIntentHarness.test.ts` | Cobre `severity`, `load-cases`, `report` e `baseline` com dados sintéticos. |

---

### Task 1: Contratos, severidade e carga do dataset

**Files:**
- Create: `evals/intent/types.ts`
- Create: `evals/intent/severity.ts`
- Create: `evals/intent/load-cases.ts`
- Create: `evals/intent/cases.jsonl`
- Test: `src/__tests__/EvalIntentHarness.test.ts`

**Interfaces:**
- Consumes: `IntentType` de `@/core/intelligence/IntentClassifier`.
- Produces: `EvalCase`, `EvalStratum`, `SeverityLevel`, `classifyConfusion(expected, got): SeverityLevel`, `loadEvalCases(absolutePath): EvalCase[]`.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar em `src/__tests__/EvalIntentHarness.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyConfusion } from "../../evals/intent/severity";
import { loadEvalCases } from "../../evals/intent/load-cases";

describe("classifyConfusion", () => {
  it("acerto não tem severidade", () => {
    expect(classifyConfusion("price_inquiry", "price_inquiry")).toBe("none");
  });

  it("perder stop_contact é crítico", () => {
    expect(classifyConfusion("stop_contact", "farewell")).toBe("critical");
  });

  it("perder clinical_urgency é crítico", () => {
    expect(classifyConfusion("clinical_urgency", "general_question")).toBe("critical");
  });

  it("pergunta de preço lida como saudação é alta", () => {
    expect(classifyConfusion("price_inquiry", "greeting")).toBe("high");
  });

  it("needs_human falso-positivo é média", () => {
    expect(classifyConfusion("general_question", "needs_human")).toBe("medium");
  });

  it("greeting trocado com acknowledgment é baixa", () => {
    expect(classifyConfusion("greeting", "acknowledgment")).toBe("low");
  });

  it("par sem entrada na matriz cai em média, nunca em none", () => {
    expect(classifyConfusion("list_appointments", "reschedule_appointment")).toBe("medium");
  });
});

describe("loadEvalCases", () => {
  function writeCases(lines: string): string {
    const dir = mkdtempSync(join(tmpdir(), "evalcases-"));
    const file = join(dir, "cases.jsonl");
    writeFileSync(file, lines, "utf8");
    return file;
  }

  const valid = JSON.stringify({
    id: "c1",
    stratum: "incident",
    message: "quanto custa",
    expected: "price_inquiry",
    source: "t.ts:1",
    context: { hasPendingSlotOffer: false, isClinicSegment: true, treatments: [] },
    history: [],
  });

  it("carrega caso válido e ignora linha vazia", () => {
    const cases = loadEvalCases(writeCases(`${valid}\n\n`));
    expect(cases).toHaveLength(1);
    expect(cases[0].expected).toBe("price_inquiry");
  });

  it("rejeita intent inexistente em vez de ignorar", () => {
    const bad = JSON.stringify({ ...JSON.parse(valid), expected: "comprar_pizza" });
    expect(() => loadEvalCases(writeCases(bad))).toThrow(/expected inválido/);
  });

  it("rejeita caso sem isClinicSegment", () => {
    const bad = JSON.parse(valid);
    delete bad.context.isClinicSegment;
    expect(() => loadEvalCases(writeCases(JSON.stringify(bad)))).toThrow(/isClinicSegment/);
  });

  it("rejeita id duplicado", () => {
    expect(() => loadEvalCases(writeCases(`${valid}\n${valid}\n`))).toThrow(/duplicado/);
  });

  it("rejeita estrato desconhecido", () => {
    const bad = JSON.stringify({ ...JSON.parse(valid), stratum: "chute" });
    expect(() => loadEvalCases(writeCases(bad))).toThrow(/stratum/);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/__tests__/EvalIntentHarness.test.ts`
Expected: FAIL — não resolve `../../evals/intent/severity`.

- [ ] **Step 3: Criar `evals/intent/types.ts`**

```ts
import type { IntentType } from "@/core/intelligence/IntentClassifier";

// "incident": texto real de lead, com o erro do modelo documentado em produção.
// "prompt_rule": frase que a própria regra do system prompt nomeia. Mede
// aderência à regra escrita, não generalização. Os dois nunca somam.
export type EvalStratum = "incident" | "prompt_rule";

export type SeverityLevel = "none" | "low" | "medium" | "high" | "critical";

export type EvalCaseHistoryEntry = {
  author: "lead" | "agent";
  body: string;
};

export type EvalCase = {
  id: string;
  stratum: EvalStratum;
  message: string;
  expected: IntentType;
  // O intent que o modelo devolveu em produção, quando o caso de origem registra.
  // Habilita a pergunta "o modelo novo ainda erra isto?".
  observedLlmIntent?: IntentType | null;
  source: string;
  context: {
    hasPendingSlotOffer: boolean;
    isClinicSegment: boolean;
    treatments: string[];
  };
  history: EvalCaseHistoryEntry[];
};

export type CaseOutcome = {
  caseId: string;
  stratum: EvalStratum;
  expected: IntentType;
  got: IntentType | null;
  severity: SeverityLevel;
  // true quando a chamada falhou (rede, 429, timeout). Nunca conta como acerto
  // nem como erro de classificação.
  executionError: string | null;
};
```

- [ ] **Step 4: Criar `evals/intent/severity.ts`**

```ts
import type { IntentType } from "@/core/intelligence/IntentClassifier";
import type { SeverityLevel } from "./types";

// Custo de negócio de cada confusão, não distância semântica. Editar aqui é a
// única forma de mudar o peso — o runner nunca decide severidade.
//
// Crítica  → dano regulatório, ou dor e presença física ignoradas.
// Alta     → a conversa entra no trilho errado e o lead se perde.
// Média    → atrito recuperável, ou ruído na recepção.
// Baixa    → praticamente inócuo.
const CONFUSION_SEVERITY: { expected: IntentType; got: IntentType; level: SeverityLevel }[] = [
  // Crítica: opt-out perdido é risco de compliance.
  { expected: "stop_contact", got: "farewell", level: "critical" },
  { expected: "stop_contact", got: "acknowledgment", level: "critical" },
  { expected: "stop_contact", got: "reject_slots", level: "critical" },
  { expected: "stop_contact", got: "unclear", level: "critical" },
  // Crítica: dor tratada como pergunta comum.
  { expected: "clinical_urgency", got: "general_question", level: "critical" },
  { expected: "clinical_urgency", got: "book_appointment", level: "critical" },
  { expected: "clinical_urgency", got: "acknowledgment", level: "critical" },
  { expected: "clinical_urgency", got: "unclear", level: "critical" },
  // Crítica: paciente na recepção sem ninguém atender (caso Carla).
  { expected: "patient_arrived", got: "acknowledgment", level: "critical" },
  { expected: "patient_arrived", got: "greeting", level: "critical" },
  { expected: "patient_arrived", got: "unclear", level: "critical" },

  // Alta: pergunta de negócio engolida pela saudação (casos Tania, Julllys).
  { expected: "price_inquiry", got: "greeting", level: "high" },
  { expected: "price_inquiry", got: "acknowledgment", level: "high" },
  { expected: "price_inquiry", got: "unclear", level: "high" },
  { expected: "book_appointment", got: "greeting", level: "high" },
  { expected: "book_appointment", got: "acknowledgment", level: "high" },
  { expected: "general_question", got: "greeting", level: "high" },
  { expected: "general_question", got: "unclear", level: "high" },
  // Alta: agenda errada.
  { expected: "confirm_slot", got: "reject_slots", level: "high" },
  { expected: "reject_slots", got: "confirm_slot", level: "high" },
  // Alta: pedido que só humano resolve, ignorado.
  { expected: "needs_human", got: "general_question", level: "high" },
  { expected: "needs_human", got: "price_inquiry", level: "high" },
  { expected: "needs_human", got: "greeting", level: "high" },

  // Média: recepção recebe ruído.
  { expected: "general_question", got: "needs_human", level: "medium" },
  { expected: "price_inquiry", got: "needs_human", level: "medium" },
  { expected: "general_question", got: "book_appointment", level: "medium" },
  { expected: "book_appointment", got: "general_question", level: "medium" },

  // Baixa: cortesia trocada por cortesia.
  { expected: "greeting", got: "acknowledgment", level: "low" },
  { expected: "acknowledgment", got: "greeting", level: "low" },
  { expected: "farewell", got: "acknowledgment", level: "low" },
  { expected: "acknowledgment", got: "farewell", level: "low" },
];

const SEVERITY_INDEX = new Map<string, SeverityLevel>(
  CONFUSION_SEVERITY.map((entry) => [`${entry.expected}>${entry.got}`, entry.level]),
);

/**
 * Nível de uma confusão. Acerto é "none". Par não catalogado cai em "medium":
 * o default é assumir que erra importa, para que esquecer de catalogar não
 * transforme um erro real em ruído invisível.
 */
export function classifyConfusion(expected: IntentType, got: IntentType | null): SeverityLevel {
  if (got === null) return "medium";
  if (expected === got) return "none";
  return SEVERITY_INDEX.get(`${expected}>${got}`) ?? "medium";
}
```

- [ ] **Step 5: Criar `evals/intent/load-cases.ts`**

```ts
import { readFileSync } from "node:fs";
import type { IntentType } from "@/core/intelligence/IntentClassifier";
import type { EvalCase, EvalStratum } from "./types";

const INTENTS: IntentType[] = [
  "book_appointment", "check_availability", "confirm_slot", "reject_slots",
  "cancel_appointment", "reschedule_appointment", "list_appointments",
  "price_inquiry", "clinical_urgency", "needs_human", "patient_arrived",
  "general_question", "greeting", "acknowledgment", "farewell",
  "stop_contact", "unclear",
];

const STRATA: EvalStratum[] = ["incident", "prompt_rule"];

/**
 * Carrega o JSONL e valida cada linha. Caso inválido lança: um dataset que
 * ignora linha malformada mede silenciosamente menos do que anuncia.
 */
export function loadEvalCases(path: string): EvalCase[] {
  const lines = readFileSync(path, "utf8").split("\n");
  const cases: EvalCase[] = [];
  const seen = new Set<string>();

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === "") return;
    const where = `${path}:${index + 1}`;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      throw new Error(`${where}: JSON inválido`);
    }

    const id = parsed.id;
    if (typeof id !== "string" || id === "") throw new Error(`${where}: id ausente`);
    if (seen.has(id)) throw new Error(`${where}: id duplicado "${id}"`);
    seen.add(id);

    if (!STRATA.includes(parsed.stratum as EvalStratum)) {
      throw new Error(`${where}: stratum inválido "${String(parsed.stratum)}"`);
    }
    if (typeof parsed.message !== "string" || parsed.message === "") {
      throw new Error(`${where}: message ausente`);
    }
    if (!INTENTS.includes(parsed.expected as IntentType)) {
      throw new Error(`${where}: expected inválido "${String(parsed.expected)}"`);
    }
    if (parsed.observedLlmIntent != null && !INTENTS.includes(parsed.observedLlmIntent as IntentType)) {
      throw new Error(`${where}: observedLlmIntent inválido "${String(parsed.observedLlmIntent)}"`);
    }
    if (typeof parsed.source !== "string" || parsed.source === "") {
      throw new Error(`${where}: source ausente`);
    }

    const context = parsed.context as Record<string, unknown> | undefined;
    if (!context) throw new Error(`${where}: context ausente`);
    if (typeof context.isClinicSegment !== "boolean") {
      throw new Error(`${where}: isClinicSegment ausente — não há default`);
    }
    if (typeof context.hasPendingSlotOffer !== "boolean") {
      throw new Error(`${where}: hasPendingSlotOffer ausente`);
    }
    if (!Array.isArray(context.treatments) || context.treatments.some((t) => typeof t !== "string")) {
      throw new Error(`${where}: treatments precisa ser lista de string`);
    }

    const history = parsed.history;
    if (!Array.isArray(history)) throw new Error(`${where}: history precisa ser lista`);
    for (const entry of history) {
      const e = entry as Record<string, unknown>;
      if (e.author !== "lead" && e.author !== "agent") {
        throw new Error(`${where}: history.author precisa ser lead ou agent`);
      }
      if (typeof e.body !== "string") throw new Error(`${where}: history.body ausente`);
    }

    cases.push(parsed as unknown as EvalCase);
  });

  return cases;
}
```

- [ ] **Step 6: Criar `evals/intent/cases.jsonl` com os 21 casos do estrato de incidentes**

Cada linha abaixo é uma tripla extraída por leitura de `coerceBusinessIntent` nos testes. `observedLlmIntent` é o intent que o `gpt-4o-mini` devolveu em produção; quando ele é igual a `expected`, o caso registra um acerto que precisa continuar acertando.

```jsonl
{"id":"tania-custo","stratum":"incident","message":"Olá! Posso ter mais informações sobre custo ?","expected":"price_inquiry","observedLlmIntent":"acknowledgment","source":"src/__tests__/BusinessIntentCoercion.test.ts","context":{"hasPendingSlotOffer":false,"isClinicSegment":true,"treatments":["Lentes de resina composta","Clareamento dental"]},"history":[]}
{"id":"julllys-valores","stratum":"incident","message":"Olá boa tarde!! E qual seria os valores?","expected":"price_inquiry","observedLlmIntent":"greeting","source":"src/__tests__/BusinessIntentCoercion.test.ts","context":{"hasPendingSlotOffer":false,"isClinicSegment":true,"treatments":["Lentes de resina composta","Clareamento dental"]},"history":[]}
{"id":"carla-frente","stratum":"incident","message":"Oi, bom dia, tudo bem? Eu estou aqui na frente mas ninguém atende.","expected":"patient_arrived","observedLlmIntent":"acknowledgment","source":"src/__tests__/BusinessIntentCoercion.test.ts","context":{"hasPendingSlotOffer":false,"isClinicSegment":true,"treatments":["Lentes de resina composta","Clareamento dental"]},"history":[]}
{"id":"clareamento-isolado","stratum":"incident","message":"clareamento","expected":"general_question","observedLlmIntent":"unclear","source":"src/__tests__/BusinessIntentCoercion.test.ts","context":{"hasPendingSlotOffer":false,"isClinicSegment":true,"treatments":["Lentes de resina composta","Clareamento dental"]},"history":[]}
{"id":"boa-noite-pura","stratum":"incident","message":"Boa noite","expected":"greeting","observedLlmIntent":"greeting","source":"src/__tests__/BusinessIntentCoercion.test.ts","context":{"hasPendingSlotOffer":false,"isClinicSegment":true,"treatments":["Lentes de resina composta","Clareamento dental"]},"history":[]}
{"id":"quanto-custa-clareamento","stratum":"incident","message":"quanto custa o clareamento?","expected":"price_inquiry","observedLlmIntent":"price_inquiry","source":"src/__tests__/BusinessIntentCoercion.test.ts","context":{"hasPendingSlotOffer":false,"isClinicSegment":true,"treatments":["Lentes de resina composta","Clareamento dental"]},"history":[]}
{"id":"cheguei-nao-clinico","stratum":"incident","message":"cheguei","expected":"acknowledgment","observedLlmIntent":"acknowledgment","source":"src/__tests__/BusinessIntentCoercion.test.ts","context":{"hasPendingSlotOffer":false,"isClinicSegment":false,"treatments":["Lentes de resina composta","Clareamento dental"]},"history":[]}
{"id":"atendem-sabados","stratum":"incident","message":"Vocês atendem aos sábados?","expected":"general_question","observedLlmIntent":"acknowledgment","source":"src/__tests__/BusinessIntentCoercion.test.ts","context":{"hasPendingSlotOffer":false,"isClinicSegment":true,"treatments":["Lentes de resina composta","Clareamento dental"]},"history":[]}
{"id":"p01-custo","stratum":"incident","message":"Olá! Posso ter mais informações sobre custo?","expected":"price_inquiry","observedLlmIntent":"greeting","source":"src/__tests__/P0.1-anti-greeting.test.ts","context":{"hasPendingSlotOffer":false,"isClinicSegment":true,"treatments":["Lentes de resina composta","Clareamento dental"]},"history":[]}
{"id":"p01-valores","stratum":"incident","message":"E qual seria os valores?","expected":"price_inquiry","observedLlmIntent":"greeting","source":"src/__tests__/P0.1-anti-greeting.test.ts","context":{"hasPendingSlotOffer":false,"isClinicSegment":true,"treatments":["Lentes de resina composta","Clareamento dental"]},"history":[]}
{"id":"p01-quanto-lente","stratum":"incident","message":"Quanto custa uma lente?","expected":"price_inquiry","observedLlmIntent":"greeting","source":"src/__tests__/P0.1-anti-greeting.test.ts","context":{"hasPendingSlotOffer":false,"isClinicSegment":true,"treatments":["Lentes de resina composta","Clareamento dental"]},"history":[]}
{"id":"p01-frente-ninguem","stratum":"incident","message":"estou aqui na frente mas ninguém atende","expected":"patient_arrived","observedLlmIntent":"acknowledgment","source":"src/__tests__/P0.1-anti-greeting.test.ts","context":{"hasPendingSlotOffer":false,"isClinicSegment":true,"treatments":["Lentes de resina composta","Clareamento dental"]},"history":[]}
{"id":"p01-cheguei-clinico","stratum":"incident","message":"cheguei","expected":"patient_arrived","observedLlmIntent":"acknowledgment","source":"src/__tests__/P0.1-anti-greeting.test.ts","context":{"hasPendingSlotOffer":false,"isClinicSegment":true,"treatments":["Lentes de resina composta","Clareamento dental"]},"history":[]}
{"id":"p01-quero-agendar","stratum":"incident","message":"quero agendar uma consulta","expected":"book_appointment","observedLlmIntent":"greeting","source":"src/__tests__/P0.1-anti-greeting.test.ts","context":{"hasPendingSlotOffer":false,"isClinicSegment":true,"treatments":["Lentes de resina composta","Clareamento dental"]},"history":[]}
{"id":"p01-posso-agendar","stratum":"incident","message":"Posso agendar um horário?","expected":"book_appointment","observedLlmIntent":"greeting","source":"src/__tests__/P0.1-anti-greeting.test.ts","context":{"hasPendingSlotOffer":false,"isClinicSegment":true,"treatments":["Lentes de resina composta","Clareamento dental"]},"history":[]}
{"id":"p01-horario-atendimento","stratum":"incident","message":"Qual seu horário de atendimento?","expected":"general_question","observedLlmIntent":"greeting","source":"src/__tests__/P0.1-anti-greeting.test.ts","context":{"hasPendingSlotOffer":false,"isClinicSegment":true,"treatments":["Lentes de resina composta","Clareamento dental"]},"history":[]}
{"id":"p01-manutencao","stratum":"incident","message":"Quanto custa manutenção?","expected":"needs_human","observedLlmIntent":"greeting","source":"src/__tests__/P0.1-anti-greeting.test.ts","context":{"hasPendingSlotOffer":false,"isClinicSegment":true,"treatments":["Lentes de resina composta","Clareamento dental"]},"history":[]}
{"id":"p01-reparo","stratum":"incident","message":"Quanto é o reparo?","expected":"needs_human","observedLlmIntent":"greeting","source":"src/__tests__/P0.1-anti-greeting.test.ts","context":{"hasPendingSlotOffer":false,"isClinicSegment":true,"treatments":["Lentes de resina composta","Clareamento dental"]},"history":[]}
{"id":"p01-polimento","stratum":"incident","message":"Qual o preço do polimento?","expected":"needs_human","observedLlmIntent":"greeting","source":"src/__tests__/P0.1-anti-greeting.test.ts","context":{"hasPendingSlotOffer":false,"isClinicSegment":true,"treatments":["Lentes de resina composta","Clareamento dental"]},"history":[]}
{"id":"p01-oi-tudo-bem","stratum":"incident","message":"Oi tudo bem?","expected":"greeting","observedLlmIntent":"greeting","source":"src/__tests__/P0.1-anti-greeting.test.ts","context":{"hasPendingSlotOffer":false,"isClinicSegment":true,"treatments":["Lentes de resina composta","Clareamento dental"]},"history":[]}
{"id":"p01-ola","stratum":"incident","message":"Olá!","expected":"greeting","observedLlmIntent":"greeting","source":"src/__tests__/P0.1-anti-greeting.test.ts","context":{"hasPendingSlotOffer":false,"isClinicSegment":true,"treatments":["Lentes de resina composta","Clareamento dental"]},"history":[]}
```

> Nota sobre `p01-manutencao`, `p01-reparo` e `p01-polimento`: esses três esperam `needs_human` porque o serviço pedido (manutenção, reparo, polimento sobre trabalho já feito) não consta no catálogo. Com o catálogo de dois tratamentos declarado no caso, a regra de manutenção do prompt se aplica. Não alterar a lista de `treatments` desses casos sem revisar o rótulo.

- [ ] **Step 7: Rodar os testes e confirmar que passam**

Run: `npx vitest run src/__tests__/EvalIntentHarness.test.ts`
Expected: PASS, 12 testes.

- [ ] **Step 8: Confirmar que o dataset real carrega**

Run: `npx tsx -e "import{loadEvalCases}from'./evals/intent/load-cases';const c=loadEvalCases('evals/intent/cases.jsonl');console.log(c.length,'casos');console.log([...new Set(c.map(x=>x.expected))].sort().join(', '))"`
Expected: `21 casos` e a lista de intents cobertos.

- [ ] **Step 9: Commit**

```bash
git add evals/intent/types.ts evals/intent/severity.ts evals/intent/load-cases.ts evals/intent/cases.jsonl src/__tests__/EvalIntentHarness.test.ts
git commit -m "feat(evals): add the intent dataset contract and severity matrix"
```

---

### Task 2: Agregação do relatório por estrato

**Files:**
- Create: `evals/intent/report.ts`
- Modify: `src/__tests__/EvalIntentHarness.test.ts`

**Interfaces:**
- Consumes: `CaseOutcome`, `SeverityLevel`, `EvalStratum` de `./types`.
- Produces: `buildReport(outcomesPerRun: CaseOutcome[][]): EvalReport`, com
  `EvalReport = { runs: number; strata: Record<EvalStratum, StratumStats>; executionErrors: number }`
  e `StratumStats = { total: number; correctMean: number; accuracyMean: number; accuracySpread: number; severityCounts: Record<SeverityLevel, number>; confusions: { expected: IntentType; got: IntentType; count: number }[] }`.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar em `src/__tests__/EvalIntentHarness.test.ts`:

```ts
import { buildReport } from "../../evals/intent/report";
import type { CaseOutcome } from "../../evals/intent/types";

function outcome(over: Partial<CaseOutcome> = {}): CaseOutcome {
  return {
    caseId: "c",
    stratum: "incident",
    expected: "price_inquiry",
    got: "price_inquiry",
    severity: "none",
    executionError: null,
    ...over,
  };
}

describe("buildReport", () => {
  it("separa os estratos e nunca os soma", () => {
    const report = buildReport([[
      outcome({ caseId: "a", stratum: "incident" }),
      outcome({ caseId: "b", stratum: "prompt_rule" }),
      outcome({ caseId: "c", stratum: "prompt_rule" }),
    ]]);

    expect(report.strata.incident.total).toBe(1);
    expect(report.strata.prompt_rule.total).toBe(2);
  });

  it("calcula média e dispersão da acurácia entre rodadas", () => {
    const hit = outcome({ caseId: "a", got: "price_inquiry", severity: "none" });
    const miss = outcome({ caseId: "a", got: "greeting", severity: "high" });
    const report = buildReport([[hit], [miss], [hit]]);

    expect(report.strata.incident.accuracyMean).toBeCloseTo(2 / 3, 5);
    expect(report.strata.incident.accuracySpread).toBeGreaterThan(0);
  });

  it("dispersão é zero quando todas as rodadas concordam", () => {
    const hit = outcome({ caseId: "a" });
    expect(buildReport([[hit], [hit]]).strata.incident.accuracySpread).toBe(0);
  });

  it("conta severidade e ordena confusões por frequência", () => {
    const report = buildReport([[
      outcome({ caseId: "a", expected: "price_inquiry", got: "greeting", severity: "high" }),
      outcome({ caseId: "b", expected: "price_inquiry", got: "greeting", severity: "high" }),
      outcome({ caseId: "c", expected: "stop_contact", got: "farewell", severity: "critical" }),
    ]]);

    expect(report.strata.incident.severityCounts.high).toBe(2);
    expect(report.strata.incident.severityCounts.critical).toBe(1);
    expect(report.strata.incident.confusions[0]).toEqual({
      expected: "price_inquiry", got: "greeting", count: 2,
    });
  });

  it("erro de execução não conta como acerto nem como erro de classificação", () => {
    const report = buildReport([[
      outcome({ caseId: "a" }),
      outcome({ caseId: "b", got: null, severity: "medium", executionError: "429" }),
    ]]);

    expect(report.executionErrors).toBe(1);
    expect(report.strata.incident.total).toBe(1);
    expect(report.strata.incident.accuracyMean).toBe(1);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/__tests__/EvalIntentHarness.test.ts`
Expected: FAIL — não resolve `../../evals/intent/report`.

- [ ] **Step 3: Criar `evals/intent/report.ts`**

```ts
import type { IntentType } from "@/core/intelligence/IntentClassifier";
import type { CaseOutcome, EvalStratum, SeverityLevel } from "./types";

export type StratumStats = {
  total: number;
  correctMean: number;
  accuracyMean: number;
  // Amplitude entre a melhor e a pior rodada. Com temperature 0 a OpenAI ainda
  // não é determinística; é este número que diz qual limiar não vai flakear.
  accuracySpread: number;
  severityCounts: Record<SeverityLevel, number>;
  confusions: { expected: IntentType; got: IntentType; count: number }[];
};

export type EvalReport = {
  runs: number;
  strata: Record<EvalStratum, StratumStats>;
  executionErrors: number;
};

const STRATA: EvalStratum[] = ["incident", "prompt_rule"];

function emptyStats(): StratumStats {
  return {
    total: 0,
    correctMean: 0,
    accuracyMean: 0,
    accuracySpread: 0,
    severityCounts: { none: 0, low: 0, medium: 0, high: 0, critical: 0 },
    confusions: [],
  };
}

/**
 * Agrega N rodadas. Casos com erro de execução saem da conta de acurácia por
 * completo: um 429 não é opinião do modelo sobre a mensagem.
 */
export function buildReport(outcomesPerRun: CaseOutcome[][]): EvalReport {
  const strata = Object.fromEntries(STRATA.map((s) => [s, emptyStats()])) as Record<EvalStratum, StratumStats>;
  let executionErrors = 0;

  for (const stratum of STRATA) {
    const perRunCorrect: number[] = [];
    const perRunTotal: number[] = [];
    const confusionCounts = new Map<string, number>();

    for (const run of outcomesPerRun) {
      const scored = run.filter((o) => o.stratum === stratum && o.executionError === null);
      const correct = scored.filter((o) => o.expected === o.got).length;
      perRunCorrect.push(correct);
      perRunTotal.push(scored.length);

      for (const o of scored) {
        if (o.expected === o.got || o.got === null) continue;
        const key = `${o.expected}>${o.got}`;
        confusionCounts.set(key, (confusionCounts.get(key) ?? 0) + 1);
      }
      for (const o of scored) {
        strata[stratum].severityCounts[o.severity] += 1;
      }
    }

    const runs = outcomesPerRun.length || 1;
    const accuracies = perRunTotal.map((total, i) => (total === 0 ? 0 : perRunCorrect[i] / total));

    strata[stratum].total = Math.max(...perRunTotal, 0);
    strata[stratum].correctMean = perRunCorrect.reduce((a, b) => a + b, 0) / runs;
    strata[stratum].accuracyMean = accuracies.reduce((a, b) => a + b, 0) / runs;
    strata[stratum].accuracySpread =
      accuracies.length > 1 ? Math.max(...accuracies) - Math.min(...accuracies) : 0;
    strata[stratum].confusions = [...confusionCounts.entries()]
      .map(([key, count]) => {
        const [expected, got] = key.split(">") as [IntentType, IntentType];
        return { expected, got, count };
      })
      .sort((a, b) => b.count - a.count || a.expected.localeCompare(b.expected));
  }

  for (const run of outcomesPerRun) {
    executionErrors += run.filter((o) => o.executionError !== null).length;
  }

  return { runs: outcomesPerRun.length, strata, executionErrors };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run src/__tests__/EvalIntentHarness.test.ts`
Expected: PASS, 17 testes.

- [ ] **Step 5: Commit**

```bash
git add evals/intent/report.ts src/__tests__/EvalIntentHarness.test.ts
git commit -m "feat(evals): aggregate eval outcomes per stratum with spread"
```

---

### Task 3: Diff de baseline e decisão de reprovação

**Files:**
- Create: `evals/intent/baseline.ts`
- Modify: `src/__tests__/EvalIntentHarness.test.ts`

**Interfaces:**
- Consumes: `EvalReport`, `StratumStats` de `./report`.
- Produces: `type Baseline = { model: string; recordedAt: string; runs: number; strata: Record<EvalStratum, { total: number; accuracyMean: number; accuracySpread: number; severityCounts: Record<SeverityLevel, number> }> }`, `compareToBaseline(current: EvalReport, baseline: Baseline | null): BaselineDiff`, `BaselineDiff = { failed: boolean; reasons: string[] }`.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar em `src/__tests__/EvalIntentHarness.test.ts`:

```ts
import { compareToBaseline, type Baseline } from "../../evals/intent/baseline";

function baseline(over: Partial<Baseline> = {}): Baseline {
  return {
    model: "gpt-4o-mini",
    recordedAt: "2026-08-12T00:00:00.000Z",
    runs: 3,
    strata: {
      incident: {
        total: 21, accuracyMean: 0.6, accuracySpread: 0.05,
        severityCounts: { none: 13, low: 0, medium: 2, high: 6, critical: 0 },
      },
      prompt_rule: {
        total: 0, accuracyMean: 0, accuracySpread: 0,
        severityCounts: { none: 0, low: 0, medium: 0, high: 0, critical: 0 },
      },
    },
    ...over,
  };
}

describe("compareToBaseline", () => {
  it("sem baseline não reprova — a primeira rodada é a que cria a referência", () => {
    const diff = compareToBaseline(buildReport([[outcome()]]), null);
    expect(diff.failed).toBe(false);
    expect(diff.reasons.join(" ")).toMatch(/sem baseline/i);
  });

  it("mais falha crítica que a baseline reprova", () => {
    const current = buildReport([[
      outcome({ caseId: "a", expected: "stop_contact", got: "farewell", severity: "critical" }),
    ]]);
    const diff = compareToBaseline(current, baseline());
    expect(diff.failed).toBe(true);
    expect(diff.reasons.join(" ")).toMatch(/critical/);
  });

  it("mais falha alta que a baseline reprova", () => {
    const run = Array.from({ length: 7 }, (_, i) =>
      outcome({ caseId: `h${i}`, expected: "price_inquiry", got: "greeting", severity: "high" }),
    );
    const diff = compareToBaseline(buildReport([run]), baseline());
    expect(diff.failed).toBe(true);
    expect(diff.reasons.join(" ")).toMatch(/high/);
  });

  it("acurácia plana caindo não reprova sozinha", () => {
    const run = [
      outcome({ caseId: "a", expected: "greeting", got: "acknowledgment", severity: "low" }),
      outcome({ caseId: "b", expected: "farewell", got: "acknowledgment", severity: "low" }),
    ];
    const diff = compareToBaseline(buildReport([run]), baseline());
    expect(diff.failed).toBe(false);
    expect(diff.reasons.join(" ")).toMatch(/informativo/);
  });

  it("compara por rodada, não por soma, para --repeat não gerar falso positivo", () => {
    const run = Array.from({ length: 2 }, (_, i) =>
      outcome({ caseId: `h${i}`, expected: "price_inquiry", got: "greeting", severity: "high" }),
    );
    // 6 falhas high em 3 rodadas na baseline = 2 por rodada. Duas rodadas com
    // 2 cada também é 2 por rodada: mesmo patamar, não reprova.
    const diff = compareToBaseline(buildReport([run, run]), baseline());
    expect(diff.failed).toBe(false);
  });
});
```

> `compareToBaseline` não recebe o modelo e por isso não opina sobre troca de modelo. O aviso de baseline gravada com outro modelo é responsabilidade do runner (Task 4), que escreve em `stderr`. Não escrever teste de "modelo diferente" aqui.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/__tests__/EvalIntentHarness.test.ts`
Expected: FAIL — não resolve `../../evals/intent/baseline`.

- [ ] **Step 3: Criar `evals/intent/baseline.ts`**

```ts
import type { EvalStratum, SeverityLevel } from "./types";
import type { EvalReport } from "./report";

export type BaselineStratum = {
  total: number;
  accuracyMean: number;
  accuracySpread: number;
  severityCounts: Record<SeverityLevel, number>;
};

export type Baseline = {
  model: string;
  recordedAt: string;
  runs: number;
  strata: Record<EvalStratum, BaselineStratum>;
};

export type BaselineDiff = { failed: boolean; reasons: string[] };

const STRATA: EvalStratum[] = ["incident", "prompt_rule"];
const BLOCKING: SeverityLevel[] = ["critical", "high"];

/**
 * Reprova só quando falha Crítica ou Alta aumenta. Acurácia plana é informativa:
 * ela pode cair legitimamente enquanto o que importa sobe — por exemplo trocando
 * erro alto por erro baixo.
 *
 * Comparação por rodada, não por soma: com --repeat N a contagem absoluta cresce
 * com N e comparar total contra total daria falso positivo.
 */
export function compareToBaseline(current: EvalReport, baseline: Baseline | null): BaselineDiff {
  if (!baseline) {
    return { failed: false, reasons: ["sem baseline commitada — esta rodada cria a referência"] };
  }

  const reasons: string[] = [];
  let failed = false;
  const runs = Math.max(current.runs, 1);
  const baseRuns = Math.max(baseline.runs, 1);

  for (const stratum of STRATA) {
    for (const level of BLOCKING) {
      const now = current.strata[stratum].severityCounts[level] / runs;
      const before = baseline.strata[stratum].severityCounts[level] / baseRuns;
      if (now > before) {
        failed = true;
        reasons.push(
          `${stratum}: falha ${level} subiu de ${before.toFixed(2)} para ${now.toFixed(2)} por rodada`,
        );
      }
    }

    const accNow = current.strata[stratum].accuracyMean;
    const accBefore = baseline.strata[stratum].accuracyMean;
    if (accNow < accBefore) {
      reasons.push(
        `${stratum}: acurácia caiu de ${(accBefore * 100).toFixed(1)}% para ${(accNow * 100).toFixed(1)}% — informativo, não reprova`,
      );
    }
  }

  if (reasons.length === 0) reasons.push("sem regressão");
  return { failed, reasons };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run src/__tests__/EvalIntentHarness.test.ts`
Expected: PASS, 22 testes.

- [ ] **Step 5: Rodar a suíte inteira para provar que nada de produção mudou**

Run: `npx vitest run`
Expected: PASS. A contagem de arquivos sobe em 1 em relação a `origin/main`; nenhum teste existente falha.

- [ ] **Step 6: Commit**

```bash
git add evals/intent/baseline.ts src/__tests__/EvalIntentHarness.test.ts
git commit -m "feat(evals): gate on severity regression instead of flat accuracy"
```

---

### Task 4: O runner CLI

**Files:**
- Create: `scripts/eval-intent.ts`
- Modify: `package.json` (adicionar script `eval:intent`)

**Interfaces:**
- Consumes: `loadEvalCases`, `classifyConfusion`, `buildReport`, `compareToBaseline`, e `IntentClassifier` de `@/core/intelligence/IntentClassifier`.
- Produces: o executável. Nenhum outro módulo importa dele.

- [ ] **Step 1: Criar `scripts/eval-intent.ts`**

```ts
// Runner do eval de intenção. Único ponto do harness que chama a API real.
// Não altera nada de produção: importa o classificador e apenas o observa.
//
// Uso:
//   npm run eval:intent
//   npm run eval:intent -- --repeat 3
//   npm run eval:intent -- --model gpt-4.1-mini
//   npm run eval:intent -- --no-treatments     (experimento de interferência, §11)
//   npm run eval:intent -- --json
//   npm run eval:intent -- --write-baseline
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEvalCases } from "../evals/intent/load-cases";
import { classifyConfusion } from "../evals/intent/severity";
import { buildReport } from "../evals/intent/report";
import { compareToBaseline, type Baseline } from "../evals/intent/baseline";
import type { CaseOutcome, EvalCase, EvalStratum } from "../evals/intent/types";
import type { IntentType } from "../src/core/intelligence/IntentClassifier";
import type { Message } from "../src/domain/entities/conversation";

const CASES_PATH = resolve("evals/intent/cases.jsonl");
const BASELINE_PATH = resolve("evals/intent/baseline.json");
const EXECUTION_ERROR_ABORT_RATIO = 0.05;

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function option(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function toMessages(caseItem: EvalCase): Message[] {
  return caseItem.history.map((entry, index) => ({
    id: `${caseItem.id}-h${index}`,
    conversationId: caseItem.id,
    author: entry.author,
    body: entry.body,
    sentAt: new Date("2026-01-01T12:00:00.000Z"),
    externalId: null,
  }));
}

async function main(): Promise<void> {
  const repeat = Number(option("repeat") ?? "1");
  if (!Number.isInteger(repeat) || repeat < 1) throw new Error("--repeat precisa ser inteiro >= 1");

  const modelOverride = option("model");
  // MODEL é const de módulo em IntentClassifier, avaliado na importação. A env
  // precisa estar posta ANTES do import dinâmico, senão o override é ignorado.
  if (modelOverride) process.env.OPENAI_CLASSIFIER_MODEL = modelOverride;
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY ausente — rode via npm run eval:intent");

  const { IntentClassifier } = await import("../src/core/intelligence/IntentClassifier");
  const model = process.env.OPENAI_CLASSIFIER_MODEL?.trim() || "gpt-4o-mini";
  const classifier = new IntentClassifier();
  const cases = loadEvalCases(CASES_PATH);
  const stripTreatments = flag("no-treatments");

  const runs: CaseOutcome[][] = [];
  for (let run = 0; run < repeat; run += 1) {
    const outcomes: CaseOutcome[] = [];
    for (const caseItem of cases) {
      const treatments = stripTreatments
        ? []
        : caseItem.context.treatments.map((name) => ({ name }));
      try {
        const result = await classifier.classify(
          caseItem.message,
          toMessages(caseItem),
          caseItem.context.hasPendingSlotOffer,
          treatments,
          {
            agentRole: "recepcionista virtual",
            serviceNoun: "tratamento",
            bookingNoun: "consulta",
            contactNoun: "paciente",
            businessDescriptor: "clínica",
            isClinicSegment: caseItem.context.isClinicSegment,
          },
          null,
        );
        const got = result.intent as IntentType;
        outcomes.push({
          caseId: caseItem.id,
          stratum: caseItem.stratum,
          expected: caseItem.expected,
          got,
          severity: classifyConfusion(caseItem.expected, got),
          executionError: null,
        });
      } catch (error) {
        outcomes.push({
          caseId: caseItem.id,
          stratum: caseItem.stratum,
          expected: caseItem.expected,
          got: null,
          severity: "none",
          executionError: error instanceof Error ? error.message : String(error),
        });
      }
    }
    runs.push(outcomes);
    process.stderr.write(`rodada ${run + 1}/${repeat} concluída\n`);
  }

  const report = buildReport(runs);
  const attempted = cases.length * repeat;
  if (attempted > 0 && report.executionErrors / attempted > EXECUTION_ERROR_ABORT_RATIO) {
    throw new Error(
      `${report.executionErrors} de ${attempted} chamadas falharam (> ${EXECUTION_ERROR_ABORT_RATIO * 100}%) — número sujo, abortando`,
    );
  }

  let baseline: Baseline | null = null;
  try {
    baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;
  } catch {
    baseline = null;
  }
  if (baseline && baseline.model !== model) {
    process.stderr.write(`aviso: baseline é de modelo diferente (${baseline.model} vs ${model})\n`);
  }
  const diff = compareToBaseline(report, baseline);

  if (flag("json")) {
    process.stdout.write(`${JSON.stringify({ model, report, diff }, null, 2)}\n`);
  } else {
    printReport(model, repeat, report, diff, stripTreatments);
  }

  if (flag("write-baseline")) {
    const next: Baseline = {
      model,
      recordedAt: new Date().toISOString(),
      runs: report.runs,
      strata: {
        incident: pickBaselineStratum(report, "incident"),
        prompt_rule: pickBaselineStratum(report, "prompt_rule"),
      },
    };
    writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    process.stderr.write(`baseline escrita em ${BASELINE_PATH}\n`);
  }

  process.exitCode = diff.failed ? 1 : 0;
}

function pickBaselineStratum(report: ReturnType<typeof buildReport>, stratum: EvalStratum) {
  const s = report.strata[stratum];
  return {
    total: s.total,
    accuracyMean: s.accuracyMean,
    accuracySpread: s.accuracySpread,
    severityCounts: s.severityCounts,
  };
}

function printReport(
  model: string,
  repeat: number,
  report: ReturnType<typeof buildReport>,
  diff: { failed: boolean; reasons: string[] },
  stripTreatments: boolean,
): void {
  const labels: Record<EvalStratum, string> = {
    incident: "Estrato A — incidentes reais",
    prompt_rule: "Estrato B — aderência às regras do prompt",
  };
  process.stdout.write(`\nModelo: ${model}   Rodadas: ${repeat}`);
  if (stripTreatments) process.stdout.write("   [sem lista de tratamentos]");
  process.stdout.write("\n");

  for (const stratum of ["incident", "prompt_rule"] as EvalStratum[]) {
    const s = report.strata[stratum];
    if (s.total === 0) continue;
    process.stdout.write(`\n${labels[stratum]} (${s.total} casos)\n`);
    process.stdout.write(
      `  Acertos: ${s.correctMean.toFixed(1)}/${s.total} (${(s.accuracyMean * 100).toFixed(1)}%, amplitude ${(s.accuracySpread * 100).toFixed(1)} pp)\n`,
    );
    const c = s.severityCounts;
    process.stdout.write(
      `  Falhas:  crítica ${c.critical}   alta ${c.high}   média ${c.medium}   baixa ${c.low}\n`,
    );
    for (const confusion of s.confusions.slice(0, 5)) {
      process.stdout.write(
        `    ${confusion.expected} <- ${confusion.got}   ${confusion.count}x\n`,
      );
    }
  }

  process.stdout.write(`\nErros de execução: ${report.executionErrors}\n`);
  process.stdout.write(`${diff.failed ? "REPROVOU" : "Diff vs baseline"}: ${diff.reasons.join("; ")}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Adicionar o script em `package.json`**

Inserir na seção `scripts`, em ordem alfabética junto aos demais:

```json
"eval:intent": "dotenv -e .env.local -- tsx scripts/eval-intent.ts",
```

- [ ] **Step 3: Confirmar que o typecheck e o lint passam**

Run: `npx tsc --noEmit && npx eslint evals scripts/eval-intent.ts`
Expected: sem saída, exit 0.

- [ ] **Step 4: Confirmar que o runner recusa rodar sem chave**

Run: `npx tsx scripts/eval-intent.ts`
Expected: falha com `OPENAI_API_KEY ausente`, exit 1. Isso prova que nenhum caminho acidental chama a API sem env carregada.

- [ ] **Step 5: Rodar de verdade, uma rodada**

Run: `npm run eval:intent`
Expected: relatório do Estrato A com 21 casos, `Erros de execução: 0`, e `sem baseline commitada`. Registrar a acurácia observada — é o primeiro número real de acurácia do classificador na história do projeto.

- [ ] **Step 6: Commit**

```bash
git add scripts/eval-intent.ts package.json
git commit -m "feat(evals): add the intent eval runner"
```

---

### Task 5: Estrato B — casos das regras do prompt

**Files:**
- Modify: `evals/intent/cases.jsonl`

**Interfaces:**
- Consumes: o formato de caso da Task 1.
- Produces: nada de código. Amplia o dataset.

**Extração é curada, não automatizada.** O prompt mistura exemplos positivos com contraexemplos (`NÃO confundir com`, `NÃO use greeting nesses casos`). Um extrator ingênuo rotularia contraexemplo como positivo e envenenaria o dataset. Além disso, muitos "negativos" são positivos de outro rótulo: `"não quero esse horário" → reject_slots` está escrito como negativo de `stop_contact` mas é verdade-base de `reject_slots`.

- [ ] **Step 1: Ler as regras e listar as frases citadas**

Run: `sed -n '59,177p' src/core/intelligence/IntentClassifier.ts`

Percorrer cada bloco `REGRA` e anotar, para cada frase entre aspas, qual intent a regra manda aplicar **àquela frase**. Descartar frase que a regra cita sem atribuir rótulo.

- [ ] **Step 2: Escrever os casos, cobrindo obrigatoriamente os críticos**

Acrescentar linhas em `evals/intent/cases.jsonl` com `"stratum":"prompt_rule"` e `"source":"src/core/intelligence/IntentClassifier.ts"`. A cobertura mínima, porque são os níveis Crítica da matriz de severidade e o Estrato A não tem nenhum:

- `stop_contact`: `"não quero mais receber mensagens"`, `"para de me mandar mensagem"`, `"me tira dessa lista"`, `"descadastrar"`, `"pare de me enviar"`
- `clinical_urgency`: `"está doendo"`, `"dor forte"`, `"trincou"`, `"caiu a lente"`, `"a coroa soltou"`
- `patient_arrived`: `"estou na recepção"`, `"vou me atrasar"`, `"chego em 10 minutos"`

E os pares que a regra distingue explicitamente, porque é onde as regras se atropelam:

- `reject_slots` (não `stop_contact`): `"não quero esse horário"`, `"nenhum desses"`
- `farewell` (não `stop_contact`): `"tchau"`, `"valeu"`, `"obrigado tchau"`
- `list_appointments` (não `check_availability`): `"tenho algum agendamento?"`, `"quando é minha consulta?"`
- `check_availability` (não `list_appointments`): `"quais horários disponíveis?"`, `"tem vaga amanhã?"`
- `confirm_slot` com `hasPendingSlotOffer: true`: `"pode ser"`, `"quero esse"`
- `general_question` (não `needs_human`): `"tem foto do serviço?"`, `"pode me mostrar como fica?"`
- `needs_human`: `"quero falar com um especialista"`, `"preciso de um desconto"`, `"me manda o comprovante"`

Exemplo do formato, para o caso de opt-out:

```jsonl
{"id":"rule-stop-contact-01","stratum":"prompt_rule","message":"não quero mais receber mensagens","expected":"stop_contact","source":"src/core/intelligence/IntentClassifier.ts","context":{"hasPendingSlotOffer":false,"isClinicSegment":true,"treatments":["Lentes de resina composta","Clareamento dental"]},"history":[]}
```

Atenção a dois detalhes que a regra impõe:
- Casos de `confirm_slot` e `reject_slots` precisam `"hasPendingSlotOffer": true`, senão a regra que os governa não se aplica e o rótulo fica errado.
- Casos de `acknowledgment` que dependem de "há histórico de conversa ativo" precisam de `history` com uma fala de `agent`; sem isso o classificador os vê como primeiro contato e `greeting` passa a ser a resposta correta.

- [ ] **Step 3: Confirmar que o dataset segue válido e que os 17 intents estão cobertos**

Run: `npx vitest run src/__tests__/EvalIntentHarness.test.ts`
Expected: PASS.

Run: `npx tsx -e "import{loadEvalCases}from'./evals/intent/load-cases';const c=loadEvalCases('evals/intent/cases.jsonl');const by=(s)=>c.filter(x=>x.stratum===s).length;console.log('incident',by('incident'),'prompt_rule',by('prompt_rule'));const cov=new Set(c.map(x=>x.expected));console.log('intents cobertos',cov.size,'de 17')"`
Expected: `incident 21`, um `prompt_rule` maior que 30, e cobertura dos 17 intents.

- [ ] **Step 4: Commit**

```bash
git add evals/intent/cases.jsonl
git commit -m "feat(evals): cover every intent with prompt-rule cases"
```

---

### Task 6: Baseline commitada e o experimento de interferência

**Files:**
- Create: `evals/intent/baseline.json`
- Create: `docs/superpowers/plans/2026-08-12-intent-eval-baseline-report.md`

**Interfaces:**
- Consumes: o runner da Task 4 e o dataset das Tasks 1 e 5.
- Produces: a baseline versionada e o relatório de achados.

- [ ] **Step 1: Rodar três vezes e escrever a baseline**

Run: `npm run eval:intent -- --repeat 3 --write-baseline`
Expected: relatório dos dois estratos, `Erros de execução: 0`, e `evals/intent/baseline.json` escrita. Anotar a amplitude (`accuracySpread`) de cada estrato — é ela que decide o limiar da etapa 2 do gate.

- [ ] **Step 2: Provar que o gate morde de verdade**

Editar temporariamente uma linha de `evals/intent/cases.jsonl`, trocando o `expected` de `p01-custo` de `price_inquiry` para `greeting`.

Run: `npm run eval:intent`
Expected: exit 1, com razão citando aumento de falha `high`. Um gate que nunca reprovou não é gate.

Desfazer a edição:

Run: `git checkout -- evals/intent/cases.jsonl`

- [ ] **Step 3: Rodar o experimento de interferência da §11**

Run: `npm run eval:intent -- --repeat 3 --json > /tmp/com-tratamentos.json`
Run: `npm run eval:intent -- --repeat 3 --no-treatments --json > /tmp/sem-tratamentos.json`

Comparar a acurácia do Estrato A entre os dois. Se a versão sem a lista de tratamentos pontuar mais alto, a hipótese de interferência de tarefa está sustentada e a spec de separação de responsabilidades tem evidência para nascer.

- [ ] **Step 4: Escrever o relatório de achados**

Criar `docs/superpowers/plans/2026-08-12-intent-eval-baseline-report.md` contendo:

1. Modelo, número de rodadas, data.
2. Acurácia e amplitude de cada estrato, com contagem absoluta ao lado da porcentagem.
3. As confusões mais frequentes, e quais delas são Crítica ou Alta.
4. Quais casos com `observedLlmIntent` divergente do `expected` o modelo **ainda** erra. Cada um desses é um guard determinístico que continua sendo necessário; cada um que ele passa a acertar é candidato a retirada de guard, e material para a spec de retirada listada na §13 da spec de design.
5. O resultado do experimento com e sem lista de tratamentos, com a conclusão sobre interferência.
6. O limiar recomendado para a etapa 2 do gate, derivado da amplitude medida, não escolhido a gosto.

- [ ] **Step 5: Confirmar que a suíte e o verify seguem intactos**

Run: `npx vitest run`
Expected: PASS, nenhum teste existente afetado.

Run: `npm run lint && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add evals/intent/baseline.json docs/superpowers/plans/2026-08-12-intent-eval-baseline-report.md
git commit -m "feat(evals): record the first measured classifier baseline"
```

---

## Notas de execução

**O que não fazer.** Não editar o prompt do classificador durante a execução deste plano, nem "consertar" um caso que o modelo erra. O valor do harness é medir o estado atual sem retoque; um prompt ajustado no meio da medição destrói a baseline antes de ela existir.

**Se a acurácia do Estrato A vier muito baixa.** Não é motivo para mexer no prompt agora. É o achado: significa que os 31 guards determinísticos do orquestrador são o que sustenta o produto hoje, e a spec de retirada de guards precisa esperar um modelo melhor. Registrar no relatório.

**Se vier muito alta.** Também é achado, e o mais valioso: significa que boa parte dos guards já é peso morto e o orquestrador pode encolher por deleção. Registrar quais casos passaram e alimentar a spec de retirada.
