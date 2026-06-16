"use client";

import { useEffect, useState, useTransition } from "react";
import { Bell, BellOff, BellRing, RefreshCw, Smartphone } from "lucide-react";
import {
  detectPushPermissionState,
  getCurrentPushSubscription,
  subscribeAndSave,
  unsubscribeAndDelete,
  type PushPermissionState,
} from "./push-notification-setup";
import { haptic } from "@/lib/haptic";

type DeviceState = "checking" | "inactive" | "active";

function statusTone(permission: PushPermissionState, deviceState: DeviceState): {
  label: string;
  color: string;
  background: string;
  border: string;
} {
  if (permission === "denied") {
    return {
      label: "Bloqueadas no navegador",
      color: "#f59e0b",
      background: "rgba(245,158,11,0.1)",
      border: "1px solid rgba(245,158,11,0.2)",
    };
  }

  if (deviceState === "active") {
    return {
      label: "Ativas neste dispositivo",
      color: "#34d399",
      background: "rgba(16,185,129,0.1)",
      border: "1px solid rgba(16,185,129,0.2)",
    };
  }

  if (permission === "unsupported") {
    return {
      label: "Não suportado",
      color: "#a1a1aa",
      background: "rgba(255,255,255,0.05)",
      border: "1px solid rgba(255,255,255,0.08)",
    };
  }

  return {
    label: "Desativadas",
    color: "#a1a1aa",
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.08)",
  };
}

export function PushNotificationSettingsCard() {
  const [permission, setPermission] = useState<PushPermissionState>("loading");
  const [deviceState, setDeviceState] = useState<DeviceState>("checking");
  const [error, setError] = useState<string | null>(null);
  const [subscriptionPreview, setSubscriptionPreview] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function refreshState(): Promise<void> {
    const nextPermission = detectPushPermissionState();
    setPermission(nextPermission);

    if (nextPermission !== "granted") {
      setDeviceState("inactive");
      setSubscriptionPreview(null);
      return;
    }

    const subscription = await getCurrentPushSubscription().catch(() => null);
    setDeviceState(subscription ? "active" : "inactive");
    setSubscriptionPreview(subscription ? subscription.endpoint.slice(-24) : null);
  }

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      void refreshState();
    });
    return () => cancelAnimationFrame(id);
  }, []);

  function handleEnable() {
    haptic("medium");
    setError(null);

    startTransition(async () => {
      try {
        const currentPermission = detectPushPermissionState();
        if (currentPermission === "unsupported") {
          setPermission("unsupported");
          return;
        }

        const permissionResult = currentPermission === "default"
          ? await Notification.requestPermission()
          : currentPermission;

        setPermission(permissionResult as PushPermissionState);
        if (permissionResult !== "granted") {
          setDeviceState("inactive");
          return;
        }

        const registration = await navigator.serviceWorker.ready;
        const ok = await subscribeAndSave(registration);
        if (!ok) {
          setError("Não foi possível salvar a inscrição de notificações.");
        }

        await refreshState();
      } catch {
        setError("Falha ao ativar notificações neste dispositivo.");
      }
    });
  }

  function handleDisable() {
    haptic();
    setError(null);

    startTransition(async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        const ok = await unsubscribeAndDelete(registration);
        if (!ok) {
          setError("Não foi possível desativar a inscrição atual.");
        }
        await refreshState();
      } catch {
        setError("Falha ao desativar notificações neste dispositivo.");
      }
    });
  }

  function handleRefresh() {
    haptic();
    setError(null);
    startTransition(async () => {
      await refreshState().catch(() => {
        setError("Não foi possível atualizar o status das notificações.");
      });
    });
  }

  const tone = statusTone(permission, deviceState);
  const loading = permission === "loading" || deviceState === "checking";
  const canEnable = permission === "default" || (permission === "granted" && deviceState === "inactive");
  const canDisable = permission === "granted" && deviceState === "active";

  return (
    <div style={{
      background: "#141416",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: "14px",
      padding: "16px 18px",
      display: "flex",
      flexDirection: "column",
      gap: "14px",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
          <div style={{
            display: "grid",
            placeItems: "center",
            width: "36px",
            height: "36px",
            borderRadius: "10px",
            background: "rgba(16,185,129,0.08)",
            border: "1px solid rgba(16,185,129,0.16)",
            color: "#34d399",
            flexShrink: 0,
          }}>
            {permission === "denied" ? <BellOff size={16} strokeWidth={1.9} /> : <Bell size={16} strokeWidth={1.9} />}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <strong style={{ fontSize: "14px", fontWeight: 600, color: "#fafafa" }}>Notificações push</strong>
              <span style={{
                fontSize: "10px",
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: "999px",
                color: tone.color,
                background: tone.background,
                border: tone.border,
              }}>
                {loading ? "Verificando..." : tone.label}
              </span>
            </div>
            <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#52525b", lineHeight: 1.5 }}>
              Controla alertas de inbox neste navegador/dispositivo sem depender da aba aberta.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleRefresh}
          disabled={isPending}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "32px",
            height: "32px",
            borderRadius: "10px",
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.03)",
            color: "#a1a1aa",
            cursor: isPending ? "default" : "pointer",
            flexShrink: 0,
          }}
          aria-label="Atualizar status das notificações"
        >
          <RefreshCw size={14} strokeWidth={2} style={isPending ? { animation: "spin 0.8s linear infinite" } : undefined} />
        </button>
      </div>

      <div style={{
        display: "grid",
        gap: "10px",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
      }}>
        <div style={{
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: "10px",
          padding: "12px 14px",
        }}>
          <p style={{ margin: "0 0 6px", fontSize: "11px", color: "#71717a", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Permissão
          </p>
          <strong style={{ fontSize: "13px", color: "#fafafa" }}>
            {permission === "granted" ? "Concedida" : permission === "denied" ? "Bloqueada" : permission === "default" ? "Pendente" : permission === "unsupported" ? "Sem suporte" : "Verificando"}
          </strong>
        </div>

        <div style={{
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: "10px",
          padding: "12px 14px",
        }}>
          <p style={{ margin: "0 0 6px", fontSize: "11px", color: "#71717a", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Dispositivo
          </p>
          <strong style={{ fontSize: "13px", color: "#fafafa", display: "flex", alignItems: "center", gap: "6px" }}>
            <Smartphone size={13} strokeWidth={2} />
            {deviceState === "active" ? "Inscrito" : deviceState === "inactive" ? "Sem inscrição" : "Verificando"}
          </strong>
          {subscriptionPreview && (
            <p style={{ margin: "6px 0 0", fontSize: "11px", color: "#52525b" }}>
              Endpoint local: <code>...{subscriptionPreview}</code>
            </p>
          )}
        </div>
      </div>

      {permission === "denied" && (
        <div style={{
          background: "rgba(245,158,11,0.08)",
          border: "1px solid rgba(245,158,11,0.14)",
          color: "#fbbf24",
          borderRadius: "10px",
          padding: "12px 14px",
          fontSize: "12px",
          lineHeight: 1.5,
        }}>
          As notificações foram bloqueadas pelo navegador. Reative nas configurações do navegador/sistema e depois toque em atualizar.
        </div>
      )}

      {permission === "unsupported" && (
        <div style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.06)",
          color: "#a1a1aa",
          borderRadius: "10px",
          padding: "12px 14px",
          fontSize: "12px",
          lineHeight: 1.5,
        }}>
          Este navegador não suporta push web ou a chave pública VAPID não está configurada no ambiente.
        </div>
      )}

      {error && (
        <div style={{
          background: "rgba(239,68,68,0.08)",
          border: "1px solid rgba(239,68,68,0.14)",
          color: "#f87171",
          borderRadius: "10px",
          padding: "12px 14px",
          fontSize: "12px",
          lineHeight: 1.5,
        }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={handleEnable}
          disabled={isPending || !canEnable}
          className="primary-button"
          style={{ minWidth: "170px" }}
        >
          <BellRing size={14} strokeWidth={2} />
          {permission === "granted" ? "Reativar neste dispositivo" : "Ativar notificações"}
        </button>
        <button
          type="button"
          onClick={handleDisable}
          disabled={isPending || !canDisable}
          className="secondary-button"
          style={{ minWidth: "170px" }}
        >
          <BellOff size={14} strokeWidth={2} />
          Desativar neste dispositivo
        </button>
      </div>

      <p style={{ margin: 0, fontSize: "11px", color: "#52525b", lineHeight: 1.5 }}>
        A ativação vale para este navegador/dispositivo. Outros operadores podem manter notificações próprias em seus aparelhos.
      </p>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
