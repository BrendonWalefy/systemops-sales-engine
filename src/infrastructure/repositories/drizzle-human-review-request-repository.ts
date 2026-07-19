import { and, eq, sql } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { humanReviewRequests } from "@/infrastructure/db/schema";
import type {
  HumanReviewDecision,
  HumanReviewDecisionSource,
} from "@/domain/entities/human-review";

export type HumanReviewRequestRecord = typeof humanReviewRequests.$inferSelect;

export class DrizzleHumanReviewRequestRepository {
  async createPending(input: {
    clinicId: string;
    conversationId: string;
    leadId: string;
    sourceMessageId: string | null;
    treatmentId: string | null;
    targetTreatmentId: string | null;
    sourceMediaType: "image" | "video" | "document" | null;
    sourceMediaUrl: string | null;
    expiresAt?: Date | null;
  }): Promise<HumanReviewRequestRecord> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const reviewCode = await this.nextAvailableCode(input.clinicId);
      try {
        const [created] = await db
          .insert(humanReviewRequests)
          .values({
            clinicId: input.clinicId,
            conversationId: input.conversationId,
            leadId: input.leadId,
            sourceMessageId: input.sourceMessageId,
            treatmentId: input.treatmentId,
            targetTreatmentId: input.targetTreatmentId,
            reviewCode,
            status: "pending",
            sourceMediaType: input.sourceMediaType ?? undefined,
            sourceMediaUrl: input.sourceMediaUrl,
            expiresAt: input.expiresAt ?? null,
          })
          .returning();
        return created;
      } catch (error) {
        if (attempt === 2) throw error;
      }
    }

    throw new Error("Could not create human review request");
  }

  async findPendingByCode(params: {
    clinicId: string;
    reviewCode: number;
  }): Promise<HumanReviewRequestRecord | null> {
    const [row] = await db
      .select()
      .from(humanReviewRequests)
      .where(
        and(
          eq(humanReviewRequests.clinicId, params.clinicId),
          eq(humanReviewRequests.reviewCode, params.reviewCode),
          eq(humanReviewRequests.status, "pending"),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async findPendingByConversation(params: {
    clinicId: string;
    conversationId: string;
  }): Promise<HumanReviewRequestRecord | null> {
    const [row] = await db
      .select()
      .from(humanReviewRequests)
      .where(
        and(
          eq(humanReviewRequests.clinicId, params.clinicId),
          eq(humanReviewRequests.conversationId, params.conversationId),
          eq(humanReviewRequests.status, "pending"),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async applyDecision(params: {
    id: string;
    decision: HumanReviewDecision;
    source: HumanReviewDecisionSource;
    reviewerPhone: string | null;
    reviewNotes?: string | null;
    now?: Date;
  }): Promise<HumanReviewRequestRecord | null> {
    const now = params.now ?? new Date();
    const [updated] = await db
      .update(humanReviewRequests)
      .set({
        status: "decided",
        decision: params.decision,
        decisionSource: params.source,
        reviewerPhone: params.reviewerPhone,
        reviewNotes: params.reviewNotes ?? null,
        decidedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(humanReviewRequests.id, params.id),
          eq(humanReviewRequests.status, "pending"),
        ),
      )
      .returning();
    return updated ?? null;
  }

  async appendReviewContext(params: {
    id: string;
    context: string;
    now?: Date;
  }): Promise<HumanReviewRequestRecord | null> {
    const now = params.now ?? new Date();
    const line = `[${now.toISOString()}] ${params.context.trim()}`;
    const [updated] = await db
      .update(humanReviewRequests)
      .set({
        reviewNotes: sql<string>`CASE
          WHEN ${humanReviewRequests.reviewNotes} IS NULL OR ${humanReviewRequests.reviewNotes} = ''
            THEN ${line}
          ELSE ${humanReviewRequests.reviewNotes} || E'\n' || ${line}
        END`,
        updatedAt: now,
      })
      .where(
        and(
          eq(humanReviewRequests.id, params.id),
          eq(humanReviewRequests.status, "pending"),
        ),
      )
      .returning();
    return updated ?? null;
  }

  private async nextAvailableCode(clinicId: string): Promise<number> {
    const pending = await db
      .select({ reviewCode: humanReviewRequests.reviewCode })
      .from(humanReviewRequests)
      .where(
        and(
          eq(humanReviewRequests.clinicId, clinicId),
          eq(humanReviewRequests.status, "pending"),
        ),
      );

    const used = new Set(pending.map((row) => row.reviewCode));
    for (let code = 1; code <= 999; code++) {
      if (!used.has(code)) return code;
    }

    throw new Error(`No human review codes available for clinic ${clinicId}`);
  }
}
