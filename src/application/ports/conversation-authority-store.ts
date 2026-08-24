export type ConversationAuthorityVersion = 0 | 1 | 2 | 3;

export interface ConversationAuthorityStore {
  getVersion(clinicId: string): Promise<ConversationAuthorityVersion>;
  compareAndSetVersion(input: Readonly<{
    clinicId: string;
    expectedVersion: ConversationAuthorityVersion;
    nextVersion: ConversationAuthorityVersion;
    actor: string;
    now: Date;
  }>): Promise<boolean>;
}
