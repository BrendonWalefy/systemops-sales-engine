import { db } from "@/infrastructure/db/client";
import {
  leads,
  conversations,
  messages,
  aiUsageCosts,
  whatsappMessageCosts,
} from "@/infrastructure/db/schema";
import { eq, count, sum, and, desc, sql } from "drizzle-orm";
import {
  Users,
  Calendar,
  MessageSquare,
  TrendingUp,
  Zap,
  AlertTriangle,
  Moon,
  Flame,
  Thermometer,
  Snowflake,
} from "lucide-react";

const CLINIC_ID = process.env.PILOT_CLINIC_ID ?? "";

function formatCurrency(micros: number): string {
  return "$" + (micros / 1_000_000).toFixed(4);
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function relativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `há ${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `há ${days} dia${days !== 1 ? "s" : ""}`;
}

function channelLabel(channel: string): string {
  const map: Record<string, string> = {
    whatsapp: "WhatsApp",
    instagram: "Instagram",
    landing_form: "Formulário",
    google_ads: "Google Ads",
    meta_ads: "Meta Ads",
    phone: "Telefone",
    referral: "Indicação",
    manual: "Manual",
  };
  return map[channel] ?? channel;
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    new: "Novo",
    waiting_response: "Aguardando",
    in_conversation: "Em conversa",
    follow_up_due: "Follow-up",
    appointment_scheduled: "Agendado",
    lost: "Perdido",
    won: "Ganho",
  };
  return map[status] ?? status;
}

function todayFormatted(): string {
  return new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function nameInitial(name: string | null, phone: string | null): string {
  if (name && name.trim().length > 0) return name.trim()[0].toUpperCase();
  if (phone && phone.trim().length > 0) return phone.trim()[0];
  return "?";
}

async function fetchDashboardData() {
  if (!CLINIC_ID) {
    return {
      totalLeads: 0,
      scheduledCount: 0,
      handoffCount: 0,
      afterHoursCount: 0,
      aiCostMicros: 0,
      waCostMicros: 0,
      recentLeads: [] as Array<{
        id: string;
        name: string | null;
        phone: string | null;
        channel: string;
        status: string;
        temperature: string | null;
        createdAt: Date;
      }>,
      tempCounts: { hot: 0, warm: 0, cold: 0 },
    };
  }

  const [
    totalLeadsResult,
    scheduledResult,
    handoffResult,
    aiCostResult,
    waCostResult,
    recentLeadsResult,
    tempHotResult,
    tempWarmResult,
    tempColdResult,
  ] = await Promise.all([
    db
      .select({ count: count() })
      .from(leads)
      .where(eq(leads.clinicId, CLINIC_ID)),

    db
      .select({ count: count() })
      .from(leads)
      .where(and(eq(leads.clinicId, CLINIC_ID), eq(leads.status, "appointment_scheduled"))),

    db
      .select({ count: count() })
      .from(leads)
      .where(
        and(
          eq(leads.clinicId, CLINIC_ID),
          eq(leads.temperature, "hot"),
          eq(leads.status, "in_conversation"),
        ),
      ),

    db
      .select({ total: sum(aiUsageCosts.estimatedCostUsdMicros) })
      .from(aiUsageCosts)
      .where(eq(aiUsageCosts.clinicId, CLINIC_ID)),

    db
      .select({ total: sum(whatsappMessageCosts.estimatedCostUsdMicros) })
      .from(whatsappMessageCosts)
      .where(eq(whatsappMessageCosts.clinicId, CLINIC_ID)),

    db
      .select({
        id: leads.id,
        name: leads.name,
        phone: leads.phone,
        channel: leads.channel,
        status: leads.status,
        temperature: leads.temperature,
        createdAt: leads.createdAt,
      })
      .from(leads)
      .where(eq(leads.clinicId, CLINIC_ID))
      .orderBy(desc(leads.createdAt))
      .limit(15),

    db
      .select({ count: count() })
      .from(leads)
      .where(and(eq(leads.clinicId, CLINIC_ID), eq(leads.temperature, "hot"))),

    db
      .select({ count: count() })
      .from(leads)
      .where(and(eq(leads.clinicId, CLINIC_ID), eq(leads.temperature, "warm"))),

    db
      .select({ count: count() })
      .from(leads)
      .where(and(eq(leads.clinicId, CLINIC_ID), eq(leads.temperature, "cold"))),
  ]);

  const afterHoursResult = await db
    .select({ count: count() })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(
      and(
        eq(conversations.clinicId, CLINIC_ID),
        eq(messages.author, "lead"),
        sql`EXTRACT(HOUR FROM (${messages.sentAt} AT TIME ZONE 'America/Sao_Paulo')) >= 18
          OR EXTRACT(HOUR FROM (${messages.sentAt} AT TIME ZONE 'America/Sao_Paulo')) < 8`,
      ),
    );

  return {
    totalLeads: totalLeadsResult[0]?.count ?? 0,
    scheduledCount: scheduledResult[0]?.count ?? 0,
    handoffCount: handoffResult[0]?.count ?? 0,
    afterHoursCount: afterHoursResult[0]?.count ?? 0,
    aiCostMicros: Number(aiCostResult[0]?.total ?? 0),
    waCostMicros: Number(waCostResult[0]?.total ?? 0),
    recentLeads: recentLeadsResult,
    tempCounts: {
      hot: tempHotResult[0]?.count ?? 0,
      warm: tempWarmResult[0]?.count ?? 0,
      cold: tempColdResult[0]?.count ?? 0,
    },
  };
}

export default async function DashboardPage() {
  const data = await fetchDashboardData();

  return (
    <div>
      <div className="product-topbar">
        <div>
          <h1>Dashboard</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)" }}>
            {todayFormatted()}
          </p>
        </div>
      </div>

      <div className="kpi-strip">
        <div className="metric">
          <div className="metric-header">
            <span className="metric-icon">
              <Users size={14} />
            </span>
            <span className="metric-label">Leads atendidos</span>
          </div>
          <span className="metric-value">{data.totalLeads}</span>
          <span className="metric-context">total da clínica</span>
        </div>

        <div className="metric metric-highlight">
          <div className="metric-header">
            <span className="metric-icon">
              <Calendar size={14} />
            </span>
            <span className="metric-label">Agendamentos pela IA</span>
          </div>
          <span className="metric-value">{data.scheduledCount}</span>
          <span className="metric-context">status appointment_scheduled</span>
        </div>

        <div className="metric">
          <div className="metric-header">
            <span className="metric-icon">
              <AlertTriangle size={14} />
            </span>
            <span className="metric-label">Handoffs</span>
          </div>
          <span className="metric-value">{data.handoffCount}</span>
          <span className="metric-context">leads quentes em conversa</span>
        </div>

        <div className="metric">
          <div className="metric-header">
            <span className="metric-icon">
              <Moon size={14} />
            </span>
            <span className="metric-label">Atendidos fora do horário</span>
          </div>
          <span className="metric-value">{data.afterHoursCount}</span>
          <span className="metric-context">mensagens entre 18h–8h</span>
        </div>

        <div className="metric">
          <div className="metric-header">
            <span className="metric-icon">
              <Zap size={14} />
            </span>
            <span className="metric-label">Custo IA (est.)</span>
          </div>
          <span className="metric-value">{formatCurrency(data.aiCostMicros)}</span>
          <span className="metric-context">OpenAI acumulado</span>
        </div>

        <div className="metric">
          <div className="metric-header">
            <span className="metric-icon">
              <MessageSquare size={14} />
            </span>
            <span className="metric-label">Custo WhatsApp (est.)</span>
          </div>
          <span className="metric-value">{formatCurrency(data.waCostMicros)}</span>
          <span className="metric-context">Z-API / Meta acumulado</span>
        </div>
      </div>

      <div style={{ padding: "0 30px 24px", display: "grid", gap: 24 }}>
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
              Leads recentes
            </p>
          </div>

          {data.recentLeads.length === 0 ? (
            <div className="empty-state compact" style={{ borderRadius: 0, border: "none" }}>
              Nenhum lead registrado ainda.
            </div>
          ) : (
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
                  {["Lead", "Canal", "Temperatura", "Status", "Data"].map((col) => (
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
                {data.recentLeads.map((lead, i) => (
                  <tr
                    key={lead.id}
                    style={{
                      background: i % 2 === 1 ? "var(--surface-soft)" : "transparent",
                      borderBottom:
                        i < data.recentLeads.length - 1 ? "1px solid var(--line)" : "none",
                    }}
                  >
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div
                          className="avatar"
                          style={{ width: 34, height: 34, fontSize: 13, borderRadius: 9 }}
                        >
                          {nameInitial(lead.name, lead.phone)}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, color: "var(--text)", lineHeight: 1.3 }}>
                            {lead.name ?? "—"}
                          </div>
                          <div style={{ fontSize: 12, color: "var(--muted)" }}>
                            {lead.phone ?? "sem telefone"}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: "12px 16px", color: "var(--text-soft)" }}>
                      {channelLabel(lead.channel)}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      {lead.temperature ? (
                        <span className={`temp-badge temp-${lead.temperature}`}>
                          {lead.temperature === "hot"
                            ? "Quente"
                            : lead.temperature === "warm"
                              ? "Morno"
                              : "Frio"}
                        </span>
                      ) : (
                        <span style={{ color: "var(--muted)", fontSize: 12 }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <span className="status-pill" style={{ fontSize: 12, padding: "4px 10px" }}>
                        <span className="status-dot" />
                        {statusLabel(lead.status)}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ color: "var(--text-soft)" }}>{formatDate(lead.createdAt)}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                        {relativeTime(lead.createdAt)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div>
          <p className="eyebrow">Distribuição de temperatura</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
            <div className="metric">
              <div className="metric-header">
                <span className="metric-icon">
                  <Flame size={14} />
                </span>
                <span className="metric-label">Quentes</span>
              </div>
              <span className="metric-value temp-hot">{data.tempCounts.hot}</span>
              <span className="metric-context">
                <span className="temp-badge temp-hot">hot</span>
              </span>
            </div>

            <div className="metric">
              <div className="metric-header">
                <span className="metric-icon">
                  <Thermometer size={14} />
                </span>
                <span className="metric-label">Mornos</span>
              </div>
              <span className="metric-value temp-warm">{data.tempCounts.warm}</span>
              <span className="metric-context">
                <span className="temp-badge temp-warm">warm</span>
              </span>
            </div>

            <div className="metric">
              <div className="metric-header">
                <span className="metric-icon">
                  <Snowflake size={14} />
                </span>
                <span className="metric-label">Frios</span>
              </div>
              <span className="metric-value temp-cold">{data.tempCounts.cold}</span>
              <span className="metric-context">
                <span className="temp-badge temp-cold">cold</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
