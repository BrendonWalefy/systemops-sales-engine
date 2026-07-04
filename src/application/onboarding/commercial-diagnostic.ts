import type { SegmentKey } from "./segment-options";
import { resolveSegmentDefaults } from "./segment-options";

/**
 * Motor de diagnóstico comercial — determinístico e config-driven.
 *
 * Regra da casa: "o sistema decide, a LLM verbaliza". Aqui NÃO há chamada de
 * LLM: diagnóstico, ROI e recomendação são matemática pura, calculados no
 * cliente em tempo real e reproduzíveis. A narrativa é montada por template
 * a partir do resultado — uma LLM pode reescrevê-la depois sem mudar os números.
 *
 * Modelo de ROI (conservador e defensável):
 *   leads não convertidos = max(0, leads - agendamentos)
 *   SystemOps recupera uma fração desses leads (recaptura), derivada dos sinais
 *   de dor e do tempo de resposta atual. Reportamos sempre uma FAIXA (baixo/alto)
 *   — nunca um número único — para não prometer o que não se entrega.
 */

// ─── Opções de diagnóstico (buckets com valor representativo) ───────────────

export type Bucket<T extends string> = {
  id: T;
  label: string;
  value: number;
};

export const LEADS_BUCKETS = [
  { id: "0-200", label: "0 – 200", value: 120 },
  { id: "200-400", label: "200 – 400", value: 300 },
  { id: "400-800", label: "400 – 800", value: 600 },
  { id: "800+", label: "800+", value: 1000 },
] as const satisfies readonly Bucket<string>[];

export const APPOINTMENTS_BUCKETS = [
  { id: "0-80", label: "0 – 80", value: 50 },
  { id: "80-120", label: "80 – 120", value: 100 },
  { id: "120-200", label: "120 – 200", value: 160 },
  { id: "200+", label: "200+", value: 240 },
] as const satisfies readonly Bucket<string>[];

export const TICKET_BUCKETS = [
  { id: "ate-350", label: "Até R$ 350", value: 300 },
  { id: "350-600", label: "R$ 350 – 600", value: 475 },
  { id: "600-1000", label: "R$ 600 – 1.000", value: 800 },
  { id: "acima-1000", label: "Acima de R$ 1.000", value: 1400 },
] as const satisfies readonly Bucket<string>[];

export const TEAM_BUCKETS = [
  { id: "1-2", label: "1 – 2 pessoas", value: 2 },
  { id: "3-5", label: "3 – 5 pessoas", value: 4 },
  { id: "6-10", label: "6 – 10 pessoas", value: 8 },
  { id: "10+", label: "Mais de 10", value: 14 },
] as const satisfies readonly Bucket<string>[];

export type LeadsBucketId = (typeof LEADS_BUCKETS)[number]["id"];
export type AppointmentsBucketId = (typeof APPOINTMENTS_BUCKETS)[number]["id"];
export type TicketBucketId = (typeof TICKET_BUCKETS)[number]["id"];
export type TeamBucketId = (typeof TEAM_BUCKETS)[number]["id"];

export const RESPONSE_TIME_OPTIONS = [
  { id: "under_1h", label: "Até 1h", risk: 0 },
  { id: "1_2h", label: "1 – 2h", risk: 1 },
  { id: "2_6h", label: "2 – 6h", risk: 2 },
  { id: "over_6h", label: "Mais de 6h", risk: 3 },
] as const;
export type ResponseTimeId = (typeof RESPONSE_TIME_OPTIONS)[number]["id"];

export const CHANNEL_OPTIONS = [
  { id: "whatsapp", label: "WhatsApp" },
  { id: "instagram", label: "Instagram" },
  { id: "google", label: "Google" },
  { id: "site", label: "Site" },
] as const;
export type ChannelId = (typeof CHANNEL_OPTIONS)[number]["id"];

export const SCHEDULE_OPTIONS = [
  { id: "internal", label: "Agenda interna" },
  { id: "google_calendar", label: "Google Calendar" },
] as const;
export type ScheduleId = (typeof SCHEDULE_OPTIONS)[number]["id"];

export const PAIN_OPTIONS = [
  {
    id: "slow_reply",
    label: "Responde devagar",
    // recaptura extra que resolver esse ponto destrava
    recaptureLow: 0.03,
    recaptureHigh: 0.05,
  },
  {
    id: "after_hours",
    label: "Perde leads fora do horário",
    recaptureLow: 0.04,
    recaptureHigh: 0.06,
  },
  {
    id: "no_organization",
    label: "Sem organização",
    recaptureLow: 0.02,
    recaptureHigh: 0.04,
  },
  {
    id: "low_conversion",
    label: "Baixa conversão",
    recaptureLow: 0.03,
    recaptureHigh: 0.05,
  },
] as const;
export type PainId = (typeof PAIN_OPTIONS)[number]["id"];

// ─── Entrada / saída ────────────────────────────────────────────────────────

export type CommercialDiagnosticInput = {
  segment: SegmentKey;
  leadsBucket: LeadsBucketId | null;
  appointmentsBucket: AppointmentsBucketId | null;
  ticketBucket: TicketBucketId | null;
  teamBucket: TeamBucketId | null;
  responseTime: ResponseTimeId | null;
  channel: ChannelId | null;
  schedule: ScheduleId | null;
  pains: PainId[];
};

export type OrgPlanKey = "essencial" | "avancado" | "rede";

export type PlanRecommendation = {
  key: OrgPlanKey;
  label: string;
  monthlyCostBrl: number;
  rationale: string;
};

export type ConfigRecommendation = {
  playbookLabel: string;
  channelLabel: string;
  scheduleLabel: string;
  automationLevel: "alta" | "moderada";
  implantationPriority: "alta" | "média";
};

export type MoneyRange = { low: number; high: number };

export type CommercialDiagnosticResult = {
  /** true quando há dados suficientes para um ROI significativo */
  hasEnoughData: boolean;
  leadsPerMonth: number;
  appointmentsPerMonth: number;
  avgTicketBrl: number;
  currentConversion: number; // 0..1
  potentialConversion: MoneyRange; // faixa 0..1 (low/high)
  missedLeads: number;
  recoveredAppointments: MoneyRange; // agendamentos adicionais/mês
  additionalRevenueBrl: MoneyRange; // receita adicional/mês
  currentRevenueBrl: number;
  plan: PlanRecommendation;
  netGainBrl: MoneyRange; // receita adicional - custo do plano
  roiMultiple: MoneyRange; // receita adicional / custo
  config: ConfigRecommendation;
  fitScore: number; // 0..100
  fitLabel: string;
  closeProbability: number; // 0..100
  timeToValueDays: [number, number];
  insight: string; // narrativa comercial (template)
  suggestedScript: string; // "fala sugerida" pro vendedor
  nextBestAction: string;
  checklist: { label: string; done: boolean; kind: "comercial" | "tecnico" }[];
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function bucketValue<T extends string>(
  buckets: readonly Bucket<T>[],
  id: T | null,
): number {
  if (!id) return 0;
  return buckets.find((b) => b.id === id)?.value ?? 0;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function round(n: number): number {
  return Math.round(n);
}

// Nomes e valores canônicos: docs/product/pricing-strategy.md + landing
// (Start/Growth/Scale, mono-unidade). NÃO inventar — refletem site e contrato.
const PLAN_LABEL: Record<OrgPlanKey, string> = {
  essencial: "Start",
  avancado: "Growth",
  rede: "Scale",
};

const PLAN_COST: Record<OrgPlanKey, number> = {
  essencial: 1300,
  avancado: 2100,
  rede: 3500,
};

// ─── Núcleo ──────────────────────────────────────────────────────────────────

export function computeCommercialDiagnostic(
  input: CommercialDiagnosticInput,
): CommercialDiagnosticResult {
  const leads = bucketValue(LEADS_BUCKETS, input.leadsBucket);
  const appointments = Math.min(
    bucketValue(APPOINTMENTS_BUCKETS, input.appointmentsBucket),
    leads,
  );
  const ticket = bucketValue(TICKET_BUCKETS, input.ticketBucket);
  const team = bucketValue(TEAM_BUCKETS, input.teamBucket);

  const hasEnoughData = leads > 0 && ticket > 0;

  const currentConversion =
    leads > 0 ? clamp(appointments / leads, 0, 0.95) : 0;
  const missedLeads = Math.max(0, leads - appointments);

  // Recaptura: piso conservador + sinais de dor + tempo de resposta.
  let recLow = 0.05;
  let recHigh = 0.1;
  for (const painId of input.pains) {
    const pain = PAIN_OPTIONS.find((p) => p.id === painId);
    if (pain) {
      recLow += pain.recaptureLow;
      recHigh += pain.recaptureHigh;
    }
  }
  const responseRisk =
    RESPONSE_TIME_OPTIONS.find((r) => r.id === input.responseTime)?.risk ?? 0;
  recLow += responseRisk * 0.01;
  recHigh += responseRisk * 0.02;
  // Teto defensável — nunca prometer recuperar mais de 22% dos leads perdidos.
  recLow = clamp(recLow, 0.05, 0.16);
  recHigh = clamp(recHigh, recLow + 0.02, 0.22);

  const recoveredLow = round(missedLeads * recLow);
  const recoveredHigh = round(missedLeads * recHigh);

  const additionalRevenue: MoneyRange = {
    low: recoveredLow * ticket,
    high: recoveredHigh * ticket,
  };

  const currentRevenueBrl = appointments * ticket;

  const potentialConversion: MoneyRange = {
    low: leads > 0 ? clamp((appointments + recoveredLow) / leads, 0, 0.98) : 0,
    high: leads > 0 ? clamp((appointments + recoveredHigh) / leads, 0, 0.98) : 0,
  };

  // ── Plano recomendado (regras sobre volume) ──
  let planKey: OrgPlanKey;
  let planRationale: string;
  if (leads <= 150) {
    planKey = "essencial";
    planRationale = "Volume inicial — o Start cobre a operação com folga.";
  } else if (leads <= 700) {
    planKey = "avancado";
    planRationale =
      "Volume que já justifica automação alta e playbooks ilimitados.";
  } else {
    planKey = "rede";
    planRationale =
      team >= 6
        ? "Alto volume e equipe grande — precisa de processo, governança e métricas."
        : "Alto volume de leads — capacidade e alertas para não perder oportunidade.";
  }
  const plan: PlanRecommendation = {
    key: planKey,
    label: PLAN_LABEL[planKey],
    monthlyCostBrl: PLAN_COST[planKey],
    rationale: planRationale,
  };

  const netGain: MoneyRange = {
    low: additionalRevenue.low - plan.monthlyCostBrl,
    high: additionalRevenue.high - plan.monthlyCostBrl,
  };
  const roiMultiple: MoneyRange = {
    low: plan.monthlyCostBrl > 0 ? additionalRevenue.low / plan.monthlyCostBrl : 0,
    high: plan.monthlyCostBrl > 0 ? additionalRevenue.high / plan.monthlyCostBrl : 0,
  };

  // ── Configuração recomendada ──
  const highAutomation =
    responseRisk >= 2 ||
    input.pains.includes("slow_reply") ||
    input.pains.includes("after_hours");
  const config: ConfigRecommendation = {
    playbookLabel: `${resolveSegmentDefaults(input.segment).specialtyDefault} · playbook inicial`,
    channelLabel:
      CHANNEL_OPTIONS.find((c) => c.id === input.channel)?.label ?? "WhatsApp",
    scheduleLabel:
      SCHEDULE_OPTIONS.find((s) => s.id === input.schedule)?.label ??
      "Agenda interna",
    automationLevel: highAutomation ? "alta" : "moderada",
    implantationPriority: leads > 300 || responseRisk >= 2 ? "alta" : "média",
  };

  // ── Fit score (0..100) ──
  let fit = 40;
  if (input.channel === "whatsapp") fit += 15; // canal onde entregamos
  fit += Math.min(20, Math.round(leads / 50)); // volume = mais a ganhar
  fit += responseRisk * 6; // resposta lenta = dor clara
  fit += Math.min(15, input.pains.length * 6); // dores mapeadas
  if (ticket >= 600) fit += 6; // ticket alto = ROI maior
  const fitScore = clamp(round(fit), 0, 98);
  const fitLabel =
    fitScore >= 80
      ? "Excelente fit"
      : fitScore >= 60
        ? "Bom fit"
        : fitScore >= 40
          ? "Fit moderado"
          : "Fit a validar";

  // ── Probabilidade de fechamento ──
  const roiSignal = clamp((roiMultiple.high - 1) * 12, 0, 30);
  const closeProbability = clamp(round(fitScore * 0.7 + roiSignal), 0, 95);

  const timeToValueDays: [number, number] =
    config.implantationPriority === "alta" ? [3, 5] : [5, 10];

  // ── Narrativa (template) ──
  const topPain =
    PAIN_OPTIONS.find((p) => input.pains.includes(p.id))?.label.toLowerCase() ??
    "a demora no atendimento";
  const upliftPct = `${Math.round(recLow * 100)}–${Math.round(recHigh * 100)}%`;
  const insight = hasEnoughData
    ? `Pelo volume de ${leads} leads/mês e por ${topPain}, o maior gargalo é a perda de oportunidade — ${missedLeads} leads/mês não viram agendamento. Recuperando ${upliftPct} desses leads, a receita sobe ${formatBrl(additionalRevenue.low)}–${formatBrl(additionalRevenue.high)}/mês. É aqui que o SystemOps entra.`
    : "Preencha leads/mês e ticket médio para gerar o diagnóstico e o ROI em tempo real.";

  const suggestedScript = hasEnoughData
    ? `"Hoje vocês recebem cerca de ${leads} contatos por mês e ${missedLeads} deles não viram agendamento. Só de responder na hora e não perder ninguém fora do horário, dá pra recuperar entre ${recoveredLow} e ${recoveredHigh} agendamentos por mês — algo como ${formatBrl(additionalRevenue.low)} a ${formatBrl(additionalRevenue.high)} a mais. O plano ${plan.label} custa ${formatBrl(plan.monthlyCostBrl)}. Posso já deixar isso configurado pra vocês?"`
    : "Complete o diagnóstico para ver a fala sugerida.";

  const nextBestAction = !hasEnoughData
    ? "Complete leads/mês e ticket para liberar a proposta."
    : closeProbability >= 70
      ? "Agende uma demonstração do fluxo no WhatsApp para mostrar o impacto na prática."
      : "Aprofunde a dor principal antes de apresentar valores — valide o volume real de leads.";

  const checklist: CommercialDiagnosticResult["checklist"] = [
    { label: "Segmento definido", done: true, kind: "comercial" },
    { label: "Volume de leads e ticket", done: hasEnoughData, kind: "comercial" },
    { label: "Dor principal mapeada", done: input.pains.length > 0, kind: "comercial" },
    { label: "Plano e ROI apresentados", done: hasEnoughData, kind: "comercial" },
    { label: "Canal do WhatsApp", done: false, kind: "tecnico" },
    { label: "Acesso do admin", done: false, kind: "tecnico" },
  ];

  return {
    hasEnoughData,
    leadsPerMonth: leads,
    appointmentsPerMonth: appointments,
    avgTicketBrl: ticket,
    currentConversion,
    potentialConversion,
    missedLeads,
    recoveredAppointments: { low: recoveredLow, high: recoveredHigh },
    additionalRevenueBrl: additionalRevenue,
    currentRevenueBrl,
    plan,
    netGainBrl: netGain,
    roiMultiple,
    config,
    fitScore,
    fitLabel,
    closeProbability,
    timeToValueDays,
    insight,
    suggestedScript,
    nextBestAction,
    checklist,
  };
}

/**
 * Snapshot persistido em `organizations.commercialDiagnostic`. Guarda a entrada
 * bruta (para reprocessar/analisar depois) + os números-chave já calculados no
 * momento da captura (para relatórios sem recomputar).
 */
export type CommercialDiagnosticSnapshot = {
  capturedAt: string; // ISO
  input: CommercialDiagnosticInput;
  leadsPerMonth: number;
  appointmentsPerMonth: number;
  avgTicketBrl: number;
  currentConversion: number;
  missedLeads: number;
  additionalRevenueBrl: MoneyRange;
  planKey: OrgPlanKey;
  fitScore: number;
  closeProbability: number;
};

export function buildDiagnosticSnapshot(
  input: CommercialDiagnosticInput,
  result: CommercialDiagnosticResult = computeCommercialDiagnostic(input),
): CommercialDiagnosticSnapshot {
  return {
    capturedAt: new Date().toISOString(),
    input,
    leadsPerMonth: result.leadsPerMonth,
    appointmentsPerMonth: result.appointmentsPerMonth,
    avgTicketBrl: result.avgTicketBrl,
    currentConversion: result.currentConversion,
    missedLeads: result.missedLeads,
    additionalRevenueBrl: result.additionalRevenueBrl,
    planKey: result.plan.key,
    fitScore: result.fitScore,
    closeProbability: result.closeProbability,
  };
}

export function formatBrl(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(value);
}
