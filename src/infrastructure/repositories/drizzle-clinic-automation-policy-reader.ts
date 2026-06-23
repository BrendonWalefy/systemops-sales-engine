import { eq } from "drizzle-orm";
import type { ClinicAutomationPolicyReader } from "@/application/ports/clinic-automation-policy-reader";
import { shouldSendAutomatedClinicOutbound } from "@/application/automation/clinic-automation-policy";
import { db } from "@/infrastructure/db/client";
import { clinics } from "@/infrastructure/db/schema";

export class DrizzleClinicAutomationPolicyReader implements ClinicAutomationPolicyReader {
  async canSendAutomatedReply(clinicId: string): Promise<boolean> {
    const [clinic] = await db
      .select({
        autoReplyEnabled: clinics.autoReplyEnabled,
        operationalStatus: clinics.operationalStatus,
      })
      .from(clinics)
      .where(eq(clinics.id, clinicId))
      .limit(1);

    return clinic ? shouldSendAutomatedClinicOutbound(clinic) : false;
  }
}
