import type { FollowUp } from "@/domain/entities/follow-up";
import type { FollowUpRepository } from "@/domain/repositories/follow-up-repository";
import type { LeadRepository } from "@/domain/repositories/lead-repository";

export type CreateFollowUpDependencies = {
  followUpRepository: FollowUpRepository;
  leadRepository: LeadRepository;
  idGenerator: () => string;
  now: () => Date;
};

export class CreateFollowUp {
  constructor(private readonly deps: CreateFollowUpDependencies) {}

  async execute(input: {
    clinicId: string;
    leadId: string;
    dueAt: Date;
    reason: string;
    suggestedMessage: string | null;
  }): Promise<FollowUp> {
    const lead = await this.deps.leadRepository.findById(input.leadId);
    if (!lead) {
      throw new Error("Lead not found");
    }

    const now = this.deps.now();
    const followUp: FollowUp = {
      id: this.deps.idGenerator(),
      clinicId: input.clinicId,
      leadId: input.leadId,
      dueAt: input.dueAt,
      status: "pending",
      reason: input.reason,
      suggestedMessage: input.suggestedMessage,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    await this.deps.followUpRepository.save(followUp);
    await this.deps.leadRepository.save({
      ...lead,
      status: "follow_up_due",
      nextActionAt: input.dueAt,
      updatedAt: now,
    });

    return followUp;
  }
}

