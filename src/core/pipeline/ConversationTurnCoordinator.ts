import type { ConversationTurnLeaseStore } from "@/application/ports/conversation-turn-lease-store";

export const CONVERSATION_TURN_LEASE_TTL_MS = 90_000;
export const CONVERSATION_TURN_MAX_WAIT_MS = 45_000;
export const CONVERSATION_TURN_POLL_MS = 2_000;

type ConversationTurnCoordinatorOptions = {
  leaseTtlMs?: number;
  maxWaitMs?: number;
  pollMs?: number;
  now?: () => Date;
  sleep?: (durationMs: number) => Promise<void>;
  onReleaseError?: (conversationId: string, error: unknown) => void;
};

/**
 * Coordena a fronteira de execução de um turno sem conhecer WhatsApp, LLM,
 * pipeline ou banco. Toda conversa possui no máximo um decisor ativo.
 */
export class ConversationTurnCoordinator {
  private readonly leaseTtlMs: number;
  private readonly maxWaitMs: number;
  private readonly pollMs: number;
  private readonly now: () => Date;
  private readonly sleep: (durationMs: number) => Promise<void>;
  private readonly onReleaseError: (conversationId: string, error: unknown) => void;

  constructor(
    private readonly leaseStore: ConversationTurnLeaseStore,
    options: ConversationTurnCoordinatorOptions = {},
  ) {
    this.leaseTtlMs = options.leaseTtlMs ?? CONVERSATION_TURN_LEASE_TTL_MS;
    this.maxWaitMs = options.maxWaitMs ?? CONVERSATION_TURN_MAX_WAIT_MS;
    this.pollMs = options.pollMs ?? CONVERSATION_TURN_POLL_MS;
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? ((durationMs) =>
      new Promise((resolve) => setTimeout(resolve, durationMs)));
    this.onReleaseError = options.onReleaseError ?? (() => undefined);
  }

  async acquire(conversationId: string): Promise<boolean> {
    const startedAt = this.now().getTime();
    if (await this.tryAcquire(conversationId)) return true;

    while (this.now().getTime() - startedAt < this.maxWaitMs) {
      await this.sleep(this.pollMs);
      if (await this.tryAcquire(conversationId)) return true;
    }
    return false;
  }

  async release(conversationId: string): Promise<void> {
    try {
      await this.leaseStore.release(conversationId);
    } catch (error) {
      // O lease expira sozinho. Falha de liberação não pode transformar
      // uma resposta já decidida em retry e duplicar o envio.
      this.onReleaseError(conversationId, error);
    }
  }

  private async tryAcquire(conversationId: string): Promise<boolean> {
    const now = this.now();
    return this.leaseStore.tryAcquire({
      conversationId,
      now,
      leaseUntil: new Date(now.getTime() + this.leaseTtlMs),
    });
  }
}
