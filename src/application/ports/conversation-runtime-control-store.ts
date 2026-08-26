export type ConversationRuntimeControl = Readonly<{
  liveOutboundEnabled: boolean;
  version: number;
}>;

export interface ConversationRuntimeControlStore {
  getGlobal(): Promise<ConversationRuntimeControl>;
  compareAndSetGlobal(input: Readonly<{
    expectedVersion: number;
    liveOutboundEnabled: boolean;
    actor: string;
    now: Date;
  }>): Promise<boolean>;
}
