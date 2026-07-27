import { eq } from "drizzle-orm";
import type { ClinicAutomationPolicyReader } from "@/application/ports/clinic-automation-policy-reader";
import { resolveClinicAutomationMode } from "@/application/automation/clinic-automation-policy";
import { db } from "@/infrastructure/db/client";
import { organizations } from "@/infrastructure/db/schema";

export class DrizzleClinicAutomationPolicyReader implements ClinicAutomationPolicyReader {
  async getAutomationMode(clinicId: string) {
    const [clinic] = await db
      .select({
        autoReplyEnabled: organizations.autoReplyEnabled,
        operationalStatus: organizations.operationalStatus,
        shadowModeEnabled: organizations.shadowModeEnabled,
      })
      .from(organizations)
      .where(eq(organizations.id, clinicId))
      .limit(1);

    return clinic ? resolveClinicAutomationMode(clinic) : "disabled" as const;
  }
}
