export const dynamic = "force-dynamic";

import type { CSSProperties } from "react";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { db } from "@/infrastructure/db/client";
import { leads, conversations, messages } from "@/infrastructure/db/schema";
import { eq, count, and, desc, sql, gte, lt } from "drizzle-orm";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Bot,
  Calendar,
  CheckCircle2,
  Clock,
  Flame,
  MessageCircle,
  Snowflake,
  Thermometer,
  TrendingUp,
  Users,
} from "lucide-react";

const DASHBOARD_TZ = "America/Sao_Paulo";
const MINUTES_SAVED_PER_AGENT_REPLY = 2;

type LeadTemperature = "hot" | "warm" | "cold";

type RecentLead = {
  id: string;
  name: string | null;
  phone: string | null;
  channel: string;
  status: string;
  temperature: string | null;
  createdAt: Date;
};

type FlowPoint = {
  label: string;
  count: number;
};

function formatDate(date: Date): string {
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: DASHBOARD_TZ,
  });
}

function relativeTime(date: Date): string {
  const now = Date.now();
  const diff = Math.max(0, now - date.getTime());
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "agora";
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

function statusTone(status: string): string {
  const map: Record<string, string> = {
    appointment_scheduled: "success",
    won: "success",
    in_conversation: "info",
    waiting_response: "warning",
    follow_up_due: "warning",
    lost: "danger",
    new: "neutral",
  };
  return map[status] ?? "neutral";
}

function temperatureLabel(temperature: string | null): string {
  if (temperature === "hot") return "Quente";
  if (temperature === "warm") return "Morno";
  if (temperature === "cold") return "Frio";
  return "Sem score";
}

function temperatureClass(temperature: string | null): string {
  if (temperature === "hot" || temperature === "warm" || temperature === "cold") {
    return `temp-${temperature}`;
  }
  return "temp-neutral";
}

function todayFormatted(): string {
  return new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: DASHBOARD_TZ,
  });
}

function nameInitial(name: string | null, phone: string | null): string {
  if (name && name.trim().length > 0) return name.trim()[0].toUpperCase();
  if (phone && phone.trim().length > 0) return phone.trim()[0];
  return "?";
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildFlowSeries(rows: Array<{ createdAt: Date }>, startDate: Date): FlowPoint[] {
  const buckets = new Map<string, number>();
  const days = Array.from({ length: 7 }, (_, index) => addDays(startDate, index));

  for (const day of days) {
    buckets.set(dateKey(day), 0);
  }

  for (const row of rows) {
    const key = dateKey(startOfDay(row.createdAt));
    if (buckets.has(key)) {
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  }

  return days.map((day) => ({
    label: day.toLocaleDateString("pt-BR", { weekday: "short", timeZone: DASHBOARD_TZ }),
    count: buckets.get(dateKey(day)) ?? 0,
  }));
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 1,
  }).format(value);
}

function formatTimeSaved(minutes: number): string {
  if (minutes <= 0) return "0h";
  if (minutes < 60) return `${minutes}min`;
  return `${Math.round(minutes / 60)}h`;
}

function trendLabel(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? "novo" : "0%";
  const value = Math.round(((current - previous) / previous) * 100);
  return `${value > 0 ? "+" : ""}${value}%`;
}

function trendTone(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? "positive" : "neutral";
  if (current > previous) return "positive";
  if (current < previous) return "negative";
  return "neutral";
}

function chartGeometry(series: FlowPoint[]) {
  const width = 640;
  const height = 260;
  const paddingX = 18;
  const paddingY = 22;
  const max = Math.max(...series.map((point) => point.count), 1);
  const usableWidth = width - paddingX * 2;
  const usableHeight = height - paddingY * 2;

  const points = series.map((point, index) => {
    const x = paddingX + (usableWidth / Math.max(series.length - 1, 1)) * index;
    const y = height - paddingY - (point.count / max) * usableHeight;
    return { ...point, x, y };
  });

  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
  const areaPath = `${path} L ${width - paddingX} ${height - paddingY} L ${paddingX} ${
    height - paddingY
  } Z`;

  return { width, height, path, areaPath, points };
}

async function fetchDashboardData() {
  const CLINIC_ID = (await getSessionClinicId()) ?? "";
  const todayStart = startOfDay(new Date());
  const flowStart = addDays(todayStart, -6);
  const previousStart = addDays(flowStart, -7);

  if (!CLINIC_ID) {
    return {
      totalLeads: 0,
      scheduledCount: 0,
      activeHotCount: 0,
      afterHoursCount: 0,
      totalConversations: 0,
      needsAttentionCount: 0,
      agentMessageCount: 0,
      currentPeriodLeadCount: 0,
      previousPeriodLeadCount: 0,
      recentLeads: [] as RecentLead[],
      flowSeries: buildFlowSeries([], flowStart),
      tempCounts: { hot: 0, warm: 0, cold: 0 },
    };
  }

  const [
    totalLeadsResult,
    scheduledResult,
    activeHotResult,
    recentLeadsResult,
    tempHotResult,
    tempWarmResult,
    tempColdResult,
    totalConversationsResult,
    needsAttentionResult,
    agentMessagesResult,
    afterHoursResult,
    currentFlowLeadsResult,
    previousLeadPeriodResult,
  ] = await Promise.all([
    db.select({ count: count() }).from(leads).where(eq(leads.clinicId, CLINIC_ID)),
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
      .limit(8),
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
    db.select({ count: count() }).from(conversations).where(eq(conversations.clinicId, CLINIC_ID)),
    db
      .select({ count: count() })
      .from(conversations)
      .where(and(eq(conversations.clinicId, CLINIC_ID), eq(conversations.needsAttention, true))),
    db
      .select({ count: count() })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(and(eq(conversations.clinicId, CLINIC_ID), eq(messages.author, "agent"))),
    db
      .select({ count: count() })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(
        and(
          eq(conversations.clinicId, CLINIC_ID),
          eq(messages.author, "lead"),
          sql`(
            EXTRACT(HOUR FROM (${messages.sentAt} AT TIME ZONE 'America/Sao_Paulo')) >= 18
            OR EXTRACT(HOUR FROM (${messages.sentAt} AT TIME ZONE 'America/Sao_Paulo')) < 8
          )`,
        ),
      ),
    db
      .select({ createdAt: leads.createdAt })
      .from(leads)
      .where(and(eq(leads.clinicId, CLINIC_ID), gte(leads.createdAt, flowStart))),
    db
      .select({ count: count() })
      .from(leads)
      .where(
        and(
          eq(leads.clinicId, CLINIC_ID),
          gte(leads.createdAt, previousStart),
          lt(leads.createdAt, flowStart),
        ),
      ),
  ]);

  return {
    totalLeads: totalLeadsResult[0]?.count ?? 0,
    scheduledCount: scheduledResult[0]?.count ?? 0,
    activeHotCount: activeHotResult[0]?.count ?? 0,
    afterHoursCount: afterHoursResult[0]?.count ?? 0,
    totalConversations: totalConversationsResult[0]?.count ?? 0,
    needsAttentionCount: needsAttentionResult[0]?.count ?? 0,
    agentMessageCount: agentMessagesResult[0]?.count ?? 0,
    currentPeriodLeadCount: currentFlowLeadsResult.length,
    previousPeriodLeadCount: previousLeadPeriodResult[0]?.count ?? 0,
    recentLeads: recentLeadsResult,
    flowSeries: buildFlowSeries(currentFlowLeadsResult, flowStart),
    tempCounts: {
      hot: tempHotResult[0]?.count ?? 0,
      warm: tempWarmResult[0]?.count ?? 0,
      cold: tempColdResult[0]?.count ?? 0,
    },
  };
}

export default async function DashboardPage() {
  const data = await fetchDashboardData();
  const conversionRate = data.totalLeads > 0 ? (data.scheduledCount / data.totalLeads) * 100 : 0;
  const automationRate =
    data.totalConversations > 0
      ? ((data.totalConversations - data.needsAttentionCount) / data.totalConversations) * 100
      : 0;
  const estimatedTimeSavedMinutes = data.agentMessageCount * MINUTES_SAVED_PER_AGENT_REPLY;
  const leadTrend = trendLabel(data.currentPeriodLeadCount, data.previousPeriodLeadCount);
  const leadTrendTone = trendTone(data.currentPeriodLeadCount, data.previousPeriodLeadCount);
  const flowChart = chartGeometry(data.flowSeries);
  const tempTotal = data.tempCounts.hot + data.tempCounts.warm + data.tempCounts.cold;
  const tempEntries: Array<{ key: LeadTemperature; label: string; value: number; Icon: typeof Flame }> = [
    { key: "hot", label: "Quentes", value: data.tempCounts.hot, Icon: Flame },
    { key: "warm", label: "Mornos", value: data.tempCounts.warm, Icon: Thermometer },
    { key: "cold", label: "Frios", value: data.tempCounts.cold, Icon: Snowflake },
  ];
  const hotDeg = tempTotal > 0 ? (data.tempCounts.hot / tempTotal) * 360 : 0;
  const warmDeg = tempTotal > 0 ? (data.tempCounts.warm / tempTotal) * 360 : 0;
  const donutStyle: CSSProperties = {
    background:
      tempTotal > 0
        ? `conic-gradient(var(--hot) 0deg ${hotDeg}deg, var(--warm) ${hotDeg}deg ${
            hotDeg + warmDeg
          }deg, var(--cold) ${hotDeg + warmDeg}deg 360deg)`
        : "conic-gradient(var(--line-strong) 0deg 360deg)",
  };

  return (
    <div className="dashboard-shell">
      <header className="dashboard-topbar">
        <div className="dashboard-title">
          <span className="dashboard-eyebrow">Command center</span>
          <h1>Dashboard</h1>
          <p>{todayFormatted()}</p>
        </div>

        <div className="dashboard-topbar-actions">
          <span className="dashboard-sync-pill">
            <Bot size={15} />
            Sincronizado com IA
          </span>
          {data.needsAttentionCount > 0 ? (
            <Link href="/app/inbox?filter=attention" className="dashboard-alert-pill" style={{ textDecoration: "none" }}>
              <AlertTriangle size={15} />
              {data.needsAttentionCount} intervenção{data.needsAttentionCount !== 1 ? "es" : ""}
            </Link>
          ) : (
            <span className="dashboard-quiet-pill">
              <CheckCircle2 size={15} />
              Sem bloqueios
            </span>
          )}
        </div>
      </header>

      <section className="dashboard-kpis" aria-label="Indicadores principais">
        <article className="dashboard-kpi-card">
          <div className="dashboard-kpi-header">
            <span className="dashboard-kpi-icon">
              <Users size={16} />
            </span>
            <span>Total de Leads</span>
            <span className={`dashboard-trend ${leadTrendTone}`}>{leadTrend}</span>
          </div>
          <strong>{data.totalLeads}</strong>
          <small>{data.currentPeriodLeadCount} nos últimos 7 dias</small>
        </article>

        <article className="dashboard-kpi-card featured">
          <div className="dashboard-kpi-header">
            <span className="dashboard-kpi-icon">
              <Calendar size={16} />
            </span>
            <span>Agendamentos IA</span>
            <span className="dashboard-trend positive">{formatPercent(conversionRate)}%</span>
          </div>
          <strong>{data.scheduledCount}</strong>
          <small>{formatPercent(conversionRate)}% taxa de conversão</small>
        </article>

        <article className="dashboard-kpi-card">
          <div className="dashboard-kpi-header">
            <span className="dashboard-kpi-icon">
              <Clock size={16} />
            </span>
            <span>Economia de Tempo</span>
            <span className="dashboard-trend positive">{data.agentMessageCount} msgs</span>
          </div>
          <strong>{formatTimeSaved(estimatedTimeSavedMinutes)}</strong>
          <small>~2min economizados por resposta da IA</small>
        </article>

        <article className="dashboard-kpi-card">
          <div className="dashboard-kpi-header">
            <span className="dashboard-kpi-icon hot">
              <Flame size={16} />
            </span>
            <span>Leads Quentes</span>
            <span className="dashboard-trend neutral">{data.activeHotCount} em conversa</span>
          </div>
          <strong>{data.tempCounts.hot}</strong>
          <small>total · {data.activeHotCount} ativos agora</small>
        </article>
      </section>

      <main className="dashboard-grid">
        <section className="dashboard-panel dashboard-flow-panel">
          <div className="dashboard-panel-header">
            <div>
              <p className="dashboard-panel-kicker">Performance</p>
              <h2>Fluxo de Conversas</h2>
            </div>
            <span className="dashboard-panel-badge">
              <Activity size={14} />
              7 dias
            </span>
          </div>

          <div className="dashboard-chart-wrap" aria-label="Leads capturados nos últimos 7 dias">
            <svg
              className="dashboard-line-chart"
              viewBox={`0 0 ${flowChart.width} ${flowChart.height}`}
              role="img"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="dashboardChartFill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.38" />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
                </linearGradient>
                <filter id="dashboardGlow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="4" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <line x1="18" x2="622" y1="64" y2="64" className="dashboard-chart-gridline" />
              <line x1="18" x2="622" y1="130" y2="130" className="dashboard-chart-gridline" />
              <line x1="18" x2="622" y1="196" y2="196" className="dashboard-chart-gridline" />
              <path d={flowChart.areaPath} fill="url(#dashboardChartFill)" />
              <path d={flowChart.path} className="dashboard-chart-line" filter="url(#dashboardGlow)" />
              {flowChart.points.map((point) => (
                <circle
                  key={`${point.label}-${point.x}`}
                  cx={point.x}
                  cy={point.y}
                  r="5"
                  className="dashboard-chart-dot"
                />
              ))}
            </svg>
            <div className="dashboard-chart-labels">
              {data.flowSeries.map((point) => (
                <span key={point.label}>
                  <strong>{point.count}</strong>
                  {point.label}
                </span>
              ))}
            </div>
          </div>

          <div className="dashboard-insights">
            <div>
              <MessageCircle size={15} />
              <span>
                <strong>{formatPercent(automationRate)}%</strong>
                autonomia da IA
              </span>
            </div>
            <div>
              <Clock size={15} />
              <span>
                <strong>{data.afterHoursCount}</strong>
                msgs fora do horário atendidas pela IA
              </span>
            </div>
            <div>
              <TrendingUp size={15} />
              <span>
                <strong>{data.scheduledCount}</strong>
                consultas marcadas
              </span>
            </div>
          </div>
        </section>

        <section className="dashboard-panel dashboard-leads-panel">
          <div className="dashboard-panel-header compact">
            <div>
              <p className="dashboard-panel-kicker">Atividade recente</p>
              <h2>Leads Recentes</h2>
            </div>
            <Link
              href="/app/inbox"
              style={{ fontSize: "12px", color: "var(--accent-strong, #34d399)", fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}
            >
              Ver todos →
            </Link>
          </div>

          {data.recentLeads.length === 0 ? (
            <div className="empty-state compact dashboard-empty-state">
              Nenhum lead registrado ainda.
            </div>
          ) : (
            <>
              <div className="dashboard-table-wrap">
                <table className="dashboard-leads-table">
                  <thead>
                    <tr>
                      {["Lead", "Status", "Temperatura", "Data"].map((col) => (
                        <th key={col}>{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentLeads.map((lead) => (
                      <tr key={lead.id}>
                        <td>
                          <div className="dashboard-lead-cell">
                            <div className="dashboard-avatar">{nameInitial(lead.name, lead.phone)}</div>
                            <div>
                              <strong>{lead.name ?? "Sem nome"}</strong>
                              <span>{channelLabel(lead.channel)}</span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className={`dashboard-status-pill ${statusTone(lead.status)}`}>
                            {statusLabel(lead.status)}
                          </span>
                        </td>
                        <td>
                          <span className={`temp-badge ${temperatureClass(lead.temperature)}`}>
                            {temperatureLabel(lead.temperature)}
                          </span>
                        </td>
                        <td>
                          <span className="dashboard-date-cell">{formatDate(lead.createdAt)}</span>
                          <small>{relativeTime(lead.createdAt)}</small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="dashboard-mobile-leads">
                {data.recentLeads.map((lead) => (
                  <article key={lead.id} className={`dashboard-mobile-lead ${temperatureClass(lead.temperature)}`}>
                    <div className="dashboard-mobile-lead-main">
                      <div className="dashboard-avatar">{nameInitial(lead.name, lead.phone)}</div>
                      <div>
                        <strong>{lead.name ?? "Sem nome"}</strong>
                        <span>{channelLabel(lead.channel)} · {relativeTime(lead.createdAt)}</span>
                      </div>
                    </div>
                    <div className="dashboard-mobile-lead-tags">
                      <span className={`dashboard-status-pill ${statusTone(lead.status)}`}>
                        {statusLabel(lead.status)}
                      </span>
                      <span className={`temp-badge ${temperatureClass(lead.temperature)}`}>
                        {temperatureLabel(lead.temperature)}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="dashboard-panel dashboard-temp-panel">
          <div className="dashboard-panel-header compact">
            <div>
              <p className="dashboard-panel-kicker">Saúde do funil</p>
              <h2>Distribuição de Temperatura</h2>
            </div>
            <span className="dashboard-panel-badge">+{tempTotal}</span>
          </div>

          <div className="dashboard-temp-content">
            <div className="dashboard-donut" style={donutStyle}>
              <div>
                <strong>{tempTotal}</strong>
                <span>leads</span>
              </div>
            </div>

            <div className="dashboard-temp-list">
              {tempEntries.map(({ key, label, value, Icon }) => {
                const percent = tempTotal > 0 ? (value / tempTotal) * 100 : 0;
                return (
                  <div key={key} className={`dashboard-temp-row ${temperatureClass(key)}`}>
                    <span>
                      <Icon size={14} />
                      {label}
                    </span>
                    <strong>{formatPercent(percent)}%</strong>
                    <small>{value}</small>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
