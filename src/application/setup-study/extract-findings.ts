/**
 * Extract-findings: envia o corpus ao LLM e extrai findings com parse defensivo (ADR-002).
 *
 * Parse defensivo:
 * - claim vazio → finding descartado
 * - target fora da allowlist → proposedChange = null (finding mantido como informativo)
 * - máx. 15 findings por estudo
 * - campos ausentes usam defaults seguros
 */

import { callAdvisorLLM, SETUP_STUDY_MODEL } from "@/infrastructure/llm/advisor-llm";
import { isValidFindingTarget } from "@/domain/entities/setup-study";
import type { SetupFinding, SetupFindingCategory, AnonymizedTranscript } from "@/domain/entities/setup-study";

const MAX_FINDINGS = 15;

const FINDING_CATEGORIES: SetupFindingCategory[] = [
  "price",
  "communication",
  "qualification",
  "policy",
  "tone",
  "other",
];

function isValidCategory(cat: unknown): cat is SetupFindingCategory {
  return typeof cat === "string" && FINDING_CATEGORIES.includes(cat as SetupFindingCategory);
}

function isValidSeverity(sev: unknown): sev is 1 | 2 | 3 {
  return sev === 1 || sev === 2 || sev === 3;
}

/** Monta o prompt para extração de findings conforme ADR-002 apêndice D. */
function buildPrompt(transcript: AnonymizedTranscript): string {
  return `Você é um Engenheiro de IA configurando o sistema para uma clínica.
O sistema desta clínica precisa ser configurado (Playbook, Tratamentos, Políticas). Seu trabalho é ler as conversas reais abaixo e EXTRAIR as regras de negócio, preços, serviços, tom de voz e objeções para preencher o setup do sistema.

PERÍODO: ${transcript.periodStart.toISOString().slice(0, 10)} a ${transcript.periodEnd.toISOString().slice(0, 10)}
CONVERSAS: ${transcript.conversationCount}
MENSAGENS: ${transcript.totalMessages}

TRANSCRITOS:
${transcript.text}

Retorne um JSON com a estrutura abaixo. Máximo de ${MAX_FINDINGS} apontamentos.
Para cada regra de negócio importante descoberta (um preço de serviço, uma política de agendamento, uma objeção que o atendente sempre contorna, ou o tom de voz predominante), crie um apontamento.

Cada finding deve ter:
- category: "price" | "communication" | "qualification" | "policy" | "tone" | "other"
- claim: afirmação clara sobre a regra ou dado descoberto (máx 280 chars, em português)
- evidence: trecho exato do transcript que comprova a descoberta (máx 400 chars)
- severity: 1 (baixa, ex: tom de voz), 2 (média, ex: qualificação), 3 (alta, ex: preço e serviços)
- proposedChange: null | { target: string, newValue: string, currentValue: "" }
  Targets válidos: treatment:<uuid>.priceCents, treatment:<uuid>.priceQuotableInChat,
  treatment:<uuid>.aliases, treatment:<uuid>.requiresEvaluationFirst,
  playbook.objections[], playbook.toneOfVoice, playbook.commercialPolicy, playbook.notes

Seja proativo: se descobrir que a clínica faz "Clareamento por R$800", crie um apontamento para isso. Se descobrir que eles usam muitos emojis e linguagem informal, crie um apontamento de tom de voz.
Se não conseguir mapear para um "target" exato, use proposedChange: null, mas NÃO deixe de criar o finding.

Formato de resposta (JSON apenas, sem markdown):
{
  "findings": [
    {
      "category": "price",
      "claim": "A clínica cobra R$ 150 pela avaliação inicial.",
      "evidence": "CLINICA: O valor da nossa consulta de avaliação é R$ 150. [trecho relevante]",
      "severity": 3,
      "proposedChange": null
    }
  ]
}`;
}

/** Tipo bruto retornado pelo LLM antes do parse defensivo. */
interface RawFinding {
  category?: unknown;
  claim?: unknown;
  evidence?: unknown;
  severity?: unknown;
  proposedChange?: {
    target?: unknown;
    newValue?: unknown;
    currentValue?: unknown;
  } | null;
}

/**
 * Extrai e valida os findings do JSON bruto do LLM.
 * Parse defensivo: campos inválidos são corrigidos ou descartados.
 */
export function parseFindings(raw: unknown): SetupFinding[] {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.findings)) return [];

  const results: SetupFinding[] = [];

  for (const item of obj.findings) {
    if (!item || typeof item !== "object") continue;
    const f = item as RawFinding;

    // claim vazio → descartar
    const claim = typeof f.claim === "string" ? f.claim.trim().slice(0, 280) : "";
    if (!claim) continue;

    const evidence = typeof f.evidence === "string" ? f.evidence.trim().slice(0, 400) : "";
    const category: SetupFindingCategory = isValidCategory(f.category) ? f.category : "other";
    const severity: 1 | 2 | 3 = isValidSeverity(f.severity) ? f.severity : 1;

    // Valida proposedChange
    let proposedChange: SetupFinding["proposedChange"] = null;
    if (f.proposedChange && typeof f.proposedChange === "object") {
      const target = typeof f.proposedChange.target === "string" ? f.proposedChange.target.trim() : "";
      const newValue = typeof f.proposedChange.newValue === "string" ? f.proposedChange.newValue.trim() : "";
      const currentValue = typeof f.proposedChange.currentValue === "string" ? f.proposedChange.currentValue.trim() : "";

      // Target fora da allowlist → proposedChange = null (finding informativo)
      if (target && isValidFindingTarget(target)) {
        proposedChange = { target, newValue, currentValue };
      }
    }

    results.push({
      id: crypto.randomUUID(),
      category,
      claim,
      evidence,
      severity,
      proposedChange,
    });

    if (results.length >= MAX_FINDINGS) break;
  }

  return results;
}

/**
 * Envia o corpus ao LLM e retorna os findings parseados.
 * Testável: aceita um modelo mockado via injeção de dependência.
 */
export async function extractFindings(
  transcript: AnonymizedTranscript,
  opts: { model?: string } = {},
): Promise<SetupFinding[]> {
  const model = opts.model ?? SETUP_STUDY_MODEL;
  const prompt = buildPrompt(transcript);

  const raw = await callAdvisorLLM(prompt, { model, maxTokens: 4000 });

  // Parse JSON — tenta extrair o bloco JSON mesmo se vier com texto extra
  let parsed: unknown;
  try {
    // Tenta parse direto
    parsed = JSON.parse(raw);
  } catch {
    // Extrai primeiro bloco JSON da resposta
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        return [];
      }
    } else {
      return [];
    }
  }

  return parseFindings(parsed);
}
