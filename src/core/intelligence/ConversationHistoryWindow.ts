export const DEFAULT_CONVERSATION_HISTORY_MESSAGES = 8;
export const MIN_CONVERSATION_HISTORY_MESSAGES = 4;
export const MAX_CONVERSATION_HISTORY_MESSAGES = 40;

export function resolveConversationHistoryWindow(value?: number | null): number {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return DEFAULT_CONVERSATION_HISTORY_MESSAGES;
  }

  return Math.min(
    MAX_CONVERSATION_HISTORY_MESSAGES,
    Math.max(MIN_CONVERSATION_HISTORY_MESSAGES, Math.trunc(value)),
  );
}

export function takeRecentConversationHistory<T>(
  history: readonly T[],
  requestedWindow?: number | null,
): T[] {
  return history.slice(-resolveConversationHistoryWindow(requestedWindow));
}
