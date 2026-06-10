import { randomUUID } from "crypto";
import type { FollowUpRepository } from "@/domain/repositories/follow-up-repository";

export type ScheduleFollowUpTrigger = "appointment_completed" | "no_show" | "lost" | "video_sent";

const FOLLOW_UP_REASONS: Record<ScheduleFollowUpTrigger, string> = {
  appointment_completed: "Retorno de rotina",
  no_show: "Lead não compareceu à consulta",
  lost: "Lead inativo — segunda chance",
  video_sent: "video_sent",
};

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

export function calculateFollowUpDueAt(trigger: ScheduleFollowUpTrigger, referenceDate: Date): Date {
  switch (trigger) {
    case "appointment_completed":
      return addMonths(referenceDate, 6);
    case "no_show":
      return addDays(referenceDate, 7);
    case "lost":
      return addDays(referenceDate, 30);
    case "video_sent":
      return addHours(referenceDate, 6);
  }
}

export async function scheduleFollowUp(params: {
  clinicId: string;
  leadId: string;
  trigger: ScheduleFollowUpTrigger;
  referenceDate?: Date;
  followUpRepository: FollowUpRepository;
  /** Para trigger 'video_sent': título do vídeo enviado, usado pelo dispatcher para personalizar a mensagem. */
  videoTitle?: string;
}): Promise<void> {
  const { clinicId, leadId, trigger, followUpRepository, videoTitle } = params;
  const referenceDate = params.referenceDate ?? new Date();
  const now = new Date();

  const reason =
    trigger === "video_sent" && videoTitle
      ? `video_sent:${videoTitle}`
      : FOLLOW_UP_REASONS[trigger];

  // Idempotência: se já existe um follow-up pending para este lead+reason, não cria outro.
  // Evita acúmulo durante sessões repetidas de teste (ex: reset → vídeo → reset → vídeo).
  const existing = await followUpRepository.findPendingByReason({ leadId, reason });
  if (existing) return;

  await followUpRepository.save({
    id: randomUUID(),
    clinicId,
    leadId,
    dueAt: calculateFollowUpDueAt(trigger, referenceDate),
    status: "pending",
    reason,
    suggestedMessage: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  });
}
