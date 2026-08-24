export type OrphanedInboundEvent = {
  id: string;
};

export type OrphanedOutboundMessage = {
  id: string;
  payload: unknown;
};

export type MessageJobOrphanReader = {
  listInboundAuthorityCandidates(input: {
    olderThan: Date;
    limit: number;
  }): Promise<OrphanedInboundEvent[]>;
  listOutboundWithoutJob(input: {
    olderThan: Date;
    limit: number;
  }): Promise<OrphanedOutboundMessage[]>;
};
