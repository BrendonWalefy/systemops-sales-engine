"use client";

import { useEffect } from "react";

export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}

export async function subscribeAndSave(registration: ServiceWorkerRegistration): Promise<boolean> {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicKey) return false;

  const existing = await registration.pushManager.getSubscription();
  if (existing) return true;

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  const json = subscription.toJSON();
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
    }),
  });
  return res.ok;
}

// Registra o service worker silenciosamente.
// Se a permissão já foi concedida antes, assina automaticamente.
// A solicitação inicial de permissão deve vir de um gesto do usuário (EnableNotificationsButton).
export function PushNotificationSetup() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) return;

    navigator.serviceWorker
      .register("/sw.js")
      .then(async (registration) => {
        if (Notification.permission === "granted") {
          await subscribeAndSave(registration).catch(() => {});
        }
      })
      .catch((err) => console.error("[PushSetup] SW registration failed:", err));
  }, []);

  return null;
}
