import type { ClinicAutomationMode } from "@/application/automation/clinic-automation-policy";
import type { V1TurnObservationSink } from "@/core/observability/V1TurnObservation";

export type ConversationHandleInput = {
  clinicId: string;
  phone: string;
  whatsappLid?: string | null;
  messageText: string;
  messageId: string;
  senderName?: string;
  senderPhoto?: string | null;
  timestamp: Date;
  turnId?: string;
  replyEnabled?: boolean;
  observationOnly?: boolean;
  mediaUrl?: string;
  mediaType?: "image" | "video" | "audio" | "document";
  turnObservationSink?: V1TurnObservationSink;
  automationMode: ClinicAutomationMode;
};

export type ConversationHandleResult = { replied: boolean; reason?: string };

export interface ConversationHandler {
  handle(input: ConversationHandleInput): Promise<ConversationHandleResult>;
}
