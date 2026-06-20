export type ConversationCategory =
  | "sales"
  | "operational"
  | "vendor"
  | "spam"
  | "archived";

export const NON_SALES_CONVERSATION_CATEGORIES: ConversationCategory[] = [
  "operational",
  "vendor",
  "spam",
  "archived",
];

export function isSalesConversationCategory(
  category: ConversationCategory | string | null | undefined,
): boolean {
  return (category ?? "sales") === "sales";
}
