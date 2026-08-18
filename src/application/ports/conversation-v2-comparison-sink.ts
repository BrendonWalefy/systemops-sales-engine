import type { LiveComparisonRecord } from "@/application/conversation-v2/comparison-record";

export type ConversationV2ComparisonSink = {
  append(input: Readonly<{
    clinicId: string;
    record: LiveComparisonRecord;
  }>): Promise<void>;
};
