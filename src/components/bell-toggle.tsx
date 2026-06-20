"use client";

import { useEffect, useState, useTransition } from "react";
import { Bell, BellOff } from "lucide-react";
import {
  detectPushPermissionState,
  getCurrentPushSubscription,
  subscribeAndSave,
  unsubscribeAndDelete,
  type PushPermissionState,
} from "./push-notification-setup";
import { haptic } from "@/lib/haptic";

export function BellToggle() {
  const [permission, setPermission] = useState<PushPermissionState>("loading");
  const [active, setActive] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function refresh() {
    const p = detectPushPermissionState();
    setPermission(p);
    if (p !== "granted") {
      setActive(false);
      return;
    }
    const sub = await getCurrentPushSubscription().catch(() => null);
    setActive(!!sub);
  }

  useEffect(() => {
    const id = requestAnimationFrame(() => void refresh());
    return () => cancelAnimationFrame(id);
  }, []);

  function handleClick() {
    if (permission === "unsupported" || permission === "loading") return;
    haptic();

    if (active) {
      startTransition(async () => {
        const reg = await navigator.serviceWorker.ready;
        await unsubscribeAndDelete(reg).catch(() => {});
        await refresh();
      });
      return;
    }

    if (permission === "denied") return;

    startTransition(async () => {
      const result =
        permission === "default"
          ? await Notification.requestPermission()
          : "granted";
      if (result !== "granted") {
        await refresh();
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      await subscribeAndSave(reg).catch(() => {});
      await refresh();
    });
  }

  const isUnsupported = permission === "unsupported";
  const isDenied = permission === "denied";

  const color = active
    ? "#34d399"
    : isDenied
      ? "#f59e0b"
      : "#52525b";

  const title = active
    ? "Notificações ativas — clique para desativar"
    : isDenied
      ? "Notificações bloqueadas pelo navegador"
      : isUnsupported
        ? "Notificações não suportadas neste navegador"
        : "Ativar notificações push";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending || isUnsupported || permission === "loading"}
      title={title}
      aria-label={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "32px",
        height: "32px",
        borderRadius: "8px",
        border: "none",
        background: "transparent",
        color,
        cursor: isUnsupported || isDenied ? "default" : "pointer",
        opacity: isPending ? 0.5 : permission === "loading" ? 0 : 1,
        transition: "color 150ms, opacity 200ms",
        flexShrink: 0,
      }}
    >
      {active ? (
        <Bell size={15} strokeWidth={2} />
      ) : (
        <BellOff size={15} strokeWidth={2} />
      )}
    </button>
  );
}
