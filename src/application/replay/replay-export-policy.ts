import path from "node:path";
import { stat } from "node:fs/promises";

export function assertClinicAllowedForReplayExport(
  clinicKey: string,
  allowlistValue: string | undefined,
): void {
  const allowed = new Set(
    (allowlistValue ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (allowed.size === 0) {
    throw new Error("REPLAY_EXPORT_ALLOWED_CLINICS must contain an explicit allowlist");
  }
  if (!allowed.has(clinicKey)) {
    throw new Error(`Clinic "${clinicKey}" is not allowed for replay export`);
  }
}

/**
 * Artefatos `needs_review` não podem nascer dentro de nenhum repositório Git.
 * O caminho precisa existir e ser absoluto para que symlinks sejam resolvidos
 * pelo chamador antes desta validação.
 */
export async function assertReplayOutputOutsideGitRepository(
  realOutputDirectory: string,
): Promise<void> {
  if (!path.isAbsolute(realOutputDirectory)) {
    throw new Error("Replay output directory must be absolute");
  }

  let current = realOutputDirectory;
  while (true) {
    if (await pathExists(path.join(current, ".git"))) {
      throw new Error("Replay output directory must be outside every Git repository");
    }
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}
