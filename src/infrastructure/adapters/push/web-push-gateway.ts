import webpush from "web-push";
import type { PushGateway, PushPayload } from "@/application/ports/push-gateway";

export class WebPushGateway implements PushGateway {
  private initialized = false;

  private ensureInitialized(): boolean {
    if (this.initialized) return true;
    const subject = process.env.VAPID_SUBJECT;
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    if (!subject || !publicKey || !privateKey) {
      console.warn("[WebPushGateway] VAPID keys not configured - push notifications disabled");
      return false;
    }
    webpush.setVapidDetails(subject, publicKey, privateKey);
    this.initialized = true;
    return true;
  }

  async send(
    subscription: { endpoint: string; p256dh: string; auth: string },
    payload: PushPayload,
  ): Promise<void> {
    if (!this.ensureInitialized()) return;
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
    );
  }
}
