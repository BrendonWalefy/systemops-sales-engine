export type RecoveryDeliveryResult = {
  ok: boolean;
  error?: string;
};

type RecoveryDeliveryDependencies = {
  send: () => Promise<string | null>;
  persistMessage: (providerMessageId: string | null) => Promise<void>;
  resumeConversation: () => Promise<void>;
  markRecoveryComplete: () => Promise<void>;
  onBookkeepingError?: (stage: string, error: unknown) => void;
};

/**
 * Delivers a recovery message and keeps post-delivery bookkeeping best-effort.
 * Once the channel accepts the message, a bookkeeping failure must not be
 * reported as a delivery failure to the operator.
 */
export async function deliverRecoveryMessage(
  dependencies: RecoveryDeliveryDependencies,
): Promise<RecoveryDeliveryResult> {
  let providerMessageId: string | null;

  try {
    providerMessageId = await dependencies.send();
  } catch {
    return { ok: false, error: "WhatsApp send failed — mensagem não entregue" };
  }

  const runBestEffort = async (stage: string, operation: () => Promise<void>) => {
    try {
      await operation();
    } catch (error: unknown) {
      dependencies.onBookkeepingError?.(stage, error);
    }
  };

  await runBestEffort("message_persistence", () =>
    dependencies.persistMessage(providerMessageId),
  );
  await runBestEffort("conversation_resume", dependencies.resumeConversation);
  await runBestEffort("follow_up_completion", dependencies.markRecoveryComplete);

  return { ok: true };
}
