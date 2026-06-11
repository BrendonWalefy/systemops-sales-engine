import type { FollowUpRepository } from "@/domain/repositories/follow-up-repository";
import { shouldCancelFollowUpOnLeadReengagement } from "./schedule-follow-up";

export async function cancelPendingFollowUps(params: {
  leadId: string;
  followUpRepository: FollowUpRepository;
  mode?: "all" | "reengagement";
}): Promise<number> {
  const mode = params.mode ?? "all";

  if (mode === "all") {
    return params.followUpRepository.cancelPendingByLead({ leadId: params.leadId });
  }

  const pending = await params.followUpRepository.listPendingByLead({ leadId: params.leadId });
  const reasons = [...new Set(
    pending
      .map((followUp) => followUp.reason)
      .filter((reason) => shouldCancelFollowUpOnLeadReengagement(reason)),
  )];

  let cancelled = 0;
  for (const reason of reasons) {
    cancelled += await params.followUpRepository.cancelPendingByReason({
      leadId: params.leadId,
      reason,
    });
  }

  return cancelled;
}
