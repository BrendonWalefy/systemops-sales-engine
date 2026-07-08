"use client";

import { useEffect, useMemo, useRef, useState, useActionState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Loader2,
  Sparkles,
  Stethoscope,
  Wallet,
  UserCog,
  Zap,
  CalendarDays,
  MessageCircle,
  TrendingUp,
  Clock,
  Target,
  CheckCircle2,
  Circle,
} from "lucide-react";
import { createProspectClinic, type ProspectState } from "./actions";
import {
  SEGMENT_OPTIONS,
  resolveSegmentDefaults,
  type SegmentKey,
} from "@/application/onboarding/segment-options";
import {
  computeCommercialDiagnostic,
  buildDiagnosticSnapshot,
  formatBrl,
  LEADS_BUCKETS,
  APPOINTMENTS_BUCKETS,
  TICKET_BUCKETS,
  TEAM_BUCKETS,
  RESPONSE_TIME_OPTIONS,
  CHANNEL_OPTIONS,
  SCHEDULE_OPTIONS,
  PAIN_OPTIONS,
  type CommercialDiagnosticInput,
  type OrgPlanKey,
} from "@/application/onboarding/commercial-diagnostic";

// Catálogo canônico — espelha a landing (Start/Growth/Scale). Fonte:
// systemops-landing/components/systemops/pricing.tsx + docs/product/pricing-strategy.md
const PLANS: {
  key: OrgPlanKey;
  label: string;
  price: number;
  desc: string;
  tagline: string;
  ideal: string;
  benefits: string[];
}[] = [
  {
    key: "start",
    label: "Start",
    price: 1300,
    desc: "~300 conversas/mês",
    tagline: "Organizar leads, respostas e follow-up pela primeira vez.",
    ideal: "Operação solo ou pequena, começando a investir em tráfego.",
    benefits: [
      "Recepção comercial com IA no WhatsApp, 24/7",
      "Agendamento automático (agenda interna ou Google)",
      "Smart Inbox com histórico e follow-up automático",
    ],
  },
  {
    key: "growth",
    label: "Growth",
    price: 2100,
    desc: "~800 conversas/mês",
    tagline: "Converter com padrão e previsibilidade.",
    ideal: "Tráfego pago ativo (R$ 5–15k/mês em mídia).",
    benefits: [
      "Tudo do Start · playbooks ilimitados",
      "Recuperação automática de leads parados",
      "B-Wave: voz hiper-realista nos momentos de conversão",
    ],
  },
  {
    key: "scale",
    label: "Scale",
    price: 3500,
    desc: "~2.000 conversas/mês",
    tagline: "Alto volume com equipe, processo e governança.",
    ideal: "Volume alto, múltiplos profissionais atendendo.",
    benefits: [
      "Tudo do Growth · até 2 números de WhatsApp",
      "Equipe de até 10 operadores",
      "Métricas completas com alertas",
    ],
  },
];

const DRAFT_KEY = "onb-guided-draft-v1";

const initialInput: CommercialDiagnosticInput = {
  segment: "dental",
  leadsBucket: null,
  appointmentsBucket: null,
  ticketBucket: null,
  teamBucket: null,
  responseTime: null,
  channel: "whatsapp",
  schedule: "internal",
  pains: [],
};

const STEPS = ["Diagnóstico", "Plano & ROI", "Criar acesso"] as const;

export default function GuidedOnboardingPage() {
  const [state, formAction, isPending] = useActionState(
    createProspectClinic,
    { ok: false } as ProspectState,
  );

  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [input, setInput] = useState<CommercialDiagnosticInput>(initialInput);
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [greeting, setGreeting] = useState("");
  const [planOverride, setPlanOverride] = useState<OrgPlanKey | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [copied, setCopied] = useState(false);
  const restored = useRef(false);

  const defaults = resolveSegmentDefaults(input.segment);
  const result = useMemo(() => computeCommercialDiagnostic(input), [input]);
  const effectivePlan = planOverride ?? result.plan.key;

  // ── Restaurar rascunho (uma vez, pós-mount) ──
  // Lazy initializer leria localStorage no render e causaria hydration mismatch;
  // servidor e primeiro render do cliente usam os defaults, e este efeito aplica
  // o rascunho depois. Daí o disable pontual do set-state-in-effect.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d.input) setInput(d.input);
        if (d.name) setName(d.name);
        if (d.city) setCity(d.city);
        if (d.greeting) setGreeting(d.greeting);
        if (d.planOverride) setPlanOverride(d.planOverride);
      }
    } catch {
      /* rascunho corrompido — ignora */
    }
    restored.current = true;
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // ── Autosave (debounce) ──
  useEffect(() => {
    if (!restored.current) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({ input, name, city, greeting, planOverride }),
        );
        setSavedAt(new Date());
      } catch {
        /* storage cheio — ignora */
      }
    }, 600);
    return () => clearTimeout(t);
  }, [input, name, city, greeting, planOverride]);

  function patch(p: Partial<CommercialDiagnosticInput>) {
    setInput((prev) => ({ ...prev, ...p }));
  }

  function togglePain(id: (typeof PAIN_OPTIONS)[number]["id"]) {
    setInput((prev) => ({
      ...prev,
      pains: prev.pains.includes(id)
        ? prev.pains.filter((x) => x !== id)
        : [...prev.pains, id],
    }));
  }

  function proposalText(): string {
    const r = result;
    const plan = PLANS.find((p) => p.key === effectivePlan);
    const lines = [
      `*Proposta SystemOps — ${name || "sua operação"}*`,
      "",
      `*Seu cenário hoje:* ${r.leadsPerMonth} leads/mês e ${r.appointmentsPerMonth} agendamentos (${(r.currentConversion * 100).toFixed(0)}% de conversão). Hoje *${r.missedLeads} oportunidades por mês* esfriam sem virar agendamento.`,
      "",
      `*O que muda com o SystemOps:* recuperando parte desses leads, a receita adicional estimada é de *${formatBrl(r.additionalRevenueBrl.low)} a ${formatBrl(r.additionalRevenueBrl.high)}/mês* — um retorno de ${r.roiMultiple.low.toFixed(1)}x a ${r.roiMultiple.high.toFixed(1)}x sobre o investimento.`,
      "",
      `*Seu plano: ${plan?.label} — ${formatBrl(plan?.price ?? 0)}/mês*`,
      ...(plan?.benefits ?? []).map((b) => `• ${b}`),
      `_Ideal para: ${plan?.ideal}_`,
      "",
      `*Bônus Turma de Fundadores:* 40% de desconto nos 3 primeiros meses, implantação pela metade e preço travado por 12 meses. Vagas limitadas.`,
      "",
      `*Próximo passo:* configuro a operação e ativo em ${r.timeToValueDays[0]} a ${r.timeToValueDays[1]} dias úteis. Posso reservar sua vaga de Fundador?`,
    ];
    return lines.join("\n");
  }

  async function copyProposal() {
    try {
      await navigator.clipboard.writeText(proposalText());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard bloqueado */
    }
  }

  const snapshotJson = useMemo(
    () => JSON.stringify(buildDiagnosticSnapshot(input, result)),
    [input, result],
  );

  return (
    <div className="owner-dark-forced onb-root">
      <style>{ONB_STYLES}</style>

      {/* Topbar */}
      <div className="onb-topbar">
        <div>
          <p className="eyebrow">Owner Panel</p>
          <h1 className="onb-title">Onboarding comercial guiado</h1>
          <p className="onb-subtitle">
            Fluxo interativo para qualificar, configurar e apresentar valor ao
            cliente.
          </p>
        </div>
        <div className="onb-topbar-actions">
          <span className="onb-saved">
            {savedAt ? (
              <>
                <Check size={13} /> Rascunho salvo
              </>
            ) : (
              "Rascunho automático"
            )}
          </span>
          <Link href="/owner/clinics/new" className="onb-ghost-btn">
            Modo avançado
          </Link>
        </div>
      </div>

      {/* Stepper */}
      <div className="onb-stepper">
        {STEPS.map((label, i) => (
          <button
            key={label}
            type="button"
            className={`onb-step ${i === step ? "is-active" : ""} ${i < step ? "is-done" : ""}`}
            onClick={() => i <= step && setStep(i as 0 | 1 | 2)}
          >
            <span className="onb-step-num">
              {i < step ? <Check size={13} strokeWidth={3} /> : i + 1}
            </span>
            <span className="onb-step-label">{label}</span>
          </button>
        ))}
      </div>

      {/* Body: main + aside */}
      <div className="onb-grid">
        <div className="onb-main">
          {step === 0 && (
            <StepDiagnostico
              input={input}
              patch={patch}
              togglePain={togglePain}
              name={name}
              setName={setName}
              city={city}
              setCity={setCity}
              greeting={greeting}
              setGreeting={setGreeting}
              greetingPlaceholder={defaults.greetingPlaceholder}
              namePlaceholder={defaults.namePlaceholder}
              insight={result.insight}
              config={result.config}
            />
          )}

          {step === 1 && (
            <StepProposta
              result={result}
              effectivePlan={effectivePlan}
              setPlanOverride={setPlanOverride}
              copyProposal={copyProposal}
              copied={copied}
            />
          )}

          {step === 2 && (
            <StepCriar
              name={name}
              input={input}
              city={city}
              greeting={greeting}
              specialty={defaults.specialtyDefault}
              effectivePlan={effectivePlan}
              snapshotJson={snapshotJson}
              formAction={formAction}
              isPending={isPending}
              state={state}
              adminPlaceholder={defaults.adminEmailPlaceholder}
            />
          )}

          {/* Nav (steps 0/1 only — step 2 has its own submit) */}
          {step < 2 && (
            <div className="onb-nav">
              {step > 0 ? (
                <button
                  type="button"
                  className="onb-ghost-btn"
                  onClick={() => setStep((s) => (s - 1) as 0 | 1)}
                >
                  <ArrowLeft size={15} /> Voltar
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                className="onb-primary-btn"
                disabled={step === 0 && !name.trim()}
                onClick={() => setStep((s) => (s + 1) as 1 | 2)}
              >
                {step === 0 ? "Avançar para proposta" : "Avançar para criação"}
                <ArrowRight size={16} />
              </button>
            </div>
          )}
        </div>

        {/* Aside — resumo em tempo real */}
        <aside className="onb-aside">
          <LiveSummary
            input={input}
            result={result}
            effectivePlan={effectivePlan}
            stepLabel={STEPS[step]}
          />
        </aside>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 1 — Diagnóstico
// ═══════════════════════════════════════════════════════════════════════════

function StepDiagnostico({
  input,
  patch,
  togglePain,
  name,
  setName,
  city,
  setCity,
  greeting,
  setGreeting,
  greetingPlaceholder,
  namePlaceholder,
  insight,
  config,
}: {
  input: CommercialDiagnosticInput;
  patch: (p: Partial<CommercialDiagnosticInput>) => void;
  togglePain: (id: (typeof PAIN_OPTIONS)[number]["id"]) => void;
  name: string;
  setName: (v: string) => void;
  city: string;
  setCity: (v: string) => void;
  greeting: string;
  setGreeting: (v: string) => void;
  greetingPlaceholder: string;
  namePlaceholder: string;
  insight: string;
  config: ReturnType<typeof computeCommercialDiagnostic>["config"];
}) {
  return (
    <div className="onb-card">
      <CardHeader
        Icon={Stethoscope}
        title="Diagnóstico do cliente"
        subtitle="Entenda o cenário atual para sugerir a melhor configuração."
      />

      <Divider label="Perfil do negócio" />

      <Field label="Segmento">
        <div className="onb-chips">
          {SEGMENT_OPTIONS.slice(0, 8).map((s) => (
            <Pill
              key={s.key}
              active={input.segment === s.key}
              onClick={() => patch({ segment: s.key as SegmentKey })}
            >
              {s.shortLabel}
            </Pill>
          ))}
        </div>
      </Field>

      <Divider label="Volume e operação" />

      <div className="onb-two">
        <Field label="Leads por mês">
          <BucketRow
            options={LEADS_BUCKETS}
            value={input.leadsBucket}
            onChange={(id) => patch({ leadsBucket: id })}
          />
        </Field>
        <Field label="Agendamentos / mês">
          <BucketRow
            options={APPOINTMENTS_BUCKETS}
            value={input.appointmentsBucket}
            onChange={(id) => patch({ appointmentsBucket: id })}
          />
        </Field>
      </div>

      <div className="onb-two">
        <Field label="Ticket médio">
          <BucketRow
            options={TICKET_BUCKETS}
            value={input.ticketBucket}
            onChange={(id) => patch({ ticketBucket: id })}
          />
        </Field>
        <Field label="Equipe de atendimento">
          <BucketRow
            options={TEAM_BUCKETS}
            value={input.teamBucket}
            onChange={(id) => patch({ teamBucket: id })}
          />
        </Field>
      </div>

      <Divider label="Atendimento hoje" />

      <div className="onb-two">
        <Field label="Canal principal">
          <div className="onb-chips">
            {CHANNEL_OPTIONS.map((c) => (
              <Pill
                key={c.id}
                active={input.channel === c.id}
                onClick={() => patch({ channel: c.id })}
              >
                {c.label}
              </Pill>
            ))}
          </div>
        </Field>
        <Field label="Agenda">
          <div className="onb-chips">
            {SCHEDULE_OPTIONS.map((s) => (
              <Pill
                key={s.id}
                active={input.schedule === s.id}
                onClick={() => patch({ schedule: s.id })}
              >
                {s.label}
              </Pill>
            ))}
          </div>
        </Field>
      </div>

      <Field label="Tempo médio de resposta">
        <div className="onb-chips">
          {RESPONSE_TIME_OPTIONS.map((r) => (
            <Pill
              key={r.id}
              active={input.responseTime === r.id}
              onClick={() => patch({ responseTime: r.id })}
            >
              {r.label}
            </Pill>
          ))}
        </div>
      </Field>

      <Field label="Principais dores (selecione as que se aplicam)">
        <div className="onb-chips">
          {PAIN_OPTIONS.map((p) => (
            <Pill
              key={p.id}
              active={input.pains.includes(p.id)}
              tone="warn"
              onClick={() => togglePain(p.id)}
            >
              {input.pains.includes(p.id) && (
                <Check size={12} strokeWidth={3} style={{ marginRight: 2 }} />
              )}
              {p.label}
            </Pill>
          ))}
        </div>
      </Field>

      {/* Sugestão da IA */}
      <div className="onb-insight">
        <Sparkles size={16} className="onb-insight-icon" />
        <div>
          <p className="onb-insight-title">Sugestão da IA</p>
          <p className="onb-insight-body">{insight}</p>
        </div>
      </div>

      {/* Configuração recomendada */}
      <Divider label="Configuração recomendada" />
      <div className="onb-config-grid">
        <ConfigCard Icon={MessageCircle} label="Canal" value={config.channelLabel} />
        <ConfigCard Icon={CalendarDays} label="Agenda" value={config.scheduleLabel} />
        <ConfigCard
          Icon={Zap}
          label="Automação"
          value={config.automationLevel === "alta" ? "Alta" : "Moderada"}
        />
        <ConfigCard
          Icon={Target}
          label="Prioridade"
          value={config.implantationPriority === "alta" ? "Alta" : "Média"}
        />
      </div>

      {/* Dados essenciais */}
      <Divider label="Dados essenciais" />
      <div className="onb-two">
        <Field label="Nome do estabelecimento *">
          <input
            className="onb-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={namePlaceholder}
          />
        </Field>
        <Field label="Cidade">
          <input
            className="onb-input"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Ex: São Paulo"
          />
        </Field>
      </div>
      <Field label="Saudação inicial da IA">
        <input
          className="onb-input"
          value={greeting}
          onChange={(e) => setGreeting(e.target.value)}
          placeholder={greetingPlaceholder}
        />
      </Field>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 2 — Plano & Proposta
// ═══════════════════════════════════════════════════════════════════════════

function StepProposta({
  result,
  effectivePlan,
  setPlanOverride,
  copyProposal,
  copied,
}: {
  result: ReturnType<typeof computeCommercialDiagnostic>;
  effectivePlan: OrgPlanKey;
  setPlanOverride: (p: OrgPlanKey) => void;
  copyProposal: () => void;
  copied: boolean;
}) {
  const planPrice = PLANS.find((p) => p.key === effectivePlan)?.price ?? 0;
  const selectedPlan = PLANS.find((p) => p.key === effectivePlan);
  const isRecommended = result.plan.key === effectivePlan;
  return (
    <div className="onb-card">
      <CardHeader
        Icon={Wallet}
        title="Plano e proposta"
        subtitle="O diagnóstico já sugere o plano. Ajuste se o cliente pedir."
      />

      <Field label="Plano comercial">
        <div className="onb-plan-grid">
          {PLANS.map((p) => {
            const active = effectivePlan === p.key;
            const recommended = result.plan.key === p.key;
            return (
              <button
                key={p.key}
                type="button"
                className={`onb-plan ${active ? "is-active" : ""}`}
                onClick={() => setPlanOverride(p.key)}
              >
                {recommended && <span className="onb-plan-tag">Recomendado</span>}
                <span className="onb-plan-name">{p.label}</span>
                <span className="onb-plan-price">{formatBrl(p.price)}</span>
                <span className="onb-plan-desc">{p.desc}</span>
              </button>
            );
          })}
        </div>
      </Field>

      {/* Diferença dos planos — apoio ao vendedor quando o cliente pergunta */}
      {selectedPlan && (
        <div className="onb-plan-detail">
          <div className="onb-plan-detail-head">
            <span className="onb-plan-detail-name">
              {selectedPlan.label}
              {isRecommended && (
                <span className="onb-plan-detail-badge">Sugerido p/ este cliente</span>
              )}
            </span>
            <span className="onb-plan-detail-price">
              {formatBrl(selectedPlan.price)}/mês
            </span>
          </div>
          <p className="onb-plan-detail-why">
            {isRecommended
              ? result.plan.rationale
              : `Você ajustou para o ${selectedPlan.label}. Sugestão do diagnóstico: ${result.plan.label}.`}
          </p>
          <ul className="onb-plan-benefits">
            {selectedPlan.benefits.map((b) => (
              <li key={b}>
                <Check size={13} className="onb-plan-benefit-icon" />
                {b}
              </li>
            ))}
          </ul>
          <p className="onb-plan-ideal">
            <strong>Para quem é:</strong> {selectedPlan.ideal}
          </p>
        </div>
      )}

      {/* ROI */}
      <p className="eyebrow" style={{ marginTop: 4 }}>
        Simulação de retorno (estimativa)
      </p>
      <div className="onb-roi-grid">
        <RoiCell
          label="Receita atual"
          value={formatBrl(result.currentRevenueBrl)}
          hint="agendamentos × ticket"
        />
        <RoiCell
          label="Receita adicional"
          value={`${formatBrl(result.additionalRevenueBrl.low)} – ${formatBrl(result.additionalRevenueBrl.high)}`}
          hint="por mês, estimado"
          positive
        />
        <RoiCell label="Custo do plano" value={`${formatBrl(planPrice)}/mês`} />
        <RoiCell
          label="Ganho líquido"
          value={`${formatBrl(Math.max(0, result.additionalRevenueBrl.low - planPrice))} – ${formatBrl(result.additionalRevenueBrl.high - planPrice)}`}
          hint="receita adicional − plano"
          positive
        />
        <RoiCell
          label="Retorno (ROI)"
          value={`${result.roiMultiple.low.toFixed(1)}x – ${result.roiMultiple.high.toFixed(1)}x`}
          positive
        />
        <RoiCell
          label="Implantação"
          value={`${result.timeToValueDays[0]}–${result.timeToValueDays[1]} dias`}
        />
      </div>

      {!result.hasEnoughData && (
        <p className="onb-warn">
          Preencha leads/mês e ticket médio no diagnóstico para uma simulação
          completa.
        </p>
      )}

      <button type="button" className="onb-copy-btn" onClick={copyProposal}>
        {copied ? (
          <>
            <Check size={16} /> Copiado!
          </>
        ) : (
          <>
            <Copy size={16} /> Copiar proposta para WhatsApp
          </>
        )}
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 3 — Criar acesso
// ═══════════════════════════════════════════════════════════════════════════

function StepCriar({
  name,
  input,
  city,
  greeting,
  specialty,
  effectivePlan,
  snapshotJson,
  formAction,
  isPending,
  state,
  adminPlaceholder,
}: {
  name: string;
  input: CommercialDiagnosticInput;
  city: string;
  greeting: string;
  specialty: string;
  effectivePlan: OrgPlanKey;
  snapshotJson: string;
  formAction: (fd: FormData) => void;
  isPending: boolean;
  state: ProspectState;
  adminPlaceholder: string;
}) {
  return (
    <form action={formAction} className="onb-card">
      <CardHeader
        Icon={UserCog}
        title="Criar acesso da organização"
        subtitle="Últimos dados para gerar o pré-cadastro e liberar o setup técnico."
      />

      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="segment" value={input.segment} />
      <input type="hidden" name="specialty" value={specialty} />
      <input type="hidden" name="city" value={city} />
      <input type="hidden" name="greetingMessage" value={greeting} />
      <input type="hidden" name="plan" value={effectivePlan} />
      <input type="hidden" name="diagnostic" value={snapshotJson} />

      <div className="onb-resumo">
        <p className="eyebrow" style={{ color: "var(--accent-strong)" }}>
          Resumo do cadastro
        </p>
        <p className="onb-resumo-name">{name || "—"}</p>
        <p className="onb-resumo-meta">
          {SEGMENT_OPTIONS.find((s) => s.key === input.segment)?.label}
          {city ? ` · ${city}` : ""} ·{" "}
          {PLANS.find((p) => p.key === effectivePlan)?.label}
        </p>
      </div>

      <Field label="E-mail do admin *">
        <input
          className="onb-input"
          type="email"
          name="adminEmail"
          required
          placeholder={adminPlaceholder}
        />
        {state.errors?.adminEmail && (
          <p className="onb-field-error">{state.errors.adminEmail}</p>
        )}
      </Field>
      <Field label="Senha de acesso *">
        <input
          className="onb-input"
          type="password"
          name="adminPassword"
          required
          minLength={8}
          placeholder="Mínimo 8 caracteres"
        />
        {state.errors?.adminPassword && (
          <p className="onb-field-error">{state.errors.adminPassword}</p>
        )}
      </Field>

      {state.message && <p className="onb-warn">{state.message}</p>}

      <button type="submit" className="onb-primary-btn onb-submit" disabled={isPending}>
        {isPending ? (
          <>
            <Loader2 size={16} className="onb-spin" /> Criando...
          </>
        ) : (
          <>
            Criar organização <ArrowRight size={16} />
          </>
        )}
      </button>
    </form>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Aside — Resumo em tempo real
// ═══════════════════════════════════════════════════════════════════════════

function LiveSummary({
  input,
  result,
  effectivePlan,
  stepLabel,
}: {
  input: CommercialDiagnosticInput;
  result: ReturnType<typeof computeCommercialDiagnostic>;
  effectivePlan: OrgPlanKey;
  stepLabel: string;
}) {
  const planPrice = PLANS.find((p) => p.key === effectivePlan)?.price ?? 0;
  const segmentLabel =
    SEGMENT_OPTIONS.find((s) => s.key === input.segment)?.label ?? "—";

  return (
    <div className="onb-summary-stack">
      {/* Resumo */}
      <div className="onb-card onb-summary">
        <div className="onb-summary-head">
          <p className="eyebrow">Resumo em tempo real</p>
          <span className="onb-live-dot" />
        </div>
        <SummaryRow label="Segmento" value={segmentLabel} />
        <SummaryRow label="Estágio atual" value={stepLabel} />
        <SummaryRow
          label="Plano sugerido"
          value={PLANS.find((p) => p.key === effectivePlan)?.label ?? "—"}
          accent
        />
        <SummaryRow
          label="Receita adicional"
          value={
            result.hasEnoughData
              ? `${formatBrl(result.additionalRevenueBrl.low)}–${formatBrl(result.additionalRevenueBrl.high)}`
              : "—"
          }
        />
        <SummaryRow label="Custo do plano" value={`${formatBrl(planPrice)}/mês`} />
        <SummaryRow
          label="Implantação"
          value={`${result.timeToValueDays[0]}–${result.timeToValueDays[1]} dias úteis`}
        />
        <div className="onb-prob">
          <div className="onb-prob-label">
            <span>Probabilidade de fechamento</span>
            <strong>{result.closeProbability}%</strong>
          </div>
          <div className="onb-prob-bar">
            <div
              className="onb-prob-fill"
              style={{ width: `${result.closeProbability}%` }}
            />
          </div>
        </div>
      </div>

      {/* Impacto previsto */}
      <div className="onb-card onb-summary">
        <p className="eyebrow">Impacto previsto (mensal)</p>
        <div className="onb-impact-grid">
          <Impact
            Icon={TrendingUp}
            label="Leads recuperados"
            value={
              result.hasEnoughData
                ? `${result.recoveredAppointments.low}–${result.recoveredAppointments.high}`
                : "—"
            }
          />
          <Impact
            Icon={Target}
            label="Conversão potencial"
            value={
              result.hasEnoughData
                ? `${(result.potentialConversion.low * 100).toFixed(0)}–${(result.potentialConversion.high * 100).toFixed(0)}%`
                : "—"
            }
          />
          <Impact
            Icon={Clock}
            label="ROI estimado"
            value={
              result.hasEnoughData
                ? `${result.roiMultiple.low.toFixed(1)}–${result.roiMultiple.high.toFixed(1)}x`
                : "—"
            }
          />
          <Impact
            Icon={Wallet}
            label="Ganho líquido"
            value={
              result.hasEnoughData
                ? formatBrl(Math.max(0, result.additionalRevenueBrl.high - planPrice))
                : "—"
            }
          />
        </div>
      </div>

      {/* Fit */}
      <div className="onb-card onb-summary onb-fit">
        <FitRing score={result.fitScore} label={result.fitLabel} />
        <div className="onb-fit-list">
          <FitItem label="Alinhamento com solução" ok={input.channel === "whatsapp"} />
          <FitItem label="Potencial de resultado" ok={result.roiMultiple.high >= 2} />
          <FitItem
            label="Dor mapeada"
            ok={input.pains.length > 0}
          />
          <FitItem label="Volume qualificado" ok={result.leadsPerMonth >= 200} />
        </div>
      </div>

      {/* Pendências */}
      <div className="onb-card onb-summary">
        <p className="eyebrow">Pendências para fechar</p>
        <div className="onb-checklist">
          {result.checklist.map((c) => (
            <div key={c.label} className="onb-check-row">
              <span className="onb-check-label">
                {c.done ? (
                  <CheckCircle2 size={14} className="onb-check-done" />
                ) : (
                  <Circle size={14} className="onb-check-pending" />
                )}
                {c.label}
              </span>
              <span className={`onb-check-tag ${c.kind}`}>{c.kind}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Próxima melhor ação */}
      <div className="onb-card onb-nba">
        <p className="eyebrow" style={{ color: "var(--accent-strong)" }}>
          Próxima melhor ação
        </p>
        <p className="onb-nba-body">{result.nextBestAction}</p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Primitivos
// ═══════════════════════════════════════════════════════════════════════════

function CardHeader({
  Icon,
  title,
  subtitle,
}: {
  Icon: React.ElementType;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="onb-card-head">
      <span className="onb-card-icon">
        <Icon size={16} />
      </span>
      <div>
        <p className="onb-card-title">{title}</p>
        <p className="onb-card-subtitle">{subtitle}</p>
      </div>
    </div>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <div className="onb-divider">
      <span>{label}</span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="onb-field">
      <label className="onb-field-label">{label}</label>
      {children}
    </div>
  );
}

function Pill({
  active,
  onClick,
  children,
  tone = "accent",
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  tone?: "accent" | "warn";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`onb-pill ${active ? `is-active tone-${tone}` : ""}`}
    >
      {children}
    </button>
  );
}

function BucketRow<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { id: T; label: string }[];
  value: T | null;
  onChange: (id: T) => void;
}) {
  return (
    <div className="onb-chips">
      {options.map((o) => (
        <Pill key={o.id} active={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </Pill>
      ))}
    </div>
  );
}

function ConfigCard({
  Icon,
  label,
  value,
}: {
  Icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="onb-config-card">
      <span className="onb-config-icon">
        <Icon size={14} />
      </span>
      <div>
        <p className="onb-config-label">{label}</p>
        <p className="onb-config-value">{value}</p>
      </div>
    </div>
  );
}

function RoiCell({
  label,
  value,
  hint,
  positive,
}: {
  label: string;
  value: string;
  hint?: string;
  positive?: boolean;
}) {
  return (
    <div className="onb-roi-cell">
      <p className="onb-roi-label">{label}</p>
      <p className={`onb-roi-value ${positive ? "is-positive" : ""}`}>{value}</p>
      {hint && <p className="onb-roi-hint">{hint}</p>}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="onb-summary-row">
      <span className="onb-summary-label">{label}</span>
      <span className={`onb-summary-value ${accent ? "is-accent" : ""}`}>
        {value}
      </span>
    </div>
  );
}

function Impact({
  Icon,
  label,
  value,
}: {
  Icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="onb-impact">
      <Icon size={14} className="onb-impact-icon" />
      <p className="onb-impact-value">{value}</p>
      <p className="onb-impact-label">{label}</p>
    </div>
  );
}

function FitRing({ score, label }: { score: number; label: string }) {
  const r = 26;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <div className="onb-ring-wrap">
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={r} className="onb-ring-track" />
        <circle
          cx="36"
          cy="36"
          r={r}
          className="onb-ring-fill"
          strokeDasharray={`${dash} ${circ}`}
          transform="rotate(-90 36 36)"
        />
      </svg>
      <div className="onb-ring-center">
        <strong>{score}%</strong>
      </div>
      <p className="onb-ring-label">{label}</p>
    </div>
  );
}

function FitItem({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="onb-fit-item">
      {ok ? (
        <CheckCircle2 size={13} className="onb-check-done" />
      ) : (
        <Circle size={13} className="onb-check-pending" />
      )}
      <span>{label}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Estilos (scoped)
// ═══════════════════════════════════════════════════════════════════════════

const ONB_STYLES = `
.onb-root { padding: 20px 24px 80px; max-width: 1360px; margin: 0 auto; }
.onb-topbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 18px; }
.onb-title { margin: 2px 0 0; font-size: 26px; font-weight: 800; letter-spacing: -0.01em; color: var(--text); }
.onb-subtitle { margin: 4px 0 0; font-size: 13px; color: var(--muted); }
.onb-topbar-actions { display: flex; align-items: center; gap: 10px; }
.onb-saved { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--muted); }
.onb-ghost-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 10px; border: 1px solid var(--line); background: transparent; color: var(--text-soft); font-size: 13px; font-weight: 600; cursor: pointer; text-decoration: none; }
.onb-ghost-btn:hover { border-color: var(--line-strong); }

.onb-stepper { display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }
.onb-step { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface-soft); color: var(--muted); font-size: 13px; font-weight: 600; cursor: pointer; }
.onb-step.is-active { border-color: color-mix(in srgb, var(--accent) 45%, transparent); background: var(--accent-soft); color: var(--accent-strong); }
.onb-step.is-done { color: var(--text-soft); }
.onb-step-num { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; font-size: 11px; font-weight: 800; background: rgba(255,255,255,0.08); color: inherit; }
.onb-step.is-active .onb-step-num { background: var(--accent); color: #04150f; }
.onb-step.is-done .onb-step-num { background: var(--accent); color: #04150f; }

.onb-grid { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 20px; align-items: start; }
.onb-main { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.onb-aside { position: sticky; top: 16px; }

.onb-card { background: var(--surface-raised); border: 1px solid var(--line); border-radius: 16px; padding: 20px; display: flex; flex-direction: column; gap: 16px; }
.onb-card-head { display: flex; align-items: center; gap: 12px; }
.onb-card-icon { display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; border-radius: 10px; background: var(--accent-soft); color: var(--accent-strong); flex-shrink: 0; }
.onb-card-title { margin: 0; font-size: 16px; font-weight: 700; color: var(--text); }
.onb-card-subtitle { margin: 2px 0 0; font-size: 12.5px; color: var(--muted); }

.onb-field { display: flex; flex-direction: column; gap: 8px; }
.onb-field-label { font-size: 12px; font-weight: 600; color: var(--text-soft); }
.onb-two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

.onb-divider { display: flex; align-items: center; gap: 12px; margin: 2px 0; }
.onb-divider::after { content: ""; flex: 1; height: 1px; background: var(--line); }
.onb-divider span { font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }

.onb-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.onb-pill { display: inline-flex; align-items: center; padding: 9px 14px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface-soft); color: var(--text-soft); font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.12s; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
.onb-pill:hover { border-color: var(--line-strong); }
.onb-pill.is-active.tone-accent { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-strong); }
.onb-pill.is-active.tone-warn { border-color: rgba(245,158,11,0.5); background: rgba(245,158,11,0.1); color: #fbbf24; }

.onb-input { width: 100%; padding: 11px 14px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface-soft); color: var(--text); font-size: 14px; outline: none; box-sizing: border-box; }
.onb-input:focus { border-color: var(--accent); }
.onb-input::placeholder { color: var(--muted); }

.onb-insight { display: flex; gap: 12px; padding: 14px 16px; border-radius: 12px; border: 1px solid color-mix(in srgb, var(--accent) 28%, transparent); background: var(--accent-soft); }
.onb-insight-icon { color: var(--accent-strong); flex-shrink: 0; margin-top: 2px; }
.onb-insight-title { margin: 0 0 4px; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; color: var(--accent-strong); }
.onb-insight-body { margin: 0; font-size: 13px; line-height: 1.55; color: var(--text-soft); }

.onb-config-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; }
.onb-config-card { display: flex; align-items: center; gap: 10px; padding: 12px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface-soft); }
.onb-config-icon { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 8px; background: rgba(255,255,255,0.05); color: var(--accent-strong); flex-shrink: 0; }
.onb-config-label { margin: 0; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
.onb-config-value { margin: 2px 0 0; font-size: 13.5px; font-weight: 700; color: var(--text); }

.onb-plan-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.onb-plan { position: relative; display: flex; flex-direction: column; gap: 3px; padding: 16px 14px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface-soft); cursor: pointer; text-align: left; }
.onb-plan.is-active { border-color: var(--accent); background: var(--accent-soft); }
.onb-plan-tag { position: absolute; top: -9px; left: 12px; font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #04150f; background: var(--accent); padding: 2px 7px; border-radius: 6px; }
.onb-plan-name { font-size: 12px; font-weight: 700; color: var(--muted); }
.onb-plan.is-active .onb-plan-name { color: var(--accent-strong); }
.onb-plan-price { font-size: 17px; font-weight: 800; color: var(--text); }
.onb-plan-desc { font-size: 11px; color: var(--muted); }

.onb-plan-detail { padding: 16px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface-soft); display: flex; flex-direction: column; gap: 10px; }
.onb-plan-detail-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.onb-plan-detail-name { font-size: 15px; font-weight: 800; color: var(--text); display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.onb-plan-detail-badge { font-size: 9.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: var(--accent-strong); background: var(--accent-soft); padding: 2px 8px; border-radius: 6px; }
.onb-plan-detail-price { font-size: 14px; font-weight: 700; color: var(--accent-strong); }
.onb-plan-detail-why { margin: 0; font-size: 12.5px; color: var(--muted); line-height: 1.5; }
.onb-plan-benefits { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 7px; }
.onb-plan-benefits li { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; color: var(--text-soft); line-height: 1.45; }
.onb-plan-benefit-icon { color: var(--accent); flex-shrink: 0; margin-top: 2px; }
.onb-plan-ideal { margin: 2px 0 0; font-size: 12px; color: var(--muted); }
.onb-plan-ideal strong { color: var(--text-soft); }

.onb-roi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.onb-roi-cell { padding: 14px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface-soft); }
.onb-roi-label { margin: 0; font-size: 11px; color: var(--muted); }
.onb-roi-value { margin: 6px 0 0; font-size: 16px; font-weight: 800; color: var(--text); line-height: 1.15; }
.onb-roi-value.is-positive { color: var(--accent-strong); }
.onb-roi-hint { margin: 4px 0 0; font-size: 10.5px; color: var(--muted); }

.onb-copy-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 12px; border-radius: 12px; border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent); background: var(--accent-soft); color: var(--accent-strong); font-size: 14px; font-weight: 700; cursor: pointer; }
.onb-copy-btn:hover { background: color-mix(in srgb, var(--accent) 18%, transparent); }

.onb-warn { margin: 0; padding: 10px 14px; border-radius: 10px; background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.28); color: #fbbf24; font-size: 12.5px; }
.onb-field-error { margin: 2px 0 0; font-size: 12px; color: var(--danger); }

.onb-resumo { padding: 14px 16px; border-radius: 12px; border: 1px solid color-mix(in srgb, var(--accent) 22%, transparent); background: var(--accent-soft); }
.onb-resumo-name { margin: 6px 0 0; font-size: 16px; font-weight: 700; color: var(--text); }
.onb-resumo-meta { margin: 3px 0 0; font-size: 13px; color: var(--muted); }

.onb-nav { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.onb-primary-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 11px 20px; border-radius: 12px; border: none; background: var(--accent); color: #04150f; font-size: 14px; font-weight: 800; cursor: pointer; }
.onb-primary-btn:hover { background: var(--accent-strong); }
.onb-primary-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.onb-submit { width: 100%; margin-top: 4px; }
.onb-spin { animation: onb-spin 1s linear infinite; }
@keyframes onb-spin { to { transform: rotate(360deg); } }

/* Aside */
.onb-summary-stack { display: flex; flex-direction: column; gap: 14px; }
.onb-summary { padding: 16px; gap: 10px; }
.onb-summary-head { display: flex; align-items: center; justify-content: space-between; }
.onb-live-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); }
.onb-summary-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.onb-summary-label { font-size: 12.5px; color: var(--muted); }
.onb-summary-value { font-size: 12.5px; font-weight: 700; color: var(--text); text-align: right; }
.onb-summary-value.is-accent { color: var(--accent-strong); }
.onb-prob { margin-top: 4px; display: flex; flex-direction: column; gap: 6px; }
.onb-prob-label { display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: var(--muted); }
.onb-prob-label strong { color: var(--accent-strong); font-size: 13px; }
.onb-prob-bar { height: 7px; border-radius: 999px; background: rgba(255,255,255,0.07); overflow: hidden; }
.onb-prob-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--accent), var(--accent-strong)); transition: width 0.3s; }

.onb-impact-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.onb-impact { padding: 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface-soft); }
.onb-impact-icon { color: var(--accent-strong); }
.onb-impact-value { margin: 6px 0 0; font-size: 15px; font-weight: 800; color: var(--text); }
.onb-impact-label { margin: 2px 0 0; font-size: 10.5px; color: var(--muted); }

.onb-fit { align-items: stretch; }
.onb-ring-wrap { position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.onb-ring-track { fill: none; stroke: rgba(255,255,255,0.08); stroke-width: 7; }
.onb-ring-fill { fill: none; stroke: var(--accent); stroke-width: 7; stroke-linecap: round; transition: stroke-dasharray 0.4s; }
.onb-ring-center { position: absolute; top: 24px; left: 0; right: 0; text-align: center; }
.onb-ring-center strong { font-size: 17px; font-weight: 800; color: var(--text); }
.onb-ring-label { margin: 0; font-size: 12px; font-weight: 700; color: var(--accent-strong); }
.onb-fit-list { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.onb-fit-item { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--text-soft); }

.onb-checklist { display: flex; flex-direction: column; gap: 9px; }
.onb-check-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.onb-check-label { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--text-soft); }
.onb-check-done { color: var(--accent); flex-shrink: 0; }
.onb-check-pending { color: var(--muted); flex-shrink: 0; }
.onb-check-tag { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; padding: 2px 7px; border-radius: 6px; }
.onb-check-tag.comercial { color: var(--accent-strong); background: var(--accent-soft); }
.onb-check-tag.tecnico { color: #818cf8; background: rgba(129,140,248,0.14); }

.onb-nba { padding: 16px; background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 22%, transparent); }
.onb-nba-body { margin: 8px 0 0; font-size: 13px; line-height: 1.5; color: var(--text-soft); }

@media (max-width: 960px) {
  .onb-root { padding: 16px 14px 90px; }
  .onb-grid { grid-template-columns: 1fr; }
  .onb-aside { position: static; }
  .onb-title { font-size: 22px; }
  .onb-two { grid-template-columns: 1fr; gap: 12px; }
  .onb-plan-grid { grid-template-columns: 1fr; }
  .onb-roi-grid { grid-template-columns: 1fr 1fr; }
}
`;
