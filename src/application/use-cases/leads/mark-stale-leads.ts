import { DrizzleLeadRepository } from "@/infrastructure/repositories/drizzle-lead-repository";
import { DrizzleFollowUpRepository } from "@/infrastructure/repositories/drizzle-follow-up-repository";
import { scheduleFollowUp } from "./schedule-follow-up";

export async function markStaleLeads(params: {
  clinicId: string;
  inactiveDays?: number;
}): Promise<{ marked: number }> {
  const inactiveDays = params.inactiveDays ?? 14;
  const lastActivityBefore = new Date(Date.now() - inactiveDays * 24 * 60 * 60 * 1000);

  const leadRepository = new DrizzleLeadRepository();
  const followUpRepository = new DrizzleFollowUpRepository();
  const staleLeads = await leadRepository.findInactiveLeads({
    clinicId: params.clinicId,
    lastActivityBefore,
  });

  const now = new Date();
  for (const lead of staleLeads) {
    await leadRepository.save({
      ...lead,
      status: "lost",
      lostReason: "inatividade",
      updatedAt: now,
    });
    try {
      await scheduleFollowUp({
        clinicId: lead.clinicId,
        leadId: lead.id,
        trigger: "lost",
        followUpRepository,
      });
    } catch (err) {
      console.error("[markStaleLeads] Failed to schedule follow-up for lead:", lead.id, err);
    }
  }

  return { marked: staleLeads.length };
}
