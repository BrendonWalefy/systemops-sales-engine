/**
 * Helpers puros para a página da clínica (ADR-006 Fase A).
 * Testáveis sem efeitos colaterais.
 */

import type { ClinicTab } from "./clinic-tabs";

/** Calcula a aba padrão a partir do status operacional da clínica.
 *  Regra ADR-006 apêndice 2: clínicas em produção → "operacao"; demais → "implantacao".
 */
export function resolveDefaultTab(operationalStatus: string): ClinicTab {
  return operationalStatus === "active" ? "operacao" : "implantacao";
}

/** CTA contextual do header (Fase A — sem timeline ainda).
 *  Regra ADR-006 apêndice 5:
 *  - Sem channelPairedAt → "Conectar WhatsApp" (link ao wizard)
 *  - Com pareamento e shadowModeEnabled → "Ver implantação" (abre aba)
 *  - Em produção → "Inbox"
 */
export type ContextualCta =
  | { label: string; href: string; kind: "link" }
  | { label: string; tab: ClinicTab; kind: "tab" };

export function resolveContextualCta(clinic: {
  clinicId: string;
  channelPairedAt: Date | null;
  shadowModeEnabled: boolean;
  operationalStatus: string;
}): ContextualCta {
  const { clinicId, channelPairedAt, shadowModeEnabled, operationalStatus } = clinic;

  if (operationalStatus === "active") {
    return { label: "Inbox", href: "/app/inbox", kind: "link" };
  }

  if (channelPairedAt && shadowModeEnabled) {
    return { label: "Ver implantação", tab: "implantacao", kind: "tab" };
  }

  // Sem canal pareado ou sem shadow → direciona ao wizard de onboarding
  return {
    label: "Conectar WhatsApp",
    href: `/owner/onboarding/${clinicId}`,
    kind: "link",
  };
}
