import type { ConversationEnginePolicy } from "@/application/conversation-v2/engine-selection";

export type ConversationEnginePolicyReader = {
  getConversationEnginePolicy(clinicId: string): Promise<ConversationEnginePolicy>;
};
