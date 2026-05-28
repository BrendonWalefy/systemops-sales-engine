export const dynamic = "force-dynamic";

import Link from "next/link";
import { db } from "@/infrastructure/db/client";
import {
  clinics,
  aiUsageCosts,
  whatsappMessageCosts,
} from "@/infrastructure/db/schema";
import { eq, sum, and, gte } from "drizzle-orm";
import { TrendingUp, DollarSign, Percent, AlertCircle, ArrowLeft, FlaskConical } from "lucide-react";

// Custos de infra mensais em BRL (centavos)
const INFRA_FIXED_BRL = {
  vercel: 10000,        // R$ 100 (Pro plan ~$20 ≈ R$100)
  neon: 9500,           // R$ 95
  zapi_per_clinic: 15000, // R$ 150 por clínica (instância dedicada)
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

// Cotação USD/BRL aproximada (fallback estático)
const USD_TO_BRL = 5.15;

function microsBrlCents(micros: number): number {
  return Math.round((micros / 1_000_000) * USD_TO_BRL * 100);
}

type ClinicFinancial = {
  id: string;
  name: string;
  plan: string;
  monthlyRevenueBrl: number;
  billingStartedAt: Date | null;
  aiCostMicros: number;
  waCostMicros: number;
  isTest: boolean;
};

async function fetchClinicFinancials(): Promise<ClinicFinancial[]> {
  const monthStart = startOfMonth();

  const allClinics = await db
    .select({
      id: clinics.id,
      name: clinics.name,
      plan: clinics.plan,
      monthlyRevenueBrl: clinics.monthlyRevenueBrl,
      billingStartedAt: clinics.billingStartedAt,
      isTest: clinics.isTest,
    })
    .from(clinics)
    .orderBy(clinics.name);

  return Promise.all(
    allClinics.map(async (clinic) => {
      const [aiResult, waResult] = await Promise.all([
        db
          .select({ total: sum(aiUsageCosts.estimatedCostUsdMicros) })
          .from(aiUsageCosts)
          .where(and(eq(aiUsageCosts.clinicId, clinic.id), gte(aiUsageCosts.createdAt, monthStart))),

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
        monthlyRevenueBrl: clinic.monthlyRevenueBrl,
        billingStartedAt: clinic.billingStartedAt ? new Date(clinic.billingStartedAt) : null,
        aiCostMicros: Number(aiResult[0]?.total ?? 0),
        waCostMicros: Number(waResult[0]?.total ?? 0),
        isTest: clinic.isTest,
      };
    }),
  );
}

export default async function FinanceiroPage() {
  const allClinics = await fetchClinicFinancials();

  const prodClinics = allClinics.filter((c) => !c.isTest);
  const testClinics = allClinics.filter((c) => c.isTest);

  const nProdClinics = prodClinics.length;
  const nTestClinics = testClinics.length;

  // MRR de produção (centavos)
  const mrr = prodClinics.reduce((s, c) => s + c.monthlyRevenueBrl, 0);

  // Custos de infra de produção este mês (BRL centavos)
  const infraFixed = INFRA_FIXED_BRL.vercel + INFRA_FIXED_BRL.neon;
  const infraVar = nProdClinics * INFRA_FIXED_BRL.zapi_per_clinic;
  const infraTotal = infraFixed + infraVar;

  // Custos variáveis de IA+WA de produção
  const aiWaTotal = prodClinics.reduce(
    (s, c) => s + microsBrlCents(c.aiCostMicros + c.waCostMicros),
    0,
  );

  const totalCosts = infraTotal + aiWaTotal;
  const grossProfit = mrr - totalCosts;
  const grossMarginPct = mrr > 0 ? Math.round((grossProfit / mrr) * 100) : 0;

  // Custo de testes
  const testZapiCost = nTestClinics * INFRA_FIXED_BRL.zapi_per_clinic;
  const testAiWaCost = testClinics.reduce(
    (s, c) => s + microsBrlCents(c.aiCostMicros + c.waCostMicros),
    0,
  );
  const totalTestCost = testZapiCost + testAiWaCost;

  const unconfiguredClinics = prodClinics.filter((c) => c.plan === "custom" && c.monthlyRevenueBrl === 0);

  return (
    <div>
      <div className="product-topbar">
        <div className="owner-page-header" style={{ display: "flex", alignItems: "center", gap: 14 }}>
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
          <span className="owner-page-header-sep" style={{ color: "var(--line-strong)" }}>·</span>
          <div className="owner-page-header-title">
            <h1 style={{ margin: 0 }}>Financeiro</h1>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)" }}>
              Mês atual · Receita, custos e margens
            </p>
          </div>
        </div>
      </div>

      <div className="page-content" style={{ paddingBottom: 60, display: "grid", gap: 32 }}>

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
            <AlertCircle size={16} style={{ color: "var(--warning)", flexShrink: 0 }} />
            <p style={{ margin: 0, fontSize: 13, color: "var(--text-soft)" }}>
              <strong>{unconfiguredClinics.length} clínica(s)</strong> sem plano configurado:{" "}
              {unconfiguredClinics.map((c) => c.name).join(", ")}. Configure o plano na tabela abaixo.
            </p>
          </div>
        )}

        {/* KPIs financeiros — produção */}
        <div className="kpi-strip">
          <div className="metric metric-highlight">
            <div className="metric-header">
              <span className="metric-icon"><DollarSign size={14} /></span>
              <span className="metric-label">MRR</span>
            </div>
            <span className="metric-value" style={{ fontSize: 22, letterSpacing: "-0.03em" }}>
              {formatBrl(mrr)}
            </span>
            <span className="metric-context">{nProdClinics} clínica{nProdClinics !== 1 ? "s" : ""} ativas</span>
          </div>

          <div className="metric">
            <div className="metric-header">
              <span className="metric-icon"><TrendingUp size={14} /></span>
              <span className="metric-label">Lucro bruto</span>
            </div>
            <span
              className="metric-value"
              style={{
                fontSize: 20,
                letterSpacing: "-0.03em",
                color: grossProfit >= 0 ? "var(--accent-strong)" : "var(--danger)",
              }}
            >
              {formatBrl(grossProfit)}
            </span>
            <span className="metric-context">receita − custos diretos</span>
          </div>

          <div className="metric">
            <div className="metric-header">
              <span className="metric-icon"><Percent size={14} /></span>
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
              <span className="metric-icon"><DollarSign size={14} /></span>
              <span className="metric-label">Custo infra</span>
            </div>
            <span className="metric-value" style={{ fontSize: 18, letterSpacing: "-0.02em" }}>
              {formatBrl(infraTotal)}
            </span>
            <span className="metric-context">Vercel + Neon + Z-API</span>
          </div>

          <div className="metric">
            <div className="metric-header">
              <span className="metric-icon"><DollarSign size={14} /></span>
              <span className="metric-label">Custo IA + WA</span>
            </div>
            <span className="metric-value" style={{ fontSize: 18, letterSpacing: "-0.02em" }}>
              {formatBrl(aiWaTotal)}
            </span>
            <span className="metric-context">OpenAI + mensagens</span>
          </div>
        </div>

        {/* Breakdown de custos */}
        <div style={{ border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
          <div
            style={{
              padding: "14px 18px 12px",
              borderBottom: "1px solid var(--line)",
              background: "var(--surface-soft)",
            }}
          >
            <p className="eyebrow" style={{ margin: 0 }}>Breakdown de custos — mês atual</p>
          </div>

          {/* Layout mobile: lista de linhas com valor visível */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            {[
              { label: "Vercel Pro", note: "fixo", value: INFRA_FIXED_BRL.vercel },
              { label: "Neon (PostgreSQL)", note: "fixo", value: INFRA_FIXED_BRL.neon },
              {
                label: `Z-API produção (${nProdClinics} instância${nProdClinics !== 1 ? "s" : ""})`,
                note: `${nProdClinics} × R$150`,
                value: infraVar,
              },
              {
                label: "OpenAI API",
                note: "variável",
                value: microsBrlCents(prodClinics.reduce((s, c) => s + c.aiCostMicros, 0)),
              },
              {
                label: "WhatsApp (Meta msgs)",
                note: "variável",
                value: microsBrlCents(prodClinics.reduce((s, c) => s + c.waCostMicros, 0)),
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
                  background: i % 2 === 1 ? "var(--surface-soft)" : "transparent",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, display: "block" }}>{row.label}</span>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>{row.note}</span>
                </div>
                <span style={{ fontWeight: 700, fontFamily: "monospace", fontSize: 13, flexShrink: 0 }}>
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
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <FlaskConical size={13} style={{ color: "#818cf8", flexShrink: 0 }} />
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 600, display: "block", color: "#818cf8" }}>
                      Infra de testes ({nTestClinics} clínica{nTestClinics !== 1 ? "s" : ""})
                    </span>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>
                      Z-API + IA · não entra no MRR
                    </span>
                  </div>
                </div>
                <span style={{ fontWeight: 700, fontFamily: "monospace", fontSize: 13, flexShrink: 0, color: "#818cf8" }}>
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
              <span style={{ fontWeight: 800, color: "var(--accent-strong)", fontSize: 13 }}>
                Total custos produção
              </span>
              <span style={{ fontWeight: 800, fontFamily: "monospace", fontSize: 14, color: "var(--accent-strong)" }}>
                {formatBrl(totalCosts)}
              </span>
            </div>
          </div>
        </div>

        {/* Receita por clínica — produção */}
        {prodClinics.length > 0 && (
          <div style={{ border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
            <div
              style={{
                padding: "14px 18px 12px",
                borderBottom: "1px solid var(--line)",
                background: "var(--surface-soft)",
              }}
            >
              <p className="eyebrow" style={{ margin: 0 }}>Receita por clínica</p>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {prodClinics.map((clinic, i) => {
                const aiWaBrl = microsBrlCents(clinic.aiCostMicros + clinic.waCostMicros);
                const planLabel = PLAN_LABEL[clinic.plan] ?? clinic.plan;
                const planDefault = PLAN_PRICE_BRL[clinic.plan] ?? 0;
                const revenueMismatch = clinic.plan !== "custom" && clinic.monthlyRevenueBrl !== planDefault;

                return (
                  <div
                    key={clinic.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "13px 18px",
                      borderBottom: i < prodClinics.length - 1 ? "1px solid var(--line)" : "none",
                      background: i % 2 === 1 ? "var(--surface-soft)" : "transparent",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                        <span style={{ fontWeight: 700, fontSize: 13 }}>{clinic.name}</span>
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
                                : clinic.plan === "clinica"
                                  ? "var(--text)"
                                  : "var(--muted)",
                          }}
                        >
                          {planLabel}
                        </span>
                      </div>
                      <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "monospace" }}>
                        IA+WA: {formatUsd(clinic.aiCostMicros + clinic.waCostMicros)} · {formatBrl(aiWaBrl)}
                      </span>
                      {clinic.billingStartedAt && (
                        <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 8 }}>
                          desde{" "}
                          {clinic.billingStartedAt.toLocaleDateString("pt-BR", { month: "short", year: "numeric" })}
                        </span>
                      )}
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <span style={{ fontWeight: 700, fontSize: 14, display: "block" }}>
                        {formatBrl(clinic.monthlyRevenueBrl)}
                        {revenueMismatch && (
                          <span style={{ marginLeft: 5, fontSize: 11, color: "var(--warning)" }} title="Valor diverge do preço padrão do plano">⚠</span>
                        )}
                      </span>
                      <span style={{ fontSize: 10, color: "var(--muted)" }}>/ mês</span>
                    </div>
                  </div>
                );
              })}
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
                const aiWaBrl = microsBrlCents(clinic.aiCostMicros + clinic.waCostMicros);
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
                      borderBottom: i < testClinics.length - 1 ? "1px solid rgba(99,102,241,0.15)" : "none",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <span style={{ fontWeight: 700, fontSize: 13, display: "block", marginBottom: 3 }}>
                        {clinic.name}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>
                        Z-API {formatBrl(INFRA_FIXED_BRL.zapi_per_clinic)} + IA {formatBrl(aiWaBrl)}
                      </span>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <span style={{ fontWeight: 700, fontSize: 14, display: "block", color: "#818cf8" }}>
                        {formatBrl(clinicTotal)}
                      </span>
                      <span style={{ fontSize: 10, color: "var(--muted)" }}>/ mês</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Nota de cotação */}
        <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
          Cotação USD/BRL utilizada: R${USD_TO_BRL.toFixed(2)} (estimativa estática). Custos de IA em USD são convertidos apenas para referência.
          {nTestClinics > 0 && " Clínicas de teste excluídas do MRR e da margem."}
        </p>
      </div>
    </div>
  );
}
