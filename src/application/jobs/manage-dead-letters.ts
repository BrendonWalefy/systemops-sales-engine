export const LATE_DELIVERY_PROTECTION_MS = 15 * 60_000;

export type DeadLetterAction = "acknowledge" | "discard" | "reprocess";

export type DeadLetterCandidate = {
  id: string;
  queue: "message.process" | "message.send" | "followup.dispatch";
  status: "dead" | string;
  createdAt: Date;
  resolved: boolean;
  outboundStatus?: string | null;
};

export type DeadLetterResolutionInput = {
  action: DeadLetterAction;
  reason: string;
  allowLateDelivery?: boolean;
  now?: Date;
};

export function validateDeadLetterResolution(
  candidate: DeadLetterCandidate,
  input: DeadLetterResolutionInput,
): void {
  if (candidate.status !== "dead") {
    throw new Error("O job não está morto e não pode ser resolvido por esta operação.");
  }
  if (candidate.resolved) {
    throw new Error("Este dead letter já foi resolvido.");
  }
  if (input.reason.trim().length < 8) {
    throw new Error("Informe um motivo de auditoria com pelo menos 8 caracteres.");
  }
  if (input.action !== "reprocess" || candidate.queue !== "message.send") return;

  if (candidate.outboundStatus !== "dead") {
    throw new Error("A mensagem de saída não está morta; reprocessamento bloqueado.");
  }

  const now = input.now ?? new Date();
  const isLate = now.getTime() - candidate.createdAt.getTime() > LATE_DELIVERY_PROTECTION_MS;
  if (isLate && !input.allowLateDelivery) {
    throw new Error(
      "Entrega tardia bloqueada: confirme explicitamente allowLateDelivery para reprocessar.",
    );
  }
}
