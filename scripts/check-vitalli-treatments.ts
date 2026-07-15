import { db } from "../src/infrastructure/db/client";
import { organizations, treatments } from "../src/infrastructure/db/schema";
import { eq, ilike } from "drizzle-orm";

async function main() {
  const vitalliOrgs = await db.select().from(organizations).where(ilike(organizations.name, "%Vitalli%"));
  
  if (vitalliOrgs.length === 0) {
    console.log("No Vitalli clinic found.");
    process.exit(1);
  }
  
  for (const org of vitalliOrgs) {
    console.log(`\nFound Clinic: ${org.name} (ID: ${org.id})`);
    
    const orgTreatments = await db.select().from(treatments).where(eq(treatments.clinicId, org.id));
    
    console.log(`Treatments:`);
    if (orgTreatments.length === 0) {
      console.log(`  (none)`);
    }
    for (const t of orgTreatments) {
      console.log(`  - ${t.name}: priceCents=${t.priceCents}, priceKind=${t.priceKind}, unit=${t.priceUnit}, isQuotable=${t.priceQuotableInChat}`);
    }
  }
  
  process.exit(0);
}

main().catch(console.error);
