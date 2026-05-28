export const dynamic = "force-dynamic";

import Link from "next/link";
import { db } from "@/infrastructure/db/client";
import {
  clinics,
  aiUsageCosts,
  whatsappMessageCosts,
} from "@/infrastructure/db/schema";
import { eq, sum, and, gte } from "drizzle-orm";
import { TrendingUp, DollarSign, Percent, AlertCircle, ArrowLeft } from "lucide-react";

// Custos de infra mensais em BRL (centavos)
const INFRA_FIXED_BRL = {
  vercel: 10000,       // R$ 100 (Pro plan ~$20 ≈ R$100)
  neon: 9500,          // R$ 95 (R$19 ≈ R$95)
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

// Cotação USD/BRL aproximada (fallback estático para não depender de API)
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
      };
    }),
  );
}

export default async function FinanceiroPage() {
  const clinicData = await fetchClinicFinancials();
  const nClinics = clinicData.length;

  // MRR total (centavos)
  const mrr = clinicData.reduce((s, c) => s + c.monthlyRevenueBrl, 0);

  // Custos de infra este mês (BRL centavos)
  const infraFixed = INFRA_FIXED_BRL.vercel + INFRA_FIXED_BRL.neon;
  const infraVar = nClinics * INFRA_FIXED_BRL.zapi_per_clinic;
  const infraTotal = infraFixed + infraVar;

  // Custos variáveis de IA+WA (micros → BRL centavos)
  const aiWaTotal = clinicData.reduce(
    (s, c) => s + microsBrlCents(c.aiCostMicros + c.waCostMicros),
    0,
  );

  const totalCosts = infraTotal + aiWaTotal;
  const grossProfit = mrr - totalCosts;
  const grossMarginPct = mrr > 0 ? Math.round((grossProfit / mrr) * 100) : 0;

  const unconfiguredClinics = clinicData.filter((c) => c.plan === "custom" && c.monthlyRevenueBrl === 0);

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

        {/* KPIs financeiros */}
        <div className="kpi-strip">
          <div className="metric metric-highlight">
            <div className="metric-header">
              <span className="metric-icon"><DollarSign size={14} /></span>
              <span className="metric-label">MRR</span>
            </div>
            <span className="metric-value" style={{ fontSize: 22, letterSpacing: "-0.03em" }}>
              {formatBrl(mrr)}
            </span>
            <span className="metric-context">{nClinics} clínica{nClinics !== 1 ? "s" : ""} ativas</span>
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
            <span className="metric-context">OpenAI + Z-API mensagens</span>
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
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <tbody>
              {[
                { label: "Vercel Pro", value: INFRA_FIXED_BRL.vercel, note: "fixo" },
                { label: "Neon (PostgreSQL)", value: INFRA_FIXED_BRL.neon, note: "fixo" },
                {
                  label: `Z-API (${nClinics} instância${nClinics !== 1 ? "s" : ""})`,
                  value: infraVar,
                  note: `${nClinics} × R$150`,
                },
                { label: "OpenAI API", value: microsBrlCents(clinicData.reduce((s, c) => s + c.aiCostMicros, 0)), note: "variável" },
                { label: "WhatsApp (Meta/Z-API msgs)", value: microsBrlCents(clinicData.reduce((s, c) => s + c.waCostMicros, 0)), note: "variável" },
              ].map((row, i) => (
                <tr
                  key={row.label}
                  style={{
                    background: i % 2 === 1 ? "var(--surface-soft)" : "transparent",
                    borderBottom: "1px solid var(--line)",
                  }}
                >
                  <td style={{ padding: "11px 18px", fontWeight: 600 }}>{row.label}</td>
                  <td style={{ padding: "11px 18px", color: "var(--muted)", fontSize: 12 }}>{row.note}</td>
                  <td style={{ padding: "11px 18px", textAlign: "right", fontWeight: 700, fontFamily: "monospace" }}>
                    {formatBrl(row.value)}
                  </td>
                </tr>
              ))}
              <tr style={{ background: "var(--accent-soft)", borderTop: "2px solid var(--accent)" }}>
                <td style={{ padding: "12px 18px", fontWeight: 800, color: "var(--accent-strong)" }}>Total de custos</td>
                <td />
                <td style={{ padding: "12px 18px", textAlign: "right", fontWeight: 800, fontFamily: "monospace", color: "var(--accent-strong)" }}>
                  {formatBrl(totalCosts)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Tabela por clínica */}
        <div style={{ border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
          <div
            style={{
              padding: "14px 18px 12px",
              borderBottom: "1px solid var(--line)",
              background: "var(--surface-soft)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <p className="eyebrow" style={{ margin: 0 }}>Receita por clínica</p>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr
                  style={{
                    background: "var(--surface-soft)",
                    borderBottom: "1px solid var(--line)",
                  }}
                >
                  {["Clínica", "Plano", "MRR (BRL)", "Custo IA+WA (USD)", "Custo IA+WA (BRL est.)", "Ativa desde"].map((col) => (
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
                        whiteSpace: "nowrap",
                      }}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {clinicData.map((clinic, i) => {
                  const aiWaBrl = microsBrlCents(clinic.aiCostMicros + clinic.waCostMicros);
                  const aiWaUsd = clinic.aiCostMicros + clinic.waCostMicros;
                  const planLabel = PLAN_LABEL[clinic.plan] ?? clinic.plan;
                  const planDefault = PLAN_PRICE_BRL[clinic.plan] ?? 0;
                  const revenueMismatch =
                    clinic.plan !== "custom" && clinic.monthlyRevenueBrl !== planDefault;

                  return (
                    <tr
                      key={clinic.id}
                      style={{
                        background: i % 2 === 1 ? "var(--surface-soft)" : "transparent",
                        borderBottom: i < clinicData.length - 1 ? "1px solid var(--line)" : "none",
                      }}
                    >
                      <td style={{ padding: "12px 16px", fontWeight: 700 }}>{clinic.name}</td>
                      <td style={{ padding: "12px 16px" }}>
                        <span
                          style={{
                            display: "inline-block",
                            border: "1px solid var(--line)",
                            borderRadius: 6,
                            background: "var(--surface-soft)",
                            fontSize: 11,
                            fontWeight: 700,
                            padding: "3px 9px",
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
                      </td>
                      <td style={{ padding: "12px 16px", fontWeight: 700 }}>
                        {formatBrl(clinic.monthlyRevenueBrl)}
                        {revenueMismatch && (
                          <span
                            style={{ marginLeft: 6, fontSize: 11, color: "var(--warning)" }}
                            title="Valor diverge do preço padrão do plano"
                          >
                            ⚠
                          </span>
                        )}
                      </td>
                      <td
                        style={{
                          padding: "12px 16px",
                          fontFamily: "monospace",
                          fontSize: 12,
                          color: "var(--muted)",
                        }}
                      >
                        {formatUsd(aiWaUsd)}
                      </td>
                      <td
                        style={{
                          padding: "12px 16px",
                          fontFamily: "monospace",
                          fontSize: 12,
                          color: "var(--text-soft)",
                        }}
                      >
                        {formatBrl(aiWaBrl)}
                      </td>
                      <td style={{ padding: "12px 16px", color: "var(--muted)", fontSize: 12 }}>
                        {clinic.billingStartedAt
                          ? clinic.billingStartedAt.toLocaleDateString("pt-BR", {
                              month: "short",
                              year: "numeric",
                            })
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
                {clinicData.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ padding: "32px 18px", textAlign: "center", color: "var(--muted)" }}>
                      Nenhuma clínica cadastrada.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Nota de cotação */}
        <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
          Cotação USD/BRL utilizada: R${USD_TO_BRL.toFixed(2)} (estimativa estática). Custos de IA em USD são convertidos apenas para referência.
        </p>
      </div>
    </div>
  );
}
