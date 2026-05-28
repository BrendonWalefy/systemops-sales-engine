import type { PushSubscriptionRepository } from "@/domain/repositories/push-subscription-repository";
import type { PushGateway, PushPayload } from "@/application/ports/push-gateway";

export class NotifyClinicOperators {
  constructor(
    private repo: PushSubscriptionRepository,
    private gateway: PushGateway,
  ) {}

  async execute(clinicId: string, payload: PushPayload): Promise<void> {
    const subscriptions = await this.repo.findByClinicId(clinicId);
    if (subscriptions.length === 0) return;

    const results = await Promise.allSettled(
      subscriptions.map((sub) =>
        this.gateway.send({ endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth }, payload),
      ),
    );

    // Remove subscriptions that the push service says are gone (410/404)
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "rejected") {
        const err = result.reason as { statusCode?: number };
        if (err.statusCode === 410 || err.statusCode === 404) {
          await this.repo.deleteByEndpoint(subscriptions[i].endpoint).catch(() => {});
        }
        console.error("[NotifyClinicOperators] Push failed:", result.reason);
      }
    }
  }
}
