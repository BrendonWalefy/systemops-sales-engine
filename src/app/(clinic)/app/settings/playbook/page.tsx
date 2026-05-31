export const dynamic = "force-dynamic";

import { db } from "@/infrastructure/db/client";
import { clinics, playbookVersions } from "@/infrastructure/db/schema";
import { eq, desc } from "drizzle-orm";
import { PlaybookVersionGrid } from "./playbook-version-grid";
import { ToggleAutoReply } from "./toggle-auto-reply";
import { saveTakeoverTtl, saveSchedulingPolicy, saveBusinessHours } from "./actions";
import { Save, MessageSquare, Timer, CalendarClock, Clock } from "lucide-react";

async function getData() {
  const clinicId = process.env.PILOT_CLINIC_ID!;
  const [clinic, versions] = await Promise.all([
    db
      .select({
        name: clinics.name,
        autoReplyEnabled: clinics.autoReplyEnabled,
        takeoverTtlHours: clinics.takeoverTtlHours,
        postAppointmentBufferMinutes: clinics.postAppointmentBufferMinutes,
        businessHours: clinics.businessHours,
      })
      .from(clinics)
      .where(eq(clinics.id, clinicId))
      .limit(1)
      .then((r) => r[0] ?? null),
    db
      .select()
      .from(playbookVersions)
      .where(eq(playbookVersions.clinicId, clinicId))
      .orderBy(desc(playbookVersions.updatedAt)),
  ]);
  return { clinic, versions };
}

export default async function PlaybookPage() {
  const { clinic, versions } = await getData();
  const activeVersion = versions.find((v) => v.status === "active");

  return (
    <div style={{ minHeight: "100vh", background: "var(--background)" }}>
      {/* Header */}
      <div
        style={{
          padding: "28px 32px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "4px" }}>
            <h1 style={{ margin: 0, fontSize: "20px", fontWeight: 700, color: "#fafafa" }}>
              Gerenciador de Playbooks
            </h1>
            {activeVersion && (
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 600,
                  padding: "3px 10px",
                  background: "rgba(16,185,129,0.1)",
                  color: "#34d399",
                  border: "1px solid rgba(16,185,129,0.25)",
                  borderRadius: "6px",
                  letterSpacing: "0.04em",
                }}
              >
                ATIVO: {activeVersion.name.toUpperCase()}
              </span>
            )}
          </div>
          {clinic && (
            <p style={{ margin: 0, fontSize: "13px", color: "#52525b" }}>{clinic.name}</p>
          )}
        </div>
      </div>

      <div style={{ padding: "28px 32px", display: "flex", flexDirection: "column", gap: "32px" }}>
        {/* Configurações operacionais */}
        <div>
          <p style={{ margin: "0 0 16px", fontSize: "11px", fontWeight: 700, color: "#52525b", letterSpacing: "0.08em" }}>
            CONFIGURAÇÕES DA IA
          </p>
          <div style={{ display: "grid", gap: "12px" }}>
            {/* Toggle auto reply */}
            <div style={settingsCardStyle}>
              <div style={{ display: "flex", alignItems: "center", gap: "14px", flex: 1 }}>
                <div style={iconBoxStyle}>
                  <MessageSquare size={16} strokeWidth={1.8} style={{ color: "#34d399" }} />
                </div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <strong style={{ fontSize: "14px", fontWeight: 600, color: "#fafafa" }}>
                      Recepcionista IA
                    </strong>
                    <span
                      style={{
                        fontSize: "10px",
                        fontWeight: 700,
                        padding: "2px 8px",
                        borderRadius: "5px",
                        ...(clinic?.autoReplyEnabled
                          ? { background: "rgba(16,185,129,0.12)", color: "#34d399", border: "1px solid rgba(16,185,129,0.25)" }
                          : { background: "rgba(255,255,255,0.05)", color: "#71717a", border: "1px solid rgba(255,255,255,0.08)" }),
                      }}
                    >
                      {clinic?.autoReplyEnabled ? "ATIVO" : "PAUSADO"}
                    </span>
                  </div>
                  <p style={{ margin: "2px 0 0", fontSize: "12px", color: "#52525b" }}>
                    Responde automaticamente leads no WhatsApp
                  </p>
                </div>
              </div>
              <ToggleAutoReply enabled={clinic?.autoReplyEnabled ?? false} />
            </div>

            {/* Takeover TTL + Buffer em linha */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div style={settingsCardStyle}>
                <div style={iconBoxStyle}>
                  <Timer size={16} strokeWidth={1.8} style={{ color: "#34d399" }} />
                </div>
                <div style={{ flex: 1 }}>
                  <strong style={{ fontSize: "14px", fontWeight: 600, color: "#fafafa", display: "block", marginBottom: "2px" }}>
                    Pausa automática
                  </strong>
                  <p style={{ margin: "0 0 10px", fontSize: "12px", color: "#52525b" }}>
                    IA retoma após operador responder
                  </p>
                  <form action={saveTakeoverTtl} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <input
                      type="number"
                      name="takeoverTtlHours"
                      defaultValue={clinic?.takeoverTtlHours ?? 4}
                      min={0}
                      max={72}
                      style={compactInputStyle}
                    />
                    <span style={{ fontSize: "12px", color: "#52525b" }}>h</span>
                    <button type="submit" style={saveIconBtnStyle}>
                      <Save size={13} />
                    </button>
                  </form>
                </div>
              </div>

              <div style={settingsCardStyle}>
                <div style={iconBoxStyle}>
                  <CalendarClock size={16} strokeWidth={1.8} style={{ color: "#34d399" }} />
                </div>
                <div style={{ flex: 1 }}>
                  <strong style={{ fontSize: "14px", fontWeight: 600, color: "#fafafa", display: "block", marginBottom: "2px" }}>
                    Intervalo entre atendimentos
                  </strong>
                  <p style={{ margin: "0 0 10px", fontSize: "12px", color: "#52525b" }}>
                    Tempo após cada agendamento
                  </p>
                  <form action={saveSchedulingPolicy} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <input
                      type="number"
                      name="postAppointmentBufferMinutes"
                      defaultValue={clinic?.postAppointmentBufferMinutes ?? 60}
                      min={0}
                      max={240}
                      step={5}
                      style={compactInputStyle}
                    />
                    <span style={{ fontSize: "12px", color: "#52525b" }}>min</span>
                    <button type="submit" style={saveIconBtnStyle}>
                      <Save size={13} />
                    </button>
                  </form>
                </div>
              </div>
            </div>

            {/* Business hours */}
            <div style={settingsCardStyle}>
              <div style={iconBoxStyle}>
                <Clock size={16} strokeWidth={1.8} style={{ color: "#34d399" }} />
              </div>
              <div style={{ flex: 1 }}>
                <strong style={{ fontSize: "14px", fontWeight: 600, color: "#fafafa", display: "block", marginBottom: "2px" }}>
                  Horário de funcionamento
                </strong>
                <p style={{ margin: "0 0 10px", fontSize: "12px", color: "#52525b" }}>
                  Informado pela IA ao responder leads
                </p>
                <form action={saveBusinessHours} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <input
                    type="text"
                    name="businessHours"
                    defaultValue={clinic?.businessHours ?? ""}
                    placeholder="Ex: Seg a Sex das 8h às 18h, Sáb das 8h às 13h"
                    style={{ ...compactInputStyle, width: "100%", flex: 1 }}
                  />
                  <button type="submit" style={saveIconBtnStyle}>
                    <Save size={13} />
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>

        {/* Divisor */}
        <div style={{ height: "1px", background: "rgba(255,255,255,0.05)" }} />

        {/* Versões de playbook */}
        <div>
          <p style={{ margin: "0 0 8px", fontSize: "11px", fontWeight: 700, color: "#52525b", letterSpacing: "0.08em" }}>
            SUAS VERSÕES
          </p>
          <p style={{ margin: "0 0 20px", fontSize: "13px", color: "#52525b", lineHeight: 1.6 }}>
            Cada versão é um conjunto independente de regras para a IA. A versão ativa é a que está em produção.
          </p>
          <PlaybookVersionGrid
            versions={versions.map((v) => ({
              id: v.id,
              name: v.name,
              status: v.status,
              updatedAt: v.updatedAt,
            }))}
          />
        </div>
      </div>
    </div>
  );
}

const settingsCardStyle: React.CSSProperties = {
  background: "#0d0d0f",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: "12px",
  padding: "16px 18px",
  display: "flex",
  alignItems: "flex-start",
  gap: "14px",
};

const iconBoxStyle: React.CSSProperties = {
  width: "34px",
  height: "34px",
  borderRadius: "8px",
  border: "1px solid rgba(255,255,255,0.07)",
  background: "rgba(16,185,129,0.07)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

const compactInputStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.09)",
  borderRadius: "7px",
  color: "#e4e4e7",
  fontSize: "13px",
  padding: "6px 10px",
  width: "80px",
  outline: "none",
  fontFamily: "inherit",
};

const saveIconBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "6px 10px",
  background: "rgba(16,185,129,0.12)",
  border: "1px solid rgba(16,185,129,0.2)",
  borderRadius: "7px",
  color: "#34d399",
  cursor: "pointer",
  flexShrink: 0,
};
