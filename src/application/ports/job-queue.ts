export type JobQueueName = "message.process" | "message.send" | "followup.dispatch";

export type JobStatus = "pending" | "processing" | "done" | "failed" | "dead";

export type JobRecord = {
  id: string;
  queue: JobQueueName;
  status: JobStatus;
  payload: unknown;
  dedupeKey: string | null;
  attempts: number;
  maxAttempts: number;
  runAt: Date;
  lockedAt: Date | null;
  lockedBy: string | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type EnqueueJobInput = {
  queue: JobQueueName;
  payload: unknown;
  dedupeKey?: string;
  runAt?: Date;
  maxAttempts?: number;
};

export type EnqueueJobResult = {
  job: JobRecord;
  isNew: boolean;
};

export type ClaimNextJobInput = {
  queues: JobQueueName[];
  workerId: string;
  now?: Date;
  dedupeKey?: string;
};

export type FailJobInput = {
  job: JobRecord;
  workerId: string;
  error: string;
  retryAt: Date;
  now?: Date;
};

export type JobQueue = {
  enqueueJob(input: EnqueueJobInput): Promise<EnqueueJobResult>;
  claimNextJob(input: ClaimNextJobInput): Promise<JobRecord | null>;
  completeJob(jobId: string, workerId: string, now?: Date): Promise<boolean>;
  releaseJob(jobId: string, workerId: string, runAt: Date, now?: Date): Promise<boolean>;
  failJob(input: FailJobInput): Promise<JobStatus | null>;
  recoverStaleJobs(input: { olderThan: Date }): Promise<number>;
};
