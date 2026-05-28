import { spawnSync } from "node:child_process";

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const vercelEnv = process.env.VERCEL_ENV;
const shouldRunMigrations = vercelEnv === "production";

if (shouldRunMigrations) {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL nao definida para deploy de producao.");
    process.exit(1);
  }

  run("tsx", ["scripts/migrate.ts"]);
} else {
  console.log(`Pulando migrations no Vercel ${vercelEnv ?? "local"} deploy.`);
}

run("next", ["build"]);
