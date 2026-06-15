export type ClinicOperationalStatus =
  | "prospect"
  | "test"
  | "active"
  | "paused"
  | "cancelled";

export function resolveInitialClinicOperationalStatus(input: {
  isTest: boolean;
}): ClinicOperationalStatus {
  return input.isTest ? "test" : "prospect";
}

export function resolveOperationalStatusFromAutomationState(input: {
  currentStatus?: ClinicOperationalStatus | null;
  isTest: boolean;
  autoReplyEnabled: boolean;
}): ClinicOperationalStatus {
  if (input.currentStatus === "cancelled") return "cancelled";
  if (input.isTest) return "test";
  if (!input.currentStatus || input.currentStatus === "prospect") {
    return "prospect";
  }
  return input.autoReplyEnabled ? "active" : "paused";
}
