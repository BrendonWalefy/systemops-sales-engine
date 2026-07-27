export type AcquireConversationTurnLeaseInput = {
  conversationId: string;
  now: Date;
  leaseUntil: Date;
};

/**
 * Porta atômica do lease que serializa decisões de uma mesma conversa.
 * A implementação deve fazer o compare-and-set em uma única operação.
 */
export type ConversationTurnLeaseStore = {
  tryAcquire(input: AcquireConversationTurnLeaseInput): Promise<boolean>;
  release(conversationId: string): Promise<void>;
};
