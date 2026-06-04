import type { Treatment } from "@/domain/entities/treatment";

export type TreatmentResolution =
  | { kind: "matched"; treatmentName: string; durationMinutes: number }
  | { kind: "all_same"; durationMinutes: number }
  | { kind: "ask_clarification"; durationMinutes: number }
  | { kind: "default"; durationMinutes: number };

/**
 * Resolve qual duração usar para o slot a partir da intenção classificada e da lista de tratamentos da clínica.
 *
 * Precedência:
 *  1. Treatment identificado pelo LLM e encontrado na lista → usa duração dele
 *  2. Nenhum treatment identificado, todos com mesma duração → usa essa duração sem perguntar
 *  3. Nenhum treatment identificado, durações diferentes → sempre pede esclarecimento
 *  4. Qualquer outro caso → duração padrão da clínica
 */
export function resolveTreatmentDuration(
  identifiedTreatment: string | null,
  clinicTreatments: Treatment[],
  clinicDefaultDurationMinutes: number,
  _shouldAskClarification: boolean,
): TreatmentResolution {
  // Caso 1: LLM identificou um treatment → busca correspondência case-insensitive
  if (identifiedTreatment && clinicTreatments.length > 0) {
    const match = clinicTreatments.find(
      (t) => t.name.toLowerCase() === identifiedTreatment.toLowerCase(),
    );
    if (match) {
      return { kind: "matched", treatmentName: match.name, durationMinutes: match.durationMinutes };
    }
    // LLM identificou algo mas não existe na clínica → usa padrão (LLM já vai pedir clarificação)
    return { kind: "default", durationMinutes: clinicDefaultDurationMinutes };
  }

  // Caso 2 e 3: Nenhum treatment identificado, mas há treatments cadastrados
  if (!identifiedTreatment && clinicTreatments.length > 0) {
    const uniqueDurations = [...new Set(clinicTreatments.map((t) => t.durationMinutes))];

    if (uniqueDurations.length === 1) {
      // Todos os tratamentos têm a mesma duração → usa ela sem perguntar
      return { kind: "all_same", durationMinutes: uniqueDurations[0] };
    }

    if (uniqueDurations.length > 1) {
      // Durações diferentes → sempre pedir esclarecimento, independente do LLM
      return { kind: "ask_clarification", durationMinutes: clinicDefaultDurationMinutes };
    }
  }

  // Caso 4: Clínica sem treatments cadastrados ou nenhuma das condições acima
  return { kind: "default", durationMinutes: clinicDefaultDurationMinutes };
}
