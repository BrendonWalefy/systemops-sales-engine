import type { OutboundMessageCategory } from "@/application/ports/outbound-message-store";
import {
  ClinicTimezone,
  parseBusinessHours,
  type ParsedBusinessHours,
} from "@/core/scheduling/ClinicTimezone";

export type OutboundSafetyClinic = {
  id: string;
  timezone: string;
  businessHours: string | null;
  outboundHourlyCap: number;
  outboundDailyCap: number;
};

export type OutboundSafetyLead = {
  id: string;
  phone: string | null;
  whatsappLid: string | null;
  contactConsentRevokedAt: Date | null;
  status?: string;
};

export type OutboundSafetyGateInput = {
  category: OutboundMessageCategory;
  clinic: OutboundSafetyClinic;
  lead: OutboundSafetyLead | null;
  sentLastHour: number;
  sentToday: number;
  now?: Date;
  capJitterMs?: number;
};

export type OutboundSafetyGateDecision =
  | { action: "allow" }
  | { action: "cancel"; reason: "consent_revoked" }
  | {
      action: "defer";
      reason: "outbound_hourly_cap_exceeded" | "outbound_daily_cap_exceeded" | "quiet_hours";
      runAt: Date;
    };

const GATED_CATEGORIES = new Set<OutboundMessageCategory>([
  "follow_up",
  "recovery",
  "campaign",
]);

export function isOutboundSafetyGatedCategory(category: OutboundMessageCategory): boolean {
  return GATED_CATEGORIES.has(category);
}

export function evaluateOutboundSafetyGate(
  input: OutboundSafetyGateInput,
): OutboundSafetyGateDecision {
  if (!isOutboundSafetyGatedCategory(input.category)) return { action: "allow" };

  if (input.lead?.contactConsentRevokedAt) {
    return { action: "cancel", reason: "consent_revoked" };
  }

  const now = input.now ?? new Date();
  if (input.sentLastHour >= input.clinic.outboundHourlyCap) {
    return {
      action: "defer",
      reason: "outbound_hourly_cap_exceeded",
      runAt: addCapJitter(now, input.capJitterMs),
    };
  }

  if (input.sentToday >= input.clinic.outboundDailyCap) {
    return {
      action: "defer",
      reason: "outbound_daily_cap_exceeded",
      runAt: addCapJitter(now, input.capJitterMs),
    };
  }

  const timezone = new ClinicTimezone(input.clinic.timezone);
  const businessHours = parseBusinessHours(input.clinic.businessHours);
  if (!timezone.isBusinessHour(now, businessHours)) {
    return {
      action: "defer",
      reason: "quiet_hours",
      runAt: nextBusinessOpening(now, timezone, businessHours),
    };
  }

  return { action: "allow" };
}

export function getOutboundCapWindows(input: {
  clinic: Pick<OutboundSafetyClinic, "timezone">;
  now?: Date;
}): { hourlySince: Date; dailySince: Date } {
  const now = input.now ?? new Date();
  const timezone = new ClinicTimezone(input.clinic.timezone);
  return {
    hourlySince: new Date(now.getTime() - 60 * 60_000),
    dailySince: timezone.startOfLocalDay(now),
  };
}

function addCapJitter(now: Date, jitterMs?: number): Date {
  const jitter = jitterMs ?? Math.floor(Math.random() * 30 * 60_000);
  return new Date(now.getTime() + 30 * 60_000 + jitter);
}

function nextBusinessOpening(
  now: Date,
  timezone: ClinicTimezone,
  businessHours: ParsedBusinessHours,
): Date {
  const base = timezone.toLocalParts(now);

  for (let dayOffset = 0; dayOffset <= 14; dayOffset++) {
    const start = getStartForCandidateDay(base, dayOffset, timezone, businessHours);
    if (!start) continue;
    if (start.getTime() > now.getTime()) return start;
  }

  return new Date(now.getTime() + 24 * 60 * 60_000);
}

function getStartForCandidateDay(
  base: ReturnType<ClinicTimezone["toLocalParts"]>,
  dayOffset: number,
  timezone: ClinicTimezone,
  businessHours: ParsedBusinessHours,
): Date | null {
  const probe = timezone.fromLocalParts(base.year, base.month, base.day + dayOffset, 12, 0);
  const probeParts = timezone.toLocalParts(probe);
  if (!businessHours.days.includes(probeParts.weekday)) return null;

  const startHour =
    probeParts.weekday === 6 && businessHours.saturdayStartHour !== undefined
      ? businessHours.saturdayStartHour
      : businessHours.startHour;
  const startMinute =
    probeParts.weekday === 6 && businessHours.saturdayStartMinute !== undefined
      ? businessHours.saturdayStartMinute
      : businessHours.startMinute;

  return timezone.fromLocalParts(
    probeParts.year,
    probeParts.month,
    probeParts.day,
    startHour,
    startMinute,
  );
}
