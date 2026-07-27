import { asc, desc, eq, and } from "drizzle-orm";
import { fingerprintReplayConfig } from "@/application/replay/fingerprint-replay-config";
import { db } from "@/infrastructure/db/client";
import {
  clinicModules,
  organizations,
  playbookVersions,
  treatments,
} from "@/infrastructure/db/schema";

export async function loadReplayClinicManifest(clinicKey: string) {
  const [clinic] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, clinicKey))
    .limit(1);
  if (!clinic?.slug) {
    throw new Error(`Clinic not found or without slug: ${clinicKey}`);
  }
  const resolvedClinic = { ...clinic, slug: clinic.slug };

  const [activePlaybook, clinicTreatments, modules] = await Promise.all([
    db
      .select()
      .from(playbookVersions)
      .where(
        and(
          eq(playbookVersions.clinicId, resolvedClinic.id),
          eq(playbookVersions.status, "active"),
        ),
      )
      .orderBy(desc(playbookVersions.updatedAt))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select()
      .from(treatments)
      .where(eq(treatments.clinicId, resolvedClinic.id))
      .orderBy(asc(treatments.name)),
    db
      .select({
        moduleKey: clinicModules.moduleKey,
        isActive: clinicModules.isActive,
        config: clinicModules.config,
      })
      .from(clinicModules)
      .where(eq(clinicModules.clinicId, resolvedClinic.id))
      .orderBy(asc(clinicModules.moduleKey)),
  ]);

  const configFingerprint = fingerprintReplayConfig({
    clinic: {
      specialty: resolvedClinic.specialty,
      timezone: resolvedClinic.timezone,
      businessHours: resolvedClinic.businessHours,
      calendarMode: resolvedClinic.calendarMode,
      autoReplyEnabled: resolvedClinic.autoReplyEnabled,
      takeoverTtlHours: resolvedClinic.takeoverTtlHours,
      postAppointmentBufferMinutes: resolvedClinic.postAppointmentBufferMinutes,
      defaultAppointmentDurationMinutes: resolvedClinic.defaultAppointmentDurationMinutes,
      unclearThreshold: resolvedClinic.unclearThreshold,
      staleConversationHours: resolvedClinic.staleConversationHours,
      conversationRestartHours: resolvedClinic.conversationRestartHours,
      slotOfferTtlMinutes: resolvedClinic.slotOfferTtlMinutes,
      maxSlotsToOffer: resolvedClinic.maxSlotsToOffer,
      slotLookaheadDays: resolvedClinic.slotLookaheadDays,
      offerSlotsAfterPriceEnabled: resolvedClinic.offerSlotsAfterPriceEnabled,
      outsideHoursExceptionEnabled: resolvedClinic.outsideHoursExceptionEnabled,
      rapidThrottleMs: resolvedClinic.rapidThrottleMs,
      messageDebounceMs: resolvedClinic.messageDebounceMs,
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
      pipelineSourceTreatmentId: treatment.pipelineSourceTreatmentId,
      pipelineEntryBehavior: treatment.pipelineEntryBehavior,
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

  return {
    clinic: resolvedClinic,
    activePlaybook,
    clinicTreatments,
    modules,
    configFingerprint,
    playbookFingerprint,
  };
}
