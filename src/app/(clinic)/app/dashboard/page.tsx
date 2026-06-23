export const dynamic = "force-dynamic";

import type { CSSProperties } from "react";
import { cookies } from "next/headers";
import { verifyToken, COOKIE_NAME } from "@/lib/session";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { getSessionMemberProfile, canViewFinancials, canViewOwnRevenue } from "@/application/tenancy/member-role";
import { redirect } from "next/navigation";
import { db } from "@/infrastructure/db/client";
import { leads, conversations, messages, clinicMembers, appointments, treatments, clinics, professionals } from "@/infrastructure/db/schema";
import { eq, count, and, desc, sql, gte, lt, notInArray, inArray, isNotNull, asc } from "drizzle-orm";
import Link from "next/link";
import { Suspense } from "react";
import { MobileDashboardAvatar } from "@/components/mobile-dashboard-avatar";
import { DashboardPeriodToggle, type PeriodKey } from "./DashboardPeriodToggle";
import { DashboardRingMetrics } from "./DashboardRingMetrics";
import {
  Activity,
  AlertTriangle,
  Bot,
  Calendar,
  CheckCircle2,
  Clock,
  Flame,
  Snowflake,
  Thermometer,
  Users,
  RefreshCw,
} from "lucide-react";

const DASHBOARD_TZ = "America/Sao_Paulo";
const MINUTES_SAVED_PER_AGENT_REPLY = 2;

type LeadTemperature = "hot" | "warm" | "cold";

type FlowPoint = {
  label: string;
  count: number;
};

function formatTime(date: Date): string {
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: DASHBOARD_TZ,
  });
}

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
    follow_up_due: "Recuperação",
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

function buildFlowSeries(rows: Array<{ createdAt: Date }>, startDate: Date, numDays = 7): FlowPoint[] {
  const buckets = new Map<string, number>();
  const days = Array.from({ length: numDays }, (_, index) => addDays(startDate, index));

  for (const day of days) {
    buckets.set(dateKey(day), 0);
  }

  for (const row of rows) {
    const key = dateKey(startOfDay(row.createdAt));
    if (buckets.has(key)) {
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  }

  const labelFormat: Intl.DateTimeFormatOptions =
    numDays <= 7 ? { weekday: "short" } : { day: "2-digit", month: "short" };

  return days.map((day) => ({
    label: day.toLocaleDateString("pt-BR", { ...labelFormat, timeZone: DASHBOARD_TZ }),
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

function emailToFirstName(email: string): string {
  const local = email.split("@")[0];
  const first = local.split(/[._\-0-9]/)[0];
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

// Saudação amigável a partir do nome do profissional vinculado ao membro.
// "Dra. Helena Marques" → "Dra. Helena"; "João Pereira" → "João".
function greetingFromProfessionalName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "você";
  if (/^(dr|dra)\.?$/i.test(parts[0]) && parts[1]) {
    return `${parts[0]} ${parts[1]}`;
  }
  return parts[0];
}

function trendTone(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? "positive" : "neutral";
  if (current > previous) return "positive";
  if (current < previous) return "negative";
  return "neutral";
}

function chartGeometry(series: FlowPoint[]) {
  const width = 640;
  const height = 130;
  const paddingX = 18;
  const paddingY = 16;
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

function periodToDays(period: string): number {
  if (period === "30d") return 30;
  if (period === "3m") return 90;
  return 7;
}

function formatBRL(cents: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function periodLabel(period: string): string {
  if (period === "30d") return "30 dias";
  if (period === "3m") return "3 meses";
  return "7 dias";
}

type ByTreatmentRow = { treatmentName: string; total: number; count: number };

type RevenueData = {
  potentialCents: number;
  potentialCount: number;
  confirmedCents: number;
  confirmedCount: number;
  byTreatment: ByTreatmentRow[];
  monthlyRevenueBrl: number;
};

async function fetchRevenueData(
  clinicId: string,
  periodStart: Date,
  professionalId: string | null,
): Promise<RevenueData> {
  const professionalFilter = professionalId
    ? [eq(appointments.professionalId, professionalId)]
    : [];

  const [potentialResult, confirmedResult, byTreatmentResult, clinicRow] = await Promise.all([
    db
      .select({ sum: sql<number>`coalesce(sum(${appointments.valueCents}), 0)`, cnt: count() })
      .from(appointments)
      .where(
        and(
          eq(appointments.clinicId, clinicId),
          inArray(appointments.status, ["scheduled", "confirmed"]),
          gte(appointments.createdAt, periodStart),
          isNotNull(appointments.valueCents),
          ...professionalFilter,
        ),
      ),
    db
      .select({ sum: sql<number>`coalesce(sum(${appointments.valueCents}), 0)`, cnt: count() })
      .from(appointments)
      .where(
        and(
          eq(appointments.clinicId, clinicId),
          eq(appointments.status, "completed"),
          gte(appointments.createdAt, periodStart),
          isNotNull(appointments.valueCents),
          ...professionalFilter,
        ),
      ),
    db
      .select({
        treatmentName: treatments.name,
        total: sql<number>`coalesce(sum(${appointments.valueCents}), 0)`,
        cnt: count(),
      })
      .from(appointments)
      .innerJoin(treatments, eq(appointments.treatmentId, treatments.id))
      .where(
        and(
          eq(appointments.clinicId, clinicId),
          gte(appointments.createdAt, periodStart),
          isNotNull(appointments.valueCents),
          ...professionalFilter,
        ),
      )
      .groupBy(treatments.name)
      .orderBy(desc(sql`sum(${appointments.valueCents})`))
      .limit(3),
    db
      .select({ monthlyRevenueBrl: clinics.monthlyRevenueBrl })
      .from(clinics)
      .where(eq(clinics.id, clinicId))
      .limit(1),
  ]);

  return {
    potentialCents: Number(potentialResult[0]?.sum ?? 0),
    potentialCount: potentialResult[0]?.cnt ?? 0,
    confirmedCents: Number(confirmedResult[0]?.sum ?? 0),
    confirmedCount: confirmedResult[0]?.cnt ?? 0,
    byTreatment: byTreatmentResult.map((r) => ({
      treatmentName: r.treatmentName,
      total: Number(r.total),
      count: r.cnt,
    })),
    monthlyRevenueBrl: clinicRow[0]?.monthlyRevenueBrl ?? 89700,
  };
}

async function fetchDashboardData(period: string) {
  const CLINIC_ID = await getSessionClinicId();
  if (!CLINIC_ID) redirect("/login");
  const days = periodToDays(period);
  const todayStart = startOfDay(new Date());
  const flowStart = addDays(todayStart, -(days - 1));
  const previousStart = addDays(flowStart, -days);

  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  const session = token ? await verifyToken(token) : null;
  const userEmail = session?.email ?? "";

  const memberProfile = await getSessionMemberProfile(CLINIC_ID);

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
    memberResult,
    todayAppointmentsResult,
    recoveryLeadsResult,
    attentionLeadsResult,
  ] = await Promise.all([
    db
      .select({ count: count() })
      .from(leads)
      .innerJoin(conversations, eq(conversations.leadId, leads.id))
      .where(and(eq(leads.clinicId, CLINIC_ID), eq(conversations.category, "sales"))),
    db
      .select({ count: count() })
      .from(leads)
      .innerJoin(conversations, eq(conversations.leadId, leads.id))
      .where(and(
        eq(leads.clinicId, CLINIC_ID),
        eq(conversations.category, "sales"),
        eq(leads.status, "appointment_scheduled"),
      )),
    db
      .select({ count: count() })
      .from(leads)
      .innerJoin(conversations, eq(conversations.leadId, leads.id))
      .where(
        and(
          eq(leads.clinicId, CLINIC_ID),
          eq(conversations.category, "sales"),
          eq(leads.temperature, "hot"),
          eq(leads.status, "in_conversation"),
        ),
      ),
    db
      .select({
        id: leads.id,
        convId: conversations.id,
        name: leads.name,
        phone: leads.phone,
        channel: leads.channel,
        status: leads.status,
        temperature: leads.temperature,
        createdAt: leads.createdAt,
      })
      .from(leads)
      .innerJoin(conversations, eq(conversations.leadId, leads.id))
      .where(and(eq(leads.clinicId, CLINIC_ID), eq(conversations.category, "sales")))
      .orderBy(desc(leads.createdAt))
      .limit(8),
    db
      .select({ count: count() })
      .from(leads)
      .innerJoin(conversations, eq(conversations.leadId, leads.id))
      .where(and(
        eq(leads.clinicId, CLINIC_ID),
        eq(conversations.category, "sales"),
        eq(leads.temperature, "hot"),
        notInArray(leads.status, ["appointment_scheduled", "won", "lost"]),
      )),
    db
      .select({ count: count() })
      .from(leads)
      .innerJoin(conversations, eq(conversations.leadId, leads.id))
      .where(and(
        eq(leads.clinicId, CLINIC_ID),
        eq(conversations.category, "sales"),
        eq(leads.temperature, "warm"),
        notInArray(leads.status, ["appointment_scheduled", "won", "lost"]),
      )),
    db
      .select({ count: count() })
      .from(leads)
      .innerJoin(conversations, eq(conversations.leadId, leads.id))
      .where(and(
        eq(leads.clinicId, CLINIC_ID),
        eq(conversations.category, "sales"),
        eq(leads.temperature, "cold"),
        notInArray(leads.status, ["appointment_scheduled", "won", "lost"]),
      )),
    db
      .select({ count: count() })
      .from(conversations)
      .where(and(eq(conversations.clinicId, CLINIC_ID), eq(conversations.category, "sales"))),
    db
      .select({ count: count() })
      .from(conversations)
      .where(and(
        eq(conversations.clinicId, CLINIC_ID),
        eq(conversations.category, "sales"),
        eq(conversations.needsAttention, true),
      )),
    db
      .select({ count: count() })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(and(
        eq(conversations.clinicId, CLINIC_ID),
        eq(conversations.category, "sales"),
        eq(messages.author, "agent"),
      )),
    db
      .select({ count: count() })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(
        and(
          eq(conversations.clinicId, CLINIC_ID),
          eq(conversations.category, "sales"),
          eq(messages.author, "lead"),
          gte(messages.sentAt, flowStart),
          sql`(
            EXTRACT(HOUR FROM (${messages.sentAt} AT TIME ZONE 'America/Sao_Paulo')) >= 18
            OR EXTRACT(HOUR FROM (${messages.sentAt} AT TIME ZONE 'America/Sao_Paulo')) < 8
          )`,
        ),
      ),
    db
      .select({ createdAt: leads.createdAt })
      .from(leads)
      .innerJoin(conversations, eq(conversations.leadId, leads.id))
      .where(and(
        eq(leads.clinicId, CLINIC_ID),
        eq(conversations.category, "sales"),
        gte(leads.createdAt, flowStart),
      )),
    db
      .select({ count: count() })
      .from(leads)
      .innerJoin(conversations, eq(conversations.leadId, leads.id))
      .where(
        and(
          eq(leads.clinicId, CLINIC_ID),
          eq(conversations.category, "sales"),
          gte(leads.createdAt, previousStart),
          lt(leads.createdAt, flowStart),
        ),
      ),
    userEmail
      ? db
          .select({ avatarUrl: clinicMembers.avatarUrl, professionalName: professionals.name })
          .from(clinicMembers)
          .leftJoin(professionals, eq(professionals.id, clinicMembers.professionalId))
          .where(and(eq(clinicMembers.email, userEmail), eq(clinicMembers.clinicId, CLINIC_ID)))
          .limit(1)
      : Promise.resolve([] as Array<{ avatarUrl: string | null; professionalName: string | null }>),
    // Agendamentos de hoje (fuso da clínica) excluindo cancelados
    db
      .select({
        id: appointments.id,
        startsAt: appointments.startsAt,
        endsAt: appointments.endsAt,
        status: appointments.status,
        leadName: leads.name,
        leadPhone: leads.phone,
      })
      .from(appointments)
      .leftJoin(leads, eq(appointments.leadId, leads.id))
      .where(and(
        eq(appointments.clinicId, CLINIC_ID),
        notInArray(appointments.status, ["cancelled"]),
        sql`(${appointments.startsAt} AT TIME ZONE 'America/Sao_Paulo')::date = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date`,
      ))
      .orderBy(asc(appointments.startsAt))
      .limit(8),
    // Leads em recuperação para o painel operacional
    db
      .select({
        id: leads.id,
        name: leads.name,
        phone: leads.phone,
        treatmentInterest: leads.treatmentInterest,
        status: leads.status,
        updatedAt: leads.updatedAt,
      })
      .from(leads)
      .innerJoin(conversations, eq(conversations.leadId, leads.id))
      .where(and(
        eq(leads.clinicId, CLINIC_ID),
        eq(conversations.category, "sales"),
        eq(leads.status, "follow_up_due"),
      ))
      .orderBy(desc(leads.updatedAt))
      .limit(5),
    db
      .select({
        id: leads.id,
        name: leads.name,
        phone: leads.phone,
        treatmentInterest: leads.treatmentInterest,
        status: leads.status,
        updatedAt: conversations.updatedAt,
      })
      .from(conversations)
      .innerJoin(leads, eq(conversations.leadId, leads.id))
      .where(and(
        eq(conversations.clinicId, CLINIC_ID),
        eq(conversations.category, "sales"),
        eq(conversations.needsAttention, true),
      ))
      .orderBy(desc(conversations.updatedAt))
      .limit(5),
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
    flowSeries: buildFlowSeries(currentFlowLeadsResult, flowStart, days),
    tempCounts: {
      hot: tempHotResult[0]?.count ?? 0,
      warm: tempWarmResult[0]?.count ?? 0,
      cold: tempColdResult[0]?.count ?? 0,
    },
    userEmail,
    avatarUrl: memberResult[0]?.avatarUrl ?? null,
    professionalName: memberResult[0]?.professionalName ?? null,
    memberProfile,
    flowStart,
    CLINIC_ID,
    todayAppointments: todayAppointmentsResult,
    recoveryLeads: recoveryLeadsResult,
    attentionLeads: attentionLeadsResult,
  };
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period = "7d" } = await searchParams;
  const safePeriod = ["7d", "30d", "3m"].includes(period) ? period : "7d";
  const data = await fetchDashboardData(safePeriod);

  const { memberProfile } = data;
  const showRevenue = memberProfile
    ? canViewFinancials(memberProfile) || canViewOwnRevenue(memberProfile)
    : false;
  const ownRevenueOnly = memberProfile ? canViewOwnRevenue(memberProfile) : false;
  const showRoi = memberProfile ? canViewFinancials(memberProfile) : false;

  const todayApptCount = data.todayAppointments.length;
  const recoveryLeadCount = data.recoveryLeads.length;
  const attentionLeadCount = data.attentionLeads.length;
  const revenueData = showRevenue
    ? await fetchRevenueData(
        data.CLINIC_ID,
        data.flowStart,
        ownRevenueOnly ? (memberProfile?.professionalId ?? null) : null,
      )
    : null;
  const firstName = data.userEmail ? emailToFirstName(data.userEmail) : "você";
  const greetingName = data.professionalName
    ? greetingFromProfessionalName(data.professionalName)
    : firstName;
  const conversionRate = data.totalLeads > 0 ? (data.scheduledCount / data.totalLeads) * 100 : 0;
  const conversionTone = conversionRate >= 10 ? "positive" : conversionRate >= 4 ? "neutral" : "negative";
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
      {/* Mobile-only header: SystemOps brand + avatar + greeting */}
      <div className="dashboard-mobile-header">
        <div className="dashboard-mobile-toprow">
          <span className="dashboard-mobile-brand">SystemOps</span>
          <MobileDashboardAvatar
            avatarUrl={data.avatarUrl}
            initial={firstName[0]?.toUpperCase() ?? "?"}
          />
        </div>
        <p className="dashboard-mobile-greeting">Olá, {greetingName}!</p>
        <p className="dashboard-mobile-date">{todayFormatted()}</p>
      </div>

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
          <small>{data.currentPeriodLeadCount} nos últimos {periodLabel(safePeriod)}</small>
        </article>

        <article className="dashboard-kpi-card featured">
          <div className="dashboard-kpi-header">
            <span className="dashboard-kpi-icon">
              <Calendar size={16} />
            </span>
            <span>Consultas Marcadas</span>
            <span className={`dashboard-trend ${conversionTone}`}>{formatPercent(conversionRate)}%</span>
          </div>
          <strong>{data.scheduledCount}</strong>
          <small>{formatPercent(conversionRate)}% de conversão · foto atual</small>
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
          <small>ativos no funil · {data.activeHotCount} em conversa agora</small>
        </article>

        <article className="dashboard-kpi-card" style={{ borderColor: todayApptCount > 0 ? "color-mix(in srgb, var(--accent) 30%, transparent)" : undefined }}>
          <div className="dashboard-kpi-header">
            <span className="dashboard-kpi-icon">
              <Calendar size={16} />
            </span>
            <span>Consultas Hoje</span>
            {todayApptCount > 0 && <span className="dashboard-trend positive">hoje</span>}
          </div>
          <strong style={{ color: todayApptCount > 0 ? "var(--accent-strong)" : undefined }}>{todayApptCount}</strong>
          <small>{todayApptCount === 0 ? "nenhuma consulta agendada" : `${todayApptCount} consulta${todayApptCount !== 1 ? "s" : ""} na agenda`}</small>
        </article>
      </section>

      {/* ── Pipeline de Receita ─────────────────────────────────────────── */}
      {revenueData && (
        <section
          style={{
            border: "1px solid var(--line)",
            borderRadius: "14px",
            background: "var(--surface-soft)",
            padding: "20px 24px",
            marginTop: "0",
          }}
          aria-label="Pipeline de receita"
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
            <div>
              <p style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", color: "var(--muted)", textTransform: "uppercase", margin: 0 }}>
                Receita
              </p>
              <h2 style={{ margin: "2px 0 0", fontSize: "17px", fontWeight: 700 }}>
                {ownRevenueOnly ? "Minha Receita" : "Pipeline de Receita"}
              </h2>
            </div>
            <span style={{ fontSize: "12px", color: "var(--muted)" }}>{periodLabel(safePeriod)}</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: showRoi ? "1fr 1fr 1fr" : "1fr 1fr", gap: "12px", marginBottom: "20px" }}>
            <div style={{ border: "1px solid var(--line)", borderRadius: "10px", padding: "14px 16px", background: "var(--surface-raised)" }}>
              <p style={{ fontSize: "11px", color: "var(--muted)", margin: "0 0 6px", fontWeight: 600 }}>Potencial</p>
              <strong style={{ fontSize: "22px", fontWeight: 800, color: "var(--accent-strong)" }}>
                {formatBRL(revenueData.potentialCents)}
              </strong>
              <p style={{ fontSize: "12px", color: "var(--muted)", margin: "4px 0 0" }}>
                {revenueData.potentialCount} agendado{revenueData.potentialCount !== 1 ? "s" : ""}
              </p>
            </div>

            <div style={{ border: "1px solid var(--line)", borderRadius: "10px", padding: "14px 16px", background: "var(--surface-raised)" }}>
              <p style={{ fontSize: "11px", color: "var(--muted)", margin: "0 0 6px", fontWeight: 600 }}>Confirmado</p>
              <strong style={{ fontSize: "22px", fontWeight: 800, color: "var(--text)" }}>
                {formatBRL(revenueData.confirmedCents)}
              </strong>
              <p style={{ fontSize: "12px", color: "var(--muted)", margin: "4px 0 0" }}>
                {revenueData.confirmedCount} realizado{revenueData.confirmedCount !== 1 ? "s" : ""}
              </p>
            </div>

            {showRoi && (
              <div style={{ border: "1px solid var(--line)", borderRadius: "10px", padding: "14px 16px", background: "var(--surface-raised)" }}>
                <p style={{ fontSize: "11px", color: "var(--muted)", margin: "0 0 6px", fontWeight: 600 }}>ROI</p>
                <strong style={{ fontSize: "22px", fontWeight: 800, color: "var(--text)" }}>
                  {revenueData.monthlyRevenueBrl > 0
                    ? `${(revenueData.confirmedCents / revenueData.monthlyRevenueBrl)
                        .toFixed(1)
                        .replace(".", ",")}x`
                    : "—"}
                </strong>
                <p style={{ fontSize: "12px", color: "var(--muted)", margin: "4px 0 0" }}>
                  sobre a mensalidade
                </p>
              </div>
            )}
          </div>

          {/* Barra de conversão */}
          {(revenueData.potentialCents + revenueData.confirmedCents) > 0 && (
            <div style={{ marginBottom: "20px" }}>
              <div
                style={{
                  height: "6px",
                  borderRadius: "3px",
                  background: "var(--line-strong)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${Math.min(100, Math.round((revenueData.confirmedCents / (revenueData.potentialCents + revenueData.confirmedCents)) * 100))}%`,
                    background: "var(--accent-strong)",
                    borderRadius: "3px",
                    transition: "width 0.4s ease",
                  }}
                />
              </div>
              <p style={{ fontSize: "11px", color: "var(--muted)", marginTop: "6px" }}>
                {Math.round((revenueData.confirmedCents / (revenueData.potentialCents + revenueData.confirmedCents)) * 100)}% convertido
              </p>
            </div>
          )}

          {/* Top tratamentos */}
          {revenueData.byTreatment.length > 0 && (
            <div style={{ display: "grid", gap: "8px" }}>
              {revenueData.byTreatment.map((row) => {
                const maxTotal = revenueData.byTreatment[0]?.total ?? 1;
                const barWidth = Math.round((row.total / maxTotal) * 100);
                return (
                  <div key={row.treatmentName} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span style={{ fontSize: "13px", color: "var(--text)", minWidth: "140px", flexShrink: 0 }}>
                      {row.treatmentName}
                    </span>
                    <div style={{ flex: 1, height: "6px", borderRadius: "3px", background: "var(--line-strong)", overflow: "hidden" }}>
                      <div style={{ width: `${barWidth}%`, height: "100%", background: "var(--accent)", borderRadius: "3px" }} />
                    </div>
                    <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--text)", minWidth: "80px", textAlign: "right" }}>
                      {formatBRL(row.total)}
                    </span>
                    <span style={{ fontSize: "11px", color: "var(--muted)", minWidth: "60px", textAlign: "right" }}>
                      {row.count} cons.
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {revenueData.byTreatment.length === 0 && revenueData.confirmedCents === 0 && revenueData.potentialCents === 0 && (
            <p style={{ fontSize: "13px", color: "var(--muted)", textAlign: "center", padding: "8px 0" }}>
              Nenhum agendamento com valor registrado neste período.
              <br />
              <small>Cadastre preços nos procedimentos e marque consultas como realizadas para ver o pipeline.</small>
            </p>
          )}
        </section>
      )}

      {/* ── Prioridades Operacionais ──────────────────────────────────────── */}
      {(todayApptCount > 0 || recoveryLeadCount > 0 || attentionLeadCount > 0) && (
        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: "14px",
          }}
        >
          {/* Consultas de hoje */}
          {todayApptCount > 0 && (
            <div style={{ border: "1px solid var(--line)", borderRadius: 12, background: "var(--surface-soft)", padding: "16px 18px" }}>
              <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--muted)", margin: "0 0 10px" }}>
                Consultas de Hoje
              </p>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                {data.todayAppointments.map((appt) => {
                  const statusColors: Record<string, string> = { scheduled: "var(--muted)", confirmed: "var(--accent-strong)", completed: "var(--success, #22c55e)" };
                  const dot = statusColors[appt.status] ?? "var(--muted)";
                  return (
                    <li key={appt.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot, flexShrink: 0 }} />
                      <span style={{ fontWeight: 600, color: "var(--text)", minWidth: 42, flexShrink: 0 }}>
                        {formatTime(appt.startsAt)}
                      </span>
                      <span style={{ color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {appt.leadName ?? appt.leadPhone ?? "Paciente"}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <Link href="/app/agenda" style={{ fontSize: 11, color: "var(--accent-strong)", textDecoration: "none", display: "block", marginTop: 10, fontWeight: 600 }}>
                Ver agenda completa →
              </Link>
            </div>
          )}

          {/* Recuperação prioritária */}
          {recoveryLeadCount > 0 && (
            <div style={{ border: "1px solid var(--line)", borderRadius: 12, background: "var(--surface-soft)", padding: "16px 18px" }}>
              <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--muted)", margin: "0 0 10px" }}>
                Recuperação Prioritária
              </p>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                {data.recoveryLeads.map((lead) => (
                  <li key={lead.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                    <RefreshCw size={12} color="var(--warm, #f59e0b)" style={{ flexShrink: 0 }} />
                    <span style={{ color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>
                      {lead.name ?? lead.phone ?? "Lead"}
                    </span>
                    {lead.treatmentInterest && (
                      <span style={{ fontSize: 11, color: "var(--muted)", flexShrink: 0, maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {lead.treatmentInterest}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <Link href="/app/inbox?filter=recovery" style={{ fontSize: 11, color: "var(--muted)", textDecoration: "none", display: "block", marginTop: 10, fontWeight: 600 }}>
                Ver fila de recuperação →
              </Link>
            </div>
          )}

          {/* Intervenção humana */}
          {attentionLeadCount > 0 && (
            <div style={{ border: "1px solid color-mix(in srgb, var(--danger, #fb7185) 35%, var(--line))", borderRadius: 12, background: "var(--surface-soft)", padding: "16px 18px" }}>
              <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--muted)", margin: "0 0 10px" }}>
                Intervenção Humana
              </p>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                {data.attentionLeads.map((lead) => (
                  <li key={lead.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                    <AlertTriangle size={12} color="var(--danger, #fb7185)" style={{ flexShrink: 0 }} />
                    <span style={{ color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>
                      {lead.name ?? lead.phone ?? "Lead"}
                    </span>
                    {lead.treatmentInterest && (
                      <span style={{ fontSize: 11, color: "var(--muted)", flexShrink: 0, maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {lead.treatmentInterest}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <Link href="/app/inbox?filter=attention" style={{ fontSize: 11, color: "var(--danger, #fb7185)", textDecoration: "none", display: "block", marginTop: 10, fontWeight: 600 }}>
                Abrir atendimentos críticos →
              </Link>
            </div>
          )}
        </section>
      )}

      <main className="dashboard-grid">
        <section className="dashboard-panel dashboard-flow-panel">
          <div className="dashboard-panel-header">
            <div>
              <p className="dashboard-panel-kicker">Performance</p>
              <h2>Fluxo de Conversas</h2>
            </div>
            <Suspense fallback={<span className="dashboard-panel-badge"><Activity size={14} />7 dias</span>}>
              <DashboardPeriodToggle current={safePeriod as PeriodKey} />
            </Suspense>
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
              <line x1="18" x2="622" y1="16" y2="16" className="dashboard-chart-gridline" />
              <line x1="18" x2="622" y1="49" y2="49" className="dashboard-chart-gridline" />
              <line x1="18" x2="622" y1="82" y2="82" className="dashboard-chart-gridline" />
              <line x1="18" x2="622" y1="114" y2="114" className="dashboard-chart-gridline" />
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
              {data.flowSeries
                .filter((_, i, arr) => {
                  if (arr.length <= 7) return true;
                  const step = Math.floor((arr.length - 1) / 6);
                  return i % step === 0;
                })
                .map((point) => (
                  <span key={`${point.label}-${point.count}`}>
                    <strong>{point.count}</strong>
                    {point.label}
                  </span>
                ))}
            </div>
          </div>

          <DashboardRingMetrics
            automationRate={automationRate}
            afterHoursCount={data.afterHoursCount}
            scheduledCount={data.scheduledCount}
          />
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
            <div className="dashboard-leads-list">
              {data.recentLeads.map((lead) => (
                <Link
                  key={lead.id}
                  href={`/app/inbox/${lead.convId}`}
                  className="dashboard-lead-row"
                  style={{ textDecoration: "none" }}
                >
                  <div className={`dashboard-avatar-temp ${temperatureClass(lead.temperature)}`}>
                    {nameInitial(lead.name, lead.phone)}
                  </div>
                  <div className="dashboard-lead-info">
                    <strong>{lead.name ?? "Sem nome"}</strong>
                    <span>{channelLabel(lead.channel)}</span>
                  </div>
                  <span className={`dashboard-status-pill ${statusTone(lead.status)}`}>
                    {statusLabel(lead.status)}
                  </span>
                  <span className={`temp-badge ${temperatureClass(lead.temperature)}`}>
                    {temperatureLabel(lead.temperature)}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", flexShrink: 0 }}>
                    {relativeTime(lead.createdAt)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="dashboard-panel dashboard-temp-panel">
          <div className="dashboard-panel-header compact">
            <div>
              <p className="dashboard-panel-kicker">Saúde do funil · leads ativos</p>
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
