export const dynamic = "force-dynamic";

import Link from "next/link";
import { db } from "@/infrastructure/db/client";
import {
  clinics,
  leads,
  aiUsageCosts,
  whatsappMessageCosts,
  conversations,
  clinicMetrics,
  playbookVersions,
} from "@/infrastructure/db/schema";
import { eq, count, sum, and, gte, max, inArray, desc } from "drizzle-orm";
import {
  Users,
  Calendar,
  TrendingUp,
  DollarSign,
  ChevronRight,
  AlertCircle,
  FlaskConical,
  Mail,
} from "lucide-react";
import {
  getClinicOperationalStatusColors,
  getClinicOperationalStatusLabel,
  isBillableOperationalStatus,
} from "@/application/clinics/clinic-operational-status-presentation";
import type { ClinicOperationalStatus } from "@/application/clinics/clinic-operational-status";
import { probeClinicChannelHealth } from "@/application/health/channel-health";
import { evaluateOperationalAlerts } from "@/application/health/operational-alerts";

const USD_TO_BRL = 5.5;

function formatCurrency(micros: number): string {
  const brl = (micros / 1_000_000) * USD_TO_BRL;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(brl);
}

function relativeTime(date: Date | null): string {
  if (!date) return "—";
  const diff = Date.now() - date.getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d}d`;
}

function startOfMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

type ClinicRow = {
  id: string;
  name: string;
  autoReplyEnabled: boolean;
  operationalStatus: ClinicOperationalStatus;
  leadsThisMonth: number;
  scheduledThisMonth: number;
  aiCostMicros: number;
  waCostMicros: number;
  lastActivity: Date | null;
  hasActivityIn24h: boolean;
  isTest: boolean;
  channelProvider: "z_api" | "meta_cloud_api" | null;
  zapiInstanceId: string | null;
  zapiToken: string | null;
  zapiClientToken: string | null;
  metaPhoneNumberId: string | null;
  metaAccessToken: string | null;
};

async function fetchAllClinics(): Promise<ClinicRow[]> {
  const allClinics = await db
    .select({
      id: clinics.id,
      name: clinics.name,
      autoReplyEnabled: clinics.autoReplyEnabled,
      operationalStatus: clinics.operationalStatus,
      isTest: clinics.isTest,
      channelProvider: clinics.channelProvider,
      zapiInstanceId: clinics.zapiInstanceId,
      zapiToken: clinics.zapiToken,
      zapiClientToken: clinics.zapiClientToken,
      metaPhoneNumberId: clinics.metaPhoneNumberId,
      metaAccessToken: clinics.metaAccessToken,
    })
    .from(clinics)
    .orderBy(clinics.name);
  const monthStart = startOfMonth();

  const rows = await Promise.all(
    allClinics.map(async (clinic) => {
      const [
        leadsResult,
        scheduledResult,
        aiCostResult,
        waCostResult,
        lastActivityResult,
      ] = await Promise.all([
        db
          .select({ count: count() })
          .from(leads)
          .where(
            and(
              eq(leads.clinicId, clinic.id),
              gte(leads.createdAt, monthStart),
            ),
          ),

        db
          .select({ count: count() })
          .from(leads)
          .where(
            and(
              eq(leads.clinicId, clinic.id),
              eq(leads.status, "appointment_scheduled"),
              gte(leads.createdAt, monthStart),
            ),
          ),

        db
          .select({ total: sum(aiUsageCosts.estimatedCostUsdMicros) })
          .from(aiUsageCosts)
          .where(
            and(
              eq(aiUsageCosts.clinicId, clinic.id),
              gte(aiUsageCosts.createdAt, monthStart),
            ),
          ),

        db
          .select({ total: sum(whatsappMessageCosts.estimatedCostUsdMicros) })
          .from(whatsappMessageCosts)
          .where(
            and(
              eq(whatsappMessageCosts.clinicId, clinic.id),
              gte(whatsappMessageCosts.createdAt, monthStart),
            ),
          ),

        db
          .select({ last: max(conversations.lastMessageAt) })
          .from(conversations)
          .where(eq(conversations.clinicId, clinic.id)),
      ]);

      const leadsCount = leadsResult[0]?.count ?? 0;
      const scheduledCount = scheduledResult[0]?.count ?? 0;
      const aiCostMicros = Number(aiCostResult[0]?.total ?? 0);
      const waCostMicros = Number(waCostResult[0]?.total ?? 0);
      const lastActivity = lastActivityResult[0]?.last
        ? new Date(lastActivityResult[0].last)
        : null;
      const hasActivityIn24h = lastActivity
        ? Date.now() - lastActivity.getTime() < 24 * 60 * 60 * 1000
        : false;

      return {
        id: clinic.id,
        name: clinic.name,
        autoReplyEnabled: clinic.autoReplyEnabled,
        operationalStatus: clinic.operationalStatus,
        leadsThisMonth: leadsCount,
        scheduledThisMonth: scheduledCount,
        aiCostMicros,
        waCostMicros,
        lastActivity,
        hasActivityIn24h,
        isTest: clinic.isTest,
        channelProvider: clinic.channelProvider,
        zapiInstanceId: clinic.zapiInstanceId,
        zapiToken: clinic.zapiToken,
        zapiClientToken: clinic.zapiClientToken,
        metaPhoneNumberId: clinic.metaPhoneNumberId,
        metaAccessToken: clinic.metaAccessToken,
      };
    }),
  );

  return rows;
}

async function fetchOperationalAlertReport(clinicRows: ClinicRow[]) {
  const activeClinics = clinicRows.filter(
    (clinic) => clinic.operationalStatus === "active",
  );

  if (activeClinics.length === 0) {
    return evaluateOperationalAlerts([], new Date());
  }

  const clinicIds = activeClinics.map((clinic) => clinic.id);
  const [activePlaybooks, latestMetrics] = await Promise.all([
    db
      .select({ clinicId: playbookVersions.clinicId })
      .from(playbookVersions)
      .where(
        and(
          inArray(playbookVersions.clinicId, clinicIds),
          eq(playbookVersions.status, "active"),
        ),
      ),
    db
      .select({
        clinicId: clinicMetrics.clinicId,
        createdAt: clinicMetrics.createdAt,
        data: clinicMetrics.data,
      })
      .from(clinicMetrics)
      .where(inArray(clinicMetrics.clinicId, clinicIds))
      .orderBy(desc(clinicMetrics.createdAt)),
  ]);

  const playbookClinicIds = new Set(
    activePlaybooks.map((row) => row.clinicId),
  );
  const latestMetricMap = new Map<
    string,
    { createdAt: Date; data: unknown }
  >();

  latestMetrics.forEach((row) => {
    if (!latestMetricMap.has(row.clinicId)) {
      latestMetricMap.set(row.clinicId, {
        createdAt: row.createdAt,
        data: row.data,
      });
    }
  });

  return evaluateOperationalAlerts(
    await Promise.all(activeClinics.map(async (clinic) => {
      const latestMetric = latestMetricMap.get(clinic.id);

      return {
        clinicId: clinic.id,
        clinicName: clinic.name,
        operationalStatus: clinic.operationalStatus,
        channelProvider: clinic.channelProvider,
        zapiInstanceId: clinic.zapiInstanceId,
        zapiToken: clinic.zapiToken,
        zapiClientToken: clinic.zapiClientToken,
        metaPhoneNumberId: clinic.metaPhoneNumberId,
        metaAccessToken: clinic.metaAccessToken,
        hasActivePlaybook: playbookClinicIds.has(clinic.id),
        latestMetricAt: latestMetric?.createdAt ?? null,
        channelStatus: await probeClinicChannelHealth({
          clinicId: clinic.id,
          clinicName: clinic.name,
          channelProvider: clinic.channelProvider,
          zapiInstanceId: clinic.zapiInstanceId,
          zapiToken: clinic.zapiToken,
          zapiClientToken: clinic.zapiClientToken,
          metaPhoneNumberId: clinic.metaPhoneNumberId,
          metaAccessToken: clinic.metaAccessToken,
        }),
        latestMetricData:
          latestMetric && typeof latestMetric.data === "object"
            ? (latestMetric.data as {
                totalConversations?: number | null;
                alerts?: Array<{
                  metric: string;
                  value: number;
                  threshold: number;
                  level: "warn" | "critical";
                }> | null;
                })
            : null,
      };
    })),
    new Date(),
  );
}

function StatusPill({ status }: { status: ClinicOperationalStatus }) {
  const colors = getClinicOperationalStatusColors(status);

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        color: colors.text,
        background: colors.background,
        border: `1px solid ${colors.border}`,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: colors.text,
          flexShrink: 0,
        }}
      />
      {getClinicOperationalStatusLabel(status)}
    </span>
  );
}

export default async function OwnerPage() {
  const clinicRows = await fetchAllClinics();
  const operationalAlertReport = await fetchOperationalAlertReport(clinicRows);
  const alertsByClinicId = new Map<string, typeof operationalAlertReport.alerts>(
    clinicRows.map((clinic) => [
      clinic.id,
      operationalAlertReport.alerts.filter(
        (alert) => alert.clinicId === clinic.id,
      ),
    ]),
  );

  const liveRows = clinicRows.filter((r) =>
    isBillableOperationalStatus(r.operationalStatus),
  );
  const activeRows = clinicRows.filter((r) => r.operationalStatus === "active");
  const pausedRows = clinicRows.filter((r) => r.operationalStatus === "paused");
  const testRows = clinicRows.filter((r) => r.operationalStatus === "test");
  const prospectRows = clinicRows.filter(
    (r) => r.operationalStatus === "prospect",
  );
  const cancelledRows = clinicRows.filter(
    (r) => r.operationalStatus === "cancelled",
  );

  const totalLeads = liveRows.reduce((s, r) => s + r.leadsThisMonth, 0);
  const totalScheduled = liveRows.reduce((s, r) => s + r.scheduledThisMonth, 0);
  const totalAiCost = liveRows.reduce((s, r) => s + r.aiCostMicros, 0);
  const totalWaCost = liveRows.reduce((s, r) => s + r.waCostMicros, 0);
  const globalConversion =
    totalLeads > 0 ? ((totalScheduled / totalLeads) * 100).toFixed(1) : "0.0";

  return (
    <div className="owner-dark-forced">
      <div className="product-topbar">
        <div>
          <p className="eyebrow">Owner Panel</p>
          <h1>Visão geral das clínicas</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)" }}>
            Mês atual · {activeRows.length} ativa
            {activeRows.length !== 1 ? "s" : ""}
            {pausedRows.length > 0 &&
              ` · ${pausedRows.length} pausada${pausedRows.length !== 1 ? "s" : ""}`}
            {prospectRows.length > 0 &&
              ` · ${prospectRows.length} em implantação`}
            {testRows.length > 0 &&
              ` · ${testRows.length} teste${testRows.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link
            href="/owner/clinics/novo"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "9px 16px",
              borderRadius: 10,
              textDecoration: "none",
              fontSize: 13,
              fontWeight: 700,
              color: "#10b981",
              border: "1px solid rgba(16,185,129,0.3)",
              background: "rgba(16,185,129,0.07)",
            }}
          >
            + Diagnóstico rápido
          </Link>
          <Link href="/owner/clinics/new" className="primary-button">
            Clínica completa
          </Link>
        </div>
      </div>

      {/* KPIs — apenas produção (2×2 grid) */}
      <div className="kpi-strip">
        <div className="metric metric-highlight">
          <div className="metric-header">
            <span className="metric-icon">
              <Users size={14} />
            </span>
            <span className="metric-label">Leads no mês</span>
          </div>
          <span className="metric-value">{totalLeads}</span>
          <span className="metric-context">produção</span>
        </div>
        <div className="metric">
          <div className="metric-header">
            <span className="metric-icon">
              <Calendar size={14} />
            </span>
            <span className="metric-label">Agendamentos</span>
          </div>
          <span className="metric-value">{totalScheduled}</span>
          <span className="metric-context">no mês</span>
        </div>
        <div className="metric">
          <div className="metric-header">
            <span className="metric-icon">
              <TrendingUp size={14} />
            </span>
            <span className="metric-label">Conversão</span>
          </div>
          <span className="metric-value">{globalConversion}%</span>
          <span className="metric-context">agendamentos / leads</span>
        </div>
        <div className="metric">
          <div className="metric-header">
            <span className="metric-icon">
              <DollarSign size={14} />
            </span>
            <span className="metric-label">Custo IA+WA</span>
          </div>
          <span className="metric-value">{formatCurrency(totalAiCost + totalWaCost)}</span>
          <span className="metric-context">no mês em R$</span>
        </div>
      </div>

      {/* Clinic list */}
      <div
        className="page-content"
        style={{ paddingBottom: "60px", display: "grid", gap: 20 }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 10,
          }}
        >
          {[
            {
              label: "Ativas",
              value: activeRows.length,
              status: "active" as const,
            },
            {
              label: "Pausadas",
              value: pausedRows.length,
              status: "paused" as const,
            },
            {
              label: "Implantação",
              value: prospectRows.length,
              status: "prospect" as const,
            },
            {
              label: "Testes",
              value: testRows.length,
              status: "test" as const,
            },
          ].map((item) => {
            const colors = getClinicOperationalStatusColors(item.status);
            return (
              <div
                key={item.label}
                style={{
                  border: `1px solid ${colors.border}`,
                  borderRadius: 12,
                  padding: "14px 16px",
                  background: colors.background,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: colors.text,
                  }}
                >
                  {item.label}
                </div>
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 24,
                    fontWeight: 800,
                    color: colors.text,
                  }}
                >
                  {item.value}
                </div>
              </div>
            );
          })}
        </div>

        <div
          style={{
            border:
              operationalAlertReport.alertCount > 0
                ? `1px solid ${
                    operationalAlertReport.criticalCount > 0
                      ? "rgba(239,68,68,0.25)"
                      : "rgba(245,158,11,0.25)"
                  }`
                : "1px solid rgba(16,185,129,0.2)",
            borderRadius: 12,
            padding: "18px 20px",
            background:
              operationalAlertReport.alertCount > 0
                ? operationalAlertReport.criticalCount > 0
                  ? "rgba(239,68,68,0.05)"
                  : "rgba(245,158,11,0.05)"
                : "rgba(16,185,129,0.05)",
            display: "grid",
            gap: 12,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div>
              <p className="eyebrow" style={{ margin: 0 }}>
                Alertas operacionais
              </p>
              <p
                style={{ margin: "6px 0 0", fontSize: 13, color: "var(--text-soft)" }}
              >
                {operationalAlertReport.alertCount === 0
                  ? "Nenhum alerta ativo nas clínicas em produção."
                  : `${operationalAlertReport.alertCount} alerta${operationalAlertReport.alertCount !== 1 ? "s" : ""} ativo${operationalAlertReport.alertCount !== 1 ? "s" : ""} em ${operationalAlertReport.activeClinicCount} clínica${operationalAlertReport.activeClinicCount !== 1 ? "s" : ""} ativa${operationalAlertReport.activeClinicCount !== 1 ? "s" : ""}.`}
              </p>
              {operationalAlertReport.alertCount > 0 && (
                <p
                  style={{
                    margin: "6px 0 0",
                    fontSize: 12,
                    color: "var(--muted)",
                  }}
                >
                  {operationalAlertReport.criticalCount} crítico
                  {operationalAlertReport.criticalCount !== 1 ? "s" : ""}
                  {" · "}
                  {operationalAlertReport.warnCount} aviso
                  {operationalAlertReport.warnCount !== 1 ? "s" : ""}
                </p>
              )}
            </div>
            <Link
              href="/owner/qualidade"
              style={{
                color: "var(--text-soft)",
                fontSize: 12,
                fontWeight: 700,
                textDecoration: "none",
              }}
            >
              Abrir qualidade
            </Link>
          </div>

          {operationalAlertReport.alerts.length > 0 && (
            <div style={{ display: "grid", gap: 8 }}>
              {operationalAlertReport.alerts.slice(0, 6).map((alert) => (
                <div
                  key={`${alert.clinicId}-${alert.source}-${alert.title}`}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    color:
                      alert.level === "critical"
                        ? "var(--danger)"
                        : "var(--text-soft)",
                    fontSize: 12,
                  }}
                >
                  <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>
                    <strong>{alert.clinicName}</strong>: {alert.title} ·{" "}
                    {alert.detail}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              paddingTop: operationalAlertReport.alerts.length > 0 ? 4 : 0,
              borderTop:
                operationalAlertReport.alerts.length > 0
                  ? "1px solid rgba(255,255,255,0.06)"
                  : "none",
              color: "var(--muted)",
              fontSize: 11,
            }}
          >
            <Mail size={11} style={{ flexShrink: 0 }} />
            <span>Digest por email · diário às 6h SP · {process.env.RESEND_API_KEY ? "ativo" : "aguardando RESEND_API_KEY"}</span>
          </div>
        </div>

        {/* Operação */}
        {liveRows.length === 0 ? (
          <div className="empty-state">
            <p style={{ margin: 0 }}>
              Nenhuma clínica operacional ativa ou pausada.
            </p>
          </div>
        ) : (
          <div
            style={{
              border: "1px solid var(--line)",
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "14px 18px 12px",
                borderBottom: "1px solid var(--line)",
                background: "var(--surface-soft)",
              }}
            >
              <p className="eyebrow" style={{ margin: 0 }}>
                Clínicas operacionais
              </p>
            </div>

            {/* Mobile: cards por clínica */}
            <div className="mobile-clinic-cards">
              {liveRows.map((clinic) => {
                const conversion =
                  clinic.leadsThisMonth > 0
                    ? (
                        (clinic.scheduledThisMonth / clinic.leadsThisMonth) *
                        100
                      ).toFixed(1)
                    : "0.0";
                const totalCost = clinic.aiCostMicros + clinic.waCostMicros;
                const lowConversion =
                  clinic.leadsThisMonth > 0 &&
                  clinic.scheduledThisMonth / clinic.leadsThisMonth < 0.05;
                const clinicAlerts = alertsByClinicId.get(clinic.id) ?? [];

                return (
                  <Link
                    key={clinic.id}
                    href={`/owner/clinics/${clinic.id}`}
                    className="mobile-clinic-card"
                  >
                    <div className="mobile-clinic-card-row">
                      <span className="mobile-clinic-card-name">
                        {clinic.name}
                      </span>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <StatusPill status={clinic.operationalStatus} />
                        <ChevronRight
                          size={15}
                          style={{ color: "var(--muted)", flexShrink: 0 }}
                        />
                      </div>
                    </div>
                    <div className="mobile-clinic-card-meta">
                      <span>
                        <strong>{clinic.leadsThisMonth}</strong> leads
                      </span>
                      <span
                        style={{
                          color: lowConversion
                            ? "var(--danger)"
                            : "var(--muted)",
                        }}
                      >
                        <strong
                          style={{
                            color: lowConversion
                              ? "var(--danger)"
                              : "var(--text-soft)",
                            fontWeight: lowConversion ? 700 : 600,
                          }}
                        >
                          {conversion}%
                        </strong>{" "}
                        conv.
                      </span>
                      <span>
                        <strong style={{ fontSize: 11 }}>
                          {formatCurrency(totalCost)}
                        </strong>{" "}
                        IA+WA
                      </span>
                      <span>{relativeTime(clinic.lastActivity)}</span>
                      {clinicAlerts.length > 0 && (
                        <span
                          style={{
                            color:
                              clinicAlerts[0]?.level === "critical"
                                ? "var(--danger)"
                                : "var(--text-soft)",
                          }}
                        >
                          <strong>{clinicAlerts.length}</strong> alerta
                          {clinicAlerts.length !== 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>

            {/* Desktop: tabela completa */}
            <div className="desktop-clinic-table" style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 13,
                }}
              >
                <thead>
                  <tr
                    style={{
                      background: "var(--surface-soft)",
                      borderBottom: "1px solid var(--line)",
                    }}
                  >
                    {[
                      "Clínica",
                      "Leads/mês",
                      "Conversão",
                      "Custo IA+WA",
                      "Último atend.",
                      "Status",
                      "Alertas",
                    ].map((col) => (
                      <th
                        key={col}
                        style={{
                          padding: "10px 16px",
                          textAlign: "left",
                          fontSize: 11,
                          fontWeight: 700,
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                          color: "var(--muted)",
                        }}
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {liveRows.map((clinic, i) => {
                    const conversion =
                      clinic.leadsThisMonth > 0
                        ? (
                            (clinic.scheduledThisMonth /
                              clinic.leadsThisMonth) *
                            100
                          ).toFixed(1)
                        : "0.0";
                    const totalCost = clinic.aiCostMicros + clinic.waCostMicros;
                    const lowConversion =
                      clinic.leadsThisMonth > 0 &&
                      clinic.scheduledThisMonth / clinic.leadsThisMonth < 0.05;
                    const clinicAlerts = alertsByClinicId.get(clinic.id) ?? [];

                    return (
                      <tr
                        key={clinic.id}
                        style={{
                          background:
                            i % 2 === 1 ? "var(--surface-soft)" : "transparent",
                          borderBottom:
                            i < liveRows.length - 1
                              ? "1px solid var(--line)"
                              : "none",
                        }}
                      >
                        <td style={{ padding: "12px 16px" }}>
                          <Link
                            href={`/owner/clinics/${clinic.id}`}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              fontWeight: 700,
                              color: "var(--text)",
                              textDecoration: "none",
                            }}
                          >
                            {clinic.name}
                            <ChevronRight
                              size={14}
                              style={{ color: "var(--muted)", flexShrink: 0 }}
                            />
                          </Link>
                        </td>
                        <td
                          style={{
                            padding: "12px 16px",
                            color: "var(--text-soft)",
                          }}
                        >
                          {clinic.leadsThisMonth}
                        </td>
                        <td style={{ padding: "12px 16px" }}>
                          <span
                            style={{
                              color: lowConversion
                                ? "var(--danger)"
                                : "var(--text-soft)",
                              fontWeight: lowConversion ? 700 : 400,
                            }}
                          >
                            {conversion}%
                          </span>
                        </td>
                        <td
                          style={{
                            padding: "12px 16px",
                            color: "var(--text-soft)",
                            fontSize: 12,
                          }}
                        >
                          {formatCurrency(totalCost)}
                        </td>
                        <td
                          style={{
                            padding: "12px 16px",
                            color: "var(--muted)",
                            fontSize: 12,
                          }}
                        >
                          {relativeTime(clinic.lastActivity)}
                        </td>
                        <td style={{ padding: "12px 16px" }}>
                          <StatusPill status={clinic.operationalStatus} />
                        </td>
                        <td style={{ padding: "12px 16px" }}>
                          {clinic.operationalStatus === "paused" ? (
                            <span
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 5,
                                fontSize: 11,
                                color: "var(--danger)",
                                fontWeight: 600,
                              }}
                            >
                              <AlertCircle size={11} style={{ flexShrink: 0 }} />
                              Operação pausada
                            </span>
                          ) : clinicAlerts.length === 0 ? (
                            <span
                              style={{ color: "var(--muted)", fontSize: 12 }}
                            >
                              —
                            </span>
                          ) : (
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 4,
                              }}
                            >
                              {clinicAlerts.slice(0, 2).map((alert) => (
                                <span
                                  key={`${alert.source}-${alert.title}`}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 5,
                                    fontSize: 11,
                                    color: alert.level === "critical"
                                      ? "var(--danger)"
                                      : "var(--text-soft)",
                                    fontWeight:
                                      alert.level === "critical" ? 600 : 400,
                                  }}
                                >
                                  <AlertCircle
                                    size={11}
                                    style={{ flexShrink: 0 }}
                                  />
                                  {alert.title}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Prospects */}
        {prospectRows.length > 0 && (
          <div
            style={{
              border: "1px solid rgba(59,130,246,0.25)",
              borderRadius: 12,
              overflow: "hidden",
              background: "rgba(59,130,246,0.03)",
            }}
          >
            <div
              style={{
                padding: "14px 18px 12px",
                borderBottom: "1px solid rgba(59,130,246,0.18)",
                background: "rgba(59,130,246,0.06)",
              }}
            >
              <p className="eyebrow" style={{ margin: 0, color: "#60a5fa" }}>
                Em implantação
              </p>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {prospectRows.map((clinic, i) => (
                <div
                  key={clinic.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "12px 18px",
                    borderBottom:
                      i < prospectRows.length - 1
                        ? "1px solid rgba(59,130,246,0.12)"
                        : "none",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      minWidth: 0,
                    }}
                  >
                    <Link
                      href={`/owner/clinics/${clinic.id}`}
                      style={{
                        fontWeight: 700,
                        color: "#60a5fa",
                        textDecoration: "none",
                        fontSize: 13,
                      }}
                    >
                      {clinic.name}
                    </Link>
                    <StatusPill status={clinic.operationalStatus} />
                  </div>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>
                    Pronto para completar onboarding e go-live
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Testes */}
        {testRows.length > 0 && (
          <div
            style={{
              border: "1px solid rgba(99,102,241,0.25)",
              borderRadius: 12,
              overflow: "hidden",
              background: "rgba(99,102,241,0.03)",
            }}
          >
            <div
              style={{
                padding: "14px 18px 12px",
                borderBottom: "1px solid rgba(99,102,241,0.2)",
                background: "rgba(99,102,241,0.06)",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <FlaskConical size={13} style={{ color: "#818cf8" }} />
              <p className="eyebrow" style={{ margin: 0, color: "#818cf8" }}>
                Ambiente de testes
              </p>
            </div>
            <div className="mobile-clinic-cards">
              {testRows.map((clinic) => (
                <Link
                  key={clinic.id}
                  href={`/owner/clinics/${clinic.id}`}
                  className="mobile-clinic-card"
                >
                  <div className="mobile-clinic-card-row">
                    <span
                      className="mobile-clinic-card-name"
                      style={{ color: "#818cf8" }}
                    >
                      {clinic.name}
                    </span>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 8 }}
                    >
                      <StatusPill status={clinic.operationalStatus} />
                      <ChevronRight
                        size={15}
                        style={{ color: "var(--muted)", flexShrink: 0 }}
                      />
                    </div>
                  </div>
                  <div className="mobile-clinic-card-meta">
                    <span>
                      <strong>{clinic.leadsThisMonth}</strong> leads
                    </span>
                    <span>{relativeTime(clinic.lastActivity)}</span>
                  </div>
                </Link>
              ))}
            </div>
            <div className="desktop-clinic-table">
              {testRows.map((clinic, i) => (
                <div
                  key={clinic.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "12px 18px",
                    borderBottom:
                      i < testRows.length - 1
                        ? "1px solid rgba(99,102,241,0.15)"
                        : "none",
                  }}
                >
                  <Link
                    href={`/owner/clinics/${clinic.id}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontWeight: 700,
                      color: "#818cf8",
                      textDecoration: "none",
                      fontSize: 13,
                    }}
                  >
                    {clinic.name}
                    <ChevronRight size={13} style={{ color: "#818cf8" }} />
                  </Link>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 10 }}
                  >
                    <StatusPill status={clinic.operationalStatus} />
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>
                      {clinic.leadsThisMonth} leads ·{" "}
                      {relativeTime(clinic.lastActivity)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {cancelledRows.length > 0 && (
          <div
            style={{
              border: "1px solid rgba(239,68,68,0.18)",
              borderRadius: 12,
              overflow: "hidden",
              background: "rgba(239,68,68,0.03)",
            }}
          >
            <div
              style={{
                padding: "14px 18px 12px",
                borderBottom: "1px solid rgba(239,68,68,0.14)",
                background: "rgba(239,68,68,0.06)",
              }}
            >
              <p className="eyebrow" style={{ margin: 0, color: "#f87171" }}>
                Clínicas canceladas
              </p>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {cancelledRows.map((clinic, i) => (
                <div
                  key={clinic.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "12px 18px",
                    borderBottom:
                      i < cancelledRows.length - 1
                        ? "1px solid rgba(239,68,68,0.1)"
                        : "none",
                  }}
                >
                  <Link
                    href={`/owner/clinics/${clinic.id}`}
                    style={{
                      fontWeight: 700,
                      color: "#f87171",
                      textDecoration: "none",
                      fontSize: 13,
                    }}
                  >
                    {clinic.name}
                  </Link>
                  <StatusPill status={clinic.operationalStatus} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
