import { randomUUID } from "crypto";
import type { FollowUpRepository } from "@/domain/repositories/follow-up-repository";

export type ScheduleFollowUpTrigger = "appointment_completed" | "no_show" | "lost";

const FOLLOW_UP_REASONS: Record<ScheduleFollowUpTrigger, string> = {
  appointment_completed: "Retorno de rotina",
  no_show: "Lead não compareceu à consulta",
  lost: "Lead inativo — segunda chance",
};

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function calculateFollowUpDueAt(trigger: ScheduleFollowUpTrigger, referenceDate: Date): Date {
  switch (trigger) {
    case "appointment_completed":
      return addMonths(referenceDate, 6);
    case "no_show":
      return addDays(referenceDate, 7);
    case "lost":
      return addDays(referenceDate, 30);
  }
}

export async function scheduleFollowUp(params: {
  clinicId: string;
  leadId: string;
  trigger: ScheduleFollowUpTrigger;
  referenceDate?: Date;
  followUpRepository: FollowUpRepository;
}): Promise<void> {
  const { clinicId, leadId, trigger, followUpRepository } = params;
  const referenceDate = params.referenceDate ?? new Date();
  const now = new Date();

  await followUpRepository.save({
    id: randomUUID(),
    clinicId,
    leadId,
    dueAt: calculateFollowUpDueAt(trigger, referenceDate),
    status: "pending",
    reason: FOLLOW_UP_REASONS[trigger],
    suggestedMessage: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  });
}
