export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ResetClinicDialog } from "./reset-clinic-dialog";
import { ArchiveClinicDialog } from "./archive-clinic-dialog";
import { PurgeClinicDialog } from "./purge-clinic-dialog";
import { db } from "@/infrastructure/db/client";
import {
  organizations,
  clinicMembers,
  leads,
  aiUsageCosts,
  whatsappMessageCosts,
  conversations,
  messages,
  agentRecommendations,
  playbookVersions,
  treatments,
  channelHealthSnapshots,
  setupStudies,
  conversationReviews,
} from "@/infrastructure/db/schema";
import { eq, count, sum, and, gte, desc, sql, notInArray, inArray } from "drizzle-orm";
import {
  ArrowLeft,
  ExternalLink,
  Flame,
  Thermometer,
  Snowflake,
  FlaskConical,
  Building2,
  KeyRound,
  UserPlus,
  AlertTriangle,
  ShieldCheck,
  BookOpen,
  Settings,
  Rocket,
} from "lucide-react";
import { hashPassword } from "@/lib/password";
import { buildClinicBlueprint } from "@/application/onboarding/clinic-blueprint";
import {
  applyClinicPlanPreset,
  getClinicVoiceBlueprintState,
} from "@/application/modules/module-gate";
import { resolveOperationalStatusFromAutomationState } from "@/application/clinics/clinic-operational-status";
import { ACTIVE_CLINIC_COOKIE } from "@/application/tenancy/resolve-clinic";
import { createLogger } from "@/infrastructure/logging/logger";
import {
  getClinicOperationalStatusColors,
  getClinicOperationalStatusLabel,
} from "@/application/clinics/clinic-operational-status-presentation";
import { updateChannelSafetySettings } from "./channel-safety-actions";
import { ClinicTabs } from "./clinic-tabs";
import { resolveDefaultTab, resolveContextualCta } from "./clinic-tab-helpers";
import { GenerateSetupStudyButton, SetupStudyCard } from "./setup-study-ui";
import { ConversationReviewCard, CreateReviewButton } from "./conversation-review-ui";
import { CalendarImportPanel } from "./calendar-import-panel";
import { DrizzleMediaAssetRepository } from "@/infrastructure/repositories/drizzle-media-asset-repository";

const mediaAssetRepo = new DrizzleMediaAssetRepository();

async function enterClinicInbox(clinicId: string) {
  "use server";
  const store = await cookies();
  store.set(ACTIVE_CLINIC_COOKIE, clinicId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  redirect("/app/inbox");
}

async function toggleIsTest(clinicId: string, currentValue: boolean) {
  "use server";
  const clinic = await db.query.organizations.findFirst({
    where: eq(organizations.id, clinicId),
    columns: {
      autoReplyEnabled: true,
      operationalStatus: true,
    },
  });
  if (!clinic) redirect(`/owner/clinics/${clinicId}`);

  const nextIsTest = !currentValue;
  await db
    .update(organizations)
    .set({
      isTest: nextIsTest,
      operationalStatus: nextIsTest
        ? "test"
        : clinic.operationalStatus === "test"
          ? "prospect"
          : resolveOperationalStatusFromAutomationState({
              currentStatus: clinic.operationalStatus,
              isTest: nextIsTest,
              autoReplyEnabled: clinic.autoReplyEnabled,
            }),
    })
    .where(eq(organizations.id, clinicId));
  redirect(`/owner/clinics/${clinicId}`);
}

/** Liga/desliga a IA da organização (owner). Não afeta organizações arquivadas. */
async function toggleClinicAutomation(clinicId: string, currentAutoReplyEnabled: boolean) {
  "use server";
  const clinic = await db.query.organizations.findFirst({
    where: eq(organizations.id, clinicId),
    columns: { operationalStatus: true, isTest: true },
  });
  if (!clinic) redirect(`/owner/clinics/${clinicId}`);
  if (clinic.operationalStatus === "cancelled") {
    redirect(`/owner/clinics/${clinicId}?automationError=cancelled`);
  }

  const nextAutoReplyEnabled = !currentAutoReplyEnabled;
  await db
    .update(organizations)
    .set({
      autoReplyEnabled: nextAutoReplyEnabled,
      operationalStatus: resolveOperationalStatusFromAutomationState({
        currentStatus: clinic.operationalStatus,
        isTest: clinic.isTest,
        autoReplyEnabled: nextAutoReplyEnabled,
      }),
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, clinicId));

  createLogger({ scope: "OwnerPanel", clinicId }).info("clinic.automation_toggled", {
    autoReplyEnabled: nextAutoReplyEnabled,
  });
  redirect(`/owner/clinics/${clinicId}`);
}

/** Liga/desliga o modo de observação: coleta inbound, sem executar decisões da IA. */
async function toggleShadowMode(clinicId: string, currentValue: boolean) {
  "use server";
  const clinic = await db.query.organizations.findFirst({
    where: eq(organizations.id, clinicId),
    columns: { operationalStatus: true },
  });
  if (!clinic) redirect(`/owner/clinics/${clinicId}`);
  if (clinic.operationalStatus === "cancelled") {
    redirect(`/owner/clinics/${clinicId}?automationError=cancelled`);
  }

  const nextValue = !currentValue;
  await db
    .update(organizations)
    .set({ shadowModeEnabled: nextValue, updatedAt: new Date() })
    .where(eq(organizations.id, clinicId));

  createLogger({ scope: "OwnerPanel", clinicId }).info("clinic.shadow_mode_toggled", {
    shadowModeEnabled: nextValue,
  });
  redirect(`/owner/clinics/${clinicId}`);
}

/** Reativa uma organização arquivada — sempre volta para "prospect"; a IA precisa ser
 *  religada manualmente (toggleClinicAutomation) para evitar automação sem revisão. */
async function reactivateClinic(clinicId: string) {
  "use server";
  await db
    .update(organizations)
    .set({ operationalStatus: "prospect", updatedAt: new Date() })
    .where(eq(organizations.id, clinicId));

  createLogger({ scope: "OwnerPanel", clinicId }).info("clinic.reactivated", {});
  redirect(`/owner/clinics/${clinicId}`);
}

async function upsertMemberPassword(clinicId: string, formData: FormData) {
  "use server";
  const email = (formData.get("email") as string)?.trim().toLowerCase();
  const password = formData.get("password") as string;
  if (!email || !password || password.length < 8)
    redirect(`/owner/clinics/${clinicId}?memberError=1`);
  const hash = await hashPassword(password);
  const existing = await db
    .select({ id: clinicMembers.id })
    .from(clinicMembers)
    .where(
      and(eq(clinicMembers.email, email), eq(clinicMembers.clinicId, clinicId)),
    )
    .limit(1)
    .then((r) => r[0] ?? null);
  if (existing) {
    await db
      .update(clinicMembers)
      .set({ passwordHash: hash })
      .where(eq(clinicMembers.id, existing.id));
  } else {
    await db
      .insert(clinicMembers)
      .values({ clinicId, email, role: "org_admin", passwordHash: hash });
  }
  redirect(`/owner/clinics/${clinicId}?memberOk=1`);
}

async function updateClinicPlan(clinicId: string, formData: FormData) {
  "use server";
  const plan = formData.get("plan") as string;
  const valid = ["start", "growth", "scale", "enterprise"] as const;
  if (!(valid as readonly string[]).includes(plan)) {
    redirect(`/owner/clinics/${clinicId}`);
  }
  const typedPlan = plan as "start" | "growth" | "scale" | "enterprise";
  await db
    .update(organizations)
    .set({ plan: typedPlan, updatedAt: new Date() })
    .where(eq(organizations.id, clinicId));
  await applyClinicPlanPreset(clinicId, typedPlan, "owner");
  redirect(`/owner/clinics/${clinicId}?planOk=1`);
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

function fourteenDaysAgo(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 14);
  return d;
}

async function activateClinicGoLive(clinicId: string) {
  "use server";

  const clinic = await db.query.organizations.findFirst({
    where: eq(organizations.id, clinicId),
    columns: {
      id: true,
      specialty: true,
      city: true,
      address: true,
      greetingMessage: true,
      businessHours: true,
      calendarMode: true,
      googleCalendarId: true,
      receptionistPhone: true,
      autoReplyEnabled: true,
      isTest: true,
      plan: true,
      monthlyRevenueBrl: true,
      billingStartedAt: true,
      defaultAppointmentDurationMinutes: true,
      postAppointmentBufferMinutes: true,
      takeoverTtlHours: true,
      channelProvider: true,
      zapiInstanceId: true,
      zapiToken: true,
      metaPhoneNumberId: true,
      metaAccessToken: true,
      metaAppSecret: true,
      operationalStatus: true,
    },
  });

  if (!clinic) redirect(`/owner/clinics/${clinicId}?goLiveError=not-found`);
  if (clinic.operationalStatus === "cancelled") {
    redirect(`/owner/clinics/${clinicId}?goLiveError=cancelled`);
  }

  const [voiceState, activePlaybook, clinicTreatments, mediaAssetCount] = await Promise.all([
    getClinicVoiceBlueprintState(clinicId),
    db.query.playbookVersions.findFirst({
      where: and(
        eq(playbookVersions.clinicId, clinicId),
        eq(playbookVersions.status, "active"),
      ),
      columns: {
        toneOfVoice: true,
        commercialPolicy: true,
        notes: true,
        differentials: true,
        objections: true,
      },
    }),
    db.query.treatments.findMany({
      where: eq(treatments.clinicId, clinicId),
      columns: {
        pipelineSteps: true,
      },
    }),
    mediaAssetRepo.countByClinic(clinicId),
  ]);

  const blueprint = buildClinicBlueprint({
    clinic: { ...clinic, ...voiceState },
    playbook: {
      toneOfVoice: activePlaybook?.toneOfVoice ?? null,
      commercialPolicy: activePlaybook?.commercialPolicy ?? null,
      notes: activePlaybook?.notes ?? null,
      differentialsCount: Array.isArray(activePlaybook?.differentials)
        ? activePlaybook.differentials.length
        : 0,
      mediaLibraryCount: mediaAssetCount,
      objectionsCount: Array.isArray(activePlaybook?.objections)
        ? activePlaybook.objections.length
        : 0,
    },
    treatments: clinicTreatments.map((t) => ({
      pipelineStepsCount: Array.isArray(t.pipelineSteps)
        ? t.pipelineSteps.length
        : 0,
    })),
  });

  if (blueprint.criticalMissing.length > 0) {
    redirect(`/owner/clinics/${clinicId}?goLiveError=incomplete`);
  }

  await db
    .update(organizations)
    .set({
      isTest: false,
      autoReplyEnabled: true,
      operationalStatus: "active",
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, clinicId));

  redirect(`/owner/clinics/${clinicId}?goLiveOk=1`);
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
  const goLiveOk = sp.goLiveOk === "1";
  const goLiveError = sp.goLiveError;
  const planOk = sp.planOk === "1";
  const channelSafetyOk = sp.channelSafetyOk === "1";
  const channelSafetyError = sp.channelSafetyError;

  const [clinic] = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      specialty: organizations.specialty,
      city: organizations.city,
      address: organizations.address,
      greetingMessage: organizations.greetingMessage,
      businessHours: organizations.businessHours,
      calendarMode: organizations.calendarMode,
      googleCalendarId: organizations.googleCalendarId,
      receptionistPhone: organizations.receptionistPhone,
      plan: organizations.plan,
      monthlyRevenueBrl: organizations.monthlyRevenueBrl,
      billingStartedAt: organizations.billingStartedAt,
      defaultAppointmentDurationMinutes:
        organizations.defaultAppointmentDurationMinutes,
      postAppointmentBufferMinutes: organizations.postAppointmentBufferMinutes,
      takeoverTtlHours: organizations.takeoverTtlHours,
      autoReplyEnabled: organizations.autoReplyEnabled,
      operationalStatus: organizations.operationalStatus,
      isTest: organizations.isTest,
      shadowModeEnabled: organizations.shadowModeEnabled,
      channelProvider: organizations.channelProvider,
      zapiInstanceId: organizations.zapiInstanceId,
      zapiToken: organizations.zapiToken,
      metaPhoneNumberId: organizations.metaPhoneNumberId,
      metaAccessToken: organizations.metaAccessToken,
      metaAppSecret: organizations.metaAppSecret,
      outboundHourlyCap: organizations.outboundHourlyCap,
      outboundDailyCap: organizations.outboundDailyCap,
      automatedReengagementPaused: organizations.automatedReengagementPaused,
      channelSafetyMode: organizations.channelSafetyMode,
      channelPairedAt: organizations.channelPairedAt,
    })
    .from(organizations)
    .where(eq(organizations.id, clinicId))
    .limit(1);
  if (!clinic) notFound();

  const [latestSnapshot, activeDraftStudy, activeReview, reviewRounds] = await Promise.all([
    db
      .select({ healthScore: channelHealthSnapshots.healthScore })
      .from(channelHealthSnapshots)
      .where(eq(channelHealthSnapshots.clinicId, clinicId))
      .orderBy(desc(channelHealthSnapshots.createdAt))
      .limit(1),
    // Estudo ativo: o mais recente ainda em ciclo (rascunho, enviado ou
    // respondido). "applied"/"expired" são terminais e não aparecem no card.
    db.query.setupStudies.findFirst({
      where: and(
        eq(setupStudies.organizationId, clinicId),
        inArray(setupStudies.status, ["draft", "sent", "answered"]),
      ),
      orderBy: (t, { desc: d }) => d(t.createdAt),
    }),
    // Revisão de conversas: rodada atual = a mais recente ainda em ciclo
    // (rascunho, enviada ou respondida). "expired" é terminal — só histórico.
    db.query.conversationReviews.findFirst({
      where: and(
        eq(conversationReviews.organizationId, clinicId),
        inArray(conversationReviews.status, ["draft", "sent", "answered"]),
      ),
      orderBy: (t, { desc: d }) => d(t.createdAt),
    }),
    // Histórico compacto das rodadas de revisão (a atual é filtrada no card).
    db
      .select({
        id: conversationReviews.id,
        title: conversationReviews.title,
        status: conversationReviews.status,
        createdAt: conversationReviews.createdAt,
      })
      .from(conversationReviews)
      .where(eq(conversationReviews.organizationId, clinicId))
      .orderBy(desc(conversationReviews.createdAt))
      .limit(10),
  ]);
  const currentScore = latestSnapshot[0]?.healthScore ?? 100;
  const reviewHistory = reviewRounds.filter((r) => r.id !== activeReview?.id);

  const [voiceState, activePlaybook, clinicTreatments, mediaAssetCount] = await Promise.all([
    getClinicVoiceBlueprintState(clinicId),
    db.query.playbookVersions.findFirst({
      where: and(
        eq(playbookVersions.clinicId, clinicId),
        eq(playbookVersions.status, "active"),
      ),
      columns: {
        toneOfVoice: true,
        commercialPolicy: true,
        notes: true,
        differentials: true,
        objections: true,
      },
    }),
    db.query.treatments.findMany({
      where: eq(treatments.clinicId, clinicId),
      columns: {
        pipelineSteps: true,
      },
    }),
    mediaAssetRepo.countByClinic(clinicId),
  ]);

  const blueprint = buildClinicBlueprint({
    clinic: { ...clinic, ...voiceState },
    playbook: {
      toneOfVoice: activePlaybook?.toneOfVoice ?? null,
      commercialPolicy: activePlaybook?.commercialPolicy ?? null,
      notes: activePlaybook?.notes ?? null,
      differentialsCount: Array.isArray(activePlaybook?.differentials)
        ? activePlaybook.differentials.length
        : 0,
      mediaLibraryCount: mediaAssetCount,
      objectionsCount: Array.isArray(activePlaybook?.objections)
        ? activePlaybook.objections.length
        : 0,
    },
    treatments: clinicTreatments.map((t) => ({
      pipelineStepsCount: Array.isArray(t.pipelineSteps)
        ? t.pipelineSteps.length
        : 0,
    })),
  });

  const operationalColors = getClinicOperationalStatusColors(
    clinic.operationalStatus,
  );
  const goLiveBlockingIssues =
    blueprint.sections.find((section) => section.id === "go_live")?.missing ??
    [];
  const canActivateGoLive =
    clinic.operationalStatus !== "active" &&
    clinic.operationalStatus !== "cancelled" &&
    blueprint.criticalMissing.length === 0;

  const toggleTestAction = toggleIsTest.bind(null, clinic.id, clinic.isTest);
  const activateGoLiveAction = activateClinicGoLive.bind(null, clinic.id);
  const upsertMemberAction = upsertMemberPassword.bind(null, clinic.id);
  const updatePlanAction = updateClinicPlan.bind(null, clinic.id);
  const toggleAutomationAction = toggleClinicAutomation.bind(null, clinic.id, clinic.autoReplyEnabled);
  const toggleShadowModeAction = toggleShadowMode.bind(null, clinic.id, clinic.shadowModeEnabled);
  const reactivateClinicAction = reactivateClinic.bind(null, clinic.id);
  const channelSafetyAction = updateChannelSafetySettings.bind(null, clinic.id);
  const isArchived = clinic.operationalStatus === "cancelled";

  // ADR-006 Fase A — aba padrão e CTA contextual
  const defaultTab = resolveDefaultTab(clinic.operationalStatus);
  const activeTab = sp.tab ?? defaultTab;
  const isConfigTab = activeTab === "config";
  const isOperacaoTab = activeTab === "operacao";
  const contextualCta = resolveContextualCta({
    clinicId: clinic.id,
    channelPairedAt: clinic.channelPairedAt ?? null,
    shadowModeEnabled: clinic.shadowModeEnabled,
    operationalStatus: clinic.operationalStatus,
  });

  const members = isConfigTab ? await db
    .select({
      id: clinicMembers.id,
      email: clinicMembers.email,
      role: clinicMembers.role,
      hasPassword: clinicMembers.passwordHash,
    })
    .from(clinicMembers)
    .where(eq(clinicMembers.clinicId, clinicId)) : [];

  const monthStart = startOfMonth();
  const fourteenDays = fourteenDaysAgo();

  const [
    leadsMonthResult,
    scheduledMonthResult,
    aiCostResult,
    waCostResult,
    tempHotResult,
    tempWarmResult,
    tempColdResult,
  ] = isOperacaoTab ? await Promise.all([
    db
      .select({ count: count() })
      .from(leads)
      .innerJoin(conversations, eq(conversations.leadId, leads.id))
      .where(
        and(
          eq(leads.clinicId, clinicId),
          eq(conversations.category, "sales"),
          gte(leads.createdAt, monthStart),
        ),
      ),
    db
      .select({ count: count() })
      .from(leads)
      .innerJoin(conversations, eq(conversations.leadId, leads.id))
      .where(
        and(
          eq(leads.clinicId, clinicId),
          eq(conversations.category, "sales"),
          eq(leads.status, "appointment_scheduled"),
          gte(leads.createdAt, monthStart),
        ),
      ),
    db
      .select({ total: sum(aiUsageCosts.estimatedCostUsdMicros) })
      .from(aiUsageCosts)
      .where(
        and(
          eq(aiUsageCosts.clinicId, clinicId),
          gte(aiUsageCosts.createdAt, monthStart),
        ),
      ),
    db
      .select({ total: sum(whatsappMessageCosts.estimatedCostUsdMicros) })
      .from(whatsappMessageCosts)
      .where(
        and(
          eq(whatsappMessageCosts.clinicId, clinicId),
          gte(whatsappMessageCosts.createdAt, monthStart),
        ),
      ),
    db
      .select({ count: count() })
      .from(leads)
      .innerJoin(conversations, eq(conversations.leadId, leads.id))
      .where(and(
        eq(leads.clinicId, clinicId),
        eq(conversations.category, "sales"),
        eq(leads.temperature, "hot"),
      )),
    db
      .select({ count: count() })
      .from(leads)
      .innerJoin(conversations, eq(conversations.leadId, leads.id))
      .where(and(
        eq(leads.clinicId, clinicId),
        eq(conversations.category, "sales"),
        eq(leads.temperature, "warm"),
      )),
    db
      .select({ count: count() })
      .from(leads)
      .innerJoin(conversations, eq(conversations.leadId, leads.id))
      .where(and(
        eq(leads.clinicId, clinicId),
        eq(conversations.category, "sales"),
        eq(leads.temperature, "cold"),
      )),
  ]) : [[], [], [], [], [], [], []];

  const leadsCount = leadsMonthResult[0]?.count ?? 0;
  const scheduledCount = scheduledMonthResult[0]?.count ?? 0;
  const aiCost = Number(aiCostResult[0]?.total ?? 0);
  const waCost = Number(waCostResult[0]?.total ?? 0);
  const conversion =
    leadsCount > 0 ? ((scheduledCount / leadsCount) * 100).toFixed(1) : "0.0";
  const tempCounts = {
    hot: tempHotResult[0]?.count ?? 0,
    warm: tempWarmResult[0]?.count ?? 0,
    cold: tempColdResult[0]?.count ?? 0,
  };

  // Daily volume (last 14 days)
  const dailyLeadsResult = !isOperacaoTab ? [] : await db
    .select({
      day: sql<string>`DATE(${leads.createdAt} AT TIME ZONE 'America/Sao_Paulo')`,
      count: count(),
    })
    .from(leads)
    .innerJoin(conversations, eq(conversations.leadId, leads.id))
    .where(and(
      eq(leads.clinicId, clinicId),
      eq(conversations.category, "sales"),
      gte(leads.createdAt, fourteenDays),
    ))
    .groupBy(sql`DATE(${leads.createdAt} AT TIME ZONE 'America/Sao_Paulo')`)
    .orderBy(
      sql`DATE(${leads.createdAt} AT TIME ZONE 'America/Sao_Paulo') DESC`,
    );

  const dailyMessagesResult = !isOperacaoTab ? [] : await db
    .select({
      day: sql<string>`DATE(${messages.sentAt} AT TIME ZONE 'America/Sao_Paulo')`,
      count: count(),
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(
      and(
        eq(conversations.clinicId, clinicId),
        eq(conversations.category, "sales"),
        gte(messages.sentAt, fourteenDays),
      ),
    )
    .groupBy(sql`DATE(${messages.sentAt} AT TIME ZONE 'America/Sao_Paulo')`)
    .orderBy(
      sql`DATE(${messages.sentAt} AT TIME ZONE 'America/Sao_Paulo') DESC`,
    );

  const dailyLeadsMap = Object.fromEntries(
    dailyLeadsResult.map((r) => [r.day, r.count]),
  );
  const dailyMsgMap = Object.fromEntries(
    dailyMessagesResult.map((r) => [r.day, r.count]),
  );
  const allDays = Array.from(
    new Set([...Object.keys(dailyLeadsMap), ...Object.keys(dailyMsgMap)]),
  ).sort((a, b) => b.localeCompare(a));

  const handoffConvs = !isOperacaoTab ? [] : await db
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

  const staleConvs = !isOperacaoTab ? [] : await db
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
        eq(conversations.category, "sales"),
        sql`${conversations.lastMessageAt} < NOW() - INTERVAL '1 hour'`,
        notInArray(leads.status, ["won", "lost", "appointment_scheduled"]),
      ),
    )
    .orderBy(desc(conversations.lastMessageAt))
    .limit(8);

  // ── Style helpers ────────────────────────────────────────────────
  const inputStyle = {
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid var(--line)",
    background: "var(--surface-soft)",
    color: "var(--text)",
    fontSize: 13,
  } as const;

  const btnStyle = {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 12px",
    border: "1px solid var(--line)",
    borderRadius: 8,
    background: "var(--surface-soft)",
    color: "var(--text-soft)" as string,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  };

  const blueprintBorderColor =
    blueprint.status === "complete"
      ? "1px solid rgba(16,185,129,0.22)"
      : blueprint.status === "attention"
        ? "1px solid rgba(245,158,11,0.22)"
        : "1px solid rgba(99,102,241,0.26)";
  const blueprintBg =
    blueprint.status === "complete"
      ? "rgba(16,185,129,0.03)"
      : blueprint.status === "attention"
        ? "rgba(245,158,11,0.03)"
        : "rgba(99,102,241,0.03)";
  const blueprintProgressColor =
    blueprint.status === "complete"
      ? "#34d399"
      : blueprint.status === "attention"
        ? "#f59e0b"
        : "#818cf8";

  function sectionChipColor(status: string) {
    if (status === "complete") return { color: "#34d399", bg: "rgba(16,185,129,0.12)" };
    if (status === "attention") return { color: "#f59e0b", bg: "rgba(245,158,11,0.12)" };
    return { color: "#818cf8", bg: "rgba(99,102,241,0.12)" };
  }

  return (
    <div style={{ minWidth: 0, overflow: "hidden" }}>
      {/* ── TOPBAR (ADR-006 Fase A — header enxuto com CTA contextual) ────── */}
      <div className="product-topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0, flex: 1 }}>
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
          <span style={{ color: "var(--line-strong)", flexShrink: 0 }}>·</span>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{clinic.name}</h1>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--muted)" }}>
              {[clinic.specialty, clinic.city].filter(Boolean).join(" · ") || "Organização"}
            </p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", flexShrink: 0 }}>
          {clinic.isTest && (
            <span style={{ display: "flex", alignItems: "center", gap: 5, border: "1px solid rgba(99,102,241,0.35)", borderRadius: 999, background: "rgba(99,102,241,0.1)", color: "#818cf8", fontSize: 11, fontWeight: 700, padding: "3px 10px" }}>
              <FlaskConical size={11} /> Teste
            </span>
          )}
          <span style={{ display: "flex", alignItems: "center", gap: 5, border: `1px solid ${operationalColors.border}`, borderRadius: 999, background: operationalColors.background, color: operationalColors.text, fontSize: 11, fontWeight: 700, padding: "3px 10px" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: operationalColors.text, flexShrink: 0 }} />
            {getClinicOperationalStatusLabel(clinic.operationalStatus)}
          </span>
          {clinic.autoReplyEnabled ? (
            <span className="status-pill" style={{ fontSize: 11, padding: "3px 10px" }}>
              <span className="status-dot" /> IA Ativa
            </span>
          ) : (
            <span className="status-pill status-handoff" style={{ fontSize: 11, padding: "3px 10px" }}>
              <span className="status-dot" /> IA Pausada
            </span>
          )}
          {/* Acesso Permanente ao Inbox */}
          <form action={enterClinicInbox.bind(null, clinic.id)}>
            <button
              type="submit"
              title="Entrar como a Clínica no CRM"
              style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: "var(--text)", background: "var(--surface-soft)", border: "1px solid var(--line)", padding: "5px 12px", borderRadius: 8, cursor: "pointer" }}
            >
              <ExternalLink size={13} />
              Acessar CRM
            </button>
          </form>

          {/* CTA contextual único — Módulos e Onboarding saem do header (ADR-006) */}
          {contextualCta.kind === "link" ? (
            contextualCta.href !== "/app/inbox" && (
              <Link
                href={contextualCta.href}
                style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: "var(--accent-strong)", textDecoration: "none", padding: "6px 12px", borderRadius: 8, border: "1px solid rgba(99,102,241,0.3)", background: "rgba(99,102,241,0.08)" }}
              >
                <Rocket size={13} />
                {contextualCta.label}
              </Link>
            )
          ) : (
            <Link
              href={`?tab=${contextualCta.tab}`}
              style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: "var(--accent-strong)", textDecoration: "none", padding: "6px 12px", borderRadius: 8, border: "1px solid rgba(99,102,241,0.3)", background: "rgba(99,102,241,0.08)" }}
            >
              <Rocket size={13} />
              {contextualCta.label}
            </Link>
          )}
        </div>
      </div>

      <div className="page-content" style={{ paddingBottom: 60, display: "grid", gap: 16, minWidth: 0 }}>

        {/* ── FLASH ALERTS (fora das abas — persistem em qualquer aba) ── */}
        {goLiveOk && (
          <div style={{ padding: "11px 16px", borderRadius: 10, border: "1px solid rgba(16,185,129,0.24)", background: "rgba(16,185,129,0.08)", color: "#34d399", fontSize: 13, fontWeight: 600 }}>
            Go-live ativado. A organização entrou em produção com automação liberada.
          </div>
        )}
        {goLiveError && (
          <div style={{ padding: "11px 16px", borderRadius: 10, border: "1px solid rgba(245,158,11,0.24)", background: "rgba(245,158,11,0.08)", color: "#f59e0b", fontSize: 13, fontWeight: 600 }}>
            {goLiveError === "incomplete"
              ? "Go-live bloqueado — existem lacunas obrigatórias no blueprint."
              : goLiveError === "cancelled"
                ? "Organização cancelada não pode ser promovida para go-live."
                : "Não foi possível concluir o go-live desta organização."}
          </div>
        )}
        {planOk && (
          <div style={{ padding: "11px 16px", borderRadius: 10, border: "1px solid rgba(16,185,129,0.24)", background: "rgba(16,185,129,0.08)", color: "#34d399", fontSize: 13, fontWeight: 600 }}>
            Plano atualizado com sucesso.
          </div>
        )}
        {channelSafetyOk && (
          <div style={{ padding: "11px 16px", borderRadius: 10, border: "1px solid rgba(16,185,129,0.24)", background: "rgba(16,185,129,0.08)", color: "#34d399", fontSize: 13, fontWeight: 600 }}>
            Configurações de segurança de canal salvas.
          </div>
        )}
        {channelSafetyError && (
          <div style={{ padding: "11px 16px", borderRadius: 10, border: "1px solid rgba(245,158,11,0.24)", background: "rgba(245,158,11,0.08)", color: "#f59e0b", fontSize: 13, fontWeight: 600 }}>
            {channelSafetyError === "unauthorized"
              ? "Sem permissão para alterar configurações de segurança."
              : channelSafetyError === "invalid_hourly_cap"
                ? "Cap horário inválido — deve ser um inteiro maior que 0."
                : channelSafetyError === "invalid_daily_cap"
                  ? "Cap diário inválido — deve ser um inteiro maior que 0."
                  : "Erro ao salvar configurações de segurança."}
          </div>
        )}

        {/* ── 3 ABAS (ADR-006 Fase A) ─────────────────────────────────────── */}
        <ClinicTabs
          defaultTab={defaultTab}
          tabImplantacao={(
            <div style={{ display: "grid", gap: 16 }}>
              {/* Blueprint compacto (seção "Clinic Blueprint" duplicada na página some — só link) */}
              <div style={{ border: blueprintBorderColor, borderRadius: 14, overflow: "hidden", background: blueprintBg }}>
                <div style={{ padding: "16px 20px", borderBottom: goLiveBlockingIssues.length > 0 ? "1px solid var(--line)" : undefined, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <p className="eyebrow" style={{ margin: 0, flex: 1 }}>Prontidão de implantação</p>
                      <strong style={{ fontSize: 13, color: blueprintProgressColor, fontWeight: 800 }}>
                        {blueprint.readinessPercent}%
                      </strong>
                    </div>
                    <div style={{ marginTop: 8, height: 5, borderRadius: 999, background: "rgba(255,255,255,0.07)" }}>
                      <div style={{ height: 5, borderRadius: 999, width: `${blueprint.readinessPercent}%`, background: blueprintProgressColor }} />
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 10 }}>
                      {blueprint.sections
                        .filter((s) => s.id !== "go_live")
                        .map((section) => {
                          const chip = sectionChipColor(section.status);
                          return (
                            <span key={section.id} style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999, color: chip.color, background: chip.bg }}>
                              {section.title}
                            </span>
                          );
                        })}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8, flexShrink: 0 }}>
                    {canActivateGoLive ? (
                      <form action={activateGoLiveAction}>
                        <button type="submit" style={{ padding: "9px 14px", borderRadius: 10, border: "none", background: "var(--accent)", color: "#000", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
                          Promover para active →
                        </button>
                      </form>
                    ) : clinic.operationalStatus === "active" ? (
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#34d399" }}>Organização ativa</span>
                    ) : null}
                    <Link
                      href={`/owner/clinics/${clinic.id}/blueprint`}
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 8, textDecoration: "none", fontSize: 12, fontWeight: 700, color: "var(--muted)", border: "1px solid var(--line)", background: "var(--surface-soft)" }}
                    >
                      <Building2 size={12} />
                      Ver Blueprint
                    </Link>
                    <Link
                      href={`/owner/onboarding/${clinic.id}`}
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 8, textDecoration: "none", fontSize: 12, fontWeight: 700, color: "var(--muted)", border: "1px solid var(--line)", background: "var(--surface-soft)" }}
                    >
                      <BookOpen size={12} />
                      Wizard de implantação
                    </Link>
                  </div>
                </div>
                {goLiveBlockingIssues.length > 0 && (
                  <div style={{ padding: "10px 20px", background: "rgba(245,158,11,0.04)", borderTop: "1px solid rgba(245,158,11,0.12)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      <AlertTriangle size={12} style={{ color: "#f59e0b" }} />
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b", textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>Bloqueios de go-live</span>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 20px" }}>
                      {goLiveBlockingIssues.slice(0, 6).map((item) => (
                        <span key={item} style={{ fontSize: 12, color: "var(--muted)" }}>· {item}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {/* Placeholder da timeline (ADR-006 Fase B — será preenchido com o componente de timeline) */}
              <div style={{ border: "1px dashed var(--line)", borderRadius: 12, padding: "20px 24px", textAlign: "center" as const }}>
                <p className="eyebrow" style={{ margin: "0 0 6px" }}>Timeline de implantação</p>
                <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>Disponível na Fase B do ADR-006 — mostrará cada etapa com seu status e CTA.</p>
              </div>

              {/* ── ZONA 1.5: SETUP STUDY (ADR-002 Fase 1) ────────────── */}
              <div style={{ display: "grid", gap: 16 }}>
                {activeDraftStudy ? (
                  <SetupStudyCard
                    clinicId={clinic.id}
                    study={{
                      id: activeDraftStudy.id,
                      status: activeDraftStudy.status,
                      createdAt: activeDraftStudy.createdAt,
                      sentAt: activeDraftStudy.sentAt,
                      expiresAt: activeDraftStudy.expiresAt,
                      findings: activeDraftStudy.findings,
                    }}
                  />
                ) : (
                  <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20 }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                        Estudo de Setup
                      </h3>
                      <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)" }}>
                        Gere um relatório analisando as conversas recentes para identificar divergências entre a operação real e o cadastro.
                      </p>
                    </div>
                    <GenerateSetupStudyButton clinicId={clinic.id} />
                  </div>
                )}
              </div>

              {/* ── ZONA 1.6: REVISÃO DE CONVERSAS (docs/product/revisao-conversas-plano.md) ── */}
              <div style={{ display: "grid", gap: 16 }}>
                {activeReview ? (
                  <ConversationReviewCard
                    clinicId={clinic.id}
                    review={{
                      id: activeReview.id,
                      status: activeReview.status,
                      title: activeReview.title,
                      excerpts: activeReview.excerpts,
                      overallComment: activeReview.overallComment,
                      createdAt: activeReview.createdAt,
                      sentAt: activeReview.sentAt,
                      answeredAt: activeReview.answeredAt,
                      expiresAt: activeReview.expiresAt,
                    }}
                    history={reviewHistory}
                  />
                ) : (
                  <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20 }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                        Revisão de conversas
                      </h3>
                      <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)" }}>
                        Cure trechos reais do shadow e envie ao responsável para ele apontar o que ajustaria antes do go-live.
                      </p>
                      {reviewHistory.length > 0 && (
                        <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--muted)" }}>
                          {reviewHistory.length} {reviewHistory.length === 1 ? "rodada anterior" : "rodadas anteriores"} no histórico.
                        </p>
                      )}
                    </div>
                    <CreateReviewButton clinicId={clinic.id} />
                  </div>
                )}
              </div>
            </div>
          )}
          tabOperacao={(
            <div style={{ display: "grid", gap: 16 }}>
              {/* ── ZONA 2: PERFORMANCE ─────────────────────────────── */}
              <div className="clinic-detail-perf-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 200px", gap: 12, alignItems: "start" }}>
          {/* KPIs */}
          <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "16px 20px" }}>
            <p className="eyebrow" style={{ margin: "0 0 14px" }}>
              Performance ·{" "}
              {new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
            </p>
            <div className="clinic-detail-kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 0, borderTop: "1px solid var(--line)", borderLeft: "1px solid var(--line)" }}>
              {[
                { label: "Leads", value: String(leadsCount), ctx: "mês atual", highlight: true },
                { label: "Agendamentos", value: String(scheduledCount), ctx: "no mês", highlight: false },
                { label: "Conversão", value: `${conversion}%`, ctx: "agend./leads", highlight: false },
                { label: "Custo IA", value: formatCurrency(aiCost), ctx: "OpenAI", mono: true },
                { label: "Custo WA", value: formatCurrency(waCost), ctx: "Z-API / Meta", mono: true },
              ].map(({ label, value, ctx, highlight, mono }) => (
                <div key={label} style={{ padding: "12px 14px", borderRight: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
                  <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase" as const, color: "var(--muted)" }}>{label}</p>
                  <p style={{ margin: "5px 0 0", fontSize: 20, fontWeight: 800, color: highlight ? "var(--accent)" : "var(--text)", fontFamily: mono ? "monospace" : undefined }}>
                    {value}
                  </p>
                  <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--muted)" }}>{ctx}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Temperatura */}
          <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "16px 18px" }}>
            <p className="eyebrow" style={{ margin: "0 0 12px" }}>Temperatura</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", borderRadius: 8, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.16)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Flame size={12} style={{ color: "#ef4444" }} />
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Quentes</span>
                </div>
                <strong style={{ fontSize: 16, color: "#ef4444" }}>{tempCounts.hot}</strong>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", borderRadius: 8, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.16)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Thermometer size={12} style={{ color: "#f59e0b" }} />
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Mornos</span>
                </div>
                <strong style={{ fontSize: 16, color: "#f59e0b" }}>{tempCounts.warm}</strong>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", borderRadius: 8, background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.16)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Snowflake size={12} style={{ color: "#60a5fa" }} />
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Frios</span>
                </div>
                <strong style={{ fontSize: 16, color: "#60a5fa" }}>{tempCounts.cold}</strong>
              </div>
            </div>
          </div>
        </div>

        {/* ── ZONA 3: SAÚDE + VOLUME ──────────────────────────── */}
        <div className="clinic-detail-two-col-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12, alignItems: "start" }}>

          {/* Saúde operacional */}
          <div style={{ display: "grid", gap: 10 }}>

            {/* Conversas paradas */}
            <div style={{ border: staleConvs.length > 0 ? "1px solid rgba(245,158,11,0.3)" : "1px solid var(--line)", borderRadius: 12, overflow: "hidden", background: staleConvs.length > 0 ? "rgba(245,158,11,0.03)" : "transparent" }}>
              <div style={{ padding: "11px 14px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between", background: staleConvs.length > 0 ? "rgba(245,158,11,0.07)" : "var(--surface-soft)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {staleConvs.length > 0 && <AlertTriangle size={12} style={{ color: "#f59e0b" }} />}
                  <p className="eyebrow" style={{ margin: 0, color: staleConvs.length > 0 ? "#f59e0b" : "var(--muted)" }}>
                    Conversas paradas
                  </p>
                </div>
                {staleConvs.length > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b", background: "rgba(245,158,11,0.15)", padding: "2px 8px", borderRadius: 999 }}>
                    {staleConvs.length}
                  </span>
                )}
              </div>
              {staleConvs.length === 0 ? (
                <div style={{ padding: "13px 14px", fontSize: 13, color: "var(--muted)" }}>
                  Nenhuma conversa parada detectada.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {staleConvs.map((c, i) => (
                    <div
                      key={c.id}
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: i < staleConvs.length - 1 ? "1px solid var(--line)" : "none", background: i % 2 === 1 ? "rgba(245,158,11,0.02)" : "transparent" }}
                    >
                      <div>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>
                          {c.leadName ?? c.leadPhone ?? "Lead desconhecido"}
                        </span>
                        <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: "#f59e0b" }}>
                          {c.lastMessageAt ? relativeTime(new Date(c.lastMessageAt)) : "—"}
                        </span>
                      </div>
                      <Link
                        href={`/app/inbox/${c.id}`}
                        style={{ fontSize: 12, color: "var(--accent-strong)", textDecoration: "none", display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}
                      >
                        <ExternalLink size={11} /> Ver
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Handoffs */}
            <div style={{ border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "11px 14px", borderBottom: "1px solid var(--line)", background: "var(--surface-soft)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <p className="eyebrow" style={{ margin: 0 }}>Handoffs ativos</p>
                {handoffConvs.length > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", background: "rgba(255,255,255,0.06)", padding: "2px 8px", borderRadius: 999 }}>
                    {handoffConvs.length}
                  </span>
                )}
              </div>
              {handoffConvs.length === 0 ? (
                <div style={{ padding: "13px 14px", fontSize: 13, color: "var(--muted)" }}>
                  Nenhum handoff registrado.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {handoffConvs.slice(0, 6).map((h, i) => (
                    <div
                      key={`${h.convId}-${i}`}
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: i < Math.min(handoffConvs.length, 6) - 1 ? "1px solid var(--line)" : "none", background: i % 2 === 1 ? "var(--surface-soft)" : "transparent" }}
                    >
                      <div>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>
                          {h.leadName ?? h.leadPhone ?? "Lead desconhecido"}
                        </span>
                        <span style={{ marginLeft: 8, fontSize: 12, color: "var(--muted)" }}>
                          {relativeTime(new Date(h.createdAt))}
                        </span>
                      </div>
                      <Link
                        href={`/app/inbox/${h.convId}`}
                        style={{ fontSize: 12, color: "var(--accent-strong)", textDecoration: "none", display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}
                      >
                        <ExternalLink size={11} /> Ver
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Volume 14 dias */}
          <div style={{ border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ padding: "11px 14px", borderBottom: "1px solid var(--line)", background: "var(--surface-soft)" }}>
              <p className="eyebrow" style={{ margin: 0 }}>Volume — últimos 14 dias</p>
            </div>
            {allDays.length === 0 ? (
              <div style={{ padding: "13px 14px", fontSize: 13, color: "var(--muted)" }}>Sem dados no período.</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "var(--surface-soft)", borderBottom: "1px solid var(--line)" }}>
                    {["Data", "Leads", "Msgs"].map((col) => (
                      <th key={col} style={{ padding: "8px 14px", textAlign: "left", fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase" as const, color: "var(--muted)" }}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allDays.slice(0, 14).map((day, i) => (
                    <tr key={day} style={{ background: i % 2 === 1 ? "var(--surface-soft)" : "transparent", borderBottom: i < Math.min(allDays.length, 14) - 1 ? "1px solid var(--line)" : "none" }}>
                      <td style={{ padding: "9px 14px", color: "var(--text-soft)" }}>{day}</td>
                      <td style={{ padding: "9px 14px", fontWeight: 600 }}>{dailyLeadsMap[day] ?? 0}</td>
                      <td style={{ padding: "9px 14px", color: "var(--text-soft)" }}>{dailyMsgMap[day] ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          </div>
        </div>
          )}
          tabConfig={(
            <div style={{ display: "grid", gap: 16 }}>
            {/* Links rápidos para módulos e onboarding (foram removidos do header) */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const }}>
              <a
                href={`/owner/clinics/${clinic.id}/modules`}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "var(--muted)", textDecoration: "none", padding: "7px 14px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface-soft)" }}
              >
                <Settings size={13} /> Módulos
              </a>
              <a
                href={`/owner/onboarding/${clinic.id}`}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "var(--muted)", textDecoration: "none", padding: "7px 14px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface-soft)" }}
              >
                <BookOpen size={13} /> Wizard de implantação
              </a>
            </div>

            {/* Importação de Calendário */}
            <CalendarImportPanel clinicId={clinic.id} />

            {/* Acesso da organização + controles */}
            <div className="clinic-detail-two-col-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12, alignItems: "start" }}>

              {/* Acesso da organização */}
              <div style={{ border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
                <div style={{ padding: "11px 14px", borderBottom: "1px solid var(--line)", background: "var(--surface-soft)", display: "flex", alignItems: "center", gap: 7 }}>
                  <KeyRound size={13} style={{ color: "var(--muted)" }} />
                  <p className="eyebrow" style={{ margin: 0 }}>Acesso da organização</p>
                </div>
                <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
                  {memberOk && (
                    <div style={{ padding: "8px 12px", borderRadius: 8, background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)", color: "#34d399", fontSize: 13 }}>Senha salva com sucesso.</div>
                  )}
                  {memberError && (
                    <div style={{ padding: "8px 12px", borderRadius: 8, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "var(--danger)", fontSize: 13 }}>Senha inválida — mínimo 8 caracteres.</div>
                  )}
                  {members.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase" as const, color: "var(--muted)" }}>Membros cadastrados</p>
                      {members.map((m) => (
                        <div key={m.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 10px", borderRadius: 8, background: "var(--surface-soft)", border: "1px solid var(--line)" }}>
                          <div>
                            <span style={{ fontSize: 13, fontWeight: 600 }}>{m.email}</span>
                            <span style={{ marginLeft: 7, fontSize: 11, color: "var(--muted)" }}>{m.role}</span>
                          </div>
                          <span style={{ fontSize: 11, color: m.hasPassword ? "#34d399" : "#f59e0b", fontWeight: 700 }}>
                            {m.hasPassword ? "Senha ✓" : "Sem senha"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <form action={upsertMemberAction} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase" as const, color: "var(--muted)" }}>Adicionar / redefinir senha</p>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const }}>
                      <input name="email" type="email" placeholder="admin@empresa.com" required style={{ ...inputStyle, flex: "1 1 160px" }} />
                      <input name="password" type="password" placeholder="Senha (mín. 8)" required minLength={8} style={{ ...inputStyle, flex: "1 1 130px" }} />
                      <button type="submit" style={btnStyle}><UserPlus size={13} /> Salvar</button>
                    </div>
                    <p style={{ margin: 0, fontSize: 11, color: "var(--muted)" }}>Se o e-mail já for membro, apenas a senha é atualizada.</p>
                  </form>
                </div>
              </div>

              {/* Controles */}
              <div style={{ display: "grid", gap: 10 }}>
                {/* Plano */}
                <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "14px 16px" }}>
                  <p className="eyebrow" style={{ margin: "0 0 12px" }}>Plano de assinatura</p>
                  <form action={updatePlanAction} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <select name="plan" defaultValue={clinic.plan} style={{ ...inputStyle, flex: 1 }}>
                      <option value="start">Start — R$1.300/mês</option>
                      <option value="growth">Growth — R$2.100/mês</option>
                      <option value="scale">Scale — R$3.500/mês</option>
                      <option value="enterprise">Enterprise (Custom)</option>
                    </select>
                    <button type="submit" style={btnStyle}>Salvar</button>
                  </form>
                  {clinic.billingStartedAt && (
                    <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--muted)" }}>Cobrança iniciada em {new Date(clinic.billingStartedAt).toLocaleDateString("pt-BR")}.</p>
                  )}
                </div>

                {/* Produção / Teste */}
                <div style={{ border: clinic.isTest ? "1px solid rgba(99,102,241,0.3)" : "1px solid var(--line)", borderRadius: 12, padding: "14px 16px", background: clinic.isTest ? "rgba(99,102,241,0.04)" : "transparent" }}>
                  <p className="eyebrow" style={{ margin: "0 0 8px", color: clinic.isTest ? "#818cf8" : "var(--muted)" }}>
                    {clinic.isTest ? "Ambiente de testes" : "Organização em produção"}
                  </p>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                    <p style={{ margin: 0, fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
                      {clinic.isTest ? "Custos e leads excluídos dos KPIs de produção." : "Leads e receita entram nos KPIs do painel financeiro."}
                    </p>
                    <form action={toggleTestAction}>
                      <button type="submit" style={btnStyle}>
                        {clinic.isTest ? (<><Building2 size={12} /> Para produção</>) : (<><FlaskConical size={12} /> Marcar teste</>)}
                      </button>
                    </form>
                  </div>
                </div>

                {/* Automação */}
                <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
                  <p className="eyebrow" style={{ margin: 0 }}>Automação</p>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                    <div>
                      <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "var(--text)" }}>IA {clinic.autoReplyEnabled ? "ativa" : "pausada"}</p>
                      <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
                        {clinic.autoReplyEnabled ? "Responde automaticamente aos leads no WhatsApp." : "Nenhuma resposta automática é enviada — use para clientes inadimplentes ou em revisão."}
                      </p>
                    </div>
                    {isArchived ? (
                      <span style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }}>Organização arquivada</span>
                    ) : (
                      <form action={toggleAutomationAction}>
                        <button type="submit" style={btnStyle}>{clinic.autoReplyEnabled ? "Pausar IA" : "Reativar IA"}</button>
                      </form>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
                    <div>
                      <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: clinic.shadowModeEnabled ? "#c084fc" : "var(--text)" }}>Shadow mode {clinic.shadowModeEnabled ? "ligado" : "desligado"}</p>
                      <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
                        Registra mensagens reais para diagnóstico, mas não executa decisões da IA, agenda, follow-ups ou envios. Valide respostas no replay isolado antes do go-live.
                      </p>
                    </div>
                    {isArchived ? (
                      <span style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }}>—</span>
                    ) : (
                      <form action={toggleShadowModeAction}>
                        <button type="submit" style={{ ...btnStyle, borderColor: clinic.shadowModeEnabled ? "rgba(192,132,252,0.5)" : btnStyle.border, color: clinic.shadowModeEnabled ? "#c084fc" : btnStyle.color }}>
                          {clinic.shadowModeEnabled ? "Desligar shadow mode" : "Ligar shadow mode"}
                        </button>
                      </form>
                    )}
                  </div>
                </div>

                {/* Segurança de canal */}
                <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <ShieldCheck size={13} style={{ color: "var(--muted)" }} />
                    <p className="eyebrow" style={{ margin: 0 }}>Segurança de canal</p>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 15, background: "rgba(255,255,255,0.03)", border: "1px solid var(--line)", padding: "10px 12px", borderRadius: 8 }}>
                    <div>
                      <p style={{ margin: 0, fontSize: 9, fontWeight: 700, textTransform: "uppercase", color: "var(--muted)", letterSpacing: "0.05em" }}>Score de Saúde (Ontem)</p>
                      <p style={{ margin: "2px 0 0", fontSize: 18, fontWeight: 800, color: currentScore >= 80 ? "#22c55e" : currentScore >= 50 ? "#eab308" : currentScore >= 20 ? "#f97316" : "#ef4444" }}>{currentScore}/100</p>
                    </div>
                    <div style={{ borderLeft: "1px solid var(--line)", paddingLeft: 15 }}>
                      <p style={{ margin: 0, fontSize: 9, fontWeight: 700, textTransform: "uppercase", color: "var(--muted)", letterSpacing: "0.05em" }}>Modo de Segurança</p>
                      <span style={{ display: "inline-block", marginTop: 4, padding: "2px 6px", borderRadius: 4, fontSize: 10, fontWeight: 700, textTransform: "uppercase" as const, background: clinic.channelSafetyMode === "normal" ? "rgba(34,197,94,0.15)" : clinic.channelSafetyMode === "atencao" ? "rgba(234,179,8,0.15)" : clinic.channelSafetyMode === "cooling" ? "rgba(249,115,22,0.15)" : "rgba(239,68,68,0.15)", color: clinic.channelSafetyMode === "normal" ? "#22c55e" : clinic.channelSafetyMode === "atencao" ? "#eab308" : clinic.channelSafetyMode === "cooling" ? "#f97316" : "#ef4444" }}>
                        {clinic.channelSafetyMode}
                      </span>
                    </div>
                  </div>
                  <form action={channelSafetyAction} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase" as const, color: "var(--muted)" }}>Sobrescrita Manual de Modo</label>
                      <select id="channel_safety_mode" name="channel_safety_mode" defaultValue={clinic.channelSafetyMode ?? "normal"} style={{ ...inputStyle, width: "100%", background: "#0c0c0e", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 6, padding: "8px 10px", fontSize: 12 }}>
                        <option value="normal">Normal (Sem restrições extras)</option>
                        <option value="atencao">Atenção (Alerta e monitoramento)</option>
                        <option value="cooling">Cooling (Bloqueia follow-up, recovery e campanhas)</option>
                        <option value="frozen">Frozen (Bloqueia tudo exceto respostas diretas)</option>
                      </select>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase" as const, color: "var(--muted)" }}>Cap horário (outbound/h)</label>
                        <input id="outbound_hourly_cap" name="outbound_hourly_cap" type="number" min={1} defaultValue={clinic.outboundHourlyCap} required style={{ ...inputStyle }} />
                        <p style={{ margin: 0, fontSize: 11, color: "var(--muted)" }}>Default 40. Vitalli: 15.</p>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase" as const, color: "var(--muted)" }}>Cap diário (outbound/dia)</label>
                        <input id="outbound_daily_cap" name="outbound_daily_cap" type="number" min={1} defaultValue={clinic.outboundDailyCap} required style={{ ...inputStyle }} />
                        <p style={{ margin: 0, fontSize: 11, color: "var(--muted)" }}>Default 200. Vitalli: 60.</p>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
                      <div>
                        <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: clinic.automatedReengagementPaused ? "#f59e0b" : "var(--text)" }}>Reengajamento {clinic.automatedReengagementPaused ? "pausado" : "ativo"}</p>
                        <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--muted)", lineHeight: 1.5 }}>Pausa follow-up e recovery sem desligar as respostas a inbound. <strong>appointment-reminder nunca é pausado</strong> — lembrete de compromisso que o lead marcou sempre sai.</p>
                      </div>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", flexShrink: 0 }}>
                        <input id="automated_reengagement_paused" name="automated_reengagement_paused" type="checkbox" defaultChecked={clinic.automatedReengagementPaused} style={{ width: 16, height: 16, cursor: "pointer", accentColor: "#f59e0b" }} />
                        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>Pausar</span>
                      </label>
                    </div>
                    <button type="submit" style={{ ...btnStyle, alignSelf: "flex-end" }}>
                      <ShieldCheck size={12} /> Salvar segurança
                    </button>
                  </form>
                </div>
              </div>
            </div>

            {/* ── ZONA DE PERIGO (ADR-006: dentro da aba Configuração, demarcada) ── */}
            <div style={{ border: "1px solid rgba(239,68,68,0.2)", borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 14, background: "rgba(239,68,68,0.03)" }}>
              <p className="eyebrow" style={{ margin: 0, color: "var(--danger)", opacity: 0.8 }}>Zona de perigo</p>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <p style={{ margin: 0, fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>Apaga todos os leads, conversas e agendamentos de teste.</p>
                <ResetClinicDialog clinicId={clinic.id} clinicName={clinic.name} />
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, paddingTop: 12, borderTop: "1px solid rgba(239,68,68,0.15)" }}>
                {isArchived ? (
                  <>
                    <p style={{ margin: 0, fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>Organização arquivada — automação desligada e fora dos KPIs de faturamento.</p>
                    <form action={reactivateClinicAction}><button type="submit" style={btnStyle}>Reativar organização</button></form>
                  </>
                ) : (
                  <>
                    <p style={{ margin: 0, fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>Arquiva a organização: desliga a IA e para de contar no faturamento. Não apaga nenhum dado.</p>
                    <ArchiveClinicDialog clinicId={clinic.id} clinicName={clinic.name} />
                  </>
                )}
              </div>
              {isArchived && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, paddingTop: 12, borderTop: "1px solid rgba(239,68,68,0.15)" }}>
                  <p style={{ margin: 0, fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>Apaga permanentemente todo o dado da organização. Só disponível para organizações já arquivadas.</p>
                  <PurgeClinicDialog clinicId={clinic.id} clinicName={clinic.name} />
                </div>
              )}
            </div>
          </div>
          )}
        />

      </div>
    </div>
  );
}
