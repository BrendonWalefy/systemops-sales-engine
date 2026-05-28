import type { PushSubscription } from "@/domain/entities/push-subscription";

export type PushSubscriptionRepository = {
  save(sub: PushSubscription): Promise<void>;
  findByClinicId(clinicId: string): Promise<PushSubscription[]>;
  deleteByEndpoint(endpoint: string): Promise<void>;
};
