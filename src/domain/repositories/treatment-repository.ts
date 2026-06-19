import type { Treatment } from "../entities/treatment";

export type TreatmentRepository = {
  listByClinic(clinicId: string): Promise<Treatment[]>;
  findByName(clinicId: string, name: string): Promise<Treatment | null>;
  create(data: Omit<Treatment, "id" | "createdAt" | "updatedAt">): Promise<Treatment>;
  update(
    id: string,
    data: Partial<
      Pick<
        Treatment,
        | "name"
        | "durationMinutes"
        | "description"
        | "commonObjections"
        | "requiresEvaluationFirst"
        | "triggerTemplate"
        | "keywordMatchEnabled"
        | "aliases"
        | "isAesthetic"
        | "pipelineSteps"
        | "priceCents"
        | "minPriceCents"
        | "maxPriceCents"
      >
    >,
  ): Promise<Treatment>;
  delete(id: string): Promise<void>;
};
