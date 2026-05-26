import { DrizzleLeadRepository } from "@/infrastructure/repositories/drizzle-lead-repository";

export async function markStaleLeads(params: {
  clinicId: string;
  inactiveDays?: number;
}): Promise<{ marked: number }> {
  const inactiveDays = params.inactiveDays ?? 14;
  const lastActivityBefore = new Date(Date.now() - inactiveDays * 24 * 60 * 60 * 1000);

  const leadRepository = new DrizzleLeadRepository();
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
  }

  return { marked: staleLeads.length };
}
