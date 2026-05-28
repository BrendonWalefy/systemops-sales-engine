import { eq } from "drizzle-orm";
import type { PushSubscription } from "@/domain/entities/push-subscription";
import type { PushSubscriptionRepository } from "@/domain/repositories/push-subscription-repository";
import { db } from "@/infrastructure/db/client";
import { pushSubscriptions } from "@/infrastructure/db/schema";

export class DrizzlePushSubscriptionRepository implements PushSubscriptionRepository {
  async save(sub: PushSubscription): Promise<void> {
    await db
      .insert(pushSubscriptions)
      .values({
        id: sub.id,
        clinicId: sub.clinicId,
        userEmail: sub.userEmail,
        endpoint: sub.endpoint,
        p256dh: sub.p256dh,
        auth: sub.auth,
        createdAt: sub.createdAt,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          p256dh: sub.p256dh,
          auth: sub.auth,
          userEmail: sub.userEmail,
        },
      });
  }

  async findByClinicId(clinicId: string): Promise<PushSubscription[]> {
    const rows = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.clinicId, clinicId));
    return rows.map(mapRow);
  }

  async deleteByEndpoint(endpoint: string): Promise<void> {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
  }
}

function mapRow(row: typeof pushSubscriptions.$inferSelect): PushSubscription {
  return {
    id: row.id,
    clinicId: row.clinicId,
    userEmail: row.userEmail,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    createdAt: row.createdAt,
  };
}
