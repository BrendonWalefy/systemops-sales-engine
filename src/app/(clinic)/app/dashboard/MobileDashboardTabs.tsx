"use client";

import { useState, Suspense } from "react";
import { OperationalInsightsCard } from "./OperationalInsightsCard";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Bot,
  CalendarDays,
  Flame,
  MessageCircle,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import { DashboardPeriodToggle, type PeriodKey } from "./DashboardPeriodToggle";

// ─── Data shapes (all pre-computed server-side) ───────────────────────────────

export type MobileActivityItem = {
  key: string;
  iconType: "message" | "calendar" | "alert";
  title: string;
  detail: string;
  context: string;
  timeLabel: string;
  tone: string;
};

export type MobileFunnelStage = {
  label: string;
  value: number;
  valueLabel: string;
  visualWidth: number;
};

export type MobileHotLeadItem = {
  id: string;
  convId: string;
  name: string;
  phone: string | null;
  initial: string;
  profilePicUrl: string | null;
  temperatureClass: string;
  treatmentLabel: string;
  valueLabel: string;
  timeLabel: string;
  statusLabel: string;
  score: number;
  isTopCard: boolean;
};

export type MobileRecoveryItem = {
  id: string;
  name: string;
  summaryLabel: string;
  timeLabel: string;
};

export type MobileSnapshotStat = {
  label: string;
  value: string;
  helper: string;
  tone: "accent" | "warning" | "neutral";
};

export type MobileSparkPoint = {
  label: string;
  value: number;
};

export type MobileAiInsight = {
  eyebrow: string;
  title: string;
  detail: string;
  action: string;
  baseLabel: string;
};

export type MobileTabsProps = {
  needsAttentionCount: number;
  nextAppointment: {
    time: string;
    dateLabel: string;
    patientName: string;
    statusLabel: string;
  } | null;
  activities: MobileActivityItem[];
  pipelineHero: string;
  confirmedRevenue: string | null;
  roi: string | null;
  conversionRate: string;
  safePeriod: PeriodKey;
  periodLabelText: string;
  funnelStages: MobileFunnelStage[];
  hotLeads: MobileHotLeadItem[];
  recoveryLeads: MobileRecoveryItem[];
  todayStats: MobileSnapshotStat[];
  pipelineStats: MobileSnapshotStat[];
  performanceSparkline: MobileSparkPoint[];
  performanceAiInsight: MobileAiInsight;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Tab = "hoje" | "leads" | "performance";

const TAB_LABELS: Record<Tab, string> = {
  hoje: "Hoje",
  leads: "Leads",
  performance: "Performance",
};

const ICON_MAP = {
  message: MessageCircle,
  calendar: CalendarDays,
  alert: AlertTriangle,
} as const;

function leadActionPlan(lead: MobileHotLeadItem) {
  if (lead.statusLabel === "Aguardando") {
    return {
      badge: "RETOMAR",
      action: "Puxar resposta e oferecer dois horarios",
      helper: "Lead quente parado aguardando retorno.",
    };
  }

  if (lead.score >= 88) {
    return {
      badge: "AGIR AGORA",
      action: "Levar direto para agenda",
      helper: "Ja demonstra intencao forte de marcar.",
    };
  }

  if (lead.score >= 76) {
    return {
      badge: "EM RISCO",
      action: "Fechar proximo passo da conversa",
      helper: "Bom lead, mas ainda com friccao comercial.",
    };
  }

  return {
    badge: "AQUECER",
    action: "Reforcar interesse e qualificar objeção",
    helper: "Precisa ganhar tracao antes da agenda.",
  };
}

function recoveryActionPlan(lead: MobileRecoveryItem) {
  return {
    badge: "REENGAJAR",
    action: "Retomar com contexto e CTA curto",
    helper: lead.summaryLabel,
  };
}

function leadPrioritySignal(lead: MobileHotLeadItem) {
  if (lead.statusLabel === "Aguardando") {
    return {
      label: "Retomar",
      tone: "warning" as const,
    };
  }

  if (lead.score >= 88) {
    return {
      label: "Agora",
      tone: "critical" as const,
    };
  }

  if (lead.score >= 76) {
    return {
      label: "Risco",
      tone: "warning" as const,
    };
  }

  return {
    label: "Aquecer",
    tone: "neutral" as const,
  };
}

function TodaySnapshotPanel({ stats }: { stats: MobileSnapshotStat[] }) {
  return (
    <section className="command-today-stats-panel">
      <div className="command-today-panel-heading">
        <span>Radar de hoje</span>
        <small>Visão rápida da operação que está no ar agora.</small>
      </div>
      <div className="command-mobile-snapshot-grid">
        {stats.map((stat) => (
          <article key={stat.label} className={`command-mobile-snapshot-card ${stat.tone}`}>
            <small>{stat.label}</small>
            <strong>{stat.value}</strong>
            <span>{stat.helper}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

function performanceBottleneck(funnelStages: MobileFunnelStage[]) {
  if (funnelStages.length < 2) {
    return {
      eyebrow: "Leitura do funil",
      title: "Ainda sem sinal claro",
      detail: "Ainda não há etapas suficientes para mostrar onde os leads estão parando.",
      action: "Sugestão: acompanhe mais conversas antes de mudar a operação.",
    };
  }

  let largestDrop = Number.NEGATIVE_INFINITY;
  let bottleneckIndex = 0;

  for (let index = 0; index < funnelStages.length - 1; index += 1) {
    const current = funnelStages[index];
    const next = funnelStages[index + 1];
    const drop = current.value - next.value;
    if (drop > largestDrop) {
      largestDrop = drop;
      bottleneckIndex = index;
    }
  }

  if (largestDrop <= 0) {
    return {
      eyebrow: "Leitura do funil",
      title: "Fluxo estável",
      detail: "Os leads estão avançando entre etapas sem queda relevante no momento.",
      action: "Sugestão: mantenha o processo atual e monitore volume e agenda.",
    };
  }

  const current = funnelStages[bottleneckIndex];
  const next = funnelStages[bottleneckIndex + 1];
  const stagePair = `${current.label}->${next.label}`;
  const actionByStage: Record<string, string> = {
    "Novos Leads->Qualificados": "Sugestão: revisar velocidade da primeira resposta e abertura da conversa.",
    "Qualificados->Propostas": "Sugestão: deixar preço, condição e próximo passo mais claros.",
    "Propostas->Negociação": "Sugestão: testar proposta mais curta com CTA direto para agenda.",
    "Negociação->Fechados": "Sugestão: oferecer dois horários prontos e fazer follow-up no mesmo dia.",
  };
  return {
    eyebrow: "Ponto de atenção",
    title: `${largestDrop} lead${largestDrop !== 1 ? "s" : ""} pararam entre ${current.label} e ${next.label}`,
    detail: "Essa é a principal queda do funil agora.",
    action: actionByStage[stagePair] ?? "Sugestão: revisar esse trecho da conversa e encurtar o próximo passo.",
  };
}

function TodayQuickActions() {
  return (
    <section className="command-mobile-quick-actions">
      <Link href="/app/inbox?filter=attention" className="command-mobile-action-card warning">
        <span>
          <AlertTriangle size={14} />
          Prioridades
        </span>
        <strong>Assumir conversas críticas</strong>
        <small>Entre primeiro nos casos que já dependem de decisão humana.</small>
      </Link>
      <Link href="/app/inbox?filter=hot" className="command-mobile-action-card">
        <span>
          <MessageCircle size={14} />
          Leads quentes
        </span>
        <strong>Ver quem está perto de marcar</strong>
        <small>Abra primeiro as conversas com maior chance de virar agenda.</small>
      </Link>
      <Link href="/app/inbox?filter=recovery" className="command-mobile-action-card recovery">
        <span>
          <RefreshCw size={14} />
          Recuperação
        </span>
        <strong>Retomar leads parados</strong>
        <small>Reengaje oportunidades que esfriaram antes da agenda.</small>
      </Link>
    </section>
  );
}

function buildSparklinePath(points: MobileSparkPoint[], width: number, height: number) {
  if (points.length === 0) return "";

  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  return points
    .map((point, index) => {
      const x = points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
      const y = height - ((point.value - min) / range) * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function buildSparklineArea(points: MobileSparkPoint[], width: number, height: number) {
  const line = buildSparklinePath(points, width, height);
  if (!line) return "";
  return `${line} L ${width} ${height} L 0 ${height} Z`;
}

function PerformanceSparkline({ points }: { points: MobileSparkPoint[] }) {
  if (points.length === 0) return null;

  const width = 280;
  const height = 68;
  const linePath = buildSparklinePath(points, width, height);
  const areaPath = buildSparklineArea(points, width, height);

  return (
    <div className="command-performance-sparkline">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="command-performance-sparkline-chart"
        aria-label="Tendência do período"
        role="img"
      >
        <defs>
          <linearGradient id="commandPerformanceArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(52, 211, 153, 0.36)" />
            <stop offset="100%" stopColor="rgba(52, 211, 153, 0)" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#commandPerformanceArea)" />
        <path d={linePath} className="command-performance-sparkline-line" />
      </svg>
    </div>
  );
}

function HealthyOperationCallout() {
  return (
    <section className="command-healthy-callout">
      <div>
        <span>Tudo sob controle</span>
        <strong>Nenhuma conversa está pedindo ajuda humana agora.</strong>
        <small>A IA está sustentando a operação e o time pode agir só por prioridade.</small>
      </div>
      <Link href="/app/inbox">Abrir inbox</Link>
    </section>
  );
}

function LeadPriorityPill({ lead }: { lead: MobileHotLeadItem }) {
  const signal = leadPrioritySignal(lead);

  return (
    <span className={`command-lead-priority-pill ${signal.tone}`}>
      {signal.label}
    </span>
  );
}

function LeadInitial({
  initial,
  profilePicUrl,
  temperatureClass,
  size = "md",
}: {
  initial: string;
  profilePicUrl: string | null;
  temperatureClass: string;
  size?: "sm" | "md";
}) {
  const cls = `command-avatar${size === "sm" ? " command-avatar-sm" : ""} ${temperatureClass}`;
  if (profilePicUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={cls} src={profilePicUrl} alt="" />;
  }
  return <span className={cls}>{initial}</span>;
}

// ─── Tab: Hoje ────────────────────────────────────────────────────────────────

function TabHoje({
  needsAttentionCount,
  nextAppointment,
  activities,
  todayStats,
}: Pick<MobileTabsProps, "needsAttentionCount" | "nextAppointment" | "activities" | "todayStats">) {
  return (
    <div className="command-tab-content">
      {needsAttentionCount > 0 && (
        <section className="command-attention-alert">
          <div>
            <span>
              <AlertTriangle size={15} />
              Prioridade agora
            </span>
            <strong>
              {needsAttentionCount} conversa{needsAttentionCount !== 1 ? "s" : ""} precisa
              {needsAttentionCount !== 1 ? "m" : ""} de intervenção humana
            </strong>
            <small>Entre primeiro onde a IA já não consegue fechar o próximo passo sozinha.</small>
          </div>
          <div className="command-attention-actions">
            <Link href="/app/inbox?filter=attention">Resolver agora</Link>
            <Link href="/app/inbox">Inbox</Link>
          </div>
        </section>
      )}
      {needsAttentionCount === 0 && <HealthyOperationCallout />}

      <TodaySnapshotPanel stats={todayStats} />

      <section className="command-mobile-next-apt">
        <div className="command-mobile-section-header">
          <span>
            <CalendarDays size={14} />
            Próximo da agenda
          </span>
          <Link href="/app/agenda">Agenda</Link>
        </div>
        {!nextAppointment ? (
          <div className="command-mobile-apt-empty">Nenhum paciente próximo na agenda.</div>
        ) : (
          <Link href="/app/agenda" className="command-mobile-apt-item">
            <span className="command-upcoming-time">{nextAppointment.time}</span>
            <div>
              <strong>{nextAppointment.patientName}</strong>
              <small>
                {nextAppointment.dateLabel} · {nextAppointment.statusLabel}
              </small>
            </div>
          </Link>
        )}
      </section>

      <TodayQuickActions />

      {activities.length > 0 && (
        <section className="command-mobile-activities">
          <div className="command-mobile-section-header">
            <span>
              <Activity size={14} />
              Últimos movimentos
            </span>
          </div>
          <div className="command-mobile-activity-list">
            {activities.map(({ key, iconType, title, detail, context, timeLabel, tone }) => {
              const Icon = ICON_MAP[iconType];
              return (
                <div key={key} className="command-mobile-activity-row">
                  <span className={`command-activity-icon ${tone}`}>
                    <Icon size={15} />
                  </span>
                  <div>
                    <strong>{detail}</strong>
                    <small>
                      {title} · {context} · {timeLabel}
                    </small>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

// ─── Tab: Pipeline ────────────────────────────────────────────────────────────

function TabPerformance({
  pipelineHero,
  confirmedRevenue,
  roi,
  conversionRate,
  safePeriod,
  periodLabelText,
  funnelStages,
  pipelineStats,
  performanceSparkline,
  performanceAiInsight,
}: Pick<
  MobileTabsProps,
  | "pipelineHero"
  | "confirmedRevenue"
  | "roi"
  | "conversionRate"
  | "safePeriod"
  | "periodLabelText"
  | "funnelStages"
  | "pipelineStats"
  | "performanceSparkline"
  | "performanceAiInsight"
>) {
  const performanceAttention = performanceBottleneck(funnelStages);

  return (
    <div className="command-tab-content">
      <section className="command-pipeline-hero-card">
        <div className="command-performance-topbar">
          <div className="command-performance-heading">
            <small>Receita em pipeline</small>
          </div>
          <div className="command-performance-filter">
            <Suspense fallback={<span className="command-mini-pill">{periodLabelText}</span>}>
              <DashboardPeriodToggle current={safePeriod} />
            </Suspense>
          </div>
        </div>
        <strong className="command-pipeline-hero-value">{pipelineHero}</strong>
        <div className="command-pipeline-hero-meta">
          {roi && (
            <span className="command-metric-pill positive">
              <TrendingUp size={12} />
              ROI {roi}
            </span>
          )}
          <span className="command-metric-pill neutral">Conv. {conversionRate}</span>
        </div>
        <PerformanceSparkline points={performanceSparkline} />
      </section>

      <section className="command-performance-summary-grid">
        <article className="command-performance-summary-card">
          <small>Confirmado</small>
          <strong>{confirmedRevenue ?? "Restrito"}</strong>
        </article>
        <article className="command-performance-summary-card">
          <small>ROI</small>
          <strong>{roi ?? "–"}</strong>
        </article>
      </section>

      <section className="command-performance-stats-panel">
        <div className="command-performance-panel-heading">
          <span>Motor de crescimento</span>
          <small>Leitura rápida do comercial em andamento.</small>
        </div>
        <div className="command-mobile-snapshot-grid">
          {pipelineStats.map((stat) => (
            <article key={stat.label} className={`command-mobile-snapshot-card ${stat.tone}`}>
              <small>{stat.label}</small>
              <strong>{stat.value}</strong>
              <span>{stat.helper}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="command-mobile-funnel-bars">
        <div className="command-funnel-bars-header">
          <span className="command-funnel-bars-eyebrow">Funil</span>
        </div>
        <div className="command-funnel-bar-list">
          {funnelStages.map((stage) => (
            <div key={stage.label} className="command-funnel-bar-row">
              <span className="command-funnel-bar-label">{stage.label}</span>
              <div className="command-funnel-bar-track">
                <div
                  className="command-funnel-bar-fill"
                  style={{ width: `${stage.visualWidth}%` }}
                />
              </div>
              <span className="command-funnel-bar-count">{stage.valueLabel}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="command-performance-insight">
        <small>{performanceAttention.eyebrow}</small>
        <strong>{performanceAttention.title}</strong>
        <span>{performanceAttention.detail}</span>
        <p>{performanceAttention.action}</p>
      </section>

      <section className="command-performance-ai-card">
        <div className="command-performance-ai-heading">
          <span>
            <Bot size={13} />
            {performanceAiInsight.eyebrow}
          </span>
          <small>{performanceAiInsight.baseLabel}</small>
        </div>
        <strong>{performanceAiInsight.title}</strong>
        <span>{performanceAiInsight.detail}</span>
        <p>{performanceAiInsight.action}</p>
      </section>
    </div>
  );
}

// ─── Tab: Leads ───────────────────────────────────────────────────────────────

function TabLeads({
  hotLeads,
  recoveryLeads,
}: Pick<MobileTabsProps, "hotLeads" | "recoveryLeads">) {
  const nowCards = hotLeads.filter((l) => l.isTopCard);
  const watchRows = hotLeads.filter((l) => !l.isTopCard);
  const urgentCount = hotLeads.filter((lead) => lead.score >= 88 || lead.statusLabel === "Aguardando").length;
  const empty = hotLeads.length === 0 && recoveryLeads.length === 0;
  const topLead = hotLeads[0] ?? null;

  if (empty) {
    return (
      <div className="command-tab-content">
        <div className="command-leads-empty">
          <Flame size={28} />
          <p>Nenhum lead quente no momento.</p>
          <small>Os leads mais próximos de fechar aparecem aqui.</small>
        </div>
      </div>
    );
  }

  return (
    <div className="command-tab-content">
      <OperationalInsightsCard />
      <section className="command-mobile-leads-hero">
        <div>
          <span>Fila comercial</span>
          <strong>{hotLeads.length} leads na mesa de decisao</strong>
          <small>
            {topLead
              ? `Prioridade #1: ${topLead.name} · ${topLead.statusLabel}`
              : `${recoveryLeads.length} lead${recoveryLeads.length !== 1 ? "s" : ""} em recuperação`}
          </small>
        </div>
        <Flame size={20} />
      </section>

      <section className="command-leads-summary-strip">
        <article>
          <small>Agir agora</small>
          <strong>{urgentCount}</strong>
        </article>
        <article>
          <small>Em observacao</small>
          <strong>{Math.max(hotLeads.length - urgentCount, 0)}</strong>
        </article>
        <article>
          <small>Recuperação</small>
          <strong>{recoveryLeads.length}</strong>
        </article>
      </section>

      {hotLeads.length > 0 && (
        <section>
          <div className="command-mobile-section-header">
            <span>Agir agora</span>
            <Link href="/app/inbox?filter=hot">Todos</Link>
          </div>

          {nowCards.length > 0 && (
            <div className="command-hot-leads-grid">
              {nowCards.map((lead) => {
                const plan = leadActionPlan(lead);

                return (
                <div key={lead.id} className="command-hot-lead-card">
                  <div className="command-hot-lead-card-top">
                    <LeadInitial
                      initial={lead.initial}
                      profilePicUrl={lead.profilePicUrl}
                      temperatureClass={lead.temperatureClass}
                    />
                    <LeadPriorityPill lead={lead} />
                  </div>
                  <em className="command-lead-card-badge">{plan.badge}</em>
                  <strong>{lead.name}</strong>
                  <span>{lead.treatmentLabel}</span>
                  <p>{plan.action}</p>
                  <small>
                    {lead.timeLabel} · {lead.statusLabel}
                  </small>
                  <Link href={`/app/inbox/${lead.convId}`} className="command-open-conv-btn">
                    Abrir conversa
                  </Link>
                </div>
                );
              })}
            </div>
          )}

          {watchRows.length > 0 && (
            <>
              <div className="command-mobile-section-header command-mobile-subsection-header">
                <span>Em observacao</span>
              </div>
            <div className="command-leads-list-rows">
              {watchRows.map((lead) => {
                const plan = leadActionPlan(lead);

                return (
                <Link
                  key={lead.id}
                  href={`/app/inbox/${lead.convId}`}
                  className="command-lead-list-row"
                >
                  <LeadInitial
                    initial={lead.initial}
                    profilePicUrl={lead.profilePicUrl}
                    temperatureClass={lead.temperatureClass}
                    size="sm"
                  />
                  <div className="command-lead-list-copy">
                    <strong>{lead.name}</strong>
                    <span className="command-lead-list-action">{plan.action}</span>
                    <small>
                      {lead.timeLabel} · {lead.statusLabel}
                    </small>
                  </div>
                  <LeadPriorityPill lead={lead} />
                </Link>
                );
              })}
            </div>
            </>
          )}
        </section>
      )}

      {recoveryLeads.length > 0 && (
        <section>
          <div className="command-mobile-section-header">
            <span>Reengajar</span>
            <Link href="/app/inbox?filter=recovery">Ver tudo</Link>
          </div>
          <div className="command-recovery-rows">
            {recoveryLeads.map((lead) => {
              const plan = recoveryActionPlan(lead);

              return (
              <div key={lead.id} className="command-recovery-row">
                <div className="command-recovery-info">
                  <span className="command-recovery-badge">
                    <RefreshCw size={11} />
                    {plan.badge} · {lead.timeLabel}
                  </span>
                  <strong>{lead.name}</strong>
                  <span>{plan.helper}</span>
                  <small>{plan.action}</small>
                </div>
                <Link href="/app/inbox?filter=recovery" className="command-recovery-send-btn">
                  Enviar
                </Link>
              </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

// ─── Root export ──────────────────────────────────────────────────────────────

export function MobileDashboardTabs(props: MobileTabsProps) {
  const [activeTab, setActiveTab] = useState<Tab>("hoje");

  return (
    <div className="command-mobile-segmented">
      <div className="command-mobile-tab-bar" role="tablist">
        {(["hoje", "leads", "performance"] as Tab[]).map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={`command-tab-panel-${tab}`}
            className={`command-mobile-tab-btn${activeTab === tab ? " active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            <span>{TAB_LABELS[tab]}</span>
          </button>
        ))}
      </div>

      {activeTab === "hoje" && (
        <div id="command-tab-panel-hoje" role="tabpanel">
          <TabHoje
            needsAttentionCount={props.needsAttentionCount}
            nextAppointment={props.nextAppointment}
            activities={props.activities}
            todayStats={props.todayStats}
          />
        </div>
      )}
      {activeTab === "leads" && (
        <div id="command-tab-panel-leads" role="tabpanel">
          <TabLeads hotLeads={props.hotLeads} recoveryLeads={props.recoveryLeads} />
        </div>
      )}
      {activeTab === "performance" && (
        <div id="command-tab-panel-performance" role="tabpanel">
          <TabPerformance
            pipelineHero={props.pipelineHero}
            confirmedRevenue={props.confirmedRevenue}
            roi={props.roi}
            conversionRate={props.conversionRate}
            safePeriod={props.safePeriod}
            periodLabelText={props.periodLabelText}
            funnelStages={props.funnelStages}
            pipelineStats={props.pipelineStats}
            performanceSparkline={props.performanceSparkline}
            performanceAiInsight={props.performanceAiInsight}
          />
        </div>
      )}
    </div>
  );
}
