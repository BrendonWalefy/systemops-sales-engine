import type { FollowUp } from "../entities/follow-up";

export type FollowUpRepository = {
  save(followUp: FollowUp): Promise<void>;
  listDue(input: { clinicId: string; now: Date }): Promise<FollowUp[]>;
};

