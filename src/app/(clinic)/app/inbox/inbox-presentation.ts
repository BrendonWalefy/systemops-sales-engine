export type InboxPresentationRow = {
  aiPaused: boolean;
  needsAttention: boolean;
  takeoverExpiresAt?: Date | null;
  lastMessageAt: Date | null;
  hoursWaiting?: number;
  leadStatus: string;
  conversationCategory: string;
  latestAppointmentStatus?: string | null;
  latestAppointmentUpdatedAt?: Date | null;
};

export type InboxLastMessage = {
  author: string;
};

export type AppointmentLifecycleState =
  | "none"
  | "scheduled"
  | "confirmed"
  | "cancelled"
  | "completed"
  | "no_show";

const RECOVERY_WAIT_HOURS = 2;

export function resolveAppointmentLifecycleState(
  row: InboxPresentationRow,
  lastMsg?: InboxLastMessage,
): AppointmentLifecycleState {
  const status = row.latestAppointmentStatus;
  if (
    status !== "scheduled" &&
    status !== "confirmed" &&
    status !== "cancelled" &&
    status !== "completed" &&
    status !== "no_show"
  ) {
    return "none";
  }

  if (status === "scheduled" || status === "confirmed") {
    return status;
  }

  const outcomeUpdatedAt = row.latestAppointmentUpdatedAt;
  const leadRepliedAfterOutcome =
    lastMsg?.author === "lead" &&
    outcomeUpdatedAt instanceof Date &&
    row.lastMessageAt instanceof Date &&
    row.lastMessageAt.getTime() > outcomeUpdatedAt.getTime();

  return leadRepliedAfterOutcome ? "none" : status;
}

export function resolvePipelineIndex(
  row: InboxPresentationRow,
  lastMsg?: InboxLastMessage,
): number {
  const appointmentState = resolveAppointmentLifecycleState(row, lastMsg);

  if (
    appointmentState === "scheduled" ||
    appointmentState === "confirmed" ||
    appointmentState === "completed"
  ) {
    return 4;
  }

  if (appointmentState === "cancelled" || appointmentState === "no_show") {
    return 3;
  }

  if (row.leadStatus === "new") return 0;
  if (row.leadStatus === "waiting_response" || row.leadStatus === "in_conversation") return 1;
  if (row.leadStatus === "follow_up_due") return 2;
  return 4;
}

export function isRecoveryCandidate(
  row: InboxPresentationRow,
  lastMsg?: InboxLastMessage,
): boolean {
  const appointmentState = resolveAppointmentLifecycleState(row, lastMsg);
  if (row.leadStatus === "lost" || row.leadStatus === "won") return false;
  if (appointmentState === "cancelled" || appointmentState === "no_show") return true;
  if (row.leadStatus === "follow_up_due") return true;
  if (row.aiPaused && row.takeoverExpiresAt && new Date(row.takeoverExpiresAt) < new Date()) return true;
  return !row.aiPaused && lastMsg?.author === "lead" && (row.hoursWaiting ?? 0) >= RECOVERY_WAIT_HOURS;
}

