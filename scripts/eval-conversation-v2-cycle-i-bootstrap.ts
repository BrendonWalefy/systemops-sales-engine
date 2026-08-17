import { createGitCycleIBuildAttestation } from "../src/infrastructure/conversation-v2/git-cycle-i-build-attestation";

// Trusted bootstrap boundary: no application, provider, corpus, or runner module is
// loaded until the closed admission snapshot has been captured.
const buildAttestation = createGitCycleIBuildAttestation();

const { config } = await import("dotenv");
config({ path: ".env.local" });

const { runCycleICli } = await import("./eval-conversation-v2-cycle-i");
runCycleICli(process.argv.slice(2), process.env, buildAttestation).then(
  (exitCode) => { process.exitCode = exitCode; },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : "Cycle I eval failed");
    process.exitCode = 1;
  },
);
