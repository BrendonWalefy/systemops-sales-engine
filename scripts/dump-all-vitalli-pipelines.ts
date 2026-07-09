import { db } from "../src/infrastructure/db/client";
import { treatments } from "../src/infrastructure/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  const clinicId = "d24a584a-faac-4a46-9750-a718d0f8e686"; // Clínica Vitalli
  const orgTreatments = await db.select().from(treatments).where(eq(treatments.clinicId, clinicId));
  
  for (const t of orgTreatments) {
    if (t.pipelineSteps || t.triggerTemplate) {
      console.log(`\nTreatment: ${t.name}`);
      console.log(`Pipeline Steps: ${JSON.stringify(t.pipelineSteps)}`);
      if (t.triggerTemplate) console.log(`Trigger Template: ${t.triggerTemplate}`);
    }
  }
  process.exit(0);
}

main().catch(console.error);
