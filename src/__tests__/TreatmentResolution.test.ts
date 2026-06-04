import { describe, expect, it } from "vitest";
import { resolveTreatmentDuration } from "@/core/scheduling/resolveTreatmentDuration";
import type { Treatment } from "@/domain/entities/treatment";

const CLINIC_DEFAULT = 60;

function makeTreatment(name: string, durationMinutes: number): Treatment {
  return {
    id: crypto.randomUUID(),
    clinicId: "clinic-1",
    name,
    durationMinutes,
    description: null,
    commonObjections: [],
    requiresEvaluationFirst: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const treatments = [
  makeTreatment("Avaliação", 60),
  makeTreatment("Limpeza", 60),
  makeTreatment("Manutenção das lentes", 60),
  makeTreatment("20 Lentes", 240),
];

const allSameDuration = [
  makeTreatment("Avaliação", 60),
  makeTreatment("Limpeza", 60),
];

describe("resolveTreatmentDuration", () => {
  describe("treatment identificado pelo LLM", () => {
    it("retorna matched com duração correta para nome exato", () => {
      const result = resolveTreatmentDuration("20 Lentes", treatments, CLINIC_DEFAULT, false);
      expect(result).toEqual({ kind: "matched", treatmentName: "20 Lentes", durationMinutes: 240 });
    });

    it("case-insensitive: '20 lentes' → '20 Lentes'", () => {
      const result = resolveTreatmentDuration("20 lentes", treatments, CLINIC_DEFAULT, false);
      expect(result).toEqual({ kind: "matched", treatmentName: "20 Lentes", durationMinutes: 240 });
    });

    it("case-insensitive: 'AVALIAÇÃO' → 'Avaliação'", () => {
      const result = resolveTreatmentDuration("AVALIAÇÃO", treatments, CLINIC_DEFAULT, false);
      expect(result).toEqual({ kind: "matched", treatmentName: "Avaliação", durationMinutes: 60 });
    });

    it("tratamento identificado mas não existe na clínica → default (LLM já vai pedir clarificação)", () => {
      const result = resolveTreatmentDuration("Clareamento", treatments, CLINIC_DEFAULT, true);
      expect(result).toEqual({ kind: "default", durationMinutes: CLINIC_DEFAULT });
    });
  });

  describe("treatment não identificado (null)", () => {
    it("todos os tratamentos com mesma duração → all_same, não pede clarificação", () => {
      const result = resolveTreatmentDuration(null, allSameDuration, CLINIC_DEFAULT, false);
      expect(result).toEqual({ kind: "all_same", durationMinutes: 60 });
    });

    it("todos com mesma duração mesmo que shouldAskClarification=true → all_same (duração não é ambígua)", () => {
      const result = resolveTreatmentDuration(null, allSameDuration, CLINIC_DEFAULT, true);
      expect(result).toEqual({ kind: "all_same", durationMinutes: 60 });
    });

    it("tratamentos com durações diferentes + shouldAskClarification=true → ask_clarification", () => {
      const result = resolveTreatmentDuration(null, treatments, CLINIC_DEFAULT, true);
      expect(result).toEqual({ kind: "ask_clarification", durationMinutes: CLINIC_DEFAULT });
    });

    it("tratamentos com durações diferentes + shouldAskClarification=false → ask_clarification (sistema sempre pergunta)", () => {
      const result = resolveTreatmentDuration(null, treatments, CLINIC_DEFAULT, false);
      expect(result).toEqual({ kind: "ask_clarification", durationMinutes: CLINIC_DEFAULT });
    });
  });

  describe("clínica sem treatments cadastrados", () => {
    it("retorna default com duração padrão da clínica", () => {
      const result = resolveTreatmentDuration(null, [], CLINIC_DEFAULT, false);
      expect(result).toEqual({ kind: "default", durationMinutes: CLINIC_DEFAULT });
    });

    it("retorna default mesmo com treatment identificado se lista vazia", () => {
      const result = resolveTreatmentDuration("Avaliação", [], CLINIC_DEFAULT, false);
      expect(result).toEqual({ kind: "default", durationMinutes: CLINIC_DEFAULT });
    });

    it("usa o defaultAppointmentDurationMinutes correto da clínica (não assume 60)", () => {
      const result = resolveTreatmentDuration(null, [], 120, false);
      expect(result).toEqual({ kind: "default", durationMinutes: 120 });
    });
  });

  describe("procedimentos da Ximendes", () => {
    const ximendesTreatments = [
      makeTreatment("Avaliação", 60),
      makeTreatment("Manutenção das lentes", 60),
      makeTreatment("Limpeza", 60),
      makeTreatment("20 Lentes", 240),
    ];

    it("'20 Lentes' → 240 minutos (4h de slot)", () => {
      const result = resolveTreatmentDuration("20 Lentes", ximendesTreatments, 60, false);
      expect(result).toEqual({ kind: "matched", treatmentName: "20 Lentes", durationMinutes: 240 });
    });

    it("'quero marcar' sem especificar → ask_clarification (20 Lentes tem duração diferente)", () => {
      const result = resolveTreatmentDuration(null, ximendesTreatments, 60, true);
      expect(result).toEqual({ kind: "ask_clarification", durationMinutes: 60 });
    });

    it("'Manutenção das lentes' → 60 minutos", () => {
      const result = resolveTreatmentDuration("Manutenção das lentes", ximendesTreatments, 60, false);
      expect(result).toEqual({ kind: "matched", treatmentName: "Manutenção das lentes", durationMinutes: 60 });
    });
  });
});
