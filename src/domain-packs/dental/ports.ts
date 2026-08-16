export type DentalService = { id: string; name: string; priceCents: number | null; priceDisclosable: boolean };

export type ServiceResolution =
  | { kind: "exact"; service: DentalService; evidenceRef: string }
  | { kind: "ambiguous"; candidates: readonly { id: string; name: string }[]; evidenceRef: string }
  | { kind: "unknown"; evidenceRef: string };

export type DentalCatalogReadPort = {
  resolveService(query: string): Promise<ServiceResolution>;
};

export type DentalSlot = { id: string; label: string; evidenceRef: string };
export type DentalSlotSearchResult = {
  service: { id: string; name: string };
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
  bookSlot(slotId: string): Promise<DentalSchedulingWriteOutcome>;
  confirmAppointment(appointmentId: string): Promise<DentalSchedulingWriteOutcome>;
};
