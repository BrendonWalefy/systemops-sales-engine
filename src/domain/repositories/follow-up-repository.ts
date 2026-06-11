import type { FollowUp } from "../entities/follow-up";

export type FollowUpRepository = {
  save(followUp: FollowUp): Promise<void>;
  listDue(input: { clinicId: string; now: Date }): Promise<FollowUp[]>;
  findPendingByReason(input: { leadId: string; reason: string }): Promise<FollowUp | null>;
  cancelPendingByReason(input: { leadId: string; reason: string }): Promise<number>;
  /**
   * Claim atômico antes do envio (CAS): pending → sending. Retorna false se
   * outro run do dispatcher já reivindicou este follow-up — não reenviar.
   */
  claimForSending(id: string): Promise<boolean>;
  /** Devolve para pending follow-ups presos em "sending" (run que morreu). */
  recoverStaleSending(input: { clinicId: string; olderThan: Date }): Promise<number>;
};
