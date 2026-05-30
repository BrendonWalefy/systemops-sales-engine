export type Treatment = {
  id: string;
  clinicId: string;
  name: string;
  durationMinutes: number;
  description: string | null;
  commonObjections: string[];
  requiresEvaluationFirst: boolean;
  createdAt: Date;
  updatedAt: Date;
};
