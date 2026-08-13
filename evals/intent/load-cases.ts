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
