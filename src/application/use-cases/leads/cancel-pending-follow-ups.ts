import type { FollowUpRepository } from "@/domain/repositories/follow-up-repository";

export async function cancelPendingFollowUps(params: {
  leadId: string;
  followUpRepository: FollowUpRepository;
}): Promise<number> {
  return params.followUpRepository.cancelPendingByLead({ leadId: params.leadId });
}
