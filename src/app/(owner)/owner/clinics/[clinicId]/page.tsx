export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ResetClinicDialog } from "./reset-clinic-dialog";
import { db } from "@/infrastructure/db/client";
import {
  clinics,
  clinicMembers,
  leads,
  aiUsageCosts,
  whatsappMessageCosts,
  conversations,
  messages,
  agentRecommendations,
} from "@/infrastructure/db/schema";
import { eq, count, sum, and, gte, desc, sql, notInArray } from "drizzle-orm";
import { ArrowLeft, ExternalLink, Flame, Thermometer, Snowflake, FlaskConical, Building2, KeyRound, UserPlus } from "lucide-react";
import { hashPassword } from "@/lib/password";

async function toggleIsTest(clinicId: string, currentValue: boolean) {
  "use server";
  await db
    .update(clinics)
    .set({ isTest: !currentValue })
    .where(eq(clinics.id, clinicId));
  redirect(`/owner/clinics/${clinicId}`);
}

async function upsertMemberPassword(clinicId: string, formData: FormData) {
  "use server";
  const email = (formData.get("email") as string)?.trim().toLowerCase();
  const password = formData.get("password") as string;
  if (!email || !password || password.length < 8) redirect(`/owner/clinics/${clinicId}?memberError=1`);
  const hash = await hashPassword(password);
  const existing = await db
    .select({ id: clinicMembers.id })
    .from(clinicMembers)
    .where(and(eq(clinicMembers.email, email), eq(clinicMembers.clinicId, clinicId)))
    .limit(1)
    .then((r) => r[0] ?? null);
  if (existing) {
    await db.update(clinicMembers).set({ passwordHash: hash }).where(eq(clinicMembers.id, existing.id));
  } else {
    await db.insert(clinicMembers).values({ clinicId, email, role: "clinic_admin", passwordHash: hash });
  }
  redirect(`/owner/clinics/${clinicId}?memberOk=1`);
}

function formatCurrency(micros: number): string {
  return "$" + (micros / 1_000_000).toFixed(4);
}

function relativeTime(date: Date | null): string {
  if (!date) return "—";
  const diff = Date.now() - date.getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d}d`;
}

function startOfMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function thirtyDaysAgo(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d;
}

export default async function ClinicDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ clinicId: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const { clinicId } = await params;
  const sp = await searchParams;
  const memberOk = sp.memberOk === "1";
  const memberError = sp.memberError === "1";

  const [clinic] = await db
    .select({
      id: clinics.id,
      name: clinics.name,
      autoReplyEnabled: clinics.autoReplyEnabled,
      isTest: clinics.isTest,
    })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
  if (!clinic) notFound();

  const toggleTestAction = toggleIsTest.bind(null, clinic.id, clinic.isTest);
  const upsertMemberAction = upsertMemberPassword.bind(null, clinic.id);

  const members = await db
    .select({ id: clinicMembers.id, email: clinicMembers.email, role: clinicMembers.role, hasPassword: clinicMembers.passwordHash })
    .from(clinicMembers)
    .where(eq(clinicMembers.clinicId, clinicId));

  const monthStart = startOfMonth();
  const thirtyDays = thirtyDaysAgo();

  const [
    leadsMonthResult,
    scheduledMonthResult,
    aiCostResult,
    waCostResult,
    tempHotResult,
    tempWarmResult,
    tempColdResult,
  ] = await Promise.all([
    db.select({ count: count() }).from(leads).where(and(eq(leads.clinicId, clinicId), gte(leads.createdAt, monthStart))),
    db.select({ count: count() }).from(leads).where(and(eq(leads.clinicId, clinicId), eq(leads.status, "appointment_scheduled"), gte(leads.createdAt, monthStart))),
    db.select({ total: sum(aiUsageCosts.estimatedCostUsdMicros) }).from(aiUsageCosts).where(and(eq(aiUsageCosts.clinicId, clinicId), gte(aiUsageCosts.createdAt, monthStart))),
    db.select({ total: sum(whatsappMessageCosts.estimatedCostUsdMicros) }).from(whatsappMessageCosts).where(and(eq(whatsappMessageCosts.clinicId, clinicId), gte(whatsappMessageCosts.createdAt, monthStart))),
    db.select({ count: count() }).from(leads).where(and(eq(leads.clinicId, clinicId), eq(leads.temperature, "hot"))),
    db.select({ count: count() }).from(leads).where(and(eq(leads.clinicId, clinicId), eq(leads.temperature, "warm"))),
    db.select({ count: count() }).from(leads).where(and(eq(leads.clinicId, clinicId), eq(leads.temperature, "cold"))),
  ]);

  const leadsCount = leadsMonthResult[0]?.count ?? 0;
  const scheduledCount = scheduledMonthResult[0]?.count ?? 0;
  const aiCost = Number(aiCostResult[0]?.total ?? 0);
  const waCost = Number(waCostResult[0]?.total ?? 0);
  const conversion = leadsCount > 0 ? ((scheduledCount / leadsCount) * 100).toFixed(1) : "0.0";
  const tempCounts = {
    hot: tempHotResult[0]?.count ?? 0,
    warm: tempWarmResult[0]?.count ?? 0,
    cold: tempColdResult[0]?.count ?? 0,
  };

  // Daily volume (last 30 days): leads created per day + messages sent per day
  const dailyLeadsResult = await db
    .select({
      day: sql<string>`DATE(${leads.createdAt} AT TIME ZONE 'America/Sao_Paulo')`,
      count: count(),
    })
    .from(leads)
    .where(and(eq(leads.clinicId, clinicId), gte(leads.createdAt, thirtyDays)))
    .groupBy(sql`DATE(${leads.createdAt} AT TIME ZONE 'America/Sao_Paulo')`)
    .orderBy(sql`DATE(${leads.createdAt} AT TIME ZONE 'America/Sao_Paulo') DESC`);

  const dailyMessagesResult = await db
    .select({
      day: sql<string>`DATE(${messages.sentAt} AT TIME ZONE 'America/Sao_Paulo')`,
      count: count(),
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(and(eq(conversations.clinicId, clinicId), gte(messages.sentAt, thirtyDays)))
    .groupBy(sql`DATE(${messages.sentAt} AT TIME ZONE 'America/Sao_Paulo')`)
    .orderBy(sql`DATE(${messages.sentAt} AT TIME ZONE 'America/Sao_Paulo') DESC`);

  // Merge daily data
  const dailyLeadsMap = Object.fromEntries(dailyLeadsResult.map((r) => [r.day, r.count]));
  const dailyMsgMap = Object.fromEntries(dailyMessagesResult.map((r) => [r.day, r.count]));
  const allDays = Array.from(
    new Set([...Object.keys(dailyLeadsMap), ...Object.keys(dailyMsgMap)]),
  ).sort((a, b) => b.localeCompare(a));

  // Handoff conversations (join with leads para mostrar nome)
  const handoffConvs = await db
    .select({
      convId: agentRecommendations.conversationId,
      leadId: agentRecommendations.leadId,
      createdAt: agentRecommendations.createdAt,
      leadName: leads.name,
      leadPhone: leads.phone,
    })
    .from(agentRecommendations)
    .leftJoin(leads, eq(agentRecommendations.leadId, leads.id))
    .where(
      and(
        eq(agentRecommendations.clinicId, clinicId),
        eq(agentRecommendations.handoffRequired, true),
      ),
    )
    .orderBy(desc(agentRecommendations.createdAt))
    .limit(10);

  // Conversas paradas: só leads ainda ativos (não finalizados), sem resposta há +1h
  const staleConvs = await db
    .select({
      id: conversations.id,
      lastMessageAt: conversations.lastMessageAt,
      leadId: conversations.leadId,
      leadName: leads.name,
      leadPhone: leads.phone,
    })
    .from(conversations)
    .leftJoin(leads, eq(conversations.leadId, leads.id))
    .where(
      and(
        eq(conversations.clinicId, clinicId),
        sql`${conversations.lastMessageAt} < NOW() - INTERVAL '1 hour'`,
        notInArray(leads.status, ["won", "lost", "appointment_scheduled"]),
      ),
    )
    .orderBy(desc(conversations.lastMessageAt))
    .limit(8);

  return (
    <div>
      {/* Header */}
      <div className="product-topbar">
        <div className="clinic-header-left" style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Link
            href="/owner"
            style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--muted)", textDecoration: "none", fontSize: 13, fontWeight: 600, flexShrink: 0 }}
          >
            <ArrowLeft size={14} />
            Visão geral
          </Link>
          <span className="clinic-header-sep" style={{ color: "var(--line-strong)" }}>·</span>
          <div className="clinic-header-title">
            <h1 style={{ margin: 0 }}>{clinic.name}</h1>
            <p style={{ margin: "3px 0 0", fontSize: 13, color: "var(--muted)" }}>
              Drill-down da clínica
            </p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {clinic.isTest && (
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                border: "1px solid rgba(99,102,241,0.35)",
                borderRadius: 999,
                background: "rgba(99,102,241,0.1)",
                color: "#818cf8",
                fontSize: 11,
                fontWeight: 700,
                padding: "3px 10px",
              }}
            >
              <FlaskConical size={11} /> Teste
            </span>
          )}
          {clinic.autoReplyEnabled ? (
            <span className="status-pill" style={{ fontSize: 11, padding: "3px 10px" }}>
              <span className="status-dot" /> IA Ativa
            </span>
          ) : (
            <span className="status-pill status-handoff" style={{ fontSize: 11, padding: "3px 10px" }}>
              <span className="status-dot" /> IA Pausada
            </span>
          )}
          <Link
            href="/app/inbox"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              fontWeight: 600,
              color: "var(--accent-strong)",
              textDecoration: "none",
            }}
          >
            <ExternalLink size={13} />
            Inbox
          </Link>
        </div>
      </div>

      <div className="page-content" style={{ paddingBottom: "60px", display: "grid", gap: 32 }}>
        {/* KPIs */}
        <div className="kpi-strip" style={{ marginLeft: 0 }}>
          <div className="metric metric-highlight">
            <div className="metric-header"><span className="metric-label">Leads no mês</span></div>
            <span className="metric-value">{leadsCount}</span>
            <span className="metric-context">mês atual</span>
          </div>
          <div className="metric">
            <div className="metric-header"><span className="metric-label">Agendamentos</span></div>
            <span className="metric-value">{scheduledCount}</span>
            <span className="metric-context">no mês</span>
          </div>
          <div className="metric">
            <div className="metric-header"><span className="metric-label">Conversão</span></div>
            <span className="metric-value">{conversion}%</span>
            <span className="metric-context">agend. / leads</span>
          </div>
          <div className="metric">
            <div className="metric-header"><span className="metric-label">Custo IA</span></div>
            <span className="metric-value" style={{ fontFamily: "monospace", fontSize: 16 }}>{formatCurrency(aiCost)}</span>
            <span className="metric-context">OpenAI no mês</span>
          </div>
          <div className="metric">
            <div className="metric-header"><span className="metric-label">Custo WhatsApp</span></div>
            <span className="metric-value" style={{ fontFamily: "monospace", fontSize: 16 }}>{formatCurrency(waCost)}</span>
            <span className="metric-context">Z-API / Meta no mês</span>
          </div>
        </div>

        {/* Daily volume */}
        <div style={{ border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: "14px 18px 12px", borderBottom: "1px solid var(--line)", background: "var(--surface-soft)" }}>
            <p className="eyebrow" style={{ margin: 0 }}>Volume diário — últimos 30 dias</p>
          </div>
          {allDays.length === 0 ? (
            <div className="empty-state compact" style={{ borderRadius: 0, border: "none" }}>
              Sem dados no período.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "var(--surface-soft)", borderBottom: "1px solid var(--line)" }}>
                  {["Data", "Leads", "Mensagens"].map((col) => (
                    <th key={col} style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)" }}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allDays.slice(0, 30).map((day, i) => (
                  <tr key={day} style={{ background: i % 2 === 1 ? "var(--surface-soft)" : "transparent", borderBottom: i < Math.min(allDays.length, 30) - 1 ? "1px solid var(--line)" : "none" }}>
                    <td style={{ padding: "10px 16px", color: "var(--text-soft)" }}>{day}</td>
                    <td style={{ padding: "10px 16px", fontWeight: 600 }}>{dailyLeadsMap[day] ?? 0}</td>
                    <td style={{ padding: "10px 16px", color: "var(--text-soft)" }}>{dailyMsgMap[day] ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>

        {/* Distribuição de temperatura */}
        <div>
          <p className="eyebrow">Distribuição de temperatura</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
            <div className="metric">
              <div className="metric-header"><span className="metric-icon"><Flame size={14} /></span><span className="metric-label">Quentes</span></div>
              <span className="metric-value temp-hot">{tempCounts.hot}</span>
              <span className="metric-context"><span className="temp-badge temp-hot">Quente</span></span>
            </div>
            <div className="metric">
              <div className="metric-header"><span className="metric-icon"><Thermometer size={14} /></span><span className="metric-label">Mornos</span></div>
              <span className="metric-value temp-warm">{tempCounts.warm}</span>
              <span className="metric-context"><span className="temp-badge temp-warm">Morno</span></span>
            </div>
            <div className="metric">
              <div className="metric-header"><span className="metric-icon"><Snowflake size={14} /></span><span className="metric-label">Frios</span></div>
              <span className="metric-value temp-cold">{tempCounts.cold}</span>
              <span className="metric-context"><span className="temp-badge temp-cold">Frio</span></span>
            </div>
          </div>
        </div>

        {/* Handoff conversations */}
        <div style={{ border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: "14px 18px 12px", borderBottom: "1px solid var(--line)", background: "var(--surface-soft)" }}>
            <p className="eyebrow" style={{ margin: 0 }}>Conversas com handoff</p>
          </div>
          {handoffConvs.length === 0 ? (
            <div className="empty-state compact" style={{ borderRadius: 0, border: "none" }}>
              Nenhum handoff registrado.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {handoffConvs.map((h, i) => (
                <div
                  key={`${h.convId}-${i}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "12px 16px",
                    borderBottom: i < handoffConvs.length - 1 ? "1px solid var(--line)" : "none",
                    background: i % 2 === 1 ? "var(--surface-soft)" : "transparent",
                  }}
                >
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                      {h.leadName ?? h.leadPhone ?? "Lead desconhecido"}
                    </span>
                    {h.leadPhone && h.leadName && (
                      <span style={{ marginLeft: 8, fontSize: 12, color: "var(--muted)" }}>{h.leadPhone}</span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>
                      {relativeTime(new Date(h.createdAt))}
                    </span>
                    <Link
                      href={`/app/inbox/${h.convId}`}
                      style={{ fontSize: 12, color: "var(--accent-strong)", textDecoration: "none", display: "flex", alignItems: "center", gap: 4 }}
                    >
                      <ExternalLink size={12} /> Ver conversa
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Stale conversations (AI non-response proxy) */}
        <div style={{ border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: "14px 18px 12px", borderBottom: "1px solid var(--line)", background: "var(--surface-soft)" }}>
            <p className="eyebrow" style={{ margin: 0 }}>
              Possíveis falhas da IA — leads ativos sem resposta há +1h
            </p>
          </div>
          {staleConvs.length === 0 ? (
            <div className="empty-state compact" style={{ borderRadius: 0, border: "none" }}>
              Nenhuma conversa parada detectada.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {staleConvs.map((c, i) => (
                <div
                  key={c.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "12px 16px",
                    borderBottom: i < staleConvs.length - 1 ? "1px solid var(--line)" : "none",
                    background: i % 2 === 1 ? "var(--surface-soft)" : "transparent",
                  }}
                >
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                      {c.leadName ?? c.leadPhone ?? "Lead desconhecido"}
                    </span>
                    {c.leadPhone && c.leadName && (
                      <span style={{ marginLeft: 8, fontSize: 12, color: "var(--muted)" }}>{c.leadPhone}</span>
                    )}
                    <span
                      style={{
                        marginLeft: 10,
                        fontSize: 11,
                        color: "var(--danger)",
                        fontWeight: 600,
                      }}
                    >
                      {c.lastMessageAt ? relativeTime(new Date(c.lastMessageAt)) : "—"}
                    </span>
                  </div>
                  <Link
                    href={`/app/inbox/${c.id}`}
                    style={{ fontSize: 12, color: "var(--accent-strong)", textDecoration: "none", display: "flex", alignItems: "center", gap: 4 }}
                  >
                    <ExternalLink size={12} /> Ver conversa
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Toggle produção / teste */}
        <div
          style={{
            border: clinic.isTest
              ? "1px solid rgba(99,102,241,0.3)"
              : "1px solid var(--line)",
            borderRadius: 12,
            padding: "18px 20px",
            background: clinic.isTest ? "rgba(99,102,241,0.05)" : "transparent",
          }}
        >
          <p
            className="eyebrow"
            style={{ margin: "0 0 6px", color: clinic.isTest ? "#818cf8" : "var(--muted)", opacity: 0.9 }}
          >
            {clinic.isTest ? "Ambiente de testes" : "Clínica em produção"}
          </p>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
              {clinic.isTest
                ? "Esta clínica está marcada como ambiente de testes. Custos e leads são excluídos dos KPIs de produção."
                : "Esta clínica está em produção. Leads e receita entram nos KPIs do painel financeiro."}
            </p>
            <form action={toggleTestAction}>
              <button
                type="submit"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "8px 16px",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  background: "var(--surface-soft)",
                  color: "var(--text-soft)",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {clinic.isTest ? (
                  <><Building2 size={13} /> Mover para produção</>
                ) : (
                  <><FlaskConical size={13} /> Marcar como teste</>
                )}
              </button>
            </form>
          </div>
        </div>

        {/* Membros e senhas */}
        <div style={{ border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: "14px 18px 12px", borderBottom: "1px solid var(--line)", background: "var(--surface-soft)", display: "flex", alignItems: "center", gap: 8 }}>
            <KeyRound size={13} style={{ color: "var(--muted)" }} />
            <p className="eyebrow" style={{ margin: 0 }}>Acesso da clínica</p>
          </div>
          <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 16 }}>
            {memberOk && (
              <div style={{ padding: "8px 12px", borderRadius: 8, background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)", color: "#34d399", fontSize: 13 }}>
                Senha salva com sucesso.
              </div>
            )}
            {memberError && (
              <div style={{ padding: "8px 12px", borderRadius: 8, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "var(--danger)", fontSize: 13 }}>
                Senha inválida — mínimo 8 caracteres.
              </div>
            )}

            {/* Membros existentes */}
            {members.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)" }}>Membros cadastrados</p>
                {members.map((m) => (
                  <div key={m.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderRadius: 8, background: "var(--surface-soft)", border: "1px solid var(--line)" }}>
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{m.email}</span>
                      <span style={{ marginLeft: 8, fontSize: 11, color: "var(--muted)" }}>{m.role}</span>
                    </div>
                    <span style={{ fontSize: 11, color: m.hasPassword ? "#34d399" : "#f59e0b", fontWeight: 600 }}>
                      {m.hasPassword ? "Senha definida" : "Sem senha (usa env)"}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Formulário para criar/atualizar membro */}
            <form action={upsertMemberAction} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)" }}>Adicionar / redefinir senha</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input
                  name="email"
                  type="email"
                  placeholder="admin@clinica.com"
                  required
                  style={{ flex: "1 1 200px", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface-soft)", color: "var(--text)", fontSize: 13 }}
                />
                <input
                  name="password"
                  type="password"
                  placeholder="Senha (mín. 8 caracteres)"
                  required
                  minLength={8}
                  style={{ flex: "1 1 200px", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface-soft)", color: "var(--text)", fontSize: 13 }}
                />
                <button
                  type="submit"
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface-soft)", color: "var(--text-soft)", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  <UserPlus size={13} /> Salvar
                </button>
              </div>
              <p style={{ margin: 0, fontSize: 11, color: "var(--muted)" }}>
                Se o e-mail já for membro, apenas a senha é atualizada. Se for novo, cria vínculo com role clinic_admin.
              </p>
            </form>
          </div>
        </div>

        {/* Danger zone */}
        <div style={{ border: "1px solid rgba(239,68,68,0.2)", borderRadius: 12, padding: "18px 20px", background: "rgba(239,68,68,0.03)" }}>
          <p className="eyebrow" style={{ margin: "0 0 6px", color: "var(--danger)", opacity: 0.7 }}>Zona de risco</p>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
              Apaga todos os leads, conversas e agendamentos de teste. As configurações da clínica são preservadas.
            </p>
            <ResetClinicDialog clinicId={clinic.id} clinicName={clinic.name} />
          </div>
        </div>
      </div>
    </div>
  );
}
