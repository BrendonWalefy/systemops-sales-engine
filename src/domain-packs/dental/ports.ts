import type {
  DentalBusinessInformationTopic,
} from "@/domain-packs/dental/vocabulary";
import type { PaymentMethod } from "@/domain/entities/payment-method";

export type DentalBusinessInformationFact = Readonly<{
  key:
    | "address"
    | "business_hours"
    | "location_guidance"
    | "parking_information"
    | "social_channels";
  value: string;
}>;

export type DentalBusinessInformationResolution =
  | Readonly<{
      kind: "resolved";
      topic: DentalBusinessInformationTopic;
      organization: Readonly<{ id: string; displayName: string }>;
      facts: readonly DentalBusinessInformationFact[];
      evidenceRef: string;
    }>
  | Readonly<{
      kind: "missing";
      topic: DentalBusinessInformationTopic;
      organization: Readonly<{ id: string; displayName: string }>;
      evidenceRef: string;
    }>;

export type DentalKnowledgeReadPort = Readonly<{
  resolveBusinessInformation(
    topic: DentalBusinessInformationTopic,
  ): Promise<DentalBusinessInformationResolution>;
}>;

export type DentalPlaybookKnowledgeFact = Readonly<{
  key: "business_differential" | "faq_answer";
  value: string;
  evidenceRef: string;
}>;

export type DentalPlaybookKnowledgeResolution =
  | Readonly<{
      kind: "resolved";
      request: "business-differentials" | "frequently-asked-question";
      organization: Readonly<{ id: string; displayName: string }>;
      facts: readonly DentalPlaybookKnowledgeFact[];
    }>
  | Readonly<{
      kind: "missing";
      request: "business-differentials" | "frequently-asked-question";
    }>;

export type DentalPlaybookKnowledgeReadPort = Readonly<{
  resolveDifferentials(): Promise<DentalPlaybookKnowledgeResolution>;
  resolveFaq(question: string): Promise<DentalPlaybookKnowledgeResolution>;
}>;

export type DentalService = {
  id: string;
  name: string;
  priceCents: number | null;
  priceDisclosable: boolean;
  /** Texto cadastrado que explica o procedimento. Null quando ninguém preencheu. */
  description: string | null;
};

export type ServiceResolution =
  | { kind: "exact"; service: DentalService; evidenceRef: string }
  | { kind: "ambiguous"; candidates: readonly { id: string; name: string }[]; evidenceRef: string }
  | { kind: "unknown"; evidenceRef: string };

export type DentalCatalogReadPort = {
  resolveService(query: string): Promise<ServiceResolution>;
  resolveServices(
    queries: readonly [string, string],
  ): Promise<readonly [ServiceResolution, ServiceResolution]>;
};

export type DentalCommercialQuantityPrice = Readonly<{
  quantity: number;
  scope: "total" | "superior" | "inferior";
  priceCents: number;
}>;

export type DentalCommercialService = Readonly<{
  id: string;
  name: string;
  priceDisclosable: boolean;
  priceKind: "from" | "fixed";
  priceCents: number | null;
  originalPriceCents: number | null;
  campaignName: string | null;
  campaignEndsAt: Date | null;
  quantityPrices: readonly DentalCommercialQuantityPrice[];
}>;

export type DentalCommercialServiceResolution =
  | Readonly<{ kind: "exact"; service: DentalCommercialService; evidenceRef: string }>
  | Readonly<{ kind: "ambiguous"; candidates: readonly { id: string; name: string }[]; evidenceRef: string }>
  | Readonly<{ kind: "unknown"; evidenceRef: string }>;

export type DentalPaymentConfigurationResolution =
  | Readonly<{
      kind: "resolved";
      organization: Readonly<{ id: string; displayName: string }>;
      methods: readonly Readonly<{
        code: PaymentMethod;
        label: string;
        evidenceRef: string;
      }>[];
      installmentRates: readonly Readonly<{
        installments: number;
        ratePercent: number;
        evidenceRef: string;
      }>[];
    }>
  | Readonly<{ kind: "missing" }>;

export type DentalRegisteredObjectionResolution =
  | Readonly<{
      kind: "resolved";
      organization: Readonly<{ id: string; displayName: string }>;
      answer: string;
      evidenceRef: string;
    }>
  | Readonly<{ kind: "missing" }>;

export type DentalCommercialReadPort = Readonly<{
  resolveService(query: string): Promise<DentalCommercialServiceResolution>;
  resolvePaymentConfiguration(): Promise<DentalPaymentConfigurationResolution>;
  resolveRegisteredObjection(
    question: string,
  ): Promise<DentalRegisteredObjectionResolution>;
}>;

export type DentalSlot = {
  id: string;
  label: string;
  evidenceRef: string;
  bookingKind?: "book" | "reschedule";
};
export type DentalSlotSearchResult = {
  service: { id: string; name: string; requiresEvaluationFirst?: boolean };
  slots: readonly DentalSlot[];
};
export type PendingDentalAppointment = { id: string; label: string; evidenceRef: string };
export type DentalAppointmentReference = PendingDentalAppointment;
export type DentalAppointmentSelection = Readonly<{
  ordinal: number | null;
  date: string | null;
  time: string | null;
}>;
export type DentalAppointmentResolution =
  | Readonly<{ kind: "resolved"; appointment: DentalAppointmentReference }>
  | Readonly<{ kind: "missing" }>
  | Readonly<{
      kind: "ambiguous";
      appointments: readonly DentalAppointmentReference[];
    }>;
export type DentalReplacementSlotSearchResult = DentalSlotSearchResult & Readonly<{
  replacesAppointmentId: string;
}>;

export type DentalSchedulingReadPort = {
  listSlots(input: {
    service: string | null;
    date: string | null;
    period: string | null;
    professional?: string | null;
    minimumLeadTimeHours: number;
    now: Date;
  }): Promise<DentalSlotSearchResult>;
  resolveOfferedSlot(input: {
    pendingStepId: string;
    ordinal: number | null;
    date: string | null;
    time: string | null;
  }): Promise<DentalSlot | null>;
  resolvePendingAppointment(pendingStepId: string): Promise<PendingDentalAppointment | null>;
};

export type DentalSchedulingWriteOutcome =
  | { success: true; appointmentId: string; label: string; evidenceRef: string }
  | { success: false; reason: string; evidenceRef: string };

export type DentalSchedulingWritePort = {
  persistSlotOffer(offer: DentalSlotSearchResult): Promise<DentalSlotSearchResult>;
  bookSlot(slotId: string): Promise<DentalSchedulingWriteOutcome>;
  confirmAppointment(appointmentId: string): Promise<DentalSchedulingWriteOutcome>;
  rescheduleSlot(slotId: string): Promise<DentalSchedulingWriteOutcome>;
};

export type DentalAppointmentLifecycleReadPort = Readonly<{
  listActiveAppointments(): Promise<readonly DentalAppointmentReference[]>;
  resolveActiveAppointment(
    input: DentalAppointmentSelection,
  ): Promise<DentalAppointmentResolution>;
  listReplacementSlots(input: Readonly<{
    appointmentId: string;
    date: string | null;
    period: string | null;
    professional: string | null;
    minimumLeadTimeHours: number;
    now: Date;
  }>): Promise<DentalReplacementSlotSearchResult>;
}>;

export type DentalAppointmentLifecycleWritePort = Readonly<{
  persistReplacementOffer(
    offer: DentalReplacementSlotSearchResult,
  ): Promise<DentalReplacementSlotSearchResult>;
  cancelAppointment(appointmentId: string): Promise<DentalSchedulingWriteOutcome>;
}>;

export type DentalJourneyDeliveryPart =
  | Readonly<{ type: "text"; content: string }>
  | Readonly<{
      type: "media";
      mediaId: string;
      url: string;
      mediaType: "image" | "video";
      title: string;
      caption?: string;
    }>;

export type DentalJourneyAdvance =
  | Readonly<{
      action: "advance";
      nextStepIndex: number;
      expectedTreatmentId: string;
      expectedStepIndex: number;
    }>
  | Readonly<{
      action: "exit";
      expectedTreatmentId: string;
      expectedStepIndex: number;
    }>;

export type DentalJourneyDeliveryPlan = Readonly<{
  replyText: string;
  interleavedParts: readonly DentalJourneyDeliveryPart[];
  pipelineAdvance: DentalJourneyAdvance | null;
  deterministic: boolean;
}>;

export type DentalJourneyResolution = Readonly<{
  kind: "unavailable";
  reason: string;
}>;

export type DentalJourneyMediaResolution = Readonly<{
  kind: "unavailable";
  reason: string;
}>;

export type DentalJourneyWriteOutcome =
  | Readonly<{
      success: true;
      kind: "journey_step_ready" | "journey_media_received" | "deposit_proof_received" | "deposit_change_released";
      subjectId: string;
      subjectLabel: string;
      evidenceRef: string;
    }>
  | Readonly<{ success: false; reason: string; evidenceRef: string }>;

export type DentalJourneyReadPort = Readonly<{
  resolveStart(serviceQuery: string): Promise<DentalJourneyResolution>;
  resolveCurrentStep(): Promise<DentalJourneyResolution>;
  resolveInboundMedia(input: Readonly<{
    messageId: string;
    mediaType: "image" | "video" | "document";
  }>): Promise<DentalJourneyMediaResolution>;
}>;

export type DentalJourneyWritePort = Readonly<{
  start(resolution: DentalJourneyResolution): Promise<DentalJourneyWriteOutcome>;
  receiveMedia(resolution: DentalJourneyMediaResolution): Promise<DentalJourneyWriteOutcome>;
  changePendingDeposit(): Promise<DentalJourneyWriteOutcome>;
  takeDeliveryPlan(): DentalJourneyDeliveryPlan | null;
}>;
