export const dynamic = "force-dynamic";

import Link from "next/link";
import { db } from "@/infrastructure/db/client";
import {
  organizations,
  aiUsageCosts,
  ttsUsageCosts,
  whatsappMessageCosts,
} from "@/infrastructure/db/schema";
import { eq, sum, and, gte } from "drizzle-orm";
import { DrizzlePlatformSpendAlertStore } from "@/infrastructure/repositories/drizzle-platform-spend-alert-store";
import {
  USD_TO_BRL,
  VERCEL_PRO_PLATFORM_FEE_USD_CENTS,
  usdCentsToBrlCents,
  vercelSpendUsdToBrlCents,
} from "@/application/finance/platform-billing";
import {
  TrendingUp,
  DollarSign,
  Percent,
  AlertCircle,
  ArrowLeft,
  FlaskConical,
  Activity,
} from "lucide-react";
import {
  getClinicOperationalStatusLabel,
  isBillableOperationalStatus,
} from "@/application/clinics/clinic-operational-status-presentation";
import type { ClinicOperationalStatus } from "@/application/clinics/clinic-operational-status";

// Custos de infra mensais em BRL (centavos) — auditados em jun/2026.
// O excedente do Vercel Pro é recebido pelo webhook de Spend Management.
// Z-API: R$79,99/instância (fatura 24/05/2026, plano "Meu número").
const INFRA_FIXED_BRL = {
  vercel: usdCentsToBrlCents(VERCEL_PRO_PLATFORM_FEE_USD_CENTS),
  neon: 0, // Free tier (gratuito até 512 MB / 100 CU-hrs)
  zapi_per_clinic: 7999, // R$ 79,99 por instância (confirmado fatura jun/2026)
};

// Preços dos planos em centavos
const PLAN_PRICE_BRL: Record<string, number> = {
  essencial: 89700,
  clinica: 149700,
  rede: 299700,
  custom: 0,
};

const PLAN_LABEL: Record<string, string> = {
  essencial: "Essencial",
  clinica: "Clínica",
  rede: "Rede",
  custom: "Customizado",
};

function formatBrl(cents: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

function formatUsd(micros: number): string {
  return "$" + (micros / 1_000_000).toFixed(2);
}

function startOfMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function microsBrlCents(micros: number): number {
  return Math.round((micros / 1_000_000) * USD_TO_BRL * 100);
}

function formatUsdAmount(usd: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
  }).format(usd);
}

type ClinicFinancial = {
  id: string;
  name: string;
  plan: string;
  operationalStatus: ClinicOperationalStatus;
  monthlyRevenueBrl: number;
  billingStartedAt: Date | null;
  aiCostMicros: number;
  ttsCostMicros: number;
  waCostMicros: number;
  isTest: boolean;
};

async function fetchClinicFinancials(): Promise<ClinicFinancial[]> {
  const monthStart = startOfMonth();

  const allClinics = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      plan: organizations.plan,
      operationalStatus: organizations.operationalStatus,
      monthlyRevenueBrl: organizations.monthlyRevenueBrl,
      billingStartedAt: organizations.billingStartedAt,
      isTest: organizations.isTest,
    })
    .from(organizations)
    .orderBy(organizations.name);

  return Promise.all(
    allClinics.map(async (clinic) => {
      const [aiResult, ttsResult, waResult] = await Promise.all([
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
          .select({ total: sum(ttsUsageCosts.estimatedCostUsdMicros) })
          .from(ttsUsageCosts)
          .where(
            and(
              eq(ttsUsageCosts.clinicId, clinic.id),
              gte(ttsUsageCosts.createdAt, monthStart),
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
      ]);

      return {
        id: clinic.id,
        name: clinic.name,
        plan: clinic.plan,
        operationalStatus: clinic.operationalStatus,
        monthlyRevenueBrl: clinic.monthlyRevenueBrl,
        billingStartedAt: clinic.billingStartedAt
          ? new Date(clinic.billingStartedAt)
          : null,
        aiCostMicros: Number(aiResult[0]?.total ?? 0),
        ttsCostMicros: Number(ttsResult[0]?.total ?? 0),
        waCostMicros: Number(waResult[0]?.total ?? 0),
        isTest: clinic.isTest,
      };
    }),
  );
}

export default async function FinanceiroPage() {
  const monthStart = startOfMonth();
  const [allClinics, vercelSpendAlert] = await Promise.all([
    fetchClinicFinancials(),
    new DrizzlePlatformSpendAlertStore().findLatest("vercel", monthStart),
  ]);

  const billableClinics = allClinics.filter((c) =>
    isBillableOperationalStatus(c.operationalStatus),
  );
  const activeClinics = allClinics.filter(
    (c) => c.operationalStatus === "active",
  );
  const pausedClinics = allClinics.filter(
    (c) => c.operationalStatus === "paused",
  );
  const testClinics = allClinics.filter((c) => c.operationalStatus === "test");
  const prospectClinics = allClinics.filter(
    (c) => c.operationalStatus === "prospect",
  );
  const cancelledClinics = allClinics.filter(
    (c) => c.operationalStatus === "cancelled",
  );

  const nProdClinics = billableClinics.length;
  const nTestClinics = testClinics.length;

  // MRR de produção (centavos)
  const mrr = billableClinics.reduce((s, c) => s + c.monthlyRevenueBrl, 0);

  // Custos de infra de produção este mês (BRL centavos)
  const vercelOverageBrl = vercelSpendAlert
    ? vercelSpendUsdToBrlCents(vercelSpendAlert.currentSpendUsd)
    : 0;
  const infraFixed = INFRA_FIXED_BRL.vercel + INFRA_FIXED_BRL.neon;
  const infraVar = nProdClinics * INFRA_FIXED_BRL.zapi_per_clinic;
  const infraTotal = infraFixed + infraVar + vercelOverageBrl;

  // Custos variáveis de IA+TTS+WA de produção
  const aiWaTotal = billableClinics.reduce(
    (s, c) => s + microsBrlCents(c.aiCostMicros + c.ttsCostMicros + c.waCostMicros),
    0,
  );

  const totalCosts = infraTotal + aiWaTotal;
  const grossProfit = mrr - totalCosts;
  const grossMarginPct = mrr > 0 ? Math.round((grossProfit / mrr) * 100) : 0;

  // Custo de testes
  const testZapiCost = nTestClinics * INFRA_FIXED_BRL.zapi_per_clinic;
  const testAiWaCost = testClinics.reduce(
    (s, c) => s + microsBrlCents(c.aiCostMicros + c.ttsCostMicros + c.waCostMicros),
    0,
  );
  const totalTestCost = testZapiCost + testAiWaCost;

  const unconfiguredClinics = billableClinics.filter(
    (c) => c.plan === "custom" && c.monthlyRevenueBrl === 0,
  );

  return (
    <div>
      <div className="product-topbar">
        <div
          className="owner-page-header"
          style={{ display: "flex", alignItems: "center", gap: 14 }}
        >
          <Link
            href="/owner"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              color: "var(--muted)",
              textDecoration: "none",
              fontSize: 13,
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            <ArrowLeft size={14} />
            Visão geral
          </Link>
          <span
            className="owner-page-header-sep"
            style={{ color: "var(--line-strong)" }}
          >
            ·
          </span>
          <div className="owner-page-header-title">
            <h1 style={{ margin: 0 }}>Financeiro</h1>
            <p
              style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)" }}
            >
              Mês atual · {activeClinics.length} ativa
              {activeClinics.length !== 1 ? "s" : ""}
              {pausedClinics.length > 0 &&
                ` · ${pausedClinics.length} pausada${pausedClinics.length !== 1 ? "s" : ""}`}
              {prospectClinics.length > 0 &&
                ` · ${prospectClinics.length} prospect${prospectClinics.length !== 1 ? "s" : ""}`}
              {testClinics.length > 0 &&
                ` · ${testClinics.length} teste${testClinics.length !== 1 ? "s" : ""}`}
            </p>
          </div>
        </div>
      </div>

      <div
        className="page-content"
        style={{ paddingBottom: 60, display: "grid", gap: 32 }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 10,
          }}
        >
          {[
            { label: "Ativas", value: activeClinics.length, color: "#34d399" },
            {
              label: "Pausadas",
              value: pausedClinics.length,
              color: "#f59e0b",
            },
            {
              label: "Prospects",
              value: prospectClinics.length,
              color: "#60a5fa",
            },
            { label: "Testes", value: testClinics.length, color: "#818cf8" },
          ].map((item) => (
            <div
              key={item.label}
              style={{
                border: `1px solid ${item.color}33`,
                borderRadius: 12,
                padding: "14px 16px",
                background: `${item.color}10`,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: item.color,
                }}
              >
                {item.label}
              </div>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 24,
                  fontWeight: 800,
                  color: item.color,
                }}
              >
                {item.value}
              </div>
            </div>
          ))}
        </div>

        {/* Alerta de clínicas sem valor configurado */}
        {unconfiguredClinics.length > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              border: "1px solid rgba(245,158,11,0.25)",
              borderRadius: 12,
              background: "rgba(245,158,11,0.05)",
              padding: "14px 18px",
            }}
          >
            <AlertCircle
              size={16}
              style={{ color: "var(--warning)", flexShrink: 0 }}
            />
            <p style={{ margin: 0, fontSize: 13, color: "var(--text-soft)" }}>
              <strong>{unconfiguredClinics.length} clínica(s)</strong> sem plano
              configurado: {unconfiguredClinics.map((c) => c.name).join(", ")}.
              Configure o plano na tabela abaixo.
            </p>
          </div>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            border: `1px solid ${
              vercelSpendAlert?.thresholdPercent === 100
                ? "rgba(239,68,68,0.35)"
                : vercelSpendAlert?.thresholdPercent === 75
                  ? "rgba(245,158,11,0.35)"
                  : "var(--line)"
            }`,
            borderRadius: 12,
            background:
              vercelSpendAlert?.thresholdPercent === 100
                ? "rgba(239,68,68,0.06)"
                : vercelSpendAlert?.thresholdPercent === 75
                  ? "rgba(245,158,11,0.06)"
                  : "var(--surface-soft)",
            padding: "14px 18px",
          }}
        >
          <AlertCircle
            size={16}
            style={{
              color:
                vercelSpendAlert?.thresholdPercent === 100
                  ? "var(--danger)"
                  : vercelSpendAlert?.thresholdPercent === 75
                    ? "var(--warning)"
                    : "var(--accent-strong)",
              flexShrink: 0,
              marginTop: 1,
            }}
          />
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-soft)" }}>
            <strong>Vercel Pro:</strong> custo base de {formatBrl(INFRA_FIXED_BRL.vercel)} / mês ({formatUsdAmount(VERCEL_PRO_PLATFORM_FEE_USD_CENTS / 100)}).
            {vercelSpendAlert ? (
              <>
                {" "}O Spend Management sinalizou {vercelSpendAlert.thresholdPercent}% do teto: {formatUsdAmount(vercelSpendAlert.currentSpendUsd)} de {formatUsdAmount(vercelSpendAlert.budgetAmountUsd)} em excedente, recebido em {vercelSpendAlert.receivedAt.toLocaleDateString("pt-BR")}.
              </>
            ) : (
              " Nenhum excedente foi sinalizado ainda. Configure o webhook de Spend Management para registrar os alertas de 50%, 75% e 100%."
            )}
          </p>
        </div>

        {/* KPIs financeiros — produção */}
        <div className="kpi-strip">
          <div className="metric metric-highlight">
            <div className="metric-header">
              <span className="metric-icon">
                <DollarSign size={14} />
              </span>
              <span className="metric-label">MRR</span>
            </div>
            <span
              className="metric-value"
              style={{ fontSize: 22, letterSpacing: "-0.03em" }}
            >
              {formatBrl(mrr)}
            </span>
            <span className="metric-context">
              {nProdClinics} clínica{nProdClinics !== 1 ? "s" : ""} ativas
            </span>
          </div>

          <div className="metric">
            <div className="metric-header">
              <span className="metric-icon">
                <TrendingUp size={14} />
              </span>
              <span className="metric-label">Lucro bruto</span>
            </div>
            <span
              className="metric-value"
              style={{
                fontSize: 20,
                letterSpacing: "-0.03em",
                color:
                  grossProfit >= 0 ? "var(--accent-strong)" : "var(--danger)",
              }}
            >
              {formatBrl(grossProfit)}
            </span>
            <span className="metric-context">receita − custos diretos</span>
          </div>

          <div className="metric">
            <div className="metric-header">
              <span className="metric-icon">
                <Percent size={14} />
              </span>
              <span className="metric-label">Margem bruta</span>
            </div>
            <span
              className="metric-value"
              style={{
                color:
                  grossMarginPct >= 70
                    ? "var(--accent-strong)"
                    : grossMarginPct >= 40
                      ? "var(--warning)"
                      : "var(--danger)",
              }}
            >
              {grossMarginPct}%
            </span>
            <span className="metric-context">meta: &gt; 70%</span>
          </div>

          <div className="metric">
            <div className="metric-header">
              <span className="metric-icon">
                <DollarSign size={14} />
              </span>
              <span className="metric-label">Custo infra</span>
            </div>
            <span
              className="metric-value"
              style={{ fontSize: 18, letterSpacing: "-0.02em" }}
            >
              {formatBrl(infraTotal)}
            </span>
            <span className="metric-context">Vercel + Neon + Z-API</span>
          </div>

          <div className="metric">
            <div className="metric-header">
              <span className="metric-icon">
                <DollarSign size={14} />
              </span>
              <span className="metric-label">Custo IA + WA</span>
            </div>
            <span
              className="metric-value"
              style={{ fontSize: 18, letterSpacing: "-0.02em" }}
            >
              {formatBrl(aiWaTotal)}
            </span>
            <span className="metric-context">OpenAI + mensagens</span>
          </div>
        </div>

        {/* Breakdown de custos */}
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
              Breakdown de custos — mês atual
            </p>
          </div>

          {/* Layout mobile: lista de linhas com valor visível */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            {[
              {
                label: "Vercel",
                note: vercelSpendAlert
                  ? `Pro ${formatUsdAmount(VERCEL_PRO_PLATFORM_FEE_USD_CENTS / 100)} + excedente alertado ${formatUsdAmount(vercelSpendAlert.currentSpendUsd)}`
                  : `Pro ${formatUsdAmount(VERCEL_PRO_PLATFORM_FEE_USD_CENTS / 100)} · sem excedente alertado`,
                value: INFRA_FIXED_BRL.vercel + vercelOverageBrl,
              },
              {
                label: "Neon (PostgreSQL)",
                note: "Free tier — gratuito",
                value: INFRA_FIXED_BRL.neon,
              },
              {
                label: `Z-API (${nProdClinics} instância${nProdClinics !== 1 ? "s" : ""})`,
                note: `${nProdClinics} × R$79,99`,
                value: infraVar,
              },
              {
                label: "OpenAI API",
                note: "variável",
                value: microsBrlCents(
                  billableClinics.reduce((s, c) => s + c.aiCostMicros, 0),
                ),
              },
              {
                label: "ElevenLabs (B-WAVE)",
                note: "variável · ~$0,30/1k chars",
                value: microsBrlCents(
                  billableClinics.reduce((s, c) => s + c.ttsCostMicros, 0),
                ),
              },
              {
                label: "WhatsApp (Meta msgs)",
                note: "variável",
                value: microsBrlCents(
                  billableClinics.reduce((s, c) => s + c.waCostMicros, 0),
                ),
              },
            ].map((row, i) => (
              <div
                key={row.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "12px 18px",
                  borderBottom: "1px solid var(--line)",
                  background:
                    i % 2 === 1 ? "var(--surface-soft)" : "transparent",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <span
                    style={{ fontSize: 13, fontWeight: 600, display: "block" }}
                  >
                    {row.label}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>
                    {row.note}
                  </span>
                </div>
                <span
                  style={{
                    fontWeight: 700,
                    fontFamily: "monospace",
                    fontSize: 13,
                    flexShrink: 0,
                  }}
                >
                  {formatBrl(row.value)}
                </span>
              </div>
            ))}

            {/* Custo de testes como linha destacada */}
            {nTestClinics > 0 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "12px 18px",
                  borderBottom: "1px solid var(--line)",
                  background: "rgba(99,102,241,0.05)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    minWidth: 0,
                  }}
                >
                  <FlaskConical
                    size={13}
                    style={{ color: "#818cf8", flexShrink: 0 }}
                  />
                  <div>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        display: "block",
                        color: "#818cf8",
                      }}
                    >
                      Infra de testes ({nTestClinics} clínica
                      {nTestClinics !== 1 ? "s" : ""})
                    </span>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>
                      Z-API + IA · não entra no MRR
                    </span>
                  </div>
                </div>
                <span
                  style={{
                    fontWeight: 700,
                    fontFamily: "monospace",
                    fontSize: 13,
                    flexShrink: 0,
                    color: "#818cf8",
                  }}
                >
                  {formatBrl(totalTestCost)}
                </span>
              </div>
            )}

            {/* Total */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "13px 18px",
                background: "var(--accent-soft)",
                borderTop: "2px solid var(--accent)",
              }}
            >
              <span
                style={{
                  fontWeight: 800,
                  color: "var(--accent-strong)",
                  fontSize: 13,
                }}
              >
                Total custos produção
              </span>
              <span
                style={{
                  fontWeight: 800,
                  fontFamily: "monospace",
                  fontSize: 14,
                  color: "var(--accent-strong)",
                }}
              >
                {formatBrl(totalCosts)}
              </span>
            </div>
          </div>
        </div>

        {/* Receita por clínica — produção */}
        {billableClinics.length > 0 && (
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
                Receita por clínica operacional
              </p>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {billableClinics.map((clinic, i) => {
                const aiWaBrl = microsBrlCents(
                  clinic.aiCostMicros + clinic.ttsCostMicros + clinic.waCostMicros,
                );
                const planLabel = PLAN_LABEL[clinic.plan] ?? clinic.plan;
                const planDefault = PLAN_PRICE_BRL[clinic.plan] ?? 0;
                const revenueMismatch =
                  clinic.plan !== "custom" &&
                  clinic.monthlyRevenueBrl !== planDefault;

                return (
                  <div
                    key={clinic.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "13px 18px",
                      borderBottom:
                        i < billableClinics.length - 1
                          ? "1px solid var(--line)"
                          : "none",
                      background:
                        i % 2 === 1 ? "var(--surface-soft)" : "transparent",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          marginBottom: 3,
                        }}
                      >
                        <span style={{ fontWeight: 700, fontSize: 13 }}>
                          {clinic.name}
                        </span>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: "var(--muted)",
                          }}
                        >
                          {getClinicOperationalStatusLabel(
                            clinic.operationalStatus,
                          )}
                        </span>
                        <span
                          style={{
                            display: "inline-block",
                            border: "1px solid var(--line)",
                            borderRadius: 6,
                            background: "var(--surface-soft)",
                            fontSize: 10,
                            fontWeight: 700,
                            padding: "2px 7px",
                            color:
                              clinic.plan === "rede"
                                ? "var(--accent-strong)"
                                : clinic.plan === "avancado"
                                  ? "var(--text)"
                                  : "var(--muted)",
                          }}
                        >
                          {planLabel}
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: 11,
                          color: "var(--muted)",
                          fontFamily: "monospace",
                        }}
                      >
                        IA+TTS+WA:{" "}
                        {formatUsd(clinic.aiCostMicros + clinic.ttsCostMicros + clinic.waCostMicros)} ·{" "}
                        {formatBrl(aiWaBrl)}
                      </span>
                      {clinic.billingStartedAt && (
                        <span
                          style={{
                            fontSize: 11,
                            color: "var(--muted)",
                            marginLeft: 8,
                          }}
                        >
                          desde{" "}
                          {clinic.billingStartedAt.toLocaleDateString("pt-BR", {
                            month: "short",
                            year: "numeric",
                          })}
                        </span>
                      )}
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <span
                        style={{
                          fontWeight: 700,
                          fontSize: 14,
                          display: "block",
                        }}
                      >
                        {formatBrl(clinic.monthlyRevenueBrl)}
                        {revenueMismatch && (
                          <span
                            style={{
                              marginLeft: 5,
                              fontSize: 11,
                              color: "var(--warning)",
                            }}
                            title="Valor diverge do preço padrão do plano"
                          >
                            ⚠
                          </span>
                        )}
                      </span>
                      <span style={{ fontSize: 10, color: "var(--muted)" }}>
                        / mês
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {prospectClinics.length > 0 && (
          <div
            style={{
              border: "1px solid rgba(59,130,246,0.24)",
              borderRadius: 12,
              overflow: "hidden",
              background: "rgba(59,130,246,0.03)",
            }}
          >
            <div
              style={{
                padding: "14px 18px 12px",
                borderBottom: "1px solid rgba(59,130,246,0.16)",
                background: "rgba(59,130,246,0.06)",
              }}
            >
              <p className="eyebrow" style={{ margin: 0, color: "#60a5fa" }}>
                Prospects fora do MRR
              </p>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {prospectClinics.map((clinic, i) => (
                <div
                  key={clinic.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "13px 18px",
                    borderBottom:
                      i < prospectClinics.length - 1
                        ? "1px solid rgba(59,130,246,0.1)"
                        : "none",
                  }}
                >
                  <div>
                    <span
                      style={{
                        fontWeight: 700,
                        fontSize: 13,
                        display: "block",
                        color: "#60a5fa",
                      }}
                    >
                      {clinic.name}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>
                      Ainda não entra no MRR nem na margem operacional
                    </span>
                  </div>
                  <span
                    style={{ fontSize: 11, fontWeight: 700, color: "#60a5fa" }}
                  >
                    {getClinicOperationalStatusLabel(clinic.operationalStatus)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Clínicas de teste */}
        {testClinics.length > 0 && (
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
                Ambiente de testes — custo real sem receita
              </p>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {testClinics.map((clinic, i) => {
                const aiWaBrl = microsBrlCents(
                  clinic.aiCostMicros + clinic.ttsCostMicros + clinic.waCostMicros,
                );
                const clinicTotal = INFRA_FIXED_BRL.zapi_per_clinic + aiWaBrl;

                return (
                  <div
                    key={clinic.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "13px 18px",
                      borderBottom:
                        i < testClinics.length - 1
                          ? "1px solid rgba(99,102,241,0.15)"
                          : "none",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <span
                        style={{
                          fontWeight: 700,
                          fontSize: 13,
                          display: "block",
                          marginBottom: 3,
                        }}
                      >
                        {clinic.name}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>
                        Z-API {formatBrl(INFRA_FIXED_BRL.zapi_per_clinic)} + IA{" "}
                        {formatBrl(aiWaBrl)}
                      </span>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <span
                        style={{
                          fontWeight: 700,
                          fontSize: 14,
                          display: "block",
                          color: "#818cf8",
                        }}
                      >
                        {formatBrl(clinicTotal)}
                      </span>
                      <span style={{ fontSize: 10, color: "var(--muted)" }}>
                        / mês
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {cancelledClinics.length > 0 && (
          <div
            style={{
              border: "1px solid rgba(239,68,68,0.2)",
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
              {cancelledClinics.map((clinic, i) => (
                <div
                  key={clinic.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "13px 18px",
                    borderBottom:
                      i < cancelledClinics.length - 1
                        ? "1px solid rgba(239,68,68,0.1)"
                        : "none",
                  }}
                >
                  <span
                    style={{ fontWeight: 700, fontSize: 13, color: "#f87171" }}
                  >
                    {clinic.name}
                  </span>
                  <span
                    style={{ fontSize: 11, fontWeight: 700, color: "#f87171" }}
                  >
                    {getClinicOperationalStatusLabel(clinic.operationalStatus)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Benchmark do piloto — dados reais auditados jun/2026 */}
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
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Activity size={13} style={{ color: "var(--accent-strong)" }} />
            <p className="eyebrow" style={{ margin: 0 }}>
              Benchmark do piloto — Ximendes Odontologia (jun/2026)
            </p>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
              gap: 0,
            }}
          >
            {[
              {
                label: "Custo total/mês",
                value: "R$ 185,49",
                note: "Vercel Pro R$103 + Z-API R$79,99 + OpenAI R$2,50",
              },
              {
                label: "Receita (Starter)",
                value: "R$ 897,00",
                note: "plano confirmado",
              },
              {
                label: "Margem bruta",
                value: "79%",
                note: "R$ 712/mês de lucro bruto",
                highlight: true,
              },
              {
                label: "Custo por lead",
                value: "R$ 2,29",
                note: "36 leads no período",
              },
              {
                label: "Custo por agendamento",
                value: "R$ 6,87",
                note: "12 agendamentos",
              },
              {
                label: "Custo OpenAI (IA)",
                value: "R$ 2,11",
                note: "$0.41 em 12 dias de piloto",
              },
            ].map((item) => (
              <div
                key={item.label}
                style={{
                  padding: "14px 18px",
                  borderRight: "1px solid var(--line)",
                  borderBottom: "1px solid var(--line)",
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--muted)",
                    display: "block",
                    marginBottom: 4,
                  }}
                >
                  {item.label}
                </span>
                <span
                  style={{
                    fontSize: 18,
                    fontWeight: 800,
                    letterSpacing: "-0.03em",
                    color: item.highlight
                      ? "var(--accent-strong)"
                      : "var(--text)",
                    display: "block",
                  }}
                >
                  {item.value}
                </span>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>
                  {item.note}
                </span>
              </div>
            ))}
          </div>
          <div
            style={{
              padding: "10px 18px",
              background: "var(--surface-soft)",
              borderTop: "1px solid var(--line)",
            }}
          >
            <p style={{ margin: 0, fontSize: 11, color: "var(--muted)" }}>
              Projeção para 5 clínicas: ~R$518/mês de custo · ~R$4.485/mês MRR ·
              margem ~88%. Inclui Vercel Pro; Neon permanece no free tier enquanto
              a franquia comportar a operação.
            </p>
          </div>
        </div>

        {/* Nota de cotação */}
        <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
          Cotação USD/BRL utilizada: R${USD_TO_BRL.toFixed(2)} (estimativa
          estática). Custos de IA em USD são convertidos apenas para referência.
          {(nTestClinics > 0 || prospectClinics.length > 0) &&
            " Clínicas de teste e prospect são excluídas do MRR e da margem."}{" "}
          Custos de infra auditados em jun/2026: Vercel Pro ({formatBrl(INFRA_FIXED_BRL.vercel)}), Neon Free
          (R$0), Z-API R$79,99/instância. O Spend Management da Vercel mede
          apenas excedente de uso, não a mensalidade do plano.
        </p>
      </div>
    </div>
  );
}
