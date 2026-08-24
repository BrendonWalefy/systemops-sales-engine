export type OrphanedInboundEvent = {
  id: string;
  receivedAt: Date;
};

export type OrphanedOutboundMessage = {
  id: string;
  payload: unknown;
};

export type MessageJobOrphanReader = {
  listInboundWithoutJob(input: {
    olderThan: Date;
    limit: number;
  }): Promise<OrphanedInboundEvent[]>;
  listOutboundWithoutJob(input: {
    olderThan: Date;
    limit: number;
  }): Promise<OrphanedOutboundMessage[]>;
};
