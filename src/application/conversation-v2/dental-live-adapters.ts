import { createHash } from "node:crypto";
import { isSafeAuthorizedDisplayText } from "@/conversation-core/authorized-response-plan";
import { parseInstitutionalDetails } from "@/application/config/institutional-details";
import { parsePaymentMethods, PAYMENT_METHOD_OPTIONS } from "@/application/config/payment-methods";
import type { EditorialConfig } from "@/application/config/editorial-config";
import type { CalendarGateway } from "@/application/ports/calendar-gateway";
import type {
  ConversationStateMachine,
  ConversationStateRow,
  FormattedSlot,
  SlotsOfferedPayload,
} from "@/core/conversation/ConversationStateMachine";
import type { BookingService } from "@/core/scheduling/BookingService";
import type { SlotReservationService } from "@/core/scheduling/SlotReservationService";
import {
  ClinicTimezone,
  parseBusinessHours,
} from "@/core/scheduling/ClinicTimezone";
import type { Appointment } from "@/domain/entities/calendar-slot";
import type { Organization } from "@/domain/entities/clinic";
import type { Conversation } from "@/domain/entities/conversation";
import type { Lead } from "@/domain/entities/lead";
import type { Treatment } from "@/domain/entities/treatment";
import type { Professional } from "@/domain/entities/professional";
import type { AppointmentRepository } from "@/domain/repositories/appointment-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { TreatmentRepository } from "@/domain/repositories/treatment-repository";
import type { MediaAssetRepository } from "@/domain/repositories/media-asset-repository";
import type { Message } from "@/domain/entities/conversation";
import type {
  DentalBusinessInformationFact,
  DentalAppointmentLifecycleReadPort,
  DentalAppointmentLifecycleWritePort,
  DentalCatalogReadPort,
  DentalCommercialReadPort,
  DentalKnowledgeReadPort,
  DentalPlaybookKnowledgeReadPort,
  DentalSchedulingReadPort,
  DentalSchedulingWriteOutcome,
  DentalSchedulingWritePort,
  DentalService,
  DentalSlot,
  DentalJourneyReadPort,
  DentalJourneyWritePort,
  DentalJourneyDeliveryPlan,
  ServiceResolution,
} from "@/domain-packs/dental/ports";
import {
  resolveEffectivePrice,
  type PriceCampaignRow,
} from "@/application/config/price-campaigns";
import {
  createDentalJourneyLiveAdapter,
  type DentalJourneyLiveAdapterDependencies,
} from "@/application/conversation-v2/dental-journey-live-adapter";
import { buildDepositRequestMessage } from "@/core/conversation/DepositTemplates";
import type { DepositFlowPayload } from "@/core/conversation/ConversationStateMachine";

type LiveState = Pick<
  ConversationStateMachine,
  | "getCurrentState"
  | "offerSlotsForTurn"
  | "invalidateIfCurrent"
> & Partial<Pick<ConversationStateMachine, "startDepositWaitForTurn">>;

export type DentalLiveAdapterDependencies = {
  treatments: Pick<TreatmentRepository, "listByClinic">;
  professionals: Pick<ProfessionalRepository, "listByClinic">;
  priceCampaigns?: Readonly<{
    listActiveByTreatment(
      clinicId: string,
      now: Date,
    ): Promise<ReadonlyMap<string, PriceCampaignRow>>;
  }>;
  calendar: Pick<CalendarGateway, "listAvailableSlots">;
  state: LiveState;
  appointments: Pick<
    AppointmentRepository,
    "findByPeriod" | "findByIdForClinicAndLead" | "findAllActiveByLeadId"
  >;
  reservations: Pick<SlotReservationService, "findActiveByPeriod">
    & Partial<Pick<SlotReservationService, "reserve" | "release">>;
  booking: Pick<
    BookingService,
    "book" | "confirmAppointment" | "cancelAppointment" | "reschedule"
  >;
  clinic: Organization;
  editorial: EditorialConfig | null;
  lead: Lead;
  leadId: string;
  conversation: Conversation;
  conversationId: string;
  turnId: string;
  now: Date;
  effectLifecycle?: Readonly<{
    attempted(): void;
    completed(): void;
  }>;
  journey?: Readonly<{
    mediaAssets: Pick<MediaAssetRepository, "findByIds">;
    state: DentalJourneyLiveAdapterDependencies["state"];
    reservations: DentalJourneyLiveAdapterDependencies["reservations"];
    inboundMessage: Pick<Message, "id" | "mediaType">;
    history: readonly Message[];
  }>;
};

class DentalLiveAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DentalLiveAdapterError";
  }
}

type ExactTreatmentResolution = {
  kind: "exact";
  treatment: Treatment;
};

type TreatmentResolution =
  | ExactTreatmentResolution
  | { kind: "ambiguous"; treatments: Treatment[] }
  | { kind: "unknown" };

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim()
    .replace(/\s+/g, " ");
}

function resolveTreatment(
  tenantTreatments: readonly Treatment[],
  query: string | null,
): TreatmentResolution {
  const normalized = query ? normalize(query) : "";
  if (!normalized) return { kind: "unknown" };
  const matches = tenantTreatments.filter((treatment) =>
    [treatment.name, ...treatment.aliases].some(
      (candidate) => normalize(candidate) === normalized,
    ),
  );
  if (matches.length === 1) return { kind: "exact", treatment: matches[0]! };
  if (matches.length > 1) {
    return {
      kind: "ambiguous",
      treatments: [...matches].sort((left, right) => left.id.localeCompare(right.id)),
    };
  }
  return { kind: "unknown" };
}

function toDentalService(treatment: Treatment): DentalService {
  return {
    id: treatment.id,
    name: treatment.name,
    priceCents: treatment.priceCents,
    priceDisclosable: treatment.priceQuotableInChat,
    description: treatment.description,
  };
}

function catalogEvidence(treatment: Treatment): string {
  return `treatment:${treatment.id}`;
}

function slotId(stateId: string, index: number, treatmentId: string): string {
  return `dental-slot:${encodeURIComponent(stateId)}:${index}:${encodeURIComponent(treatmentId)}`;
}

function parseSlotId(value: string): {
  stateId: string;
  index: number;
  treatmentId: string;
} | null {
  const match = /^dental-slot:([^:]+):([1-9]\d*):([^:]+)$/.exec(value);
  if (!match) return null;
  try {
    return {
      stateId: decodeURIComponent(match[1]!),
      index: Number(match[2]),
      treatmentId: decodeURIComponent(match[3]!),
    };
  } catch {
    return null;
  }
}

function slotEvidence(stateId: string, index: number): string {
  return `conversation-state:${stateId}:slot:${index}`;
}

function deterministicUuid(input: string): string {
  const bytes = Buffer.from(
    createHash("sha256").update(input).digest("hex").slice(0, 32),
    "hex",
  );
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function appointmentEvidence(appointmentId: string): string {
  return `appointment:${appointmentId}`;
}

function isActiveAppointment(appointment: Appointment): boolean {
  return appointment.status === "scheduled" || appointment.status === "confirmed";
}

function isExactAppointmentForSlot(
  appointment: Appointment,
  clinicId: string,
  startsAt: Date,
  endsAt: Date,
): boolean {
  return appointment.clinicId === clinicId &&
    isActiveAppointment(appointment) &&
    appointment.startsAt.getTime() === startsAt.getTime() &&
    appointment.endsAt.getTime() === endsAt.getTime();
}

function activeAppointmentForLead(
  appointments: readonly Appointment[],
  clinicId: string,
  leadId: string,
  startsAt: Date,
  endsAt: Date,
): Appointment | null {
  return appointments.find((appointment) =>
    appointment.leadId === leadId &&
    isExactAppointmentForSlot(appointment, clinicId, startsAt, endsAt),
  ) ?? null;
}

function parseOfferedPayload(state: ConversationStateRow): SlotsOfferedPayload | null {
  if (state.state !== "slots_offered") return null;
  const payload = state.payload as SlotsOfferedPayload | null;
  return payload?.slots?.length ? payload : null;
}

function datesMatch(
  timezone: ClinicTimezone,
  slot: FormattedSlot,
  requestedDate: string,
  reference: Date,
  businessHours: ReturnType<typeof parseBusinessHours>,
): boolean {
  const requested = timezone.resolvePreferredDate(
    requestedDate,
    reference,
    businessHours,
  );
  if (!requested) return false;
  const expected = timezone.toLocalParts(requested);
  const actual = timezone.toLocalParts(new Date(slot.startsAt));
  return expected.year === actual.year &&
    expected.month === actual.month &&
    expected.day === actual.day;
}

function timesMatch(
  timezone: ClinicTimezone,
  slot: FormattedSlot,
  requestedTime: string,
): boolean {
  const match = /^(\d{1,2})(?:(?:h(\d{2}))|(?::(\d{2}))|h)?$/.exec(
    normalize(requestedTime),
  );
  if (!match) return false;
  const expectedHour = Number(match[1]);
  const expectedMinute = Number(match[2] ?? match[3] ?? 0);
  if (expectedHour > 23 || expectedMinute > 59) return false;
  const actual = timezone.toLocalParts(new Date(slot.startsAt));
  return actual.hour === expectedHour && actual.minute === expectedMinute;
}

function validOfferedSlot(
  slot: FormattedSlot,
  treatment: Treatment,
): { startsAt: Date; endsAt: Date } | null {
  if (!Number.isInteger(slot.index) || slot.index < 1) return null;
  const startsAt = new Date(slot.startsAt);
  const endsAt = new Date(slot.endsAt);
  if (
    !Number.isFinite(startsAt.getTime()) ||
    !Number.isFinite(endsAt.getTime()) ||
    endsAt.getTime() <= startsAt.getTime() ||
    endsAt.getTime() - startsAt.getTime() !== treatment.durationMinutes * 60_000
  ) return null;
  return { startsAt, endsAt };
}

function toDentalSlot(
  stateId: string,
  slot: FormattedSlot,
  treatmentId: string,
  bookingKind: "book" | "reschedule" = "book",
): DentalSlot {
  return {
    id: slotId(stateId, slot.index, treatmentId),
    label: slot.label,
    evidenceRef: slotEvidence(stateId, slot.index),
    bookingKind,
  };
}

function periodMatches(
  timezone: ClinicTimezone,
  startsAt: Date,
  period: string | null,
): boolean {
  if (!period) return true;
  const hour = timezone.toLocalParts(startsAt).hour;
  switch (normalize(period)) {
    case "morning":
    case "manha":
      return hour >= 8 && hour < 12;
    case "afternoon":
    case "tarde":
      return hour >= 12 && hour < 18;
    case "evening":
    case "noite":
      return hour >= 18;
    default:
      return false;
  }
}

export function createDentalLiveAdapters(
  deps: DentalLiveAdapterDependencies,
): {
  knowledgeRead: DentalKnowledgeReadPort;
  playbookKnowledgeRead: DentalPlaybookKnowledgeReadPort;
  catalogRead: DentalCatalogReadPort;
  commercialRead: DentalCommercialReadPort;
  schedulingRead: DentalSchedulingReadPort;
  schedulingWrite: DentalSchedulingWritePort;
  appointmentLifecycleRead: DentalAppointmentLifecycleReadPort;
  appointmentLifecycleWrite: DentalAppointmentLifecycleWritePort;
  journeyRead: DentalJourneyReadPort;
  journeyWrite: DentalJourneyWritePort;
} {
  const {
    appointments,
    booking,
    calendar,
    clinic,
    conversation,
    conversationId,
    effectLifecycle,
    editorial,
    lead,
    leadId,
    now: turnNow,
    reservations,
    state,
    treatments,
    professionals,
    turnId,
  } = deps;
  if (lead.clinicId !== clinic.id || lead.id !== leadId) {
    throw new DentalLiveAdapterError("tenant and lead binding mismatch");
  }
  if (
    conversation.id !== conversationId ||
    conversation.clinicId !== clinic.id ||
    conversation.leadId !== leadId
  ) {
    throw new DentalLiveAdapterError("conversation binding mismatch");
  }
  if (!conversationId || !turnId) {
    throw new DentalLiveAdapterError("conversation and turn binding required");
  }

  const timezone = new ClinicTimezone(clinic.timezone);
  const businessHours = parseBusinessHours(clinic.businessHours);
  let preparedSlotOffer: Readonly<{
    stateId: string;
    treatment: Treatment;
    slots: readonly { startsAt: Date; endsAt: Date; professionalId?: string }[];
    professionalId: string | null;
    replacesAppointmentId: string | null;
    exposed: Readonly<{ service: { id: string; name: string; requiresEvaluationFirst: boolean }; slots: readonly DentalSlot[] }>;
  }> | null = null;
  const journey = deps.journey
    ? createDentalJourneyLiveAdapter({
        clinicId: clinic.id,
        conversationId,
        turnId,
        now: new Date(turnNow.getTime()),
        inboundMessage: deps.journey.inboundMessage,
        history: deps.journey.history,
        treatments,
        mediaAssets: deps.journey.mediaAssets,
        state: deps.journey.state,
        reservations: deps.journey.reservations,
        effectLifecycle,
      })
    : {
        journeyRead: {
          resolveStart: async () => ({ kind: "unavailable" as const, reason: "journey_adapter_unavailable" }),
          resolveCurrentStep: async () => ({ kind: "unavailable" as const, reason: "journey_adapter_unavailable" }),
          resolveInboundMedia: async () => ({ kind: "unavailable" as const, reason: "journey_adapter_unavailable" }),
        },
        journeyWrite: {
          prepareStep: async () => ({ success: false as const, reason: "journey_adapter_unavailable", evidenceRef: "journey:adapter_unavailable" }),
          receiveMedia: async () => ({ success: false as const, reason: "journey_adapter_unavailable", evidenceRef: "journey:adapter_unavailable" }),
          releasePendingDeposit: async () => ({ success: false as const, reason: "journey_adapter_unavailable", evidenceRef: "journey:adapter_unavailable" }),
          takeDeliveryPlan: () => null,
        },
      };

  async function listTenantTreatments(): Promise<Treatment[]> {
    return (await treatments.listByClinic(clinic.id)).filter(
      (treatment) => treatment.clinicId === clinic.id,
    );
  }

  async function listTenantActiveProfessionals(): Promise<Professional[]> {
    const rows = await professionals.listByClinic(clinic.id);
    if (rows.some((professional) => professional.clinicId !== clinic.id)) {
      throw new DentalLiveAdapterError("professional tenant binding mismatch");
    }
    return rows.filter((professional) => professional.isActive);
  }

  async function resolveRequestedProfessional(
    query: string | null | undefined,
  ): Promise<Professional | null> {
    if (!query || !normalize(query)) return null;
    const normalized = normalize(query);
    const matches = (await listTenantActiveProfessionals()).filter(
      (professional) => normalize(professional.name) === normalized,
    );
    if (matches.length !== 1) {
      throw new DentalLiveAdapterError("professional resolution required");
    }
    return matches[0]!;
  }

  function withinProfessionalSchedule(
    professional: Professional | null,
    startsAt: Date,
    endsAt: Date,
  ): boolean {
    if (!professional?.workSchedule) return true;
    const start = timezone.toLocalParts(startsAt);
    const end = timezone.toLocalParts(endsAt);
    const window = professional.workSchedule[start.weekday as keyof typeof professional.workSchedule];
    if (!window || start.weekday !== end.weekday) return false;
    const startMinutes = start.hour * 60 + start.minute;
    const endMinutes = end.hour * 60 + end.minute;
    return startMinutes >= window.startHour * 60 + window.startMinute
      && endMinutes <= window.endHour * 60 + window.endMinute;
  }

  async function exactTreatmentForScheduling(
    query: string | null,
  ): Promise<Treatment> {
    const tenantTreatments = await listTenantTreatments();
    const hasExplicitQuery = Boolean(query && normalize(query));
    const direct = resolveTreatment(tenantTreatments, query);
    if (direct.kind === "exact") return direct.treatment;
    if (hasExplicitQuery || direct.kind === "ambiguous") {
      throw new DentalLiveAdapterError("service resolution required");
    }

    const interest = resolveTreatment(tenantTreatments, lead.treatmentInterest);
    if (interest.kind === "exact") return interest.treatment;
    if (interest.kind === "ambiguous") {
      throw new DentalLiveAdapterError("service resolution required");
    }
    if (tenantTreatments.length === 1) return tenantTreatments[0]!;
    throw new DentalLiveAdapterError("service resolution required");
  }

  async function currentOfferedSlot(
    id: string,
  ): Promise<{
    state: ConversationStateRow;
    slot: FormattedSlot;
    treatment: Treatment;
    startsAt: Date;
    endsAt: Date;
    replacesAppointmentId: string | null;
  } | null> {
    const parsed = parseSlotId(id);
    if (!parsed) return null;
    const current = await state.getCurrentState(conversationId);
    if (
      !current ||
      current.conversationId !== conversationId ||
      current.id !== parsed.stateId
    ) return null;
    const payload = parseOfferedPayload(current);
    const offered = payload?.slots.find((slot) => slot.index === parsed.index);
    if (
      !payload ||
      !offered ||
      !payload.treatmentName ||
      payload.treatmentId !== parsed.treatmentId
    ) return null;
    const tenantTreatments = await listTenantTreatments();
    const treatment = tenantTreatments.find(
      (candidate) => candidate.id === parsed.treatmentId,
    );
    if (
      !treatment ||
      treatment.requiresEvaluationFirst ||
      normalize(treatment.name) !== normalize(payload.treatmentName)
    ) {
      return null;
    }
    if (
      payload.durationMinutes != null &&
      payload.durationMinutes !== treatment.durationMinutes
    ) return null;
    const parsedSlot = validOfferedSlot(offered, treatment);
    return parsedSlot
      ? {
          state: current,
          slot: offered,
          treatment,
          replacesAppointmentId: payload.replacesAppointmentId ?? null,
          ...parsedSlot,
        }
      : null;
  }

  async function pendingAppointment(
    expectedStateId: string | null,
    expectedAppointmentId?: string,
  ): Promise<{ appointment: Appointment; label: string; stateId: string } | null> {
    const current = await state.getCurrentState(conversationId);
    if (
      !current ||
      current.conversationId !== conversationId ||
      current.state !== "awaiting_appointment_confirmation" ||
      (expectedStateId !== null && current.id !== expectedStateId)
    ) return null;
    const payload = current.payload as {
      appointmentId?: unknown;
      appointmentLabel?: unknown;
    } | null;
    if (
      typeof payload?.appointmentId !== "string" ||
      typeof payload.appointmentLabel !== "string" ||
      (expectedAppointmentId && payload.appointmentId !== expectedAppointmentId)
    ) return null;
    const appointment = await appointments.findByIdForClinicAndLead(
      clinic.id,
      leadId,
      payload.appointmentId,
    );
    if (
      !appointment ||
      appointment.clinicId !== clinic.id ||
      appointment.leadId !== leadId ||
      !isActiveAppointment(appointment)
    ) return null;
    return { appointment, label: payload.appointmentLabel, stateId: current.id };
  }

  const catalogRead: DentalCatalogReadPort = {
    async resolveService(query): Promise<ServiceResolution> {
      const resolution = resolveTreatment(await listTenantTreatments(), query);
      if (resolution.kind === "exact") {
        return {
          kind: "exact",
          service: toDentalService(resolution.treatment),
          evidenceRef: catalogEvidence(resolution.treatment),
        };
      }
      if (resolution.kind === "ambiguous") {
        return {
          kind: "ambiguous",
          candidates: resolution.treatments.map(({ id, name }) => ({ id, name })),
          evidenceRef: `treatment-catalog:${clinic.id}`,
        };
      }
      return { kind: "unknown", evidenceRef: `treatment-catalog:${clinic.id}` };
    },
    async resolveServices(queries) {
      const tenantTreatments = await listTenantTreatments();
      const resolveOne = (query: string): ServiceResolution => {
        const resolution = resolveTreatment(tenantTreatments, query);
        if (resolution.kind === "exact") {
          return {
            kind: "exact",
            service: toDentalService(resolution.treatment),
            evidenceRef: catalogEvidence(resolution.treatment),
          };
        }
        if (resolution.kind === "ambiguous") {
          return {
            kind: "ambiguous",
            candidates: resolution.treatments.map(({ id, name }) => ({ id, name })),
            evidenceRef: `treatment-catalog:${clinic.id}`,
          };
        }
        return { kind: "unknown", evidenceRef: `treatment-catalog:${clinic.id}` };
      };
      return [resolveOne(queries[0]), resolveOne(queries[1])];
    },
  };

  const commercialRead: DentalCommercialReadPort = {
    async resolveService(query) {
      const tenantTreatments = await listTenantTreatments();
      const resolution = resolveTreatment(tenantTreatments, query);
      if (resolution.kind === "ambiguous") {
        return {
          kind: "ambiguous",
          candidates: resolution.treatments.map(({ id, name }) => ({ id, name })),
          evidenceRef: `treatment-catalog:${clinic.id}`,
        };
      }
      if (resolution.kind !== "exact") {
        return { kind: "unknown", evidenceRef: `treatment-catalog:${clinic.id}` };
      }
      const campaignMap = deps.priceCampaigns
        ? await deps.priceCampaigns.listActiveByTreatment(clinic.id, new Date(turnNow.getTime()))
        : new Map<string, PriceCampaignRow>();
      const tenantIds = new Set(tenantTreatments.map(({ id }) => id));
      if ([...campaignMap.keys()].some((treatmentId) => !tenantIds.has(treatmentId))) {
        throw new DentalLiveAdapterError("campaign tenant binding mismatch");
      }
      const treatment = resolution.treatment;
      const campaign = campaignMap.get(treatment.id) ?? null;
      const effective = resolveEffectivePrice(treatment, campaign, turnNow);
      const effectiveCents = effective.priceKind === "fixed"
        ? effective.priceCents ?? effective.minPriceCents
        : effective.minPriceCents ?? effective.priceCents;
      return {
        kind: "exact",
        service: {
          id: treatment.id,
          name: treatment.name,
          priceDisclosable: treatment.priceQuotableInChat,
          priceKind: effective.priceKind,
          priceCents: effectiveCents,
          originalPriceCents: effective.originalPriceCents,
          campaignName: effective.campaignName,
          campaignEndsAt: effective.campaignEndsAt,
          quantityPrices: (treatment.quantityPrices ?? []).map((price) => ({
            quantity: price.quantity,
            scope: price.scope ?? "total",
            priceCents: price.priceCents,
          })),
        },
        evidenceRef: effective.campaignName !== null && campaign
          ? `price-campaign:${campaign.id}`
          : catalogEvidence(treatment),
      };
    },
    async resolvePaymentConfiguration() {
      let methods: ReturnType<typeof parsePaymentMethods>;
      try {
        methods = parsePaymentMethods(clinic.paymentMethods ?? []);
      } catch {
        return { kind: "missing" };
      }
      const labels = new Map(PAYMENT_METHOD_OPTIONS.map((option) => [option.code, option.label]));
      const installmentRates = (clinic.installmentRates ?? [])
        .filter((rate) => rate.active)
        .map((rate) => ({
          installments: rate.n,
          ratePercent: rate.rate,
          evidenceRef: `organization:${clinic.id}:installment-rate:${rate.n}`,
        }));
      if (methods.length === 0 && installmentRates.length === 0) return { kind: "missing" };
      return {
        kind: "resolved",
        organization: { id: clinic.id, displayName: clinic.name },
        methods: methods.map((code) => ({
          code,
          label: labels.get(code)!,
          evidenceRef: `organization:${clinic.id}:payment-method:${code}`,
        })),
        installmentRates,
      };
    },
    async resolveRegisteredObjection(question) {
      const canonical = normalize(question);
      const matches = (editorial?.objections ?? []).filter(
        (entry) => normalize(entry.objection) === canonical,
      );
      if (matches.length !== 1) return { kind: "missing" };
      const index = (editorial?.objections ?? []).indexOf(matches[0]!);
      return {
        kind: "resolved",
        organization: { id: clinic.id, displayName: clinic.name },
        answer: matches[0]!.response,
        evidenceRef: `playbook:${editorial!.versionId}:objection:${index}`,
      };
    },
  };

  type InstitutionalText =
    | Readonly<{ kind: "absent" }>
    | Readonly<{ kind: "invalid" }>
    | Readonly<{ kind: "valid"; value: string }>;

  function institutionalText(value: string | null): InstitutionalText {
    if (value === null || value.length === 0) return { kind: "absent" };
    const normalized = value.trim();
    return isSafeAuthorizedDisplayText(normalized)
      ? { kind: "valid", value: normalized }
      : { kind: "invalid" };
  }

  function addressText(): string | null {
    const address = institutionalText(clinic.address);
    if (address.kind !== "valid") return null;
    const complement = institutionalText(clinic.addressComplement);
    if (complement.kind === "invalid") return null;
    const combined = complement.kind === "valid"
      ? `${address.value}, ${complement.value}`
      : address.value;
    return isSafeAuthorizedDisplayText(combined) ? combined : null;
  }

  function parkingText(): string | null {
    try {
      return parseInstitutionalDetails({
        parkingInformation: clinic.parkingInformation,
        socialChannels: null,
      }).parkingInformation;
    } catch {
      return null;
    }
  }

  function socialText(): string | null {
    try {
      const channels = parseInstitutionalDetails({
        parkingInformation: null,
        socialChannels: clinic.socialChannels,
      }).socialChannels;
      if (!channels) return null;
      const rendered = [...channels]
        .sort((left, right) => left.label.localeCompare(right.label, "pt-BR", {
          sensitivity: "base",
        }))
        .map(({ label, url }) => `${label}: ${url}`)
        .join(" · ");
      return isSafeAuthorizedDisplayText(rendered) ? rendered : null;
    } catch {
      return null;
    }
  }

  function institutionalResolution(
    topic: Parameters<DentalKnowledgeReadPort["resolveBusinessInformation"]>[0],
    fact: DentalBusinessInformationFact | null,
    evidenceRef: string,
  ) {
    return fact
      ? {
          kind: "resolved" as const,
          topic,
          organization: { id: clinic.id, displayName: clinic.name },
          facts: [fact],
          evidenceRef,
        }
      : {
          kind: "missing" as const,
          topic,
          organization: { id: clinic.id, displayName: clinic.name },
          evidenceRef: `${evidenceRef}:missing`,
        };
  }

  const knowledgeRead: DentalKnowledgeReadPort = {
    async resolveBusinessInformation(topic) {
      if (topic === "address") {
        const value = addressText();
        return institutionalResolution(
          topic,
          value ? { key: "address", value } : null,
          `organization:${clinic.id}:address`,
        );
      }
      if (topic === "business-hours") {
        const candidate = institutionalText(clinic.businessHours);
        const value = candidate.kind === "valid" ? candidate.value : null;
        return institutionalResolution(
          topic,
          value ? { key: "business_hours", value } : null,
          `organization:${clinic.id}:business-hours`,
        );
      }
      if (topic === "location-guidance") {
        const guidance = institutionalText(clinic.locationMessage);
        const fallback = guidance.kind === "absent" ? addressText() : null;
        return institutionalResolution(
          topic,
          guidance.kind === "valid" || fallback
            ? { key: "location_guidance", value: guidance.kind === "valid" ? guidance.value : fallback! }
            : null,
          guidance.kind === "valid"
            ? `organization:${clinic.id}:location-message`
            : guidance.kind === "absent"
              ? `organization:${clinic.id}:address`
              : `organization:${clinic.id}:location-message`,
        );
      }
      if (topic === "parking") {
        const value = parkingText();
        return institutionalResolution(
          topic,
          value ? { key: "parking_information", value } : null,
          `organization:${clinic.id}:parking-information`,
        );
      }
      if (topic === "social") {
        const value = socialText();
        return institutionalResolution(
          topic,
          value ? { key: "social_channels", value } : null,
          `organization:${clinic.id}:social-channels`,
        );
      }
      return institutionalResolution(
        topic,
        null,
        `organization:${clinic.id}:${topic}`,
      );
    },
  };

  const missingPlaybookKnowledge = (
    request: "business-differentials" | "frequently-asked-question",
  ) => ({ kind: "missing" as const, request });

  const playbookKnowledgeRead: DentalPlaybookKnowledgeReadPort = {
    async resolveDifferentials() {
      if (!editorial) return missingPlaybookKnowledge("business-differentials");
      const configured = editorial.differentials.slice(0, 8);
      if (
        configured.length === 0
        || configured.some((value) => !isSafeAuthorizedDisplayText(value))
      ) return missingPlaybookKnowledge("business-differentials");
      return {
        kind: "resolved",
        request: "business-differentials",
        organization: { id: clinic.id, displayName: clinic.name },
        facts: configured.map((value, index) => ({
          key: "business_differential" as const,
          value,
          evidenceRef: `playbook:${editorial.versionId}:differential:${index}`,
        })),
      };
    },
    async resolveFaq(question) {
      if (!editorial) return missingPlaybookKnowledge("frequently-asked-question");
      const normalizedQuestion = normalize(question);
      const index = editorial.faqs.findIndex((faq) =>
        normalize(faq.question) === normalizedQuestion
      );
      const faq = index >= 0 ? editorial.faqs[index] : undefined;
      if (!faq || !isSafeAuthorizedDisplayText(faq.answer)) {
        return missingPlaybookKnowledge("frequently-asked-question");
      }
      return {
        kind: "resolved",
        request: "frequently-asked-question",
        organization: { id: clinic.id, displayName: clinic.name },
        facts: [{
          key: "faq_answer",
          value: faq.answer,
          evidenceRef: `playbook:${editorial.versionId}:faq:${index}`,
        }],
      };
    },
  };

  const schedulingRead: DentalSchedulingReadPort = {
    async listSlots(input) {
      const treatment = await exactTreatmentForScheduling(input.service);
      const requestedProfessional = await resolveRequestedProfessional(input.professional);
      const service = {
        id: treatment.id,
        name: treatment.name,
        requiresEvaluationFirst: treatment.requiresEvaluationFirst,
      };
      if (treatment.requiresEvaluationFirst) return { service, slots: [] };
      const minimumLeadTimeMs = Math.max(0, input.minimumLeadTimeHours) * 60 * 60_000;
      const from = new Date(input.now.getTime() + minimumLeadTimeMs);
      const to = new Date(from.getTime() + clinic.slotLookaheadDays * 24 * 60 * 60_000);
      const requestedDay = input.date
        ? timezone.resolvePreferredDate(input.date, input.now, businessHours)
        : null;
      if (input.date && !requestedDay) {
        return { service, slots: [] };
      }
      const requestedParts = requestedDay
        ? timezone.toLocalParts(requestedDay)
        : null;
      const activeAppointments = await appointments.findByPeriod(clinic.id, from, to);
      const activeReservations = await reservations.findActiveByPeriod(
        clinic.id,
        from,
        to,
        input.now,
      );
      const bufferMs = clinic.postAppointmentBufferMinutes * 60_000;
      const slots = (await calendar.listAvailableSlots({
        clinicId: clinic.id,
        from,
        to,
        slotDurationMinutes: treatment.durationMinutes,
        ...(requestedProfessional ? { professionalId: requestedProfessional.id } : {}),
        allowedStartWindows: treatment.bookingWindows ?? null,
      }))
        .filter((slot) => slot.clinicId === clinic.id)
        .filter((slot) => slot.startsAt >= from && slot.endsAt <= to)
        .filter((slot) =>
          Number.isFinite(slot.startsAt.getTime()) &&
          Number.isFinite(slot.endsAt.getTime()) &&
          slot.endsAt.getTime() > slot.startsAt.getTime() &&
          slot.endsAt.getTime() - slot.startsAt.getTime() ===
            treatment.durationMinutes * 60_000,
        )
        .filter((slot) => {
          if (!requestedParts) return true;
          const actual = timezone.toLocalParts(slot.startsAt);
          return actual.year === requestedParts.year &&
            actual.month === requestedParts.month &&
            actual.day === requestedParts.day;
        })
        .filter((slot) => periodMatches(timezone, slot.startsAt, input.period))
        .filter((slot) => {
          if (requestedProfessional) {
            return withinProfessionalSchedule(
              requestedProfessional,
              slot.startsAt,
              slot.endsAt,
            );
          }
          return true;
        })
        .filter((slot) => !activeAppointments.some((appointment) =>
          appointment.clinicId === clinic.id &&
          isActiveAppointment(appointment) &&
          appointment.startsAt.getTime() < slot.endsAt.getTime() &&
          appointment.endsAt.getTime() + bufferMs > slot.startsAt.getTime(),
        ))
        .filter((slot) => !activeReservations.some((reservation) =>
          reservation.clinicId === clinic.id &&
          (reservation.status === "confirmed" ||
            (reservation.status === "pending" && reservation.expiresAt > input.now)) &&
          reservation.startsAt.getTime() < slot.endsAt.getTime() &&
          reservation.endsAt.getTime() > slot.startsAt.getTime(),
        ))
        .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime())
        .slice(0, clinic.maxSlotsToOffer);

      if (slots.length === 0) {
        return { service, slots: [] };
      }
      const stateId = deterministicUuid(
        `conversation-v2-slot-offer:${conversationId}:${turnId}`,
      );
      const exposed = Object.freeze({
        service,
        slots: Object.freeze(slots.map((slot, index) => Object.freeze({
          id: `dental-slot-candidate:${stateId}:${index + 1}:${encodeURIComponent(treatment.id)}`,
          label: timezone.formatForHuman(slot.startsAt),
          evidenceRef: `slot-candidate:${stateId}:${index + 1}`,
        }))),
      });
      preparedSlotOffer = Object.freeze({
        stateId,
        treatment,
        professionalId: requestedProfessional?.id ?? null,
        replacesAppointmentId: null,
        slots: Object.freeze(slots.map((slot) => Object.freeze({
          startsAt: new Date(slot.startsAt.getTime()),
          endsAt: new Date(slot.endsAt.getTime()),
          ...((requestedProfessional?.id ?? slot.professionalId)
            ? { professionalId: requestedProfessional?.id ?? slot.professionalId! }
            : {}),
        }))),
        exposed,
      });
      return exposed;
    },

    async resolveOfferedSlot(input) {
      const current = await state.getCurrentState(conversationId);
      if (
        !current ||
        current.conversationId !== conversationId ||
        current.id !== input.pendingStepId
      ) return null;
      const payload = parseOfferedPayload(current);
      if (!payload) return null;
      if (!payload.treatmentId || !payload.treatmentName) return null;
      const treatment = (await listTenantTreatments()).find(
        (candidate) => candidate.id === payload.treatmentId,
      );
      if (
        !treatment ||
        treatment.requiresEvaluationFirst ||
        normalize(treatment.name) !== normalize(payload.treatmentName) ||
        (payload.durationMinutes != null &&
          payload.durationMinutes !== treatment.durationMinutes)
      ) return null;
      const matches = payload.slots.filter((slot) => {
        if (!validOfferedSlot(slot, treatment)) return false;
        if (input.ordinal !== null && slot.index !== input.ordinal) return false;
        if (
          input.date &&
          !datesMatch(timezone, slot, input.date, turnNow, businessHours)
        ) return false;
        if (input.time && !timesMatch(timezone, slot, input.time)) return false;
        return true;
      });
      if (matches.length !== 1) return null;
      return toDentalSlot(
        current.id,
        matches[0]!,
        treatment.id,
        payload.replacesAppointmentId ? "reschedule" : "book",
      );
    },

    async resolvePendingAppointment(pendingStepId) {
      const pending = await pendingAppointment(pendingStepId);
      return pending
        ? {
            id: pending.appointment.id,
            label: pending.label,
            evidenceRef: appointmentEvidence(pending.appointment.id),
          }
        : null;
    },
  };

  async function activeAppointmentsForLead(): Promise<Appointment[]> {
    const rows = await appointments.findAllActiveByLeadId(leadId);
    if (rows.some((appointment) =>
      appointment.clinicId !== clinic.id ||
      appointment.leadId !== leadId
    )) {
      throw new DentalLiveAdapterError("appointment tenant binding mismatch");
    }
    return rows
      .filter(isActiveAppointment)
      .sort((left, right) =>
        left.startsAt.getTime() - right.startsAt.getTime() ||
        left.id.localeCompare(right.id)
      );
  }

  function appointmentReference(appointment: Appointment) {
    return {
      id: appointment.id,
      label: timezone.formatForConfirmation(appointment.startsAt),
      evidenceRef: appointmentEvidence(appointment.id),
    };
  }

  const appointmentLifecycleRead: DentalAppointmentLifecycleReadPort = {
    async listActiveAppointments() {
      return (await activeAppointmentsForLead()).map(appointmentReference);
    },
    async resolveActiveAppointment(input) {
      const rows = await activeAppointmentsForLead();
      const matches = rows.filter((appointment, index) => {
        if (input.ordinal !== null && input.ordinal !== index + 1) return false;
        const slot: FormattedSlot = {
          index: index + 1,
          startsAt: appointment.startsAt.toISOString(),
          endsAt: appointment.endsAt.toISOString(),
          label: timezone.formatForConfirmation(appointment.startsAt),
        };
        if (input.date && !datesMatch(timezone, slot, input.date, turnNow, businessHours)) {
          return false;
        }
        if (input.time && !timesMatch(timezone, slot, input.time)) return false;
        return true;
      });
      if (matches.length === 0) return { kind: "missing" };
      if (matches.length > 1) {
        return {
          kind: "ambiguous",
          appointments: matches.map(appointmentReference),
        };
      }
      return { kind: "resolved", appointment: appointmentReference(matches[0]!) };
    },
    async listReplacementSlots(input) {
      const appointment = await appointments.findByIdForClinicAndLead(
        clinic.id,
        leadId,
        input.appointmentId,
      );
      if (
        !appointment ||
        appointment.clinicId !== clinic.id ||
        appointment.leadId !== leadId ||
        !isActiveAppointment(appointment)
      ) {
        throw new DentalLiveAdapterError("replacement appointment binding mismatch");
      }
      const tenantTreatments = await listTenantTreatments();
      const boundTreatment = appointment.treatmentId
        ? tenantTreatments.find(({ id }) => id === appointment.treatmentId) ?? null
        : null;
      const treatment = boundTreatment ?? await exactTreatmentForScheduling(null);
      const offer = await schedulingRead.listSlots({
        service: treatment.name,
        date: input.date,
        period: input.period,
        professional: input.professional,
        minimumLeadTimeHours: input.minimumLeadTimeHours,
        now: input.now,
      });
      if (preparedSlotOffer) {
        preparedSlotOffer = Object.freeze({
          ...preparedSlotOffer,
          replacesAppointmentId: appointment.id,
        });
      }
      return { ...offer, replacesAppointmentId: appointment.id };
    },
  };

  function successfulOutcome(
    appointment: Appointment,
    label: string,
  ): DentalSchedulingWriteOutcome {
    return {
      success: true,
      kind: "appointment",
      appointmentId: appointment.id,
      label,
      evidenceRef: appointmentEvidence(appointment.id),
    };
  }

  let schedulingDeliveryPlan: DentalJourneyDeliveryPlan | null = null;

  function completeDepositOutcome(payload: DepositFlowPayload): DentalSchedulingWriteOutcome {
    if (!payload.reservationId) {
      return {
        success: false,
        reason: "deposit_reservation_missing",
        evidenceRef: `deposit:${turnId}:reservation_missing`,
      };
    }
    const requestText = buildDepositRequestMessage(clinic, payload.slotLabel);
    schedulingDeliveryPlan = {
      replyText: requestText,
      interleavedParts: [{ type: "text", content: requestText }],
      pipelineAdvance: null,
      deterministic: true,
    };
    return {
      success: true,
      kind: "deposit_requested",
      reservationId: payload.reservationId,
      label: payload.slotLabel,
      requestText,
      evidenceRef: `conversation-state:deposit:${payload.sourceTurnId ?? turnId}`,
    };
  }

  async function existingDepositForSlot(id: string): Promise<DentalSchedulingWriteOutcome | null> {
    const parsed = parseSlotId(id);
    if (!parsed) return null;
    const current = await state.getCurrentState(conversationId);
    if (current?.state !== "awaiting_deposit_proof") return null;
    const payload = current.payload as DepositFlowPayload | null;
    if (
      !payload
      || payload.sourceOfferStateId !== parsed.stateId
      || payload.sourceTurnId !== turnId
      || payload.treatmentId !== parsed.treatmentId
    ) return null;
    return completeDepositOutcome(payload);
  }

  async function invalidateConsumedStateBestEffort(stateId: string): Promise<void> {
    try {
      await state.invalidateIfCurrent(conversationId, stateId);
    } catch {
      // BookingService/confirmation success is authoritative. State cleanup must
      // never invert it or cause the action to be retried.
    }
  }

  const schedulingWrite: DentalSchedulingWritePort = {
    async persistSlotOffer(offer) {
      const prepared = preparedSlotOffer;
      if (!prepared) {
        throw new DentalLiveAdapterError("prepared slot offer unavailable");
      }
      const exactBinding = offer.service.id === prepared.exposed.service.id &&
        offer.service.name === prepared.exposed.service.name &&
        offer.slots.length === prepared.exposed.slots.length &&
        offer.slots.every((slot, index) => {
          const expected = prepared.exposed.slots[index];
          return Boolean(expected) && slot.id === expected!.id &&
            slot.label === expected!.label && slot.evidenceRef === expected!.evidenceRef;
        });
      if (!exactBinding) {
        throw new DentalLiveAdapterError("prepared slot offer binding mismatch");
      }
      // Consume before the write. A failed write is never replayed by this adapter.
      preparedSlotOffer = null;
      effectLifecycle?.attempted();
      const formatted = await state.offerSlotsForTurn(
        prepared.stateId,
        conversationId,
        prepared.slots.map(({ startsAt, endsAt, professionalId }) => ({
          startsAt: new Date(startsAt.getTime()),
          endsAt: new Date(endsAt.getTime()),
          ...(professionalId ? { professionalId } : {}),
        })),
        timezone,
        prepared.treatment.name,
        prepared.treatment.durationMinutes,
        clinic.slotOfferTtlMinutes,
        false,
        prepared.treatment.id,
        prepared.professionalId ?? undefined,
        prepared.replacesAppointmentId ?? undefined,
      );
      effectLifecycle?.completed();
      if (
        formatted.length !== prepared.slots.length ||
        formatted.some((slot, index) => {
          const candidate = prepared.slots[index];
          const valid = validOfferedSlot(slot, prepared.treatment);
          return !candidate || !valid || slot.index !== index + 1 ||
            valid.startsAt.getTime() !== candidate.startsAt.getTime() ||
            valid.endsAt.getTime() !== candidate.endsAt.getTime();
        })
      ) {
        throw new DentalLiveAdapterError("persisted slot offer unavailable");
      }
      return {
        service: {
          id: prepared.treatment.id,
          name: prepared.treatment.name,
        },
        slots: formatted.map((slot) =>
          toDentalSlot(
            prepared.stateId,
            slot,
            prepared.treatment.id,
            prepared.replacesAppointmentId ? "reschedule" : "book",
          ),
        ),
      };
    },

    async bookSlot(id) {
      const retry = await existingDepositForSlot(id);
      if (retry) return retry;
      const offered = await currentOfferedSlot(id);
      if (!offered) {
        return {
          success: false,
          reason: "stale_offer",
          evidenceRef: `booking:${turnId}:stale_offer`,
        };
      }
      const { startsAt, endsAt } = offered;
      let inPeriod = await appointments.findByPeriod(clinic.id, startsAt, endsAt);
      const existing = activeAppointmentForLead(
        inPeriod,
        clinic.id,
        leadId,
        startsAt,
        endsAt,
      );
      if (existing) {
        effectLifecycle?.completed();
        await invalidateConsumedStateBestEffort(offered.state.id);
        return successfulOutcome(existing, offered.slot.label);
      }
      if (inPeriod.some((appointment) =>
        isExactAppointmentForSlot(appointment, clinic.id, startsAt, endsAt),
      )) {
        return {
          success: false,
          reason: "slot_taken",
          evidenceRef: `booking:${turnId}:slot_taken`,
        };
      }

      if (clinic.depositEnabled === true) {
        const amount = clinic.depositAmountCents;
        const pixKey = clinic.depositPixKey?.trim();
        const ttlHours = clinic.depositTtlHours ?? 24;
        if (
          !Number.isInteger(amount)
          || (amount ?? 0) <= 0
          || !pixKey
          || !Number.isFinite(ttlHours)
          || ttlHours <= 0
          || !state.startDepositWaitForTurn
          || !reservations.reserve
          || !reservations.release
        ) {
          return {
            success: false,
            reason: "deposit_configuration_incomplete",
            evidenceRef: `deposit:${turnId}:configuration_incomplete`,
          };
        }
        effectLifecycle?.attempted();
        const held = await reservations.reserve(
          clinic.id,
          leadId,
          startsAt,
          endsAt,
          ttlHours * 60,
        );
        if (!held) {
          return {
            success: false,
            reason: "slot_taken",
            evidenceRef: `deposit:${turnId}:slot_taken`,
          };
        }
        const campaign = deps.priceCampaigns
          ? (await deps.priceCampaigns.listActiveByTreatment(clinic.id, turnNow))
              .get(offered.treatment.id) ?? null
          : null;
        const payload: DepositFlowPayload = {
          slotStartsAt: startsAt.toISOString(),
          slotEndsAt: endsAt.toISOString(),
          slotLabel: offered.slot.label,
          reservationId: held.id,
          treatmentId: offered.treatment.id,
          treatmentName: offered.treatment.name,
          valueCents: resolveEffectivePrice(offered.treatment, campaign).priceCents,
          depositAmountCents: amount!,
          holdExpiresAt: held.expiresAt.toISOString(),
          sourceOfferStateId: offered.state.id,
          sourceTurnId: turnId,
        };
        try {
          const transition = await state.startDepositWaitForTurn({
            conversationId,
            turnId,
            expectedCurrentStateId: offered.state.id,
            payload,
            ttlMinutes: ttlHours * 60,
          });
          const persisted = transition.state?.state === "awaiting_deposit_proof"
            ? transition.state.payload as DepositFlowPayload | null
            : null;
          if (
            !persisted
            || persisted.sourceOfferStateId !== offered.state.id
            || persisted.sourceTurnId !== turnId
            || persisted.reservationId !== held.id
          ) {
            await reservations.release(held.id);
            return {
              success: false,
              reason: "deposit_state_changed",
              evidenceRef: `deposit:${turnId}:state_changed`,
            };
          }
          effectLifecycle?.completed();
          return completeDepositOutcome(persisted);
        } catch {
          await reservations.release(held.id);
          return {
            success: false,
            reason: "deposit_state_failed",
            evidenceRef: `deposit:${turnId}:state_failed`,
          };
        }
      }

      effectLifecycle?.attempted();
      const result = await booking.book({
        clinic,
        lead,
        startsAt,
        endsAt,
        treatmentName: offered.treatment.name,
        treatmentId: offered.treatment.id,
        valueCents: offered.treatment.priceCents,
        professionalId: offered.slot.professionalId ?? null,
        origin: "ai_conversation",
      });
      if (!result.success) {
        if (result.reason === "slot_taken") {
          inPeriod = await appointments.findByPeriod(clinic.id, startsAt, endsAt);
          const reconciled = activeAppointmentForLead(
            inPeriod,
            clinic.id,
            leadId,
            startsAt,
            endsAt,
          );
          if (reconciled) {
            effectLifecycle?.completed();
            await invalidateConsumedStateBestEffort(offered.state.id);
            return successfulOutcome(reconciled, offered.slot.label);
          }
        }
        return {
          success: false,
          reason: result.reason,
          evidenceRef: `booking:${turnId}:${result.reason}`,
        };
      }
      effectLifecycle?.completed();
      if (
        result.appointment.clinicId !== clinic.id ||
        result.appointment.leadId !== leadId
      ) {
        return {
          success: false,
          reason: "invalid_booking_binding",
          evidenceRef: `booking:${turnId}:invalid_binding`,
        };
      }
      await invalidateConsumedStateBestEffort(offered.state.id);
      return successfulOutcome(result.appointment, offered.slot.label);
    },

    async rescheduleSlot(id) {
      const offered = await currentOfferedSlot(id);
      if (!offered?.replacesAppointmentId) {
        return {
          success: false,
          reason: "stale_replacement_offer",
          evidenceRef: `reschedule:${turnId}:stale_offer`,
        };
      }
      effectLifecycle?.attempted();
      const result = await booking.reschedule({
        clinic,
        lead,
        appointmentId: offered.replacesAppointmentId,
        startsAt: offered.startsAt,
        endsAt: offered.endsAt,
        professionalId: offered.slot.professionalId ?? null,
      });
      if (!result.success) {
        return {
          success: false,
          reason: result.reason,
          evidenceRef: `reschedule:${turnId}:${result.reason}`,
        };
      }
      if (
        result.appointment.id !== offered.replacesAppointmentId ||
        result.appointment.clinicId !== clinic.id ||
        result.appointment.leadId !== leadId ||
        result.appointment.startsAt.getTime() !== offered.startsAt.getTime() ||
        result.appointment.endsAt.getTime() !== offered.endsAt.getTime()
      ) {
        return {
          success: false,
          reason: "invalid_reschedule_binding",
          evidenceRef: `reschedule:${turnId}:invalid_binding`,
        };
      }
      effectLifecycle?.completed();
      await invalidateConsumedStateBestEffort(offered.state.id);
      return successfulOutcome(result.appointment, offered.slot.label);
    },

    async confirmAppointment(appointmentId) {
      const pending = await pendingAppointment(null, appointmentId);
      if (!pending) {
        return {
          success: false,
          reason: "appointment_not_found",
          evidenceRef: `appointment-confirmation:${turnId}:not_found`,
        };
      }
      effectLifecycle?.attempted();
      const result = await booking.confirmAppointment({
        clinic,
        lead,
        appointmentId: pending.appointment.id,
      });
      if (!result.success) {
        return {
          success: false,
          reason: result.reason,
          evidenceRef: `appointment-confirmation:${turnId}:${result.reason}`,
        };
      }
      effectLifecycle?.completed();
      if (
        result.appointment.clinicId !== clinic.id ||
        result.appointment.leadId !== leadId ||
        result.appointment.id !== appointmentId
      ) {
        return {
          success: false,
          reason: "invalid_confirmation_binding",
          evidenceRef: `appointment-confirmation:${turnId}:invalid_binding`,
        };
      }
      await invalidateConsumedStateBestEffort(pending.stateId);
      return successfulOutcome(result.appointment, pending.label);
    },
    takeDeliveryPlan() {
      const plan = schedulingDeliveryPlan;
      schedulingDeliveryPlan = null;
      return plan;
    },
  };

  const appointmentLifecycleWrite: DentalAppointmentLifecycleWritePort = {
    async persistReplacementOffer(offer) {
      const prepared = preparedSlotOffer;
      if (!prepared || prepared.replacesAppointmentId !== offer.replacesAppointmentId) {
        throw new DentalLiveAdapterError("prepared replacement offer unavailable");
      }
      const persisted = await schedulingWrite.persistSlotOffer({
        service: offer.service,
        slots: offer.slots,
      });
      return { ...persisted, replacesAppointmentId: offer.replacesAppointmentId };
    },
    async cancelAppointment(appointmentId) {
      effectLifecycle?.attempted();
      const result = await booking.cancelAppointment({ clinic, lead, appointmentId });
      if (!result.success) {
        return {
          success: false,
          reason: result.reason,
          evidenceRef: `appointment-cancellation:${turnId}:${result.reason}`,
        };
      }
      if (
        result.appointment.id !== appointmentId ||
        result.appointment.clinicId !== clinic.id ||
        result.appointment.leadId !== leadId ||
        result.appointment.status !== "cancelled"
      ) {
        return {
          success: false,
          reason: "invalid_cancellation_binding",
          evidenceRef: `appointment-cancellation:${turnId}:invalid_binding`,
        };
      }
      effectLifecycle?.completed();
      return successfulOutcome(
        result.appointment,
        timezone.formatForConfirmation(result.appointment.startsAt),
      );
    },
  };

  return {
    knowledgeRead,
    playbookKnowledgeRead,
    catalogRead,
    commercialRead,
    schedulingRead,
    schedulingWrite,
    appointmentLifecycleRead,
    appointmentLifecycleWrite,
    journeyRead: journey.journeyRead,
    journeyWrite: journey.journeyWrite,
  };
}
