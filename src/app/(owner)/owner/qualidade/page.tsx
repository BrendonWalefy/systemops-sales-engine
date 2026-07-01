export const dynamic = "force-dynamic";

import Link from "next/link";
import { db } from "@/infrastructure/db/client";
import { organizations, clinicMetrics } from "@/infrastructure/db/schema";
import { eq, and, gte, desc } from "drizzle-orm";
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle,
  Activity,
  TrendingDown,
  RefreshCw,
} from "lucide-react";
import { recheckOperationalHealth } from "./actions";

type DailySnapshot = {
  clinicId: string;
  clinicName: string;
  periodFrom: Date;
  periodTo: Date;
  totalConversations: number;
  unclearRate: number;
  needsHumanRate: number;
  conversionRate: number;
  dropOffAfterSlotsRate: number;
  alerts: Array<{
    metric: string;
    value: number;
    threshold: number;
    level: "warn" | "critical";
  }>;
};

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(d);
}

async function fetchQualityData(): Promise<DailySnapshot[]> {
  const since = new Date();
  since.setDate(since.getDate() - 30);

  const allClinics = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.operationalStatus, "active"));

  const snapshots: DailySnapshot[] = [];

  for (const clinic of allClinics) {
    // Busca o snapshot diário mais recente (periodDays=1) da organização
    const [latest] = await db
      .select({
        periodFrom: clinicMetrics.periodFrom,
        periodTo: clinicMetrics.periodTo,
        data: clinicMetrics.data,
      })
      .from(clinicMetrics)
      .where(
        and(
          eq(clinicMetrics.clinicId, clinic.id),
          gte(clinicMetrics.periodFrom, since),
        ),
      )
      .orderBy(desc(clinicMetrics.createdAt))
      .limit(1);

    if (!latest) continue;

    const data = latest.data as Record<string, unknown>;
    if ((data.periodDays as number | undefined) !== 1) continue;

    snapshots.push({
      clinicId: clinic.id,
      clinicName: clinic.name,
      periodFrom: latest.periodFrom,
      periodTo: latest.periodTo,
      totalConversations: (data.totalConversations as number) ?? 0,
      unclearRate: (data.unclearRate as number) ?? 0,
      needsHumanRate: (data.needsHumanRate as number) ?? 0,
      conversionRate: (data.conversionRate as number) ?? 0,
      dropOffAfterSlotsRate: (data.dropOffAfterSlotsRate as number) ?? 0,
      alerts: (data.alerts as DailySnapshot["alerts"]) ?? [],
    });
  }

  return snapshots.sort((a, b) => b.alerts.length - a.alerts.length);
}

export default async function QualidadePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const sp = await searchParams;
  const snapshots = await fetchQualityData();
  const totalAlerts = snapshots.reduce((s, n) => s + n.alerts.length, 0);
  const hasCritical = snapshots.some((s) =>
    s.alerts.some((a) => a.level === "critical"),
  );
  const recheckState = sp.recheck;
  const recheckProcessed = Number(sp.processed ?? "0");
  const recheckFailed = Number(sp.failed ?? "0");
  const recheckChannelDegraded = Number(sp.channelDegraded ?? "0");
  const recheckSnapshotAlerts = Number(sp.snapshotAlerts ?? "0");
  const recheckMessage = sp.message;
  const recheckScope = sp.scope === "clinic" ? "da organização" : "geral";

  return (
    <div>
      <div className="product-topbar">
        <div
          className="owner-page-header"
          style={{ display: "flex", alignItems: "center", gap: 14 }}
        >
          <Link
            href="/owner"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              color: "var(--muted)",
              textDecoration: "none",
              fontSize: 13,
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            <ArrowLeft size={14} />
            Visão geral
          </Link>
          <span style={{ color: "var(--line-strong)" }}>·</span>
          <div className="owner-page-header-title">
            <h1 style={{ margin: 0 }}>Qualidade IA</h1>
            <p
              style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)" }}
            >
              Último snapshot diário por organização · Atualizado às 8h UTC ou sob demanda
            </p>
          </div>
        </div>
      </div>

      <div
        className="page-content"
        style={{ paddingBottom: 60, display: "grid", gap: 24 }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
            Use o recheck manual para recalcular o snapshot diário e revalidar a saúde operacional sem esperar o próximo cron.
          </p>
          <form action={recheckOperationalHealth}>
            <button
              type="submit"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                borderRadius: 10,
                border: "1px solid var(--line)",
                background: "var(--surface)",
                color: "var(--fg)",
                padding: "10px 14px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <RefreshCw size={14} />
              Recheck geral
            </button>
          </form>
        </div>

        {recheckState && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              border: `1px solid ${
                recheckState === "ok"
                  ? "rgba(16,185,129,0.2)"
                  : recheckState === "partial"
                    ? "rgba(245,158,11,0.25)"
                    : "rgba(239,68,68,0.3)"
              }`,
              borderRadius: 12,
              padding: "16px 20px",
              background:
                recheckState === "ok"
                  ? "rgba(16,185,129,0.05)"
                  : recheckState === "partial"
                    ? "rgba(245,158,11,0.05)"
                    : "rgba(239,68,68,0.05)",
            }}
          >
            {recheckState === "ok" ? (
              <CheckCircle
                size={16}
                style={{ color: "var(--accent)", flexShrink: 0 }}
              />
            ) : (
              <AlertTriangle
                size={16}
                style={{
                  color:
                    recheckState === "partial" ? "#f59e0b" : "#ef4444",
                  flexShrink: 0,
                }}
              />
            )}
            <span style={{ fontSize: 13, color: "var(--fg)" }}>
              {recheckMessage
                ? recheckMessage
                : `Recheck ${recheckScope} concluído: ${
                    recheckProcessed === 1
                      ? "1 organização processada"
                      : `${recheckProcessed} organizações processadas`
                  }, ${recheckFailed} falha(s), ${recheckChannelDegraded} canal(is) degradado(s) e ${recheckSnapshotAlerts} alerta(s) de snapshot no resultado atual.`}
            </span>
          </div>
        )}

        {/* Banner de status global */}
        {snapshots.length === 0 ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              border: "1px solid rgba(100,116,139,0.2)",
              borderRadius: 12,
              padding: "16px 20px",
              background: "var(--surface)",
            }}
          >
            <Activity
              size={16}
              style={{ color: "var(--muted)", flexShrink: 0 }}
            />
            <span style={{ fontSize: 13, color: "var(--muted)" }}>
              Nenhum snapshot disponível ainda. O cron de analytics roda às 8h
              UTC.
            </span>
          </div>
        ) : totalAlerts === 0 ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              border: "1px solid rgba(16,185,129,0.2)",
              borderRadius: 12,
              padding: "16px 20px",
              background: "rgba(16,185,129,0.05)",
            }}
          >
            <CheckCircle
              size={16}
              style={{ color: "var(--accent)", flexShrink: 0 }}
            />
            <span style={{ fontSize: 13, color: "var(--fg)" }}>
              Todas as organizações dentro dos limites. Nenhum alerta ativo.
            </span>
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              border: `1px solid ${hasCritical ? "rgba(239,68,68,0.3)" : "rgba(245,158,11,0.25)"}`,
              borderRadius: 12,
              padding: "16px 20px",
              background: hasCritical
                ? "rgba(239,68,68,0.05)"
                : "rgba(245,158,11,0.05)",
            }}
          >
            <AlertTriangle
              size={16}
              style={{
                color: hasCritical ? "#ef4444" : "#f59e0b",
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 13, color: "var(--fg)" }}>
              {totalAlerts} alerta{totalAlerts > 1 ? "s" : ""} ativo
              {totalAlerts > 1 ? "s" : ""}
              {hasCritical ? " — verifique os itens críticos abaixo" : ""}.
            </span>
          </div>
        )}

        {/* Tabela de snapshots */}
        {snapshots.length > 0 && (
          <div style={{ display: "grid", gap: 12 }}>
            {snapshots.map((snap) => {
              const hasCriticalAlert = snap.alerts.some(
                (a) => a.level === "critical",
              );
              const hasWarnAlert = snap.alerts.some((a) => a.level === "warn");
              const borderColor = hasCriticalAlert
                ? "rgba(239,68,68,0.3)"
                : hasWarnAlert
                  ? "rgba(245,158,11,0.25)"
                  : "var(--line)";

              return (
                <div
                  key={snap.clinicId}
                  style={{
                    border: `1px solid ${borderColor}`,
                    borderRadius: 12,
                    padding: "20px 24px",
                    background: "var(--surface)",
                    display: "grid",
                    gap: 16,
                  }}
                >
                  {/* Header da organização */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: 15,
                          color: "var(--fg)",
                        }}
                      >
                        {snap.clinicName}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--muted)",
                          marginTop: 2,
                        }}
                      >
                        Período: {formatDate(snap.periodFrom)} →{" "}
                        {formatDate(snap.periodTo)}
                      </div>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        flexShrink: 0,
                      }}
                    >
                      {snap.alerts.length > 0 && (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <AlertTriangle
                            size={13}
                            style={{
                              color: hasCriticalAlert ? "#ef4444" : "#f59e0b",
                            }}
                          />
                          <span
                            style={{
                              fontSize: 12,
                              color: hasCriticalAlert ? "#ef4444" : "#f59e0b",
                              fontWeight: 600,
                            }}
                          >
                            {snap.alerts.length} alerta
                            {snap.alerts.length > 1 ? "s" : ""}
                          </span>
                        </div>
                      )}
                      <form action={recheckOperationalHealth}>
                        <input type="hidden" name="clinicId" value={snap.clinicId} />
                        <button
                          type="submit"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 8,
                            borderRadius: 10,
                            border: "1px solid var(--line)",
                            background: "transparent",
                            color: "var(--fg)",
                            padding: "8px 12px",
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          <RefreshCw size={13} />
                          Recheck
                        </button>
                      </form>
                    </div>
                  </div>

                  {/* Métricas */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fill, minmax(130px, 1fr))",
                      gap: 12,
                    }}
                  >
                    <MetricCard
                      label="Conversas"
                      value={String(snap.totalConversations)}
                      warn={snap.totalConversations === 0}
                    />
                    <MetricCard
                      label="Taxa unclear"
                      value={pct(snap.unclearRate)}
                      warn={snap.unclearRate > 0.2}
                    />
                    <MetricCard
                      label="Needs human"
                      value={pct(snap.needsHumanRate)}
                      warn={snap.needsHumanRate > 0.3}
                    />
                    <MetricCard
                      label="Conversão"
                      value={pct(snap.conversionRate)}
                      good={snap.conversionRate > 0.05}
                    />
                    <MetricCard
                      label="Drop pós-slots"
                      value={pct(snap.dropOffAfterSlotsRate)}
                      warn={snap.dropOffAfterSlotsRate > 0.5}
                    />
                  </div>

                  {/* Alertas detalhados */}
                  {snap.alerts.length > 0 && (
                    <div style={{ display: "grid", gap: 6 }}>
                      {snap.alerts.map((alert, i) => (
                        <div
                          key={i}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            fontSize: 12,
                            color:
                              alert.level === "critical"
                                ? "#ef4444"
                                : "#f59e0b",
                          }}
                        >
                          {alert.level === "critical" ? (
                            <TrendingDown size={12} />
                          ) : (
                            <AlertTriangle size={12} />
                          )}
                          <span>
                            <strong>{alert.metric}</strong>:{" "}
                            {typeof alert.value === "number" && alert.value < 1
                              ? pct(alert.value)
                              : alert.value}{" "}
                            (limite:{" "}
                            {typeof alert.threshold === "number" &&
                            alert.threshold < 1
                              ? pct(alert.threshold)
                              : alert.threshold}
                            )
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  warn = false,
  good = false,
}: {
  label: string;
  value: string;
  warn?: boolean;
  good?: boolean;
}) {
  const valueColor = warn ? "#f59e0b" : good ? "var(--accent)" : "var(--fg)";
  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: 8,
        padding: "10px 12px",
        background: "var(--bg)",
      }}
    >
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 18,
          fontWeight: 700,
          color: valueColor,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
    </div>
  );
}
