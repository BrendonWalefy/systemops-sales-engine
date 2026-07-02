// Marca o tenant (clínica) no escopo atual do Sentry, permitindo filtrar erros
// por clínica no dashboard — essencial no multi-tenant. Seguro em qualquer
// runtime: vira no-op quando o Sentry não está ativo (sem DSN / dev local).
import * as Sentry from "@sentry/nextjs";

export function setSentryClinic(clinicId: string | null | undefined): void {
  if (!clinicId) return;
  Sentry.setTag("clinic_id", clinicId);
}
