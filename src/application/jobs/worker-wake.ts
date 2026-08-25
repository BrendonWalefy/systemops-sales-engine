export type WorkerKind = "message" | "sender";

export const MAX_EVENT_DRIVEN_MESSAGE_DELAY_MS = 30_000;
const WORKER_WAKE_REQUEST_TIMEOUT_MS = 3_000;

type WorkerWakeEnvironment = Readonly<Record<string, string | undefined>>;

export type WorkerWakeResult =
  | Readonly<{ requested: true; status: number }>
  | Readonly<{
      requested: false;
      reason:
        | "disabled"
        | "delay_exceeds_limit"
        | "no_base_url"
        | "no_secret"
        | "failed"
        | "rejected";
      status?: number;
    }>;

export function resolveWorkerBaseUrl(env: WorkerWakeEnvironment): string | null {
  const configuredUrl = env.NEXT_PUBLIC_APP_URL?.trim()
    ?? env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
    ?? env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const deploymentUrl = env.VERCEL_URL?.trim();
  if (env.VERCEL_ENV === "production" && configuredUrl) {
    return normalizeBaseUrl(configuredUrl);
  }
  if (deploymentUrl) return normalizeBaseUrl(deploymentUrl);

  return configuredUrl ? normalizeBaseUrl(configuredUrl) : null;
}

function normalizeBaseUrl(value: string): string {
  const normalized = value.replace(/\/+$/, "");
  return /^https?:\/\//.test(normalized) ? normalized : `https://${normalized}`;
}

export function resolveWorkerWakeDelay(input: {
  notBefore?: Date;
  now?: Date;
  maxDelayMs?: number;
}): { accepted: true; delayMs: number } | { accepted: false } {
  if (!input.notBefore) return { accepted: true, delayMs: 0 };
  const notBeforeMs = input.notBefore.getTime();
  if (!Number.isFinite(notBeforeMs)) return { accepted: false };
  const delayMs = Math.max(0, notBeforeMs - (input.now ?? new Date()).getTime());
  if (delayMs > (input.maxDelayMs ?? MAX_EVENT_DRIVEN_MESSAGE_DELAY_MS)) {
    return { accepted: false };
  }
  return { accepted: true, delayMs };
}

export async function requestWorkerRun(input: {
  worker: WorkerKind;
  notBefore?: Date;
  deferredWake?: boolean;
  env?: WorkerWakeEnvironment;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<WorkerWakeResult> {
  const env = input.env ?? process.env;
  if (env.DISABLE_EVENT_DRIVEN_WORKERS === "1") {
    return { requested: false, reason: "disabled" };
  }

  const wakeDelay = resolveWorkerWakeDelay({
    notBefore: input.notBefore,
    now: input.now,
  });
  if (!wakeDelay.accepted) {
    return { requested: false, reason: "delay_exceeds_limit" };
  }

  const secret = env.CRON_SECRET?.trim();
  if (!secret) return { requested: false, reason: "no_secret" };

  const baseUrl = resolveWorkerBaseUrl(env);
  if (!baseUrl) return { requested: false, reason: "no_base_url" };

  const params = new URLSearchParams({ ack: "1" });
  if (input.notBefore) params.set("notBefore", input.notBefore.toISOString());
  if (input.deferredWake) params.set("deferredWake", "1");
  const route = input.worker === "message" ? "message-worker" : "sender-worker";

  try {
    const response = await (input.fetchImpl ?? fetch)(
      `${baseUrl}/api/cron/${route}?${params.toString()}`,
      {
        method: "GET",
        headers: { authorization: `Bearer ${secret}` },
        cache: "no-store",
        signal: AbortSignal.timeout(WORKER_WAKE_REQUEST_TIMEOUT_MS),
      },
    );
    return response.status === 202
      ? { requested: true, status: response.status }
      : { requested: false, reason: "rejected", status: response.status };
  } catch {
    return { requested: false, reason: "failed" };
  }
}

export function requestMessageWorkerRun(input: {
  notBefore: Date;
  env?: WorkerWakeEnvironment;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<WorkerWakeResult> {
  return requestWorkerRun({ ...input, worker: "message" });
}

export function requestSenderWorkerRun(input: {
  notBefore?: Date;
  deferredWake?: boolean;
  env?: WorkerWakeEnvironment;
  fetchImpl?: typeof fetch;
  now?: Date;
} = {}): Promise<WorkerWakeResult> {
  return requestWorkerRun({ ...input, worker: "sender" });
}

export function scheduleMessageWorkerWake(
  schedule: (task: () => Promise<void>) => void,
  input: {
    notBefore: Date;
    onResult?: (result: WorkerWakeResult) => void;
  },
): void {
  try {
    schedule(async () => {
      const result = await requestMessageWorkerRun({ notBefore: input.notBefore });
      input.onResult?.(result);
    });
  } catch {
    // A wake is latency optimization only. The durable fallback cron owns recovery.
  }
}

export function scheduleSenderWorkerWake(
  schedule: (task: () => Promise<void>) => void,
  input: {
    notBefore?: Date;
    deferredWake?: boolean;
    request?: () => Promise<unknown>;
    onResult?: (result: WorkerWakeResult) => void;
  } = {},
): void {
  try {
    schedule(async () => {
      try {
        const result = input.request
          ? await input.request()
          : await requestSenderWorkerRun({
              notBefore: input.notBefore,
              deferredWake: input.deferredWake,
            });
        if (isWorkerWakeResult(result)) input.onResult?.(result);
      } catch {
        // The durable queue and fallback cron own recovery.
      }
    });
  } catch {
    // The caller may be outside a request scope. Durable recovery is unchanged.
  }
}

function isWorkerWakeResult(value: unknown): value is WorkerWakeResult {
  return Boolean(value && typeof value === "object" && "requested" in value);
}

export function scheduleAcceptedWorkerRun(input: {
  schedule: (task: () => Promise<void>) => void;
  notBefore?: Date;
  run: () => Promise<unknown>;
  now?: Date;
  sleep?: (delayMs: number) => Promise<void>;
}): boolean {
  const wakeDelay = resolveWorkerWakeDelay({
    notBefore: input.notBefore,
    now: input.now,
  });
  if (!wakeDelay.accepted) return false;

  try {
    input.schedule(async () => {
      if (wakeDelay.delayMs > 0) {
        await (input.sleep ?? sleepOnce)(wakeDelay.delayMs);
      }
      await input.run();
    });
    return true;
  } catch {
    return false;
  }
}

function sleepOnce(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
