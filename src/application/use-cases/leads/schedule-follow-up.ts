import { randomUUID } from "crypto";
import type { FollowUpRepository } from "@/domain/repositories/follow-up-repository";

export type ScheduleFollowUpTrigger = "appointment_completed" | "no_show" | "lost" | "video_sent";

export const FOLLOW_UP_REASONS: Record<Exclude<ScheduleFollowUpTrigger, "video_sent">, string> = {
  appointment_completed: "Retorno de rotina",
  no_show: "Lead não compareceu à consulta",
  lost: "Lead inativo — segunda chance",
};

export function buildFollowUpReason(
  trigger: ScheduleFollowUpTrigger,
  input: { videoTitle?: string } = {},
): string {
  if (trigger === "video_sent") {
    return input.videoTitle ? `video_sent:${input.videoTitle}` : "video_sent";
  }

  return FOLLOW_UP_REASONS[trigger];
}

export function shouldCancelFollowUpOnLeadReengagement(reason: string): boolean {
  return (
    reason.startsWith("video_sent:") ||
    reason === "video_sent" ||
    reason === FOLLOW_UP_REASONS.lost ||
    reason === FOLLOW_UP_REASONS.no_show
  );
}

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

  const reason = buildFollowUpReason(trigger, { videoTitle });

  // Mantém só um pending por lead+reason. Se houver um antigo, cancela e substitui
  // pelo novo dueAt para evitar acúmulo silencioso de follow-ups de teste/replay.
  await followUpRepository.cancelPendingByReason({ leadId, reason });

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
