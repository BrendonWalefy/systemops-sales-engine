import type { ClinicOperationalStatus } from "@/application/clinics/clinic-operational-status";

export function getClinicOperationalStatusLabel(
  status: ClinicOperationalStatus | null | undefined,
): string {
  switch (status) {
    case "active":
      return "Ativa";
    case "paused":
      return "Pausada";
    case "test":
      return "Teste";
    case "cancelled":
      return "Cancelada";
    case "prospect":
    default:
      return "Prospect";
  }
}

export function getClinicOperationalStatusColors(
  status: ClinicOperationalStatus | null | undefined,
): {
  text: string;
  background: string;
  border: string;
} {
  switch (status) {
    case "active":
      return {
        text: "#34d399",
        background: "rgba(16,185,129,0.12)",
        border: "rgba(16,185,129,0.26)",
      };
    case "paused":
      return {
        text: "#f59e0b",
        background: "rgba(245,158,11,0.12)",
        border: "rgba(245,158,11,0.26)",
      };
    case "test":
      return {
        text: "#818cf8",
        background: "rgba(99,102,241,0.12)",
        border: "rgba(99,102,241,0.26)",
      };
    case "cancelled":
      return {
        text: "#f87171",
        background: "rgba(239,68,68,0.12)",
        border: "rgba(239,68,68,0.26)",
      };
    case "prospect":
    default:
      return {
        text: "#60a5fa",
        background: "rgba(59,130,246,0.12)",
        border: "rgba(59,130,246,0.24)",
      };
  }
}

export function isBillableOperationalStatus(
  status: ClinicOperationalStatus | null | undefined,
): boolean {
  return status === "active" || status === "paused";
}
