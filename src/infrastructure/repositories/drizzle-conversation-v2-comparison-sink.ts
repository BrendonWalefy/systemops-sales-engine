import type { ConversationV2ComparisonSink } from "@/application/ports/conversation-v2-comparison-sink";
import {
  parseLiveComparisonRecord,
  type LiveComparisonRecord,
} from "@/application/conversation-v2/comparison-record";
import { db } from "@/infrastructure/db/client";
import { conversationV2Comparisons } from "@/infrastructure/db/schema";

const RETENTION_MS = 30 * 24 * 60 * 60_000;

export class DrizzleConversationV2ComparisonSink
implements ConversationV2ComparisonSink {
  private readonly allowedModelIds: ReadonlySet<string>;
  private readonly now: () => Date;

  constructor(input: {
    allowedModelIds: ReadonlySet<string>;
    now?: () => Date;
  }) {
    this.allowedModelIds = Object.freeze(new Set(input.allowedModelIds));
    this.now = input.now ?? (() => new Date());
  }

  async append(input: Readonly<{
    clinicId: string;
    record: LiveComparisonRecord;
  }>): Promise<void> {
    const record = parseLiveComparisonRecord(input.record, this.allowedModelIds);
    const now = this.now();
    await db.insert(conversationV2Comparisons).values({
      turnRef: record.turnRef,
      clinicId: input.clinicId,
      record,
      occurredAt: new Date(record.occurredAt),
      expiresAt: new Date(now.getTime() + RETENTION_MS),
    });
  }
}
