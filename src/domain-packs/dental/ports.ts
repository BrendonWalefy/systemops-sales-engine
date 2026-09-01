import type {
  DentalBusinessInformationTopic,
} from "@/domain-packs/dental/vocabulary";

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

export type DentalCommercialReadPort = Readonly<{
  resolveService(query: string): Promise<DentalCommercialServiceResolution>;
}>;

export type DentalSlot = { id: string; label: string; evidenceRef: string };
export type DentalSlotSearchResult = {
  service: { id: string; name: string; requiresEvaluationFirst?: boolean };
  slots: readonly DentalSlot[];
};
export type PendingDentalAppointment = { id: string; label: string; evidenceRef: string };

export type DentalSchedulingReadPort = {
  listSlots(input: {
    service: string | null;
    date: string | null;
    period: string | null;
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
};
