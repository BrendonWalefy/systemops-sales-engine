import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { buildSanitizedReplayCorpus } from "@/application/replay/build-sanitized-replay-corpus";
import { fingerprintReplayConfig } from "@/application/replay/fingerprint-replay-config";
import {
  assertClinicAllowedForReplayExport,
  assertReplayOutputOutsideGitRepository,
} from "@/application/replay/replay-export-policy";
import { db } from "@/infrastructure/db/client";
import {
  clinicModules,
  conversations,
  leads,
  messages,
  organizations,
  playbookVersions,
  treatments,
} from "@/infrastructure/db/schema";

type Arguments = {
  clinicKey: string;
  datasetVersion: string;
  outputDirectory: string;
  limit: number;
};

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  assertClinicAllowedForReplayExport(
    args.clinicKey,
    process.env.REPLAY_EXPORT_ALLOWED_CLINICS,
  );
  const sourceHashKey = process.env.REPLAY_EXPORT_HASH_KEY ?? "";
  if (sourceHashKey.length < 32) {
    throw new Error("REPLAY_EXPORT_HASH_KEY must have at least 32 characters");
  }

  await mkdir(args.outputDirectory, { recursive: true, mode: 0o700 });
  const outputDirectory = await realpath(args.outputDirectory);
  await assertReplayOutputOutsideGitRepository(outputDirectory);

  const [clinic] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, args.clinicKey))
    .limit(1);
  if (!clinic?.slug) throw new Error(`Clinic not found or without slug: ${args.clinicKey}`);
  assertClinicAllowedForReplayExport(
    clinic.slug,
    process.env.REPLAY_EXPORT_ALLOWED_CLINICS,
  );

  const [sourceConversations, activePlaybook, clinicTreatments, modules] =
    await Promise.all([
      db
        .select({
          id: conversations.id,
          leadId: conversations.leadId,
        })
        .from(conversations)
        .where(
          and(
            eq(conversations.clinicId, clinic.id),
            eq(conversations.category, "sales"),
          ),
        )
        .orderBy(desc(conversations.lastMessageAt))
        .limit(args.limit),
      db
        .select()
        .from(playbookVersions)
        .where(
          and(
            eq(playbookVersions.clinicId, clinic.id),
            eq(playbookVersions.status, "active"),
          ),
        )
        .orderBy(desc(playbookVersions.updatedAt))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      db
        .select()
        .from(treatments)
        .where(eq(treatments.clinicId, clinic.id))
        .orderBy(asc(treatments.name)),
      db
        .select({
          moduleKey: clinicModules.moduleKey,
          isActive: clinicModules.isActive,
          config: clinicModules.config,
        })
        .from(clinicModules)
        .where(eq(clinicModules.clinicId, clinic.id))
        .orderBy(asc(clinicModules.moduleKey)),
    ]);

  const conversationIds = sourceConversations.map((conversation) => conversation.id);
  const leadIds = [...new Set(sourceConversations.map((conversation) => conversation.leadId))];
  const [messageRows, leadRows] = await Promise.all([
    conversationIds.length
      ? db
          .select({
            id: messages.id,
            conversationId: messages.conversationId,
            author: messages.author,
            body: messages.body,
            mediaType: messages.mediaType,
            sentAt: messages.sentAt,
          })
          .from(messages)
          .where(inArray(messages.conversationId, conversationIds))
          .orderBy(asc(messages.sentAt))
      : Promise.resolve([]),
    leadIds.length
      ? db
          .select({ id: leads.id, name: leads.name })
          .from(leads)
          .where(inArray(leads.id, leadIds))
      : Promise.resolve([]),
  ]);

  const leadNameById = new Map(leadRows.map((lead) => [lead.id, lead.name]));
  const messagesByConversation = new Map<string, typeof messageRows>();
  for (const message of messageRows) {
    const entries = messagesByConversation.get(message.conversationId) ?? [];
    entries.push(message);
    messagesByConversation.set(message.conversationId, entries);
  }

  const configFingerprint = fingerprintReplayConfig({
    clinic: {
      specialty: clinic.specialty,
      timezone: clinic.timezone,
      businessHours: clinic.businessHours,
      calendarMode: clinic.calendarMode,
      autoReplyEnabled: clinic.autoReplyEnabled,
      takeoverTtlHours: clinic.takeoverTtlHours,
      postAppointmentBufferMinutes: clinic.postAppointmentBufferMinutes,
      defaultAppointmentDurationMinutes: clinic.defaultAppointmentDurationMinutes,
      unclearThreshold: clinic.unclearThreshold,
      staleConversationHours: clinic.staleConversationHours,
      conversationRestartHours: clinic.conversationRestartHours,
      slotOfferTtlMinutes: clinic.slotOfferTtlMinutes,
      maxSlotsToOffer: clinic.maxSlotsToOffer,
      slotLookaheadDays: clinic.slotLookaheadDays,
      offerSlotsAfterPriceEnabled: clinic.offerSlotsAfterPriceEnabled,
      rapidThrottleMs: clinic.rapidThrottleMs,
      messageDebounceMs: clinic.messageDebounceMs,
    },
    treatments: clinicTreatments.map((treatment) => ({
      name: treatment.name,
      durationMinutes: treatment.durationMinutes,
      description: treatment.description,
      requiresEvaluationFirst: treatment.requiresEvaluationFirst,
      triggerTemplate: treatment.triggerTemplate,
      keywordMatchEnabled: treatment.keywordMatchEnabled,
      aliases: treatment.aliases,
      isAesthetic: treatment.isAesthetic,
      pipelineSteps: treatment.pipelineSteps,
      priceCents: treatment.priceCents,
      minPriceCents: treatment.minPriceCents,
      maxPriceCents: treatment.maxPriceCents,
      priceQuotableInChat: treatment.priceQuotableInChat,
      priceKind: treatment.priceKind,
      priceUnit: treatment.priceUnit,
      priceDeductible: treatment.priceDeductible,
      quantityPrices: treatment.quantityPrices,
      bookingWindows: treatment.bookingWindows,
    })),
    modules,
  });
  const playbookFingerprint = activePlaybook
    ? fingerprintReplayConfig({
        specialty: activePlaybook.specialty,
        toneOfVoice: activePlaybook.toneOfVoice,
        differentials: activePlaybook.differentials,
        commercialPolicy: activePlaybook.commercialPolicy,
        notes: activePlaybook.notes,
        receptionistName: activePlaybook.receptionistName,
        objections: activePlaybook.objections,
        warrantyPolicy: activePlaybook.warrantyPolicy,
        mediaAssetIds: activePlaybook.mediaAssetIds,
      })
    : null;

  const dataset = buildSanitizedReplayCorpus({
    datasetVersion: args.datasetVersion,
    generatedAt: new Date(),
    clinicKey: clinic.slug,
    timezone: clinic.timezone,
    configFingerprint,
    playbookFingerprint,
    sourceHashKey,
    conversations: sourceConversations.map((conversation) => ({
      sourceId: conversation.id,
      leadName: leadNameById.get(conversation.leadId) ?? null,
      messages: (messagesByConversation.get(conversation.id) ?? []).map((message) => ({
        sourceId: message.id,
        author:
          message.author === "clinic_user"
            ? "operator"
            : message.author,
        body: message.body,
        mediaType: message.mediaType,
        sentAt: message.sentAt,
      })),
    })),
  });

  const safeClinicKey = clinic.slug.replace(/[^a-zA-Z0-9._-]/g, "_");
  const safeVersion = args.datasetVersion.replace(/[^a-zA-Z0-9._-]/g, "_");
  const outputPath = path.join(
    outputDirectory,
    `${safeClinicKey}.${safeVersion}.needs-review.json`,
  );
  await writeFile(outputPath, `${JSON.stringify(dataset, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  console.log(JSON.stringify({
    outputPath,
    clinicKey: clinic.slug,
    datasetVersion: args.datasetVersion,
    scenarioCount: dataset.scenarioCount,
    status: dataset.status,
  }));
}

export function parseArguments(argv: string[]): Arguments {
  const clinicKey = requiredValue(argv, "--clinic");
  const datasetVersion = requiredValue(argv, "--dataset-version");
  const outputDirectory = requiredValue(argv, "--out-dir");
  if (!path.isAbsolute(outputDirectory)) {
    throw new Error("--out-dir must be an absolute path outside a Git repository");
  }
  const rawLimit = optionalValue(argv, "--limit") ?? "50";
  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("--limit must be an integer between 1 and 100");
  }
  return { clinicKey, datasetVersion, outputDirectory, limit };
}

function requiredValue(argv: string[], flag: string): string {
  const value = optionalValue(argv, flag);
  if (!value) throw new Error(`${flag} is required`);
  return value;
}

function optionalValue(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  return index >= 0 ? (argv[index + 1] ?? null) : null;
}

if (process.env.VITEST !== "true") {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
