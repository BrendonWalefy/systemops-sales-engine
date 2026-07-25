export function assertReplaySandboxEnvironment(env: NodeJS.ProcessEnv): {
  databaseHost: string;
} {
  if (env.E2E_MODE !== "true" || env.E2E_REPLAY_MODE !== "true") {
    throw new Error("Replay endpoint requires E2E_MODE=true and E2E_REPLAY_MODE=true");
  }
  if (env.VERCEL_ENV === "production") {
    throw new Error("Replay endpoint is forbidden in a production runtime");
  }
  const databaseUrl = required(env.DATABASE_URL, "DATABASE_URL");
  const expectedSandboxHost = required(
    env.REPLAY_SANDBOX_DATABASE_HOST,
    "REPLAY_SANDBOX_DATABASE_HOST",
  );
  const productionHost = required(
    env.REPLAY_PRODUCTION_DATABASE_HOST,
    "REPLAY_PRODUCTION_DATABASE_HOST",
  );
  const databaseHost = new URL(databaseUrl).hostname.toLowerCase();
  if (databaseHost !== expectedSandboxHost.toLowerCase()) {
    throw new Error("DATABASE_URL does not match REPLAY_SANDBOX_DATABASE_HOST");
  }
  if (databaseHost === productionHost.toLowerCase()) {
    throw new Error("Replay sandbox database host must differ from production");
  }
  return { databaseHost };
}

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value.trim();
}
