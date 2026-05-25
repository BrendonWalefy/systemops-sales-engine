export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { ResetClinicDialog } from "./reset-clinic-dialog";
import { db } from "@/infrastructure/db/client";
import {
  clinics,
  leads,
  aiUsageCosts,
  whatsappMessageCosts,
  conversations,
  messages,
  agentRecommendations,
} from "@/infrastructure/db/schema";
import { eq, count, sum, and, gte, desc, sql } from "drizzle-orm";
import { ArrowLeft, ExternalLink } from "lucide-react";

function formatCurrency(micros: number): string {
  return "$" + (micros / 1_000_000).toFixed(4);
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
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

function thirtyDaysAgo(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d;
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default async function ClinicDetailPage({
  params,
}: {
  params: Promise<{ clinicId: string }>;
}) {
  const { clinicId } = await params;

  const [clinic] = await db
    .select({
      id: clinics.id,
      name: clinics.name,
      autoReplyEnabled: clinics.autoReplyEnabled,
    })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
  if (!clinic) notFound();

  const monthStart = startOfMonth();
  const thirtyDays = thirtyDaysAgo();

  const [
    leadsMonthResult,
    scheduledMonthResult,
    aiCostResult,
    waCostResult,
  ] = await Promise.all([
    db.select({ count: count() }).from(leads).where(and(eq(leads.clinicId, clinicId), gte(leads.createdAt, monthStart))),
    db.select({ count: count() }).from(leads).where(and(eq(leads.clinicId, clinicId), eq(leads.status, "appointment_scheduled"), gte(leads.createdAt, monthStart))),
    db.select({ total: sum(aiUsageCosts.estimatedCostUsdMicros) }).from(aiUsageCosts).where(and(eq(aiUsageCosts.clinicId, clinicId), gte(aiUsageCosts.createdAt, monthStart))),
    db.select({ total: sum(whatsappMessageCosts.estimatedCostUsdMicros) }).from(whatsappMessageCosts).where(and(eq(whatsappMessageCosts.clinicId, clinicId), gte(whatsappMessageCosts.createdAt, monthStart))),
  ]);

  const leadsCount = leadsMonthResult[0]?.count ?? 0;
  const scheduledCount = scheduledMonthResult[0]?.count ?? 0;
  const aiCost = Number(aiCostResult[0]?.total ?? 0);
  const waCost = Number(waCostResult[0]?.total ?? 0);
  const conversion = leadsCount > 0 ? ((scheduledCount / leadsCount) * 100).toFixed(1) : "0.0";

  // Daily volume (last 30 days): leads created per day + messages sent per day
  const dailyLeadsResult = await db
    .select({
      day: sql<string>`DATE(${leads.createdAt} AT TIME ZONE 'America/Sao_Paulo')`,
      count: count(),
    })
    .from(leads)
    .where(and(eq(leads.clinicId, clinicId), gte(leads.createdAt, thirtyDays)))
    .groupBy(sql`DATE(${leads.createdAt} AT TIME ZONE 'America/Sao_Paulo')`)
    .orderBy(sql`DATE(${leads.createdAt} AT TIME ZONE 'America/Sao_Paulo') DESC`);

  const dailyMessagesResult = await db
    .select({
      day: sql<string>`DATE(${messages.sentAt} AT TIME ZONE 'America/Sao_Paulo')`,
      count: count(),
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(and(eq(conversations.clinicId, clinicId), gte(messages.sentAt, thirtyDays)))
    .groupBy(sql`DATE(${messages.sentAt} AT TIME ZONE 'America/Sao_Paulo')`)
    .orderBy(sql`DATE(${messages.sentAt} AT TIME ZONE 'America/Sao_Paulo') DESC`);

  // Merge daily data
  const dailyLeadsMap = Object.fromEntries(dailyLeadsResult.map((r) => [r.day, r.count]));
  const dailyMsgMap = Object.fromEntries(dailyMessagesResult.map((r) => [r.day, r.count]));
  const allDays = Array.from(
    new Set([...Object.keys(dailyLeadsMap), ...Object.keys(dailyMsgMap)]),
  ).sort((a, b) => b.localeCompare(a));

  // Handoff conversations
  const handoffConvs = await db
    .select({
      convId: agentRecommendations.conversationId,
      leadId: agentRecommendations.leadId,
      createdAt: agentRecommendations.createdAt,
    })
    .from(agentRecommendations)
    .where(
      and(
        eq(agentRecommendations.clinicId, clinicId),
        eq(agentRecommendations.handoffRequired, true),
      ),
    )
    .orderBy(desc(agentRecommendations.createdAt))
    .limit(10);

  // AI non-response proxy: conversations where last AI message was > 1h ago and no lead reply after it
  // Simplified: just pull last 10 conversations where lastMessageAt is stale
  const staleConvs = await db
    .select({
      id: conversations.id,
      lastMessageAt: conversations.lastMessageAt,
      leadId: conversations.leadId,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.clinicId, clinicId),
        sql`${conversations.lastMessageAt} < NOW() - INTERVAL '1 hour'`,
      ),
    )
    .orderBy(desc(conversations.lastMessageAt))
    .limit(8);

  return (
    <div>
      {/* Header */}
      <div className="product-topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Link
            href="/owner"
            style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--muted)", textDecoration: "none", fontSize: 13, fontWeight: 600 }}
          >
            <ArrowLeft size={14} />
            Visão geral
          </Link>
          <span style={{ color: "var(--line-strong)" }}>·</span>
          <div>
            <h1 style={{ margin: 0 }}>{clinic.name}</h1>
            <p style={{ margin: "3px 0 0", fontSize: 13, color: "var(--muted)" }}>
              Drill-down da clínica
            </p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {clinic.autoReplyEnabled ? (
            <span className="status-pill" style={{ fontSize: 11, padding: "3px 10px" }}>
              <span className="status-dot" /> IA Ativa
            </span>
          ) : (
            <span className="status-pill status-handoff" style={{ fontSize: 11, padding: "3px 10px" }}>
              <span className="status-dot" /> IA Pausada
            </span>
          )}
          <ResetClinicDialog clinicId={clinic.id} clinicName={clinic.name} />
          <Link
            href="/app/inbox"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              fontWeight: 600,
              color: "var(--accent-strong)",
              textDecoration: "none",
            }}
          >
            <ExternalLink size={13} />
            Acessar inbox
          </Link>
        </div>
      </div>

      <div style={{ padding: "0 30px 40px", display: "grid", gap: 32 }}>
        {/* KPIs */}
        <div className="kpi-strip" style={{ marginLeft: 0 }}>
          <div className="metric metric-highlight">
            <div className="metric-header"><span className="metric-label">Leads no mês</span></div>
            <span className="metric-value">{leadsCount}</span>
            <span className="metric-context">mês atual</span>
          </div>
          <div className="metric">
            <div className="metric-header"><span className="metric-label">Agendamentos</span></div>
            <span className="metric-value">{scheduledCount}</span>
            <span className="metric-context">no mês</span>
          </div>
          <div className="metric">
            <div className="metric-header"><span className="metric-label">Conversão</span></div>
            <span className="metric-value">{conversion}%</span>
            <span className="metric-context">agend. / leads</span>
          </div>
          <div className="metric">
            <div className="metric-header"><span className="metric-label">Custo IA</span></div>
            <span className="metric-value" style={{ fontFamily: "monospace", fontSize: 16 }}>{formatCurrency(aiCost)}</span>
            <span className="metric-context">OpenAI no mês</span>
          </div>
          <div className="metric">
            <div className="metric-header"><span className="metric-label">Custo WhatsApp</span></div>
            <span className="metric-value" style={{ fontFamily: "monospace", fontSize: 16 }}>{formatCurrency(waCost)}</span>
            <span className="metric-context">Z-API / Meta no mês</span>
          </div>
        </div>

        {/* Daily volume */}
        <div style={{ border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: "14px 18px 12px", borderBottom: "1px solid var(--line)", background: "var(--surface-soft)" }}>
            <p className="eyebrow" style={{ margin: 0 }}>Volume diário — últimos 30 dias</p>
          </div>
          {allDays.length === 0 ? (
            <div className="empty-state compact" style={{ borderRadius: 0, border: "none" }}>
              Sem dados no período.
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "var(--surface-soft)", borderBottom: "1px solid var(--line)" }}>
                  {["Data", "Leads", "Mensagens"].map((col) => (
                    <th key={col} style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)" }}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allDays.slice(0, 30).map((day, i) => (
                  <tr key={day} style={{ background: i % 2 === 1 ? "var(--surface-soft)" : "transparent", borderBottom: i < Math.min(allDays.length, 30) - 1 ? "1px solid var(--line)" : "none" }}>
                    <td style={{ padding: "10px 16px", color: "var(--text-soft)" }}>{day}</td>
                    <td style={{ padding: "10px 16px", fontWeight: 600 }}>{dailyLeadsMap[day] ?? 0}</td>
                    <td style={{ padding: "10px 16px", color: "var(--text-soft)" }}>{dailyMsgMap[day] ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Handoff conversations */}
        <div style={{ border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: "14px 18px 12px", borderBottom: "1px solid var(--line)", background: "var(--surface-soft)" }}>
            <p className="eyebrow" style={{ margin: 0 }}>Conversas com handoff</p>
          </div>
          {handoffConvs.length === 0 ? (
            <div className="empty-state compact" style={{ borderRadius: 0, border: "none" }}>
              Nenhum handoff registrado.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {handoffConvs.map((h, i) => (
                <div
                  key={`${h.convId}-${i}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "12px 16px",
                    borderBottom: i < handoffConvs.length - 1 ? "1px solid var(--line)" : "none",
                    background: i % 2 === 1 ? "var(--surface-soft)" : "transparent",
                  }}
                >
                  <div>
                    <span style={{ fontSize: 12, color: "var(--muted)", fontFamily: "monospace" }}>
                      conv: {h.convId.slice(0, 8)}…
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>
                      {relativeTime(new Date(h.createdAt))}
                    </span>
                    <Link
                      href={`/app/inbox/${h.convId}`}
                      style={{ fontSize: 12, color: "var(--accent-strong)", textDecoration: "none", display: "flex", alignItems: "center", gap: 4 }}
                    >
                      <ExternalLink size={12} /> Ver conversa
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Stale conversations (AI non-response proxy) */}
        <div style={{ border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: "14px 18px 12px", borderBottom: "1px solid var(--line)", background: "var(--surface-soft)" }}>
            <p className="eyebrow" style={{ margin: 0 }}>
              Possíveis falhas da IA — conversas sem resposta há +1h
            </p>
          </div>
          {staleConvs.length === 0 ? (
            <div className="empty-state compact" style={{ borderRadius: 0, border: "none" }}>
              Nenhuma conversa parada detectada.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {staleConvs.map((c, i) => (
                <div
                  key={c.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "12px 16px",
                    borderBottom: i < staleConvs.length - 1 ? "1px solid var(--line)" : "none",
                    background: i % 2 === 1 ? "var(--surface-soft)" : "transparent",
                  }}
                >
                  <div>
                    <span style={{ fontSize: 12, color: "var(--muted)", fontFamily: "monospace" }}>
                      conv: {c.id.slice(0, 8)}…
                    </span>
                    <span
                      style={{
                        marginLeft: 12,
                        fontSize: 11,
                        color: "var(--danger)",
                        fontWeight: 600,
                      }}
                    >
                      {c.lastMessageAt ? relativeTime(new Date(c.lastMessageAt)) : "—"}
                    </span>
                  </div>
                  <Link
                    href={`/app/inbox/${c.id}`}
                    style={{ fontSize: 12, color: "var(--accent-strong)", textDecoration: "none", display: "flex", alignItems: "center", gap: 4 }}
                  >
                    <ExternalLink size={12} /> Ver conversa
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
