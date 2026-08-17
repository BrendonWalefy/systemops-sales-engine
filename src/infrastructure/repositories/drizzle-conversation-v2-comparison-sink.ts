import { isProxy } from "node:util/types";
import { inArray, lt } from "drizzle-orm";
import type { ConversationV2ComparisonSink } from "@/application/ports/conversation-v2-comparison-sink";
import {
  parseLiveComparisonRecord,
  type LiveComparisonRecord,
} from "@/application/conversation-v2/comparison-record";
import {
  canonicalizeModelIdAllowlist,
  snapshotExactPlainRecord,
} from "@/application/conversation-v2/comparison-record-config";
import { db } from "@/infrastructure/db/client";
import { conversationV2Comparisons } from "@/infrastructure/db/schema";

const RETENTION_MS = 30 * 24 * 60 * 60_000;

export class DrizzleConversationV2ComparisonSink
implements ConversationV2ComparisonSink {
  private readonly allowedModelIds: ReadonlySet<string>;
  private readonly now: () => Date;

  constructor(input: {
    allowedModelIds: readonly string[];
    now?: () => Date;
  }) {
    if (
      typeof input !== "object"
      || input === null
      || isProxy(input)
      || Array.isArray(input)
      || Object.getPrototypeOf(input) !== Object.prototype
    ) throw new Error("invalid comparison sink config");
    const keys = Object.prototype.hasOwnProperty.call(input, "now")
      ? ["allowedModelIds", "now"]
      : ["allowedModelIds"];
    const source = snapshotExactPlainRecord(input, keys, "invalid comparison sink config");
    const allowedModelIds = canonicalizeModelIdAllowlist(source.allowedModelIds);
    if (source.now !== undefined && typeof source.now !== "function") {
      throw new Error("invalid comparison sink clock");
    }
    this.allowedModelIds = new Set(allowedModelIds);
    this.now = (source.now as (() => Date) | undefined) ?? (() => new Date());
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

  async deleteExpired(now: Date, limit = 1_000): Promise<number> {
    if (
      !(now instanceof Date)
      || Number.isNaN(now.getTime())
      || !Number.isSafeInteger(limit)
      || limit < 1
      || limit > 1_000
    ) throw new Error("invalid bounded comparison retention request");
    const expired = await db
      .select({ turnRef: conversationV2Comparisons.turnRef })
      .from(conversationV2Comparisons)
      .where(lt(conversationV2Comparisons.expiresAt, now))
      .limit(limit);
    if (expired.length === 0) return 0;
    const deleted = await db
      .delete(conversationV2Comparisons)
      .where(inArray(
        conversationV2Comparisons.turnRef,
        expired.map(({ turnRef }) => turnRef),
      ))
      .returning({ turnRef: conversationV2Comparisons.turnRef });
    return deleted.length;
  }
}
