export const dynamic = "force-dynamic";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq, count, and, desc, sql, gte, lt, notInArray, inArray, isNotNull, asc } from "drizzle-orm";
import { verifyToken, COOKIE_NAME } from "@/lib/session";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { getSessionMemberProfile, canViewFinancials, canViewOwnRevenue } from "@/application/tenancy/member-role";
import { db } from "@/infrastructure/db/client";
import { leads, conversations, messages, clinicMembers, appointments, treatments, organizations, professionals, channelHealthSnapshots } from "@/infrastructure/db/schema";
import {
  DashboardCommandCenter,
  type DashboardData,
  type DashboardPeriodFunnel,
  type FlowPoint,
  type RevenueData,
} from "./DashboardCommandCenter";
import type { PeriodKey } from "./DashboardPeriodToggle";

const DASHBOARD_TZ = "America/Sao_Paulo";
type DateLike = Date | string | number;

type DashboardFetchResult = DashboardData & {
  memberProfile: Awaited<ReturnType<typeof getSessionMemberProfile>>;
  flowStart: Date;
  CLINIC_ID: string;
};

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toDate(value: DateLike): Date {
  return value instanceof Date ? value : new Date(value);
}

function startOfDay(value: DateLike): Date {
  const next = toDate(value);
  next.setHours(0, 0, 0, 0);
  return next;
}

function dateKey(value: DateLike): string {
  return toDate(value).toLocaleDateString("en-CA", { timeZone: DASHBOARD_TZ });
}

function buildFlowSeries(rows: Array<{ createdAt: DateLike }>, startDate: Date, numDays = 7): FlowPoint[] {
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

function buildValueSeries(
  rows: Array<{ startsAt: DateLike; valueCents: number | null }>,
  startDate: Date,
  numDays = 7,
): FlowPoint[] {
  const buckets = new Map<string, number>();
  const days = Array.from({ length: numDays }, (_, index) => addDays(startDate, index));

  for (const day of days) {
    buckets.set(dateKey(day), 0);
  }

  for (const row of rows) {
    const key = dateKey(row.startsAt);
    if (buckets.has(key)) {
      buckets.set(key, (buckets.get(key) ?? 0) + Number(row.valueCents ?? 0));
    }
  }

  const labelFormat: Intl.DateTimeFormatOptions =
    numDays <= 7 ? { weekday: "short" } : { day: "2-digit", month: "short" };

  return days.map((day) => ({
    label: day.toLocaleDateString("pt-BR", { ...labelFormat, timeZone: DASHBOARD_TZ }),
    count: buckets.get(dateKey(day)) ?? 0,
  }));
}

function buildPeriodFunnel(rows: Array<{ status: string; temperature: string | null }>): DashboardPeriodFunnel {
  let hotCount = 0;
  let warmCount = 0;
  let activeHotCount = 0;
  let scheduledCount = 0;
  let wonCount = 0;

  for (const row of rows) {
    const isOpen = !["appointment_scheduled", "won", "lost"].includes(row.status);

    if (row.temperature === "hot" && isOpen) hotCount += 1;
    if (row.temperature === "warm" && isOpen) warmCount += 1;
    if (row.temperature === "hot" && row.status === "in_conversation") activeHotCount += 1;
    if (row.status === "appointment_scheduled") scheduledCount += 1;
    if (row.status === "won") wonCount += 1;
  }

  return {
    totalLeads: rows.length,
    hotCount,
    warmCount,
    activeHotCount,
    scheduledCount,
    wonCount,
  };
}

function periodToDays(period: string): number {
  if (period === "1d") return 1;
  if (period === "30d") return 30;
  return 7;
}

async function fetchRevenueData(
  clinicId: string,
  periodStart: Date,
  numDays: number,
  professionalId: string | null,
): Promise<RevenueData> {
  const professionalFilter = professionalId
    ? [eq(appointments.professionalId, professionalId)]
    : [];

  const [potentialResult, confirmedResult, byTreatmentResult, clinicRow, seriesRows] = await Promise.all([
    db
      .select({ sum: sql<number>`coalesce(sum(${appointments.valueCents}), 0)`, cnt: count() })
      .from(appointments)
      .where(
        and(
          eq(appointments.clinicId, clinicId),
          inArray(appointments.status, ["scheduled", "confirmed"]),
          gte(appointments.startsAt, periodStart),
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
          gte(appointments.startsAt, periodStart),
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
          gte(appointments.startsAt, periodStart),
          isNotNull(appointments.valueCents),
          ...professionalFilter,
        ),
      )
      .groupBy(treatments.name)
      .orderBy(desc(sql`sum(${appointments.valueCents})`))
      .limit(3),
    db
      .select({ monthlyRevenueBrl: organizations.monthlyRevenueBrl })
      .from(organizations)
      .where(eq(organizations.id, clinicId))
      .limit(1),
    db
      .select({
        startsAt: appointments.startsAt,
        valueCents: appointments.valueCents,
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.clinicId, clinicId),
          inArray(appointments.status, ["scheduled", "confirmed", "completed"]),
          gte(appointments.startsAt, periodStart),
          isNotNull(appointments.valueCents),
          ...professionalFilter,
        ),
      )
      .orderBy(asc(appointments.startsAt)),
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
    monthlyRevenueBrl: clinicRow[0]?.monthlyRevenueBrl ?? 130000,
    series: buildValueSeries(seriesRows, periodStart, numDays),
  };
}

async function getResponsibleDoctorName(
  clinicId: string,
  professionalId: string | null,
): Promise<string | null> {
  if (professionalId) {
    const professional = await db
      .select({ name: professionals.name })
      .from(professionals)
      .where(and(eq(professionals.id, professionalId), eq(professionals.clinicId, clinicId)))
      .limit(1)
      .then((rows) => rows[0] ?? null);

    if (professional?.name) return professional.name;
  }

  const primaryProfessional = await db
    .select({ name: professionals.name })
    .from(professionals)
    .where(and(eq(professionals.clinicId, clinicId), eq(professionals.isActive, true)))
    .orderBy(asc(professionals.createdAt))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  return primaryProfessional?.name ?? null;
}

async function fetchDashboardData(period: string): Promise<DashboardFetchResult> {
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

  const lastMessageSql = sql<string | null>`(
    select ${messages.body}
    from ${messages}
    where ${messages.conversationId} = ${conversations.id}
    order by ${messages.sentAt} desc
    limit 1
  )`;
  const lastMessageAtSql = sql<Date | null>`(
    select ${messages.sentAt}
    from ${messages}
    where ${messages.conversationId} = ${conversations.id}
    order by ${messages.sentAt} desc
    limit 1
  )`;
  const activityAtSql = sql<Date>`coalesce(${conversations.lastMessageAt}, ${conversations.updatedAt}, ${leads.updatedAt}, ${leads.createdAt})`;

  const [
    totalLeadsResult,
    activeLeadsResult,
    scheduledResult,
    activeHotResult,
    recentLeadsResult,
    hotLeadsResult,
    tempHotResult,
    tempWarmResult,
    tempColdResult,
    totalConversationsResult,
    needsAttentionResult,
    agentMessagesResult,
    afterHoursResult,
    currentFlowLeadsResult,
    previousLeadPeriodResult,
    periodLeadSnapshotResult,
    statusCountsResult,
    treatmentCatalogResult,
    clinicInfoResult,
    responsibleDoctorName,
    memberResult,
    todayAppointmentsResult,
    upcomingAppointmentsResult,
    recoveryLeadsResult,
    attentionLeadsResult,
    insightConversationsResult,
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
        notInArray(leads.status, ["appointment_scheduled", "won", "lost"]),
      )),
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
        profilePicUrl: leads.profilePicUrl,
        channel: leads.channel,
        status: leads.status,
        temperature: leads.temperature,
        treatmentInterest: leads.treatmentInterest,
        summary: conversations.summary,
        needsAttention: conversations.needsAttention,
        aiPaused: conversations.aiPaused,
        lastMessage: lastMessageSql,
        lastMessageAt: lastMessageAtSql,
        createdAt: leads.createdAt,
        updatedAt: activityAtSql,
      })
      .from(leads)
      .innerJoin(conversations, eq(conversations.leadId, leads.id))
      .where(and(eq(leads.clinicId, CLINIC_ID), eq(conversations.category, "sales")))
      .orderBy(desc(activityAtSql))
      .limit(8),
    db
      .select({
        id: leads.id,
        convId: conversations.id,
        name: leads.name,
        phone: leads.phone,
        profilePicUrl: leads.profilePicUrl,
        status: leads.status,
        temperature: leads.temperature,
        treatmentInterest: leads.treatmentInterest,
        updatedAt: activityAtSql,
      })
      .from(leads)
      .innerJoin(conversations, eq(conversations.leadId, leads.id))
      .where(and(
        eq(leads.clinicId, CLINIC_ID),
        eq(conversations.category, "sales"),
        inArray(leads.temperature, ["hot", "warm"]),
        notInArray(leads.status, ["appointment_scheduled", "won", "lost"]),
      ))
      .orderBy(
        desc(sql`case when ${leads.temperature} = 'hot' then 2 when ${leads.temperature} = 'warm' then 1 else 0 end`),
        desc(activityAtSql),
      )
      .limit(5),
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
    db
      .select({
        status: leads.status,
        temperature: leads.temperature,
      })
      .from(leads)
      .innerJoin(conversations, eq(conversations.leadId, leads.id))
      .where(
        and(
          eq(leads.clinicId, CLINIC_ID),
          eq(conversations.category, "sales"),
          gte(leads.createdAt, flowStart),
        ),
      ),
    db
      .select({ status: leads.status, count: count() })
      .from(leads)
      .innerJoin(conversations, eq(conversations.leadId, leads.id))
      .where(and(eq(leads.clinicId, CLINIC_ID), eq(conversations.category, "sales")))
      .groupBy(leads.status),
    db
      .select({
        name: treatments.name,
        priceCents: treatments.priceCents,
        minPriceCents: treatments.minPriceCents,
        maxPriceCents: treatments.maxPriceCents,
      })
      .from(treatments)
      .where(eq(treatments.clinicId, CLINIC_ID))
      .limit(200),
    db
      .select({
        name: organizations.name,
        autoReplyEnabled: organizations.autoReplyEnabled,
        channelSafetyMode: organizations.channelSafetyMode,
      })
      .from(organizations)
      .where(eq(organizations.id, CLINIC_ID))
      .limit(1),
    getResponsibleDoctorName(CLINIC_ID, memberProfile?.professionalId ?? null),
    userEmail
      ? db
          .select({ avatarUrl: clinicMembers.avatarUrl })
          .from(clinicMembers)
          .where(and(eq(clinicMembers.email, userEmail), eq(clinicMembers.clinicId, CLINIC_ID)))
          .limit(1)
      : Promise.resolve([] as Array<{ avatarUrl: string | null }>),
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
        gte(appointments.startsAt, new Date()),
      ))
      .orderBy(asc(appointments.startsAt))
      .limit(5),
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
    db
      .select({
        status: leads.status,
        treatmentInterest: leads.treatmentInterest,
        summary: conversations.summary,
        lastMessage: lastMessageSql,
      })
      .from(conversations)
      .innerJoin(leads, eq(conversations.leadId, leads.id))
      .where(and(
        eq(conversations.clinicId, CLINIC_ID),
        eq(conversations.category, "sales"),
        notInArray(leads.status, ["appointment_scheduled", "won"]),
      ))
  ]);

  const [latestSnapshot] = await db
    .select({ healthScore: channelHealthSnapshots.healthScore })
    .from(channelHealthSnapshots)
    .where(eq(channelHealthSnapshots.clinicId, CLINIC_ID))
    .orderBy(desc(channelHealthSnapshots.createdAt))
    .limit(1);
  const currentScore = latestSnapshot?.healthScore ?? 100;

  const periodFunnel = buildPeriodFunnel(periodLeadSnapshotResult);

  return {
    totalLeads: totalLeadsResult[0]?.count ?? 0,
    activeLeads: activeLeadsResult[0]?.count ?? 0,
    scheduledCount: scheduledResult[0]?.count ?? 0,
    activeHotCount: activeHotResult[0]?.count ?? 0,
    afterHoursCount: afterHoursResult[0]?.count ?? 0,
    totalConversations: totalConversationsResult[0]?.count ?? 0,
    needsAttentionCount: needsAttentionResult[0]?.count ?? 0,
    agentMessageCount: agentMessagesResult[0]?.count ?? 0,
    currentPeriodLeadCount: currentFlowLeadsResult.length,
    previousPeriodLeadCount: previousLeadPeriodResult[0]?.count ?? 0,
    recentLeads: recentLeadsResult,
    hotLeads: hotLeadsResult,
    treatmentCatalog: treatmentCatalogResult,
    flowSeries: buildFlowSeries(currentFlowLeadsResult, flowStart, days),
    tempCounts: {
      hot: tempHotResult[0]?.count ?? 0,
      warm: tempWarmResult[0]?.count ?? 0,
      cold: tempColdResult[0]?.count ?? 0,
    },
    statusCounts: Object.fromEntries(statusCountsResult.map((row) => [row.status, row.count])),
    userEmail,
    avatarUrl: memberResult[0]?.avatarUrl ?? null,
    clinicName: clinicInfoResult[0]?.name ?? "",
    responsibleDoctorName,
    autoReplyEnabled: clinicInfoResult[0]?.autoReplyEnabled ?? false,
    memberProfile,
    flowStart,
    CLINIC_ID,
    todayAppointments: todayAppointmentsResult,
    upcomingAppointments: upcomingAppointmentsResult,
    recoveryLeads: recoveryLeadsResult,
    attentionLeads: attentionLeadsResult,
    insightConversations: insightConversationsResult,
    periodFunnel,
    channelSafetyMode: clinicInfoResult[0]?.channelSafetyMode ?? "normal",
    healthScore: currentScore,
  };
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period = "7d" } = await searchParams;
  const safePeriod = (["1d", "7d", "30d"].includes(period) ? period : "7d") as PeriodKey;
  const data = await fetchDashboardData(safePeriod);

  const { memberProfile } = data;
  const showRevenue = memberProfile
    ? canViewFinancials(memberProfile) || canViewOwnRevenue(memberProfile)
    : false;
  const ownRevenueOnly = memberProfile ? canViewOwnRevenue(memberProfile) : false;
  const showRoi = memberProfile ? canViewFinancials(memberProfile) : false;
  const revenueData = showRevenue
      ? await fetchRevenueData(
        data.CLINIC_ID,
        data.flowStart,
        periodToDays(safePeriod),
        ownRevenueOnly ? (memberProfile?.professionalId ?? null) : null,
      )
    : null;

  return (
    <DashboardCommandCenter
      data={data}
      revenueData={revenueData}
      safePeriod={safePeriod}
      showRevenue={showRevenue}
      showRoi={showRoi}
      ownRevenueOnly={ownRevenueOnly}
    />
  );
}
