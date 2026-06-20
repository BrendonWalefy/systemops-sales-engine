export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/infrastructure/db/client";
import {
  clinics,
  playbookVersions,
  treatments,
} from "@/infrastructure/db/schema";
import { eq, and } from "drizzle-orm";
import {
  ArrowLeft,
  Building2,
  MessageSquare,
  Calendar,
  BookOpen,
  CreditCard,
  Stethoscope,
  Shield,
  Film,
  Mic,
  Rocket,
  CheckCircle2,
  AlertCircle,
  Clock,
  ChevronRight,
  MapPin,
} from "lucide-react";
import { buildClinicBlueprint, type BlueprintSection } from "@/application/onboarding/clinic-blueprint";
import { getClinicVoiceBlueprintState } from "@/application/modules/module-gate";

type Params = Promise<{ clinicId: string }>;

function statusColor(status: BlueprintSection["status"]) {
  if (status === "complete") return "#10b981";
  if (status === "attention") return "#f59e0b";
  return "#6366f1";
}

function statusBg(status: BlueprintSection["status"]) {
  if (status === "complete") return "rgba(16,185,129,0.1)";
  if (status === "attention") return "rgba(245,158,11,0.1)";
  return "rgba(99,102,241,0.1)";
}

function statusLabel(status: BlueprintSection["status"]) {
  if (status === "complete") return "Completo";
  if (status === "attention") return "Atenção";
  return "Pendente";
}

function StatusIcon({ status, size = 16 }: { status: BlueprintSection["status"]; size?: number }) {
  if (status === "complete") return <CheckCircle2 size={size} style={{ color: "#10b981" }} />;
  if (status === "attention") return <AlertCircle size={size} style={{ color: "#f59e0b" }} />;
  return <Clock size={size} style={{ color: "#6366f1" }} />;
}

const SECTION_META: Record<
  BlueprintSection["id"],
  { icon: React.ReactNode; actionHref: (clinicId: string) => string; actionLabel: string }
> = {
  identity: {
    icon: <Building2 size={20} />,
    actionHref: (id) => `/owner/onboarding/${id}`,
    actionLabel: "Preencher no wizard",
  },
  channel: {
    icon: <MessageSquare size={20} />,
    actionHref: (id) => `/owner/onboarding/${id}`,
    actionLabel: "Configurar canal",
  },
  schedule: {
    icon: <Calendar size={20} />,
    actionHref: (id) => `/owner/onboarding/${id}`,
    actionLabel: "Configurar agenda",
  },
  playbook: {
    icon: <BookOpen size={20} />,
    actionHref: (id) => `/owner/onboarding/${id}`,
    actionLabel: "Editar playbook",
  },
  commercial: {
    icon: <CreditCard size={20} />,
    actionHref: (id) => `/owner/onboarding/${id}`,
    actionLabel: "Ajustar comercial",
  },
  treatments: {
    icon: <Stethoscope size={20} />,
    actionHref: (id) => `/owner/onboarding/${id}`,
    actionLabel: "Cadastrar tratamentos",
  },
  objections: {
    icon: <Shield size={20} />,
    actionHref: () => "/app/settings/playbook",
    actionLabel: "Mapear no playbook",
  },
  media: {
    icon: <Film size={20} />,
    actionHref: () => "/app/settings/playbook",
    actionLabel: "Adicionar mídia",
  },
  tts: {
    icon: <Mic size={20} />,
    actionHref: (id) => `/owner/clinics/${id}/modules`,
    actionLabel: "Configurar voz",
  },
  go_live: {
    icon: <Rocket size={20} />,
    actionHref: (id) => `/owner/clinics/${id}`,
    actionLabel: "Ir para detalhes",
  },
};

export default async function BlueprintPage({ params }: { params: Params }) {
  const { clinicId } = await params;

  const [clinic] = await db
    .select({
      id: clinics.id,
      name: clinics.name,
      specialty: clinics.specialty,
      city: clinics.city,
      address: clinics.address,
      greetingMessage: clinics.greetingMessage,
      businessHours: clinics.businessHours,
      calendarMode: clinics.calendarMode,
      googleCalendarId: clinics.googleCalendarId,
      receptionistPhone: clinics.receptionistPhone,
      plan: clinics.plan,
      monthlyRevenueBrl: clinics.monthlyRevenueBrl,
      billingStartedAt: clinics.billingStartedAt,
      defaultAppointmentDurationMinutes: clinics.defaultAppointmentDurationMinutes,
      postAppointmentBufferMinutes: clinics.postAppointmentBufferMinutes,
      takeoverTtlHours: clinics.takeoverTtlHours,
      autoReplyEnabled: clinics.autoReplyEnabled,
      operationalStatus: clinics.operationalStatus,
      isTest: clinics.isTest,
      channelProvider: clinics.channelProvider,
      zapiInstanceId: clinics.zapiInstanceId,
      zapiToken: clinics.zapiToken,
      metaPhoneNumberId: clinics.metaPhoneNumberId,
      metaAccessToken: clinics.metaAccessToken,
    })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);

  if (!clinic) notFound();

  const [voiceState, activePlaybook, clinicTreatments] = await Promise.all([
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
        mediaLibrary: true,
        objections: true,
      },
    }),
    db.query.treatments.findMany({
      where: eq(treatments.clinicId, clinicId),
      columns: { pipelineSteps: true },
    }),
  ]);

  const blueprint = buildClinicBlueprint({
    clinic: {
      ...clinic,
      ...voiceState,
    },
    playbook: {
      toneOfVoice: activePlaybook?.toneOfVoice ?? null,
      commercialPolicy: activePlaybook?.commercialPolicy ?? null,
      notes: activePlaybook?.notes ?? null,
      differentialsCount: Array.isArray(activePlaybook?.differentials)
        ? activePlaybook.differentials.length
        : 0,
      mediaLibraryCount: Array.isArray(activePlaybook?.mediaLibrary)
        ? activePlaybook.mediaLibrary.length
        : 0,
      objectionsCount: Array.isArray(activePlaybook?.objections)
        ? activePlaybook.objections.length
        : 0,
    },
    treatments: clinicTreatments.map((t) => ({
      pipelineStepsCount: Array.isArray(t.pipelineSteps) ? t.pipelineSteps.length : 0,
    })),
  });

  const mainSections = blueprint.sections.filter((s) => s.id !== "go_live");
  const goLiveSection = blueprint.sections.find((s) => s.id === "go_live");
  const enrichmentIds: BlueprintSection["id"][] = ["objections", "media", "tts"];

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "0 0 48px" }}>
      {/* Top bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "16px 20px",
          borderBottom: "1px solid var(--line)",
          flexWrap: "wrap",
        }}
      >
        <Link
          href={`/owner/clinics/${clinicId}`}
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
          {clinic.name}
        </Link>
        <span style={{ color: "var(--line-strong)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--fg)" }}>
          Clinic Blueprint
        </span>
      </div>

      <div style={{ padding: "24px 20px", display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Header card */}
        <div
          style={{
            borderRadius: 16,
            border: `1px solid ${statusColor(blueprint.status)}33`,
            background: statusBg(blueprint.status),
            padding: "20px 20px 24px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <div>
              <p className="eyebrow" style={{ margin: 0, color: "var(--muted)" }}>
                Clinic Blueprint
              </p>
              <h1
                style={{
                  margin: "6px 0 4px",
                  fontSize: 22,
                  fontWeight: 800,
                  color: "var(--fg)",
                  lineHeight: 1.2,
                }}
              >
                {clinic.name}
              </h1>
              {(clinic.specialty || clinic.city) && (
                <p
                  style={{
                    margin: 0,
                    fontSize: 13,
                    color: "var(--muted)",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  {clinic.specialty && <span>{clinic.specialty}</span>}
                  {clinic.specialty && clinic.city && (
                    <MapPin size={12} style={{ flexShrink: 0 }} />
                  )}
                  {clinic.city && <span>{clinic.city}</span>}
                </p>
              )}
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div
                style={{
                  fontSize: 36,
                  fontWeight: 900,
                  color: statusColor(blueprint.status),
                  lineHeight: 1,
                }}
              >
                {blueprint.readinessPercent}%
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: statusColor(blueprint.status),
                  fontWeight: 700,
                  marginTop: 4,
                }}
              >
                {statusLabel(blueprint.status)}
              </div>
            </div>
          </div>

          {/* Readiness bar */}
          <div
            style={{
              marginTop: 20,
              height: 6,
              borderRadius: 99,
              background: "rgba(255,255,255,0.08)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${blueprint.readinessPercent}%`,
                borderRadius: 99,
                background: statusColor(blueprint.status),
                transition: "width 0.4s ease",
              }}
            />
          </div>

          <div
            style={{
              marginTop: 12,
              display: "flex",
              gap: 16,
              flexWrap: "wrap",
              fontSize: 12,
              color: "var(--muted)",
            }}
          >
            <span>
              {mainSections.filter((s) => s.status === "complete").length}/{mainSections.length} blocos completos
            </span>
            {blueprint.criticalMissing.length > 0 && (
              <span style={{ color: "#f59e0b" }}>
                {blueprint.criticalMissing.length} item(s) bloqueando go-live
              </span>
            )}
          </div>
        </div>

        {/* Core sections */}
        <div>
          <p
            className="eyebrow"
            style={{ margin: "0 0 12px", color: "var(--muted)", fontSize: 11 }}
          >
            Blocos obrigatórios
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
              gap: 12,
            }}
          >
            {mainSections
              .filter((s) => !enrichmentIds.includes(s.id))
              .map((section) => (
                <SectionCard
                  key={section.id}
                  section={section}
                  clinicId={clinicId}
                />
              ))}
          </div>
        </div>

        {/* Enrichment sections */}
        <div>
          <p
            className="eyebrow"
            style={{ margin: "0 0 12px", color: "var(--muted)", fontSize: 11 }}
          >
            Enriquecimento (opcional mas recomendado)
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
              gap: 12,
            }}
          >
            {mainSections
              .filter((s) => enrichmentIds.includes(s.id))
              .map((section) => (
                <SectionCard
                  key={section.id}
                  section={section}
                  clinicId={clinicId}
                />
              ))}
          </div>
        </div>

        {/* Go-live */}
        {goLiveSection && (
          <div
            style={{
              borderRadius: 16,
              border:
                goLiveSection.status === "complete"
                  ? "1px solid rgba(16,185,129,0.22)"
                  : "1px solid rgba(245,158,11,0.22)",
              background:
                goLiveSection.status === "complete"
                  ? "rgba(16,185,129,0.04)"
                  : "rgba(245,158,11,0.04)",
              padding: "20px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
                marginBottom: goLiveSection.missing.length > 0 ? 16 : 0,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    background: statusBg(goLiveSection.status),
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: statusColor(goLiveSection.status),
                    flexShrink: 0,
                  }}
                >
                  <Rocket size={18} />
                </div>
                <div>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 14,
                      fontWeight: 700,
                      color: "var(--fg)",
                    }}
                  >
                    Checklist de Go-live
                  </p>
                  <p
                    style={{
                      margin: "2px 0 0",
                      fontSize: 12,
                      color: "var(--muted)",
                    }}
                  >
                    {goLiveSection.summary}
                  </p>
                </div>
              </div>
              <Link
                href={`/owner/clinics/${clinicId}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 14px",
                  borderRadius: 8,
                  textDecoration: "none",
                  fontSize: 13,
                  fontWeight: 700,
                  color:
                    goLiveSection.status === "complete"
                      ? "#10b981"
                      : "var(--accent-strong)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "var(--surface-soft)",
                  flexShrink: 0,
                }}
              >
                {goLiveSection.status === "complete" ? "Ativar IA" : "Ver detalhes"}
                <ChevronRight size={14} />
              </Link>
            </div>

            {goLiveSection.missing.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                {goLiveSection.missing.map((item, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 12px",
                      borderRadius: 8,
                      background: "rgba(245,158,11,0.06)",
                      border: "1px solid rgba(245,158,11,0.12)",
                    }}
                  >
                    <AlertCircle size={13} style={{ color: "#f59e0b", flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: "var(--fg)" }}>{item}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SectionCard({
  section,
  clinicId,
}: {
  section: BlueprintSection;
  clinicId: string;
}) {
  const meta = SECTION_META[section.id];
  const color = statusColor(section.status);
  const bg = statusBg(section.status);

  return (
    <div
      style={{
        borderRadius: 12,
        border: `1px solid ${color}22`,
        background: "var(--surface-soft)",
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      {/* Card header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: bg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color,
            flexShrink: 0,
          }}
        >
          {meta.icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: 14,
                fontWeight: 700,
                color: "var(--fg)",
              }}
            >
              {section.title}
            </p>
            <StatusIcon status={section.status} size={15} />
          </div>
          <p
            style={{
              margin: "3px 0 0",
              fontSize: 12,
              color: "var(--muted)",
              lineHeight: 1.45,
            }}
          >
            {section.summary}
          </p>
        </div>
      </div>

      {/* Missing items */}
      {section.missing.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {section.missing.map((item, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 10px",
                borderRadius: 6,
                background: "rgba(255,255,255,0.03)",
                border: "1px solid var(--line)",
              }}
            >
              <div
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: color,
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{item}</span>
            </div>
          ))}
        </div>
      )}

      {/* Action */}
      {section.status !== "complete" && (
        <Link
          href={meta.actionHref(clinicId)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 12px",
            borderRadius: 8,
            background: bg,
            border: `1px solid ${color}33`,
            textDecoration: "none",
            color,
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          {meta.actionLabel}
          <ChevronRight size={14} />
        </Link>
      )}
    </div>
  );
}
