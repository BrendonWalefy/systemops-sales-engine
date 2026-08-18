import { eq } from "drizzle-orm";
import {
  resolveActiveEditorialConfig,
  type EditorialConfig,
} from "@/application/config/editorial-config";
import type { LiveConversationContextReader } from "@/application/ports/live-conversation-context-reader";
import { resolveSegmentVocab } from "@/application/onboarding/segment-vocab";
import type { MenuItem, Organization } from "@/domain/entities/clinic";
import { db } from "@/infrastructure/db/client";
import { organizations } from "@/infrastructure/db/schema";

export type OrganizationRow = typeof organizations.$inferSelect;

export function buildOrganization(row: OrganizationRow): Organization {
  return {
    id: row.id,
    name: row.name,
    specialty: row.specialty,
    plan: row.plan,
    segment: row.segment,
    city: row.city,
    address: row.address ?? null,
    addressComplement: row.addressComplement ?? null,
    mapsUrl: row.mapsUrl ?? null,
    locationMessage: row.locationMessage ?? null,
    timezone: row.timezone,
    greetingMessage: row.greetingMessage ?? null,
    menuItems: (row.menuItems as MenuItem[] | null) ?? null,
    businessHours: row.businessHours,
    googleCalendarId: row.googleCalendarId,
    calendarMode: row.calendarMode,
    receptionistPhone: row.receptionistPhone ?? null,
    takeoverTtlHours: row.takeoverTtlHours,
    postAppointmentBufferMinutes: row.postAppointmentBufferMinutes,
    defaultAppointmentDurationMinutes: row.defaultAppointmentDurationMinutes,
    installmentRates: (row.installmentRates as {
      n: number;
      rate: number;
      active: boolean;
    }[] | null) ?? null,
    rateLimitPerHour: row.rateLimitPerHour,
    unclearThreshold: row.unclearThreshold,
    staleConversationHours: row.staleConversationHours,
    conversationRestartHours: row.conversationRestartHours,
    slotOfferTtlMinutes: row.slotOfferTtlMinutes,
    maxSlotsToOffer: row.maxSlotsToOffer,
    slotLookaheadDays: row.slotLookaheadDays,
    offerSlotsAfterPriceEnabled: row.offerSlotsAfterPriceEnabled,
    outsideHoursExceptionEnabled: row.outsideHoursExceptionEnabled,
    depositEnabled: row.depositEnabled,
    depositAmountCents: row.depositAmountCents ?? null,
    depositPixKey: row.depositPixKey ?? null,
    depositPixKeyType: row.depositPixKeyType ?? null,
    depositRecipientName: row.depositRecipientName ?? null,
    depositTtlHours: row.depositTtlHours,
    depositNotes: row.depositNotes ?? null,
    depositConfirmationNotes: row.depositConfirmationNotes ?? null,
    mediaTakeoverTtlHours: row.mediaTakeoverTtlHours ?? null,
    rapidThrottleMs: row.rapidThrottleMs,
    messageDebounceMs: row.messageDebounceMs ?? null,
    aiContextWindowMessages: row.aiContextWindowMessages ?? null,
    pipelineQaDefaultMaxTurns: row.pipelineQaDefaultMaxTurns ?? null,
    serviceNoun: row.serviceNoun,
    bookingNoun: row.bookingNoun,
    contactNoun: row.contactNoun,
    agentRole: row.agentRole,
    businessDescriptor: row.businessDescriptor ?? null,
    businessNoun: resolveSegmentVocab(row.segment).businessNoun,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleLiveConversationContextReader
  implements LiveConversationContextReader
{
  private readonly sourceRows = new WeakMap<Organization, Readonly<OrganizationRow>>();

  async findOrganization(clinicId: string): Promise<Organization | null> {
    const [row] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, clinicId))
      .limit(1);
    if (!row) return null;
    const organization = Object.freeze(buildOrganization(row));
    this.sourceRows.set(organization, Object.freeze({ ...row }));
    return organization;
  }

  resolveEditorialConfig(clinicId: string): Promise<EditorialConfig | null> {
    return resolveActiveEditorialConfig(clinicId);
  }

  getOrganizationRow(organization: Organization): Readonly<OrganizationRow> {
    const row = this.sourceRows.get(organization);
    if (!row) throw new Error("organization was not produced by this context reader");
    return row;
  }
}
