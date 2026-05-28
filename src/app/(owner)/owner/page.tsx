export const dynamic = "force-dynamic";

import Link from "next/link";
import { db } from "@/infrastructure/db/client";
import {
  clinics,
  leads,
  aiUsageCosts,
  whatsappMessageCosts,
  conversations,
} from "@/infrastructure/db/schema";
import { eq, count, sum, and, gte, max } from "drizzle-orm";

function formatCurrency(micros: number): string {
  return "$" + (micros / 1_000_000).toFixed(4);
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
  leadsThisMonth: number;
  scheduledThisMonth: number;
  aiCostMicros: number;
  waCostMicros: number;
  lastActivity: Date | null;
  hasActivityIn24h: boolean;
};

async function fetchAllClinics(): Promise<ClinicRow[]> {
  const allClinics = await db
    .select({
      id: clinics.id,
      name: clinics.name,
      autoReplyEnabled: clinics.autoReplyEnabled,
    })
    .from(clinics)
    .orderBy(clinics.name);
  const monthStart = startOfMonth();

  const rows = await Promise.all(
    allClinics.map(async (clinic) => {
      const [leadsResult, scheduledResult, aiCostResult, waCostResult, lastActivityResult] =
        await Promise.all([
          db
            .select({ count: count() })
            .from(leads)
            .where(and(eq(leads.clinicId, clinic.id), gte(leads.createdAt, monthStart))),

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
              and(eq(aiUsageCosts.clinicId, clinic.id), gte(aiUsageCosts.createdAt, monthStart)),
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
        leadsThisMonth: leadsCount,
        scheduledThisMonth: scheduledCount,
        aiCostMicros,
        waCostMicros,
        lastActivity,
        hasActivityIn24h,
      };
    }),
  );

  return rows;
}

export default async function OwnerPage() {
  const clinicRows = await fetchAllClinics();

  const totalLeads = clinicRows.reduce((s, r) => s + r.leadsThisMonth, 0);
  const totalScheduled = clinicRows.reduce((s, r) => s + r.scheduledThisMonth, 0);
  const totalAiCost = clinicRows.reduce((s, r) => s + r.aiCostMicros, 0);
  const totalWaCost = clinicRows.reduce((s, r) => s + r.waCostMicros, 0);
  const globalConversion = totalLeads > 0 ? ((totalScheduled / totalLeads) * 100).toFixed(1) : "0.0";

  return (
    <div>
      <div className="product-topbar">
        <div>
          <p className="eyebrow">Owner Panel</p>
          <h1>Visão geral das clínicas</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)" }}>
            Mês atual · {clinicRows.length} clínica{clinicRows.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Global KPIs */}
      <div className="kpi-strip">
        <div className="metric metric-highlight">
          <div className="metric-header">
            <span className="metric-label">Leads no mês</span>
          </div>
          <span className="metric-value">{totalLeads}</span>
          <span className="metric-context">todas as clínicas</span>
        </div>
        <div className="metric">
          <div className="metric-header">
            <span className="metric-label">Agendamentos</span>
          </div>
          <span className="metric-value">{totalScheduled}</span>
          <span className="metric-context">no mês</span>
        </div>
        <div className="metric">
          <div className="metric-header">
            <span className="metric-label">Conversão global</span>
          </div>
          <span className="metric-value">{globalConversion}%</span>
          <span className="metric-context">agendamentos / leads</span>
        </div>
        <div className="metric">
          <div className="metric-header">
            <span className="metric-label">Custo IA total</span>
          </div>
          <span className="metric-value">{formatCurrency(totalAiCost)}</span>
          <span className="metric-context">OpenAI no mês</span>
        </div>
        <div className="metric">
          <div className="metric-header">
            <span className="metric-label">Custo WhatsApp total</span>
          </div>
          <span className="metric-value">{formatCurrency(totalWaCost)}</span>
          <span className="metric-context">Z-API / Meta no mês</span>
        </div>
      </div>

      {/* Clinic table */}
      <div className="page-content" style={{ paddingBottom: "40px" }}>
        {clinicRows.length === 0 ? (
          <div className="empty-state">
            <p style={{ margin: 0 }}>Nenhuma clínica cadastrada.</p>
          </div>
        ) : (
          <div style={{ border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
            <div
              style={{
                padding: "14px 18px 12px",
                borderBottom: "1px solid var(--line)",
                background: "var(--surface-soft)",
              }}
            >
              <p className="eyebrow" style={{ margin: 0 }}>Clínicas</p>
            </div>

            <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr
                  style={{
                    background: "var(--surface-soft)",
                    borderBottom: "1px solid var(--line)",
                  }}
                >
                  {["Clínica", "Leads/mês", "Conversão", "Custo IA+WA", "Último atend.", "Status IA", "Alertas"].map((col) => (
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
                {clinicRows.map((clinic, i) => {
                  const conversion =
                    clinic.leadsThisMonth > 0
                      ? ((clinic.scheduledThisMonth / clinic.leadsThisMonth) * 100).toFixed(1)
                      : "0.0";
                  const totalCost = clinic.aiCostMicros + clinic.waCostMicros;
                  const lowConversion =
                    clinic.leadsThisMonth > 0 &&
                    clinic.scheduledThisMonth / clinic.leadsThisMonth < 0.05;

                  const alerts: string[] = [];
                  if (!clinic.autoReplyEnabled) alerts.push("🔴 IA pausada");
                  if (!clinic.hasActivityIn24h && clinic.lastActivity)
                    alerts.push("🟡 Sem atend. +24h");
                  if (lowConversion) alerts.push("🟡 Conversão < 5%");

                  return (
                    <tr
                      key={clinic.id}
                      style={{
                        background: i % 2 === 1 ? "var(--surface-soft)" : "transparent",
                        borderBottom:
                          i < clinicRows.length - 1 ? "1px solid var(--line)" : "none",
                      }}
                    >
                      <td style={{ padding: "12px 16px" }}>
                        <Link
                          href={`/owner/clinics/${clinic.id}`}
                          style={{
                            fontWeight: 700,
                            color: "var(--text)",
                            textDecoration: "none",
                          }}
                        >
                          {clinic.name}
                        </Link>
                      </td>
                      <td style={{ padding: "12px 16px", color: "var(--text-soft)" }}>
                        {clinic.leadsThisMonth}
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        <span
                          style={{
                            color: lowConversion ? "var(--danger)" : "var(--text-soft)",
                            fontWeight: lowConversion ? 700 : 400,
                          }}
                        >
                          {conversion}%
                        </span>
                      </td>
                      <td style={{ padding: "12px 16px", color: "var(--text-soft)", fontFamily: "monospace", fontSize: 12 }}>
                        {formatCurrency(totalCost)}
                      </td>
                      <td style={{ padding: "12px 16px", color: "var(--muted)", fontSize: 12 }}>
                        {relativeTime(clinic.lastActivity)}
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        {clinic.autoReplyEnabled ? (
                          <span className="status-pill" style={{ fontSize: 11, padding: "3px 10px" }}>
                            <span className="status-dot" />
                            Ativa
                          </span>
                        ) : (
                          <span className="status-pill status-handoff" style={{ fontSize: 11, padding: "3px 10px" }}>
                            <span className="status-dot" />
                            Pausada
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        {alerts.length === 0 ? (
                          <span style={{ color: "var(--muted)", fontSize: 12 }}>—</span>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            {alerts.map((alert) => (
                              <span key={alert} style={{ fontSize: 11, color: "var(--text-soft)" }}>
                                {alert}
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
      </div>
    </div>
  );
}
