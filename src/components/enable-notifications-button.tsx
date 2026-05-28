"use client";

import { useState, useEffect } from "react";
import { BellOff, BellRing } from "lucide-react";
import { subscribeAndSave } from "./push-notification-setup";

type State = "loading" | "unsupported" | "default" | "granted" | "denied";

function detectState(): State {
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window) ||
    !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  ) {
    return "unsupported";
  }
  return Notification.permission as State;
}

export function EnableNotificationsButton() {
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    // requestAnimationFrame defers the setState fora do corpo síncrono do efeito,
    // satisfazendo a regra do linter sem afetar a funcionalidade.
    const id = requestAnimationFrame(() => setState(detectState()));
    return () => cancelAnimationFrame(id);
  }, []);

  async function handleClick() {
    if (state !== "default") return;
    setState("loading");

    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission as State);
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      await subscribeAndSave(registration);
      setState("granted");
    } catch {
      setState("default");
    }
  }

  if (state === "loading" || state === "unsupported" || state === "granted") return null;

  if (state === "denied") {
    return (
      <span
        title="Notificações bloqueadas — ative nas configurações do iPhone"
        style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)", cursor: "default" }}
      >
        <BellOff size={14} />
        Notificações bloqueadas
      </span>
    );
  }

  return (
    <button
      onClick={handleClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
        fontWeight: 500,
        color: "var(--accent)",
        background: "none",
        border: "1px solid currentColor",
        borderRadius: 6,
        padding: "4px 10px",
        cursor: "pointer",
      }}
    >
      <BellRing size={13} />
      Ativar notificações
    </button>
  );
}
