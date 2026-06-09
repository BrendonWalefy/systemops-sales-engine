export type Treatment = {
  id: string;
  clinicId: string;
  name: string;
  durationMinutes: number;
  description: string | null;
  commonObjections: string[];
  requiresEvaluationFirst: boolean;
  triggerTemplate: string | null;
  keywordMatchEnabled: boolean;
  aliases: string[];
  isAesthetic: boolean;
  createdAt: Date;
  updatedAt: Date;
};
