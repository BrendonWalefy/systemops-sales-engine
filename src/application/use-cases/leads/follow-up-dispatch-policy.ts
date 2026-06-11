import type { FollowUp } from "@/domain/entities/follow-up";

export function selectOneFollowUpPerLead(followUps: FollowUp[]): {
  selected: FollowUp[];
  deferred: FollowUp[];
} {
  const seenLeadIds = new Set<string>();
  const selected: FollowUp[] = [];
  const deferred: FollowUp[] = [];

  for (const followUp of followUps) {
    if (seenLeadIds.has(followUp.leadId)) {
      deferred.push(followUp);
      continue;
    }

    seenLeadIds.add(followUp.leadId);
    selected.push(followUp);
  }

  return { selected, deferred };
}
