import type { CapturedV2TurnReads } from "@/application/conversation-v2/captured-turn-reads";
import type { DentalCatalogReadPort, DentalSchedulingReadPort } from "@/domain-packs/dental/ports";

export class CapturedReadUnavailableError extends Error {
  constructor() {
    super("captured read unavailable");
    this.name = "CapturedReadUnavailableError";
  }
}

function unavailable(): never {
  throw new CapturedReadUnavailableError();
}

export function createDentalCapturedReadAdapters(reads: CapturedV2TurnReads): {
  catalogRead: DentalCatalogReadPort;
  schedulingRead: DentalSchedulingReadPort;
} {
  return {
    catalogRead: {
      async resolveService(query) {
        if (reads.catalog.status !== "captured") unavailable();
        const match = reads.serviceResolutions.find((entry) => entry.query === query);
        if (!match) unavailable();
        return match.result;
      },
    },
    schedulingRead: {
      async listSlots(input) {
        const match = reads.slotSearches.find((entry) => entry.input.service === input.service
          && entry.input.date === input.date && entry.input.period === input.period
          && entry.input.minimumLeadTimeHours === input.minimumLeadTimeHours
          && entry.input.now === input.now.toISOString());
        if (!match) unavailable();
        return match.result;
      },
      async resolveOfferedSlot(input) {
        const match = reads.offeredSlotResolutions.find((entry) => entry.pendingStepId === input.pendingStepId
          && entry.ordinal === input.ordinal && entry.date === input.date && entry.time === input.time);
        if (!match) unavailable();
        return match.result;
      },
      async resolvePendingAppointment(pendingStepId) {
        const match = reads.pendingAppointmentResolutions.find((entry) => entry.pendingStepId === pendingStepId);
        if (!match) unavailable();
        return match.result;
      },
    },
  };
}
