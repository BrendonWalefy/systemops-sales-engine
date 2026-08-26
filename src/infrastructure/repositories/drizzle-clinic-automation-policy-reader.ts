import { eq } from "drizzle-orm";
import type {
  ClinicAutomationFactsReader,
} from "@/application/ports/clinic-automation-policy-reader";
import type { InternalLabEligibilityReader } from "@/application/ports/internal-lab-eligibility-reader";
import { db } from "@/infrastructure/db/client";
import { organizations } from "@/infrastructure/db/schema";

export class DrizzleClinicAutomationPolicyReader
implements ClinicAutomationFactsReader, InternalLabEligibilityReader {
  async getAutomationFacts(clinicId: string) {
    const [clinic] = await db
      .select({
        isTest: organizations.isTest,
        isDemo: organizations.isDemo,
        autoReplyEnabled: organizations.autoReplyEnabled,
        operationalStatus: organizations.operationalStatus,
        shadowModeEnabled: organizations.shadowModeEnabled,
        liveAutomationEnabled: organizations.liveAutomationEnabled,
      })
      .from(organizations)
      .where(eq(organizations.id, clinicId))
      .limit(1);

    return clinic ? Object.freeze({ clinicId, ...clinic }) : null;
  }

  async getInternalLabEligibilityFacts(clinicId: string) {
    return this.getAutomationFacts(clinicId);
  }
}
