import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { asc, eq } from "drizzle-orm";
import { resolveActiveEditorialConfig } from "@/application/config/editorial-config";
import { getActivePriceCampaignsByTreatment, resolveEffectivePrice } from "@/application/config/price-campaigns";
import { getClinicModules } from "@/application/modules/module-gate";
import { db } from "@/infrastructure/db/client";
import {
  clinicModules,
  mediaAssets,
  organizations,
  playbookVersions,
  priceCampaigns,
  treatments,
} from "@/infrastructure/db/schema";

type Severity = "P0" | "P1" | "P2" | "P3";
type FindingCategory =
  | "ownership"
  | "duplicate"
  | "missing"
  | "orphan"
  | "runtime"
  | "migration"
  | "security";

type ConfigFinding = {
  id: string;
  severity: Severity;
  category: FindingCategory;
  title: string;
  evidence: Array<{ source: "db" | "code" | "runtime"; reference: string; value?: unknown }>;
  recommendation: string;
  autoFixSafe: boolean;
};

const SENSITIVE_KEY_RE =
  /(token|secret|password|credential|private.?key|access.?key|api.?key|pix|phone|email|recipient)/i;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
// Exige que o número não esteja dentro de um UUID/hash. O regex anterior aceitava
// hífens como separadores e acabava corrompendo IDs técnicos no snapshot.
const PHONE_RE =
  /(?<![A-F0-9-])(?:\+?55[\s.-]*)?(?:\(\d{2}\)|\d{2})[\s.-]*\d{4,5}[\s.-]?\d{4}(?![A-F0-9-])/gi;
const CPF_RE = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const CNPJ_RE = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
const URL_RE = /https?:\/\/[^\s)"'<>]+/gi;

function sanitizeText(value: string): string {
  return value
    .replace(EMAIL_RE, "[REDACTED_EMAIL]")
    .replace(CNPJ_RE, "[REDACTED_CNPJ]")
    .replace(CPF_RE, "[REDACTED_CPF]")
    .replace(PHONE_RE, "[REDACTED_PHONE]")
    .replace(URL_RE, "[REDACTED_URL]");
}

function sanitizeValue(value: unknown, key = ""): unknown {
  if (SENSITIVE_KEY_RE.test(key)) return "[REDACTED]";
  if (typeof value === "string") return sanitizeText(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([nestedKey, nestedValue]) => [
        nestedKey,
        sanitizeValue(nestedValue, nestedKey),
      ]),
    );
  }
  return value;
}

function gitValue(args: string[]): string | null {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

function pushFinding(
  findings: ConfigFinding[],
  finding: ConfigFinding,
): void {
  findings.push(finding);
}

async function auditClinic(slug: string) {
  const [organization] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);

  if (!organization) throw new Error(`Clinic not found: ${slug}`);

  const [
    playbooks,
    clinicTreatments,
    campaigns,
    modules,
    assets,
    runtimeEditorial,
    activeCampaigns,
  ] = await Promise.all([
    db
      .select()
      .from(playbookVersions)
      .where(eq(playbookVersions.clinicId, organization.id))
      .orderBy(asc(playbookVersions.createdAt)),
    db
      .select()
      .from(treatments)
      .where(eq(treatments.clinicId, organization.id))
      .orderBy(asc(treatments.name)),
    db
      .select()
      .from(priceCampaigns)
      .where(eq(priceCampaigns.clinicId, organization.id))
      .orderBy(asc(priceCampaigns.createdAt)),
    db
      .select()
      .from(clinicModules)
      .where(eq(clinicModules.clinicId, organization.id))
      .orderBy(asc(clinicModules.moduleKey)),
    db
      .select()
      .from(mediaAssets)
      .where(eq(mediaAssets.clinicId, organization.id))
      .orderBy(asc(mediaAssets.title)),
    resolveActiveEditorialConfig(organization.id),
    getActivePriceCampaignsByTreatment(organization.id),
  ]);

  const findings: ConfigFinding[] = [];
  const activePlaybooks = playbooks.filter((playbook) => playbook.status === "active");

  if (activePlaybooks.length !== 1) {
    pushFinding(findings, {
      id: "CFG-ACTIVE-PLAYBOOK-COUNT",
      severity: activePlaybooks.length === 0 ? "P1" : "P0",
      category: activePlaybooks.length === 0 ? "missing" : "duplicate",
      title: `A clínica possui ${activePlaybooks.length} playbook(s) ativo(s)`,
      evidence: [
        {
          source: "db",
          reference: "playbook_versions.status=active",
          value: activePlaybooks.map((playbook) => playbook.id),
        },
      ],
      recommendation: "Definir exatamente uma versão ativa antes de adicionar constraint parcial.",
      autoFixSafe: false,
    });
  }

  const treatmentById = new Map(clinicTreatments.map((treatment) => [treatment.id, treatment]));
  const pipelineOwners = new Map<string, typeof clinicTreatments>();
  const aliasOwners = new Map<string, typeof clinicTreatments>();

  for (const treatment of clinicTreatments) {
    if (treatment.pipelineSteps?.length) {
      const fingerprint = JSON.stringify(treatment.pipelineSteps);
      pipelineOwners.set(fingerprint, [
        ...(pipelineOwners.get(fingerprint) ?? []),
        treatment,
      ]);
    }
    if (treatment.keywordMatchEnabled) {
      for (const alias of treatment.aliases ?? []) {
        const normalizedAlias = sanitizeText(alias)
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .trim();
        if (!normalizedAlias) continue;
        aliasOwners.set(normalizedAlias, [
          ...(aliasOwners.get(normalizedAlias) ?? []),
          treatment,
        ]);
      }
    }
  }

  for (const owners of pipelineOwners.values()) {
    if (owners.length < 2) continue;
    pushFinding(findings, {
      id: `CFG-DUPLICATE-PIPELINE-${owners.map((owner) => owner.id).sort().join("-")}`,
      severity: "P1",
      category: "duplicate",
      title: `${owners.length} tratamentos possuem uma cópia idêntica do mesmo pipeline`,
      evidence: [
        {
          source: "db",
          reference: "treatments.pipeline_steps",
          value: owners.map((owner) => ({ id: owner.id, name: owner.name })),
        },
      ],
      recommendation:
        "Manter o pipeline em um tratamento canônico e apontar as variantes por pipeline_source_treatment_id.",
      autoFixSafe: false,
    });
  }

  for (const [alias, owners] of aliasOwners) {
    const distinctOwners = [...new Map(
      owners.map((owner) => [owner.id, owner]),
    ).values()];
    if (distinctOwners.length < 2) continue;
    const pipelineBackedOwners = distinctOwners.filter(
      (owner) => owner.pipelineSteps?.length || owner.pipelineSourceTreatmentId,
    );
    if (pipelineBackedOwners.length < 2) continue;
    pushFinding(findings, {
      id: `CFG-AMBIGUOUS-PIPELINE-ALIAS-${alias.replace(/[^a-z0-9]+/g, "-")}`,
      severity: "P1",
      category: "duplicate",
      title: `Alias "${alias}" pode iniciar pipelines de tratamentos diferentes`,
      evidence: [
        {
          source: "db",
          reference: "treatments.aliases",
          value: pipelineBackedOwners.map((owner) => ({
            id: owner.id,
            name: owner.name,
          })),
        },
      ],
      recommendation:
        "Deixar o alias genérico somente no tratamento canônico; variantes devem manter apenas aliases específicos.",
      autoFixSafe: false,
    });
  }

  for (const treatment of clinicTreatments) {
    if (treatment.pipelineSourceTreatmentId) {
      const source = treatmentById.get(treatment.pipelineSourceTreatmentId);
      if (!source) {
        pushFinding(findings, {
          id: `CFG-PIPELINE-SOURCE-${treatment.id}`,
          severity: "P1",
          category: "orphan",
          title: `Pipeline herdado de "${treatment.name}" não resolve dentro da clínica`,
          evidence: [
            {
              source: "db",
              reference: `treatments.pipeline_source_treatment_id:${treatment.id}`,
              value: treatment.pipelineSourceTreatmentId,
            },
          ],
          recommendation: "Selecionar uma fonte de pipeline existente da mesma clínica ou remover a herança.",
          autoFixSafe: false,
        });
      } else if (source.pipelineSourceTreatmentId || !(source.pipelineSteps?.length)) {
        pushFinding(findings, {
          id: `CFG-PIPELINE-SOURCE-NOT-CANONICAL-${treatment.id}`,
          severity: "P1",
          category: "orphan",
          title: `A fonte de pipeline de "${treatment.name}" não é canônica`,
          evidence: [
            {
              source: "db",
              reference: `treatments.pipeline_source_treatment_id:${treatment.id}`,
              value: {
                sourceTreatmentId: source.id,
                sourceHasOwnSource: Boolean(source.pipelineSourceTreatmentId),
                sourceStepCount: source.pipelineSteps?.length ?? 0,
              },
            },
          ],
          recommendation: "A variante deve apontar diretamente para um tratamento com etapas próprias.",
          autoFixSafe: false,
        });
      }
      if (treatment.pipelineSteps?.length) {
        pushFinding(findings, {
          id: `CFG-PIPELINE-VARIANT-LOCAL-COPY-${treatment.id}`,
          severity: "P1",
          category: "duplicate",
          title: `Variante "${treatment.name}" ainda mantém uma cópia local do pipeline`,
          evidence: [
            {
              source: "db",
              reference: `treatments.pipeline_steps:${treatment.id}`,
              value: { stepCount: treatment.pipelineSteps.length },
            },
          ],
          recommendation: "Limpar pipeline_steps da variante; a jornada deve existir somente no canônico.",
          autoFixSafe: false,
        });
      }
    }

    if (treatment.triggerTemplate?.trim() && (treatment.pipelineSteps?.length ?? 0) > 0) {
      pushFinding(findings, {
        id: `CFG-TRIGGER-PIPELINE-${treatment.id}`,
        severity: "P2",
        category: "duplicate",
        title: `Tratamento "${treatment.name}" possui triggerTemplate e pipelineSteps`,
        evidence: [
          {
            source: "db",
            reference: `treatments:${treatment.id}`,
            value: { hasTriggerTemplate: true, pipelineStepCount: treatment.pipelineSteps?.length ?? 0 },
          },
        ],
        recommendation: "Confirmar qual mecanismo é consumido e migrar para um único dono.",
        autoFixSafe: false,
      });
    }

    if (/R\s*\$/i.test(treatment.description ?? "")) {
      pushFinding(findings, {
        id: `CFG-PRICE-IN-DESCRIPTION-${treatment.id}`,
        severity: "P1",
        category: "duplicate",
        title: `Descrição de "${treatment.name}" contém preço em prosa livre`,
        evidence: [{ source: "db", reference: `treatments.description:${treatment.id}` }],
        recommendation: "Manter preço somente nos campos estruturados do tratamento/campanha.",
        autoFixSafe: false,
      });
    }
  }

  for (const playbook of playbooks) {
    if ((playbook.mediaLibrary?.length ?? 0) > 0) {
      pushFinding(findings, {
        id: `CFG-LEGACY-MEDIA-${playbook.id}`,
        severity: "P2",
        category: "migration",
        title: `Playbook "${playbook.name}" ainda possui media_library legado`,
        evidence: [
          {
            source: "db",
            reference: `playbook_versions.media_library:${playbook.id}`,
            value: { count: playbook.mediaLibrary.length },
          },
        ],
        recommendation: "Confirmar backfill para media_assets/media_asset_ids antes de remover o fallback.",
        autoFixSafe: false,
      });
    }

    if (/R\s*\$/i.test(playbook.commercialPolicy ?? "")) {
      pushFinding(findings, {
        id: `CFG-PRICE-IN-COMMERCIAL-POLICY-${playbook.id}`,
        severity: "P1",
        category: "duplicate",
        title: `Playbook "${playbook.name}" contém preço digitado na política comercial`,
        evidence: [{ source: "db", reference: `playbook_versions.commercial_policy:${playbook.id}` }],
        recommendation: "Remover o número manual após confirmar que composePriceSection cobre o caso.",
        autoFixSafe: false,
      });
    }

    if (/(^|\n)\s*trigger\b/i.test(playbook.notes ?? "")) {
      pushFinding(findings, {
        id: `CFG-LEGACY-TRIGGER-NOTES-${playbook.id}`,
        severity: "P1",
        category: "duplicate",
        title: `Playbook "${playbook.name}" contém trigger legado em notes`,
        evidence: [{ source: "db", reference: `playbook_versions.notes:${playbook.id}` }],
        recommendation: "Migrar o comportamento para pipelineSteps e remover a instrução duplicada.",
        autoFixSafe: false,
      });
    }
  }

  const assetIds = new Set(assets.map((asset) => asset.id));
  for (const playbook of playbooks) {
    const missingIds = (playbook.mediaAssetIds ?? []).filter((id) => !assetIds.has(id));
    if (missingIds.length > 0) {
      pushFinding(findings, {
        id: `CFG-MISSING-MEDIA-${playbook.id}`,
        severity: "P1",
        category: "orphan",
        title: `Playbook "${playbook.name}" referencia mídias inexistentes`,
        evidence: [
          {
            source: "db",
            reference: `playbook_versions.media_asset_ids:${playbook.id}`,
            value: missingIds,
          },
        ],
        recommendation: "Remover os IDs órfãos ou restaurar os assets corretos da mesma clínica.",
        autoFixSafe: false,
      });
    }
  }

  const now = new Date();
  for (const treatment of clinicTreatments) {
    const liveCampaigns = campaigns.filter(
      (campaign) =>
        campaign.treatmentId === treatment.id &&
        campaign.isActive &&
        (!campaign.startsAt || campaign.startsAt <= now) &&
        (!campaign.endsAt || campaign.endsAt >= now),
    );
    if (liveCampaigns.length > 1) {
      pushFinding(findings, {
        id: `CFG-MULTIPLE-CAMPAIGNS-${treatment.id}`,
        severity: "P1",
        category: "duplicate",
        title: `Tratamento "${treatment.name}" possui múltiplas campanhas vigentes`,
        evidence: [
          {
            source: "db",
            reference: `price_campaigns:treatment=${treatment.id}`,
            value: liveCampaigns.map((campaign) => campaign.id),
          },
        ],
        recommendation: "Definir precedência explícita ou impedir sobreposição no fluxo de ativação.",
        autoFixSafe: false,
      });
    }
  }

  if (organization.calendarMode === "internal" && organization.googleCalendarId) {
    pushFinding(findings, {
      id: "CFG-INACTIVE-GOOGLE-CALENDAR-ID",
      severity: "P3",
      category: "runtime",
      title: "googleCalendarId está preenchido, mas calendarMode é internal",
      evidence: [
        {
          source: "db",
          reference: "organizations.calendar_mode/google_calendar_id",
          value: { calendarMode: organization.calendarMode, googleCalendarIdConfigured: true },
        },
      ],
      recommendation: "Confirmar se o ID é legado intencional e sinalizar claramente na UI que está inativo.",
      autoFixSafe: false,
    });
  }

  if (organization.shadowModeEnabled) {
    pushFinding(findings, {
      id: "CFG-DELIVERY-SHADOW-NOT-ENGINE-SHADOW",
      severity: "P1",
      category: "runtime",
      title: "shadowModeEnabled suprime entrega, mas permite efeitos do motor atual",
      evidence: [
        {
          source: "code",
          reference: "src/infrastructure/db/schema.ts:shadowModeEnabled",
          value: true,
        },
      ],
      recommendation: "Não reutilizar esta flag como V2 decision shadow puro.",
      autoFixSafe: false,
    });
  }

  const resolvedPipelines = clinicTreatments.map((treatment) => {
    const source = treatment.pipelineSourceTreatmentId
      ? treatmentById.get(treatment.pipelineSourceTreatmentId) ?? null
      : null;
    const resolved = source?.pipelineSteps?.length ? source : treatment;
    return {
      treatmentId: treatment.id,
      treatmentName: treatment.name,
      sourceTreatmentId: source?.id ?? null,
      sourceTreatmentName: source?.name ?? null,
      resolvedTreatmentId: resolved.id,
      pipelineEntryBehavior:
        treatment.pipelineEntryBehavior ?? resolved.pipelineEntryBehavior ?? null,
      stepCount: resolved.pipelineSteps?.length ?? 0,
      steps: sanitizeValue(resolved.pipelineSteps ?? []),
    };
  });

  const effectivePrices = clinicTreatments.map((treatment) => {
    const campaign = activeCampaigns.get(treatment.id) ?? null;
    return {
      treatmentId: treatment.id,
      treatmentName: treatment.name,
      value: resolveEffectivePrice(treatment, campaign),
    };
  });

  // Campos adicionados em produção depois do antigo ponto de corte da develop.
  // Agora são lidos pelo schema canônico já sincronizado. Exportamos somente
  // presença/contagem para não copiar endereço, URL ou texto de garantia.
  const currentSchemaExtensions = {
    addressComplementConfigured: Boolean(organization.addressComplement?.trim()),
    mapsUrlConfigured: Boolean(organization.mapsUrl?.trim()),
    locationMessageConfigured: Boolean(organization.locationMessage?.trim()),
    warrantyPolicyConfigured: Boolean(activePlaybooks[0]?.warrantyPolicy),
    warrantyTierCount: activePlaybooks[0]?.warrantyPolicy?.tiers.length ?? 0,
  };

  return {
    metadata: {
      generatedAt: new Date().toISOString(),
      gitCommit: gitValue(["rev-parse", "HEAD"]),
      branch: gitValue(["branch", "--show-current"]),
      schemaVersion: gitValue(["rev-parse", "--short", "HEAD"]),
      auditedProductionCommit: gitValue(["rev-parse", "origin/main"]),
      sanitized: true as const,
      source: "read-only production database query",
    },
    organization: sanitizeValue({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      specialty: organization.specialty,
      city: organization.city,
      timezone: organization.timezone,
      businessHours: organization.businessHours,
      calendarMode: organization.calendarMode,
      googleCalendarIdConfigured: Boolean(organization.googleCalendarId),
      autoReplyEnabled: organization.autoReplyEnabled,
      operationalStatus: organization.operationalStatus,
      shadowModeEnabled: organization.shadowModeEnabled,
      automatedReengagementPaused: organization.automatedReengagementPaused,
      staleConversationHours: organization.staleConversationHours,
      conversationRestartHours: organization.conversationRestartHours,
      slotOfferTtlMinutes: organization.slotOfferTtlMinutes,
      maxSlotsToOffer: organization.maxSlotsToOffer,
      slotLookaheadDays: organization.slotLookaheadDays,
      offerSlotsAfterPriceEnabled: organization.offerSlotsAfterPriceEnabled,
      rapidThrottleMs: organization.rapidThrottleMs,
      messageDebounceMs: organization.messageDebounceMs,
      defaultAppointmentDurationMinutes: organization.defaultAppointmentDurationMinutes,
      postAppointmentBufferMinutes: organization.postAppointmentBufferMinutes,
      depositEnabled: organization.depositEnabled,
      depositAmountCents: organization.depositAmountCents,
      depositTtlHours: organization.depositTtlHours,
      channelProvider: organization.channelProvider,
      isTest: organization.isTest,
      isDemo: organization.isDemo,
      segment: organization.segment,
      serviceNoun: organization.serviceNoun,
      bookingNoun: organization.bookingNoun,
      contactNoun: organization.contactNoun,
      agentRole: organization.agentRole,
      businessDescriptor: organization.businessDescriptor,
      updatedAt: organization.updatedAt,
    }),
    currentSchemaExtensions: sanitizeValue(currentSchemaExtensions),
    activePlaybook: activePlaybooks[0]
      ? sanitizeValue({
          id: activePlaybooks[0].id,
          name: activePlaybooks[0].name,
          status: activePlaybooks[0].status,
          specialty: activePlaybooks[0].specialty,
          toneOfVoice: activePlaybooks[0].toneOfVoice,
          commercialPolicy: activePlaybooks[0].commercialPolicy,
          notes: activePlaybooks[0].notes,
          receptionistName: activePlaybooks[0].receptionistName,
          differentials: activePlaybooks[0].differentials,
          objections: activePlaybooks[0].objections,
          warrantyPolicyConfigured: Boolean(activePlaybooks[0].warrantyPolicy),
          warrantyTierCount: activePlaybooks[0].warrantyPolicy?.tiers.length ?? 0,
          mediaAssetIds: activePlaybooks[0].mediaAssetIds,
          legacyMediaCount: activePlaybooks[0].mediaLibrary.length,
          createdAt: activePlaybooks[0].createdAt,
          updatedAt: activePlaybooks[0].updatedAt,
        })
      : null,
    playbookVersions: playbooks.map((playbook) =>
      sanitizeValue({
        id: playbook.id,
        name: playbook.name,
        status: playbook.status,
        specialty: playbook.specialty,
        toneOfVoice: playbook.toneOfVoice,
        commercialPolicy: playbook.commercialPolicy,
        notes: playbook.notes,
        receptionistName: playbook.receptionistName,
        differentials: playbook.differentials,
        objections: playbook.objections,
        warrantyPolicyConfigured: Boolean(playbook.warrantyPolicy),
        warrantyTierCount: playbook.warrantyPolicy?.tiers.length ?? 0,
        mediaAssetIds: playbook.mediaAssetIds,
        legacyMediaCount: playbook.mediaLibrary.length,
        createdAt: playbook.createdAt,
        updatedAt: playbook.updatedAt,
      }),
    ),
    treatments: clinicTreatments.map((treatment) =>
      sanitizeValue({
        ...treatment,
        triggerTemplateConfigured: Boolean(treatment.triggerTemplate?.trim()),
        triggerTemplate: treatment.triggerTemplate,
      }),
    ),
    resolvedPipelines,
    priceCampaigns: campaigns.map((campaign) => sanitizeValue(campaign)),
    effectivePrices: sanitizeValue(effectivePrices),
    modules: modules.map((module) =>
      sanitizeValue({
        moduleKey: module.moduleKey,
        isActive: module.isActive,
        config: module.config,
        updatedAt: module.updatedAt,
      }),
    ),
    runtimeModules: sanitizeValue(await getClinicModules(organization.id)),
    mediaAssets: assets.map((asset) =>
      sanitizeValue({
        id: asset.id,
        treatmentId: asset.treatmentId,
        title: asset.title,
        type: asset.type,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
        folder: asset.folder,
        createdAt: asset.createdAt,
        updatedAt: asset.updatedAt,
      }),
    ),
    runtimeResolution: {
      editorialConfig: runtimeEditorial
        ? sanitizeValue({
            specialty: runtimeEditorial.specialty,
            toneOfVoice: runtimeEditorial.toneOfVoice,
            commercialPolicy: runtimeEditorial.commercialPolicy,
            procedures: runtimeEditorial.procedures,
            receptionistName: runtimeEditorial.receptionistName,
            differentials: runtimeEditorial.differentials,
            objections: runtimeEditorial.objections,
            mediaLibrary: runtimeEditorial.mediaLibrary.map((asset) => ({
              id: asset.id,
              title: asset.title,
              type: asset.type,
              treatmentId: asset.treatmentId,
            })),
            playbookText: runtimeEditorial.playbookText,
          })
        : null,
    },
    findings,
  };
}

function parseArguments(argv: string[]): { slugs: string[]; outDir: string } {
  const outDirIndex = argv.indexOf("--out-dir");
  const outDir = outDirIndex >= 0 && argv[outDirIndex + 1]
    ? argv[outDirIndex + 1]
    : "artifacts/config-audit";

  if (argv.includes("--all")) {
    return { slugs: [], outDir };
  }

  const slugIndex = argv.indexOf("--slug");
  const slug = slugIndex >= 0 ? argv[slugIndex + 1] : null;
  if (!slug) {
    throw new Error("Use --slug <clinic-slug> or --all");
  }
  return { slugs: [slug], outDir };
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  const slugs = args.slugs.length > 0
    ? args.slugs
    : await db
        .select({ slug: organizations.slug })
        .from(organizations)
        .then((rows) => rows.flatMap((row) => (row.slug ? [row.slug] : [])));

  await mkdir(args.outDir, { recursive: true });

  for (const slug of slugs) {
    const snapshot = await auditClinic(slug);
    const outputPath = path.join(args.outDir, `${slug}-config-snapshot.sanitized.json`);
    await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    console.log(
      JSON.stringify({
        slug,
        outputPath,
        findingCount: snapshot.findings.length,
        sanitized: true,
      }),
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
