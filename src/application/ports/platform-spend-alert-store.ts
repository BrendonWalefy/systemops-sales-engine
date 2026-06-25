export type PlatformSpendAlert = {
  id: string;
  provider: "vercel";
  teamId: string;
  budgetAmountUsd: number;
  currentSpendUsd: number;
  thresholdPercent: 50 | 75 | 100;
  eventKey: string;
  receivedAt: Date;
};

export type RecordPlatformSpendAlertInput = Omit<PlatformSpendAlert, "id">;

export type PlatformSpendAlertStore = {
  record(input: RecordPlatformSpendAlertInput): Promise<{ alert: PlatformSpendAlert; isNew: boolean }>;
  findLatest(provider: "vercel", since?: Date): Promise<PlatformSpendAlert | null>;
};
