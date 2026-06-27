import { and, desc, eq, gte } from "drizzle-orm";
import type {
  PlatformSpendAlert,
  PlatformSpendAlertStore,
  RecordPlatformSpendAlertInput,
} from "@/application/ports/platform-spend-alert-store";
import { db } from "@/infrastructure/db/client";
import { platformSpendAlerts } from "@/infrastructure/db/schema";

export class DrizzlePlatformSpendAlertStore implements PlatformSpendAlertStore {
  async record(
    input: RecordPlatformSpendAlertInput,
  ): Promise<{ alert: PlatformSpendAlert; isNew: boolean }> {
    const [created] = await db
      .insert(platformSpendAlerts)
      .values(input)
      .onConflictDoNothing({ target: platformSpendAlerts.eventKey })
      .returning();

    if (created) return { alert: mapAlert(created), isNew: true };

    const [existing] = await db
      .select()
      .from(platformSpendAlerts)
      .where(eq(platformSpendAlerts.eventKey, input.eventKey))
      .limit(1);

    if (!existing) {
      throw new Error("Vercel spend alert conflict without an existing event");
    }

    return { alert: mapAlert(existing), isNew: false };
  }

  async findLatest(provider: "vercel", since?: Date): Promise<PlatformSpendAlert | null> {
    const [row] = await db
      .select()
      .from(platformSpendAlerts)
      .where(
        since
          ? and(
              eq(platformSpendAlerts.provider, provider),
              gte(platformSpendAlerts.receivedAt, since),
            )
          : eq(platformSpendAlerts.provider, provider),
      )
      .orderBy(desc(platformSpendAlerts.receivedAt))
      .limit(1);

    return row ? mapAlert(row) : null;
  }
}

function mapAlert(row: typeof platformSpendAlerts.$inferSelect): PlatformSpendAlert {
  return {
    id: row.id,
    provider: row.provider,
    teamId: row.teamId,
    budgetAmountUsd: row.budgetAmountUsd,
    currentSpendUsd: row.currentSpendUsd,
    thresholdPercent: row.thresholdPercent,
    eventKey: row.eventKey,
    receivedAt: row.receivedAt,
  };
}
