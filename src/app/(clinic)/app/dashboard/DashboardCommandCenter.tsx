import type { CSSProperties, ElementType } from "react";
import { Suspense } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  CalendarDays,
  CheckCircle2,
  Clock3,
  DollarSign,
  Flame,
  Handshake,
  MessageCircle,
  RefreshCw,
  Send,
  TrendingUp,
  Users,
  WalletCards,
  Zap,
} from "lucide-react";
import { MobileDashboardAvatar } from "@/components/mobile-dashboard-avatar";
import { DashboardPeriodToggle, type PeriodKey } from "./DashboardPeriodToggle";

const DASHBOARD_TZ = "America/Sao_Paulo";
const MINUTES_SAVED_PER_AGENT_REPLY = 2;
type DateLike = Date | string | number;

export type FlowPoint = {
  label: string;
  count: number;
};

export type ByTreatmentRow = {
  treatmentName: string;
  total: number;
  count: number;
};

export type RevenueData = {
  potentialCents: number;
  potentialCount: number;
  confirmedCents: number;
  confirmedCount: number;
  byTreatment: ByTreatmentRow[];
  monthlyRevenueBrl: number;
};

export type DashboardRecentLead = {
  id: string;
  convId: string;
  name: string | null;
  phone: string | null;
  profilePicUrl: string | null;
  channel: string;
  status: string;
  temperature: string | null;
  treatmentInterest: string | null;
  summary: string | null;
  needsAttention: boolean;
  aiPaused: boolean;
  lastMessage: string | null;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type DashboardHotLead = {
  id: string;
  convId: string;
  name: string | null;
  phone: string | null;
  profilePicUrl: string | null;
  status: string;
  temperature: string | null;
  treatmentInterest: string | null;
  updatedAt: Date;
};

export type DashboardTreatmentValue = {
  name: string;
  priceCents: number | null;
  minPriceCents: number | null;
  maxPriceCents: number | null;
};

export type DashboardAppointment = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
  leadName: string | null;
  leadPhone: string | null;
};

export type DashboardActionLead = {
  id: string;
  name: string | null;
  phone: string | null;
  treatmentInterest: string | null;
  status: string;
  updatedAt: Date;
};

export type DashboardData = {
  totalLeads: number;
  activeLeads: number;
  scheduledCount: number;
  activeHotCount: number;
  afterHoursCount: number;
  totalConversations: number;
  needsAttentionCount: number;
  agentMessageCount: number;
  currentPeriodLeadCount: number;
  previousPeriodLeadCount: number;
  recentLeads: DashboardRecentLead[];
  hotLeads: DashboardHotLead[];
  treatmentCatalog: DashboardTreatmentValue[];
  flowSeries: FlowPoint[];
  tempCounts: {
    hot: number;
    warm: number;
    cold: number;
  };
  statusCounts: Record<string, number>;
  userEmail: string;
  avatarUrl: string | null;
  clinicName: string;
  responsibleDoctorName: string | null;
  autoReplyEnabled: boolean;
  todayAppointments: DashboardAppointment[];
  upcomingAppointments: DashboardAppointment[];
  recoveryLeads: DashboardActionLead[];
  attentionLeads: DashboardActionLead[];
};

type Props = {
  data: DashboardData;
  revenueData: RevenueData | null;
  safePeriod: PeriodKey;
  showRevenue: boolean;
  showRoi: boolean;
  ownRevenueOnly: boolean;
};

type MetricCardProps = {
  title: string;
  value: string;
  context: string;
  trend: string;
  tone?: "positive" | "neutral" | "warning" | "muted";
  Icon: ElementType;
};

function toDate(value: DateLike): Date {
  return value instanceof Date ? value : new Date(value);
}

function timeValue(value: DateLike): number {
  const date = toDate(value);
  const time = date.getTime();
  return Number.isNaN(time) ? 0 : time;
}

function formatTime(value: DateLike): string {
  return toDate(value).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: DASHBOARD_TZ,
  });
}

function localDateKey(value: DateLike): string {
  return toDate(value).toLocaleDateString("en-CA", { timeZone: DASHBOARD_TZ });
}

function appointmentDateLabel(value: DateLike): string {
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);

  const valueKey = localDateKey(value);
  if (valueKey === localDateKey(today)) return "Hoje";
  if (valueKey === localDateKey(tomorrow)) return "Amanhã";

  return toDate(value).toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    timeZone: DASHBOARD_TZ,
  });
}

function appointmentStatusLabel(status: string): string {
  const map: Record<string, string> = {
    scheduled: "Marcado",
    confirmed: "Confirmado",
    completed: "Concluído",
    no_show: "Faltou",
  };
  return map[status] ?? status;
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

function getGreetingByTime(): string {
  const hour = Number(new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    hour12: false,
    timeZone: DASHBOARD_TZ,
  }).format(new Date()));

  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

function formatDoctorDisplayName(name: string | null): string | null {
  const clean = name?.trim().replace(/\s+/g, " ");
  if (!clean) return null;

  const parts = clean.split(" ");
  const titleToken = parts[0]?.replace(/\./g, "");
  const hasTitle = /^(dr|dra)$/i.test(titleToken ?? "");
  const title = /^dra$/i.test(titleToken ?? "") ? "Dra." : "Dr.";
  const givenName = hasTitle ? parts[1] : parts[0];

  if (!givenName) return hasTitle ? title : null;
  return `${title} ${givenName.replace(/[,.]/g, "")}`;
}

function greetingText(doctorName: string | null): string {
  const doctorDisplayName = formatDoctorDisplayName(doctorName);
  const greeting = getGreetingByTime();
  return doctorDisplayName ? `${greeting}, ${doctorDisplayName} 👋` : `${greeting} 👋`;
}

function greetingInitial(doctorName: string | null): string {
  const doctorDisplayName = formatDoctorDisplayName(doctorName);
  const withoutTitle = doctorDisplayName?.replace(/^Dra?\.\s+/i, "").trim();
  return Array.from(withoutTitle ?? "")[0]?.toUpperCase() ?? "?";
}

function clinicDisplayName(name: string): string {
  const clean = name.trim();
  return clean.length > 0 ? clean : "sua clínica";
}

function relativeTime(value: DateLike): string {
  const date = toDate(value);
  const timestamp = date.getTime();
  if (Number.isNaN(timestamp)) return "agora";

  const now = Date.now();
  const diff = Math.max(0, now - timestamp);
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

function statusLabel(status: string, needsAttention = false): string {
  if (needsAttention) return "Requer humano";

  const map: Record<string, string> = {
    new: "Novo",
    waiting_response: "Aguardando",
    in_conversation: "Em conversa",
    follow_up_due: "Recuperado",
    appointment_scheduled: "Agendado",
    lost: "Perdido",
    won: "Ganho",
  };
  return map[status] ?? status;
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

function nameInitial(name: string | null, phone: string | null): string {
  if (name && name.trim().length > 0) return Array.from(name.trim())[0]?.toUpperCase() ?? "?";
  if (phone && phone.trim().length > 0) return Array.from(phone.trim())[0] ?? "?";
  return "?";
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 1,
  }).format(value);
}

function formatBRL(cents: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(cents / 100);
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

function trendTone(current: number, previous: number): MetricCardProps["tone"] {
  if (previous === 0) return current > 0 ? "positive" : "neutral";
  if (current > previous) return "positive";
  if (current < previous) return "warning";
  return "neutral";
}

function periodLabel(period: PeriodKey): string {
  if (period === "30d") return "30 dias";
  if (period === "3m") return "3 meses";
  return "7 dias";
}

function leadDisplayName(lead: { name: string | null; phone: string | null }): string {
  return lead.name ?? lead.phone ?? "Lead sem nome";
}

function normalize(value: string): string {
  return value
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function estimateTreatmentValue(
  treatmentInterest: string | null,
  catalog: DashboardTreatmentValue[],
): number | null {
  if (!treatmentInterest) return null;
  const interest = normalize(treatmentInterest);
  const treatment = catalog.find((item) => {
    const name = normalize(item.name);
    return interest.includes(name) || name.includes(interest);
  });

  if (!treatment) return null;
  return treatment.priceCents ?? treatment.minPriceCents ?? treatment.maxPriceCents ?? null;
}

function leadScore(temperature: string | null, status: string, needsAttention = false): number {
  const base = temperature === "hot" ? 88 : temperature === "warm" ? 72 : temperature === "cold" ? 48 : 58;
  const statusBoost: Record<string, number> = {
    in_conversation: 6,
    appointment_scheduled: 10,
    waiting_response: 2,
    follow_up_due: -4,
    won: 12,
  };
  const attentionPenalty = needsAttention ? -8 : 0;
  return Math.max(1, Math.min(99, base + (statusBoost[status] ?? 0) + attentionPenalty));
}

function lastMessageLabel(lead: DashboardRecentLead): string {
  return lead.lastMessage ?? lead.summary ?? lead.treatmentInterest ?? channelLabel(lead.channel);
}

function summarizeText(value: string, maxLength = 112): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 1).trimEnd()}…`;
}

function conversationMeta(lead: DashboardRecentLead): string {
  return [
    relativeTime(lead.lastMessageAt ?? lead.updatedAt),
    statusLabel(lead.status, lead.needsAttention),
    temperatureLabel(lead.temperature),
  ].join(" · ");
}

function conversionRate(data: DashboardData): number {
  return data.totalLeads > 0 ? (data.scheduledCount / data.totalLeads) * 100 : 0;
}

function automationRate(data: DashboardData): number {
  return data.totalConversations > 0
    ? ((data.totalConversations - data.needsAttentionCount) / data.totalConversations) * 100
    : 0;
}

function roiMultiplier(revenueData: RevenueData | null): number | null {
  if (!revenueData || revenueData.monthlyRevenueBrl <= 0) return null;
  return revenueData.confirmedCents / revenueData.monthlyRevenueBrl;
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function countLabel(value: number, singular: string, plural: string): string {
  return `${compactNumber(value)} ${value === 1 ? singular : plural}`;
}

function buildRevenueStages(data: DashboardData) {
  const won = data.statusCounts.won ?? 0;
  const total = data.totalLeads;
  const qualified = Math.min(total, data.tempCounts.hot + data.tempCounts.warm + data.scheduledCount + won);
  const proposals = Math.min(qualified, data.scheduledCount + data.activeHotCount + won);
  const negotiation = Math.min(proposals, data.activeHotCount + won);
  const closed = Math.min(negotiation, data.scheduledCount + won);

  return [
    { label: "Novos Leads", value: total },
    { label: "Qualificados", value: qualified },
    { label: "Propostas", value: proposals },
    { label: "Negociação", value: negotiation },
    { label: "Fechados", value: closed },
  ];
}

function buildRecentActivities(data: DashboardData) {
  const leadActivities = data.recentLeads.slice(0, 3).map((lead) => ({
    key: `lead-${lead.id}`,
    Icon: MessageCircle,
    title: "Novo lead recebido",
    detail: leadDisplayName(lead),
    context: channelLabel(lead.channel),
    time: lead.lastMessageAt ?? lead.createdAt,
    tone: "accent",
  }));

  const appointmentActivities = data.todayAppointments.slice(0, 2).map((appointment) => ({
    key: `appointment-${appointment.id}`,
    Icon: CalendarDays,
    title: "Agendamento confirmado",
    detail: appointment.leadName ?? appointment.leadPhone ?? "Paciente",
    context: "Agenda",
    time: appointment.startsAt,
    tone: "accent",
  }));

  const attentionActivities = data.attentionLeads.slice(0, 1).map((lead) => ({
    key: `attention-${lead.id}`,
    Icon: AlertTriangle,
    title: "IA solicitou intervenção humana",
    detail: leadDisplayName(lead),
    context: "Inbox",
    time: lead.updatedAt,
    tone: "warning",
  }));

  return [...leadActivities, ...appointmentActivities, ...attentionActivities]
    .sort((a, b) => timeValue(b.time) - timeValue(a.time))
    .slice(0, 5);
}

function MetricCard({ title, value, context, trend, tone = "neutral", Icon }: MetricCardProps) {
  return (
    <article className="command-metric-card">
      <div className="command-metric-topline">
        <span>{title}</span>
        <span className={`command-metric-icon ${tone}`}>
          <Icon size={17} />
        </span>
      </div>
      <strong>{value}</strong>
      <div className="command-metric-footer">
        <span className={`command-trend ${tone}`}>{trend}</span>
        <small>{context}</small>
      </div>
    </article>
  );
}

function ScoreRing({ score }: { score: number }) {
  return (
    <span
      className="command-score-ring"
      style={{ "--score": `${score}%` } as CSSProperties}
      aria-label={`Score ${score}`}
    >
      <small>Score</small>
      <strong>{score}</strong>
    </span>
  );
}

function LeadAvatar({
  name,
  phone,
  imageUrl,
  className = "",
}: {
  name: string | null;
  phone: string | null;
  imageUrl: string | null;
  className?: string;
}) {
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img className={`command-avatar ${className}`} src={imageUrl} alt="" />
    );
  }

  return (
    <span className={`command-avatar ${className}`} aria-hidden="true">
      {nameInitial(name, phone)}
    </span>
  );
}

function DashboardHeader({
  data,
  safePeriod,
}: {
  data: DashboardData;
  safePeriod: PeriodKey;
}) {
  const greeting = greetingText(data.responsibleDoctorName);
  const avatarInitial = greetingInitial(data.responsibleDoctorName);
  const clinicLabel = clinicDisplayName(data.clinicName);

  return (
    <>
      <section className="command-mobile-hero" aria-label="Resumo do dashboard">
        <div className="command-mobile-header">
          <div>
            <span>SystemOps</span>
            <strong>{greeting}</strong>
          </div>
          <MobileDashboardAvatar
            avatarUrl={data.avatarUrl}
            initial={avatarInitial}
          />
        </div>

        <p className="command-mobile-subtitle">
          Aqui está o desempenho comercial da {clinicLabel} hoje.
        </p>

        <div className="command-mobile-pills">
          <span className={`command-status-pill ${data.autoReplyEnabled ? "active" : "muted"}`}>
            <Bot size={15} />
            {data.autoReplyEnabled ? "IA ativa" : "IA pausada"}
          </span>
          {data.needsAttentionCount > 0 ? (
            <Link href="/app/inbox?filter=attention" className="command-status-pill warning">
              <AlertTriangle size={15} />
              {data.needsAttentionCount} {data.needsAttentionCount === 1 ? "intervenção" : "intervenções"}
            </Link>
          ) : (
            <span className="command-status-pill active">
              <CheckCircle2 size={15} />
              Operação em dia
            </span>
          )}
        </div>

        <div className="command-mobile-toolbar">
          <span className="command-date-pill">
            <CalendarDays size={15} />
            {todayFormatted()}
          </span>
          <Suspense fallback={<span className="command-period-fallback">{periodLabel(safePeriod)}</span>}>
            <DashboardPeriodToggle current={safePeriod} />
          </Suspense>
        </div>
      </section>

      <header className="command-dashboard-header">
        <div className="command-dashboard-title">
          <h1>{greeting}</h1>
          <p>Aqui está o desempenho comercial da {clinicLabel} hoje.</p>
        </div>

        <div className="command-dashboard-actions">
          <span className={`command-status-pill ${data.autoReplyEnabled ? "active" : "muted"}`}>
            <Bot size={15} />
            {data.autoReplyEnabled ? "IA ativa" : "IA pausada"}
          </span>
          {data.needsAttentionCount > 0 ? (
            <Link href="/app/inbox?filter=attention" className="command-status-pill warning">
              <AlertTriangle size={15} />
              {data.needsAttentionCount} {data.needsAttentionCount === 1 ? "intervenção" : "intervenções"}
            </Link>
          ) : (
            <span className="command-status-pill active">
              <CheckCircle2 size={15} />
              Operação em dia
            </span>
          )}
          <span className="command-date-pill">
            <CalendarDays size={15} />
            {todayFormatted()}
          </span>
          <Suspense fallback={<span className="command-period-fallback">{periodLabel(safePeriod)}</span>}>
            <DashboardPeriodToggle current={safePeriod} />
          </Suspense>
        </div>
      </header>
    </>
  );
}

function HumanInterventionAlert({ data }: { data: DashboardData }) {
  if (data.needsAttentionCount === 0) return null;

  return (
    <section className="command-attention-alert" aria-label="Intervenção humana">
      <div>
        <span>
          <AlertTriangle size={15} />
          Atenção humana
        </span>
        <strong>
          {data.needsAttentionCount} conversa{data.needsAttentionCount !== 1 ? "s" : ""} precisa
          {data.needsAttentionCount === 1 ? "" : "m"} de decisão da equipe
        </strong>
      </div>
      <div className="command-attention-actions">
        <Link href="/app/inbox?filter=attention">Resolver agora</Link>
        <Link href="/app/inbox">Ver inbox</Link>
      </div>
    </section>
  );
}

function SecondaryMetrics({ data }: { data: DashboardData }) {
  const autoRate = automationRate(data);
  const saved = data.agentMessageCount * MINUTES_SAVED_PER_AGENT_REPLY;

  return (
    <section className="command-secondary-strip" aria-label="Métricas secundárias">
      <div>
        <Activity size={16} />
        <span>Autonomia IA</span>
        <strong>{formatPercent(autoRate)}%</strong>
      </div>
      <div>
        <Clock3 size={16} />
        <span>Fora do horário</span>
        <strong>{data.afterHoursCount}</strong>
      </div>
      <div>
        <RefreshCw size={16} />
        <span>Recuperação</span>
        <strong>{data.recoveryLeads.length}</strong>
      </div>
      <div>
        <Zap size={16} />
        <span>Tempo economizado</span>
        <strong>{formatTimeSaved(saved)}</strong>
      </div>
    </section>
  );
}

function RevenueSummary({
  data,
  revenueData,
}: {
  data: DashboardData;
  revenueData: RevenueData | null;
}) {
  return (
    <section className="command-revenue-summary" aria-label="Resumo de receita e agenda">
      <div>
        <WalletCards size={16} />
        <span>Confirmado</span>
        <strong>{revenueData ? formatBRL(revenueData.confirmedCents) : "Restrito"}</strong>
      </div>
      <div>
        <Handshake size={16} />
        <span>Potencial</span>
        <strong>{revenueData ? formatBRL(revenueData.potentialCents) : "Restrito"}</strong>
      </div>
      <div>
        <Send size={16} />
        <span>Propostas</span>
        <strong>{compactNumber(buildRevenueStages(data)[2]?.value ?? 0)}</strong>
      </div>
      <div>
        <MessageCircle size={16} />
        <span>Conversas</span>
        <strong>{compactNumber(data.totalConversations)}</strong>
      </div>
    </section>
  );
}

function UpcomingAppointments({ appointments }: { appointments: DashboardAppointment[] }) {
  return (
    <section className="command-upcoming-panel" aria-label="Próximos agendamentos">
      <div className="command-upcoming-header">
        <span>
          <CalendarDays size={16} />
          Próximos agendamentos
        </span>
        <Link href="/app/agenda">Ver agenda</Link>
      </div>

      {appointments.length === 0 ? (
        <div className="command-upcoming-empty">Nenhum horário futuro marcado.</div>
      ) : (
        <div className="command-upcoming-list">
          {appointments.slice(0, 4).map((appointment) => (
            <Link key={appointment.id} href="/app/agenda" className="command-upcoming-item">
              <span className="command-upcoming-time">{formatTime(appointment.startsAt)}</span>
              <div>
                <strong>{appointment.leadName ?? appointment.leadPhone ?? "Paciente"}</strong>
                <small>
                  {appointmentDateLabel(appointment.startsAt)} · {appointmentStatusLabel(appointment.status)}
                </small>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function ConversationList({ leads }: { leads: DashboardRecentLead[] }) {
  return (
    <section className="command-panel command-conversations-panel">
      <div className="command-panel-header">
        <div>
          <span>Conversas</span>
          <h2>Inbox resumido</h2>
        </div>
        <Link href="/app/inbox" className="command-icon-link" aria-label="Ver todas as conversas">
          <ArrowRight size={16} />
        </Link>
      </div>

      {leads.length === 0 ? (
        <div className="command-empty">Nenhuma conversa registrada ainda.</div>
      ) : (
        <div className="command-conversation-list">
          {leads.slice(0, 6).map((lead) => (
            <Link key={lead.id} href={`/app/inbox/${lead.convId}`} className="command-conversation-row">
              <LeadAvatar
                name={lead.name}
                phone={lead.phone}
                imageUrl={lead.profilePicUrl}
                className={temperatureClass(lead.temperature)}
              />
              <div className="command-conversation-copy">
                <strong>{leadDisplayName(lead)}</strong>
                <p>{summarizeText(lastMessageLabel(lead), 92)}</p>
                <small className={`command-conversation-meta ${temperatureClass(lead.temperature)}`}>
                  {conversationMeta(lead)}
                </small>
              </div>
            </Link>
          ))}
        </div>
      )}

      <Link href="/app/inbox" className="command-panel-footer">
        Ver todas as conversas
      </Link>
    </section>
  );
}

function RevenueFunnel({
  data,
  revenueData,
  safePeriod,
}: {
  data: DashboardData;
  revenueData: RevenueData | null;
  safePeriod: PeriodKey;
}) {
  const stages = buildRevenueStages(data);
  const max = Math.max(stages[0]?.value ?? 0, 1);
  const totalPipeline = revenueData ? revenueData.potentialCents + revenueData.confirmedCents : 0;

  return (
    <section className="command-panel command-funnel-panel">
      <div className="command-panel-header">
        <div>
          <span>Funil de novas receitas</span>
          <h2>{totalPipeline > 0 ? formatBRL(totalPipeline) : "Pipeline comercial"}</h2>
        </div>
        <span className="command-mini-pill">{periodLabel(safePeriod)}</span>
      </div>

      <div className="command-funnel">
        {stages.map((stage, index) => {
          const percent = max > 0 ? (stage.value / max) * 100 : 0;
          const visualWidth = Math.max(48, 100 - index * 10);
          return (
            <div key={stage.label} className="command-funnel-line">
              <div
                className="command-funnel-stage"
                style={{ "--stage-width": `${visualWidth}%` } as CSSProperties}
              >
                <span>{stage.label}</span>
                <strong>{compactNumber(stage.value)}</strong>
              </div>
              <small>{formatPercent(percent)}%</small>
            </div>
          );
        })}
      </div>

      <div className="command-funnel-footer">
        <span>Taxa de conversão geral</span>
        <strong>{formatPercent(conversionRate(data))}%</strong>
      </div>
    </section>
  );
}

function HotLeadsCard({
  leads,
  treatmentCatalog,
}: {
  leads: DashboardHotLead[];
  treatmentCatalog: DashboardTreatmentValue[];
}) {
  return (
    <section className="command-panel command-hotleads-panel">
      <div className="command-panel-header">
        <div>
          <span>Hot leads</span>
          <h2>Hot leads para agir agora</h2>
        </div>
        <Flame size={18} className="command-hot-icon" />
      </div>

      {leads.length === 0 ? (
        <div className="command-empty">Nenhum lead quente ativo agora.</div>
      ) : (
        <div className="command-hotlead-list">
          {leads.slice(0, 5).map((lead) => {
            const score = leadScore(lead.temperature, lead.status);
            const estimatedValue = estimateTreatmentValue(lead.treatmentInterest, treatmentCatalog);
            const treatmentLabel = lead.treatmentInterest ?? "Interesse a qualificar";
            const valueLabel = estimatedValue ? `${formatBRL(estimatedValue)} estimado` : "Valor pendente";

            return (
              <Link key={lead.id} href={`/app/inbox/${lead.convId}`} className="command-hotlead-row">
                <LeadAvatar
                  name={lead.name}
                  phone={lead.phone}
                  imageUrl={lead.profilePicUrl}
                  className={temperatureClass(lead.temperature)}
                />
                <div className="command-hotlead-copy">
                  <strong>{leadDisplayName(lead)}</strong>
                  <span>{treatmentLabel} · {valueLabel}</span>
                  <small>
                    {relativeTime(lead.updatedAt)} · {statusLabel(lead.status)}
                  </small>
                </div>
                <ScoreRing score={score} />
              </Link>
            );
          })}
        </div>
      )}

      <Link href="/app/inbox?temperature=hot" className="command-panel-footer">
        Ver todos os leads
      </Link>
    </section>
  );
}

function RecentActivity({ data }: { data: DashboardData }) {
  const activities = buildRecentActivities(data);

  return (
    <section className="command-activity-panel" aria-label="Atividades recentes">
      <div className="command-activity-header">
        <span>
          <Activity size={16} />
          Atividades recentes
        </span>
        <Link href="/app/inbox">Abrir operação</Link>
      </div>

      {activities.length === 0 ? (
        <div className="command-empty">A operação ainda não registrou atividade recente.</div>
      ) : (
        <div className="command-activity-list">
          {activities.map(({ key, Icon, title, detail, context, time, tone }) => (
            <div key={key} className="command-activity-item">
              <span className={`command-activity-icon ${tone}`}>
                <Icon size={16} />
              </span>
              <div>
                <strong>{title}</strong>
                <p>{detail} · {formatTime(time)}</p>
                <small>{context}</small>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function DashboardCommandCenter({
  data,
  revenueData,
  safePeriod,
  showRevenue,
  showRoi,
  ownRevenueOnly,
}: Props) {
  const pipelineCents = revenueData ? revenueData.potentialCents + revenueData.confirmedCents : 0;
  const roi = showRoi ? roiMultiplier(revenueData) : null;
  const leadTrend = trendLabel(data.currentPeriodLeadCount, data.previousPeriodLeadCount);
  const leadTone = trendTone(data.currentPeriodLeadCount, data.previousPeriodLeadCount);
  const totalAppointmentsToday = data.todayAppointments.length;
  const revenueOpportunityCount = (revenueData?.potentialCount ?? 0) + (revenueData?.confirmedCount ?? 0);

  return (
    <div className="command-dashboard-shell">
      <DashboardHeader data={data} safePeriod={safePeriod} />

      <section className="command-metric-grid" aria-label="Indicadores principais">
        <MetricCard
          title={ownRevenueOnly ? "Minha Receita em Pipeline" : "Receita em Pipeline"}
          value={showRevenue && revenueData ? formatBRL(pipelineCents) : "Restrito"}
          trend={revenueData ? countLabel(revenueOpportunityCount, "oportunidade", "oportunidades") : "financeiro"}
          context={showRevenue ? "potencial e confirmado" : "permissão necessária"}
          tone="positive"
          Icon={DollarSign}
        />
        <MetricCard
          title="ROI"
          value={roi !== null ? `${roi.toFixed(1)}x` : "Restrito"}
          trend={roi !== null ? "sobre mensalidade" : "financeiro"}
          context={roi !== null ? "Receita confirmada no período" : "permissão necessária"}
          tone={roi !== null && roi >= 1 ? "positive" : "neutral"}
          Icon={TrendingUp}
        />
        <MetricCard
          title="Leads Ativos"
          value={compactNumber(data.activeLeads)}
          trend={leadTrend}
          context={`vs. últimos ${periodLabel(safePeriod)}`}
          tone={leadTone}
          Icon={Users}
        />
        <MetricCard
          title="Agendamentos"
          value={compactNumber(data.scheduledCount)}
          trend={`Hoje: ${totalAppointmentsToday}`}
          context={`${formatPercent(conversionRate(data))}% de conversão`}
          tone={totalAppointmentsToday > 0 ? "positive" : "neutral"}
          Icon={CalendarDays}
        />
      </section>

      <RevenueSummary data={data} revenueData={revenueData} />
      <SecondaryMetrics data={data} />
      <UpcomingAppointments appointments={data.upcomingAppointments} />
      <HumanInterventionAlert data={data} />

      <main className="command-main-grid">
        <ConversationList leads={data.recentLeads} />
        <RevenueFunnel data={data} revenueData={revenueData} safePeriod={safePeriod} />
        <HotLeadsCard leads={data.hotLeads} treatmentCatalog={data.treatmentCatalog} />
      </main>

      <RecentActivity data={data} />
    </div>
  );
}
